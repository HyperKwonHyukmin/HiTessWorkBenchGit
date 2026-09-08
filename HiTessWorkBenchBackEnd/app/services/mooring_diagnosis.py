"""Mooring Fitting 진단 — 증거(fact)에 임계값·우선순위·문장 템플릿을 적용하는 순수 함수.

C# 엔진(MooringFitting.exe)은 MODEL_EVIDENCE.json / solve 결과 JSON / EQUILIBRIUM.json 으로
"사실"만 조인해서 낸다. 이 모듈은 그 사실에 임계값과 한국어 문장을 입혀 "왜 이 부재가
과대응력인가"를 사용자에게 근거 수치와 함께 설명한다. 판정을 엔진이 아니라 여기(백엔드)에
둔 이유는 임계값·문구가 자주 바뀌는데, 엔진에 두면 바꿀 때마다 exe 재빌드 + 사내 서버
수동 교체가 붙기 때문이다.

설계 원칙:
  1. 근거 수치를 문장에 항상 붙인다 — 판정을 검증할 수 있어야 판정을 믿는다.
  2. 모델 결함(가짜 부재·경계조건 인공물)을 단면 부족보다 먼저 본다 — 순서를 뒤집으면
     원 도면에 없는 가짜 부재를 "단면을 키우라"고 답하는, 가장 비싼 오답이 된다.
  3. 아무 규칙도 맞지 않으면 지어내지 않는다 — 정직하게 NO_SPECIFIC_CAUSE 로 남긴다.

파일 I/O·DB 접근을 하지 않는다(순수 함수). 얇은 파일 I/O 래퍼는
`mooring_fitting_service.write_diagnosis_file()` 에 있다.
"""
from __future__ import annotations

from statistics import median
from typing import Any

SCHEMA_VERSION = "1.0"

# ── 확신도 3단계 ──────────────────────────────────────────────
CONFIDENCE_CONFIRMED = "확정"
CONFIDENCE_LIKELY = "유력"
CONFIDENCE_REFERENCE = "참고"

# ── 부재 단위 규칙 임계값 (자주 바뀌는 값이므로 모듈 상단 한 곳에 모은다) ──
LOAD_PROXIMITY_HOPS = 2          # 이 이하면 "직결"로 본다
SECTION_WEAK_RATIO = 1.0 / 3.0   # 같은 단면 타입 중앙값 대비
BENDING_DOMINANT_RATIO = 0.6     # 굽힘 지배 판정 — 약축 단면 부족은 굽힘이 지배할 때만 의미가 있다
MAXRATIO_WARN = 1.0e5
SECTION_PEER_MIN = 3             # 비교군이 이보다 적으면 단면 판정을 하지 않는다(표본 부족)


def _finding(code: str, confidence: str, message: str, hint: str | None = None) -> dict:
    return {"code": code, "confidence": confidence, "message": message, "hint": hint}


# ══════════════════════════════════════════════════════════════
# Task 12 — 케이스 단위 규칙
# ══════════════════════════════════════════════════════════════

def _case_findings(evidence: dict, equilibrium: dict | None, f06: dict | None) -> list[dict]:
    findings: list[dict] = []
    meta = evidence.get("meta") or {}
    case_facts = evidence.get("caseFacts") or {}

    substantive_skips = case_facts.get("substantiveSkips") or 0
    if substantive_skips > 0:
        findings.append(_finding(
            "INPUT_ROW_DROPPED", CONFIDENCE_CONFIRMED,
            f"입력 CSV {substantive_skips}행이 모델에 반영되지 않았습니다. "
            "해당 부재는 해석 모델에 존재하지 않으므로 결과에도 나타나지 않습니다.",
            hint="CSV_Parse_Skips.csv 에서 행 번호와 사유를 확인하세요.",
        ))

    mf_input = case_facts.get("mfInputCount") or 0
    force_load = case_facts.get("forceLoadCount") or 0
    if mf_input > 0 and force_load == 0:
        findings.append(_finding(
            "LOAD_NOT_APPLIED", CONFIDENCE_CONFIRMED,
            f"MF 입력이 {mf_input}건인데 모델에 실린 하중은 0건입니다. "
            "하중이 구조에 연결되지 못했습니다.",
        ))
    if mf_input == 0:
        findings.append(_finding(
            "LOAD_NONE", CONFIDENCE_CONFIRMED,
            "MF 하중 입력이 0건입니다. 입력 CSV 에 MF 행이 없습니다.",
        ))

    winch_input = case_facts.get("winchInputCount") or 0
    if winch_input == 0:
        findings.append(_finding(
            "LOAD_NONE", CONFIDENCE_REFERENCE,
            "Winch 하중 입력이 0건입니다. 의도한 것이 아니라면 입력 CSV 의 LOADCASE 행을 확인하세요.",
        ))

    element_count = meta.get("elementCount") or 0
    elements_with_origin = meta.get("elementsWithOrigin")
    if elements_with_origin is not None and elements_with_origin < element_count:
        untraced = element_count - elements_with_origin
        findings.append(_finding(
            "MODEL_UNTRACED", CONFIDENCE_LIKELY,
            f"부재 {untraced}개의 출신을 추적하지 못했습니다. 원인 설명이 불완전할 수 있습니다.",
        ))

    if equilibrium is not None:
        worst = equilibrium.get("worstRelResidual") or 0.0
        rel_tol_fail = equilibrium.get("relTolFail")
        failed = bool(equilibrium.get("failed"))
        exceeds_fail_tol = rel_tol_fail is not None and worst > rel_tol_fail
        if failed or exceeds_fail_tol:
            findings.append(_finding(
                "EQUILIBRIUM_FAIL", CONFIDENCE_CONFIRMED,
                f"적용 하중과 반력이 {worst * 100:.1f}% 어긋납니다. "
                "하중이 모델에 도달하지 못했거나 SPC·RBE2 가 하중을 흡수하고 있습니다.",
            ))
        elif equilibrium.get("warned"):
            rel_tol_warn = equilibrium.get("relTolWarn") or 0.0
            findings.append(_finding(
                "EQUILIBRIUM_WARN", CONFIDENCE_REFERENCE,
                f"평형 잔차가 {worst * 100:.3f}% 입니다(주의 기준 {rel_tol_warn * 100:.1f}%). "
                "결과 해석에 참고하세요.",
            ))

    if f06 is not None:
        if f06.get("mechanism"):
            findings.append(_finding(
                "SOLVER_UNSTABLE", CONFIDENCE_CONFIRMED,
                "강성행렬에 메커니즘(강체 운동)이 있습니다. 구속이 부족해 해를 신뢰할 수 없습니다.",
            ))
        max_ratio = f06.get("maxRatio")
        if max_ratio is not None and max_ratio > MAXRATIO_WARN:
            findings.append(_finding(
                "SOLVER_UNSTABLE", CONFIDENCE_LIKELY,
                f"강성행렬 조건수(MAXRATIO)가 {max_ratio:.1e} 입니다. "
                "건전한 모델은 1e3 내외이며 1e5 를 넘으면 준특이를 의심합니다.",
            ))

    return findings


# ══════════════════════════════════════════════════════════════
# Task 13 — 부재 단위 규칙 + 우선순위
# ══════════════════════════════════════════════════════════════

def _section_medians(elements: list[dict]) -> dict[str, tuple[float, int]]:
    """section.type 별 iWeakMm4 중앙값 + 비교군 크기.

    같은 propertyId 를 쓰는 부재가 여러 개면 단면은 하나인데 여러 번 세게 되어
    중앙값이 그 단면 쪽으로 쏠린다 — propertyId 기준으로 먼저 유일화한다.
    """
    unique_by_pid: dict[Any, dict] = {}
    for el in elements:
        section = el.get("section") or {}
        pid = section.get("propertyId")
        if pid is None or pid in unique_by_pid:
            continue
        unique_by_pid[pid] = section

    by_type: dict[str, list[float]] = {}
    for section in unique_by_pid.values():
        sec_type = section.get("type")
        i_weak = section.get("iWeakMm4")
        if sec_type is None or i_weak is None:
            continue
        by_type.setdefault(sec_type, []).append(i_weak)

    return {sec_type: (median(vals), len(vals)) for sec_type, vals in by_type.items()}


def _bending_dominant_ratio(el: dict) -> float:
    nx = abs(el.get("nx") or 0.0)
    my = abs(el.get("my") or 0.0)
    mz = abs(el.get("mz") or 0.0)
    denom = nx + my + mz
    if denom == 0:
        return 0.0
    return (my + mz) / denom


def _element_candidates(el: dict, evid: dict, section_medians: dict[str, tuple[float, int]]) -> list[tuple[int, dict]]:
    """부재·하중케이스 조합 하나의 candidate finding 목록을 (우선순위, finding) 으로 반환.

    우선순위 숫자가 작을수록 주원인 — 모델 결함(1) > 하중 근접(2) > 단면 부족(3) > 특이사항 없음(9).
    """
    candidates: list[tuple[int, dict]] = []

    origin = evid.get("origin") or {}
    if origin.get("kind") == "fabricated":
        stage = origin.get("stage", "?")
        operation = origin.get("operation", "?")
        candidates.append((1, _finding(
            "FAKE_LOAD_PATH", CONFIDENCE_CONFIRMED,
            f"원 도면에 없는 부재입니다. {stage} 단계의 {operation} 이 만든 구간이며, "
            "하중이 이 경로로 흐릅니다.",
            hint="원 도면에 실제 부재가 있는지 확인하고, 없다면 CSV 입력의 연결 상태를 점검하세요.",
        )))

    boundary = evid.get("boundary") or {}
    spc_hops = boundary.get("spcHops")
    if boundary.get("spcSource") == "FreeEnd" and spc_hops is not None and 0 <= spc_hops <= 1:
        candidates.append((1, _finding(
            "BOUNDARY_ARTIFACT", CONFIDENCE_CONFIRMED,
            f"{spc_hops}절점 거리에 자유단 SPC 가 있습니다. 이 SPC 는 연결 끊김을 찾기 위한 "
            "진단용이라 실제 구속이 아니며, 반력이 과도하게 집중됩니다.",
            hint="해당 위치의 부재 연결이 CSV 에서 끊겨 있는지 확인하세요.",
        )))

    load_path = evid.get("loadPath") or {}
    hops = load_path.get("hops")
    if hops is not None and 0 <= hops <= LOAD_PROXIMITY_HOPS:
        candidates.append((2, _finding(
            "LOAD_PROXIMITY", CONFIDENCE_LIKELY,
            f"하중 작용점에서 {hops}절점 거리입니다. 하중이 거의 직접 전달됩니다.",
        )))

    section = evid.get("section") or {}
    i_weak = section.get("iWeakMm4")
    sec_type = section.get("type")
    if i_weak is not None and i_weak > 0 and sec_type in section_medians:
        med, peer_n = section_medians[sec_type]
        if peer_n >= SECTION_PEER_MIN and med > 0 and i_weak <= med * SECTION_WEAK_RATIO:
            bending_ratio = _bending_dominant_ratio(el)
            if bending_ratio >= BENDING_DOMINANT_RATIO:
                pct_of_median = i_weak / med * 100.0
                candidates.append((3, _finding(
                    "SECTION_WEAK", CONFIDENCE_LIKELY,
                    f"굽힘이 {bending_ratio * 100:.0f}% 지배하는데 약축 단면2차모멘트가 "
                    f"{i_weak:,.0f} mm⁴ 로, 같은 {sec_type} 타입 부재 중앙값 {med:,.0f} mm⁴ 의 "
                    f"{pct_of_median:.0f}% 에 불과합니다.",
                    hint="단면 상향 또는 스팬 축소를 검토하세요.",
                )))

    if not candidates:
        usage = el.get("usage")
        usage_txt = f"{usage:.2f}" if isinstance(usage, (int, float)) else str(usage)
        candidates.append((9, _finding(
            "NO_SPECIFIC_CAUSE", CONFIDENCE_REFERENCE,
            f"모델·하중·단면에서 특이 사항이 없습니다. Usage {usage_txt} 초과는 설계 여유 부족으로 보입니다.",
        )))

    return candidates


def _element_findings(result: dict, evidence: dict) -> list[dict]:
    evidence_elements = evidence.get("elements") or []
    evidence_by_id = {e.get("elementId"): e for e in evidence_elements}
    section_medians = _section_medians(evidence_elements)

    element_findings: list[dict] = []
    for case in result.get("cases") or []:
        # subcaseId = 해석 실행 단위(NASTRAN SUBCASE), loadSetId = BDF LOAD 세트 번호.
        # 구버전 결과 JSON 은 SUBCASE 번호를 loadCaseId 로 내보냈으므로 그것을 폴백으로 둔다.
        subcase_id = case.get("subcaseId", case.get("loadCaseId"))
        load_set_id = case.get("loadSetId")
        for el in case.get("elements") or []:
            if el.get("ok"):
                continue  # 통과 부재는 진단하지 않는다(노이즈 방지)

            element_id = el.get("id")
            evid = evidence_by_id.get(element_id)
            if evid is None:
                candidates = [(0, _finding(
                    "USER_ADDED", CONFIDENCE_CONFIRMED,
                    "원 도면과 자동 변형 어느 쪽에도 없는 부재입니다. "
                    "Studio 에서 사용자가 추가한 보강재로 보입니다.",
                ))]
            else:
                candidates = _element_candidates(el, evid, section_medians)

            priorities = [p for p, _ in candidates]
            primary_index = priorities.index(min(priorities))
            for idx, (_priority, finding) in enumerate(candidates):
                element_findings.append({
                    "elementId": element_id,
                    "subcaseId": subcase_id,
                    "loadSetId": load_set_id,
                    "loadCaseId": subcase_id,   # [deprecated] 구버전 Studio 호환

                    "code": finding["code"],
                    "confidence": finding["confidence"],
                    "message": finding["message"],
                    "hint": finding["hint"],
                    "primary": idx == primary_index,
                })

    return element_findings


# ══════════════════════════════════════════════════════════════
# 공개 API
# ══════════════════════════════════════════════════════════════

def diagnose(evidence: dict, result: dict | None, equilibrium: dict | None = None,
             f06: dict | None = None) -> dict:
    """증거 → 진단 보고서 dict.

    evidence: MODEL_EVIDENCE.json 파싱 결과 (필수).
    result: solve-bdf 결과 JSON 파싱 결과. 해석 전이면 None — 이 경우 elementFindings 는
        빈 리스트다(부재별 진단은 결과가 있어야 가능).
    equilibrium: EQUILIBRIUM.json 파싱 결과. 없으면 None — 평형 규칙을 건너뛴다.
    f06: F06 조건수/메커니즘 진단 정보. 없으면 None — 솔버 안정성 규칙을 건너뛴다.

    반환: {"schemaVersion": "1.0", "findings": [...], "elementFindings": [...]}
    """
    findings = _case_findings(evidence, equilibrium, f06)
    element_findings = _element_findings(result, evidence) if result is not None else []

    return {
        "schemaVersion": SCHEMA_VERSION,
        "findings": findings,
        "elementFindings": element_findings,
    }
