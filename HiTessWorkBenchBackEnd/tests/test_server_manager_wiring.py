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
from serverguard import backoff, health
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

    def __init__(self, pid=4242, alive=True, stdout_lines=(), terminate_raises=None):
        self.pid = pid
        self._alive = alive
        self.terminated = False
        self.killed = False
        self.stdout = iter(stdout_lines)
        # Windows TerminateProcess 가 드물게 PermissionError 를 내는 상황을 흉내낸다.
        self._terminate_raises = terminate_raises

    def poll(self):
        return None if self._alive else 0

    def terminate(self):
        if self._terminate_raises is not None:
            raise self._terminate_raises
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


class FakeClock:
    """server_manager.time 대역 — 백오프 판정을 결정적으로 만든다.

    백오프는 '지금'과 wait_until 의 대소로 갈리므로 실제 시계로는 10~60분짜리
    대기 구간을 넘어갈 수 없다. monotonic 과 time 을 같은 값으로 준다 —
    server_manager 는 예산에 monotonic, 사람이 읽는 기록에 time 을 쓴다.
    """

    def __init__(self, start=1000.0):
        self.now = start

    def monotonic(self):
        return self.now

    def time(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


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


def install_clock(monkeypatch, start=1000.0):
    """server_manager 의 시계를 대역으로 바꾼다."""
    clock = FakeClock(start)
    monkeypatch.setattr(server_manager, "time", clock)
    return clock


def exhaust_budget(policy, clock):
    """창 안의 재시작 예산을 소진시킨다 — 다음 크래시가 "wait" 가 되도록.

    on_crash 가 아니라 record_attempt 로 세팅한다. on_crash 로 채우면 이
    헬퍼 자신이 검증 대상(예약·이벤트)을 오염시킨다.
    """
    for _ in range(backoff.MAX_RESTARTS_IN_WINDOW):
        policy.record_attempt(clock.monotonic())


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


def test_force_restart_zombie_survives_terminate_failure(harness):
    """종료 실패가 좀비 복구를 '영구 정지' 시키면 안 된다.

    restart_begin 과 재시작 예약 사이에서 예외가 새어 나가면 :475 의 reset() 이
    실행되지 않아 state 가 ZOMBIE 로 남는다. HealthTracker.record 는 전이 시에만
    changed=True 를 주므로, 이후 모든 실패가 changed=False → _force_restart_zombie
    가 다시는 발화하지 않는다. 덤으로 restart_begin 이 짝 없이 남아 I5 가
    없애려던 모호성이 그대로 재현된다. 확률은 낮지만 결과가 '무인 복구 영구
    정지' 라 이 기능의 존재 이유와 정면 충돌한다.

    종료에 실패했어도 고아 정리·포트 해제·리셋·재시작 예약은 전부 실행되어야
    한다 — 그게 이 함수가 하려던 일이다(catch-and-continue).
    """
    proc = FakeProc(pid=303, terminate_raises=PermissionError("액세스가 거부되었습니다"))
    harness.app.server_proc = proc
    harness.proctree.children = [{"pid": 1, "name": "nastran.exe", "create_time": 1.0}]
    fail_n(harness.app.health_tracker, health.ZOMBIE_THRESHOLD)

    harness.app._force_restart_zombie()

    assert "terminate_failed" in harness.events.names()
    assert "PermissionError" in harness.events.detail("terminate_failed")["error"]
    # 영구 정지 방지 — 다음 좀비도 반드시 다시 감지되어야 한다.
    assert harness.app.health_tracker.fail_streak == 0
    assert harness.app.health_tracker.state == health.HEALTHY
    # 나머지 복구 시퀀스가 전부 실행됐는가.
    assert harness.proctree.kill_calls, "고아 정리가 실행되어야 한다"
    assert harness.killed_ports == [9091]
    assert harness.root.scheduled(harness.app._zombie_restart_fire)


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


# ── Task 9. 예산 소진은 '영구 정지' 가 아니라 '더 긴 대기' 다 ────────────
def test_crash_within_budget_restarts_promptly(harness, monkeypatch):
    """예산이 남아 있는 동안은 예전과 똑같이 즉시(3초 후) 재시작해야 한다 —
    백오프는 반복 실패에만 걸리는 벌칙이지 상시 지연이 아니다."""
    install_clock(monkeypatch)

    harness.app._schedule_auto_restart()

    [(delay_ms, _, _)] = harness.root.scheduled(harness.app._auto_restart_fire)
    assert delay_ms == server_manager.RESTART_DELAY_MS
    assert "backoff_wait" not in harness.events.names()


def test_exhausted_budget_backs_off_instead_of_giving_up(harness, monkeypatch):
    """예산을 소진해도 재시작을 포기하면 안 된다.

    영구 포기 상태에서도 이 GUI 프로세스(L1)는 살아 있어서 L2 워치독이 개입하지
    않는다 — 서버가 죽은 채 아무도 살리지 않는 상태가 사람이 Start 를 누를
    때까지 무한정 이어진다. '완전 무인 복구' 라는 이 기능의 존재 이유와 정면
    충돌한다.
    """
    clock = install_clock(monkeypatch)
    exhaust_budget(harness.app.restart_policy, clock)

    harness.app._schedule_auto_restart()

    detail = harness.events.detail("backoff_wait")
    assert detail["delay_sec"] == backoff.BACKOFF_STEPS_SEC[0]
    assert detail["level"] == 1
    assert detail["reason"] == "crash"
    [(delay_ms, _, _)] = harness.root.scheduled(harness.app._auto_restart_fire)
    assert delay_ms == backoff.BACKOFF_STEPS_SEC[0] * 1000


def test_backoff_escalates_then_stays_at_the_cap_forever(harness, monkeypatch):
    """단계는 올라가되 마지막에서 상한에 머문다 — 예약은 매번 반드시 남는다.

    '예약이 하나도 없는 크래시' 가 곧 영구 정지다. 상한 이후에도 계속 예약이
    나온다는 사실이 이 Task 의 핵심 단언이다.
    """
    clock = install_clock(monkeypatch)
    rounds = len(backoff.BACKOFF_STEPS_SEC) + 2      # 상한 도달 후 2회 더

    delays_ms = []
    for _ in range(rounds):
        exhaust_budget(harness.app.restart_policy, clock)
        harness.root.after_calls.clear()

        harness.app._schedule_auto_restart()

        scheduled = harness.root.scheduled(harness.app._auto_restart_fire)
        assert scheduled, "예약이 사라진 순간이 곧 영구 정지다"
        delays_ms.append(scheduled[-1][0])
        clock.advance(delays_ms[-1] / 1000)          # 대기가 끝난 시점으로 이동

    cap_ms = backoff.BACKOFF_STEPS_SEC[-1] * 1000
    assert delays_ms == [step * 1000 for step in backoff.BACKOFF_STEPS_SEC] + [cap_ms, cap_ms]
    assert len([r for r in harness.events.records if r["event"] == "backoff_wait"]) == rounds


def test_crash_budget_is_counted_once_per_crash(harness, monkeypatch):
    """on_crash 가 "go" 직전에 스스로 record_attempt 를 부른다 — 호출부에서 또
    부르면 이중 카운트로 예산이 절반이 된다(Task 3 에서 실제로 났던 버그)."""
    install_clock(monkeypatch)

    for _ in range(backoff.MAX_RESTARTS_IN_WINDOW):
        harness.app._schedule_auto_restart()

    assert "backoff_wait" not in harness.events.names()
    scheduled = harness.root.scheduled(harness.app._auto_restart_fire)
    assert len(scheduled) == backoff.MAX_RESTARTS_IN_WINDOW
    assert {call[0] for call in scheduled} == {server_manager.RESTART_DELAY_MS}

    # 반대 방향 — 예산이 실제로 세어지긴 해야 한다(한 칸 더 쓰면 백오프).
    harness.app._schedule_auto_restart()
    assert "backoff_wait" in harness.events.names()


def test_auto_restart_fire_records_restart_done_on_success(harness):
    harness.app._auto_restart_fire()

    assert harness.events.detail("restart_done")["reason"] == "crash"
    assert len(harness.spawned) == 1


def test_auto_restart_fire_does_not_claim_restart_done_on_start_failure(harness):
    """좀비 경로(I4/I5)와 같은 불변식 — 뜨지도 않은 서버를 성공으로 기록하면
    사후 분석 로그가 거짓을 말한다."""
    harness.popen_error = FileNotFoundError("python.exe 없음")

    harness.app._auto_restart_fire()

    assert "restart_done" not in harness.events.names()
    assert "server_start_failed" in harness.events.names()


# ── Task 9 후속. 시작 실패도 재예약해야 한다 (마지막 영구 정지 경로) ────
# _start_server 가 OSError 로 실패하면 Popen 이 없어 _stream_output·_on_server_exit
# 이 영영 오지 않는다 — 아무도 재예약하지 않는데 L1 GUI 는 살아 있으니 L2 도
# 개입하지 않는다. Task 9 가 없애겠다고 선언한 바로 그 상태다.
def test_auto_restart_fire_reschedules_when_start_fails(harness, monkeypatch):
    """venv 이동·백신 격리로 Popen 이 실패하면 크래시 체인이 기록만 남기고 끊긴다."""
    install_clock(monkeypatch)
    harness.popen_error = FileNotFoundError("python.exe 없음")

    harness.app._auto_restart_fire()

    assert "server_start_failed" in harness.events.names()
    assert "restart_done" not in harness.events.names()
    [(delay_ms, _, _)] = harness.root.scheduled(harness.app._auto_restart_fire)
    assert delay_ms == server_manager.RESTART_DELAY_MS


def test_zombie_restart_fire_reschedules_when_start_fails(harness, monkeypatch):
    """좀비 경로도 같다. 단 재예약 대상은 반드시 좀비 경로여야 한다 —
    크래시 경로로 갈아타면 restart_begin 의 짝(restart_done{zombie})을 잃는다."""
    install_clock(monkeypatch)
    harness.popen_error = PermissionError("접근 거부")

    harness.app._zombie_restart_fire()

    assert "server_start_failed" in harness.events.names()
    assert "restart_done" not in harness.events.names()
    [(delay_ms, _, _)] = harness.root.scheduled(harness.app._zombie_restart_fire)
    assert delay_ms == server_manager.RESTART_DELAY_MS
    assert harness.root.scheduled(harness.app._auto_restart_fire) == []


def test_repeated_start_failures_end_in_backoff_not_silence(harness, monkeypatch):
    """재예약이 3초마다 영원히 도는 것도 답이 아니다. Popen 실패는 즉시 반환되므로
    예산이 60초 창 안에서 소진되고 그 뒤로는 백오프가 받는다 — 바운드돼 있고
    절대 포기하지 않는다."""
    install_clock(monkeypatch)
    harness.popen_error = FileNotFoundError("python.exe 없음")

    harness.app._schedule_auto_restart()           # 크래시 감지 → 1회차 예약
    fires = backoff.MAX_RESTARTS_IN_WINDOW         # 발화할 때마다 Popen 즉시 실패
    for _ in range(fires):
        harness.app._auto_restart_fire()

    # 어느 시점에도 '침묵' 이 없다 — 매 실패가 반드시 다음 예약을 낳았다.
    assert len(harness.root.scheduled(harness.app._auto_restart_fire)) == fires + 1
    detail = harness.events.detail("backoff_wait")
    assert detail["reason"] == "crash"
    assert detail["delay_sec"] == backoff.BACKOFF_STEPS_SEC[0]
    assert harness.root.scheduled(harness.app._auto_restart_fire)[-1][0] == \
        backoff.BACKOFF_STEPS_SEC[0] * 1000


def test_manual_start_resets_budget_and_backoff(harness):
    """사용자가 직접 Start → 깨끗한 예산으로 재개한다. backoff_level·wait_until 을
    남겨두면 사람이 원인을 고치고 눌러도 다음 크래시가 60분 대기로 직행한다."""
    harness.app.restart_policy.record_attempt(1.0)
    harness.app.restart_policy.backoff_level = 3
    harness.app.restart_policy.wait_until = 10_000.0

    harness.app._toggle_server()

    assert harness.app.restart_policy.history == []
    assert harness.app.restart_policy.backoff_level == 0
    assert harness.app.restart_policy.wait_until == 0.0
    assert len(harness.spawned) == 1, "수동 Start 는 실제로 서버를 띄워야 한다"


# ── Task 9 / Step 6. 좀비 재시작도 같은 예산을 쓴다 ──────────────────────
def test_repeated_zombie_restarts_consume_budget_and_back_off(harness, monkeypatch):
    """좀비 재시작도 같은 예산을 **소모한다**는 것을 고정한다.

    ⚠ 이 테스트가 고정하는 것은 "좀비 재시작이 예산을 쓴다" 이지 "좀비 루프가
    억제된다" 가 아니다. 시계를 고정해 6회를 한 창에 몰아넣은 것은 **인위적
    배치**다 — 실제 좀비 한 사이클은 12프로브×15초 = 최소 3분이라
    RESTART_WINDOW_SEC(60초) 창에 둘 이상 들어갈 수 없다. 순수 좀비 루프는
    백오프에 걸리지 않고 3분 주기를 유지하며, 그건 의도된 수용이다(무인 복구
    속도 우선 — 3분 재시도는 원인이 해소되는 즉시 복귀하지만 60분 대기는
    그렇지 않다). 그 사실 자체는 아래
    test_realistic_zombie_cadence_never_reaches_backoff 가 고정한다.

    이 예산이 실제로 발동하는 건 크래시와 섞였을 때다 —
    test_zombie_restart_makes_the_next_crash_burst_hit_the_wall_sooner 참조.
    """
    install_clock(monkeypatch)

    for i in range(backoff.MAX_RESTARTS_IN_WINDOW):
        harness.app.server_proc = FakeProc(pid=800 + i)
        harness.app._force_restart_zombie()

    assert "backoff_wait" not in harness.events.names()

    harness.app.server_proc = FakeProc(pid=899)
    harness.app._force_restart_zombie()

    detail = harness.events.detail("backoff_wait")
    assert detail["reason"] == "zombie", "어느 경로가 대기 중인지 구분할 수 있어야 한다"
    assert detail["delay_sec"] == backoff.BACKOFF_STEPS_SEC[0]
    # 대기 후에도 좀비 경로로 돌아와야 한다 — restart_begin 의 짝(restart_done
    # {reason: zombie})을 남기는 쪽은 _zombie_restart_fire 뿐이다.
    assert harness.root.scheduled(harness.app._zombie_restart_fire)[-1][0] == \
        backoff.BACKOFF_STEPS_SEC[0] * 1000
    assert harness.root.scheduled(harness.app._auto_restart_fire) == []


def test_zombie_and_crash_share_one_restart_budget(harness, monkeypatch):
    """두 경로가 **하나의** 예산을 본다 — 경로별 카운터는 서로의 소모를 못 봐
    예산을 사실상 2배로 만든다. 그 불변식 자체를 고정한다.

    ⚠ 단, 여기 쓴 순서(크래시 4회 → 좀비)는 **실제로는 일어날 수 없다.** 좀비
    판정은 새 프로세스가 뜬 뒤 12프로브×15초 = 최소 3분이 지나야 나오는데,
    그 프로세스보다 앞선 크래시 기록은 그 시점에 이미 60초 창 밖이라 전부
    걷힌다. 시계를 고정했기 때문에 성립하는 배치다.

    실제로 도달 가능한 혼합 방향은 그 반대다(좀비 → 뒤이은 크래시 연발) —
    test_zombie_restart_makes_the_next_crash_burst_hit_the_wall_sooner 가
    그쪽을 고정한다. 이 테스트는 "예산이 하나"라는 배선만 본다.
    """
    install_clock(monkeypatch)

    for _ in range(backoff.MAX_RESTARTS_IN_WINDOW - 1):
        harness.app._schedule_auto_restart()
    assert "backoff_wait" not in harness.events.names()

    # 예산의 마지막 한 칸을 좀비가 쓴다.
    harness.app.server_proc = FakeProc(pid=910)
    harness.app._force_restart_zombie()
    assert "backoff_wait" not in harness.events.names()
    assert harness.root.scheduled(harness.app._zombie_restart_fire)[-1][0] == \
        server_manager.RESTART_DELAY_MS

    # 크래시가 쓴 4칸을 좀비도 본다 → 여기서 바로 백오프여야 한다.
    harness.app.server_proc = FakeProc(pid=911)
    harness.app._force_restart_zombie()
    assert harness.events.detail("backoff_wait")["reason"] == "zombie"


def test_realistic_zombie_cadence_never_reaches_backoff(harness, monkeypatch):
    """순수 좀비 루프는 백오프에 걸리지 않는다 — 의도된 수용을 고정한다.

    좀비 한 사이클(≥3분)이 예산 창(60초)보다 길어서 기록이 매번 걷힌다. 이걸
    '고쳐야 할 결함' 으로 오해하지 않도록, 그리고 나중에 누가 창을 늘렸을 때
    조용히 뒤집히지 않도록 여기서 사실로 못 박는다. 3분 재시도는 원인이
    해소되는 즉시 복귀하므로 무인 복구 목표에는 오히려 부합한다.
    """
    clock = install_clock(monkeypatch)
    cycle_sec = health.ZOMBIE_THRESHOLD * health.CHECK_INTERVAL_SEC   # 12 × 15 = 180초
    # 이 전제가 깨지면 아래 결론도 뒤집힌다 — 결론보다 전제가 먼저 터져야 한다.
    assert cycle_sec > backoff.RESTART_WINDOW_SEC

    for i in range(backoff.MAX_RESTARTS_IN_WINDOW * 3):
        harness.app.server_proc = FakeProc(pid=700 + i)
        harness.app._force_restart_zombie()
        clock.advance(cycle_sec)

    assert "backoff_wait" not in harness.events.names()
    assert harness.app.restart_policy.backoff_level == 0
    # 그럼에도 매번 재시작 예약은 나온다 — 3분마다 계속 살리려 시도한다.
    assert len(harness.root.scheduled(harness.app._zombie_restart_fire)) == \
        backoff.MAX_RESTARTS_IN_WINDOW * 3


def test_zombie_restart_makes_the_next_crash_burst_hit_the_wall_sooner(harness, monkeypatch):
    """예산 공유가 실제로 값을 하는 유일한 방향 — 좀비가 쓴 칸을 뒤이은 크래시가 본다.

    좀비 재시작으로 띄운 프로세스가 곧바로 연속 크래시하는 상황은 3초 간격이라
    전부 한 창에 들어간다. 좀비가 이미 한 칸을 썼으므로 크래시는 5회가 아니라
    4회 만에 벽에 닿는다 — 이것이 '나쁜 상태의 서버를 통합해서 본다' 의 실체다.
    """
    clock = install_clock(monkeypatch)
    harness.app.server_proc = FakeProc(pid=920)
    harness.app._force_restart_zombie()          # 예산 1칸 소모

    # 좀비 재시작으로 뜬 프로세스가 3초 간격으로 연속 크래시한다.
    for _ in range(backoff.MAX_RESTARTS_IN_WINDOW - 1):
        clock.advance(server_manager.RESTART_DELAY_MS / 1000)
        harness.app._schedule_auto_restart()
    assert "backoff_wait" not in harness.events.names()

    clock.advance(server_manager.RESTART_DELAY_MS / 1000)
    harness.app._schedule_auto_restart()

    # 좀비가 쓴 칸이 없었다면 이 크래시는 아직 "go" 였다.
    assert harness.events.detail("backoff_wait")["reason"] == "crash"
