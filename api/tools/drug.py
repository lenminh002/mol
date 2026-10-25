"""Drug lookup: PubChem for identity/structure, RDKit for drug-likeness properties."""

from urllib.parse import quote

import httpx
from rdkit import Chem
from rdkit.Chem import AllChem, Crippen, Descriptors, Lipinski, rdMolDescriptors

from tools.cache import cached

PUBCHEM = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
AUTOCOMPLETE = "https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound"


class DrugNotFound(Exception):
    pass


@cached("drug")
def get_drug(name: str) -> dict:
    """Look up a small-molecule drug by name and compute its drug-likeness properties."""
    url = f"{PUBCHEM}/compound/name/{quote(name)}/property/SMILES,MolecularFormula,IUPACName/JSON"
    resp = httpx.get(url, timeout=20)
    if resp.status_code == 404:
        raise DrugNotFound(f"PubChem has no compound named '{name}'")
    resp.raise_for_status()
    props = resp.json()["PropertyTable"]["Properties"][0]

    smiles = props["SMILES"]
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise DrugNotFound(f"RDKit could not parse the SMILES for '{name}'")

    mw = Descriptors.MolWt(mol)
    logp = Crippen.MolLogP(mol)
    hbd = Lipinski.NumHDonors(mol)
    hba = Lipinski.NumHAcceptors(mol)
    violations = sum([mw > 500, logp > 5, hbd > 5, hba > 10])

    return {
        "name": name,
        "cid": props["CID"],
        "smiles": smiles,
        "formula": props.get("MolecularFormula"),
        "iupac_name": props.get("IUPACName"),
        "mw": round(mw, 2),
        "logp": round(logp, 2),
        "hbd": hbd,
        "hba": hba,
        "tpsa": round(rdMolDescriptors.CalcTPSA(mol), 2),
        "rotatable_bonds": Lipinski.NumRotatableBonds(mol),
        "lipinski_violations": violations,
        "pubchem_url": f"https://pubchem.ncbi.nlm.nih.gov/compound/{props['CID']}",
    }


def smiles_to_sdf(smiles: str) -> str:
    """3D conformer (ETKDG + MMFF) as SDF text, the ligand input DiffDock expects."""
    mol = Chem.AddHs(Chem.MolFromSmiles(smiles))
    if AllChem.EmbedMolecule(mol, AllChem.ETKDGv3()) != 0:
        raise ValueError("RDKit could not embed a 3D conformer")
    AllChem.MMFFOptimizeMolecule(mol)
    return Chem.MolToMolBlock(mol) + "$$$$\n"


@cached("autocomplete")
def autocomplete(prefix: str, limit: int = 8) -> list[str]:
    """PubChem compound-name suggestions for a typed prefix."""
    resp = httpx.get(f"{AUTOCOMPLETE}/{quote(prefix)}/json", params={"limit": limit}, timeout=10)
    resp.raise_for_status()
    return resp.json().get("dictionary_terms", {}).get("compound", [])
