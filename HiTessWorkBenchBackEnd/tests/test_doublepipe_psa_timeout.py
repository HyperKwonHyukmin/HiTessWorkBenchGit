"""DoublePipe PSA subprocess timeout/cancel/license-slot regression tests."""

from __future__ import annotations

import io
import subprocess
import threading

import pytest
from fastapi import HTTPException

from app.services import doublepipe_psa_service as service


class _BlockingOutput:
    """EOF 를 내지 않다가 close 시 reader 를 해제하는 stdout fake."""

    def __init__(self):
        self._closed = threading.Event()
        self.close_calls = 0

    def __iter__(self):
        return self

    def __next__(self):
        self._closed.wait(timeout=10)
        raise StopIteration

    def close(self):
        self.close_calls += 1
        self._closed.set()


class _TimeoutProcess:
    def __init__(self):
        self.pid = 41001
        self.stdout = _BlockingOutput()
        self.returncode = None
        self.tree_killed = False
        self.kill_calls = 0
        self.wait_calls = []

    def wait(self, timeout=None):
        self.wait_calls.append(timeout)
        if not self.tree_killed:
            raise subprocess.TimeoutExpired(["psa.exe"], timeout)
        self.returncode = -9
        return self.returncode

    def kill(self):
        self.kill_calls += 1
        self.tree_killed = True


class _NormalProcess:
    def __init__(self, output: str, returncode: int = 0):
        self.pid = 41002
        self.stdout = io.StringIO(output)
        self.returncode = returncode
        self.wait_calls = []

    def wait(self, timeout=None):
        self.wait_calls.append(timeout)
        return self.returncode

    def kill(self):
        raise AssertionError("normal completion must not kill the process")


class _CancellableProcess:
    def __init__(self):
        self.pid = 41003
        self.stdout = _BlockingOutput()
        self.returncode = None
        self.wait_started = threading.Event()
        self.terminated = threading.Event()

    def wait(self, timeout=None):
        self.wait_started.set()
        if not self.terminated.wait(timeout=5):
            raise subprocess.TimeoutExpired(["psa.exe"], timeout)
        self.returncode = -9
        return self.returncode

    def kill(self):
        self.terminated.set()


@pytest.fixture(autouse=True)
def _isolated_psa_state(monkeypatch):
    with service._jobs_lock:
        service._jobs.clear()
        service._active_job_id = None

    monkeypatch.setattr(service, "_stage_report_template", lambda *_: None)
    monkeypatch.setattr(service, "_build_subprocess_env", lambda *_: {})
    monkeypatch.setattr(service, "_record_psa_analysis", lambda *_: None)
    # EOF 없는 fake 에서 정리 시간이 길어지지 않게 하되 join/close 경로 자체는 실행한다.
    monkeypatch.setattr(service, "_OUTPUT_READER_JOIN_TIMEOUT", 0.05)

    yield

    with service._jobs_lock:
        service._jobs.clear()
        service._active_job_id = None


def _seed_running_job(job_id: str, tmp_path, employee_id: str = "E001"):
    job = {
        "jobId": job_id,
        "status": "running",
        "returncode": None,
        "csvPath": str(tmp_path / "input.csv"),
        "logs": [],
        "reportPath": str(tmp_path / service._REPORT_NAME),
        "reportReady": False,
        "employeeId": employee_id,
        "loadCases": None,
        "startedAt": "2026-07-28T00:00:00",
        "startedAtEpoch": 0.0,
        "finishedAt": None,
        "pid": None,
    }
    with service._jobs_lock:
        service._jobs[job_id] = job
        service._active_job_id = job_id
    return job


def test_eof_less_stdout_still_times_out_kills_tree_and_releases_slot(monkeypatch, tmp_path):
    job_id = "timeout-job"
    _seed_running_job(job_id, tmp_path)
    proc = _TimeoutProcess()
    kill_calls = []

    monkeypatch.setattr(service.subprocess, "Popen", lambda *a, **k: proc)

    def _kill_tree(pid, received_job_id):
        kill_calls.append((pid, received_job_id))
        proc.tree_killed = True
        return True

    monkeypatch.setattr(service, "_kill_process_tree", _kill_tree)

    service._run_pipeline(job_id, ["psa.exe"], str(tmp_path))

    job = service.get_psa_job(job_id)
    assert kill_calls == [(proc.pid, job_id)]
    assert job["status"] == "failed"
    assert job["returncode"] == -2
    assert job["reportReady"] is False
    assert "시간 초과" in "\n".join(job["logs"])
    assert service._active_job_id is None
    assert proc.stdout.close_calls == 1
    assert proc.kill_calls == 0  # process-tree kill 후 정상 reap 되어 직계 kill 폴백 불필요
    assert proc.wait_calls[0] == service._PSA_TIMEOUT


def test_normal_output_streaming_completion_and_report_ready(monkeypatch, tmp_path):
    job_id = "normal-job"
    _seed_running_job(job_id, tmp_path)
    (tmp_path / service._REPORT_NAME).write_bytes(b"report")
    proc = _NormalProcess("first line\nsecond line\r\n")

    monkeypatch.setattr(service.subprocess, "Popen", lambda *a, **k: proc)
    monkeypatch.setattr(
        service,
        "_kill_process_tree",
        lambda *_: pytest.fail("normal completion must not kill the process tree"),
    )

    service._run_pipeline(job_id, ["psa.exe"], str(tmp_path))

    job = service.get_psa_job(job_id)
    assert job["status"] == "done"
    assert job["returncode"] == 0
    assert job["reportReady"] is True
    assert job["logs"] == ["first line", "second line"]
    assert service._active_job_id is None
    assert proc.stdout.closed
    assert proc.wait_calls == [service._PSA_TIMEOUT]


def test_cancel_wins_race_without_pipeline_overwriting_cancel_state(monkeypatch, tmp_path):
    job_id = "cancel-job"
    _seed_running_job(job_id, tmp_path)
    proc = _CancellableProcess()
    pipeline_finish_attempted = threading.Event()
    real_finish = service._finish

    monkeypatch.setattr(service.subprocess, "Popen", lambda *a, **k: proc)

    def _observed_finish(*args, **kwargs):
        pipeline_finish_attempted.set()
        return real_finish(*args, **kwargs)

    def _kill_tree_then_let_pipeline_race(pid, received_job_id):
        proc.terminated.set()
        # 파이프라인의 _finish 가 먼저 실행되는 최악의 순서를 강제한다.
        assert pipeline_finish_attempted.wait(timeout=1)
        return True

    monkeypatch.setattr(service, "_finish", _observed_finish)
    monkeypatch.setattr(service, "_kill_process_tree", _kill_tree_then_let_pipeline_race)

    pipeline = threading.Thread(
        target=service._run_pipeline,
        args=(job_id, ["psa.exe"], str(tmp_path)),
    )
    pipeline.start()
    assert proc.wait_started.wait(timeout=1)

    assert service.cancel_psa_job(job_id, "E001") == {"cancelled": True}
    pipeline.join(timeout=2)

    assert not pipeline.is_alive()
    job = service.get_psa_job(job_id)
    assert job["status"] == "failed"
    assert job["returncode"] == -3
    assert job["diagnostic"] == "cancelled"
    assert job["reportReady"] is False
    assert service._active_job_id is None
    assert proc.stdout.close_calls == 1


def test_launch_keeps_single_abaqus_slot_atomic(monkeypatch, tmp_path):
    csv_path = tmp_path / "input.csv"
    csv_path.write_text("header\n", encoding="utf-8")

    monkeypatch.setattr(service.os.path, "isdir", lambda *_: True)
    monkeypatch.setattr(service.os.path, "isfile", lambda *_: True)

    class _NeverStartedThread:
        def __init__(self, *args, **kwargs):
            pass

        def start(self):
            pass

    monkeypatch.setattr(service.threading, "Thread", _NeverStartedThread)

    first = service._launch_job(str(csv_path), "E001")
    with pytest.raises(HTTPException) as exc_info:
        service._launch_job(str(csv_path), "E002")

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "license_busy"
    assert service._active_job_id == first["jobId"]
    assert len(service._jobs) == 1


def test_cancel_before_popen_never_starts_process_and_releases_slot(monkeypatch, tmp_path):
    job_id = "cancel-before-popen"
    _seed_running_job(job_id, tmp_path)
    env_entered = threading.Event()
    allow_env = threading.Event()
    popen_calls = []

    def blocking_env(*_):
        env_entered.set()
        assert allow_env.wait(timeout=2)
        return {}

    monkeypatch.setattr(service, "_build_subprocess_env", blocking_env)
    monkeypatch.setattr(
        service.subprocess,
        "Popen",
        lambda *a, **k: popen_calls.append((a, k)),
    )

    pipeline = threading.Thread(
        target=service._run_pipeline,
        args=(job_id, ["psa.exe"], str(tmp_path)),
    )
    pipeline.start()
    assert env_entered.wait(timeout=1)

    result = {}
    cancel = threading.Thread(
        target=lambda: result.update(service.cancel_psa_job(job_id, "E001")),
    )
    cancel.start()
    allow_env.set()
    cancel.join(timeout=2)
    pipeline.join(timeout=2)

    assert not cancel.is_alive()
    assert not pipeline.is_alive()
    assert result == {"cancelled": True}
    assert popen_calls == []
    assert service.get_psa_job(job_id)["diagnostic"] == "cancelled"
    assert service._active_job_id is None


def test_cancel_kill_failure_keeps_license_slot_and_running_state(monkeypatch, tmp_path):
    job_id = "cancel-kill-failed"
    job = _seed_running_job(job_id, tmp_path)

    class _UnkillableProcess:
        pid = 42001

        def wait(self, timeout=None):
            raise subprocess.TimeoutExpired(["psa.exe"], timeout)

        def kill(self):
            raise OSError("access denied")

    proc = _UnkillableProcess()
    ready = threading.Event()
    ready.set()
    job.update({
        "pid": proc.pid,
        "_process": proc,
        "_processReady": ready,
        "_terminationLock": threading.Lock(),
    })
    monkeypatch.setattr(service, "_kill_process_tree", lambda *_: False)

    result = service.cancel_psa_job(job_id, "E001")

    assert result["cancelled"] is False
    assert service.get_psa_job(job_id)["status"] == "running"
    assert service._active_job_id == job_id
    assert "슬롯을 유지" in "\n".join(service.get_psa_job(job_id)["logs"])
    assert "_cancelRequested" not in job

    # kill 실패 뒤 parent가 스스로 끝나더라도 전체 tree 검증 전에는 terminal/slot release 금지.
    proc.returncode = 0
    service._finish(job_id, status="done", returncode=0)
    assert service.get_psa_job(job_id)["status"] == "running"
    assert service.get_psa_job(job_id)["diagnostic"] == "termination_pending"
    assert job["_deferredFinish"]["status"] == "done"
    assert service._active_job_id == job_id


def test_cancel_retry_releases_slot_only_after_verified_cleanup(monkeypatch, tmp_path):
    job_id = "cancel-retry"
    job = _seed_running_job(job_id, tmp_path)

    class _Process:
        pid = 42011
        returncode = None

    proc = _Process()
    ready = threading.Event()
    ready.set()
    job.update({
        "pid": proc.pid,
        "_process": proc,
        "_processReady": ready,
        "_terminationLock": threading.Lock(),
    })
    results = iter([False, True])
    monkeypatch.setattr(service, "_terminate_process_tree", lambda *_: next(results))

    first = service.cancel_psa_job(job_id, "E001")
    assert first["cancelled"] is False
    assert service._active_job_id == job_id
    assert "_cancelRequested" not in job

    assert service.cancel_psa_job(job_id, "E001") == {"cancelled": True}
    assert service.get_psa_job(job_id)["diagnostic"] == "cancelled"
    assert service._active_job_id is None


def test_failed_cancel_defers_natural_finish_until_cleanup_is_verified(
    monkeypatch, tmp_path,
):
    job_id = "cancel-natural-finish-race"
    job = _seed_running_job(job_id, tmp_path)

    class _Process:
        pid = 42013
        returncode = 0

    proc = _Process()
    ready = threading.Event()
    ready.set()
    job.update({
        "pid": proc.pid,
        "_process": proc,
        "_processReady": ready,
        "_terminationLock": threading.Lock(),
    })

    def natural_finish_during_failed_kill(*_):
        # _cancelRequested 때문에 우선 deferred되고, 실패 정리 시 재생되어야 한다.
        service._finish(job_id, status="done", returncode=0)
        return False

    monkeypatch.setattr(
        service, "_terminate_process_tree", natural_finish_during_failed_kill,
    )

    result = service.cancel_psa_job(job_id, "E001")

    assert result["cancelled"] is False
    assert result["status"] == "running"
    assert service.get_psa_job(job_id)["status"] == "running"
    assert service.get_psa_job(job_id)["diagnostic"] == "termination_pending"
    assert job["_deferredFinish"]["status"] == "done"
    assert service._active_job_id == job_id

    monkeypatch.setattr(service, "_terminate_process_tree", lambda *_: True)
    retry = service.cancel_psa_job(job_id, "E001")

    assert retry["cancelled"] is False
    assert retry["status"] == "done"
    assert service.get_psa_job(job_id)["status"] == "done"
    assert service._active_job_id is None


@pytest.mark.parametrize(
    ("wait_exception", "expected_code"),
    [
        (subprocess.TimeoutExpired(["psa.exe"], 1), -2),
        (RuntimeError("wait failed"), -1),
    ],
)
def test_timeout_or_error_holds_slot_when_tree_reap_not_verified(
    monkeypatch, tmp_path, wait_exception, expected_code,
):
    job_id = f"termination-pending-{expected_code}"
    _seed_running_job(job_id, tmp_path)

    class _UnreapedProcess:
        pid = 42012
        returncode = None
        stdout = io.StringIO("")

        def wait(self, timeout=None):
            raise wait_exception

    proc = _UnreapedProcess()
    monkeypatch.setattr(service.subprocess, "Popen", lambda *a, **k: proc)
    monkeypatch.setattr(service, "_terminate_process_tree", lambda *_: False)

    service._run_pipeline(job_id, ["psa.exe"], str(tmp_path))

    job = service.get_psa_job(job_id)
    assert job["status"] == "running"
    assert job["diagnostic"] == "termination_pending"
    assert job["returncode"] is None
    assert service._active_job_id == job_id


def test_surviving_descendant_makes_tree_termination_unverified(monkeypatch):
    calls = []

    class _NoSuchProcess(Exception):
        pass

    class _AccessDenied(Exception):
        pass

    class _FakeProcess:
        def __init__(self, pid, survives=False):
            self.pid = pid
            self.survives = survives

        def children(self, recursive=False):
            assert recursive is True
            return [child]

        def is_running(self):
            return self.survives

        def status(self):
            return "running"

        def terminate(self):
            calls.append(("terminate", self.pid))

        def kill(self):
            calls.append(("kill", self.pid))

    parent = _FakeProcess(43001, survives=False)
    child = _FakeProcess(43002, survives=True)

    class _FakePsutil:
        NoSuchProcess = _NoSuchProcess
        AccessDenied = _AccessDenied
        STATUS_ZOMBIE = "zombie"

        @staticmethod
        def Process(pid):
            assert pid == parent.pid
            return parent

        @staticmethod
        def wait_procs(processes, timeout):
            return [], list(processes)

    class _Result:
        returncode = 5

    monkeypatch.setitem(__import__("sys").modules, "psutil", _FakePsutil)
    monkeypatch.setattr(service.os, "name", "nt")
    monkeypatch.setattr(service.subprocess, "run", lambda *a, **k: _Result())
    monkeypatch.setattr(service, "_append_log", lambda *args: None)

    assert service._kill_process_tree(parent.pid, "descendant-job") is False
    assert ("terminate", child.pid) in calls
    assert ("kill", child.pid) in calls


def test_taskkill_nonzero_falls_back_to_direct_kill_and_reap(monkeypatch, tmp_path):
    job_id = "taskkill-fallback"
    job = _seed_running_job(job_id, tmp_path)

    class _FallbackProcess:
        pid = 42002

        def __init__(self):
            self.killed = False

        def wait(self, timeout=None):
            if not self.killed:
                raise subprocess.TimeoutExpired(["psa.exe"], timeout)
            return -9

        def kill(self):
            self.killed = True

    class _Result:
        returncode = 5

    proc = _FallbackProcess()
    ready = threading.Event()
    ready.set()
    job.update({
        "pid": proc.pid,
        "_process": proc,
        "_processReady": ready,
        "_terminationLock": threading.Lock(),
    })
    monkeypatch.setattr(service.os, "name", "nt")
    monkeypatch.setattr(service.subprocess, "run", lambda *a, **k: _Result())

    result = service.cancel_psa_job(job_id, "E001")

    assert result["cancelled"] is False
    assert proc.killed is False
    assert service.get_psa_job(job_id)["diagnostic"] == "termination_pending"
    assert job["_terminationVerificationPending"] is True
    assert service._active_job_id == job_id


@pytest.mark.parametrize("snapshot_error", ["missing", "denied"])
def test_unavailable_initial_tree_snapshot_and_failed_taskkill_stays_pending(
    monkeypatch, tmp_path, snapshot_error,
):
    job_id = f"snapshot-{snapshot_error}"
    job = _seed_running_job(job_id, tmp_path)

    class _NoSuchProcess(Exception):
        pass

    class _AccessDenied(Exception):
        pass

    class _FakePsutil:
        NoSuchProcess = _NoSuchProcess
        AccessDenied = _AccessDenied
        STATUS_ZOMBIE = "zombie"

        @staticmethod
        def Process(_pid):
            if snapshot_error == "missing":
                raise _NoSuchProcess()
            raise _AccessDenied()

        @staticmethod
        def wait_procs(processes, timeout):
            return [], list(processes)

    class _Result:
        returncode = 128 if snapshot_error == "missing" else 5

    monkeypatch.setitem(__import__("sys").modules, "psutil", _FakePsutil)
    monkeypatch.setattr(service.os, "name", "nt")
    monkeypatch.setattr(service.subprocess, "run", lambda *a, **k: _Result())

    assert service._kill_process_tree(42999, job_id) is False
    assert job["_terminationVerificationPending"] is True
    assert service._active_job_id == job_id


def test_survivor_late_finish_replays_only_after_verified_retry(monkeypatch, tmp_path):
    job_id = "survivor-late-finish"
    job = _seed_running_job(job_id, tmp_path)

    class _Process:
        pid = 42021
        returncode = 0

    class _Survivor:
        pid = 42022

    proc = _Process()
    ready = threading.Event()
    ready.set()
    survivor = _Survivor()
    job.update({
        "pid": proc.pid,
        "_process": proc,
        "_processReady": ready,
        "_terminationLock": threading.Lock(),
        "_terminationProcesses": [survivor],
    })

    monkeypatch.setattr(service, "_terminate_process_tree", lambda *_: False)
    first = service.cancel_psa_job(job_id, "E001")
    assert first["cancelled"] is False

    # cancel failure 정리로 _cancelRequested가 제거된 뒤 도착하는 late completion도 보류된다.
    service._finish(job_id, status="done", returncode=0, report_ready=True)
    assert service.get_psa_job(job_id)["status"] == "running"
    assert job["_deferredFinish"] == {
        "status": "done",
        "returncode": 0,
        "report_ready": True,
    }
    assert service._active_job_id == job_id

    def _verified_cleanup(*_):
        with service._jobs_lock:
            job.pop("_terminationProcesses", None)
            job.pop("_terminationVerificationPending", None)
            job.pop("_terminationReapPending", None)
            job.pop("diagnostic", None)
        return True

    monkeypatch.setattr(service, "_terminate_process_tree", _verified_cleanup)
    retry = service.cancel_psa_job(job_id, "E001")

    assert retry["cancelled"] is False
    assert retry["status"] == "done"
    final = service.get_psa_job(job_id)
    assert final["status"] == "done"
    assert final["reportReady"] is True
    assert service._active_job_id is None


def test_verified_snapshot_allows_later_dead_tree_to_replay_after_parent_reap(
    monkeypatch, tmp_path,
):
    job_id = "verified-snapshot-retry"
    job = _seed_running_job(job_id, tmp_path)

    class _NoSuchProcess(Exception):
        pass

    class _AccessDenied(Exception):
        pass

    class _TrackedProcess:
        def __init__(self, pid, created):
            self.pid = pid
            self.created = created
            self.running = True

        def create_time(self):
            return self.created

        def children(self, recursive=False):
            assert recursive is True
            return [child] if self is parent else []

        def is_running(self):
            return self.running

        def status(self):
            return "running"

        def terminate(self):
            pass

        def kill(self):
            pass

    parent = _TrackedProcess(42101, 100.0)
    child = _TrackedProcess(42102, 101.0)
    snapshot_available = True

    class _FakePsutil:
        NoSuchProcess = _NoSuchProcess
        AccessDenied = _AccessDenied
        STATUS_ZOMBIE = "zombie"

        @staticmethod
        def Process(pid):
            assert pid == parent.pid
            if not snapshot_available:
                raise _NoSuchProcess()
            return parent

        @staticmethod
        def wait_procs(processes, timeout):
            return [], list(processes)

    class _Result:
        returncode = 128

    class _PopenParent:
        pid = parent.pid
        returncode = None

        def poll(self):
            return self.returncode

        def wait(self, timeout=None):
            self.returncode = 0
            return 0

        def kill(self):
            raise AssertionError("already reaped parent must not need direct kill")

    proc = _PopenParent()
    ready = threading.Event()
    ready.set()
    job.update({
        "pid": proc.pid,
        "_process": proc,
        "_processReady": ready,
        "_terminationLock": threading.Lock(),
    })
    monkeypatch.setitem(__import__("sys").modules, "psutil", _FakePsutil)
    monkeypatch.setattr(service.os, "name", "nt")
    monkeypatch.setattr(service.subprocess, "run", lambda *a, **k: _Result())

    first = service.cancel_psa_job(job_id, "E001")
    assert first["cancelled"] is False
    assert job["_terminationSnapshotVerified"] is True
    assert len(job["_terminationTrackedProcesses"]) == 2

    service._finish(job_id, status="done", returncode=0, report_ready=True)
    parent.running = False
    child.running = False
    snapshot_available = False

    retry = service.cancel_psa_job(job_id, "E001")

    assert retry["cancelled"] is False
    assert retry["status"] == "done"
    assert service._active_job_id is None
    assert "_terminationSnapshotVerified" not in job
    assert "_terminationTrackedProcesses" not in job
    assert "_terminationProcesses" not in job


@pytest.mark.parametrize("uncertain_state", ["pid_reused", "access_denied"])
def test_verified_snapshot_retry_keeps_slot_when_tracked_identity_is_uncertain(
    monkeypatch, tmp_path, uncertain_state,
):
    job_id = f"verified-snapshot-{uncertain_state}"
    job = _seed_running_job(job_id, tmp_path)

    class _NoSuchProcess(Exception):
        pass

    class _AccessDenied(Exception):
        pass

    class _TrackedProcess:
        def __init__(self, pid, created):
            self.pid = pid
            self.created = created
            self.running = True
            self.deny = False

        def create_time(self):
            if self.deny:
                raise _AccessDenied()
            return self.created

        def children(self, recursive=False):
            return [child] if self is parent else []

        def is_running(self):
            return self.running

        def status(self):
            return "running"

        def terminate(self):
            pass

        def kill(self):
            pass

    parent = _TrackedProcess(42201, 200.0)
    child = _TrackedProcess(42202, 201.0)
    snapshot_available = True

    class _FakePsutil:
        NoSuchProcess = _NoSuchProcess
        AccessDenied = _AccessDenied
        STATUS_ZOMBIE = "zombie"

        @staticmethod
        def Process(pid):
            if not snapshot_available:
                raise _NoSuchProcess()
            return parent

        @staticmethod
        def wait_procs(processes, timeout):
            return [], list(processes)

    class _Result:
        returncode = 128

    class _PopenParent:
        pid = parent.pid

        @staticmethod
        def poll():
            return None

    proc = _PopenParent()
    ready = threading.Event()
    ready.set()
    job.update({
        "pid": proc.pid,
        "_process": proc,
        "_processReady": ready,
        "_terminationLock": threading.Lock(),
    })
    monkeypatch.setitem(__import__("sys").modules, "psutil", _FakePsutil)
    monkeypatch.setattr(service.os, "name", "nt")
    monkeypatch.setattr(service.subprocess, "run", lambda *a, **k: _Result())

    assert service.cancel_psa_job(job_id, "E001")["cancelled"] is False
    parent.running = False
    snapshot_available = False
    if uncertain_state == "pid_reused":
        child.created += 1.0
    else:
        child.deny = True

    retry = service.cancel_psa_job(job_id, "E001")

    assert retry["cancelled"] is False
    assert service.get_psa_job(job_id)["status"] == "running"
    assert service._active_job_id == job_id
    assert job["_terminationSnapshotVerified"] is True
    assert job["_terminationVerificationPending"] is True


def test_thread_start_failure_marks_failed_and_releases_slot(monkeypatch, tmp_path):
    csv_path = tmp_path / "input.csv"
    csv_path.write_text("header\n", encoding="utf-8")
    monkeypatch.setattr(service.os.path, "isdir", lambda *_: True)
    monkeypatch.setattr(service.os.path, "isfile", lambda *_: True)

    class _FailingThread:
        def __init__(self, *args, **kwargs):
            pass

        def start(self):
            raise RuntimeError("thread unavailable")

    monkeypatch.setattr(service.threading, "Thread", _FailingThread)

    with pytest.raises(HTTPException) as exc_info:
        service._launch_job(str(csv_path), "E001")

    assert exc_info.value.status_code == 503
    assert service._active_job_id is None
    assert len(service._jobs) == 1
    job = next(iter(service._jobs.values()))
    assert job["status"] == "failed"
    assert job["diagnostic"] == "thread_start_failed"
