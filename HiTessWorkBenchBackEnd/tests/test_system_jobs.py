"""실행 중/대기 중 해석 작업 모니터(system/jobs/active) 테스트."""
from datetime import datetime, timedelta

from app import models
from app.services.job_manager import job_status_store


def test_active_jobs_lists_running_and_pending(admin_client, db_session):
    """job_status 가 Running/Pending 인 작업만 반환하고, 사용자 이름을 결합한다."""
    db_session.add(models.User(
        employee_id="USER001", name="실행자", company="HHI",
        department="구조팀", is_active=True,
    ))
    db_session.add_all([
        models.Analysis(
            job_id="job-run", employee_id="USER001", program_name="Truss",
            project_name="p1", status="Pending", job_status="Running",
            progress=40, started_at=datetime.now() - timedelta(seconds=30),
            created_at=datetime.now() - timedelta(seconds=35),
        ),
        models.Analysis(
            job_id="job-wait", employee_id="USER001", program_name="Beam",
            project_name="p2", status="Pending", job_status="Pending",
            progress=0, created_at=datetime.now() - timedelta(seconds=5),
        ),
        # 완료된 작업은 목록에서 제외되어야 함
        models.Analysis(
            job_id="job-done", employee_id="USER001", program_name="Beam",
            project_name="p3", status="Success", job_status="Success",
            progress=100, created_at=datetime.now(),
        ),
    ])
    db_session.commit()

    resp = admin_client.get("/api/system/jobs/active")
    assert resp.status_code == 200
    data = resp.json()
    assert data["running"] == 1
    assert data["pending"] == 1
    ids = [j["job_id"] for j in data["jobs"]]
    assert "job-done" not in ids
    assert set(ids) == {"job-run", "job-wait"}

    running = next(j for j in data["jobs"] if j["job_id"] == "job-run")
    assert running["name"] == "실행자"
    assert running["program_name"] == "Truss"
    assert running["elapsed_seconds"] is not None and running["elapsed_seconds"] >= 25


def test_active_jobs_flags_stale_after_restart(admin_client, db_session):
    """DB 는 Running 인데 인메모리 store 에 없으면(서버 재시작 유령) stale=True."""
    db_session.add(models.Analysis(
        job_id="ghost-job", employee_id="USER001", program_name="Truss",
        project_name="p", status="Pending", job_status="Running",
        progress=10, started_at=datetime.now() - timedelta(hours=5),
        created_at=datetime.now() - timedelta(hours=5),
    ))
    db_session.commit()

    resp = admin_client.get("/api/system/jobs/active")
    assert resp.status_code == 200
    job = resp.json()["jobs"][0]
    assert job["job_id"] == "ghost-job"
    assert job["stale"] is True


def test_active_jobs_uses_live_progress_from_store(admin_client, db_session):
    """인메모리 store 에 실시간 진행률이 있으면 DB 값보다 우선한다."""
    db_session.add(models.Analysis(
        job_id="live-job", employee_id="USER001", program_name="Truss",
        project_name="p", status="Pending", job_status="Running",
        progress=10, started_at=datetime.now(), created_at=datetime.now(),
    ))
    db_session.commit()
    job_status_store.set("live-job", {"status": "Running", "progress": 88, "message": "거의 완료"})
    try:
        resp = admin_client.get("/api/system/jobs/active")
        job = next(j for j in resp.json()["jobs"] if j["job_id"] == "live-job")
        assert job["progress"] == 88
        assert job["message"] == "거의 완료"
        assert job["stale"] is False
    finally:
        job_status_store._store.pop("live-job", None)
