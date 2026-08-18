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
    undeclared = 0  # result 표기가 아예 없는 요소 수

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
            else:
                undeclared += 1
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
    # ⚠️ 합격은 '전 부재가 통과했음이 확인될 때'만 쓴다.
    #    한 요소만 OK 를 달아도 문서 전체가 합격으로 열리면, 바로 옆의 판정 표기 없는
    #    과응력 요소가 합격에 묻힌다. 부분 누락(파이프라인이 일부 result 만 빠뜨림)이
    #    전면 누락보다 흔하므로 여기가 실제 위험 지점이다.
    #    불합격은 커버리지와 무관하게 우선한다 — 아는 실패는 아는 실패다.
    if any_fail:
        verdict = "불합격"
    elif undeclared or not any_declared:
        verdict = None
    else:
        verdict = "합격"

    # 판정을 비우는 데 그치지 않고 왜 비었는지 남긴다. 빈 칸만 보면 승인자는
    # 도구가 고장 난 건지 데이터가 부족한 건지 구분할 수 없다.
    notices = list(base.notices)
    if undeclared:
        notices.append(
            f"판정 표기가 없는 요소 {undeclared}건이 있습니다 — "
            "전 부재에 대한 합격 여부는 확인되지 않았습니다."
        )

    return ReportDoc(
        meta=meta,
        verdict=verdict,
        sections=sections,
        notices=tuple(notices),
    )
