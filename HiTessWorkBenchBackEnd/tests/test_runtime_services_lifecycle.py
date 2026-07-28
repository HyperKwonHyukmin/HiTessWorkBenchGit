"""Import-time diagnostics와 cleanup daemon의 멱등성 테스트."""
import os
import threading
import time

from app import diagnostics
from app.services import cleanup_service


def test_crash_diagnostics_install_is_pid_idempotent(monkeypatch):
    calls = []
    monkeypatch.delenv("WORKBENCH_DISABLE_CRASH_DIAGNOSTICS", raising=False)
    monkeypatch.setattr(diagnostics, "_installed_pid", None)
    monkeypatch.setattr(diagnostics, "_ensure_log_dir", lambda: True)
    monkeypatch.setattr(diagnostics, "_install_faulthandler", lambda: calls.append("fault"))
    monkeypatch.setattr(diagnostics, "_install_file_logging", lambda: calls.append("logging"))
    monkeypatch.setattr(diagnostics, "_install_console_ctrl_guard", lambda: calls.append("ctrl"))
    monkeypatch.setattr(diagnostics, "_start_memory_watchdog", lambda: calls.append("watchdog"))

    diagnostics.install_crash_diagnostics()
    diagnostics.install_crash_diagnostics()

    assert calls == ["fault", "logging", "ctrl", "watchdog"]
    assert diagnostics._installed_pid == os.getpid()


def test_crash_diagnostics_can_be_disabled_before_main_import(monkeypatch):
    calls = []
    monkeypatch.setenv("WORKBENCH_DISABLE_CRASH_DIAGNOSTICS", "1")
    monkeypatch.setattr(diagnostics, "_installed_pid", None)
    monkeypatch.setattr(diagnostics, "_ensure_log_dir", lambda: calls.append("called"))

    diagnostics.install_crash_diagnostics()

    assert calls == []
    assert diagnostics._installed_pid is None


def test_cleanup_scheduler_start_and_stop_are_idempotent(monkeypatch):
    calls = []
    monkeypatch.setattr(cleanup_service, "run_all_cleanup", lambda: calls.append("cleanup"))
    monkeypatch.setattr(cleanup_service, "_seconds_until_midnight", lambda: 60.0)
    cleanup_service.shutdown_cleanup_scheduler(timeout=0.1)

    assert cleanup_service.start_cleanup_scheduler() is True
    assert cleanup_service.start_cleanup_scheduler() is False

    deadline = time.time() + 2
    while not calls and time.time() < deadline:
        time.sleep(0.01)

    assert calls == ["cleanup"]
    assert cleanup_service.shutdown_cleanup_scheduler(timeout=1) is True
    assert cleanup_service.shutdown_cleanup_scheduler(timeout=0.1) is False


def test_cleanup_timeout_hands_off_pending_restart_after_old_thread_exits(
    monkeypatch,
):
    cleanup_started = threading.Event()
    release_cleanup = threading.Event()
    calls = 0

    def blocking_cleanup():
        nonlocal calls
        calls += 1
        cleanup_started.set()
        if calls == 1:
            release_cleanup.wait(timeout=5)

    monkeypatch.setattr(cleanup_service, "run_all_cleanup", blocking_cleanup)
    monkeypatch.setattr(cleanup_service, "_seconds_until_midnight", lambda: 60.0)
    cleanup_service.shutdown_cleanup_scheduler(timeout=0.1)

    assert cleanup_service.start_cleanup_scheduler() is True
    assert cleanup_started.wait(timeout=1)
    original_thread = cleanup_service._scheduler_thread

    assert cleanup_service.shutdown_cleanup_scheduler(timeout=0.01) is False
    assert cleanup_service._scheduler_thread is original_thread
    assert original_thread is not None and original_thread.is_alive()
    # 다음 lifespan의 start 요청은 old generation 종료 뒤 자동 handoff로 접수된다.
    assert cleanup_service.start_cleanup_scheduler() is True
    assert cleanup_service.start_cleanup_scheduler() is False

    release_cleanup.set()
    original_thread.join(timeout=1)
    assert not original_thread.is_alive()

    deadline = time.time() + 1
    while (
        cleanup_service._scheduler_thread is original_thread
        and time.time() < deadline
    ):
        time.sleep(0.01)
    assert cleanup_service._scheduler_thread is not None
    assert cleanup_service._scheduler_thread is not original_thread
    assert cleanup_service._scheduler_thread.is_alive()
    assert calls >= 2
    assert cleanup_service.shutdown_cleanup_scheduler(timeout=1) is True


def test_cleanup_pending_restart_is_cancelled_if_new_lifespan_also_stops(
    monkeypatch,
):
    cleanup_started = threading.Event()
    release_cleanup = threading.Event()
    calls = 0

    def blocking_cleanup():
        nonlocal calls
        calls += 1
        cleanup_started.set()
        release_cleanup.wait(timeout=5)

    monkeypatch.setattr(cleanup_service, "run_all_cleanup", blocking_cleanup)
    monkeypatch.setattr(cleanup_service, "_seconds_until_midnight", lambda: 60.0)
    cleanup_service.shutdown_cleanup_scheduler(timeout=0.1)

    assert cleanup_service.start_cleanup_scheduler() is True
    assert cleanup_started.wait(timeout=1)
    old_thread = cleanup_service._scheduler_thread
    assert cleanup_service.shutdown_cleanup_scheduler(timeout=0.01) is False
    assert cleanup_service.start_cleanup_scheduler() is True

    # 새 lifespan도 old cleanup이 끝나기 전에 닫히면 pending handoff를 취소한다.
    assert cleanup_service.shutdown_cleanup_scheduler(timeout=0.01) is False
    release_cleanup.set()
    old_thread.join(timeout=1)
    assert not old_thread.is_alive()

    deadline = time.time() + 1
    while cleanup_service._scheduler_thread is not None and time.time() < deadline:
        time.sleep(0.01)
    assert cleanup_service._scheduler_thread is None
    assert calls == 1


def test_concurrent_cleanup_starts_create_exactly_one_thread(monkeypatch):
    cleanup_started = threading.Event()
    monkeypatch.setattr(
        cleanup_service,
        "run_all_cleanup",
        lambda: cleanup_started.set(),
    )
    monkeypatch.setattr(cleanup_service, "_seconds_until_midnight", lambda: 60.0)
    cleanup_service.shutdown_cleanup_scheduler(timeout=0.1)

    barrier = threading.Barrier(8)
    results = []
    results_lock = threading.Lock()

    def start_together():
        barrier.wait(timeout=2)
        result = cleanup_service.start_cleanup_scheduler()
        with results_lock:
            results.append(result)

    callers = [threading.Thread(target=start_together) for _ in range(8)]
    for caller in callers:
        caller.start()
    for caller in callers:
        caller.join(timeout=2)

    assert cleanup_started.wait(timeout=1)
    assert results.count(True) == 1
    assert results.count(False) == 7
    running_thread = cleanup_service._scheduler_thread
    assert running_thread is not None and running_thread.is_alive()
    assert cleanup_service.shutdown_cleanup_scheduler(timeout=1) is True


def test_activity_log_cleanup_handles_session_creation_failure_without_secret(
    monkeypatch,
    caplog,
):
    secret = "mysql://workbench:top-secret@db.internal/hitess"

    def fail_session_creation():
        raise RuntimeError(secret)

    monkeypatch.setattr(
        cleanup_service.database,
        "SessionLocal",
        fail_session_creation,
    )

    result = cleanup_service.run_activity_log_cleanup()

    assert result == {"deleted": 0, "errors": ["RuntimeError"]}
    assert "RuntimeError" in caplog.text
    assert secret not in caplog.text


def test_session_cleanup_failure_is_structured_without_secret(monkeypatch, caplog):
    secret = "postgresql://cleanup:top-secret@db.internal/workbench"

    def fail_session_cleanup():
        raise RuntimeError(secret)

    monkeypatch.setattr(
        cleanup_service.session_store,
        "cleanup_expired",
        fail_session_cleanup,
    )

    result = cleanup_service.run_session_cleanup()

    assert result["deleted"] == 0
    assert result["errors"] == ["session_cleanup_failed"]
    assert result["success"] is False
    assert result["error"] == "session_cleanup_failed"
    assert result["error_type"] == "RuntimeError"
    assert secret not in str(result)
    assert "RuntimeError" in caplog.text
    assert secret not in caplog.text


def test_filesystem_cleanup_failure_is_sanitized(monkeypatch, caplog):
    secret = r"\\server\share?password=top-secret"
    monkeypatch.setattr(cleanup_service.os.path, "isdir", lambda path: True)
    monkeypatch.setattr(cleanup_service.os, "listdir", lambda path: ["job"])
    monkeypatch.setattr(cleanup_service, "_get_folder_age_days", lambda path: 31)
    monkeypatch.setattr(
        cleanup_service,
        "_force_rmtree",
        lambda path: (_ for _ in ()).throw(OSError(secret)),
    )

    result = cleanup_service.run_cleanup()

    assert result["errors"] == [{
        "folder": "job",
        "error": "filesystem_cleanup_failed",
        "error_type": "OSError",
    }]
    assert secret not in str(result)
    assert "OSError" in caplog.text
    assert secret not in caplog.text


def test_activity_log_session_failure_does_not_restart_scheduler(
    monkeypatch,
    caplog,
):
    secret = "password=top-secret"
    session_attempts = 0

    def fail_session_creation():
        nonlocal session_attempts
        session_attempts += 1
        raise RuntimeError(secret)

    monkeypatch.setattr(
        cleanup_service,
        "run_cleanup",
        lambda dry_run=False: {"deleted": [], "errors": [], "skipped": 0},
    )
    monkeypatch.setattr(
        cleanup_service,
        "run_session_cleanup",
        lambda dry_run=False: {"deleted": 0, "errors": []},
    )
    monkeypatch.setattr(
        cleanup_service.database,
        "SessionLocal",
        fail_session_creation,
    )
    monkeypatch.setattr(cleanup_service, "_seconds_until_midnight", lambda: 60.0)
    cleanup_service.shutdown_cleanup_scheduler(timeout=0.1)
    generation_before = cleanup_service._scheduler_generation

    assert cleanup_service.start_cleanup_scheduler() is True

    deadline = time.time() + 1
    while session_attempts == 0 and time.time() < deadline:
        time.sleep(0.01)

    generation_running = cleanup_service._scheduler_generation
    time.sleep(0.05)
    running_thread = cleanup_service._scheduler_thread
    assert session_attempts == 1
    assert generation_running == generation_before + 1
    assert cleanup_service._scheduler_generation == generation_running
    assert cleanup_service._scheduler_desired_running is True
    assert running_thread is not None and running_thread.is_alive()
    assert secret not in caplog.text
    assert cleanup_service.shutdown_cleanup_scheduler(timeout=1) is True


def test_unexpected_scheduler_exception_stops_without_respawn_or_secret(
    monkeypatch,
    caplog,
):
    secret = "token=top-secret"
    cleanup_calls = 0

    def crash_cleanup():
        nonlocal cleanup_calls
        cleanup_calls += 1
        raise RuntimeError(secret)

    monkeypatch.setattr(cleanup_service, "run_all_cleanup", crash_cleanup)
    monkeypatch.setattr(cleanup_service, "_seconds_until_midnight", lambda: 0.001)
    cleanup_service.shutdown_cleanup_scheduler(timeout=0.1)
    generation_before = cleanup_service._scheduler_generation

    assert cleanup_service.start_cleanup_scheduler() is True

    deadline = time.time() + 1
    while cleanup_service._scheduler_thread is not None and time.time() < deadline:
        time.sleep(0.01)
    time.sleep(0.05)

    assert cleanup_calls == 1
    assert cleanup_service._scheduler_thread is None
    assert cleanup_service._scheduler_desired_running is False
    assert cleanup_service._scheduler_generation == generation_before + 2
    assert "RuntimeError" in caplog.text
    assert secret not in caplog.text
