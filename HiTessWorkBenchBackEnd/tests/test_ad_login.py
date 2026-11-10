"""사내 AD 로그인(AUTH_MODE=ad, 2026-11-04).

지키는 것
- 스위치를 끄면 로그인 계약이 그대로다(test_auth_contract 가 따로 지킨다).
- 켜면 비밀번호 없이·틀린 비밀번호로는 토큰이 나오지 않는다 — 보안 테스트의
  `POST /api/login {employee_id}` 만으로 외부 App 을 연 재현이 막힌다.
- 빈 비밀번호는 AD 에 보내지 않는다(익명 bind 성공 함정).
- 틀린 시도는 AD 에 묻기 전에 끊는다(직원 회사 PC 계정 잠금 방지).
- 비밀번호가 응답·활동 기록에 남지 않는다.
"""
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app import database, models, sessions
from app.main import app
from app.routers import auth
from app.services import ad_auth
from app.services.ad_auth import AdResult, LoginAttemptLimiter
from app.state import server_state

SECRET = "Correct-Horse-1"


@pytest.fixture()
def client(db_session, monkeypatch):
    def _override_db():
        yield db_session

    monkeypatch.setattr(sessions, "SessionLocal",
                        sessionmaker(bind=db_session.get_bind(), autocommit=False, autoflush=False))
    monkeypatch.setattr(auth, "fetch_plm_email", lambda _e: None)
    monkeypatch.setattr(auth, "notify_logbook_logout", lambda _t: None)
    monkeypatch.setitem(server_state, "maintenance_mode", False)
    monkeypatch.setenv("AUTH_MODE", "ad")
    ad_auth.login_attempt_limiter.clear()
    app.dependency_overrides[database.get_db] = _override_db
    yield TestClient(app)
    app.dependency_overrides.clear()
    ad_auth.login_attempt_limiter.clear()


@pytest.fixture()
def fake_ad(monkeypatch):
    """AD 대역 — 비밀번호가 SECRET 이면 OK. 불린 횟수를 센다."""
    calls = []

    def _verify(employee_id, password):
        calls.append(employee_id)
        return AdResult.OK if password == SECRET else AdResult.INVALID

    monkeypatch.setattr(auth, "verify_ad_password", _verify)
    return calls


def _user(db, employee_id="A123456", is_active=True):
    db.add(models.User(employee_id=employee_id, name="홍길동", company="HD 현대중공업", department="구조",
                       position="책임", is_active=is_active, is_admin=False, is_developer=False))
    db.commit()


def _login(client, password=None, employee_id="A123456"):
    body = {"employee_id": employee_id}
    if password is not None:
        body["password"] = password
    return client.post("/api/login", json=body)


def test_options_reports_mode(client, monkeypatch):
    from app.services import windows_auth
    monkeypatch.setattr(windows_auth, "_sspi_available", lambda: True)
    assert client.get("/api/login/options").json() == {"auth_mode": "ad", "windows_login": True, "device_login": True}
    monkeypatch.delenv("AUTH_MODE")
    assert client.get("/api/login/options").json() == {"auth_mode": "employee_id", "windows_login": False, "device_login": False}


def test_employee_id_only_login_is_refused(client, db_session, fake_ad):
    """보안 테스트 스크립트 1단계 그대로 — 토큰이 나오지 않아야 한다."""
    _user(db_session)
    res = _login(client)
    assert (res.status_code, res.json()["detail"]) == (401, "password_required")
    assert "token" not in res.json()
    assert fake_ad == []                                  # AD 에 묻지도 않는다


@pytest.mark.parametrize("password", ["", "   "])
def test_blank_password_never_reaches_ad(client, db_session, fake_ad, password):
    _user(db_session)
    assert _login(client, password).status_code == 401
    assert fake_ad == []


def test_wrong_password_refused_and_correct_one_works(client, db_session, fake_ad):
    _user(db_session)
    res = _login(client, "wrong")
    assert (res.status_code, res.json()["detail"]) == (401, "invalid_credentials")
    ok = _login(client, SECRET)
    assert ok.status_code == 200 and ok.json()["token"]


def test_wrong_password_does_not_reveal_registration(client, db_session, fake_ad):
    """등록 안 된 사번이어도 비밀번호가 틀리면 404 가 아니라 401 — 사번 존재 여부를 흘리지 않는다."""
    assert _login(client, "wrong", "A999999").status_code == 401
    assert _login(client, SECRET, "A999999").status_code == 404   # 본인 확인 뒤에야 '미등록' 안내


def test_approval_still_required_after_ad(client, db_session, fake_ad):
    _user(db_session, is_active=False)
    res = _login(client, SECRET)
    assert (res.status_code, res.json()["detail"]) == (403, "Approval Pending")


def test_failures_are_cut_before_ad(client, db_session, fake_ad):
    _user(db_session)
    for _ in range(ad_auth._MAX_FAILURES_PER_EMPLOYEE):
        assert _login(client, "wrong").status_code == 401
    asked = len(fake_ad)
    res = _login(client, SECRET)                          # 맞는 비밀번호여도 잠시 막힌다
    assert (res.status_code, res.json()["detail"]) == (429, "too_many_attempts")
    assert len(fake_ad) == asked                          # AD 로 가지 않았다


def test_success_resets_failure_count(client, db_session, fake_ad):
    _user(db_session)
    for _ in range(ad_auth._MAX_FAILURES_PER_EMPLOYEE - 1):
        _login(client, "wrong")
    assert _login(client, SECRET).status_code == 200
    assert _login(client, "wrong").status_code == 401      # 다시 처음부터 센다(429 아님)


@pytest.mark.parametrize("result, status", [
    (AdResult.LOCKED, 401),
    (AdResult.PASSWORD_EXPIRED, 401),
    (AdResult.DISABLED, 401),
    (AdResult.UNAVAILABLE, 502),
])
def test_ad_outcomes_map_to_status(client, db_session, monkeypatch, result, status):
    _user(db_session)
    monkeypatch.setattr(auth, "verify_ad_password", lambda _e, _p: result)
    res = _login(client, SECRET)
    assert (res.status_code, res.json()["detail"]) == (status, result.value)


def test_password_not_in_activity_log(client, db_session, fake_ad):
    _user(db_session)
    _login(client, "wrong")
    _login(client, SECRET)
    logs = db_session.query(models.ActivityLog).filter_by(action_type="LOGIN").all()
    dumped = json.dumps([log.action_detail for log in logs], ensure_ascii=False, default=str)
    assert "wrong" not in dumped and SECRET not in dumped


def test_mode_off_keeps_employee_id_login(client, db_session, monkeypatch):
    monkeypatch.delenv("AUTH_MODE")
    monkeypatch.setattr(auth, "verify_ad_password",
                        lambda *_: (_ for _ in ()).throw(AssertionError("AD must not be used")))
    _user(db_session)
    assert _login(client).status_code == 200


# ── ad_auth 단위 ─────────────────────────────────────────────

def test_verify_rejects_blank_without_connecting(monkeypatch):
    import ldap3
    monkeypatch.setattr(ldap3, "Connection",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not connect")))
    for blank in (None, "", "  "):
        assert ad_auth.verify_ad_password("A123456", blank) is AdResult.INVALID


@pytest.mark.parametrize("message, expected", [
    ("80090308: LdapErr: DSID-0C090457, comment: AcceptSecurityContext error, data 52e, v3839", AdResult.INVALID),
    ("... AcceptSecurityContext error, data 775, v3839", AdResult.LOCKED),
    ("... AcceptSecurityContext error, data 532, v3839", AdResult.PASSWORD_EXPIRED),
    ("... AcceptSecurityContext error, data 773, v3839", AdResult.PASSWORD_EXPIRED),
    ("... AcceptSecurityContext error, data 533, v3839", AdResult.DISABLED),
    ("no data code", AdResult.INVALID),
])
def test_bind_failure_codes(message, expected):
    assert ad_auth._classify_bind_failure({"result": 49, "message": message}) is expected


def test_verify_uses_ldaps_with_cert_check(monkeypatch):
    """접속 설정 — ldaps·인증서 검증·DOMAIN\\사번(소문자). 실제 AD 에는 붙지 않는다."""
    import ssl
    import ldap3
    seen = {}

    class FakeConn:
        result = {"result": 0}

        def __init__(self, server, user, password, receive_timeout):
            seen.update(server=server, user=user)

        def bind(self):
            return True

        def unbind(self):
            seen["unbound"] = True

    monkeypatch.setattr(ldap3, "Connection", FakeConn)
    monkeypatch.delenv("AD_LDAP_HOST", raising=False)
    assert ad_auth.verify_ad_password("A123456", SECRET) is AdResult.OK
    assert seen["user"] == "HHI\\a123456" and seen["unbound"]
    server = seen["server"]
    assert server.ssl and server.port == 636 and server.host == "HHIWVRA06.HHI.co.kr"
    assert server.tls.validate == ssl.CERT_REQUIRED


def test_limiter_window_expires(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(ad_auth.time, "monotonic", lambda: clock[0])
    limiter = LoginAttemptLimiter(window_sec=60, max_per_employee=2, max_per_ip=100)
    limiter.record_failure("A1", "1.1.1.1")
    limiter.record_failure("A1", "1.1.1.1")
    assert limiter.is_blocked("A1", "1.1.1.1")
    assert not limiter.is_blocked("A2", "1.1.1.1")         # 다른 사번은 영향 없음
    clock[0] += 61
    assert not limiter.is_blocked("A1", "1.1.1.1")


def test_limiter_blocks_spray_from_one_ip():
    limiter = LoginAttemptLimiter(window_sec=60, max_per_employee=100, max_per_ip=3)
    for emp in ("A1", "A2", "A3"):
        limiter.record_failure(emp, "9.9.9.9")
    assert limiter.is_blocked("A4", "9.9.9.9")              # 여러 사번을 돌려 시도하는 것도 끊는다
