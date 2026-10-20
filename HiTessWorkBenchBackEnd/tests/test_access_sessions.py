"""접속 이력(access_sessions)·화면 오류 보고·해석 종료 시각 테스트."""
from datetime import datetime, timedelta

from app import models
from app.routers import presence
from app.services import access_session_service as svc


def _beat(db, now, page="Dashboard", idle=0, client=None, version="1.6.21"):
    row = svc.record_heartbeat(
        db, "EMP001", now=now, page=page, idle_seconds=idle,
        ip="10.0.0.1", app_version=version, client=client,
    )
    db.commit()
    return row


def test_thresholds_match_presence_router():
    assert svc.ONLINE_THRESHOLD_SECONDS == presence.ONLINE_THRESHOLD_SECONDS
    assert svc.IDLE_THRESHOLD_SECONDS == presence.IDLE_THRESHOLD_SECONDS


def test_heartbeats_accumulate_time_on_previous_page(db_session):
    t0 = datetime(2026, 10, 20, 9, 0, 0)
    _beat(db_session, t0, "Dashboard", client={"hostname": "HHI-PC01", "os_user": "kim", "platform": "win32"})
    _beat(db_session, t0 + timedelta(seconds=45), "Dashboard")
    # 화면 이동 즉시 하트비트 — 직전 간격은 Dashboard 몫
    _beat(db_session, t0 + timedelta(seconds=60), "HiTESS Model Builder")
    # 유휴 중 하트비트 — 접속 시간에는 더하고 활성 시간에는 더하지 않는다
    row = _beat(db_session, t0 + timedelta(seconds=105), "HiTESS Model Builder", idle=400)

    rows = db_session.query(models.AccessSession).all()
    assert len(rows) == 1
    assert row.online_seconds == 105
    assert row.active_seconds == 60
    assert row.page_seconds == {"Dashboard": 60}
    assert row.heartbeat_count == 4
    assert row.hostname == "HHI-PC01" and row.os_user == "kim"
    assert row.ended_at is None


def test_gap_over_threshold_opens_new_session_and_closes_old(db_session):
    t0 = datetime(2026, 10, 20, 9, 0, 0)
    _beat(db_session, t0)
    _beat(db_session, t0 + timedelta(seconds=30))
    _beat(db_session, t0 + timedelta(seconds=30 + svc.ONLINE_THRESHOLD_SECONDS + 10))

    rows = db_session.query(models.AccessSession).order_by(models.AccessSession.id).all()
    assert len(rows) == 2
    assert rows[0].end_reason == "timeout"
    assert rows[0].ended_at == t0 + timedelta(seconds=30)
    assert rows[0].online_seconds == 30
    assert rows[1].ended_at is None


def test_close_on_logout_adds_tail_and_relogin_does_not(db_session):
    t0 = datetime(2026, 10, 20, 9, 0, 0)
    _beat(db_session, t0)
    svc.close_open_sessions(db_session, "EMP001", "logout", now=t0 + timedelta(seconds=20))
    db_session.commit()
    first = db_session.query(models.AccessSession).one()
    assert first.end_reason == "logout"
    assert first.online_seconds == 20

    _beat(db_session, t0 + timedelta(minutes=10))
    svc.close_open_sessions(db_session, "EMP001", "relogin", now=t0 + timedelta(minutes=30))
    db_session.commit()
    second = db_session.query(models.AccessSession).order_by(models.AccessSession.id.desc()).first()
    assert second.end_reason == "relogin"
    assert second.ended_at == t0 + timedelta(minutes=10)


def test_close_stale_sessions(db_session):
    now = datetime.now()
    _beat(db_session, now - timedelta(minutes=30))
    assert svc.close_stale_sessions(db_session, now=now) == 1
    row = db_session.query(models.AccessSession).one()
    assert row.end_reason == "timeout"
    assert svc.close_stale_sessions(db_session, now=now) == 0


def test_heartbeat_route_records_session_and_admin_endpoints(admin_client, db_session):
    r = admin_client.post("/api/presence/heartbeat", json={
        "page": "Dashboard", "idle_seconds": 0, "app_version": "1.6.21",
        "client": {"hostname": "HHI-PC01", "os_user": "kim", "platform": "win32"},
    })
    assert r.status_code == 200
    row = db_session.query(models.AccessSession).one()
    assert row.employee_id == "ADMIN001" and row.hostname == "HHI-PC01"

    # 이전 하트비트를 60초 전으로 돌려 시간 누적을 만든다
    row.last_seen_at = datetime.now() - timedelta(seconds=60)
    db_session.commit()
    admin_client.post("/api/presence/heartbeat", json={"page": "My Projects"})

    listing = admin_client.get("/api/presence/sessions").json()
    assert listing["total"] == 1
    assert listing["items"][0]["name"] == "관리자"
    assert listing["items"][0]["page_seconds"].get("Dashboard", 0) >= 59

    summary = admin_client.get("/api/presence/sessions/summary?days=7").json()
    assert summary["user_count"] == 1
    assert summary["users"][0]["hostnames"] == ["HHI-PC01"]
    assert summary["pages"][0]["page"] == "Dashboard"


def test_offline_beacon_and_force_logout_close_sessions(admin_client, db_session):
    admin_client.post("/api/presence/heartbeat", json={"page": "Dashboard"})
    db_session.add(models.UserSession(
        token="tok-1", employee_id="ADMIN001",
        expires_at=datetime.now() + timedelta(hours=1),
    ))
    db_session.commit()
    assert admin_client.post("/api/presence/offline", content=b"tok-1").json() == {"ok": True}
    db_session.expire_all()
    row = db_session.query(models.AccessSession).one()
    assert row.end_reason == "closed"

    db_session.add(models.AccessSession(
        employee_id="EMP001", started_at=datetime.now(), last_seen_at=datetime.now(),
    ))
    db_session.commit()
    admin_client.post("/api/presence/force-logout/EMP001")
    db_session.expire_all()
    forced = db_session.query(models.AccessSession).filter_by(employee_id="EMP001").one()
    assert forced.end_reason == "forced"
    audit = db_session.query(models.ActivityLog).filter_by(action_type="FORCE_LOGOUT").one()
    assert audit.employee_id == "ADMIN001"
    assert audit.action_detail["target"] == "EMP001"


def test_sessions_endpoints_require_admin(switchable_client):
    switchable_client.as_user()
    assert switchable_client.get("/api/presence/sessions").status_code == 403
    assert switchable_client.get("/api/presence/sessions/summary").status_code == 403


def test_client_error_is_logged_without_auth_and_rate_limited(admin_client, db_session, monkeypatch):
    from app.routers import activity

    monkeypatch.setattr(activity, "_client_error_hits", {})
    r = admin_client.post("/api/activity/client-error", json={
        "kind": "window-error", "message": "x is undefined", "stack": "s" * 9000,
        "page": "Dashboard", "app_version": "1.6.21",
        "extra": {"hostname": "HHI-PC01", "big": "y" * 999},
    })
    assert r.json() == {"ok": True}
    log = db_session.query(models.ActivityLog).filter_by(action_type="CLIENT_ERROR").one()
    assert log.employee_id is None  # 토큰 없음 → 사번 없이
    assert log.status == "failure"
    assert len(log.action_detail["stack"]) == 4000
    assert len(log.action_detail["extra"]["big"]) == 300

    monkeypatch.setattr(activity, "CLIENT_ERROR_LIMIT_PER_MINUTE", 2)
    admin_client.post("/api/activity/client-error", json={"kind": "window-error"})
    r3 = admin_client.post("/api/activity/client-error", json={"kind": "window-error"})
    assert r3.json()["reason"] == "rate_limited"


def test_job_terminal_status_sets_finished_at(db_session, monkeypatch):
    from app import database
    from app.services import job_manager

    db_session.add(models.Analysis(job_id="job-x", program_name="P", employee_id="EMP001", status="Pending"))
    db_session.commit()
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)
    monkeypatch.setattr(job_manager, "_notify_job_terminal", lambda *a, **k: None)

    store = job_manager.job_status_store
    store._write_through("job-x", {"status": "Running"})
    rec = db_session.query(models.Analysis).filter_by(job_id="job-x").one()
    assert rec.started_at is not None and rec.finished_at is None
    store._write_through("job-x", {"status": "Success", "progress": 100})
    db_session.refresh(rec)
    assert rec.finished_at is not None
