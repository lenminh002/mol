"""Debate flow with the model calls stubbed: event order, rebuttal trigger, citation filtering, fallback."""

import asyncio
import json

import pytest

from agents import claude, gemini, orchestrator
from agents.claude import JudgeEffect, JudgeHop, JudgeTarget, JudgeVerdict
from schemas import SimulateRequest, SimulationResult


def verdict(**overrides) -> JudgeVerdict:
    base = dict(
        targets=[JudgeTarget(name="BCR-ABL", cell_location="cytoplasm"),
                 JudgeTarget(name="KIT", cell_location="membrane")],
        effects=[
            JudgeEffect(pathway="BCR-ABL kinase signalling", organelle="cytoplasm", direction="block",
                        magnitude=1.4, status="agreed", confidence=0.9, explanation="x",
                        source_ids=["pmid:1", "pmid:999"]),  # pmid:999 was never fetched
        ],
        reasoning_path=[JudgeHop(source="imatinib", relation="binds", target="BCR-ABL", source_id="pdb:1IEP")],
        caveats=["test"],
        summary="test summary",
        verdict_note="test note",
    )
    return JudgeVerdict(**{**base, **overrides})


@pytest.fixture
def stub_models(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    calls = {"rebut": 0}

    async def propose(board, drug, target, context, emit):
        await board.literature("proposer", "imatinib")  # stubbed below
        board.targets["bcr-abl"] = {"name": "BCR-ABL", "uniprot": "P00519", "pdb_id": "1IEP"}
        board.cite("pdb:1IEP", "PDB 1IEP", "https://www.rcsb.org/structure/1IEP")
        return "Imatinib blocks BCR-ABL [pmid:1] [pdb:1IEP]."

    async def challenge(board, drug, target, case):
        return "1. Resistance mutations exist [pmid:1].\nVerdict: CHALLENGED"

    async def rebut(case, challenge_text):
        calls["rebut"] += 1
        return "Conceded on resistance [pmid:1]."

    async def judge(evidence, transcript):
        return verdict()

    monkeypatch.setattr(claude, "propose", propose)
    monkeypatch.setattr(gemini, "challenge", challenge)
    monkeypatch.setattr(claude, "rebut", rebut)
    monkeypatch.setattr(claude, "judge", judge)
    monkeypatch.setattr(
        "agents.evidence.search_literature",
        lambda query: [{"source_id": "pmid:1", "source": "pubmed", "pmid": "1", "title": "Paper one",
                        "url": "https://pubmed.ncbi.nlm.nih.gov/1/", "year": "2020", "text": "..."}],
    )
    return calls


async def collect(req: SimulateRequest) -> list[dict]:
    return [e async for e in orchestrator.run_simulation(req)]


def test_full_debate_flow(stub_models, tmp_path, monkeypatch):
    monkeypatch.setattr(orchestrator, "CACHE_DIR", tmp_path)
    events = asyncio.run(collect(SimulateRequest(drug="imatinib", target="BCR-ABL")))

    parsed = next(e for e in events if e["type"] == "parsed")
    assert (parsed["drug"], parsed["target"]) == ("imatinib", "BCR-ABL")
    turns = [e["turn"] for e in events if e["type"] == "turn"]
    assert [(t["agent"], t["round"]) for t in turns] == [("proposer", 1), ("skeptic", 1), ("proposer", 2), ("judge", 3)]
    assert [t["model"] for t in turns] == ["Claude", "Gemini", "Claude", "Claude"]
    assert stub_models["rebut"] == 1
    assert any(e["type"] == "tool_call" and e["tool"] == "search_literature" for e in events)

    result = SimulationResult.model_validate(events[-1]["result"])
    assert events[-1]["type"] == "result"
    effect = result.effects[0]
    assert effect.magnitude == 1.0  # clamped
    assert effect.source_ids == ["pmid:1"]  # invented pmid:999 dropped
    assert result.targets[0].pdb_id == "1IEP"
    assert result.targets[1].pdb_id is None and result.targets[1].uniprot is None  # no borrowed evidence
    assert result.reasoning_path[0].source_id == "pdb:1IEP"
    assert {c.id for c in result.citations} == {"pmid:1", "pdb:1IEP"}
    assert events[-1]["result"]["reasoning_path"][0]["from"] == "imatinib"  # serialized by alias


def test_sound_verdict_skips_rebuttal(stub_models, monkeypatch, tmp_path):
    monkeypatch.setattr(orchestrator, "CACHE_DIR", tmp_path)

    async def sound(board, drug, target, case):
        return "Looks right.\nVerdict: SOUND"

    monkeypatch.setattr(gemini, "challenge", sound)
    events = asyncio.run(collect(SimulateRequest(drug="imatinib")))
    assert [e["turn"]["agent"] for e in events if e["type"] == "turn"] == ["proposer", "skeptic", "judge"]
    assert stub_models["rebut"] == 0


def test_preset_success_is_cached_then_failure_falls_back(stub_models, monkeypatch, tmp_path):
    monkeypatch.setattr(orchestrator, "CACHE_DIR", tmp_path)
    asyncio.run(collect(SimulateRequest(preset="imatinib-bcrabl")))
    assert (tmp_path / "imatinib-bcrabl.json").exists()

    async def broken(*a, **k):
        raise RuntimeError("API down")

    monkeypatch.setattr(claude, "propose", broken)
    events = asyncio.run(collect(SimulateRequest(preset="imatinib-bcrabl")))
    assert any(e["type"] == "status" and "cached" in e["message"] for e in events)
    assert events[-1]["type"] == "result" and events[-1]["result"]["from_cache"] is True


def test_failure_without_cache_reports_error(stub_models, monkeypatch, tmp_path):
    monkeypatch.setattr(orchestrator, "CACHE_DIR", tmp_path)

    async def broken(*a, **k):
        raise RuntimeError("API down")

    monkeypatch.setattr(claude, "propose", broken)
    events = asyncio.run(collect(SimulateRequest(drug="aspirin")))
    assert events[-1] == {"type": "error", "message": "Simulation failed: API down"}


def test_source_id_extraction_and_skeptic_verdict():
    text = "Blocks it [pmid:123] and [pdb:1IEP; pmid:456, uniprot:P00519]; again [pmid:123]. Not an id: [figure 2]."
    assert claude.source_ids(text) == ["pmid:123", "pdb:1IEP", "pmid:456", "uniprot:P00519"]
    assert gemini.verdict("...\nVerdict: SOUND") == "SOUND"
    assert gemini.verdict("...\nVerdict: CHALLENGED") == "CHALLENGED"
    assert gemini.verdict("no verdict line") == "CHALLENGED"


def test_judge_schema_is_json_serializable():
    schema = JudgeVerdict.model_json_schema()
    assert json.dumps(schema)
    assert set(schema["required"]) >= {"targets", "effects", "reasoning_path", "caveats", "summary"}


def test_missing_keys_named_in_error(monkeypatch, tmp_path):
    monkeypatch.setattr(orchestrator, "CACHE_DIR", tmp_path)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    events = asyncio.run(collect(SimulateRequest(drug="aspirin")))
    assert events[-1]["message"] == "Simulation failed: ANTHROPIC_API_KEY not set in mol/.env"


def test_gemini_failure_falls_back_to_claude_skeptic(stub_models, monkeypatch, tmp_path):
    monkeypatch.setattr(orchestrator, "CACHE_DIR", tmp_path)

    async def overloaded(*a, **k):
        raise RuntimeError("503 UNAVAILABLE. This model is currently experiencing high demand")

    async def claude_skeptic(board, drug, target, case, emit):
        return "Claude as skeptic.\nVerdict: SOUND"

    monkeypatch.setattr(gemini, "challenge", overloaded)
    monkeypatch.setattr(claude, "challenge", claude_skeptic)
    events = asyncio.run(collect(SimulateRequest(drug="imatinib")))
    skeptic = next(e["turn"] for e in events if e["type"] == "turn" and e["turn"]["agent"] == "skeptic")
    assert skeptic["model"] == "Claude (Gemini unavailable)"
    assert any(e["type"] == "status" and "Claude takes the skeptic role" in e["message"] for e in events)
    assert events[-1]["type"] == "result"


def test_gemini_timeout_falls_back(stub_models, monkeypatch, tmp_path):
    monkeypatch.setattr(orchestrator, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(orchestrator, "SKEPTIC_TIMEOUT_S", 0.05)

    async def slow(*a, **k):
        await asyncio.sleep(5)

    async def claude_skeptic(board, drug, target, case, emit):
        return "Claude as skeptic.\nVerdict: SOUND"

    monkeypatch.setattr(gemini, "challenge", slow)
    monkeypatch.setattr(claude, "challenge", claude_skeptic)
    events = asyncio.run(collect(SimulateRequest(drug="imatinib")))
    assert any(e["type"] == "status" and "timed out" in e["message"] for e in events)
    assert events[-1]["type"] == "result"


def test_no_skeptic_available_still_produces_verdict(stub_models, monkeypatch, tmp_path):
    monkeypatch.setattr(orchestrator, "CACHE_DIR", tmp_path)
    seen = {}

    async def down(*a, **k):
        raise RuntimeError("503")

    async def judge(evidence, transcript):
        seen["transcript"] = transcript
        return verdict()

    monkeypatch.setattr(gemini, "challenge", down)
    monkeypatch.setattr(claude, "challenge", down)
    monkeypatch.setattr(claude, "judge", judge)
    events = asyncio.run(collect(SimulateRequest(drug="imatinib")))
    assert [e["turn"]["agent"] for e in events if e["type"] == "turn"] == ["proposer", "judge"]
    assert "No skeptic review was available" in seen["transcript"]
    assert stub_models["rebut"] == 0
    assert events[-1]["type"] == "result"
