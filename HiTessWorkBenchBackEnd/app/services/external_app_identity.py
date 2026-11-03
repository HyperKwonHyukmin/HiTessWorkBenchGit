"""외부 App 에 넘기는 서명된 사용자 신원(JWT, RS256).

게이트웨이(`routers/external_apps.py`)가 요청마다 `X-HiTESS-Assertion` 헤더로 붙이고,
외부 App 은 `/api/external-apps/jwks` 의 공개키로 검증한다. 규격 원본 =
`RecordMD/2026-11-03-external-app-signed-identity-plan.md` 3절 — claim 이름은 45번 Cookie Manager 의
사용자 정보(`employee_id`·`display_name`·`role`·`modules`)와 같게 맞췄다.

개인키 = `.env` `EXTERNAL_APP_SIGNING_KEY_PATH`(기본 `<백엔드>/.secrets/external_app_signing_key.pem`, git 미추적).
없으면 처음 쓸 때 만든다. 같은 폴더의 `*.previous.pem` 은 키 교체 동안 JWKS 에만 싣는다.
새 의존성 없이 `cryptography` 로 직접 서명한다(알고리즘은 RS256 하나뿐).
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
from pathlib import Path
from threading import Lock
import time

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

logger = logging.getLogger(__name__)

ISSUER = "hitess-workbench"
ASSERTION_HEADER = "X-HiTESS-Assertion"
ASSERTION_TTL_SECONDS = 60
KEY_PATH_ENV = "EXTERNAL_APP_SIGNING_KEY_PATH"
_DEFAULT_KEY_PATH = Path(__file__).resolve().parents[2] / ".secrets" / "external_app_signing_key.pem"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _int_b64url(value: int) -> str:
    return _b64url(value.to_bytes((value.bit_length() + 7) // 8, "big"))


class AssertionSigner:
    """개인키 하나로 서명하고, 현재·이전 공개키를 JWKS 로 낸다."""

    def __init__(self, private_key: rsa.RSAPrivateKey, previous_public_keys=()):
        self._private_key = private_key
        self._public_keys = [private_key.public_key(), *previous_public_keys]
        self.kid = self._kid_of(private_key.public_key())

    @staticmethod
    def _kid_of(public_key: rsa.RSAPublicKey) -> str:
        modulus = _int_b64url(public_key.public_numbers().n)
        return hashlib.sha256(modulus.encode("ascii")).hexdigest()[:16]

    @classmethod
    def generate(cls) -> "AssertionSigner":
        return cls(rsa.generate_private_key(public_exponent=65537, key_size=2048))

    def private_pem(self) -> bytes:
        return self._private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )

    def sign(self, claims: dict) -> str:
        header = {"alg": "RS256", "typ": "JWT", "kid": self.kid}
        signing_input = ".".join(
            _b64url(json.dumps(part, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
            for part in (header, claims)
        )
        signature = self._private_key.sign(
            signing_input.encode("ascii"), padding.PKCS1v15(), hashes.SHA256()
        )
        return f"{signing_input}.{_b64url(signature)}"

    def jwks(self) -> dict:
        keys = []
        for public_key in self._public_keys:
            numbers = public_key.public_numbers()
            keys.append({
                "kty": "RSA",
                "use": "sig",
                "alg": "RS256",
                "kid": self._kid_of(public_key),
                "n": _int_b64url(numbers.n),
                "e": _int_b64url(numbers.e),
            })
        return {"keys": keys}


def _key_path() -> Path:
    configured = (os.environ.get(KEY_PATH_ENV) or "").strip()
    return Path(configured) if configured else _DEFAULT_KEY_PATH


def _load_private_key(path: Path) -> rsa.RSAPrivateKey:
    key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    if not isinstance(key, rsa.RSAPrivateKey):
        raise ValueError(f"RSA 개인키가 아닙니다: {path.name}")
    return key


def load_signer(path: Path) -> AssertionSigner:
    """파일에서 키를 읽는다. 없으면 만들어 저장한다(같은 폴더 *.previous.pem 은 JWKS 에만)."""

    if path.exists():
        private_key = _load_private_key(path)
    else:
        signer = AssertionSigner.generate()
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
        temporary.write_bytes(signer.private_pem())
        try:
            temporary.chmod(0o600)
        except OSError:  # Windows 는 폴더 ACL 로 막는다.
            pass
        temporary.replace(path)
        logger.warning("외부 App 서명 키가 없어 새로 만들었습니다: %s", path)
        private_key = _load_private_key(path)

    previous = []
    for old in sorted(path.parent.glob("*.previous.pem")):
        try:
            previous.append(_load_private_key(old).public_key())
        except (OSError, ValueError):
            logger.warning("이전 서명 키를 읽지 못해 JWKS 에서 뺍니다: %s", old.name, exc_info=True)
    return AssertionSigner(private_key, previous)


_signer: AssertionSigner | None = None
_signer_lock = Lock()


def get_signer() -> AssertionSigner:
    global _signer
    if _signer is None:
        with _signer_lock:
            if _signer is None:
                _signer = load_signer(_key_path())
    return _signer


def build_claims(audience: str, profile: dict, *, now: float | None = None) -> dict:
    """profile = {employee_id, name, department, company, is_admin} (WorkBench users 행)."""

    issued_at = int(now if now is not None else time.time())
    employee_id = profile["employee_id"]
    return {
        "iss": ISSUER,
        "aud": audience,
        "sub": employee_id,
        "employee_id": employee_id,
        "display_name": profile.get("name") or employee_id,
        "department": profile.get("department") or None,
        "company": profile.get("company") or None,
        "role": "admin" if profile.get("is_admin") else "member",
        # 게이트웨이가 이 App 을 열 권한을 확인한 뒤에만 발급하므로 항상 이 App 하나다.
        "modules": [audience],
        "iat": issued_at,
        "exp": issued_at + ASSERTION_TTL_SECONDS,
        "jti": secrets.token_urlsafe(12),
    }


def issue_assertion(audience: str, profile: dict) -> str:
    return get_signer().sign(build_claims(audience, profile))
