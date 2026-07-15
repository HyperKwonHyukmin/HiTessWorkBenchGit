"""인증 및 회원가입 API 라우터."""
import re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from pydantic import BaseModel
from typing import Optional
from fastapi import Request
from .. import models, schemas, database
from ..state import server_state
from ..sessions import session_store
from ..dependencies import require_auth
from ..services.activity_service import log_activity

router = APIRouter(prefix="/api", tags=["auth"])
member_router = APIRouter(prefix="/member", tags=["member"])
EMPLOYEE_ID_PATTERN = re.compile(r"^A\d{6}$")


class CheckUserRequest(BaseModel):
    userID: str
    company: str


@member_router.post("/check_user")
@router.post("/check_user")
def check_user(req: CheckUserRequest, db: Session = Depends(database.get_db)):
    user_id = req.userID.upper()
    user = db.query(models.User).filter(
        models.User.employee_id == user_id,
        models.User.company == req.company
    ).first()

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


@router.post("/login", response_model=schemas.UserResponse)
def login(request: schemas.LoginRequest, req: Request, db: Session = Depends(database.get_db)):
  employee_id = request.employee_id.upper()
  ip = req.client.host if req.client else None

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

  log_activity(db, "LOGIN", employee_id=employee_id, status="success", ip_address=ip)

  # 로그인은 '최근 접속'의 기준점이다. 이전 presence 행을 제거해, 로그인 후 첫 하트비트가
  # 새 행(session_started=지금)을 만들어 접속 지속 시간이 로그인 시점부터 다시 시작되게 한다.
  db.query(models.UserPresence).filter(
      models.UserPresence.employee_id == user.employee_id
  ).delete(synchronize_session=False)
  db.commit()

  token = session_store.create(user.employee_id)
  return schemas.UserResponse(
      id=user.id,
      employee_id=user.employee_id,
      name=user.name,
      company=user.company,
      department=user.department,
      position=user.position,
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
  # 접속 상태(presence) 행 삭제 — 로그아웃 즉시 오프라인으로 표시.
  db.query(models.UserPresence).filter(models.UserPresence.employee_id == employee_id).delete()
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
  new_user = models.User(
    employee_id=employee_id,
    name=user.name,
    company=user.company,
    department=user.department,
    position=user.position,
    is_active=False,
    is_admin=False,
    login_count=0,
    created_at=current_time
  )

  db.add(new_user)
  db.commit()
  db.refresh(new_user)

  return new_user
