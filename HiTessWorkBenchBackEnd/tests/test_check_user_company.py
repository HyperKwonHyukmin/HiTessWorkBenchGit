"""외부 프로그램 로그인(/member/check_user) — PLM 리프레시로 회사 표기가 바뀌어도 인식되어야 한다.

실제 장애(2026-10-19): 주기 PLM 리프레시가 users.company 를 'HD 현대중공업' → 'HD현대중공업㈜' 로
덮어써, 가입 표기를 그대로 보내는 HiTESS Beam 이 전원 not_registered 를 받았다.
"""
import pytest
from fastapi.testclient import TestClient

from app import database, models
from app.main import app
from app.routers.auth import normalize_company


@pytest.fixture()
def client(db_session):
    def _override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = _override_db
    yield TestClient(app)
    app.dependency_overrides.clear()


def _add_user(db, employee_id, company, is_active=True):
    db.add(models.User(employee_id=employee_id, name="홍길동", company=company,
                       is_active=is_active, is_admin=False, is_developer=False))
    db.commit()


@pytest.mark.parametrize("stored, sent", [
    ("HD현대중공업㈜", "HD 현대중공업"),       # PLM 표기 ↔ 가입 표기
    ("HD 현대중공업", "HD 현대중공업"),        # 기존 그대로
    ("HD현대삼호㈜", "HD 현대삼호"),
    ("(주)HD한국조선해양", "HD 한국조선해양"),
    ("HD현대중공업 주식회사", "hd현대중공업"),
])
def test_company_notation_differences_are_accepted(client, db_session, stored, sent):
    _add_user(db_session, "A123456", stored)
    for path in ("/member/check_user", "/api/check_user"):
        res = client.post(path, json={"userID": "a123456", "company": sent})
        assert res.status_code == 200, (path, res.json())
        assert res.json()["ok"] is True


def test_different_company_still_rejected(client, db_session):
    _add_user(db_session, "A123456", "HD현대중공업㈜")
    res = client.post("/member/check_user", json={"userID": "A123456", "company": "HD 현대삼호"})
    assert res.status_code == 404
    assert res.json()["detail"] == "not_registered"


def test_unknown_user_and_unapproved(client, db_session):
    assert client.post("/member/check_user",
                       json={"userID": "A999999", "company": "HD 현대중공업"}).status_code == 404
    _add_user(db_session, "A111111", "HD현대중공업㈜", is_active=False)
    res = client.post("/member/check_user", json={"userID": "A111111", "company": "HD 현대중공업"})
    assert res.status_code == 403
    assert res.json()["detail"] == "not_approved"


def test_normalize_company():
    assert normalize_company("HD현대중공업㈜") == normalize_company("HD 현대중공업")
    assert normalize_company(None) == ""
    assert normalize_company("HD 현대삼호") != normalize_company("HD 현대중공업")
