"""알림 센터 API — 사용자별 인앱 알림 목록/읽음/삭제.

polling 기반(WebSocket 없음, presence/chat 과 같은 철학): 클라이언트가 30초마다
GET /api/notifications?since=<마지막 id> 로 델타를 받고, 헤더 종 아이콘의 미읽음 배지를 갱신한다.
알림 '생성' 은 services/notification_service.notify() 한 곳이며 이 라우터는 만들지 않는다.

플랫폼 공통 기능이라 app_settings.GUARDED_ROUTES 에 등록하지 않는다.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import database, models
from ..dependencies import require_auth
from ..services.notification_service import get_notification_prefs, serialize_notification

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

DEFAULT_LIMIT = 50
MAX_LIMIT = 100


def _mine(db: Session, me: str, notification_id: int) -> models.Notification:
    """내 알림 1건. 남의 것은 존재 자체를 노출하지 않도록 404 로 통일한다."""
    row = (
        db.query(models.Notification)
        .filter(
            models.Notification.id == notification_id,
            models.Notification.employee_id == me,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="알림을 찾을 수 없습니다.")
    return row


@router.get("")
def list_notifications(
    since: int | None = Query(default=None, ge=0),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    unread_only: bool = False,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """내 알림 목록(id 내림차순). since 가 있으면 그 id 이후(델타)만 돌려준다.

    unread_count / latest_id 는 since·limit 과 무관하게 항상 전체 기준이다 — 배지는 델타가 아니라
    현재 상태를 보여 줘야 한다. prefs 는 user_preferences 의 알림 설정(Plan E 이전에는 기본값).
    """
    query = db.query(models.Notification).filter(models.Notification.employee_id == me)
    if since is not None:
        query = query.filter(models.Notification.id > since)
    if unread_only:
        query = query.filter(models.Notification.read_at.is_(None))
    items = query.order_by(models.Notification.id.desc()).limit(limit).all()

    unread_count = (
        db.query(func.count(models.Notification.id))
        .filter(models.Notification.employee_id == me, models.Notification.read_at.is_(None))
        .scalar()
    ) or 0
    latest_id = (
        db.query(func.max(models.Notification.id))
        .filter(models.Notification.employee_id == me)
        .scalar()
    ) or 0

    return {
        "items": [serialize_notification(n) for n in items],
        "unread_count": int(unread_count),
        "latest_id": int(latest_id),
        "prefs": get_notification_prefs(db, me),
    }


@router.post("/read-all")
def mark_all_read(
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """내 미읽음 알림을 전부 읽음 처리하고 건수를 돌려준다."""
    updated = (
        db.query(models.Notification)
        .filter(models.Notification.employee_id == me, models.Notification.read_at.is_(None))
        .update({"read_at": datetime.now()}, synchronize_session=False)
    )
    db.commit()
    return {"updated": int(updated)}


@router.post("/{notification_id}/read")
def mark_read(
    notification_id: int,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """알림 1건 읽음 처리(멱등)."""
    row = _mine(db, me, notification_id)
    if row.read_at is None:
        row.read_at = datetime.now()
        db.commit()
    return {"ok": True, "id": row.id}


@router.delete("/{notification_id}")
def delete_notification(
    notification_id: int,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """알림 1건 삭제(내 것만)."""
    row = _mine(db, me, notification_id)
    db.delete(row)
    db.commit()
    return {"ok": True}
