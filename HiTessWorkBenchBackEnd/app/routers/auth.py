"""인증 및 회원가입 API 라우터."""
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

  user.login_count += 1
  user.last_login = datetime.now()
  db.commit()
  db.refresh(user)

  log_activity(db, "LOGIN", employee_id=employee_id, status="success", ip_address=ip)

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
  log_activity(db, "LOGOUT", employee_id=employee_id, ip_address=req.client.host if req.client else None)
  return {"ok": True}


@router.post("/register", response_model=schemas.UserResponse)
def register_user(user: schemas.UserCreate, db: Session = Depends(database.get_db)):
  employee_id = user.employee_id.upper()
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
