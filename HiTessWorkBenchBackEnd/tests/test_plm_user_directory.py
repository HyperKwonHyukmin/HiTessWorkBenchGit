"""PLM 메일 주소 백필 — 서비스 단위 테스트와 라우터 통합 테스트.

운영 코드는 사내망의 Oracle(HIPLM)을 치지만, 테스트는 ``set_fetcher`` 로 조회를
대체한다. 핵심 요구는 "PLM 이 실패해도 WorkBench 가입/로그인이 통과한다" 는 것이라
각 흐름에서 성공/실패/비활성 세 상황을 모두 확인한다.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import database, models
from app.main import app
from app.services import plm_user_directory


# --- 서비스 단위 테스트 ---------------------------------------------------------


def test_fetch_plm_email_rejects_malformed_employee_id(monkeypatch):
    """사번 형식 검증을 통과하지 못하면 fetcher 를 아예 호출하지 않는다."""
    called = {"n": 0}

    def _fetcher(_eid):
        called["n"] += 1
        return "x@hhi.co.kr"

    plm_user_directory.set_fetcher(_fetcher)
    try:
        assert plm_user_directory.fetch_plm_email("not-a-sabn") is None
        assert plm_user_directory.fetch_plm_email("") is None
        assert plm_user_directory.fetch_plm_email(None) is None
        assert called["n"] == 0
    finally:
        plm_user_directory.set_fetcher(None)


def test_fetch_plm_email_uppercases_before_query():
    """소문자 사번은 대문자로 승격한 뒤 fetcher 로 전달된다(C# 레거시 규약)."""
    captured = {}

    def _fetcher(eid):
        captured["eid"] = eid
        return "person@hhi.co.kr"

    plm_user_directory.set_fetcher(_fetcher)
    try:
        result = plm_user_directory.fetch_plm_email("a123456")
        assert result == "person@hhi.co.kr"
        assert captured["eid"] == "A123456"
    finally:
        plm_user_directory.set_fetcher(None)


def test_fetch_plm_email_swallows_fetcher_exceptions():
    """fetcher 예외는 삼키고 None 을 반환한다 — 가입/로그인을 가로채면 안 된다."""
    def _fetcher(_eid):
        raise RuntimeError("Oracle down")

    plm_user_directory.set_fetcher(_fetcher)
    try:
        assert plm_user_directory.fetch_plm_email("A123456") is None
    finally:
        plm_user_directory.set_fetcher(None)


def test_default_fetcher_returns_none_when_not_configured(monkeypatch):
    """PLM_ORACLE_* 미설정이면 운영 fetcher 는 조용히 None 을 돌려준다."""
    monkeypatch.delenv("PLM_ORACLE_DSN", raising=False)
    monkeypatch.delenv("PLM_ORACLE_USER", raising=False)
    monkeypatch.delenv("PLM_ORACLE_PASSWORD", raising=False)
    assert plm_user_directory._default_fetcher("A123456") is None
    assert plm_user_directory.is_configured() is False


def test_is_configured_true_when_all_vars_present(monkeypatch):
    monkeypatch.setenv("PLM_ORACLE_DSN", "HIPLM")
    monkeypatch.setenv("PLM_ORACLE_USER", "caduser")
    monkeypatch.setenv("PLM_ORACLE_PASSWORD", "plmcad")
    assert plm_user_directory.is_configured() is True


# --- 가입 흐름 통합 테스트 -------------------------------------------------------


@pytest.fixture()
def client(db_session):
    """DB override 만 걸고 require_auth 는 그대로 두는 간단한 클라이언트.

    가입/로그인 엔드포인트는 인증을 요구하지 않으므로 신원 override 가 불필요하다.
    """
    def _override_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[database.get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_register_backfills_email_from_plm(client, db_session):
    plm_user_directory.set_fetcher(lambda eid: f"{eid.lower()}@hhi.co.kr")
    try:
        resp = client.post(
            "/api/register",
            json={
                "employee_id": "A123456",
                "name": "홍길동",
                "company": "HHI",
                "department": "구조해석팀",
                "position": "책임연구원",
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["email"] == "a123456@hhi.co.kr"

        row = db_session.query(models.User).filter_by(employee_id="A123456").one()
        assert row.email == "a123456@hhi.co.kr"
    finally:
        plm_user_directory.set_fetcher(None)


def test_register_succeeds_when_plm_fails(client, db_session):
    """PLM 접속 실패해도 가입은 통과한다. 메일은 NULL 로 둔다."""
    def _down(_eid):
        raise RuntimeError("Oracle unreachable")

    plm_user_directory.set_fetcher(_down)
    try:
        resp = client.post(
            "/api/register",
            json={
                "employee_id": "A999999",
                "name": "홍길동",
                "company": "HHI",
                "department": "구조해석팀",
                "position": "책임연구원",
            },
        )
        assert resp.status_code == 200, resp.text
        row = db_session.query(models.User).filter_by(employee_id="A999999").one()
        assert row.email is None
    finally:
        plm_user_directory.set_fetcher(None)


def test_login_backfills_email_if_blank(client, db_session):
    """가입 때 PLM 접속이 안 됐더라도 로그인 때 비어 있으면 다시 시도한다."""
    user = models.User(
        employee_id="A700001", name="홍", company="HHI",
        department="구조해석팀", position="연구원",
        is_active=True, is_admin=False, is_developer=False,
        email=None,
    )
    db_session.add(user)
    db_session.commit()

    plm_user_directory.set_fetcher(lambda eid: "later@hhi.co.kr")
    try:
        resp = client.post("/api/login", json={"employee_id": "A700001"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["email"] == "later@hhi.co.kr"
        db_session.refresh(user)
        assert user.email == "later@hhi.co.kr"
    finally:
        plm_user_directory.set_fetcher(None)


def test_login_does_not_overwrite_existing_email(client, db_session):
    """이미 메일이 저장돼 있으면 PLM 재조회로 덮어쓰지 않는다(불필요한 쿼리 억제)."""
    user = models.User(
        employee_id="A700002", name="홍", company="HHI",
        department="구조해석팀", position="연구원",
        is_active=True, is_admin=False, is_developer=False,
        email="original@hhi.co.kr",
    )
    db_session.add(user)
    db_session.commit()

    called = {"n": 0}

    def _fetcher(_eid):
        called["n"] += 1
        return "new@hhi.co.kr"

    plm_user_directory.set_fetcher(_fetcher)
    try:
        resp = client.post("/api/login", json={"employee_id": "A700002"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["email"] == "original@hhi.co.kr"
        assert called["n"] == 0  # 기존 값 있으면 호출 안 됨
    finally:
        plm_user_directory.set_fetcher(None)


# --- 관리자 수동 액션 테스트 ----------------------------------------------------


def test_admin_sync_email_success(admin_client, db_session, monkeypatch):
    monkeypatch.setenv("PLM_ORACLE_DSN", "HIPLM")
    monkeypatch.setenv("PLM_ORACLE_USER", "caduser")
    monkeypatch.setenv("PLM_ORACLE_PASSWORD", "plmcad")

    target = models.User(
        employee_id="A800001", name="홍", company="HHI",
        department="구조해석팀", position="연구원",
        is_active=True, is_admin=False, is_developer=False,
        email=None,
    )
    db_session.add(target)
    db_session.commit()

    plm_user_directory.set_fetcher(lambda eid: f"{eid.lower()}@hhi.co.kr")
    try:
        resp = admin_client.post(f"/api/users/{target.id}/sync-email")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["email"] == "a800001@hhi.co.kr"
        assert body["changed"] is True
        db_session.refresh(target)
        assert target.email == "a800001@hhi.co.kr"
    finally:
        plm_user_directory.set_fetcher(None)


def test_admin_sync_email_404_when_plm_has_no_record(admin_client, db_session, monkeypatch):
    monkeypatch.setenv("PLM_ORACLE_DSN", "HIPLM")
    monkeypatch.setenv("PLM_ORACLE_USER", "caduser")
    monkeypatch.setenv("PLM_ORACLE_PASSWORD", "plmcad")

    target = models.User(
        employee_id="A800002", name="홍", company="HHI",
        department="구조해석팀", position="연구원",
        is_active=True, is_admin=False, is_developer=False,
    )
    db_session.add(target)
    db_session.commit()

    plm_user_directory.set_fetcher(lambda _eid: None)
    try:
        resp = admin_client.post(f"/api/users/{target.id}/sync-email")
        assert resp.status_code == 404
        assert resp.json()["detail"] == "plm_email_not_found"
    finally:
        plm_user_directory.set_fetcher(None)


def test_admin_sync_email_503_when_plm_not_configured(admin_client, db_session, monkeypatch):
    monkeypatch.delenv("PLM_ORACLE_DSN", raising=False)
    monkeypatch.delenv("PLM_ORACLE_USER", raising=False)
    monkeypatch.delenv("PLM_ORACLE_PASSWORD", raising=False)

    target = models.User(
        employee_id="A800003", name="홍", company="HHI",
        department="구조해석팀", position="연구원",
        is_active=True, is_admin=False, is_developer=False,
    )
    db_session.add(target)
    db_session.commit()

    resp = admin_client.post(f"/api/users/{target.id}/sync-email")
    assert resp.status_code == 503
    assert resp.json()["detail"] == "plm_not_configured"


def test_users_list_includes_email(admin_client, db_session):
    target = models.User(
        employee_id="A800100", name="홍", company="HHI",
        department="구조해석팀", position="연구원",
        is_active=True, is_admin=False, is_developer=False,
        email="hong@hhi.co.kr",
    )
    db_session.add(target)
    db_session.commit()

    resp = admin_client.get("/api/users")
    assert resp.status_code == 200
    row = next(r for r in resp.json() if r["employee_id"] == "A800100")
    assert row["email"] == "hong@hhi.co.kr"
