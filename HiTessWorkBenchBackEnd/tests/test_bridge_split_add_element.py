"""nastran_bridge — 부재 나누기(splitElement) · 노드끼리 새 부재(addElement), Mooring Studio 현업 요청 5번(2026-11-12)."""
import math

import pytest

from app.routers import analysis as _an  # noqa: F401  — nastran_bridge 경로를 sys.path 에 올린다

nb = pytest.importorskip("nastran_bridge")


def _model():
    return {
        "nodes": [
            {"id": 1, "x": 0, "y": 0, "z": 0},
            {"id": 2, "x": 1000, "y": 0, "z": 0},
            {"id": 3, "x": 500, "y": 600, "z": 0},
            {"id": 4, "x": 0, "y": 0, "z": 800},
        ],
        "elements": [
            {"id": 10, "type": "CBEAM", "startNode": 1, "endNode": 2, "propertyId": 7,
             "category": "Structure", "orientation": [0, 0, 1], "lengthMm": 1000},
        ],
        "rigids": [{"id": 20, "independentNode": 3, "dependentNodes": [4]}],
        "properties": [{"id": 7, "card": "PBEAML", "kind": "T", "dims": [850, 461, 11, 18]},
                       {"id": 8, "card": "PBEAML", "kind": "T", "dims": [850, 311, 11, 12]}],
        "pointMasses": [],
    }


def _edit(*intents):
    return {"schemaVersion": "1.0", "intents": [{"id": f"i{k}", **it} for k, it in enumerate(intents)]}


def _apply(model, *intents):
    edit = _edit(*intents)
    assert nb.is_edit_json(edit), "편집 JSON 머리 형식을 확인하세요"
    return nb.apply_edit_json(model, edit)


def _el(data, eid):
    return next(e for e in data["elements"] if e["id"] == eid)


def _node(data, nid):
    return next(n for n in data["nodes"] if n["id"] == nid)


def test_split_by_ratio_keeps_total_length_and_section():
    data, summary = _apply(_model(), {"kind": "splitElement",
                                      "params": {"elementId": 10, "newNodeId": 100, "newElementId": 101, "ratio": 0.25}})
    assert (_node(data, 100)["x"], _node(data, 100)["y"], _node(data, 100)["z"]) == (250, 0, 0)
    a, b = _el(data, 10), _el(data, 101)
    assert (a["startNode"], a["endNode"], b["startNode"], b["endNode"]) == (1, 100, 100, 2)
    assert b["propertyId"] == 7 and b["orientation"] == [0, 0, 1] and b["splitOf"] == 10
    assert math.isclose(a["lengthMm"] + b["lengthMm"], 1000)
    assert summary["splitElements"] == [{"elementId": 10, "newNodeId": 100, "newElementId": 101}]


def test_split_by_point_projects_onto_member():
    data, _ = _apply(_model(), {"kind": "splitElement",
                                "params": {"elementId": 10, "newNodeId": 100, "newElementId": 101, "x": 600, "y": 300, "z": 50}})
    assert (_node(data, 100)["x"], _node(data, 100)["y"], _node(data, 100)["z"]) == (600, 0, 0)


@pytest.mark.parametrize("params,message", [
    ({"ratio": 0.0005}, "끝에서"),                       # 0.5 mm — 길이 0 에 가까운 조각
    ({"ratio": 1.2}, "끝에서"),                          # 부재 밖
    ({"ratio": 0.5, "newNodeId": 3}, "이미 존재"),        # 쓰고 있는 노드 번호
    ({"ratio": 0.5, "newElementId": 20}, "이미 쓰이고"),   # RBE 번호와 겹침(같은 EID 공간)
])
def test_split_refuses_bad_input(params, message):
    full = {"elementId": 10, "newNodeId": 100, "newElementId": 101, **params}
    with pytest.raises(SystemExit, match=message):
        _apply(_model(), {"kind": "splitElement", "params": full})


def test_add_element_after_split_uses_new_node_and_reference_section():
    """Studio 는 나누기 → 그 노드에 새 부재 순으로 기록한다. 배열 순서가 바뀌어도 나누기가 먼저 적용돼야 한다."""
    data, summary = _apply(
        _model(),
        {"kind": "addElement", "params": {"elementId": 102, "startNode": 100, "endNode": 3, "refElementId": 10}},
        {"kind": "splitElement", "params": {"elementId": 10, "newNodeId": 100, "newElementId": 101, "ratio": 0.5}},
    )
    e = _el(data, 102)
    assert (e["startNode"], e["endNode"], e["propertyId"], e["addedFrom"]) == (100, 3, 7, 10)
    assert e["orientation"] == [0, 0, 1]
    assert summary["addedElements"] == [102]


def test_add_element_picks_valid_orientation_when_reference_vector_is_parallel():
    # 수직 부재에 참조 방향 (0,0,1) 은 축과 평행 → 엔진 규칙 (1,0,0)
    data, _ = _apply(_model(), {"kind": "addElement",
                                "params": {"elementId": 102, "startNode": 1, "endNode": 4, "refElementId": 10}})
    assert _el(data, 102)["orientation"] == [1, 0, 0]


def test_add_element_other_section_and_refusals():
    data, _ = _apply(_model(), {"kind": "addElement",
                                "params": {"elementId": 102, "startNode": 2, "endNode": 3, "refElementId": 10, "propertyId": 8}})
    assert _el(data, 102)["propertyId"] == 8
    for params, message in [({"propertyId": 99}, "PID"), ({"endNode": 2}, "서로 다른"), ({"refElementId": 77}, "참조 요소"),
                            ({"elementId": 10}, "이미 쓰이고")]:
        full = {"elementId": 102, "startNode": 2, "endNode": 3, "refElementId": 10, **params}
        with pytest.raises(SystemExit, match=message):
            _apply(_model(), {"kind": "addElement", "params": full})


def test_old_kinds_unchanged_by_new_branches():
    """새 분기는 기존 kind 의 결과를 바꾸지 않는다 — duplicateElement 가 예전처럼 reinforceOf 를 남긴다."""
    data, summary = _apply(_model(), {"kind": "duplicateElement", "params": {"sourceElementId": 10}})
    clone = [e for e in data["elements"] if e.get("reinforceOf") == 10]
    assert len(clone) == 1 and summary["applied"] == 1


def test_studio_numbers_win_over_bridge_numbers():
    """Studio 가 정한 새 부재 번호가 앞선 복제(bridge 가 번호를 고름)에 뺏기지 않는다."""
    m = _model()
    data, _ = _apply(m, {"kind": "duplicateElement", "params": {"sourceElementId": 10}},
                     {"kind": "addElement", "params": {"elementId": 21, "startNode": 2, "endNode": 3, "refElementId": 10}})
    ids = sorted(e["id"] for e in data["elements"])
    assert 21 in ids and len(ids) == len(set(ids)) == 3
