"""편집 intent → 편집 반영 solvable BDF 검증.

duplicateElement(보강) / duplicateElement+newPropertyId / changeElementProperty(참조 단면 복사)
가 _build_solvable_edited_bdf 의 deck 에 EID·PID 로 정확히 반영되는지, EID 충돌이 없는지 확인.
현재 _build_solvable_edited_bdf / apply_edit_json 편집 경로는 별도 커버리지가 없어 순증 테스트.
"""
import re
from pathlib import Path

import pytest

# analysis import 가 WorkBenchSubModule/Nastran_bridge 를 sys.path 에 추가 → 그 뒤 nastran_bridge import.
from app.routers import analysis as _an

try:
    import nastran_bridge as _nb
    _NB = True
except Exception:  # pragma: no cover - nastran_bridge 미가용 환경
    _NB = False

pytestmark = pytest.mark.skipif(not _NB, reason="nastran_bridge 모듈 미가용")


def _card(*fields):
    """8-col 고정 small-field 카드 한 줄 생성(각 필드 좌측정렬 8칸)."""
    return "".join(str(f).ljust(8)[:8] for f in fields)


def _write_minimal_bdf(path: Path) -> None:
    """SOL101 solvable deck: GRID 2개, PBEAML 10·20, 같은 노드쌍 CBEAM 2개(PID10), FORCE/SPC."""
    lines = [
        "SOL 101",
        "CEND",
        "SPC = 1",
        "LOAD = 1",
        "SUBCASE 1",
        "  LABEL = unit",
        "BEGIN BULK",
        _card("MAT1", 100, 210000.0, "", 0.3),
        _card("PBEAML", 10, 100, "", "BAR", 50.0, 30.0),
        _card("PBEAML", 20, 100, "", "BAR", 80.0, 40.0),
        _card("GRID", 1, "", 0.0, 0.0, 0.0),
        _card("GRID", 2, "", 1000.0, 0.0, 0.0),
        _card("CBEAM", 1, 10, 1, 2, 0.0, 0.0, 1.0),
        _card("CBEAM", 2, 10, 1, 2, 0.0, 0.0, 1.0),
        _card("FORCE", 1, 2, 0, 1000.0, 1.0, 0.0, 0.0),
        _card("SPC", 1, 1, 123456, 0.0),
        "ENDDATA",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _fields(ln):
    return re.split(r"[,\s]+", ln.strip())


def _pid(ln):
    return ln[16:24].strip()


def _eid(ln):
    return ln[8:16].strip()


def test_fixed_real_normalizes_rotation_roundoff_to_zero():
    """모델 회전에서 생긴 1e-16급 잔차는 CBEAM orientation에 지수 표기로 남기지 않는다."""
    assert _nb.fixed_real(-7.03e-17) == "     0.0"
    line = _nb.bdf_line_fixed(
        "CBEAM", 2513, 7, 1699, 1700, -0.81862, -7.03e-17, 0.57434, "BGG",
    )
    assert line == "CBEAM       2513       7    1699    1700-0.81862     0.0 0.57434     BGG"


def test_change_property_and_duplicate_with_new_pid(tmp_path):
    bdf_path = tmp_path / "STAGE_07_FinalValidation.bdf"
    _write_minimal_bdf(bdf_path)

    base = _nb.convert_bdf(bdf_path)
    elems = [e for e in base["elements"] if e.get("type") == "CBEAM"]
    assert len(elems) == 2, f"CBEAM 2개 기대, got {len(elems)}"
    e1 = elems[0]
    assert e1["propertyId"] == 10

    intents = [
        {"kind": "changeElementProperty", "params": {"elementId": e1["id"], "newPropertyId": 20}},
        {"kind": "duplicateElement", "params": {"sourceElementId": e1["id"], "newPropertyId": 20}},
    ]
    edited, summary = _nb.apply_edit_json(base, {"schemaVersion": "1.0", "intents": intents})
    assert summary["applied"] == 2
    assert e1["id"] in summary.get("changedProperties", [])
    clone_id = summary["addedElements"][0]
    assert clone_id != e1["id"]

    orig = bdf_path.read_text(encoding="utf-8")
    deck = _an._build_solvable_edited_bdf(orig, edited)
    lines = deck.splitlines()

    surv = [ln for ln in lines if ln[:8].strip().upper() == "CBEAM" and _eid(ln) == str(e1["id"])]
    clone = [ln for ln in lines if ln[:8].strip().upper() == "CBEAM" and _eid(ln) == str(clone_id)]
    assert len(surv) == 1 and _pid(surv[0]) == "20", f"생존 PID 패치 실패: {surv}"
    assert len(clone) == 1 and _pid(clone[0]) == "20", f"clone PID 패치 실패: {clone}"

    # EID 유일성(중복 없음)
    eids = [_eid(ln) for ln in lines if ln[:8].strip().upper() == "CBEAM"]
    assert len(eids) == len(set(eids)), f"중복 EID: {eids}"

    # solvable 필수 요소 보존
    assert any(l.strip().upper().startswith("SUBCASE") for l in lines)
    assert any(l[:8].strip().upper() in ("FORCE", "SPC") for l in lines)
    assert lines[-1].strip().upper() == "ENDDATA"


def test_invalid_new_pid_is_skipped(tmp_path):
    bdf_path = tmp_path / "STAGE_07_FinalValidation.bdf"
    _write_minimal_bdf(bdf_path)
    base = _nb.convert_bdf(bdf_path)
    e1 = next(e for e in base["elements"] if e.get("type") == "CBEAM")

    edited, summary = _nb.apply_edit_json(
        base, {"schemaVersion": "1.0",
               "intents": [{"kind": "changeElementProperty",
                            "params": {"elementId": e1["id"], "newPropertyId": 99999999}}]},
    )
    assert summary["applied"] == 0
    assert summary["skipped"] >= 1
    # 미존재 PID → 변경되지 않아야 함
    assert next(e for e in edited["elements"] if e["id"] == e1["id"])["propertyId"] == 10


def test_duplicate_no_pid_keeps_source_and_unique_eid(tmp_path):
    bdf_path = tmp_path / "STAGE_07_FinalValidation.bdf"
    _write_minimal_bdf(bdf_path)
    base = _nb.convert_bdf(bdf_path)
    e1 = next(e for e in base["elements"] if e.get("type") == "CBEAM")

    edited, summary = _nb.apply_edit_json(
        base, {"schemaVersion": "1.0",
               "intents": [{"kind": "duplicateElement", "params": {"sourceElementId": e1["id"]}}]},
    )
    clone_id = summary["addedElements"][0]
    clone = next(e for e in edited["elements"] if e["id"] == clone_id)
    assert clone["propertyId"] == 10           # newPropertyId 없으면 source PID 유지
    assert clone["reinforceOf"] == e1["id"]
    assert clone_id != e1["id"]


def test_connect_clears_dependent_spc(tmp_path):
    """노드 연결(addRigid + clearSpcNodes) 시 종속 노드의 SPC 가 spcs/deck 양쪽에서 제거된다."""
    bdf_path = tmp_path / "STAGE_07_FinalValidation.bdf"
    _write_minimal_bdf(bdf_path)
    base = _nb.convert_bdf(bdf_path)
    # 최소 deck 의 SPC 는 노드 1 에 걸림 → 노드 1 을 종속으로 연결하며 SPC 삭제
    assert any(_nb.as_int(s.get("nodeId")) == 1 for s in base.get("spcs", []))

    edited, summary = _nb.apply_edit_json(
        base, {"schemaVersion": "1.0",
               "intents": [{"kind": "addRigid",
                            "params": {"independentNode": 2, "dependentNodes": [1],
                                       "cm": "123456", "clearSpcNodes": [1]}}]},
    )
    assert summary["applied"] == 1
    assert 1 in (edited.get("clearedSpcNodes") or [])
    assert all(_nb.as_int(s.get("nodeId")) != 1 for s in edited.get("spcs", []))  # JSON 제거

    orig = bdf_path.read_text(encoding="utf-8")
    deck = _an._build_solvable_edited_bdf(orig, edited)
    lines = deck.splitlines()
    # deck: 노드 1 의 SPC 카드(G1=cols16:24) 제거 + RBE2 생성
    spc_node1 = [ln for ln in lines if ln[:8].strip().upper() == "SPC" and ln[16:24].strip() == "1"]
    assert not spc_node1, f"종속노드 SPC 미삭제: {spc_node1}"
    # RBE2 는 재생성 시 자유필드(콤마) 형식 — 카드명만 확인
    assert any(ln.strip().upper().startswith("RBE2") for ln in lines), "RBE2 미생성"


def test_connect_clears_both_node_spcs(tmp_path):
    """노드 연결 시 clearSpcNodes 의 두 노드(독립+종속) SPC 가 모두 제거된다."""
    bdf_path = tmp_path / "STAGE_07_FinalValidation.bdf"
    lines = [
        "SOL 101", "CEND", "SPC = 1", "LOAD = 1", "SUBCASE 1", "  LABEL = unit", "BEGIN BULK",
        _card("MAT1", 100, 210000.0, "", 0.3),
        _card("PBEAML", 10, 100, "", "BAR", 50.0, 30.0),
        _card("GRID", 1, "", 0.0, 0.0, 0.0),
        _card("GRID", 2, "", 1000.0, 0.0, 0.0),
        _card("CBEAM", 1, 10, 1, 2, 0.0, 0.0, 1.0),
        _card("FORCE", 1, 2, 0, 1000.0, 1.0, 0.0, 0.0),
        _card("SPC", 1, 1, 123456, 0.0),
        _card("SPC", 1, 2, 123456, 0.0),
        "ENDDATA",
    ]
    bdf_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    base = _nb.convert_bdf(bdf_path)
    assert {1, 2} <= {_nb.as_int(s.get("nodeId")) for s in base.get("spcs", [])}

    edited, summary = _nb.apply_edit_json(
        base, {"schemaVersion": "1.0",
               "intents": [{"kind": "addRigid",
                            "params": {"independentNode": 1, "dependentNodes": [2],
                                       "cm": "123456", "clearSpcNodes": [1, 2]}}]},
    )
    assert summary["applied"] == 1
    assert set(edited.get("clearedSpcNodes") or []) >= {1, 2}
    assert not edited.get("spcs"), f"두 노드 SPC 모두 제거 기대, 남음: {edited.get('spcs')}"

    deck = _an._build_solvable_edited_bdf(bdf_path.read_text(encoding="utf-8"), edited)
    spc_cards = [ln for ln in deck.splitlines() if ln[:8].strip().upper() == "SPC"]
    assert not spc_cards, f"deck SPC 카드 잔존: {spc_cards}"


def test_connect_centroid_creates_node_and_rbe2(tmp_path):
    """3개+ 노드 연결: 종속노드 중심에 새 GRID 생성→독립, N개 종속 RBE2 + 종속 SPC 삭제 + deck 신규 GRID 출력."""
    bdf_path = tmp_path / "STAGE_07_FinalValidation.bdf"
    lines = [
        "SOL 101", "CEND", "SPC = 1", "LOAD = 1", "SUBCASE 1", "  LABEL = unit", "BEGIN BULK",
        _card("MAT1", 100, 210000.0, "", 0.3),
        _card("PBEAML", 10, 100, "", "BAR", 50.0, 30.0),
        _card("GRID", 1, "", 0.0, 0.0, 0.0),
        _card("GRID", 2, "", 100.0, 0.0, 0.0),
        _card("GRID", 3, "", 100.0, 100.0, 0.0),
        _card("GRID", 4, "", 0.0, 100.0, 0.0),
        _card("CBEAM", 1, 10, 1, 2, 0.0, 0.0, 1.0),
        _card("SPC", 1, 1, 123456, 0.0),
        _card("SPC", 1, 3, 123456, 0.0),
        "ENDDATA",
    ]
    bdf_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    base = _nb.convert_bdf(bdf_path)
    n_before = len(base["nodes"])

    edited, summary = _nb.apply_edit_json(
        base, {"schemaVersion": "1.0",
               "intents": [{"kind": "addRigid",
                            "params": {"createIndependentAtCentroid": True,
                                       "dependentNodes": [1, 2, 3, 4],
                                       "cm": "123456", "clearSpcNodes": [1, 2, 3, 4]}}]},
    )
    assert summary["applied"] == 1
    assert len(edited["nodes"]) == n_before + 1          # 새 노드 1개
    new_node = max(edited["nodes"], key=lambda n: _nb.as_int(n["id"]))
    new_id = _nb.as_int(new_node["id"])
    assert abs(float(new_node["x"]) - 50.0) < 1e-6       # 중심 = (50,50,0)
    assert abs(float(new_node["y"]) - 50.0) < 1e-6
    rig = edited["rigids"][-1]
    assert _nb.as_int(rig["independentNode"]) == new_id
    assert {_nb.as_int(d) for d in rig["dependentNodes"]} == {1, 2, 3, 4}
    assert not edited.get("spcs")                         # 종속 4개 SPC 모두 제거(1,3 에 있던 것)

    deck = _an._build_solvable_edited_bdf(bdf_path.read_text(encoding="utf-8"), edited)
    out = deck.splitlines()
    new_grid = [ln for ln in out if ln.strip().upper().startswith("GRID") and str(new_id) in _fields(ln)]
    assert new_grid, f"신규 중심 GRID {new_id} 미출력"
    assert any(ln.strip().upper().startswith("RBE2") for ln in out), "RBE2 미생성"
    assert not [ln for ln in out if ln[:8].strip().upper() == "SPC"], "SPC 카드 잔존"


def test_connect_rejects_node_already_dependent(tmp_path):
    """이미 다른 RBE 의 종속노드인 노드를 또 종속으로 묶으면 SystemExit(2개 이상 RBE 종속 불가)."""
    bdf_path = tmp_path / "STAGE_07_FinalValidation.bdf"
    _write_minimal_bdf(bdf_path)
    base = _nb.convert_bdf(bdf_path)
    edited, _ = _nb.apply_edit_json(
        base, {"schemaVersion": "1.0",
               "intents": [{"kind": "addRigid", "params": {"independentNode": 2, "dependentNodes": [1]}}]},
    )
    with pytest.raises(SystemExit):
        _nb.apply_edit_json(
            edited, {"schemaVersion": "1.0",
                     "intents": [{"kind": "addRigid", "params": {"independentNode": 2, "dependentNodes": [1]}}]},
        )
