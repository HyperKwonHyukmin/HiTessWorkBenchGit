"""관리자 웹 콘솔(app/routers/admin_web.py) — 페이지 서빙, 입구 검사, 가입 대기 숫자 API."""

import hashlib

import pytest
from fastapi.testclient import TestClient

from app import database, models
from app.main import app
from app.routers import admin_web
from app.sessions import session_store


@pytest.fixture()
def web_dir(tmp_path, monkeypatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "admin.html").write_text("<!doctype html><title>관리</title>", encoding="utf-8")
    (tmp_path / "assets" / "index-abc.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path / "assets" / "index-abc.css").write_text("body{}", encoding="utf-8")
    (tmp_path / "notes.txt").write_text("내부 메모", encoding="utf-8")
    (tmp_path.parent / "secret.js").write_text("바깥", encoding="utf-8")
    monkeypatch.setattr(admin_web, "ADMIN_WEB_DIR", tmp_path)
    return tmp_path


def test_page_and_assets(web_dir):
    client = TestClient(app)
    res = client.get("/admin", follow_redirects=False)
    assert res.status_code == 307 and res.headers["location"] == "/admin/"
    page = client.get("/admin/")
    assert page.status_code == 200 and "관리" in page.text
    assert page.headers["cache-control"] == "no-cache"
    js = client.get("/admin/assets/index-abc.js")
    assert js.status_code == 200 and "javascript" in js.headers["content-type"]
    assert "immutable" in js.headers["cache-control"]
    assert client.get("/admin/assets/index-abc.css").status_code == 200


def test_assets_reject_unknown_types_and_escapes(web_dir):
    client = TestClient(app)
    assert client.get("/admin/notes.txt").status_code == 404
    assert client.get("/admin/../secret.js").status_code == 404
    assert client.get("/admin/%2E%2E/secret.js").status_code == 404
    assert client.get("/admin//server/share/x.js").status_code == 404
    assert client.get("/admin/assets\\x.js").status_code == 404


def test_page_missing_is_404(tmp_path, monkeypatch):
    monkeypatch.setattr(admin_web, "ADMIN_WEB_DIR", tmp_path)
    assert TestClient(app).get("/admin/").status_code == 404


def test_drm_wrapped_page_is_500(web_dir):
    (web_dir / "admin.html").write_bytes(b"HHIDRMC" + b"\x00" * 10)
    assert TestClient(app).get("/admin/").status_code == 500


# ── API ──

@pytest.fixture()
def people(monkeypatch):
    """콘솔 사용자(관리자·지정 사번), 다른 관리자, 승인 대기 2명."""
    monkeypatch.setenv("ADMIN_CONSOLE_VIEWERS", "A111111")
    db = database.SessionLocal()
    rows = [
        models.User(employee_id="A111111", name="나", is_active=True, is_admin=True),
        models.User(employee_id="A222222", name="다른 관리자", is_active=True, is_admin=True),
        models.User(employee_id="A333333", name="대기1", is_active=False, is_admin=False),
        models.User(employee_id="A444444", name="대기2", is_active=False, is_admin=False),
    ]
    db.add_all(rows)
    db.commit()
    tokens = {r.employee_id: session_store.create(r.employee_id) for r in rows if r.is_active}
    db.close()
    yield tokens
    db = database.SessionLocal()
    db.query(models.User).filter(models.User.employee_id.in_([r.employee_id for r in rows])).delete(synchronize_session=False)
    db.commit()
    db.close()


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_access_only_for_listed_admin(people):
    client = TestClient(app)
    assert client.get("/api/admin-console/access").status_code == 401
    me = client.get("/api/admin-console/access", headers=_bearer(people["A111111"]))
    assert me.status_code == 200 and me.json()["allowed"] is True
    other = client.get("/api/admin-console/access", headers=_bearer(people["A222222"]))
    assert other.status_code == 200 and other.json()["allowed"] is False


def test_console_logout_revokes_only_that_token(people):
    client = TestClient(app)
    other = session_store.create("A111111")  # exe 쪽 세션이라고 본다
    res = client.post("/api/admin-console/logout", headers=_bearer(people["A111111"]))
    assert res.status_code == 200
    assert client.get("/api/admin-console/access", headers=_bearer(people["A111111"])).status_code == 401
    assert client.get("/api/admin-console/access", headers=_bearer(other)).json()["allowed"] is True
    assert client.post("/api/admin-console/logout").status_code == 200


def test_pending_count_with_bearer(people):
    client = TestClient(app)
    res = client.get("/api/admin-console/pending-count", headers=_bearer(people["A111111"]))
    assert res.status_code == 200 and res.json()["pending"] >= 2
    assert client.get("/api/admin-console/pending-count", headers=_bearer(people["A222222"])).status_code == 403
    assert client.get("/api/admin-console/pending-count").status_code == 401


def test_pending_count_with_streamdeck_key(people, monkeypatch):
    client = TestClient(app)
    key = "test-key-0123456789"
    header = {admin_web.STREAMDECK_KEY_HEADER: key}
    # 해시가 비어 있으면 열쇠 경로는 꺼져 있다
    monkeypatch.delenv("ADMIN_CONSOLE_STREAMDECK_KEY_SHA256", raising=False)
    assert client.get("/api/admin-console/pending-count", headers=header).status_code == 401
    monkeypatch.setenv("ADMIN_CONSOLE_STREAMDECK_KEY_SHA256", hashlib.sha256(key.encode()).hexdigest().upper())
    ok = client.get("/api/admin-console/pending-count", headers=header)
    assert ok.status_code == 200 and ok.json()["pending"] >= 2
    bad = client.get("/api/admin-console/pending-count", headers={admin_web.STREAMDECK_KEY_HEADER: "wrong"})
    assert bad.status_code == 401
    # 열쇠로는 다른 관리 API 를 못 쓴다
    assert client.get("/api/users", headers=header).status_code == 401


# ── LogBook 새 자료 수 ──

def _logbook_mock(monkeypatch, handler):
    import httpx
    monkeypatch.setenv("LOGBOOK_INTEGRATION_SECRET", "lb-secret")
    monkeypatch.setattr(admin_web, "_logbook_transport", httpx.MockTransport(handler))


def test_logbook_new_passes_since_and_exclude(people, monkeypatch):
    import httpx
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["secret"] = request.headers.get("X-HiTESS-Integration")
        return httpx.Response(200, json={"count": 4, "latest_at": "2026-11-18T10:00:00", "names": ["a.zip", "b.zip"],
                                         "uploading_since": "2026-11-18T08:30:00.123456"})

    _logbook_mock(monkeypatch, handler)
    client = TestClient(app)
    res = client.get("/api/admin-console/logbook-new", params={"since": "2026-11-18T09:00:00"},
                     headers=_bearer(people["A111111"]))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["count"] == 4 and body["names"] == ["a.zip", "b.zip"]
    assert body["uploading_since"] == "2026-11-18T08:30:00.123456"
    assert body["open_url"].endswith(":9095/")
    assert "exclude=A111111" in seen["url"] and "since=2026-11-18T09%3A00%3A00" in seen["url"]
    assert seen["secret"] == "lb-secret"


def test_logbook_new_with_streamdeck_key_excludes_first_viewer(people, monkeypatch):
    import httpx
    seen = {}
    key = "streamdeck-key-0123456789"
    monkeypatch.setenv("ADMIN_CONSOLE_STREAMDECK_KEY_SHA256", hashlib.sha256(key.encode()).hexdigest())
    _logbook_mock(monkeypatch, lambda r: (seen.setdefault("url", str(r.url)),
                                          httpx.Response(200, json={"count": 0, "names": ["H3496 FORE.zip"],
                                                                    "uploading_since": "엉뚱한 값"}))[1])
    res = TestClient(app).get("/api/admin-console/logbook-new", params={"since": "2026-11-18T09:00:00+09:00"},
                              headers={admin_web.STREAMDECK_KEY_HEADER: key})
    assert res.status_code == 200 and res.json()["count"] == 0
    assert res.json()["names"] == []            # 열쇠로는 묶음 이름을 주지 않는다
    assert res.json()["uploading_since"] is None  # 시각 모양이 아니면 버린다
    assert "exclude=A111111" in seen["url"]


def test_logbook_new_errors(people, monkeypatch):
    import httpx
    client = TestClient(app)
    h = _bearer(people["A111111"])
    assert client.get("/api/admin-console/logbook-new", params={"since": "어제"}, headers=h).status_code == 422
    assert client.get("/api/admin-console/logbook-new", params={"since": "2026-11-18T09:00:00"},
                      headers=_bearer(people["A222222"])).status_code == 403
    monkeypatch.delenv("LOGBOOK_INTEGRATION_SECRET", raising=False)
    assert client.get("/api/admin-console/logbook-new", params={"since": "2026-11-18T09:00:00"}, headers=h).status_code == 503
    _logbook_mock(monkeypatch, lambda r: httpx.Response(404, json={"detail": "not_found"}))
    res = client.get("/api/admin-console/logbook-new", params={"since": "2026-11-18T09:00:00"}, headers=h)
    assert res.status_code == 502 and res.json()["detail"] == "logbook_old_server"
