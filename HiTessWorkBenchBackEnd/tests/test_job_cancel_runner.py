"""공용 래퍼(run_subprocess_killtree)와 Mooring _run_capture 의 Popen 등록/해제 검증."""
import subprocess

import pytest

from app.services import analysis_runner, job_manager


class FakePopen:
    """subprocess.Popen 대체. communicate 는 즉시 반환하며 pid 만 흉내낸다."""

    def __init__(self, *args, **kwargs):
        self.pid = 4242
        self._alive = True
        self.args = args[0] if args else []
        # 실제 Popen 과 동일하게 종료 전에는 None, 종료 후 정수.
        self.returncode = None

    def poll(self):
        return None if self._alive else 0

    def communicate(self, timeout=None):
        self._alive = False
        self.returncode = 0
        return (b"OK", b"")

    def wait(self, timeout=None):
        self._alive = False
        self.returncode = 0
        return 0

    def terminate(self):
        self._alive = False
        self.returncode = 0

    def kill(self):
        self._alive = False
        self.returncode = 0


@pytest.fixture(autouse=True)
def _isolate_psutil(monkeypatch):
    monkeypatch.setattr(job_manager, "_load_psutil", lambda: None, raising=False)
    monkeypatch.setattr(job_manager, "_taskkill_tree", lambda pid: False, raising=False)


def test_run_subprocess_killtree_registers_and_unregisters_popen(monkeypatch):
    seen = {"reg": [], "unreg": []}

    def _reg(job_id, popen):
        seen["reg"].append((job_id, popen))

    def _unreg(job_id, popen):
        seen["unreg"].append((job_id, popen))

    monkeypatch.setattr(job_manager.job_status_store, "register_process", _reg)
    monkeypatch.setattr(job_manager.job_status_store, "unregister_process", _unreg)
    monkeypatch.setattr(analysis_runner.subprocess, "Popen", FakePopen)
    # psutil 이 있는 경로(폴백 아님)를 강제
    monkeypatch.setattr(analysis_runner, "psutil", object(), raising=False)

    analysis_runner.run_subprocess_killtree(
        ["fake"], cwd=None, timeout=1, job_id="j-run-1",
    )

    assert seen["reg"] and seen["reg"][0][0] == "j-run-1"
    assert seen["unreg"] and seen["unreg"][0][0] == "j-run-1"


def test_run_subprocess_killtree_skips_when_cancel_already_requested(monkeypatch):
    """이미 취소가 요청된 job 이 새 프로세스를 띄우려 하면 TimeoutExpired 로 잘라 기존 catch 재사용."""
    monkeypatch.setattr(
        job_manager.job_status_store, "is_cancel_requested", lambda jid: jid == "j-can",
    )
    monkeypatch.setattr(analysis_runner.subprocess, "Popen", FakePopen)

    with pytest.raises(subprocess.TimeoutExpired):
        analysis_runner.run_subprocess_killtree(
            ["fake"], cwd=None, timeout=1, job_id="j-can",
        )


def test_run_subprocess_killtree_infers_job_id_from_context(monkeypatch):
    """job_id 를 명시하지 않으면 current_job_id() 를 쓴다."""
    seen = {"reg": []}
    monkeypatch.setattr(
        job_manager.job_status_store, "register_process",
        lambda jid, popen: seen["reg"].append(jid),
    )
    monkeypatch.setattr(job_manager.job_status_store, "unregister_process", lambda *_a: None)
    monkeypatch.setattr(analysis_runner.subprocess, "Popen", FakePopen)

    token = job_manager._CURRENT_JOB_ID.set("j-ctx")
    try:
        analysis_runner.run_subprocess_killtree(["fake"], timeout=1)
    finally:
        job_manager._CURRENT_JOB_ID.reset(token)
    assert seen["reg"] == ["j-ctx"]


def test_run_subprocess_killtree_without_job_id_does_not_register(monkeypatch):
    """job_id 도 컨텍스트도 없는 레거시 호출은 훅을 전혀 건드리지 않는다(기존 동작 보존)."""
    seen = {"reg": [], "cancel_lookups": []}
    monkeypatch.setattr(
        job_manager.job_status_store, "register_process",
        lambda jid, popen: seen["reg"].append(jid),
    )
    monkeypatch.setattr(
        job_manager.job_status_store, "is_cancel_requested",
        lambda jid: seen["cancel_lookups"].append(jid) or False,
    )
    monkeypatch.setattr(analysis_runner.subprocess, "Popen", FakePopen)

    result = analysis_runner.run_subprocess_killtree(["fake"], timeout=1)

    assert result.returncode == 0
    assert seen["reg"] == []
    assert seen["cancel_lookups"] == []


def test_run_subprocess_killtree_unregisters_even_when_hook_raises(monkeypatch):
    """등록 훅이 터져도 해석(반환 계약)은 그대로 이어진다."""
    def _boom(*_args, **_kwargs):
        raise RuntimeError("store down")

    monkeypatch.setattr(job_manager.job_status_store, "register_process", _boom)
    monkeypatch.setattr(job_manager.job_status_store, "unregister_process", _boom)
    monkeypatch.setattr(analysis_runner.subprocess, "Popen", FakePopen)

    result = analysis_runner.run_subprocess_killtree(
        ["fake"], timeout=1, job_id="j-boom",
    )
    assert result.returncode == 0
    assert result.stdout == b"OK"


def test_mooring_run_capture_registers_and_delegates_kill_on_timeout(monkeypatch):
    from app.services import mooring_fitting_service as mfs

    class SlowPopen(FakePopen):
        def communicate(self, timeout=None):
            raise subprocess.TimeoutExpired(cmd=self.args, timeout=timeout)

    monkeypatch.setattr(mfs.subprocess, "Popen", SlowPopen)

    reg_calls, unreg_calls, kill_calls = [], [], []
    monkeypatch.setattr(
        job_manager.job_status_store, "register_process",
        lambda jid, popen: reg_calls.append(jid),
    )
    monkeypatch.setattr(
        job_manager.job_status_store, "unregister_process",
        lambda jid, popen: unreg_calls.append(jid),
    )
    monkeypatch.setattr(
        "app.services.job_manager._kill_process_tree",
        lambda popen, grace_seconds=None: kill_calls.append(popen) or True,
    )

    with pytest.raises(subprocess.TimeoutExpired):
        mfs._run_capture(["mf.exe"], cwd=".", timeout=1, job_id="j-mf")

    assert reg_calls == ["j-mf"]
    assert unreg_calls == ["j-mf"]
    assert len(kill_calls) == 1


def test_mooring_run_capture_skips_when_cancel_already_requested(monkeypatch):
    """취소 요청된 job 은 MooringFitting.exe 를 아예 띄우지 않는다."""
    from app.services import mooring_fitting_service as mfs

    spawned = []

    class TracingPopen(FakePopen):
        def __init__(self, *args, **kwargs):
            spawned.append(args)
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(mfs.subprocess, "Popen", TracingPopen)
    monkeypatch.setattr(
        job_manager.job_status_store, "is_cancel_requested", lambda jid: jid == "j-mf-cancel",
    )

    with pytest.raises(subprocess.TimeoutExpired):
        mfs._run_capture(["mf.exe"], cwd=".", timeout=1, job_id="j-mf-cancel")
    assert spawned == []


def test_mooring_run_capture_without_job_id_keeps_legacy_contract(monkeypatch):
    """job_id 없는 호출은 기존처럼 (returncode, stdout, stderr) 를 그대로 돌려준다."""
    from app.services import mooring_fitting_service as mfs

    monkeypatch.setattr(mfs.subprocess, "Popen", FakePopen)
    rc, out, err = mfs._run_capture(["mf.exe"], cwd=".", timeout=1)
    assert (rc, out, err) == (0, b"OK", b"")
