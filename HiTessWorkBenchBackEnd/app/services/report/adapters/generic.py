"""어댑터 미지정 App 이 쓰는 공용 어댑터.

앱별 지식이 없으므로 input_info / result_info 를 기계적으로 편다.
스칼라는 필드, dict 리스트는 표. 파일 경로 키는 근거 섹션이 따로 다루므로 뺀다.
"""
from __future__ import annotations

from typing import Any

from ..models import ReportDoc, ReportField, ReportMeta, ReportSection, ReportTable

# 경로·내부 식별자 — 계산서 본문에 노출하지 않는다(근거 섹션이 대신 보여 준다).
_EXCLUDED_KEY_SUFFIXES: tuple[str, ...] = ("_json", "_path", "_dir", "_file")
_EXCLUDED_KEYS: frozenset[str] = frozenset({
    "bdf_model", "input_json", "output_json", "work_dir", "_work_dir",
})

# 판정으로 해석할 키와 값. 색이 아니라 한국어 문자열로 굳힌다.
_VERDICT_KEYS: tuple[str, ...] = ("assessment", "verdict", "judgement", "result_status")
_VERDICT_WORDS: dict[str, str] = {
    "pass": "합격", "ok": "합격", "safe": "합격", "합격": "합격",
    "fail": "불합격", "ng": "불합격", "불합격": "불합격",
    "warn": "경고", "warning": "경고", "경고": "경고",
}

_MAX_TABLE_ROWS = 500


def _is_excluded(key: str) -> bool:
    return key in _EXCLUDED_KEYS or key.endswith(_EXCLUDED_KEY_SUFFIXES)


def _is_scalar(value: Any) -> bool:
    return value is None or isinstance(value, (str, int, float, bool))


def _table_from_rows(title: str, rows: list[dict]) -> ReportTable | None:
    columns: list[str] = []
    for row in rows:
        for key in row:
            if key not in columns:
                columns.append(key)
    if not columns:
        return None
    trimmed = rows[:_MAX_TABLE_ROWS]
    note = None if len(rows) <= _MAX_TABLE_ROWS else f"상위 {_MAX_TABLE_ROWS}행만 표시 (전체 {len(rows)}행)"
    return ReportTable(
        title=title,
        columns=tuple(columns),
        rows=tuple(tuple(row.get(col) for col in columns) for row in trimmed),
        note=note,
    )


def _split(source: dict) -> tuple[tuple[ReportField, ...], tuple[ReportTable, ...]]:
    fields: list[ReportField] = []
    tables: list[ReportTable] = []
    for key, value in (source or {}).items():
        if _is_excluded(key):
            continue
        if _is_scalar(value):
            fields.append(ReportField(label=key, value=value))
        elif isinstance(value, list) and value and all(isinstance(item, dict) for item in value):
            table = _table_from_rows(key, value)
            if table:
                tables.append(table)
        elif isinstance(value, dict):
            for sub_key, sub_value in value.items():
                if _is_scalar(sub_value) and not _is_excluded(sub_key):
                    fields.append(ReportField(label=f"{key}.{sub_key}", value=sub_value))
    return tuple(fields), tuple(tables)


def _detect_verdict(*sources: dict) -> str | None:
    for source in sources:
        for key in _VERDICT_KEYS:
            value = (source or {}).get(key)
            if isinstance(value, str):
                mapped = _VERDICT_WORDS.get(value.strip().casefold())
                if mapped:
                    return mapped
    return None


def generic_adapter(payload: dict, meta: ReportMeta) -> ReportDoc:
    input_fields, input_tables = _split(payload.get("input") or {})
    result_fields, result_tables = _split(payload.get("result") or {})

    output = payload.get("output")
    if isinstance(output, dict):
        output_fields, output_tables = _split(output)
        result_fields = (*result_fields, *output_fields)
        result_tables = (*result_tables, *output_tables)

    sections = (
        ReportSection(
            key="overview",
            title="개요",
            fields=(
                ReportField(label="해석 App", value=meta.display_name),
                ReportField(label="프로젝트", value=meta.project_name),
                ReportField(label="수행자 사번", value=meta.employee_id),
                ReportField(label="상태", value=meta.status),
            ),
        ),
        ReportSection(key="input", title="입력 조건", fields=input_fields, tables=input_tables),
        ReportSection(key="result", title="해석 결과", fields=result_fields, tables=result_tables),
    )

    return ReportDoc(
        meta=meta,
        verdict=_detect_verdict(payload.get("result") or {}, payload.get("output") or {}),
        sections=sections,
    )
