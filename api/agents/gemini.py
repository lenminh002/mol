"""Gemini skeptic: a different model family challenges Claude's case, so disagreement is genuine."""

import os

from google import genai
from google.genai import types

from agents import prompts
from agents.evidence import EvidenceBoard

# Tried in order. Flash runs on the free tier; set GEMINI_MODEL=gemini-pro-latest with a paid key for a
# stronger skeptic. gemini-2.5-flash is the last resort: older, but the most reliably available.
MODELS = list(dict.fromkeys([os.getenv("GEMINI_MODEL", "gemini-3.8-flash"), "gemini-flash-latest",
                             "gemini-2.5-flash"]))
REQUEST_TIMEOUT_MS = 45_000

_client: genai.Client | None = None


def client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    return _client


async def challenge(board: EvidenceBoard, drug: str, target: str | None, case: str) -> str:
    async def drug_info(name: str) -> str:
        """Look up a drug in PubChem and compute drug-likeness properties (MW, logP, Lipinski).

        Args:
            name: Common drug name.
        """
        return await board.drug_info("skeptic", name)

    async def target_info(name: str) -> str:
        """Resolve a protein target to UniProt, a PDB structure, and its location in the cell.

        Args:
            name: Target name or gene symbol.
        """
        return await board.target_info("skeptic", name)

    async def search_literature(query: str) -> str:
        """Search the literature index (PubMed, ClinicalTrials.gov, web) for counter-evidence or gaps.

        Args:
            query: Search terms.
        """
        return await board.literature("skeptic", query)

    async def knowledge_graph(entity: str) -> str:
        """Look up a drug, gene or pathway in the biomedical knowledge graph (Hetionet) and list its relations.

        Args:
            entity: Drug, gene symbol or pathway name.
        """
        return await board.graph_neighbors("skeptic", entity)

    async def off_targets(drug: str, primary: str = "") -> str:
        """Other proteins the drug is recorded to bind besides the primary target, plus recorded side effects.

        Args:
            drug: Drug name.
            primary: The primary target to exclude, e.g. "ABL1".
        """
        return await board.graph_off_targets("skeptic", drug, primary or None)

    prompt = (
        f"Drug: {drug}\nTarget: {target or 'unspecified'}\n\n"
        f"The pharmacologist's case:\n{case}\n\n"
        f"Sources already gathered (you may cite these):\n"
        + "\n".join(f"- [{c['id']}] {c['title']}" for c in board.citations.values())
    )
    errors = []
    for model in MODELS:
        # Automatic function calling runs through the chat API, as the SDK recommends. The SDK's own
        # retries are off: on overload we'd rather move to the next model than back off for a minute.
        chat = client().aio.chats.create(
            model=model,
            config=types.GenerateContentConfig(
                system_instruction=prompts.SKEPTIC,
                tools=[drug_info, target_info, search_literature, knowledge_graph, off_targets],
                automatic_function_calling=types.AutomaticFunctionCallingConfig(maximum_remote_calls=8),
                http_options=types.HttpOptions(
                    timeout=REQUEST_TIMEOUT_MS, retry_options=types.HttpRetryOptions(attempts=1)
                ),
            ),
        )
        try:
            resp = await chat.send_message(prompt)
        except Exception as e:  # noqa: BLE001 — overload/quota/timeout: try the next model
            errors.append(f"{model}: {str(e)[:80]}")
            continue
        text = (resp.text or "").strip()
        if text:
            return text
        errors.append(f"{model}: empty response")
    raise RuntimeError("; ".join(errors))


def verdict(challenge_text: str) -> str:
    """'SOUND' or 'CHALLENGED' from the skeptic's final line (defaults to CHALLENGED if missing)."""
    tail = challenge_text.strip().splitlines()[-1].upper() if challenge_text.strip() else ""
    return "SOUND" if "SOUND" in tail and "CHALLENGED" not in tail else "CHALLENGED"
