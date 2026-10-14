"""사내 PLM(VT_PLM_USER) 기준으로 users 테이블의 이름·회사·부서·직책·메일을 리프레시한다.

세 가지 트리거가 모두 **같은 적용 로직**(``apply_plm_profile`` + ``sync_users``)을 쓴다:
- 관리자 수동 — 단건 ``POST /api/users/{id}/sync-plm`` / 전체 ``POST /api/users/sync-plm-all``
- CLI — ``scripts/sync_user_directory.py``
- 주기 스케줄러 — 매주 월요일 03:00 Asia/Seoul 1회

안전 규약(사용자 요청)
--------------------
- PLM 조회가 아예 실패하거나 사번이 PLM 에 없으면 → **그 사용자의 전 필드 유지**(그대로)
- 특정 필드만 PLM 에서 비어 있으면 → **그 필드만 유지**, 나머지는 반영
- 사용자가 승인(``is_active``)·권한(``is_admin``/``is_developer``)·사번 등은 **절대 건드리지 않는다**
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from .. import database, models
from .plm_user_directory import fetch_plm_profile, is_configured

logger = logging.getLogger(__name__)

# user_directory_sync 가 PLM 에서 가져와 **덮어 쓸 수 있는** users 컬럼 화이트리스트.
# 여기 밖의 필드(사번·권한·승인·접속 통계)는 어떤 경로로도 리프레시 대상이 아니다.
MUTABLE_FIELDS: tuple[str, ...] = ("email", "name", "company", "department", "position")

# 주기 스케줄: 매주 월요일 03:00 Asia/Seoul.
_SCHEDULE_WEEKDAY = 0   # 월요일(datetime.weekday 기준)
_SCHEDULE_HOUR = 3
_SCHEDULE_MINUTE = 0


# ---------------------------------------------------------------------------
# 결과 요약 자료구조
# ---------------------------------------------------------------------------


@dataclass
class UserSyncOutcome:
    """사용자 1명 리프레시 결과. CLI/라우터 응답에서 공통으로 쓴다."""

    employee_id: str
    name: Optional[str]
    status: str   # updated | unchanged | missing | error
    changes: dict[str, tuple[Optional[str], Optional[str]]] = field(default_factory=dict)
    reason: Optional[str] = None


@dataclass
class SyncSummary:
    """``sync_users`` 전체 실행 결과 집계."""

    total: int = 0
    updated: int = 0
    unchanged: int = 0
    missing: int = 0   # PLM 미등록 또는 조회 실패 — '유지'로 끝남
    errors: int = 0
    dry_run: bool = False
    outcomes: list[UserSyncOutcome] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "total": self.total,
            "updated": self.updated,
            "unchanged": self.unchanged,
            "missing": self.missing,
            "errors": self.errors,
            "dryRun": self.dry_run,
        }


# ---------------------------------------------------------------------------
# 핵심 적용 로직
# ---------------------------------------------------------------------------


def apply_plm_profile(
    user: models.User,
    profile: Optional[dict],
) -> dict[str, tuple[Optional[str], Optional[str]]]:
    """PLM 프로필 1건을 사용자 모델에 반영한다. 변경 전/후 쌍만 돌려준다(커밋은 호출자).

    - ``profile`` 이 ``None`` 또는 빈 dict 면 아무 것도 바꾸지 않는다(=기존 값 유지).
    - 각 필드가 ``None``·빈 문자열이면 그 필드도 유지한다.
    - 반환 dict 는 **실제로 바뀐 필드만** 담는다({필드명: (이전값, 신규값)}).
    """
    if not profile:
        return {}
    changes: dict[str, tuple[Optional[str], Optional[str]]] = {}
    for field_name in MUTABLE_FIELDS:
        if field_name not in profile:
            continue
        new_value = profile.get(field_name)
        if new_value is None:
            continue
        new_text = str(new_value).strip()
        if not new_text:
            continue
        current = getattr(user, field_name, None)
        current_text = (current or "").strip() if isinstance(current, str) else current
        if current_text == new_text:
            continue
        setattr(user, field_name, new_text)
        changes[field_name] = (current_text or None, new_text)
    return changes


def _resolve_target_users(
    db: Session,
    employee_ids: Optional[Iterable[str]] = None,
) -> list[models.User]:
    """리프레시 대상 사용자 목록을 돌려준다. 사번 미지정 시 전체."""
    query = db.query(models.User)
    if employee_ids is not None:
        normalized = [eid.strip().upper() for eid in employee_ids if eid and eid.strip()]
        if not normalized:
            return []
        query = query.filter(models.User.employee_id.in_(normalized))
    return query.order_by(models.User.employee_id.asc()).all()


def sync_users(
    db: Session,
    *,
    employee_ids: Optional[Iterable[str]] = None,
    dry_run: bool = False,
) -> SyncSummary:
    """지정한 사용자들(기본: 전체)의 PLM 정보를 리프레시한다.

    트랜잭션은 전체를 1회 커밋한다 — 중간에 오류가 나도 그 사용자만 롤백 효과,
    나머지는 성공 반영. 조회 자체가 실패해 ``None`` 이면 그 사용자는 '유지'로 끝난다.
    """
    users = _resolve_target_users(db, employee_ids)
    summary = SyncSummary(total=len(users), dry_run=dry_run)
    if not users:
        return summary

    for user in users:
        eid = user.employee_id
        try:
            profile = fetch_plm_profile(eid)
        except Exception as exc:  # noqa: BLE001 — fetch 는 자체 삼킴
            summary.errors += 1
            summary.outcomes.append(
                UserSyncOutcome(employee_id=eid, name=user.name, status="error", reason=str(exc))
            )
            continue

        if not profile:
            summary.missing += 1
            summary.outcomes.append(
                UserSyncOutcome(
                    employee_id=eid, name=user.name, status="missing",
                    reason="PLM 미등록 또는 조회 실패 — 기존 값 유지",
                )
            )
            continue

        changes = apply_plm_profile(user, profile)
        if not changes:
            summary.unchanged += 1
            summary.outcomes.append(
                UserSyncOutcome(employee_id=eid, name=user.name, status="unchanged")
            )
            continue

        summary.updated += 1
        summary.outcomes.append(
            UserSyncOutcome(
                employee_id=eid, name=user.name, status="updated", changes=changes,
            )
        )

    if dry_run:
        db.rollback()
    elif summary.updated > 0:
        db.commit()
    else:
        db.rollback()  # 변경이 없으면 세션을 깨끗이 끝낸다
    return summary


# ---------------------------------------------------------------------------
# 주기 스케줄러 (cleanup_service 패턴 축소판)
# ---------------------------------------------------------------------------


_scheduler_lock = threading.Lock()
_scheduler_stop = threading.Event()
_scheduler_thread: threading.Thread | None = None
_scheduler_generation = 0
_scheduler_desired_running = False


def _seconds_until_next_run(now: Optional[datetime] = None) -> float:
    """다음 '월요일 03:00' 까지 남은 초. 지금이 월요일 03:00 이후면 다음 주 월요일."""
    current = now or datetime.now()
    days_ahead = (_SCHEDULE_WEEKDAY - current.weekday()) % 7
    candidate = current.replace(
        hour=_SCHEDULE_HOUR, minute=_SCHEDULE_MINUTE, second=0, microsecond=0,
    ) + timedelta(days=days_ahead)
    if candidate <= current:
        candidate += timedelta(days=7)
    return max(1.0, (candidate - current).total_seconds())


def run_scheduled_sync() -> SyncSummary:
    """스케줄러에서 호출되는 전체 리프레시 작업 — 세션 생성·종료까지 책임진다."""
    if not is_configured():
        logger.info("[UserDirSync] PLM 설정이 없어 스케줄 리프레시를 건너뜁니다")
        return SyncSummary()
    db = database.SessionLocal()
    try:
        summary = sync_users(db)
        logger.info(
            "[UserDirSync] 주기 리프레시 완료 — 전체 %d · 갱신 %d · 유지 %d · 미등록 %d · 오류 %d",
            summary.total, summary.updated, summary.unchanged, summary.missing, summary.errors,
        )
        return summary
    except Exception as exc:  # noqa: BLE001 — 스케줄러를 죽이지 않는다
        logger.error("[UserDirSync] 주기 리프레시 중 예외: %s", type(exc).__name__)
        try:
            db.rollback()
        except Exception:
            pass
        return SyncSummary()
    finally:
        db.close()


def _loop(stop_event: threading.Event) -> None:
    """매주 월요일 03:00 KST 에 ``run_scheduled_sync`` 1회 실행."""
    while not stop_event.is_set():
        sleep_secs = _seconds_until_next_run()
        logger.info(
            "[UserDirSync] 다음 주기 리프레시까지 %.0f초 (월요일 03:00 KST)", sleep_secs,
        )
        if stop_event.wait(sleep_secs):
            break
        if stop_event.is_set():
            break
        run_scheduled_sync()


def _scheduler_entry(stop_event: threading.Event, generation: int) -> None:
    """cleanup_service 와 같은 generation handoff 패턴. 안전 재시작·조기 종료 처리."""
    global _scheduler_desired_running, _scheduler_generation, _scheduler_thread
    unexpected_exit = False
    try:
        _loop(stop_event)
        unexpected_exit = not stop_event.is_set()
    except Exception as exc:  # noqa: BLE001
        unexpected_exit = True
        logger.error(
            "[UserDirSync] 스케줄러가 예기치 않게 중단되었습니다 (%s)", type(exc).__name__,
        )
    finally:
        current = threading.current_thread()
        with _scheduler_lock:
            if _scheduler_thread is current:
                _scheduler_thread = None
                if unexpected_exit:
                    _scheduler_desired_running = False
                    _scheduler_generation += 1
                elif _scheduler_desired_running:
                    _spawn_scheduler_locked(_scheduler_generation)


def _spawn_scheduler_locked(generation: int) -> None:
    global _scheduler_stop, _scheduler_thread
    _scheduler_stop = threading.Event()
    _scheduler_thread = threading.Thread(
        target=_scheduler_entry,
        args=(_scheduler_stop, generation),
        daemon=True,
        name="UserDirectorySync",
    )
    _scheduler_thread.start()


def start_user_directory_sync_scheduler() -> bool:
    """스케줄러 desired-running 전환. True = 새로 시작했거나 handoff 접수."""
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
            message = "재시작 예약"
    logger.info("[UserDirSync] 스케줄러 %s (generation=%d)", message, generation)
    return True


def shutdown_user_directory_sync_scheduler(timeout: float = 2.0) -> bool:
    """스케줄러 중지 요청. timeout 안에 종료되지 않으면 False."""
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
            logger.warning("[UserDirSync] 스케줄러가 %.1f초 안에 종료되지 않았습니다", timeout)
            return False
        if _scheduler_thread is thread:
            _scheduler_thread = None
    logger.info("[UserDirSync] 스케줄러 중지 완료")
    return True
