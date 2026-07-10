"""실시간 접속(presence) API — 클라이언트 하트비트 수집 + 관리자용 접속자 조회.

앱이 열려 있는 동안 클라이언트가 주기적으로 /heartbeat 를 호출해 last_seen 을 갱신하고,
관리자는 /online 으로 임계시간(ONLINE_THRESHOLD_SECONDS) 이내 접속자를 실시간 조회한다.
세션 인증과 분리된 user_presence 테이블을 사용하므로 서버 재시작 시 create_all 로 자동 생성된다.
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import database, models
from ..dependencies import require_admin, require_auth

router = APIRouter(prefix="/api/presence", tags=["presence"])

# 온라인 판정 임계: 하트비트 주기(45초)의 약 3배 여유 — 1회 누락은 온라인으로 유지.
ONLINE_THRESHOLD_SECONDS = 150


class HeartbeatRequest(BaseModel):
    page: Optional[str] = None


def _client_ip(req: Request) -> Optional[str]:
    """서버가 관측한 client IP. 클라이언트가 못 위조하도록 요청 정보만 사용한다."""
    forwarded_for = req.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip()
    return req.client.host if req.client else None


@router.post("/heartbeat")
def heartbeat(
    payload: HeartbeatRequest,
    req: Request,
    db: Session = Depends(database.get_db),
    employee_id: str = Depends(require_auth),
):
    """현재 인증 사용자의 접속 상태를 갱신합니다(클라이언트가 45초 주기로 호출)."""
    now = datetime.now()
    page = (payload.page or "")[:200]
    ip = _client_ip(req)

    row = (
        db.query(models.UserPresence)
        .filter(models.UserPresence.employee_id == employee_id)
        .first()
    )
    if row:
        row.last_seen = now
        row.last_page = page
        row.last_ip = ip
    else:
        db.add(models.UserPresence(
            employee_id=employee_id,
            last_seen=now,
            last_page=page,
            last_ip=ip,
        ))
    db.commit()
    return {"ok": True}


@router.get("/online")
def get_online_users(
    db: Session = Depends(database.get_db),
    _: str = Depends(require_admin),
):
    """최근 ONLINE_THRESHOLD_SECONDS 이내 하트비트를 보낸 접속 사용자 목록(관리자 전용)."""
    now = datetime.now()
    cutoff = now - timedelta(seconds=ONLINE_THRESHOLD_SECONDS)

    rows = (
        db.query(models.UserPresence, models.User)
        .outerjoin(models.User, models.UserPresence.employee_id == models.User.employee_id)
        .filter(models.UserPresence.last_seen >= cutoff)
        .order_by(models.UserPresence.last_seen.desc())
        .all()
    )

    items = [
        {
            "employee_id": presence.employee_id,
            "name": user.name if user else None,
            "department": user.department if user else None,
            "company": user.company if user else None,
            "is_admin": bool(user.is_admin) if user else False,
            "last_seen": presence.last_seen.isoformat() if presence.last_seen else None,
            "seconds_ago": int((now - presence.last_seen).total_seconds()) if presence.last_seen else None,
            "last_ip": presence.last_ip,
            "last_page": presence.last_page,
        }
        for presence, user in rows
    ]

    return {
        "count": len(items),
        "threshold_seconds": ONLINE_THRESHOLD_SECONDS,
        "items": items,
    }
