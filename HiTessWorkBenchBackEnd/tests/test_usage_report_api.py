"""GET /api/analysis/report 엔드포인트 API 테스트."""
from datetime import datetime, date


def test_report_endpoint_returns_200(admin_client, make_user, make_analysis):
    make_user("E001", department="구조해석팀")
    make_analysis("E001", "Truss Assessment", datetime(2026, 5, 20, 9, 0))
    r = admin_client.get("/api/analysis/report?period=daily&date=2026-05-20")
    assert r.status_code == 200
    body = r.json()
    assert body["period"]["type"] == "daily"
    assert body["summary"]["total"] == 1
    assert body["programs"][0]["name"] == "Truss Assessment"


def test_report_endpoint_default_date_yesterday(admin_client):
    r = admin_client.get("/api/analysis/report?period=daily")
    assert r.status_code == 200
    assert "summary" in r.json()


def test_report_endpoint_invalid_period(admin_client):
    r = admin_client.get("/api/analysis/report?period=yearly")
    assert r.status_code in (400, 422)


def test_report_endpoint_future_date(admin_client):
    r = admin_client.get("/api/analysis/report?period=daily&date=2099-01-01")
    assert r.status_code == 400


def test_report_endpoint_requires_admin(db_session, make_user):
    from fastapi.testclient import TestClient
    from app.main import app
    from app import database
    from app.dependencies import require_auth

    make_user("USER001", is_developer=False)

    def _override_db():
        yield db_session
    app.dependency_overrides[database.get_db] = _override_db
    app.dependency_overrides[require_auth] = lambda: "USER001"

    client = TestClient(app)
    r = client.get("/api/analysis/report?period=daily")
    assert r.status_code == 403
    app.dependency_overrides.clear()
