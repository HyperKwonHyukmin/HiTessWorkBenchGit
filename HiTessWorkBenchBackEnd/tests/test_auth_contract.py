"""로그인 계약 고정(Hi-TESS Core 2단계 2-A, hitess-core docs/20-phase2-identity.md).

WB 앱·LogBook 한 번 로그인·외부 프로그램(HiTESS Beam 등)이 모두 이 동작에 기댄다.
이 파일의 테스트가 깨지면 '로그인 계약을 바꾼 것'이다 — hitess-core 에 변경안을 먼저 쓴다(03-safety §2).
이미 다른 파일이 지키는 것: 회사 표기(test_check_user_company), 비활성 계정 세션 무효·Beam 익명 허용
(test_p0_security·test_hitessbeam_legacy_client), 일회 코드·로그아웃 통지(test_logbook_link).
"""
import uuid
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app import database, models, sessions
from app.main import app
from app.routers import auth
from app.state import server_state

LOGIN_FIELDS = {"id", "employee_id", "name", "company", "department", "position", "email", "is_active",
                "is_admin", "login_count", "last_login", "created_at", "token"}


@pytest.fixture()
def client(db_session, monkeypatch):
    def _override_db():
        yield db_session

    # session_store 는 SessionLocal 을 직접 연다 — 테스트 DB 로 돌린다
    monkeypatch.setattr(sessions, "SessionLocal",
                        sessionmaker(bind=db_session.get_bind(), autocommit=False, autoflush=False))
    monkeypatch.setattr(auth, "fetch_plm_email", lambda _e: None)        # 사내 PLM 접속 없음
    monkeypatch.setattr(auth, "notify_logbook_logout", lambda _t: None)
    monkeypatch.setitem(server_state, "maintenance_mode", False)
    app.dependency_overrides[database.get_db] = _override_db
    yield TestClient(app)
    app.dependency_overrides.clear()


def _user(db, employee_id="A123456", is_active=True, is_admin=False):
    db.add(models.User(employee_id=employee_id, name="홍길동", company="HD 현대중공업", department="구조",
                       position="책임", is_active=is_active, is_admin=is_admin, is_developer=False))
    db.commit()


def _login(client, employee_id="A123456"):
    return client.post("/api/login", json={"employee_id": employee_id})


def test_login_response_shape_and_token(client, db_session):
    _user(db_session)
    res = _login(client, "a123456")   # 소문자도 받는다
    assert res.status_code == 200
    body = res.json()
    assert set(body) == LOGIN_FIELDS
    assert body["employee_id"] == "A123456" and body["is_admin"] is False and body["login_count"] == 1
    assert uuid.UUID(body["token"]).version == 4
    row = db_session.query(models.UserSession).filter_by(token=body["token"]).one()
    assert row.employee_id == "A123456"
    assert row.expires_at - row.created_at == timedelta(hours=8)   # 8시간 고정 만료


def test_login_request_is_employee_id_only(client, db_session):
    _user(db_session)
    # 비밀번호 칸이 없다 — 다른 칸이 와도 무시하고 통과
    assert client.post("/api/login", json={"employee_id": "A123456", "password": "x"}).status_code == 200


@pytest.mark.parametrize("setup, status, detail", [
    ({}, 404, "User not found"),
    ({"is_active": False}, 403, "Approval Pending"),
])
def test_login_errors(client, db_session, setup, status, detail):
    if setup:
        _user(db_session, **setup)
    res = _login(client)
    assert (res.status_code, res.json()["detail"]) == (status, detail)


def test_login_maintenance_blocks_non_admin_only(client, db_session, monkeypatch):
    _user(db_session)
    _user(db_session, "A654321", is_admin=True)
    monkeypatch.setitem(server_state, "maintenance_mode", True)
    res = _login(client)
    assert (res.status_code, res.json()["detail"]) == (503, "Maintenance Mode")
    assert _login(client, "A654321").status_code == 200


def test_bearer_token_session_context_and_logout(client, db_session):
    _user(db_session)
    token = _login(client).json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    ctx = client.get("/api/session/context", headers=h)
    assert ctx.status_code == 200
    assert set(ctx.json()) == {"employee_id", "client_ip", "client_host"}
    assert ctx.json()["employee_id"] == "A123456"
    assert client.get("/api/session/context").status_code == 401                       # 헤더 없음
    assert client.get("/api/session/context", headers={"Authorization": token}).status_code == 401  # Bearer 없음
    assert client.post("/api/logout", headers=h).json() == {"ok": True}
    assert client.get("/api/session/context", headers=h).status_code == 401              # 로그아웃 뒤


def test_expired_token_rejected(client, db_session):
    _user(db_session)
    token = _login(client).json()["token"]
    row = db_session.query(models.UserSession).filter_by(token=token).one()
    row.expires_at = datetime.now() - timedelta(seconds=1)
    db_session.commit()
    assert client.get("/api/session/context", headers={"Authorization": f"Bearer {token}"}).status_code == 401


@pytest.mark.parametrize("path", ["/member/check_user", "/api/check_user"])
def test_check_user_response_shape(client, db_session, path):
    """외부 프로그램(Beam) 로그인 — 요청 {userID, company}, 응답 칸 이름 고정, 토큰은 주지 않는다."""
    _user(db_session, is_admin=True)
    res = client.post(path, json={"userID": " a123456 ", "company": "HD 현대중공업"})
    assert res.status_code == 200
    assert res.json() == {"ok": True, "userName": "홍길동", "permissions": {"is_admin": True}}
