"""부재를 단면 치수대로 세운 3D 솔리드 렌더 (matplotlib Agg → PNG bytes).

사내 서식(ver02) 설명서의 Hi-TESS-BEAM 캡처처럼 각 부재를 '단면을 가진 입체'로 그린다.
선도(2D `figures.py`)와 달리 부재 굵기·가림·음영이 보여 형상 파악이 쉽다.

한 부재 = 시작·끝 절점을 잇는 각기둥 6면. 로컬 축은 CBEAM orientation 벡터로 잡는다.
2,500 부재 ≈ 15,000 면이고 렌더 1장에 약 1초다(실측).
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
from mpl_toolkits.mplot3d import proj3d  # noqa: E402
from mpl_toolkits.mplot3d.art3d import Poly3DCollection  # noqa: E402

plt.rcParams["font.family"] = ["Malgun Gothic", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

# 사내 서식 캡처와 같은 붉은 강재색
STEEL_RGB = (0.75, 0.20, 0.17)
COG_COLOR = "#111827"                # 그룹색(2번이 붉은색)과 겹치지 않는 진회색
EDGE_RGB = (0.35, 0.08, 0.06)
DEFAULT_HW = 100.0                   # 단면 정보를 못 찾은 부재의 기본 한 변(mm)
MIN_HW = 30.0                        # 너무 얇으면 화면에서 사라져 최소 굵기를 준다
LIGHT = np.array([0.40, -0.60, 0.70])
LIGHT = LIGHT / np.linalg.norm(LIGHT)
FACES = ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7))
# (elev, azim) — top 은 정확히 90° 면 방위각이 무의미해져 89.9° 를 쓴다
VIEWS = {"top": (89.9, -90.0), "home": (22.0, -55.0), "iso": (22.0, -55.0), "side": (0.0, -90.0)}


def section_hw(section) -> tuple[float, float]:
    """PBEAML 단면 → (높이, 폭) mm. 종류를 모르면 치수 최대값을 정사각으로 쓴다."""
    if section is None:
        return (DEFAULT_HW, DEFAULT_HW)
    kind = str(getattr(section, "kind", "") or "").upper()
    dims = [float(x) for x in (getattr(section, "dims", None) or []) if isinstance(x, (int, float))]
    try:
        if kind == "L":
            return (dims[1], dims[0])
        if kind == "H":                      # DIM1=웹 순높이, DIM2=2·tf, DIM3=플랜지 폭
            return (dims[0] + dims[1], dims[2])
        if kind in ("I", "T", "CHAN"):
            return (dims[0], dims[1])
        if kind == "BAR":
            return (dims[1], dims[0])
        if kind in ("TUBE", "TUBE2"):
            return (dims[0], dims[0])
        if kind == "ROD":
            return (2 * dims[0], 2 * dims[0])
    except IndexError:
        pass
    m = max(dims) if dims else DEFAULT_HW
    return (m, m)


class SolidMesh:
    """부재 6면 사각형 묶음. quads (N,4,3) · shades (N,) · elem_ids (N,)."""

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
        pa, pb = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
        axis = pb - pa
        length = float(np.linalg.norm(axis))
        if length < 1e-6:
            continue
        axis /= length
        v = np.asarray(geometry.orientations.get(eid, (0.0, 0.0, 1.0)), dtype=float)
        if np.linalg.norm(np.cross(axis, v)) < 1e-6:      # 축과 평행하면 다른 기준 벡터로
            v = np.array([1.0, 0.0, 0.0]) if abs(axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
        n_w = np.cross(axis, v)
        n_w /= np.linalg.norm(n_w)
        n_h = np.cross(axis, n_w)
        h, w = section_hw(sec_by_pid.get(pid))
        h2, w2 = max(h, MIN_HW) / 2, max(w, MIN_HW) / 2
        corners = [pa + n_w * w2 + n_h * h2, pa - n_w * w2 + n_h * h2,
                   pa - n_w * w2 - n_h * h2, pa + n_w * w2 - n_h * h2,
                   pb + n_w * w2 + n_h * h2, pb - n_w * w2 + n_h * h2,
                   pb - n_w * w2 - n_h * h2, pb + n_w * w2 - n_h * h2]
        for face in FACES:
            q = [corners[i] for i in face]
            nrm = np.cross(q[1] - q[0], q[2] - q[0])
            nl = float(np.linalg.norm(nrm))
            if nl < 1e-9:
                continue
            quads.append(q)
            shades.append(0.34 + 0.66 * abs(float(np.dot(nrm / nl, LIGHT))))
            ids.append(eid)
    if not quads:
        return SolidMesh(np.zeros((0, 4, 3)), np.zeros(0), np.zeros(0, dtype=int))
    return SolidMesh(np.asarray(quads), np.asarray(shades), np.asarray(ids, dtype=int))


def marker_mesh(points: Sequence, size: float, start_id: int = -1) -> SolidMesh:
    """권상 위치·COG 표시용 정육면체 묶음. 선(scatter)이 아니라 솔리드라야 부재에 가려지지 않고
    깊이 정렬에 정상 참여한다. elem_ids 는 음수로 매겨 per_element 색 지정에 쓴다."""
    quads, shades, ids = [], [], []
    h = size / 2
    for k, p in enumerate(points):
        c = np.asarray(p, dtype=float)
        corners = [c + np.array(d) * h for d in
                   ((1, 1, 1), (-1, 1, 1), (-1, -1, 1), (1, -1, 1),
                    (1, 1, -1), (-1, 1, -1), (-1, -1, -1), (1, -1, -1))]
        for face in ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            q = [corners[i] for i in face]
            nrm = np.cross(q[1] - q[0], q[2] - q[0])
            nl = float(np.linalg.norm(nrm))
            if nl < 1e-9:
                continue
            quads.append(q)
            shades.append(0.55 + 0.45 * abs(float(np.dot(nrm / nl, LIGHT))))
            ids.append(start_id - k)
    if not quads:
        return SolidMesh(np.zeros((0, 4, 3)), np.zeros(0), np.zeros(0, dtype=int))
    return SolidMesh(np.asarray(quads), np.asarray(shades), np.asarray(ids, dtype=int))


def pin_mesh(points: Sequence, top_z: float, size: float, start_id: int = -1) -> SolidMesh:
    """권상 위치 지시 핀 — 러그에서 모델 상단 위까지 세운 가는 기둥 + 머리 큐브.

    러그는 보통 구조물 중간 높이라 마커만 두면 위 부재에 가려 안 보인다. 도면 관례대로
    지시선을 세워 평면도·등각도 어디서든 위치가 읽히게 한다.
    """
    quads, shades, ids = [], [], []
    r = size * 0.18
    for k, p in enumerate(points):
        c = np.asarray(p, dtype=float)
        head = np.array([c[0], c[1], max(top_z, c[2] + size)])
        # 기둥(사각 단면) + 머리 큐브를 한 번에 만든다
        for lo, hi, half in ((c, head, r), (head - np.array([0, 0, size / 2]), head + np.array([0, 0, size / 2]), size / 2)):
            corners = [np.array([lo[0] + sx * half, lo[1] + sy * half, lo[2]]) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
            corners += [np.array([hi[0] + sx * half, hi[1] + sy * half, hi[2]]) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
            for face in FACES:
                q = [corners[i] for i in face]
                nrm = np.cross(q[1] - q[0], q[2] - q[0])
                nl = float(np.linalg.norm(nrm))
                if nl < 1e-9:
                    continue
                quads.append(q)
                shades.append(0.62 + 0.38 * abs(float(np.dot(nrm / nl, LIGHT))))
                ids.append(start_id - k)
    if not quads:
        return SolidMesh(np.zeros((0, 4, 3)), np.zeros(0), np.zeros(0, dtype=int))
    return SolidMesh(np.asarray(quads), np.asarray(shades), np.asarray(ids, dtype=int))


def concat(*meshes: SolidMesh) -> SolidMesh:
    """여러 메시를 합친다(부재 + 마커)."""
    parts = [m for m in meshes if len(m.quads)]
    if not parts:
        return SolidMesh(np.zeros((0, 4, 3)), np.zeros(0), np.zeros(0, dtype=int))
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


def render(mesh: SolidMesh, colors: np.ndarray, view: str = "home", *,
           title: str = "", subtitle: str = "", markers: Iterable = (), edges: bool = True,
           colorbar=None, width_in: float = 7.2, height_in: float = 5.0, dpi: int = 130,
           zoom: float = 1.35) -> bytes:
    """솔리드 메시를 지정 시점에서 렌더해 PNG 바이트로 돌려준다.

    markers: (xyz, color, label) 목록 — 권상 위치·COG 등.
    colorbar: (cmap, norm, label) 이면 우측에 컬러바를 붙인다.
    """
    fig = plt.figure(figsize=(width_in, height_in), dpi=dpi)
    ax = fig.add_subplot(projection="3d", proj_type="ortho")
    if len(mesh.quads):
        ax.add_collection3d(Poly3DCollection(
            mesh.quads, facecolors=colors,
            edgecolors=EDGE_RGB if edges else "none", linewidths=0.12 if edges else 0.0))
    mn, mx = mesh.bounds
    marker_pts = [np.asarray(m[0], dtype=float) for m in markers]
    if marker_pts:
        allp = np.vstack([np.array([mn, mx])] + [p[None, :] for p in marker_pts])
        mn, mx = allp.min(axis=0), allp.max(axis=0)
    size = np.maximum(mx - mn, 1.0)
    pad = size * 0.03
    ax.set_xlim(mn[0] - pad[0], mx[0] + pad[0])
    ax.set_ylim(mn[1] - pad[1], mx[1] + pad[1])
    ax.set_zlim(mn[2] - pad[2], mx[2] + pad[2])
    # 3D 축은 항상 정사각 영역을 잡아 사방에 큰 여백이 남는다. 축을 figure 전체로 넓히고
    # zoom 으로 모델을 키운 뒤, 저장 후 _trim_white 로 남은 흰 여백을 잘라낸다.
    try:
        ax.set_box_aspect(tuple(size / size.max()), zoom=zoom)
    except TypeError:                                     # matplotlib < 3.6
        ax.set_box_aspect(tuple(size / size.max()))
    elev, azim = VIEWS.get(view, VIEWS["home"])
    ax.view_init(elev=elev, azim=azim)
    ax.set_axis_off()
    ax.set_position([0.0, 0.0, 1.0, 1.0])

    # 라벨은 3D text 로 두면 부재 폴리곤에 가려진다. 3D 좌표를 화면 좌표로 투영해
    # 2D 주석으로 그려 항상 맨 위에 보이게 한다.
    if markers:
        fig.canvas.draw()
        for pos, color, label in markers:
            if not label:
                continue
            p = np.asarray(pos, dtype=float)
            sx, sy, _ = proj3d.proj_transform(p[0], p[1], p[2], ax.get_proj())
            ax.annotate(label, ax.transData.transform((sx, sy)), xycoords="figure pixels",
                        fontsize=7.5, color=color, fontweight="bold", ha="center", va="center",
                        bbox=dict(boxstyle="round,pad=0.22", fc="white", ec=color, lw=0.7, alpha=0.95),
                        annotation_clip=False, zorder=10)

    if title:
        fig.text(0.012, 0.985, title, fontsize=11, fontweight="bold", color="#18242F", va="top")
    if subtitle:
        fig.text(0.012, 0.938, subtitle, fontsize=8.5, color="#5B6975", va="top")
    if colorbar is not None:
        cmap, norm, clabel = colorbar
        sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
        sm.set_array([])
        cb = fig.colorbar(sm, ax=ax, fraction=0.028, pad=0.0, shrink=0.72)
        cb.set_label(clabel, fontsize=8)
        cb.ax.tick_params(labelsize=7)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight", pad_inches=0.02, facecolor="white")
    plt.close(fig)
    return _trim_white(buf.getvalue())


def _trim_white(png: bytes, margin: int = 6) -> bytes:
    """3D 축은 항상 정사각 영역을 잡아 여백이 크다. 흰 여백을 잘라 그림이 프레임을 채우게 한다."""
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
