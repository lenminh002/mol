"""What the molecule viewer should focus on in a structure, and which residues line the binding site.

Focus is the co-crystallized drug for the presets (the experimental pose), or the largest drug-like
het group for other structures. A `chain` focus (protein–protein interface) is also supported.
"""

import math
from collections import defaultdict
from pathlib import Path

import httpx

STRUCTURES = Path(__file__).parent.parent / "data" / "structures"

# PDB entry -> what the drug is in that structure.
CURATED_FOCUS: dict[str, dict] = {
    "1IEP": {"ligands": ["STI"], "label": "imatinib (STI-571)"},
    "1HWK": {"ligands": ["117"], "label": "atorvastatin"},
    "3ERT": {"ligands": ["OHT"], "label": "4-hydroxytamoxifen (tamoxifen's active form)"},
    "1O86": {"ligands": ["LPR"], "label": "lisinopril"},
}

# Waters, ions, sugars, detergents and other crystallization additives — never the drug.
NOT_DRUGS = {
    "HOH", "DOD", "NA", "CL", "K", "MG", "ZN", "CA", "MN", "FE", "CU", "CO", "NI", "CD", "IOD", "BR",
    "SO4", "PO4", "POP", "GOL", "EDO", "PEG", "PGE", "PG4", "1PE", "ACT", "DMS", "FMT", "MPD", "TRS",
    "EPE", "MES", "BOG", "NAG", "NDG", "MAN", "BMA", "FUC", "GAL", "GLC", "HEM", "CIT", "FLC", "ACY", "IMD",
}
CUTOFF = 5.0


def structure_path(pdb_id: str) -> Path:
    pdb_id = pdb_id.upper()
    path = STRUCTURES / f"{pdb_id}.pdb"
    if not path.exists():
        resp = httpx.get(f"https://files.rcsb.org/download/{pdb_id}.pdb", timeout=60)
        resp.raise_for_status()
        STRUCTURES.mkdir(parents=True, exist_ok=True)
        path.write_text(resp.text)
    return path


def _atoms(pdb_text: str) -> list[dict]:
    atoms = []
    for line in pdb_text.splitlines():
        if line.startswith(("ATOM", "HETATM")):
            atoms.append({
                "het": line.startswith("HETATM"),
                "resname": line[17:20].strip(),
                "chain": line[21],
                "resseq": line[22:26].strip(),
                "xyz": (float(line[30:38]), float(line[38:46]), float(line[46:54])),
            })
        elif line.startswith("ENDMDL"):
            break  # first model only
    return atoms


def _auto_ligand(atoms: list[dict]) -> list[str]:
    sizes: dict[str, int] = defaultdict(int)
    for a in atoms:
        if a["het"] and a["resname"] not in NOT_DRUGS:
            sizes[a["resname"]] += 1
    return [max(sizes, key=sizes.get)] if sizes else []


def binding_site(pdb_id: str) -> dict:
    pdb_id = pdb_id.upper()
    atoms = _atoms(structure_path(pdb_id).read_text())
    focus = dict(CURATED_FOCUS.get(pdb_id) or {})
    if not focus:
        ligands = _auto_ligand(atoms)
        focus = {"ligands": ligands, "label": ligands[0] if ligands else "whole structure"}

    if focus.get("ligands"):
        names = set(focus["ligands"])
        # Crystals often hold several copies of the complex; use the copy the first ligand atom belongs to.
        first = next((a for a in atoms if a["resname"] in names), None)
        if first is None:
            return {"pdb_id": pdb_id, "focus": focus, "residues": [], "residue_count": 0}
        focus["chain"] = first["chain"]
        site = [a for a in atoms if a["resname"] in names and a["chain"] == first["chain"]]
        # Partners: protein/nucleic residues and any other het group except the ligand itself and waters.
        partners = [a for a in atoms if a["resname"] not in names and a["resname"] not in {"HOH", "DOD"}]
    elif focus.get("chain"):
        site = [a for a in atoms if a["chain"] == focus["chain"] and not a["het"]]
        partners = [a for a in atoms if a["chain"] != focus["chain"] and not a["het"]]
    else:
        return {"pdb_id": pdb_id, "focus": focus, "residues": [], "residue_count": 0}

    # Grid hash the site atoms so the neighbour search stays fast on large complexes.
    cell = CUTOFF
    grid: dict[tuple, list] = defaultdict(list)
    for a in site:
        grid[tuple(int(c // cell) for c in a["xyz"])].append(a["xyz"])

    near: dict[tuple, float] = {}
    for a in partners:
        gx, gy, gz = (int(c // cell) for c in a["xyz"])
        best = min(
            (math.dist(a["xyz"], s) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1)
             for s in grid.get((gx + dx, gy + dy, gz + dz), [])),
            default=None,
        )
        if best is not None and best <= CUTOFF:
            key = (a["chain"], a["resname"], a["resseq"])
            near[key] = min(near.get(key, best), best)

    residues = [
        {"chain": c, "resname": r, "resseq": s, "distance": round(d, 2)}
        for (c, r, s), d in sorted(near.items(), key=lambda kv: kv[1])
    ]
    return {"pdb_id": pdb_id, "focus": focus, "residues": residues[:40], "residue_count": len(residues)}
