"""실제 analysis route의 userConnection 소유권 회귀 테스트."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import database, models
from app.dependencies import require_auth
from app.routers import analysis


def _client(db_session, employee_id: str) -> TestClient:
    app = FastAPI()
    app.include_router(analysis.router)

    def override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = override_db
    app.dependency_overrides[require_auth] = lambda: employee_id
    return TestClient(app)


def _owner_workspace(tmp_path, monkeypatch, owner="OWNER01"):
    base = tmp_path / "userConnection"
    work_dir = base / f"20260728_120000_{owner}_Program"
    work_dir.mkdir(parents=True)
    bdf_path = work_dir / "model.bdf"
    bdf_path.write_text("CEND\nBEGIN BULK\nENDDATA\n", encoding="utf-8")
    posture_path = work_dir / "model_posture.json"
    posture_path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))
    monkeypatch.setattr(analysis, "_ALLOWED_DOWNLOAD_BASE", str(base))
    monkeypatch.setattr(analysis, "submit_analysis_job", lambda *args, **kwargs: "job-test")
    return work_dir, bdf_path, posture_path


def test_path_driven_analysis_routes_block_cross_user(
    db_session,
    tmp_path,
    monkeypatch,
):
    work_dir, bdf_path, posture_path = _owner_workspace(tmp_path, monkeypatch)
    client = _client(db_session, "OTHER01")

    requests = [
        (
            "/api/analysis/drawing-to-analysis/rebuild",
            {"json": {
                "employee_id": "OTHER01",
                "work_dir": str(work_dir),
                "mode": "lug",
                "params": {},
            }},
        ),
        (
            "/api/analysis/drawing-to-analysis/solve",
            {"json": {
                "employee_id": "OTHER01",
                "work_dir": str(work_dir),
                "bdf_path": str(bdf_path),
                "bcs": [{"nodes": [1], "dof": "123456"}],
            }},
        ),
        (
            "/api/analysis/modelbuilder/solve",
            {"json": {
                "employee_id": "OTHER01",
                "work_dir": str(work_dir),
                "bdf_path": str(bdf_path),
                "bcs": [{"nodes": [1], "dof": "123456"}],
            }},
        ),
        (
            "/api/analysis/module-stability/request",
            {"json": {"posturePath": str(posture_path)}},
        ),
        (
            "/api/analysis/module-stability/optimize",
            {"json": {"posturePath": str(posture_path)}},
        ),
        (
            "/api/analysis/groupmoduleunit/request-from-path",
            {"data": {
                "bdf_server_path": str(bdf_path),
                "employee_id": "OTHER01",
            }},
        ),
    ]

    for path, request_kwargs in requests:
        response = client.post(path, **request_kwargs)
        assert response.status_code == 403, (path, response.text)


def test_unit_structural_blocks_cross_user_parent(
    db_session,
    tmp_path,
    monkeypatch,
):
    _work_dir, bdf_path, posture_path = _owner_workspace(tmp_path, monkeypatch)
    parent = models.Analysis(
        employee_id="OWNER01",
        program_name="GroupModuleUnit",
        project_name="owner-project",
        status="Success",
        input_info={"bdf_model": str(bdf_path)},
        result_info={},
    )
    db_session.add(parent)
    db_session.commit()

    response = _client(db_session, "OTHER01").post(
        "/api/analysis/unit-structural/request",
        data={
            "stability_path": str(posture_path),
            "parent_analysis_id": parent.id,
            "employee_id": "OTHER01",
        },
    )

    assert response.status_code == 403


def test_module_stability_upload_rejects_oversized_artifact(
    db_session,
    tmp_path,
    monkeypatch,
):
    _work_dir, bdf_path, _posture_path = _owner_workspace(
        tmp_path,
        monkeypatch,
        owner="OWNER01",
    )
    parent = models.Analysis(
        employee_id="OWNER01",
        program_name="GroupModuleUnit",
        project_name="owner-project",
        status="Success",
        input_info={"bdf_model": str(bdf_path)},
        result_info={},
    )
    db_session.add(parent)
    db_session.commit()
    monkeypatch.setattr(analysis, "MODULE_STABILITY_UPLOAD_MAX_BYTES", 4)

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-stability/upload",
        data={
            "employee_id": "OWNER01",
            "parent_analysis_id": str(parent.id),
            "artifact_kind": "posture",
        },
        files={"file": ("model_posture.json", b"12345", "application/json")},
    )

    assert response.status_code == 413
    assert not (bdf_path.parent / "model_posture.json").exists()


def test_admin_can_use_owned_route_for_support(
    db_session,
    tmp_path,
    monkeypatch,
):
    work_dir, _bdf_path, _posture_path = _owner_workspace(tmp_path, monkeypatch)
    db_session.add(models.User(
        employee_id="ADMIN01",
        name="관리자",
        company="HHI",
        is_active=True,
        is_admin=True,
    ))
    db_session.commit()

    response = _client(db_session, "ADMIN01").post(
        "/api/analysis/drawing-to-analysis/rebuild",
        json={
            "employee_id": "ADMIN01",
            "work_dir": str(work_dir),
            "mode": "lug",
            "params": {},
        },
    )

    assert response.status_code == 200, response.text


def test_cog_malformed_work_folder_cannot_bypass_owner_check(
    db_session,
    tmp_path,
    monkeypatch,
):
    base = tmp_path / "userConnection"
    folder = base / "legacy-folder"
    folder.mkdir(parents=True)
    bdf_path = folder / "model.bdf"
    bdf_path.write_text("ENDDATA\n", encoding="utf-8")
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))
    monkeypatch.setattr(analysis, "_ALLOWED_DOWNLOAD_BASE", str(base))

    response = _client(db_session, "USER001").post(
        "/api/analysis/groupmodule/cog",
        json={"bdf_path": str(bdf_path)},
    )

    assert response.status_code == 403
