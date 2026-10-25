"""Elastic hybrid search against a real cluster. Runs only when ELASTIC_TEST_URL is set, e.g.

    docker run -d --name mol-es -p 127.0.0.1:9200:9200 -e discovery.type=single-node \\
      -e xpack.security.enabled=false docker.elastic.co/elasticsearch/elasticsearch:9.5.3
    ELASTIC_TEST_URL=http://localhost:9200 uv run pytest tests/test_search_index.py
"""

import os

import pytest

from tools import literature, search_index

pytestmark = pytest.mark.skipif(
    not (os.getenv("ELASTIC_TEST_URL") and os.getenv("GEMINI_API_KEY")),
    reason="needs ELASTIC_TEST_URL and GEMINI_API_KEY",
)

DOCS = [
    {"source_id": "pmid:1", "source": "pubmed", "title": "Imatinib binds the inactive conformation of ABL kinase",
     "text": "Crystal structures show STI-571 occupies the ATP site of Abl when the activation loop is unphosphorylated.",
     "url": "https://pubmed.ncbi.nlm.nih.gov/1/", "year": "2000", "pmid": "1"},
    {"source_id": "pmid:2", "source": "pubmed", "title": "Aspirin irreversibly acetylates cyclooxygenase-1",
     "text": "Acetylation of Ser530 blocks arachidonic acid access to the COX-1 active site, reducing thromboxane.",
     "url": "https://pubmed.ncbi.nlm.nih.gov/2/", "year": "1995", "pmid": "2"},
    {"source_id": "nct:NCT0001", "source": "clinicaltrials", "title": "Imatinib in chronic myeloid leukemia",
     "text": "Status: COMPLETED. Phase: PHASE3. Conditions: CML. Imatinib versus interferon in newly diagnosed CML.",
     "url": "https://clinicaltrials.gov/study/NCT0001", "year": "2000", "pmid": None},
    {"source_id": "web:https://example.org/x", "source": "web", "title": "Atorvastatin label",
     "text": "Atorvastatin competitively inhibits HMG-CoA reductase, lowering hepatic cholesterol synthesis.",
     "url": "https://example.org/x", "year": None, "pmid": None, "chunk": 0},
]


@pytest.fixture(scope="module", autouse=True)
def test_index():
    os.environ["ELASTIC_URL"] = os.environ["ELASTIC_TEST_URL"]
    search_index.es.cache_clear()
    search_index.INDEX = "mol-test"
    search_index.ensure_index(reset=True)
    assert search_index.index_docs(DOCS, drug="test") == len(DOCS)
    yield
    search_index.es().indices.delete(index="mol-test")
    del os.environ["ELASTIC_URL"]


def test_keyword_query_finds_exact_terms():
    hits = search_index.hybrid_search("STI-571 Abl ATP site", k=2)
    assert hits[0]["source_id"] == "pmid:1"


def test_semantic_query_finds_paraphrase():
    # No shared keywords with the aspirin abstract: relies on the Gemini embedding.
    hits = search_index.hybrid_search("how does a common painkiller stop platelet clotting enzymes", k=2)
    assert "pmid:2" in [h["source_id"] for h in hits]


def test_literature_tool_uses_index_and_returns_all_source_types():
    ids = {d["source_id"] for d in literature.search_literature("imatinib leukemia trial", k=4)}
    assert "nct:NCT0001" in ids
