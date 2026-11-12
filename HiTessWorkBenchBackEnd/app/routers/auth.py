"""인증 및 회원가입 API 라우터."""
import re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from pydantic import BaseModel
from typing import Optional
from fastapi import Request, Response
from .. import models, schemas, database
from ..state import server_state
from ..sessions import session_store
from ..dependencies import require_auth
from ..services import access_session_service
from ..services.activity_service import log_activity
from ..services.ad_auth import (
  AdResult, auth_mode, is_test_login_account, login_attempt_limiter, test_login_accounts,
  verify_ad_password, verify_test_password,
)
from ..services.external_app_access import external_app_access_store
from ..services.logbook_integration import notify_logbook_logout
from ..services.plm_user_directory import fetch_plm_email
from ..services.device_login import device_login_enabled
from ..services.windows_auth import (
    employee_id_from_account, negotiate_sessions, ntlm_claimed_account, windows_login_enabled,
)

router = APIRouter(prefix="/api", tags=["auth"])
member_router = APIRouter(prefix="/member", tags=["member"])
# 사번 형식: 영문 1자 + 숫자 5~7자리 (A123456, D12345 등 계열사별 자릿수 차이를 허용)
EMPLOYEE_ID_PATTERN = re.compile(r"^[A-Z]\d{5,7}$")


class CheckUserRequest(BaseModel):
    userID: str
    company: str


# 회사명 비교용 정규화 — 법인 표기·공백·대소문자 차이를 무시한다.
# PLM 리프레시(user_directory_sync)가 회사를 'HD현대중공업㈜' 처럼 PLM 표기로 덮어쓰는데,
# 이미 배포된 외부 프로그램(HiTESS Beam 등)은 가입 화면 표기('HD 현대중공업')를 그대로 보낸다.
# 표기는 PLM 값으로 두되 같은 회사로 인식되게 한다.
_COMPANY_NOISE = re.compile(r"㈜|\(주\)|（주）|주식회사|\s+")


def normalize_company(value: Optional[str]) -> str:
    return _COMPANY_NOISE.sub("", value or "").casefold()


@member_router.post("/check_user")
@router.post("/check_user")
def check_user(req: CheckUserRequest, db: Session = Depends(database.get_db)):
    user_id = req.userID.strip().upper()
    user = db.query(models.User).filter(models.User.employee_id == user_id).first()
    # 사번이 맞아도 회사가 다르면 기존과 같이 미등록으로 본다(계약 유지).
    if user and normalize_company(user.company) != normalize_company(req.company):
        user = None

    if not user:
        raise HTTPException(status_code=404, detail="not_registered")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="not_approved")

    return {
        "ok": True,
        "userName": user.name,
        "permissions": {
            "is_admin": user.is_admin
        }
    }


@router.get("/login/options")
def login_options():
  """로그인 화면이 비밀번호 칸을 보일지 정한다. 인증 없음·DB 안 씀(서버 주소 확인 직후 부른다)."""
  return {"auth_mode": auth_mode(), "windows_login": windows_login_enabled(),
          # 회사 도메인에 없는 PC(계열사)의 등록한 PC 로그인 — routers/device_login.py
          "device_login": device_login_enabled(),
          # AD 에 없는 테스트 사번 — 등록한 PC 화면에서도 이 사번은 비밀번호 칸을 연다
          "password_login_ids": sorted(test_login_accounts()) if auth_mode() == "ad" else []}


def _verify_ad_login(db: Session, employee_id: str, password, ip: Optional[str]) -> None:
  """AUTH_MODE=ad — 사번·비밀번호를 AD 로 확인한다. 실패면 HTTPException.

  DB 사번 조회보다 먼저 한다: 비밀번호가 틀린 요청에는 '등록된 사번인지' 도 알려 주지 않는다.
  """
  secret = password.get_secret_value() if password is not None else ""
  if not secret.strip():
    # 옛 클라이언트(비밀번호 칸 없음)·Electron 자동 재로그인. AD 에 묻지 않으니 횟수에 넣지 않는다.
    log_activity(db, "LOGIN", employee_id=employee_id, action_detail={"reason": "password_required"}, status="failure", ip_address=ip)
    raise HTTPException(status_code=401, detail="password_required")
  if login_attempt_limiter.is_blocked(employee_id, ip):
    log_activity(db, "LOGIN", employee_id=employee_id, action_detail={"reason": "too_many_attempts"}, status="failure", ip_address=ip)
    raise HTTPException(status_code=429, detail="too_many_attempts")

  if is_test_login_account(employee_id):
    result = verify_test_password(employee_id, secret)
  else:
    result = verify_ad_password(employee_id, secret)
  if result is AdResult.OK:
    login_attempt_limiter.reset(employee_id)
    return
  if result is AdResult.UNAVAILABLE:
    log_activity(db, "LOGIN", employee_id=employee_id, action_detail={"reason": "auth_unavailable"}, status="failure", ip_address=ip)
    raise HTTPException(status_code=502, detail="auth_unavailable")
  login_attempt_limiter.record_failure(employee_id, ip)
  log_activity(db, "LOGIN", employee_id=employee_id, action_detail={"reason": result.value}, status="failure", ip_address=ip)
  raise HTTPException(status_code=401, detail=result.value)


@router.post("/login", response_model=schemas.UserResponse)
def login(request: schemas.LoginRequest, req: Request, db: Session = Depends(database.get_db)):
  employee_id = request.employee_id.strip().upper()
  ip = req.client.host if req.client else None

  method = "password"
  if auth_mode() == "ad":
    _verify_ad_login(db, employee_id, request.password, ip)
    if is_test_login_account(employee_id):
      method = "test_account"  # AD 를 거치지 않은 로그인 — 활동 기록에서 따로 보이게

  return _complete_login(db, employee_id, ip, method=method)


def _windows_unknown_key(ip: Optional[str]) -> str:
  """누구인지 모르는 실패(Kerberos·모양이 틀린 토큰)는 IP 마다 따로 센다 — 공용 키로 세면 몇 번에 모두가 막힌다."""
  return f"windows-ip:{ip}"


@router.post("/login/windows", response_model=schemas.UserResponse)
def login_windows(req: Request, response: Response, employee_id: Optional[str] = None,
                  db: Session = Depends(database.get_db)):
  """회사 PC 계정 자동 로그인(Windows 통합 인증). 비밀번호를 받지 않는다 — services/windows_auth.py.

  401 + `WWW-Authenticate: Negotiate` 로 시작해 Windows(Electron·.NET)가 토큰을 보내게 한다.
  NTLM 은 같은 연결에서 한 번 더 오간다.

  쿼리 `employee_id` = 화면에 입력한(또는 AM 이 넘긴) 사번. 있으면 Windows 계정과 같을 때만 세션을 만든다 —
  다른 사람 PC 에서 그 PC 주인 이름으로 로그인 처리(접속 이력·로그인 횟수)가 일어나지 않게.
  본문이 아니라 쿼리인 이유: Electron 40 은 본문이 있으면 NTLM 3번째 메시지를 보내지 않고 멈췄다(2026-11-05 실측).
  """
  if not windows_login_enabled():
    raise HTTPException(status_code=404, detail="windows_login_disabled")
  ip = req.client.host if req.client else None
  conn_key = (ip, req.client.port if req.client else None)
  authorization = req.headers.get("authorization", "")
  expected = (employee_id or "").strip().upper()

  # NTLM 응답은 도메인 컨트롤러로 가서 틀리면 그 직원 계정의 실패 횟수를 올린다(계정 잠금).
  # 비밀번호 로그인과 같은 제한(사번별·IP 별)을 **묻기 전에** 건다 — 두 경로를 합쳐 센다.
  claimed = employee_id_from_account(ntlm_claimed_account(authorization) or "") or _windows_unknown_key(ip)
  if authorization and login_attempt_limiter.is_blocked(claimed, ip):
    log_activity(db, "LOGIN", employee_id=None if claimed.startswith("windows-ip:") else claimed,
                 action_detail={"method": "windows", "reason": "too_many_attempts"}, status="failure", ip_address=ip)
    raise HTTPException(status_code=429, detail="too_many_attempts")

  step = negotiate_sessions.step(conn_key, authorization)
  if step.kind in ("challenge", "continue"):
    header = f"Negotiate {step.out_token}" if step.out_token else "Negotiate"
    raise HTTPException(status_code=401, detail="negotiate", headers={"WWW-Authenticate": header})
  if step.kind == "error":
    login_attempt_limiter.record_failure(claimed, ip)
    # WWW-Authenticate 를 다시 주지 않는다 — 주면 클라이언트가 같은 실패를 되풀이한다.
    log_activity(db, "LOGIN", employee_id=None if claimed.startswith("windows-ip:") else claimed,
                 action_detail={"method": "windows", "reason": "windows_auth_failed",
                                "mechanism": step.mechanism, "error": step.error},
                 status="failure", ip_address=ip)
    raise HTTPException(status_code=401, detail="windows_auth_failed")

  employee_id = employee_id_from_account(step.account)
  if not employee_id:
    # 로컬 계정·다른 도메인·사번이 아닌 공용 계정. 계정 이름은 그 PC 사용자 자신의 것이라 기록해도 된다.
    log_activity(db, "LOGIN", action_detail={"method": "windows", "reason": "account_not_employee",
                                             "account": step.account[:64]},
                 status="failure", ip_address=ip)
    raise HTTPException(status_code=403, detail="windows_account_not_employee")
  login_attempt_limiter.reset(employee_id)
  if expected and expected != employee_id:
    # 본인 확인은 됐지만 입력한 사번의 주인이 아니다 — 세션을 만들지 않고 비밀번호로 넘긴다.
    log_activity(db, "LOGIN", employee_id=expected,
                 action_detail={"method": "windows", "reason": "account_mismatch", "windows_account": employee_id},
                 status="failure", ip_address=ip)
    raise HTTPException(status_code=403, detail="windows_account_mismatch")

  if step.out_token:  # Kerberos 상호 인증 — 클라이언트가 서버를 확인할 수 있게 돌려준다
    response.headers["WWW-Authenticate"] = f"Negotiate {step.out_token}"
  return _complete_login(db, employee_id, ip, method="windows", mechanism=step.mechanism)


def _complete_login(db: Session, employee_id: str, ip: Optional[str], method: str = "password",
                    mechanism: str = "") -> schemas.UserResponse:
  """본인 확인이 끝난 사번으로 세션을 발급한다(사번 로그인·AD 비밀번호·Windows 자동 로그인 공통)."""
  user = db.query(models.User).filter(models.User.employee_id == employee_id).first()
  if not user:
    log_activity(db, "LOGIN", employee_id=employee_id, action_detail={"reason": "not_found"}, status="failure", ip_address=ip)
    raise HTTPException(status_code=404, detail="User not found")
  if not user.is_active:
    log_activity(db, "LOGIN", employee_id=employee_id, action_detail={"reason": "not_approved"}, status="failure", ip_address=ip)
    raise HTTPException(status_code=403, detail="Approval Pending")
  if server_state["maintenance_mode"] and not user.is_admin:
    log_activity(db, "LOGIN", employee_id=employee_id, action_detail={"reason": "maintenance"}, status="failure", ip_address=ip)
    raise HTTPException(status_code=503, detail="Maintenance Mode")

  # 사번 대문자 self-heal: 과거 소문자로 저장된 레코드를 대문자로 승격한다.
  # (MySQL 콜레이션이 대소문자 무시라 로그인 매칭은 되지만, 저장값이 소문자면
  #  세션·Analysis 레코드로 소문자가 전파돼 통계가 쪼개진다. 여기서 표준화.)
  if user.employee_id != employee_id:
    user.employee_id = employee_id

  # PLM 메일 주소 백필(best-effort) — 가입 시점 PLM 접속이 실패했거나 그때는 미등록
  # 사번이었던 사용자도 다음 로그인 때 다시 시도한다. 실패해도 로그인은 통과.
  if not getattr(user, "email", None):
    plm_email = fetch_plm_email(employee_id)
    if plm_email:
      user.email = plm_email

  user.login_count += 1
  user.last_login = datetime.now()
  try:
    db.commit()
  except Exception:
    # 극히 드문 케이스: 대소문자만 다른 사번 행이 별도로 존재해 대문자 승격이 unique 충돌.
    # self-heal은 포기하되 로그인 자체는 정상 진행한다.
    db.rollback()
    user = db.query(models.User).filter(models.User.employee_id == employee_id).first()
    user.login_count += 1
    user.last_login = datetime.now()
    db.commit()
  db.refresh(user)

  log_activity(db, "LOGIN", employee_id=employee_id, status="success", ip_address=ip,
               action_detail={"method": method, "mechanism": mechanism} if method != "password" else None)

  # 로그인은 '최근 접속'의 기준점이다. 이전 presence 행을 제거해, 로그인 후 첫 하트비트가
  # 새 행(session_started=지금)을 만들어 접속 지속 시간이 로그인 시점부터 다시 시작되게 한다.
  db.query(models.UserPresence).filter(
      models.UserPresence.employee_id == user.employee_id
  ).delete(synchronize_session=False)
  # 이전 접속 이력이 열려 있으면(창을 닫지 않고 재로그인 등) 마지막 하트비트 시각에 닫는다.
  access_session_service.close_open_sessions(db, user.employee_id, "relogin")
  db.commit()

  token = session_store.create(user.employee_id)
  return schemas.UserResponse(
      id=user.id,
      employee_id=user.employee_id,
      name=user.name,
      company=user.company,
      department=user.department,
      position=user.position,
      email=user.email,
      is_active=user.is_active,
      is_admin=user.is_admin,
      login_count=user.login_count,
      last_login=user.last_login,
      created_at=user.created_at,
      token=token,
  )


@router.post("/logout")
def logout(req: Request, db: Session = Depends(database.get_db), employee_id: str = Depends(require_auth)):
  """세션 토큰을 무효화하고 로그아웃 이벤트를 기록합니다."""
  token = req.headers.get("Authorization", "").removeprefix("Bearer ").strip()
  session_store.revoke(token)
  external_app_access_store.revoke_employee(employee_id)
  # Hi-TESS LogBook 세션도 함께 폐기(백그라운드·실패 무시 — 로그아웃을 늦추지 않는다).
  notify_logbook_logout(token)
  # 접속 상태(presence) 행 삭제 — 로그아웃 즉시 오프라인으로 표시.
  db.query(models.UserPresence).filter(models.UserPresence.employee_id == employee_id).delete()
  access_session_service.close_open_sessions(db, employee_id, "logout")
  db.commit()
  log_activity(db, "LOGOUT", employee_id=employee_id, ip_address=req.client.host if req.client else None)
  return {"ok": True}


@router.get("/session/context")
def get_session_context(req: Request, employee_id: str = Depends(require_auth)):
  """현재 요청 기준의 접속 컨텍스트를 반환합니다. DB 조회 없이 헤더와 요청 정보만 사용합니다."""
  forwarded_for = req.headers.get("x-forwarded-for", "")
  client_ip = forwarded_for.split(",", 1)[0].strip() if forwarded_for else None
  return {
      "employee_id": employee_id,
      "client_ip": client_ip or (req.client.host if req.client else None),
      "client_host": req.client.host if req.client else None,
  }


@router.post("/register", response_model=schemas.UserResponse)
def register_user(user: schemas.UserCreate, db: Session = Depends(database.get_db)):
  employee_id = user.employee_id.upper()
  if not EMPLOYEE_ID_PATTERN.fullmatch(employee_id):
    raise HTTPException(status_code=422, detail="invalid_employee_id_format")

  existing_user = db.query(models.User).filter(models.User.employee_id == employee_id).first()
  if existing_user:
    raise HTTPException(status_code=400, detail="Employee ID already registered")

  current_time = datetime.now()
  # 가입 시점에 PLM 메일 주소를 best-effort 로 조회해 함께 저장한다.
  # 접속 실패/미등록 사번은 None 을 돌려주므로 가입 자체는 막히지 않는다 — 이후
  # 로그인 때 다시 시도된다(login 쪽 best-effort 백필 참조).
  plm_email = fetch_plm_email(employee_id)
  new_user = models.User(
    employee_id=employee_id,
    name=user.name,
    company=user.company,
    department=user.department,
    position=user.position,
    email=plm_email,
    is_active=False,
    is_admin=False,
    login_count=0,
    created_at=current_time
  )

  db.add(new_user)
  db.commit()
  db.refresh(new_user)

  return new_user
