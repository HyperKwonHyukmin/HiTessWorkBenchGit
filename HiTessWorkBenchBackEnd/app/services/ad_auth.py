"""사내 AD(LDAP) 로 사번·비밀번호를 확인한다 (2026-11-04).

왜: 예전 `/api/login` 은 사번만 받아, 사번을 아는 사람이면 누구나 그 사람으로 로그인했다
(보안 테스트에서 PowerShell 로 세션을 받아 외부 App 을 연 것이 그 예). AD 로 '본인' 을 확인한다.

설계
----
- **스위치**: ``.env`` ``AUTH_MODE=ad`` 일 때만 켠다. 비우면 예전처럼 사번만(로그인 계약 그대로).
  사번만으로 무인 로그인하는 클라이언트(AM 연동 HiTessMB·AmLauncher)를 고친 뒤 켠다.
- **비밀번호는 저장·기록하지 않는다.** AD 에 bind 해 맞는지만 보고 연결을 닫는다.
- **ldaps(636) + 인증서 검증.** 사내 AD 인증서가 RSA 1024 비트라 OpenSSL 기본(SECLEVEL 2)이
  거부한다(2026-11-04 실측 'EE certificate key too weak'). 검증·이름 확인은 켜 둔 채
  키 길이 하한만 SECLEVEL 1 로 낮춘다. IT 가 키를 바꾸면 ``AD_LDAP_TLS_SECLEVEL=2``.
- **빈 비밀번호는 AD 에 보내지 않는다.** AD 는 빈 비밀번호 simple bind 를 '익명 접속 성공' 으로
  처리할 수 있다(ldap3 가 먼저 막지만 의존하지 않는다).
- **시도 횟수 제한은 AD 에 묻기 전에.** 틀린 시도가 AD 로 계속 가면 그 직원의 회사 PC 계정이
  잠긴다. 그래서 사번별 제한을 AD 잠금 기준(흔히 5회)보다 낮게 둔다.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import ssl
import threading
import time
from collections import deque
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)

# 사내 AD 기본값(2026-11-04 `nltest /dsgetdc:HHI.CO.KR` 로 확인). .env 로 바꿀 수 있다.
_DEFAULT_LDAP_HOST = "HHIWVRA06.HHI.co.kr"
_DEFAULT_LDAP_PORT = 636
_DEFAULT_NETBIOS_DOMAIN = "HHI"
_DEFAULT_TLS_SECLEVEL = 1
_TIMEOUT_SEC = 5

# 실패 제한: 사번별 15분에 4회(AD 잠금 기준보다 낮게), IP 별 15분에 20회.
_WINDOW_SEC = 15 * 60
_MAX_FAILURES_PER_EMPLOYEE = 4
_MAX_FAILURES_PER_IP = 20

# AD 가 bind 실패(49) 메시지에 붙이는 세부 코드. 'data 52e' = 비밀번호 틀림.
_AD_DATA_CODE = re.compile(r"data\s+([0-9a-f]{3})", re.IGNORECASE)
_LOCKED_CODES = {"775"}                 # 계정 잠김
_EXPIRED_CODES = {"532", "773"}         # 비밀번호 만료 / 다음 로그인 때 변경 필요
_DISABLED_CODES = {"533", "701"}        # 계정 사용 안 함 / 계정 만료


class AdResult(Enum):
    OK = "ok"
    INVALID = "invalid_credentials"
    LOCKED = "account_locked"
    PASSWORD_EXPIRED = "password_expired"
    DISABLED = "account_disabled"
    UNAVAILABLE = "auth_unavailable"


def auth_mode() -> str:
    """'ad' 또는 'employee_id'(기본). 요청마다 읽어 .env 수정 후 재시작만으로 바뀐다."""
    return "ad" if (os.getenv("AUTH_MODE") or "").strip().lower() == "ad" else "employee_id"


# 테스트 계정(2026-11-12) — AD 에 없는 계열사 시험용 사번(중형선 A888888 · 삼호 A878787).
# AD 로그인으로 바뀐 뒤 들어올 길이 없어 .env 에 적은 사번만 서버가 비밀번호를 직접 확인한다.
#   TEST_LOGIN_ACCOUNTS=A888888,A878787
#   TEST_LOGIN_PASSWORD_SHA256=<비밀번호의 sha256 16진수>  (비밀번호 원문은 어디에도 두지 않는다)
# 둘 중 하나라도 비면 꺼진다. 실패 횟수 제한·관리자 승인은 다른 계정과 같다.
def test_login_accounts() -> frozenset[str]:
    if not (os.getenv("TEST_LOGIN_PASSWORD_SHA256") or "").strip():
        return frozenset()
    raw = os.getenv("TEST_LOGIN_ACCOUNTS") or ""
    return frozenset(x.strip().upper() for x in raw.split(",") if x.strip())


def is_test_login_account(employee_id: str) -> bool:
    return (employee_id or "").strip().upper() in test_login_accounts()


def verify_test_password(employee_id: str, password: str | None) -> AdResult:
    """테스트 계정의 비밀번호를 .env 의 sha256 과 비교한다(AD 에 묻지 않음)."""
    expected = (os.getenv("TEST_LOGIN_PASSWORD_SHA256") or "").strip().lower()
    if not expected or not is_test_login_account(employee_id) or not password:
        return AdResult.INVALID
    actual = hashlib.sha256(password.encode("utf-8")).hexdigest()
    return AdResult.OK if hmac.compare_digest(actual, expected) else AdResult.INVALID


@dataclass(frozen=True)
class _Settings:
    host: str
    port: int
    domain: str
    seclevel: int


def _settings() -> _Settings:
    def _int(name: str, default: int) -> int:
        try:
            return int((os.getenv(name) or "").strip() or default)
        except ValueError:
            return default

    return _Settings(
        host=(os.getenv("AD_LDAP_HOST") or "").strip() or _DEFAULT_LDAP_HOST,
        port=_int("AD_LDAP_PORT", _DEFAULT_LDAP_PORT),
        domain=(os.getenv("AD_NETBIOS_DOMAIN") or "").strip() or _DEFAULT_NETBIOS_DOMAIN,
        seclevel=_int("AD_LDAP_TLS_SECLEVEL", _DEFAULT_TLS_SECLEVEL),
    )


def _classify_bind_failure(result: dict) -> AdResult:
    match = _AD_DATA_CODE.search(str(result.get("message") or ""))
    code = match.group(1).lower() if match else ""
    if code in _LOCKED_CODES:
        return AdResult.LOCKED
    if code in _EXPIRED_CODES:
        return AdResult.PASSWORD_EXPIRED
    if code in _DISABLED_CODES:
        return AdResult.DISABLED
    return AdResult.INVALID


def verify_ad_password(employee_id: str, password: str | None) -> AdResult:
    """AD 에 bind 해 사번·비밀번호가 맞는지 본다. 비밀번호는 어디에도 남기지 않는다."""
    if not password or not password.strip() or not employee_id:
        return AdResult.INVALID
    try:
        from ldap3 import Connection, Server, Tls
        from ldap3.core.exceptions import LDAPException
    except ImportError:
        logger.error("ldap3 가 설치되지 않아 AD 로그인을 확인할 수 없습니다(pip install -r requirements.txt).")
        return AdResult.UNAVAILABLE

    cfg = _settings()
    tls = Tls(
        validate=ssl.CERT_REQUIRED,
        version=ssl.PROTOCOL_TLS_CLIENT,
        ciphers=f"DEFAULT:@SECLEVEL={cfg.seclevel}",
    )
    server = Server(cfg.host, port=cfg.port, use_ssl=True, tls=tls, connect_timeout=_TIMEOUT_SEC)
    conn = Connection(
        server,
        user=f"{cfg.domain}\\{employee_id.strip().lower()}",
        password=password,
        receive_timeout=_TIMEOUT_SEC,
    )
    try:
        if conn.bind():
            return AdResult.OK
        result = conn.result or {}
        if result.get("result") == 49:
            return _classify_bind_failure(result)
        logger.warning("AD bind 실패(인증 외 사유): %s", result.get("description"))
        return AdResult.UNAVAILABLE
    except LDAPException as exc:
        # 접속·인증서 문제. 비밀번호가 실린 객체는 로그에 남기지 않는다.
        logger.warning("AD 접속 실패: %s", type(exc).__name__)
        return AdResult.UNAVAILABLE
    finally:
        try:
            conn.unbind()
        except Exception:
            pass


class LoginAttemptLimiter:
    """틀린 시도 횟수를 사번·IP 별로 센다(메모리, 서버 재시작 시 초기화)."""

    def __init__(self, window_sec: int = _WINDOW_SEC,
                 max_per_employee: int = _MAX_FAILURES_PER_EMPLOYEE,
                 max_per_ip: int = _MAX_FAILURES_PER_IP):
        self._window = window_sec
        self._max_employee = max_per_employee
        self._max_ip = max_per_ip
        self._failures: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: str, now: float) -> deque[float]:
        bucket = self._failures.setdefault(key, deque())
        while bucket and now - bucket[0] > self._window:
            bucket.popleft()
        return bucket

    def _count(self, key: str, now: float) -> int:
        count = len(self._recent(key, now))
        if count == 0:
            self._failures.pop(key, None)   # 사번을 바꿔 가며 넣어도 빈 키가 쌓이지 않게
        return count

    def is_blocked(self, employee_id: str, ip: str | None) -> bool:
        now = time.monotonic()
        with self._lock:
            if self._count(f"emp:{employee_id}", now) >= self._max_employee:
                return True
            return bool(ip) and self._count(f"ip:{ip}", now) >= self._max_ip

    def record_failure(self, employee_id: str, ip: str | None) -> None:
        now = time.monotonic()
        with self._lock:
            self._recent(f"emp:{employee_id}", now).append(now)
            if ip:
                self._recent(f"ip:{ip}", now).append(now)

    def reset(self, employee_id: str) -> None:
        with self._lock:
            self._failures.pop(f"emp:{employee_id}", None)

    def clear(self) -> None:
        with self._lock:
            self._failures.clear()


login_attempt_limiter = LoginAttemptLimiter()
