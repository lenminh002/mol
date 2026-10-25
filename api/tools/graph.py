"""Biomedical knowledge graph: Hetionet v1.0 (29 curated databases), with room for curated edges
for drugs newer than Hetionet (2017).

The graph links drug -> protein target -> pathway / cellular component -> one of our five cell regions,
which is exactly the chain the cell view animates. Built by `ingest/build_graph.py`.
"""

import gzip
import json
from collections import deque
from functools import lru_cache
from pathlib import Path

import networkx as nx

GRAPH_FILE = Path(__file__).parent.parent / "data" / "graph.json.gz"

REGIONS = ["membrane", "cytoplasm", "nucleus", "mitochondria", "er"]

# Hetionet metaedge -> (readable relation, citation title). Ids are cited as hetionet:<metaedge>.
METAEDGES = {
    "CbG": ("binds", "Hetionet v1.0: Compound–binds–Gene (BindingDB, DrugBank, DrugCentral)"),
    "CuG": ("upregulates", "Hetionet v1.0: Compound–upregulates–Gene (LINCS L1000 signatures)"),
    "CdG": ("downregulates", "Hetionet v1.0: Compound–downregulates–Gene (LINCS L1000 signatures)"),
    "CtD": ("treats", "Hetionet v1.0: Compound–treats–Disease (PharmacotherapyDB)"),
    "CpD": ("palliates", "Hetionet v1.0: Compound–palliates–Disease (PharmacotherapyDB)"),
    "CcSE": ("causes side effect", "Hetionet v1.0: Compound–causes–Side Effect (SIDER)"),
    "GpPW": ("participates in", "Hetionet v1.0: Gene–participates–Pathway (Reactome, WikiPathways, PID)"),
    "GpCC": ("located in", "Hetionet v1.0: Gene–participates–Cellular Component (Gene Ontology)"),
    "PCiC": ("includes", "Hetionet v1.0: Pharmacologic Class–includes–Compound (DrugCentral)"),
}
HETIONET_URL = "https://het.io/"

# GO cellular-component names -> our five regions. Checked in order; first keyword hit wins.
REGION_KEYWORDS = [
    ("mitochondri", "mitochondria"),
    ("endoplasmic reticulum", "er"),
    ("nucle", "nucleus"),
    ("chromatin", "nucleus"),
    ("chromosom", "nucleus"),
    ("plasma membrane", "membrane"),
    ("cell surface", "membrane"),
    ("cell junction", "membrane"),
    ("focal adhesion", "membrane"),
    ("cytosol", "cytoplasm"),
    ("cytoplasm", "cytoplasm"),
    ("cytoskeleton", "cytoplasm"),
]

ALIASES = {
    # drugs: brand / common names -> graph names
    "aspirin": "acetylsalicylic acid",
    "gleevec": "imatinib",
    "lipitor": "atorvastatin",
    "nolvadex": "tamoxifen",
    "zestril": "lisinopril",
    "prinivil": "lisinopril",
    # targets: common names -> graph gene names
    "bcr-abl": "abl1",
    "bcr-abl1": "abl1",
    "abl": "abl1",
    "cox-1": "ptgs1",
    "cox1": "ptgs1",
    "cox-2": "ptgs2",
    "cox2": "ptgs2",
    "hmg-coa reductase": "hmgcr",
    "estrogen receptor alpha": "esr1",
    "estrogen receptor": "esr1",
    "er-alpha": "esr1",
    "angiotensin-converting enzyme": "ace",
    "angiotensin converting enzyme": "ace",
}


def region_of(component_name: str) -> str | None:
    name = component_name.lower()
    for keyword, region in REGION_KEYWORDS:
        if keyword in name:
            return region
    return None


@lru_cache(maxsize=1)
def load_graph() -> nx.MultiDiGraph:
    data = json.loads(gzip.decompress(GRAPH_FILE.read_bytes()))
    g = nx.MultiDiGraph(curated_sources=data.get("curated_sources", {}))
    for node_id, name, kind in data["nodes"]:
        g.add_node(node_id, name=name, kind=kind)
    for src, rel, dst, source_id in data["edges"]:
        g.add_edge(src, dst, relation=rel, source_id=source_id)
    # Cellular components link to a virtual node per region, so "where in the cell" is just a hop.
    for region in REGIONS:
        g.add_node(f"Region::{region}", name=region, kind="Region")
    for node_id, attrs in list(g.nodes(data=True)):
        if attrs["kind"] == "Cellular Component" and (region := region_of(attrs["name"])):
            g.add_edge(node_id, f"Region::{region}", relation="is part of", source_id="hetionet:GpCC")
    return g


def _index(g: nx.MultiDiGraph) -> dict[str, str]:
    return {attrs["name"].lower(): n for n, attrs in g.nodes(data=True)}


def resolve(name: str) -> str | None:
    """Node id for a drug/gene/pathway name (case-insensitive, with a few brand-name aliases)."""
    g = load_graph()
    raw = name.strip().lower()
    key = ALIASES.get(raw) or ALIASES.get(raw.split(" (")[0]) or raw
    idx = _index(g)
    for candidate in (key, key.split(" (")[0]):
        if candidate in idx:
            return idx[candidate]
    # Prefer compounds and genes on partial matches ("BCR-ABL" -> ABL1 is handled by curated aliases).
    for kind in ("Compound", "Gene"):
        for n, attrs in g.nodes(data=True):
            if attrs["kind"] == kind and key in attrs["name"].lower():
                return n
    return None


def _triple(g: nx.MultiDiGraph, src: str, dst: str, data: dict) -> dict:
    return {
        "from": g.nodes[src]["name"],
        "from_kind": g.nodes[src]["kind"],
        "relation": data["relation"],
        "to": g.nodes[dst]["name"],
        "to_kind": g.nodes[dst]["kind"],
        "source_id": data["source_id"],
    }


# Most useful relations first, so the capped neighbourhood shows targets before side effects.
RELATION_PRIORITY = ["binds", "treats", "participates in", "located in", "is part of", "palliates",
                     "downregulates", "upregulates", "causes side effect", "includes"]


def neighbors(name: str, limit: int = 30) -> dict:
    """Direct relations of a drug, gene or pathway, most informative relation types first."""
    g = load_graph()
    node = resolve(name)
    if node is None:
        return {"error": f"'{name}' is not in the knowledge graph"}
    triples = [_triple(g, node, dst, d) for _, dst, d in g.out_edges(node, data=True)]
    triples += [_triple(g, src, node, d) for src, _, d in g.in_edges(node, data=True)]
    triples.sort(key=lambda t: RELATION_PRIORITY.index(t["relation"]) if t["relation"] in RELATION_PRIORITY else 99)
    counts: dict[str, int] = {}
    for t in triples:
        counts[t["relation"]] = counts.get(t["relation"], 0) + 1
    return {"entity": g.nodes[node]["name"], "kind": g.nodes[node]["kind"], "relation_counts": counts,
            "triples": triples[:limit]}


MECHANISTIC = {"binds", "participates in", "located in", "is part of", "downregulates", "upregulates"}


def _shortest(g: nx.MultiDiGraph, a: str, b: str, max_hops: int = 4) -> list[str] | None:
    """Breadth-first node path a -> b over mechanistic relations only."""
    queue = deque([[a]])
    seen = {a}
    while queue:
        path = queue.popleft()
        if len(path) > max_hops:
            continue
        for _, nxt, d in g.out_edges(path[-1], data=True):
            if d["relation"] not in MECHANISTIC or nxt in seen:
                continue
            if nxt == b:
                return path + [nxt]
            seen.add(nxt)
            queue.append(path + [nxt])
    return None


def find_path(drug: str, region: str, via: str | None = None) -> dict:
    """Shortest mechanistic chain from a drug to a cell region, e.g. drug -> target -> component -> region.
    `via` routes the chain through a specific target (gene symbol or protein name)."""
    g = load_graph()
    start = resolve(drug)
    if start is None:
        return {"error": f"'{drug}' is not in the knowledge graph"}
    if region not in REGIONS:
        return {"error": f"region must be one of {REGIONS}"}
    goal = f"Region::{region}"

    if via:
        mid = resolve(via)
        if mid is None:
            return {"error": f"'{via}' is not in the knowledge graph"}
        first, second = _shortest(g, start, mid), _shortest(g, mid, goal)
        nodes = first + second[1:] if first and second else None
    else:
        nodes = _shortest(g, start, goal)
    if nodes is None:
        return {"error": f"No mechanistic path from {drug} to the {region}" + (f" via {via}" if via else "")}

    hops = [_triple(g, a, b, next(iter(g.get_edge_data(a, b).values()))) for a, b in zip(nodes, nodes[1:])]
    return {"path": hops}


def off_targets(drug: str, primary: str | None = None, limit: int = 15) -> dict:
    """Other proteins the drug binds (besides `primary`) and its most common recorded side effects."""
    g = load_graph()
    node = resolve(drug)
    if node is None:
        return {"error": f"'{drug}' is not in the knowledge graph"}
    primary_node = resolve(primary) if primary else None
    targets, side_effects = [], []
    for _, dst, d in g.out_edges(node, data=True):
        if d["relation"] == "binds" and dst != primary_node:
            regions = sorted({r for _, cc, e in g.out_edges(dst, data=True) if e["relation"] == "located in"
                              for _, rr, _e in g.out_edges(cc, data=True) if rr.startswith("Region::")
                              for r in [g.nodes[rr]["name"]]})
            targets.append({"target": g.nodes[dst]["name"], "regions": regions, "source_id": d["source_id"]})
        elif d["relation"] == "causes side effect":
            side_effects.append(g.nodes[dst]["name"])
    return {"drug": g.nodes[node]["name"], "other_targets": targets[:limit],
            "side_effects_sample": sorted(side_effects)[:limit],
            "side_effect_count": len(side_effects),
            "side_effect_source_id": "hetionet:CcSE" if side_effects else None}


def citation(source_id: str) -> dict | None:
    """Citation record for a graph source id (hetionet:<metaedge> or curated:<key>)."""
    kind, _, key = source_id.partition(":")
    if kind == "hetionet" and key in METAEDGES:
        return {"id": source_id, "title": METAEDGES[key][1], "url": HETIONET_URL}
    if kind == "curated" and key in (meta := load_graph().graph["curated_sources"]):
        return {"id": source_id, **meta[key]}
    return None
