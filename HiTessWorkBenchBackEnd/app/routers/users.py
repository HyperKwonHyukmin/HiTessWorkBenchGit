"""사용자 관리 API 라우터."""
from fastapi import APIRouter, Depends, Request
from sqlalchemy import func
from sqlalchemy.orm import Session
from .. import models, database
from ..dependencies import require_admin
from ..services.activity_service import log_activity
from ._crud_helpers import delete_record, get_or_404, update_record

router = APIRouter(prefix="/api", tags=["users"])

_USER_NOT_FOUND = "User not found"


@router.get("/users")
def get_users(
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    users = db.query(models.User).all()

    # 사용자별 해석 통계 — N+1 회피 위해 단일 GROUP BY 쿼리로 일괄 조회.
    # 사번 대소문자(a477273 ↔ A477273)는 동일인으로 병합한다.
    stats_rows = (
        db.query(
            models.Analysis.employee_id.label("employee_id"),
            func.count(models.Analysis.id).label("count"),
            func.max(models.Analysis.created_at).label("last_at"),
        )
        .group_by(models.Analysis.employee_id)
        .all()
    )

    def _norm(v):
        return (v or "").strip().upper()

    stats_map = {}
    for row in stats_rows:
        key = _norm(row.employee_id)
        prev = stats_map.get(key)
        if prev:
            prev["count"] += int(row.count or 0)
            if row.last_at and (prev["last_at"] is None or row.last_at > prev["last_at"]):
                prev["last_at"] = row.last_at
        else:
            stats_map[key] = {"count": int(row.count or 0), "last_at": row.last_at}

    def _iso(dt):
        return dt.isoformat() if dt else None

    result = []
    for u in users:
        s = stats_map.get(_norm(u.employee_id))
        result.append({
            "id": u.id,
            "employee_id": _norm(u.employee_id),
            "name": u.name,
            "company": u.company,
            "department": u.department,
            "position": u.position,
            "is_active": u.is_active,
            "is_admin": u.is_admin,
            "is_developer": bool(getattr(u, "is_developer", False)),
            "login_count": u.login_count or 0,
            "last_login": _iso(u.last_login),
            "created_at": _iso(u.created_at),
            "analysis_count": s["count"] if s else 0,
            "last_analysis_at": _iso(s["last_at"]) if s else None,
        })
    return result


# is_admin / is_developer 는 관리자만 변경 가능 (PUT 시 화이트리스트 분리)
_USER_ALLOWED_FIELDS = {"name", "company", "department", "position", "is_active"}
_ADMIN_ALLOWED_FIELDS = {"is_admin", "is_developer"}

@router.put("/users/{user_id}")
def update_user(
    user_id: int,
    update_data: dict,
    req: Request,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    user = get_or_404(db, models.User, user_id, _USER_NOT_FOUND)
    before_active = bool(user.is_active)
    # update_data 는 임의 dict 이므로 화이트리스트 외 필드는 무시 (임의 컬럼 주입 차단).
    update_record(db, user, update_data, allowed_fields=_USER_ALLOWED_FIELDS | _ADMIN_ALLOWED_FIELDS)
    action = "USER_APPROVE" if not before_active and bool(user.is_active) else (
        "USER_DEACTIVATE" if before_active and not bool(user.is_active) else "USER_UPDATE"
    )
    log_activity(
        db,
        action,
        employee_id=current_admin,
        action_detail={"target_employee_id": user.employee_id, "target_user_id": user.id, "fields": sorted(update_data.keys())},
        status="success",
        ip_address=req.client.host if req.client else None,
    )
    return {"message": "Update successful"}


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    req: Request,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    user = get_or_404(db, models.User, user_id, _USER_NOT_FOUND)
    target_employee_id = user.employee_id
    result = delete_record(db, user, message="User deleted")
    log_activity(
        db,
        "USER_DELETE",
        employee_id=current_admin,
        action_detail={"target_employee_id": target_employee_id, "target_user_id": user_id},
        status="success",
        ip_address=req.client.host if req.client else None,
    )
    return result
