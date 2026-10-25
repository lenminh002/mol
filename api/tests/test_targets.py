from agents.claude import JudgeTarget, JudgeVerdict
from agents.evidence import EvidenceBoard
from agents.orchestrator import _assemble
from schemas import SimulationResult, Target


def test_off_targets_get_no_structure_or_docking_from_the_primary():
    board = EvidenceBoard(lambda _event: None)
    board.drugs["imatinib"] = {"smiles": "C"}
    board.targets["bcr-abl"] = {"uniprot": "P00519", "pdb_id": "1IEP", "name": "BCR-ABL"}
    board.docking["bcr-abl"] = {"best_confidence": 0.1, "pose_file": "poses/x.sdf"}
    verdict = JudgeVerdict(
        targets=[
            JudgeTarget(name="BCR-ABL", cell_location="cytoplasm", role="primary"),
            JudgeTarget(name="LCK", cell_location="cytoplasm", role="off_target"),
        ],
        effects=[], reasoning_path=[], caveats=[], summary="", verdict_note="",
    )
    result = _assemble(board, "imatinib", verdict, [])
    primary, off = result.targets
    assert (primary.role, primary.pdb_id) == ("primary", "1IEP")
    assert (off.role, off.pdb_id, off.pose_pdb_url, off.binding_score) == ("off_target", None, None, None)


def test_old_results_without_a_role_default_to_primary():
    assert Target(name="ACE", cell_location="membrane").role == "primary"


def test_cached_imatinib_loads_with_off_targets():
    from agents.orchestrator import cached_result

    result = cached_result("imatinib-bcrabl")
    assert isinstance(result, SimulationResult)
    assert [t.role for t in result.targets] == ["primary", "off_target", "off_target"]
