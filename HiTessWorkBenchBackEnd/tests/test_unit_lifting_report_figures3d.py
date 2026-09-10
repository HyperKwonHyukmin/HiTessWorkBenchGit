"""3D 솔리드 캡처 — 결과 레포트 자리 비율·권상 장구 수집·와이어 절단·라벨 경계 검증."""
import io
import os

import numpy as np
import pytest
from PIL import Image

from app.services.unit_lifting_report.collector import collect, ReportOptions
from app.services.unit_lifting_report import figures3d, solid3d as S3

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "unit_lifting_report")
STEM = "3496-35210-A508372_20260108_edit"
SLOT_RATIO = S3.SLOT_W_IN / S3.SLOT_H_IN


@pytest.fixture(scope="module")
def data():
    return collect({
        "nastranResultJson": os.path.join(FIX, f"{STEM}_lifting_nastranResult.json"),
        "stabilityJson": os.path.join(FIX, f"{STEM}_stability.json"),
        "liftingMetaJson": os.path.join(FIX, f"{STEM}_lifting_meta.json"),
        "bdf": os.path.join(FIX, f"{STEM}.bdf"),
    }, ReportOptions())


def _size(png: bytes):
    return Image.open(io.BytesIO(png)).size


def test_result_figures_match_template_slot_ratio(data):
    """서식의 캡처 자리는 TwoCellAnchor 라 그림을 자리 비율로 늘린다. 비율이 다르면 왜곡된다."""
    figs, errors = figures3d.render_result_figures(data)
    assert errors == {}
    assert set(figs) == {"modelTop", "modelHome", "displacement", "stress"}
    for key, png in figs.items():
        w, h = _size(png)
        assert abs(w / h - SLOT_RATIO) < 0.01, (key, w, h)
        assert w >= 1200, key                                   # 200dpi 급 해상도


def test_rig_collects_wires_apexes_and_lugs(data):
    rig = figures3d._Rig(data)
    assert len(rig.apexes) == 3
    assert len(rig.wires) == 7                              # G1 2 + G2 2 + G3 3 (fixture)
    gids = {g for g, *_ in rig.wires}
    assert gids == {1, 2, 3}
    assert all(apex is not None and ang is not None for _g, _l, _lug, apex, ang in rig.wires)


def test_rig_clip_shortens_wires_and_drops_hooks(data):
    rig = figures3d._Rig(data)
    size = 100.0
    full, _per, _n = rig.meshes(size)
    clip_z = rig.clip_height(data)
    clipped, _per2, _n2 = rig.meshes(size, clip_z=clip_z)
    assert len(full) == 3 and len(clipped) == 2              # 와이어·러그·훅 → 와이어·러그
    top_full = S3.concat(*full).bounds[1][2]
    top_clip = S3.concat(*clipped).bounds[1][2]
    assert top_clip < top_full
    assert top_clip <= clip_z + size


def test_fit_aspect_letterboxes_without_scaling():
    im = Image.new("RGB", (300, 300), (10, 20, 30))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    out = Image.open(io.BytesIO(S3.fit_aspect(buf.getvalue(), 2.0)))
    assert out.size == (600, 300)
    assert out.getpixel((0, 0)) == (255, 255, 255)          # 덧댄 여백은 흰색
    assert out.getpixel((300, 150)) == (10, 20, 30)         # 원본은 가운데 그대로


def test_wire_and_diamond_meshes_have_expected_faces():
    w = S3.wire_mesh([((0, 0, 0), (0, 0, 1000))], radius=5.0, start_id=-1)
    assert len(w.quads) == 6 and set(w.elem_ids.tolist()) == {-1}
    d = S3.diamond_mesh([(0, 0, 0), (10, 0, 0)], size=4.0, start_id=-5)
    assert len(d.quads) == 16 and set(d.elem_ids.tolist()) == {-5, -6}
    assert np.allclose(d.bounds[0], (-2, -2, -2)) and np.allclose(d.bounds[1], (12, 2, 2))


def test_hoist_figure_labels_stay_inside_image(data):
    """라벨 후보가 그림 밖으로 나가면 잘린다. 네 변 가장자리 띠가 모두 흰색이어야 한다."""
    png = figures3d.render_hoist_model(data, "top")
    im = Image.open(io.BytesIO(png)).convert("L")
    a = np.asarray(im)
    assert a[:2, :].min() == 255 and a[-2:, :].min() == 255
    assert a[:, :2].min() == 255 and a[:, -2:].min() == 255


def test_tube_section_uses_diameter_and_round_profile():
    """TUBE·ROD 의 DIM1 은 반지름이다 — 지름(2·DIM1)으로, 원형으로 세워야 배관이 배관으로 보인다."""
    class S:
        def __init__(self, kind, dims):
            self.kind, self.dims = kind, dims

    assert S3.section_profile(S("Tube", [177.8, 173])) == (355.6, 355.6, True)
    assert S3.section_profile(S("ROD", [8])) == (16.0, 16.0, True)
    h, w, round_ = S3.section_profile(S("L", [75, 75, 6, 6]))
    assert (h, w, round_) == (75, 75, False)
    assert S3.section_profile(None)[2] is False


def test_pipe_elements_are_red_and_others_untouched(data):
    """배관(PID ≥ 101)만 붉은색. 구조·가서포트는 강재색(회색) 그대로."""
    per = figures3d._pipe_colors(data)
    pids = {pid for eid, _n1, _n2, pid, _r in data.geometry.elements}
    assert min(p for p in pids if p >= figures3d.PIPE_PID_MIN) >= 101
    assert per and set(per.values()) == {figures3d.PIPE_RGB}
    pid_of = {eid: pid for eid, _n1, _n2, pid, _r in data.geometry.elements}
    assert all(pid_of[eid] >= figures3d.PIPE_PID_MIN for eid in per)
    assert any(pid_of[eid] < figures3d.PIPE_PID_MIN for eid in pid_of)      # 회색으로 남는 부재가 있다


def test_hoist_rig_uses_2d_circles_instead_of_solid_markers(data):
    """체결 위치는 가득 찬 원, 훅은 빈 원 — 2D 도면과 같은 기호(솔리드 큐브·다이아 대신)."""
    rig = figures3d._Rig(data)
    parts, _per, _nid = rig.meshes(100.0, solid_markers=False)
    assert len(parts) == 1                                   # 와이어만 솔리드
    pts = rig.points2d()
    assert len(pts) == len(rig.wires) + len(rig.apexes)
    lugs, hooks = pts[:len(rig.wires)], pts[len(rig.wires):]
    assert all(s["mfc"] != "white" and s["marker"] == "o" for _p, s in lugs)
    assert all(s["mfc"] == "white" and s["marker"] == "o" for _p, s in hooks)
