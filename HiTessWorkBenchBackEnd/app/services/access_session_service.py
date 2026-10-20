"""접속 이력(access_sessions) 기록·조회.

하트비트가 올 때마다 '열린 세션' 하나를 이어서 갱신한다. 직전 하트비트와의 간격을
online_seconds 에 더하고, 유휴가 아니면 active_seconds 와 직전 화면의 page_seconds 에도 더한다.
간격이 온라인 임계(150초)를 넘으면 앱이 닫혔다가 다시 열린 것으로 보고 새 세션을 연다.

프런트는 화면을 옮길 때 곧바로 하트비트를 보내므로, 간격은 항상 '직전 하트비트의 화면'에서
보낸 시간이다.
"""
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from .. import models

# presence.py 의 판정 기준과 같은 값(순환 import 를 피하려고 여기 둔다).
ONLINE_THRESHOLD_SECONDS = 150
IDLE_THRESHOLD_SECONDS = 180
# page_seconds 키 상한 — 비정상 클라이언트가 페이지명을 마구 보내도 행이 커지지 않게.
MAX_PAGE_KEYS = 80

END_REASONS = ("logout", "closed", "forced", "relogin", "timeout")


def _clip(value: Optional[str], size: int) -> Optional[str]:
    text = (value or "").strip()
    return text[:size] or None


def _open_session(db: Session, employee_id: str) -> Optional[models.AccessSession]:
    return (
        db.query(models.AccessSession)
        .filter(
            models.AccessSession.employee_id == employee_id,
            models.AccessSession.ended_at.is_(None),
        )
        .order_by(models.AccessSession.id.desc())
        .first()
    )


def _apply_client_info(row: models.AccessSession, client: Optional[dict]) -> None:
    """Electron 이 알려 준 PC 정보. 옛 클라이언트는 보내지 않으므로 있을 때만 채운다."""
    if not client:
        return
    hostname = _clip(client.get("hostname"), 100)
    os_user = _clip(client.get("os_user"), 100)
    platform = _clip(client.get("platform"), 50)
    if hostname:
        row.hostname = hostname
    if os_user:
        row.os_user = os_user
    if platform:
        row.platform = platform


def record_heartbeat(
    db: Session,
    employee_id: str,
    *,
    now: datetime,
    page: Optional[str],
    idle_seconds: int,
    ip: Optional[str],
    app_version: Optional[str],
    client: Optional[dict] = None,
) -> models.AccessSession:
    """하트비트 1회를 접속 이력에 반영한다. commit 은 호출자가 한다."""
    page = _clip(page, 200)
    row = _open_session(db, employee_id)
    gap = (now - row.last_seen_at).total_seconds() if row and row.last_seen_at else None

    if row is not None and gap is not None and 0 <= gap <= ONLINE_THRESHOLD_SECONDS:
        delta = int(round(gap))
        row.online_seconds = (row.online_seconds or 0) + delta
        if idle_seconds < IDLE_THRESHOLD_SECONDS:
            row.active_seconds = (row.active_seconds or 0) + delta
            if row.last_page and delta > 0:
                pages = dict(row.page_seconds or {})
                if row.last_page in pages or len(pages) < MAX_PAGE_KEYS:
                    pages[row.last_page] = int(pages.get(row.last_page, 0)) + delta
                    # JSON 컬럼은 같은 객체를 고치면 변경을 못 알아챈다 — 새 dict 로 바꿔 끼운다.
                    row.page_seconds = pages
    else:
        if row is not None:
            # 하트비트가 끊긴 뒤 다시 들어왔다 — 이전 세션은 마지막 하트비트 시각에 끝난 것으로 본다.
            row.ended_at = row.last_seen_at
            row.end_reason = "timeout"
        row = models.AccessSession(
            employee_id=employee_id,
            started_at=now,
            last_seen_at=now,
            heartbeat_count=0,
            online_seconds=0,
            active_seconds=0,
            page_seconds={},
        )
        db.add(row)

    row.last_seen_at = now
    row.heartbeat_count = (row.heartbeat_count or 0) + 1
    row.last_page = page
    if ip:
        row.ip = _clip(ip, 50)
    if app_version:
        row.app_version = _clip(app_version, 30)
    _apply_client_info(row, client)
    return row


def close_open_sessions(
    db: Session,
    employee_id: str,
    reason: str,
    *,
    now: Optional[datetime] = None,
) -> int:
    """사용자의 열린 세션을 닫는다. commit 은 호출자가 한다.

    로그아웃·창 닫기·강제 로그아웃은 '지금' 끝난 것이고, 재로그인은 이전 세션이 마지막
    하트비트 시각에 끝난 것이다(로그인 화면에 머문 시간까지 접속으로 세지 않는다).
    """
    now = now or datetime.now()
    rows = (
        db.query(models.AccessSession)
        .filter(
            models.AccessSession.employee_id == employee_id,
            models.AccessSession.ended_at.is_(None),
        )
        .all()
    )
    for row in rows:
        if reason in ("logout", "closed", "forced"):
            gap = (now - row.last_seen_at).total_seconds() if row.last_seen_at else None
            # 마지막 하트비트 뒤의 짧은 꼬리(최대 임계값)까지만 접속 시간으로 더한다.
            if gap is not None and 0 < gap <= ONLINE_THRESHOLD_SECONDS:
                row.online_seconds = (row.online_seconds or 0) + int(round(gap))
                row.last_seen_at = now
            row.ended_at = row.last_seen_at or now
        else:
            row.ended_at = row.last_seen_at or now
        row.end_reason = reason
    return len(rows)


def close_stale_sessions(db: Session, *, now: Optional[datetime] = None) -> int:
    """하트비트가 끊긴 채 열려 있는 세션을 닫는다(정리 스케줄러). commit 포함."""
    now = now or datetime.now()
    cutoff = now - timedelta(seconds=ONLINE_THRESHOLD_SECONDS)
    rows = (
        db.query(models.AccessSession)
        .filter(
            models.AccessSession.ended_at.is_(None),
            models.AccessSession.last_seen_at < cutoff,
        )
        .all()
    )
    for row in rows:
        row.ended_at = row.last_seen_at
        row.end_reason = "timeout"
    if rows:
        db.commit()
    return len(rows)


def serialize_session(row: models.AccessSession, user: Optional[models.User] = None) -> dict:
    return {
        "id": row.id,
        "employee_id": row.employee_id,
        "name": user.name if user else None,
        "department": user.department if user else None,
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "last_seen_at": row.last_seen_at.isoformat() if row.last_seen_at else None,
        "ended_at": row.ended_at.isoformat() if row.ended_at else None,
        "end_reason": row.end_reason,
        "ip": row.ip,
        "app_version": row.app_version,
        "hostname": row.hostname,
        "os_user": row.os_user,
        "platform": row.platform,
        "online_seconds": row.online_seconds or 0,
        "active_seconds": row.active_seconds or 0,
        "page_seconds": row.page_seconds or {},
    }


def summarize_sessions(rows: list[tuple]) -> dict:
    """(AccessSession, User|None) 목록을 사용자별·화면별로 묶는다."""
    users: dict[str, dict] = {}
    pages: dict[str, int] = {}
    for row, user in rows:
        item = users.setdefault(row.employee_id, {
            "employee_id": row.employee_id,
            "name": user.name if user else None,
            "department": user.department if user else None,
            "sessions": 0,
            "days": set(),
            "online_seconds": 0,
            "active_seconds": 0,
            "hostnames": set(),
            "last_seen_at": None,
            "app_version": None,
        })
        item["sessions"] += 1
        if row.started_at:
            item["days"].add(row.started_at.date().isoformat())
        item["online_seconds"] += row.online_seconds or 0
        item["active_seconds"] += row.active_seconds or 0
        if row.hostname:
            item["hostnames"].add(row.hostname)
        if row.last_seen_at and (item["last_seen_at"] is None or row.last_seen_at > item["last_seen_at"]):
            item["last_seen_at"] = row.last_seen_at
            item["app_version"] = row.app_version
        for page, seconds in (row.page_seconds or {}).items():
            pages[page] = pages.get(page, 0) + int(seconds or 0)

    user_list = []
    for item in users.values():
        user_list.append({
            **item,
            "days": len(item["days"]),
            "hostnames": sorted(item["hostnames"]),
            "last_seen_at": item["last_seen_at"].isoformat() if item["last_seen_at"] else None,
        })
    user_list.sort(key=lambda x: x["active_seconds"], reverse=True)
    page_list = sorted(
        ({"page": page, "active_seconds": seconds} for page, seconds in pages.items()),
        key=lambda x: x["active_seconds"],
        reverse=True,
    )
    return {
        "user_count": len(user_list),
        "session_count": sum(u["sessions"] for u in user_list),
        "online_seconds": sum(u["online_seconds"] for u in user_list),
        "active_seconds": sum(u["active_seconds"] for u in user_list),
        "users": user_list,
        "pages": page_list,
    }
