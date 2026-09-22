"""JobStatusStore._write_through 가 Success/Failed 반영 직후 알림을 남기는지 검증한다.

database.SessionLocal 을 conftest 의 인메모리 SQLite 세션으로 바꿔 write-through 가 그 세션에
쓰게 한다(test_doublepipe_psa_persistence.py 와 같은 패턴). _write_through 는 finally 에서
db.close() 를 부르지만 SQLAlchemy Session 은 close 뒤 재사용이 가능하다.
"""
from datetime import datetime

from app import database, models
from app.services import job_manager, notification_service


def _running_analysis(make_analysis, job_id, program="Truss Assessment"):
    a = make_analysis("EMP001", program, datetime(2026, 9, 18, 9, 0, 0), status="Running")
    a.job_id = job_id
    a.project_name = "3496 유닛 권상"
    return a


def test_success_write_through_creates_completed_notification(db_session, make_analysis, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    a = _running_analysis(make_analysis, "job-wt-1")
    db_session.commit()
    # _write_through 가 finally 에서 db.close() 를 불러 인스턴스가 detach 되므로 id 를 미리 잡는다.
    analysis_id = a.id

    job_manager.job_status_store.update_job("job-wt-1", {"status": "Success", "progress": 100, "message": "완료"})

    db_session.expire_all()
    rows = db_session.query(models.Notification).all()
    assert len(rows) == 1
    assert rows[0].employee_id == "EMP001"
    assert rows[0].kind == "job.completed"
    assert rows[0].link["params"]["analysis_id"] == analysis_id
    saved = db_session.get(models.Analysis, analysis_id)
    assert saved.job_status == "Success" and saved.status == "Success"


def test_failed_write_through_creates_failed_notification_with_message(db_session, make_analysis, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    _running_analysis(make_analysis, "job-wt-2")
    db_session.commit()

    job_manager.job_status_store.update_job("job-wt-2", {"status": "Failed", "progress": 100, "message": "Nastran FATAL"})

    db_session.expire_all()
    row = db_session.query(models.Notification).one()
    assert row.kind == "job.failed"
    assert row.body == "Nastran FATAL"


def test_running_and_progress_updates_do_not_notify(db_session, make_analysis, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    _running_analysis(make_analysis, "job-wt-3")
    db_session.commit()

    job_manager.job_status_store.update_job("job-wt-3", {"status": "Running", "progress": 10})
    job_manager.job_status_store.update_job("job-wt-3", {"progress": 50, "message": "solving"})

    db_session.expire_all()
    assert db_session.query(models.Notification).count() == 0


def test_notification_failure_does_not_undo_status_write(db_session, make_analysis, monkeypatch, caplog):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    a = _running_analysis(make_analysis, "job-wt-4")
    db_session.commit()
    analysis_id = a.id

    def _boom(*_args, **_kwargs):
        raise RuntimeError("notifications table is gone")
    monkeypatch.setattr(notification_service, "notify_job_terminal", _boom)

    job_manager.job_status_store.update_job("job-wt-4", {"status": "Success", "progress": 100})

    db_session.expire_all()
    assert db_session.get(models.Analysis, analysis_id).job_status == "Success"
    assert db_session.query(models.Notification).count() == 0
    assert any("종료 알림 생성 실패" in r.getMessage() for r in caplog.records)


def test_write_through_without_record_is_silent(db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    job_manager.job_status_store.update_job("job-no-record", {"status": "Success", "progress": 100})
    assert db_session.query(models.Notification).count() == 0
