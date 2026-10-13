"""App Settings 에서 외부 앱을 등록 → 카탈로그·프록시 입구가 생기는지 검증."""

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app import database, models
from app.dependencies import require_auth
from app.routers import external_apps
from app.services import app_settings as app_settings_service
from app.services import external_app_registry as registry
from app.services.external_app_access import ExternalAppAccessStore

BASE = "/api/admin/external-app-registry"

VALID = {
    "slug": "block-lug",
    "title": "Block Lug Planner",
    "description": "러그 배치 도구",
    "mode": "Interactive",
    "category": "Lifting",
    "art": "lift",
    "tags": ["Lug", " 러그 "],
    "contributor": "외부 개발자",
    "dev_status": "Active",
    "host": "10.14.42.200",
    "port": 31890,
}


@pytest.fixture(autouse=True)
def _clear_caches():
    registry.invalidate_cache()
    app_settings_service.invalidate_cache()
    yield
    registry.invalidate_cache()
    app_settings_service.invalidate_cache()


def _create(admin_client, **overrides):
    return admin_client.post(BASE, json={**VALID, **overrides})


# ── 등록·수정·삭제 ───────────────────────────────────────────────


def test_create_then_listed_publicly_without_address(admin_client):
    created = _create(admin_client)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["proxy_path"] == "/external-apps/block-lug"
    assert body["tags"] == ["Lug", "러그"]
    assert (body["host"], body["port"]) == ("10.14.42.200", 31890)

    public = admin_client.get("/api/external-app-registry").json()
    assert [row["slug"] for row in public] == ["block-lug"]
    assert "host" not in public[0] and "port" not in public[0]
    assert public[0]["category"] == "Lifting" and public[0]["art"] == "lift"


@pytest.mark.parametrize(
    ("overrides", "status"),
    [
        ({"slug": "Block_Lug"}, 422),
        ({"slug": "-lug"}, 422),
        ({"slug": "block-weld"}, 409),          # 코드 외부 앱 주소
        ({"title": "Block Weld Assessment"}, 409),  # 코드 앱 이름
        ({"title": "HiTESS Model Builder"}, 409),
        ({"host": "8.8.8.8"}, 422),             # 사내망 밖
        ({"host": "127.0.0.1"}, 422),           # 서버 자신
        ({"host": "server.local"}, 422),        # 이름은 대역 확인 불가
        ({"port": 0}, 422),
        ({"mode": "Other"}, 422),
        ({"category": " "}, 422),
        ({"art": "rocket"}, 422),
        ({"dev_status": "Hidden"}, 422),
    ],
)
def test_create_rejects_invalid_values(admin_client, overrides, status):
    assert _create(admin_client, **overrides).status_code == status


def test_duplicate_slug_or_title_is_rejected(admin_client):
    assert _create(admin_client).status_code == 201
    assert _create(admin_client, title="Other Name").status_code == 409
    assert _create(admin_client, slug="other-slug").status_code == 409


def test_update_changes_address_and_meta_but_not_identity(admin_client):
    _create(admin_client)
    updated = admin_client.put(
        f"{BASE}/block-lug",
        json={"host": "10.14.42.201", "port": 31891, "category": "Weld", "art": "weld"},
    )
    assert updated.status_code == 200
    body = updated.json()
    assert (body["host"], body["port"], body["category"], body["art"]) == (
        "10.14.42.201", 31891, "Weld", "weld",
    )
    assert body["title"] == "Block Lug Planner"
    assert admin_client.put(f"{BASE}/block-lug", json={"host": "1.1.1.1"}).status_code == 422
    assert admin_client.put(f"{BASE}/block-lug", json={"category": None}).status_code == 422
    assert admin_client.put(f"{BASE}/missing", json={"art": "weld"}).status_code == 404


def test_delete_removes_registration_and_its_settings(admin_client, db_session):
    _create(admin_client)
    admin_client.put(
        "/api/admin/app-settings/Block Lug Planner", json={"maintenance": True}
    )
    assert admin_client.delete(f"{BASE}/block-lug").status_code == 200
    assert admin_client.get("/api/external-app-registry").json() == []
    assert db_session.query(models.AppSetting).filter_by(app_key="Block Lug Planner").first() is None


def test_endpoint_list_includes_registered_apps(admin_client):
    _create(admin_client)
    rows = {
        row["app_key"]: row
        for row in admin_client.get("/api/admin/app-settings/external-apps").json()
    }
    row = rows["Block Lug Planner"]
    assert row["registered"] is True and row["slug"] == "block-lug"
    assert (row["host"], row["port"]) == ("10.14.42.200", 31890)


def test_registered_app_rejects_settings_address_override(admin_client):
    """등록 앱 주소는 등록 정보로만 바꾼다(app_settings 오버라이드와 이중 관리 방지)."""
    _create(admin_client)
    response = admin_client.put(
        "/api/admin/app-settings/Block Lug Planner", json={"external_host": "10.0.0.1"}
    )
    assert response.status_code == 422


def test_private_ip_rule():
    assert registry.is_private_ipv4("10.14.42.145")
    assert registry.is_private_ipv4("172.16.0.1")
    assert registry.is_private_ipv4("192.168.1.10")
    assert not registry.is_private_ipv4("172.32.0.1")
    assert not registry.is_private_ipv4("8.8.8.8")
    assert not registry.is_private_ipv4("127.0.0.1")
    assert not registry.is_private_ipv4("169.254.1.1")
    assert not registry.is_private_ipv4("10.14.42.145:80")


# ── 프록시 입구 ─────────────────────────────────────────────────


@pytest.fixture()
def registered_proxy(admin_client, db_session, monkeypatch):
    """등록 API 로 만든 앱을 실제 DB 조회 경로 그대로 프록시로 연다."""
    monkeypatch.setattr(database, "SessionLocal", sessionmaker(bind=db_session.get_bind()))
    db_session.add_all([
        models.User(employee_id="A100001", name="사용자", company="HHI", is_active=True, is_admin=False),
    ])
    db_session.commit()

    class _Clock:
        value = 1000.0

        def __call__(self):
            return self.value

    monkeypatch.setattr(
        external_apps,
        "external_app_access_store",
        ExternalAppAccessStore(clock=_Clock(), grant_ttl_seconds=5, session_ttl_seconds=60),
    )
    seen = []

    async def handler(request: httpx.Request):
        seen.append({
            "url": str(request.url),
            "host": request.headers.get("host"),
            "cookie": request.headers.get("cookie"),
        })
        return httpx.Response(
            200,
            content=b'<html><head><script src="/app.js"></script></head><body>ok</body></html>',
            headers={"content-type": "text/html; charset=utf-8"},
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(external_apps, "get_registered_app_client", lambda: client)

    proxy_app = FastAPI()
    proxy_app.include_router(external_apps.router)
    identity = {"employee_id": "A100001"}
    proxy_app.dependency_overrides[require_auth] = lambda: identity["employee_id"]
    return proxy_app, seen, identity


def _launch(client, slug):
    issued = client.post(f"/external-apps/{slug}/__wb_bootstrap", json={"cache_bust": False})
    assert issued.status_code == 200, issued.text
    exchanged = client.get(issued.json()["launchPath"], follow_redirects=False)
    assert exchanged.status_code == 303
    return exchanged


def test_registered_app_opens_through_proxy(admin_client, registered_proxy):
    proxy_app, seen, _identity = registered_proxy
    assert _create(admin_client).status_code == 201

    with TestClient(proxy_app) as client:
        exchanged = _launch(client, "block-lug")
        assert exchanged.headers["location"] == "/external-apps/block-lug/A100001"
        assert "wb_ext_app_block_lug" in exchanged.headers["set-cookie"]
        page = client.get(
            "/external-apps/block-lug/A100001",
            headers={"Cookie": f"wb_ext_app_block_lug={client.cookies.get('wb_ext_app_block_lug')}; other=1"},
        )
        health = client.get("/external-apps/block-lug/__wb_proxy_health")
        other_user = client.get("/external-apps/block-lug/A765432")

    assert page.status_code == 200
    assert 'src="/external-apps/block-lug/app.js"' in page.text
    assert health.status_code == 200
    assert other_user.status_code == 403
    assert seen[0]["url"] == "http://10.14.42.200:31890/A100001"
    assert seen[0]["host"] == "10.14.42.200:31890"
    # 게이트웨이 쿠키는 외부 앱으로 넘어가지 않는다.
    assert seen[0]["cookie"] == "other=1"


def test_registered_app_follows_address_change(admin_client, registered_proxy):
    proxy_app, seen, _identity = registered_proxy
    _create(admin_client)
    admin_client.put(f"{BASE}/block-lug", json={"host": "10.14.42.201", "port": 31891})

    with TestClient(proxy_app) as client:
        _launch(client, "block-lug")
        client.get("/external-apps/block-lug/A100001")

    assert seen[-1]["url"] == "http://10.14.42.201:31891/A100001"


def test_unknown_slug_is_404_and_code_apps_keep_their_routes(registered_proxy):
    proxy_app, _seen, _identity = registered_proxy
    with TestClient(proxy_app) as client:
        assert client.post(
            "/external-apps/nothing/__wb_bootstrap", json={"cache_bust": False}
        ).status_code == 404
        # 코드 앱 경로는 등록 앱 catch-all 보다 먼저 잡혀 자기 실행 권한을 발급한다.
        issued = client.post("/external-apps/block-weld/__wb_bootstrap", json={"cache_bust": False})
    assert issued.status_code == 200
    assert issued.json()["launchPath"].startswith("/external-apps/block-weld/__wb_bootstrap")


def test_developing_registered_app_is_blocked_for_regular_users(admin_client, registered_proxy, db_session):
    proxy_app, _seen, identity = registered_proxy
    _create(admin_client, dev_status="Developing")

    with TestClient(proxy_app) as client:
        blocked = client.post("/external-apps/block-lug/__wb_bootstrap", json={"cache_bust": False})
        assert blocked.status_code == 403

        # 관리자는 개발 중인 앱도 연다.
        identity["employee_id"] = "ADMIN001"
        assert client.post(
            "/external-apps/block-lug/__wb_bootstrap", json={"cache_bust": False}
        ).status_code == 200

    # App Settings 오버라이드(점검)가 등록값보다 우선한다.
    admin_client.put(f"{BASE}/block-lug", json={"dev_status": "Active"})
    admin_client.put("/api/admin/app-settings/Block Lug Planner", json={"maintenance": True})
    registry.invalidate_cache()
    app_settings_service.invalidate_cache()
    identity["employee_id"] = "A100001"
    with TestClient(proxy_app) as client:
        assert client.post(
            "/external-apps/block-lug/__wb_bootstrap", json={"cache_bust": False}
        ).status_code == 403


def test_slow_upstream_returns_clear_504(admin_client, registered_proxy, monkeypatch):
    """30초 안에 응답하지 않으면 원인이 빈 502 대신 이유가 적힌 504 를 준다."""
    proxy_app, _seen, _identity = registered_proxy
    _create(admin_client)

    async def slow(request: httpx.Request):
        raise httpx.ReadTimeout("timed out", request=request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(slow))
    monkeypatch.setattr(external_apps, "get_registered_app_client", lambda: client)

    with TestClient(proxy_app) as test_client:
        _launch(test_client, "block-lug")
        response = test_client.get("/external-apps/block-lug/A100001/api/long")

    assert response.status_code == 504
    assert "30초 안에 응답하지 않았습니다" in response.json()["detail"]
