"""Follow-up chat: the thread and result reach the model, and a re-simulation is only ever proposed."""

import asyncio
import json
from types import SimpleNamespace

from agents import claude
from schemas import ChatRequest, SimulationResult

RESULT = SimulationResult.model_validate(
    {"drug": {"name": "imatinib"}, "targets": [], "effects": [], "summary": "Blocks BCR-ABL."}
)


def fake_client(chunks, final_content, seen):
    class Stream:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        @property
        def text_stream(self):
            async def gen():
                for c in chunks:
                    yield c

            return gen()

        async def get_final_message(self):
            return SimpleNamespace(content=final_content, stop_reason="end_turn", stop_details=None)

    def stream(**kwargs):
        seen.update(kwargs)
        return Stream()

    return SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(stream=stream)))


def collect(agen):
    async def run():
        return [c async for c in agen]

    return asyncio.run(run())


def test_followup_streams_and_forwards_history_and_result(monkeypatch):
    seen: dict = {}
    text = SimpleNamespace(type="text", text="Nausea.")
    monkeypatch.setattr(claude, "client", lambda: fake_client(["Nau", "sea."], [text], seen))
    messages = [
        {"role": "user", "content": "What does it do?"},
        {"role": "assistant", "content": "It blocks BCR-ABL."},
        {"role": "user", "content": "Side effects?"},
    ]
    events = collect(claude.followup(RESULT.model_dump_json(), messages))
    assert events == [{"type": "delta", "text": "Nau"}, {"type": "delta", "text": "sea."}, {"type": "done"}]
    assert seen["messages"] == messages
    assert "Blocks BCR-ABL." in seen["system"]


def test_followup_proposes_instead_of_running(monkeypatch):
    block = SimpleNamespace(
        type="tool_use", name="propose_resimulation", input={"prompt": "imatinib on KIT", "reason": "new target"}
    )
    monkeypatch.setattr(claude, "client", lambda: fake_client([], [block], {}))
    events = collect(claude.followup("{}", [{"role": "user", "content": "redo it for KIT"}]))
    assert events == [{"type": "resimulate_proposal", "prompt": "imatinib on KIT", "reason": "new target"}]


def test_chat_events_forwards_chunks(monkeypatch):
    import main

    async def followup(result_json, messages):
        yield {"type": "delta", "text": "ok"}
        yield {"type": "done"}

    monkeypatch.setattr(main.claude, "followup", followup)
    req = ChatRequest(result=RESULT, messages=[{"role": "user", "content": "hi"}])
    events = [json.loads(e["data"]) for e in collect(main.chat_events(req))]
    assert events == [{"type": "delta", "text": "ok"}, {"type": "done"}]
