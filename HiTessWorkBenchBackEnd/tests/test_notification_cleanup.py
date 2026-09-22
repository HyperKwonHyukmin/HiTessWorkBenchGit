"""알림 90일 정리 — cleanup_service.run_notification_cleanup / run_all_cleanup 키."""
from datetime import datetime, timedelta

from app import database, models
from app.services import cleanup_service
from app.services.notification_service import NOTIFICATION_RETENTION_DAYS, notify


def _seed(db):
    old = notify(db, employee_id="EMP001", kind="job.completed", title="old")
    old.created_at = datetime.now() - timedelta(days=NOTIFICATION_RETENTION_DAYS + 3)
    notify(db, employee_id="EMP001", kind="job.completed", title="fresh")
    db.commit()


def test_dry_run_counts_without_deleting(db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    _seed(db_session)
    result = cleanup_service.run_notification_cleanup(dry_run=True)
    assert result == {"deleted": 1, "errors": []}
    assert db_session.query(models.Notification).count() == 2


def test_real_run_deletes_old_rows(db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    _seed(db_session)
    result = cleanup_service.run_notification_cleanup()
    assert result == {"deleted": 1, "errors": []}
    db_session.expire_all()
    assert [r.title for r in db_session.query(models.Notification).all()] == ["fresh"]


def test_errors_are_reported_by_type_only(db_session, monkeypatch):
    def _broken():
        raise RuntimeError("secret://dsn")
    monkeypatch.setattr(database, "SessionLocal", _broken)
    result = cleanup_service.run_notification_cleanup()
    assert result["deleted"] == 0
    assert result["errors"] == ["RuntimeError"]


def test_run_all_cleanup_includes_notifications(db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    result = cleanup_service.run_all_cleanup(dry_run=True)
    assert set(result) == {"user_connection", "activity_logs", "sessions", "notifications"}
    assert result["notifications"] == {"deleted": 0, "errors": []}
