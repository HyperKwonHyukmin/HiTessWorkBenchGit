"""사용자 환경설정 — 정규화·부분 병합·기본값 채움(스펙 §4.2).

- 저장은 `models.UserPreference.prefs` JSON 한 칸에 4키(`favorites`·`recent_apps`·
  `notifications`·`landing_menu`)만 담는다. 화이트리스트 밖 키는 조용히 무시하고
  `ignored_keys` 로 라우터가 응답한다(마스터 §2.2·spec D5).
- 값 형식/어휘 오류는 ValueError. 라우터가 422 로 변환.
- Plan A(알림 센터)의 `NOTIFICATION_KINDS` 를 지연 import 한다 — Plan A 미구현이어도
  저장은 되어야 한다는 사용자 결정(spec D6).
"""
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from .. import models

PREFERENCE_KEYS: tuple[str, ...] = ("favorites", "recent_apps", "notifications", "landing_menu")

# 스펙 §4.2 상한
MAX_FAVORITES = 50
MAX_RECENT_APPS = 8
LANDING_MENU_MAX_LEN = 200

# Plan A 미구현 폴백 — 마스터 §2.1 의 9개 kind 를 그대로 갖는다.
NOTIFICATION_KINDS_FALLBACK: frozenset[str] = frozenset({
    "job.completed", "job.failed", "job.cancelled",
    "retention.expired",
    "batch.completed", "share.received",
    "feature_request.status_changed", "notice.published",
})

DEFAULT_NOTIFICATION_PREFS: dict[str, Any] = {"muted_kinds": [], "desktop_toast": True}
DEFAULT_LANDING_MENU: Optional[str] = None


def _known_notification_kinds() -> frozenset[str]:
    """Plan A 가 있으면 그 상수, 없으면 폴백."""
    try:
        from .notification_service import NOTIFICATION_KINDS  # type: ignore
    except Exception:
        return NOTIFICATION_KINDS_FALLBACK
    if isinstance(NOTIFICATION_KINDS, (frozenset, set)):
        return frozenset(NOTIFICATION_KINDS)
    return NOTIFICATION_KINDS_FALLBACK


def default_prefs() -> dict[str, Any]:
    """저장된 값이 없을 때 프론트에 돌려주는 기본 실효값(4키)."""
    return {
        "favorites": [],
        "recent_apps": [],
        "notifications": {"muted_kinds": list(DEFAULT_NOTIFICATION_PREFS["muted_kinds"]),
                          "desktop_toast": DEFAULT_NOTIFICATION_PREFS["desktop_toast"]},
        "landing_menu": DEFAULT_LANDING_MENU,
    }


def normalize_favorites(raw: Any) -> list[str]:
    """문자열만, trim, 빈 값 제거, 순서 유지 중복 제거, 50개 초과 컷."""
    if not isinstance(raw, list):
        raise ValueError("favorites must be a list")
    seen: set[str] = set()
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        value = item.strip()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out[:MAX_FAVORITES]


def normalize_recent_apps(raw: Any) -> list[dict[str, Any]]:
    """{menu,label,mode,category,at} 만 남기고 menu 기준 최신순 유일 8개."""
    if not isinstance(raw, list):
        raise ValueError("recent_apps must be a list")
    by_menu: dict[str, dict[str, Any]] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        menu = item.get("menu")
        if not isinstance(menu, str) or not menu.strip():
            continue
        menu = menu.strip()
        label = item.get("label")
        label = label.strip() if isinstance(label, str) and label.strip() else menu
        mode = item.get("mode") if isinstance(item.get("mode"), str) else ""
        category = item.get("category") if isinstance(item.get("category"), str) else ""
        try:
            at = int(item.get("at") or 0)
            if at < 0:
                at = 0
        except (TypeError, ValueError):
            at = 0
        prev = by_menu.get(menu)
        # 같은 menu 는 at 이 큰 쪽만 남긴다.
        if prev is None or at > prev["at"]:
            by_menu[menu] = {"menu": menu, "label": label, "mode": mode,
                             "category": category, "at": at}
    ordered = sorted(by_menu.values(), key=lambda x: x["at"], reverse=True)
    return ordered[:MAX_RECENT_APPS]


def normalize_notifications(raw: Any, previous: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """{muted_kinds, desktop_toast} 부분 병합. 어휘 밖 kind 나 잘못된 타입은 ValueError."""
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ValueError("notifications must be an object")

    known = _known_notification_kinds()
    base = dict(DEFAULT_NOTIFICATION_PREFS)
    if isinstance(previous, dict):
        for key in ("muted_kinds", "desktop_toast"):
            if key in previous:
                base[key] = previous[key]

    if "muted_kinds" in raw:
        muted = raw["muted_kinds"]
        if not isinstance(muted, list):
            raise ValueError("notifications.muted_kinds must be a list")
        clean: list[str] = []
        for k in muted:
            if not isinstance(k, str):
                raise ValueError("notifications.muted_kinds items must be strings")
            if k not in known:
                raise ValueError(f"unknown notification kind: {k!r}")
            if k not in clean:
                clean.append(k)
        base["muted_kinds"] = sorted(clean)
    else:
        # previous 값을 유지하되 리스트 형태만 보장.
        if not isinstance(base.get("muted_kinds"), list):
            base["muted_kinds"] = []

    if "desktop_toast" in raw:
        if not isinstance(raw["desktop_toast"], bool):
            raise ValueError("notifications.desktop_toast must be a boolean")
        base["desktop_toast"] = raw["desktop_toast"]
    else:
        if not isinstance(base.get("desktop_toast"), bool):
            base["desktop_toast"] = DEFAULT_NOTIFICATION_PREFS["desktop_toast"]

    return {"muted_kinds": list(base["muted_kinds"]), "desktop_toast": bool(base["desktop_toast"])}


def normalize_landing_menu(raw: Any) -> Optional[str]:
    """None/빈문자열 → None. 200자 초과 → ValueError."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ValueError("landing_menu must be a string or null")
    value = raw.strip()
    if not value:
        return None
    if len(value) > LANDING_MENU_MAX_LEN:
        raise ValueError("landing_menu is too long")
    return value


def _apply_key(current: dict[str, Any], key: str, value: Any) -> None:
    """화이트리스트 키 하나를 정규화해 current 에 대입한다."""
    if key == "favorites":
        current[key] = normalize_favorites(value)
    elif key == "recent_apps":
        current[key] = normalize_recent_apps(value)
    elif key == "notifications":
        prev = current.get("notifications") if isinstance(current.get("notifications"), dict) else None
        current[key] = normalize_notifications(value, previous=prev)
    elif key == "landing_menu":
        current[key] = normalize_landing_menu(value)


def effective_prefs(stored: Optional[dict[str, Any]]) -> dict[str, Any]:
    """저장값에 기본값을 덮어 4키를 모두 갖는 dict 를 돌려준다."""
    out = default_prefs()
    if not isinstance(stored, dict):
        return out
    if isinstance(stored.get("favorites"), list):
        try:
            out["favorites"] = normalize_favorites(stored["favorites"])
        except ValueError:
            pass
    if isinstance(stored.get("recent_apps"), list):
        try:
            out["recent_apps"] = normalize_recent_apps(stored["recent_apps"])
        except ValueError:
            pass
    if isinstance(stored.get("notifications"), dict):
        try:
            out["notifications"] = normalize_notifications(stored["notifications"])
        except ValueError:
            pass
    if "landing_menu" in stored:
        try:
            out["landing_menu"] = normalize_landing_menu(stored["landing_menu"])
        except ValueError:
            pass
    return out


def merge_prefs(current: dict[str, Any], payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """부분 병합 결과와 무시된 키 목록을 돌려준다. current 는 변경하지 않는다(deep 복제)."""
    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")
    merged = effective_prefs(current)
    ignored: list[str] = []
    for key, value in payload.items():
        if key not in PREFERENCE_KEYS:
            ignored.append(key)
            continue
        _apply_key(merged, key, value)
    return merged, ignored


def get_prefs(db: Session, employee_id: str) -> tuple[dict[str, Any], Optional[datetime]]:
    """(effective prefs, updated_at) 를 돌려준다. 행이 없으면 기본값+None."""
    row = (
        db.query(models.UserPreference)
        .filter(models.UserPreference.employee_id == employee_id)
        .first()
    )
    if row is None:
        return default_prefs(), None
    return effective_prefs(row.prefs), row.updated_at


def upsert_prefs(
    db: Session,
    employee_id: str,
    payload: dict[str, Any],
) -> tuple[dict[str, Any], list[str]]:
    """부분 병합 후 저장(없으면 생성)한다. 반환은 (effective prefs, ignored_keys)."""
    row = (
        db.query(models.UserPreference)
        .filter(models.UserPreference.employee_id == employee_id)
        .first()
    )
    current = row.prefs if row and isinstance(row.prefs, dict) else {}
    merged, ignored = merge_prefs(current, payload)
    if row is None:
        row = models.UserPreference(employee_id=employee_id, prefs=merged, updated_at=datetime.now())
        db.add(row)
    else:
        # JSON 컬럼은 새 dict 를 대입해야 변경이 추적된다(스펙 §9 함정).
        row.prefs = dict(merged)
        row.updated_at = datetime.now()
    db.commit()
    db.refresh(row)
    return merged, ignored
