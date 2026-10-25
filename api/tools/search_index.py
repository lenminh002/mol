"""Elastic literature index: Gemini embeddings in a dense_vector field + BM25, fused with
reciprocal rank fusion in the client (works on any Elastic license, Serverless included)."""

import logging
import os
import re
import time
from functools import lru_cache

from elasticsearch import Elasticsearch, helpers
from google import genai
from google.genai import errors, types

log = logging.getLogger("mol.index")

INDEX = os.getenv("ELASTIC_INDEX", "mol-literature")
EMBED_MODEL = "gemini-embedding-001"
DIMS = 768
RRF_K = 60

MAPPING = {
    "properties": {
        "source_id": {"type": "keyword"},
        "source": {"type": "keyword"},
        "title": {"type": "text"},
        "text": {"type": "text"},
        "url": {"type": "keyword", "index": False},
        "year": {"type": "keyword"},
        "pmid": {"type": "keyword"},
        "drug": {"type": "keyword"},
        "embedding": {"type": "dense_vector", "dims": DIMS, "similarity": "cosine"},
    }
}


def enabled() -> bool:
    return bool(os.getenv("ELASTIC_URL"))


@lru_cache(maxsize=1)
def es() -> Elasticsearch:
    api_key = os.getenv("ELASTIC_API_KEY")
    return Elasticsearch(os.environ["ELASTIC_URL"], api_key=api_key or None, request_timeout=30)


@lru_cache(maxsize=1)
def _gemini() -> genai.Client:
    return genai.Client(api_key=os.getenv("GEMINI_API_KEY"))


BATCH = 25


def _embed_batch(texts: list[str], task: str, attempts: int = 6) -> list[list[float]]:
    for attempt in range(attempts):
        try:
            resp = _gemini().models.embed_content(
                model=EMBED_MODEL,
                contents=texts,
                config=types.EmbedContentConfig(task_type=task, output_dimensionality=DIMS),
            )
            return [e.values for e in resp.embeddings]
        except errors.ClientError as e:
            # Free tier allows ~100 embedded texts per minute; wait as long as the API asks.
            if e.code != 429 or attempt == attempts - 1:
                raise
            match = re.search(r"retry in ([\d.]+)s", str(e))
            wait = min(float(match.group(1)) + 1 if match else 30, 65)
            log.warning("Gemini embedding rate limit; waiting %.0fs", wait)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def embed(texts: list[str], task: str) -> list[list[float]]:
    """Gemini embeddings; task is RETRIEVAL_DOCUMENT for indexing, RETRIEVAL_QUERY for searching."""
    out: list[list[float]] = []
    for i in range(0, len(texts), BATCH):
        out += _embed_batch(texts[i : i + BATCH], task)
    return out


def ensure_index(reset: bool = False) -> None:
    if reset and es().indices.exists(index=INDEX):
        es().indices.delete(index=INDEX)
    if not es().indices.exists(index=INDEX):
        es().indices.create(index=INDEX, mappings=MAPPING)


def index_docs(docs: list[dict], drug: str | None = None) -> int:
    """Embed and bulk-index documents (deduplicated by source_id + chunk)."""
    if not docs:
        return 0
    vectors = embed([f"{d['title']}\n{d['text']}" for d in docs], "RETRIEVAL_DOCUMENT")
    actions = [
        {
            "_index": INDEX,
            "_id": f"{d['source_id']}#{d.get('chunk', 0)}",
            "_source": {**{k: d.get(k) for k in MAPPING["properties"] if k != "embedding"},
                        "drug": drug, "embedding": v},
        }
        for d, v in zip(docs, vectors)
    ]
    ok, _ = helpers.bulk(es(), actions, refresh="wait_for")
    return ok


def hybrid_search(query: str, k: int = 5) -> list[dict]:
    """BM25 and vector kNN, fused with reciprocal rank fusion; one hit per source document."""
    fields = ["source_id", "source", "title", "text", "url", "year", "pmid"]
    bm25 = es().search(index=INDEX, size=20, source=fields,
                       query={"multi_match": {"query": query, "fields": ["title^2", "text"]}})
    rankings = [bm25["hits"]["hits"]]
    try:
        vector = embed([query], "RETRIEVAL_QUERY")[0]
        knn = es().search(index=INDEX, size=20, source=fields,
                          knn={"field": "embedding", "query_vector": vector, "k": 20, "num_candidates": 100})
        rankings.append(knn["hits"]["hits"])
    except errors.APIError as e:  # Gemini quota/outage: keep the keyword half rather than lose the index
        log.warning("Query embedding failed, using keyword search only: %s", str(e)[:120])

    scores: dict[str, float] = {}
    docs: dict[str, dict] = {}
    for hits in rankings:
        for rank, hit in enumerate(hits):
            src = hit["_source"]
            sid = src["source_id"]
            scores[sid] = scores.get(sid, 0) + 1 / (RRF_K + rank + 1)
            docs.setdefault(sid, src)  # first (best-ranked) chunk of each document wins
    ranked = sorted(scores, key=scores.get, reverse=True)[:k]
    return [docs[s] for s in ranked]


def count() -> int:
    return es().count(index=INDEX)["count"] if es().indices.exists(index=INDEX) else 0
