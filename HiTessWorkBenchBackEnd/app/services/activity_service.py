"""사용자 활동 로그 기록 헬퍼."""
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
