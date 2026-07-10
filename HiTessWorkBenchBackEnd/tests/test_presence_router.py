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


def test_heartbeat_upserts_single_row(admin_client, db_session):
    """하트비트 재호출은 새 행을 만들지 않고 기존 행을 갱신한다(사용자당 1행)."""
    admin_client.post("/api/presence/heartbeat", json={"page": "Dashboard"})
    admin_client.post("/api/presence/heartbeat", json={"page": "System Settings"})

    rows = db_session.query(models.UserPresence).all()
    assert len(rows) == 1
    assert rows[0].last_page == "System Settings"
