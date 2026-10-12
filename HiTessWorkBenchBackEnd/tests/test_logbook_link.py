"""Hi-TESS LogBook 연동(`/api/logbook/*`)·로그아웃 통지 테스트.

LogBook 서버는 httpx.MockTransport 로 대신한다 — 실제 9095 나 DB 에는 붙지 않는다.
"""
import json
import os
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app import models
from app.routers import _access_control, auth, logbook_link
from app.services import logbook_integration as lb

SECRET = "test-shared-secret"
TOKEN = "11111111-2222-3333-4444-555555555555"


class Clock:
    def __init__(self):
        self.value = 1000.0

    def __call__(self):
        return self.value


@pytest.fixture()
def clock(monkeypatch):
    c = Clock()
    monkeypatch.setattr(lb, "launch_code_store", lb.LaunchCodeStore(clock=c))
    return c


@pytest.fixture()
def enabled(monkeypatch):
    monkeypatch.setenv("LOGBOOK_INTEGRATION_SECRET", SECRET)
    monkeypatch.delenv("LOGBOOK_BASE_URL", raising=False)
    monkeypatch.delenv("LOGBOOK_INTERNAL_URL", raising=False)


@pytest.fixture()
def user_conn(tmp_path, monkeypatch):
    base = tmp_path / "userConnection"
    base.mkdir()
    monkeypatch.setattr(logbook_link, "USER_CONNECTION_DIR", str(base))
    return base


def _auth():
    return {"Authorization": f"Bearer {TOKEN}"}


def _launch(client, body=None):
    return client.post("/api/logbook/launch", json=body or {}, headers=_auth())


# ── launch ──────────────────────────────────────────────────────────────────

def test_launch_disabled_without_secret(admin_client, clock, monkeypatch):
    monkeypatch.delenv("LOGBOOK_INTEGRATION_SECRET", raising=False)
    r = _launch(admin_client)
    assert r.status_code == 503
    assert r.json()["detail"] == "logbook_integration_disabled"


def test_launch_returns_sso_url_with_code(admin_client, db_session, clock, enabled):
    expires = datetime.now() + timedelta(hours=3)
    db_session.add(models.UserSession(
        token=TOKEN, employee_id="ADMIN001", created_at=datetime.now(), expires_at=expires,
    ))
    db_session.commit()

    r = _launch(admin_client, {"target": "gmu", "slot": 2})
    assert r.status_code == 200
    body = r.json()
    assert body["windowKey"] == "hitess-logbook"
    url = urlparse(body["url"])
    # 설정이 없으면 요청 Host 의 호스트명 + :9095 (TestClient Host = testserver)
    assert f"{url.scheme}://{url.netloc}" == "http://testserver:9095"
    assert url.path == "/sso"
    q = parse_qs(url.query)
    assert q["target"] == ["gmu"] and q["slot"] == ["2"]
    code = q["code"][0]
    grant = lb.launch_code_store.redeem(code)
    assert grant.employee_id == "ADMIN001"
    assert grant.wb_ref == lb.wb_ref_of(TOKEN)
    assert grant.wb_expires_at == expires


def test_launch_drops_invalid_target_and_slot(admin_client, clock, enabled, monkeypatch):
    monkeypatch.setenv("LOGBOOK_BASE_URL", "http://logbook.example:9095/")
    r = _launch(admin_client, {"target": "evil", "slot": 9})
    url = urlparse(r.json()["url"])
    assert url.netloc == "logbook.example:9095"
    q = parse_qs(url.query)
    assert set(q) == {"code"}

    r2 = _launch(admin_client, {"target": "gmu", "slot": 7})
    q2 = parse_qs(urlparse(r2.json()["url"]).query)
    assert q2["target"] == ["gmu"] and "slot" not in q2


def test_launch_truss_target_fixes_slot_to_1(admin_client, clock, enabled):
    # Truss Structural Assessment 는 작업 탭이 없는 단일 화면 — 어떤 slot 을 줘도 1 로 고정한다.
    for slot in (None, 1, 3, 9):
        r = _launch(admin_client, {"target": "truss", "slot": slot})
        assert r.status_code == 200
        q = parse_qs(urlparse(r.json()["url"]).query)
        assert q["target"] == ["truss"] and q["slot"] == ["1"]


def test_launch_rate_limited_per_employee(admin_client, clock, enabled):
    for _ in range(10):
        assert _launch(admin_client).status_code == 200
    r = _launch(admin_client)
    assert r.status_code == 429
    clock.value += 61
    assert _launch(admin_client).status_code == 200


# ── redeem ──────────────────────────────────────────────────────────────────

def _code(client):
    return parse_qs(urlparse(_launch(client).json()["url"]).query)["code"][0]


def test_redeem_requires_secret_header(admin_client, clock, enabled):
    code = _code(admin_client)
    assert admin_client.post("/api/logbook/redeem", json={"code": code}).status_code == 404
    r = admin_client.post(
        "/api/logbook/redeem", json={"code": code},
        headers={"X-HiTESS-Integration": "wrong"},
    )
    assert r.status_code == 404
    # 틀린 비밀키 시도로 코드가 소모되지 않는다.
    ok = admin_client.post(
        "/api/logbook/redeem", json={"code": code},
        headers={"X-HiTESS-Integration": SECRET},
    )
    assert ok.status_code == 200


def test_redeem_disabled_when_secret_empty(admin_client, clock, monkeypatch):
    monkeypatch.setenv("LOGBOOK_INTEGRATION_SECRET", "")
    r = admin_client.post(
        "/api/logbook/redeem", json={"code": "x"}, headers={"X-HiTESS-Integration": ""},
    )
    assert r.status_code == 404


def test_redeem_single_use(admin_client, clock, enabled):
    code = _code(admin_client)
    h = {"X-HiTESS-Integration": SECRET}
    r = admin_client.post("/api/logbook/redeem", json={"code": code}, headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["employee_id"] == "ADMIN001"
    assert body["wb_ref"] == lb.wb_ref_of(TOKEN)
    assert "wb_expires_at" in body
    again = admin_client.post("/api/logbook/redeem", json={"code": code}, headers=h)
    assert again.status_code == 404
    assert again.json()["detail"] == "code_invalid"


def test_redeem_expired(admin_client, clock, enabled):
    code = _code(admin_client)
    clock.value += 31
    r = admin_client.post(
        "/api/logbook/redeem", json={"code": code},
        headers={"X-HiTESS-Integration": SECRET},
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "code_invalid"


# ── import ──────────────────────────────────────────────────────────────────

def _mock_logbook(monkeypatch, handler):
    monkeypatch.setattr(logbook_link, "_http_transport", httpx.MockTransport(handler))


def test_import_happy_path(admin_client, db_session, enabled, user_conn, monkeypatch):
    seen = {}
    content = b"SOL 101\nCEND\nBEGIN BULK\nGRID,1,,0.,0.,0.\nENDDATA\n" * 1000

    def handler(request):
        seen["url"] = str(request.url)
        seen["secret"] = request.headers.get("X-HiTESS-Integration")
        return httpx.Response(200, content=content, headers={
            "X-LogBook-Entry": "E000123",
            "X-LogBook-File-Name": "3542_m09%20%ED%95%9C%EA%B8%80.bdf",
            "X-LogBook-Sha256": "x",
        })

    _mock_logbook(monkeypatch, handler)
    r = admin_client.post("/api/logbook/import", json={"file_id": 4512, "target": "GroupModuleUnit"},
                          headers=_auth())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["fileName"] == "3542_m09 한글.bdf"
    assert body["entryId"] == "E000123"
    assert body["fileId"] == 4512
    assert seen["secret"] == SECRET
    assert seen["url"].startswith("http://127.0.0.1:9095/api/integration/files/4512/content")
    assert "as=ADMIN001" in seen["url"]
    # LB 가 대상별 분류 규칙을 검사할 수 있게 짧은 대상 이름을 함께 보낸다.
    assert "target=gmu" in seen["url"]

    path = body["bdfServerPath"]
    with open(path, "rb") as fh:
        assert fh.read() == content
    folder = os.path.dirname(path)
    assert os.path.dirname(folder) == str(user_conn)
    assert os.path.basename(folder).endswith("_ADMIN001_LogBookImport")
    with open(os.path.join(folder, "logbook_source.json"), encoding="utf-8") as fh:
        src = json.load(fh)
    assert src["entryId"] == "E000123" and src["fileId"] == 4512
    assert src["employee_id"] == "ADMIN001" and len(src["sha256"]) == 64

    # GMU request-from-path 와 같은 소유자 검사를 통과한다(관리자 우회가 아니라 소유자 일치로).
    assert _access_control.owner_from_userconnection_path(path, str(user_conn)) == "ADMIN001"
    _access_control.assert_current_user_can_access_path(path, "ADMIN001", db_session, str(user_conn))


def test_import_sanitizes_hostile_file_name(admin_client, enabled, user_conn, monkeypatch):
    _mock_logbook(monkeypatch, lambda req: httpx.Response(
        200, content=b"x", headers={"X-LogBook-File-Name": "..%2F..%2Fevil.bdf"},
    ))
    r = admin_client.post("/api/logbook/import", json={"file_id": 7, "target": "GroupModuleUnit"},
                          headers=_auth())
    assert r.status_code == 200
    path = r.json()["bdfServerPath"]
    assert os.path.basename(path) == "evil.bdf"
    assert os.path.dirname(os.path.dirname(path)) == str(user_conn)


def test_import_falls_back_to_default_name(admin_client, enabled, user_conn, monkeypatch):
    _mock_logbook(monkeypatch, lambda req: httpx.Response(200, content=b"x"))
    r = admin_client.post("/api/logbook/import", json={"file_id": 9, "target": "GroupModuleUnit"},
                          headers=_auth())
    assert r.json()["fileName"] == "logbook_9.bdf"
    assert r.json()["entryId"] is None


@pytest.mark.parametrize("lb_status,status,detail", [
    (404, 404, "logbook_file_not_found"),
    (409, 409, "logbook_has_includes"),
    (415, 415, "logbook_not_bdf"),
    (500, 502, "logbook_unreachable"),
    (401, 502, "logbook_unreachable"),
])
def test_import_error_mapping(admin_client, enabled, user_conn, monkeypatch, lb_status, status, detail):
    _mock_logbook(monkeypatch, lambda req: httpx.Response(lb_status, json={"detail": "x"}))
    r = admin_client.post("/api/logbook/import", json={"file_id": 1, "target": "GroupModuleUnit"},
                          headers=_auth())
    assert r.status_code == status
    assert r.json()["detail"] == detail
    # 실패하면 반쯤 만든 폴더를 남기지 않는다.
    assert list(user_conn.iterdir()) == []


def test_import_truss_target_sends_truss_and_saves(admin_client, enabled, user_conn, monkeypatch):
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        return httpx.Response(200, content=b"CBAR", headers={"X-LogBook-File-Name": "truss.bdf"})

    _mock_logbook(monkeypatch, handler)
    r = admin_client.post("/api/logbook/import", json={"file_id": 11, "target": "TrussAssessment"},
                          headers=_auth())
    assert r.status_code == 200, r.text
    assert "target=truss" in seen["url"]
    folder = os.path.dirname(r.json()["bdfServerPath"])
    assert os.path.basename(folder).endswith("_ADMIN001_LogBookImport")
    with open(os.path.join(folder, "logbook_source.json"), encoding="utf-8") as fh:
        assert json.load(fh)["target"] == "TrussAssessment"


@pytest.mark.parametrize("lb_body,message", [
    ({"detail": "target_not_allowed", "message": "Truss 분류가 아닌 모델입니다."}, "Truss 분류가 아닌 모델입니다."),
    ({"detail": {"code": "target_not_allowed", "message": "구역이 다릅니다."}}, "구역이 다릅니다."),
    ({"detail": "target_not_allowed"}, None),
])
def test_import_target_not_allowed(admin_client, enabled, user_conn, monkeypatch, lb_body, message):
    _mock_logbook(monkeypatch, lambda req: httpx.Response(409, json=lb_body))
    r = admin_client.post("/api/logbook/import", json={"file_id": 1, "target": "TrussAssessment"},
                          headers=_auth())
    assert r.status_code == 409
    body = r.json()
    assert body["detail"] == "logbook_target_not_allowed"
    assert body.get("message") == message
    assert list(user_conn.iterdir()) == []


def test_import_connection_failure(admin_client, enabled, user_conn, monkeypatch):
    def handler(request):
        raise httpx.ConnectError("refused", request=request)

    _mock_logbook(monkeypatch, handler)
    r = admin_client.post("/api/logbook/import", json={"file_id": 1, "target": "GroupModuleUnit"},
                          headers=_auth())
    assert r.status_code == 502
    assert r.json()["detail"] == "logbook_unreachable"
    assert list(user_conn.iterdir()) == []


def test_import_disabled_and_bad_target(admin_client, user_conn, monkeypatch):
    monkeypatch.delenv("LOGBOOK_INTEGRATION_SECRET", raising=False)
    r = admin_client.post("/api/logbook/import", json={"file_id": 1, "target": "GroupModuleUnit"},
                          headers=_auth())
    assert r.status_code == 503
    monkeypatch.setenv("LOGBOOK_INTEGRATION_SECRET", SECRET)
    r2 = admin_client.post("/api/logbook/import", json={"file_id": 1, "target": "BdfScanner"},
                           headers=_auth())
    assert r2.status_code == 400


# ── 로그아웃 통지 ────────────────────────────────────────────────────────────

@pytest.fixture()
def logout_env(monkeypatch):
    revoked = []
    monkeypatch.setattr(auth.session_store, "revoke", lambda token: revoked.append(token))
    sent = []
    # 백그라운드 스레드 대신 즉시 실행해 결과를 확인한다.
    monkeypatch.setattr(lb, "_start_background", lambda target, *args: target(*args))
    monkeypatch.setattr(lb, "_send_logout", lambda wb_ref: sent.append(wb_ref))
    return revoked, sent


def test_logout_notifies_logbook_with_wb_ref(admin_client, enabled, logout_env):
    revoked, sent = logout_env
    r = admin_client.post("/api/logout", headers=_auth())
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert revoked == [TOKEN]
    assert sent == [lb.wb_ref_of(TOKEN)]


def test_logout_skips_notify_without_secret(admin_client, logout_env, monkeypatch):
    monkeypatch.delenv("LOGBOOK_INTEGRATION_SECRET", raising=False)
    _, sent = logout_env
    assert admin_client.post("/api/logout", headers=_auth()).status_code == 200
    assert sent == []


def test_logout_succeeds_when_notifier_raises(admin_client, enabled, logout_env, monkeypatch):
    def boom(_wb_ref):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(lb, "_send_logout", boom)
    assert admin_client.post("/api/logout", headers=_auth()).status_code == 200

    # 스레드 시작 자체가 실패해도 로그아웃은 성공한다.
    def broken_start(*_a, **_k):
        raise RuntimeError("no threads")

    monkeypatch.setattr(lb, "_start_background", broken_start)
    assert admin_client.post("/api/logout", headers=_auth()).status_code == 200


def test_force_logout_notifies_each_revoked_session(admin_client, db_session, enabled, logout_env):
    _, sent = logout_env
    now = datetime.now()
    db_session.add_all([
        models.UserSession(token="tok-a", employee_id="USER001", created_at=now,
                           expires_at=now + timedelta(hours=1)),
        models.UserSession(token="tok-b", employee_id="USER001", created_at=now,
                           expires_at=now + timedelta(hours=1)),
    ])
    db_session.commit()
    r = admin_client.post("/api/presence/force-logout/USER001")
    assert r.json()["revoked_sessions"] == 2
    assert sorted(sent) == sorted([lb.wb_ref_of("tok-a"), lb.wb_ref_of("tok-b")])
