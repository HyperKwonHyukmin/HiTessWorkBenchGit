"""GET/PUT /api/preferences — 부분 병합, ignored_keys 응답, 422, 사번 격리, 401.

conftest 의 admin_client 는 require_auth 를 ADMIN001 로 고정. 다른 사용자 시점은
test_notifications_router.py 와 같은 _act_as() 로 override 만 교체한다.
"""
from datetime import datetime

from app import models
from app.dependencies import require_auth
from app.main import app


def _act_as(employee_id: str):
    app.dependency_overrides[require_auth] = lambda: employee_id


def test_get_returns_defaults_when_no_row(admin_client, db_session):
    data = admin_client.get("/api/preferences").json()
    assert data["prefs"] == {
        "favorites": [],
        "recent_apps": [],
        "notifications": {"muted_kinds": [], "desktop_toast": True},
        "landing_menu": None,
    }
    assert data["updated_at"] is None
    # 조회만으로 행이 생겨선 안 된다(GET 은 사이드이펙트 없음).
    assert db_session.query(models.UserPreference).count() == 0


def test_get_returns_stored_values_with_iso_updated_at(admin_client, db_session):
    row = models.UserPreference(
        employee_id="ADMIN001",
        prefs={"favorites": ["BDF Scanner"], "landing_menu": "My Projects"},
        updated_at=datetime(2026, 9, 18, 10, 0, 0),
    )
    db_session.add(row)
    db_session.commit()

    data = admin_client.get("/api/preferences").json()
    assert data["prefs"]["favorites"] == ["BDF Scanner"]
    assert data["prefs"]["landing_menu"] == "My Projects"
    # 기본값이 채워졌는지 확인
    assert data["prefs"]["notifications"] == {"muted_kinds": [], "desktop_toast": True}
    assert data["updated_at"] == row.updated_at.isoformat()


def test_put_creates_row_and_returns_merged(admin_client, db_session):
    res = admin_client.put("/api/preferences", json={"favorites": ["Truss Analysis"]})
    assert res.status_code == 200
    body = res.json()
    assert body["ignored_keys"] == []
    assert body["prefs"]["favorites"] == ["Truss Analysis"]

    row = db_session.query(models.UserPreference).one()
    assert row.employee_id == "ADMIN001"
    assert row.prefs["favorites"] == ["Truss Analysis"]
    assert row.updated_at is not None


def test_put_merges_partially_and_persists(admin_client, db_session):
    admin_client.put("/api/preferences", json={
        "favorites": ["A"],
        "notifications": {"muted_kinds": ["notice.published"]},
    })
    admin_client.put("/api/preferences", json={"landing_menu": "  My Projects  "})
    admin_client.put("/api/preferences", json={"notifications": {"desktop_toast": False}})

    data = admin_client.get("/api/preferences").json()
    assert data["prefs"] == {
        "favorites": ["A"],
        "recent_apps": [],
        "notifications": {"muted_kinds": ["notice.published"], "desktop_toast": False},
        "landing_menu": "My Projects",
    }
    # DB 재조회로 실제 영속 확인
    db_session.expire_all()
    row = db_session.query(models.UserPreference).one()
    assert row.prefs["favorites"] == ["A"]
    assert row.prefs["notifications"] == {"muted_kinds": ["notice.published"], "desktop_toast": False}


def test_put_unknown_keys_are_ignored_not_422(admin_client, db_session):
    res = admin_client.put("/api/preferences",
                           json={"favorites": ["A"], "dark_mode": True, "future_key": {"x": 1}})
    assert res.status_code == 200
    body = res.json()
    assert set(body["ignored_keys"]) == {"dark_mode", "future_key"}
    assert body["prefs"]["favorites"] == ["A"]


def test_put_bad_value_types_are_422(admin_client):
    assert admin_client.put("/api/preferences", json={"favorites": "not a list"}).status_code == 422
    assert admin_client.put("/api/preferences",
                            json={"notifications": {"desktop_toast": "yes"}}).status_code == 422
    assert admin_client.put("/api/preferences",
                            json={"notifications": {"muted_kinds": ["job.done"]}}).status_code == 422
    assert admin_client.put("/api/preferences",
                            json={"landing_menu": "M" * 201}).status_code == 422


def test_put_rejects_non_object_body(admin_client):
    r = admin_client.put("/api/preferences", json=["favorites"])
    assert r.status_code == 422


def test_recent_apps_normalization_through_put(admin_client, db_session):
    res = admin_client.put("/api/preferences", json={"recent_apps": [
        {"menu": "BDF Scanner", "at": 100},
        {"menu": "BDF Scanner", "at": 500},
        {"menu": "Truss Analysis", "at": 300, "label": "Truss Analysis"},
        {"label": "no menu"},
    ]})
    assert res.status_code == 200
    apps = res.json()["prefs"]["recent_apps"]
    assert [x["menu"] for x in apps] == ["BDF Scanner", "Truss Analysis"]
    assert apps[0]["at"] == 500


def test_preferences_are_isolated_per_employee(admin_client, db_session):
    admin_client.put("/api/preferences", json={"favorites": ["A"]})
    _act_as("EMP001")
    data = admin_client.get("/api/preferences").json()
    assert data["prefs"]["favorites"] == []  # 다른 사번은 자기 것 없음
    admin_client.put("/api/preferences", json={"favorites": ["B"]})

    _act_as("ADMIN001")
    assert admin_client.get("/api/preferences").json()["prefs"]["favorites"] == ["A"]
    assert db_session.query(models.UserPreference).count() == 2


def test_requires_auth(admin_client):
    saved = app.dependency_overrides.pop(require_auth)
    try:
        assert admin_client.get("/api/preferences").status_code == 401
        assert admin_client.put("/api/preferences", json={}).status_code == 401
    finally:
        app.dependency_overrides[require_auth] = saved
