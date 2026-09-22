"""알림 센터 — 서버가 사용자에게 남기는 인앱 알림의 단일 생성 창구(마스터 설계 §2.1).

다른 plan(보관 만료·취소·공유·배치·기능요청) 은 아래 규약으로 지연 import 해서 호출한다:

    try:
        from app.services.notification_service import notify
    except ImportError:
        notify = None

그래야 이 모듈 없이도 각 plan 이 단독으로 동작한다. 이 모듈은 다른 plan 의 영역을
구현하지 않는다 — user_preferences 는 읽기만(쓰기는 Plan E).
"""
import logging
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from .. import models
from .program_registry import resolve_program

logger = logging.getLogger(__name__)

# kind 어휘는 고정이다(마스터 §2.1). 새 kind 는 마스터 문서를 먼저 고친다.
NOTIFICATION_KINDS = frozenset({
    "job.completed",
    "job.failed",
    "job.cancelled",
    # "retention.expiring" 은 제거했다 — 만료 임박을 알림으로 알리지 않는다(사용자 결정
    # 2026-09-22). 남은 일수는 My Projects 화면 카드·배지로만 보여 준다.
    "retention.expired",
    "batch.completed",
    "share.received",
    "feature_request.status_changed",
    "notice.published",
})

NOTIFICATION_RETENTION_DAYS = 90
TITLE_MAX_LEN = 200
BODY_MAX_LEN = 1000
DEFAULT_NOTIFICATION_PREFS = {"muted_kinds": [], "desktop_toast": True}

# _write_through 가 알림을 남기는 종료 상태. Interrupted(서버 재시작)는 raw UPDATE 라 여기 안 온다.
_TERMINAL_KIND_BY_STATUS = {"Success": "job.completed", "Failed": "job.failed"}


def get_notification_prefs(db: Session, employee_id: str) -> dict:
    """user_preferences.prefs["notifications"] 를 읽어 {"muted_kinds", "desktop_toast"} 로 정규화한다.

    행이 없거나 형식이 틀리면 기본값. Plan E 이전에도 안전하게 동작해야 하므로 어떤 값도 믿지 않는다.
    """
    prefs = {"muted_kinds": list(DEFAULT_NOTIFICATION_PREFS["muted_kinds"]),
             "desktop_toast": DEFAULT_NOTIFICATION_PREFS["desktop_toast"]}
    row = (
        db.query(models.UserPreference)
        .filter(models.UserPreference.employee_id == employee_id)
        .first()
    )
    raw = (row.prefs or {}).get("notifications") if row and isinstance(row.prefs, dict) else None
    if not isinstance(raw, dict):
        return prefs
    muted = raw.get("muted_kinds")
    if isinstance(muted, list):
        prefs["muted_kinds"] = [str(k) for k in muted if isinstance(k, str)]
    if isinstance(raw.get("desktop_toast"), bool):
        prefs["desktop_toast"] = raw["desktop_toast"]
    return prefs


def notify(
    db: Session,
    *,
    employee_id: str,
    kind: str,
    title: str,
    body: str = "",
    link: dict | None = None,
    dedupe_key: str | None = None,
    dedupe_unread_only: bool = True,
) -> models.Notification | None:
    """알림 1건을 만들고 commit 한다. 만들지 않은 경우(None) 는 정상 흐름이다.

    - kind 가 어휘 밖이면 ValueError(호출자 버그를 조용히 삼키지 않는다).
    - employee_id 가 비면 None. muted_kinds 에 든 kind 면 None.
    - dedupe_key 가 같은 (employee_id, dedupe_key) 의 미읽음 알림이 있으면 None.
      dedupe_unread_only=False 면 읽음 여부와 무관하게 1건이면 None(작업 종료 알림용).
    """
    if kind not in NOTIFICATION_KINDS:
        raise ValueError(f"unknown notification kind: {kind!r}")
    employee_id = (employee_id or "").strip()
    if not employee_id:
        return None
    if kind in get_notification_prefs(db, employee_id)["muted_kinds"]:
        return None

    if dedupe_key:
        query = db.query(models.Notification).filter(
            models.Notification.employee_id == employee_id,
            models.Notification.dedupe_key == dedupe_key,
        )
        if dedupe_unread_only:
            query = query.filter(models.Notification.read_at.is_(None))
        if query.first() is not None:
            return None

    row = models.Notification(
        employee_id=employee_id,
        kind=kind,
        title=(title or "").strip()[:TITLE_MAX_LEN],
        body=(body or "").strip()[:BODY_MAX_LEN],
        link=link if isinstance(link, dict) else None,
        dedupe_key=(dedupe_key or None),
        created_at=datetime.now(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def notify_job_terminal(
    db: Session,
    record: models.Analysis,
    status: str,
) -> models.Notification | None:
    """해석 작업이 Success/Failed 로 끝났을 때 소유자에게 알림을 남긴다.

    job_manager.JobStatusStore._write_through 가 DB 반영 직후 호출한다. 이력에 보이지 않는
    내부 단계 프로그램(history_visible=False)은 알리지 않는다 — 사용자가 이력에서도 못 보는
    항목이라 소음이 된다.
    """
    kind = _TERMINAL_KIND_BY_STATUS.get(status)
    if kind is None or not (record.employee_id or "").strip():
        return None
    spec = resolve_program(record.program_name)
    if spec is not None and not spec.history_visible:
        return None

    display_name = spec.display_name if spec else (record.program_name or "해석")
    verb = "완료" if kind == "job.completed" else "실패"
    project_name = (record.project_name or "").strip()
    job_message = (record.job_message or "").strip()
    # 성공은 '무엇이 끝났나'(프로젝트), 실패는 '왜'(엔진 메시지)가 먼저다.
    body = (project_name or job_message) if kind == "job.completed" else (job_message or project_name)
    link = {
        "menu": "My Projects",
        "params": {
            "analysis_id": record.id,
            "program_name": record.program_name,
            "job_id": record.job_id,
        },
    }
    return notify(
        db,
        employee_id=record.employee_id,
        kind=kind,
        title=f"{display_name} 해석 {verb}",
        body=body,
        link=link,
        dedupe_key=f"job:{record.job_id or record.id}:{kind}",
        dedupe_unread_only=False,
    )


def serialize_notification(row: models.Notification) -> dict:
    return {
        "id": row.id,
        "kind": row.kind,
        "title": row.title,
        "body": row.body or "",
        "link": row.link,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "read_at": row.read_at.isoformat() if row.read_at else None,
        "is_read": row.read_at is not None,
    }


def prune_notifications(db: Session, retention_days: int = NOTIFICATION_RETENTION_DAYS) -> int:
    """보존 기간을 넘긴 알림을 읽음 여부와 무관하게 삭제하고 건수를 돌려준다."""
    cutoff = datetime.now() - timedelta(days=retention_days)
    deleted = (
        db.query(models.Notification)
        .filter(models.Notification.created_at < cutoff)
        .delete(synchronize_session=False)
    )
    db.commit()
    return int(deleted)
