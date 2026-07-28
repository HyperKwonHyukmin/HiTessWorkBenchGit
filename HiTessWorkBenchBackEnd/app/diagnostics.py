"""백엔드 비정상 종료(무-로그 급사) 진단·방어 모듈.

증상: uvicorn 프로세스가 아무 로그도 남기지 않고 갑자기 사라진다(정상 종료 시 남는
`Shutting down` 로그조차 없음). 정상 종료가 아니라 **강제 종료**라는 뜻이며, 가능한 원인은:

  1) 자식 subprocess(Abaqus/Nastran 등 외부 solver)의 콘솔 제어신호(CTRL_C/CTRL_BREAK)가
     같은 콘솔을 공유하는 uvicorn까지 함께 종료시킴.
     → Windows 콘솔 컨트롤 핸들러를 설치해 CTRL_C/CTRL_BREAK를 무시(서버 보호)한다.
       Server Manager의 Stop은 TerminateProcess 라 이 핸들러의 영향을 받지 않으므로
       정상적인 서버 중지/재시작에는 지장이 없다.

  2) 네이티브 C확장(numpy·pywin32·pymysql 등)의 access violation → 파이썬 트레이스백
     없이 프로세스 즉사.
     → faulthandler 로 네이티브+파이썬 스택을 크래시 로그 파일에 덤프해 원인 모듈을 특정한다.

  3) 메모리 고갈(OOM) → OS 가 프로세스를 강제 종료.
     → 메모리 워치독이 주기적으로 RSS 를 로그에 남겨 종료 직전 메모리 추세를 확인한다.

또한 uvicorn 의 모든 로그를 회전 로그 파일에도 기록해, GUI 로그창이 사라져도 '종료 직전
마지막 줄'이 디스크에 보존되게 한다.

이 모듈은 어떤 경우에도 서버 자체를 죽여선 안 되므로, 모든 설치 단계는 예외를 삼킨다.
"""
import faulthandler
import logging
import os
import threading
import time
from logging.handlers import RotatingFileHandler

logger = logging.getLogger(__name__)

# HiTessWorkBenchBackEnd/logs/
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_LOG_DIR = os.path.join(_BACKEND_DIR, "logs")
_CRASH_LOG = os.path.join(_LOG_DIR, "backend_crash.log")
_SERVER_LOG = os.path.join(_LOG_DIR, "backend.log")

# faulthandler 가 프로세스 수명 내내 쓸 수 있도록 파일 핸들을 살려둔다(전역 참조).
_crash_fp = None
# SetConsoleCtrlHandler 콜백이 GC 되지 않도록 전역 참조 유지.
_ctrl_handler_ref = None
_install_lock = threading.Lock()
_installed_pid = None

_MEM_WATCH_INTERVAL_SEC = 300  # 5분마다 RSS 기록


def _ensure_log_dir() -> bool:
    try:
        os.makedirs(_LOG_DIR, exist_ok=True)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("로그 디렉터리 생성 실패(%s): %s", _LOG_DIR, exc)
        return False


def _crash_note(message: str) -> None:
    """크래시 로그 파일에 한 줄 기록(진단 이벤트 표시용)."""
    if _crash_fp is None:
        return
    try:
        _crash_fp.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}\n")
        _crash_fp.flush()
    except Exception:  # noqa: BLE001
        pass


def _install_faulthandler() -> None:
    """네이티브 크래시(SIGSEGV/SIGABRT 등) 발생 시 스택을 크래시 로그에 덤프."""
    global _crash_fp
    try:
        _crash_fp = open(_CRASH_LOG, "a", buffering=1, encoding="utf-8", errors="replace")
        _crash_fp.write(
            f"\n===== 백엔드 시작 {time.strftime('%Y-%m-%d %H:%M:%S')} (pid={os.getpid()}) =====\n"
        )
        _crash_fp.flush()
        faulthandler.enable(file=_crash_fp, all_threads=True)
        logger.info("[diag] faulthandler 활성화 → %s", _CRASH_LOG)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[diag] faulthandler 설치 실패: %s", exc)


def _install_file_logging() -> None:
    """root/uvicorn 로거에 회전 파일 핸들러를 붙여 모든 로그를 디스크에 보존."""
    try:
        handler = RotatingFileHandler(
            _SERVER_LOG, maxBytes=5_000_000, backupCount=5,
            encoding="utf-8", errors="replace",
        )
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
        )
        handler.setLevel(logging.INFO)

        root = logging.getLogger()
        if root.level == logging.NOTSET or root.level > logging.INFO:
            root.setLevel(logging.INFO)
        root.addHandler(handler)
        # uvicorn 은 자체 로거를 쓰므로 명시적으로 핸들러를 추가한다.
        for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
            logging.getLogger(name).addHandler(handler)
        logger.info("[diag] 파일 로깅 활성화 → %s", _SERVER_LOG)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[diag] 파일 로깅 설치 실패: %s", exc)


def _install_console_ctrl_guard() -> None:
    """자식 solver 가 던지는 CTRL_C/CTRL_BREAK 로부터 uvicorn 프로세스를 보호(Windows 전용).

    같은 콘솔을 공유하는 자식(Abaqus/Nastran 등)이 종료되며 CTRL_BREAK 를 발생시키면
    콘솔에 붙은 모든 프로세스가 이 신호를 받는데, uvicorn 이 이를 받으면 정상 종료 절차
    없이 즉시 죽는다("무-로그 급사"). 여기서 핸들러가 True 를 반환해 uvicorn 프로세스에
    한해 신호를 삼킨다(자식 solver 는 각자의 핸들러 체인을 가지므로 영향 없음).
    """
    if os.name != "nt":
        return
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32
        CTRL_C_EVENT = 0
        CTRL_BREAK_EVENT = 1

        # BOOL WINAPI HandlerRoutine(DWORD dwCtrlType)
        HANDLER = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)

        def _handler(ctrl_type):  # noqa: ANN001, ANN202
            if ctrl_type in (CTRL_C_EVENT, CTRL_BREAK_EVENT):
                _crash_note(
                    f"[guard] 콘솔 신호(ctrl_type={ctrl_type}) 무시 — 서버 유지"
                )
                return True  # 처리됨 → 전파 차단(프로세스 종료 방지)
            # CTRL_CLOSE/LOGOFF/SHUTDOWN 은 정상 처리에 맡긴다(시스템 종료 존중).
            return False

        global _ctrl_handler_ref
        _ctrl_handler_ref = HANDLER(_handler)
        if not kernel32.SetConsoleCtrlHandler(_ctrl_handler_ref, True):
            logger.warning("[diag] SetConsoleCtrlHandler 등록 실패")
        else:
            logger.info("[diag] 콘솔 CTRL_C/CTRL_BREAK 가드 설치 완료")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[diag] 콘솔 가드 설치 실패: %s", exc)


def _memory_watchdog_loop() -> None:
    try:
        import psutil
    except Exception:  # noqa: BLE001
        logger.info("[diag] psutil 없음 — 메모리 워치독 비활성")
        return

    proc = psutil.Process(os.getpid())
    peak_mb = 0.0
    while True:
        try:
            time.sleep(_MEM_WATCH_INTERVAL_SEC)
            rss_mb = proc.memory_info().rss / (1024 * 1024)
            vm = psutil.virtual_memory()
            avail_mb = vm.available / (1024 * 1024)
            if rss_mb > peak_mb:
                peak_mb = rss_mb
            msg = (
                f"[diag][mem] RSS={rss_mb:.0f}MB peak={peak_mb:.0f}MB "
                f"system_avail={avail_mb:.0f}MB used={vm.percent:.0f}%"
            )
            logger.info(msg)
            # 시스템 여유 메모리가 매우 낮으면 OOM 위험 경고(종료 직전 흔적 남기기).
            if avail_mb < 512 or vm.percent >= 95:
                _crash_note(f"[mem][WARN] OOM 위험 — {msg}")
        except Exception:  # noqa: BLE001
            # 워치독은 절대 서버에 영향 주지 않는다.
            time.sleep(_MEM_WATCH_INTERVAL_SEC)


def _start_memory_watchdog() -> None:
    try:
        t = threading.Thread(target=_memory_watchdog_loop, daemon=True, name="MemWatchdog")
        t.start()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[diag] 메모리 워치독 시작 실패: %s", exc)


def install_crash_diagnostics() -> None:
    """비정상 종료 진단·방어 일체를 현재 프로세스에 한 번만 설치합니다."""
    disabled = os.environ.get("WORKBENCH_DISABLE_CRASH_DIAGNOSTICS", "").strip().lower()
    if disabled in {"1", "true", "yes", "on"}:
        return

    global _installed_pid
    current_pid = os.getpid()
    with _install_lock:
        if _installed_pid == current_pid:
            return
        # 설치 도중 재진입하거나 일부 optional 단계가 실패하더라도 handler/watchdog를
        # 중복으로 추가하지 않도록 먼저 표시한다. 각 설치 함수는 자체적으로 실패를 기록한다.
        _installed_pid = current_pid
        if not _ensure_log_dir():
            return
        _install_faulthandler()
        _install_file_logging()
        _install_console_ctrl_guard()
        _start_memory_watchdog()
