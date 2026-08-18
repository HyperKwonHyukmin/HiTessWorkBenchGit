"""Truss Structural Assessment 전용 어댑터.

결과 JSON 의 loadCases[].elements[] 중첩을 Load Case 별 표로 편다.
기존 /api/analysis/export-xlsx(부재 전수 상세 시트)와는 별개 문서다.
"""
from __future__ import annotations

from typing import Any

from ..models import ReportDoc, ReportField, ReportMeta, ReportSection, ReportTable
from .generic import generic_adapter

_ELEMENT_COLUMNS: tuple[str, ...] = ("element", "assessment", "result")


def _rows_for(elements: list[dict]) -> tuple[tuple[Any, ...], ...]:
    return tuple(
        tuple(item.get(col) for col in _ELEMENT_COLUMNS)
        for item in elements
        if isinstance(item, dict)
    )


def truss_assessment_adapter(payload: dict, meta: ReportMeta) -> ReportDoc:
    output = payload.get("output")
    load_cases = (output or {}).get("loadCases") if isinstance(output, dict) else None
    if not isinstance(load_cases, list) or not load_cases:
        # 결과 파일이 없거나 형태가 다르면 기계적 전개로 물러선다.
        return generic_adapter(payload, meta)

    tables: list[ReportTable] = []
    worst: float | None = None
    any_fail = False

    for case in load_cases:
        if not isinstance(case, dict):
            continue
        elements = [e for e in (case.get("elements") or []) if isinstance(e, dict)]
        for element in elements:
            value = element.get("assessment")
            if isinstance(value, (int, float)):
                worst = value if worst is None else max(worst, value)
            if str(element.get("result", "")).strip().upper() == "FAIL":
                any_fail = True
        tables.append(
            ReportTable(
                title=f"Load Case {case.get('loadCaseId')}",
                columns=_ELEMENT_COLUMNS,
                rows=_rows_for(elements),
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

    return ReportDoc(
        meta=meta,
        verdict="불합격" if any_fail else "합격",
        sections=sections,
    )
