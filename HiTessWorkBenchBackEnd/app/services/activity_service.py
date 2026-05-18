"""사용자 활동 로그 기록 + 조회 헬퍼."""
from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Session
from .. import models


def log_activity(
    db: Session,
    action_type: str,
    employee_id: str = None,
    action_detail: dict = None,
    status: str = "success",
    ip_address: str = None,
):
    """activity_logs 테이블에 이벤트를 기록합니다. 예외가 발생해도 원래 요청을 막지 않습니다."""
    try:
        entry = models.ActivityLog(
            employee_id=employee_id,
            action_type=action_type,
            action_detail=action_detail,
            status=status,
            ip_address=ip_address,
        )
        db.add(entry)
        db.commit()
    except Exception:
        db.rollback()


def build_activity_query(
    db: Session,
    employee_id: Optional[str] = None,
    action_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    """
    activity.py 라우터의 /logs 와 /logs/export 가 동일하게 반복하던
    필터 + User outerjoin + name add_columns + 정렬 패턴을 단일 쿼리 빌더로 통합.

    호출부는 반환된 Query 객체에 offset/limit/count/all() 등을 자유롭게 체인할 수 있다.
    """
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
    return (
        q.outerjoin(models.User, models.ActivityLog.employee_id == models.User.employee_id)
        .add_columns(models.User.name)
        .order_by(models.ActivityLog.created_at.desc())
    )
