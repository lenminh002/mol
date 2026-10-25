"""Voice narration with Cartesia text-to-speech. Audio is cached on disk by (voice, text), so replaying
a saved debate never re-synthesizes."""

import hashlib
import os
from pathlib import Path

import httpx

CARTESIA_URL = "https://api.cartesia.ai/tts/bytes"
CARTESIA_VERSION = "2026-08-14"
MODEL = os.getenv("CARTESIA_MODEL", "sonic-3.6")
# "Clive": composed and articulate, suited to educational narration.
VOICE_ID = os.getenv("CARTESIA_VOICE_ID", "b24f41fd-00a3-4cd8-992a-a0c9f13f3ef1")
AUDIO_DIR = Path(__file__).parent.parent / "data" / "audio"
MAX_CHARS = 1200


class TTSError(Exception):
    pass


def enabled() -> bool:
    return bool(os.getenv("CARTESIA_API_KEY"))


def synthesize(text: str) -> Path:
    """MP3 of `text` spoken by the narrator voice; returns the cached file path."""
    if not enabled():
        raise TTSError("CARTESIA_API_KEY is not set")
    text = " ".join(text.split())[:MAX_CHARS]
    if not text:
        raise TTSError("Nothing to narrate")

    key = hashlib.sha256(f"{MODEL}|{VOICE_ID}|{text}".encode()).hexdigest()[:20]
    path = AUDIO_DIR / f"{key}.mp3"
    if path.exists():
        return path

    resp = httpx.post(
        CARTESIA_URL,
        headers={"Authorization": f"Bearer {os.environ['CARTESIA_API_KEY']}", "Cartesia-Version": CARTESIA_VERSION},
        json={
            "model_id": MODEL,
            "transcript": text,
            "voice": {"id": VOICE_ID},
            "output_format": {"container": "mp3", "sample_rate": 44100, "bit_rate": 128000},
            "language": "en",
        },
        timeout=60,
    )
    if resp.status_code != 200:
        raise TTSError(f"Cartesia returned {resp.status_code}: {resp.text[:200]}")
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    path.write_bytes(resp.content)
    return path
