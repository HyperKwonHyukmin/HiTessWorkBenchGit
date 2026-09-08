"""Unit 권상 검토 보고서 — 2D 도면 렌더(matplotlib Agg → PNG bytes).

모든 좌표는 모델 mm. 투영: plan(XY, 위에서), side(XZ), front(YZ), iso(등각).
그룹 색은 Studio 와 동일한 6색. 라벨 겹침 회피는 Studio LiftingArrangementReport.js 의 로직을 옮겼다.
"""
from __future__ import annotations

import io
import math
from typing import Optional

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import colors as mcolors  # noqa: E402
from matplotlib.collections import LineCollection  # noqa: E402

from .collector import ReportData, Geometry, SUPPORT_REMARK  # noqa: E402

plt.rcParams["font.family"] = ["Malgun Gothic", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

GROUP_COLORS = ["#1769AA", "#D73A49", "#138A5B", "#E07A16", "#7653C6", "#008C99"]
STRUCTURE = "#B8C2CC"
SUPPORT = "#E07A16"
DPI = 150
# Studio stressColorRamp.js RAMP_STOPS 와 동일
RAMP = mcolors.LinearSegmentedColormap.from_list("util", [
    (0.00, "#1E5AA8"), (0.40, "#2BA6C4"), (0.70, "#37E08A"), (0.85, "#FFC447"), (1.00, "#FF8A3D")])
EXCEEDED = "#FF5566"
NO_RESULT = "#90A4B0"
_ISO_C, _ISO_S = math.cos(math.radians(30)), math.sin(math.radians(30))


def group_color(gid: int) -> str:
    return GROUP_COLORS[(max(1, int(gid)) - 1) % len(GROUP_COLORS)]


def project(p, view: str) -> tuple[float, float]:
    x, y, z = p
    if view == "plan":
        return (x, y)
    if view == "side":
        return (x, z)
    if view == "front":
        return (y, z)
    # iso: X 오른쪽-아래, Y 오른쪽-위, Z 위
    return ((x + y) * _ISO_C, (-x + y) * _ISO_S + z)


def place_label(occupied: list, px: float, py: float, w: float, h: float, gap: float = 6.0):
    """겹치지 않는 라벨 박스(x0, y0) 를 고른다. 6개 후보 중 첫 미충돌, 없으면 마지막 후보."""
    cands = [(px + gap, py + gap), (px + gap, py - h - gap), (px - w - gap, py + gap),
             (px - w - gap, py - h - gap), (px + gap * 2, py - h / 2), (px - w - gap * 2, py - h / 2),
             # 같은 선상에 점이 몰릴 때를 위한 2단째 후보(위·아래로 한 칸 더)
             (px - w / 2, py + h + gap * 2), (px - w / 2, py - 2 * h - gap * 2),
             (px + gap, py + 2 * h + gap * 3), (px + gap, py - 3 * h - gap * 3)]
    for cx, cy in cands:
        box = (cx, cy, cx + w, cy + h)
        if not any(_overlap(box, o) for o in occupied):
            occupied.append(box)
            return (cx, cy)
    cx, cy = cands[-1]
    occupied.append((cx, cy, cx + w, cy + h))
    return (cx, cy)


def _overlap(a, b, pad=2.0):
    return not (a[2] + pad < b[0] or b[2] + pad < a[0] or a[3] + pad < b[1] or b[3] + pad < a[1])


# ── 공개 ──────────────────────────────────────────────────────────────────────
def render_all(data: ReportData) -> dict[str, bytes]:
    figs, errors = render_all_safe(data)
    if errors:
        raise RuntimeError("; ".join(f"{k}: {v}" for k, v in errors.items()))
    return figs


def render_all_safe(data: ReportData) -> tuple[dict[str, bytes], dict[str, str]]:
    """그림별로 실패를 격리한다. 반환 (성공 PNG, 실패 사유)."""
    figs: dict[str, bytes] = {}
    errors: dict[str, str] = {}
    g = data.geometry
    jobs = []
    if g and g.nodes:
        # 평면도·측면도·정면도는 치수를 읽는 '도면'이라 2D 선도를 유지하고,
        # 등각도 계열(형상 파악용)은 단면을 가진 3D 솔리드로 그린다(사용자 결정).
        from . import figures3d                      # 지연 import — figures3d 가 이 모듈을 참조한다
        for view in ("plan", "side", "front"):
            jobs.append((f"model_{view}", lambda v=view: _render_model(g, v, data)))
        jobs += [("model_iso", lambda: figures3d.render_model_solid(data, "home")),
                 ("hoist_plan", lambda: _render_hoist(g, data, "plan")),
                 ("hoist_side", lambda: _render_hoist(g, data, "side")),
                 ("hoist_iso", lambda: figures3d.render_hoist_model(data, "home")),
                 ("deformed_iso", lambda: figures3d.render_displacement(data)),
                 ("stress_plan", lambda: _render_stress(g, data, "plan")),
                 ("stress_iso", lambda: figures3d.render_stress(data))]
        if data.edits and data.edits.support_beams:
            jobs += [("support_plan", lambda: _render_support(g, data, "plan")),
                     ("support_iso", lambda: figures3d.render_support(data, "home"))]
    jobs.append(("utilization_hist", lambda: _render_histogram(data)))
    for key, fn in jobs:
        try:
            figs[key] = fn()
        except Exception as exc:  # 한 그림 실패가 보고서를 막지 않게
            errors[key] = f"{type(exc).__name__}: {exc}"
            plt.close("all")
    return figs, errors


# ── 공통 ──────────────────────────────────────────────────────────────────────
def _fig(w=7.2, h=4.6):
    fig, ax = plt.subplots(figsize=(w, h), dpi=DPI)
    ax.set_aspect("equal", adjustable="box")
    ax.set_facecolor("white")
    fig.patch.set_facecolor("white")
    for s in ax.spines.values():
        s.set_color("#AEB8C2")
    ax.tick_params(labelsize=7, colors="#5B6975")
    return fig, ax


def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png", dpi=DPI, facecolor="white")
    plt.close(fig)
    return buf.getvalue()


def _segments(g: Geometry, view: str, exclude_support=False):
    segs = []
    for _eid, n1, n2, _pid, remark in g.elements:
        if exclude_support and remark == SUPPORT_REMARK:
            continue
        segs.append([project(g.nodes[n1], view), project(g.nodes[n2], view)])
    return segs


def _draw_structure(ax, g: Geometry, view: str, color=STRUCTURE, lw=0.5, alpha=0.9):
    ax.add_collection(LineCollection(_segments(g, view, exclude_support=True), colors=color, linewidths=lw, alpha=alpha, zorder=1))
    ax.autoscale_view()


def _axis_labels(ax, view: str):
    ax.set_xlabel({"plan": "X (mm)", "side": "X (mm)", "front": "Y (mm)", "iso": ""}[view], fontsize=8)
    ax.set_ylabel({"plan": "Y (mm)", "side": "Z (mm)", "front": "Z (mm)", "iso": ""}[view], fontsize=8)
    if view == "iso":
        ax.set_xticks([])
        ax.set_yticks([])
        ax.grid(False)
    else:
        ax.grid(True, color="#E6EAEE", linewidth=0.5)


def _title(ax, text, sub=""):
    ax.set_title(text + (f"\n{sub}" if sub else ""), fontsize=10, color="#18242F", loc="left", fontweight="bold")


def _dimension(ax, g: Geometry, view: str):
    """외형 치수선(가로·세로) — 도면 관례대로 바깥쪽에 얇게."""
    pts = [project(p, view) for p in g.nodes.values()]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    pad = 0.06 * max(x1 - x0, y1 - y0, 1)
    ax.annotate("", (x0, y0 - pad), (x1, y0 - pad), arrowprops=dict(arrowstyle="<->", color="#5B6975", lw=0.7))
    ax.text((x0 + x1) / 2, y0 - pad * 1.25, f"{x1 - x0:,.0f}", ha="center", va="top", fontsize=7, color="#34424E")
    ax.annotate("", (x0 - pad, y0), (x0 - pad, y1), arrowprops=dict(arrowstyle="<->", color="#5B6975", lw=0.7))
    ax.text(x0 - pad * 1.25, (y0 + y1) / 2, f"{y1 - y0:,.0f}", ha="right", va="center", fontsize=7, color="#34424E", rotation=90)
    ax.set_xlim(x0 - pad * 3, x1 + pad)
    ax.set_ylim(y0 - pad * 3, y1 + pad)


def _label(ax, occupied, px, py, text, color, fontsize=7):
    """데이터 좌표를 픽셀로 바꿔 겹침 회피 후 리더선 + 박스 라벨."""
    fig = ax.get_figure()
    fig.canvas.draw()
    disp = ax.transData.transform((px, py))
    px_per_pt = DPI / 72.0                       # transform 결과는 dpi 기준 픽셀
    w, h = fontsize * px_per_pt * 0.6 * len(text) + 12, fontsize * px_per_pt * 1.9
    bx, by = place_label(occupied, disp[0], disp[1], w, h)
    dx, dy = ax.transData.inverted().transform((bx + w / 2, by + h / 2))
    ax.annotate(text, (px, py), (dx, dy), fontsize=fontsize, color="#18242F", ha="center", va="center",
                bbox=dict(boxstyle="round,pad=0.25", fc="white", ec=color, lw=0.8),
                arrowprops=dict(arrowstyle="-", color=color, lw=0.7), zorder=6)


def _cog_xyz(d: ReportData):
    c = d.model.cog_mm
    return (c.get("x", 0), c.get("y", 0), c.get("z", 0)) if c else None


# ── 각 그림 ───────────────────────────────────────────────────────────────────
def _render_model(g: Geometry, view: str, d: ReportData) -> bytes:
    fig, ax = _fig()
    _draw_structure(ax, g, view, color="#6B7A88", lw=0.6)
    if view != "iso":
        _dimension(ax, g, view)
    cog = _cog_xyz(d)
    if cog:
        cx, cy = project(cog, view)
        ax.plot(cx, cy, marker=(4, 1, 0), ms=11, color="#D73A49", zorder=5)
        ax.annotate("COG", (cx, cy), (6, 6), textcoords="offset points", fontsize=7, color="#D73A49")
    names = {"plan": "평면도 (Plan, XY)", "side": "측면도 (Side, XZ)", "front": "정면도 (Front, YZ)", "iso": "등각도 (Isometric)"}
    _title(ax, f"해석 모델 — {names[view]}", f"절점 {d.model.node_count:,} · 요소 {d.model.element_count:,}")
    _axis_labels(ax, view)
    return _png(fig)


def _render_hoist(g: Geometry, d: ReportData, view: str) -> bytes:
    fig, ax = _fig(7.2, 5.0)
    _draw_structure(ax, g, view)
    st = d.stability
    for w in st.wires:
        s, e = w.start_mm, w.end_mm
        if not s or not e:
            continue
        p0, p1 = project((s["x"], s["y"], s["z"]), view), project((e["x"], e["y"], e["z"]), view)
        c = group_color(w.group_id)
        ax.plot([p0[0], p1[0]], [p0[1], p1[1]], color=c, lw=1.4, zorder=3)
        ax.plot(*p1, "o", ms=6, color=c, zorder=4)
    for a in st.apexes:
        p = a.get("pointMm") or {}
        px, py = project((p.get("x", 0), p.get("y", 0), p.get("z", 0)), view)
        ax.plot(px, py, "o", ms=9, mfc="white", mec=group_color(a.get("groupId", 1)), mew=1.6, zorder=5)
    cog = _cog_xyz(d)
    if cog:
        cx, cy = project(cog, view)
        ax.plot(cx, cy, marker=(4, 1, 0), ms=12, color="#D73A49", zorder=6)
        if view == "plan" and st.tipping and st.tipping.evaluation_mode == "ConvexPolygon" and len(st.apexes) >= 3:
            pts = [project((a["pointMm"]["x"], a["pointMm"]["y"], 0), "plan") for a in st.apexes]
            hull = _convex_hull(pts)
            hull = hull + hull[:1]
            ax.plot([p[0] for p in hull], [p[1] for p in hull], "--", color="#7653C6", lw=0.9, zorder=2)
    ax.autoscale_view()
    fig.canvas.draw()
    occupied: list = []
    for w in st.wires:
        e = w.end_mm
        if not e:
            continue
        px, py = project((e["x"], e["y"], e["z"]), view)
        _label(ax, occupied, px, py, f"G{w.group_id}·N{w.lug_node_id}·{w.angle_deg:.1f}°", group_color(w.group_id))
    for a in st.apexes:
        p = a["pointMm"]
        px, py = project((p["x"], p["y"], p["z"]), view)
        _label(ax, occupied, px, py, f"HOOK G{a.get('groupId')}", group_color(a.get("groupId", 1)), fontsize=7.5)
    if cog:
        _label(ax, occupied, cx, cy, "COG", "#D73A49")
    handles = [plt.Line2D([], [], color=group_color(i + 1), lw=2, label=f"권상 그룹 G{i + 1}") for i in range(d.identity.group_count)]
    handles.append(plt.Line2D([], [], color=STRUCTURE, lw=2, label="기존 구조"))
    if view == "plan" and st.tipping and st.tipping.evaluation_mode == "ConvexPolygon":
        handles.append(plt.Line2D([], [], color="#7653C6", lw=1, ls="--", label="지지 다각형"))
    ax.legend(handles=handles, fontsize=7, loc="upper right", framealpha=0.95)
    _title(ax, f"권상 배치 — {'평면도' if view == 'plan' else '측면도'}",
           f"{d.identity.lifting_method} · {d.model.total_mass_ton:.3f} ton · 그룹 / 러그 절점 / 슬링각")
    _axis_labels(ax, view)
    return _png(fig)


def _convex_hull(pts):
    pts = sorted(set(pts))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def _render_deformed(g: Geometry, d: ReportData) -> bytes:
    fig, ax = _fig(7.2, 5.0)
    view = "iso"
    _draw_structure(ax, g, view, color="#D5DBE1", lw=0.5)
    disp = {r.node_id: (r.t1, r.t2, r.t3) for r in d.results.all_displacements}
    size = max(d.model.size_mm) or 1.0
    scale = (0.05 * size / d.results.max_displacement_mm) if d.results.max_displacement_mm > 0 else 1.0
    segs, vals = [], []
    for _eid, n1, n2, _pid, _r in g.elements:
        a, b = g.nodes[n1], g.nodes[n2]
        da, db = disp.get(n1, (0, 0, 0)), disp.get(n2, (0, 0, 0))
        pa = tuple(a[i] + da[i] * scale for i in range(3))
        pb = tuple(b[i] + db[i] * scale for i in range(3))
        segs.append([project(pa, view), project(pb, view)])
        vals.append((math.dist((0, 0, 0), da) + math.dist((0, 0, 0), db)) / 2)
    norm = mcolors.Normalize(0, d.results.max_displacement_mm or 1)
    lc = LineCollection(segs, cmap="viridis", norm=norm, linewidths=0.9, zorder=3)
    lc.set_array(vals)
    ax.add_collection(lc)
    ax.autoscale_view()
    cb = fig.colorbar(lc, ax=ax, fraction=0.035, pad=0.02)
    cb.set_label("변위 크기 (mm)", fontsize=8)
    cb.ax.tick_params(labelsize=7)
    nid = d.results.max_displacement_node_id
    if nid in g.nodes:
        dn = disp.get(nid, (0, 0, 0))
        p = tuple(g.nodes[nid][i] + dn[i] * scale for i in range(3))
        px, py = project(p, view)
        ax.plot(px, py, "o", ms=7, mfc="none", mec="#D73A49", mew=1.5, zorder=6)
        _label(ax, [], px, py, f"최대 {d.results.max_displacement_mm:.2f} mm @N{nid}", "#D73A49")
    _title(ax, "변형 형상 (Deformed shape)", f"변형 배율 ×{scale:,.0f} · 회색 = 원형")
    _axis_labels(ax, view)
    return _png(fig)


def _render_stress(g: Geometry, d: ReportData, view: str) -> bytes:
    fig, ax = _fig(7.2, 5.0)
    util = {m.element_id: m.utilization for m in d.results.all_members}
    segs, cols = [], []
    for eid, n1, n2, _pid, _r in g.elements:
        segs.append([project(g.nodes[n1], view), project(g.nodes[n2], view)])
        u = util.get(eid)
        cols.append(NO_RESULT if u is None else (EXCEEDED if u > 1 else RAMP(min(max(u, 0), 1))))
    ax.add_collection(LineCollection(segs, colors=cols, linewidths=1.0, zorder=3))
    ax.autoscale_view()
    sm = plt.cm.ScalarMappable(cmap=RAMP, norm=mcolors.Normalize(0, 1))
    sm.set_array([])
    cb = fig.colorbar(sm, ax=ax, fraction=0.035, pad=0.02, ticks=[0, 0.4, 0.7, 0.85, 1.0])
    cb.set_label(f"활용도 σ/σ허용 (σ허용 = {d.results.allowable_mpa:g} MPa)", fontsize=8)
    cb.ax.tick_params(labelsize=7)
    fig.canvas.draw()
    occupied: list = []
    elem_by_id = {e[0]: e for e in g.elements}
    for m in d.results.governing[:5]:
        el = elem_by_id.get(m.element_id)
        if not el:
            continue
        a, b = g.nodes[el[1]], g.nodes[el[2]]
        px, py = project(tuple((a[i] + b[i]) / 2 for i in range(3)), view)
        _label(ax, occupied, px, py, f"E{m.element_id} {m.stress_mpa:.1f} MPa", EXCEEDED if m.exceeds else "#34424E")
    _title(ax, f"부재 응력 활용도 — {'평면도' if view == 'plan' else '등각도'}",
           f"최대 {d.results.max_stress_mpa:.1f} MPa @E{d.results.max_stress_element_id} · 초과 {d.results.exceed_count}개 · 회색 = 결과 없음")
    _axis_labels(ax, view)
    return _png(fig)


def _render_support(g: Geometry, d: ReportData, view: str) -> bytes:
    fig, ax = _fig(7.2, 5.0)
    _draw_structure(ax, g, view)
    occupied: list = []
    fig.canvas.draw()
    for i, s in enumerate(d.edits.support_beams):
        a, b = g.nodes.get(s.start_node), g.nodes.get(s.end_node)
        if not a or not b:
            continue
        p0, p1 = project(a, view), project(b, view)
        ax.plot([p0[0], p1[0]], [p0[1], p1[1]], color=SUPPORT, lw=2.4, zorder=4)
        _label(ax, occupied, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, f"S{i + 1}·N{s.start_node}–N{s.end_node}", SUPPORT)
    ax.autoscale_view()
    _title(ax, f"가서포트 배치 — {'평면도' if view == 'plan' else '등각도'}", f"가서포트 {len(d.edits.support_beams)}개 (주황)")
    _axis_labels(ax, view)
    return _png(fig)


def _render_histogram(d: ReportData) -> bytes:
    fig, ax = plt.subplots(figsize=(7.2, 3.2), dpi=DPI)
    bins = d.results.utilization_bins
    labels = [f"{lo:.1f}–{hi:.1f}" if math.isfinite(hi) else "≥1.2" for lo, hi, _ in bins]
    counts = [c for _, _, c in bins]
    colors = [EXCEEDED if lo >= 1.0 else RAMP(min(lo + 0.05, 1)) for lo, _, _ in bins]
    ax.bar(labels, counts, color=colors, edgecolor="white")
    for i, c in enumerate(counts):
        if c:
            ax.text(i, c, f"{c:,}", ha="center", va="bottom", fontsize=7)
    ax.axvline(9.5, color=EXCEEDED, ls="--", lw=1)
    ax.text(9.6, max(counts or [1]) * 0.95, "허용 (1.0)", color=EXCEEDED, fontsize=7)
    ax.set_xlabel("활용도 구간", fontsize=8)
    ax.set_ylabel("부재 수", fontsize=8)
    ax.tick_params(labelsize=7)
    ax.set_title(f"부재 활용도 분포 (n = {d.results.member_count:,})", fontsize=10, loc="left", fontweight="bold")
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    return _png(fig)
