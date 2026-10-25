import pytest

from tools import graph as G

pytestmark = pytest.mark.skipif(not G.GRAPH_FILE.exists(), reason="run ingest/build_graph.py first")


def names(path: dict) -> list[str]:
    hops = path["path"]
    return [hops[0]["from"]] + [h["to"] for h in hops]


def test_resolve_aliases_and_qualifiers():
    assert G.resolve("BCR-ABL (ABL1 kinase domain)") == G.resolve("ABL1")
    assert G.resolve("aspirin") == G.resolve("Acetylsalicylic acid")
    assert G.resolve("COX-1") == G.resolve("PTGS1")
    assert G.resolve("not a real entity xyz") is None


@pytest.mark.parametrize(
    "drug,region,via,expected",
    [
        ("imatinib", "nucleus", "ABL1", ["Imatinib", "ABL1"]),
        ("aspirin", "er", "COX-1", ["Acetylsalicylic acid", "PTGS1"]),
        ("atorvastatin", "er", "HMG-CoA reductase", ["Atorvastatin", "HMGCR"]),
        ("tamoxifen", "nucleus", "estrogen receptor alpha", ["Tamoxifen", "ESR1"]),
        ("lisinopril", "membrane", "ACE", ["Lisinopril", "ACE"]),
    ],
)
def test_preset_mechanism_paths(drug, region, via, expected):
    p = G.find_path(drug, region, via)
    assert names(p)[: len(expected)] == expected
    assert names(p)[-1] == region
    assert all(h["source_id"] for h in p["path"])


def test_via_constrains_the_route():
    # Without `via` any bound gene may win; with it the chain must pass through ABL1.
    p = G.find_path("imatinib", "cytoplasm", via="ABL1")
    assert "ABL1" in names(p)


def test_no_path_is_reported_not_invented():
    assert "error" in G.find_path("imatinib", "mitochondria", via="ABL1")
    assert "error" in G.find_path("imatinib", "golgi")


def test_off_targets_exclude_primary_and_list_side_effects():
    o = G.off_targets("imatinib", primary="ABL1")
    targets = {t["target"] for t in o["other_targets"]}
    assert "ABL1" not in targets
    assert {"KIT", "PDGFRA"} & {t["target"] for t in G.off_targets("imatinib", "ABL1", limit=100)["other_targets"]}
    assert o["side_effect_count"] > 50 and o["side_effect_source_id"] == "hetionet:CcSE"


def test_citations_resolve():
    assert "BindingDB" in G.citation("hetionet:CbG")["title"]
    assert G.citation("hetionet:nope") is None
