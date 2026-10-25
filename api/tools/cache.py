"""Disk cache for slow tool calls. Doubles as the shared evidence cache for the debate:
the proposer's tool results are reused by the skeptic instead of being fetched twice."""

import functools
import hashlib
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

CACHE_ROOT = Path(__file__).parent.parent / "cache" / "tools"


def _key(args: tuple, kwargs: dict) -> str:
    raw = json.dumps([args, kwargs], sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def cached(namespace: str) -> Callable:
    """Cache a function's JSON-serializable return value on disk, keyed by its arguments."""

    def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            path = CACHE_ROOT / namespace / f"{_key(args, kwargs)}.json"
            if path.exists():
                return json.loads(path.read_text())
            result = fn(*args, **kwargs)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(result, indent=2))
            return result

        wrapper.uncached = fn  # type: ignore[attr-defined]
        return wrapper

    return decorator
