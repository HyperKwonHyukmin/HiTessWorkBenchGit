from dataclasses import replace
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app import models
from app.dependencies import require_auth
from app.routers import external_apps
from app.services.external_app_access import ExternalAppAccessStore


class MutableClock:
    def __init__(self, value: float = 100.0):
        self.value = value

    def __call__(self) -> float:
        return self.value


@pytest.fixture()
def proxy_harness(monkeypatch):
    clock = MutableClock()
    store = ExternalAppAccessStore(
        clock=clock,
        grant_ttl_seconds=5,
        session_ttl_seconds=60,
    )
    monkeypatch.setattr(external_apps, "external_app_access_store", store)
    monkeypatch.setattr(external_apps, "_employee_is_active", lambda _employee_id: True)

    captured = {"block-weld": [], "independent-tank": []}

    def make_client(app_key):
        async def handler(request: httpx.Request):
            body = await request.aread()
            captured[app_key].append(
                {
                    "method": request.method,
                    "url": str(request.url),
                    "headers": dict(request.headers),
                    "body": body,
                }
            )
            if request.url.path.endswith(".js"):
                return httpx.Response(
                    200,
                    content=b"console.log('asset')",
                    headers={"content-type": "application/javascript"},
                )
            if request.url.path.endswith("/cookie-check"):
                return httpx.Response(
                    200,
                    content=b"cookies",
                    headers=[
                        ("content-type", "application/octet-stream"),
                        ("set-cookie", "upstream_one=alpha; Path=/; HttpOnly"),
                        ("set-cookie", "wb_ext_block_weld=replace; Path=/external-apps"),
                        ("set-cookie", "upstream_two=beta; Path=/api; SameSite=Lax"),
                    ],
                )
            return httpx.Response(
                200,
                content=(
                    b'<html><head><script src="/app.js"></script></head>'
                    b"<body>external app</body></html>"
                ),
                headers={"content-type": "text/html; charset=utf-8"},
            )

        return httpx.AsyncClient(transport=httpx.MockTransport(handler))

    block_client = make_client("block-weld")
    tank_client = make_client("independent-tank")
    monkeypatch.setattr(
        external_apps,
        "BLOCK_WELD",
        replace(external_apps.BLOCK_WELD, get_client=lambda: block_client),
    )
    monkeypatch.setattr(
        external_apps,
        "INDEPENDENT_TANK",
        replace(external_apps.INDEPENDENT_TANK, get_client=lambda: tank_client),
    )

    app = FastAPI()
    app.include_router(external_apps.router)
    app.dependency_overrides[require_auth] = lambda: "USER001"
    return app, clock, captured


def _bootstrap(client: TestClient, proxy_path: str, *, cache_bust=False):
    response = client.post(
        f"{proxy_path}/__wb_bootstrap",
        json={"cache_bust": cache_bust},
        headers={"Authorization": "Bearer workbench-secret"},
    )
    assert response.status_code == 200
    launch_path = response.json()["launchPath"]
    assert "workbench-secret" not in launch_path
    return launch_path


def _exchange(client: TestClient, launch_path: str):
    response = client.get(launch_path, follow_redirects=False)
    assert response.status_code == 303
    return response


def test_access_store_can_revoke_all_credentials_for_employee():
    store = ExternalAppAccessStore()
    grant = store.issue_grant("block-weld", "A000001")
    first = store.issue_session("block-weld", "A000001")
    second = store.issue_session("independent-tank", "A000001")
    other = store.issue_session("block-weld", "A000002")

    assert store.revoke_employee("a000001") == 2
    assert store.consume_grant(grant, "block-weld") is None
    assert store.get_session(first, "block-weld") is None
    assert store.get_session(second, "independent-tank") is None
    assert store.get_session(other, "block-weld") is not None


def test_external_cookie_identity_is_revalidated_from_database(
    db_session,
    monkeypatch,
):
    SessionFactory = sessionmaker(
        bind=db_session.get_bind(),
        autocommit=False,
        autoflush=False,
    )
    monkeypatch.setattr(external_apps.database, "SessionLocal", SessionFactory)
    db_session.add(models.User(
        employee_id="A000001",
        name="사용자",
        company="HHI",
        is_active=True,
    ))
    db_session.commit()

    assert external_apps._employee_is_active("A000001") is True
    user = db_session.query(models.User).filter_by(employee_id="A000001").one()
    user.is_active = False
    db_session.commit()
    assert external_apps._employee_is_active("A000001") is False


def test_proxy_and_bootstrap_reject_unauthenticated_requests():
    app = FastAPI()
    app.include_router(external_apps.router)

    with TestClient(app) as client:
        bootstrap = client.post(
            "/external-apps/block-weld/__wb_bootstrap",
            json={"cache_bust": False},
        )
        root = client.get("/external-apps/block-weld/USER001")
        health = client.get("/external-apps/block-weld/__wb_proxy_health")

    assert bootstrap.status_code == 401
    assert root.status_code == 401
    assert health.status_code == 401


def test_grant_exchange_sets_clean_app_cookie_and_is_one_time(proxy_harness):
    app, _clock, _captured = proxy_harness

    with TestClient(app) as client:
        launch_path = _bootstrap(
            client,
            external_apps.BLOCK_WELD_PROXY_PATH,
            cache_bust=True,
        )
        grant = parse_qs(urlparse(launch_path).query)["grant"][0]
        assert grant

        response = _exchange(client, launch_path)
        location = response.headers["location"]
        set_cookie = response.headers["set-cookie"]

        assert location.startswith("/external-apps/block-weld/USER001?")
        assert "__wb_cache_bust=" in location
        assert "grant" not in location
        assert "HttpOnly" in set_cookie
        assert "SameSite=lax" in set_cookie
        assert "Path=/external-apps" in set_cookie
        assert "workbench-secret" not in set_cookie

        replay = client.get(launch_path, follow_redirects=False)
        assert replay.status_code == 401


def test_expired_grant_cannot_create_browser_session(proxy_harness):
    app, clock, _captured = proxy_harness

    with TestClient(app) as client:
        launch_path = _bootstrap(client, external_apps.BLOCK_WELD_PROXY_PATH)
        clock.value += 6
        response = client.get(launch_path, follow_redirects=False)

    assert response.status_code == 401
    assert "set-cookie" not in response.headers


@pytest.mark.parametrize(
    ("config_name", "proxy_path", "cookie_name"),
    [
        ("block-weld", external_apps.BLOCK_WELD_PROXY_PATH, "wb_ext_block_weld"),
        (
            "independent-tank",
            external_apps.INDEPENDENT_TANK_PROXY_PATH,
            "wb_ext_independent_tank",
        ),
    ],
)
def test_cookie_authorizes_assets_and_mutations_without_forwarding_credentials(
    proxy_harness,
    config_name,
    proxy_path,
    cookie_name,
):
    app, _clock, captured = proxy_harness

    with TestClient(app) as client:
        launch_path = _bootstrap(client, proxy_path)
        exchange = _exchange(client, launch_path)
        assert cookie_name in exchange.headers["set-cookie"]
        gateway_token = client.cookies.get(cookie_name)
        other_gateway_cookie = (
            "wb_ext_independent_tank"
            if cookie_name == "wb_ext_block_weld"
            else "wb_ext_block_weld"
        )
        browser_cookies = (
            f"{cookie_name}={gateway_token}; "
            f"{other_gateway_cookie}=other-gateway-secret; "
            "upstream_session=upstream-value"
        )

        asset = client.get(
            f"{proxy_path}/app.js",
            headers={
                "Authorization": "Bearer must-not-reach-upstream",
                "Cookie": browser_cookies,
            },
        )
        mutation = client.post(
            f"{proxy_path}/api/save?x=1&__wb_grant=must-not-reach-upstream",
            content=b'{"value":42}',
            headers={
                "Authorization": "Bearer must-not-reach-upstream",
                "Cookie": browser_cookies,
                "Content-Type": "application/json",
                "Forwarded": "for=192.0.2.1;host=evil.example",
                "X-Forwarded-For": "192.0.2.2",
                "X-Forwarded-Host": "evil.example",
            },
        )

    assert asset.status_code == 200
    assert mutation.status_code == 200
    assert len(captured[config_name]) == 2
    for upstream_request in captured[config_name]:
        assert "authorization" not in upstream_request["headers"]
        assert upstream_request["headers"]["cookie"] == (
            "upstream_session=upstream-value"
        )
        assert "gateway-secret" not in upstream_request["headers"]["cookie"]
        assert "forwarded" not in upstream_request["headers"]
        assert "x-forwarded-for" not in upstream_request["headers"]
        assert "x-forwarded-host" not in upstream_request["headers"]
        assert "__wb_grant" not in upstream_request["url"]
        assert "must-not-reach-upstream" not in upstream_request["url"]
    assert captured[config_name][1]["method"] == "POST"
    assert captured[config_name][1]["body"] == b'{"value":42}'
    assert captured[config_name][1]["url"].endswith("/api/save?x=1")


def test_mutation_without_browser_cookie_never_reaches_upstream(proxy_harness):
    app, _clock, captured = proxy_harness

    with TestClient(app) as client:
        response = client.delete("/external-apps/independent-tank/api/model/7")

    assert response.status_code == 401
    assert captured["independent-tank"] == []


def test_browser_session_cannot_select_another_employee_root(proxy_harness):
    app, _clock, captured = proxy_harness

    with TestClient(app) as client:
        launch_path = _bootstrap(client, external_apps.BLOCK_WELD_PROXY_PATH)
        _exchange(client, launch_path)
        own = client.get("/external-apps/block-weld/USER001")
        other = client.get("/external-apps/block-weld/A765432")

    assert own.status_code == 200
    assert other.status_code == 403
    assert len(captured["block-weld"]) == 1
    assert captured["block-weld"][0]["url"].endswith("/USER001")


def test_proxy_rejects_oversized_request_body_before_upstream(
    proxy_harness,
    monkeypatch,
):
    app, _clock, captured = proxy_harness
    monkeypatch.setattr(external_apps, "EXTERNAL_PROXY_MAX_BODY_BYTES", 4)

    with TestClient(app) as client:
        launch_path = _bootstrap(client, external_apps.BLOCK_WELD_PROXY_PATH)
        _exchange(client, launch_path)
        response = client.post(
            "/external-apps/block-weld/api/save",
            content=b"12345",
        )

    assert response.status_code == 413
    assert captured["block-weld"] == []


def test_inactive_account_revokes_browser_session(
    proxy_harness,
    monkeypatch,
):
    app, _clock, captured = proxy_harness

    with TestClient(app) as client:
        launch_path = _bootstrap(client, external_apps.BLOCK_WELD_PROXY_PATH)
        exchange = _exchange(client, launch_path)
        assert exchange.status_code == 303
        token = client.cookies.get("wb_ext_block_weld")

        monkeypatch.setattr(external_apps, "_employee_is_active", lambda _employee_id: False)
        response = client.get("/external-apps/block-weld/app.js")

    assert response.status_code == 401
    assert captured["block-weld"] == []
    assert external_apps.external_app_access_store.get_session(token, "block-weld") is None


def test_browser_session_revalidation_runs_outside_event_loop(
    proxy_harness,
    monkeypatch,
):
    app, _clock, captured = proxy_harness
    calls = []

    async def recording_threadpool(func, *args):
        calls.append((func, args))
        return func(*args)

    monkeypatch.setattr(external_apps, "run_in_threadpool", recording_threadpool)

    with TestClient(app) as client:
        launch_path = _bootstrap(client, external_apps.BLOCK_WELD_PROXY_PATH)
        _exchange(client, launch_path)
        response = client.get("/external-apps/block-weld/app.js")

    assert response.status_code == 200
    assert len(captured["block-weld"]) == 1
    assert calls == [(external_apps._employee_is_active, ("USER001",))]


def test_cookie_filter_is_fail_closed_and_preserves_valid_quoted_values():
    assert external_apps._upstream_cookie_header(
        "upstream_session=abc; $Path=/external-apps"
    ) == "upstream_session=abc"
    assert external_apps._upstream_cookie_header(
        "malformed-cookie; upstream_session=abc"
    ) is None
    assert external_apps._upstream_cookie_header(
        'quoted="value with spaces"; plain=abc'
    ) == 'quoted="value with spaces"; plain=abc'
    assert external_apps._upstream_cookie_header(
        'quoted="unterminated; plain=abc'
    ) is None
    assert external_apps._upstream_cookie_header(
        "plain=abc; broken pair=value"
    ) is None
    assert external_apps._upstream_cookie_header(
        "plain=abc\x01; later=value"
    ) is None


def test_proxy_preserves_multiple_set_cookie_fields_and_blocks_gateway_names(
    proxy_harness,
):
    app, _clock, _captured = proxy_harness

    with TestClient(app) as client:
        launch_path = _bootstrap(client, external_apps.BLOCK_WELD_PROXY_PATH)
        _exchange(client, launch_path)
        response = client.get("/external-apps/block-weld/cookie-check")

    assert response.status_code == 200
    set_cookie_values = response.headers.get_list("set-cookie")
    assert set_cookie_values == [
        "upstream_one=alpha; Path=/; HttpOnly",
        "upstream_two=beta; Path=/api; SameSite=Lax",
    ]
    assert all("wb_ext_block_weld" not in value for value in set_cookie_values)


@pytest.mark.parametrize(
    "path",
    [
        "//evil.example/steal",
        r"\evil.example\steal",
        "http://evil.example/steal",
        "../admin",
        "safe/%2e%2e/admin",
        "%2f%2fevil.example/steal",
        "%252f%252fevil.example/steal",
        "safe/%5c%5cevil.example",
        "safe/\x00/control",
    ],
)
def test_proxy_path_policy_rejects_host_escape_and_traversal(path):
    assert external_apps._path_is_safe(path) is False


@pytest.mark.parametrize(
    "path",
    ["USER001", "assets/app.js", "api/results/42", "models/member%20one.bdf"],
)
def test_proxy_path_policy_preserves_normal_subpaths(path):
    assert external_apps._path_is_safe(path) is True
