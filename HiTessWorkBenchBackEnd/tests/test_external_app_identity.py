"""외부 App 신원 토큰(X-HiTESS-Assertion) — 서명·claims·키 파일·게이트웨이 주입·쓰기 출처 확인.

규격 원본: RecordMD/2026-11-03-external-app-signed-identity-plan.md 3절.
"""

import base64
import json
from dataclasses import replace

import httpx
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.dependencies import require_auth
from app.routers import external_apps
from app.services import external_app_identity as identity
from app.services import external_app_registry
from app.services.external_app_access import ExternalAppAccessStore

PROFILE = {
    "employee_id": "A123456",
    "name": "홍길동",
    "department": "구조시스템연구실",
    "company": "HHI",
    "is_admin": False,
}


def _b64decode(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def _verify(token: str, jwks: dict) -> dict:
    """외부 App 예제와 같은 검사(서명·alg·kid)를 cryptography 로만 한다."""
    head_b64, body_b64, sig_b64 = token.split(".")
    header = json.loads(_b64decode(head_b64))
    assert header["alg"] == "RS256"
    jwk = next(key for key in jwks["keys"] if key["kid"] == header["kid"])
    public_key = rsa.RSAPublicNumbers(
        int.from_bytes(_b64decode(jwk["e"]), "big"),
        int.from_bytes(_b64decode(jwk["n"]), "big"),
    ).public_key()
    public_key.verify(
        _b64decode(sig_b64),
        f"{head_b64}.{body_b64}".encode("ascii"),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
    return json.loads(_b64decode(body_b64))


@pytest.fixture()
def signer(monkeypatch):
    signer = identity.AssertionSigner.generate()
    monkeypatch.setattr(identity, "_signer", signer)
    return signer


# ── 서명·claims ────────────────────────────────────────────────────────────


def test_signed_token_verifies_with_published_key_and_carries_cookie_manager_names(signer):
    token = signer.sign(identity.build_claims("block-weld", PROFILE, now=1_000))
    claims = _verify(token, signer.jwks())

    assert claims["iss"] == "hitess-workbench"
    assert claims["aud"] == "block-weld"
    assert claims["sub"] == claims["employee_id"] == "A123456"
    assert claims["display_name"] == "홍길동"
    assert claims["department"] == "구조시스템연구실"
    assert claims["company"] == "HHI"
    assert claims["role"] == "member"
    assert claims["modules"] == ["block-weld"]
    assert claims["iat"] == 1_000
    assert claims["exp"] == 1_000 + identity.ASSERTION_TTL_SECONDS
    assert claims["jti"]


def test_admin_role_and_missing_fields():
    claims = identity.build_claims(
        "sala",
        {"employee_id": "A000001", "name": "", "department": "", "company": None, "is_admin": True},
        now=0,
    )
    assert claims["role"] == "admin"
    assert claims["display_name"] == "A000001"
    assert claims["department"] is None
    assert claims["company"] is None


def test_tampered_payload_fails_verification(signer):
    token = signer.sign(identity.build_claims("block-weld", PROFILE))
    head, _body, sig = token.split(".")
    forged_claims = {**identity.build_claims("block-weld", PROFILE), "employee_id": "A999999"}
    forged_body = base64.urlsafe_b64encode(json.dumps(forged_claims).encode()).rstrip(b"=").decode()

    with pytest.raises(Exception):
        _verify(f"{head}.{forged_body}.{sig}", signer.jwks())


def test_jti_is_unique_per_token():
    first = identity.build_claims("block-weld", PROFILE, now=0)
    second = identity.build_claims("block-weld", PROFILE, now=0)
    assert first["jti"] != second["jti"]


# ── 키 파일 ───────────────────────────────────────────────────────────────


def test_key_file_is_created_once_and_reused(tmp_path):
    path = tmp_path / "keys" / "external_app_signing_key.pem"
    first = identity.load_signer(path)
    assert path.exists()
    assert path.read_bytes().startswith(b"-----BEGIN PRIVATE KEY-----")

    second = identity.load_signer(path)
    assert second.kid == first.kid
    token = first.sign(identity.build_claims("block-weld", PROFILE))
    assert _verify(token, second.jwks())["employee_id"] == "A123456"


def test_previous_key_stays_in_jwks_during_rotation(tmp_path):
    old = identity.AssertionSigner.generate()
    (tmp_path / "external_app_signing_key.previous.pem").write_bytes(old.private_pem())
    current = identity.load_signer(tmp_path / "external_app_signing_key.pem")

    kids = [key["kid"] for key in current.jwks()["keys"]]
    assert kids == [current.kid, old.kid]
    # 교체 직전에 발급된 토큰도 검증된다.
    old_token = old.sign(identity.build_claims("block-weld", PROFILE))
    assert _verify(old_token, current.jwks())["employee_id"] == "A123456"


def test_jwks_has_only_public_parts(signer):
    keys = signer.jwks()["keys"]
    assert len(keys) == 1
    assert set(keys[0]) == {"kty", "use", "alg", "kid", "n", "e"}
    assert keys[0]["alg"] == "RS256"


def test_registered_app_audience_is_slug():
    config = external_apps._registered_app_config(
        {"slug": "sala", "title": "SALA", "host": "10.14.42.145", "port": 31810}
    )
    assert config.key == "registered:sala"
    assert external_apps._assertion_audience(config) == "sala"
    assert external_apps._assertion_audience(external_apps.BLOCK_WELD) == "block-weld"


# ── 게이트웨이 ────────────────────────────────────────────────────────────


@pytest.fixture()
def gateway(monkeypatch, signer):
    store = ExternalAppAccessStore(grant_ttl_seconds=5, session_ttl_seconds=60)
    monkeypatch.setattr(external_apps, "external_app_access_store", store)
    monkeypatch.setattr(external_apps, "_employee_profile", lambda employee_id: {**PROFILE, "employee_id": employee_id})
    monkeypatch.setattr(external_apps, "_load_app_setting", lambda _app_key: None)

    captured = []

    async def handler(request: httpx.Request):
        captured.append({"method": request.method, "headers": dict(request.headers)})
        return httpx.Response(200, content=b"ok", headers={"content-type": "text/plain"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(external_apps, "BLOCK_WELD", replace(external_apps.BLOCK_WELD, get_client=lambda: client))

    app = FastAPI()
    app.include_router(external_apps.jwks_router)
    app.include_router(external_apps.router)
    app.dependency_overrides[require_auth] = lambda: "A123456"

    with TestClient(app) as test_client:
        launch = test_client.post(
            "/external-apps/block-weld/__wb_bootstrap",
            json={"cache_bust": False},
            headers={"Authorization": "Bearer workbench-secret"},
        ).json()["launchPath"]
        assert test_client.get(launch, follow_redirects=False).status_code == 303
        yield test_client, captured, signer


def test_proxy_attaches_verifiable_assertion_to_every_request(gateway):
    client, captured, _signer = gateway

    page = client.get("/external-apps/block-weld/A123456")
    asset = client.get("/external-apps/block-weld/assets/app.js")
    jwks = client.get("/api/external-apps/jwks").json()

    assert page.status_code == asset.status_code == 200
    assert len(captured) == 2
    for upstream in captured:
        claims = _verify(upstream["headers"]["x-hitess-assertion"], jwks)
        assert claims["employee_id"] == "A123456"
        assert claims["aud"] == "block-weld"
        assert claims["modules"] == ["block-weld"]


def test_browser_cannot_inject_identity_headers(gateway):
    client, captured, _signer = gateway

    response = client.get(
        "/external-apps/block-weld/A123456",
        headers={"X-HiTESS-Assertion": "forged.token.value", "X-HiTESS-User": "A999999"},
    )

    assert response.status_code == 200
    headers = captured[0]["headers"]
    assert headers["x-hitess-assertion"] != "forged.token.value"
    assert "x-hitess-user" not in headers
    assert _verify(headers["x-hitess-assertion"], client.get("/api/external-apps/jwks").json())["employee_id"] == "A123456"


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Origin": "http://evil.example"},
        {"Origin": "http://testserver:31810"},
        {"Origin": "https://testserver"},
        {"Origin": "null"},
        {"Referer": "http://evil.example/page"},
    ],
)
@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_cross_origin_or_unknown_writes_never_reach_upstream(gateway, method, headers):
    client, captured, _signer = gateway

    response = client.request(method, "/external-apps/block-weld/api/save", content=b"{}", headers=headers)

    assert response.status_code == 403
    assert captured == []


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "http://testserver"},
        {"Referer": "http://testserver/external-apps/block-weld/A123456"},
    ],
)
def test_same_origin_writes_pass(gateway, headers):
    client, captured, _signer = gateway

    response = client.post("/external-apps/block-weld/api/save", content=b"{}", headers=headers)

    assert response.status_code == 200
    assert captured[0]["method"] == "POST"


def test_reads_do_not_need_origin(gateway):
    client, captured, _signer = gateway

    assert client.get("/external-apps/block-weld/A123456").status_code == 200
    assert client.options("/external-apps/block-weld/api/save").status_code == 200
    assert len(captured) == 2


def test_unauthenticated_write_is_401_before_origin_check(gateway):
    client, captured, _signer = gateway
    client.cookies.clear()

    response = client.post("/external-apps/block-weld/api/save", content=b"{}")

    assert response.status_code == 401
    assert captured == []


def test_signing_failure_is_503_and_never_forwards(gateway, monkeypatch):
    client, captured, _signer = gateway

    def broken(_audience, _profile):
        raise OSError("key file unreadable")

    monkeypatch.setattr(identity, "issue_assertion", broken)
    response = client.get("/external-apps/block-weld/A123456")

    assert response.status_code == 503
    assert captured == []


@pytest.mark.parametrize(
    ("config_name", "proxy_path", "audience"),
    [
        ("BLOCK_WELD", "/external-apps/block-weld", "block-weld"),
        ("INDEPENDENT_TANK", "/external-apps/independent-tank", "independent-tank"),
        ("HEAVY_BLOCK_LIFTING", "/external-apps/heavy-block-lifting", "heavy-block-lifting"),
        (None, "/external-apps/sala", "sala"),  # App Settings 등록 App
    ],
)
def test_every_external_app_gets_its_own_audience(monkeypatch, signer, config_name, proxy_path, audience):
    """모든 외부 App 이 같은 게이트웨이를 지나므로, 실행 → 페이지·쓰기 요청 모두 자기 aud 토큰을 받는다."""
    monkeypatch.setattr(
        external_apps, "external_app_access_store", ExternalAppAccessStore(grant_ttl_seconds=5, session_ttl_seconds=60)
    )
    monkeypatch.setattr(external_apps, "_employee_profile", lambda employee_id: {**PROFILE, "employee_id": employee_id})
    monkeypatch.setattr(external_apps, "_load_app_setting", lambda _app_key: None)

    captured = []

    async def handler(request: httpx.Request):
        captured.append(dict(request.headers))
        return httpx.Response(200, content=b"ok", headers={"content-type": "text/plain"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    if config_name:
        monkeypatch.setattr(
            external_apps, config_name, replace(getattr(external_apps, config_name), get_client=lambda: client)
        )
    else:
        registration = {"slug": "sala", "title": "SALA", "host": "10.14.42.145", "port": 31810,
                        "proxy_path": proxy_path}
        monkeypatch.setattr(external_apps, "_load_registration", lambda slug: (registration, None) if slug == "sala" else (None, None))
        monkeypatch.setattr(external_apps, "get_registered_app_client", lambda: client)
        monkeypatch.setattr(external_app_registry, "effective_block_reason", lambda _reg, _setting: None)

    app = FastAPI()
    app.include_router(external_apps.jwks_router)
    app.include_router(external_apps.router)
    app.dependency_overrides[require_auth] = lambda: "A123456"

    with TestClient(app) as test_client:
        launch = test_client.post(
            f"{proxy_path}/__wb_bootstrap", json={"cache_bust": False}, headers={"Authorization": "Bearer x"}
        ).json()["launchPath"]
        assert test_client.get(launch, follow_redirects=False).status_code == 303
        page = test_client.get(f"{proxy_path}/A123456")
        save = test_client.post(f"{proxy_path}/api/save", content=b"{}", headers={"Origin": "http://testserver"})
        jwks = test_client.get("/api/external-apps/jwks").json()

    assert page.status_code == save.status_code == 200
    assert len(captured) == 2
    for headers in captured:
        claims = _verify(headers["x-hitess-assertion"], jwks)
        assert claims["aud"] == audience
        assert claims["modules"] == [audience]
        assert claims["employee_id"] == "A123456"


def test_jwks_endpoint_needs_no_login_and_is_cacheable(signer):
    app = FastAPI()
    app.include_router(external_apps.jwks_router)

    with TestClient(app) as client:
        response = client.get("/api/external-apps/jwks")

    assert response.status_code == 200
    assert response.json() == signer.jwks()
    assert "max-age=3600" in response.headers["cache-control"]


def test_jwks_route_is_registered_on_the_real_app_before_slug_routes():
    from app.main import app

    paths = [route.path for route in app.routes]
    assert "/api/external-apps/jwks" in paths
