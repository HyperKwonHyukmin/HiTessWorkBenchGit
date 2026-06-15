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
from .activity_service import ACTIVITY_LOG_RETENTION_DAYS, prune_activity_logs

logger = logging.getLogger(__name__)

# userConnection/ 기준 경로: app/services/ → app/ → HiTessWorkBenchBackEnd/ → userConnection/
_SERVICES_DIR   = os.path.dirname(os.path.abspath(__file__))
_APP_DIR        = os.path.dirname(_SERVICES_DIR)
_BACKEND_DIR    = os.path.dirname(_APP_DIR)
_USER_CONN_DIR  = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))

RETENTION_DAYS  = 30


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
    except OSError as e:
        logger.error("[Cleanup] 디렉터리 목록 조회 실패: %s", e)
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
        except OSError as e:
            result["errors"].append({"folder": entry, "error": str(e)})
            logger.error("[Cleanup] 삭제 실패: %s — %s", entry, e)

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
    db = database.SessionLocal()
    try:
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
    except Exception as e:
        db.rollback()
        result["errors"].append(str(e))
        logger.error("[Cleanup] Activity Log 정리 실패: %s", e, exc_info=True)
    finally:
        db.close()
    return result


def run_all_cleanup(dry_run: bool = False) -> dict:
    """파일 작업 폴더와 Activity Log 보존 정책을 함께 적용합니다."""
    return {
        "user_connection": run_cleanup(dry_run=dry_run),
        "activity_logs": run_activity_log_cleanup(dry_run=dry_run),
    }


def _seconds_until_midnight() -> float:
    """다음 자정(00:00:00)까지 남은 초를 반환합니다."""
    now   = datetime.now()
    nxt   = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return (nxt - now).total_seconds()


def _cleanup_loop():
    """서버 시작 직후 1회 실행 → 이후 매일 자정에 반복 실행하는 데몬 루프."""
    # 서버 시작 직후 즉시 실행
    logger.info("[Cleanup] 서버 시작 — 초기 정리 실행")
    run_all_cleanup()

    while True:
        sleep_secs = _seconds_until_midnight()
        logger.info("[Cleanup] 다음 실행까지 %.0f초 대기 (다음 자정)", sleep_secs)
        time.sleep(sleep_secs)
        run_all_cleanup()


def start_cleanup_scheduler():
    """cleanup 데몬 스레드를 시작합니다. main.py의 startup 이벤트에서 호출하세요."""
    t = threading.Thread(target=_cleanup_loop, daemon=True, name="UserConnCleanup")
    t.start()
    logger.info("[Cleanup] 스케줄러 시작 (보존 기간: %d일)", RETENTION_DAYS)
