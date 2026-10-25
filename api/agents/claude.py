"""Claude roles: query parsing, the proposer (tool-using), the rebuttal, and the judge (structured verdict)."""

import os
import re
from collections.abc import AsyncIterator, Callable
from typing import Literal

import anthropic
from anthropic import beta_async_tool
from pydantic import BaseModel, Field

from agents import prompts
from agents.evidence import EvidenceBoard

MODEL = os.getenv("CLAUDE_MODEL", "claude-opus-5-5")

# Server-side refusal fallback: if a safety classifier declines, the API retries on the model
# Anthropic recommends for that refusal category, inside the same call.
FALLBACK = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
WEB_SEARCH = {"type": "web_search_20260209", "name": "web_search", "max_uses": 3}

_client: anthropic.AsyncAnthropic | None = None


def client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic()
    return _client


class AgentRefused(Exception):
    pass


def _check(message) -> None:
    if message.stop_reason == "refusal":
        category = getattr(message.stop_details, "category", None) if message.stop_details else None
        raise AgentRefused(f"Claude declined this request (category: {category})")


def _text(message) -> str:
    return "\n".join(b.text for b in message.content if b.type == "text").strip()


BRACKETS = re.compile(r"\[([^\]]+)\]")
SOURCE_ID = re.compile(r"^(?:pmid|nct|pubchem|pdb|dock|uniprot|web|hetionet|curated):\S+$")


def source_ids(text: str) -> list[str]:
    """Source ids cited inline, including grouped citations like [pdb:1IEP; pmid:123]."""
    ids = []
    for group in BRACKETS.findall(text):
        for part in re.split(r"[;,]\s*", group):
            if SOURCE_ID.match(part.strip()):
                ids.append(part.strip())
    return list(dict.fromkeys(ids))


# --- parse ----------------------------------------------------------------------


class ParsedQuery(BaseModel):
    drug: str
    target: str | None = None
    context: str | None = None


async def parse_query(prompt: str) -> ParsedQuery:
    resp = await client().beta.messages.parse(
        model=MODEL,
        max_tokens=2000,
        system=prompts.PARSE,
        output_config={"effort": "low"},
        output_format=ParsedQuery,
        messages=[{"role": "user", "content": prompt}],
        **FALLBACK,
    )
    _check(resp)
    return resp.parsed_output


# --- tool-using roles (proposer, and skeptic when Gemini is unavailable) ---------

ROLE_LABEL = {"proposer": "Pharmacologist", "skeptic": "Skeptic"}


def _tools(board: EvidenceBoard, agent: str) -> list:
    @beta_async_tool
    async def drug_info(name: str) -> str:
        """Look up a drug in PubChem and compute drug-likeness properties (MW, logP, Lipinski).

        Args:
            name: Common drug name, e.g. "imatinib".
        """
        return await board.drug_info(agent, name)

    @beta_async_tool
    async def target_info(name: str) -> str:
        """Resolve a protein target to UniProt, a PDB structure, and its location in the cell.

        Args:
            name: Target name or gene symbol, e.g. "BCR-ABL", "PTGS2", "HMG-CoA reductase".
        """
        return await board.target_info(agent, name)

    @beta_async_tool
    async def dock(drug_name: str, target_name: str) -> str:
        """Dock a small-molecule drug into a target with DiffDock; returns pose confidence (a ranking score).

        Args:
            drug_name: Drug name, as used with drug_info.
            target_name: Target name, as used with target_info.
        """
        return await board.dock(agent, drug_name, target_name)

    @beta_async_tool
    async def search_literature(query: str) -> str:
        """Search the literature index: PubMed abstracts, ClinicalTrials.gov records and curated web pages.
        Returns documents with source_id, type, title, year and text.

        Args:
            query: Search terms, e.g. "imatinib BCR-ABL STAT5 apoptosis".
        """
        return await board.literature(agent, query)

    @beta_async_tool
    async def knowledge_graph(entity: str) -> str:
        """Look up a drug, gene or pathway in the biomedical knowledge graph (Hetionet: 29 curated databases).
        Returns its relations: targets it binds, diseases it treats, pathways and cell components, side effects.

        Args:
            entity: Drug, gene symbol or pathway name, e.g. "imatinib", "ABL1", "PTGS1".
        """
        return await board.graph_neighbors(agent, entity)

    @beta_async_tool
    async def mechanism_path(drug: str, region: str, via: str | None = None) -> str:
        """Find the shortest curated chain from a drug to a cell region, e.g. drug -binds-> target
        -located in-> component -is part of-> region. Use it to ground where each effect happens.

        Args:
            drug: Drug name.
            region: One of membrane, cytoplasm, nucleus, mitochondria, er.
            via: Optional target to route the chain through, e.g. "ABL1".
        """
        return await board.graph_path(agent, drug, region, via)

    @beta_async_tool
    async def off_targets(drug: str, primary: str | None = None) -> str:
        """Other proteins the drug is recorded to bind (besides the primary target), with their cell regions,
        and a sample of recorded side effects (SIDER).

        Args:
            drug: Drug name.
            primary: The primary target to exclude, e.g. "ABL1".
        """
        return await board.graph_off_targets(agent, drug, primary)

    return [drug_info, target_info, dock, search_literature, knowledge_graph, mechanism_path, off_targets,
            WEB_SEARCH]


async def _run_with_tools(board: EvidenceBoard, agent: str, system: str, ask: str,
                          emit: Callable[[dict], None]) -> str:
    runner = client().beta.messages.tool_runner(
        model=MODEL,
        max_tokens=16000,
        max_iterations=12,
        system=system,
        thinking={"type": "adaptive", "display": "summarized"},
        output_config={"effort": "medium"},
        tools=_tools(board, agent),
        messages=[{"role": "user", "content": ask}],
        **FALLBACK,
    )
    last = None
    async for message in runner:
        last = message
        _check(message)
        for block in message.content:
            if block.type == "thinking" and block.thinking:
                emit({"type": "status", "message": f"{ROLE_LABEL[agent]}: {block.thinking[:220]}"})
            elif block.type == "server_tool_use" and block.name == "web_search":
                emit({"type": "tool_call", "agent": agent, "tool": "web_search", "args": dict(block.input)})
            elif block.type == "web_search_tool_result" and isinstance(block.content, list):
                for r in block.content:
                    if getattr(r, "url", None):
                        board.cite(f"web:{r.url}", r.title or r.url, r.url)
    if last is None:
        raise RuntimeError(f"{ROLE_LABEL[agent]} produced no response")
    return _text(last)


async def propose(board: EvidenceBoard, drug: str, target: str | None, context: str | None,
                  emit: Callable[[dict], None]) -> str:
    ask = f"Drug: {drug}"
    if target:
        ask += f"\nTarget: {target}"
    if context:
        ask += f"\nContext: {context}"
    return await _run_with_tools(board, "proposer", prompts.PROPOSER, ask, emit)


async def challenge(board: EvidenceBoard, drug: str, target: str | None, case: str,
                    emit: Callable[[dict], None]) -> str:
    """Claude as the reviewer: used only when the Gemini skeptic is unavailable."""
    ask = f"Drug: {drug}\nTarget: {target or 'unspecified'}\n\nThe colleague's summary:\n{case}"
    return await _run_with_tools(board, "skeptic", prompts.CLAUDE_REVIEWER, ask, emit)


async def rebut(case: str, challenge: str) -> str:
    resp = await client().beta.messages.create(
        model=MODEL,
        max_tokens=8000,
        system=prompts.REBUTTAL,
        thinking={"type": "adaptive", "display": "summarized"},
        output_config={"effort": "medium"},
        messages=[
            {"role": "user", "content": f"Your case:\n{case}\n\nThe skeptic's challenge:\n{challenge}"},
        ],
        **FALLBACK,
    )
    _check(resp)
    return _text(resp)


# --- follow-up chat -------------------------------------------------------------

PROPOSE_RESIMULATION = {
    "name": "propose_resimulation",
    "description": "Ask the user to confirm a new simulation. Nothing runs until they agree.",
    "input_schema": {
        "type": "object",
        "properties": {
            "prompt": {"type": "string", "description": "Self-contained question for the new simulation"},
            "reason": {"type": "string", "description": "One sentence on why the current result cannot answer"},
        },
        "required": ["prompt", "reason"],
    },
}


async def followup(result_json: str, messages: list[dict]) -> AsyncIterator[dict]:
    """Answer a question about a finished result, streaming {"type": "delta", "text"} chunks, then either
    {"type": "done"} or {"type": "resimulate_proposal", "prompt", "reason"}. A new simulation is only ever
    proposed, never run."""
    async with client().beta.messages.stream(
        model=MODEL,
        max_tokens=4000,
        system=f"{prompts.FOLLOWUP}\n\n<result>\n{result_json}\n</result>",
        output_config={"effort": "medium"},
        tools=[PROPOSE_RESIMULATION],
        messages=messages,
        **FALLBACK,
    ) as stream:
        async for text in stream.text_stream:
            yield {"type": "delta", "text": text}
        final = await stream.get_final_message()
    _check(final)
    for block in final.content:
        if block.type == "tool_use" and block.name == "propose_resimulation":
            yield {"type": "resimulate_proposal", "prompt": block.input["prompt"], "reason": block.input["reason"]}
            return
    yield {"type": "done"}


# --- judge ----------------------------------------------------------------------

Region = Literal["membrane", "cytoplasm", "nucleus", "mitochondria", "er"]


class JudgeTarget(BaseModel):
    name: str = Field(description="Target name as it appears in the evidence")
    cell_location: Region


class JudgeEffect(BaseModel):
    pathway: str
    organelle: Region
    direction: Literal["up", "down", "block"]
    magnitude: float = Field(description="0 to 1")
    status: Literal["agreed", "disputed", "speculative"]
    confidence: float = Field(description="0 to 1")
    explanation: str
    source_ids: list[str]


class JudgeHop(BaseModel):
    source: str
    relation: str
    target: str
    source_id: str | None = None


class JudgeVerdict(BaseModel):
    targets: list[JudgeTarget]
    effects: list[JudgeEffect]
    reasoning_path: list[JudgeHop]
    caveats: list[str]
    summary: str
    verdict_note: str = Field(description="One or two sentences explaining how the debate was resolved")


async def judge(evidence: str, transcript: str) -> JudgeVerdict:
    resp = await client().beta.messages.parse(
        model=MODEL,
        max_tokens=16000,
        system=prompts.JUDGE,
        output_config={"effort": "high"},
        output_format=JudgeVerdict,
        messages=[
            {"role": "user", "content": f"<evidence>\n{evidence}\n</evidence>\n\n<debate>\n{transcript}\n</debate>"}
        ],
        **FALLBACK,
    )
    _check(resp)
    if resp.parsed_output is None:
        raise RuntimeError(f"Judge returned no structured verdict (stop_reason={resp.stop_reason})")
    return resp.parsed_output
