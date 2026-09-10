"""부재를 단면 치수대로 세운 3D 솔리드 렌더 (matplotlib Agg → PNG bytes).

사내 서식(ver02) 설명서의 Hi-TESS-BEAM 캡처처럼 각 부재를 '단면을 가진 입체'로 그린다.
선도(2D `figures.py`)와 달리 부재 굵기·가림·음영이 보여 형상 파악이 쉽다.

한 부재 = 시작·끝 절점을 잇는 각기둥 6면. 로컬 축은 CBEAM orientation 벡터로 잡는다.
2,500 부재 ≈ 15,000 면이고 렌더 1장에 약 1~2초다(실측).

화면 구성(`render`)은 2D 도면(`figures.py`)과 같은 문법을 쓴다:
  좌상단 제목·부제 / 우측 정보 띠(범례·컬러바·좌표축) / 마커에는 겹침을 피한 리더선 라벨.
마커·와이어는 scatter/line 이 아니라 **솔리드**로 만들어 부재와 같은 깊이 정렬에 참여시키고,
라벨·다각형은 3D 좌표를 화면 픽셀로 투영해 **2D 로 맨 위에** 그린다(부재에 가리지 않게).
"""
from __future__ import annotations

import io
import math
from typing import Iterable, Optional, Sequence

import numpy as np

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import colors as mcolors  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from mpl_toolkits.mplot3d import proj3d  # noqa: E402
from mpl_toolkits.mplot3d.art3d import Poly3DCollection  # noqa: E402

plt.rcParams["font.family"] = ["Malgun Gothic", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

# 색 — 구조물은 중립 강재색으로 두어 그룹색(권상)·결과색(변위/응력)이 도드라지게 한다.
STEEL_RGB = (0.60, 0.65, 0.70)
STEEL_RED_RGB = (0.75, 0.20, 0.17)   # 사내 서식 Hi-TESS-BEAM 캡처의 붉은 강재색(필요 시 선택)
COG_COLOR = "#111827"                # 그룹색(2번이 붉은색)과 겹치지 않는 진회색
TEXT_DARK = "#18242F"
TEXT_MUTED = "#5B6975"
AXIS_COLORS = {"X": "#D73A49", "Y": "#138A5B", "Z": "#1769AA"}
DEFAULT_HW = 100.0                   # 단면 정보를 못 찾은 부재의 기본 한 변(mm)
MIN_HW = 30.0                        # 너무 얇으면 화면에서 사라져 최소 굵기를 준다
TUBE_SIDES = 8                       # 원형 단면(배관) 근사 면 수 — 8이면 둥글게 보이면서 면 수가 각기둥과 비슷하다
TUBE_CAPS = False                    # 마구리 면 — 배관은 서로 이어져 끝이 거의 안 보이는데 면 수만 3배가 된다
LIGHT = np.array([0.40, -0.60, 0.70])
LIGHT = LIGHT / np.linalg.norm(LIGHT)
FACES = ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7))
# (elev, azim) — top 은 정확히 90° 면 방위각이 무의미해져 89.9° 를 쓴다
VIEWS = {"top": (89.9, -90.0), "home": (24.0, -55.0), "iso": (24.0, -55.0), "side": (0.0, -90.0)}

# 사내 서식의 캡처 자리는 1243×719px (비율 1.73). 같은 비율로 만들어야 자리를 꽉 채운다.
SLOT_W_IN, SLOT_H_IN = 7.2, 4.16
DPI = 200
PANEL_FRAC = 0.165                   # 우측 정보 띠(범례·컬러바·좌표축) 폭 비율
TITLE_FRAC = 0.10                    # 상단 제목 띠 높이 비율


def section_profile(section) -> tuple[float, float, bool]:
    """PBEAML 단면 → (높이, 폭, 원형 여부) mm. 종류를 모르면 치수 최대값을 정사각으로 쓴다.

    ⚠ TUBE·ROD 의 DIM1 은 NASTRAN 표준대로 **반지름**이라 지름 = 2·DIM1 이다
    (Studio `computeCrossSectionAreaMm2` 와 같은 해석 — Hypermesh 질량 99% 일치로 검증된 규약).
    원형 단면은 각기둥이 아니라 둥근 기둥으로 세워야 배관이 배관으로 보인다.
    """
    if section is None:
        return (DEFAULT_HW, DEFAULT_HW, False)
    kind = str(getattr(section, "kind", "") or "").upper()
    dims = [float(x) for x in (getattr(section, "dims", None) or []) if isinstance(x, (int, float))]
    try:
        if kind == "L":
            return (dims[1], dims[0], False)
        if kind == "H":                      # DIM1=웹 순높이, DIM2=2·tf, DIM3=플랜지 폭
            return (dims[0] + dims[1], dims[2], False)
        if kind in ("I", "T", "CHAN"):
            return (dims[0], dims[1], False)
        if kind == "BAR":
            return (dims[1], dims[0], False)
        if kind in ("TUBE", "TUBE2", "ROD"):
            d = 2 * dims[0]
            return (d, d, True)
    except IndexError:
        pass
    m = max(dims) if dims else DEFAULT_HW
    return (m, m, False)


class SolidMesh:
    """면 묶음. quads (N,4,3) · shades (N,) · elem_ids (N,)."""

    __slots__ = ("quads", "shades", "elem_ids", "bounds")

    def __init__(self, quads, shades, elem_ids):
        self.quads = quads
        self.shades = shades
        self.elem_ids = elem_ids
        if len(quads):
            flat = quads.reshape(-1, 3)
            self.bounds = (flat.min(axis=0), flat.max(axis=0))
        else:
            self.bounds = (np.zeros(3), np.ones(3))


def _empty() -> SolidMesh:
    return SolidMesh(np.zeros((0, 4, 3)), np.zeros(0), np.zeros(0, dtype=int))


def _pack(quads, shades, ids) -> SolidMesh:
    if not quads:
        return _empty()
    return SolidMesh(np.asarray(quads, dtype=float), np.asarray(shades, dtype=float), np.asarray(ids, dtype=int))


def _prism(pa, pb, h2: float, w2: float, v_ref=(0.0, 0.0, 1.0)):
    """pa→pb 를 축으로 하는 각기둥의 6면과 음영. 축과 v_ref 가 평행하면 기준 벡터를 바꾼다."""
    pa, pb = np.asarray(pa, dtype=float), np.asarray(pb, dtype=float)
    axis = pb - pa
    length = float(np.linalg.norm(axis))
    if length < 1e-6:
        return [], []
    axis /= length
    v = np.asarray(v_ref, dtype=float)
    if np.linalg.norm(np.cross(axis, v)) < 1e-6:
        v = np.array([1.0, 0.0, 0.0]) if abs(axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    n_w = np.cross(axis, v)
    n_w /= np.linalg.norm(n_w)
    n_h = np.cross(axis, n_w)
    corners = [pa + n_w * w2 + n_h * h2, pa - n_w * w2 + n_h * h2,
               pa - n_w * w2 - n_h * h2, pa + n_w * w2 - n_h * h2,
               pb + n_w * w2 + n_h * h2, pb - n_w * w2 + n_h * h2,
               pb - n_w * w2 - n_h * h2, pb + n_w * w2 - n_h * h2]
    return _faces(corners, FACES)


def _tube(pa, pb, r: float, v_ref=(0.0, 0.0, 1.0), sides: int = TUBE_SIDES, caps: bool = TUBE_CAPS):
    """pa→pb 를 축으로 하는 둥근 기둥(정 sides 각기둥 근사) + 양 끝 마구리."""
    pa, pb = np.asarray(pa, dtype=float), np.asarray(pb, dtype=float)
    axis = pb - pa
    length = float(np.linalg.norm(axis))
    if length < 1e-6:
        return [], []
    axis /= length
    v = np.asarray(v_ref, dtype=float)
    if np.linalg.norm(np.cross(axis, v)) < 1e-6:
        v = np.array([1.0, 0.0, 0.0]) if abs(axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    n_w = np.cross(axis, v)
    n_w /= np.linalg.norm(n_w)
    n_h = np.cross(axis, n_w)
    ring = [n_w * (r * math.cos(t)) + n_h * (r * math.sin(t))
            for t in (2 * math.pi * k / sides for k in range(sides))]
    corners = [pa + d for d in ring] + [pb + d for d in ring] + [pa, pb]
    faces = [(i, (i + 1) % sides, sides + (i + 1) % sides, sides + i) for i in range(sides)]
    if caps:                                                 # 마구리 — 삼각형은 끝점을 반복해 사각 배열에 맞춘다
        c0, c1 = 2 * sides, 2 * sides + 1
        for i in range(sides):
            j = (i + 1) % sides
            faces.append((c0, j, i, i))
            faces.append((c1, sides + i, sides + j, sides + j))
    return _faces(corners, faces)


def _faces(corners, faces, ambient: float = 0.34):
    quads, shades = [], []
    for face in faces:
        q = [corners[i] for i in face]
        nrm = np.cross(q[1] - q[0], q[2] - q[0])
        nl = float(np.linalg.norm(nrm))
        if nl < 1e-9:
            continue
        quads.append(q)
        shades.append(ambient + (1.0 - ambient) * abs(float(np.dot(nrm / nl, LIGHT))))
    return quads, shades


def build_mesh(geometry, sections: Sequence, node_pos: Optional[dict] = None,
               include: Optional[set] = None) -> SolidMesh:
    """부재를 각기둥으로 펼친다.

    node_pos 를 주면 그 좌표(변형 형상 등)를 쓰고, 없으면 원형 좌표를 쓴다.
    include 가 주어지면 그 요소 id 만 그린다.
    """
    nodes = node_pos if node_pos is not None else geometry.nodes
    sec_by_pid = {s.pid: s for s in sections}
    quads, shades, ids = [], [], []
    for eid, n1, n2, pid, _remark in geometry.elements:
        if include is not None and eid not in include:
            continue
        a, b = nodes.get(n1), nodes.get(n2)
        if a is None or b is None:
            continue
        h, w, round_section = section_profile(sec_by_pid.get(pid))
        h, w = max(h, MIN_HW), max(w, MIN_HW)
        orient = geometry.orientations.get(eid, (0.0, 0.0, 1.0))
        q, s = _tube(a, b, max(h, w) / 2, orient) if round_section else _prism(a, b, h / 2, w / 2, orient)
        quads += q
        shades += s
        ids += [eid] * len(q)
    return _pack(quads, shades, ids)


def wire_mesh(segments: Sequence, radius: float, start_id: int = -1) -> SolidMesh:
    """와이어(러그→훅) 를 가는 사각기둥으로. 선(plot)이 아니라 솔리드라야 부재와 깊이 정렬이 맞는다.
    segments: ((x,y,z) 시작, (x,y,z) 끝) 목록. elem_ids 는 start_id, start_id-1, ... 로 매긴다."""
    quads, shades, ids = [], [], []
    for k, (p0, p1) in enumerate(segments):
        q, s = _prism(p0, p1, radius, radius)
        quads += q
        shades += [0.55 + 0.45 * (x - 0.34) / 0.66 for x in s]     # 와이어는 밝게(그늘이 덜 지게)
        ids += [start_id - k] * len(q)
    return _pack(quads, shades, ids)


def marker_mesh(points: Sequence, size: float, start_id: int = -1) -> SolidMesh:
    """정육면체 마커 묶음(러그 위치 등). elem_ids 는 음수로 매겨 per_element 색 지정에 쓴다."""
    quads, shades, ids = [], [], []
    h = size / 2
    for k, p in enumerate(points):
        c = np.asarray(p, dtype=float)
        corners = [c + np.array(d) * h for d in
                   ((1, 1, 1), (-1, 1, 1), (-1, -1, 1), (1, -1, 1),
                    (1, 1, -1), (-1, 1, -1), (-1, -1, -1), (1, -1, -1))]
        q, s = _faces(corners, FACES, ambient=0.55)
        quads += q
        shades += s
        ids += [start_id - k] * len(q)
    return _pack(quads, shades, ids)


def diamond_mesh(points: Sequence, size: float, start_id: int = -1) -> SolidMesh:
    """팔면체(다이아몬드) 마커 — 훅·COG 처럼 정육면체(러그)와 구분해야 하는 점에 쓴다."""
    quads, shades, ids = [], [], []
    h = size / 2
    for k, p in enumerate(points):
        c = np.asarray(p, dtype=float)
        top, bot = c + (0, 0, h), c - (0, 0, h)
        ring = [c + np.array(d) * h for d in ((1, 0, 0), (0, 1, 0), (-1, 0, 0), (0, -1, 0))]
        for i in range(4):
            a, b = ring[i], ring[(i + 1) % 4]
            for tri in ((top, a, b), (bot, b, a)):
                q = [tri[0], tri[1], tri[2], tri[2]]              # 삼각형은 마지막 꼭짓점을 반복해 사각 배열에 맞춘다
                nrm = np.cross(q[1] - q[0], q[2] - q[0])
                nl = float(np.linalg.norm(nrm))
                if nl < 1e-9:
                    continue
                quads.append(q)
                shades.append(0.55 + 0.45 * abs(float(np.dot(nrm / nl, LIGHT))))
                ids.append(start_id - k)
    return _pack(quads, shades, ids)


def pin_mesh(points: Sequence, top_z: float, size: float, start_id: int = -1) -> SolidMesh:
    """지시 핀(가는 기둥 + 머리 큐브). 러그가 부재에 가릴 때 위치를 끌어올려 보여 준다."""
    quads, shades, ids = [], [], []
    r = size * 0.18
    for k, p in enumerate(points):
        c = np.asarray(p, dtype=float)
        head = np.array([c[0], c[1], max(top_z, c[2] + size)])
        q, s = _prism(c, head, r, r)
        quads += q
        shades += s
        ids += [start_id - k] * len(q)
        m = marker_mesh([head], size)
        quads += list(m.quads)
        shades += list(m.shades)
        ids += [start_id - k] * len(m.quads)
    return _pack(quads, shades, ids)


def concat(*meshes: SolidMesh) -> SolidMesh:
    """여러 메시를 합친다(부재 + 마커 + 와이어)."""
    parts = [m for m in meshes if len(m.quads)]
    if not parts:
        return _empty()
    return SolidMesh(np.concatenate([m.quads for m in parts]),
                     np.concatenate([m.shades for m in parts]),
                     np.concatenate([m.elem_ids for m in parts]))


def face_colors(mesh: SolidMesh, base_rgb=STEEL_RGB, per_element: Optional[dict] = None,
                missing_rgb=(0.565, 0.643, 0.690)) -> np.ndarray:
    """면 색 = (부재 색) × (음영). per_element 는 요소 id → (r,g,b) 0~1."""
    if per_element:
        base = np.array([per_element.get(int(e), missing_rgb) for e in mesh.elem_ids], dtype=float)
    else:
        base = np.tile(np.asarray(base_rgb, dtype=float), (len(mesh.elem_ids), 1))
    return np.clip(base * mesh.shades[:, None], 0.0, 1.0)


# ── 렌더 ─────────────────────────────────────────────────────────────────────
def render(mesh: SolidMesh, colors: np.ndarray, view: str = "home", *,
           title: str = "", subtitle: str = "", labels: Iterable = (), overlays: Iterable = (),
           legend: Sequence = (), colorbar=None, extra_points: Iterable = (), triad: bool = True,
           width_in: float = SLOT_W_IN, height_in: float = SLOT_H_IN, dpi: int = DPI,
           fill: float = 0.90, markers: Iterable = (), points2d: Iterable = ()) -> bytes:
    """솔리드 메시를 지정 시점에서 렌더해 PNG 바이트로 돌려준다.

    labels:   (xyz, text, color) — 겹침을 피해 배치한 리더선 라벨(항상 맨 위).
    overlays: (xyz 목록, style dict) — 투영해 2D 선으로 그린다(지지 다각형 등).
    points2d: (xyz, style dict) — 투영해 2D 마커로 그린다(체결 위치 ●·훅 ○).
    legend:   matplotlib 핸들 목록 → 우측 띠 상단 범례.
    colorbar: (cmap, norm, label[, ticks]) → 우측 띠 컬러바.
    extra_points: 화면에 반드시 들어와야 하는 점(훅 정점 등) — 뷰 범위 계산에 포함.
    markers:  구버전 호환 — (xyz, color, text) 형식을 labels 로 바꿔 받는다.
    결과 PNG 는 흰 여백을 잘라낸 뒤 width_in:height_in 비율로 다시 맞춘다(서식 자리 왜곡 방지).
    """
    from .figures import place_label       # 지연 import — figures 가 figures3d 를 지연 참조한다

    labels = list(labels) + [(m[0], m[2], m[1]) for m in markers]
    fig = plt.figure(figsize=(width_in, height_in), dpi=dpi)
    fig.patch.set_facecolor("white")
    ax = fig.add_subplot(projection="3d", proj_type="ortho")
    ax.set_facecolor("white")
    coll = None
    if len(mesh.quads):
        coll = Poly3DCollection(mesh.quads, facecolors=colors,
                                edgecolors=np.clip(colors * 0.55, 0, 1), linewidths=0.18)
        # 배치를 잡는 동안(줌 맞춤·범례·좌표축) 은 숨겨 둔다. 이 draw 들은 투영 행렬만 있으면 되는데
        # 3만 면을 매번 깊이 정렬해 그리면 그림 1장이 3.3s → 1.2s 차이로 벌어진다(실측).
        coll.set_visible(False)
        ax.add_collection3d(coll)

    # 뷰 범위: 메시 + 라벨 위치 + 추가 점
    pts = [np.array([mesh.bounds[0], mesh.bounds[1]])]
    pts += [np.asarray(p, dtype=float)[None, :] for p in extra_points]
    pts += [np.asarray(l[0], dtype=float)[None, :] for l in labels]
    allp = np.vstack(pts)
    mn, mx = allp.min(axis=0), allp.max(axis=0)
    size = np.maximum(mx - mn, 1.0)
    ax.set_xlim(mn[0], mx[0])
    ax.set_ylim(mn[1], mx[1])
    ax.set_zlim(mn[2], mx[2])
    elev, azim = VIEWS.get(view, VIEWS["home"])
    ax.view_init(elev=elev, azim=azim)
    ax.set_axis_off()
    has_panel = bool(legend) or colorbar is not None or triad
    panel_x = 1.0 - PANEL_FRAC if has_panel else 1.0
    top_y = 1.0 - TITLE_FRAC if (title or subtitle) else 1.0
    # Axes3D 는 주어진 영역 안에서 항상 '정사각형' 으로 줄어든다(apply_aspect). 가로로 넓은 자리를
    # 다 쓰려면 축 자체를 가시 영역(panel_x × top_y)보다 큰 정사각형으로 놓고, 그 중심을 가시 영역
    # 중심에 맞춘 뒤 가시 영역 기준으로 확대율을 정해야 한다(축 밖은 그냥 잘린다).
    W, H = fig.get_size_inches() * fig.dpi
    sq_w = panel_x
    sq_h = sq_w * W / H
    ax.set_position([0.0, (top_y - sq_h) / 2.0, sq_w, sq_h])
    vis_w, vis_h = panel_x * W, top_y * H

    # 투영 배율은 zoom 에 비례하므로 '그려 보고 재서 보정' 을 돌려 가시 영역을 fill 만큼 채운다.
    aspect = tuple(size / size.max())
    corners = np.array([[x, y, z] for x in (mn[0], mx[0]) for y in (mn[1], mx[1]) for z in (mn[2], mx[2])])
    zoom = 1.0
    for _ in range(3):
        ax.set_box_aspect(aspect, zoom=zoom)
        fig.canvas.draw()
        px = _to_pixels(ax, corners)
        bw, bh = max(float(np.ptp(px[:, 0])), 1.0), max(float(np.ptp(px[:, 1])), 1.0)
        factor = min(vis_w / bw, vis_h / bh) * fill
        zoom *= factor
        if abs(factor - 1.0) < 0.02:
            break
    ax.set_box_aspect(aspect, zoom=zoom)

    # 제목
    if title:
        fig.text(0.012, 0.975, title, fontsize=10.5, fontweight="bold", color=TEXT_DARK, va="top")
    if subtitle:
        fig.text(0.012, 0.975 - (0.055 if title else 0.0), subtitle, fontsize=8, color=TEXT_MUTED, va="top")

    # 우측 정보 띠 — 범례 / 컬러바 / 좌표축
    occupied: list = []
    leg = None
    if legend:
        leg = fig.legend(handles=list(legend), loc="upper left", bbox_to_anchor=(panel_x + 0.008, top_y - 0.005),
                         fontsize=7, framealpha=0.95, edgecolor="#AEB8C2", borderaxespad=0.0, handlelength=1.6)
    cax = None
    if colorbar is not None:
        cmap, norm, clabel = colorbar[:3]
        ticks = colorbar[3] if len(colorbar) > 3 else None
        cb_top = (top_y - 0.05) - (0.055 * (len(legend) + 1) if legend else 0.0)
        cb_h = max(0.30, cb_top - 0.22)
        cax = fig.add_axes([panel_x + 0.035, cb_top - cb_h, 0.022, cb_h])
        sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
        sm.set_array([])
        cb = fig.colorbar(sm, cax=cax, ticks=ticks)
        cb.set_label(clabel, fontsize=7.5, color=TEXT_DARK)
        cb.ax.tick_params(labelsize=6.5, colors=TEXT_MUTED)
        cb.outline.set_edgecolor("#AEB8C2")

    fig.canvas.draw()
    # 그림 밖은 전부 '점유' 로 두어 라벨 후보가 화면 밖으로 나가지 않게 한다
    big = 1e6
    occupied += [(-big, -big, 0.0, big), (W, -big, big, big), (-big, -big, big, 0.0), (-big, H, big, big)]
    if title or subtitle:
        occupied.append((0.0, H * top_y, W * panel_x, H))
    if leg is not None:
        b = leg.get_window_extent()
        occupied.append((b.x0, b.y0, b.x1, b.y1))
    if cax is not None:
        b = cax.get_tightbbox()
        occupied.append((b.x0 - 4, b.y0 - 4, b.x1 + 4, b.y1 + 4))
    if triad:
        _draw_triad(fig, ax, (W * (panel_x + 0.075), H * 0.10), 30.0 * dpi / 200.0)
        occupied.append((W * panel_x, 0.0, W, H * 0.20))

    # 2D 오버레이(권상 와이어 중심선·지지 다각형 등) — 투영해 항상 맨 위에.
    # style 의 "avoid" 는 Line2D 인자가 아니라 이 함수의 지시자다: True 면 선을 따라 점유 영역을
    # 깔아 라벨이 그 선을 덮지 않게 한다(권상 선이 라벨에 가리면 그림의 요점이 사라진다).
    for pts3, style in overlays:
        style = dict(style)
        avoid = bool(style.pop("avoid", False))
        p = _to_pixels(ax, np.asarray(pts3, dtype=float))
        line = Line2D(p[:, 0] / W, p[:, 1] / H, transform=fig.transFigure, zorder=8,
                      **{"color": "#7653C6", "lw": 1.0, "ls": "--", **style})
        fig.add_artist(line)
        if avoid:
            occupied += _line_boxes(p, half=max(float(style.get("lw", 1.0)) * 1.6, 5.0))

    # 2D 마커 — 체결 위치(●)·훅(○). 솔리드 마커는 평면도에서 부재에 묻혀 서로 구분이 안 되므로,
    # 2D 도면(`figures.py`)과 같은 기호로 투영해 맨 위에 찍는다.
    for pos, style in points2d:
        p = _to_pixels(ax, np.asarray(pos, dtype=float)[None, :])[0]
        fig.add_artist(Line2D([p[0] / W], [p[1] / H], transform=fig.transFigure, ls="none", zorder=9, **style))
        half = float(style.get("ms", 6.0)) * dpi / 72.0
        occupied.append((p[0] - half, p[1] - half, p[0] + half, p[1] + half))

    # 리더선 라벨 — 3D 좌표를 화면 픽셀로 투영해 겹침을 피해 놓는다
    px_per_pt = dpi / 72.0
    for pos, text, color in labels:
        if not text:
            continue
        sx, sy = _to_pixels(ax, np.asarray(pos, dtype=float)[None, :])[0]
        fs = 7.5
        w = sum((1.0 if ord(ch) > 0x2E7F else 0.58) for ch in text) * fs * px_per_pt + 14
        h = fs * px_per_pt * 1.9
        bx, by = place_label(occupied, sx, sy, w, h, gap=8.0)
        ax.annotate(text, (sx, sy), (bx + w / 2, by + h / 2), xycoords="figure pixels", textcoords="figure pixels",
                    fontsize=fs, color=TEXT_DARK, fontweight="bold", ha="center", va="center",
                    bbox=dict(boxstyle="round,pad=0.25", fc="white", ec=color, lw=0.9, alpha=0.96),
                    arrowprops=dict(arrowstyle="-", color=color, lw=0.9, shrinkA=0, shrinkB=1),
                    annotation_clip=False, zorder=10)

    if coll is not None:
        coll.set_visible(True)                  # 실제로 부재를 그리는 것은 이 한 번뿐이다
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, facecolor="white")
    plt.close(fig)
    return fit_aspect(_trim_white(buf.getvalue(), margin=int(10 * dpi / 200)), width_in / height_in)


def _line_boxes(px: np.ndarray, half: float, step: float = 14.0) -> list:
    """투영된 폴리라인을 따라 작은 점유 상자를 깐다(라벨 겹침 회피용).
    선 전체를 한 상자로 잡으면 대각선일 때 화면 대부분을 막아 버리므로 잘게 나눈다."""
    boxes = []
    for a, b in zip(px[:-1], px[1:]):
        d = b - a
        n = max(1, int(np.hypot(*d) / step))
        for i in range(n + 1):
            x, y = a + d * (i / n)
            boxes.append((x - half, y - half, x + half, y + half))
    return boxes


def _to_pixels(ax, pts: np.ndarray) -> np.ndarray:
    """3D 좌표 (N,3) → figure 픽셀 (N,2)."""
    M = ax.get_proj()
    out = []
    for x, y, z in pts:
        sx, sy, _ = proj3d.proj_transform(x, y, z, M)
        out.append(ax.transData.transform((sx, sy)))
    return np.asarray(out, dtype=float)


def _draw_triad(fig, ax, origin_px: tuple, length_px: float):
    """현재 시점의 X/Y/Z 방향을 우측 하단에 표시한다. 시선과 나란한 축은 점(⊙)으로."""
    W, H = fig.get_size_inches() * fig.dpi
    span = float(np.max(np.array(ax.get_w_lims()[1::2]) - np.array(ax.get_w_lims()[0::2])))
    o3 = np.array([ax.get_xlim()[0], ax.get_ylim()[0], ax.get_zlim()[0]])
    base = _to_pixels(ax, o3[None, :])[0]
    ox, oy = origin_px
    for name, e in (("X", (1, 0, 0)), ("Y", (0, 1, 0)), ("Z", (0, 0, 1))):
        tip = _to_pixels(ax, (o3 + np.asarray(e) * span * 0.1)[None, :])[0] - base
        n = float(np.linalg.norm(tip))
        color = AXIS_COLORS[name]
        if n < 1e-3:
            fig.add_artist(Line2D([ox / W], [oy / H], transform=fig.transFigure, marker="o", ms=7, mfc="white",
                                  mec=color, mew=1.4, zorder=9))
            fig.text(ox / W + 0.012, oy / H + 0.012, name, fontsize=7.5, color=color, fontweight="bold")
            continue
        d = tip / n * length_px
        fig.add_artist(Line2D([ox / W, (ox + d[0]) / W], [oy / H, (oy + d[1]) / H], transform=fig.transFigure,
                              color=color, lw=1.6, zorder=9, solid_capstyle="round"))
        fig.text((ox + d[0] * 1.35) / W, (oy + d[1] * 1.35) / H, name, fontsize=7.5, color=color,
                 fontweight="bold", ha="center", va="center")


def _trim_white(png: bytes, margin: int = 10) -> bytes:
    """흰 여백을 잘라 그림이 자리를 채우게 한다."""
    try:
        from PIL import Image, ImageChops
    except ImportError:
        return png
    try:
        im = Image.open(io.BytesIO(png)).convert("RGB")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bbox = ImageChops.difference(im, bg).getbbox()
        if not bbox:
            return png
        x0, y0, x1, y1 = bbox
        x0, y0 = max(0, x0 - margin), max(0, y0 - margin)
        x1, y1 = min(im.width, x1 + margin), min(im.height, y1 + margin)
        out = io.BytesIO()
        im.crop((x0, y0, x1, y1)).save(out, format="PNG")
        return out.getvalue()
    except Exception:
        return png


def fit_aspect(png: bytes, ratio: float) -> bytes:
    """잘라낸 그림을 흰 바탕 위에 가운데 놓아 가로:세로 = ratio 로 맞춘다.
    서식의 자리(TwoCellAnchor)는 그림을 자리 비율로 늘리므로, 비율을 미리 맞춰야 왜곡이 없다."""
    try:
        from PIL import Image
    except ImportError:
        return png
    try:
        im = Image.open(io.BytesIO(png)).convert("RGB")
        w, h = im.size
        if w / h > ratio:
            W, H = w, int(round(w / ratio))
        else:
            W, H = int(round(h * ratio)), h
        if (W, H) == (w, h):
            return png
        canvas = Image.new("RGB", (W, H), (255, 255, 255))
        canvas.paste(im, ((W - w) // 2, (H - h) // 2))
        out = io.BytesIO()
        canvas.save(out, format="PNG")
        return out.getvalue()
    except Exception:
        return png


def deformed_nodes(geometry, displacements: Sequence, scale: float) -> dict:
    """변형 형상 좌표. displacements 는 collector.DispRow 목록."""
    d = {r.node_id: (r.t1, r.t2, r.t3) for r in displacements}
    out = {}
    for nid, p in geometry.nodes.items():
        t = d.get(nid)
        if t is None:
            out[nid] = p
        else:
            out[nid] = (p[0] + t[0] * scale, p[1] + t[1] * scale, p[2] + t[2] * scale)
    return out


def value_colors(values: dict, cmap, norm, over_rgb=None) -> dict:
    """요소 id → 값 dict 를 요소 id → RGB dict 로."""
    out = {}
    for eid, v in values.items():
        if v is None or not math.isfinite(v):
            continue
        if over_rgb is not None and v > norm.vmax:
            out[eid] = over_rgb
        else:
            out[eid] = tuple(mcolors.to_rgb(cmap(norm(v))))
    return out
