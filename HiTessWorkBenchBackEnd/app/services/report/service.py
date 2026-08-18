"""리포트 생성 오케스트레이터.

레코드 → payload → 어댑터 → (근거 계보 부착) → 렌더러 → XLSX bytes.
2단계에서 TemplateRenderer 가 붙을 자리는 renderer 선택 지점 한 곳뿐이다.
"""
from __future__ import annotations

import logging

from ..analysis_passport import build_analysis_passport
from ..program_registry import PROGRAM_SPECS, resolve_program
from .adapters import get_adapter
from .models import ReportDoc, ReportField, ReportMeta, ReportSection
from .payload import collect_payload
from .renderers.generic_xlsx import render_generic_xlsx

logger = logging.getLogger(__name__)

_COMPLETED_STATUSES: frozenset[str] = frozenset({"success", "완료", "completed"})

# 1단계에는 템플릿 렌더러가 없으므로 모든 리포트가 범용 서식이다.
# ⚠️ 2단계에서 TemplateRenderer 를 붙일 때 이 문구를 조건부로 바꿔야 한다
#    (양식이 적용된 리포트에 "양식 미적용"이라고 적히면 그게 곧 거짓 표기다).
_GENERIC_NOTICE = "표준 양식이 등록되지 않은 App 입니다 — 범용 서식으로 생성되었습니다."


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


def _provenance_section(passport: dict | None) -> ReportSection:
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
        fields = (ReportField(label="산출물", value="기록 없음"),)
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
    try:
        doc = adapter(payload, meta)
        notices: tuple[str, ...] = ()
    except Exception:
        logger.warning("리포트: 어댑터 실패 — generic 으로 폴백합니다", exc_info=True)
        doc = get_adapter(None)(payload, meta)
        notices = ("전용 어댑터가 실패해 기본 서식으로 생성되었습니다.",)

    try:
        passport = build_analysis_passport(record, user_connection_base=user_connection_base)
    except Exception:
        logger.info("리포트: passport 생성 실패 — 근거 섹션을 비웁니다", exc_info=True)
        passport = None

    sections = (
        *doc.sections,
        _verdict_section(doc.verdict),
        _provenance_section(passport),
    )

    return ReportDoc(
        meta=doc.meta,
        verdict=doc.verdict,
        sections=sections,
        provenance=passport,
        template_applied=False,
        notices=(*doc.notices, *notices, _GENERIC_NOTICE),
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
