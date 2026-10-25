"""Follow-up chat: the thread and result reach the model, and a re-simulation is only ever proposed."""

import asyncio
import json
from types import SimpleNamespace

from agents import claude
from schemas import ChatRequest, SimulationResult

RESULT = SimulationResult.model_validate(
    {"drug": {"name": "imatinib"}, "targets": [], "effects": [], "summary": "Blocks BCR-ABL."}
)


def fake_client(content, seen):
    async def create(**kwargs):
        seen.update(kwargs)
        return SimpleNamespace(content=content, stop_reason="end_turn", stop_details=None)

    return SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create)))


def test_followup_forwards_history_and_result(monkeypatch):
    seen: dict = {}
    monkeypatch.setattr(claude, "client", lambda: fake_client([SimpleNamespace(type="text", text="Nausea.")], seen))
    messages = [
        {"role": "user", "content": "What does it do?"},
        {"role": "assistant", "content": "It blocks BCR-ABL."},
        {"role": "user", "content": "Side effects?"},
    ]
    reply = asyncio.run(claude.followup(RESULT.model_dump_json(), messages))
    assert reply == {"type": "answer", "text": "Nausea."}
    assert seen["messages"] == messages
    assert "Blocks BCR-ABL." in seen["system"]


def test_followup_proposes_instead_of_running(monkeypatch):
    block = SimpleNamespace(
        type="tool_use", name="propose_resimulation", input={"prompt": "imatinib on KIT", "reason": "new target"}
    )
    monkeypatch.setattr(claude, "client", lambda: fake_client([block], {}))
    reply = asyncio.run(claude.followup("{}", [{"role": "user", "content": "redo it for KIT"}]))
    assert reply == {"type": "resimulate_proposal", "prompt": "imatinib on KIT", "reason": "new target"}


def test_chat_events_streams_reply(monkeypatch):
    import main

    async def followup(result_json, messages):
        return {"type": "answer", "text": "ok"}

    monkeypatch.setattr(main.claude, "followup", followup)
    req = ChatRequest(result=RESULT, messages=[{"role": "user", "content": "hi"}])
    async def collect():
        return [json.loads(e["data"]) async for e in main.chat_events(req)]

    events = asyncio.run(collect())
    assert events == [{"type": "answer", "text": "ok"}]
