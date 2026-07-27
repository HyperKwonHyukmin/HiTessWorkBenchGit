"""server_manager 배선(상태 머신) 테스트 — GUI 없이 헤드리스로 돌린다.

serverguard/ 6개 모듈에는 순수 로직 테스트가 있지만, 그것들을 '조합하는' 배선
(헬스 tick → 프로브 → 판정 → 강제 재시작 → 고아 정리 → 재기동)에는 테스트가
없었다. 여기서 잡는 결함들은 *상태가 언제 리셋되는가* 와 *이 결과가 어느
프로세스의 것인가* 에 대한 것이라, 어떤 순수 모듈 테스트로도 볼 수 없다.

server_manager.py 는 모듈 스코프에 상수·경로 탐색만 두고 Tk() 를 __main__ 아래
두었으므로 창 없이 import 된다. 이 파일은 __init__ 을 건너뛰고(object.__new__)
실제 메서드에 대역(root/subprocess/threading/serverguard)을 물려 상태 머신만
돌린다 — 실제 프로세스를 만들지 않고 실제 logs/ 에도 쓰지 않는다.
"""
import types

import pytest

import server_manager
from serverguard import health
from serverguard.backoff import RestartPolicy


# ── 대역(테스트 더블) ────────────────────────────────────────────────────
class FakeRoot:
    """tk.Tk 대역 — after() 예약을 실행하지 않고 기록만 한다.

    실행까지 하면 재시작 체인이 테스트 안에서 재귀로 돌아버린다. 예약 자체가
    관측 대상이므로 기록만으로 충분하다.
    """

    def __init__(self):
        self.after_calls = []

    def after(self, delay_ms, func=None, *args):
        self.after_calls.append((delay_ms, func, args))
        return f"timer-{len(self.after_calls)}"

    def scheduled(self, func):
        # 바운드 메서드는 접근할 때마다 새 객체라 `is` 로는 못 찾는다 —
        # `==` 는 (같은 함수, 같은 인스턴스) 를 비교하므로 이쪽이 맞다.
        return [call for call in self.after_calls if call[1] == func]


class FakeProc:
    """subprocess.Popen 대역."""

    def __init__(self, pid=4242, alive=True, stdout_lines=()):
        self.pid = pid
        self._alive = alive
        self.terminated = False
        self.killed = False
        self.stdout = iter(stdout_lines)

    def poll(self):
        return None if self._alive else 0

    def terminate(self):
        self.terminated = True
        self._alive = False

    def wait(self, timeout=None):
        self._alive = False
        return 0

    def kill(self):
        self.killed = True
        self._alive = False


class FakeThread:
    def __init__(self, target=None, args=(), daemon=None):
        self.target = target
        self.args = args
        self.daemon = daemon
        self.started = False

    def start(self):
        self.started = True


class ThreadRecorder:
    """server_manager.threading 대역 — 스레드를 만들지 않고 기록만 한다."""

    def __init__(self):
        self.threads = []

    def Thread(self, target=None, args=(), kwargs=None, daemon=None):
        thread = FakeThread(target=target, args=args, daemon=daemon)
        self.threads.append(thread)
        return thread


class EventRecorder:
    """serverguard.events 대역 — 실제 JSONL 을 건드리지 않는다."""

    def __init__(self):
        self.records = []

    def append_event(self, log_dir, src, event, detail=None, **kwargs):
        record = {"src": src, "event": event, "detail": detail or {}}
        self.records.append(record)
        return record

    def names(self):
        return [record["event"] for record in self.records]

    def detail(self, event):
        """해당 이벤트의 detail 하나를 돌려준다(없으면 실패시킨다)."""
        matches = [r["detail"] for r in self.records if r["event"] == event]
        assert matches, f"{event} 이벤트가 기록되지 않았다: {self.names()}"
        return matches[0]


class ProctreeRecorder:
    """serverguard.proctree 대역 — 실제 프로세스를 열거·종료하지 않는다."""

    def __init__(self, children=(), result=None, raises=None):
        self.children = list(children)
        self.result = result
        self.raises = raises
        self.snapshot_calls = []
        self.kill_calls = []

    def snapshot_tree(self, pid):
        self.snapshot_calls.append(pid)
        return list(self.children)

    def kill_survivors(self, snapshot):
        self.kill_calls.append(list(snapshot))
        if self.raises is not None:
            raise self.raises
        if self.result is not None:
            return list(self.result)
        return [{**entry, "terminated": True} for entry in snapshot]


class ManagerHarness:
    """대역을 물린 ServerManagerApp 인스턴스와 관측 결과 묶음."""

    def __init__(self, app, root, evt, tree, threads):
        self.app = app
        self.root = root
        self.events = evt
        self.proctree = tree
        self.threads = threads
        self.killed_ports = []
        self.logs = []
        self.running_states = []
        self.spawned = []
        self.popen_error = None

    def popen(self, *args, **kwargs):
        if self.popen_error is not None:
            raise self.popen_error
        proc = FakeProc(pid=1000 + len(self.spawned))
        self.spawned.append(proc)
        return proc


@pytest.fixture()
def harness(monkeypatch):
    app = object.__new__(server_manager.ServerManagerApp)

    root = FakeRoot()
    evt = EventRecorder()
    tree = ProctreeRecorder()
    threads = ThreadRecorder()
    hz = ManagerHarness(app, root, evt, tree, threads)

    app.root = root
    app.server_proc = None
    app.is_updating = False
    app.intentional_stop = False
    app.restart_history = []
    app.health_tracker = health.HealthTracker()
    app.restart_policy = RestartPolicy()
    app.uvicorn_log = types.SimpleNamespace(write=lambda line: None, close=lambda: None)

    # GUI 대역 — 위젯이 없으므로 인스턴스 속성으로 가린다.
    app._log = lambda message, tag="info": hz.logs.append((tag, message))
    app._set_running = lambda running: hz.running_states.append(running)
    # 되돌릴 수 없는 부작용 — 실제 개발 백엔드(포트 9091)를 건드리면 안 된다.
    app._kill_port = lambda port: hz.killed_ports.append(port)

    monkeypatch.setattr(server_manager, "events", evt)
    monkeypatch.setattr(server_manager, "proctree", tree)
    monkeypatch.setattr(server_manager, "diagnostics",
                        types.SimpleNamespace(collect=lambda uvicorn_pid=None: {"cpu": 0.0}))
    monkeypatch.setattr(server_manager, "threading", threads)
    monkeypatch.setattr(server_manager, "subprocess", types.SimpleNamespace(
        Popen=hz.popen,
        PIPE=-1, STDOUT=-2, CREATE_NO_WINDOW=0,
        TimeoutExpired=TimeoutError,
    ))
    return hz


def fail_n(tracker, count, *, start=100.0):
    """연속 실패를 count 회 기록한다."""
    for i in range(count):
        tracker.record(False, now=start + i)


# ── I1. 헬스 상태가 재시작을 넘어 이월되면 안 된다 ──────────────────────
def test_start_server_resets_health_tracker(harness):
    """RESTART_DELAY_MS(3초) 는 HEALTH_INTERVAL_MS(15초) 보다 짧다 — 사망·재기동이
    두 tick 사이에 통째로 들어가는 것이 통례다. 그때 streak 이 이월되면 다음
    한 번의 실패로 임계(12)를 넘어, 아직 부팅 중인 정상 서버를 좀비로 오판해
    사살하고 "last_ok: null" 이라는 거짓 진단까지 남긴다."""
    fail_n(harness.app.health_tracker, 11)
    assert harness.app.health_tracker.fail_streak == 11

    harness.app._start_server()

    assert harness.app.health_tracker.fail_streak == 0
    assert harness.app.health_tracker.state == health.HEALTHY
    assert harness.app.health_tracker.last_ok_at is None


# ── I2-a. 스테일 프로브 결과는 조용히 버린다 ────────────────────────────
def test_stale_health_result_does_not_touch_tracker(harness):
    """프로브(타임아웃 5초)가 도는 사이 대상이 죽고 새 프로세스가 떴다면, 뒤늦게
    도착한 결과는 '지난' 프로세스의 것이다. 반영하면 새 프로세스의 streak 을
    올려 유령 좀비 재시작을 부른다."""
    old_proc = FakeProc(pid=111)
    new_proc = FakeProc(pid=222)
    harness.app.server_proc = new_proc
    fail_n(harness.app.health_tracker, 11)

    harness.app._on_health_result(False, old_proc)

    assert harness.app.health_tracker.fail_streak == 11
    # 흔한 레이스지 이상 징후가 아니다 — 이벤트를 남기지 않는다.
    assert harness.events.names() == []


def test_health_tick_binds_probe_to_the_process_it_observed(harness):
    """tick 이 관측 대상을 캡처해 프로브·콜백까지 끌고 가야 위 가드가 성립한다."""
    proc = FakeProc(pid=333)
    harness.app.server_proc = proc

    harness.app._health_tick()

    [thread] = [t for t in harness.threads.threads if t.target == harness.app._probe_health]
    assert thread.args == (proc,)


# ── 양성 대조: 프로브 실패가 실제로 감지·재시작까지 이어진다 ───────────
# 아래 두 테스트가 없으면 _on_health_result 를 첫 줄 return 으로 통째로 무력화해도
# 스위트가 초록이다 — 다른 테스트는 전부 '거부당하는' 음성 방향이거나
# _force_restart_zombie 를 직접 호출하기 때문이다.
def test_repeated_probe_failures_escalate_to_zombie_detection(harness):
    proc = FakeProc(pid=200)
    harness.app.server_proc = proc

    for _ in range(health.ZOMBIE_THRESHOLD - 1):
        harness.app._on_health_result(False, proc)

    # 임계 직전: 관찰 중이라고 알리되 아직 아무것도 죽이지 않는다.
    assert "health_degraded" in harness.events.names()
    assert "zombie_detected" not in harness.events.names()
    assert harness.killed_ports == []

    harness.app._on_health_result(False, proc)          # 임계 도달

    # 재시작을 촉발한 streak 은 '기록' 에 남아야 하고, 트래커 자신은 그 결정보다
    # 오래 살면 안 된다(:475 의 reset — 아래 zombie_abort 테스트와 같은 불변식).
    assert harness.events.detail("zombie_detected")["fail_streak"] == health.ZOMBIE_THRESHOLD
    assert harness.app.health_tracker.fail_streak == 0
    assert "zombie_detected" in harness.events.names()
    assert "restart_begin" in harness.events.names()
    assert proc.terminated is True
    assert harness.killed_ports == [9091]
    assert harness.root.scheduled(harness.app._zombie_restart_fire)


def test_recovery_records_health_recovered_and_resets_restart_policy(harness):
    proc = FakeProc(pid=201)
    harness.app.server_proc = proc
    # 이전 크래시로 예산을 쓰고 백오프가 올라간 상태를 만든다.
    harness.app.restart_policy.record_attempt(1.0)
    harness.app.restart_policy.backoff_level = 2

    harness.app._on_health_result(False, proc)          # HEALTHY → SUSPECT
    harness.app._on_health_result(True, proc)           # SUSPECT → HEALTHY

    assert "health_recovered" in harness.events.names()
    # record_success() 가 실제로 반영되어야 한다 — 안 그러면 일시적 장애 이후에도
    # 백오프가 계속 누적돼 다음 크래시의 재시도가 불필요하게 밀린다.
    assert harness.app.restart_policy.history == []
    assert harness.app.restart_policy.backoff_level == 0


# ── I2-b. 이미 죽은 대상에게 강제 재시작을 실행하지 않는다 ──────────────
def test_force_restart_zombie_aborts_when_target_already_dead(harness):
    """되돌릴 수 없는 부작용(kill_survivors, _kill_port)을 실행하기 직전이므로
    대상 검증이 함수 첫 줄에 있어야 한다. 죽은 PID 로 진행하면 Windows 의 PID
    재사용 때문에 무관한 프로세스의 자식을 열거해 죽일 수 있다 —
    크래시 경로가 :330-331 주석에서 의도적으로 거부한 바로 그 위험이다."""
    dead = FakeProc(pid=444, alive=False)
    harness.app.server_proc = dead
    # 자손이 잡히는 상황이어야 kill_survivors 미호출 단언이 공허해지지 않는다.
    harness.proctree.children = [{"pid": 1, "name": "nastran.exe", "create_time": 1.0}]
    fail_n(harness.app.health_tracker, 12)

    harness.app._force_restart_zombie()

    assert harness.proctree.kill_calls == []
    assert harness.killed_ports == []
    assert "zombie_abort" in harness.events.names()
    assert harness.events.detail("zombie_abort")["reason"] == "process_already_dead"
    # 죽은 대상에 대한 좀비 진단은 사실이 아니다 — 남기면 안 된다.
    assert "zombie_detected" not in harness.events.names()
    assert harness.app.health_tracker.fail_streak == 0


# ── I3. intentional_stop 은 '사용자 의도' 전용이다 ──────────────────────
def test_force_restart_zombie_leaves_intentional_stop_clear(harness):
    """여기서 플래그를 빌려 쓰면 좀비 재시작 후 True 로 잔류해 '사용자가 멈췄다'고
    거짓말한다. Task 9 의 백오프 재시도 콜백이 그 플래그를 읽으면 영구 정지가
    된다 — 플래그를 지우는 곳이 _start_server 뿐인데 거부당하는 대상이 바로
    그 _start_server 이기 때문이다."""
    harness.app.server_proc = FakeProc(pid=555)
    fail_n(harness.app.health_tracker, 12)

    harness.app._force_restart_zombie()

    assert harness.app.intentional_stop is False


# ── I4/I5. 일어나지 않은 재시작을 사실로 단언하지 않는다 ────────────────
def test_zombie_restart_fire_does_not_claim_restart_done_on_start_failure(harness):
    """venv 가 옮겨졌거나 백신에 격리된 장비에서 서버는 안 떴는데 JSONL 이
    zombie_detected → restart_begin → restart_done 을 보여주면, 이 2계층 설계의
    산출물(사후 원인 분석)이 통째로 거짓이 된다."""
    harness.popen_error = FileNotFoundError("python.exe 없음")

    harness.app._zombie_restart_fire()

    assert "restart_done" not in harness.events.names()
    assert "server_start_failed" in harness.events.names()
    assert "FileNotFoundError" in harness.events.detail("server_start_failed")["error"]


def test_start_server_reports_failure_for_non_filenotfound_oserror(harness):
    """PermissionError 등은 지금 root.after 콜백 밖으로 나가 tkinter 핸들러로 가고,
    콘솔 없는 GUI 앱에선 아무 데도 남지 않은 채 재시작 체인이 끊긴다."""
    harness.popen_error = PermissionError("접근 거부")

    assert harness.app._start_server() is False
    assert "PermissionError" in harness.events.detail("server_start_failed")["error"]


def test_start_server_returns_true_on_success_and_when_already_running(harness):
    assert harness.app._start_server() is True
    # 이미 살아있는 경우의 early return — "호출 후 서버가 떠 있다"는 사실은 참이다.
    assert harness.app._start_server() is True
    assert len(harness.spawned) == 1


def test_zombie_restart_fire_records_restart_done_on_success(harness):
    harness.app._zombie_restart_fire()

    assert "restart_done" in harness.events.names()
    assert harness.events.detail("restart_done")["reason"] == "zombie"


def test_zombie_restart_fire_records_skip_when_updating(harness):
    """restart_begin 의 짝이 없으면 분석자는 '업데이트 중이라 건너뜀' 과
    '매니저 자신이 재시작 도중 죽음' 을 구분할 수 없다."""
    harness.app.is_updating = True

    harness.app._zombie_restart_fire()

    assert harness.events.detail("restart_skipped")["reason"] == "updating"
    assert "restart_done" not in harness.events.names()
    assert harness.spawned == []


def test_zombie_restart_fire_records_skip_when_already_running(harness):
    harness.app.server_proc = FakeProc(pid=666)

    harness.app._zombie_restart_fire()

    assert harness.events.detail("restart_skipped")["reason"] == "already_running"
    assert "restart_done" not in harness.events.names()
    assert harness.spawned == []


# ── M1. last_ok_at = 0.0 이 "한 번도 응답 없음" 으로 뭉개지면 안 된다 ───
def test_zombie_snapshot_keeps_epoch_zero_last_ok(harness):
    """테스트 시계는 관례상 0 에서 시작하고 HealthTracker 는 L2(Task 11)와
    공유된다. 0.0 을 null 로 기록하면 사실의 정반대를 남긴다."""
    harness.app.server_proc = FakeProc(pid=777)
    harness.app.health_tracker.record(True, now=0.0)
    fail_n(harness.app.health_tracker, 12, start=1.0)

    harness.app._force_restart_zombie()

    # None 이 아닌 것에 더해, 변환 자체가 터지지 않아야 한다 — naive datetime 의
    # astimezone() 은 Windows 에서 epoch 직후 하루 구간에 OSError 를 던진다
    # (실측/KST: t < 86400 전부 실패). tz 를 주는 경로여야만 통과한다.
    last_ok = harness.events.detail("zombie_detected")["last_ok"]
    assert last_ok is not None
    assert last_ok.startswith("1970-01-01")


def test_zombie_snapshot_reports_null_when_never_ok(harness):
    harness.app.server_proc = FakeProc(pid=778)
    fail_n(harness.app.health_tracker, 12)

    harness.app._force_restart_zombie()

    assert harness.events.detail("zombie_detected")["last_ok"] is None


# ── M2/M3. 프로세스 정체성은 인자로 넘긴다 ──────────────────────────────
def test_on_server_exit_requires_proc_argument(harness):
    """기본값이 있으면 미변환 호출자가 가드를 조용히 끈다 — 그 실수는
    TypeError 로 시끄럽게 터져야지 '조용하지만 틀린 크래시 진단' 이 되면 안 된다."""
    with pytest.raises(TypeError):
        harness.app._on_server_exit()


def test_stale_exit_notification_after_zombie_restart_is_ignored(harness):
    """_on_server_exit 의 identity 가드 자체를 고정한다.

    I3(intentional_stop 삭제)의 안전성 논거 전체가 이 가드 위에 서 있다 —
    "이 종료의 크래시 오판은 identity 가드가 막는다" 는 주석이 참이어야만
    플래그를 지운 것이 안전하다. 다른 테스트들은 '플래그가 False 로 남는다'는
    *결과* 만 고정하고, '스테일 종료 통지가 실제로 걸러진다'는 *전제* 는
    고정하지 않는다. 여기서 전제를 직접 관측한다.
    """
    old_proc = FakeProc(pid=100)
    harness.app.server_proc = old_proc
    fail_n(harness.app.health_tracker, 12)

    harness.app._force_restart_zombie()      # old_proc 를 내리고 server_proc=None
    harness.app._zombie_restart_fire()       # 새 프로세스 기동
    new_proc = harness.spawned[-1]
    assert harness.app.server_proc is new_proc

    running_before = len(harness.running_states)
    # 스트리밍 스레드의 EOF 감지가 늦어 '지난' 프로세스의 종료 통지가 이제 도착.
    harness.app._on_server_exit(old_proc)

    # 허위 크래시 기록도, 재시작 예산 소모도, UI 흔들림도 없어야 한다.
    assert "crash_detected" not in harness.events.names()
    assert harness.root.scheduled(harness.app._auto_restart_fire) == []
    assert len(harness.running_states) == running_before


def test_exit_notification_from_the_live_process_is_treated_as_crash(harness):
    """가드의 반대 방향 — 현재 프로세스의 종료는 반드시 크래시로 처리해야 한다.
    (가드를 `return` 하나로 바꾸면 위 테스트만으로는 안 잡힌다.)"""
    proc = FakeProc(pid=101)
    harness.app.server_proc = proc

    harness.app._on_server_exit(proc)

    assert "crash_detected" in harness.events.names()
    assert harness.root.scheduled(harness.app._auto_restart_fire)
    assert harness.running_states[-1] is False


def test_start_server_hands_the_new_process_to_stream_output(harness):
    """캡처가 스레드 시작 '이후' 면 레이스 창이 열린다 — 인자로 넘기면
    불변식이 논증 대상이 아니라 지역 사실이 된다."""
    harness.app._start_server()

    [thread] = [t for t in harness.threads.threads if t.target == harness.app._stream_output]
    assert thread.args == (harness.spawned[0],)


def test_stream_output_notifies_exit_with_its_own_process(harness):
    """스레드는 self.server_proc 가 아니라 '인자로 받은 자기 프로세스' 를 알려야
    한다. server_proc 에 같은 객체를 넣어두면 그 불변식이 관측 불가능해지므로
    (스레드가 도는 사이 좀비 재시작이 일어난 상황 그대로) 다른 객체를 둔다."""
    proc = FakeProc(pid=888, stdout_lines=["INFO: Application startup complete"])
    harness.app.server_proc = FakeProc(pid=999)

    harness.app._stream_output(proc)

    assert harness.root.scheduled(harness.app._on_server_exit)[-1][2] == (proc,)


# ── M5. kill_survivors 계약 위반을 unconfirmed 로 위장하지 않는다 ───────
def test_cleanup_orphans_logs_contract_violation_instead_of_faking_unconfirmed(harness):
    """proctree 는 항목에 필수 키가 없으면 KeyError 를 의도적으로 전파한다.
    .get() 으로 받으면 그 회귀가 '종료 확인 실패' 로 위장돼 조용히 묻힌다.
    단, 예외가 _cleanup_orphans 밖으로 나가면 재시작이 중단된다 — 이 래퍼가
    존재하는 이유가 그것이므로 기록하고 계속 진행해야 한다."""
    harness.proctree.result = [{"pid": 1, "name": "nastran.exe", "create_time": 1.0}]

    harness.app._cleanup_orphans([{"pid": 1, "name": "nastran.exe", "create_time": 1.0}])

    assert "orphan_cleanup_failed" in harness.events.names()
    assert "KeyError" in harness.events.detail("orphan_cleanup_failed")["error"]
    assert "orphan_killed" not in harness.events.names()


def test_cleanup_orphans_records_unconfirmed_survivors(harness):
    """정상 계약(terminated 키가 있는 경우)은 그대로 동작해야 한다."""
    harness.proctree.result = [
        {"pid": 1, "name": "nastran.exe", "create_time": 1.0, "terminated": True},
        {"pid": 2, "name": "Cmb.Cli.exe", "create_time": 2.0, "terminated": False},
    ]

    harness.app._cleanup_orphans([{"pid": 1}, {"pid": 2}])

    detail = harness.events.detail("orphan_killed")
    assert detail["attempted"] == 2
    assert detail["terminated"] == 1
    assert [entry["pid"] for entry in detail["unconfirmed"]] == [2]


def test_force_restart_zombie_continues_when_cleanup_fails(harness):
    """정리 실패가 재시작 자체를 막아서는 안 된다 — 서버가 안 뜨는 것이
    라이선스가 물린 것보다 나쁘다."""
    harness.app.server_proc = FakeProc(pid=999)
    harness.proctree.children = [{"pid": 1, "name": "nastran.exe", "create_time": 1.0}]
    harness.proctree.raises = RuntimeError("psutil 폭발")
    fail_n(harness.app.health_tracker, 12)

    harness.app._force_restart_zombie()

    assert "orphan_cleanup_failed" in harness.events.names()
    assert harness.killed_ports == [9091]
    assert harness.root.scheduled(harness.app._zombie_restart_fire)
