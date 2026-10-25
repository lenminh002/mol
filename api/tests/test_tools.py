import os

import pytest

from tools import cache
from tools.docking import run_docking
from tools.drug import DrugNotFound, autocomplete, get_drug, smiles_to_sdf
from tools.target import _map_location, fetch_structure, get_target, protein_only

ASPIRIN = "CC(=O)OC1=CC=CC=C1C(=O)O"


# --- offline ---------------------------------------------------------------


def test_cache_reuses_result():
    calls = []

    @cache.cached("test")
    def f(x):
        calls.append(x)
        return {"x": x}

    assert f(1) == {"x": 1}
    assert f(1) == {"x": 1}
    assert f(2) == {"x": 2}
    assert calls == [1, 2]


def test_smiles_to_sdf_has_3d_coords():
    sdf = smiles_to_sdf(ASPIRIN)
    assert "V2000" in sdf and sdf.endswith("$$$$\n")
    # 3D: at least one atom with a non-zero z coordinate
    atom_lines = [line for line in sdf.splitlines()[4:] if len(line.split()) > 3 and line.split()[3].isalpha()]
    assert any(abs(float(line.split()[2])) > 0.01 for line in atom_lines)


def test_location_mapping():
    assert _map_location(["Mitochondrion inner membrane"]) == "mitochondria"
    assert _map_location(["Endoplasmic reticulum membrane"]) == "er"
    assert _map_location(["Cell membrane", "Cytoplasm"]) == "membrane"
    assert _map_location(["Nucleus"]) == "nucleus"
    assert _map_location([]) == "cytoplasm"


def test_protein_only_strips_hetero_atoms():
    pdb = "ATOM      1  N   ALA A   1\nHETATM    2  O   HOH A 101\nTER\nEND"
    assert protein_only(pdb) == "ATOM      1  N   ALA A   1\nTER\nEND\n"


def test_curated_target_aliases():
    t = get_target("ESR1")
    assert t["pdb_id"] == "3ERT" and t["cell_location"] == "nucleus"
    assert get_target("HMG-CoA reductase")["cell_location"] == "er"
    assert get_target("BCR-ABL")["pdb_id"] == "1IEP"


# --- network ---------------------------------------------------------------


@pytest.mark.network
def test_get_drug_aspirin():
    d = get_drug("aspirin")
    assert d["cid"] == 2244
    assert 179 < d["mw"] < 181
    assert d["lipinski_violations"] == 0


@pytest.mark.network
def test_get_drug_unknown():
    with pytest.raises(DrugNotFound):
        get_drug("notarealdrugxyz123")


@pytest.mark.network
def test_get_target_from_uniprot():
    t = get_target("PTGS2")  # COX-2, not curated
    assert t["uniprot"] == "P35354"
    assert t["cell_location"] in {"er", "nucleus"}
    assert t["structure_url"].endswith(".pdb")


@pytest.mark.network
def test_fetch_structure_1iep():
    path = fetch_structure(get_target("BCR-ABL"))
    text = path.read_text()
    assert "STI" in text  # imatinib's ligand code in 1IEP
    assert protein_only(text).count("ATOM") > 1000


# --- docking ---------------------------------------------------------------


@pytest.mark.docking
@pytest.mark.skipif(not os.getenv("NVIDIA_API_KEY"), reason="NVIDIA_API_KEY not set")
def test_docking_aspirin_cox1():
    r = run_docking(ASPIRIN, "COX-1", num_poses=3)
    assert r["pose_file"].endswith(".sdf")
    assert len(r["confidences"]) >= 1


@pytest.mark.network
def test_autocomplete():
    assert "Imatinib" in autocomplete("imat")


@pytest.mark.network
@pytest.mark.skipif(not os.getenv("CARTESIA_API_KEY"), reason="CARTESIA_API_KEY not set")
def test_tts_synthesizes_and_caches(tmp_path, monkeypatch):
    from tools import tts

    monkeypatch.setattr(tts, "AUDIO_DIR", tmp_path)
    first = tts.synthesize("Atorvastatin blocks cholesterol synthesis in the liver.")
    data = first.read_bytes()
    assert len(data) > 2000 and (data[:3] == b"ID3" or data[:2] == b"\xff\xfb" or data[0] == 0xFF)
    mtime = first.stat().st_mtime
    assert tts.synthesize("Atorvastatin blocks cholesterol synthesis in the liver.").stat().st_mtime == mtime
