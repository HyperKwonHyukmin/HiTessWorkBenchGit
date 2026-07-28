import os
import subprocess
import sys

from serverguard import diagnostics


def test_collect_returns_host_metrics():
    snapshot = diagnostics.collect()

    assert "cpu" in snapshot
    assert "mem_pct" in snapshot
    assert "disk_free_gb" in snapshot
    assert "disk_path" in snapshot        # 증거가 스스로를 설명해야 한다 — 어느 드라이브인지 명시.


def test_collect_includes_process_metrics_for_valid_pid():
    snapshot = diagnostics.collect(uvicorn_pid=os.getpid())

    assert snapshot["uvicorn_pid"] == os.getpid()
    assert snapshot["threads"] >= 1
    assert snapshot["proc_mem_mb"] > 0


def test_collect_survives_dead_pid():
    # 스냅샷 수집이 실패해도 재시작을 막아서는 안 된다. psutil.Process(-1) 은
    # ValueError(음수 pid)를 던지지만, 실제 위험 시나리오는 "있다가 방금 죽은
    # PID" 다 — 이 경우 psutil.NoSuchProcess 가 발생한다(실측 확인). 실제
    # 프로세스를 띄우고 종료를 확인한 뒤 그 pid 로 재현한다.
    child = subprocess.Popen([sys.executable, "-c", "pass"])
    try:
        child.wait(timeout=5)
        dead_pid = child.pid

        snapshot = diagnostics.collect(uvicorn_pid=dead_pid)

        assert snapshot["uvicorn_pid"] == dead_pid
        assert "threads" not in snapshot
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)
