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


def test_delete_conversation_hides_for_deleter_only(admin_client, make_user):
    """대화 삭제는 삭제한 사람 화면에서만 대화를 숨기고 상대는 그대로 본다(내게서만 삭제)."""
    make_user("USER001", name="홍길동")
    admin_client.post("/api/chat/send", json={"recipient_id": "USER001", "body": "hi"})
    admin_client.post("/api/chat/send", json={"recipient_id": "USER001", "body": "there"})

    # USER001 이 대화를 삭제.
    _act_as("USER001")
    r = admin_client.delete("/api/chat/conversation/ADMIN001")
    assert r.status_code == 200

    # USER001 시점: 대화·목록 모두 비었다.
    assert admin_client.get("/api/chat/conversation/ADMIN001").json()["messages"] == []
    threads = admin_client.get("/api/chat/threads").json()
    assert threads["total_unread"] == 0
    assert threads["threads"] == []

    # 관리자 시점: 대화가 그대로 남아 있다.
    _act_as("ADMIN001")
    assert len(admin_client.get("/api/chat/conversation/USER001").json()["messages"]) == 2
    assert len(admin_client.get("/api/chat/threads").json()["threads"]) == 1


def test_new_message_after_delete_reappears_for_deleter(admin_client, make_user):
    """삭제 후 상대가 새 메시지를 보내면 그 대화가 다시 나타나고 과거 메시지는 계속 숨겨진다."""
    make_user("USER001")
    admin_client.post("/api/chat/send", json={"recipient_id": "USER001", "body": "old-1"})
    admin_client.post("/api/chat/send", json={"recipient_id": "USER001", "body": "old-2"})

    _act_as("USER001")
    admin_client.delete("/api/chat/conversation/ADMIN001")

    # 관리자가 삭제 이후 새 메시지 전송.
    _act_as("ADMIN001")
    admin_client.post("/api/chat/send", json={"recipient_id": "USER001", "body": "new-3"})

    # USER001 시점: 대화 재등장, 새 메시지 1개만 보이고 미읽음 1.
    _act_as("USER001")
    threads = admin_client.get("/api/chat/threads").json()
    assert len(threads["threads"]) == 1
    assert threads["threads"][0]["unread"] == 1
    assert threads["threads"][0]["last_message"] == "new-3"
    msgs = admin_client.get("/api/chat/conversation/ADMIN001").json()["messages"]
    assert [m["body"] for m in msgs] == ["new-3"]


def test_contacts_lists_active_admins_excluding_self(admin_client, make_user):
    """사용자는 활성 관리자 전원을 대화 상대로 받는다(일반 사용자·본인은 제외)."""
    make_user("ADMIN002", name="김철수", is_admin=True)
    make_user("USER001", name="홍길동")

    _act_as("USER001")
    r = admin_client.get("/api/chat/contacts")
    assert r.status_code == 200
    ids = [i["employee_id"] for i in r.json()["items"]]
    assert set(ids) == {"ADMIN001", "ADMIN002"}
    assert "USER001" not in ids


def test_contacts_excludes_caller_when_caller_is_admin(admin_client, make_user):
    """관리자가 호출하면 자신은 목록에서 빠지고 다른 관리자만 남는다."""
    make_user("ADMIN002", name="김철수", is_admin=True)

    items = admin_client.get("/api/chat/contacts").json()["items"]
    assert [i["employee_id"] for i in items] == ["ADMIN002"]


def test_contacts_excludes_inactive_admin(admin_client, make_user):
    """승인되지 않은(is_active=False) 관리자는 노출하지 않는다."""
    make_user("ADMIN003", name="이영희", is_admin=True, is_active=False)
    make_user("USER001")

    _act_as("USER001")
    items = admin_client.get("/api/chat/contacts").json()["items"]
    assert [i["employee_id"] for i in items] == ["ADMIN001"]


def test_contacts_returns_empty_list_when_no_other_admin(admin_client):
    """대화 가능한 관리자가 없으면 빈 배열을 반환한다(프론트가 안내 문구를 띄운다)."""
    assert admin_client.get("/api/chat/contacts").json()["items"] == []


def test_contacts_includes_name_and_department(admin_client, make_user):
    """행 표시에 필요한 이름·부서가 함께 내려온다."""
    make_user("USER001")

    _act_as("USER001")
    item = admin_client.get("/api/chat/contacts").json()["items"][0]
    assert item["employee_id"] == "ADMIN001"
    assert item["name"] == "관리자"
    assert item["is_admin"] is True
    # conftest 의 ADMIN001 은 department 를 지정하지 않으므로 None 이다.
    assert "department" in item
