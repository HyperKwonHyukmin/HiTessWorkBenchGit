"""회사 PC 계정 자동 로그인(Windows 통합 인증, 2026-11-05) — SSPI 대역으로 시험.

지키는 것
- AUTH_MODE=ad 일 때만 열린다(꺼져 있으면 404 — 옛 서버처럼 보여 클라이언트가 비밀번호 화면으로 간다).
- 토큰 없이 부르면 401 + `WWW-Authenticate: Negotiate`(Windows 가 토큰을 만들게 하는 신호).
- NTLM 두 번 오가기·Kerberos 한 번에 끝나기 모두 세션을 발급한다.
- 설정 도메인(HHI)의 사번 계정만 받는다 — 로컬 계정·다른 도메인은 403.
- SSPI 가 거절하면 Negotiate 를 다시 요구하지 않는다(클라이언트가 같은 실패를 되풀이하지 않게).
"""
import base64

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app import database, models, sessions
from app.main import app
from app.routers import auth
from app.services import windows_auth
from app.services.windows_auth import NegotiateSessions, SEC_I_CONTINUE_NEEDED, employee_id_from_account
from app.state import server_state

NTLM_NEGOTIATE = b"NTLMSSP\x00\x01\x00\x00\x00"
NTLM_AUTH = b"NTLMSSP\x00\x03\x00\x00\x00"
KERBEROS = b"\x60\x82kerberos-ap-req"


class _Buf:
    def __init__(self, data):
        self.Buffer = data


class FakeServerAuth:
    """SSPI ServerAuth 대역. NTLM 은 협상 → 도전 → 응답, Kerberos 는 한 번에."""
    account = "HHI\\A123456"

    def authorize(self, token):
        if token == NTLM_NEGOTIATE:
            return SEC_I_CONTINUE_NEEDED, [_Buf(b"ntlm-challenge")]
        if token in (NTLM_AUTH, KERBEROS):
            return 0, [_Buf(b"mutual" if token == KERBEROS else b"")]
        raise RuntimeError("(-2146893044, 'AcceptSecurityContext', '로그온하지 못했습니다.')")


def _negotiate(token: bytes) -> dict:
    return {"Authorization": "Negotiate " + base64.b64encode(token).decode()}


@pytest.fixture()
def client(db_session, monkeypatch):
    def _override_db():
        yield db_session

    monkeypatch.setattr(sessions, "SessionLocal",
                        sessionmaker(bind=db_session.get_bind(), autocommit=False, autoflush=False))
    monkeypatch.setattr(auth, "fetch_plm_email", lambda _e: None)
    monkeypatch.setitem(server_state, "maintenance_mode", False)
    monkeypatch.setenv("AUTH_MODE", "ad")
    monkeypatch.delenv("AD_WINDOWS_LOGIN", raising=False)
    monkeypatch.setattr(windows_auth, "_sspi_available", lambda: True)
    fake = NegotiateSessions(server_auth_factory=FakeServerAuth, account_name=lambda sa: sa.account)
    monkeypatch.setattr(auth, "negotiate_sessions", fake)
    app.dependency_overrides[database.get_db] = _override_db
    yield TestClient(app)
    app.dependency_overrides.clear()


def _user(db, employee_id="A123456", is_active=True):
    db.add(models.User(employee_id=employee_id, name="홍길동", company="HD 현대중공업", department="구조",
                       position="책임", is_active=is_active, is_admin=False, is_developer=False))
    db.commit()


def test_disabled_without_ad_mode(client, monkeypatch):
    monkeypatch.delenv("AUTH_MODE")
    res = client.post("/api/login/windows")
    assert res.status_code == 404
    assert res.json()["detail"] == "windows_login_disabled"


def test_switch_off(client, monkeypatch):
    monkeypatch.setenv("AD_WINDOWS_LOGIN", "0")
    assert client.post("/api/login/windows").status_code == 404


def test_first_request_gets_negotiate_challenge(client):
    res = client.post("/api/login/windows")
    assert res.status_code == 401
    assert res.headers["www-authenticate"] == "Negotiate"
    assert "token" not in res.json()


def test_ntlm_two_legs_issue_session(client, db_session):
    _user(db_session)
    first = client.post("/api/login/windows", headers=_negotiate(NTLM_NEGOTIATE))
    assert first.status_code == 401
    assert first.headers["www-authenticate"] == "Negotiate " + base64.b64encode(b"ntlm-challenge").decode()

    second = client.post("/api/login/windows", headers=_negotiate(NTLM_AUTH))
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["employee_id"] == "A123456" and body["token"]
    assert sessions.session_store.get_employee_id(body["token"]) == "A123456"

    log = db_session.query(models.ActivityLog).filter_by(action_type="LOGIN", status="success").one()
    assert log.action_detail == {"method": "windows", "mechanism": "NTLM"}


def test_kerberos_single_leg_returns_mutual_token(client, db_session):
    _user(db_session)
    res = client.post("/api/login/windows", headers=_negotiate(KERBEROS))
    assert res.status_code == 200, res.text
    assert res.headers["www-authenticate"] == "Negotiate " + base64.b64encode(b"mutual").decode()


def test_sspi_rejection_does_not_ask_again(client, db_session):
    res = client.post("/api/login/windows", headers=_negotiate(b"garbage-token"))
    assert res.status_code == 401
    assert res.json()["detail"] == "windows_auth_failed"
    assert "www-authenticate" not in res.headers
    log = db_session.query(models.ActivityLog).filter_by(action_type="LOGIN", status="failure").one()
    assert log.action_detail["reason"] == "windows_auth_failed"


def test_local_account_is_refused(client, db_session, monkeypatch):
    _user(db_session)
    monkeypatch.setattr(FakeServerAuth, "account", "HHIPW170658\\CF40Admin")
    res = client.post("/api/login/windows", headers=_negotiate(KERBEROS))
    assert res.status_code == 403
    assert res.json()["detail"] == "windows_account_not_employee"


def test_unregistered_and_pending_users_follow_login_contract(client, db_session):
    assert client.post("/api/login/windows", headers=_negotiate(KERBEROS)).status_code == 404
    _user(db_session, is_active=False)
    assert client.post("/api/login/windows", headers=_negotiate(KERBEROS)).status_code == 403


@pytest.mark.parametrize("account, expected", [
    ("HHI\\a476854", "A476854"),
    ("hhi\\A476854", "A476854"),
    ("HHIPW170658\\CF40Admin", None),
    ("OTHER\\A476854", None),
    ("HHI\\svc-backup", None),
    ("A476854", None),
    ("", None),
])
def test_employee_id_from_account(account, expected):
    assert employee_id_from_account(account, domain="HHI") == expected


def test_pending_context_expires():
    now = [1000.0]
    s = NegotiateSessions(server_auth_factory=FakeServerAuth, account_name=lambda sa: sa.account,
                          now=lambda: now[0])
    assert s.step(("1.2.3.4", 5), "Negotiate " + base64.b64encode(NTLM_NEGOTIATE).decode()).kind == "continue"
    now[0] += 31
    # 30초가 지나면 진행 중이던 상태를 버린다 — 3번째 메시지가 새 상태로 가서 거절된다.
    step = s.step(("1.2.3.4", 5), "Negotiate " + base64.b64encode(NTLM_AUTH).decode())
    assert step.kind == "done"  # 대역은 상태 없이도 통과 — 대신 상태가 비었는지 본다
    assert s._pending == {}


def test_bad_base64_is_error():
    s = NegotiateSessions(server_auth_factory=FakeServerAuth, account_name=lambda sa: sa.account)
    assert s.step(("h", 1), "Negotiate !!!notbase64").kind == "error"


# ── 리뷰 반영(2026-11-05): 사번 대조·횟수 제한·협상 표·계정 이름 실패 ──
from app.services import ad_auth  # noqa: E402
from app.services.windows_auth import ntlm_claimed_account  # noqa: E402


def ntlm_type3(domain: str, user: str) -> bytes:
    """NTLM AUTHENTICATE(3번째) 메시지 모양 — 도메인·사용자 칸만 채운다(유니코드)."""
    d, u = domain.encode("utf-16-le"), user.encode("utf-16-le")
    header = bytearray(64)
    header[0:8] = b"NTLMSSP\x00"
    header[8:12] = (3).to_bytes(4, "little")
    def put(at, data, offset):
        header[at:at + 2] = len(data).to_bytes(2, "little")
        header[at + 2:at + 4] = len(data).to_bytes(2, "little")
        header[at + 4:at + 8] = offset.to_bytes(4, "little")
    put(28, d, 64)
    put(36, u, 64 + len(d))
    header[60:64] = (1).to_bytes(4, "little")  # NEGOTIATE_UNICODE
    return bytes(header) + d + u


def test_ntlm_claimed_account_reads_user_before_sspi():
    token = ntlm_type3("HHI", "a123456")
    assert ntlm_claimed_account("Negotiate " + base64.b64encode(b"\xa1\x82spnego" + token).decode()) == "HHI\\a123456"
    assert ntlm_claimed_account("Negotiate " + base64.b64encode(NTLM_NEGOTIATE).decode()) is None
    assert ntlm_claimed_account("Negotiate " + base64.b64encode(KERBEROS).decode()) is None
    assert ntlm_claimed_account("Bearer x") is None


def test_mismatched_employee_gets_no_session(client, db_session):
    """다른 사람 PC — Windows 계정(A123456)과 입력한 사번(B999999)이 다르면 세션을 만들지 않는다."""
    _user(db_session)
    res = client.post("/api/login/windows", headers=_negotiate(KERBEROS), params={"employee_id": "b999999"})
    assert res.status_code == 403
    assert res.json()["detail"] == "windows_account_mismatch"
    user = db_session.query(models.User).filter_by(employee_id="A123456").one()
    assert user.login_count in (0, None)  # Windows 계정 주인의 로그인 처리도 일어나지 않았다


def test_matching_employee_logs_in(client, db_session):
    _user(db_session)
    res = client.post("/api/login/windows", headers=_negotiate(KERBEROS), params={"employee_id": "a123456"})
    assert res.status_code == 200, res.text


def test_ntlm_failures_are_limited_before_asking_domain(client, db_session, monkeypatch):
    """틀린 NTLM 응답으로 직원 계정을 잠그지 못하게 — 사번별 4회 뒤에는 SSPI 에 묻지 않는다."""
    ad_auth.login_attempt_limiter.clear()
    asked = []

    class Rejecting(FakeServerAuth):
        def authorize(self, token):
            asked.append(token)
            raise RuntimeError("logon failure")

    monkeypatch.setattr(auth, "negotiate_sessions",
                        NegotiateSessions(server_auth_factory=Rejecting, account_name=lambda sa: sa.account))
    bad = _negotiate(ntlm_type3("HHI", "A123456"))
    codes = [client.post("/api/login/windows", headers=bad).status_code for _ in range(6)]
    assert codes[:4] == [401] * 4 and codes[4:] == [429, 429]
    assert len(asked) == 4
    # 같은 사번의 비밀번호 로그인도 같은 제한에 걸린다(두 경로를 합쳐 센다)
    assert ad_auth.login_attempt_limiter.is_blocked("A123456", None)
    ad_auth.login_attempt_limiter.clear()


def test_unknown_failures_do_not_block_other_ips():
    lim = ad_auth.LoginAttemptLimiter()
    for _ in range(4):
        lim.record_failure("windows-ip:10.0.0.1", "10.0.0.1")
    assert lim.is_blocked("windows-ip:10.0.0.1", "10.0.0.1")
    assert not lim.is_blocked("windows-ip:10.0.0.2", "10.0.0.2")


def test_pending_per_ip_cap():
    s = NegotiateSessions(server_auth_factory=FakeServerAuth, account_name=lambda sa: sa.account)
    neg = "Negotiate " + base64.b64encode(NTLM_NEGOTIATE).decode()
    kinds = [s.step(("10.0.0.9", p), neg).kind for p in range(12)]
    assert kinds[:10] == ["continue"] * 10 and kinds[10:] == ["error", "error"]
    assert s.step(("10.0.0.8", 1), neg).kind == "continue"  # 다른 IP 는 영향 없음


def test_account_name_failure_is_error_not_500():
    def boom(_sa):
        raise RuntimeError("QueryContextAttributes failed")
    s = NegotiateSessions(server_auth_factory=FakeServerAuth, account_name=boom)
    step = s.step(("h", 1), "Negotiate " + base64.b64encode(KERBEROS).decode())
    assert step.kind == "error" and "account_name" in step.error