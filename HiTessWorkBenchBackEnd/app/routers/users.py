"""사용자 관리 API 라우터."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from .. import models, database
from ..dependencies import require_admin

router = APIRouter(prefix="/api", tags=["users"])


@router.get("/users")
def get_users(
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    users = db.query(models.User).all()

    # 사용자별 해석 통계 — N+1 회피 위해 단일 GROUP BY 쿼리로 일괄 조회
    stats_rows = (
        db.query(
            models.Analysis.employee_id.label("employee_id"),
            func.count(models.Analysis.id).label("count"),
            func.max(models.Analysis.created_at).label("last_at"),
        )
        .group_by(models.Analysis.employee_id)
        .all()
    )
    stats_map = {row.employee_id: row for row in stats_rows}

    def _iso(dt):
        return dt.isoformat() if dt else None

    result = []
    for u in users:
        s = stats_map.get(u.employee_id)
        result.append({
            "id": u.id,
            "employee_id": u.employee_id,
            "name": u.name,
            "company": u.company,
            "department": u.department,
            "position": u.position,
            "is_active": u.is_active,
            "is_admin": u.is_admin,
            "login_count": u.login_count or 0,
            "last_login": _iso(u.last_login),
            "created_at": _iso(u.created_at),
            "analysis_count": int(s.count) if s else 0,
            "last_analysis_at": _iso(s.last_at) if s else None,
        })
    return result


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
