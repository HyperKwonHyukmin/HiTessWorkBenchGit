"""큐 대기 가시성(runningJobs/queuedJobs/queuePosition) 테스트.

실제로 오래 걸리는 해석을 돌리는 대신 JobStatusStore 의 상태 dict 를 직접 조작해
집계·순번 계산 로직만 검증한다. 싱글턴 오염을 피하려고 매 테스트마다 새 인스턴스를 만든다.
"""
from datetime import datetime

from app.services.job_manager import JobStatusStore


def _seed(store: JobStatusStore, job_id: str, status: str, seq: int) -> None:
    """set()/DB write-through 를 우회해 store 내부에 상태 항목을 직접 심는다."""
    store._store[job_id] = {
        "status": status,
        "progress": 0,
        "message": "",
        "_created_at": datetime.now(),
        "_seq": seq,
    }


def test_queue_stats_counts_running_and_pending():
    """5개 실행 중 + 2개 대기 → runningJobs=5, queuedJobs=2, 6번째 job 순번=1, 7번째=2."""
    store = JobStatusStore()
    for i in range(5):
        _seed(store, f"run-{i}", "Running", i + 1)
    _seed(store, "wait-a", "Pending", 6)  # 6번째 제출 → 대기열 첫 번째
    _seed(store, "wait-b", "Pending", 7)  # 7번째 제출 → 대기열 두 번째

    stats_a = store.get_queue_stats("wait-a")
    assert stats_a["runningJobs"] == 5
    assert stats_a["queuedJobs"] == 2
    assert stats_a["queuePosition"] == 1

    stats_b = store.get_queue_stats("wait-b")
    assert stats_b["runningJobs"] == 5
    assert stats_b["queuedJobs"] == 2
    assert stats_b["queuePosition"] == 2


def test_queue_stats_no_position_for_running_job():
    """실행 중(Running)이거나 완료된 job 에는 queuePosition 키가 붙지 않는다."""
    store = JobStatusStore()
    _seed(store, "run-1", "Running", 1)
    _seed(store, "wait-1", "Pending", 2)
    _seed(store, "done-1", "Success", 3)

    stats = store.get_queue_stats("run-1")
    assert stats["runningJobs"] == 1
    assert stats["queuedJobs"] == 1
    assert "queuePosition" not in stats

    # 완료 job 도 순번 없음(대기/실행 집계에도 안 잡힘)
    assert "queuePosition" not in store.get_queue_stats("done-1")


def test_queue_stats_position_uses_submission_order_not_dict_order():
    """순번은 dict 삽입 순서가 아니라 제출 순번(_seq) 으로 결정된다."""
    store = JobStatusStore()
    # b 를 먼저 삽입하지만 seq 가 더 크므로 대기열에선 뒤여야 한다.
    _seed(store, "wait-b", "Pending", 8)
    _seed(store, "wait-a", "Pending", 3)

    assert store.get_queue_stats("wait-a")["queuePosition"] == 1
    assert store.get_queue_stats("wait-b")["queuePosition"] == 2


def test_queue_stats_without_job_id_returns_only_counts():
    """job_id 없이 호출하면 집계만 반환(queuePosition 없음)."""
    store = JobStatusStore()
    _seed(store, "run-1", "Running", 1)
    _seed(store, "wait-1", "Pending", 2)

    stats = store.get_queue_stats()
    assert stats == {"runningJobs": 1, "queuedJobs": 1}


def test_set_assigns_increasing_submission_sequence():
    """set() 은 제출마다 단조 증가하는 _seq 를 부여한다(대기 순번의 기반)."""
    store = JobStatusStore()
    # DB write-through 는 매칭 Analysis 레코드가 없으면 조용히 no-op 이므로 안전하다.
    store.set("j1", {"status": "Pending", "progress": 0, "message": ""})
    store.set("j2", {"status": "Pending", "progress": 0, "message": ""})
    assert store._store["j1"]["_seq"] < store._store["j2"]["_seq"]
    # 내부 메타(_seq)는 외부 조회에는 노출되지 않아야 한다.
    assert "_seq" not in store.get("j1")


def test_status_endpoint_includes_queue_fields(admin_client, db_session):
    """status 엔드포인트가 store 경로에서 큐 필드를 함께 반환한다."""
    from app import models
    from app.services.job_manager import job_status_store

    db_session.add(models.Analysis(
        job_id="queue-job", employee_id="ADMIN001", program_name="ModuleStability",
        project_name="p", status="Pending", job_status="Pending",
        progress=0, created_at=datetime.now(),
    ))
    db_session.commit()
    job_status_store.set("queue-job", {"status": "Pending", "progress": 0, "message": "대기 중"})
    try:
        resp = admin_client.get("/api/analysis/status/queue-job")
        assert resp.status_code == 200
        data = resp.json()
        assert "runningJobs" in data
        assert "queuedJobs" in data
        assert data["queuedJobs"] >= 1
        assert data["queuePosition"] >= 1
    finally:
        job_status_store._store.pop("queue-job", None)
