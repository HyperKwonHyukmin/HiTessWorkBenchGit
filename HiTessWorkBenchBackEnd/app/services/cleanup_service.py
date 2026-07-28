"""
userConnection/ 디렉터리 자동 정리 서비스.

서버 시작 시 즉시 1회 실행 후, 매일 자정(00:00)에 반복 실행됩니다.
생성된 지 30일이 경과한 하위 폴더를 안전하게 삭제합니다.
"""
import logging
import os
import shutil
import stat
import threading
import time
from datetime import datetime, timedelta

from .. import database, models
from ..sessions import session_store
from .activity_service import ACTIVITY_LOG_RETENTION_DAYS, prune_activity_logs

logger = logging.getLogger(__name__)

# userConnection/ 기준 경로: app/services/ → app/ → HiTessWorkBenchBackEnd/ → userConnection/
_SERVICES_DIR   = os.path.dirname(os.path.abspath(__file__))
_APP_DIR        = os.path.dirname(_SERVICES_DIR)
_BACKEND_DIR    = os.path.dirname(_APP_DIR)
_USER_CONN_DIR  = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))

RETENTION_DAYS  = 30

_scheduler_lock = threading.Lock()
_scheduler_stop = threading.Event()
_scheduler_thread: threading.Thread | None = None
_scheduler_generation = 0
_scheduler_desired_running = False


def _get_folder_age_days(folder_path: str) -> float:
    """
    폴더명의 타임스탬프(YYYYMMDDHHmmss 또는 YYYYMMDD_HHMMSS 형식)를 먼저 파싱하고,
    파싱 실패 시 OS stat의 생성/수정 시각 중 더 오래된 값을 사용합니다.
    """
    folder_name = os.path.basename(folder_path)

    # 폴더명 앞 14자리가 숫자면 타임스탬프로 간주
    prefix = folder_name.split("_")[0] if "_" in folder_name else folder_name[:14]
    try:
        if prefix.isdigit() and len(prefix) == 14:
            created = datetime.strptime(prefix, "%Y%m%d%H%M%S")
            return (datetime.now() - created).total_seconds() / 86400
    except ValueError:
        pass

    # fallback: stat 기반 (mtime/ctime 중 더 오래된 값)
    try:
        stat = os.stat(folder_path)
        oldest_ts = min(stat.st_mtime, getattr(stat, "st_birthtime", stat.st_ctime))
        return (time.time() - oldest_ts) / 86400
    except OSError:
        return 0.0


def _extended_path(path: str) -> str:
    r"""Windows 예약어(nul/con/aux…) 파일이나 260자 초과 긴 경로를 \\?\ 확장 경로로 우회한다.

    주의: os.path.abspath() 는 NUL/CON/PRN/AUX 등 예약명을 '\\.\nul' 디바이스 경로로
    변환해 버리므로 전체 경로에 적용하면 안 된다(폴더 정보가 사라짐). 디렉터리만
    정규화하고 basename(예약명일 수 있음)은 문자열로 그대로 결합한다.
    비Windows에서는 예약어 문제가 없으므로 경로를 그대로 반환한다.
    """
    if os.name != "nt" or path.startswith("\\\\?\\"):
        return path
    head, tail = os.path.split(path)
    head = os.path.abspath(head) if head else os.getcwd()
    return "\\\\?\\" + os.path.join(head, tail)


def _force_unlink(path: str) -> bool:
    """일반 경로 → 확장 경로 순으로 파일 강제 삭제. 읽기전용도 chmod 후 재시도."""
    for target in (path, _extended_path(path)):
        try:
            os.chmod(target, stat.S_IWRITE)
        except OSError:
            pass
        try:
            os.unlink(target)
            return True
        except OSError:
            continue
    return False


def _force_rmdir(path: str) -> bool:
    for target in (path, _extended_path(path)):
        try:
            os.rmdir(target)
            return True
        except OSError:
            continue
    return False


def _force_rmtree(path: str) -> None:
    r"""폴더 트리 삭제. 일반 shutil.rmtree 가 실패하면(예: Win32 예약어 'nul' 파일로
    [WinError 87], 읽기전용 파일로 PermissionError) 하위 항목을 확장 경로(\\?\)로
    개별 강제 삭제한 뒤 폴더를 제거한다."""
    try:
        shutil.rmtree(path)
        return
    except OSError:
        pass
    # 폴백: 깊은 곳부터 개별 강제 삭제
    for root, dirs, files in os.walk(path, topdown=False):
        for name in files:
            _force_unlink(os.path.join(root, name))
        for name in dirs:
            _force_rmdir(os.path.join(root, name))
    if not _force_rmdir(path) and os.path.exists(_extended_path(path)):
        raise OSError(f"폴더 제거 실패(잔여 항목 존재): {path}")


def run_cleanup(dry_run: bool = False) -> dict:
    """
    userConnection/ 하위의 30일 초과 폴더를 삭제합니다.

    Parameters
    ----------
    dry_run : bool
        True이면 실제 삭제 없이 대상 목록만 반환합니다.

    Returns
    -------
    dict
        { "deleted": [...], "errors": [...], "skipped": int }
    """
    result = {"deleted": [], "errors": [], "skipped": 0}

    if not os.path.isdir(_USER_CONN_DIR):
        logger.warning("[Cleanup] userConnection 디렉터리가 존재하지 않습니다: %s", _USER_CONN_DIR)
        return result

    try:
        entries = os.listdir(_USER_CONN_DIR)
    except OSError as exc:
        logger.error(
            "[Cleanup] 디렉터리 목록 조회 실패 (%s)",
            type(exc).__name__,
        )
        return result

    for entry in entries:
        folder_path = os.path.join(_USER_CONN_DIR, entry)
        if not os.path.isdir(folder_path):
            continue

        age_days = _get_folder_age_days(folder_path)

        if age_days < RETENTION_DAYS:
            result["skipped"] += 1
            continue

        if dry_run:
            result["deleted"].append({"folder": entry, "age_days": round(age_days, 1)})
            continue

        try:
            _force_rmtree(folder_path)
            result["deleted"].append({"folder": entry, "age_days": round(age_days, 1)})
            logger.info("[Cleanup] 삭제 완료: %s (%.1f일 경과)", entry, age_days)
        except OSError as exc:
            error_type = type(exc).__name__
            result["errors"].append({
                "folder": entry,
                "error": "filesystem_cleanup_failed",
                "error_type": error_type,
            })
            logger.error(
                "[Cleanup] 삭제 실패: %s (%s)",
                entry,
                error_type,
            )

    logger.info(
        "[Cleanup] 완료 — 삭제: %d개, 오류: %d개, 유지: %d개",
        len(result["deleted"]), len(result["errors"]), result["skipped"],
    )
    return result


def run_activity_log_cleanup(dry_run: bool = False) -> dict:
    """
    activity_logs 테이블에서 30일 초과 로그를 삭제합니다.

    Parameters
    ----------
    dry_run : bool
        True이면 삭제하지 않고 대상 건수만 반환합니다.
    """
    result = {"deleted": 0, "errors": []}
    db = None
    try:
        db = database.SessionLocal()
        cutoff = datetime.now() - timedelta(days=ACTIVITY_LOG_RETENTION_DAYS)
        if dry_run:
            result["deleted"] = (
                db.query(models.ActivityLog)
                .filter(models.ActivityLog.created_at < cutoff)
                .count()
            )
        else:
            result["deleted"] = prune_activity_logs(db)
        logger.info("[Cleanup] Activity Log 정리 완료 — 삭제: %d건", result["deleted"])
    except Exception as exc:
        if db is not None:
            try:
                db.rollback()
            except Exception:
                pass
        # DB driver 오류 원문에는 접속 정보가 포함될 수 있어 type만 기록한다.
        error_type = type(exc).__name__
        result["errors"].append(error_type)
        logger.error("[Cleanup] Activity Log 정리 실패 (%s)", error_type)
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                logger.warning("[Cleanup] Activity Log DB session close failed")
    return result


def run_session_cleanup(dry_run: bool = False) -> dict:
    """
    user_sessions 테이블에서 만료된 세션을 삭제합니다.

    Parameters
    ----------
    dry_run : bool
        True이면 삭제하지 않고 대상 건수만 반환합니다.
    """
    result = {
        "deleted": 0,
        "errors": [],
        "success": True,
        "error": None,
        "error_type": None,
    }
    try:
        if dry_run:
            db = database.SessionLocal()
            try:
                result["deleted"] = (
                    db.query(models.UserSession)
                    .filter(models.UserSession.expires_at < datetime.now())
                    .count()
                )
            finally:
                db.close()
        else:
            result["deleted"] = session_store.cleanup_expired()
        logger.info("[Cleanup] Session 정리 완료 — 삭제: %d건", result["deleted"])
    except Exception as exc:
        error_type = type(exc).__name__
        result.update({
            "success": False,
            "error": "session_cleanup_failed",
            "error_type": error_type,
        })
        result["errors"].append("session_cleanup_failed")
        logger.error("[Cleanup] Session 정리 실패 (%s)", error_type)
    return result


def run_all_cleanup(dry_run: bool = False) -> dict:
    """파일 작업 폴더, Activity Log, 만료 세션 보존 정책을 함께 적용합니다."""
    return {
        "user_connection": run_cleanup(dry_run=dry_run),
        "activity_logs": run_activity_log_cleanup(dry_run=dry_run),
        "sessions": run_session_cleanup(dry_run=dry_run),
    }


def _seconds_until_midnight() -> float:
    """다음 자정(00:00:00)까지 남은 초를 반환합니다."""
    now   = datetime.now()
    nxt   = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return (nxt - now).total_seconds()


def _cleanup_loop(stop_event: threading.Event):
    """서버 시작 직후 1회 실행 → 이후 매일 자정에 반복 실행하는 데몬 루프."""
    if stop_event.is_set():
        return
    # 서버 시작 직후 즉시 실행
    logger.info("[Cleanup] 서버 시작 — 초기 정리 실행")
    run_all_cleanup()

    while not stop_event.is_set():
        sleep_secs = _seconds_until_midnight()
        logger.info("[Cleanup] 다음 실행까지 %.0f초 대기 (다음 자정)", sleep_secs)
        if stop_event.wait(sleep_secs):
            break
        run_all_cleanup()


def _scheduler_entry(stop_event: threading.Event, generation: int) -> None:
    """한 scheduler generation을 실행하고 pending restart를 정확히 한 번 handoff합니다."""
    global _scheduler_desired_running, _scheduler_generation, _scheduler_thread
    unexpected_exit = False
    try:
        _cleanup_loop(stop_event)
        # 실제 loop는 stop 요청 외에는 반환하지 않는다. 조기 반환도 crash와 동일하게
        # 처리해 desired-running auto-respawn의 tight loop를 막는다.
        unexpected_exit = not stop_event.is_set()
    except Exception as exc:
        unexpected_exit = True
        # 오류 원문에는 DB URL/파일 경로가 포함될 수 있어 type만 기록한다.
        logger.error(
            "[Cleanup] 스케줄러가 예기치 않게 중단되었습니다 (%s)",
            type(exc).__name__,
        )
    finally:
        current = threading.current_thread()
        with _scheduler_lock:
            # 이미 더 최신 thread가 current로 등록됐다면 오래된 generation은 건드리지 않는다.
            if _scheduler_thread is current:
                _scheduler_thread = None
                if unexpected_exit:
                    # 안전 우선: crash generation의 pending restart를 폐기하고 정지한다.
                    # 다음 명시적 lifespan start만 새 generation을 만들 수 있다.
                    _scheduler_desired_running = False
                    _scheduler_generation += 1
                elif _scheduler_desired_running:
                    _spawn_scheduler_locked(_scheduler_generation)


def _spawn_scheduler_locked(generation: int) -> None:
    """_scheduler_lock 보유 상태에서 새 generation thread를 등록·시작합니다."""
    global _scheduler_stop, _scheduler_thread
    _scheduler_stop = threading.Event()
    _scheduler_thread = threading.Thread(
        target=_scheduler_entry,
        args=(_scheduler_stop, generation),
        daemon=True,
        name="UserConnCleanup",
    )
    _scheduler_thread.start()


def start_cleanup_scheduler() -> bool:
    """scheduler의 desired-running 전환을 요청합니다.

    True는 새 실행이 즉시 시작됐거나, 종료 중인 old generation 뒤의 handoff 요청이
    새로 접수됐음을 뜻합니다. 이미 desired-running이면 False입니다.
    """
    global _scheduler_desired_running, _scheduler_generation
    with _scheduler_lock:
        if _scheduler_desired_running:
            return False
        _scheduler_desired_running = True
        _scheduler_generation += 1
        generation = _scheduler_generation
        thread = _scheduler_thread
        if thread is None or not thread.is_alive():
            _spawn_scheduler_locked(generation)
            message = "시작"
        else:
            # old thread의 stop_event가 이미 set된 종료 중 상태다. finally handoff가
            # 현재 generation/desired state를 보고 정확히 하나를 이어서 시작한다.
            message = "재시작 예약"
    logger.info(
        "[Cleanup] 스케줄러 %s (generation=%d, 보존 기간=%d일)",
        message,
        generation,
        RETENTION_DAYS,
    )
    return True


def shutdown_cleanup_scheduler(timeout: float = 2.0) -> bool:
    """cleanup daemon 중지를 요청합니다.

    timeout 안에 종료되지 않으면 False를 반환하고 thread 참조를 유지합니다. 그 동안
    start는 중복 daemon을 만들지 않으며, 기존 thread가 끝난 뒤에는 다시 시작할 수 있습니다.
    """
    global _scheduler_desired_running, _scheduler_generation, _scheduler_thread
    with _scheduler_lock:
        _scheduler_desired_running = False
        _scheduler_generation += 1
        thread = _scheduler_thread
        if thread is None:
            return False
        _scheduler_stop.set()
    if thread is not threading.current_thread():
        thread.join(timeout=timeout)
    with _scheduler_lock:
        if thread.is_alive():
            logger.warning("[Cleanup] 스케줄러가 %.1f초 안에 종료되지 않았습니다.", timeout)
            return False
        if _scheduler_thread is thread:
            _scheduler_thread = None
    logger.info("[Cleanup] 스케줄러 중지 요청 완료")
    return True
