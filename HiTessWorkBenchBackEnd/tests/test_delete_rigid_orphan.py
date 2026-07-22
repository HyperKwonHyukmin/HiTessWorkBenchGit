"""deleteRigid edit intent 의 orphan(고립) 노드 처리 + apply_edit_json 의 RBE 공유 정규화 검증.

Finding F-2: deleteRigid 로 RBE2 를 지우면, 그 RBE2 로만 붙어 있던(attachment-only) 종속/독립
노드가 어떤 element/RBE/mass 에도 참조되지 않는 6-DOF 자유 GRID(→ singular matrix, FATAL 9050)
로 남는다. 편집 결과에서 이런 진짜 고립 노드는 제거되어야 하며, 제거 개수를 summary 로 노출한다.

Finding F-4(Python side): normalize_rigid_node_sharing() 가 dead code 였다 → apply_edit_json 이
intents 적용 후 이를 호출해 "한 노드 = 한 RBE2" 불변식을 강제하는지(그리고 정상 단일 RBE 는
훼손하지 않는지) 확인.
"""
import re
from pathlib import Path

import pytest

# analysis import 가 nastran_bridge 디렉터리를 sys.path 에 추가 → 그 뒤 nastran_bridge import.
from app.routers import analysis as _an  # noqa: F401

try:
    import nastran_bridge as _nb
    _NB = True
except Exception:  # pragma: no cover - nastran_bridge 미가용 환경
    _NB = False

pytestmark = pytest.mark.skipif(not _NB, reason="nastran_bridge 모듈 미가용")


def _card(*fields):
    """8-col 고정 small-field 카드 한 줄 생성(각 필드 좌측정렬 8칸)."""
    return "".join(str(f).ljust(8)[:8] for f in fields)


def _node_ids(model):
    return {_nb.as_int(n.get("id")) for n in model.get("nodes", [])}


def _apply(base, intents):
    return _nb.apply_edit_json(base, {"schemaVersion": "1.0", "intents": intents})


def _base_with_orphan_dependent(tmp_path: Path):
    """RBE2 100: independent=1(빔 위), dependent=[3](오직 RBE2 로만 붙은 attachment-only 노드).

    노드 1·2 는 CBEAM 1 로 연결, 노드 3 은 어떤 element 에도 없음 → RBE2 삭제 시 3 은 진짜 고립.
    """
    bdf = tmp_path / "STAGE_07_FinalValidation.bdf"
    lines = [
        "SOL 101", "CEND", "SPC = 1", "LOAD = 1", "SUBCASE 1", "  LABEL = unit", "BEGIN BULK",
        _card("MAT1", 100, 210000.0, "", 0.3),
        _card("PBEAML", 10, 100, "", "BAR", 50.0, 30.0),
        _card("GRID", 1, "", 0.0, 0.0, 0.0),
        _card("GRID", 2, "", 1000.0, 0.0, 0.0),
        _card("GRID", 3, "", 2000.0, 0.0, 0.0),
        _card("CBEAM", 1, 10, 1, 2, 0.0, 0.0, 1.0),
        _card("RBE2", 100, 1, 123456, 3),
        _card("SPC", 1, 1, 123456, 0.0),
        "ENDDATA",
    ]
    bdf.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return _nb.convert_bdf(bdf)


def test_delete_rigid_removes_orphaned_dependent_node(tmp_path):
    """RBE2 삭제로 attachment-only 종속노드(3)가 고립 → 편집 결과에서 GRID 제거 + summary 카운트."""
    base = _base_with_orphan_dependent(tmp_path)
    assert 3 in _node_ids(base)
    rig = next(r for r in base["rigids"] if _nb.as_int(r["id"]) == 100)
    assert 3 in {_nb.as_int(d) for d in rig["dependentNodes"]}

    edited, summary = _apply(base, [{"kind": "deleteRigid", "params": {"rigidId": 100}}])

    # RBE2 는 삭제됨
    assert all(_nb.as_int(r["id"]) != 100 for r in edited.get("rigids", []))
    assert summary["deleted"]["rigids"] == 1
    # 고립된 종속노드 3 은 편집 결과에서 제거되어야 한다
    assert 3 not in _node_ids(edited), "고립 종속노드가 제거되지 않음"
    # 빔 위 독립노드 1·2 는 보존
    assert {1, 2} <= _node_ids(edited)
    # summary 에 제거 개수/목록 노출
    assert summary.get("removedOrphanNodeIds") == [3]
    assert summary["deleted"]["nodes"] >= 1
    # 최종 모델 진단에 orphan 이 남지 않음
    assert 3 not in (edited.get("healthMetrics", {}).get("issues", {}).get("orphanNodeIds", []))


def test_delete_rigid_keeps_dependent_node_still_attached_elsewhere(tmp_path):
    """무회귀: 종속노드가 다른 element 에도 붙어 있으면 RBE2 삭제 후에도 GRID 를 유지한다."""
    bdf = tmp_path / "STAGE_07_FinalValidation.bdf"
    lines = [
        "SOL 101", "CEND", "SPC = 1", "LOAD = 1", "SUBCASE 1", "  LABEL = unit", "BEGIN BULK",
        _card("MAT1", 100, 210000.0, "", 0.3),
        _card("PBEAML", 10, 100, "", "BAR", 50.0, 30.0),
        _card("GRID", 1, "", 0.0, 0.0, 0.0),
        _card("GRID", 2, "", 1000.0, 0.0, 0.0),
        _card("GRID", 3, "", 2000.0, 0.0, 0.0),
        _card("CBEAM", 1, 10, 1, 2, 0.0, 0.0, 1.0),
        _card("CBEAM", 2, 10, 2, 3, 0.0, 0.0, 1.0),   # 노드 3 이 CBEAM 2 로도 붙음
        _card("RBE2", 100, 1, 123456, 3),
        _card("SPC", 1, 1, 123456, 0.0),
        "ENDDATA",
    ]
    bdf.write_text("\n".join(lines) + "\n", encoding="utf-8")
    base = _nb.convert_bdf(bdf)

    edited, summary = _apply(base, [{"kind": "deleteRigid", "params": {"rigidId": 100}}])

    assert summary["deleted"]["rigids"] == 1
    # 노드 3 은 CBEAM 2 로 여전히 참조 → 제거 금지
    assert {1, 2, 3} <= _node_ids(edited)
    assert not summary.get("removedOrphanNodeIds")


def test_delete_rigid_removes_orphaned_independent_hub_node(tmp_path):
    """독립(hub) 노드가 element/mass 없이 RBE2 로만 존재하면, RBE2 삭제 시 hub 도 고립 → 제거."""
    bdf = tmp_path / "STAGE_07_FinalValidation.bdf"
    lines = [
        "SOL 101", "CEND", "SPC = 1", "LOAD = 1", "SUBCASE 1", "  LABEL = unit", "BEGIN BULK",
        _card("MAT1", 100, 210000.0, "", 0.3),
        _card("PBEAML", 10, 100, "", "BAR", 50.0, 30.0),
        _card("GRID", 1, "", 0.0, 0.0, 0.0),
        _card("GRID", 2, "", 1000.0, 0.0, 0.0),
        _card("GRID", 9, "", 500.0, 500.0, 0.0),      # 가상 hub — 어떤 element/mass 에도 없음
        _card("CBEAM", 1, 10, 1, 2, 0.0, 0.0, 1.0),
        _card("RBE2", 100, 9, 123456, 1, 2),          # hub=9, 종속=1,2 (둘 다 빔 위)
        _card("SPC", 1, 1, 123456, 0.0),
        "ENDDATA",
    ]
    bdf.write_text("\n".join(lines) + "\n", encoding="utf-8")
    base = _nb.convert_bdf(bdf)
    assert 9 in _node_ids(base)

    edited, summary = _apply(base, [{"kind": "deleteRigid", "params": {"rigidId": 100}}])

    # hub 9 는 고립 → 제거, 빔 위 종속 1·2 는 유지
    assert 9 not in _node_ids(edited)
    assert {1, 2} <= _node_ids(edited)
    assert summary.get("removedOrphanNodeIds") == [9]


def test_apply_edit_normalizes_shared_node_rbe2(tmp_path):
    """F-4: 서로 노드를 공유하는 두 RBE2 는 apply_edit_json(intents 무관) 에서 하나로 병합된다."""
    bdf = tmp_path / "STAGE_07_FinalValidation.bdf"
    lines = [
        "SOL 101", "CEND", "SPC = 1", "LOAD = 1", "SUBCASE 1", "  LABEL = unit", "BEGIN BULK",
        _card("MAT1", 100, 210000.0, "", 0.3),
        _card("PBEAML", 10, 100, "", "BAR", 50.0, 30.0),
        _card("GRID", 1, "", 0.0, 0.0, 0.0),
        _card("GRID", 2, "", 1000.0, 0.0, 0.0),
        _card("GRID", 3, "", 2000.0, 0.0, 0.0),
        _card("CBEAM", 1, 10, 1, 2, 0.0, 0.0, 1.0),
        _card("CBEAM", 2, 10, 2, 3, 0.0, 0.0, 1.0),
        _card("RBE2", 100, 1, 123456, 2),   # 독립=1, 종속=2
        _card("RBE2", 200, 3, 123456, 2),   # 독립=3, 종속=2  ← 노드 2 공유(불법)
        "ENDDATA",
    ]
    bdf.write_text("\n".join(lines) + "\n", encoding="utf-8")
    base = _nb.convert_bdf(bdf)
    assert len(base["rigids"]) == 2

    edited, _summary = _apply(base, [])   # intents 없이도 정규화 적용

    assert len(edited["rigids"]) == 1, "노드 공유 RBE2 가 병합되지 않음"


def test_apply_edit_does_not_corrupt_single_valid_rbe2(tmp_path):
    """F-4 무회귀: 노드를 공유하지 않는 정상 단일 RBE2 는 정규화가 훼손하지 않는다."""
    base = _base_with_orphan_dependent(tmp_path)   # RBE2 100: indep=1, dep=[3]
    before = next(r for r in base["rigids"] if _nb.as_int(r["id"]) == 100)
    indep_before = _nb.as_int(before["independentNode"])
    deps_before = {_nb.as_int(d) for d in before["dependentNodes"]}

    edited, _summary = _apply(base, [])   # deleteRigid 없음 → 노드 제거도 없어야

    assert len(edited["rigids"]) == 1
    after = edited["rigids"][0]
    assert _nb.as_int(after["independentNode"]) == indep_before
    assert {_nb.as_int(d) for d in after["dependentNodes"]} == deps_before
    # deleteRigid 를 안 했으므로 어떤 노드도 제거되지 않음
    assert {1, 2, 3} <= _node_ids(edited)
