"""Short-lived browser access for proxied external engineering applications.

The WorkBench bearer token deliberately never enters an external-app browser URL.
An authenticated API request creates a one-time grant; the top-level browser
exchanges that grant for an app-specific, random HttpOnly cookie.

This store is intentionally in-memory.  External-app browser sessions are
recoverable UI state and should be invalidated when the backend restarts rather
than surviving independently from the process that issued them.
"""

from __future__ import annotations

from dataclasses import dataclass
import secrets
from threading import RLock
import time
from typing import Callable


GRANT_TTL_SECONDS = 45
SESSION_TTL_SECONDS = 8 * 60 * 60


@dataclass(frozen=True)
class ExternalAppGrant:
    app_key: str
    employee_id: str
    expires_at: float
    cache_bust: bool


@dataclass(frozen=True)
class ExternalAppSession:
    app_key: str
    employee_id: str
    expires_at: float


class ExternalAppAccessStore:
    """Thread-safe, bounded-lifetime grants and browser sessions."""

    def __init__(
        self,
        *,
        clock: Callable[[], float] = time.monotonic,
        grant_ttl_seconds: int = GRANT_TTL_SECONDS,
        session_ttl_seconds: int = SESSION_TTL_SECONDS,
    ) -> None:
        self._clock = clock
        self._grant_ttl_seconds = grant_ttl_seconds
        self._session_ttl_seconds = session_ttl_seconds
        self._grants: dict[str, ExternalAppGrant] = {}
        self._sessions: dict[str, ExternalAppSession] = {}
        self._lock = RLock()

    @staticmethod
    def _token() -> str:
        return secrets.token_urlsafe(32)

    def _remove_expired(self, now: float) -> None:
        self._grants = {
            token: grant
            for token, grant in self._grants.items()
            if grant.expires_at > now
        }
        self._sessions = {
            token: session
            for token, session in self._sessions.items()
            if session.expires_at > now
        }

    def issue_grant(
        self,
        app_key: str,
        employee_id: str,
        *,
        cache_bust: bool = True,
    ) -> str:
        now = self._clock()
        with self._lock:
            self._remove_expired(now)
            token = self._token()
            self._grants[token] = ExternalAppGrant(
                app_key=app_key,
                employee_id=employee_id,
                expires_at=now + self._grant_ttl_seconds,
                cache_bust=cache_bust,
            )
            return token

    def consume_grant(self, token: str, app_key: str) -> ExternalAppGrant | None:
        """Consume a grant exactly once, including invalid app/expired attempts."""

        now = self._clock()
        with self._lock:
            grant = self._grants.pop(token, None)
            self._remove_expired(now)
            if grant is None or grant.expires_at <= now or grant.app_key != app_key:
                return None
            return grant

    def issue_session(self, app_key: str, employee_id: str) -> str:
        now = self._clock()
        with self._lock:
            self._remove_expired(now)
            token = self._token()
            self._sessions[token] = ExternalAppSession(
                app_key=app_key,
                employee_id=employee_id,
                expires_at=now + self._session_ttl_seconds,
            )
            return token

    def get_session(self, token: str | None, app_key: str) -> ExternalAppSession | None:
        if not token:
            return None
        now = self._clock()
        with self._lock:
            session = self._sessions.get(token)
            self._remove_expired(now)
            if (
                session is None
                or session.expires_at <= now
                or session.app_key != app_key
            ):
                return None
            return session

    def revoke_session(self, token: str | None) -> bool:
        """Revoke one browser session without revealing whether it existed."""

        if not token:
            return False
        with self._lock:
            return self._sessions.pop(token, None) is not None

    def revoke_employee(self, employee_id: str) -> int:
        """Revoke every grant and browser session issued to one account."""

        normalized = (employee_id or "").strip().casefold()
        if not normalized:
            return 0
        with self._lock:
            session_tokens = [
                token
                for token, session in self._sessions.items()
                if session.employee_id.strip().casefold() == normalized
            ]
            grant_tokens = [
                token
                for token, grant in self._grants.items()
                if grant.employee_id.strip().casefold() == normalized
            ]
            for token in session_tokens:
                self._sessions.pop(token, None)
            for token in grant_tokens:
                self._grants.pop(token, None)
            return len(session_tokens)

    def clear(self) -> None:
        """Test/lifecycle helper; does not expose or return credentials."""

        with self._lock:
            self._grants.clear()
            self._sessions.clear()


external_app_access_store = ExternalAppAccessStore()
