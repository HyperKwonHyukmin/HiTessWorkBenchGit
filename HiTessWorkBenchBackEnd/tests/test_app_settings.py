"""App별 관리자 설정 API + 접근 게이트 회귀 테스트."""

import pytest

from app import database, models
from app.main import app
from app.services import app_settings as svc
from app.sessions import session_store

APP_KEY = "Truss Model Builder"
GUARDED_PATH = "/api/analysis/truss/request"


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    """TTL 캐시가 테스트 사이로 새지 않게 한다."""
    svc.invalidate_cache()
    yield
    svc.invalidate_cache()


def _seed_setting(db_session, **kwargs):
    row = models.AppSetting(app_key=APP_KEY, **kwargs)
    db_session.add(row)
    db_session.commit()
    return row


# ── 순수 판정 로직 ────────────────────────────────────────────────


def test_resolve_app_key_maps_guarded_paths():
    assert svc.resolve_app_key(GUARDED_PATH) == APP_KEY
    assert svc.resolve_app_key("/api/analysis/mooring-fitting/request") == "Mooring Fitting Assessment"
    # 미등록 경로는 게이트 대상이 아니다(fail-open).
    assert svc.resolve_app_key("/api/analysis/status/abc123") is None


def test_block_reason_precedence_and_messages():
    # 오버라이드 없음 → 통과
    assert svc.block_reason(None) is None
    assert svc.block_reason({"dev_status": "Active", "maintenance": False}) is None

    # 점검 모드가 상태보다 우선하고, 관리자가 쓴 문구를 그대로 쓴다.
    reason, message = svc.block_reason({
        "dev_status": "Active",
        "maintenance": True,
        "maintenance_message": "16시 재개 예정",
    })
    assert (reason, message) == ("maintenance", "16시 재개 예정")

    # 문구를 비워 두면 기본 문구로 대체된다.
    _, fallback = svc.block_reason({"maintenance": True, "maintenance_message": "  "})
    assert fallback == svc.DEFAULT_MAINTENANCE_MESSAGE

    assert svc.block_reason({"dev_status": "Developing"})[0] == "developing"
    assert svc.block_reason({"dev_status": "Planned"})[0] == "planned"


# ── 관리자 API ────────────────────────────────────────────────────


def test_upsert_creates_then_partially_updates(admin_client, db_session):
    created = admin_client.put(
        f"/api/admin/app-settings/{APP_KEY}",
        json={"dev_status": "Developing", "contributor": "권혁민"},
    )
    assert created.status_code == 200
    assert created.json()["dev_status"] == "Developing"
    assert created.json()["contributor"] == "권혁민"
    assert created.json()["updated_by"] == "ADMIN001"

    # 보내지 않은 필드는 그대로 유지된다.
    updated = admin_client.put(
        f"/api/admin/app-settings/{APP_KEY}",
        json={"maintenance": True, "maintenance_message": "점검 중"},
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["dev_status"] == "Developing"
    assert body["contributor"] == "권혁민"
    assert body["maintenance"] is True


def test_explicit_null_clears_override(admin_client):
    admin_client.put(
        f"/api/admin/app-settings/{APP_KEY}",
        json={"dev_status": "Developing", "description": "임시 설명"},
    )
    cleared = admin_client.put(
        f"/api/admin/app-settings/{APP_KEY}",
        json={"description": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["description"] is None
    assert cleared.json()["dev_status"] == "Developing"


def test_invalid_dev_status_is_rejected(admin_client):
    response = admin_client.put(
        f"/api/admin/app-settings/{APP_KEY}",
        json={"dev_status": "Retired"},
    )
    assert response.status_code == 422


def test_empty_string_folds_to_none(admin_client):
    response = admin_client.put(
        f"/api/admin/app-settings/{APP_KEY}",
        json={"maintenance_message": "   ", "contributor": ""},
    )
    assert response.status_code == 200
    assert response.json()["maintenance_message"] is None
    assert response.json()["contributor"] is None


def test_tags_are_trimmed_and_capped(admin_client):
    response = admin_client.put(
        f"/api/admin/app-settings/{APP_KEY}",
        json={"tags": [" 트러스 ", "", "CSV"] + [f"t{i}" for i in range(20)]},
    )
    assert response.status_code == 200
    tags = response.json()["tags"]
    assert tags[:2] == ["트러스", "CSV"]
    assert len(tags) == 12


def test_delete_resets_to_code_default(admin_client, db_session):
    admin_client.put(f"/api/admin/app-settings/{APP_KEY}", json={"dev_status": "Planned"})
    assert admin_client.delete(f"/api/admin/app-settings/{APP_KEY}").status_code == 200
    assert admin_client.get("/api/app-settings").json() == []
    # 두 번째 삭제는 404.
    assert admin_client.delete(f"/api/admin/app-settings/{APP_KEY}").status_code == 404


def test_list_returns_only_overridden_apps(admin_client, db_session):
    _seed_setting(db_session, dev_status="Developing", maintenance=False)
    response = admin_client.get("/api/app-settings")
    assert response.status_code == 200
    assert [row["app_key"] for row in response.json()] == [APP_KEY]


# ── assert_app_available ─────────────────────────────────────────


def test_assert_app_available_blocks_regular_user(db_session, make_user):
    _seed_setting(db_session, dev_status="Developing", maintenance=False)
    make_user("A100001")

    with pytest.raises(Exception) as exc:
        svc.assert_app_available(APP_KEY, "A100001", db_session)
    assert exc.value.status_code == 403


def test_assert_app_available_allows_admin(db_session):
    _seed_setting(db_session, maintenance=True, maintenance_message="점검")
    db_session.add(models.User(
        employee_id="ADMIN002", name="관리자2", company="HHI",
        is_active=True, is_admin=True,
    ))
    db_session.commit()

    svc.assert_app_available(APP_KEY, "ADMIN002", db_session)  # 예외 없음


# ── 미들웨어 (실제 요청 경로 차단) ────────────────────────────────


@pytest.fixture()
def gated_client(db_session, monkeypatch):
    """Bearer 토큰이 실제 사용자로 해석되는 TestClient — 미들웨어 경로 검증용."""
    from fastapi.testclient import TestClient

    def _override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = _override_db
    # 미들웨어는 dependency override 를 타지 않고 app.state 의 팩토리를 쓴다.
    previous_factory = app.state.session_factory
    app.state.session_factory = lambda: db_session

    tokens = {"user-token": "A100001", "admin-token": "ADMIN001"}
    monkeypatch.setattr(session_store, "get_employee_id", lambda t: tokens.get(t))

    db_session.add_all([
        models.User(employee_id="A100001", name="사용자", company="HHI", is_active=True, is_admin=False),
        models.User(employee_id="ADMIN001", name="관리자", company="HHI", is_active=True, is_admin=True),
    ])
    db_session.commit()

    yield TestClient(app)

    app.state.session_factory = previous_factory
    app.dependency_overrides.clear()


def test_middleware_blocks_developing_app_for_regular_user(gated_client, db_session):
    _seed_setting(db_session, dev_status="Developing", maintenance=False)

    response = gated_client.post(
        GUARDED_PATH,
        headers={"Authorization": "Bearer user-token"},
    )
    assert response.status_code == 403
    body = response.json()
    assert body["app_key"] == APP_KEY
    assert body["reason"] == "developing"


def test_middleware_lets_admin_through(gated_client, db_session):
    _seed_setting(db_session, dev_status="Developing", maintenance=False)

    response = gated_client.post(
        GUARDED_PATH,
        headers={"Authorization": "Bearer admin-token"},
    )
    # 게이트를 통과했으므로 403 이 아니다(엔드포인트 자체의 입력 검증 결과가 나온다).
    assert response.status_code != 403


def test_middleware_does_not_block_get_polling(gated_client, db_session):
    """진행 중 작업의 상태 조회(GET)까지 막으면 남의 작업이 화면에서 끊긴다."""
    _seed_setting(db_session, maintenance=True, maintenance_message="점검")

    response = gated_client.get(
        "/api/analysis/status/nonexistent-job",
        headers={"Authorization": "Bearer user-token"},
    )
    assert response.status_code != 403


def test_middleware_passes_when_no_override(gated_client):
    response = gated_client.post(
        GUARDED_PATH,
        headers={"Authorization": "Bearer user-token"},
    )
    assert response.status_code != 403
