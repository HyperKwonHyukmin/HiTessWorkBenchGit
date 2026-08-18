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
#
# ⚠️ 정확 일치로는 실제 데이터를 못 잡는다 — carling_service 는 "Total OK" / "Not OK" 를
#    내보낸다. 그래서 토큰 단위로 본다.
# ⚠️ 순서가 안전을 좌우한다: 부정 표현을 **먼저** 검사한다. "Not OK" 를 토큰만 보고 처리하면
#    "ok" 가 걸려 불합격이 합격으로 뒤집힌다 — 구조 계산서에서 가장 위험한 오류다.
# ⚠️ 짧은 토큰(ng)은 부분 문자열로 찾지 않는다. "bending" 안의 "ng" 가 걸린다.
_VERDICT_KEYS: tuple[str, ...] = ("assessment", "verdict", "judgement", "result_status")

# 다어절 부정 표현 — 정규화한 문장에서 부분 문자열로 찾는다.
_VERDICT_NEGATIVE_PHRASES: tuple[str, ...] = ("not ok", "no good")
# 아래 세 묶음은 모두 **토큰 완전 일치**로만 본다.
_VERDICT_NEGATIVE_TOKENS: frozenset[str] = frozenset({
    "fail", "failed", "ng", "nok", "불합격", "부적합",
})
_VERDICT_WARNING_TOKENS: frozenset[str] = frozenset({
    "warn", "warning", "경고", "주의",
})
_VERDICT_POSITIVE_TOKENS: frozenset[str] = frozenset({
    "ok", "pass", "passed", "safe", "합격", "적합",
})

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


def _as_text(item: Any) -> str:
    """한 칸에 이어 붙일 때 쓰는 표기.

    float 를 str() 하면 0.1+0.2 가 '0.30000000000000004' 로 굳어 버린다. 스칼라 필드는
    숫자 그대로 넘겨 Excel 이 표시 자릿수를 정하지만, 목록은 텍스트로 굳으므로 여기서 다듬는다.
    """
    if isinstance(item, float):
        return f"{item:g}"
    return "" if item is None else str(item)


def _scalar_list_field(key: str, values: list) -> ReportField:
    """스칼라 목록은 한 칸에 이어 붙인다(하중 배열 등이 통째로 사라지지 않게)."""
    shown = values[:_MAX_LIST_ITEMS]
    text = ", ".join(_as_text(item) for item in shown)
    note = (
        None if len(values) <= _MAX_LIST_ITEMS
        else f"상위 {_MAX_LIST_ITEMS}개만 표시 (전체 {len(values)}개)"
    )
    return ReportField(label=key, value=text, note=note)


def _split(source: dict) -> tuple[tuple[ReportField, ...], tuple[ReportTable, ...], tuple[str, ...]]:
    """payload 한 덩어리를 (필드, 표, 생략된 키) 로 편다.

    ⚠️ 표현할 수 없는 값을 조용히 버리지 않는다 — 무엇이 빠졌는지 세 번째 반환값으로
    올려 보내고, 호출자가 ReportDoc.notices 에 담는다. 계산서가 입력을 말없이 누락하면
    결재자가 그 사실을 알 방법이 없다 (설계원칙 1: 신뢰가 곧 기능).

    생략 사실을 '필드'로 끼워 넣지 않는 이유: 렌더러가 필드를 실제 데이터 행과 똑같이
    그리므로 결재자가 데이터와 구분할 수 없고, result 와 output 에 각각 호출되면 같은
    라벨이 두 번 나온다. notices 는 표지에 '유의 사항'으로 따로 그려진다.
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

    return tuple(fields), tuple(tables), tuple(omitted)


def _match_verdict(value: str) -> str | None:
    """판정 문자열 하나를 한국어 판정으로. 부정 → 경고 → 긍정 순서로 본다."""
    text = " ".join(value.replace("_", " ").replace("-", " ").casefold().split())
    if not text:
        return None
    tokens = set(text.split())
    if any(phrase in text for phrase in _VERDICT_NEGATIVE_PHRASES):
        return "불합격"
    if tokens & _VERDICT_NEGATIVE_TOKENS:
        return "불합격"
    if tokens & _VERDICT_WARNING_TOKENS:
        return "경고"
    if tokens & _VERDICT_POSITIVE_TOKENS:
        return "합격"
    return None


def _detect_verdict(*sources: dict) -> str | None:
    for source in sources:
        for key in _VERDICT_KEYS:
            value = (source or {}).get(key)
            if isinstance(value, str):
                mapped = _match_verdict(value)
                if mapped:
                    return mapped
    return None


def _omission_notice(section_title: str, omitted: tuple[str, ...]) -> str:
    return f"{section_title}에서 생략됨: {', '.join(omitted)}"


def generic_adapter(payload: dict, meta: ReportMeta) -> ReportDoc:
    input_fields, input_tables, input_omitted = _split(payload.get("input") or {})
    result_fields, result_tables, result_omitted = _split(payload.get("result") or {})

    output = payload.get("output")
    if isinstance(output, dict):
        output_fields, output_tables, output_omitted = _split(output)
        result_fields = (*result_fields, *output_fields)
        result_tables = (*result_tables, *output_tables)
        result_omitted = (*result_omitted, *output_omitted)

    notices: list[str] = []
    if input_omitted:
        notices.append(_omission_notice("입력 조건", input_omitted))
    if result_omitted:
        notices.append(_omission_notice("해석 결과", result_omitted))

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
        notices=tuple(notices),
    )
