"""P0 authentication, identity, and legacy-upload security regressions."""
import os
import io
import pickle
import subprocess
import asyncio
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app import database, models, sessions
from app.dependencies import optional_auth, require_auth
from app.routers import (
    carling,
    column_buckling,
    d_type_lug,
    davit,
    doublepipe,
    hitessbeam,
    hole_calculation,
    section_property,
)


def _route_dependency_names(router):
    return {
        route.path: {dep.call.__name__ for dep in route.dependant.dependencies}
        for route in router.routes
    }


def test_engineering_routes_require_auth():
    expected = [
        (carling.router, {
            "/api/carling/free",
            "/api/carling/optimization",
            "/api/carling/free/report",
            "/api/carling/optimization/report",
        }),
        (davit.router, {
            "/api/davit/jib-rest-1dan",
            "/api/davit/jib-rest-2dan",
            "/api/davit/mast-post",
        }),
        (column_buckling.router, {"/api/column-buckling/calculate"}),
        (d_type_lug.router, {"/api/d-type-lug/calculate"}),
        (hole_calculation.router, {"/api/hole-calculation/calculate"}),
        (section_property.router, {
            "/api/section-property/calculate",
            "/api/section-property/shapes",
        }),
        (doublepipe.router, {route.path for route in doublepipe.router.routes}),
    ]

    for router, paths in expected:
        dependencies = _route_dependency_names(router)
        for path in paths:
            assert "require_auth" in dependencies[path], path


def test_hitessbeam_legacy_routes_use_optional_auth_by_design():
    """hitessbeam 라우터만 require_auth 예외다 — 실수가 아니라 결정이다.

    이 창구를 쓰는 건 WorkBench 앱이 아니라 사내에 이미 배포된 실행 파일
    (HiTESS Beam 이 띄우는 ModuleUnitAnalysis.exe 등)이라 Authorization 헤더를
    붙일 수 없다. 2026-07-28 에 require_auth 로 닫았다가 배포본이 전부 401 로
    죽었다. 토큰이 오면 신원·소유권을 그대로 강제한다 —
    자세한 계약은 tests/test_hitessbeam_legacy_client.py 참조.
    """
    dependencies = _route_dependency_names(hitessbeam.router)
    for route in hitessbeam.router.routes:
        assert "optional_auth" in dependencies[route.path], route.path
        assert "require_auth" not in dependencies[route.path], route.path


def test_session_is_invalidated_when_user_becomes_inactive(db_session, monkeypatch):
    SessionFactory = sessionmaker(
        bind=db_session.get_bind(),
        autocommit=False,
        autoflush=False,
    )
    monkeypatch.setattr(sessions, "SessionLocal", SessionFactory)
    db_session.add(models.User(
        employee_id="USER001",
        name="사용자",
        company="HHI",
        is_active=True,
    ))
    db_session.add(models.UserSession(
        token="active-token",
        employee_id="USER001",
        created_at=datetime.now(),
        expires_at=datetime.now() + timedelta(hours=1),
    ))
    db_session.commit()

    assert sessions.session_store.get_employee_id("active-token") == "USER001"
    user = db_session.query(models.User).filter_by(employee_id="USER001").one()
    user.is_active = False
    db_session.commit()

    assert sessions.session_store.get_employee_id("active-token") is None
    db_session.expire_all()
    assert db_session.query(models.UserSession).filter_by(token="active-token").first() is None


def test_hitessbeam_restricted_pickle_accepts_legacy_string_list():
    content = pickle.dumps(["structure.csv", "None", "equipment.csv"])
    assert hitessbeam._load_role_list(content) == [
        "structure.csv",
        "None",
        "equipment.csv",
    ]


def test_hitessbeam_restricted_pickle_normalizes_legacy_absolute_paths():
    content = pickle.dumps([
        r"C:\Engineering\CsvToBdf\structure.csv",
        r"C:\Engineering\CsvToBdf\pipe.csv",
        r"C:\Engineering\CsvToBdf\equipment.csv",
    ])

    assert hitessbeam._load_role_list(content) == [
        "structure.csv",
        "pipe.csv",
        "equipment.csv",
    ]


def test_hitessbeam_restricted_pickle_rejects_global_execution(tmp_path):
    marker = tmp_path / "pickle-executed.txt"

    class Payload:
        def __reduce__(self):
            return (os.system, (f'echo unsafe > "{marker}"',))

    content = pickle.dumps(Payload())
    with pytest.raises(pickle.UnpicklingError):
        hitessbeam._load_role_list(content)
    assert not marker.exists()


def test_engineering_route_rejects_conflicting_employee_id(monkeypatch):
    app = FastAPI()
    app.include_router(column_buckling.router)
    app.dependency_overrides[require_auth] = lambda: "USER001"
    called = []
    monkeypatch.setattr(
        column_buckling,
        "run_column_buckling",
        lambda *args: called.append(args) or {},
    )

    response = TestClient(app).post(
        "/api/column-buckling/calculate",
        json={
            "member_name": "300A PIPE",
            "length_mm": 1000,
            "employee_id": "USER002",
        },
    )
    assert response.status_code == 403
    assert called == []


def test_doublepipe_status_is_owner_or_admin_only(db_session, monkeypatch):
    app = FastAPI()
    app.include_router(doublepipe.router)

    def override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = override_db
    app.dependency_overrides[require_auth] = lambda: "USER001"
    db_session.add(models.User(
        employee_id="USER001",
        name="사용자",
        company="HHI",
        is_active=True,
        is_admin=False,
    ))
    db_session.commit()
    monkeypatch.setattr(
        doublepipe,
        "get_psa_job",
        lambda _job_id: {
            "jobId": "job-2",
            "employeeId": "USER002",
            "status": "running",
            "logs": ["solver detail"],
        },
    )

    response = TestClient(app).get("/api/doublepipe/run-psa/status/job-2")
    assert response.status_code == 403


def test_doublepipe_active_hides_other_users_job_details(db_session, monkeypatch):
    app = FastAPI()
    app.include_router(doublepipe.router)

    def override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = override_db
    app.dependency_overrides[require_auth] = lambda: "USER001"
    db_session.add(models.User(
        employee_id="USER001",
        name="사용자",
        company="HHI",
        is_active=True,
        is_admin=False,
    ))
    db_session.commit()
    monkeypatch.setattr(
        doublepipe,
        "get_active_status",
        lambda: {
            "active": True,
            "jobId": "secret-job",
            "employeeId": "USER002",
            "startedAtEpoch": 10,
            "serverNowEpoch": 20,
            "elapsedSec": 10,
            "status": "running",
            "lastLog": "secret solver path",
        },
    )

    response = TestClient(app).get("/api/doublepipe/active")
    assert response.status_code == 200
    assert response.json()["active"] is True
    assert "jobId" not in response.json()
    assert "employeeId" not in response.json()
    assert "lastLog" not in response.json()


def test_doublepipe_upload_rejects_non_csv_before_service(monkeypatch):
    app = FastAPI()
    app.include_router(doublepipe.router)
    app.dependency_overrides[require_auth] = lambda: "USER001"
    called = []
    monkeypatch.setattr(
        doublepipe,
        "start_psa_job_from_upload",
        lambda *args: called.append(args) or {},
    )

    response = TestClient(app).post(
        "/api/doublepipe/run-psa-upload",
        data={"employee_id": "USER001"},
        files={"csv_file": ("input.txt", b"a,b\n1,2\n", "text/plain")},
    )

    assert response.status_code == 400
    assert called == []


def test_doublepipe_upload_is_bounded(monkeypatch):
    app = FastAPI()
    app.include_router(doublepipe.router)
    app.dependency_overrides[require_auth] = lambda: "USER001"
    monkeypatch.setattr(doublepipe, "_MAX_CSV_BYTES", 8)

    response = TestClient(app).post(
        "/api/doublepipe/run-psa-upload",
        data={"employee_id": "USER001"},
        files={"csv_file": ("input.csv", b"123456789", "text/csv")},
    )

    assert response.status_code == 413


def test_doublepipe_malformed_work_folder_cannot_bypass_owner_check(
    db_session,
    tmp_path,
    monkeypatch,
):
    base = tmp_path / "userConnection"
    (base / "legacy-folder").mkdir(parents=True)
    app = FastAPI()
    app.include_router(doublepipe.router)

    def override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = override_db
    app.dependency_overrides[require_auth] = lambda: "USER001"
    monkeypatch.setattr(doublepipe, "_USER_CONNECTION_DIR", str(base))
    called = []
    monkeypatch.setattr(
        doublepipe,
        "generate_inner_pipe_pdf",
        lambda *args: called.append(args) or (b"pdf", "result.pdf"),
    )

    response = TestClient(app).post(
        "/api/doublepipe/inner-pipe-pdf",
        json={
            "workDir": "legacy-folder",
            "sourceCsv": "input.csv",
            "employee_id": "USER001",
        },
    )

    assert response.status_code == 403
    assert called == []


def test_hitessbeam_malformed_work_folder_cannot_bypass_download_owner_check(
    db_session,
    tmp_path,
    monkeypatch,
):
    # 인증된 요청 기준의 검사다. 토큰을 안 보내는 레거시 exe 는 이 창구에서
    # 소유자 검사 자체가 없다(test_hitessbeam_legacy_client.py 참조).
    base = tmp_path / "userConnection"
    folder = base / "legacy-folder"
    folder.mkdir(parents=True)
    (folder / "result.bdf").write_text("ENDDATA\n", encoding="utf-8")
    app = FastAPI()
    app.include_router(hitessbeam.router)

    def override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = override_db
    app.dependency_overrides[optional_auth] = lambda: "USER001"
    monkeypatch.setattr(hitessbeam, "_USER_CONN_DIR", str(base))

    response = TestClient(app).get(
        "/hitessbeam/csvToBdf/download/legacy-folder/result.bdf",
    )

    assert response.status_code == 403


def test_hitessbeam_csv_converter_runs_blocking_work_in_threadpool(
    tmp_path,
    monkeypatch,
):
    backend_dir = tmp_path / "backend"
    executable = backend_dir / "CsvToBdf_HiTESS.exe"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"placeholder")

    threadpool_calls = []

    async def recorded_threadpool(func, *args, **kwargs):
        threadpool_calls.append(func)
        return func(*args, **kwargs)

    def fake_subprocess_run(cmd_args, **_kwargs):
        with open(cmd_args[-1], "w", encoding="utf-8") as output:
            output.write("ENDDATA\n")
        return subprocess.CompletedProcess(cmd_args, 0)

    monkeypatch.setattr(hitessbeam, "_BACKEND_DIR", str(backend_dir))
    monkeypatch.setattr(hitessbeam, "_EXE_PATH", str(executable))
    monkeypatch.setattr(hitessbeam, "run_in_threadpool", recorded_threadpool)
    monkeypatch.setattr(hitessbeam.subprocess, "run", fake_subprocess_run)

    response = asyncio.run(
        hitessbeam.csv_to_bdf(
            userID="USER001",
            current_user="USER001",
            file=[
                hitessbeam.UploadFile(
                    filename="input.pkl",
                    file=io.BytesIO(pickle.dumps(["structure.csv", "None", "None"])),
                ),
                hitessbeam.UploadFile(
                    filename="structure.csv",
                    file=io.BytesIO(b"node,x,y,z\n"),
                ),
            ],
        )
    )

    assert response["bdfFilename"] == "structure.bdf"
    assert fake_subprocess_run in threadpool_calls
    assert hitessbeam._clean_grav_card in threadpool_calls


def test_hitessbeam_module_unit_runs_solver_in_threadpool(
    tmp_path,
    monkeypatch,
):
    backend_dir = tmp_path / "backend"
    executable = backend_dir / "ModuleUnit_HiTESS.exe"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"placeholder")

    threadpool_calls = []

    async def recorded_threadpool(func, *args, **kwargs):
        threadpool_calls.append(func)
        return func(*args, **kwargs)

    def fake_subprocess_run(cmd_args, **_kwargs):
        with open(cmd_args[2], "w", encoding="utf-8") as output:
            output.write("ENDDATA\n")
        return subprocess.CompletedProcess(cmd_args, 0, stdout="", stderr="")

    monkeypatch.setattr(hitessbeam, "_BACKEND_DIR", str(backend_dir))
    monkeypatch.setattr(hitessbeam, "_MODULE_UNIT_EXE", str(executable))
    monkeypatch.setattr(hitessbeam, "run_in_threadpool", recorded_threadpool)
    monkeypatch.setattr(hitessbeam.subprocess, "run", fake_subprocess_run)

    response = asyncio.run(
        hitessbeam.module_unit(
            userID="USER001",
            current_user="USER001",
            programName="ModuleUnit",
            file=hitessbeam.UploadFile(
                filename="input.bdf",
                file=io.BytesIO(b"BEGIN BULK\nENDDATA\n"),
            ),
        )
    )

    assert response["bdf_filename"] == "input_r.bdf"
    assert fake_subprocess_run in threadpool_calls
