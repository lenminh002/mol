"""Protein target lookup: curated demo targets, otherwise UniProt + RCSB/AlphaFold."""

from pathlib import Path

import httpx

from tools.cache import cached

STRUCTURES = Path(__file__).parent.parent / "data" / "structures"

# Demo targets with the PDB entry that shows the drug bound, so poses can be compared.
CURATED: dict[str, dict] = {
    "bcr-abl": {
        "name": "BCR-ABL (ABL1 kinase domain)",
        "uniprot": "P00519",
        "pdb_id": "1IEP",
        "cell_location": "cytoplasm",
        "note": "Constitutively active fusion kinase in chronic myeloid leukemia",
    },
    "cox-1": {
        "name": "COX-1 (PTGS1)",
        "uniprot": "P05979",
        "pdb_id": "1PTH",
        "cell_location": "er",
        "note": "Prostaglandin H2 synthase on the ER membrane; 1PTH is ovine COX-1 acetylated "
        "by 2-bromoacetoxy-benzoic acid, an aspirin analog",
    },
    "hmg-coa reductase": {
        "name": "HMG-CoA reductase (HMGCR)",
        "uniprot": "P04035",
        "pdb_id": "1HWK",
        "cell_location": "er",
        "note": "Rate-limiting enzyme of cholesterol synthesis, anchored in the ER membrane; "
        "1HWK is its catalytic portion bound to atorvastatin",
    },
    "estrogen receptor alpha": {
        "name": "Estrogen receptor alpha (ESR1)",
        "uniprot": "P03372",
        "pdb_id": "3ERT",
        "cell_location": "nucleus",
        "note": "Ligand-activated transcription factor; 3ERT is its ligand-binding domain bound to "
        "4-hydroxytamoxifen, tamoxifen's active metabolite",
    },
    "ace": {
        "name": "Angiotensin-converting enzyme (ACE)",
        "uniprot": "P12821",
        "pdb_id": "1O86",
        "cell_location": "membrane",
        "note": "Membrane-bound peptidase that makes angiotensin II; 1O86 is human testis ACE "
        "(equivalent to the somatic C-domain) bound to lisinopril",
    },
}
ALIASES = {
    "abl1": "bcr-abl",
    "abl": "bcr-abl",
    "ptgs1": "cox-1",
    "cox1": "cox-1",
    "hmgcr": "hmg-coa reductase",
    "hmg-coa": "hmg-coa reductase",
    "esr1": "estrogen receptor alpha",
    "estrogen receptor": "estrogen receptor alpha",
    "er-alpha": "estrogen receptor alpha",
    "erα": "estrogen receptor alpha",
    "angiotensin-converting enzyme": "ace",
    "angiotensin converting enzyme": "ace",
}

# UniProt subcellular location text -> our five cell regions (first match wins).
LOCATION_KEYWORDS = [
    ("mitochondri", "mitochondria"),
    ("endoplasmic reticulum", "er"),
    ("nucleus", "nucleus"),
    ("nuclear", "nucleus"),
    ("cell membrane", "membrane"),
    ("plasma membrane", "membrane"),
    ("secreted", "membrane"),
    ("cytoplasm", "cytoplasm"),
    ("cytosol", "cytoplasm"),
]


class TargetNotFound(Exception):
    pass


def _curated(name: str) -> dict | None:
    key = name.strip().lower()
    return CURATED.get(ALIASES.get(key, key))


def _map_location(texts: list[str]) -> str:
    joined = " ".join(texts).lower()
    for keyword, loc in LOCATION_KEYWORDS:
        if keyword in joined:
            return loc
    return "cytoplasm"


@cached("target")
def get_target(name: str) -> dict:
    """Resolve a protein target to UniProt, a 3D structure and where it lives in the cell."""
    if curated := _curated(name):
        return {**curated, "source": "curated", "structure_url": rcsb_url(curated["pdb_id"])}

    fields = "accession,protein_name,gene_primary,cc_subcellular_location,xref_pdb"
    query = f"(gene_exact:{name} OR protein_name:\"{name}\") AND organism_id:9606 AND reviewed:true"
    resp = httpx.get(
        "https://rest.uniprot.org/uniprotkb/search",
        params={"query": query, "fields": fields, "format": "json", "size": 1},
        timeout=20,
    )
    resp.raise_for_status()
    results = resp.json().get("results", [])
    if not results:
        raise TargetNotFound(f"No reviewed human UniProt entry matches '{name}'")
    entry = results[0]

    accession = entry["primaryAccession"]
    protein = entry.get("proteinDescription", {}).get("recommendedName", {}).get("fullName", {}).get("value", name)
    locations = [
        loc["location"]["value"]
        for c in entry.get("comments", [])
        if c.get("commentType") == "SUBCELLULAR LOCATION"
        for loc in c.get("subcellularLocations", [])
    ]
    pdb_ids = [x["id"] for x in entry.get("uniProtKBCrossReferences", []) if x.get("database") == "PDB"]
    pdb_id = pdb_ids[0] if pdb_ids else None

    return {
        "name": protein,
        "uniprot": accession,
        "pdb_id": pdb_id,
        "cell_location": _map_location(locations),
        "note": "; ".join(locations[:3]),
        "source": "uniprot",
        "structure_url": rcsb_url(pdb_id) if pdb_id else alphafold_url(accession),
    }


def rcsb_url(pdb_id: str) -> str:
    return f"https://files.rcsb.org/download/{pdb_id.upper()}.pdb"


def alphafold_url(accession: str) -> str:
    return f"https://alphafold.ebi.ac.uk/files/AF-{accession}-F1-model_v4.pdb"


def fetch_structure(target: dict) -> Path:
    """Download the target's PDB file once and return its local path."""
    STRUCTURES.mkdir(parents=True, exist_ok=True)
    stem = target["pdb_id"] or f"AF-{target['uniprot']}"
    path = STRUCTURES / f"{stem}.pdb"
    if not path.exists():
        resp = httpx.get(target["structure_url"], timeout=60, follow_redirects=True)
        resp.raise_for_status()
        path.write_text(resp.text)
    return path


def protein_only(pdb_text: str) -> str:
    """Strip ligands, waters and ions so the docking model sees only the receptor."""
    keep = ("ATOM", "TER", "END")
    return "\n".join(line for line in pdb_text.splitlines() if line.startswith(keep)) + "\n"
