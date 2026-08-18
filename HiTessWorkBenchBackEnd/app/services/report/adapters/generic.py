"""어댑터 미지정 App 이 쓰는 공용 어댑터.

앱별 지식이 없으므로 input_info / result_info 를 기계적으로 편다.
스칼라는 필드, dict 리스트는 표. 파일 경로 키는 근거 섹션이 따로 다루므로 뺀다.
"""
from __future__ import annotations

import re
from typing import Any

from .. import verdict_vocab
from ..models import ReportDoc, ReportField, ReportMeta, ReportSection, ReportTable

# 판정 문자열 토큰 분리 — 영숫자·한글이 아니면 전부 구분자.
_TOKEN_SPLIT_RE = re.compile(r"[^0-9a-z가-힣]+")
# 축약형 부정. 아포스트로피가 구분자라 "isn't" 는 [isn, t] 로 쪼개져 부정어가 사라진다.
# 조동사마다 토큰을 등록하는 대신 n't 를 not 으로 되돌린다.
_CONTRACTION_NOT_RE = re.compile(r"n['’]t\b")

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

# 부정어. 같은 문자열 안에 긍정어와 함께 나오면 거리·순서를 따지지 않고 불합격으로 읽는다.
# ⚠️ 창(window)을 두지 않는다. "부정어 바로 앞 N칸" 규칙은 N 을 아무리 키워도
#    'not currently considered safe' 처럼 한 칸만 더 벌어지면 뚫린다. 창을 없애야 닫힌다.
# "cannot" 은 아포스트로피가 없어 축약형 복원으로도 살아나지 않는다. 별도 토큰으로 넣는다
# (형식체 보고서일수록 can't 보다 cannot 을 쓴다).
_VERDICT_NEGATORS: frozenset[str] = frozenset({
    "not", "no", "non", "never", "without", "cannot",
})

# 긍정 토큰을 포함하지 않아 위 규칙으로는 못 잡는 다어절 부정 표현.
_VERDICT_NEGATIVE_PHRASES: tuple[str, ...] = ("no good",)
# 아래 세 묶음은 모두 **토큰 완전 일치**로만 본다.
# ⚠️ 낱말 목록을 여기에 따로 적지 않는다. 렌더러가 표의 실패 행을 강조할 때도 같은
#    낱말을 봐야 한다 — 두 곳에 따로 적으면 조용히 어긋난다. 단일 출처에서 가져온다.
_VERDICT_NEGATIVE_TOKENS = verdict_vocab.NEGATIVE_TOKENS
_VERDICT_WARNING_TOKENS = verdict_vocab.WARNING_TOKENS
_VERDICT_POSITIVE_TOKENS = verdict_vocab.POSITIVE_TOKENS

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


def _tokenize(value: str) -> list[str]:
    """casefold → 축약형 부정 복원 → 영숫자·한글이 아닌 문자는 전부 구분자.

    'not,safe' / 'not/safe' / 'safe?' 처럼 문장부호가 붙어도 부정어가 온전한 토큰으로
    떨어지게 한다. 부호를 안 떼면 'not,' 이 부정어 목록에 안 걸려 그대로 새어 나간다.
    축약형("isn't")은 부호를 떼는 순간 부정어가 통째로 사라지므로 먼저 되돌린다.
    """
    text = _CONTRACTION_NOT_RE.sub(" not ", value.casefold())
    return [token for token in _TOKEN_SPLIT_RE.split(text) if token]


def _match_verdict(value: str) -> str | None:
    """판정 문자열 하나를 한국어 판정으로.

    ⚠️ 이 함수는 **틀리더라도 안전한 쪽으로만 틀리게** 만들어져 있다.
    잘못된 '합격'은 결재를 그대로 통과하지만, 지나친 '불합격'은 사람이 다시 보게 만든다.
    그래서 부정어와 긍정어가 한 문자열에 함께 있으면 거리도 순서도 따지지 않고 불합격이다.
    'no issues, safe' 같은 문장이 불합격으로 읽히는 대가를 치르더라도,
    'not currently considered safe' 가 합격으로 읽히는 일은 없어야 한다.

    한계(의도적): 'OK but check' 처럼 단서만 달린 표현은 합격으로 읽고, 한국어 활용형
    ('적합하지 않음')과 영어·한국어 밖 문자(중국어·일본어·키릴)는 인식하지 못해
    판정 없음이 된다. 부정어 인식은 _VERDICT_NEGATORS 에 등록된 **고정 목록**뿐이라,
    어휘 밖 부정 표현('insufficient', 'fails to meet', 'unable to')은 잡지 못한다.
    이건 전용 어댑터가 없는 App 을 위한 fallback 이지 문장 분류기가 아니다 —
    판정이 중요한 App 은 전용 어댑터에서 직접 채운다.
    """
    tokens = _tokenize(value)
    if not tokens:
        return None
    unique = set(tokens)

    if (unique & _VERDICT_NEGATORS) and (unique & _VERDICT_POSITIVE_TOKENS):
        return "불합격"
    if any(phrase in " ".join(tokens) for phrase in _VERDICT_NEGATIVE_PHRASES):
        return "불합격"
    if unique & _VERDICT_NEGATIVE_TOKENS:
        return "불합격"
    if unique & _VERDICT_WARNING_TOKENS:
        return "경고"
    if unique & _VERDICT_POSITIVE_TOKENS:
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
