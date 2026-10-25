"""Build api/data/graph.json.gz from Hetionet v1.0 (plus any curated edges below).

    uv run python ingest/build_graph.py

Downloads Hetionet's node/edge tables (~15 MB, from github.com/hetio/hetionet) on first run.
Keeps the mechanism-relevant edge types, and only gene->pathway/component edges for genes some
drug actually touches, which keeps the graph small enough to load in a second.
"""

import csv
import gzip
import json
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from tools.graph import GRAPH_FILE, METAEDGES  # noqa: E402

HETIONET_DIR = ROOT / "data" / "hetionet"
HETIONET_RAW = "https://github.com/hetio/hetionet/raw/main/hetnet/tsv"
FILES = ["hetionet-v1.0-nodes.tsv", "hetionet-v1.0-edges.sif.gz"]

DRUG_EDGES = {"CbG", "CuG", "CdG", "CtD", "CpD", "CcSE", "PCiC"}
GENE_EDGES = {"GpPW", "GpCC"}

# Drugs and targets newer than Hetionet (2017) can be added here; every edge must cite the
# structure or database entry behind it, e.g. ("Compound::x", "binds", "Gene::y", "curated:<key>").
CURATED_SOURCES: dict[str, dict] = {}
CURATED_NODES: list[tuple[str, str, str]] = []
CURATED_EDGES: list[tuple[str, str, str, str]] = []


def download() -> None:
    HETIONET_DIR.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        path = HETIONET_DIR / name
        if not path.exists():
            print(f"downloading {name}…")
            resp = httpx.get(f"{HETIONET_RAW}/{name}", follow_redirects=True, timeout=300)
            resp.raise_for_status()
            path.write_bytes(resp.content)


def build() -> dict:
    download()
    names: dict[str, tuple[str, str]] = {}
    with open(HETIONET_DIR / FILES[0]) as f:
        for row in csv.DictReader(f, delimiter="\t"):
            names[row["id"]] = (row["name"], row["kind"])

    drug_edges, gene_edges = [], []
    with gzip.open(HETIONET_DIR / FILES[1], "rt") as f:
        next(f)
        for line in f:
            src, metaedge, dst = line.rstrip("\n").split("\t")
            if metaedge in DRUG_EDGES:
                drug_edges.append((src, metaedge, dst))
            elif metaedge in GENE_EDGES:
                gene_edges.append((src, metaedge, dst))

    # Genes some compound touches.
    touched = {dst for _, m, dst in drug_edges if m in {"CbG", "CuG", "CdG"}}
    edges = [(s, METAEDGES[m][0], d, f"hetionet:{m}") for s, m, d in drug_edges]
    edges += [(s, METAEDGES[m][0], d, f"hetionet:{m}") for s, m, d in gene_edges if s in touched]
    edges += CURATED_EDGES

    used = {n for s, _, d, _ in edges for n in (s, d)}
    nodes = [(n, *names[n]) for n in sorted(used) if n in names]
    nodes += CURATED_NODES
    return {"nodes": nodes, "edges": edges, "curated_sources": CURATED_SOURCES,
            "version": "hetionet-v1.0"}


if __name__ == "__main__":
    data = build()
    GRAPH_FILE.parent.mkdir(parents=True, exist_ok=True)
    GRAPH_FILE.write_bytes(gzip.compress(json.dumps(data).encode()))
    print(f"{len(data['nodes'])} nodes, {len(data['edges'])} edges -> {GRAPH_FILE.relative_to(ROOT)} "
          f"({GRAPH_FILE.stat().st_size / 1e6:.1f} MB)")
