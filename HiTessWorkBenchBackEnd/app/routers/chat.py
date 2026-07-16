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
