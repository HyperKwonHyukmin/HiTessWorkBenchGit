"""사용자 관리 API 라우터."""
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session
from .. import models, database
from ..dependencies import require_admin
from ._crud_helpers import delete_record, get_or_404, update_record

router = APIRouter(prefix="/api", tags=["users"])

_USER_NOT_FOUND = "User not found"


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
    user = get_or_404(db, models.User, user_id, _USER_NOT_FOUND)
    # update_data 는 임의 dict 이므로 화이트리스트 외 필드는 무시 (임의 컬럼 주입 차단).
    update_record(db, user, update_data, allowed_fields=_USER_ALLOWED_FIELDS | _ADMIN_ALLOWED_FIELDS)
    return {"message": "Update successful"}


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    user = get_or_404(db, models.User, user_id, _USER_NOT_FOUND)
    return delete_record(db, user, message="User deleted")
