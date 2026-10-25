"""Runs one simulation: resolve input -> proposer (Claude) -> skeptic (Gemini) -> rebuttal -> judge (Claude).

Yields SSE event dicts as it goes. Any failure falls back to a cached preset result if one exists.
"""

import asyncio
import logging
import os
from collections.abc import AsyncIterator, Callable
from pathlib import Path

from agents import claude, gemini
from agents.evidence import EvidenceBoard
from presets import PRESETS_BY_ID
from schemas import Citation, DebateTurn, Drug, Effect, PathHop, SimulateRequest, SimulationResult, Target

log = logging.getLogger("mol.debate")
CACHE_DIR = Path(__file__).parent.parent / "cache"
SKEPTIC_TIMEOUT_S = 100  # covers both Gemini models at 45 s each


def cached_result(preset_id: str | None) -> SimulationResult | None:
    path = CACHE_DIR / f"{preset_id}.json" if preset_id else None
    if path and path.exists():
        return SimulationResult.model_validate_json(path.read_text())
    return None


async def run_simulation(req: SimulateRequest) -> AsyncIterator[dict]:
    """Stream events from the debate task as they are emitted."""
    queue: asyncio.Queue[dict] = asyncio.Queue()
    task = asyncio.create_task(_debate(req, queue.put_nowait))
    while True:
        getter = asyncio.create_task(queue.get())
        done, _ = await asyncio.wait({getter, task}, return_when=asyncio.FIRST_COMPLETED)
        if getter in done:
            yield getter.result()
            continue
        getter.cancel()
        while not queue.empty():
            yield queue.get_nowait()
        if task.exception():
            yield {"type": "error", "message": f"Simulation crashed: {task.exception()}"}
        return


async def _debate(req: SimulateRequest, emit: Callable[[dict], None]) -> None:
    try:
        result = await _live(req, emit)
    except Exception as e:  # noqa: BLE001 — any failure degrades to the cached demo
        log.exception("live debate failed")
        fallback = cached_result(req.preset)
        if fallback is None:
            emit({"type": "error", "message": f"Simulation failed: {e}"})
            return
        emit({"type": "status", "message": f"Live run failed ({e}); showing the cached result."})
        fallback.from_cache = True
        for turn in fallback.debate:
            emit({"type": "turn", "turn": turn.model_dump()})
        emit({"type": "result", "result": fallback.model_dump(by_alias=True)})
        return

    if req.preset:  # remember successful preset runs for instant, offline-safe demos
        (CACHE_DIR / f"{req.preset}.json").write_text(result.model_dump_json(by_alias=True, indent=2))
    emit({"type": "result", "result": result.model_dump(by_alias=True)})


async def _live(req: SimulateRequest, emit: Callable[[dict], None]) -> SimulationResult:
    missing = [k for k in ("ANTHROPIC_API_KEY", "GEMINI_API_KEY") if not os.getenv(k)]
    if missing:
        raise RuntimeError(f"{' and '.join(missing)} not set in mol/.env")

    # 1. Resolve what we're simulating.
    context = None
    if preset := PRESETS_BY_ID.get(req.preset or ""):
        drug, target = preset.drug, preset.target
    elif req.prompt:
        emit({"type": "status", "message": "Reading your question…"})
        parsed = await claude.parse_query(req.prompt)
        drug, target, context = parsed.drug, parsed.target, parsed.context
    elif req.drug:
        drug, target = req.drug, req.target
    else:
        raise ValueError("Provide a preset, a prompt, or a drug")
    emit({"type": "parsed", "drug": drug, "target": target, "context": context})

    board = EvidenceBoard(emit)
    debate: list[DebateTurn] = []

    def say(agent: str, round_: int, text: str, model: str = "Claude") -> None:
        turn = DebateTurn(agent=agent, round=round_, text=text, model=model, source_ids=claude.source_ids(text))
        debate.append(turn)
        emit({"type": "turn", "turn": turn.model_dump()})

    # 2. Proposer builds the case with tools.
    emit({"type": "status", "message": f"Pharmacologist (Claude) is investigating {drug}…"})
    case = await claude.propose(board, drug, target, context, emit)
    say("proposer", 1, case)

    # 3. Skeptic challenges it: Gemini, or Claude in the same role if Gemini is down or slow.
    emit({"type": "status", "message": "Skeptic (Gemini) is checking the case…"})
    try:
        challenge = await asyncio.wait_for(gemini.challenge(board, drug, target, case), SKEPTIC_TIMEOUT_S)
        say("skeptic", 1, challenge, model="Gemini")
    except Exception as e:  # noqa: BLE001 — includes timeouts, 429 quota and 503 overload
        reason = "timed out" if isinstance(e, TimeoutError) else str(e).split(".")[0][:120]
        log.warning("Gemini skeptic unavailable: %s", e)
        emit({"type": "status", "message": f"Gemini unavailable ({reason}); Claude takes the skeptic role."})
        try:
            challenge = await claude.challenge(board, drug, target, case, emit)
            say("skeptic", 1, challenge, model="Claude (Gemini unavailable)")
        except Exception as e2:  # noqa: BLE001 — e.g. a safety-classifier decline; continue without a review
            log.warning("Claude skeptic unavailable: %s", e2)
            challenge = None
            emit({"type": "status", "message": "No skeptic available; the judge will rule on the case alone."})

    # 4. One rebuttal round if the skeptic found real problems.
    if challenge is not None and gemini.verdict(challenge) == "CHALLENGED":
        emit({"type": "status", "message": "Pharmacologist is responding to the challenge…"})
        say("proposer", 2, await claude.rebut(case, challenge))

    # 5. Judge turns the debate into a structured verdict.
    emit({"type": "status", "message": "Judge (Claude) is weighing the debate…"})
    transcript = "\n\n".join(f"[{t.agent}, round {t.round}]\n{t.text}" for t in debate)
    if challenge is None:
        transcript += "\n\n[note] No skeptic review was available for this run. Mark effects without direct " \
                      "citations as speculative and add a caveat that the case was not independently reviewed."
    verdict = await claude.judge(board.summary(), transcript)
    say("judge", len({t.round for t in debate}) + 1, verdict.verdict_note)

    return _assemble(board, drug, verdict, debate)


def _match(name: str, table: dict[str, dict], fallback: bool = False) -> dict | None:
    """Find the evidence entry for a target the judge named. Only the primary target may fall back
    to the first resolved entry; off-targets without their own evidence get none."""
    n = name.lower()
    for key, value in table.items():
        if key in n or n in key or n in str(value.get("name", "")).lower():
            return value
    return next(iter(table.values()), None) if fallback else None


def _assemble(board: EvidenceBoard, drug_name: str, verdict: claude.JudgeVerdict,
              debate: list[DebateTurn]) -> SimulationResult:
    known = board.citations
    clamp = lambda x: max(0.0, min(1.0, x))  # noqa: E731

    d = board.drugs.get(drug_name.lower()) or next(iter(board.drugs.values()), {})
    drug = Drug(name=drug_name, smiles=d.get("smiles"), cid=d.get("cid"), mw=d.get("mw"), logp=d.get("logp"))

    targets = []
    for i, jt in enumerate(verdict.targets):
        t = _match(jt.name, board.targets, fallback=i == 0) or {}
        dock = _match(jt.name, board.docking, fallback=i == 0)
        targets.append(
            Target(
                name=jt.name,
                uniprot=t.get("uniprot"),
                pdb_id=t.get("pdb_id"),
                cell_location=jt.cell_location,
                role="primary" if i == 0 else jt.role,
                binding_score=dock.get("best_confidence") if dock else None,
                pose_pdb_url=f"files/{dock['pose_file']}" if dock else None,
            )
        )

    effects = [
        Effect(
            pathway=e.pathway,
            organelle=e.organelle,
            direction=e.direction,
            magnitude=clamp(e.magnitude),
            status=e.status,
            confidence=clamp(e.confidence),
            explanation=e.explanation,
            source_ids=[s for s in e.source_ids if s in known],
        )
        for e in verdict.effects
    ]
    path = [
        PathHop(from_=h.source, relation=h.relation, to=h.target,
                source_id=h.source_id if h.source_id in known else None)
        for h in verdict.reasoning_path
    ]

    cited = {s for t in debate for s in t.source_ids} | {s for e in effects for s in e.source_ids}
    cited |= {h.source_id for h in path if h.source_id}
    citations = [Citation(**known[s]) for s in known if s in cited]

    return SimulationResult(
        drug=drug,
        targets=targets,
        effects=effects,
        debate=debate,
        reasoning_path=path,
        citations=citations,
        caveats=verdict.caveats,
        summary=verdict.summary,
        from_cache=False,
    )
