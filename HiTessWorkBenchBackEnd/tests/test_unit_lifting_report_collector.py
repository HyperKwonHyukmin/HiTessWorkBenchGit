"""collector — 실측 축소 fixture 로 데이터 모델 검증."""
import os
import shutil

import pytest

from app.services.unit_lifting_report.collector import collect, ReportOptions

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "unit_lifting_report")
STEM = "3496-35210-A508372_20260108_edit"


def _result_info(folder=FIX):
    return {
        "nastranResultJson": os.path.join(folder, f"{STEM}_lifting_nastranResult.json"),
        "stabilityJson": os.path.join(folder, f"{STEM}_stability.json"),
        "liftingMetaJson": os.path.join(folder, f"{STEM}_lifting_meta.json"),
        "bdf": os.path.join(folder, f"{STEM}.bdf"),
    }


@pytest.fixture()
def data():
    return collect(_result_info(), ReportOptions(author="A476854"))


def test_identity_from_filename_and_mode(data):
    assert data.identity.hull_no == "3496"
    assert data.identity.unit_no == "35210"
    assert data.identity.lifting_method == "Hydro Crane"
    assert data.identity.group_count == 3
    assert data.identity.wire_length_m == 8


def test_title_prefix_follows_project_kind():
    """표지·파일명 제목은 부모 프로젝트(projectKind)를 따른다."""
    base = _result_info()
    assert collect(base, ReportOptions()).identity.title_prefix == "Module Unit"
    sp = {**base, "projectKind": "SidePassage"}
    assert collect(sp, ReportOptions()).identity.title_prefix == "Side Passage"
    gmu = {**base, "projectKind": "GroupModuleUnit"}
    assert collect(gmu, ReportOptions()).identity.title_prefix == "Module Unit"


def test_title_prefix_falls_back_to_result_folder_name():
    """projectKind 기록 이전의 해석도 결과 폴더 이름으로 프로젝트를 알아낸다."""
    base = _result_info()
    legacy = {**base, "bdf": "C:/uc/20260101_A476854_SidePassage/model.bdf"}
    assert collect(legacy, ReportOptions()).identity.title_prefix == "Side Passage"


def test_model_and_geometry(data):
    assert data.model.total_mass_ton == pytest.approx(6.73985, abs=1e-4)
    assert data.model.node_count == 2555            # validation 카드 수(원본 규모)
    assert len(data.geometry.nodes) > 0
    assert any(s.kind == "L" for s in data.model.sections)


def test_edit_history_detects_deleted_elements(data):
    assert data.edits is not None
    assert data.edits.deleted_element_count == 3    # build_fixture 가 원본에 3개 더 넣음
    assert data.edits.deleted_rigid_count == 2
    assert data.edits.support_beams == []
    assert data.edits.removed_spc_cards == 0


def test_hoist_and_stability(data):
    assert data.hoist.auto_selected is True
    assert data.hoist.evaluated_count == 21352
    assert [g.group_id for g in data.hoist.groups] == [1, 2, 3]
    rows = data.stability.stage_rows
    assert [r.stage for r in rows] == [0, 1, 2, 3, 4, 5, 6, 7]
    assert rows[5].status == "warn"
    assert "6" in rows[5].key_metric          # conflictCount 6
    assert data.stability.overall_status == "warn"
    assert data.stability.tipping.evaluation_mode == "ConvexPolygon"
    assert data.stability.tipping.margin_mm == pytest.approx(159.24)
    assert data.stability.min_sling_angle_deg == pytest.approx(65.54)


def test_loads(data):
    assert data.loads.safety_factor == pytest.approx(1.2)
    assert data.loads.total_load_ton == pytest.approx(6.73985 * 1.2, abs=1e-3)
    assert data.loads.anchor_node_id == 2874
    assert data.loads.wire_area_mm2 == pytest.approx(1257.0)


def test_results_and_verdicts(data):
    r = data.results
    assert r.max_stress_mpa == pytest.approx(145.7619)
    assert r.max_stress_element_id == 3857
    assert r.max_displacement_mm == pytest.approx(23.5248, abs=1e-3)
    assert r.exceeding == []
    assert len(r.governing) == 30
    assert r.governing[0].element_id == 3857
    assert r.governing[0].section_label.startswith("PBEAML")
    assert len(r.wires) == 7
    w = next(x for x in r.wires if x.lug_node_id == 34)
    assert w.tension_ton == pytest.approx(10198.65 / 9800, abs=1e-3)
    assert w.angle_deg == pytest.approx(77.91)
    assert w.needs_jig is False
    assert len(r.hook_totals) == 3
    assert r.hook_check_error_pct == pytest.approx(
        (sum(h.vertical_ton for h in r.hook_totals) / data.loads.total_load_ton - 1) * 100, abs=1e-6)
    assert data.verdicts.structure == "OK"
    assert data.verdicts.stability == "warn"
    assert data.verdicts.jig_required is False


def test_missing_optional_json_yields_none_and_warning(tmp_path):
    for name in ("_lifting_nastranResult.json", "_stability.json", "_lifting_meta.json", "_edited.json"):
        shutil.copy(os.path.join(FIX, f"{STEM}{name}"), tmp_path / f"{STEM}{name}")
    d = collect(_result_info(str(tmp_path)), ReportOptions())
    assert d.hoist is None
    assert d.edits is None
    assert any("hoist_optimization" in w for w in d.warnings)
