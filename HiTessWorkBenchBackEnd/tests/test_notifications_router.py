"""알림 센터 API — 목록(델타)/읽음/모두 읽음/삭제/권한.

conftest 의 admin_client 는 require_auth 를 ADMIN001 로 고정한다. 다른 사용자 시점은
test_chat_router.py 와 같은 _act_as() 로 require_auth override 만 교체한다.
"""
from app import models
from app.dependencies import require_auth
from app.main import app
from app.services.notification_service import notify


def _act_as(employee_id: str):
    app.dependency_overrides[require_auth] = lambda: employee_id


def _seed(db, employee_id, n, kind="job.completed"):
    return [notify(db, employee_id=employee_id, kind=kind, title=f"{employee_id}-{i}") for i in range(n)]


def test_list_returns_only_mine_newest_first_with_unread_count(admin_client, db_session):
    mine = _seed(db_session, "ADMIN001", 3)
    _seed(db_session, "EMP001", 2)

    data = admin_client.get("/api/notifications").json()
    assert [n["id"] for n in data["items"]] == [mine[2].id, mine[1].id, mine[0].id]
    assert data["unread_count"] == 3
    assert data["latest_id"] == mine[2].id
    assert data["prefs"] == {"muted_kinds": [], "desktop_toast": True}
    item = data["items"][0]
    assert set(item) == {"id", "kind", "title", "body", "link", "created_at", "read_at", "is_read"}


def test_list_since_returns_delta_but_counts_are_global(admin_client, db_session):
    first = _seed(db_session, "ADMIN001", 2)
    later = _seed(db_session, "ADMIN001", 2)

    data = admin_client.get(f"/api/notifications?since={first[1].id}").json()
    assert [n["id"] for n in data["items"]] == [later[1].id, later[0].id]
    assert data["unread_count"] == 4
    assert data["latest_id"] == later[1].id


def test_list_limit_and_unread_only(admin_client, db_session):
    rows = _seed(db_session, "ADMIN001", 5)
    admin_client.post(f"/api/notifications/{rows[4].id}/read")

    data = admin_client.get("/api/notifications?limit=2").json()
    assert len(data["items"]) == 2

    data = admin_client.get("/api/notifications?unread_only=true").json()
    assert rows[4].id not in {n["id"] for n in data["items"]}
    assert len(data["items"]) == 4

    assert admin_client.get("/api/notifications?limit=0").status_code == 422
    assert admin_client.get("/api/notifications?limit=101").status_code == 422


def test_list_reflects_user_preferences(admin_client, db_session):
    db_session.add(models.UserPreference(
        employee_id="ADMIN001",
        prefs={"notifications": {"muted_kinds": ["job.failed"], "desktop_toast": False}},
    ))
    db_session.commit()
    data = admin_client.get("/api/notifications").json()
    assert data["prefs"] == {"muted_kinds": ["job.failed"], "desktop_toast": False}


def test_mark_read_and_read_all(admin_client, db_session):
    rows = _seed(db_session, "ADMIN001", 3)

    r = admin_client.post(f"/api/notifications/{rows[0].id}/read")
    assert r.status_code == 200 and r.json() == {"ok": True, "id": rows[0].id}
    db_session.expire_all()
    assert db_session.get(models.Notification, rows[0].id).read_at is not None
    assert admin_client.get("/api/notifications").json()["unread_count"] == 2

    # 멱등
    assert admin_client.post(f"/api/notifications/{rows[0].id}/read").status_code == 200

    r = admin_client.post("/api/notifications/read-all")
    assert r.json() == {"updated": 2}
    assert admin_client.get("/api/notifications").json()["unread_count"] == 0
    assert admin_client.post("/api/notifications/read-all").json() == {"updated": 0}


def test_delete_own_notification(admin_client, db_session):
    rows = _seed(db_session, "ADMIN001", 2)
    r = admin_client.delete(f"/api/notifications/{rows[0].id}")
    assert r.status_code == 200 and r.json() == {"ok": True}
    db_session.expire_all()
    assert db_session.get(models.Notification, rows[0].id) is None
    assert admin_client.delete(f"/api/notifications/{rows[0].id}").status_code == 404


def test_other_users_notification_is_404_for_read_and_delete(admin_client, db_session):
    theirs = _seed(db_session, "EMP001", 1)[0]
    assert admin_client.post(f"/api/notifications/{theirs.id}/read").status_code == 404
    assert admin_client.delete(f"/api/notifications/{theirs.id}").status_code == 404

    _act_as("EMP001")
    assert admin_client.post(f"/api/notifications/{theirs.id}/read").status_code == 200
    db_session.expire_all()
    assert db_session.get(models.Notification, theirs.id).read_at is not None


def test_read_all_only_touches_mine(admin_client, db_session):
    _seed(db_session, "ADMIN001", 1)
    theirs = _seed(db_session, "EMP001", 1)[0]
    assert admin_client.post("/api/notifications/read-all").json() == {"updated": 1}
    db_session.expire_all()
    assert db_session.get(models.Notification, theirs.id).read_at is None


def test_requires_auth(admin_client):
    saved = app.dependency_overrides.pop(require_auth)
    try:
        assert admin_client.get("/api/notifications").status_code == 401
        assert admin_client.post("/api/notifications/read-all").status_code == 401
    finally:
        app.dependency_overrides[require_auth] = saved
