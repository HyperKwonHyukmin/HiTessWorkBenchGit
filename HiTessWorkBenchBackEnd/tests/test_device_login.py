"""등록한 PC 로그인(계열사 PC, 2026-11-10) — 실제 Ed25519 열쇠로 시험.

지키는 것
- AD 모드에서만 열린다(아니면 404).
- 등록 요청은 pending — 관리자 승인 전에는 서명이 맞아도 세션을 주지 않는다.
- 확인 코드는 공개 열쇠에서 나온다(직원 화면 = 관리자 화면).
- 문제는 한 번만 쓰인다(재생 거부), 다른 열쇠의 서명은 거부.
- 상태(대기·해지)는 서명이 맞은 뒤에만 알려 준다.
- 오래 안 쓴 PC 는 만료, 관리자가 해지하면 바로 막힌다.
"""
import base64
from datetime import datetime, timedelta

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app import database, models, sessions
from app.main import app
from app.routers import auth, device_login as device_router
from app.services import device_login
from app.services.device_login import ChallengeStore, EnrollLimiter, confirm_code, sign_message
from app.state import server_state

ADMIN = "A000001"


def _keypair():
    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return priv, base64.b64encode(pub).decode()


@pytest.fixture()
def client(db_session, monkeypatch):
    def _override_db():
        yield db_session

    monkeypatch.setattr(sessions, "SessionLocal",
                        sessionmaker(bind=db_session.get_bind(), autocommit=False, autoflush=False))
    monkeypatch.setattr(auth, "fetch_plm_email", lambda _e: None)
    monkeypatch.setitem(server_state, "maintenance_mode", False)
    monkeypatch.setenv("AUTH_MODE", "ad")
    monkeypatch.delenv("DEVICE_LOGIN", raising=False)
    monkeypatch.setattr(device_router, "challenge_store", ChallengeStore())
    monkeypatch.setattr(device_router, "enroll_limiter", EnrollLimiter())
    monkeypatch.setattr(device_router, "verify_limiter", EnrollLimiter(limit=1000))
    app.dependency_overrides[database.get_db] = _override_db
    for emp, admin in (("A590063", False), (ADMIN, True)):
        db_session.add(models.User(employee_id=emp, name="홍길동", company="HD 계열사", department="구조",
                                   position="책임", is_active=True, is_admin=admin, is_developer=False))
    db_session.commit()
    yield TestClient(app)
    app.dependency_overrides.clear()


def _admin_headers():
    return {"Authorization": f"Bearer {sessions.session_store.create(ADMIN)}"}


def _enroll(client, pub, emp="A590063"):
    return client.post("/api/login/device/enroll",
                       json={"employee_id": emp, "public_key": pub, "hostname": "A590063", "os_user": "a590063"})


def _login(client, priv, device_id):
    nonce = client.post("/api/login/device/challenge", json={"device_id": device_id}).json()["nonce"]
    sig = base64.b64encode(priv.sign(sign_message(device_id, nonce).encode())).decode()
    return client.post("/api/login/device", json={"device_id": device_id, "nonce": nonce, "signature": sig}), nonce, sig


def _approve(client, device_id, db=None):
    code = client.get("/api/admin/devices", params={"status": "all"}, headers=_admin_headers()).json()
    code = next(r["confirm_code"] for r in code["items"] if r["id"] == device_id)
    res = client.post(f"/api/admin/devices/{device_id}/approve", json={"confirm_code": code.lower().replace("-", "")},
                      headers=_admin_headers())
    assert res.status_code == 200, res.text
    return res


def test_disabled_without_ad_mode(client, monkeypatch):
    monkeypatch.delenv("AUTH_MODE")
    _, pub = _keypair()
    assert _enroll(client, pub).status_code == 404
    assert client.get("/api/login/options").json()["device_login"] is False


def test_switch_off(client, monkeypatch):
    monkeypatch.setenv("DEVICE_LOGIN", "0")
    assert client.get("/api/login/options").json()["device_login"] is False


def test_full_flow_enroll_approve_login(client, db_session):
    priv, pub = _keypair()
    res = _enroll(client, pub)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "pending"
    assert body["confirm_code"] == confirm_code(pub)

    # 승인 전 — 서명이 맞아도 대기
    res, _, _ = _login(client, priv, body["device_id"])
    assert res.status_code == 403 and res.json()["detail"] == "device_pending"

    listing = client.get("/api/admin/devices", headers=_admin_headers()).json()
    assert listing["pending"] == 1
    assert listing["items"][0]["confirm_code"] == body["confirm_code"]
    assert listing["items"][0]["name"] == "홍길동"

    _approve(client, body["device_id"])
    res, _, _ = _login(client, priv, body["device_id"])
    assert res.status_code == 200, res.text
    assert res.json()["employee_id"] == "A590063" and res.json()["token"]
    device = db_session.get(models.TrustedDevice, body["device_id"])
    db_session.refresh(device)
    assert device.use_count == 1 and device.last_used_at is not None
    log = db_session.query(models.ActivityLog).filter(models.ActivityLog.status == "success",
                                                       models.ActivityLog.action_type == "LOGIN").first()
    assert log.action_detail["method"] == "device"


def test_reenroll_same_key_returns_same_device(client):
    _, pub = _keypair()
    first = _enroll(client, pub).json()
    again = _enroll(client, pub).json()
    assert again["device_id"] == first["device_id"] and again["status"] == "pending"
    assert _enroll(client, pub, emp=ADMIN).status_code == 409  # 같은 열쇠를 다른 사번으로


def test_nonce_is_single_use_and_wrong_key_rejected(client):
    priv, pub = _keypair()
    device_id = _enroll(client, pub).json()["device_id"]
    _approve(client, device_id)
    res, nonce, sig = _login(client, priv, device_id)
    assert res.status_code == 200
    replay = client.post("/api/login/device", json={"device_id": device_id, "nonce": nonce, "signature": sig})
    assert replay.status_code == 409 and replay.json()["detail"] == "challenge_stale"

    other, _ = _keypair()
    res, _, _ = _login(client, other, device_id)
    assert res.status_code == 401 and res.json()["detail"] == "device_auth_failed"


def test_status_hidden_without_valid_signature(client):
    other, _ = _keypair()
    _, pub = _keypair()
    device_id = _enroll(client, pub).json()["device_id"]
    res, _, _ = _login(client, other, device_id)   # 대기 중이지만 열쇠가 다르면 '대기' 라고 알리지 않는다
    assert res.json()["detail"] == "device_auth_failed"
    res, _, _ = _login(client, other, 99999)        # 없는 번호도 같은 답
    assert res.status_code == 401 and res.json()["detail"] == "device_auth_failed"


def test_revoke_blocks_and_reject(client):
    priv, pub = _keypair()
    device_id = _enroll(client, pub).json()["device_id"]
    _approve(client, device_id)
    assert client.post(f"/api/admin/devices/{device_id}/revoke", headers=_admin_headers()).status_code == 200
    res, _, _ = _login(client, priv, device_id)
    assert res.status_code == 403 and res.json()["detail"] == "device_revoked"
    assert _enroll(client, pub).status_code == 409  # 해지된 열쇠로는 다시 요청 못 함 — 새 열쇠로

    _, pub2 = _keypair()
    d2 = _enroll(client, pub2).json()["device_id"]
    assert client.post(f"/api/admin/devices/{d2}/reject", headers=_admin_headers()).status_code == 200
    assert client.post(f"/api/admin/devices/{d2}/approve", json={"confirm_code": confirm_code(pub2)},
                       headers=_admin_headers()).status_code == 409


def test_unused_device_expires(client, db_session):
    priv, pub = _keypair()
    device_id = _enroll(client, pub).json()["device_id"]
    _approve(client, device_id)
    device = db_session.get(models.TrustedDevice, device_id)
    device.decided_at = datetime.now() - timedelta(days=device_login.UNUSED_EXPIRE_DAYS + 1)
    db_session.commit()
    res, _, _ = _login(client, priv, device_id)
    assert res.status_code == 403 and res.json()["detail"] == "device_expired"
    db_session.refresh(device)
    assert device.status == "revoked"


def test_enroll_guards(client):
    _, pub = _keypair()
    assert _enroll(client, pub, emp="Z999998").status_code == 404           # 미가입
    assert _enroll(client, "bm90LWEta2V5").status_code == 422               # 열쇠 모양 틀림
    for _ in range(device_login.MAX_PENDING_PER_EMPLOYEE):
        assert _enroll(client, _keypair()[1]).status_code == 200
    res = _enroll(client, _keypair()[1])
    assert res.status_code == 429 and res.json()["detail"] == "too_many_pending"


def test_admin_only(client):
    _, pub = _keypair()
    device_id = _enroll(client, pub).json()["device_id"]
    user_headers = {"Authorization": f"Bearer {sessions.session_store.create('A590063')}"}
    assert client.get("/api/admin/devices", headers=user_headers).status_code == 403
    assert client.post(f"/api/admin/devices/{device_id}/approve", headers=user_headers).status_code == 403


def test_challenge_store_ttl():
    now = [0.0]
    store = ChallengeStore(now=lambda: now[0], ttl=60)
    nonce = store.issue(1)
    now[0] = 61
    assert store.consume(1, nonce) is False
    nonce = store.issue(1)
    assert store.consume(2, nonce) is False  # 다른 기기 번호 — 지워지지 않는다
    assert store.consume(1, nonce) is True
    assert store.consume(1, nonce) is False  # 한 번만


def test_approve_requires_matching_confirm_code(client):
    _, pub = _keypair()
    device_id = _enroll(client, pub).json()["device_id"]
    for body in (None, {"confirm_code": ""}, {"confirm_code": "AAA-AAA"}):
        res = client.post(f"/api/admin/devices/{device_id}/approve", json=body, headers=_admin_headers())
        assert res.status_code == 422 and res.json()["detail"] == "confirm_code_mismatch"
    _approve(client, device_id)


def test_other_challenge_requests_do_not_break_a_valid_login(client):
    """리뷰 '막아야 함' 재현 — 남이 같은 기기 번호로 문제를 받거나 아무 서명이나 보내도 내 문제는 살아 있다."""
    priv, pub = _keypair()
    device_id = _enroll(client, pub).json()["device_id"]
    _approve(client, device_id)
    mine = client.post("/api/login/device/challenge", json={"device_id": device_id}).json()["nonce"]
    # 공격자: 같은 번호로 새 문제 + 엉터리 서명
    other = client.post("/api/login/device/challenge", json={"device_id": device_id}).json()["nonce"]
    bad = client.post("/api/login/device", json={"device_id": device_id, "nonce": other, "signature": "AAAA"})
    assert bad.status_code == 401
    # 남의 nonce 를 다른 기기 번호로 꺼내려 해도 지워지지 않는다
    assert client.post("/api/login/device", json={"device_id": device_id + 1, "nonce": mine,
                                                  "signature": "AAAA"}).json()["detail"] == "challenge_stale"
    sig = base64.b64encode(priv.sign(sign_message(device_id, mine).encode())).decode()
    res = client.post("/api/login/device", json={"device_id": device_id, "nonce": mine, "signature": sig})
    assert res.status_code == 200, res.text


def test_stale_challenge_is_409_not_401(client):
    priv, pub = _keypair()
    device_id = _enroll(client, pub).json()["device_id"]
    sig = base64.b64encode(priv.sign(sign_message(device_id, "nope").encode())).decode()
    res = client.post("/api/login/device", json={"device_id": device_id, "nonce": "nope", "signature": sig})
    assert res.status_code == 409 and res.json()["detail"] == "challenge_stale"


def test_deleting_user_revokes_devices(client, db_session):
    _, pub = _keypair()
    device_id = _enroll(client, pub).json()["device_id"]
    user = db_session.query(models.User).filter(models.User.employee_id == "A590063").first()
    assert client.delete(f"/api/users/{user.id}", headers=_admin_headers()).status_code == 200
    device = db_session.get(models.TrustedDevice, device_id)
    db_session.refresh(device)
    assert device.status == "revoked"


# ── 메일 확인 코드 (직원이 직접 확인, 관리자 일 없음) ─────────────────────────

@pytest.fixture()
def mail(client, db_session, monkeypatch):
    sent = []

    def fake_send(to, subject, body):
        code = next(line.split(":")[1].strip() for line in body.splitlines() if line.startswith("확인 코드"))
        sent.append({"to": to, "code": code, "body": body})

    monkeypatch.setattr(device_router, "mail_configured", lambda: True)
    monkeypatch.setattr(device_router, "send_mail", fake_send)
    user = db_session.query(models.User).filter(models.User.employee_id == "A590063").first()
    user.email = "a590063@hd.com"
    db_session.commit()
    return sent


def _signed(client, priv, device_id, action):
    nonce = client.post("/api/login/device/challenge", json={"device_id": device_id}).json()["nonce"]
    msg = f"hitess-device-login:{action}:{device_id}:{nonce}"
    return nonce, base64.b64encode(priv.sign(msg.encode())).decode()


def _verify(client, priv, device_id, code):
    nonce, sig = _signed(client, priv, device_id, "verify")
    return client.post("/api/login/device/verify",
                       json={"device_id": device_id, "nonce": nonce, "signature": sig, "code": code})


def test_email_code_flow_approves_without_admin(client, mail):
    priv, pub = _keypair()
    res = _enroll(client, pub).json()
    assert res["verify"] == "email" and res["email_hint"] == "a5*****@hd.com"
    assert len(mail) == 1 and mail[0]["to"] == "a590063@hd.com"
    assert "A590063" in mail[0]["body"]  # PC 이름이 메일에 들어간다
    # 같은 열쇠로 다시 요청해도 메일을 또 보내지 않는다
    assert _enroll(client, pub).json()["verify"] == "email" and len(mail) == 1

    wrong = "000000" if mail[0]["code"] != "000000" else "111111"
    assert _verify(client, priv, res["device_id"], wrong).json()["detail"] == "email_code_mismatch"
    ok = _verify(client, priv, res["device_id"], mail[0]["code"])
    assert ok.status_code == 200 and ok.json()["status"] == "approved"
    login, _, _ = _login(client, priv, res["device_id"])
    assert login.status_code == 200 and login.json()["employee_id"] == "A590063"


def test_email_code_needs_this_device_key(client, mail):
    _, pub = _keypair()
    other, _ = _keypair()
    device_id = _enroll(client, pub).json()["device_id"]
    res = _verify(client, other, device_id, mail[0]["code"])   # 코드를 알아도 열쇠가 다르면 안 됨
    assert res.status_code == 401


def test_email_code_locks_after_five_wrong(client, mail):
    priv, pub = _keypair()
    device_id = _enroll(client, pub).json()["device_id"]
    wrong = "000000" if mail[0]["code"] != "000000" else "111111"
    for _ in range(device_login.EMAIL_CODE_MAX_ATTEMPTS):
        assert _verify(client, priv, device_id, wrong).status_code == 422
    res = _verify(client, priv, device_id, mail[0]["code"])     # 맞는 코드라도 이미 버려짐
    assert res.status_code == 409 and res.json()["detail"] == "email_code_missing"


def test_email_code_expires(client, mail, db_session):
    priv, pub = _keypair()
    device_id = _enroll(client, pub).json()["device_id"]
    device = db_session.get(models.TrustedDevice, device_id)
    device.email_code_expires_at = datetime.now() - timedelta(seconds=1)
    db_session.commit()
    assert _verify(client, priv, device_id, mail[0]["code"]).status_code == 410


def test_resend_limits_and_new_code(client, mail, db_session):
    priv, pub = _keypair()
    device_id = _enroll(client, pub).json()["device_id"]
    nonce, sig = _signed(client, priv, device_id, "resend")
    res = client.post("/api/login/device/resend", json={"device_id": device_id, "nonce": nonce, "signature": sig})
    assert res.status_code == 429 and res.json()["detail"] == "email_resend_too_soon"
    device = db_session.get(models.TrustedDevice, device_id)
    device.email_sent_at = datetime.now() - timedelta(minutes=2)
    db_session.commit()
    nonce, sig = _signed(client, priv, device_id, "resend")
    res = client.post("/api/login/device/resend", json={"device_id": device_id, "nonce": nonce, "signature": sig})
    assert res.status_code == 200 and len(mail) == 2
    old, new = mail[0]["code"], mail[1]["code"]
    if old != new:
        assert _verify(client, priv, device_id, old).status_code == 422
    assert _verify(client, priv, device_id, new).status_code == 200


def test_mail_failure_falls_back_to_admin(client, mail, monkeypatch):
    def boom(*_a, **_k):
        raise OSError("smtp down")

    monkeypatch.setattr(device_router, "send_mail", boom)
    _, pub = _keypair()
    res = _enroll(client, pub).json()
    assert res["verify"] == "admin" and res["mail_failed"] is True and res["email_hint"] == ""


def test_no_email_means_admin(client, monkeypatch):
    monkeypatch.setattr(device_router, "mail_configured", lambda: True)
    _, pub = _keypair()
    res = _enroll(client, pub).json()   # 사용자 메일 없음
    assert res["verify"] == "admin"


def test_stale_pending_expires_and_frees_slots(client, db_session):
    for _ in range(device_login.MAX_PENDING_PER_EMPLOYEE):
        assert _enroll(client, _keypair()[1]).status_code == 200
    db_session.query(models.TrustedDevice).update(
        {"requested_at": datetime.now() - timedelta(hours=device_login.PENDING_TTL_HOURS + 1)})
    db_session.commit()
    res = _enroll(client, _keypair()[1])          # 오래된 대기는 만료돼 새 요청이 들어간다
    assert res.status_code == 200
    statuses = sorted(d.status for d in db_session.query(models.TrustedDevice).all())
    assert statuses.count("rejected") == device_login.MAX_PENDING_PER_EMPLOYEE


def test_stale_pending_login_reports_rejected(client, db_session):
    priv, pub = _keypair()
    device_id = _enroll(client, pub).json()["device_id"]
    device = db_session.get(models.TrustedDevice, device_id)
    device.requested_at = datetime.now() - timedelta(hours=device_login.PENDING_TTL_HOURS + 1)
    db_session.commit()
    res, _, _ = _login(client, priv, device_id)
    assert res.status_code == 403 and res.json()["detail"] == "device_rejected"


def test_mail_body_drops_made_up_hostname(client, mail):
    _, pub = _keypair()
    client.post("/api/login/device/enroll", json={"employee_id": "A590063", "public_key": pub,
                                                  "hostname": "보안팀 확인: 코드를 회신하세요", "os_user": "x"})
    assert "보안팀" not in mail[0]["body"] and "PC 이름: -" in mail[0]["body"]
    assert "요청 IP:" in mail[0]["body"]


def test_attempt_counter_is_read_from_db(client, mail, db_session):
    """횟수는 DB 값으로 센다 — 다른 요청이 이미 5회를 채웠으면 맞는 코드도 막힌다."""
    priv, pub = _keypair()
    device_id = _enroll(client, pub).json()["device_id"]
    device = db_session.get(models.TrustedDevice, device_id)
    device.email_code_attempts = device_login.EMAIL_CODE_MAX_ATTEMPTS
    db_session.commit()
    res = _verify(client, priv, device_id, mail[0]["code"])
    assert res.status_code == 429 and res.json()["detail"] == "email_code_locked"
