"""ManagedAnalysisExecutor.submit(fn, job_id, *args) 계약 + current_job_id() 컨텍스트 전파."""
import threading

import pytest

from app.services import job_manager

# 이 파일이 모듈 싱글턴 store 에 남기는 job 들. 다른 테스트의 큐 통계를 오염시키지 않도록
# 매 테스트 후 지운다.
_TEST_JOB_IDS = ("j-ctx-1", "j-fut-1", "j-fut-2", "j-a", "j-b")


@pytest.fixture(autouse=True)
def _cleanup_store():
    yield
    store = job_manager.job_status_store
    with store._lock:
        for job_id in _TEST_JOB_IDS:
            store._store.pop(job_id, None)
            store._futures.pop(job_id, None)
            store._processes.pop(job_id, None)
            store.cancel_requested.discard(job_id)


def test_submit_binds_current_job_id_in_worker_thread():
    executor = job_manager.ManagedAnalysisExecutor(max_workers=1)
    try:
        seen: dict = {}
        done = threading.Event()

        def task(job_id):
            seen["worker_job_id"] = job_manager.current_job_id()
            done.set()

        job_manager.job_status_store.set(
            "j-ctx-1", {"status": "Pending", "progress": 0, "message": "대기"})
        executor.submit(task, "j-ctx-1")
        assert done.wait(2)
        assert seen["worker_job_id"] == "j-ctx-1"
        assert job_manager.current_job_id() is None  # 밖에서는 None
    finally:
        executor.shutdown(wait=True)


def test_submit_attaches_future_to_store():
    executor = job_manager.ManagedAnalysisExecutor(max_workers=1)
    release = threading.Event()
    try:
        # 첫 작업은 slot 하나를 점유해서 두 번째가 큐에서 대기하게 만든다.
        gate = threading.Event()

        def blocker(job_id):
            gate.set()
            release.wait(5)

        job_manager.job_status_store.set(
            "j-fut-1", {"status": "Pending", "progress": 0, "message": "대기"})
        job_manager.job_status_store.set(
            "j-fut-2", {"status": "Pending", "progress": 0, "message": "대기"})
        executor.submit(blocker, "j-fut-1")
        assert gate.wait(2)

        future = executor.submit(lambda job_id: None, "j-fut-2")
        # 대기 중 Future 가 store 에 붙었다.
        assert job_manager.job_status_store._futures.get("j-fut-2") is future

        # 취소가 Future 로 이어진다 — future.cancel() 이 성공하고 상태가 Cancelled.
        assert job_manager.job_status_store.cancel("j-fut-2") is True
        entry = job_manager.job_status_store.get("j-fut-2")
        assert entry["status"] == "Cancelled"
        assert future.cancelled() is True
    finally:
        release.set()
        executor.shutdown(wait=True)


def test_submit_without_job_id_still_works():
    """계약을 지키지 않는 옛 호출부(첫 인자가 str 이 아님)도 그냥 실행된다(attach_future 없이)."""
    executor = job_manager.ManagedAnalysisExecutor(max_workers=1)
    try:
        done = threading.Event()
        executor.submit(lambda: done.set())
        assert done.wait(2)
    finally:
        executor.shutdown(wait=True)


def test_bind_job_context_resets_after_completion():
    """current_job_id 가 다음 작업의 컨텍스트로 새지 않는다."""
    executor = job_manager.ManagedAnalysisExecutor(max_workers=1)
    try:
        job_manager.job_status_store.set(
            "j-a", {"status": "Pending", "progress": 0, "message": "대기"})
        job_manager.job_status_store.set(
            "j-b", {"status": "Pending", "progress": 0, "message": "대기"})

        seen: list = []

        def cap(job_id):
            seen.append((job_id, job_manager.current_job_id()))

        fa = executor.submit(cap, "j-a")
        fb = executor.submit(cap, "j-b")
        fa.result(timeout=2)
        fb.result(timeout=2)
        assert ("j-a", "j-a") in seen
        assert ("j-b", "j-b") in seen
        # worker 스레드에 남은 컨텍스트가 없어야 한다(재사용 스레드로 누수 금지).
        assert executor.submit(
            lambda: job_manager.current_job_id()).result(timeout=2) is None
    finally:
        executor.shutdown(wait=True)


def test_handle_future_result_ignores_cancelled_future(monkeypatch):
    """취소된 Future 의 CancelledError 를 'task 외부 예외' 로 오인해 Failed 로 쓰지 않는다."""
    from concurrent.futures import Future

    from app.routers import _intake

    future = Future()
    assert future.cancel() is True

    calls = []
    monkeypatch.setattr(_intake.job_status_store, "update_job",
                        lambda *args, **kwargs: calls.append(args))

    _intake._handle_future_result("j-cancelled", future)

    assert calls == []
