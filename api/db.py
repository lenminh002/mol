"""SQLite store of finished simulations, so History can reload a run instead of re-running it."""

import json
import os
import sqlite3
import time
import uuid
from contextlib import closing
from pathlib import Path

# Kept out of data/, which main.py serves publicly under /files.
DB_PATH = Path(os.getenv("MOL_DB_PATH", Path(__file__).parent / "storage" / "runs.db"))
MAX_RUNS = 50


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    with closing(_connect()) as conn, conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                req_json TEXT NOT NULL,
                result_json TEXT NOT NULL,
                tool_calls_json TEXT NOT NULL,
                parsed_json TEXT,
                ts INTEGER NOT NULL
            )"""
        )


def label_for(req: dict) -> str:
    if (req.get("prompt") or "").strip():
        return req["prompt"].strip()
    if req.get("drug"):
        return f"{req['drug']} → {req['target']}" if req.get("target") else req["drug"]
    return req.get("preset") or "simulation"


def save_run(req: dict, result: dict, tool_calls: list[dict], parsed: dict | None) -> str:
    """Store a finished run; an older run with the same label is replaced. Returns the new id."""
    run_id = uuid.uuid4().hex
    label = label_for(req)
    with closing(_connect()) as conn, conn:
        conn.execute("DELETE FROM runs WHERE label = ?", (label,))
        conn.execute(
            "INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                run_id,
                label,
                json.dumps(req),
                json.dumps(result),
                json.dumps(tool_calls),
                json.dumps(parsed) if parsed else None,
                int(time.time() * 1000),
            ),
        )
        conn.execute(
            "DELETE FROM runs WHERE id NOT IN (SELECT id FROM runs ORDER BY ts DESC LIMIT ?)",
            (MAX_RUNS,),
        )
    return run_id


def list_runs() -> list[dict]:
    with closing(_connect()) as conn:
        rows = conn.execute("SELECT id, label, req_json, ts FROM runs ORDER BY ts DESC").fetchall()
    return [{"id": r["id"], "label": r["label"], "req": json.loads(r["req_json"]), "ts": r["ts"]} for r in rows]


def get_run(run_id: str) -> dict | None:
    with closing(_connect()) as conn:
        r = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    if r is None:
        return None
    return {
        "id": r["id"],
        "label": r["label"],
        "req": json.loads(r["req_json"]),
        "result": json.loads(r["result_json"]),
        "tool_calls": json.loads(r["tool_calls_json"]),
        "parsed": json.loads(r["parsed_json"]) if r["parsed_json"] else None,
        "ts": r["ts"],
    }


def delete_run(run_id: str) -> None:
    with closing(_connect()) as conn, conn:
        conn.execute("DELETE FROM runs WHERE id = ?", (run_id,))


def clear_runs() -> None:
    with closing(_connect()) as conn, conn:
        conn.execute("DELETE FROM runs")
