"""Build the Elastic literature index for the demo presets (and any extra drugs given on the command line).

    uv run python ingest/ingest_literature.py            # presets
    uv run python ingest/ingest_literature.py --reset    # drop and rebuild the index
    uv run python ingest/ingest_literature.py ibuprofen  # add more drugs

Per drug: PubMed papers for several mechanism / safety / resistance queries, ClinicalTrials.gov records,
and (with Bright Data configured) authoritative web pages found via SERP and fetched via Web Unlocker.
"""

import argparse
import logging
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT.parent / ".env")

from presets import PRESETS  # noqa: E402
from tools import search_index, sources  # noqa: E402

QUERIES = [
    "{drug} {target} mechanism of action",
    "{drug} {target} structure binding",
    "{drug} downstream signaling effects cells",
    "{drug} resistance mechanisms",
    "{drug} adverse effects safety",
    "{drug} off-target effects",
]
WEB_QUERY = "{drug} mechanism of action site:nih.gov OR site:fda.gov OR site:who.int"


def gather(drug: str, target: str) -> list[dict]:
    docs: dict[str, dict] = {}

    def add(batch: list[dict], label: str) -> None:
        new = [d for d in batch if f"{d['source_id']}#{d.get('chunk', 0)}" not in docs]
        for d in new:
            docs[f"{d['source_id']}#{d.get('chunk', 0)}"] = d
        print(f"    {label}: +{len(new)}")

    for q in QUERIES:
        query = q.format(drug=drug, target=target).strip()
        time.sleep(0.5)  # NCBI allows 3 requests/s without an API key, and each search makes two
        try:
            add(sources.pubmed(query, k=15), f"pubmed '{query}'")
        except Exception as e:  # noqa: BLE001
            print(f"    pubmed '{query}' failed: {e}")
    try:
        add(sources.clinical_trials(drug, k=10), "clinicaltrials.gov")
    except Exception as e:  # noqa: BLE001
        print(f"    clinicaltrials.gov failed: {e}")
    if sources.brightdata_enabled():
        try:
            for hit in sources.web_search(WEB_QUERY.format(drug=drug), k=3):
                add(sources.web_page(hit["url"], hit["title"]), f"web {hit['url'][:60]}")
        except Exception as e:  # noqa: BLE001
            print(f"    bright data failed: {e}")
    return list(docs.values())


def main() -> None:
    logging.basicConfig(level=logging.WARNING, format="    %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("drugs", nargs="*", help="extra drugs to index (presets are always included)")
    parser.add_argument("--reset", action="store_true", help="drop and recreate the index first")
    args = parser.parse_args()

    if not search_index.enabled():
        sys.exit("ELASTIC_URL is not set in mol/.env")
    search_index.ensure_index(reset=args.reset)
    print(f"Bright Data: {'on' if sources.brightdata_enabled() else 'off (set BRIGHTDATA_* to enable)'}")

    jobs = [(p.drug, p.target) for p in PRESETS] + [(d, "") for d in args.drugs]
    for drug, target in jobs:
        print(f"{drug}:")
        docs = gather(drug, target)
        print(f"  indexed {search_index.index_docs(docs, drug=drug)} chunks")
    print(f"\nIndex '{search_index.INDEX}' now holds {search_index.count()} chunks.")


if __name__ == "__main__":
    main()
