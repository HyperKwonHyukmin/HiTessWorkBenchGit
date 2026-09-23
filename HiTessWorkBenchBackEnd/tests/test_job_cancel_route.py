"""취소 API — 소유자·관리자·타인·not-found·terminal 케이스 + PSA 위임 + 알림 지연 import."""
import sys
import types
from datetime import datetime

import pytest

from app import database, models
from app.services import doublepipe_psa_service, job_manager

_SEEDED_JOB_IDS = (
    "j-cancel-1", "j-cancel-2", "j-cancel-3", "j-cancel-4",
    "j-cancel-5", "j-cancel-6", "j-cancel-7",
)


@pytest.fixture(autouse=True)
def _isolate_store(db_session, monkeypatch):
    """전역 job_status_store 오염과 운영 DB write-through 를 차단한다.

    job_status_store.set() 은 _write_through 로 운영 SessionLocal 을 연다 — 테스트에서는
    인메모리 세션으로 돌려 실제 MySQL 에 쓰지 않게 한다.
    """
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    yield
    with job_manager.job_status_store._lock:
        for job_id in _SEEDED_JOB_IDS:
            job_manager.job_status_store._store.pop(job_id, None)
            job_manager.job_status_store.cancel_requested.discard(job_id)


def _make_owner_analysis(db, employee_id, job_id):
    a = models.Analysis(
        employee_id=employee_id,
        program_name="Truss Assessment",
        project_name="row",
        status="Running",
        job_id=job_id,
        job_status="Running",
        created_at=datetime.now(),
    )
    db.add(a); db.commit(); db.refresh(a)
    return a


def test_cancel_success_as_owner(switchable_client, db_session, monkeypatch):
    _make_owner_analysis(db_session, "EMP001", "j-cancel-1")
    job_manager.job_status_store.set("j-cancel-1", {"status": "Running", "progress": 30, "message": "solving"})

    called = {}
    monkeypatch.setattr(
        job_manager.job_status_store, "cancel",
        lambda jid, grace_seconds=None: called.setdefault("id", jid) or True,
    )

    switchable_client.as_user()
    r = switchable_client.post("/api/analysis/j-cancel-1/cancel")
    assert r.status_code == 200
    body = r.json()
    assert body["job_id"] == "j-cancel-1"
    assert body["kind"] == "queue"
    assert body["cancelled"] is True
    assert body["status"] == "Cancelled"
    assert called["id"] == "j-cancel-1"


def test_cancel_success_as_admin(switchable_client, db_session, monkeypatch):
    _make_owner_analysis(db_session, "EMP001", "j-cancel-2")
    job_manager.job_status_store.set("j-cancel-2", {"status": "Running", "progress": 30, "message": "solving"})
    monkeypatch.setattr(job_manager.job_status_store, "cancel", lambda *_a, **_k: True)

    switchable_client.as_admin()
    assert switchable_client.post("/api/analysis/j-cancel-2/cancel").status_code == 200


def test_cancel_forbidden_when_not_owner_nor_admin(switchable_client, db_session):
    _make_owner_analysis(db_session, "OTHER", "j-cancel-3")
    job_manager.job_status_store.set("j-cancel-3", {"status": "Running", "progress": 30, "message": "solving", "employee_id": "OTHER"})

    switchable_client.as_user()   # EMP001 이 OTHER 의 작업 취소 시도
    assert switchable_client.post("/api/analysis/j-cancel-3/cancel").status_code == 403


def test_cancel_not_found(switchable_client):
    switchable_client.as_admin()
    assert switchable_client.post("/api/analysis/no-such/cancel").status_code == 404


def test_cancel_conflict_when_terminal_in_store(switchable_client, db_session):
    _make_owner_analysis(db_session, "EMP001", "j-cancel-4")
    job_manager.job_status_store.set("j-cancel-4", {"status": "Success", "progress": 100, "message": "완료"})

    switchable_client.as_user()
    r = switchable_client.post("/api/analysis/j-cancel-4/cancel")
    assert r.status_code == 409
    assert "Success" in r.json().get("detail", "")


def test_cancel_conflict_when_only_in_db(switchable_client, db_session):
    """스토어에서 만료된 완료 작업은 DB 만 남는다 — 취소 대상이 아님."""
    _make_owner_analysis(db_session, "EMP001", "j-cancel-5")
    # 스토어에는 없다.
    switchable_client.as_user()
    r = switchable_client.post("/api/analysis/j-cancel-5/cancel")
    assert r.status_code == 409


def test_cancel_delegates_to_psa_service(switchable_client, db_session, monkeypatch):
    """PSA 자체 스토어에 있는 job 은 doublepipe_psa_service.cancel_psa_job 으로 위임된다."""
    monkeypatch.setitem(doublepipe_psa_service._jobs, "psa-1", {
        "status": "running", "employeeId": "EMP001",
    })
    calls = []
    monkeypatch.setattr(
        doublepipe_psa_service, "cancel_psa_job",
        lambda jid, owner: calls.append((jid, owner)) or {"cancelled": True},
    )

    switchable_client.as_user()
    r = switchable_client.post("/api/analysis/psa-1/cancel")
    assert r.status_code == 200
    assert r.json()["kind"] == "psa"
    assert calls == [("psa-1", "EMP001")]


def test_run_psa_cancel_compat_route_still_works(switchable_client, db_session, monkeypatch):
    """구 라우트 POST /api/doublepipe/run-psa/cancel 도 같은 서비스 함수로 위임된다."""
    monkeypatch.setitem(doublepipe_psa_service._jobs, "psa-2", {
        "status": "running", "employeeId": "EMP001",
    })
    called = []
    monkeypatch.setattr(
        doublepipe_psa_service, "cancel_psa_job",
        lambda jid, owner: called.append(jid) or {"cancelled": True},
    )

    switchable_client.as_user()
    r = switchable_client.post(
        "/api/doublepipe/run-psa/cancel",
        json={"jobId": "psa-2", "employee_id": "EMP001"},
    )
    assert r.status_code == 200
    assert called == ["psa-2"]
    assert r.json()["cancelled"] is True


def test_cancel_calls_notify_when_service_available(switchable_client, db_session, monkeypatch):
    _make_owner_analysis(db_session, "EMP001", "j-cancel-6")
    job_manager.job_status_store.set("j-cancel-6", {"status": "Running", "progress": 30, "message": "solving"})
    monkeypatch.setattr(job_manager.job_status_store, "cancel", lambda *_a, **_k: True)

    called = []
    fake = types.SimpleNamespace(
        notify=lambda db, **kwargs: called.append(kwargs.get("kind")),
    )
    monkeypatch.setitem(sys.modules, "app.services.notification_service", fake)

    switchable_client.as_user()
    switchable_client.post("/api/analysis/j-cancel-6/cancel")
    assert called == ["job.cancelled"]


def test_cancel_ignores_notify_when_service_missing(switchable_client, db_session, monkeypatch):
    _make_owner_analysis(db_session, "EMP001", "j-cancel-7")
    job_manager.job_status_store.set("j-cancel-7", {"status": "Running", "progress": 30, "message": "solving"})
    monkeypatch.setattr(job_manager.job_status_store, "cancel", lambda *_a, **_k: True)

    # notification_service 를 import 실패시키기
    monkeypatch.setitem(sys.modules, "app.services.notification_service", None)

    switchable_client.as_user()
    r = switchable_client.post("/api/analysis/j-cancel-7/cancel")
    assert r.status_code == 200
