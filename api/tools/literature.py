"""Literature search used by the agents.

Primary: the Elastic hybrid index built by `ingest/ingest_literature.py` (PubMed, ClinicalTrials.gov and,
with Bright Data configured, web pages). Fallback: live PubMed search, used when ELASTIC_URL is unset,
Elastic is unreachable, or the index has nothing relevant.
"""

import logging

from tools import search_index, sources
from tools.cache import cached

log = logging.getLogger("mol.literature")


@cached("literature-pubmed")
def _pubmed(query: str, k: int) -> list[dict]:
    return sources.pubmed(query, k)


def search_literature(query: str, k: int = 5) -> list[dict]:
    """Search biomedical literature; returns up to k documents with source_id, title, year, text and url."""
    if search_index.enabled():
        try:
            hits = search_index.hybrid_search(query, k)
            if hits:
                return hits
        except Exception as e:  # noqa: BLE001 — degrade to live PubMed rather than fail the debate
            log.warning("Elastic search failed, falling back to PubMed: %s", e)
    return _pubmed(query, k)
