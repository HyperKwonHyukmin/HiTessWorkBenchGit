"""기능 업데이트 안내 페이지(app/routers/updates_web.py)와 조회 기록(app/services/update_page_stats.py)."""

import json
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app import database, models
from app.dependencies import require_auth
from app.main import app
from app.routers import updates_web
from app.services import update_page_stats

ENTRIES = {"entries": [
    {"id": "2026-11-01-old", "date": "2026-11-01", "title": "옛 안내", "sections": [{"id": "how", "heading": "사용"}]},
    {"id": "2026-11-12-new", "date": "2026-11-12", "title": "새 안내", "programs": ["GroupModuleUnit"],
     "sections": [{"id": "what", "heading": "무엇"}, {"id": "how", "heading": "사용"}, {"id": "BAD id"}]},
    {"id": "../evil", "date": "2026-11-12", "title": "모양 틀림"},
    {"id": "2026-11-13-nodate", "title": "날짜 없음"},
]}


@pytest.fixture()
def client(db_session, tmp_path, monkeypatch):
    (tmp_path / "img").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>안내</title><body></body>", encoding="utf-8")
    (tmp_path / "updates.json").write_text(json.dumps(ENTRIES, ensure_ascii=False), encoding="utf-8")
    (tmp_path / "img" / "a.png").write_bytes(b"\x89PNG png")
    (tmp_path / "secret.py").write_text("x = 1", encoding="utf-8")
    monkeypatch.setattr(updates_web, "UPDATE_WEB_DIR", tmp_path)
    monkeypatch.delenv("NEWSLETTER_STATS_VIEWERS", raising=False)

    def _db():
        yield db_session
    app.dependency_overrides[database.get_db] = _db
    yield TestClient(app)
    app.dependency_overrides.clear()


def _rows(db):
    return db.query(models.UpdatePageView).all()


def _beacon(client, **payload):
    return client.post("/updates/beacon", content=json.dumps(payload))


def test_page_and_list_without_login(client):
    assert client.get("/updates", follow_redirects=False).headers["location"] == "/updates/"
    page = client.get("/updates/")
    assert page.status_code == 200 and "안내" in page.text
    entries = client.get("/updates/updates.json").json()["entries"]
    # 최신이 앞, 모양이 틀린 항목(id·날짜)은 빠지고, 틀린 구획 id 도 빠진다
    assert [e["id"] for e in entries] == ["2026-11-12-new", "2026-11-01-old"]
    assert [s["id"] for s in entries[0]["sections"]] == ["what", "how"]


def test_entry_address_serves_same_page(client):
    """페이지는 하나 — /updates/<안내 id> 도 같은 HTML(첫 화면은 페이지가 주소로 고른다)."""
    base = client.get("/updates/").text
    assert client.get("/updates/2026-11-01-old").text == base
    assert client.get("/updates/2026-01-01-gone").text == base   # 없는 안내 = 페이지가 최신으로
    res = client.get("/updates/2026-11-01-old/", follow_redirects=False)
    assert res.status_code == 307 and res.headers["location"] == "/updates/2026-11-01-old"
    assert client.get("/updates/img/a.png").content.startswith(b"\x89PNG")


def test_assets_only_allowed_types_inside_folder(client):
    assert client.get("/updates/img/a.png").status_code == 200
    assert client.get("/updates/secret.py").status_code == 404
    assert client.get("/updates/..%2Fupdates.json").status_code == 404
    assert client.get("/updates///host/share/x.png").status_code == 404


def test_view_then_measure(client, db_session):
    for _ in range(2):
        assert _beacon(client, entry="2026-11-12-new", type="view").status_code == 204
    assert _beacon(client, entry="2026-11-12-new", type="measure", depth=80, dwell=40,
                   sections=["what", "how", "<script>", "BAD id"]).status_code == 204
    rows = _rows(db_session)
    assert len(rows) == 1
    r = rows[0]
    assert r.views == 2 and r.max_depth == 80 and r.dwell_seconds == 40
    assert r.sections == ["what", "how"] and r.employee_id is None


def test_measure_without_view_and_unknown_entry_ignored(client, db_session):
    _beacon(client, entry="2026-11-12-new", type="measure", depth=50, dwell=10)
    _beacon(client, entry="2026-11-99-none", type="view")
    _beacon(client, entry="../evil", type="view")
    client.post("/updates/beacon", content=b"not json")
    assert _rows(db_session) == []


def test_signed_in_beacon_records_employee(client, db_session):
    app.dependency_overrides[require_auth] = lambda: "a476854"
    res = client.post("/api/updates/beacon", content=json.dumps({"entry": "2026-11-01-old", "type": "view"}))
    assert res.status_code == 204
    row = _rows(db_session)[0]
    assert row.employee_id == "A476854" and row.visitor != update_page_stats.visitor_key(ip="testclient")


def test_signed_in_beacon_needs_login(client):
    res = client.post("/api/updates/beacon", content=json.dumps({"entry": "2026-11-01-old", "type": "view"}))
    assert res.status_code == 401


def test_stats_only_for_listed_viewer(client, db_session):
    app.dependency_overrides[require_auth] = lambda: "A999999"
    assert client.get("/api/admin/update-stats").json() == {"allowed": False}
    app.dependency_overrides[require_auth] = lambda: "A476854"
    _beacon(client, entry="2026-11-12-new", type="view")
    _beacon(client, entry="2026-11-12-new", type="measure", depth=100, dwell=30, sections=["what"])
    client.post("/api/updates/beacon", content=json.dumps({"entry": "2026-11-12-new", "type": "view"}))
    data = client.get("/api/admin/update-stats").json()
    assert data["allowed"] is True
    new = data["entries"][0]
    assert new["entry"] == "2026-11-12-new" and new["views"] == 2
    assert new["browserVisitors"] == 1 and new["people"] == 1
    assert [s["reached"] for s in new["sections"]] == [1, 0]
    assert data["entries"][1]["views"] == 0     # 기록이 없는 안내도 0 으로 나온다


def test_app_effect_targets_who_saw(db_session, make_user):
    """대상 = 그 App 을 한 번이라도 실행한 사람(User Management App 사용자 필터와 같은 기준), 누가 봤는지까지."""
    day = datetime(2026, 11, 12)

    def run(emp, when, program="GroupModuleUnit", source=None):
        db_session.add(models.Analysis(program_name=program, employee_id=emp, created_at=when, source=source))

    u1 = make_user("A100001"); u1.name = "가"; u1.email = "a@x.com"
    make_user("A100002").name = "나"
    run("A100001", day - timedelta(days=3))
    run("a100002 ", day - timedelta(days=200))                          # 오래전 사용자도 대상, 사번은 대문자로 합친다
    run("A100003", day - timedelta(days=3), program="Truss")             # 다른 앱
    run("A100004", day - timedelta(days=3), source="WorkbenchSample")    # 샘플 실행은 빼고 센다
    run("A100005", day - timedelta(days=3), program="ModuleStability")   # 권상 세부 검토(내부 단계)도 뺀다
    run("A100001", day + timedelta(days=1))
    for emp, d in (("A100001", "2026-11-13"), ("A100001", "2026-11-12"), ("A100009", "2026-11-12")):
        db_session.add(models.UpdatePageView(entry="e", visitor=emp + d, employee_id=emp, day=d,
                                             views=1, max_depth=0, dwell_seconds=0, sections=[]))
    db_session.commit()
    entry = {"id": "e", "date": "2026-11-12", "title": "t", "programs": ["GroupModuleUnit", "ModuleStability"], "sections": []}
    out = update_page_stats.build_stats(db_session, [entry])["entries"][0]
    effect = out["appEffect"]
    assert out["people"] == 2
    assert effect["targetUsers"] == 2 and effect["viewedTargets"] == 1 and effect["otherViewers"] == 1
    assert [(t["employeeId"], t["name"], t["seenDay"]) for t in effect["targets"]] == [
        ("A100001", "가", "2026-11-12"), ("A100002", "나", None)]
    assert effect["targets"][0]["email"] == "a@x.com"


def test_repo_updates_json_is_valid():
    """저장소의 실제 updates.json — 모든 항목이 걸러지지 않고 그림 경로가 실제 파일이어야 한다."""
    raw = json.loads((updates_web.UPDATE_WEB_DIR / "updates.json").read_text(encoding="utf-8"))["entries"]
    loaded = updates_web.load_entries()
    assert len(loaded) == len(raw)
    for e in loaded:
        for s in e["sections"]:
            if s.get("image"):
                assert (updates_web.UPDATE_WEB_DIR / s["image"]["src"]).is_file()
    assert (updates_web.UPDATE_WEB_DIR / "fonts" / "SUIT-Variable.woff2").read_bytes()[:4] == b"wOF2"


def test_changelog_pages_point_to_real_entries():
    """Update History(changelog.json) 의 page 는 실제 안내 id 여야 한다 — 지운 안내를 가리키면 '사용자 안내 페이지' 단추가 최신 안내를 연다."""
    from pathlib import Path
    changelog = json.loads((Path(updates_web.__file__).resolve().parent.parent / "changelog" / "changelog.json").read_text(encoding="utf-8"))
    ids = {e["id"] for e in updates_web.load_entries()}
    pages = [i["page"] for i in changelog["items"] if i.get("page")]
    assert pages and all(p in ids for p in pages)
