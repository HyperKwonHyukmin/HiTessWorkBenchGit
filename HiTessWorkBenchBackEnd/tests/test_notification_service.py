"""알림 서비스 계약(마스터 §2.1) 테스트 — notify / notify_job_terminal / prefs / prune."""
from datetime import datetime, timedelta

import pytest

from app import models
from app.services.notification_service import (
    NOTIFICATION_KINDS,
    NOTIFICATION_RETENTION_DAYS,
    get_notification_prefs,
    notify,
    notify_job_terminal,
    prune_notifications,
    serialize_notification,
)
from app.services.program_registry import internal_substep_programs


def test_kind_vocabulary_matches_master_spec():
    assert NOTIFICATION_KINDS == frozenset({
        "job.completed", "job.failed", "job.cancelled",
        # "retention.expiring" 은 어휘에서 뺐다 — 만료 임박을 알림으로 알리지 않는다
        # (사용자 결정 2026-09-22). 남은 일수는 My Projects 화면 카드·배지로만 보여 준다.
        "retention.expired",
        "batch.completed", "share.received",
        "feature_request.status_changed", "notice.published",
    })
    assert NOTIFICATION_RETENTION_DAYS == 90


def test_notify_rejects_unknown_kind(db_session):
    with pytest.raises(ValueError):
        notify(db_session, employee_id="EMP001", kind="job.done", title="x")


def test_notify_creates_unread_row_with_link(db_session):
    row = notify(
        db_session, employee_id="EMP001", kind="job.completed",
        title="Truss Assessment 해석 완료", body="3496 유닛",
        link={"menu": "My Projects", "params": {"analysis_id": 7}},
        dedupe_key="job:abc:job.completed",
    )
    assert row.id is not None
    assert row.read_at is None
    assert row.link == {"menu": "My Projects", "params": {"analysis_id": 7}}
    assert row.dedupe_key == "job:abc:job.completed"
    assert db_session.query(models.Notification).count() == 1


def test_notify_skips_blank_employee(db_session):
    assert notify(db_session, employee_id="  ", kind="job.completed", title="x") is None
    assert db_session.query(models.Notification).count() == 0


def test_notify_truncates_title_and_body(db_session):
    row = notify(db_session, employee_id="EMP001", kind="job.failed",
                 title="t" * 300, body="b" * 2000)
    assert len(row.title) == 200
    assert len(row.body) == 1000


def test_notify_respects_muted_kinds_from_user_preferences(db_session):
    db_session.add(models.UserPreference(
        employee_id="EMP001",
        prefs={"notifications": {"muted_kinds": ["job.completed"], "desktop_toast": False}},
    ))
    db_session.commit()
    assert notify(db_session, employee_id="EMP001", kind="job.completed", title="x") is None
    assert notify(db_session, employee_id="EMP001", kind="job.failed", title="x") is not None


def test_get_notification_prefs_defaults_and_shape(db_session):
    assert get_notification_prefs(db_session, "NOBODY") == {"muted_kinds": [], "desktop_toast": True}
    db_session.add(models.UserPreference(employee_id="EMP002", prefs={"notifications": "garbage"}))
    db_session.commit()
    assert get_notification_prefs(db_session, "EMP002") == {"muted_kinds": [], "desktop_toast": True}


def test_dedupe_key_blocks_only_while_unread(db_session):
    first = notify(db_session, employee_id="EMP001", kind="retention.expired",
                   title="만료 예정", dedupe_key="retention:5")
    assert first is not None
    assert notify(db_session, employee_id="EMP001", kind="retention.expired",
                  title="만료 예정", dedupe_key="retention:5") is None
    first.read_at = datetime.now()
    db_session.commit()
    again = notify(db_session, employee_id="EMP001", kind="retention.expired",
                   title="만료 예정", dedupe_key="retention:5")
    assert again is not None and again.id != first.id


def test_dedupe_key_is_per_employee(db_session):
    notify(db_session, employee_id="EMP001", kind="share.received", title="x", dedupe_key="k")
    assert notify(db_session, employee_id="EMP002", kind="share.received", title="x", dedupe_key="k") is not None


def test_dedupe_any_state_blocks_even_after_read(db_session):
    first = notify(db_session, employee_id="EMP001", kind="job.completed", title="x",
                   dedupe_key="job:1:job.completed", dedupe_unread_only=False)
    first.read_at = datetime.now()
    db_session.commit()
    assert notify(db_session, employee_id="EMP001", kind="job.completed", title="x",
                  dedupe_key="job:1:job.completed", dedupe_unread_only=False) is None


def _analysis(make_analysis, program_name, **overrides):
    a = make_analysis("EMP001", program_name, datetime(2026, 9, 18, 9, 0, 0), status="Running")
    a.job_id = overrides.get("job_id", "job-1")
    a.project_name = overrides.get("project_name", "3496 유닛 권상")
    a.job_message = overrides.get("job_message")
    return a


def test_notify_job_terminal_success(db_session, make_analysis):
    a = _analysis(make_analysis, "Truss Assessment")
    db_session.commit()
    row = notify_job_terminal(db_session, a, "Success")
    assert row.kind == "job.completed"
    assert row.title == "Truss Assessment 해석 완료"
    assert row.body == "3496 유닛 권상"
    assert row.link == {
        "menu": "My Projects",
        "params": {"analysis_id": a.id, "program_name": "Truss Assessment", "job_id": "job-1"},
    }
    assert row.dedupe_key == "job:job-1:job.completed"
    # 같은 작업의 Success 가 두 번 반영돼도 알림은 1건
    assert notify_job_terminal(db_session, a, "Success") is None


def test_notify_job_terminal_failed_prefers_job_message(db_session, make_analysis):
    a = _analysis(make_analysis, "BdfScanner", job_id="job-2", job_message="Nastran FATAL 2101")
    db_session.commit()
    row = notify_job_terminal(db_session, a, "Failed")
    assert row.kind == "job.failed"
    assert row.title == "BDF Scanner 해석 실패"      # registry display_name
    assert row.body == "Nastran FATAL 2101"


def test_notify_job_terminal_unknown_program_uses_raw_name(db_session, make_analysis):
    a = _analysis(make_analysis, "SomethingNew", job_id="job-3")
    db_session.commit()
    row = notify_job_terminal(db_session, a, "Success")
    assert row.title == "SomethingNew 해석 완료"


def test_notify_job_terminal_skips_internal_substep_and_non_terminal(db_session, make_analysis):
    internal = internal_substep_programs()[0]
    a = _analysis(make_analysis, internal, job_id="job-4")
    db_session.commit()
    assert notify_job_terminal(db_session, a, "Success") is None

    b = _analysis(make_analysis, "Truss Assessment", job_id="job-5")
    db_session.commit()
    assert notify_job_terminal(db_session, b, "Running") is None
    assert db_session.query(models.Notification).count() == 0


def test_notify_job_terminal_without_owner(db_session, make_analysis):
    a = _analysis(make_analysis, "Truss Assessment", job_id="job-6")
    a.employee_id = None
    db_session.commit()
    assert notify_job_terminal(db_session, a, "Success") is None


def test_serialize_notification(db_session):
    row = notify(db_session, employee_id="EMP001", kind="job.completed", title="t", body="b",
                 link={"menu": "My Projects", "params": {}})
    data = serialize_notification(row)
    assert data["id"] == row.id
    assert data["kind"] == "job.completed"
    assert data["is_read"] is False
    assert data["read_at"] is None
    assert data["created_at"] == row.created_at.isoformat()
    assert data["link"] == {"menu": "My Projects", "params": {}}


def test_prune_notifications_deletes_only_old_rows(db_session):
    old = notify(db_session, employee_id="EMP001", kind="job.completed", title="old")
    old.created_at = datetime.now() - timedelta(days=NOTIFICATION_RETENTION_DAYS + 1)
    notify(db_session, employee_id="EMP001", kind="job.completed", title="new")
    db_session.commit()
    assert prune_notifications(db_session) == 1
    remaining = db_session.query(models.Notification).all()
    assert [r.title for r in remaining] == ["new"]
