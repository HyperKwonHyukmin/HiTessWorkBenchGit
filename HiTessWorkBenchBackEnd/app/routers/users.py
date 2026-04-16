"""사용자 관리 API 라우터."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from .. import models, database
from ..dependencies import require_admin

router = APIRouter(prefix="/api", tags=["users"])


@router.get("/users")
def get_users(
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    return db.query(models.User).all()


# is_admin은 관리자 전용 별도 엔드포인트에서만 변경 가능
_USER_ALLOWED_FIELDS = {"name", "company", "department", "position", "is_active"}
_ADMIN_ALLOWED_FIELDS = {"is_admin"}

@router.put("/users/{user_id}")
def update_user(
    user_id: int,
    update_data: dict,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    allowed = _USER_ALLOWED_FIELDS | _ADMIN_ALLOWED_FIELDS
    for key, value in update_data.items():
        if key in allowed:
            setattr(user, key, value)
    db.commit()
    return {"message": "Update successful"}


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    return {"message": "User deleted"}
