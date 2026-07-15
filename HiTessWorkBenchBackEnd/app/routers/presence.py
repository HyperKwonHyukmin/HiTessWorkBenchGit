"""실시간 접속(presence) API — 클라이언트 하트비트 수집 + 관리자용 접속자 조회.

앱이 열려 있는 동안 클라이언트가 주기적으로 /heartbeat 를 호출해 last_seen 을 갱신하고,
관리자는 /online 으로 임계시간(ONLINE_THRESHOLD_SECONDS) 이내 접속자를 실시간 조회한다.
세션 인증과 분리된 user_presence 테이블을 사용하므로 서버 재시작 시 create_all 로 자동 생성된다.

- last_seen       : 마지막 하트비트(앱이 열려 있음) — 온라인 판정
- last_active_at  : 마지막 실제 상호작용(클릭/키입력) — 유휴/활성 판정
- session_started : 접속 시작 시각 — 접속 지속 시간 계산
"""
import json
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
# 유휴 판정 임계: 앱은 켜져 있으나 이 시간 이상 무입력이면 '자리비움(유휴)'.
IDLE_THRESHOLD_SECONDS = 180
# 이 기간 이상 하트비트가 없던 행은 housekeeping 으로 정리(비-로그아웃 종료 잔여 행 청소).
STALE_PRESENCE_MAX_AGE_SECONDS = 24 * 60 * 60


class HeartbeatRequest(BaseModel):
    page: Optional[str] = None
    # 클라이언트가 계산한 '마지막 상호작용 이후 경과초'. 절대시각이 아닌 duration 이라
    # 클라이언트-서버 시계 오차에 영향받지 않는다.
    idle_seconds: Optional[int] = None
    # 클라이언트 앱 버전(package.json). 관리자가 구버전 사용자를 식별하는 데 사용.
    app_version: Optional[str] = None


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
    app_version = (payload.app_version or "")[:30] or None
    idle = payload.idle_seconds if (payload.idle_seconds and payload.idle_seconds > 0) else 0
    # 마지막 상호작용 시각 = 지금 - 유휴 경과(서버 시각 기준으로 환산).
    last_active_at = now - timedelta(seconds=idle)

    row = (
        db.query(models.UserPresence)
        .filter(models.UserPresence.employee_id == employee_id)
        .first()
    )
    if row:
        # 마지막 하트비트 이후 온라인 임계를 넘긴 공백(앱을 닫았다가 재접속 등)이 있으면
        # '현재 연속 접속'이 끊긴 것이므로 새 세션으로 보고 session_started 를 지금으로 리셋한다.
        # 45초 주기의 1~2회 누락 정도의 짧은 공백은 기존 세션을 그대로 유지한다.
        gap_seconds = (now - row.last_seen).total_seconds() if row.last_seen else None
        if row.session_started is None or (gap_seconds is not None and gap_seconds > ONLINE_THRESHOLD_SECONDS):
            row.session_started = now
        row.last_seen = now
        row.last_page = page
        row.last_ip = ip
        row.last_active_at = last_active_at
        row.app_version = app_version
    else:
        db.add(models.UserPresence(
            employee_id=employee_id,
            last_seen=now,
            last_page=page,
            last_ip=ip,
            session_started=now,
            last_active_at=last_active_at,
            app_version=app_version,
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

    # Housekeeping: 하루 이상 갱신 없던 잔여 행(비-로그아웃 종료분) 정리.
    stale_before = now - timedelta(seconds=STALE_PRESENCE_MAX_AGE_SECONDS)
    purged = (
        db.query(models.UserPresence)
        .filter(models.UserPresence.last_seen < stale_before)
        .delete(synchronize_session=False)
    )
    if purged:
        db.commit()

    rows = (
        db.query(models.UserPresence, models.User)
        .outerjoin(models.User, models.UserPresence.employee_id == models.User.employee_id)
        .filter(models.UserPresence.last_seen >= cutoff)
        .order_by(models.UserPresence.last_seen.desc())
        .all()
    )

    items = []
    active_count = 0
    idle_count = 0
    for presence, user in rows:
        # 유휴 경과: last_active_at 이 없으면 last_seen 을 대체값으로 사용.
        active_ref = presence.last_active_at or presence.last_seen
        idle_seconds = int((now - active_ref).total_seconds()) if active_ref else None
        session_seconds = (
            int((now - presence.session_started).total_seconds())
            if presence.session_started else None
        )
        is_idle = bool(idle_seconds is not None and idle_seconds >= IDLE_THRESHOLD_SECONDS)
        if is_idle:
            idle_count += 1
        else:
            active_count += 1
        items.append({
            "employee_id": presence.employee_id,
            "name": user.name if user else None,
            "department": user.department if user else None,
            "company": user.company if user else None,
            "is_admin": bool(user.is_admin) if user else False,
            "last_seen": presence.last_seen.isoformat() if presence.last_seen else None,
            "seconds_ago": int((now - presence.last_seen).total_seconds()) if presence.last_seen else None,
            "last_ip": presence.last_ip,
            "last_page": presence.last_page,
            "app_version": presence.app_version,
            "session_started": presence.session_started.isoformat() if presence.session_started else None,
            "session_seconds": session_seconds,
            "idle_seconds": idle_seconds,
            "is_idle": is_idle,
        })

    return {
        "count": len(items),
        "active_count": active_count,
        "idle_count": idle_count,
        "threshold_seconds": ONLINE_THRESHOLD_SECONDS,
        "idle_threshold_seconds": IDLE_THRESHOLD_SECONDS,
        "items": items,
    }


def _extract_token(raw: bytes) -> str:
    """sendBeacon 본문에서 세션 토큰을 관대하게 추출한다(평문 또는 {"token": ...})."""
    text = (raw or b"").decode("utf-8", errors="ignore").strip()
    if text.startswith("{"):
        try:
            return str(json.loads(text).get("token", "")).strip()
        except (ValueError, TypeError):
            return ""
    return text


@router.post("/offline")
async def presence_offline(req: Request, db: Session = Depends(database.get_db)):
    """앱 종료(pagehide) 시 navigator.sendBeacon 으로 호출되는 즉시 오프라인 처리.

    sendBeacon 은 커스텀 헤더(Authorization)를 실을 수 없으므로 세션 토큰을 본문으로 받아
    검증한다. 유효한 토큰이면 해당 사용자의 presence 행을 삭제해 즉시 오프라인으로 만든다.
    """
    token = _extract_token(await req.body())
    if not token:
        return {"ok": False}

    session = (
        db.query(models.UserSession)
        .filter(models.UserSession.token == token)
        .first()
    )
    if not session or datetime.now() > session.expires_at:
        return {"ok": False}

    db.query(models.UserPresence).filter(
        models.UserPresence.employee_id == session.employee_id
    ).delete(synchronize_session=False)
    db.commit()
    return {"ok": True}


@router.post("/force-logout/{employee_id}")
def force_logout(
    employee_id: str,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    """관리자가 특정 사용자의 모든 세션을 무효화하고 오프라인 처리한다(점검·배포용).

    대상 클라이언트는 다음 요청에서 401 을 받아 자동 로그아웃된다. 관리자 본인은 대상에서 제외.
    """
    if employee_id == current_admin:
        return {"ok": False, "reason": "self", "revoked_sessions": 0}

    revoked = (
        db.query(models.UserSession)
        .filter(models.UserSession.employee_id == employee_id)
        .delete(synchronize_session=False)
    )
    db.query(models.UserPresence).filter(
        models.UserPresence.employee_id == employee_id
    ).delete(synchronize_session=False)
    db.commit()
    return {"ok": True, "revoked_sessions": int(revoked)}
