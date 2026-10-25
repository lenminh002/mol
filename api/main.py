from pathlib import Path

from dotenv import load_dotenv

# Load keys/model overrides before the agent modules read them at import time.
load_dotenv(Path(__file__).parent.parent / ".env")

# ruff: noqa: E402
import asyncio
import json
import mimetypes
import os
from collections.abc import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse

import db
from agents.orchestrator import cached_result, run_simulation
from presets import PRESETS
from tools.binding_site import binding_site
from tools import tts
from tools.drug import autocomplete
from schemas import Preset, SimulateRequest

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
db.init()

app = FastAPI(title="Mol API")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    # Deployed frontends, comma-separated, e.g. "https://mol.vercel.app,https://mol.bio".
    allow_origins=[o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)
# .pdb defaults to the Palm database MIME type; serve structures as text.
for ext in (".pdb", ".sdf"):
    mimetypes.add_type("text/plain", ext)
# Structures and docked poses for the molecule viewer, e.g. /files/poses/<id>.sdf
app.mount("/files", StaticFiles(directory=DATA_DIR), name="files")


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/presets")
def presets() -> list[Preset]:
    return PRESETS


@app.get("/autocomplete")
async def drug_autocomplete(q: str) -> list[str]:
    """Drug-name suggestions: matching presets first, then PubChem."""
    q = q.strip()
    if len(q) < 2:
        return []
    presets_first = [p.drug for p in PRESETS if p.drug.lower().startswith(q.lower())]
    try:
        pubchem = await asyncio.to_thread(autocomplete, q)
    except Exception:  # noqa: BLE001 — suggestions are a nicety; never fail the input box
        pubchem = []
    return list(dict.fromkeys(presets_first + pubchem))[:8]


class NarrationRequest(BaseModel):
    text: str


@app.post("/tts")
async def narrate(req: NarrationRequest) -> FileResponse:
    """Spoken version of a verdict summary (Cartesia), as MP3."""
    if not tts.enabled():
        raise HTTPException(503, "Narration is off: CARTESIA_API_KEY is not set")
    try:
        path = await asyncio.to_thread(tts.synthesize, req.text)
    except tts.TTSError as e:
        raise HTTPException(502, str(e)) from e
    return FileResponse(path, media_type="audio/mpeg")


@app.get("/structure/{pdb_id}")
async def structure(pdb_id: str) -> dict:
    """Viewer focus (drug or interface) and binding-site residues; the file itself is under /files/structures/."""
    site = await asyncio.to_thread(binding_site, pdb_id)
    return {**site, "structure_url": f"files/structures/{site['pdb_id']}.pdb"}


def event(payload: dict) -> dict:
    return {"data": json.dumps(payload)}


async def _replay_or_run(req: SimulateRequest) -> AsyncIterator[dict]:
    # Presets that already ran live replay instantly (pass fresh=true to re-run the debate).
    if not req.fresh and (cached := cached_result(req.preset)):
        cached.from_cache = True
        yield {"type": "status", "message": "Replaying a saved debate…"}
        target = cached.targets[0].name if cached.targets else None
        yield {"type": "parsed", "drug": cached.drug.name, "target": target, "context": None}
        for turn in cached.debate:
            await asyncio.sleep(0.4)  # pace the replay so the debate reads as a conversation
            yield {"type": "turn", "turn": turn.model_dump()}
        yield {"type": "result", "result": cached.model_dump(by_alias=True)}
        return
    async for e in run_simulation(req):
        yield e


async def simulate_events(req: SimulateRequest) -> AsyncIterator[dict]:
    parsed: dict | None = None
    tool_calls: list[dict] = []
    async for e in _replay_or_run(req):
        yield event(e)
        if e["type"] == "parsed":
            parsed = {"drug": e["drug"], "target": e["target"]}
        elif e["type"] == "tool_call":
            tool_calls.append({"agent": e["agent"], "tool": e["tool"], "args": e["args"]})
        elif e["type"] == "result":
            run_id = await asyncio.to_thread(db.save_run, req.model_dump(), e["result"], tool_calls, parsed)
            yield event({"type": "saved", "id": run_id})


@app.get("/history")
def history() -> list[dict]:
    return db.list_runs()


@app.get("/history/{run_id}")
def history_item(run_id: str) -> dict:
    if (run := db.get_run(run_id)) is None:
        raise HTTPException(404, "No such run")
    return run


@app.delete("/history/{run_id}")
def history_delete(run_id: str) -> dict:
    db.delete_run(run_id)
    return {"ok": True}


@app.delete("/history")
def history_clear() -> dict:
    db.clear_runs()
    return {"ok": True}


@app.post("/simulate")
async def simulate(req: SimulateRequest) -> EventSourceResponse:
    return EventSourceResponse(simulate_events(req))
