"""Gather evidence for every demo preset ahead of the demo so the live path never waits.

Writes cache/evidence/<preset>.json (drug, target, structure, docking) and fills the tool cache.
Steps that fail (e.g. docking without NVIDIA_API_KEY) are recorded and skipped, not fatal.

    uv run python scripts/precompute_presets.py
"""

import json
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT.parent / ".env")

from presets import PRESETS  # noqa: E402
from tools.docking import run_docking  # noqa: E402
from tools.drug import get_drug  # noqa: E402
from tools.target import fetch_structure, get_target  # noqa: E402

OUT = ROOT / "cache" / "evidence"


def step(record: dict, key: str, fn):
    try:
        record[key] = fn()
        print(f"  ✓ {key}")
    except Exception as e:  # noqa: BLE001 — record any failure and keep going
        record.setdefault("errors", {})[key] = str(e)
        print(f"  ✗ {key}: {e}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for p in PRESETS:
        print(f"{p.id}")
        record: dict = {"preset": p.model_dump()}
        step(record, "target", lambda: get_target(p.target))
        if "target" in record:
            step(record, "structure", lambda: str(fetch_structure(record["target"]).relative_to(ROOT / "data")))
        step(record, "drug", lambda: get_drug(p.drug))
        if "drug" in record:
            step(record, "docking", lambda: run_docking(record["drug"]["smiles"], p.target))
        (OUT / f"{p.id}.json").write_text(json.dumps(record, indent=2))

    failed = [f.stem for f in OUT.glob("*.json") if "errors" in json.loads(f.read_text())]
    print(f"\nDone. {len(PRESETS) - len(failed)}/{len(PRESETS)} presets complete.", end=" ")
    print(f"Incomplete: {', '.join(failed)}" if failed else "")


if __name__ == "__main__":
    main()
