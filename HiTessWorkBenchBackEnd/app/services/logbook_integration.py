"""Hi-TESS LogBook 연동 — 설정 · 일회 코드 · 로그아웃 통지.

WorkBench(9091) 와 LogBook(9095) 은 서버끼리 공유 비밀키(`X-HiTESS-Integration`)로 서로를 확인한다.
계약 원본: LogBook 저장소 `docs/plans/2026-10-08-logbook-18-workbench-link.md` 7절.

- 비밀키(`LOGBOOK_INTEGRATION_SECRET`)가 비어 있으면 연동 전체가 꺼진다(fail-closed).
- 일회 코드는 메모리에만 둔다(30초·1회용). 서버를 재시작하면 사라지는데 의도한 것이다.
- WB 토큰 자체는 LogBook 으로 넘기지 않는다. 대신 `wb_ref = sha256(토큰)` 을 넘겨,
  WB 로그아웃 때 같은 값으로 LogBook 세션을 찾아 폐기하게 한다.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Callable

import httpx

logger = logging.getLogger(__name__)

INTEGRATION_HEADER = "X-HiTESS-Integration"
WINDOW_KEY = "hitess-logbook"
DEFAULT_INTERNAL_URL = "http://127.0.0.1:9095"
DEFAULT_PUBLIC_PORT = 9095

CODE_TTL_SECONDS = 30
RATE_LIMIT_COUNT = 10
RATE_LIMIT_WINDOW_SECONDS = 60
LOGOUT_TIMEOUT_SECONDS = 3.0


# ── 설정 (환경 변수 — 다른 설정과 같이 os.environ 에서 읽는다) ──────────────────

def integration_secret() -> str:
    return os.environ.get("LOGBOOK_INTEGRATION_SECRET", "").strip()


def integration_enabled() -> bool:
    return bool(integration_secret())


def internal_url() -> str:
    value = os.environ.get("LOGBOOK_INTERNAL_URL", "").strip().strip('"')
    return (value or DEFAULT_INTERNAL_URL).rstrip("/")


def public_base_url(request_hostname: str | None) -> str:
    """사용자 창이 여는 LogBook 주소. 설정이 없으면 '요청 Host 의 호스트명 + :9095'."""
    value = os.environ.get("LOGBOOK_BASE_URL", "").strip().strip('"')
    if value:
        return value.rstrip("/")
    host = (request_hostname or "127.0.0.1").strip()
    if ":" in host and not host.startswith("["):  # IPv6 리터럴
        host = f"[{host}]"
    return f"http://{host}:{DEFAULT_PUBLIC_PORT}"


def secret_matches(provided: str | None) -> bool:
    """서버 간 헤더 비교. 비밀키가 비어 있으면 항상 거부한다."""
    secret = integration_secret()
    if not secret or not provided:
        return False
    return hmac.compare_digest(provided.encode("utf-8"), secret.encode("utf-8"))


def wb_ref_of(token: str) -> str:
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


# ── 일회 코드 저장소 ───────────────────────────────────────────────────────────

@dataclass(frozen=True)
class LaunchGrant:
    employee_id: str
    wb_ref: str
    wb_expires_at: datetime | None
    expires_at: float


class RateLimited(Exception):
    """사람당 분당 발급 한도를 넘었다."""


class LaunchCodeStore:
    def __init__(
        self,
        *,
        clock: Callable[[], float] = time.monotonic,
        ttl_seconds: float = CODE_TTL_SECONDS,
        rate_limit: int = RATE_LIMIT_COUNT,
        rate_window_seconds: float = RATE_LIMIT_WINDOW_SECONDS,
    ):
        self._clock = clock
        self._ttl = ttl_seconds
        self._rate_limit = rate_limit
        self._rate_window = rate_window_seconds
        self._codes: dict[str, LaunchGrant] = {}
        self._issued: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, now: float) -> None:
        for code in [c for c, g in self._codes.items() if g.expires_at <= now]:
            del self._codes[code]
        cutoff = now - self._rate_window
        for emp in list(self._issued):
            recent = [t for t in self._issued[emp] if t > cutoff]
            if recent:
                self._issued[emp] = recent
            else:
                del self._issued[emp]

    def issue(self, employee_id: str, wb_ref: str, wb_expires_at: datetime | None) -> str:
        with self._lock:
            now = self._clock()
            self._prune(now)
            key = employee_id.casefold()
            history = self._issued.setdefault(key, [])
            if len(history) >= self._rate_limit:
                raise RateLimited()
            history.append(now)
            code = secrets.token_urlsafe(32)
            self._codes[code] = LaunchGrant(
                employee_id=employee_id,
                wb_ref=wb_ref,
                wb_expires_at=wb_expires_at,
                expires_at=now + self._ttl,
            )
            return code

    def redeem(self, code: str) -> LaunchGrant | None:
        """코드를 꺼내며 즉시 지운다(1회용). 없거나 만료면 None."""
        if not code:
            return None
        with self._lock:
            now = self._clock()
            grant = self._codes.pop(code, None)
            self._prune(now)
            if grant is None or grant.expires_at <= now:
                return None
            return grant

    def clear(self) -> None:
        with self._lock:
            self._codes.clear()
            self._issued.clear()


launch_code_store = LaunchCodeStore()


# ── WB 로그아웃 → LogBook 세션 폐기 통지 (백그라운드, 실패 무시) ─────────────────

def _send_logout(wb_ref: str) -> None:
    secret = integration_secret()
    if not secret:
        return
    with httpx.Client(timeout=LOGOUT_TIMEOUT_SECONDS) as client:
        response = client.post(
            f"{internal_url()}/api/integration/logout",
            json={"wb_ref": wb_ref},
            headers={INTEGRATION_HEADER: secret},
        )
        if response.status_code >= 400:
            logger.warning("LogBook 로그아웃 통지 실패: HTTP %s", response.status_code)


def _run_logout_safely(wb_ref: str) -> None:
    try:
        _send_logout(wb_ref)
    except Exception as exc:  # noqa: BLE001 — 로그아웃은 어떤 경우에도 실패하면 안 된다
        logger.warning("LogBook 로그아웃 통지 실패: %s", exc)


def _start_background(target: Callable[..., None], *args) -> None:
    threading.Thread(target=target, args=args, daemon=True, name="logbook-logout").start()


def notify_logbook_logout(tokens: list[str] | str) -> None:
    """WB 세션 토큰(들)이 폐기됐음을 LogBook 에 알린다. 비밀키가 없으면 아무것도 하지 않는다.

    호출자(로그아웃 라우트)를 늦추거나 실패시키지 않도록 데몬 스레드에서 보내고 예외를 삼킨다.
    """
    try:
        if not integration_enabled():
            return
        items = [tokens] if isinstance(tokens, str) else list(tokens or [])
        for token in items:
            if token:
                _start_background(_run_logout_safely, wb_ref_of(token))
    except Exception as exc:  # noqa: BLE001
        logger.warning("LogBook 로그아웃 통지 예약 실패: %s", exc)
