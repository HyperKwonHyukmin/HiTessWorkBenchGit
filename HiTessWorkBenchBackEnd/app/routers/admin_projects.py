"""관리자 All Projects (`/api/admin/projects*`) — 모든 사용자의 해석 이력·작업 폴더 파일·LogBook 보내기.

- `GET  /api/admin/projects`                     — 전체 사용자 이력(My Projects 와 같은 기준: 샘플·세부 검토 제외)
- `GET  /api/admin/projects/{id}/files`          — 작업 폴더의 모든 파일(입력/결과/기타 구분) + LogBook 보낸 이력
- `POST /api/admin/projects/{id}/logbook`        — 고른 파일을 Hi-TESS LogBook '정리 대기'로 보낸다(서버끼리)

파일 받기는 기존 `GET /api/download` 를 쓴다(관리자는 남의 작업 폴더도 통과 — `_access_control`).
"""
from __future__ import annotations

import os
from datetime import date as _date
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import database, models
from ..dependencies import require_admin
from ..services import admin_projects as svc
from ..services.activity_service import log_activity
from . import analysis as analysis_router

router = APIRouter(prefix="/api/admin/projects", tags=["admin-projects"])

FILE_STATUSES = {"available", "expired"}


def _base_query(db: Session):
    return db.query(models.Analysis).filter(
        models.Analysis.source != analysis_router.SAMPLE_SOURCE_TAG,
        models.Analysis.program_name.notin_(analysis_router.INTERNAL_SUBSTEP_PROGRAMS),
    )


def _export_summary(db: Session, ids: list[int]) -> dict[int, dict]:
    if not ids:
        return {}
    rows = (db.query(models.LogbookExport)
            .filter(models.LogbookExport.analysis_id.in_(ids), models.LogbookExport.state != "failed")
            .order_by(models.LogbookExport.created_at.desc()).all())
    out: dict[int, dict] = {}
    for row in rows:
        item = out.setdefault(row.analysis_id, {"count": 0, "last_at": row.created_at, "last_by": row.sent_by})
        item["count"] += 1
    return out


@router.get("")
def list_projects(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    search: Optional[str] = Query(None),
    program_name: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    employee_id: Optional[str] = Query(None),
    date_from: Optional[_date] = Query(None),
    date_to: Optional[_date] = Query(None),
    file_status: Optional[str] = Query(None),
    db: Session = Depends(database.get_db),
    _admin: str = Depends(require_admin),
):
    q = _base_query(db)
    q = analysis_router._apply_analysis_filters(
        q, program_name=program_name, status=status, date_from=date_from, date_to=date_to,
    )
    users = db.query(models.User).all()
    users_by_eid = {analysis_router._norm_eid(u.employee_id): u for u in users}
    if employee_id and employee_id.strip():
        q = q.filter(func.upper(models.Analysis.employee_id) == employee_id.strip().upper())
    if search and search.strip():
        term = search.strip()
        like = f"%{term}%"
        # 사용자 이름·부서로도 찾는다 — 해당 사번 목록으로 바꿔 넣는다
        folded = term.casefold()
        matched = [eid for eid, u in users_by_eid.items()
                   if folded in (u.name or "").casefold() or folded in (u.department or "").casefold()]
        conditions = [
            models.Analysis.project_name.ilike(like),
            models.Analysis.program_name.ilike(like),
            models.Analysis.employee_id.ilike(like),
        ]
        if matched:
            conditions.append(func.upper(models.Analysis.employee_id).in_(matched))
        q = q.filter(or_(*conditions))

    if file_status in FILE_STATUSES:
        want = file_status == "available"
        rows = [r for r in analysis_router._ordered_analysis_rows(db, q)
                if analysis_router._files_available(r) == want]
        total = len(rows)
        rows = rows[skip:skip + limit]
    else:
        total = q.count()
        rows = analysis_router._ordered_analysis_rows(db, q, skip=skip, limit=limit)

    exports = _export_summary(db, [r.id for r in rows])
    items = []
    for r in rows:
        payload = analysis_router._serialize_analysis(r)
        user = users_by_eid.get(analysis_router._norm_eid(r.employee_id))
        payload.update({
            "userName": user.name if user else "Deleted User",
            "department": (user.department if user and user.department else "Unknown"),
            "logbook": exports.get(r.id),
        })
        items.append(payload)

    programs = [p for (p,) in _base_query(db).with_entities(models.Analysis.program_name).distinct().all() if p]
    return {"total": total, "skip": skip, "limit": limit, "items": items, "programs": sorted(programs)}


def _record_or_404(db: Session, analysis_id: int) -> models.Analysis:
    record = db.query(models.Analysis).filter(models.Analysis.id == analysis_id).first()
    if record is None:
        raise HTTPException(status_code=404, detail="해석 기록을 찾을 수 없습니다.")
    return record


def _resolved(db: Session, record: models.Analysis) -> dict:
    records = svc.related_records(db, record, analysis_router.INTERNAL_SUBSTEP_PROGRAMS)
    return svc.resolve(records, analysis_router._USER_CONNECTION_DIR)


def _export_rows(db: Session, analysis_id: int) -> list[dict]:
    rows = (db.query(models.LogbookExport).filter(models.LogbookExport.analysis_id == analysis_id)
            .order_by(models.LogbookExport.created_at.desc()).limit(20).all())
    return [{
        "id": r.id, "sent_by": r.sent_by, "batch_key": r.batch_key, "state": r.state, "title": r.title,
        "note": r.note, "file_count": r.file_count, "total_bytes": r.total_bytes,
        "blocked": r.blocked or [], "rejected": r.rejected or [], "error": r.error,
        "created_at": r.created_at.isoformat(timespec="seconds") if r.created_at else None,
    } for r in rows]


@router.get("/{analysis_id}/files")
def project_files(
    analysis_id: int,
    db: Session = Depends(database.get_db),
    _admin: str = Depends(require_admin),
):
    record = _record_or_404(db, analysis_id)
    listing = svc.list_files(_resolved(db, record))
    listing["exports"] = _export_rows(db, analysis_id)
    return listing


class LogbookExportRequest(BaseModel):
    paths: list[str] = Field(min_length=1, max_length=svc.MAX_EXPORT_FILES)
    title: Optional[str] = Field(default=None, max_length=200)
    note: Optional[str] = Field(default=None, max_length=1000)


@router.post("/{analysis_id}/logbook")
def export_to_logbook(
    analysis_id: int,
    payload: LogbookExportRequest,
    request: Request,
    db: Session = Depends(database.get_db),
    admin_id: str = Depends(require_admin),
):
    record = _record_or_404(db, analysis_id)
    try:
        picked = svc.select_paths(_resolved(db, record), payload.paths)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    total = sum(os.path.getsize(p) for p, _f, _r in picked)
    if total > svc.MAX_EXPORT_BYTES:
        raise HTTPException(status_code=413, detail=f"한 번에 보낼 수 있는 크기({svc.MAX_EXPORT_BYTES // 1024 ** 3}GB)를 넘었습니다.")

    owner = analysis_router._norm_eid(record.employee_id)
    title = (payload.title or "").strip() or f"WB #{record.id} · {record.program_name} · {owner}"
    note = (payload.note or "").strip() or None
    origin = {"analysis_id": record.id, "owner": owner, "program": record.program_name,
              "project": record.project_name, "created_at": record.created_at.isoformat() if record.created_at else None,
              "note": note}
    row = models.LogbookExport(analysis_id=record.id, sent_by=admin_id, title=title, note=note,
                               created_at=datetime.now())
    ip = request.client.host if request.client else None
    try:
        result = svc.send_to_logbook(sender=admin_id, name=title, origin=origin, picked=picked)
    except svc.ExportError as exc:
        row.state = "failed"
        row.error = exc.message
        db.add(row)
        db.commit()
        log_activity(db, "LOGBOOK_EXPORT", employee_id=admin_id, status="failed", ip_address=ip,
                     action_detail={"analysis_id": record.id, "error": exc.message})
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    row.batch_key = result["key"]
    row.state = result["state"]
    row.file_count = result["file_count"]
    row.total_bytes = result["total_bytes"]
    row.blocked = result["blocked"]
    row.rejected = result["rejected"]
    db.add(row)
    db.commit()
    log_activity(db, "LOGBOOK_EXPORT", employee_id=admin_id, ip_address=ip,
                 action_detail={"analysis_id": record.id, "batch_key": result["key"], "state": result["state"],
                                "files": result["file_count"]})
    return {**result, "export_id": row.id, "title": title}
