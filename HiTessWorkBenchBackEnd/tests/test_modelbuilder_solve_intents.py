"""Analysis 탭 해석 실행이 Studio 편집 intent 전체를 '편집 적용'과 같은 엔진으로 반영하는가.

배경(2026-10-02 정합성 검토): 해석 실행은 삭제·RBE 추가만 BDF 텍스트에 직접 반영해 노드 추가·회전·유체 비움·
무게중심 RBE 가 빠졌고, 무게중심 RBE 가 있으면 independent_node=null 로 요청 전체가 422 였다.
엔진 exe 가 없으면 엔진 경로 테스트는 건너뛴다(CMB_CLI_EXE 로 새 빌드 지정 가능).
"""
import json
import os
import shutil
from pathlib import Path

import pytest

from app.routers.analysis import ModelBuilderSolveRequest
from app.services import modelbuilder_solve_service as solve

BACKEND = Path(__file__).resolve().parents[1]
FIXTURE = BACKEND / "tests" / "fixtures" / "modelbuilder_edit_contract"
BASE = "06_Validation"
CMB_EXE = Path(os.environ.get("CMB_CLI_EXE") or solve._CMB_EXE)
OK = {"status": "ok", "warnings": [], "errors": []}


@pytest.fixture()
def work(tmp_path, monkeypatch):
    for name in (f"{BASE}.json", f"{BASE}.bdf"):
        shutil.copy2(FIXTURE / name, tmp_path / name)
    monkeypatch.setattr(solve, "_CMB_EXE", str(CMB_EXE))
    (tmp_path / "solve").mkdir()
    return tmp_path


def _doc(intents):
    meta = json.loads((FIXTURE / f"{BASE}.json").read_text(encoding="utf-8"))["meta"]
    return {
        "schemaVersion": "1.0",
        "stageRef": {"phase": meta["phase"], "stageName": meta["stageName"], "sourceTimestamp": meta["timestamp"]},
        "intents": [{"id": f"i{n}", "createdAt": "2026-10-02T00:00:00Z", "validation": OK, **it} for n, it in enumerate(intents)],
    }


def _grids(text):
    return solve._grid_ids(text)


def test_centroid_rigid_no_longer_rejects_request():
    req = ModelBuilderSolveRequest.model_validate({
        "employee_id": "A", "work_dir": "x", "bdf_path": "",
        "edits": {"added_rigids": [{"independent_node": None, "dependent_nodes": [1, 2, 3]}],
                  "intent_document": {"intents": []}, "base_name": BASE},
    })
    assert req.edits.added_rigids[0].independent_node is None


@pytest.mark.skipif(not CMB_EXE.is_file(), reason="Cmb.Cli.exe 없음")
def test_engine_path_applies_group_delete(work):
    doc = _doc([{"kind": "deleteGroup", "params": {"groupId": 4, "memberNodeCount": 2}}])
    text, log = solve.build_edited_source_bdf(str(work / f"{BASE}.bdf"), str(work / "solve"),
                                              {"intent_document": doc, "base_name": BASE})
    assert {11, 12}.isdisjoint(_grids(text))
    assert 13 in _grids(text)


@pytest.mark.skipif(not CMB_EXE.is_file(), reason="Cmb.Cli.exe 없음")
def test_rotation_and_added_node_survive_edit_apply(work):
    # 2026-10-28 부터 엔진이 addNode 를 직접 적용한다(옛 엔진이면 bridge fallback). 어느 경로든 결과가 같아야 한다.
    doc = _doc([
        {"kind": "rotateModel", "params": {"axis": "Z", "angleDeg": 90, "pivot": {"x": 0, "y": 0, "z": 0}}},
        {"kind": "addNode", "params": {"nodeId": 500, "x": 1.0, "y": 2.0, "z": 3.0}},
        {"kind": "addRigid", "params": {"independentNode": 500, "dependentNodes": [9], "cm": "123456"}},
    ])
    text, log = solve.build_edited_source_bdf(str(work / f"{BASE}.bdf"), str(work / "solve"),
                                              {"intent_document": doc, "base_name": BASE})
    assert 500 in _grids(text)
    edited = json.loads(next((work / "solve" / "edit_apply" / "edited").glob("*.json")).read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in edited["nodes"]}
    assert (nodes[500]["x"], nodes[500]["y"]) == pytest.approx((1.0, 2.0))       # 추가 노드는 한 번 더 안 돈다
    assert (nodes[1]["x"], nodes[1]["y"]) == pytest.approx((-4908.0, 90072.0))   # 원본 노드는 Z 90° 회전


def test_rejects_unsafe_base_name(work):
    with pytest.raises(RuntimeError, match="파일명"):
        solve.build_edited_source_bdf(str(work / f"{BASE}.bdf"), str(work / "solve"),
                                      {"intent_document": _doc([{"kind": "deleteGroup", "params": {"groupId": 4}}]),
                                       "base_name": "..\\evil"})


def test_grid_ids_reads_fixed_free_and_large_fields():
    text = "GRID           9        202754.0  -410.0 26256.0\nGRID,10,,1.,2.,3.\nGRID*   11              0.0\nCBAR,1,1,1,2\n"
    assert solve._grid_ids(text) == {9, 10, 11}
