"""L2 워치독 — 작업 스케줄러가 5분마다 실행하는 비상주 단발 스크립트.

L1(server_manager.py) 이 죽었을 때 런처를 다시 띄우는 것이 유일한 임무다.
상주하지 않으므로 "워치독이 죽으면 누가 감시하나"라는 질문이 없다 — 최종
감시자는 OS(작업 스케줄러)다. 매 실행은 판정 → 행동 → 종료로 끝난다.

⚠ 경계 규칙: uvicorn 을 절대 직접 건드리지 않는다. L1 이 살아 있으면 아무
것도 하지 않고 즉시 종료한다. 재시작 권한을 L1 에만 두어, 두 계층이 동시에
재시작을 시도하는 경합을 원천 차단한다.

★ 이 모듈을 관통하는 원칙 — **판독 불가를 죽음으로 뭉개지 않는다.**
이 시스템에서 가장 나쁜 결과는 서버가 5분 늦게 살아나는 것이 아니라 L1 이
둘이 되는 것이다. 두 L1 은 서로의 uvicorn 을 _kill_port(9091) 로 죽이고 상대를
크래시로 오판해 재기동하는 상호 kill 루프에 빠지며, 해석 exe 는 고아로 남아
MSC 라이선스를 문다. 그래서 '확신이 없으면 살아있는 쪽'으로 기운다. L1 의
중복 실행 가드(_find_running_manager)는 정반대로 '확신이 없으면 띄운다'로
기우는데, 그쪽은 사람이 런처를 눌러 화면 앞에 있는 상황이라 판단이 다르다.

⚠ 파일명이 watchdog.py 가 아닌 이유: PyPI 에 `watchdog` 패키지가 있어, 백엔드
루트(uvicorn 의 cwd)에 watchdog.py 를 두면 그 import 를 섀도잉한다. 지금
직접 의존이 없더라도 어떤 서드파티가 `import watchdog` 를 하는 순간 백엔드가
깨지므로, 이름 충돌 자체를 피한다.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
# 스케줄러가 다른 작업 디렉토리로 실행할 수 있으므로 import 경로를 명시적으로 보장한다.
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

import psutil                                          # noqa: E402
from serverguard import events, health, pidfile        # noqa: E402

LOG_DIR = BASE_DIR / "logs"
STATE_FILENAME = "watchdog_state.json"
LAUNCHER = BASE_DIR / "HiTESS_Server.bat"

MANAGER_MARKER = "server_manager.py"
REVIVE_WINDOW_SEC = 1800          # 30분
MAX_REVIVES_IN_WINDOW = 3

# 재기동 후 헬스 확인. 단발 프로브 대신 폴링하는 이유: 백엔드는 라우터 19개와
# numpy/SQLAlchemy import, DB 부트스트랩을 거쳐 뜬다. 고정 대기가 짧으면 실제로는
# 성공인데 recovered:false 가 남아 로그를 못 믿게 되고, 길게 잡으면 정상 케이스가
# 매번 그만큼 늦어진다. 폴링은 정상 케이스를 더 빨리 확정하면서 느린 기동도 잡는다.
RECOVERY_POLL_INTERVAL_SEC = 5
RECOVERY_MAX_WAIT_SEC = 90        # 스케줄러의 ExecutionTimeLimit(5분) 안에 끝난다.

# classify_manager 의 3값 판정.
MANAGER_ALIVE = "alive"
MANAGER_DEAD = "dead"
MANAGER_UNREADABLE = "unreadable"


def classify_manager(pid, *, proc_factory=psutil.Process, marker=MANAGER_MARKER):
    """PID 가 가리키는 프로세스를 살았음/죽었음/판독 불가로 판정한다.

    ★ cmdline 대조가 필수인 이유: Windows 는 PID 를 재활용한다. 생존 여부만
    보면 L1 이 죽은 뒤 같은 PID 를 물려받은 무관한 프로세스를 L1 으로 오인해
    영원히 복구하지 않는다.

    ★ 그런데 그 cmdline 을 읽지 못하는 경우가 실재한다 — 이 PC 실측으로
    생성자와 is_running() 은 통과하는데 cmdline() 만 AccessDenied 를 던지는
    프로세스가 5개 있다(Registry, LsaIso.exe, MemCompression). 계정이 다르거나
    (다중 RDP) L1 과 워치독의 승격 수준이 어긋나면 L1 에서도 재현된다.
    이때 '죽음'으로 판정하면 L1 이 둘이 된다.

    특히 위험한 이유는 오판 조건과 위험 구간이 독립 사건이 아니라는 데 있다.
    L1 이 백오프(10~60분) 대기에 들어가면 그 구간엔 uvicorn 이 설계상 확실히
    다운이라 health.probe() 가 반드시 False 다 — 판독 불가가 겹치는 순간
    곧바로 중복 기동으로 이어진다.

    그래서 '없음이 확정된 경우'(NoSuchProcess)만 죽음이고, 읽지 못한 경우는
    UNREADABLE 로 따로 알린다. 판정 자체는 예외를 밖으로 내보내지 않는다 —
    여기서 워치독이 죽으면 복구 기회가 사라진다.
    """
    if not pid:
        # PID 파일이 없거나 비었다. 프로세스 조회로는 더 알 수 없고,
        # 죽음의 확정은 find_manager_by_scan 이 맡는다.
        return MANAGER_DEAD

    try:
        proc = proc_factory(pid)
        if not proc.is_running():
            return MANAGER_DEAD
        cmdline = proc.cmdline()
    except psutil.NoSuchProcess:
        return MANAGER_DEAD                  # 그 PID 는 확실히 없다.
    except Exception:
        return MANAGER_UNREADABLE            # AccessDenied·OSError 등 — 모른다.

    return MANAGER_ALIVE if marker.lower() in " ".join(cmdline).lower() else MANAGER_DEAD


def find_manager_by_scan(*, proc_iter=psutil.process_iter, marker=MANAGER_MARKER):
    """실행 중인 프로세스를 훑어 L1 의 PID 를 찾는다. 없으면 None.

    PID 파일이 없거나 틀렸다고 해서 L1 이 죽은 것은 아니다 — server_manager 의
    _write_pidfile 은 쓰기에 실패해도 기동을 막지 않는다(의도된 설계). PID 파일만
    믿고 재기동하면 그 경우 L1 이 둘이 되므로, 죽음을 확정하기 전에 한 번 훑는다.

    ★ process_iter(['cmdline']) 은 AccessDenied 를 전파하지 않고 해당 항목을
    None 으로 준다(이 PC 실측 416개 중 5개). None 을 방어하지 않으면 TypeError 로
    스캔 전체가 무너져 살아있는 L1 을 못 찾는다.

    자기 자신을 제외하지 않는 이유: 워치독의 커맨드라인엔 server_watchdog.py 가
    들어가지 server_manager.py 는 없어 마커에 걸리지 않는다(테스트로 고정).

    스캔 자체가 실패하면(psutil 이상) None 을 돌려준다 — 이 함수는 PID 기반
    판정이 이미 '죽음'으로 기운 뒤의 보조 확인이라, 여기서 못 찾은 것을 죽음의
    확정으로 쓴다.
    """
    needle = marker.lower()
    try:
        for proc in proc_iter(["cmdline"]):
            try:
                cmdline = proc.info.get("cmdline")
                if not cmdline:                  # None(권한 없음) 이거나 빈 목록
                    continue
                if needle in " ".join(cmdline).lower():
                    return proc.pid
            except Exception:
                continue                         # 순회 중 사라진 프로세스 등
    except Exception:
        return None
    return None


def read_revive_history(log_dir):
    """기록된 재기동 시각(epoch) 목록을 반환한다.

    파일이 없거나 손상됐으면 빈 리스트다 — 이력을 잃는 손해보다 워치독이
    죽어 복구가 멈추는 손해가 훨씬 크다.
    """
    try:
        raw = (Path(log_dir) / STATE_FILENAME).read_text(encoding="utf-8")
        return [float(ts) for ts in json.loads(raw)["revives"]]
    except Exception:
        return []


def record_revive(log_dir, *, now=None, window_sec=REVIVE_WINDOW_SEC):
    """이번 재기동을 이력에 추가하고, 창 안으로 정리된 이력을 반환한다.

    임시 파일에 쓰고 os.replace 로 갈아끼운다. 대상 파일을 직접 열면 쓰는
    도중 급사했을 때 파일이 잘려 이력이 통째로 날아가고, 그러면 폭주 억제
    (giveup 판정)가 조용히 이완된다. replace 는 원자적이라 상태 파일은 항상
    이전본이거나 완전한 새 본이다.

    쓰기 실패는 삼킨다 — 기록에 실패했다고 복구를 막을 이유가 없다.
    """
    now = time.time() if now is None else now
    history = [ts for ts in read_revive_history(log_dir) if now - ts < window_sec]
    history.append(now)

    tmp = None
    try:
        path = Path(log_dir)
        path.mkdir(parents=True, exist_ok=True)
        tmp = path / (STATE_FILENAME + ".tmp")
        tmp.write_text(json.dumps({"revives": history}), encoding="utf-8")
        os.replace(tmp, path / STATE_FILENAME)
    except Exception:
        if tmp is not None:
            try:
                tmp.unlink(missing_ok=True)      # 실패한 임시본을 남기지 않는다.
            except Exception:
                pass
    return history


def decide_action(
    *,
    manager_alive,
    http_ok,
    revive_history,
    now,
    window_sec=REVIVE_WINDOW_SEC,
    max_revives=MAX_REVIVES_IN_WINDOW,
):
    """이번 실행에서 무엇을 할지 결정한다: "noop" | "revive" | "giveup".

    manager_alive 면 무조건 noop 이다. L1 이 백오프로 *대기 중*일 때도 L1
    프로세스는 살아 있으므로 여기서 noop 이 된다 — 의도된 동작이다. 대기 중인
    L1 을 보고 L2 가 대신 런처를 띄우면 백오프의 폭주 억제가 무력화되고, 곧
    L1 이 둘이 된다.

    http_ok 면 역시 noop 이다. L1 없이 uvicorn 만 살아있는 경우인데, 사용자가
    원하는 서비스는 이미 제공되고 있다. 감시를 되찾자고 여기서 재기동하면
    동작 중인 해석 exe(nastran 은 수 분~수십 분 돈다)를 끊게 된다 — 감시 공백
    보다 그 손해가 크다. 그래서 승격하지 않고 main 이 기록만 남긴다.
    """
    if manager_alive:
        return "noop"
    if http_ok:
        return "noop"
    if sum(1 for ts in revive_history if now - ts < window_sec) >= max_revives:
        return "giveup"
    return "revive"


def revive(*, spawn=subprocess.Popen):
    """런처를 현재 프로세스·job object 에서 분리해 실행한다.

    DETACHED_PROCESS: 워치독은 곧 종료되므로 자식이 딸려 죽으면 안 된다.
    `start` 가 bat 에 새 콘솔을 붙여 GUI 가 뜨게 한다(워치독 자신은 pythonw.exe
    로 실행되어 콘솔이 없다). `start` 뒤의 "" 는 창 제목 자리다 — 빼면 경로에
    공백이 있을 때 start 가 런처 경로를 창 제목으로 먹고 아무것도 실행하지 않는다.

    CREATE_BREAKAWAY_FROM_JOB: 작업 스케줄러는 태스크를 job object 로 묶는다.
    되살린 L1 이 그 job 에 남으면 ①태스크가 계속 Running 으로 보여 이후 5분
    트리거가 전부 스킵되거나 ②ExecutionTimeLimit(5분) 만료 시 스케줄러가 방금
    되살린 L1 과 uvicorn 을 도로 죽인다.

    job 이 breakaway 를 불허하면 Popen 이 OSError 를 낸다. 그때는 플래그를 낮춰
    (콘솔 분리만) 다시 시도한다 — 폴백이 없으면 재기동이 통째로 실패한다.
    두 번째도 실패하면 전파한다. 여기서 삼키면 호출자가 '재기동했다'고 기록해
    놓고 결과를 남기지 않아, 로그가 거짓말을 하게 된다.
    """
    argv = [os.environ.get("COMSPEC", "cmd"), "/c", "start", "", str(LAUNCHER)]
    kwargs = {"cwd": str(BASE_DIR), "close_fds": True}
    try:
        return spawn(
            argv,
            creationflags=subprocess.DETACHED_PROCESS
            | subprocess.CREATE_BREAKAWAY_FROM_JOB,
            **kwargs,
        )
    except OSError:
        return spawn(argv, creationflags=subprocess.DETACHED_PROCESS, **kwargs)


def wait_for_recovery(
    *,
    probe=None,
    sleep=None,
    interval_sec=RECOVERY_POLL_INTERVAL_SEC,
    max_wait_sec=RECOVERY_MAX_WAIT_SEC,
):
    """재기동한 백엔드가 응답할 때까지 폴링한다. 살아나면 True.

    기본값을 호출 시점에 확인하는 이유는, 모듈 로드 시점에 health.probe 를
    묶어두면 테스트가 대역으로 갈아끼워도 원본이 불린다는 것 때문이다.
    """
    probe = health.probe if probe is None else probe
    sleep = time.sleep if sleep is None else sleep

    waited = 0
    while waited < max_wait_sec:
        sleep(interval_sec)                  # 기동 직후엔 반드시 실패하므로 먼저 쉰다.
        waited += interval_sec
        if probe():
            return True
    return False


def main():
    """1회 감시 사이클. 종료 코드 0 = 정상, 1 = 복구 실패/판단 불가."""
    now = time.time()

    try:
        pid = pidfile.read(LOG_DIR)
    except Exception as exc:
        # pidfile.read 는 PermissionError 등을 전파한다. 여기서 안 잡으면
        # pythonw 로 뜬 워치독이 트레이스백과 함께 죽고 콘솔이 없어 아무 기록도
        # 남지 않는다. 게다가 PID 를 못 읽으면 L1 생존 여부를 알 수 없으므로,
        # 모르는 채로 재기동하면 L1 이 둘이 된다 — 기록만 남기고 물러난다.
        events.append_event(LOG_DIR, "L2", "watchdog_pidfile_unreadable",
                            {"error": f"{type(exc).__name__}: {exc}"[:300]})
        return 1

    verdict = classify_manager(pid)
    manager_alive = verdict == MANAGER_ALIVE

    if verdict == MANAGER_UNREADABLE:
        # 살아있는지 알 수 없다 → 살아있는 쪽으로 기운다. 재기동을 5분 미루는
        # 손해가 L1 이 둘이 되는 손해보다 훨씬 작다. 대신 반드시 기록을 남긴다 —
        # 이 상태가 계속되면 워치독이 영원히 복구하지 않으므로 사람이 알아야 한다.
        events.append_event(LOG_DIR, "L2", "watchdog_manager_unreadable", {"pid": pid})
        manager_alive = True
    elif not manager_alive:
        scanned = find_manager_by_scan()
        if scanned is not None:
            events.append_event(LOG_DIR, "L2", "watchdog_manager_found_by_scan",
                                {"pid": scanned, "pidfile_pid": pid})
            manager_alive = True

    http_ok = health.probe() if not manager_alive else False
    action = decide_action(
        manager_alive=manager_alive,
        http_ok=http_ok,
        revive_history=read_revive_history(LOG_DIR),
        now=now,
    )

    if action == "noop":
        if http_ok and not manager_alive:
            # L1 만 죽고 자식 uvicorn 이 살아남았다(Windows 는 부모 사망이 자식을
            # 죽이지 않는다). 서비스는 응답하므로 죽이지 않지만, 헬스체크·좀비
            # 감지·백오프가 전부 사라진 상태라 기록 없이 넘어가면 아무도 모른다.
            events.append_event(LOG_DIR, "L2", "watchdog_orphan_uvicorn",
                                {"health_url": health.HEALTH_URL, "pidfile_pid": pid})
        return 0

    if action == "giveup":
        # 창 안에서 이미 한도만큼 시도했다. 계속 띄우면 실패하는 기동을 5분마다
        # 반복할 뿐이므로, 사람이 볼 기록만 남기고 멈춘다.
        events.append_event(LOG_DIR, "L2", "watchdog_giveup",
                            {"window_sec": REVIVE_WINDOW_SEC,
                             "max_revives": MAX_REVIVES_IN_WINDOW})
        return 1

    if not LAUNCHER.exists():
        # 런처가 없어도 cmd 는 정상 실행되고 오류는 아무도 안 보는 콘솔에만 찍힌다.
        # 선검사가 없으면 재기동 예산 3회를 조용히 소진하고 giveup 한다.
        events.append_event(LOG_DIR, "L2", "watchdog_launcher_missing",
                            {"launcher": str(LAUNCHER)})
        return 1

    events.append_event(LOG_DIR, "L2", "watchdog_revive", {"launcher": str(LAUNCHER)})
    record_revive(LOG_DIR, now=now)
    try:
        revive()
    except Exception as exc:
        # pythonw 라 예외가 밖으로 나가면 아무 기록도 남지 않고, 로그는
        # '재기동했는데 결과가 없다'로 읽힌다.
        events.append_event(LOG_DIR, "L2", "watchdog_revive_failed",
                            {"error": f"{type(exc).__name__}: {exc}"[:300]})
        return 1

    recovered = wait_for_recovery()
    events.append_event(LOG_DIR, "L2", "watchdog_revive_result",
                        {"recovered": recovered})
    return 0 if recovered else 1


if __name__ == "__main__":
    sys.exit(main())
