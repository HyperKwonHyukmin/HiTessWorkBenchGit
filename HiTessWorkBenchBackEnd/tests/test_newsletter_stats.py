"""웹 뉴스레터 조회 통계(app/services/newsletter_stats.py) — 공개 페이지 기록 · 측정값 · 나만 보는 통계."""

import json
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app import database, models
from app.dependencies import require_auth
from app.main import app
from app.routers import newsletter_web
from app.services import newsletter_stats

HTML = "<!doctype html><title>11월</title><body><section id=\"story\"></section></body>"


@pytest.fixture()
def client(db_session, tmp_path, monkeypatch):
    folder = tmp_path / "2026-11"
    folder.mkdir()
    (folder / "index.html").write_text(HTML, encoding="utf-8")
    (folder / "issue.json").write_text(json.dumps({"title": "26년 11월호"}, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(newsletter_web, "NEWSLETTER_WEB_DIR", tmp_path)
    monkeypatch.delenv("NEWSLETTER_STATS_VIEWERS", raising=False)

    def _db():
        yield db_session
    app.dependency_overrides[database.get_db] = _db
    yield TestClient(app)
    app.dependency_overrides.clear()


def _rows(db):
    return db.query(models.NewsletterView).all()


def test_page_view_recorded_once_per_visitor_per_day(client, db_session):
    for _ in range(3):
        assert client.get("/newsletter/2026-11/").status_code == 200
    rows = _rows(db_session)
    assert len(rows) == 1 and rows[0].views == 3 and rows[0].issue == "2026-11"
    # IP 원문 대신 해시(되돌릴 수 있는 해시라 익명 보장은 아님)
    assert "testclient" not in rows[0].visitor and len(rows[0].visitor) == 16


def test_head_does_not_count(client, db_session):
    client.head("/newsletter/2026-11/")
    assert _rows(db_session) == []


def test_tracker_script_injected_before_body_end(client):
    text = client.get("/newsletter/2026-11/").text
    assert "sendBeacon" in text and text.index("sendBeacon") < text.index("</body>")


def test_beacon_updates_depth_dwell_sections(client, db_session):
    client.get("/newsletter/2026-11/")
    res = client.post("/newsletter/2026-11/beacon", content=json.dumps(
        {"depth": 80, "dwell": 95, "sections": ["story", "apps", "<script>"]}))
    assert res.status_code == 204
    client.post("/newsletter/2026-11/beacon", content=json.dumps({"depth": 40, "dwell": 99999, "sections": ["manuals"]}))
    row = _rows(db_session)[0]
    db_session.refresh(row)
    assert row.max_depth == 80                      # 큰 값 유지
    assert row.dwell_seconds == 95 + newsletter_stats.MAX_DWELL_PER_BEACON  # 한 번에 받는 상한
    assert row.sections == ["story", "apps", "manuals"]  # 모르는 구획 이름은 버림


def test_beacon_without_page_view_creates_nothing(client, db_session):
    assert client.post("/newsletter/2026-11/beacon", content=b"not json").status_code == 204
    assert _rows(db_session) == []


def test_stats_only_for_listed_viewer(client, db_session):
    client.get("/newsletter/2026-11/")
    app.dependency_overrides[require_auth] = lambda: "A111111"   # 관리자여도 목록에 없으면 내용 없음
    res = client.get("/api/admin/newsletter-stats")
    assert res.status_code == 200 and res.json() == {"allowed": False}
    app.dependency_overrides[require_auth] = lambda: "a476854"   # 기본 열람자(대소문자 무시)
    res = client.get("/api/admin/newsletter-stats")
    assert res.status_code == 200
    issue = res.json()["issues"][0]
    assert issue["issue"] == "2026-11" and issue["title"] == "26년 11월호"
    assert issue["views"] == 1 and issue["visitors"] == 1 and issue["daily"][0]["views"] == 1
    assert set(issue["outcomes"]["before"]) == {"signups", "runs", "activeUsers", "videoPlays"}


def test_stats_viewers_env_override(monkeypatch):
    monkeypatch.setenv("NEWSLETTER_STATS_VIEWERS", "A1, b2")
    assert newsletter_stats.stats_viewers() == {"A1", "B2"}


def test_outcomes_count_windows(db_session, make_user):
    sent = datetime(2026, 11, 10)
    u = make_user("A100001")
    u.created_at = sent + timedelta(days=2)
    old = make_user("A100002")
    old.created_at = sent - timedelta(days=3)
    db_session.commit()
    out = newsletter_stats._outcomes(db_session, "2026-11-10")
    assert out["before"]["signups"] == 1 and out["after"]["signups"] == 1


def test_page_still_opens_when_recording_fails(client, monkeypatch):
    monkeypatch.setattr(newsletter_stats.models, "NewsletterView", None)
    assert client.get("/newsletter/2026-11/").status_code == 200


def test_sent_date_from_issue_json_wins(client, db_session):
    folder = newsletter_web.NEWSLETTER_WEB_DIR / "2026-11"
    (folder / "issue.json").write_text(json.dumps({"title": "26년 11월호", "sentDate": "2026-11-12"}), encoding="utf-8")
    client.get("/newsletter/2026-11/")
    app.dependency_overrides[require_auth] = lambda: "A476854"
    issue = client.get("/api/admin/newsletter-stats").json()["issues"][0]
    assert issue["outcomes"]["sentDay"] == "2026-11-12" and issue["sentDayFromIssue"] is True


def test_runs_exclude_samples_and_substeps(db_session):
    sent = datetime(2026, 11, 10)
    for name, source in [("HiTessModelBuilder", None), ("HiTessModelBuilder", "WorkbenchSample"),
                         ("UnitStructuralAnalysis", None), ("Truss", "web")]:
        db_session.add(models.Analysis(program_name=name, source=source, employee_id="A1",
                                       created_at=sent + timedelta(days=1)))
    db_session.commit()
    # 샘플·세부 검토 2건 제외 → 2건(이력 목록·월별 건수와 같은 기준)
    assert newsletter_stats._outcomes(db_session, "2026-11-10")["after"]["runs"] == 2
