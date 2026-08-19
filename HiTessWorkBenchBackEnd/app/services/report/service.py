"""리포트 생성 오케스트레이터.

레코드 → payload → 어댑터 → (근거 계보 부착) → 렌더러 → XLSX bytes.
2단계에서 TemplateRenderer 가 붙을 자리는 renderer 선택 지점 한 곳뿐이다.
"""
from __future__ import annotations

import logging
import re

from ..analysis_passport import build_analysis_passport
from ..program_registry import PROGRAM_SPECS, resolve_program
from . import verdict_vocab
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


# 표지(renderers.generic_xlsx._verdict_cell)와 판정 시트가 반드시 같은 낱말을 써야 한다.
# 실제 리포트에서 표지는 '판정 미확정', 판정 시트는 '판정 없음' 으로 갈려
# 승인자가 서로 다른 상태로 읽을 수 있었다 — 그래서 단일 출처에서 가져온다.
_UNDETERMINED = verdict_vocab.UNDETERMINED_VERDICT

# 판정이 나와야 정상인 App 인데 근거를 못 읽은 경우.
# 주황색 경고만 덩그러니 두면 도구가 고장 난 것처럼 보인다 — 실제로 Mast Post 는
# 후보가 전부 통과했는데도 미확정으로 나왔다. 추측해서 합격을 찍지는 않되
# (거짓 합격이 최악이다), 왜 비었고 어디를 봐야 하는지는 말해 준다.
# ⚠️ 판정 개념이 없는 App(verdict_kind="none")에는 이 문구도, 판정 칸도 뜨지 않는다.
_NO_VERDICT_NOTICE = (
    "판정 근거를 찾지 못했습니다 — 개별 검토 결과는 '해석 결과' 시트에서 직접 확인하세요."
)


# 계산서 대상이 아닌 이유. '아직 없음'과 '원래 대상 아님'을 같은 문구로 쓰면
# 승인자가 '언젠가 생기겠지'와 '영영 없다'를 구분하지 못한다.
_EXCLUSION_REASONS: dict[str, str] = {
    "planned": "이 App 의 전용 계산서는 준비 중입니다 — 해석 결과 파일을 직접 확인하세요.",
    "not-applicable": "모델 생성·전처리 단계라 계산서 대상이 아닙니다.",
}
_UNREGISTERED_REASON = "레지스트리에 등록되지 않은 App 이라 계산서를 만들 수 없습니다."


class ReportNotAvailable(Exception):
    """리포트를 만들 수 없는 레코드 (미완료·결과 없음·계산서 대상 아님)."""


def _meta_for(record, program_id: str, display_name: str, verdict_kind: str) -> ReportMeta:
    return ReportMeta(
        program_id=program_id,
        display_name=display_name,
        analysis_id=record.id,
        project_name=record.project_name,
        employee_id=record.employee_id,
        created_at=record.created_at,
        status=record.status,
        verdict_kind=verdict_kind,
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
        fields=(ReportField(label="종합 판정", value=verdict or _UNDETERMINED),),
    )


def build_report_doc(record, *, user_connection_base: str) -> ReportDoc:
    if str(record.status or "").strip().casefold() not in _COMPLETED_STATUSES:
        raise ReportNotAvailable("완료된 해석만 리포트를 생성할 수 있습니다.")
    if not isinstance(record.result_info, dict) or not record.result_info:
        raise ReportNotAvailable("완료된 해석만 리포트를 생성할 수 있습니다.")

    # ⚠️ 화면에서만 막으면 API 는 열려 있다(app_settings_gate 가 같은 이유로 존재한다).
    #    리포트 대상 여부는 의도적으로 선언해야 하는 결정이므로, 미등록 App 은
    #    기본 허용이 아니라 거절이다 — 그래야 신규 App 이 빈 계산서를 뱉지 않는다.
    spec = resolve_program(record.program_name)
    if spec is None:
        raise ReportNotAvailable(_UNREGISTERED_REASON)
    if spec.report_scope != "supported":
        raise ReportNotAvailable(_EXCLUSION_REASONS[spec.report_scope])

    program_id = spec.program_id
    display_name = spec.display_name

    payload = collect_payload(record, user_connection_base=user_connection_base)
    meta = _meta_for(record, program_id, display_name, spec.verdict_kind)

    adapter = get_adapter(spec.report_adapter)
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

    # 판정 개념이 없는 App(허용하중·단면 특성 산출 등)에는 판정 칸을 만들지 않는다.
    # 사용자가 표지에서 본 「판정 : 판정 미확정」 이 정확히 이 경우였다 —
    # 판정할 것이 없는데 판정이 비어 있는 것처럼 보였다.
    has_verdict_row = spec.verdict_kind == "required"

    # 전용 어댑터가 판정을 비운 경우(예: truss 의 커버리지 부족)는 그 어댑터가 이미
    # 자기 사유를 notices 에 남긴다. 여기서는 generic 경로에서만 설명을 보탠다.
    if has_verdict_row and doc.verdict is None and not spec.report_adapter:
        notices = (*notices, _NO_VERDICT_NOTICE)

    sections = (
        # ordered_sections() 가 STANDARD_SECTION_ORDER 로 다시 정렬하므로 여기 순서는 무의미하다.
        *doc.sections,
        *((_verdict_section(doc.verdict),) if has_verdict_row else ()),
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


# 확장자와 id 를 붙일 자리를 남긴다(100 + "_" + 7자리 id + ".xlsx" = 113).
_FILENAME_STEM_MAX = 100
# 파일 시스템이 거부하거나 경로로 해석하는 문자 + 제어 문자.
_ILLEGAL_IN_FILENAME = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def _filename_part(text: str | None) -> str:
    """파일명 조각으로 쓸 수 있게 다듬는다.

    한글은 일부러 남긴다 — Content-Disposition 이 RFC 5987 로 실어 보내므로
    여기서 지우면 사람이 읽을 이름을 잃는다(ASCII 폴백은 라우터가 따로 만든다).
    """
    if not text:
        return ""
    cleaned = _ILLEGAL_IN_FILENAME.sub("_", str(text))
    cleaned = re.sub(r"\s+", "_", cleaned)
    return re.sub(r"_+", "_", cleaned).strip("._")


def _report_filename(doc: ReportDoc) -> str:
    """다운로드 폴더에서 어느 App 의 어느 해석인지 바로 읽히는 이름.

    ⚠️ program_id 슬러그('column-buckling')로는 App 을 알아보기 어렵다 —
    사용자가 받은 파일이 무엇인지 구분하지 못한 실제 사유다.
    """
    parts = (_filename_part(doc.meta.display_name), _filename_part(doc.meta.project_name))
    stem = "_".join(part for part in parts if part)[:_FILENAME_STEM_MAX].strip("._")
    return f"{stem or 'WorkBench_Report'}_{doc.meta.analysis_id}.xlsx"


def build_report_xlsx(record, *, user_connection_base: str) -> tuple[str, bytes]:
    """(파일명, XLSX bytes). 디스크에 쓰지 않는다."""
    doc = build_report_doc(record, user_connection_base=user_connection_base)
    return _report_filename(doc), render_generic_xlsx(doc)


def report_capabilities() -> dict[str, dict]:
    """program_id → 리포트 가능 여부. 프론트 카탈로그 표시용."""
    return {
        spec.program_id: {
            "reportable": spec.report_scope == "supported",
            "scope": spec.report_scope,
            # 목록에서 조용히 지우지 않는다 — '내 해석이 왜 없지?' 가 되므로
            # 왜 안 되는지 화면이 그대로 말할 수 있게 사유를 함께 내린다.
            "reason": _EXCLUSION_REASONS.get(spec.report_scope),
            "hasTemplate": bool(spec.report_template),
            "displayName": spec.display_name,
            # 이력에 저장된 program_name 은 정본 표시명이 아닐 수 있다 —
            # davit_service 는 "Jib Rest Assessment (1단)" 로 남긴다. 별칭까지 내려보내
            # 프론트가 표시명 하나로만 맞추다 조용히 빗나가지 않게 한다.
            "aliases": list(spec.aliases),
        }
        for spec in PROGRAM_SPECS
    }
