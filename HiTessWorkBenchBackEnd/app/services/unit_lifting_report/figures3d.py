"""보고서용 3D 그림 세트 — `solid3d` 저수준 렌더를 보고서 데이터에 엮는다.

결과 레포트(사내 서식)와 상세 레포트가 같은 그림을 쓴다:

  modelTop / modelHome  권상 위치(지시 핀 + 그룹 라벨) + COG 를 얹은 모델
  displacement          변형 형상(자동 배율) + 변위 컬러바
  stress                부재 응력 활용도 + 컬러바
  supportTop / supportHome  가서포트 강조(있을 때만)
"""
from __future__ import annotations

from typing import Optional

import matplotlib
from matplotlib import cm, colors as mcolors

from .collector import ReportData
from .figures import EXCEEDED, NO_RESULT, RAMP, group_color
from . import solid3d as S3

SUPPORT_RGB = mcolors.to_rgb("#E07A16")
DEFORM_RATIO = 0.05          # 최대 변위가 모델 최대 치수의 5% 가 되도록 배율을 잡는다
# 사내 서식의 캡처 자리는 1243×719px (비율 1.73). 같은 비율로 렌더해야 자리를 꽉 채운다.
SLOT_W_IN, SLOT_H_IN = 7.2, 4.16


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
            matplotlib.pyplot.close("all")
    return figs, errors


# ── 개별 그림 ─────────────────────────────────────────────────────────────────
def _pin_size(data: ReportData) -> tuple[float, float]:
    span = max(data.model.size_mm) or 1000.0
    return span * 0.016, data.model.bbox.get("maxZ", 0.0) + span * 0.03


def render_hoist_model(data: ReportData, view: str) -> bytes:
    """권상 위치 지시 핀과 COG 를 얹은 모델. 설명서의 Top View / Home View 자리."""
    g = data.geometry
    beam = S3.build_mesh(g, data.model.sections)
    size, top_z = _pin_size(data)
    parts, per, labels = [beam], {}, []
    next_id = -1
    groups = data.hoist.groups if data.hoist else []
    for grp in groups:
        pts = [(n["x"], n["y"], n["z"]) for n in grp.nodes if "x" in n]
        if not pts:
            pts = [g.nodes[nid] for nid in grp.node_ids if nid in g.nodes]
        if not pts:
            continue
        parts.append(S3.pin_mesh(pts, top_z, size, start_id=next_id))
        rgb = mcolors.to_rgb(group_color(grp.group_id))
        for k in range(len(pts)):
            per[next_id - k] = rgb
        next_id -= len(pts)
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        labels.append(((cx, cy, top_z + size * 1.6), group_color(grp.group_id), f"Group_{grp.group_id}"))
    cog = data.model.cog_mm
    if cog:
        parts.append(S3.pin_mesh([(cog.get("x", 0), cog.get("y", 0), cog.get("z", 0))], top_z, size, start_id=next_id))
        per[next_id] = mcolors.to_rgb(S3.COG_COLOR)
        labels.append(((cog.get("x", 0), cog.get("y", 0), top_z + size * 1.6), S3.COG_COLOR, "COG"))
    mesh = S3.concat(*parts)
    colors = S3.face_colors(mesh, per_element=per, missing_rgb=S3.STEEL_RGB)
    return S3.render(mesh, colors, view, markers=labels, width_in=SLOT_W_IN, height_in=SLOT_H_IN)


def render_model_solid(data: ReportData, view: str = "home") -> bytes:
    """마커 없는 해석 모델 등각도 — 상세 보고서 2.1절용."""
    mesh = S3.build_mesh(data.geometry, data.model.sections)
    colors = S3.face_colors(mesh)
    return S3.render(mesh, colors, view, width_in=SLOT_W_IN, height_in=SLOT_H_IN)


def deform_scale(data: ReportData) -> float:
    span = max(data.model.size_mm) or 1000.0
    return (DEFORM_RATIO * span / data.results.max_displacement_mm) if data.results.max_displacement_mm > 0 else 1.0


def render_displacement(data: ReportData, view: str = "home") -> bytes:
    """변형 형상 — 절점 변위를 배율만큼 부풀린 좌표로 다시 세운다."""
    g = data.geometry
    scale = deform_scale(data)
    mesh = S3.build_mesh(g, data.model.sections,
                         node_pos=S3.deformed_nodes(g, data.results.all_displacements, scale))
    mags = {r.node_id: abs(r.magnitude) for r in data.results.all_displacements}
    values = {eid: (mags.get(n1, 0.0) + mags.get(n2, 0.0)) / 2 for eid, n1, n2, _pid, _r in g.elements}
    norm = mcolors.Normalize(0.0, data.results.max_displacement_mm or 1.0)
    per = S3.value_colors(values, cm.viridis, norm)
    colors = S3.face_colors(mesh, per_element=per, missing_rgb=mcolors.to_rgb(NO_RESULT))
    return S3.render(mesh, colors, view, colorbar=(cm.viridis, norm, "변위 [mm]"),
                     width_in=SLOT_W_IN, height_in=SLOT_H_IN)


def render_stress(data: ReportData, view: str = "home") -> bytes:
    """부재 응력 활용도 — Studio stressColorRamp 와 같은 색 구간."""
    mesh = S3.build_mesh(data.geometry, data.model.sections)
    values = {m.element_id: m.utilization for m in data.results.all_members if m.utilization is not None}
    norm = mcolors.Normalize(0.0, 1.0)
    per = S3.value_colors(values, RAMP, norm, over_rgb=mcolors.to_rgb(EXCEEDED))
    colors = S3.face_colors(mesh, per_element=per, missing_rgb=mcolors.to_rgb(NO_RESULT))
    return S3.render(mesh, colors, view, colorbar=(RAMP, norm, "활용도 σ/σ허용"),
                     width_in=SLOT_W_IN, height_in=SLOT_H_IN)


def render_support(data: ReportData, view: str = "home") -> bytes:
    """가서포트만 주황으로 강조하고 나머지는 강재색."""
    mesh = S3.build_mesh(data.geometry, data.model.sections)
    per = {sb.element_id: SUPPORT_RGB for sb in data.edits.support_beams}
    colors = S3.face_colors(mesh, per_element=per, missing_rgb=S3.STEEL_RGB)
    size, top_z = _pin_size(data)
    labels = []
    for k, sb in enumerate(data.edits.support_beams):
        a, b = data.geometry.nodes.get(sb.start_node), data.geometry.nodes.get(sb.end_node)
        if a and b:
            mid = tuple((a[i] + b[i]) / 2 for i in range(3))
            labels.append(((mid[0], mid[1], mid[2] + size), "#E07A16", f"S{k + 1}"))
    return S3.render(mesh, colors, view, markers=labels, width_in=SLOT_W_IN, height_in=SLOT_H_IN)
