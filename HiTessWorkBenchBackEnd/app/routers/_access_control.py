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


def assert_current_user_can_access_owner(
    owner_id: str | None,
    current_user: str,
    db: Session,
    *,
    allow_unowned: bool = False,
) -> None:
    """소유자 또는 관리자만 허용하며, 소유자 미식별 상태는 기본 거부합니다.

    ``allow_unowned=True``는 관리자가 배포한 catalogue/sample 같은 명시적 공유
    자산에만 사용하는 예외입니다. 사용자가 전달한 userConnection 경로에는 이
    예외를 사용하지 않아, 비표준/손상된 폴더명이 권한 우회가 되지 않게 합니다.
    관리자는 레거시 작업 복구를 위해 소유자 미식별 경로에도 접근할 수 있습니다.
    """
    if (
        owner_id
        and owner_id.strip().casefold() == (current_user or "").strip().casefold()
    ):
        return
    if is_admin_user(db, current_user):
        return
    if not owner_id and allow_unowned:
        return
    raise HTTPException(status_code=403, detail="접근 권한이 없는 작업입니다.")


def assert_current_user_can_access_path(
    path: str,
    current_user: str,
    db: Session,
    user_connection_base: str,
    *,
    allow_unowned: bool = False,
) -> None:
    assert_current_user_can_access_owner(
        owner_from_userconnection_path(path, user_connection_base),
        current_user,
        db,
        allow_unowned=allow_unowned,
    )


def assert_current_user_can_access_job(job_id: str, current_user: str, db: Session, status: dict | None = None) -> None:
    record = db.query(models.Analysis).filter(models.Analysis.job_id == job_id).first()
    if record:
        assert_current_user_can_access_owner(record.employee_id, current_user, db)
        return
    if isinstance(status, dict):
        assert_current_user_can_access_owner(status.get("employee_id"), current_user, db)
        return
    # DB와 메모리 어디에서도 소유자를 입증하지 못하면 존재 여부 자체를 노출하지 않는다.
    raise HTTPException(status_code=403, detail="접근 권한이 없는 작업입니다.")
