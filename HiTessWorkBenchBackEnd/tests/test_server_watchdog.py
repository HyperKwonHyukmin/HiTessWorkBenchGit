"""L2 워치독(server_watchdog.py) 테스트 — 실제 프로세스·실제 재기동 없이 돌린다.

server_watchdog 는 작업 스케줄러가 5분마다 실행하는 단발 스크립트다. 여기서
검증하는 것은 네 가지다: L1 이 살아있는가(판독 불가를 죽음과 구분), 재기동
이력이 창(window) 안에서 몇 번인가, 그래서 무엇을 할 것인가, 그리고 되살릴
때 자식을 콘솔·job object 에서 떼어내는가.

⚠ revive() 는 어떤 테스트에서도 실제로 프로세스를 만들지 않는다 — 만들면
HiTESS_Server.bat 이 새 콘솔에서 uvicorn 을 띄운다. revive() 는 spawn 을
주입받으므로 argv 와 creationflags 만 대역으로 관측하고, main() 경로 테스트는
revive 자체를 대역으로 갈아끼운다.
"""
import json
import subprocess

import psutil
import pytest

import server_watchdog
from server_watchdog import (
    MANAGER_ALIVE,
    MANAGER_DEAD,
    MANAGER_UNREADABLE,
    classify_manager,
    decide_action,
    find_manager_by_scan,
    read_revive_history,
    record_revive,
    wait_for_recovery,
)


# ── 대역(테스트 더블) ────────────────────────────────────────────────────
class FakeProc:
    """psutil.Process 대역 — classify_manager 가 쓰는 두 메서드만 갖는다."""

    def __init__(self, cmdline=None, running=True, raises=None):
        self._cmdline = cmdline or []
        self._running = running
        self._raises = raises          # cmdline() 이 던질 예외

    def is_running(self):
        return self._running

    def cmdline(self):
        if self._raises is not None:
            raise self._raises
        return self._cmdline


class FakeScanned:
    """psutil.process_iter(['cmdline']) 가 주는 항목의 대역."""

    def __init__(self, pid, cmdline):
        self.pid = pid
        self.info = {"cmdline": cmdline}


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
    # 누군가 uvicorn 만 수동으로 띄웠거나, L1 만 죽고 자식 uvicorn 이 남은
    # 경우다. 서비스는 응답하고 있으므로 죽이지 않는다.
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


# ── classify_manager: 살았나 / 죽었나 / 알 수 없나 ───────────────────────
# ★ 이 3값 구분이 이 모듈에서 가장 중요한 안전장치다. 판독 불가를 '죽음'으로
#   뭉개면 살아있는 L1 위에 두 번째 L1 을 띄우고, 두 L1 이 서로의 uvicorn 을
#   _kill_port(9091) 로 죽이는 상호 kill 루프가 된다.
def test_manager_alive_when_cmdline_matches():
    proc = FakeProc(["python.exe", "server_manager.py"])

    assert classify_manager(4321, proc_factory=lambda pid: proc) == MANAGER_ALIVE


def test_manager_alive_ignores_cmdline_case():
    # 경로 대소문자는 Windows 에서 보존되지 않는다 — 대소문자를 따지면
    # 살아있는 L1 을 죽었다고 판정할 수 있다.
    proc = FakeProc(["C:\\Python\\PYTHONW.EXE", "C:\\Coding\\Server_Manager.PY"])

    assert classify_manager(4321, proc_factory=lambda pid: proc) == MANAGER_ALIVE


def test_manager_dead_when_pid_was_recycled():
    # Windows 는 PID 를 재활용한다. 살아있는 무관한 프로세스(여기선 메모장)를
    # L1 으로 오인하면 워치독은 영원히 복구하지 않는다 — cmdline 대조가 필수다.
    proc = FakeProc(["C:\\Windows\\notepad.exe"])

    assert classify_manager(4321, proc_factory=lambda pid: proc) == MANAGER_DEAD


def test_manager_dead_when_process_not_running():
    proc = FakeProc(["python.exe", "server_manager.py"], running=False)

    assert classify_manager(4321, proc_factory=lambda pid: proc) == MANAGER_DEAD


def test_manager_dead_when_pid_is_none():
    # PID 파일이 없다 = L1 이 정상 종료했거나, 급사했거나, PID 기록에
    # 실패했다(_write_pidfile 은 실패해도 기동을 막지 않는다). 어느 쪽인지는
    # 스캔이 가린다 — 여기서는 '프로세스 조회로는 확인 못 함'까지다.
    called = Recorder()

    assert classify_manager(None, proc_factory=called) == MANAGER_DEAD
    assert called.calls == []          # 프로세스 조회조차 하지 않아야 한다.


def test_manager_dead_when_process_is_gone():
    def gone(pid):
        raise psutil.NoSuchProcess(pid)

    assert classify_manager(4321, proc_factory=gone) == MANAGER_DEAD


def test_manager_unreadable_when_cmdline_access_is_denied():
    # ★ 실측: 생성자와 is_running() 은 통과하는데 cmdline() 만 AccessDenied 를
    #   던지는 프로세스가 이 PC 에 실재한다(Registry, LsaIso.exe, MemCompression).
    #   계정이 다르거나(다중 RDP) 승격 수준이 어긋나면 L1 에서도 재현된다.
    #   이때 '죽음'으로 판정하면 L1 이 둘이 된다 — 살아있는 쪽으로 기울여야 한다.
    proc = FakeProc(running=True, raises=psutil.AccessDenied(4321))

    assert classify_manager(4321, proc_factory=lambda pid: proc) == MANAGER_UNREADABLE


def test_manager_unreadable_when_cmdline_raises_oserror():
    proc = FakeProc(running=True, raises=OSError("handle is closed"))

    assert classify_manager(4321, proc_factory=lambda pid: proc) == MANAGER_UNREADABLE


def test_manager_unreadable_when_lookup_is_denied():
    def denied(pid):
        raise psutil.AccessDenied(pid)

    assert classify_manager(4321, proc_factory=denied) == MANAGER_UNREADABLE


# ── find_manager_by_scan: PID 파일이 틀렸을 때의 마지막 확인 ─────────────
def test_scan_finds_manager_by_cmdline():
    procs = [
        FakeScanned(100, ["C:\\Windows\\explorer.exe"]),
        FakeScanned(200, ["python.exe", "C:\\Coding\\server_manager.py"]),
    ]

    assert find_manager_by_scan(proc_iter=lambda attrs: procs) == 200


def test_scan_ignores_processes_with_unreadable_cmdline():
    # ★ 실측: process_iter(['cmdline']) 은 AccessDenied 를 전파하지 않고 해당
    #   항목을 None 으로 준다(이 PC 에서 416개 중 5개). None 방어가 없으면
    #   TypeError 로 스캔 전체가 무너져 L1 을 못 찾는다.
    procs = [
        FakeScanned(4, None),                                   # Registry 등
        FakeScanned(200, ["python.exe", "server_manager.py"]),
    ]

    assert find_manager_by_scan(proc_iter=lambda attrs: procs) == 200


def test_scan_ignores_case():
    procs = [FakeScanned(200, ["PYTHONW.EXE", "C:\\Coding\\Server_Manager.PY"])]

    assert find_manager_by_scan(proc_iter=lambda attrs: procs) == 200


def test_scan_returns_none_when_no_manager_running():
    procs = [FakeScanned(100, ["C:\\Windows\\explorer.exe"])]

    assert find_manager_by_scan(proc_iter=lambda attrs: procs) is None


def test_scan_skips_processes_that_vanish_mid_iteration():
    class Vanishing:
        pid = 300

        @property
        def info(self):
            raise psutil.NoSuchProcess(300)

    procs = [Vanishing(), FakeScanned(200, ["python.exe", "server_manager.py"])]

    assert find_manager_by_scan(proc_iter=lambda attrs: procs) == 200


def test_scan_returns_none_when_iteration_fails():
    def boom(attrs):
        raise RuntimeError("psutil is broken")

    assert find_manager_by_scan(proc_iter=boom) is None


def test_watchdog_does_not_match_its_own_cmdline():
    # 스캔에서 자기 자신을 제외할 필요가 있는지에 대한 답이다. 워치독의
    # 커맨드라인엔 server_watchdog.py 가 들어가지 server_manager.py 는 없으므로
    # 자기 자신에 걸리지 않는다 — 마커를 넓히면(예: "server_") 이 테스트가 깨진다.
    own = ["pythonw.exe", str(server_watchdog.BASE_DIR / "server_watchdog.py")]

    assert server_watchdog.MANAGER_MARKER not in " ".join(own).lower()


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


def test_state_file_is_written_atomically(tmp_path, monkeypatch):
    # 쓰는 도중 급사하면 이력이 통째로 날아가 폭주 억제가 이완된다. tmp 에 쓰고
    # os.replace 로 갈아끼우면 상태 파일은 항상 이전본이거나 완전한 새 본이다.
    replaced = []
    real_replace = server_watchdog.os.replace

    def spy(src, dst):
        replaced.append((str(src), str(dst)))
        real_replace(src, dst)

    monkeypatch.setattr(server_watchdog.os, "replace", spy)

    record_revive(tmp_path, now=1000.0)

    assert len(replaced) == 1
    src, dst = replaced[0]
    assert dst.endswith(server_watchdog.STATE_FILENAME)
    assert not src.endswith(server_watchdog.STATE_FILENAME)   # 임시 파일에 먼저 쓴다.
    assert list(tmp_path.glob("*.tmp")) == []                 # 임시 파일이 남지 않는다.
    assert read_revive_history(tmp_path) == [1000.0]


def test_previous_history_survives_a_failed_write(tmp_path, monkeypatch):
    # 새 본을 쓰다 실패해도 직전 이력은 온전해야 한다. 대상 파일을 직접 열어
    # 쓰면 실패 순간 파일이 잘려 이력이 통째로 날아간다.
    record_revive(tmp_path, now=1000.0)

    def boom(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(server_watchdog.os, "replace", boom)

    record_revive(tmp_path, now=1001.0)          # 실패는 삼켜진다.

    assert read_revive_history(tmp_path) == [1000.0]


def test_record_creates_missing_log_dir(tmp_path):
    nested = tmp_path / "logs"

    record_revive(nested, now=1000.0)

    assert read_revive_history(nested) == [1000.0]


def test_record_swallows_write_failure(tmp_path):
    # 기록 실패가 복구를 막아서는 안 된다 — 예외 없이 정리된 이력을 돌려준다.
    blocked = tmp_path / "blocked"
    blocked.write_text("i am a file, not a directory", encoding="utf-8")

    assert record_revive(blocked, now=1000.0) == [1000.0]


# ── revive(): 콘솔·job object 에서 떼어내기 ─────────────────────────────
def test_revive_spawns_launcher_with_empty_window_title():
    # `start` 의 첫 인자는 창 제목이다. "" 를 빼면 경로에 공백이 있을 때
    # start 가 런처 경로를 창 제목으로 먹고 아무것도 실행하지 않는다.
    spawn = Recorder()

    server_watchdog.revive(spawn=spawn)

    (argv,), kwargs = spawn.calls[0]
    assert argv[1:] == ["/c", "start", "", str(server_watchdog.LAUNCHER)]
    assert argv[0].lower().endswith("cmd.exe")      # COMSPEC 사용
    assert kwargs["cwd"] == str(server_watchdog.BASE_DIR)


def test_revive_detaches_from_console_and_job():
    # DETACHED_PROCESS: 워치독은 곧 종료되므로 자식이 딸려 죽으면 안 된다.
    # CREATE_BREAKAWAY_FROM_JOB: 스케줄러가 태스크를 job object 로 묶는데,
    # 되살린 L1 이 그 안에 남으면 ExecutionTimeLimit(5분) 만료 때 스케줄러가
    # 방금 되살린 L1 과 uvicorn 을 도로 죽인다.
    spawn = Recorder()

    server_watchdog.revive(spawn=spawn)

    flags = spawn.calls[0][1]["creationflags"]
    assert flags & subprocess.DETACHED_PROCESS
    assert flags & subprocess.CREATE_BREAKAWAY_FROM_JOB


def test_revive_retries_without_breakaway_when_job_forbids_it():
    # job 이 breakaway 를 불허하면 Popen 이 OSError 를 낸다. 폴백이 없으면
    # 재기동이 통째로 실패한다 — 콘솔 분리만이라도 유지하고 다시 시도한다.
    attempts = []

    def spawn(argv, **kwargs):
        attempts.append((argv, kwargs["creationflags"]))
        if len(attempts) == 1:
            raise OSError("breakaway not permitted")
        return object()

    server_watchdog.revive(spawn=spawn)

    assert len(attempts) == 2
    assert attempts[0][0] == attempts[1][0]                     # 같은 명령
    assert attempts[1][1] == subprocess.DETACHED_PROCESS        # 플래그만 낮춘다
    assert not attempts[1][1] & subprocess.CREATE_BREAKAWAY_FROM_JOB


def test_revive_propagates_failure_when_fallback_also_fails():
    # 여기서 삼키면 main 이 '재기동했다'고 기록하고 결과를 남기지 않는다.
    def spawn(argv, **kwargs):
        raise OSError("cmd not found")

    with pytest.raises(OSError):
        server_watchdog.revive(spawn=spawn)


# ── wait_for_recovery: 콜드 스타트를 기다린다 ───────────────────────────
def test_wait_for_recovery_returns_as_soon_as_backend_answers():
    # 정상 케이스는 고정 대기보다 오히려 빨리 확정된다.
    results = iter([False, True])
    sleeps = Recorder()

    ok = wait_for_recovery(probe=lambda: next(results), sleep=sleeps)

    assert ok is True
    assert len(sleeps.calls) == 2                                # 90초를 다 안 쓴다.


def test_wait_for_recovery_gives_up_after_max_wait():
    # 백엔드는 라우터 19개 + numpy/SQLAlchemy import 와 DB 부트스트랩을 거친다.
    # 30초 단발 프로브는 실제로는 성공인데 recovered:false 를 남길 수 있다.
    sleeps = Recorder()

    ok = wait_for_recovery(probe=lambda: False, sleep=sleeps)

    assert ok is False
    slept = sum(args[0] for args, _ in sleeps.calls)
    assert slept == server_watchdog.RECOVERY_MAX_WAIT_SEC


# ── main(): 배선 ─────────────────────────────────────────────────────────
@pytest.fixture()
def isolated_main(tmp_path, monkeypatch):
    """main() 을 실제 logs/·실제 재기동·실제 HTTP·실제 프로세스에서 떼어낸다.

    기본 상태는 '재기동이 필요한 상황'(PID 없음·L1 죽음·스캔에도 없음·HTTP
    무응답)이고, 각 테스트는 필요한 부분만 덮어쓴다.
    """
    monkeypatch.setattr(server_watchdog, "LOG_DIR", tmp_path)

    stub = {
        "events": [],
        "revive": Recorder(),
        "probe": Recorder(result=False),
        "sleep": Recorder(),
        "log_dir": tmp_path,
    }
    monkeypatch.setattr(server_watchdog, "revive", stub["revive"])
    monkeypatch.setattr(server_watchdog, "classify_manager", lambda pid: MANAGER_DEAD)
    monkeypatch.setattr(server_watchdog, "find_manager_by_scan", lambda: None)
    monkeypatch.setattr(server_watchdog.pidfile, "read", lambda log_dir: None)
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
    # pidfile.read 는 PermissionError 를 전파한다. 안 잡으면 pythonw 로 뜬
    # 워치독이 트레이스백과 함께 죽고 콘솔이 없어 아무 기록도 남지 않는다.
    # 게다가 PID 를 못 읽으면 L1 생존 여부를 모르므로, 모르는 채로 재기동하면
    # L1 이 둘이 된다.
    def boom(log_dir):
        raise PermissionError("locked")

    monkeypatch.setattr(server_watchdog.pidfile, "read", boom)

    rc = server_watchdog.main()

    assert "watchdog_pidfile_unreadable" in _event_names(isolated_main)
    assert isolated_main["revive"].calls == []       # 절대 재기동하지 않는다.
    assert rc != 0


def test_main_does_nothing_when_manager_is_alive(isolated_main, monkeypatch):
    monkeypatch.setattr(server_watchdog.pidfile, "read", lambda log_dir: 4321)
    monkeypatch.setattr(server_watchdog, "classify_manager", lambda pid: MANAGER_ALIVE)

    rc = server_watchdog.main()

    assert rc == 0
    assert isolated_main["revive"].calls == []
    assert isolated_main["probe"].calls == []        # L1 이 살아있으면 프로브도 불필요.


def test_main_treats_unreadable_manager_as_alive(isolated_main, monkeypatch):
    # ★ 이 모듈 최악의 실패(L1 이 둘이 되는 것)를 막는 지점이다. 재기동을 5분
    #   미루는 손해가 상호 kill 루프보다 훨씬 작다.
    monkeypatch.setattr(server_watchdog.pidfile, "read", lambda log_dir: 4321)
    monkeypatch.setattr(
        server_watchdog, "classify_manager", lambda pid: MANAGER_UNREADABLE
    )

    rc = server_watchdog.main()

    assert rc == 0
    assert isolated_main["revive"].calls == []
    assert "watchdog_manager_unreadable" in _event_names(isolated_main)


def test_main_does_not_revive_when_scan_finds_manager(isolated_main, monkeypatch):
    # PID 파일이 없어도 L1 이 살아있을 수 있다 — server_manager 의 _write_pidfile
    # 은 쓰기에 실패해도 기동을 막지 않는다(의도된 설계). 죽음을 확정하기 전에
    # 반드시 한 번 훑는다.
    monkeypatch.setattr(server_watchdog, "find_manager_by_scan", lambda: 777)

    rc = server_watchdog.main()

    assert rc == 0
    assert isolated_main["revive"].calls == []
    assert "watchdog_manager_found_by_scan" in _event_names(isolated_main)


def test_main_records_orphan_uvicorn_without_killing_it(isolated_main, monkeypatch):
    # L1 만 죽고 자식 uvicorn 이 살아남은 상태(Windows 는 부모 사망이 자식을
    # 죽이지 않는다). 서비스는 응답하므로 건드리지 않지만, 헬스체크·좀비
    # 감지·백오프가 전부 사라진 상태를 아무도 모르면 안 되므로 기록은 남긴다.
    monkeypatch.setattr(server_watchdog.health, "probe", lambda *a, **k: True)

    rc = server_watchdog.main()

    assert rc == 0
    assert isolated_main["revive"].calls == []      # 동작 중인 서비스를 죽이지 않는다.
    assert "watchdog_orphan_uvicorn" in _event_names(isolated_main)


def test_main_gives_up_after_too_many_revives(isolated_main, monkeypatch):
    now = 10_000.0
    monkeypatch.setattr(server_watchdog.time, "time", lambda: now)
    (isolated_main["log_dir"] / server_watchdog.STATE_FILENAME).write_text(
        json.dumps({"revives": [now - 30, now - 20, now - 10]}), encoding="utf-8"
    )

    rc = server_watchdog.main()

    assert "watchdog_giveup" in _event_names(isolated_main)
    assert isolated_main["revive"].calls == []
    assert rc == 1


def test_main_aborts_when_launcher_is_missing(isolated_main, monkeypatch, tmp_path):
    # 런처가 없어도 cmd 자체는 정상 실행되므로 오류가 아무도 안 보는 콘솔에만
    # 찍힌다. 선검사가 없으면 재기동 예산 3회를 조용히 소진하고 giveup 한다.
    monkeypatch.setattr(server_watchdog, "LAUNCHER", tmp_path / "없는런처.bat")

    rc = server_watchdog.main()

    assert rc != 0
    assert "watchdog_launcher_missing" in _event_names(isolated_main)
    assert isolated_main["revive"].calls == []
    assert read_revive_history(isolated_main["log_dir"]) == []   # 예산을 쓰지 않는다.


def test_main_records_failure_when_spawn_raises(isolated_main, monkeypatch):
    # revive() 가 main 의 유일한 무보호 호출이었다. 예외가 밖으로 나가면 pythonw
    # 라 아무 기록도 안 남고, 로그는 '재기동했는데 결과가 없다'로 읽힌다.
    def boom():
        raise OSError("cmd not found")

    monkeypatch.setattr(server_watchdog, "revive", boom)

    rc = server_watchdog.main()

    assert rc == 1
    assert "watchdog_revive_failed" in _event_names(isolated_main)
    assert "watchdog_revive_result" not in _event_names(isolated_main)


def test_main_revives_and_reports_recovery(isolated_main, monkeypatch):
    # revive 는 대역이라 실제 런처가 뜨지 않고, sleep 도 대역이라 실제로
    # 기다리지 않는다.
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
    assert isolated_main["sleep"].calls                              # 폴링은 했다.
    assert len(read_revive_history(isolated_main["log_dir"])) == 1   # 이력에 남는다.


def test_main_reports_failure_when_revive_does_not_recover(isolated_main):
    rc = server_watchdog.main()      # probe 대역은 항상 False.

    assert rc == 1
    assert isolated_main["events"][-1][1] == "watchdog_revive_result"
    assert isolated_main["events"][-1][2] == {"recovered": False}
