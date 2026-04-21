"""사용자 활동 로그 조회 및 버전 업데이트 이벤트 API."""
import csv
import io
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from .. import models, database
from ..dependencies import require_admin, require_auth
from ..services.activity_service import log_activity

router = APIRouter(prefix="/api/activity", tags=["activity"])


class VersionUpdateRequest(BaseModel):
    employee_id: Optional[str] = None
    old_version: str
    new_version: str


@router.post("/version-update")
def report_version_update(
    req: VersionUpdateRequest,
    db: Session = Depends(database.get_db),
):
    """클라이언트가 새 버전을 감지했을 때 이벤트를 기록합니다."""
    log_activity(
        db,
        action_type="VERSION_UPDATE",
        employee_id=req.employee_id,
        action_detail={"old_version": req.old_version, "new_version": req.new_version},
    )
    return {"ok": True}


@router.get("/logs")
def get_activity_logs(
    employee_id: Optional[str] = Query(None),
    action_type: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(database.get_db),
    _: str = Depends(require_admin),
):
    """관리자용 활동 로그 조회. 날짜·사번·이벤트 유형 필터 지원."""
    q = db.query(models.ActivityLog)
    if employee_id:
        q = q.filter(models.ActivityLog.employee_id == employee_id)
    if action_type:
        q = q.filter(models.ActivityLog.action_type == action_type)
    if date_from:
        q = q.filter(models.ActivityLog.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        dt_to = datetime.fromisoformat(date_to).replace(hour=23, minute=59, second=59)
        q = q.filter(models.ActivityLog.created_at <= dt_to)

    total = q.count()
    items = q.order_by(models.ActivityLog.created_at.desc()).offset(skip).limit(limit).all()

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [
            {
                "id": r.id,
                "employee_id": r.employee_id,
                "action_type": r.action_type,
                "action_detail": r.action_detail,
                "status": r.status,
                "ip_address": r.ip_address,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in items
        ],
    }


@router.get("/logs/export")
def export_activity_logs_csv(
    employee_id: Optional[str] = Query(None),
    action_type: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(database.get_db),
    _: str = Depends(require_admin),
):
    """활동 로그를 CSV로 내보냅니다."""
    q = db.query(models.ActivityLog)
    if employee_id:
        q = q.filter(models.ActivityLog.employee_id == employee_id)
    if action_type:
        q = q.filter(models.ActivityLog.action_type == action_type)
    if date_from:
        q = q.filter(models.ActivityLog.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        dt_to = datetime.fromisoformat(date_to).replace(hour=23, minute=59, second=59)
        q = q.filter(models.ActivityLog.created_at <= dt_to)

    items = q.order_by(models.ActivityLog.created_at.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "사번", "이벤트", "상태", "세부정보", "IP", "시간"])
    for r in items:
        detail_str = str(r.action_detail) if r.action_detail else ""
        created = r.created_at.isoformat() if r.created_at else ""
        writer.writerow([r.id, r.employee_id or "", r.action_type, r.status or "", detail_str, r.ip_address or "", created])

    output.seek(0)
    filename = f"activity_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
