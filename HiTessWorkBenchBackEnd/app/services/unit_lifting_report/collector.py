"""Unit 권상 검토 보고서 — 결과 폴더 JSON 을 보고서 데이터 모델로 조립한다.

필수: nastranResult · stability. 나머지(lifting_meta·posture·hoist_optimization·validation·
edited·원본 json·f06)는 없으면 None 으로 두고 warnings 에 남긴다(과거 결과도 보고서가 나오게).
"""
from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from ..hitess_modelflow_service import scan_f06_diagnostics

TON_FORCE_N = 9800.0
GOVERNING_TOP_N = 30
DISPLACEMENT_TOP_N = 10
LIFTING_MODE_LABELS = {"hydro": "Hydro Crane", "goliat": "Goliat Crane", "goliath": "Goliat Crane", "ceiling": "Ceiling Crane"}
STAGE_LABELS = {
    0: "입력 검증·파싱", 1: "권상 형상 분류", 2: "형상 유효성", 3: "정점 좌표 산출",
    4: "슬링 각도", 5: "와이어-구조 간섭", 6: "자세 안정성(전도)", 7: "리깅 하중(SWL)",
}
SUPPORT_REMARK = "가서포트"


# ── 옵션 ─────────────────────────────────────────────────────────────────────
# 결과 레포트 '주의 사항' 5행에 넣을 수 있는 글자 수. 서식의 F~BA 박스(576px)에 12pt 한글이
# 정확히 36자 들어간다 — 이보다 길면 Excel 이 글자를 줄여 다른 줄보다 작아 보인다(사용자 결정).
EXTRA_NOTICE_MAX_CHARS = 36


@dataclass
class ReportOptions:
    hull_no: str = ""
    unit_no: str = ""
    drawing_no: str = ""
    revision: str = "0"
    author: str = ""
    department: str = ""
    contact: str = ""                # 보고서 문의처 '이름/직급/부서' — WorkBench 로그인 사용자에서 채운다
    jig_limit_ton: float = 6.2
    yield_strength_mpa: float = 275.0
    notes: str = ""
    extra_notice: str = ""           # 결과 레포트 '주의 사항' 5행 — 사용자가 모달에 직접 적는 한 줄

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None) -> "ReportOptions":
        p = payload or {}

        def num(key, default):
            try:
                v = float(p.get(key, default))
                return v if math.isfinite(v) and v > 0 else default
            except (TypeError, ValueError):
                return default

        return cls(
            hull_no=str(p.get("hullNo") or "").strip(), unit_no=str(p.get("unitNo") or "").strip(),
            drawing_no=str(p.get("drawingNo") or "").strip(), revision=str(p.get("revision") or "0").strip(),
            author=str(p.get("author") or "").strip(), department=str(p.get("department") or "").strip(),
            contact=str(p.get("contact") or "").strip(),
            jig_limit_ton=num("jigLimitTon", 6.2), yield_strength_mpa=num("yieldStrengthMpa", 275.0),
            notes=str(p.get("notes") or "").strip(),
            # 서식의 주의 사항 칸은 폭이 정해져 있다 — 길면 글자가 줄어 다른 줄보다 작아 보이므로
            # 프런트(maxLength)와 같은 길이로 여기서도 자른다. [[NOTICE_EXTRA_MAX_CHARS]]
            extra_notice=str(p.get("extraNotice") or "").strip()[:EXTRA_NOTICE_MAX_CHARS],
        )


def format_contact(generator: dict | None, fallback: str = "") -> str:
    """보고서 문의처 문자열 — `이름/직급/부서`. 빠진 항목은 건너뛰고, 아무것도 없으면 fallback(사번)."""
    g = generator or {}
    parts = [str(g.get(k) or "").strip() for k in ("name", "position", "department")]
    parts = [p for p in parts if p]
    return "/".join(parts) or str(fallback or "").strip()


# ── 데이터 모델 ───────────────────────────────────────────────────────────────
@dataclass
class Identity:
    title_prefix: str; hull_no: str; unit_no: str; drawing_no: str; revision: str
    author: str; department: str; contact: str; lifting_method: str; equipment: str
    group_count: int; wire_length_m: float; source_bdf: str; edited_model: str
    generated_at: str; engine_version: str; notes: str


@dataclass
class Section:
    pid: int; card: str; kind: str; dims: list; material_id: int; area_mm2: Optional[float]; label: str


@dataclass
class Material:
    mid: int; name: str; e_mpa: float; nu: float; rho: float


@dataclass
class ModelInfo:
    node_count: int; element_count: int; rigid_count: int; point_mass_count: int
    property_count: int; material_count: int
    bbox: dict; size_mm: tuple
    total_mass_ton: float; cog_mm: dict; mass_source: str
    sections: list; materials: list; point_masses: list
    validation_status: Optional[str]; free_end_nodes: Optional[int]; disconnected_groups: Optional[int]


@dataclass
class SupportBeam:
    element_id: int; start_node: int; end_node: int; pid: int; length_mm: float; dims: list


@dataclass
class EditInfo:
    deleted_element_count: int; deleted_rigid_count: int; deleted_node_count: int
    support_beams: list; removed_spc_cards: int; removed_suport_cards: int; trace: list


@dataclass
class HoistGroup:
    group_id: int; node_ids: list; nodes: list; centroid_mm: dict


@dataclass
class HoistInfo:
    groups: list; auto_selected: bool; candidate_count: int; evaluated_count: int
    pass_count: int; warn_count: int; fail_count: int; elapsed_ms: int
    best_label: str; best_score: float; best_metrics: dict; current_metrics: dict


@dataclass
class StageRow:
    stage: int; label: str; status: str; key_metric: str; note: str


@dataclass
class WireGeom:
    group_id: int; lug_node_id: int; length_mm: float; angle_deg: float; safe: bool; status: str
    start_mm: dict; end_mm: dict


@dataclass
class Tipping:
    evaluation_mode: str; is_stable: bool; margin_mm: float; interior_margin_mm: float
    deviation_mm: float; threshold_mm: float; cog_inside: bool; tilt_deg: float; apex_to_cog_mm: float


@dataclass
class StabilityInfo:
    overall_status: str; overall_label: str; primary_message: str
    stage_rows: list; apexes: list; wires: list
    min_sling_angle_deg: Optional[float]; interference_count: int; min_clearance_mm: Optional[float]
    tipping: Optional[Tipping]; strict_evaluation: bool; shape_gate_relaxed: bool
    warnings: list; critical: list


@dataclass
class LoadInfo:
    safety_factor: float; gravity_mm_s2: float; total_load_ton: float
    wire_pid: int; wire_mid: int; wire_area_mm2: float; wire_j_mm4: float; wire_e_mpa: float
    wire_pid_remapped: bool; wire_mid_remapped: bool
    spc_sid: int; spc_components: str; anchor_node_id: Optional[int]; anchor_components: str
    anchor_distance_mm: Optional[float]; stabilization_cards: list; stabilization_reason: str
    grav_sid: int; load_sid: int; subcase_id: int
    f06: dict; solver: str


@dataclass
class MemberRow:
    element_id: int; pid: Optional[int]; section_label: str; stress_mpa: float; utilization: Optional[float]; exceeds: bool


@dataclass
class PidSummary:
    pid: int; section_label: str; count: int; max_stress_mpa: float; max_utilization: float; governing_element_id: int


@dataclass
class DispRow:
    node_id: int; t1: float; t2: float; t3: float; magnitude: float


@dataclass
class WireRow:
    wire_element_id: int; group_id: int; lug_node_id: int; axial_force_n: float; tension_ton: float
    angle_deg: Optional[float]; vertical_ton: Optional[float]; needs_jig: bool; is_compression: bool; is_slack: bool


@dataclass
class HookTotal:
    group_id: int; wire_count: int; tension_ton: float; vertical_ton: float


@dataclass
class ResultInfo:
    allowable_mpa: float; yield_mpa: float
    max_stress_mpa: float; max_stress_element_id: Optional[int]; member_count: int; exceed_count: int
    max_displacement_mm: float; max_displacement_node_id: Optional[int]; max_displacement_components: tuple
    governing: list; exceeding: list; all_members: list
    pid_summary: list; utilization_bins: list
    top_displacements: list; all_displacements: list
    wires: list; hook_totals: list; hook_check_error_pct: Optional[float]
    wire_compression_count: int; wire_missing_count: int


@dataclass
class Verdicts:
    structure: str; stability: str; jig_required: bool; actions: list


@dataclass
class Geometry:
    nodes: dict                      # id -> (x, y, z)
    elements: list                   # (id, n1, n2, pid, remark)
    center: tuple
    orientations: dict = field(default_factory=dict)   # id -> (vx, vy, vz) CBEAM 방향 벡터(3D 솔리드용)


@dataclass
class ReportData:
    identity: Identity; model: ModelInfo; edits: Optional[EditInfo]; hoist: Optional[HoistInfo]
    stability: StabilityInfo; loads: LoadInfo; results: ResultInfo; verdicts: Verdicts
    geometry: Optional[Geometry]; options: ReportOptions; warnings: list = field(default_factory=list)


# ── 진입점 ────────────────────────────────────────────────────────────────────
def collect(result_info: dict[str, Any], options: ReportOptions, generated_at: str = "") -> ReportData:
    warnings: list[str] = []
    result_path = _require(result_info.get("nastranResultJson"), "구조 해석 결과(nastranResultJson)")
    stability_path = _require(result_info.get("stabilityJson"), "자세안정성 결과(stabilityJson)")
    folder = os.path.dirname(result_path)
    stem = _stem_of(result_path)

    result = _load_json(result_path)
    stability = _load_json(stability_path)
    meta_path = result_info.get("liftingMetaJson") or _sib(folder, stem, "_lifting_meta.json")
    lifting_meta = _optional(meta_path, "lifting_meta", warnings)
    posture = _optional(_sib(folder, stem, "_posture.json"), "posture", warnings)
    hoist_opt = _optional(_sib(folder, stem, "_hoist_optimization.json"), "hoist_optimization", warnings)
    validation = _optional(_sib(folder, stem, "_validation_step1.json"), "validation_step1", warnings)
    edited = _optional(_sib(folder, stem, "_edited.json"), "edited 모델", warnings)
    original = _optional(_sib(folder, stem, ".json"), "원본 모델 json", warnings, quiet=True)
    model_json = edited or original

    geometry = _geometry(model_json) if model_json else None
    identity = _identity(options, result_info, stability, posture, lifting_meta, generated_at)
    model = _model(model_json, stability, posture, validation)
    edits = _edits(original, edited, lifting_meta) if (edited and original) else None
    hoist = _hoist(posture, hoist_opt, stability) if hoist_opt else None
    stab = _stability(stability, posture)
    loads = _loads(lifting_meta, result, stability, folder, stem)
    results = _results(result, stability, stab, options, geometry, model)
    verdicts = _verdicts(results, stab, options)
    return ReportData(identity, model, edits, hoist, stab, loads, results, verdicts, geometry, options, warnings)


# ── 파일 탐색 ─────────────────────────────────────────────────────────────────
def _require(path, label):
    if not path or not os.path.isfile(path):
        raise FileNotFoundError(f"{label} 파일을 찾을 수 없습니다: {path}")
    return os.path.abspath(path)


def _stem_of(result_path: str) -> str:
    name = os.path.basename(result_path)
    for suffix in ("_lifting_nastranResult.json", "_nastranResult.json", ".json"):
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return os.path.splitext(name)[0]


def _sib(folder: str, stem: str, suffix: str) -> str:
    return os.path.join(folder, f"{stem}{suffix}")


def _load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _optional(path, label, warnings, quiet=False):
    if path and os.path.isfile(path):
        try:
            return _load_json(path)
        except Exception as exc:  # 깨진 파일은 없는 것으로 취급
            warnings.append(f"{label} 파일을 읽지 못했습니다({os.path.basename(path)}): {exc}")
            return None
    if not quiet:
        warnings.append(f"{label} 파일이 없어 해당 절은 '자료 없음'으로 기록했습니다.")
    return None


# ── 조립 ─────────────────────────────────────────────────────────────────────
def _identity(o: ReportOptions, info, stability, posture, meta, generated_at) -> Identity:
    src = info.get("bdf") or ((meta or {}).get("meta") or {}).get("sourceBdf") or ""
    hull, unit = _parse_ids(src)
    inp = stability.get("input") or {}
    mode = inp.get("liftingMode") or {}
    mode_id = str(mode.get("id") or "").lower()
    method = LIFTING_MODE_LABELS.get(mode_id) or str(mode.get("label") or "-")
    equipment = str((((posture or {}).get("hoisting") or {}).get("mode") or {}).get("equipment") or "")
    return Identity(
        title_prefix=_title_prefix(info), hull_no=o.hull_no or hull or "-", unit_no=o.unit_no or unit or "-",
        drawing_no=o.drawing_no or "-", revision=o.revision or "0", author=o.author or "-",
        department=o.department or "-", contact=o.contact or o.author or "-",
        lifting_method=method, equipment=equipment,
        group_count=int(inp.get("groupCount") or 0), wire_length_m=float(inp.get("wireLengthM") or 0),
        source_bdf=os.path.basename(src),
        edited_model=str(((stability.get("meta") or {}).get("sourceFiles") or {}).get("model") or ""),
        generated_at=generated_at, engine_version=str((stability.get("meta") or {}).get("engineVersion") or ""),
        notes=o.notes,
    )


# result_info["projectKind"] (= 부모 Analysis.program_name) → 보고서 표지·파일명의 제목 머리말.
# 같은 결과 스키마를 Module Unit 과 Side Passage 가 함께 쓰므로, 어느 쪽 프로젝트인지는
# 결과 JSON 이 아니라 부모 레코드만 안다. 없으면 폴더 이름으로 추정한다(과거 기록 호환).
_TITLE_PREFIX_BY_PROJECT = {
    "sidepassage": "Side Passage",
    "groupmoduleunit": "Module Unit",
}


def _title_prefix(info) -> str:
    kind = re.sub(r"[^a-z]", "", str(info.get("projectKind") or "").lower())
    if kind in _TITLE_PREFIX_BY_PROJECT:
        return _TITLE_PREFIX_BY_PROJECT[kind]
    folder = re.sub(r"[^a-z]", "", str(info.get("bdf") or "").lower())
    if "sidepassage" in folder:
        return "Side Passage"
    return "Group Unit" if str(info.get("analysisType") or "").lower().startswith("group") else "Module Unit"


def _parse_ids(path: str):
    m = re.search(r"(?<!\d)(\d{4})[-_](\d{5})(?!\d)", os.path.basename(path or ""))
    return (m.group(1), m.group(2)) if m else (None, None)


def _geometry(mj: dict) -> Geometry:
    nodes = {int(n["id"]): (float(n["x"]), float(n["y"]), float(n["z"])) for n in mj.get("nodes", [])}
    elements, orientations = [], {}
    for e in mj.get("elements", []):
        if e.get("startNode") not in nodes or e.get("endNode") not in nodes:
            continue
        eid = int(e["id"])
        elements.append((eid, int(e["startNode"]), int(e["endNode"]), e.get("propertyId"), str(e.get("remark") or "")))
        ori = e.get("orientation") or [0, 0, 1]
        try:
            orientations[eid] = (float(ori[0]), float(ori[1]), float(ori[2]))
        except (TypeError, ValueError, IndexError):
            orientations[eid] = (0.0, 0.0, 1.0)
    if nodes:
        xs, ys, zs = zip(*nodes.values())
        center = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2)
    else:
        center = (0.0, 0.0, 0.0)
    return Geometry(nodes, elements, center, orientations)


def _section_label(p: dict) -> str:
    dims = ", ".join(_fmt(d) for d in (p.get("dims") or []))
    return f"{p.get('card', '')} {p.get('kind', '')} [{dims}]".strip()


def _section_area(p: dict) -> Optional[float]:
    try:
        from ..bdf_mass_properties import cross_section_area_mm2
        return cross_section_area_mm2(p)
    except Exception:
        return None


def _model(mj, stability, posture, validation) -> ModelInfo:
    inp = stability.get("input") or {}
    pm = (posture or {}).get("model") or {}
    ps = (validation or {}).get("parsingSummary") or {}
    counts = ps.get("cardCounts") or {}
    bbox = inp.get("modelBboxMm") or pm.get("bboxMm") or {}
    b = {k: float(bbox.get(k) or 0) for k in ("minX", "maxX", "minY", "maxY", "minZ", "maxZ")}
    if not any(b.values()) and ps.get("boundingBox"):
        bb = ps["boundingBox"]
        b = {"minX": bb["xMin"], "maxX": bb["xMax"], "minY": bb["yMin"], "maxY": bb["yMax"], "minZ": bb["zMin"], "maxZ": bb["zMax"]}
    sections = [Section(int(p["id"]), p.get("card", ""), p.get("kind", ""), list(p.get("dims") or []), int(p.get("materialId") or 0),
                        _section_area(p), _section_label(p)) for p in (mj or {}).get("properties", [])]
    materials = [Material(int(m["id"]), str(m.get("name") or ""), float(m.get("E") or 0), float(m.get("nu") or 0), float(m.get("rho") or 0))
                 for m in (mj or {}).get("materials", [])]
    return ModelInfo(
        node_count=int(counts.get("grid") or pm.get("nodeCount") or len((mj or {}).get("nodes", []))),
        element_count=int(counts.get("element") or len((mj or {}).get("elements", []))),
        rigid_count=len((mj or {}).get("rigids", [])),
        point_mass_count=int(counts.get("pointMass") or len((mj or {}).get("pointMasses", []))),
        property_count=len(sections), material_count=len(materials), bbox=b,
        size_mm=(b["maxX"] - b["minX"], b["maxY"] - b["minY"], b["maxZ"] - b["minZ"]),
        total_mass_ton=float(inp.get("totalMassTon") or pm.get("totalMassTon") or 0),
        cog_mm=inp.get("centerOfGravityMm") or pm.get("centerOfGravityMm") or {}, mass_source=str(inp.get("massSource") or ""),
        sections=sections, materials=materials, point_masses=list((mj or {}).get("pointMasses", [])),
        validation_status=(validation or {}).get("status"), free_end_nodes=ps.get("freeEndNodes"),
        disconnected_groups=ps.get("disconnectedGroupCount"),
    )


def _edits(original, edited, meta) -> EditInfo:
    o_el = {int(e["id"]) for e in original.get("elements", [])}
    e_el = {int(e["id"]) for e in edited.get("elements", [])}
    o_rg = {int(r["id"]) for r in original.get("rigids", [])}
    e_rg = {int(r["id"]) for r in edited.get("rigids", [])}
    o_nd = {int(n["id"]) for n in original.get("nodes", [])}
    e_nd = {int(n["id"]) for n in edited.get("nodes", [])}
    nodes = {int(n["id"]): n for n in edited.get("nodes", [])}
    props = {int(p["id"]): p for p in edited.get("properties", [])}
    supports = []
    for e in edited.get("elements", []):
        if str(e.get("remark") or "") != SUPPORT_REMARK:
            continue
        a, b = nodes.get(e["startNode"]), nodes.get(e["endNode"])
        length = math.dist((a["x"], a["y"], a["z"]), (b["x"], b["y"], b["z"])) if a and b else float(e.get("lengthMm") or 0)
        supports.append(SupportBeam(int(e["id"]), int(e["startNode"]), int(e["endNode"]), int(e.get("propertyId") or 0), length,
                                    list((props.get(e.get("propertyId")) or {}).get("dims") or [])))
    stripped = ((meta or {}).get("lifting") or {}).get("strippedOriginalConstraints") or {}
    return EditInfo(
        deleted_element_count=len(o_el - e_el), deleted_rigid_count=len(o_rg - e_rg), deleted_node_count=len(o_nd - e_nd),
        support_beams=supports, removed_spc_cards=int(stripped.get("spcCardCount") or 0),
        removed_suport_cards=int(stripped.get("suportCardCount") or 0), trace=list(edited.get("trace") or []),
    )


def _hoist(posture, opt, stability) -> HoistInfo:
    groups = []
    for g in (((posture or {}).get("hoisting") or {}).get("groups") or []):
        groups.append(HoistGroup(int(g["id"]), [int(n["id"]) for n in g.get("nodes", [])], list(g.get("nodes", [])), g.get("centroidMm") or {}))
    if not groups:
        for g in (stability.get("input") or {}).get("groups") or []:
            groups.append(HoistGroup(int(g["groupId"]), [int(i) for i in g.get("nodeIds", [])], [], {}))
    best = opt.get("Best") or {}
    best_sets = sorted(sorted(int(i) for i in g.get("NodeIds", [])) for g in best.get("Groups", []))
    cur_sets = sorted(sorted(g.node_ids) for g in groups)
    trace = opt.get("SearchTrace") or {}
    return HoistInfo(
        groups=groups, auto_selected=bool(best_sets) and best_sets == cur_sets,
        candidate_count=int(opt.get("CandidateCount") or 0), evaluated_count=int(opt.get("EvaluatedCount") or 0),
        pass_count=int(trace.get("PassCount") or 0), warn_count=int(trace.get("WarnCount") or 0), fail_count=int(trace.get("FailCount") or 0),
        elapsed_ms=int(trace.get("ElapsedMs") or 0), best_label=str(best.get("Label") or ""), best_score=float(best.get("Score") or 0),
        best_metrics=dict(best.get("Metrics") or {}), current_metrics=dict((opt.get("Current") or {}).get("Metrics") or {}),
    )


def _stage_metric(stage: int, s: dict) -> str:
    if stage == 0:
        return f"그룹 {s.get('groupCount', '-')}개 · 와이어 {_fmt(s.get('wireLengthMm'))} mm · 경고 {s.get('warnings', 0)}"
    if stage in (1, 2):
        return f"{s.get('passed', '-')}/{s.get('totalGroups', '-')} 그룹 통과"
    if stage == 3:
        return f"정점 {s.get('finalApexCount', '-')}개" + (" · Trolley 분할" if s.get("trolleySplitApplied") else "")
    if stage == 4:
        return (f"최소 슬링각 {_fmt(s.get('minAngleDeg'))}° (G{s.get('minAngleAtGroupId', '-')}/N{s.get('minAngleAtLugNodeId', '-')})"
                f" · 장력계수 {_fmt(s.get('maxTensionFactor'))}")
    if stage == 5:
        return f"간섭 {s.get('conflictCount', 0)}건 · 최소 이격 {_fmt(s.get('minClearanceMm'))} mm"
    if stage == 6:
        return (f"{s.get('evaluationMode', '-')} · 여유 {_fmt(s.get('marginMm'))} mm · 편차 {_fmt(s.get('deviationMm'))} mm"
                f" · 경사 {_fmt(s.get('tiltAngleDeg'))}°")
    if stage == 7:
        return str(s.get("skipped") or "-")
    return "-"


def _stability(st: dict, posture) -> StabilityInfo:
    rows, relaxed = [], False
    stages = st.get("stages") or []
    for stg in stages:
        s = stg.get("summary") or {}
        n = int(stg.get("stage"))
        relaxed = relaxed or bool(s.get("shapeGateRelaxed"))
        note = ""
        if n == 5 and s.get("conflictCount"):
            note = "경로 확인 필요"
        if n in (1, 2) and s.get("shapeGateRelaxed"):
            note = "Strict OFF 로 완화 판정"
        # 표 열 폭에 맞는 짧은 표준 이름을 쓴다(엔진 displayLabel 은 "5단계 · 와이어-구조물 간섭 검사" 로 길다).
        rows.append(StageRow(n, STAGE_LABELS.get(n) or str(stg.get("displayLabel") or ""),
                             str(stg.get("status") or "-"), _stage_metric(n, s), note))
    viz = st.get("visualization") or {}
    wires = [WireGeom(int(w.get("groupId") or 0), int(w.get("lugNodeId") or 0), float(w.get("lengthMm") or 0), float(w.get("angleDeg") or 0),
                      bool(w.get("safe", True)), str(w.get("status") or ""), w.get("startMm") or {}, w.get("endMm") or {})
             for w in viz.get("wires") or []]

    def summary_of(k):
        return next((x.get("summary") or {} for x in stages if x.get("stage") == k), None)

    s4, s5, s6 = summary_of(4) or {}, summary_of(5) or {}, summary_of(6)
    tipping = Tipping(str(s6.get("evaluationMode") or ""), bool(s6.get("isStable")), float(s6.get("marginMm") or 0),
                      float(s6.get("interiorMarginMm") or 0), float(s6.get("deviationMm") or 0), float(s6.get("thresholdMm") or 0),
                      bool(s6.get("cogInsideHull")), float(s6.get("tiltAngleDeg") or 0), float(s6.get("apexToCogHeightMm") or 0)) if s6 else None
    ov = st.get("overall") or {}
    us = ov.get("userSummary") or {}
    return StabilityInfo(
        overall_status=str(ov.get("status") or "-"), overall_label=str(us.get("statusLabel") or ""),
        primary_message=str(us.get("primaryMessage") or ""), stage_rows=rows, apexes=list(viz.get("apexes") or []), wires=wires,
        min_sling_angle_deg=_num(s4.get("minAngleDeg")), interference_count=int(s5.get("conflictCount") or 0),
        min_clearance_mm=_num(s5.get("minClearanceMm")), tipping=tipping,
        strict_evaluation=bool((posture or {}).get("strictEvaluation", False)), shape_gate_relaxed=relaxed,
        warnings=list(us.get("warnings") or []), critical=list(us.get("criticalIssues") or []),
    )


def _loads(meta, result, stability, folder, stem) -> LoadInfo:
    lf = (meta or {}).get("lifting") or {}
    rl = result.get("lifting") or {}
    wp, wm = lf.get("wireProperty") or {}, lf.get("wireMaterial") or {}
    anchor = lf.get("antiRigidBodyAnchor") or {}
    stab = lf.get("stabilizationParams") or {}
    sf = float(lf.get("safetyFactor") or rl.get("safetyFactor") or 1.0)
    mass = float((stability.get("input") or {}).get("totalMassTon") or 0)
    f06_path = (result.get("meta") or {}).get("f06Path") or ""
    if not os.path.isfile(f06_path):
        cand = os.path.join(folder, f"{stem}_lifting.f06")
        f06_path = cand if os.path.isfile(cand) else _first_f06(folder)
    return LoadInfo(
        safety_factor=sf, gravity_mm_s2=float(lf.get("gravityMagMm") or 9800.0), total_load_ton=mass * sf,
        wire_pid=int(wp.get("propertyId") or rl.get("wirePropertyId") or 0), wire_mid=int(wm.get("materialId") or rl.get("wireMaterialId") or 0),
        wire_area_mm2=float(wp.get("areaMm2") or 0), wire_j_mm4=float(wp.get("jMm4") or 0), wire_e_mpa=float(wm.get("eMPa") or 0),
        wire_pid_remapped=bool(wp.get("remappedFromConflict")), wire_mid_remapped=bool(wm.get("remappedFromConflict")),
        spc_sid=int(lf.get("spcSid") or 0), spc_components=str(lf.get("spcComponents") or ""), anchor_node_id=anchor.get("nodeId"),
        anchor_components=str(anchor.get("components") or ""), anchor_distance_mm=_num(anchor.get("selectedDistanceMm")),
        stabilization_cards=list(stab.get("cards") or []), stabilization_reason=str(stab.get("reason") or ""),
        grav_sid=int(lf.get("gravSid") or 0), load_sid=int(lf.get("loadSid") or 0),
        subcase_id=int((result.get("summary") or {}).get("subcaseId") or 1),
        f06=scan_f06_diagnostics(f06_path) if f06_path else {"available": False}, solver="MSC Nastran SOL 101 (선형 정적)",
    )


def _first_f06(folder):
    try:
        return next((os.path.join(folder, f) for f in sorted(os.listdir(folder)) if f.lower().endswith("_lifting.f06")), "")
    except OSError:
        return ""


def _results(result, stability, stab: StabilityInfo, o: ReportOptions, geom: Optional[Geometry], model: ModelInfo) -> ResultInfo:
    ev, sm = result.get("evaluation") or {}, result.get("summary") or {}
    allowable_given = _num(ev.get("structuralAllowableMPa"))
    allowable = allowable_given or o.yield_strength_mpa * 0.8
    yield_mpa = allowable / 0.8 if allowable_given else o.yield_strength_mpa
    pid_of = {e[0]: e[3] for e in (geom.elements if geom else [])}
    label_of = {s.pid: s.label for s in model.sections}
    members = []
    for m in result.get("members") or []:
        pid = pid_of.get(int(m["elementId"]))
        members.append(MemberRow(int(m["elementId"]), pid, label_of.get(pid, f"PID {pid}" if pid else "-"),
                                 float(m.get("maxStressMPa") or 0), _num(m.get("utilization")), bool(m.get("exceedsLimit"))))
    members.sort(key=lambda r: -(r.utilization if r.utilization is not None else -1))
    exceeding = [r for r in members if r.exceeds or (r.utilization or 0) > 1.0]
    by_pid: dict[int, list[MemberRow]] = {}
    for r in members:
        if r.pid is not None:
            by_pid.setdefault(r.pid, []).append(r)
    pid_summary = [PidSummary(pid, rows[0].section_label, len(rows), max(r.stress_mpa for r in rows),
                              max((r.utilization or 0) for r in rows), rows[0].element_id) for pid, rows in sorted(by_pid.items())]
    edges = [i * 0.1 for i in range(13)]
    bins = [(lo, hi, sum(1 for r in members if r.utilization is not None and lo <= r.utilization < hi)) for lo, hi in zip(edges[:-1], edges[1:])]
    bins.append((1.2, math.inf, sum(1 for r in members if (r.utilization or 0) >= 1.2)))
    disp = [DispRow(int(d["nodeId"]), float(d.get("t1") or 0), float(d.get("t2") or 0), float(d.get("t3") or 0), float(d.get("magnitude") or 0))
            for d in result.get("displacements") or []]
    disp.sort(key=lambda d: -d.magnitude)
    max_disp = _num(sm.get("maxDisplacementMag"))
    if max_disp is None:
        max_disp = disp[0].magnitude if disp else 0.0
    max_node = sm.get("maxDisplacementNodeId") or (disp[0].node_id if disp else None)
    top = next((d for d in disp if d.node_id == max_node), disp[0] if disp else None)
    angles = {(w.group_id, w.lug_node_id): w.angle_deg for w in stab.wires}
    wires: list[WireRow] = []
    for w in result.get("wires") or []:
        f = float(w.get("axialForceN") or 0)
        t = abs(f) / TON_FORCE_N
        ang = angles.get((int(w.get("groupId") or 0), int(w.get("lugNodeId") or 0)))
        vert = t * math.sin(math.radians(ang)) if ang is not None else None
        wires.append(WireRow(int(w.get("wireElementId") or 0), int(w.get("groupId") or 0), int(w.get("lugNodeId") or 0), f, t, ang, vert,
                             t > o.jig_limit_ton, bool(w.get("isCompression")), bool(w.get("isSlack"))))
    wires.sort(key=lambda w: (w.group_id, w.lug_node_id))
    totals = []
    for gid in sorted({w.group_id for w in wires}):
        ws = [w for w in wires if w.group_id == gid]
        totals.append(HookTotal(gid, len(ws), sum(w.tension_ton for w in ws), sum(w.vertical_ton or 0 for w in ws)))
    mass = float((stability.get("input") or {}).get("totalMassTon") or 0)
    sf = float((result.get("lifting") or {}).get("safetyFactor") or 1.0)
    total_load = mass * sf
    check = ((sum(h.vertical_ton for h in totals) / total_load) - 1) * 100 if total_load > 0 and totals else None
    return ResultInfo(
        allowable_mpa=allowable, yield_mpa=yield_mpa,
        max_stress_mpa=float(sm.get("memberMaxStressMPa") or (members[0].stress_mpa if members else 0)),
        max_stress_element_id=sm.get("memberMaxStressElementId") or (members[0].element_id if members else None),
        member_count=int(sm.get("memberElementCount") or len(members)), exceed_count=int(sm.get("memberExceedCount") or len(exceeding)),
        max_displacement_mm=float(max_disp or 0), max_displacement_node_id=max_node,
        max_displacement_components=(top.t1, top.t2, top.t3) if top else (0.0, 0.0, 0.0),
        governing=members[:GOVERNING_TOP_N], exceeding=exceeding, all_members=members, pid_summary=pid_summary, utilization_bins=bins,
        top_displacements=disp[:DISPLACEMENT_TOP_N], all_displacements=disp, wires=wires, hook_totals=totals, hook_check_error_pct=check,
        wire_compression_count=int(sm.get("wireCompressionCount") or 0), wire_missing_count=int(sm.get("wireMissingResultCount") or 0),
    )


def _verdicts(r: ResultInfo, s: StabilityInfo, o: ReportOptions) -> Verdicts:
    actions: list[str] = []
    if r.member_count == 0:
        structure = "판정 불가"
        actions.append("부재 응력 결과가 없습니다 — 해석 로그(F06)를 확인하십시오.")
    elif r.exceeding:
        structure = "NG"
        actions.append(f"허용응력 초과 부재 {len(r.exceeding)}개 — 단면 보강 또는 권상 위치 재검토가 필요합니다.")
    else:
        structure = "OK"
    jig = any(w.needs_jig for w in r.wires)
    if jig:
        actions.append(f"와이어 장력이 지그 기준 {o.jig_limit_ton:g} ton 을 초과하는 러그가 있습니다 — 국부 변형 방지 지그를 설치하십시오.")
    if r.wire_compression_count or any(w.is_slack for w in r.wires):
        actions.append("압축 또는 슬랙 상태의 와이어가 있습니다 — 권상 자세와 와이어 길이를 재검토하십시오.")
    if s.overall_status == "fail":
        actions.append("자세안정성 FAIL — 권상 위치를 변경하기 전에는 권상할 수 없습니다.")
    for w in s.warnings[:5]:
        actions.append(f"[{w.get('target', '')}] {w.get('headline', '')}")
    return Verdicts(structure, s.overall_status, jig, actions)


# ── 유틸 ─────────────────────────────────────────────────────────────────────
def _num(v) -> Optional[float]:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _fmt(v, nd=2) -> str:
    f = _num(v)
    if f is None:
        return "-"
    if abs(f) < 1e-9:
        return "0"
    return f"{f:,.{nd}f}".rstrip("0").rstrip(".")
