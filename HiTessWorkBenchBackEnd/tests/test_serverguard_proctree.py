import os
import subprocess
import sys
import time

import psutil
import pytest

from serverguard import proctree


class FakeProcess:
    """psutil.Process 의 최소 대역 — kill 호출과 종료 확인(wait) 여부를 기록한다."""

    def __init__(self, pid, create_time, *, raises=None, wait_raises=None):
        self.pid = pid
        self._create_time = create_time
        self._raises = raises
        self._wait_raises = wait_raises
        self.killed = False

    def create_time(self):
        if self._raises:
            raise self._raises
        return self._create_time

    def kill(self):
        self.killed = True

    def wait(self, timeout=None):
        """실제 psutil.Process.wait() 대역 — 기본은 즉시 종료 확인, wait_raises 를
        주면 psutil.TimeoutExpired 등으로 '아직 안 죽음'을 시뮬레이션한다."""
        if self._wait_raises:
            raise self._wait_raises
        return 0


def test_snapshot_tree_returns_empty_for_missing_pid():
    # psutil.Process(-1) 는 존재할 수 없는 pid 라 psutil.NoSuchProcess 가 아니라
    # ValueError("pid must be a positive integer") 를 던진다(실측 확인) — 이를
    # 삼키고 빈 목록을 반환해야 한다.
    assert proctree.snapshot_tree(-1) == []


def test_snapshot_tree_records_current_process_children():
    entries = proctree.snapshot_tree(os.getpid())

    assert isinstance(entries, list)
    for entry in entries:
        assert set(entry) == {"pid", "name", "create_time"}


def test_kill_survivors_kills_matching_processes():
    fake = FakeProcess(pid=15880, create_time=111.0)
    snapshot = [{"pid": 15880, "name": "nastran.exe", "create_time": 111.0}]

    killed = proctree.kill_survivors(snapshot, proc_factory=lambda pid: fake)

    assert fake.killed is True
    # terminated=True — kill() 뿐 아니라 wait() 으로 실제 종료까지 확인했다는 뜻.
    assert killed == [
        {"pid": 15880, "name": "nastran.exe", "create_time": 111.0, "terminated": True}
    ]


def test_kill_survivors_reports_unconfirmed_when_wait_times_out():
    # kill() 요청은 보냈지만 timeout 안에 실제 종료를 확인하지 못한 경우 —
    # 항목을 조용히 빼면 "죽이려 했는데 확인 못 했다"는, 사후 분석에 가장 중요한
    # 정보가 사라진다. 빼지 말고 terminated=False 로 실어야 한다.
    fake = FakeProcess(
        pid=15880,
        create_time=111.0,
        wait_raises=psutil.TimeoutExpired(0, pid=15880, name="nastran.exe"),
    )
    snapshot = [{"pid": 15880, "name": "nastran.exe", "create_time": 111.0}]

    killed = proctree.kill_survivors(snapshot, proc_factory=lambda pid: fake, timeout=0)

    assert fake.killed is True
    assert killed == [
        {"pid": 15880, "name": "nastran.exe", "create_time": 111.0, "terminated": False}
    ]


def test_kill_survivors_skips_reused_pid():
    # 같은 PID 지만 create_time 이 다르면 무관한 새 프로세스다 — 죽이면 사고다.
    fake = FakeProcess(pid=15880, create_time=999.0)
    snapshot = [{"pid": 15880, "name": "nastran.exe", "create_time": 111.0}]

    killed = proctree.kill_survivors(snapshot, proc_factory=lambda pid: fake)

    assert fake.killed is False
    assert killed == []


def test_kill_survivors_skips_already_exited_process():
    def factory(pid):
        raise psutil.NoSuchProcess(pid)

    snapshot = [{"pid": 15880, "name": "nastran.exe", "create_time": 111.0}]

    assert proctree.kill_survivors(snapshot, proc_factory=factory) == []


def test_kill_survivors_continues_after_access_denied():
    denied = FakeProcess(pid=1, create_time=1.0, raises=psutil.AccessDenied(1))
    allowed = FakeProcess(pid=2, create_time=2.0)
    snapshot = [
        {"pid": 1, "name": "protected.exe", "create_time": 1.0},
        {"pid": 2, "name": "nastran.exe", "create_time": 2.0},
    ]
    lookup = {1: denied, 2: allowed}

    killed = proctree.kill_survivors(snapshot, proc_factory=lambda pid: lookup[pid])

    # 하나가 실패해도 나머지 정리는 계속되어야 한다.
    assert allowed.killed is True
    assert [entry["pid"] for entry in killed] == [2]


def test_kill_survivors_never_touches_own_pid():
    # 호출부 실수로 감시 주체 자신의 PID 가 snapshot 에 섞여 들어와도
    # 절대 죽이지 않아야 한다 — L1 자살은 L2 가 복구할 때까지 감시 공백을 만든다.
    own_pid = os.getpid()
    fake = FakeProcess(pid=own_pid, create_time=123.0)
    snapshot = [{"pid": own_pid, "name": "python.exe", "create_time": 123.0}]

    killed = proctree.kill_survivors(snapshot, proc_factory=lambda pid: fake)

    assert fake.killed is False
    assert killed == []


def test_kill_survivors_terminates_a_real_child_process():
    # 위 테스트들은 전부 FakeProcess 대역이다 — create_time 대조와 종료 확인
    # 로직이 진짜 psutil.Process 객체에서도 동작하는지는 이 테스트만이 검증한다.
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        deadline = time.monotonic() + 5
        entries = []
        while time.monotonic() < deadline:
            entries = proctree.snapshot_tree(os.getpid())
            if any(entry["pid"] == child.pid for entry in entries):
                break
            time.sleep(0.1)

        matching = [entry for entry in entries if entry["pid"] == child.pid]
        assert matching, "실제 자식 프로세스가 snapshot_tree 에 잡혀야 한다"

        killed = proctree.kill_survivors(matching)
        assert len(killed) == 1
        assert killed[0]["pid"] == child.pid
        assert killed[0]["terminated"] is True

        # kill_survivors 의 확인과 별개로, OS 레벨에서도 실제 종료를 재확인한다.
        assert child.wait(timeout=5) is not None
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)
