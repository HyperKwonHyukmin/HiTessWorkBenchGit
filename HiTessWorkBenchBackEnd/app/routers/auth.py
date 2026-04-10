"""인증 및 회원가입 API 라우터."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from pydantic import BaseModel
from typing import Optional
from .. import models, schemas, database
from ..state import server_state

router = APIRouter(prefix="/api", tags=["auth"])


class CheckUserRequest(BaseModel):
    userID: str
    company: str


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
def login(request: schemas.LoginRequest, db: Session = Depends(database.get_db)):
  user = db.query(models.User).filter(models.User.employee_id == request.employee_id.upper()).first()
  if not user:
    raise HTTPException(status_code=404, detail="User not found")
  if not user.is_active:
    raise HTTPException(status_code=403, detail="Approval Pending")
  if server_state["maintenance_mode"] and not user.is_admin:
    raise HTTPException(status_code=503, detail="Maintenance Mode")

  user.login_count += 1
  user.last_login = datetime.now()
  db.commit()
  db.refresh(user)

  return user


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
