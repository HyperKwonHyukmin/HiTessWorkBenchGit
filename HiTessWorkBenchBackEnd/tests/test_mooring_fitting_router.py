"""POST /api/analysis/mooring-fitting/request — 라우터 통합 테스트.

executor 의 실제 task 실행은 mock 으로 차단하고 다음만 검증:
  - 200 응답 + job_id 반환
  - userConnection/{ts}_{eid}_MooringFitting/ 폴더 생성
  - 두 CSV가 표준 파일명(MooringFittingData.csv, MooringFittingDataLoad.csv)으로 저장
  - submit 인자에 표준 경로가 그대로 전달됨
"""
import io
import os

import pytest


@pytest.fixture(autouse=True)
def isolated_user_connection(tmp_path, monkeypatch):
    """Mooring Fitting 요청 작업 폴더를 테스트별 임시 루트로 격리한다."""
    from app.routers import _intake, analysis

    root = tmp_path / "userConnection"
    root.mkdir()
    monkeypatch.setattr(_intake, "USER_CONNECTION_DIR", str(root))
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(root))
    return root


@pytest.fixture
def auth_client(db_session):
    """일반 사용자(HHI123)로 인증되는 TestClient."""
    from fastapi.testclient import TestClient
    from app import database, models
    from app.dependencies import require_auth
    from app.main import app

    def _override_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[database.get_db] = _override_db
    app.dependency_overrides[require_auth] = lambda: "HHI123"

    user = models.User(
        employee_id="HHI123", name="테스트사용자", company="HHI",
        is_active=True, is_admin=False, is_developer=False,
    )
    db_session.add(user)
    db_session.commit()

    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_request_saves_csvs_with_standard_filenames(
    auth_client,
    isolated_user_connection,
    monkeypatch,
):
    """업로드된 임의 파일명이 표준명으로 강제 저장되어야 한다."""
    captured = {}

    def fake_submit(task_fn, *args, **kwargs):
        # task_fn 실행 차단 — 인자만 캡쳐
        captured["args"] = args

    monkeypatch.setattr(
        "app.services.job_manager.analysis_executor.submit", fake_submit
    )

    files = {
        "structure_file": ("Vessel_X_data.csv", b"MF,F1,Pipe,0,0,0,...\n", "text/csv"),
        "load_file":      ("Vessel_X_load.csv", b"LOADCASE,F1,1,2,3,...\n", "text/csv"),
    }
    data = {"employee_id": "HHI123", "source": "Workbench"}
    res = auth_client.post("/api/analysis/mooring-fitting/request", files=files, data=data)

    assert res.status_code == 200, res.text
    body = res.json()
    assert "job_id" in body

    # work_dir 가 userConnection 하위에 생성되었는지
    # submit_analysis_job → analysis_executor.submit(task_fn, job_id, *task_args)
    # fake_submit(task_fn, *args) 이므로 args = (job_id, structure_path, load_path, work_dir, ...)
    structure_path = captured["args"][1]
    load_path = captured["args"][2]
    work_dir = captured["args"][3]

    assert os.path.commonpath([work_dir, str(isolated_user_connection)]) == str(
        isolated_user_connection
    )
    assert "_HHI123_MooringFitting" in os.path.basename(work_dir)
    assert os.path.basename(structure_path) == "MooringFittingData.csv"
    assert os.path.basename(load_path) == "MooringFittingDataLoad.csv"
    assert os.path.isfile(structure_path)
    assert os.path.isfile(load_path)
    # 사용자 임의 파일명으로는 저장되지 않아야
    assert not os.path.exists(os.path.join(work_dir, "Vessel_X_data.csv"))
    assert not os.path.exists(os.path.join(work_dir, "Vessel_X_load.csv"))


def test_request_rejects_mismatched_employee_id(auth_client, monkeypatch):
    """Form 의 employee_id 가 인증 사용자와 다르면 403."""
    monkeypatch.setattr(
        "app.services.job_manager.analysis_executor.submit", lambda *a, **k: None
    )
    # File(...) 은 필수 필드 — 파일 없이 보내면 422 가 먼저 발생하므로
    # 403 검증을 위해 의도적으로 최소 파일을 첨부한다.
    files = {
        "structure_file": ("a.csv", b"x\n", "text/csv"),
        "load_file":      ("b.csv", b"y\n", "text/csv"),
    }
    data = {"employee_id": "OTHER999", "source": "Workbench"}
    res = auth_client.post("/api/analysis/mooring-fitting/request", files=files, data=data)
    assert res.status_code == 403


def test_run_sample_uses_backend_relative_csvs(
    auth_client,
    isolated_user_connection,
    tmp_path,
    monkeypatch,
):
    """서버 SampleFile/MooringFitting 의 두 CSV를 표준명으로 복사해 실행한다."""
    from app.routers import analysis

    sample_dir = tmp_path / "backend" / "SampleFile" / "MooringFitting"
    sample_dir.mkdir(parents=True)
    structure_bytes = b"MF,F1,Pipe,0,0,0\n"
    load_bytes = b"LOADCASE,F1,1,2,3\n"
    (sample_dir / "MooringFittingData.csv").write_bytes(structure_bytes)
    (sample_dir / "MooringFittingDataLoad.csv").write_bytes(load_bytes)
    monkeypatch.setattr(analysis, "_BACKEND_DIR", str(tmp_path / "backend"))
    analysis._SAMPLE_RUN_TRACKER.pop(("mooring-fitting", "HHI123"), None)

    captured = {}

    def fake_submit(task_fn, *args, **kwargs):
        captured["args"] = args

    monkeypatch.setattr(
        "app.services.job_manager.analysis_executor.submit", fake_submit
    )

    res = auth_client.post("/api/analysis/mooring-fitting/run-sample")

    assert res.status_code == 200, res.text
    assert "job_id" in res.json()
    structure_path = captured["args"][1]
    load_path = captured["args"][2]
    work_dir = captured["args"][3]
    assert os.path.commonpath([work_dir, str(isolated_user_connection)]) == str(
        isolated_user_connection
    )
    assert os.path.basename(structure_path) == "MooringFittingData.csv"
    assert os.path.basename(load_path) == "MooringFittingDataLoad.csv"
    with open(structure_path, "rb") as structure_file:
        assert structure_file.read() == structure_bytes
    with open(load_path, "rb") as load_file:
        assert load_file.read() == load_bytes
    assert captured["args"][7] == "WorkbenchSample"
    assert captured["args"][8] == 1.25


def test_run_sample_returns_404_when_relative_sample_files_are_missing(
    auth_client,
    tmp_path,
    monkeypatch,
):
    """배포 서버에 두 CSV가 없으면 필요한 상대 경로를 포함한 404를 반환한다."""
    from app.routers import analysis

    monkeypatch.setattr(analysis, "_BACKEND_DIR", str(tmp_path / "empty-backend"))
    analysis._SAMPLE_RUN_TRACKER.pop(("mooring-fitting", "HHI123"), None)

    res = auth_client.post("/api/analysis/mooring-fitting/run-sample")

    assert res.status_code == 404
    assert "SampleFile/MooringFitting" in res.json()["detail"]
