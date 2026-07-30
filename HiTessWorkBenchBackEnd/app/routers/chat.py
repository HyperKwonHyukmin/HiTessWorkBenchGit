"""관리자↔사용자 1:1 DM 채팅 API.

polling 기반: 클라이언트가 우하단 채팅 도크에서 /threads 를 주기적으로 폴링해
미읽음/최근 메시지를 받고, 대화를 열면 /conversation/{other} 로 내역을 가져오며
자신에게 온 미읽음을 읽음 처리한다. presence 와 동일하게 WebSocket 없이 동작한다.

범위: 대화 양측 중 최소 1명은 관리자여야 한다(비관리자↔비관리자 = peer-to-peer 금지).
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from .. import database, models
from ..dependencies import require_auth
from .presence import presence_status

router = APIRouter(prefix="/api/chat", tags=["chat"])

# 메시지 본문 최대 길이 — 초과분은 조용히 잘라 저장(presence 의 page[:200] 과 동일한 방어 패턴).
MAX_BODY_LEN = 2000


class SendRequest(BaseModel):
    recipient_id: str
    body: str


def _user(db: Session, employee_id: str):
    return (
        db.query(models.User)
        .filter(models.User.employee_id == employee_id)
        .first()
    )


def _visible_to(m: "models.ChatMessage", me: str) -> bool:
    """'내게서만 삭제'를 반영해 이 메시지가 me 의 화면에 보여야 하는지 판정한다."""
    if m.sender_id == me and m.hidden_by_sender:
        return False
    if m.recipient_id == me and m.hidden_by_recipient:
        return False
    return True


@router.post("/send")
def send_message(
    payload: SendRequest,
    db: Session = Depends(database.get_db),
    sender_id: str = Depends(require_auth),
):
    """현재 사용자가 recipient_id 에게 메시지를 보낸다(양측 중 1명은 관리자여야 함)."""
    body = (payload.body or "").strip()[:MAX_BODY_LEN]
    if not body:
        raise HTTPException(status_code=400, detail="메시지 내용이 비어 있습니다.")

    recipient_id = (payload.recipient_id or "").strip()
    recipient = _user(db, recipient_id)
    if not recipient:
        raise HTTPException(status_code=404, detail="수신자를 찾을 수 없습니다.")

    sender = _user(db, sender_id)
    sender_is_admin = bool(sender and sender.is_admin)
    recipient_is_admin = bool(recipient.is_admin)
    # 범위 강제: 관리자↔사용자 1:1 DM 만 허용 — 양측 모두 비관리자면 거부.
    if not sender_is_admin and not recipient_is_admin:
        raise HTTPException(status_code=403, detail="관리자와의 대화만 허용됩니다.")

    msg = models.ChatMessage(
        sender_id=sender_id,
        recipient_id=recipient_id,
        body=body,
        created_at=datetime.now(),
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return {"ok": True, "id": msg.id}


# 목록 정렬 우선순위 — 지금 응답 가능한 사람이 위로 온다.
_STATUS_ORDER = {"online": 0, "idle": 1, "offline": 2}


@router.get("/contacts")
def get_contacts(
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """대화를 걸 수 있는 상대(활성 관리자) 목록 + 접속 상태.

    send 의 '양측 중 1명은 관리자' 규칙과 짝을 이루는 목록이라 같은 파일에 둔다.
    응답 필드는 화이트리스트로 최소화한다 — last_ip / last_page / app_version 은 물론
    last_seen(마지막 접속 시각)도 넣지 않는다. 전 직원이 관리자의 근태를 조회하는
    창구가 되면 안 되므로 상태는 3단계 라벨로만 노출한다.
    """
    now = datetime.now()
    rows = (
        db.query(models.User, models.UserPresence)
        .outerjoin(
            models.UserPresence,
            models.User.employee_id == models.UserPresence.employee_id,
        )
        .filter(
            models.User.is_admin.is_(True),
            models.User.is_active.is_(True),
            models.User.employee_id != me,
        )
        .all()
    )

    items = [
        {
            "employee_id": user.employee_id,
            "name": user.name,
            "department": user.department,
            "status": presence_status(presence, now),
            "is_admin": True,
        }
        for user, presence in rows
    ]
    items.sort(
        key=lambda x: (
            _STATUS_ORDER.get(x["status"], 3),
            x["name"] or x["employee_id"],
        )
    )
    return {"items": items}


def _serialize(m: models.ChatMessage, me: str) -> dict:
    return {
        "id": m.id,
        "sender_id": m.sender_id,
        "recipient_id": m.recipient_id,
        "body": m.body,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "read_at": m.read_at.isoformat() if m.read_at else None,
        "mine": m.sender_id == me,
    }


@router.get("/conversation/{other_id}")
def get_conversation(
    other_id: str,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """나 ↔ other_id 대화내역(시간순)을 반환하고, 나에게 온 미읽음을 읽음 처리한다."""
    msgs = (
        db.query(models.ChatMessage)
        .filter(
            or_(
                and_(
                    models.ChatMessage.sender_id == me,
                    models.ChatMessage.recipient_id == other_id,
                ),
                and_(
                    models.ChatMessage.sender_id == other_id,
                    models.ChatMessage.recipient_id == me,
                ),
            )
        )
        .order_by(models.ChatMessage.created_at.asc(), models.ChatMessage.id.asc())
        .all()
    )

    # '내게서만 삭제'로 내가 숨긴 메시지는 제외.
    msgs = [m for m in msgs if _visible_to(m, me)]

    # 상대가 나에게 보낸 미읽음 메시지를 읽음 처리(내가 보낸 것은 건드리지 않음).
    now = datetime.now()
    changed = False
    for m in msgs:
        if m.recipient_id == me and m.sender_id == other_id and m.read_at is None:
            m.read_at = now
            changed = True
    if changed:
        db.commit()

    other = _user(db, other_id)
    return {
        "other_id": other_id,
        "other_name": other.name if other else None,
        "other_is_admin": bool(other.is_admin) if other else False,
        "messages": [_serialize(m, me) for m in msgs],
    }


@router.get("/threads")
def get_threads(
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """내가 관여한 대화들을 상대별로 묶어 미읽음·마지막 메시지와 함께 반환(도크 폴링용)."""
    msgs = (
        db.query(models.ChatMessage)
        .filter(
            or_(
                models.ChatMessage.sender_id == me,
                models.ChatMessage.recipient_id == me,
            )
        )
        .order_by(models.ChatMessage.created_at.asc(), models.ChatMessage.id.asc())
        .all()
    )

    threads: dict = {}
    for m in msgs:
        if not _visible_to(m, me):
            continue  # 내가 숨긴 메시지는 목록/미읽음 집계에서 제외.
        other_id = m.recipient_id if m.sender_id == me else m.sender_id
        t = threads.get(other_id)
        if t is None:
            t = {"other_id": other_id, "last_message": None, "last_at": None, "unread": 0}
            threads[other_id] = t
        # msgs 는 시간 오름차순 → 마지막 순회 값이 최신 메시지.
        t["last_message"] = m.body
        t["last_at"] = m.created_at.isoformat() if m.created_at else None
        if m.recipient_id == me and m.read_at is None:
            t["unread"] += 1

    result = []
    total_unread = 0
    for other_id, t in threads.items():
        other = _user(db, other_id)
        t["other_name"] = other.name if other else None
        t["other_is_admin"] = bool(other.is_admin) if other else False
        total_unread += t["unread"]
        result.append(t)

    # 최신 대화 순(마지막 메시지 시각 내림차순).
    result.sort(key=lambda x: x["last_at"] or "", reverse=True)
    return {"total_unread": total_unread, "threads": result}


@router.delete("/conversation/{other_id}")
def delete_conversation(
    other_id: str,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """나 ↔ other_id 대화를 '내 화면에서만' 숨긴다(상대 기록은 보존).

    삭제자가 보낸 메시지는 hidden_by_sender, 받은 메시지는 hidden_by_recipient 를 세운다.
    삭제 이후 도착하는 새 메시지는 플래그가 없어 자연히 다시 보인다.
    """
    msgs = (
        db.query(models.ChatMessage)
        .filter(
            or_(
                and_(
                    models.ChatMessage.sender_id == me,
                    models.ChatMessage.recipient_id == other_id,
                ),
                and_(
                    models.ChatMessage.sender_id == other_id,
                    models.ChatMessage.recipient_id == me,
                ),
            )
        )
        .all()
    )

    hidden = 0
    for m in msgs:
        if m.sender_id == me and not m.hidden_by_sender:
            m.hidden_by_sender = True
            hidden += 1
        elif m.recipient_id == me and not m.hidden_by_recipient:
            m.hidden_by_recipient = True
            hidden += 1
    if hidden:
        db.commit()
    return {"ok": True, "hidden": hidden}
