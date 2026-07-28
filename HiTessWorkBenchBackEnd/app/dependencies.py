from fastapi import Header, HTTPException, Depends
from sqlalchemy.orm import Session
from app.sessions import session_store
from app import database, models


def require_auth(authorization: str = Header(default=None)) -> str:
    """Authorization: Bearer <token> 헤더 검증. 성공 시 employee_id 반환."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")
    token = authorization.removeprefix("Bearer ").strip()
    employee_id = session_store.get_employee_id(token)
    if not employee_id:
        raise HTTPException(status_code=401, detail="유효하지 않거나 만료된 세션입니다. 다시 로그인해주세요.")
    return employee_id


def require_admin(employee_id: str = Depends(require_auth), db: Session = Depends(database.get_db)) -> str:
    """관리자 권한 검증. 성공 시 employee_id 반환."""
    user = db.query(models.User).filter(models.User.employee_id == employee_id).first()
    if not user or not user.is_admin:
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")
    return employee_id


def authenticated_employee_id(claimed_employee_id: str | None, current_user: str) -> str:
    """Return the token identity after rejecting a conflicting client claim.

    Older WorkBench requests may omit the body/form employee id, so an absent
    value is accepted.  A supplied value is never trusted and must match the
    authenticated session.
    """
    if not isinstance(current_user, str) or not current_user.strip():
        raise HTTPException(
            status_code=401,
            detail="인증 사용자 정보가 올바르지 않습니다.",
        )
    claimed = (claimed_employee_id or "").strip()
    if claimed and claimed.lower() not in {"unknown", "undefined"} and claimed != current_user:
        raise HTTPException(
            status_code=403,
            detail="employee_id가 인증 사용자와 일치하지 않습니다.",
        )
    return current_user
