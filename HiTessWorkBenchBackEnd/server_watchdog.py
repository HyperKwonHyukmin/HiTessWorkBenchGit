"""L2 워치독 — 작업 스케줄러가 5분마다 실행하는 비상주 단발 스크립트.

L1(server_manager.py) 이 죽었을 때 런처를 다시 띄우는 것이 유일한 임무다.
상주하지 않으므로 "워치독이 죽으면 누가 감시하나"라는 질문이 없다 — 최종
감시자는 OS(작업 스케줄러)다. 매 실행은 판정 → 행동 → 종료로 끝난다.

⚠ 경계 규칙: uvicorn 을 절대 직접 건드리지 않는다. L1 이 살아 있으면 아무
것도 하지 않고 즉시 종료한다. 재시작 권한을 L1 에만 두어, 두 계층이 동시에
재시작을 시도하는 경합을 원천 차단한다.

⚠ 파일명이 watchdog.py 가 아닌 이유: PyPI 에 `watchdog` 패키지가 있어, 백엔드
루트(uvicorn 의 cwd)에 watchdog.py 를 두면 그 import 를 섀도잉한다. 지금
직접 의존이 없더라도 어떤 서드파티가 `import watchdog` 를 하는 순간 백엔드가
깨지므로, 이름 충돌 자체를 피한다.
"""
import json
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
STARTUP_GRACE_SEC = 30            # 재기동 후 헬스 확인까지 기다리는 시간


def is_manager_alive(pid, *, proc_factory=psutil.Process, marker=MANAGER_MARKER):
    """PID 가 가리키는 프로세스가 정말 L1 인지 판정한다.

    ★ cmdline 대조가 필수인 이유: Windows 는 PID 를 재활용한다. 생존 여부만
    보면 L1 이 죽은 뒤 같은 PID 를 물려받은 무관한 프로세스를 L1 으로 오인해
    '살아있음' → noop 이 되고, 워치독은 영원히 복구하지 않는다.

    조회 자체가 실패하는 경우(NoSuchProcess/AccessDenied 등)는 모두 '살아있다고
    볼 근거 없음'으로 취급한다 — 여기서 예외를 전파하면 워치독이 죽어버려
    복구 기회 자체가 사라진다.
    """
    if not pid:
        return False
    try:
        proc = proc_factory(pid)
        if not proc.is_running():
            return False
        return marker in " ".join(proc.cmdline())
    except Exception:
        return False


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

    쓰기 실패는 삼킨다 — 기록에 실패했다고 복구를 막을 이유가 없다. 대신
    이력이 남지 않아 폭주 억제(giveup 판정)가 느슨해질 수 있는데, 그건
    '재기동을 아예 못 하는' 상태보다 낫다.
    """
    now = time.time() if now is None else now
    history = [ts for ts in read_revive_history(log_dir) if now - ts < window_sec]
    history.append(now)

    try:
        path = Path(log_dir)
        path.mkdir(parents=True, exist_ok=True)
        (path / STATE_FILENAME).write_text(
            json.dumps({"revives": history}), encoding="utf-8"
        )
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

    http_ok 면 역시 noop 이다. L1 없이 누군가 uvicorn 만 수동으로 띄운
    경우인데, 사용자가 원하는 서비스는 이미 제공되고 있다.
    """
    if manager_alive:
        return "noop"
    if http_ok:
        return "noop"
    if sum(1 for ts in revive_history if now - ts < window_sec) >= max_revives:
        return "giveup"
    return "revive"


def revive():
    """런처를 현재 프로세스에서 분리해 실행한다.

    워치독은 30초 뒤 종료되므로 자식이 딸려 죽으면 안 된다. DETACHED_PROCESS 로
    cmd 를 떼어내고, `start` 가 bat 에 새 콘솔을 붙여 GUI 가 뜨게 한다
    (워치독 자신은 pythonw.exe 로 실행되어 콘솔이 없다).
    """
    subprocess.Popen(["cmd", "/c", "start", "", str(LAUNCHER)],
                     cwd=str(BASE_DIR),
                     creationflags=subprocess.DETACHED_PROCESS,
                     close_fds=True)


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
                            {"error": f"{type(exc).__name__}: {exc}"})
        return 1

    manager_alive = is_manager_alive(pid)
    http_ok = health.probe() if not manager_alive else False
    action = decide_action(
        manager_alive=manager_alive,
        http_ok=http_ok,
        revive_history=read_revive_history(LOG_DIR),
        now=now,
    )

    if action == "noop":
        return 0

    if action == "giveup":
        # 창 안에서 이미 한도만큼 시도했다. 계속 띄우면 실패하는 기동을 5분마다
        # 반복할 뿐이므로, 사람이 볼 기록만 남기고 멈춘다.
        events.append_event(LOG_DIR, "L2", "watchdog_giveup",
                            {"window_sec": REVIVE_WINDOW_SEC,
                             "max_revives": MAX_REVIVES_IN_WINDOW})
        return 1

    events.append_event(LOG_DIR, "L2", "watchdog_revive", {"launcher": str(LAUNCHER)})
    record_revive(LOG_DIR, now=now)
    revive()
    time.sleep(STARTUP_GRACE_SEC)
    recovered = health.probe()
    events.append_event(LOG_DIR, "L2", "watchdog_revive_result",
                        {"recovered": recovered})
    return 0 if recovered else 1


if __name__ == "__main__":
    sys.exit(main())
