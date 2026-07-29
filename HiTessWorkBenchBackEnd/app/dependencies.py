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


def optional_auth(authorization: str = Header(default=None)) -> str | None:
    """Authorization 헤더가 있으면 검증하고, 아예 없으면 None 을 반환한다.

    사내에 이미 배포되어 헤더를 붙일 수 없는 레거시 클라이언트(HiTESS Beam 이
    실행하는 ModuleUnitAnalysis.exe 등) 전용 창구에만 사용한다. 새 엔드포인트는
    반드시 require_auth 를 쓸 것.

    헤더가 '있는데 잘못된' 경우는 익명으로 강등하지 않고 그대로 401 이다.
    만료된 세션을 조용히 레거시 경로로 흘려보내면, 인증이 끝난 클라이언트가
    임의의 사번을 주장할 수 있게 된다.
    """
    if authorization is None:
        return None
    return require_auth(authorization)


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
