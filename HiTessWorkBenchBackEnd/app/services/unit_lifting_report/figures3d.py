"""보고서용 3D 그림 세트 — `solid3d` 저수준 렌더를 보고서 데이터에 엮는다.

결과 레포트(사내 서식)와 상세 레포트가 같은 그림을 쓴다:

  modelTop / modelHome  권상 배치 — 체결 위치(●) + 와이어 + 훅(○) + COG + 라벨 (+ 평면도엔 지지 다각형)
  displacement          변형 형상(자동 배율) + 변위 컬러바 + 최대 변위 위치
  stress                부재 응력 활용도 + 컬러바 + 지배 부재 라벨
  supportTop / supportHome  가서포트 강조(있을 때만)

2D 도면(`figures.py`)과 같은 문법(제목·범례·리더선 라벨·그룹색)을 써서 두 보고서가 한 세트로 읽힌다.
"""
from __future__ import annotations

import matplotlib
import matplotlib.pyplot as plt
from matplotlib import cm, colors as mcolors
from matplotlib.lines import Line2D

from .collector import ReportData
from .figures import EXCEEDED, NO_RESULT, RAMP, STRUCTURE, group_color, _convex_hull
from . import solid3d as S3

SUPPORT_RGB = mcolors.to_rgb("#E07A16")
HULL_COLOR = "#7653C6"
MAX_MARK = "#D73A49"
DEFORM_RATIO = 0.05          # 최대 변위가 모델 최대 치수의 5% 가 되도록 배율을 잡는다
STRESS_LABEL_N = 3           # 응력 그림에 라벨을 다는 지배 부재 수
WIRE_RADIUS_RATIO = 0.26     # 권상 배치 그림의 와이어 굵기(마커 크기 대비) — 평면도에서 선이 보이게
WIRE_LINE_LW = 2.6           # 와이어 중심선(2D 덧그림) 두께
LUG_MS, HOOK_MS = 6.5, 9.5   # 체결 위치(●) · 훅(○) 2D 마커 크기 — 2D 도면(figures.py)과 같은 기호
PIPE_PID_MIN = 101           # 배관 판별 — ModelBuilder 는 배관 property 를 101 이상으로 매긴다(구조재는 100 이하)
PIPE_RGB = mcolors.to_rgb("#B3382C")   # 배관은 붉은색, 구조·가서포트는 강재색(회색)
SLOT_W_IN, SLOT_H_IN = S3.SLOT_W_IN, S3.SLOT_H_IN
VIEW_NAMES = {"top": "Top View (평면)", "home": "Home View (등각)", "iso": "등각도", "side": "측면도"}


def render_result_figures(data: ReportData) -> tuple[dict[str, bytes], dict[str, str]]:
    """결과 레포트(사내 서식)의 캡처 4~6장. 그림별로 실패를 격리한다."""
    figs: dict[str, bytes] = {}
    errors: dict[str, str] = {}
    if not (data.geometry and data.geometry.nodes):
        errors["model"] = "ValueError: 모델 형상(edited/원본 json)이 없어 3D 캡처를 만들 수 없습니다."
        return figs, errors

    jobs = [
        ("modelTop", lambda: render_hoist_model(data, "top")),
        ("modelHome", lambda: render_hoist_model(data, "home")),
        ("displacement", lambda: render_displacement(data)),
        ("stress", lambda: render_stress(data)),
    ]
    if data.edits and data.edits.support_beams:
        jobs += [("supportTop", lambda: render_support(data, "top")),
                 ("supportHome", lambda: render_support(data, "home"))]
    for key, fn in jobs:
        try:
            figs[key] = fn()
        except Exception as exc:
            errors[key] = f"{type(exc).__name__}: {exc}"
            plt.close("all")
    return figs, errors


# ── 공통 조각 ─────────────────────────────────────────────────────────────────
def _span(data: ReportData) -> float:
    return max(data.model.size_mm) or 1000.0


def _cog(data: ReportData):
    c = data.model.cog_mm
    return (c.get("x", 0.0), c.get("y", 0.0), c.get("z", 0.0)) if c else None


def _xyz(d: dict):
    return (float(d.get("x", 0.0)), float(d.get("y", 0.0)), float(d.get("z", 0.0)))


def _pipe_colors(data: ReportData) -> dict:
    """배관 요소 id → 붉은색. 결과(변위·응력) 그림에는 쓰지 않는다 — 거기선 색이 곧 해석 결과다."""
    return {eid: PIPE_RGB for eid, _n1, _n2, pid, _r in data.geometry.elements
            if pid and int(pid) >= PIPE_PID_MIN}


def _pipe_handle(per: dict):
    """배관이 실제로 있을 때만 범례에 한 줄 넣는다."""
    return ([Line2D([], [], color=mcolors.to_hex(PIPE_RGB), lw=3, label=f"배관 (PID ≥ {PIPE_PID_MIN})")]
            if per else [])


class _Rig:
    """권상 장구(와이어·러그·훅) 를 데이터에서 모아 둔다. stability 의 visualization 이 1순위,
    없으면 hoist 그룹의 러그 절점만(와이어 없이) 쓴다."""

    def __init__(self, data: ReportData, node_pos: dict | None = None):
        st = data.stability
        nodes = node_pos or data.geometry.nodes
        self.wires = []                      # (group_id, lug_id, lug_xyz, apex_xyz, angle_deg)
        self.apexes = {}                     # group_id -> xyz
        for a in st.apexes:
            gid = int(a.get("groupId") or 0)
            if a.get("pointMm"):
                self.apexes[gid] = _xyz(a["pointMm"])
        for w in st.wires:
            if not w.end_mm:
                continue
            lug = nodes.get(w.lug_node_id) or _xyz(w.end_mm)   # 변형 형상이면 이동한 러그 좌표를 쓴다
            apex = self.apexes.get(w.group_id) or (_xyz(w.start_mm) if w.start_mm else None)
            self.wires.append((w.group_id, w.lug_node_id, tuple(lug), apex, w.angle_deg))
        if not self.wires and data.hoist:
            for grp in data.hoist.groups:
                for n in grp.nodes:
                    nid = int(n.get("id") or 0)
                    p = nodes.get(nid) or ((n["x"], n["y"], n["z"]) if "x" in n else None)
                    if p:
                        self.wires.append((grp.group_id, nid, tuple(p), None, None))
        self.group_ids = sorted({g for g, *_ in self.wires} | set(self.apexes))

    def meshes(self, size: float, start_id: int = -1, wire_rgb=None, clip_z: float | None = None,
               wire_radius: float | None = None, solid_markers: bool = True):
        """(메시 목록, 요소색 dict, 다음 id).
        wire_rgb 를 주면 와이어·마커를 그 한 색으로(결과 그림의 '참고' 표시).
        clip_z 를 주면 와이어를 그 높이에서 잘라 훅 마커를 생략한다 — 결과 그림에서 훅 정점(모델 위 수 m)
        까지 그리면 모델이 작아지므로, 방향만 보이게 짧게 둔다.
        solid_markers=False 면 러그·훅 솔리드를 만들지 않는다(권상 배치 그림은 `points2d` 의 ●/○ 를 쓴다)."""
        parts, per = [], {}
        nid = start_id
        segs = []
        for _g, _l, lug, apex, _a in self.wires:
            if not apex:
                continue
            end = apex
            if clip_z is not None and apex[2] > clip_z > lug[2]:
                t = (clip_z - lug[2]) / (apex[2] - lug[2])
                end = tuple(lug[i] + (apex[i] - lug[i]) * t for i in range(3))
            segs.append((lug, end))
        if segs:
            parts.append(S3.wire_mesh(segs, wire_radius if wire_radius is not None else size * 0.11, start_id=nid))
            for k, (g, *_r) in enumerate([w for w in self.wires if w[3]]):
                per[nid - k] = wire_rgb or mcolors.to_rgb(group_color(g))
            nid -= len(segs)
        lugs = [lug for _g, _l, lug, _a, _ang in self.wires] if solid_markers else []
        if lugs:
            parts.append(S3.marker_mesh(lugs, size, start_id=nid))
            for k, (g, *_r) in enumerate(self.wires):
                per[nid - k] = wire_rgb or mcolors.to_rgb(group_color(g))
            nid -= len(lugs)
        if self.apexes and clip_z is None and solid_markers:
            items = sorted(self.apexes.items())
            parts.append(S3.diamond_mesh([p for _g, p in items], size * 1.7, start_id=nid))
            for k, (g, _p) in enumerate(items):
                per[nid - k] = wire_rgb or mcolors.to_rgb(group_color(g))
            nid -= len(items)
        return parts, per, nid

    def points2d(self) -> list:
        """체결 위치(러그)는 '가득 찬 원', 훅은 '빈 원' — 2D 도면(`figures.py`)과 같은 기호로 통일한다."""
        pts = [(lug, dict(marker="o", ms=LUG_MS, mfc=group_color(gid), mec="white", mew=0.9))
               for gid, _l, lug, _a, _ang in self.wires]
        pts += [(apex, dict(marker="o", ms=HOOK_MS, mfc="white", mec=group_color(gid), mew=1.8))
                for gid, apex in sorted(self.apexes.items())]
        return pts

    def clip_height(self, data: ReportData) -> float:
        """결과 그림의 와이어 절단 높이 — 모델 상단 + 최대 치수의 12%."""
        return data.model.bbox.get("maxZ", 0.0) + _span(data) * 0.12


def _legend_groups(data: ReportData, rig: _Rig, *, cog: bool = True, structure: bool = True, hull: bool = False):
    gids = rig.group_ids or list(range(1, (data.identity.group_count or 0) + 1))
    handles = [Line2D([], [], color=group_color(g), lw=WIRE_LINE_LW, marker="o", ms=5, mec="white", mew=0.7,
                      label=f"권상 그룹 G{g}") for g in gids]
    handles.append(Line2D([], [], color=S3.TEXT_MUTED, lw=0, marker="o", ms=5, mfc=S3.TEXT_MUTED, mec="white",
                          label="체결 위치(러그)"))
    if rig.apexes:
        handles.append(Line2D([], [], color=S3.TEXT_MUTED, lw=0, marker="o", ms=6, mfc="white", mew=1.4,
                              mec=S3.TEXT_MUTED, label="훅 정점"))
    if cog and _cog(data):
        handles.append(Line2D([], [], color=S3.COG_COLOR, lw=0, marker="D", ms=6, label="COG"))
    if hull:
        handles.append(Line2D([], [], color=HULL_COLOR, lw=1, ls="--", label="지지 다각형"))
    if structure:
        handles.append(Line2D([], [], color=STRUCTURE, lw=3, label="기존 구조"))
    return handles


def _cog_parts(data: ReportData, size: float, nid: int):
    cog = _cog(data)
    if not cog:
        return [], {}, nid, []
    mesh = S3.diamond_mesh([cog], size * 1.5, start_id=nid)
    return [mesh], {nid: mcolors.to_rgb(S3.COG_COLOR)}, nid - 1, [(cog, "COG", S3.COG_COLOR)]


# ── 권상 배치 ─────────────────────────────────────────────────────────────────
def render_hoist_model(data: ReportData, view: str) -> bytes:
    """권상 배치 — 체결 위치(●)·와이어·훅(○)·COG 를 그룹색으로 얹은 3D 모델. 라벨은 그룹·러그 절점.

    슬링각은 라벨에 넣지 않는다(도면이 난잡해진다). 최소 슬링각은 부제에, 그룹별 전량은
    상세 레포트 표 11(와이어 기하)에 있다.
    """
    g = data.geometry
    span = _span(data)
    size = span * 0.014
    rig = _Rig(data)
    parts = [S3.build_mesh(g, data.model.sections)]
    pipes = _pipe_colors(data)
    rig_parts, per, nid = rig.meshes(size, wire_radius=size * WIRE_RADIUS_RATIO, solid_markers=False)
    per.update(pipes)
    parts += rig_parts
    cog_parts, cog_per, nid, labels = _cog_parts(data, size, nid)
    parts += cog_parts
    per.update(cog_per)

    for gid, lug_id, lug, _apex, _ang in rig.wires:
        labels.append((lug, f"G{gid}·N{lug_id}", group_color(gid)))
    for gid, apex in sorted(rig.apexes.items()):
        labels.append((apex, f"HOOK G{gid}", group_color(gid)))

    # 와이어 중심선을 2D 로 덧그린다. 평면도에서는 와이어가 거의 수직이라 솔리드가 짧게 눌려
    # 흐릿해지는데, 이 선은 투영 길이와 무관하게 그룹색 그대로 또렷하게 남는다.
    overlays = [([lug, apex], {"color": group_color(gid), "lw": WIRE_LINE_LW, "ls": "-",
                               "solid_capstyle": "round", "avoid": True})
                for gid, _l, lug, apex, _a in rig.wires if apex]
    st = data.stability
    hull_ok = view == "top" and st.tipping and st.tipping.evaluation_mode == "ConvexPolygon" and len(rig.apexes) >= 3
    if hull_ok:
        z_top = data.model.bbox.get("maxZ", 0.0)
        hull = _convex_hull([(p[0], p[1]) for p in rig.apexes.values()])
        hull = hull + hull[:1]
        overlays.append(([(x, y, z_top) for x, y in hull], {"color": HULL_COLOR, "lw": 1.1, "ls": "--"}))

    mesh = S3.concat(*parts)
    colors = S3.face_colors(mesh, per_element=per, missing_rgb=S3.STEEL_RGB)
    sub = f"{data.identity.lifting_method} · {data.model.total_mass_ton:.3f} ton · 그룹 {len(rig.group_ids)}개"
    if st.min_sling_angle_deg is not None:
        sub += f" · 최소 슬링각 {st.min_sling_angle_deg:.1f}°"
    return S3.render(mesh, colors, view, title=f"권상 배치 — {VIEW_NAMES.get(view, view)}", subtitle=sub,
                     labels=labels, overlays=overlays, points2d=rig.points2d(),
                     legend=_legend_groups(data, rig, hull=bool(hull_ok)) + _pipe_handle(pipes),
                     extra_points=list(rig.apexes.values()), width_in=SLOT_W_IN, height_in=SLOT_H_IN)


def render_model_solid(data: ReportData, view: str = "home") -> bytes:
    """마커 없는 해석 모델 등각도 — 상세 보고서 2.1절용."""
    mesh = S3.build_mesh(data.geometry, data.model.sections)
    pipes = _pipe_colors(data)
    colors = S3.face_colors(mesh, per_element=pipes, missing_rgb=S3.STEEL_RGB)
    sub = f"절점 {data.model.node_count:,} · 요소 {data.model.element_count:,} · " \
          f"{data.model.size_mm[0]:,.0f} × {data.model.size_mm[1]:,.0f} × {data.model.size_mm[2]:,.0f} mm"
    return S3.render(mesh, colors, view, title=f"해석 모델 — {VIEW_NAMES.get(view, view)}", subtitle=sub,
                     legend=[Line2D([], [], color=STRUCTURE, lw=3, label="부재(단면 반영)")] + _pipe_handle(pipes),
                     width_in=SLOT_W_IN, height_in=SLOT_H_IN)


# ── 결과 ─────────────────────────────────────────────────────────────────────
def deform_scale(data: ReportData) -> float:
    span = _span(data)
    return (DEFORM_RATIO * span / data.results.max_displacement_mm) if data.results.max_displacement_mm > 0 else 1.0


def render_displacement(data: ReportData, view: str = "home") -> bytes:
    """변형 형상 — 절점 변위를 배율만큼 부풀린 좌표로 다시 세우고 |변위| 로 칠한다."""
    g, r = data.geometry, data.results
    scale = deform_scale(data)
    pos = S3.deformed_nodes(g, r.all_displacements, scale)
    parts = [S3.build_mesh(g, data.model.sections, node_pos=pos)]
    mags = {d.node_id: abs(d.magnitude) for d in r.all_displacements}
    values = {eid: (mags.get(n1, 0.0) + mags.get(n2, 0.0)) / 2 for eid, n1, n2, _pid, _r in g.elements
              if n1 in mags or n2 in mags}
    vmax = r.max_displacement_mm or 1.0
    norm = mcolors.Normalize(0.0, vmax)
    per = S3.value_colors(values, cm.viridis, norm)

    size = _span(data) * 0.014
    rig = _Rig(data, node_pos=pos)
    rig_parts, rig_per, nid = rig.meshes(size, wire_rgb=(0.72, 0.75, 0.78), clip_z=rig.clip_height(data))
    parts += rig_parts
    per.update(rig_per)

    labels = []
    if r.max_displacement_node_id in pos:
        p = pos[r.max_displacement_node_id]
        parts.append(S3.diamond_mesh([p], size * 1.6, start_id=nid))
        per[nid] = mcolors.to_rgb(MAX_MARK)
        labels.append((p, f"최대 {vmax:.1f} mm · N{r.max_displacement_node_id}", MAX_MARK))

    mesh = S3.concat(*parts)
    colors = S3.face_colors(mesh, per_element=per, missing_rgb=mcolors.to_rgb(NO_RESULT))
    handles = [Line2D([], [], color=MAX_MARK, lw=0, marker="D", ms=6, label="최대 변위 절점"),
               Line2D([], [], color="#B8BFC6", lw=2, label="와이어 방향(참고)")]
    if len(values) < len(g.elements):
        handles.append(Line2D([], [], color=NO_RESULT, lw=3, label="결과 없음"))
    return S3.render(mesh, colors, view, title=f"변형 형상 — {VIEW_NAMES.get(view, view)} (변형 배율 ×{scale:.0f})",
                     subtitle=f"최대 변위 {vmax:.2f} mm @N{r.max_displacement_node_id} · 참고치(판정 없음)",
                     labels=labels, legend=handles, colorbar=(cm.viridis, norm, "변위 [mm]"),
                     width_in=SLOT_W_IN, height_in=SLOT_H_IN)


def render_stress(data: ReportData, view: str = "home") -> bytes:
    """부재 응력 활용도 — Studio stressColorRamp 와 같은 색 구간. 지배 부재·초과 부재에 라벨."""
    g, r = data.geometry, data.results
    parts = [S3.build_mesh(g, data.model.sections)]
    values = {m.element_id: m.utilization for m in r.all_members if m.utilization is not None}
    norm = mcolors.Normalize(0.0, 1.0)
    per = S3.value_colors(values, RAMP, norm, over_rgb=mcolors.to_rgb(EXCEEDED))

    size = _span(data) * 0.014
    rig = _Rig(data)
    rig_parts, rig_per, nid = rig.meshes(size, wire_rgb=(0.72, 0.75, 0.78), clip_z=rig.clip_height(data))
    parts += rig_parts
    per.update(rig_per)

    mid = {eid: tuple((g.nodes[n1][i] + g.nodes[n2][i]) / 2 for i in range(3))
           for eid, n1, n2, _pid, _r in g.elements if n1 in g.nodes and n2 in g.nodes}
    picked = list(r.exceeding) + [m for m in r.governing if m not in r.exceeding]
    labels = []
    for m in picked[:max(STRESS_LABEL_N, len(r.exceeding))]:
        if m.element_id in mid:
            color = EXCEEDED if (m.exceeds or (m.utilization or 0) > 1.0) else S3.TEXT_MUTED
            labels.append((mid[m.element_id], f"E{m.element_id} {m.stress_mpa:.1f} MPa", color))

    mesh = S3.concat(*parts)
    colors = S3.face_colors(mesh, per_element=per, missing_rgb=mcolors.to_rgb(NO_RESULT))
    handles = [Line2D([], [], color=EXCEEDED, lw=3, label="허용 초과"),
               Line2D([], [], color="#B8BFC6", lw=2, label="와이어 방향(참고)")]
    if len(values) < len(g.elements):
        handles.append(Line2D([], [], color=NO_RESULT, lw=3, label="결과 없음"))
    sub = f"최대 {r.max_stress_mpa:.1f} MPa @E{r.max_stress_element_id} · σ허용 {r.allowable_mpa:.0f} MPa · 초과 {r.exceed_count}개"
    return S3.render(mesh, colors, view, title=f"부재 응력 활용도 — {VIEW_NAMES.get(view, view)}", subtitle=sub,
                     labels=labels, legend=handles,
                     colorbar=(RAMP, norm, f"활용도 σ/σ허용 (σ허용 = {r.allowable_mpa:.0f} MPa)", [0, 0.4, 0.7, 0.85, 1.0]),
                     width_in=SLOT_W_IN, height_in=SLOT_H_IN)


def render_support(data: ReportData, view: str = "home") -> bytes:
    """가서포트만 주황으로 강조하고 나머지는 강재색. 권상 장구는 옅게 함께 그린다."""
    g = data.geometry
    parts = [S3.build_mesh(g, data.model.sections)]
    pipes = _pipe_colors(data)
    per = dict(pipes)
    per.update({sb.element_id: SUPPORT_RGB for sb in data.edits.support_beams})
    size = _span(data) * 0.014
    rig = _Rig(data)
    rig_parts, rig_per, nid = rig.meshes(size, wire_rgb=(0.72, 0.75, 0.78), clip_z=rig.clip_height(data))
    parts += rig_parts
    per.update(rig_per)
    labels = []
    for k, sb in enumerate(data.edits.support_beams):
        a, b = g.nodes.get(sb.start_node), g.nodes.get(sb.end_node)
        if a and b:
            labels.append((tuple((a[i] + b[i]) / 2 for i in range(3)), f"S{k + 1}", "#E07A16"))
    mesh = S3.concat(*parts)
    colors = S3.face_colors(mesh, per_element=per, missing_rgb=S3.STEEL_RGB)
    handles = [Line2D([], [], color="#E07A16", lw=3, label=f"가서포트 {len(data.edits.support_beams)}개"),
               Line2D([], [], color="#B8BFC6", lw=2, label="와이어 방향(참고)"),
               Line2D([], [], color=STRUCTURE, lw=3, label="기존 구조")] + _pipe_handle(pipes)
    return S3.render(mesh, colors, view, title=f"가서포트 배치 — {VIEW_NAMES.get(view, view)}",
                     subtitle="권상 중 처짐·응력 저감을 위해 추가한 임시 보강재", labels=labels, legend=handles,
                     width_in=SLOT_W_IN, height_in=SLOT_H_IN)
