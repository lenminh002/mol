"""Hybrid-ranking and fallback logic with a fake Elasticsearch client (no network)."""

import pytest

from tools import literature, search_index


def hit(sid: str) -> dict:
    return {"_source": {"source_id": sid, "source": "pubmed", "title": sid, "text": "", "url": "u", "year": None,
                        "pmid": None}}


class FakeES:
    def __init__(self, bm25: list[str], knn: list[str], fail: bool = False):
        self.bm25, self.knn, self.fail = bm25, knn, fail

    def search(self, **kw):
        if self.fail:
            raise ConnectionError("cluster down")
        ids = self.knn if "knn" in kw else self.bm25
        return {"hits": {"hits": [hit(i) for i in ids]}}


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setenv("ELASTIC_URL", "http://fake")
    monkeypatch.setattr(search_index, "embed", lambda texts, task: [[0.0] * search_index.DIMS for _ in texts])
    monkeypatch.setattr(literature, "_pubmed", lambda q, k: [{"source_id": "pmid:live"}])

    def use(es: FakeES):
        monkeypatch.setattr(search_index, "es", lambda: es)

    return use


def test_rrf_rewards_documents_found_by_both_retrievers(fake):
    fake(FakeES(bm25=["a", "b", "c"], knn=["c", "d", "a"]))
    ranked = [d["source_id"] for d in search_index.hybrid_search("q", k=4)]
    assert ranked[:2] == ["a", "c"]  # in both lists
    assert set(ranked) == {"a", "b", "c", "d"}


def test_chunks_of_one_document_collapse_to_one_hit(fake):
    fake(FakeES(bm25=["web:x", "web:x", "b"], knn=["web:x"]))
    ranked = [d["source_id"] for d in search_index.hybrid_search("q", k=5)]
    assert ranked.count("web:x") == 1


def test_elastic_down_falls_back_to_pubmed(fake):
    fake(FakeES([], [], fail=True))
    assert literature.search_literature("q") == [{"source_id": "pmid:live"}]


def test_empty_index_falls_back_to_pubmed(fake):
    fake(FakeES([], []))
    assert literature.search_literature("q") == [{"source_id": "pmid:live"}]


def test_no_elastic_url_uses_pubmed(monkeypatch):
    monkeypatch.delenv("ELASTIC_URL", raising=False)
    monkeypatch.setattr(literature, "_pubmed", lambda q, k: [{"source_id": "pmid:live"}])
    assert literature.search_literature("q") == [{"source_id": "pmid:live"}]


def test_embedding_outage_keeps_keyword_results(fake, monkeypatch):
    from google.genai import errors

    def broken(texts, task):
        raise errors.ClientError(402, {"error": {"message": "prepayment exhausted"}})

    monkeypatch.setattr(search_index, "embed", broken)
    fake(FakeES(bm25=["a", "b"], knn=["z"]))
    assert [d["source_id"] for d in literature.search_literature("q", k=5)] == ["a", "b"]
