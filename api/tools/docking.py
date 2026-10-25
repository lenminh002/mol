"""Blind docking through NVIDIA's hosted DiffDock NIM: protein + ligand -> ranked poses."""

import hashlib
import os
from pathlib import Path

import httpx

from tools.cache import cached
from tools.drug import smiles_to_sdf
from tools.target import fetch_structure, get_target, protein_only

DIFFDOCK_URL = os.getenv("DIFFDOCK_URL", "https://health.api.nvidia.com/v1/biology/mit/diffdock")
POSES = Path(__file__).parent.parent / "data" / "poses"


class DockingError(Exception):
    pass


@cached("docking")
def run_docking(smiles: str, target_name: str, num_poses: int = 5) -> dict:
    """Dock a ligand (SMILES) into a target protein and return the best pose with its confidence."""
    api_key = os.getenv("NVIDIA_API_KEY")
    if not api_key:
        raise DockingError("NVIDIA_API_KEY is not set")

    target = get_target(target_name)
    protein = protein_only(fetch_structure(target).read_text())
    payload = {
        "ligand": smiles_to_sdf(smiles),
        "ligand_file_type": "sdf",
        "protein": protein,
        "num_poses": num_poses,
        "time_divisions": 20,
        "steps": 18,
        "save_trajectory": False,
        "is_staged": False,
    }
    resp = httpx.post(
        DIFFDOCK_URL,
        json=payload,
        headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
        timeout=120,
    )
    if resp.status_code != 200:
        raise DockingError(f"DiffDock returned {resp.status_code}: {resp.text[:300]}")
    data = resp.json()

    poses: list[str] = data.get("ligand_positions") or []
    confidences: list[float] = data.get("position_confidence") or []
    if not poses:
        raise DockingError(f"DiffDock returned no poses: {str(data)[:300]}")

    # DiffDock ranks poses by confidence; save the best one for the molecule viewer.
    POSES.mkdir(parents=True, exist_ok=True)
    pose_id = hashlib.sha256(f"{smiles}|{target_name}".encode()).hexdigest()[:12]
    (POSES / f"{pose_id}.sdf").write_text(poses[0])

    return {
        "target": target["name"],
        "pdb_id": target["pdb_id"],
        "method": "DiffDock (NVIDIA NIM)",
        "best_confidence": confidences[0] if confidences else None,
        "confidences": confidences,
        "pose_file": f"poses/{pose_id}.sdf",
        "note": "DiffDock confidence is a ranking score, not a binding affinity. Higher is more confident; "
        "values above 0 are generally considered good.",
    }
