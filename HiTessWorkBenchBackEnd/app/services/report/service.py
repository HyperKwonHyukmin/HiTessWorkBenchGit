"""리포트 생성 오케스트레이터.

레코드 → payload → 어댑터 → (근거 계보 부착) → 렌더러 → XLSX bytes.
2단계에서 TemplateRenderer 가 붙을 자리는 renderer 선택 지점 한 곳뿐이다.
"""
from __future__ import annotations

import logging

from ..analysis_passport import build_analysis_passport
from ..program_registry import PROGRAM_SPECS, resolve_program
from .adapters import generic_adapter, get_adapter
from .models import ReportDoc, ReportField, ReportMeta, ReportSection
from .payload import collect_payload
from .renderers.generic_xlsx import render_generic_xlsx

logger = logging.getLogger(__name__)

_COMPLETED_STATUSES: frozenset[str] = frozenset({"success", "완료", "completed"})

# ⚠️ '범용 서식으로 생성됨'을 notices 에 넣지 않는다.
#    표지에 이미 「적용 양식 : 범용 서식」 행이 있어 순수 중복이고, 유의 사항 블록은
#    이 해석 고유의 경고(무엇이 생략됐는지, 왜 판정이 비었는지)만 담아야 읽힌다.
#    서식 종류 같은 문서 메타 정보를 같은 목록에 섞으면 정작 중요한 줄이 묻힌다.
#    덤으로 2단계에서 문구가 거짓이 될 지뢰도 사라진다 — template_applied 가 표지를 몰고 간다.


class ReportNotAvailable(Exception):
    """리포트를 만들 수 없는 레코드 (미완료·결과 없음)."""


def _meta_for(record, program_id: str, display_name: str) -> ReportMeta:
    return ReportMeta(
        program_id=program_id,
        display_name=display_name,
        analysis_id=record.id,
        project_name=record.project_name,
        employee_id=record.employee_id,
        created_at=record.created_at,
        status=record.status,
    )


def _provenance_section(passport: dict | None, *, lookup_failed: bool) -> ReportSection:
    """근거 파일 섹션.

    ⚠️ '조회 실패'와 '원래 없음'을 같은 문구로 쓰지 않는다. 둘은 다른 사실이고,
    승인자가 구분할 수 없으면 근거가 없는 해석을 근거가 있는 것으로 오해할 수 있다.
    """
    artifacts = (passport or {}).get("artifacts") or []
    fields = tuple(
        ReportField(
            label=str(item.get("name") or item.get("role") or "산출물"),
            value=str(item.get("status") or "확인됨"),
            note=str(item.get("role")) if item.get("role") else None,
        )
        for item in artifacts
    )
    if not fields:
        fields = (
            ReportField(
                label="산출물",
                value="조회 실패" if lookup_failed else "기록 없음",
                note=(
                    "산출물 계보를 읽지 못했습니다 — 근거 파일이 없다는 뜻은 아닙니다."
                    if lookup_failed else None
                ),
            ),
        )
    return ReportSection(key="provenance", title="근거 파일", fields=fields)


def _verdict_section(verdict: str | None) -> ReportSection:
    return ReportSection(
        key="verdict",
        title="판정",
        fields=(ReportField(label="종합 판정", value=verdict or "판정 없음"),),
    )


def build_report_doc(record, *, user_connection_base: str) -> ReportDoc:
    if str(record.status or "").strip().casefold() not in _COMPLETED_STATUSES:
        raise ReportNotAvailable("완료된 해석만 리포트를 생성할 수 있습니다.")
    if not isinstance(record.result_info, dict) or not record.result_info:
        raise ReportNotAvailable("완료된 해석만 리포트를 생성할 수 있습니다.")

    spec = resolve_program(record.program_name)
    program_id = spec.program_id if spec else "unknown"
    display_name = spec.display_name if spec else (record.program_name or "Unknown App")

    payload = collect_payload(record, user_connection_base=user_connection_base)
    meta = _meta_for(record, program_id, display_name)

    adapter = get_adapter(spec.report_adapter if spec else None)
    notices: tuple[str, ...] = ()
    try:
        doc = adapter(payload, meta)
        # 예외만 막으면 폴백이 반쪽이다 — 어댑터가 조용히 None 을 돌려주면(early return 실수 등)
        # 이 블록 밖에서 AttributeError 로 터진다. 계약 위반도 예외와 같게 취급한다.
        if not isinstance(doc, ReportDoc):
            raise TypeError(f"어댑터가 ReportDoc 이 아닌 {type(doc).__name__} 을 돌려줬습니다")
    except Exception:
        logger.warning("리포트: 어댑터 실패 — generic 으로 폴백합니다", exc_info=True)
        # get_adapter(None) 을 다시 부르지 않는다 — 조회 자체가 깨졌을 수도 있는 경로다.
        # generic_adapter 를 직접 참조해야 폴백이 '무조건 안전'하다는 이름값을 한다.
        doc = generic_adapter(payload, meta)
        notices = ("전용 어댑터가 실패해 기본 서식으로 생성되었습니다.",)

    passport_failed = False
    try:
        passport = build_analysis_passport(record, user_connection_base=user_connection_base)
    except Exception:
        logger.info("리포트: passport 생성 실패 — 조회 실패로 표기합니다", exc_info=True)
        passport = None
        passport_failed = True
        notices = (
            *notices,
            "근거 파일 계보를 조회하지 못했습니다 — 산출물 유무는 이 계산서로 판단할 수 없습니다.",
        )

    sections = (
        # ordered_sections() 가 STANDARD_SECTION_ORDER 로 다시 정렬하므로 여기 순서는 무의미하다.
        *doc.sections,
        _verdict_section(doc.verdict),
        _provenance_section(passport, lookup_failed=passport_failed),
    )

    return ReportDoc(
        meta=doc.meta,
        verdict=doc.verdict,
        sections=sections,
        provenance=passport,
        template_applied=False,
        notices=(*doc.notices, *notices),
    )


def build_report_xlsx(record, *, user_connection_base: str) -> tuple[str, bytes]:
    """(파일명, XLSX bytes). 디스크에 쓰지 않는다."""
    doc = build_report_doc(record, user_connection_base=user_connection_base)
    filename = f"WorkBench_Report_{doc.meta.program_id}_{doc.meta.analysis_id}.xlsx"
    return filename, render_generic_xlsx(doc)


def report_capabilities() -> dict[str, dict]:
    """program_id → 리포트 가능 여부. 프론트 카탈로그 표시용."""
    return {
        spec.program_id: {
            "reportable": True,
            "hasTemplate": bool(spec.report_template),
            "displayName": spec.display_name,
        }
        for spec in PROGRAM_SPECS
    }
