"""Truss Structural Assessment 전용 어댑터.

결과 JSON 의 loadCases[].elements[] 중첩을 Load Case 별 표로 편다.
기존 /api/analysis/export-xlsx(부재 전수 상세 시트)와는 별개 문서다.
"""
from __future__ import annotations

from typing import Any

from ..models import ReportDoc, ReportField, ReportMeta, ReportSection, ReportTable
from .generic import generic_adapter

# 열 순서 선호도. 실제 요소가 가진 키는 전부 싣되, 읽는 순서만 여기서 정한다.
# ⚠️ 고정 3열로 투영하면 axial/allowAxial 같은 '비율의 근거'가 흔적 없이 사라진다.
#    승인자가 assessment 값을 검산할 방법이 없어지고, 이 설계가 지켜 온
#    '조용히 버리지 않는다'가 표 열에서만 깨진다.
_PREFERRED_COLUMNS: tuple[str, ...] = (
    "element", "set", "property", "leg", "condition",
    "axial", "bending", "allowAxial", "allowBending",
    "assessment", "result",
)


def _is_number(value: Any) -> bool:
    """bool 은 int 의 하위형이라 그냥 두면 최대값에 섞인다."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _columns_for(elements: list[dict]) -> tuple[str, ...]:
    """요소들이 실제로 가진 키 전부를, 선호 순서를 앞세워 돌려준다."""
    seen: list[str] = []
    for item in elements:
        for key in item:
            if key not in seen:
                seen.append(key)
    preferred = [key for key in _PREFERRED_COLUMNS if key in seen]
    rest = [key for key in seen if key not in _PREFERRED_COLUMNS]
    return tuple(preferred + rest)


def _rows_for(elements: list[dict], columns: tuple[str, ...]) -> tuple[tuple[Any, ...], ...]:
    return tuple(tuple(item.get(col) for col in columns) for item in elements)


def _case_title(case: dict) -> str:
    case_id = case.get("loadCaseId")
    return f"Load Case {case_id}" if case_id is not None else "Load Case (미지정)"


def truss_assessment_adapter(payload: dict, meta: ReportMeta) -> ReportDoc:
    output = payload.get("output")
    load_cases = (output or {}).get("loadCases") if isinstance(output, dict) else None
    if not isinstance(load_cases, list) or not load_cases:
        # 결과 파일이 없거나 형태가 다르면 기계적 전개로 물러선다.
        return generic_adapter(payload, meta)

    tables: list[ReportTable] = []
    worst: float | None = None
    any_fail = False
    any_declared = False  # result 값을 하나라도 읽었는가

    for case in load_cases:
        if not isinstance(case, dict):
            continue
        elements = [e for e in (case.get("elements") or []) if isinstance(e, dict)]
        for element in elements:
            value = element.get("assessment")
            if _is_number(value):
                worst = value if worst is None else max(worst, value)
            token = str(element.get("result", "")).strip().upper()
            if token:
                any_declared = True
                if token == "FAIL":
                    any_fail = True
        columns = _columns_for(elements)
        tables.append(
            ReportTable(
                title=_case_title(case),
                columns=columns,
                rows=_rows_for(elements, columns),
            )
        )

    fields: list[ReportField] = [
        ReportField(label="Load Case 수", value=len(tables)),
    ]
    if worst is not None:
        fields.append(ReportField(label="최대 Assessment", value=worst))

    base = generic_adapter(payload, meta)
    sections = tuple(
        ReportSection(key="result", title="해석 결과", fields=tuple(fields), tables=tuple(tables))
        if section.key == "result"
        else section
        for section in base.sections
    )

    # base.notices 를 반드시 이어받는다. 우리는 result 섹션만 다시 만들 뿐, generic 이
    # 펴지 못한 다른 키(입력 조건 쪽, 또는 output 의 loadCases 외 항목)를 대신 표현하지는
    # 않는다. 여기서 notices 를 떨어뜨리면 '무엇이 빠졌는지' 만 사라지고 데이터는 계속
    # 빠진 채로 남는다 — 조용한 누락으로 되돌아간다.
    # ⚠️ 판정 근거가 하나도 없으면 '합격'이라 단정하지 않는다.
    #    result 키가 없는 요소만 있으면 과응력이어도 any_fail 은 False 로 남는다 —
    #    그걸 합격으로 찍으면 없는 데이터로 결재를 통과시키는 셈이다.
    #    generic._match_verdict 가 모를 때 None 을 내는 것과 같은 태도.
    if any_fail:
        verdict = "불합격"
    elif any_declared:
        verdict = "합격"
    else:
        verdict = None

    return ReportDoc(
        meta=meta,
        verdict=verdict,
        sections=sections,
        notices=base.notices,
    )
