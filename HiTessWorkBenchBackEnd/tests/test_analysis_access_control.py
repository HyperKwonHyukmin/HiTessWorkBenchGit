"""analysis 라우터의 작업/경로 소유권 검증 helper 테스트."""
import os

import pytest
from fastapi import HTTPException

from app import models
from app.routers import analysis
from app.routers import _access_control


def test_owner_from_userconnection_path_extracts_employee_id():
    path = os.path.join(
        analysis._ALLOWED_DOWNLOAD_BASE,
        "20260615_101112_A123456_HiTessModelBuilder",
        "result.bdf",
    )

    assert _access_control.owner_from_userconnection_path(path, analysis._ALLOWED_DOWNLOAD_BASE) == "A123456"


def test_owner_access_allows_same_user(db_session):
    _access_control.assert_current_user_can_access_owner("A123456", "A123456", db_session)


def test_owner_access_blocks_other_non_admin_user(db_session):
    db_session.add(models.User(
        employee_id="A654321",
        name="사용자",
        company="HHI",
        position="Engineer",
        is_active=True,
        is_admin=False,
    ))
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        _access_control.assert_current_user_can_access_owner("A123456", "A654321", db_session)

    assert exc.value.status_code == 403


def test_owner_access_allows_admin_user(db_session):
    db_session.add(models.User(
        employee_id="ADMIN01",
        name="관리자",
        company="HHI",
        position="Admin",
        is_active=True,
        is_admin=True,
    ))
    db_session.commit()

    _access_control.assert_current_user_can_access_owner("A123456", "ADMIN01", db_session)


def test_job_access_uses_analysis_record_owner_before_memory_status(db_session):
    db_session.add(models.Analysis(
        job_id="job-1",
        project_name="project",
        program_name="HiTessModelBuilder",
        employee_id="A123456",
        status="Running",
        job_status="Running",
        progress=50,
        input_info={},
        result_info={},
    ))
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        _access_control.assert_current_user_can_access_job(
            "job-1",
            "A654321",
            db_session,
            {"status": "Running", "employee_id": "A123456"},
        )

    assert exc.value.status_code == 403
