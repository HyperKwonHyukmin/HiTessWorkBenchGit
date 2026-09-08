import os

import pytest

from app.services.unit_lifting_report.collector import collect, ReportOptions
from app.services.unit_lifting_report import figures

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "unit_lifting_report")
STEM = "3496-35210-A508372_20260108_edit"
PNG = b"\x89PNG\r\n\x1a\n"


@pytest.fixture(scope="module")
def data():
    return collect({
        "nastranResultJson": os.path.join(FIX, f"{STEM}_lifting_nastranResult.json"),
        "stabilityJson": os.path.join(FIX, f"{STEM}_stability.json"),
        "liftingMetaJson": os.path.join(FIX, f"{STEM}_lifting_meta.json"),
        "bdf": os.path.join(FIX, f"{STEM}.bdf"),
    }, ReportOptions())


def test_render_all_returns_expected_keys(data):
    figs = figures.render_all(data)
    expected = {"model_plan", "model_side", "model_front", "model_iso", "hoist_plan", "hoist_side",
                "deformed_iso", "stress_plan", "stress_iso", "utilization_hist"}
    assert expected <= set(figs)
    assert "support_plan" not in figs                      # fixture 에는 가서포트 없음
    for key in expected:
        assert figs[key][:8] == PNG, key
        assert len(figs[key]) > 2000, key


def test_project_views_are_right_handed():
    assert figures.project((1000, 2000, 3000), "plan") == (1000, 2000)
    assert figures.project((1000, 2000, 3000), "side") == (1000, 3000)
    assert figures.project((1000, 2000, 3000), "front") == (2000, 3000)
    ix, iy = figures.project((1000, 0, 0), "iso")
    assert ix > 0 and iy < 0                               # +X 는 오른쪽 아래로


def test_place_label_avoids_overlap():
    occupied = []
    a = figures.place_label(occupied, 100, 100, 40, 12)
    b = figures.place_label(occupied, 100, 100, 40, 12)
    assert a != b
    assert len(occupied) == 2


def test_render_failure_is_isolated(data, monkeypatch):
    def boom(*_):
        raise RuntimeError("boom")
    monkeypatch.setattr(figures, "_render_histogram", boom)
    figs, errors = figures.render_all_safe(data)
    assert "utilization_hist" not in figs
    assert errors["utilization_hist"].startswith("RuntimeError")


def test_support_figures_render_when_support_beams_exist(data):
    """가서포트가 있는 모델은 support_plan/iso 가 추가로 나온다(fixture 에는 없어 합성해서 확인)."""
    from app.services.unit_lifting_report.collector import EditInfo, SupportBeam

    node_ids = list(data.geometry.nodes)[:4]
    data.edits = EditInfo(
        deleted_element_count=0, deleted_rigid_count=0, deleted_node_count=0,
        support_beams=[SupportBeam(90001, node_ids[0], node_ids[1], 900, 1234.5, [100, 100, 10, 10]),
                       SupportBeam(90002, node_ids[2], node_ids[3], 900, 2345.6, [100, 100, 10, 10])],
        removed_spc_cards=0, removed_suport_cards=0, trace=[])
    try:
        figs, errors = figures.render_all_safe(data)
        assert errors == {}
        assert figs["support_plan"][:8] == PNG
        assert figs["support_iso"][:8] == PNG
    finally:
        data.edits = None
