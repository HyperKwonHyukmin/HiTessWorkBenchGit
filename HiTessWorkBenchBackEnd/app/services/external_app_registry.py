"""관리자가 등록한 외부 앱(ExternalAppRegistration) 조회·검증.

코드에 박힌 외부 앱 3개(routers/external_apps.py)와 같은 프록시를 쓰되, 목록이 DB 에 있다.
프록시는 요청마다 slug 로 행을 찾으므로 짧은 TTL 캐시를 둔다(쓰기 시 즉시 무효화).
"""
from __future__ import annotations

import ipaddress
import re
import threading
import time

from sqlalchemy.orm import Session

from .. import models
from . import app_settings as app_settings_service

# 주소 이름: 소문자·숫자·하이픈, 2~40자, 하이픈으로 시작·끝 금지.
SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$")

# 코드 외부 앱 주소와 프록시 내부 예약 경로. 같은 slug 를 쓰면 라우팅이 겹친다.
RESERVED_SLUGS = frozenset({
    "block-weld",
    "independent-tank",
    "heavy-block-lifting",
    "x",
    "api",
    "admin",
    "static",
})

# 프론트 카탈로그 모드(Layout GROUP_MENU_BY_MODE)와 같다.
VALID_MODES = ("File", "Interactive", "Parametric", "Productivity")

# 프론트 utils/cardArt.js CARD_ART_NAMES 와 같다 — 그림을 추가하면 양쪽 다.
VALID_ART_NAMES = (
    "truss", "frame", "pipe", "lift", "beam", "column", "plate", "weld", "hull", "doc",
)

MAX_TAGS = 12
MAX_TAG_LEN = 30

_CACHE_TTL_SECONDS = 5.0
_cache_lock = threading.Lock()
_cache: dict[str, dict] | None = None
_cache_expires_at = 0.0


def is_private_ipv4(host: str) -> bool:
    """사내 사설 대역(10/8, 172.16/12, 192.168/16)의 IPv4 만 허용한다.

    등록 앱은 WorkBench 서버가 대신 요청을 보내는 대상이라, 관리자 실수나 악용으로
    외부·서버 자신(127.x)을 가리키지 못하게 한다.
    """
    try:
        address = ipaddress.IPv4Address((host or "").strip())
    except ValueError:
        return False
    return address.is_private and not address.is_loopback and not address.is_link_local


def row_to_dict(row: models.ExternalAppRegistration) -> dict:
    return {
        "slug": row.slug,
        "title": row.title,
        "description": row.description,
        "mode": row.mode,
        "category": row.category,
        "art": row.art,
        "tags": row.tags if isinstance(row.tags, list) else [],
        "contributor": row.contributor,
        "dev_status": row.dev_status,
        "host": row.host,
        "port": row.port,
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_by": row.updated_by,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def invalidate_cache() -> None:
    global _cache, _cache_expires_at
    with _cache_lock:
        _cache = None
        _cache_expires_at = 0.0


def load_registrations(db: Session, *, use_cache: bool = True) -> dict[str, dict]:
    """slug → 등록 정보 dict 전체(TTL 캐시)."""
    global _cache, _cache_expires_at
    if use_cache:
        with _cache_lock:
            if _cache is not None and time.monotonic() < _cache_expires_at:
                return _cache

    rows = (
        db.query(models.ExternalAppRegistration)
        .order_by(models.ExternalAppRegistration.title.asc())
        .all()
    )
    registrations = {row.slug: row_to_dict(row) for row in rows}
    with _cache_lock:
        _cache = registrations
        _cache_expires_at = time.monotonic() + _CACHE_TTL_SECONDS
    return registrations


def clean_tags(value) -> list[str]:
    if not value:
        return []
    tags = [str(tag).strip()[:MAX_TAG_LEN] for tag in value if str(tag).strip()]
    return tags[:MAX_TAGS]


def effective_block_reason(registration: dict, setting: dict | None) -> tuple[str, str] | None:
    """등록 앱의 차단 사유. 서비스 상태는 app_settings 오버라이드가 등록값보다 우선한다."""
    merged = dict(setting or {})
    merged["dev_status"] = (setting or {}).get("dev_status") or registration.get("dev_status")
    return app_settings_service.block_reason(merged)
