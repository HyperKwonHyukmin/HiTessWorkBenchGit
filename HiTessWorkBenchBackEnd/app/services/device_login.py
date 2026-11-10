"""등록한 PC 로그인 — 회사 도메인에 없는 계열사 PC 용 (2026-11-10).

왜: 계열사 PC 는 도메인에 가입하지 않은 로컬 계정(``whoami`` = ``a590063\\a590063``)이라 Windows 자동 로그인
(windows_auth)이 될 수 없고, 비밀번호 칸에 회사 Windows 비밀번호를 넣게 하는 것은 보안 문제로 주목받을 수 있다
(사용자 결정). 그래서 PC 마다 열쇠 쌍을 만들고 관리자가 한 번 승인하면, 이후에는 그 PC 의 서명으로 들어온다.

흐름
----
1. 등록 요청: 앱이 Ed25519 열쇠 쌍을 만들어 비밀 열쇠는 PC 에 Windows 사용자 단위로 잠가 두고(Electron safeStorage),
   공개 열쇠만 보낸다 → ``trusted_devices`` 에 pending. 화면과 관리자 화면에 같은 **확인 코드**(공개 열쇠 지문)가 뜬다.
2. 관리자 승인: 직원에게 화면의 확인 코드를 물어 같을 때만 승인한다 — 남이 다른 사람 사번으로 요청한 것을 거르는 단계.
3. 로그인: 서버가 일회용 문제(nonce)를 주고, 앱이 서명하고, 서버가 공개 열쇠로 확인한다. 상태(대기·해지)는
   서명이 맞은 뒤에만 알려 준다 — 열쇠를 가진 PC 만 자기 상태를 안다.

비밀번호를 쓰지 않으므로 AD 계정 잠금과 무관하다. 그래서 횟수 제한은 요청 남발(대기 목록 채우기)만 막는다.
"""
from __future__ import annotations

import base64
import hashlib
import os
import secrets
import threading
import time
import re
from collections import deque
from datetime import datetime, timedelta
from typing import Callable, Optional

from .ad_auth import auth_mode

# 서명할 글의 머리. 앱(electron/device-login.js)은 이 머리로 시작하는 글만 서명한다 —
# 다른 글을 서명해 주는 도구가 되지 않게.
SIGN_PREFIX = "hitess-device-login"
CHALLENGE_TTL_SEC = 60
UNUSED_EXPIRE_DAYS = 90          # 승인 뒤(또는 마지막 사용 뒤) 이만큼 안 쓰면 다시 등록해야 한다
MAX_PENDING_PER_EMPLOYEE = 3
ENROLL_PER_IP_PER_HOUR = 10

STATUSES = ("pending", "approved", "rejected", "revoked")


def device_login_enabled() -> bool:
    """AD 모드 서버에서만 켠다(사번만 로그인 서버에는 필요 없다). ``DEVICE_LOGIN=0`` 으로 끈다."""
    if auth_mode() != "ad":
        return False
    return (os.getenv("DEVICE_LOGIN") or "").strip() != "0"


def decode_public_key(value: str) -> Optional[bytes]:
    """base64 Ed25519 공개 열쇠(32바이트). 모양이 틀리면 None."""
    try:
        raw = base64.b64decode((value or "").strip(), validate=True)
    except Exception:
        return None
    if len(raw) != 32:
        return None
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        Ed25519PublicKey.from_public_bytes(raw)
    except Exception:
        return None
    return raw


def confirm_code(public_key_b64: str) -> str:
    """공개 열쇠 지문 6자리(예 ``K7Q-4ZM``). 앱 화면과 관리자 화면이 같은 값을 보인다.

    서버가 따로 지어 내지 않고 열쇠에서 계산한다 — 관리자가 승인하는 열쇠가 직원 화면의 그 열쇠임을 보장한다.
    """
    raw = base64.b64decode(public_key_b64)
    text = base64.b32encode(hashlib.sha256(raw).digest()).decode()[:6]
    return f"{text[:3]}-{text[3:]}"


def sign_message(device_id: int, nonce: str) -> str:
    return f"{SIGN_PREFIX}:{device_id}:{nonce}"


def verify_signature(public_key_b64: str, message: str, signature_b64: str) -> bool:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    try:
        key = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64))
        key.verify(base64.b64decode((signature_b64 or "").strip(), validate=True), message.encode("utf-8"))
        return True
    except Exception:
        return False


def is_expired(device, now: Optional[datetime] = None) -> bool:
    """승인된 PC 가 오래 쓰이지 않았는가(마지막 사용, 없으면 승인 시각 기준)."""
    base = device.last_used_at or device.decided_at
    if base is None:
        return False
    return (now or datetime.now()) - base > timedelta(days=UNUSED_EXPIRE_DAYS)


class ChallengeStore:
    """일회용 문제 — 60초, 한 번 쓰면 사라진다(재생 방지).

    **문제 값(nonce)으로 찾는다.** 기기 번호로 하나만 들고 있으면, 인증 없이 그 번호로 문제를 다시 받거나
    아무 서명이나 보내는 것만으로 정상 PC 의 문제를 덮어쓰거나 꺼내 버릴 수 있었다(2026-11-10 리뷰 '막아야 함').
    nonce 는 요청한 쪽만 알기 때문에 남이 내 문제를 건드릴 수 없다.
    """

    def __init__(self, now: Callable[[], float] = time.monotonic, ttl: int = CHALLENGE_TTL_SEC):
        self._now = now
        self._ttl = ttl
        self._lock = threading.Lock()
        self._items: dict[str, tuple[int, float]] = {}

    def issue(self, device_id: int) -> str:
        nonce = secrets.token_urlsafe(24)
        with self._lock:
            cutoff = self._now() - self._ttl
            for key in [k for k, (_, t) in self._items.items() if t < cutoff]:
                del self._items[key]
            if len(self._items) > 20000:   # 남발 방어 — 오래된 것부터 버린다
                for key in list(self._items)[:5000]:
                    del self._items[key]
            self._items[nonce] = (device_id, self._now())
        return nonce

    def consume(self, device_id: int, nonce: str) -> bool:
        """맞는 문제면 지우고 True. 다른 기기 번호로 낸 nonce 는 지우지 않는다(남의 문제를 못 꺼내게)."""
        with self._lock:
            item = self._items.get(nonce or "")
            if not item or item[0] != device_id:
                return False
            del self._items[nonce]
        return self._now() - item[1] <= self._ttl


class EnrollLimiter:
    """IP 마다 시간당 등록 요청 수 — 관리자 대기 목록을 채우는 남발만 막는다."""

    def __init__(self, now: Callable[[], float] = time.monotonic, limit: int = ENROLL_PER_IP_PER_HOUR):
        self._now = now
        self._limit = limit
        self._lock = threading.Lock()
        self._hits: dict[str, deque] = {}

    def allow(self, ip: Optional[str]) -> bool:
        key = ip or "-"
        with self._lock:
            q = self._hits.setdefault(key, deque())
            cutoff = self._now() - 3600
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self._limit:
                return False
            q.append(self._now())
            return True


challenge_store = ChallengeStore()
enroll_limiter = EnrollLimiter()


# ── 메일 확인 코드 (2026-11-10, 사용자 결정: 관리자가 직원에게 코드를 묻지 않게) ──────────────
# 등록 요청 때 그 사번의 회사 메일(users.email)로 6자리 코드를 보내고, 직원이 앱에 입력하면 바로 승인된다.
# 그 메일함을 열 수 있어야 하므로 남의 사번으로 등록하려는 시도를 막는다(관리자 확인 코드와 같은 역할).
# 메일이 없거나 발송에 실패하면 예전처럼 관리자 승인(verify_method=admin)으로 넘어간다.
EMAIL_CODE_TTL_MIN = 10
EMAIL_CODE_MAX_ATTEMPTS = 5      # 이만큼 틀리면 그 코드는 버린다(다시 보내기 필요)
EMAIL_RESEND_MIN_SEC = 60
EMAIL_MAX_SENDS = 5              # 한 등록 요청에 보낼 수 있는 메일 수
PENDING_TTL_HOURS = 24           # 이만큼 지난 대기 요청은 만료(남이 대기를 채워 본인 등록을 막지 못하게)
VERIFY_PER_IP_PER_HOUR = 60      # 코드 확인 요청 수(IP 별)

_HOSTNAME_FOR_MAIL = re.compile(r"^[A-Za-z0-9._-]{1,15}$")


def safe_hostname(value: Optional[str]) -> str:
    """메일에 넣을 PC 이름 — PC 이름 모양(NetBIOS 15자)일 때만. 요청자가 지어낸 문구가 회사 발신 메일에 실리지 않게."""
    text = (value or "").strip()
    return text if _HOSTNAME_FOR_MAIL.fullmatch(text) else ""


def new_email_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def email_code_hash(device_id: int, code: str) -> str:
    return hashlib.sha256(f"{device_id}:{(code or '').strip()}".encode()).hexdigest()


def verify_message(device_id: int, nonce: str) -> str:
    """메일 코드 확인도 이 PC 의 열쇠로 서명한다 — 코드만 알아서는 남의 기기를 승인시키지 못하게."""
    return f"{SIGN_PREFIX}:verify:{device_id}:{nonce}"


def email_code_body(code: str, hostname: Optional[str], ip: Optional[str] = None) -> tuple[str, str]:
    subject = "[Hi-TESS WorkBench] PC 등록 확인 코드"
    body = (
        f"Hi-TESS WorkBench 에 이 PC 를 등록하려는 요청이 있었습니다.\n\n"
        f"확인 코드: {code}\n"
        f"(유효 시간 {EMAIL_CODE_TTL_MIN}분)\n\n"
        f"PC 이름: {safe_hostname(hostname) or '-'}\n"
        f"요청 IP: {ip or '-'}\n\n"
        "WorkBench 로그인 화면의 칸에 이 코드를 입력하면 등록이 끝나고, 다음부터 비밀번호 없이 들어옵니다.\n"
        "직접 요청하지 않았다면 이 메일을 무시하고 WorkBench 관리자에게 알려 주세요. "
        "코드를 다른 사람에게 알려 주지 마세요.\n"
    )
    return subject, body


verify_limiter = EnrollLimiter(limit=VERIFY_PER_IP_PER_HOUR)
