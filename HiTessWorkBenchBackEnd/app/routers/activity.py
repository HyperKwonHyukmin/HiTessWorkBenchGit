"""사용자 활동 로그 조회 및 버전 업데이트 이벤트 API."""
import csv
import io
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from .. import database
from ..dependencies import require_admin
from ..services.activity_service import build_activity_query, log_activity

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
    q = build_activity_query(db, employee_id, action_type, date_from, date_to)
    # 필터 적용된 결과의 총 개수 — outerjoin/order 가 들어가도 count() 결과는 동일.
    total = q.count()
    rows = q.offset(skip).limit(limit).all()

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [
            {
                "id": r.ActivityLog.id,
                "employee_id": r.ActivityLog.employee_id,
                "name": r.name,
                "action_type": r.ActivityLog.action_type,
                "action_detail": r.ActivityLog.action_detail,
                "status": r.ActivityLog.status,
                "ip_address": r.ActivityLog.ip_address,
                "created_at": r.ActivityLog.created_at.isoformat() if r.ActivityLog.created_at else None,
            }
            for r in rows
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
    rows = build_activity_query(db, employee_id, action_type, date_from, date_to).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "사번", "이름", "이벤트", "상태", "세부정보", "IP", "시간"])
    for r in rows:
        detail_str = str(r.ActivityLog.action_detail) if r.ActivityLog.action_detail else ""
        created = r.ActivityLog.created_at.isoformat() if r.ActivityLog.created_at else ""
        writer.writerow([r.ActivityLog.id, r.ActivityLog.employee_id or "", r.name or "", r.ActivityLog.action_type, r.ActivityLog.status or "", detail_str, r.ActivityLog.ip_address or "", created])

    output.seek(0)
    filename = f"activity_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
