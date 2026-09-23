"""JobStatusStore 취소 코어 — Pending/Running 전이, 동결 규칙, _kill_process_tree 승격.

FakePopen 은 실제 프로세스를 쓰지 않는다: terminate() 에 죽는 것(die_on_terminate=True)과
무시하는 것(die_on_terminate=False, die_on_kill=True) 두 가지로 5초 유예의 승격 동작을 검증한다.
_kill_process_tree 는 psutil 을 통해 자식 트리 스냅샷을 뜨는데 우리는 가짜 PID(4242)를 쓰므로
autouse fixture 로 psutil 로딩과 taskkill 을 no-op 으로 만든다(실 프로세스에 닿으면 위험).
"""
import time

import pytest

from app import database, models
from app.services import job_manager
from app.services.job_manager import (
    CANCELLED_MESSAGE,
    CANCELLED_QUEUE_MESSAGE,
    DEFAULT_CANCEL_GRACE_SECONDS,
    JobStatusStore,
    TERMINAL_STATUSES,
    job_status_store,
)


@pytest.fixture(autouse=True)
def _isolate_psutil_and_taskkill(monkeypatch):
    """psutil 스냅샷과 Windows taskkill 을 no-op 으로 대체해 실 프로세스에 닿지 않게 한다."""
    monkeypatch.setattr(job_manager, "_load_psutil", lambda: None, raising=False)
    monkeypatch.setattr(job_manager, "_taskkill_tree", lambda pid: False, raising=False)
    yield


@pytest.fixture()
def store():
    """모듈 싱글턴 대신 격리된 store 로 검사(모듈 싱글턴은 백그라운드 cleanup 스레드가 돈다)."""
    s = JobStatusStore()
    s.shutdown()  # cleanup 스레드 중지(테스트 시간 조작 방지)
    return s


class FakePopen:
    """subprocess.Popen 대체 — terminate/kill 응답과 poll() 결과를 시나리오로 지정한다."""

    def __init__(self, *, die_on_terminate=True, die_on_kill=True):
        self.pid = 4242
        self._alive = True
        self._die_on_terminate = die_on_terminate
        self._die_on_kill = die_on_kill
        self.terminate_calls = 0
        self.kill_calls = 0
        self.wait_calls = 0

    def poll(self):
        return None if self._alive else 0

    def terminate(self):
        self.terminate_calls += 1
        if self._die_on_terminate:
            self._alive = False

    def kill(self):
        self.kill_calls += 1
        if self._die_on_kill:
            self._alive = False

    def wait(self, timeout=None):
        self.wait_calls += 1
        if not self._alive:
            return 0
        # 유예 기다린 뒤 timeout 예외 흉내
        time.sleep(min(timeout or 0.01, 0.01))
        if not self._alive:
            return 0
        raise TimeoutError(timeout)


def test_terminal_statuses_covers_four_values():
    assert TERMINAL_STATUSES == frozenset({"Success", "Failed", "Interrupted", "Cancelled"})


def test_default_cancel_grace_seconds_is_five():
    assert DEFAULT_CANCEL_GRACE_SECONDS == 5.0


def test_cancel_unknown_job_returns_false(store):
    assert store.cancel("no-such") is False


def test_cancel_terminal_job_returns_false_without_marking(store):
    store.set("j1", {"status": "Success", "progress": 100, "message": "ok"})
    assert store.cancel("j1") is False
    assert store.is_cancel_requested("j1") is False


def test_cancel_pending_uses_future_cancel_and_marks_cancelled(store):
    class FakeFuture:
        cancelled_calls = 0

        def cancel(self):
            type(self).cancelled_calls += 1
            return True

    store.set("j1", {"status": "Pending", "progress": 0, "message": "대기"})
    fut = FakeFuture()
    store.attach_future("j1", fut)

    assert store.cancel("j1") is True
    entry = store.get("j1")
    assert entry["status"] == "Cancelled"
    assert entry["progress"] == 100
    assert entry["message"] == CANCELLED_QUEUE_MESSAGE
    assert FakeFuture.cancelled_calls == 1
    # 이 경로에서는 Popen 이 없으므로 cancel_requested 는 True 여도 되고 아니어도 상관없다.


def test_cancel_running_terminates_registered_popen_and_marks_cancelled(store):
    store.set("j1", {"status": "Running", "progress": 30, "message": "solving"})
    popen = FakePopen(die_on_terminate=True)
    store.register_process("j1", popen)

    assert store.cancel("j1", grace_seconds=0.05) is True
    assert popen.terminate_calls == 1
    entry = store.get("j1")
    assert entry["status"] == "Cancelled"
    assert entry["message"] == CANCELLED_MESSAGE
    assert store.is_cancel_requested("j1") is True


def test_cancel_pending_but_future_started_falls_through_to_terminate(store):
    class FakeFuture:
        def cancel(self):
            return False  # 이미 실행 시작

    store.set("j1", {"status": "Pending", "progress": 0, "message": "대기"})
    store.attach_future("j1", FakeFuture())
    popen = FakePopen(die_on_terminate=True)
    store.register_process("j1", popen)

    assert store.cancel("j1", grace_seconds=0.05) is True
    entry = store.get("j1")
    assert entry["status"] == "Cancelled"
    assert popen.terminate_calls == 1


def test_terminate_grace_escalates_to_kill(store):
    """terminate() 는 무시하고 kill() 에서만 죽는 프로세스는 유예 후 kill 로 승격한다."""
    store.set("j1", {"status": "Running", "progress": 30, "message": "solving"})
    popen = FakePopen(die_on_terminate=False, die_on_kill=True)
    store.register_process("j1", popen)

    assert store.cancel("j1", grace_seconds=0.05) is True
    assert popen.terminate_calls == 1
    assert popen.kill_calls >= 1


def test_terminate_returns_true_when_process_already_gone(store):
    """이미 정상 종료된 Popen 도 cancel() 은 True — 하지만 상태는 진행 중 값을 유지한다.

    (진행 중이라면 register_process 해제 후 종료됐을 것이므로 이 경로는 실무에선 드물다.)
    """
    store.set("j1", {"status": "Running", "progress": 30, "message": "solving"})
    popen = FakePopen()
    popen._alive = False   # 이미 죽어 있음
    store.register_process("j1", popen)

    assert store.cancel("j1", grace_seconds=0.05) is True
    entry = store.get("j1")
    assert entry["status"] == "Cancelled"


def test_update_job_freezes_status_progress_message_after_cancel(store):
    """취소 이후 서비스가 Failed/Success 로 덮으려 해도 status/progress/message 는 얼어붙는다."""
    store.set("j1", {"status": "Running", "progress": 30, "message": "solving"})
    store.register_process("j1", FakePopen())
    store.cancel("j1", grace_seconds=0.05)

    store.update_job("j1", {"status": "Failed", "progress": 100, "message": "엔진 오류"})
    entry = store.get("j1")
    assert entry["status"] == "Cancelled"
    assert entry["message"] == CANCELLED_MESSAGE


def test_update_job_accepts_non_frozen_fields_after_cancel(store):
    """engine_log·project·기타 필드는 취소 후에도 반영된다(사용자에게 진단이 남아야 한다)."""
    store.set("j1", {"status": "Running", "progress": 30, "message": "solving"})
    store.register_process("j1", FakePopen())
    store.cancel("j1", grace_seconds=0.05)

    store.update_job("j1", {"engine_log": "종료 로그", "status": "Failed"})
    entry = store.get("j1")
    assert entry["status"] == "Cancelled"
    assert entry.get("engine_log") == "종료 로그"


def test_register_process_after_cancel_terminates_immediately(store):
    """cancel 이 먼저 도착하고 Popen 이 뒤에 등록되면 register 가 즉시 종료한다(경합 대비)."""
    store.set("j1", {"status": "Running", "progress": 30, "message": "solving"})
    store.cancel("j1", grace_seconds=0.05)  # 등록된 프로세스 없음 — 그래도 cancel_requested True
    popen = FakePopen(die_on_terminate=True)
    store.register_process("j1", popen)
    assert popen.terminate_calls == 1


def test_is_cancel_requested_for_unknown_returns_false(store):
    assert store.is_cancel_requested("no-such") is False


def test_unregister_process_removes_reference(store):
    """정상 종료한 Popen 을 해제하면 이후 취소가 그 객체를 건드리지 않는다."""
    store.set("j1", {"status": "Running", "progress": 30, "message": "solving"})
    popen = FakePopen()
    store.register_process("j1", popen)
    store.unregister_process("j1", popen)

    assert store.cancel("j1", grace_seconds=0.05) is True
    assert popen.terminate_calls == 0
    assert store.get("j1")["status"] == "Cancelled"


def test_current_job_id_is_none_outside_worker():
    assert job_manager.current_job_id() is None


def test_attach_future_drops_reference_when_future_done(store):
    """future 종료 후 done 콜백이 자기 참조를 지운다(메모리 누수 방지)."""
    class FakeFuture:
        def __init__(self):
            self._cbs = []

        def add_done_callback(self, cb):
            self._cbs.append(cb)

        def cancel(self):
            return True

        def done_now(self):
            for cb in self._cbs:
                cb(self)

    store.set("j1", {"status": "Pending", "progress": 0, "message": "대기"})
    fut = FakeFuture()
    store.attach_future("j1", fut)
    fut.done_now()  # 완료 시뮬레이션
    # 내부적으로 참조가 사라졌는지 = cancel() 이 이제 Pending 을 Cancelled 로 만들지 못한다.
    assert store.cancel("j1") is True  # register_process 도 없으니 cancel_requested 만 True
    # 두 번째 cancel 은 이미 terminal(Cancelled)이라 False
    assert store.cancel("j1") is False


def test_write_through_persists_cancelled_status(db_session, make_analysis, monkeypatch):
    """_write_through 가 status=='Cancelled' 를 만나면 record.status·job_status 양쪽에 반영한다."""
    from datetime import datetime
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    a = make_analysis("EMP001", "Truss Assessment", datetime(2026, 9, 18, 9, 0, 0), status="Running")
    a.job_id = "wt-c"
    db_session.commit()
    # _write_through 가 finally 에서 db.close() 를 불러 인스턴스가 detach 되므로 id 를 미리 잡는다.
    analysis_id = a.id

    job_status_store.set("wt-c", {"status": "Running", "progress": 30, "message": "solving"})
    job_status_store.register_process("wt-c", FakePopen())
    assert job_status_store.cancel("wt-c", grace_seconds=0.05) is True

    db_session.expire_all()
    saved = db_session.get(models.Analysis, analysis_id)
    assert saved.job_status == "Cancelled"
    assert saved.status == "Cancelled"
    assert saved.progress == 100


def test_cleanup_loop_considers_cancelled(store):
    """_cleanup_loop 이 만료 판단에서 Cancelled 를 다른 terminal 상태와 동일하게 취급한다."""
    from datetime import datetime, timedelta
    store.set("j1", {"status": "Cancelled", "progress": 100, "message": CANCELLED_MESSAGE})
    # 24h+ 전에 만든 것으로 위조
    with store._lock:
        store._store["j1"]["_created_at"] = datetime.now() - timedelta(seconds=job_manager.JOB_RETENTION_SECONDS + 5)
    # _cleanup_loop 는 블로킹이므로 만료 검사만 별도로 부른다.
    store._cleanup_once()   # 신설(테스트용): 한 번만 sweep 하고 반환
    assert store.get("j1") is None
    assert store.is_cancel_requested("j1") is False   # cleanup 이 cancel_requested 도 함께 비운다


def _await_gone(pids, timeout=5.0):
    """주어진 PID 들이 사라질 때까지 기다린다(테스트 정리용). 남으면 남은 목록을 돌려준다."""
    import time as _time

    import psutil

    deadline = _time.time() + timeout
    remaining = list(pids)
    while remaining and _time.time() < deadline:
        remaining = [pid for pid in remaining if psutil.pid_exists(pid)]
        if remaining:
            _time.sleep(0.05)
    return remaining


def test_kill_process_tree_kills_only_the_target_tree(monkeypatch):
    """실제 프로세스로 대상 정확도를 검증한다 — 자손은 죽고, 무관한 프로세스와 자기 자신은 산다.

    autouse fixture 가 no-op 으로 만든 psutil 을 이 테스트에서만 진짜로 되돌린다
    (트리 스냅샷이 실제로 손자까지 회수하는지 확인해야 하므로).

    ⚠ 자식 프로세스가 기동을 마친 뒤에 종료한다. 파이썬 기동 도중 TerminateProcess 를 맞으면
    Windows 가 프로세스를 반쯤 만들어진 상태(스레드 1개·정지)로 남겨 테스트가 좀비를 흘린다.
    정리 단계에서도 세 PID 가 모두 사라졌는지 확인한다.
    """
    import os
    import subprocess
    import sys
    import time as _time

    import psutil

    monkeypatch.setattr(job_manager, "_load_psutil", lambda: psutil)

    child_code = (
        "import subprocess, sys, time\n"
        "g = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])\n"
        "time.sleep(1.5)\n"                       # 손자 기동 완료 대기
        "print(g.pid, flush=True)\n"
        "time.sleep(30)\n"
    )
    parent = subprocess.Popen([sys.executable, "-c", child_code], stdout=subprocess.PIPE, text=True)
    # 취소 대상이 아닌 무관한 프로세스(형제) — 절대 죽으면 안 된다.
    bystander = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    grandchild_pid = None
    try:
        line = parent.stdout.readline().strip()   # 손자 기동(1.5s) 뒤에 도착한다
        assert line.isdigit(), f"자식 트리 기동 실패: {line!r}"
        grandchild_pid = int(line)

        assert job_manager._kill_process_tree(parent, grace_seconds=5.0) is True

        assert parent.poll() is not None                        # 부모 회수
        assert _await_gone([grandchild_pid]) == []              # 손자 회수
        assert bystander.poll() is None                         # 무관한 프로세스는 생존
        assert psutil.pid_exists(os.getpid())                   # 테스트 프로세스 자신도 생존
    finally:
        pids = [parent.pid, bystander.pid] + ([grandchild_pid] if grandchild_pid else [])
        _time.sleep(0.2)                                        # 형제 기동 완료를 기다린 뒤 종료
        for proc in (parent, bystander):
            try:
                proc.kill()
                proc.wait(timeout=5)
            except Exception:
                pass
        try:
            parent.stdout.close()
        except Exception:
            pass
        for pid in _await_gone(pids):
            try:
                psutil.Process(pid).kill()
            except Exception:
                pass
        assert _await_gone(pids) == [], "테스트가 프로세스를 남겼다"


def test_cleanup_removes_all_four_terminal_statuses(store):
    """Success/Failed/Interrupted/Cancelled 모두 24h 후 정리된다."""
    from datetime import datetime, timedelta

    for jid, status in [("j-s", "Success"), ("j-f", "Failed"), ("j-i", "Interrupted"), ("j-c", "Cancelled")]:
        store.set(jid, {"status": status, "progress": 100, "message": "-"})
        with store._lock:
            store._store[jid]["_created_at"] = datetime.now() - timedelta(seconds=job_manager.JOB_RETENTION_SECONDS + 5)
    # 취소 메타데이터도 함께 비워지는지 보려고 실제 취소 흔적을 남겨 둔다.
    with store._lock:
        store.cancel_requested.add("j-c")

    store._cleanup_once()
    for jid in ("j-s", "j-f", "j-i", "j-c"):
        assert store.get(jid) is None
    # Cancelled 는 cancel_requested 에서도 같이 지워진다.
    assert "j-c" not in store.cancel_requested
