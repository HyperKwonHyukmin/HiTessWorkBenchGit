"""analysis 라우터의 작업/경로 소유권 검증 helper 테스트."""
import os

import pytest
from fastapi import HTTPException

from app import models
from app.dependencies import authenticated_employee_id
from app.routers import analysis
from app.routers import _access_control
from app.routers import _intake


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


def test_path_access_fails_closed_when_work_folder_owner_cannot_be_parsed(db_session, tmp_path):
    base = tmp_path / "userConnection"
    malformed_path = base / "legacy-shared-folder" / "result.bdf"

    with pytest.raises(HTTPException) as exc:
        _access_control.assert_current_user_can_access_path(
            str(malformed_path),
            "A123456",
            db_session,
            str(base),
        )

    assert exc.value.status_code == 403


def test_path_access_allows_admin_for_unparseable_legacy_folder(db_session, tmp_path):
    db_session.add(models.User(
        employee_id="ADMIN01",
        name="관리자",
        company="HHI",
        position="Admin",
        is_active=True,
        is_admin=True,
    ))
    db_session.commit()
    base = tmp_path / "userConnection"

    _access_control.assert_current_user_can_access_path(
        str(base / "legacy-shared-folder" / "result.bdf"),
        "ADMIN01",
        db_session,
        str(base),
    )


def test_path_access_requires_explicit_opt_in_for_shared_assets(db_session):
    _access_control.assert_current_user_can_access_owner(
        None,
        "A123456",
        db_session,
        allow_unowned=True,
    )


def test_authenticated_employee_id_rejects_unresolved_dependency_identity():
    with pytest.raises(HTTPException) as exc:
        authenticated_employee_id("A123456", object())

    assert exc.value.status_code == 401


def test_pending_memory_status_keeps_owner_when_db_recording_fails(monkeypatch):
    captured = {}

    def fake_set(job_id, data):
        captured.update(data)

    monkeypatch.setattr(_intake, "_record_pending_analysis", lambda *args: None)
    monkeypatch.setattr(_intake.job_status_store, "set", fake_set)
    monkeypatch.setattr(_intake.analysis_executor, "submit", lambda *args: None)

    _intake.submit_analysis_job(
        lambda *_args: None,
        "input.bdf",
        "work",
        "A123456",
        "20260728_120000",
        "Workbench",
    )

    assert captured["status"] == "Pending"
    assert captured["employee_id"] == "A123456"
