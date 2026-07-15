"""실시간 접속(presence) 라우터 테스트."""
from datetime import datetime, timedelta

from app import models


def test_heartbeat_then_online_lists_user(admin_client):
    """하트비트 후 /online 에 사용자가 뜨고 현재 페이지(last_page)가 반영된다."""
    r = admin_client.post("/api/presence/heartbeat", json={"page": "User Management"})
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    r2 = admin_client.get("/api/presence/online")
    assert r2.status_code == 200
    data = r2.json()
    assert data["count"] == 1
    item = data["items"][0]
    assert item["employee_id"] == "ADMIN001"
    assert item["name"] == "관리자"
    assert item["last_page"] == "User Management"
    assert item["seconds_ago"] is not None and item["seconds_ago"] < 5
    # 접속 지속 시간 / 유휴 필드가 함께 내려온다.
    assert item["session_seconds"] is not None and item["session_seconds"] < 5
    assert item["is_idle"] is False


def test_stale_presence_excluded_from_online(admin_client, db_session):
    """last_seen 이 임계시간(150초)을 초과한 오래된 접속은 /online 에서 제외된다."""
    db_session.add(models.UserPresence(
        employee_id="ADMIN001",
        last_seen=datetime.now() - timedelta(seconds=600),
        last_page="Dashboard",
        last_ip="127.0.0.1",
    ))
    db_session.commit()

    data = admin_client.get("/api/presence/online").json()
    assert data["count"] == 0


def test_heartbeat_upserts_single_row_and_keeps_session_start(admin_client, db_session):
    """하트비트 재호출은 새 행을 만들지 않고 기존 행을 갱신하되 session_started 는 유지한다."""
    admin_client.post("/api/presence/heartbeat", json={"page": "Dashboard"})
    first = db_session.query(models.UserPresence).one()
    started = first.session_started
    assert started is not None

    admin_client.post("/api/presence/heartbeat", json={"page": "System Settings"})
    db_session.expire_all()
    rows = db_session.query(models.UserPresence).all()
    assert len(rows) == 1
    assert rows[0].last_page == "System Settings"
    assert rows[0].session_started == started  # 접속 시작 시각은 유지


def test_heartbeat_resets_session_after_long_offline_gap(admin_client, db_session):
    """마지막 하트비트 이후 온라인 임계를 넘긴 공백이 있으면 session_started 를 재접속 시점으로 리셋한다."""
    from app.routers.presence import ONLINE_THRESHOLD_SECONDS

    db_session.add(models.UserPresence(
        employee_id="ADMIN001",
        last_seen=datetime.now() - timedelta(seconds=ONLINE_THRESHOLD_SECONDS + 3600),
        session_started=datetime.now() - timedelta(hours=76),
        last_page="Dashboard",
    ))
    db_session.commit()

    admin_client.post("/api/presence/heartbeat", json={"page": "Dashboard"})
    db_session.expire_all()
    row = db_session.query(models.UserPresence).one()
    # 76시간 전이 아니라 재접속(지금)으로 리셋되어야 한다.
    assert (datetime.now() - row.session_started).total_seconds() < 10

    data = admin_client.get("/api/presence/online").json()
    assert data["items"][0]["session_seconds"] < 10


def test_idle_seconds_marks_user_as_idle(admin_client):
    """idle_seconds 가 유휴 임계(180초)를 넘으면 is_idle=True 로 표시된다."""
    admin_client.post("/api/presence/heartbeat", json={"page": "Dashboard", "idle_seconds": 600})

    item = admin_client.get("/api/presence/online").json()["items"][0]
    assert item["is_idle"] is True
    assert item["idle_seconds"] >= 590


def test_online_returns_app_version_and_split_counts(admin_client):
    """하트비트의 app_version 이 /online 에 반영되고 활성/유휴 카운트가 분리된다."""
    admin_client.post("/api/presence/heartbeat", json={
        "page": "Dashboard", "app_version": "1.3.24", "idle_seconds": 0,
    })
    data = admin_client.get("/api/presence/online").json()
    assert data["active_count"] == 1
    assert data["idle_count"] == 0
    assert data["items"][0]["app_version"] == "1.3.24"


def test_offline_beacon_removes_presence_with_valid_token(admin_client, db_session):
    """유효한 세션 토큰으로 /offline 을 호출하면 해당 사용자의 presence 가 즉시 삭제된다."""
    db_session.add(models.UserSession(
        token="tok-123", employee_id="ADMIN001",
        created_at=datetime.now(), expires_at=datetime.now() + timedelta(hours=1),
    ))
    db_session.commit()
    admin_client.post("/api/presence/heartbeat", json={"page": "Dashboard"})
    assert db_session.query(models.UserPresence).count() == 1

    r = admin_client.post("/api/presence/offline", content="tok-123")
    assert r.status_code == 200 and r.json()["ok"] is True
    db_session.expire_all()
    assert db_session.query(models.UserPresence).count() == 0


def test_offline_beacon_ignores_invalid_token(admin_client, db_session):
    """유효하지 않은 토큰의 /offline 은 presence 를 삭제하지 않는다."""
    admin_client.post("/api/presence/heartbeat", json={"page": "Dashboard"})
    r = admin_client.post("/api/presence/offline", content="bogus-token")
    assert r.json()["ok"] is False
    db_session.expire_all()
    assert db_session.query(models.UserPresence).count() == 1


def test_force_logout_revokes_sessions_and_presence(admin_client, db_session):
    """관리자 강제 로그아웃은 대상의 모든 세션과 presence 를 삭제한다."""
    db_session.add_all([
        models.UserSession(
            token="t1", employee_id="USER001",
            created_at=datetime.now(), expires_at=datetime.now() + timedelta(hours=1),
        ),
        models.UserPresence(
            employee_id="USER001", last_seen=datetime.now(), last_page="Dashboard",
        ),
    ])
    db_session.commit()

    r = admin_client.post("/api/presence/force-logout/USER001")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["revoked_sessions"] == 1
    db_session.expire_all()
    assert db_session.query(models.UserSession).filter_by(employee_id="USER001").count() == 0
    assert db_session.query(models.UserPresence).filter_by(employee_id="USER001").count() == 0


def test_force_logout_refuses_self(admin_client):
    """관리자는 자기 자신을 강제 로그아웃할 수 없다."""
    r = admin_client.post("/api/presence/force-logout/ADMIN001")
    assert r.json()["ok"] is False
    assert r.json()["reason"] == "self"
