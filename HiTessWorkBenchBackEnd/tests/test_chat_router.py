"""관리자↔사용자 1:1 DM 채팅 라우터 테스트.

conftest 의 admin_client 는 require_auth 를 ADMIN001 로 고정한다. 특정 테스트에서
'다른 사용자 시점'이 필요하면 _act_as() 로 require_auth override 만 교체한다
(database.get_db override 는 유지되어 같은 인메모리 세션을 계속 사용).
"""
from app import models
from app.dependencies import require_auth
from app.main import app


def _act_as(employee_id: str):
    """현재 인증 사용자를 교체한다(require_auth override 만 갱신)."""
    app.dependency_overrides[require_auth] = lambda: employee_id


def test_send_then_conversation_returns_message(admin_client, make_user):
    """관리자가 보낸 메시지가 대화내역에 나타나고 발신자 시점에서 mine=True 다."""
    make_user("USER001", name="홍길동")

    r = admin_client.post("/api/chat/send", json={"recipient_id": "USER001", "body": "안녕하세요"})
    assert r.status_code == 200
    assert r.json()["ok"] is True

    conv = admin_client.get("/api/chat/conversation/USER001").json()
    assert conv["other_id"] == "USER001"
    assert conv["other_name"] == "홍길동"
    assert len(conv["messages"]) == 1
    m = conv["messages"][0]
    assert m["sender_id"] == "ADMIN001"
    assert m["recipient_id"] == "USER001"
    assert m["body"] == "안녕하세요"
    assert m["mine"] is True


def test_conversation_marks_incoming_as_read(admin_client, make_user, db_session):
    """수신자가 대화를 열람하면 자신에게 온 미읽음 메시지가 읽음 처리된다."""
    make_user("USER001")
    admin_client.post("/api/chat/send", json={"recipient_id": "USER001", "body": "hi"})

    _act_as("USER001")
    admin_client.get("/api/chat/conversation/ADMIN001")

    db_session.expire_all()
    msg = db_session.query(models.ChatMessage).one()
    assert msg.read_at is not None


def test_conversation_does_not_mark_own_outgoing_as_read(admin_client, make_user, db_session):
    """발신자가 자기 대화를 열어도 자신이 보낸(상대가 아직 안 읽은) 메시지는 읽음 처리되지 않는다."""
    make_user("USER001")
    admin_client.post("/api/chat/send", json={"recipient_id": "USER001", "body": "hi"})

    # 관리자(발신자) 시점에서 열람
    admin_client.get("/api/chat/conversation/USER001")

    db_session.expire_all()
    msg = db_session.query(models.ChatMessage).one()
    assert msg.read_at is None


def test_threads_lists_conversation_with_unread(admin_client, make_user):
    """수신자의 /threads 는 상대별 대화·미읽음 개수·마지막 메시지를 반환한다."""
    make_user("USER001", name="홍길동")
    admin_client.post("/api/chat/send", json={"recipient_id": "USER001", "body": "hi"})
    admin_client.post("/api/chat/send", json={"recipient_id": "USER001", "body": "there"})

    _act_as("USER001")
    data = admin_client.get("/api/chat/threads").json()
    assert data["total_unread"] == 2
    assert len(data["threads"]) == 1
    t = data["threads"][0]
    assert t["other_id"] == "ADMIN001"
    assert t["other_name"] == "관리자"
    assert t["other_is_admin"] is True
    assert t["unread"] == 2
    assert t["last_message"] == "there"


def test_unread_cleared_after_reading_conversation(admin_client, make_user):
    """대화를 열람하면 해당 상대의 미읽음이 0 이 된다."""
    make_user("USER001")
    admin_client.post("/api/chat/send", json={"recipient_id": "USER001", "body": "hi"})

    _act_as("USER001")
    admin_client.get("/api/chat/conversation/ADMIN001")
    data = admin_client.get("/api/chat/threads").json()
    assert data["total_unread"] == 0
    assert data["threads"][0]["unread"] == 0


def test_non_admin_cannot_message_non_admin(admin_client, make_user):
    """비관리자끼리의 메시지는 금지된다(admin↔user 1:1 범위 강제)."""
    make_user("USER001")
    make_user("USER002")

    _act_as("USER001")
    r = admin_client.post("/api/chat/send", json={"recipient_id": "USER002", "body": "hi"})
    assert r.status_code == 403


def test_user_can_reply_to_admin(admin_client, make_user):
    """사용자는 관리자에게 답장(발신)할 수 있다."""
    make_user("USER001")

    _act_as("USER001")
    r = admin_client.post("/api/chat/send", json={"recipient_id": "ADMIN001", "body": "네 확인했습니다"})
    assert r.status_code == 200


def test_send_rejects_empty_body(admin_client, make_user):
    """공백만 있는 본문은 거부된다."""
    make_user("USER001")
    r = admin_client.post("/api/chat/send", json={"recipient_id": "USER001", "body": "   "})
    assert r.status_code == 400


def test_send_rejects_unknown_recipient(admin_client):
    """존재하지 않는 수신자에게는 보낼 수 없다."""
    r = admin_client.post("/api/chat/send", json={"recipient_id": "NOPE", "body": "hi"})
    assert r.status_code == 404
