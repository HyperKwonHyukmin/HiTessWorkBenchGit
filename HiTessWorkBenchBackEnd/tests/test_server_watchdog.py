"""L2 워치독(server_watchdog.py) 테스트 — 실제 프로세스·실제 재기동 없이 돌린다.

server_watchdog 는 작업 스케줄러가 5분마다 실행하는 단발 스크립트다. 여기서
검증하는 것은 세 가지 순수 판정이다: L1 이 살아있는가(cmdline 대조 포함),
재기동 이력이 창(window) 안에서 몇 번인가, 그래서 무엇을 할 것인가.

⚠ revive() 는 어떤 테스트에서도 실제로 호출하지 않는다 — 호출하면
HiTESS_Server.bat 이 새 콘솔에서 uvicorn 을 띄운다. main() 경로 테스트는
revive 를 대역으로 갈아끼우고 '호출되지 않았음' 또는 '호출 기록'만 본다.
"""
import json

import psutil
import pytest

import server_watchdog
from server_watchdog import (
    decide_action,
    is_manager_alive,
    read_revive_history,
    record_revive,
)


# ── 대역(테스트 더블) ────────────────────────────────────────────────────
class FakeProc:
    """psutil.Process 대역 — is_manager_alive 가 쓰는 두 메서드만 갖는다."""

    def __init__(self, cmdline, running=True):
        self._cmdline = cmdline
        self._running = running

    def is_running(self):
        return self._running

    def cmdline(self):
        return self._cmdline


class Recorder:
    """호출을 기록만 하는 대역 — '호출되지 않았음'을 단언하기 위한 것."""

    def __init__(self, result=None):
        self.calls = []
        self.result = result

    def __call__(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self.result


# ── decide_action: 무엇을 할 것인가 ──────────────────────────────────────
def test_noop_when_manager_is_alive():
    # L1 이 살아있으면 L2 는 손대지 않는다. L1 이 백오프 대기 중이어도
    # 프로세스는 살아있으므로 여기서 noop 이 되는 것이 의도된 동작이다 —
    # 끼어들면 백오프의 폭주 억제가 무력화된다.
    assert decide_action(
        manager_alive=True, http_ok=False, revive_history=[], now=1000.0
    ) == "noop"


def test_noop_when_manager_dead_but_http_responds():
    # 누군가 uvicorn 만 수동으로 띄운 경우다. 서비스는 정상이므로 건드리지 않는다.
    assert decide_action(
        manager_alive=False, http_ok=True, revive_history=[], now=1000.0
    ) == "noop"


def test_revive_when_manager_dead_and_http_down():
    assert decide_action(
        manager_alive=False, http_ok=False, revive_history=[], now=1000.0
    ) == "revive"


def test_giveup_when_revives_exceed_limit_in_window():
    # 창 안에 3회(=MAX_REVIVES_IN_WINDOW) 재기동했다면 더 시도하지 않는다.
    history = [1000.0, 1100.0, 1200.0]

    assert decide_action(
        manager_alive=False, http_ok=False, revive_history=history, now=1300.0
    ) == "giveup"


def test_revives_again_once_window_has_passed():
    # 같은 이력이라도 창(30분)을 벗어나면 카운트에서 빠져 다시 시도한다.
    history = [1000.0, 1100.0, 1200.0]
    now = 1200.0 + server_watchdog.REVIVE_WINDOW_SEC + 1

    assert decide_action(
        manager_alive=False, http_ok=False, revive_history=history, now=now
    ) == "revive"


# ── is_manager_alive: L1 이 정말 그 L1 인가 ──────────────────────────────
def test_manager_alive_when_cmdline_matches():
    proc = FakeProc(["python.exe", "server_manager.py"])

    assert is_manager_alive(4321, proc_factory=lambda pid: proc) is True


def test_manager_dead_when_pid_was_recycled():
    # ★ Windows 는 PID 를 재활용한다. 살아있는 무관한 프로세스(여기선 메모장)를
    # L1 으로 오인하면 워치독은 영원히 복구하지 않는다 — cmdline 대조가 필수다.
    proc = FakeProc(["C:\\Windows\\notepad.exe"])

    assert is_manager_alive(4321, proc_factory=lambda pid: proc) is False


def test_manager_dead_when_process_not_running():
    proc = FakeProc(["python.exe", "server_manager.py"], running=False)

    assert is_manager_alive(4321, proc_factory=lambda pid: proc) is False


def test_manager_dead_when_pid_is_none():
    # PID 파일이 없다 = L1 이 정상 종료했거나 급사했다.
    called = Recorder()

    assert is_manager_alive(None, proc_factory=called) is False
    assert called.calls == []          # 프로세스 조회조차 하지 않아야 한다.


def test_manager_dead_when_process_lookup_raises():
    def boom(pid):
        raise psutil.NoSuchProcess(pid)

    assert is_manager_alive(4321, proc_factory=boom) is False


# ── 재기동 이력: 창 안 횟수를 세는 유일한 근거 ──────────────────────────
def test_record_then_read_roundtrip(tmp_path):
    record_revive(tmp_path, now=1000.0)

    assert read_revive_history(tmp_path) == [1000.0]


def test_history_is_empty_when_state_file_missing(tmp_path):
    assert read_revive_history(tmp_path) == []


def test_history_is_empty_when_state_file_is_corrupt(tmp_path):
    # 손상된 상태 파일 때문에 워치독이 죽으면 복구 자체가 불가능해진다 —
    # 이력을 잃을지언정 예외를 전파하지 않는다.
    (tmp_path / server_watchdog.STATE_FILENAME).write_text(
        "{ not json at all", encoding="utf-8"
    )

    assert read_revive_history(tmp_path) == []


def test_record_drops_entries_outside_window(tmp_path):
    stale = 1000.0
    fresh = stale + server_watchdog.REVIVE_WINDOW_SEC - 10
    now = stale + server_watchdog.REVIVE_WINDOW_SEC + 10

    record_revive(tmp_path, now=stale)
    record_revive(tmp_path, now=fresh)
    history = record_revive(tmp_path, now=now)

    assert stale not in history                 # 창 밖 기록은 버린다.
    assert history == [fresh, now]
    assert read_revive_history(tmp_path) == [fresh, now]


def test_state_file_is_valid_json(tmp_path):
    record_revive(tmp_path, now=1000.0)

    raw = (tmp_path / server_watchdog.STATE_FILENAME).read_text(encoding="utf-8")

    assert json.loads(raw) == {"revives": [1000.0]}


def test_record_creates_missing_log_dir(tmp_path):
    nested = tmp_path / "logs"

    record_revive(nested, now=1000.0)

    assert read_revive_history(nested) == [1000.0]


def test_record_swallows_write_failure(tmp_path):
    # 기록 실패가 복구를 막아서는 안 된다 — 예외 없이 정리된 이력을 돌려준다.
    blocked = tmp_path / "blocked"
    blocked.write_text("i am a file, not a directory", encoding="utf-8")

    assert record_revive(blocked, now=1000.0) == [1000.0]


# ── main(): 배선 ─────────────────────────────────────────────────────────
@pytest.fixture()
def isolated_main(tmp_path, monkeypatch):
    """main() 을 실제 logs/·실제 재기동·실제 HTTP 에서 떼어낸다."""
    monkeypatch.setattr(server_watchdog, "LOG_DIR", tmp_path)

    stub = {
        "events": [],
        "revive": Recorder(),
        "probe": Recorder(result=False),
        "sleep": Recorder(),
        "log_dir": tmp_path,
    }
    monkeypatch.setattr(server_watchdog, "revive", stub["revive"])
    monkeypatch.setattr(server_watchdog.health, "probe", stub["probe"])
    monkeypatch.setattr(server_watchdog.time, "sleep", stub["sleep"])
    monkeypatch.setattr(
        server_watchdog.events,
        "append_event",
        lambda log_dir, src, event, detail=None: stub["events"].append(
            (src, event, detail)
        ),
    )
    return stub


def _event_names(stub):
    return [event for _src, event, _detail in stub["events"]]


def test_main_logs_and_aborts_when_pidfile_is_unreadable(isolated_main, monkeypatch):
    # ★ pidfile.read 는 PermissionError 를 전파한다. 안 잡으면 pythonw 로 뜬
    # 워치독이 트레이스백과 함께 죽고 아무 기록도 남지 않는다. 게다가 PID 를
    # 못 읽으면 L1 생존 여부를 모르므로, 모르는 채로 재기동하면 L1 이 둘이 된다.
    def boom(log_dir):
        raise PermissionError("locked")

    monkeypatch.setattr(server_watchdog.pidfile, "read", boom)

    rc = server_watchdog.main()

    assert "watchdog_pidfile_unreadable" in _event_names(isolated_main)
    assert isolated_main["revive"].calls == []       # 절대 재기동하지 않는다.
    assert rc != 0


def test_main_does_nothing_when_manager_is_alive(isolated_main, monkeypatch):
    monkeypatch.setattr(server_watchdog.pidfile, "read", lambda log_dir: 4321)
    monkeypatch.setattr(server_watchdog, "is_manager_alive", lambda pid: True)

    rc = server_watchdog.main()

    assert rc == 0
    assert isolated_main["revive"].calls == []
    assert isolated_main["probe"].calls == []        # L1 이 살아있으면 프로브도 불필요.


def test_main_gives_up_after_too_many_revives(isolated_main, monkeypatch):
    monkeypatch.setattr(server_watchdog.pidfile, "read", lambda log_dir: None)
    monkeypatch.setattr(server_watchdog, "is_manager_alive", lambda pid: False)
    now = 10_000.0
    monkeypatch.setattr(server_watchdog.time, "time", lambda: now)
    (isolated_main["log_dir"] / server_watchdog.STATE_FILENAME).write_text(
        json.dumps({"revives": [now - 30, now - 20, now - 10]}), encoding="utf-8"
    )

    rc = server_watchdog.main()

    assert "watchdog_giveup" in _event_names(isolated_main)
    assert isolated_main["revive"].calls == []
    assert rc == 1


def test_main_revives_and_reports_recovery(isolated_main, monkeypatch):
    # revive 는 대역이므로 실제 런처가 뜨지 않고, sleep 도 대역이라 30초를
    # 실제로 기다리지 않는다.
    monkeypatch.setattr(server_watchdog.pidfile, "read", lambda log_dir: None)
    monkeypatch.setattr(server_watchdog, "is_manager_alive", lambda pid: False)
    probe_results = iter([False, True])   # 판정 시엔 down, 재기동 후엔 up.
    monkeypatch.setattr(
        server_watchdog.health, "probe", lambda *a, **k: next(probe_results)
    )

    rc = server_watchdog.main()

    assert rc == 0
    assert len(isolated_main["revive"].calls) == 1
    assert _event_names(isolated_main) == [
        "watchdog_revive",
        "watchdog_revive_result",
    ]
    assert isolated_main["events"][-1][2] == {"recovered": True}
    assert isolated_main["sleep"].calls == [((server_watchdog.STARTUP_GRACE_SEC,), {})]
    assert len(read_revive_history(isolated_main["log_dir"])) == 1   # 이력에 남는다.


def test_main_reports_failure_when_revive_does_not_recover(isolated_main, monkeypatch):
    monkeypatch.setattr(server_watchdog.pidfile, "read", lambda log_dir: None)
    monkeypatch.setattr(server_watchdog, "is_manager_alive", lambda pid: False)

    rc = server_watchdog.main()      # probe 대역은 항상 False.

    assert rc == 1
    assert isolated_main["events"][-1][1] == "watchdog_revive_result"
    assert isolated_main["events"][-1][2] == {"recovered": False}
