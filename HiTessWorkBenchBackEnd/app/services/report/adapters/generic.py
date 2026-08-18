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
_MAX_LIST_ITEMS = 20


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


def _scalar_list_field(key: str, values: list) -> ReportField:
    """스칼라 목록은 한 칸에 이어 붙인다(하중 배열 등이 통째로 사라지지 않게)."""
    shown = values[:_MAX_LIST_ITEMS]
    text = ", ".join("" if item is None else str(item) for item in shown)
    note = (
        None if len(values) <= _MAX_LIST_ITEMS
        else f"상위 {_MAX_LIST_ITEMS}개만 표시 (전체 {len(values)}개)"
    )
    return ReportField(label=key, value=text, note=note)


def _split(source: dict) -> tuple[tuple[ReportField, ...], tuple[ReportTable, ...]]:
    """payload 한 덩어리를 필드/표로 편다.

    ⚠️ 표현할 수 없는 값을 조용히 버리지 않는다 — 무엇이 빠졌는지 '생략된 항목' 필드로
    남긴다. 계산서가 입력을 말없이 누락하면 결재자가 그 사실을 알 방법이 없다
    (설계원칙 1: 신뢰가 곧 기능).
    """
    fields: list[ReportField] = []
    tables: list[ReportTable] = []
    omitted: list[str] = []

    for key, value in (source or {}).items():
        if _is_excluded(key):
            continue
        if _is_scalar(value):
            fields.append(ReportField(label=key, value=value))
        elif isinstance(value, list):
            if not value:
                continue  # 빈 목록은 잃을 정보가 없다
            if all(isinstance(item, dict) for item in value):
                table = _table_from_rows(key, value)
                if table:
                    tables.append(table)
                else:
                    omitted.append(key)
            elif all(_is_scalar(item) for item in value):
                fields.append(_scalar_list_field(key, value))
            else:
                omitted.append(key)  # 혼합 목록은 표로도 한 칸으로도 못 편다
        elif isinstance(value, dict):
            if not value:
                continue
            for sub_key, sub_value in value.items():
                if _is_excluded(sub_key):
                    continue
                if _is_scalar(sub_value):
                    fields.append(ReportField(label=f"{key}.{sub_key}", value=sub_value))
                else:
                    omitted.append(f"{key}.{sub_key}")  # 2단계 이상 중첩은 펴지 않는다
        else:
            omitted.append(key)

    if omitted:
        fields.append(
            ReportField(
                label="생략된 항목",
                value=", ".join(omitted),
                note="이 서식으로 표현할 수 없어 본문에서 생략된 데이터 키입니다.",
            )
        )
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
