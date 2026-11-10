"""등록한 PC 로그인 API — 회사 도메인에 없는 계열사 PC 용 (2026-11-10). 규칙은 services/device_login.py.

사용자(인증 없음)
- POST /api/login/device/enroll    등록 요청(공개 열쇠) → pending + 확인 코드
- POST /api/login/device/challenge 일회용 문제
- POST /api/login/device           서명으로 로그인(승인된 PC 만 세션 발급)
- POST /api/login/device/verify    회사 메일로 받은 6자리 코드 입력 → 승인(서명 필요)
- POST /api/login/device/resend    코드 다시 보내기(서명 필요, 60초·5통 제한)
관리자
- GET  /api/admin/devices          목록(기본: 대기 + 승인)
- POST /api/admin/devices/{id}/approve | reject | revoke
"""
import re
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import update
from sqlalchemy.orm import Session

from .. import database, models, schemas
from ..dependencies import require_admin
from ..services.activity_service import log_activity
from ..services.device_login import (
    EMAIL_CODE_MAX_ATTEMPTS, EMAIL_CODE_TTL_MIN, EMAIL_MAX_SENDS, EMAIL_RESEND_MIN_SEC, MAX_PENDING_PER_EMPLOYEE,
    PENDING_TTL_HOURS, SIGN_PREFIX, challenge_store, verify_limiter, confirm_code, decode_public_key, device_login_enabled, email_code_body,
    email_code_hash, enroll_limiter, is_expired, new_email_code, sign_message, verify_message, verify_signature,
)
from ..services.mailer import mail_configured, mask_email, send_mail
from .auth import EMPLOYEE_ID_PATTERN, _complete_login

router = APIRouter(prefix="/api", tags=["device-login"])


class EnrollRequest(BaseModel):
  employee_id: str = Field(max_length=50)
  public_key: str = Field(max_length=64)
  hostname: Optional[str] = Field(default=None, max_length=100)
  os_user: Optional[str] = Field(default=None, max_length=100)


class ChallengeRequest(BaseModel):
  device_id: int


class DeviceLoginRequest(BaseModel):
  device_id: int
  nonce: str = Field(max_length=100)
  signature: str = Field(max_length=200)


class VerifyRequest(DeviceLoginRequest):
  code: str = Field(max_length=12)


_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _usable_email(user: Optional[models.User]) -> str:
  value = ((user.email if user else "") or "").strip()
  return value if _EMAIL_PATTERN.fullmatch(value) else ""


def _send_email_code(db: Session, device: models.TrustedDevice, email: str, ip: Optional[str]) -> bool:
  """새 코드를 만들어 보낸다. 실패하면 관리자 승인으로 넘기고 False(코드는 남기지 않는다)."""
  code = new_email_code()
  now = datetime.now()
  device.verify_method = "email"
  device.email_code_hash = email_code_hash(device.id, code)
  device.email_code_expires_at = now + timedelta(minutes=EMAIL_CODE_TTL_MIN)
  device.email_code_attempts = 0
  device.email_sent_at = now
  device.email_sent_count = (device.email_sent_count or 0) + 1
  db.commit()
  subject, body = email_code_body(code, device.hostname, ip)
  try:
    send_mail(email, subject, body)
    return True
  except Exception as exc:  # 사내 메일 서버 접속·인증 실패 — 관리자 승인으로
    device.verify_method = "admin"
    device.email_code_hash = None
    device.email_code_expires_at = None
    db.commit()
    log_activity(db, "DEVICE_ENROLL", employee_id=device.employee_id, status="failure", ip_address=ip,
                 action_detail={"device_id": device.id, "reason": "email_send_failed", "error": type(exc).__name__})
    return False


def _expire_stale_pending(db: Session, employee_id: Optional[str] = None, device_id: Optional[int] = None) -> None:
  """24시간 지난 대기 요청을 거절(만료)로 — 남이 대기를 채워 본인 등록을 막거나 메일을 계속 보내지 못하게."""
  q = update(models.TrustedDevice).where(
      models.TrustedDevice.status == "pending",
      models.TrustedDevice.requested_at < datetime.now() - timedelta(hours=PENDING_TTL_HOURS),
  )
  if employee_id is not None:
    q = q.where(models.TrustedDevice.employee_id == employee_id)
  if device_id is not None:
    q = q.where(models.TrustedDevice.id == device_id)
  res = db.execute(q.values(status="rejected", decided_at=datetime.now(), decided_by="expired",
                            email_code_hash=None).execution_options(synchronize_session=False))
  if res.rowcount:
    db.commit()
    db.expire_all()


def _enroll_response(device: models.TrustedDevice, email: str, mail_failed: bool = False) -> dict:
  return {
      "device_id": device.id,
      "status": device.status,
      "confirm_code": confirm_code(device.public_key),
      # email = 직원이 메일 코드로 직접 확인 · admin = 관리자 승인(메일 없음·발송 실패)
      "verify": device.verify_method or "admin",
      "email_hint": mask_email(email) if device.verify_method == "email" else "",
      "mail_failed": mail_failed,
  }


def _signed_device(body: DeviceLoginRequest, db: Session, message) -> models.TrustedDevice:
  """문제(nonce)가 살아 있고 이 기기 열쇠의 서명이 맞을 때만 기기를 돌려준다."""
  if not challenge_store.consume(body.device_id, body.nonce):
    raise HTTPException(status_code=409, detail="challenge_stale")
  device = db.get(models.TrustedDevice, body.device_id)
  if device is None or not verify_signature(device.public_key, message(body.device_id, body.nonce), body.signature):
    raise HTTPException(status_code=401, detail="device_auth_failed")
  return device


def _ip(req: Request) -> Optional[str]:
  return req.client.host if req.client else None


def _require_enabled() -> None:
  if not device_login_enabled():
    raise HTTPException(status_code=404, detail="device_login_disabled")


@router.post("/login/device/enroll")
def enroll_device(body: EnrollRequest, req: Request, db: Session = Depends(database.get_db)):
  _require_enabled()
  ip = _ip(req)
  employee_id = body.employee_id.strip().upper()
  if not EMPLOYEE_ID_PATTERN.fullmatch(employee_id):
    raise HTTPException(status_code=422, detail="invalid_employee_id")
  raw = decode_public_key(body.public_key)
  if raw is None:
    raise HTTPException(status_code=422, detail="invalid_public_key")
  public_key = body.public_key.strip()

  existing = db.query(models.TrustedDevice).filter(models.TrustedDevice.public_key == public_key).first()
  if existing:
    # 같은 열쇠로 다시 요청 — 화면을 다시 연 경우. 다른 사번으로 같은 열쇠를 쓰려 하면 거절.
    if existing.employee_id != employee_id:
      raise HTTPException(status_code=409, detail="device_key_in_use")
    if existing.status in ("rejected", "revoked"):
      raise HTTPException(status_code=409, detail=f"device_{existing.status}")
    # 메일을 다시 보내지 않는다(다시 보내기는 /resend) — 화면이 지금 상태만 다시 그린다.
    owner = db.query(models.User).filter(models.User.employee_id == employee_id).first()
    return _enroll_response(existing, _usable_email(owner))

  if not enroll_limiter.allow(ip):
    raise HTTPException(status_code=429, detail="too_many_requests")
  user = db.query(models.User).filter(models.User.employee_id == employee_id).first()
  if not user:
    raise HTTPException(status_code=404, detail="User not found")
  if not user.is_active:
    raise HTTPException(status_code=403, detail="Approval Pending")
  _expire_stale_pending(db, employee_id=employee_id)
  pending = db.query(models.TrustedDevice).filter(
      models.TrustedDevice.employee_id == employee_id, models.TrustedDevice.status == "pending").count()
  if pending >= MAX_PENDING_PER_EMPLOYEE:
    raise HTTPException(status_code=429, detail="too_many_pending")

  device = models.TrustedDevice(
      employee_id=employee_id, public_key=public_key, status="pending",
      hostname=(body.hostname or "").strip()[:100] or None, os_user=(body.os_user or "").strip()[:100] or None,
      ip_address=ip, requested_at=datetime.now(),
  )
  db.add(device)
  db.commit()
  db.refresh(device)
  email = _usable_email(user)
  mail_failed = False
  if email and mail_configured():
    mail_failed = not _send_email_code(db, device, email, ip)
  log_activity(db, "DEVICE_ENROLL", employee_id=employee_id, ip_address=ip,
               action_detail={"device_id": device.id, "hostname": device.hostname, "os_user": device.os_user,
                              "verify": device.verify_method})
  return _enroll_response(device, email, mail_failed)


@router.post("/login/device/verify")
def verify_device_email(body: VerifyRequest, req: Request, db: Session = Depends(database.get_db)):
  """회사 메일로 받은 코드 확인 → 승인. 틀린 코드는 5번까지, 10분 안에."""
  _require_enabled()
  ip = _ip(req)
  if not verify_limiter.allow(ip):
    raise HTTPException(status_code=429, detail="too_many_requests")
  device = _signed_device(body, db, verify_message)
  _expire_stale_pending(db, device_id=device.id)
  db.refresh(device)
  if device.status != "pending":
    raise HTTPException(status_code=409, detail=f"device_{device.status}")
  if device.verify_method != "email" or not device.email_code_hash:
    raise HTTPException(status_code=409, detail="email_code_missing")
  if device.email_code_expires_at is None or datetime.now() > device.email_code_expires_at:
    raise HTTPException(status_code=410, detail="email_code_expired")
  # 시도 횟수를 비교 **전에** 한 줄 갱신으로 올린다 — 읽고 더해 쓰면 동시 요청에서 횟수가 유실돼
  # 5회 제한을 넘어 계속 추측할 수 있었다(커밋 전 리뷰 '막아야 함').
  claimed = db.execute(
      update(models.TrustedDevice)
      .where(models.TrustedDevice.id == device.id,
             models.TrustedDevice.email_code_attempts < EMAIL_CODE_MAX_ATTEMPTS,
             models.TrustedDevice.email_code_hash.isnot(None))
      .values(email_code_attempts=models.TrustedDevice.email_code_attempts + 1)
      .execution_options(synchronize_session=False)
  ).rowcount
  db.commit()
  if not claimed:
    raise HTTPException(status_code=429, detail="email_code_locked")
  db.refresh(device)
  if email_code_hash(device.id, body.code) != device.email_code_hash:
    if device.email_code_attempts >= EMAIL_CODE_MAX_ATTEMPTS:
      device.email_code_hash = None  # 이 코드는 버린다 — 다시 보내기로 새 코드
    db.commit()
    log_activity(db, "DEVICE_ENROLL", employee_id=device.employee_id, status="failure", ip_address=ip,
                 action_detail={"device_id": device.id, "reason": "email_code_mismatch",
                                "attempts": device.email_code_attempts})
    raise HTTPException(status_code=422, detail="email_code_mismatch",
                        headers={"X-Attempts-Left": str(max(EMAIL_CODE_MAX_ATTEMPTS - device.email_code_attempts, 0))})
  device.status = "approved"
  device.decided_at = datetime.now()
  device.decided_by = "email"
  device.email_code_hash = None
  db.commit()
  log_activity(db, "DEVICE_APPROVE", employee_id=device.employee_id, ip_address=ip,
               action_detail={"device_id": device.id, "method": "email", "hostname": device.hostname})
  return {"status": "approved"}


def _resend_message(device_id: int, nonce: str) -> str:
  return f"{SIGN_PREFIX}:resend:{device_id}:{nonce}"


@router.post("/login/device/resend")
def resend_device_email(body: DeviceLoginRequest, req: Request, db: Session = Depends(database.get_db)):
  """코드 다시 보내기 — 60초에 한 번, 한 요청에 5통까지."""
  _require_enabled()
  ip = _ip(req)
  device = _signed_device(body, db, _resend_message)
  _expire_stale_pending(db, device_id=device.id)
  db.refresh(device)
  if device.status != "pending":
    raise HTTPException(status_code=409, detail=f"device_{device.status}")
  user = db.query(models.User).filter(models.User.employee_id == device.employee_id).first()
  email = _usable_email(user)
  if not email or not mail_configured():
    raise HTTPException(status_code=409, detail="email_unavailable")
  if device.email_sent_at and (datetime.now() - device.email_sent_at).total_seconds() < EMAIL_RESEND_MIN_SEC:
    raise HTTPException(status_code=429, detail="email_resend_too_soon")
  if (device.email_sent_count or 0) >= EMAIL_MAX_SENDS:
    raise HTTPException(status_code=429, detail="email_resend_limit")
  mail_failed = not _send_email_code(db, device, email, ip)
  return _enroll_response(device, email, mail_failed)


@router.post("/login/device/challenge")
def device_challenge(body: ChallengeRequest):
  _require_enabled()
  # 기기가 있는지 묻지 않는다 — 없는 번호도 문제를 받고 서명 단계에서 같은 이유로 실패한다.
  return {"nonce": challenge_store.issue(body.device_id)}


@router.post("/login/device", response_model=schemas.UserResponse)
def device_login(body: DeviceLoginRequest, req: Request, db: Session = Depends(database.get_db)):
  _require_enabled()
  ip = _ip(req)
  if not challenge_store.consume(body.device_id, body.nonce):
    # 문제가 없거나 낡았다 — 열쇠에 대해서는 아무것도 알려 주지 않는 답. 앱은 새 문제로 다시 시도한다
    # (401 과 섞으면 앱이 '열쇠가 틀림' 으로 보고 승인된 열쇠를 지운다 — 리뷰 '막아야 함').
    raise HTTPException(status_code=409, detail="challenge_stale")
  device = db.get(models.TrustedDevice, body.device_id)
  if device is None or not verify_signature(device.public_key, sign_message(device.id, body.nonce), body.signature):
    # 기기가 없거나 열쇠가 다르다 — 어느 쪽인지 알려 주지 않는다. 기기가 있을 때만 기록한다(남발 시 로그가 쌓이지 않게).
    if device is not None:
      log_activity(db, "LOGIN", employee_id=device.employee_id, status="failure", ip_address=ip,
                   action_detail={"method": "device", "reason": "device_auth_failed", "device_id": device.id})
    raise HTTPException(status_code=401, detail="device_auth_failed")

  # 여기부터는 열쇠를 가진 PC 다 — 상태를 알려 줘도 된다.
  _expire_stale_pending(db, device_id=device.id)
  db.refresh(device)
  if device.status == "approved" and is_expired(device):
    device.status = "revoked"
    device.decided_at = datetime.now()
    device.decided_by = "expired"
    db.commit()
    log_activity(db, "LOGIN", employee_id=device.employee_id, status="failure", ip_address=ip,
                 action_detail={"method": "device", "reason": "device_expired", "device_id": device.id})
    raise HTTPException(status_code=403, detail="device_expired")
  if device.status != "approved":
    raise HTTPException(status_code=403, detail=f"device_{device.status}")

  response = _complete_login(db, device.employee_id, ip, method="device", mechanism=f"device:{device.id}")
  device.last_used_at = datetime.now()
  device.use_count = (device.use_count or 0) + 1
  db.commit()
  return response


# ── 관리자 ─────────────────────────────────────────────────────────────

def _device_row(device: models.TrustedDevice, user: Optional[models.User]) -> dict:
  return {
      "id": device.id,
      "employee_id": device.employee_id,
      "name": user.name if user else None,
      "company": user.company if user else None,
      "department": user.department if user else None,
      "status": device.status,
      "confirm_code": confirm_code(device.public_key),
      "hostname": device.hostname,
      "os_user": device.os_user,
      "ip_address": device.ip_address,
      "requested_at": device.requested_at.isoformat() if device.requested_at else None,
      "decided_at": device.decided_at.isoformat() if device.decided_at else None,
      "decided_by": device.decided_by,
      "last_used_at": device.last_used_at.isoformat() if device.last_used_at else None,
      "use_count": device.use_count or 0,
      "verify": device.verify_method or "admin",
      "email_sent_at": device.email_sent_at.isoformat() if device.email_sent_at else None,
  }


@router.get("/admin/devices")
def list_devices(status: Optional[str] = None, db: Session = Depends(database.get_db),
                 _: str = Depends(require_admin)):
  """status 없으면 대기 + 승인(관리할 것). 'all' 이면 전부. 정렬 = 대기 먼저, 최근 요청 먼저."""
  q = db.query(models.TrustedDevice, models.User).outerjoin(
      models.User, models.User.employee_id == models.TrustedDevice.employee_id)
  if status == "all":
    pass
  elif status:
    q = q.filter(models.TrustedDevice.status == status)
  else:
    q = q.filter(models.TrustedDevice.status.in_(("pending", "approved")))
  rows = q.order_by(models.TrustedDevice.requested_at.desc()).limit(500).all()
  items = [_device_row(d, u) for d, u in rows]
  items.sort(key=lambda r: r["status"] != "pending")  # 안정 정렬 — 대기 먼저, 그 안은 최근 순
  return {"items": items, "pending": sum(1 for r in items if r["status"] == "pending")}


_TRANSITIONS = {"approve": ("pending", "approved"), "reject": ("pending", "rejected"),
                "revoke": ("approved", "revoked")}


class DecideRequest(BaseModel):
  # 승인 때만 — 직원이 화면에서 불러 준 확인 코드. 관리자가 직원과 확인했다는 증거로 서버가 대조한다.
  confirm_code: Optional[str] = Field(default=None, max_length=20)


def _normalize_code(value: Optional[str]) -> str:
  return "".join(ch for ch in (value or "").upper() if ch.isalnum())


@router.post("/admin/devices/{device_id}/{action}")
def decide_device(device_id: int, action: str, req: Request, body: Optional[DecideRequest] = None,
                  db: Session = Depends(database.get_db), admin: str = Depends(require_admin)):
  if action not in _TRANSITIONS:
    raise HTTPException(status_code=404, detail="unknown_action")
  device = db.get(models.TrustedDevice, device_id)
  if device is None:
    raise HTTPException(status_code=404, detail="device_not_found")
  before, after = _TRANSITIONS[action]
  if device.status != before:
    raise HTTPException(status_code=409, detail=f"device_{device.status}")
  if action == "approve" and _normalize_code(body.confirm_code if body else "") != _normalize_code(
      confirm_code(device.public_key)):
    # 남이 다른 사람 사번으로 보낸 요청을 거르는 단계 — 코드 없이 승인하지 못하게 한다.
    raise HTTPException(status_code=422, detail="confirm_code_mismatch")
  device.status = after
  device.decided_at = datetime.now()
  device.decided_by = admin
  db.commit()
  log_activity(db, f"DEVICE_{action.upper()}", employee_id=admin, ip_address=_ip(req),
               action_detail={"device_id": device.id, "target": device.employee_id, "hostname": device.hostname})
  user = db.query(models.User).filter(models.User.employee_id == device.employee_id).first()
  return _device_row(device, user)
