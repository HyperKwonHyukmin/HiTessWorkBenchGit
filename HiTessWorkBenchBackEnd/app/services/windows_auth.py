"""회사 PC 계정 자동 로그인 — Windows 통합 인증(Negotiate) (2026-11-05).

왜: AD 로그인(2026-11-04)은 회사 PC 비밀번호를 평문 HTTP(9091)로 보낸다. Negotiate 는 Windows 가
지금 로그인한 계정으로 일회용 증명 토큰을 만들어 보내므로 **비밀번호가 망에 흐르지 않는다.**
사번 입력도 필요 없다(서버가 계정 이름 ``HHI\\<사번>`` 에서 사번을 얻는다).

0단계 시험(2026-11-05, RecordMD/2026-11-05-https-certificate-pinning-plan.md): 145 는 도메인 가입
PC 이고, 로컬 계정으로 도는 서버 프로그램도 도메인 계정을 확인했다. IP 로 부르면 NTLM, FQDN 으로
부르면 Kerberos.

설계
----
- **스위치**: ``AUTH_MODE=ad`` 이고 pywin32 ``sspi`` 를 쓸 수 있을 때만 켠다(``AD_WINDOWS_LOGIN=0`` 으로 끔).
  사번 + 비밀번호 로그인은 예비로 그대로 둔다(공용 PC·다른 계정).
- **NTLM 은 한 TCP 연결에서 두 번 오간다**(협상 → 도전 → 응답). 그래서 진행 중인 SSPI 상태를
  연결(클라이언트 IP + 포트)마다 잠깐(30초) 들고 있는다. Kerberos 는 한 번에 끝난다.
- 받는 계정은 설정된 도메인(``AD_WINDOWS_DOMAINS``, 비우면 ``AD_NETBIOS_DOMAIN`` 기본 ``HHI``)의 사번 모양 이름뿐이다.
- 토큰·계정 외의 값은 기록하지 않는다.
"""
from __future__ import annotations

import base64
import os
import re
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Optional

from .ad_auth import _settings, auth_mode

_PENDING_TTL_SEC = 30
_MAX_PENDING = 500
_MAX_PENDING_PER_IP = 10  # 한 IP 가 협상 표를 채워 다른 사람의 자동 로그인을 막지 못하게
# 사번 형식(auth.EMPLOYEE_ID_PATTERN 과 같다). 순환 import 를 피하려고 여기 따로 둔다.
_EMPLOYEE_ID = re.compile(r"^[A-Z]\d{5,7}$")

# sspicon 값(pywin32 가 없는 PC 에서도 모듈을 import 할 수 있게 숫자로 둔다).
SEC_I_CONTINUE_NEEDED = 0x00090312


def _sspi_available() -> bool:
    try:
        import sspi  # noqa: F401  (pywin32)
        return True
    except Exception:
        return False


def windows_login_enabled() -> bool:
    if auth_mode() != "ad":
        return False
    if (os.getenv("AD_WINDOWS_LOGIN") or "").strip() == "0":
        return False
    return _sspi_available()


def _default_server_auth():
    import sspi
    return sspi.ServerAuth("Negotiate")


def _account_name(server_auth) -> str:
    import sspicon
    return server_auth.ctxt.QueryContextAttributes(sspicon.SECPKG_ATTR_NAMES)


@dataclass(frozen=True)
class NegotiateStep:
    """한 번의 요청 결과. kind = challenge | continue | done | error."""
    kind: str
    out_token: str = ""      # base64, WWW-Authenticate: Negotiate <out_token>
    account: str = ""        # done 일 때 'HHI\\A476854'
    mechanism: str = ""      # NTLM | Kerberos
    error: str = ""


class NegotiateSessions:
    def __init__(
        self,
        server_auth_factory: Callable[[], Any] = _default_server_auth,
        account_name: Callable[[Any], str] = _account_name,
        now: Callable[[], float] = time.monotonic,
    ):
        self._factory = server_auth_factory
        self._account_name = account_name
        self._now = now
        self._lock = threading.Lock()
        self._pending: dict[tuple, tuple[Any, str, float]] = {}

    def _prune(self) -> None:
        cutoff = self._now() - _PENDING_TTL_SEC
        for key in [k for k, (_, _, t) in self._pending.items() if t < cutoff]:
            del self._pending[key]

    def step(self, conn_key: tuple, authorization: str) -> NegotiateStep:
        scheme, _, b64 = (authorization or "").strip().partition(" ")
        if scheme.lower() not in ("negotiate", "ntlm") or not b64.strip():
            with self._lock:
                self._pending.pop(conn_key, None)
            return NegotiateStep("challenge")
        try:
            token = base64.b64decode(b64.strip(), validate=True)
        except Exception:
            return NegotiateStep("error", error="bad_token")

        with self._lock:
            self._prune()
            entry = self._pending.pop(conn_key, None)
            if entry is None:
                same_ip = sum(1 for k in self._pending if k[0] == conn_key[0])
                if len(self._pending) >= _MAX_PENDING or same_ip >= _MAX_PENDING_PER_IP:
                    return NegotiateStep("error", error="busy")
        if entry is None:
            # 첫 토큰의 모양으로 방식을 가른다(NTLM 은 'NTLMSSP' 서명이 그대로 들어 있다).
            server_auth, mechanism = self._factory(), ("NTLM" if b"NTLMSSP" in token else "Kerberos")
        else:
            server_auth, mechanism, _ = entry

        try:
            err, out = server_auth.authorize(token)
        except Exception as exc:  # 틀린 토큰·로컬 계정·만료 등 — SSPI 가 거절
            return NegotiateStep("error", mechanism=mechanism, error=str(exc)[:200])
        out_bytes = bytes(out[0].Buffer) if out and out[0].Buffer else b""
        out_token = base64.b64encode(out_bytes).decode() if out_bytes else ""

        if err == SEC_I_CONTINUE_NEEDED:
            with self._lock:
                self._pending[conn_key] = (server_auth, mechanism, self._now())
            return NegotiateStep("continue", out_token=out_token, mechanism=mechanism)
        if err != 0:
            return NegotiateStep("error", mechanism=mechanism, error=f"sspi_status_{err:#x}")
        try:
            account = self._account_name(server_auth)
        except Exception as exc:
            return NegotiateStep("error", mechanism=mechanism, error=f"account_name: {exc}"[:200])
        return NegotiateStep("done", out_token=out_token, account=account, mechanism=mechanism)


def ntlm_claimed_account(authorization: str) -> Optional[str]:
    """NTLM 응답(3번째) 메시지에 평문으로 든 'DOMAIN\\user' — SSPI(도메인 컨트롤러)에 묻기 전에 읽는다.

    왜: 틀린 응답이 도메인으로 가면 그 직원의 회사 계정 실패 횟수가 오른다. 비밀번호 로그인처럼 사번별 횟수
    제한을 **묻기 전에** 걸려면 누구인지 먼저 알아야 한다. 확인된 값이 아니다(보낸 사람이 적은 이름) —
    횟수 제한 키로만 쓰고 로그인 판단에는 쓰지 않는다. NTLM 이 아니거나(Kerberos) 모양이 틀리면 None.
    """
    scheme, _, b64 = (authorization or "").strip().partition(" ")
    if scheme.lower() not in ("negotiate", "ntlm"):
        return None
    try:
        token = base64.b64decode(b64.strip(), validate=True)
    except Exception:
        return None
    start = token.find(b"NTLMSSP\x00")  # Negotiate 는 SPNEGO 로 감싸 보낸다
    if start < 0:
        return None
    msg = token[start:]
    if len(msg) < 64 or int.from_bytes(msg[8:12], "little") != 3:
        return None
    unicode = bool(int.from_bytes(msg[60:64], "little") & 0x1)

    def field(at: int) -> str:
        length = int.from_bytes(msg[at:at + 2], "little")
        offset = int.from_bytes(msg[at + 4:at + 8], "little")
        raw = msg[offset:offset + length]
        return raw.decode("utf-16-le" if unicode else "latin-1", errors="replace")

    domain, user = field(28), field(36)
    return f"{domain}\\{user}" if user else None


def windows_domains() -> frozenset:
    """자동 로그인에서 받는 도메인 = ``AD_NETBIOS_DOMAIN``(기본 HHI) + ``AD_WINDOWS_DOMAINS``(쉼표, 예 ``VMDC``).

    왜(2026-11-09): VMDC(가상 PC)에서는 Windows 계정이 ``VMDC\\<사번>`` 이다. 145(HHI)가 트러스트로 이 계정을
    확인까지 마쳤는데 도메인이 HHI 가 아니라고 거절해(``account_not_employee``) 비밀번호 창이 떴다.
    넣는 도메인은 **계정 이름 = 본인 사번** 이 보장되는 곳만 — 아니면 남의 사번으로 로그인된다.
    비밀번호 로그인(ad_auth)은 이 목록과 무관하게 ``AD_NETBIOS_DOMAIN`` 으로만 확인한다.
    """
    raw = os.getenv("AD_WINDOWS_DOMAINS") or ""
    names = {d.strip().upper() for d in raw.split(",") if d.strip()}
    # 기본 도메인은 늘 포함 — 목록에 HHI 를 빠뜨려도 일반 PC 자동 로그인이 멈추지 않게.
    names.add(_settings().domain.upper())
    return frozenset(names)


def employee_id_from_account(account: str, domain: Optional[str] = None) -> Optional[str]:
    """'HHI\\a476854' → 'A476854'. 받는 도메인(``windows_domains``)이 아니거나 로컬 계정·사번 모양이 아니면 None."""
    allowed = frozenset([domain.upper()]) if domain else windows_domains()
    dom, sep, name = (account or "").partition("\\")
    if not sep or dom.strip().upper() not in allowed:
        return None
    employee_id = name.strip().upper()
    return employee_id if _EMPLOYEE_ID.fullmatch(employee_id) else None


negotiate_sessions = NegotiateSessions()
