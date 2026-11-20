"""My Projects — 내 해석을 Hi-TESS LogBook '올리기와 확정'으로 보내기(LogBook 65).

- `GET  /api/analysis/{id}/logbook/files` — 내 해석의 작업 폴더 파일(입력/결과/기타) + 보낸 이력 + 보낼 수 있는지
- `POST /api/analysis/{id}/logbook`       — 고른 파일을 보낸다(관리자 All Projects 와 같은 공용 함수 `export_analysis`)

관리자 All Projects 보내기와 다른 점:
- 자기 해석만(관리자도 이 경로로는 자기 해석만 — 남의 해석은 All Projects 에서).
- 성공(Success)한 해석만. 샘플, 권상 세부 검토(자식 단계)는 보내지 않는다.
- `.env LOGBOOK_OWNER_SEND=0` 이면 꺼진다(503).
LogBook 은 비관리자 보내기를 `origin.owner == as` 일 때만 받는다(LogBook `integration._wb_sender`).
설계: LogBook 저장소 docs/plans/2026-11-20-logbook-65-wb-owner-send.md
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import database, models
from ..dependencies import require_auth
from ..services import admin_projects as svc
from ..services import logbook_integration as lb
from . import admin_projects as admin_router
from . import analysis as analysis_router

router = APIRouter(prefix="/api/analysis", tags=["my-projects-logbook"])


def _own_record(db: Session, analysis_id: int, current_user: str) -> models.Analysis:
    record = db.query(models.Analysis).filter(models.Analysis.id == analysis_id).first()
    if record is None:
        raise HTTPException(status_code=404, detail="해석 기록을 찾을 수 없습니다.")
    # get_analysis_by_id 와 같은 403 — 다만 관리자도 통과시키지 않는다(남의 해석은 All Projects 에서 보낸다)
    if analysis_router._norm_eid(record.employee_id) != analysis_router._norm_eid(current_user):
        raise HTTPException(status_code=403, detail="자기 해석만 LogBook 으로 보낼 수 있습니다.")
    return record


def _blocked_reason(record: models.Analysis) -> Optional[str]:
    """보낼 수 없는 이유(화면에 그대로 보인다). 보낼 수 있으면 None."""
    if not lb.owner_send_enabled():
        return "LogBook 보내기가 지금 꺼져 있습니다(관리자 설정)."
    if not lb.integration_secret():
        return "이 서버는 LogBook 과 연결되어 있지 않습니다."
    if record.source == analysis_router.SAMPLE_SOURCE_TAG:
        return "샘플 해석은 보낼 수 없습니다."
    if record.program_name in analysis_router.INTERNAL_SUBSTEP_PROGRAMS:
        return "세부 검토 단계는 따로 보낼 수 없습니다. 상위 해석에서 보내 주세요."
    if record.status != "Success":
        return "성공한 해석만 LogBook 으로 보낼 수 있습니다."
    if not analysis_router._files_available(record):
        return "작업 폴더 파일이 보관 기간이 지나 지워졌습니다."
    return None


@router.get("/{analysis_id}/logbook/files")
def my_logbook_files(
    analysis_id: int,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    record = _own_record(db, analysis_id, current_user)
    listing = svc.list_files(admin_router._resolved(db, record))
    listing["exports"] = admin_router._export_rows(db, analysis_id)
    recommended = svc.lifting_recommendation(record.program_name, listing)
    if recommended is not None:
        listing["liftingSet"] = recommended
    reason = _blocked_reason(record)
    listing["canSend"] = reason is None
    listing["blockedReason"] = reason
    return listing


class MyLogbookExportRequest(BaseModel):
    paths: list[str] = Field(min_length=1, max_length=svc.MAX_EXPORT_FILES)
    title: Optional[str] = Field(default=None, max_length=200)
    note: Optional[str] = Field(default=None, max_length=1000)


@router.post("/{analysis_id}/logbook")
def my_logbook_export(
    analysis_id: int,
    payload: MyLogbookExportRequest,
    request: Request,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    record = _own_record(db, analysis_id, current_user)
    reason = _blocked_reason(record)
    if reason is not None:
        raise HTTPException(status_code=503 if not lb.owner_send_enabled() else 422, detail=reason)
    owner = analysis_router._norm_eid(record.employee_id)
    try:
        # sender = owner: LogBook 이 as == origin.owner 를 확인한다(대소문자는 양쪽 모두 대문자로 맞춤)
        return svc.export_analysis(
            db, record, admin_router._resolved(db, record), sender=owner, owner=owner,
            requested=payload.paths, title=payload.title, note=payload.note,
            ip=request.client.host if request.client else None,
            user_connection_dir=analysis_router._USER_CONNECTION_DIR, by_owner=True)
    except svc.ExportError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
