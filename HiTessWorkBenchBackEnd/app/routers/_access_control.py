"""분석 작업 파일/상태 접근 제어 helper.

사내 사번 기반 인증 수준을 유지하면서, userConnection 작업 폴더는
본인 또는 관리자만 접근하도록 제한한다.
"""
import os
import re

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models

WORK_FOLDER_RE = re.compile(r"^\d{8}_\d{6}_(?P<employee_id>[^_]+)_.+$")


def owner_from_userconnection_path(path: str, user_connection_base: str) -> str | None:
    """userConnection/{timestamp}_{employee_id}_{Program}/... 경로에서 소유자 사번을 추출합니다."""
    try:
        rel = os.path.relpath(os.path.abspath(path), os.path.abspath(user_connection_base))
    except ValueError:
        return None
    if rel.startswith(".."):
        return None
    first_segment = rel.split(os.sep, 1)[0]
    match = WORK_FOLDER_RE.match(first_segment)
    return match.group("employee_id") if match else None


def is_admin_user(db: Session, employee_id: str) -> bool:
    user = db.query(models.User).filter(models.User.employee_id == employee_id).first()
    return bool(user and user.is_admin)


def assert_current_user_can_access_owner(owner_id: str | None, current_user: str, db: Session) -> None:
    """소유자 식별이 가능한 작업은 본인 또는 관리자만 접근하도록 제한합니다."""
    if not owner_id or owner_id == current_user:
        return
    if is_admin_user(db, current_user):
        return
    raise HTTPException(status_code=403, detail="접근 권한이 없는 작업입니다.")


def assert_current_user_can_access_path(
    path: str,
    current_user: str,
    db: Session,
    user_connection_base: str,
) -> None:
    assert_current_user_can_access_owner(
        owner_from_userconnection_path(path, user_connection_base),
        current_user,
        db,
    )


def assert_current_user_can_access_job(job_id: str, current_user: str, db: Session, status: dict | None = None) -> None:
    record = db.query(models.Analysis).filter(models.Analysis.job_id == job_id).first()
    if record:
        assert_current_user_can_access_owner(record.employee_id, current_user, db)
        return
    if isinstance(status, dict):
        assert_current_user_can_access_owner(status.get("employee_id"), current_user, db)
