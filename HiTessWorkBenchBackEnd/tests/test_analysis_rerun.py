"""과거 프로젝트 동일 입력 재실행 API 테스트."""
import os
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import database, models
from app.dependencies import require_auth
from app.routers import _intake, analysis


@pytest.fixture(autouse=True)
def isolated_user_connection(tmp_path, monkeypatch):
    """재실행 테스트가 운영 userConnection에 작업 폴더를 만들지 않게 한다."""
    root = tmp_path / "userConnection"
    root.mkdir(exist_ok=True)
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(root))
    monkeypatch.setattr(_intake, "USER_CONNECTION_DIR", str(root))
    return root


def _seed_truss_project(db_session, employee_id: str, node_path: Path, member_path: Path):
    record = models.Analysis(
        employee_id=employee_id,
        program_name="TrussModelBuilder",
        project_name="rerun-source",
        status="Success",
        input_info={
            "node_csv": str(node_path),
            "member_csv": str(member_path),
        },
        result_info={},
        source="Workbench",
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def _client(db_session, employee_id: str) -> TestClient:
    app = FastAPI()
    app.include_router(analysis.router)

    def override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = override_db
    app.dependency_overrides[require_auth] = lambda: employee_id
    return TestClient(app)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (True, True),
        (False, False),
        ("true", True),
        ("1", True),
        ("false", False),
        ("0", False),
        (None, False),
        ("legacy-unknown", False),
    ],
)
def test_rerun_bool_handles_json_and_legacy_values(value, expected):
    assert analysis._rerun_bool(value) is expected


def test_rerun_copies_inputs_to_new_workdir_and_submits(admin_client, db_session, tmp_path, monkeypatch):
    source_dir = tmp_path / "userConnection" / "source"
    source_dir.mkdir(parents=True)
    node_path = source_dir / "node.csv"
    member_path = source_dir / "member.csv"
    node_path.write_text("id,x,y,z\n1,0,0,0\n", encoding="utf-8")
    member_path.write_text("id,n1,n2\n1,1,2\n", encoding="utf-8")
    record = _seed_truss_project(db_session, "ADMIN001", node_path, member_path)

    rerun_dir = tmp_path / "userConnection" / "rerun"
    rerun_dir.mkdir()
    submitted = {}

    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(tmp_path / "userConnection"))
    monkeypatch.setattr(analysis, "make_work_dir", lambda *_args: (str(rerun_dir), "20260728_120000"))

    def fake_submit(task, *args, **kwargs):
        submitted["task"] = task
        submitted["args"] = args
        submitted["kwargs"] = kwargs
        return "rerun-job-1"

    monkeypatch.setattr(analysis, "submit_analysis_job", fake_submit)

    response = admin_client.post(f"/api/analysis/{record.id}/rerun")

    assert response.status_code == 200
    assert response.json()["job_id"] == "rerun-job-1"
    assert submitted["task"] is analysis.task_execute_truss
    assert (rerun_dir / "node.csv").read_text(encoding="utf-8") == node_path.read_text(encoding="utf-8")
    assert (rerun_dir / "member.csv").read_text(encoding="utf-8") == member_path.read_text(encoding="utf-8")


def test_rerun_reports_expired_input_file(
    admin_client,
    db_session,
    isolated_user_connection,
):
    source_dir = isolated_user_connection / "source"
    source_dir.mkdir(parents=True)
    missing_node = source_dir / "missing-node.csv"
    missing_member = source_dir / "missing-member.csv"
    record = _seed_truss_project(db_session, "ADMIN001", missing_node, missing_member)

    response = admin_client.post(f"/api/analysis/{record.id}/rerun")

    assert response.status_code == 409
    assert "원본 입력 파일" in response.json()["detail"]
    assert list(isolated_user_connection.iterdir()) == [source_dir]


def test_rerun_rejects_input_owned_by_another_user(
    db_session,
    isolated_user_connection,
):
    source_dir = (
        isolated_user_connection
        / "20260728_120000_OTHER01_TrussModelBuilder"
    )
    source_dir.mkdir(parents=True)
    node_path = source_dir / "node.csv"
    member_path = source_dir / "member.csv"
    node_path.write_text("node", encoding="utf-8")
    member_path.write_text("member", encoding="utf-8")
    record = _seed_truss_project(
        db_session,
        "OWNER01",
        node_path,
        member_path,
    )
    response = _client(db_session, "OWNER01").post(
        f"/api/analysis/{record.id}/rerun",
    )

    assert response.status_code == 403
    assert list(isolated_user_connection.iterdir()) == [source_dir]


def test_rerun_submit_failure_cleans_owned_workspace(
    admin_client,
    db_session,
    isolated_user_connection,
    monkeypatch,
):
    source_dir = (
        isolated_user_connection
        / "20260728_120000_ADMIN001_TrussModelBuilder"
    )
    source_dir.mkdir(parents=True)
    node_path = source_dir / "node.csv"
    member_path = source_dir / "member.csv"
    node_path.write_text("node", encoding="utf-8")
    member_path.write_text("member", encoding="utf-8")
    record = _seed_truss_project(
        db_session,
        "ADMIN001",
        node_path,
        member_path,
    )
    monkeypatch.setattr(_intake, "_record_pending_analysis", lambda *_args: True)
    monkeypatch.setattr(
        _intake.analysis_executor,
        "submit",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("full")),
    )

    response = admin_client.post(f"/api/analysis/{record.id}/rerun")

    assert response.status_code == 503
    assert list(isolated_user_connection.iterdir()) == [source_dir]


def test_admin_can_rerun_owned_project_for_support(
    admin_client,
    db_session,
    tmp_path,
    monkeypatch,
):
    source_dir = (
        tmp_path
        / "userConnection"
        / "20260728_120000_OWNER01_TrussModelBuilder"
    )
    source_dir.mkdir(parents=True)
    node_path = source_dir / "node.csv"
    member_path = source_dir / "member.csv"
    node_path.write_text("node", encoding="utf-8")
    member_path.write_text("member", encoding="utf-8")
    record = _seed_truss_project(
        db_session,
        "OWNER01",
        node_path,
        member_path,
    )
    rerun_dir = tmp_path / "userConnection" / "admin-rerun"
    rerun_dir.mkdir()
    monkeypatch.setattr(
        analysis,
        "_USER_CONNECTION_DIR",
        str(tmp_path / "userConnection"),
    )
    monkeypatch.setattr(
        analysis,
        "make_work_dir",
        lambda *_args: (str(rerun_dir), "20260728_120000"),
    )
    monkeypatch.setattr(
        analysis,
        "submit_analysis_job",
        lambda *_args, **_kwargs: "admin-rerun-job",
    )

    response = admin_client.post(f"/api/analysis/{record.id}/rerun")

    assert response.status_code == 200
    assert response.json()["job_id"] == "admin-rerun-job"


@pytest.mark.parametrize("program_name", ["ModelBuilderAnalysis", "MooringFittingSolve"])
def test_derived_solve_records_are_not_rerunnable(
    admin_client,
    db_session,
    program_name,
):
    record = models.Analysis(
        employee_id="ADMIN001",
        program_name=program_name,
        project_name="derived-solve",
        status="Success",
        input_info={},
        result_info={},
        source="Workbench",
    )
    db_session.add(record)
    db_session.commit()

    response = admin_client.post(f"/api/analysis/{record.id}/rerun")

    assert response.status_code == 422
    assert "재실행을 지원하지 않습니다" in response.json()["detail"]


def test_rerun_rejects_symlink_that_resolves_outside_workspace(
    db_session,
    tmp_path,
    monkeypatch,
):
    base = tmp_path / "userConnection"
    owned = base / "20260728_120000_OWNER01_TrussModelBuilder"
    destination = base / "rerun"
    owned.mkdir(parents=True)
    destination.mkdir()
    outside = tmp_path / "outside.csv"
    outside.write_text("secret", encoding="utf-8")
    link = owned / "node.csv"
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip("Symlink creation is not permitted on this Windows host")
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))

    with pytest.raises(HTTPException) as exc_info:
        analysis._copy_rerun_input(
            str(link),
            str(destination),
            current_user="OWNER01",
            db=db_session,
        )

    assert exc_info.value.status_code == 403
    assert not (destination / "node.csv").exists()


def test_rerun_rejects_directory_link_to_another_owner(
    db_session,
    tmp_path,
    monkeypatch,
):
    base = tmp_path / "userConnection"
    owned = base / "20260728_120000_OWNER01_TrussModelBuilder"
    other = base / "20260728_120000_OTHER01_TrussModelBuilder"
    destination = base / "rerun"
    owned.mkdir(parents=True)
    other.mkdir()
    destination.mkdir()
    (other / "node.csv").write_text("other", encoding="utf-8")
    linked_dir = owned / "linked"
    try:
        linked_dir.symlink_to(other, target_is_directory=True)
    except OSError:
        pytest.skip("Directory symlink/junction creation is not permitted on this Windows host")
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))

    with pytest.raises(HTTPException) as exc_info:
        analysis._copy_rerun_input(
            str(linked_dir / "node.csv"),
            str(destination),
            current_user="OWNER01",
            db=db_session,
        )

    assert exc_info.value.status_code == 403
    assert not (destination / "node.csv").exists()


def test_rerun_discards_copy_if_source_changes_during_read(
    admin_client,
    db_session,
    tmp_path,
    monkeypatch,
):
    base = tmp_path / "userConnection"
    owned = base / "20260728_120000_ADMIN001_TrussModelBuilder"
    destination = base / "rerun"
    owned.mkdir(parents=True)
    destination.mkdir()
    source = owned / "node.csv"
    source.write_text("initial", encoding="utf-8")
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))
    real_copy = analysis.shutil.copyfileobj

    def changing_copy(source_stream, destination_stream, *args, **kwargs):
        real_copy(source_stream, destination_stream, *args, **kwargs)
        source.write_text("changed-during-copy", encoding="utf-8")

    monkeypatch.setattr(analysis.shutil, "copyfileobj", changing_copy)

    with pytest.raises(HTTPException) as exc_info:
        analysis._copy_rerun_input(
            str(source),
            str(destination),
            current_user="ADMIN001",
            db=db_session,
        )

    assert exc_info.value.status_code == 409
    assert not (destination / "node.csv").exists()
    assert list(destination.iterdir()) == []


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param(b"normal-input", id="normal"),
        pytest.param(b"L" * (2 * 1024 * 1024 + 17), id="large"),
    ],
)
def test_rerun_atomic_copy_handles_normal_and_large_inputs(
    db_session,
    tmp_path,
    monkeypatch,
    payload,
):
    base = tmp_path / "userConnection"
    owned = base / "20260728_120000_OWNER01_TrussModelBuilder"
    destination = base / "rerun"
    owned.mkdir(parents=True)
    destination.mkdir()
    source = owned / "node.csv"
    source.write_bytes(payload)
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))

    copied_path = analysis._copy_rerun_input(
        str(source),
        str(destination),
        current_user="OWNER01",
        db=db_session,
    )

    assert Path(copied_path).read_bytes() == payload
    assert [item.name for item in destination.iterdir()] == ["node.csv"]


def test_rerun_rejects_same_size_same_mtime_mid_copy_mutation(
    db_session,
    tmp_path,
    monkeypatch,
):
    chunk_size = 1024 * 1024
    base = tmp_path / "userConnection"
    owned = base / "20260728_120000_OWNER01_TrussModelBuilder"
    destination = base / "rerun"
    owned.mkdir(parents=True)
    destination.mkdir()
    source = owned / "node.csv"
    source.write_bytes(b"A" * (chunk_size * 2))
    before = source.stat()
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))
    real_copy = analysis.shutil.copyfileobj

    def mutate_after_first_chunk(source_stream, destination_stream, *args, **kwargs):
        first = source_stream.read(chunk_size)
        destination_stream.write(first)
        with source.open("r+b", buffering=0) as writer:
            writer.seek(chunk_size)
            writer.write(b"B" * chunk_size)
        os.utime(source, ns=(before.st_atime_ns, before.st_mtime_ns))
        real_copy(source_stream, destination_stream, *args, **kwargs)

    monkeypatch.setattr(analysis.shutil, "copyfileobj", mutate_after_first_chunk)

    with pytest.raises(HTTPException) as exc_info:
        analysis._copy_rerun_input(
            str(source),
            str(destination),
            current_user="OWNER01",
            db=db_session,
        )

    assert exc_info.value.status_code == 409
    assert list(destination.iterdir()) == []


@pytest.mark.skipif(os.name != "nt", reason="Windows sharing semantics only")
def test_rerun_windows_source_handle_denies_concurrent_writer(
    db_session,
    tmp_path,
    monkeypatch,
):
    base = tmp_path / "userConnection"
    owned = base / "20260728_120000_OWNER01_TrussModelBuilder"
    destination = base / "rerun"
    owned.mkdir(parents=True)
    destination.mkdir()
    source = owned / "node.csv"
    source.write_bytes(b"locked-input")
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))
    real_copy = analysis.shutil.copyfileobj
    writer_denied = {"value": False}

    def probe_writer(source_stream, destination_stream, *args, **kwargs):
        try:
            with source.open("r+b") as writer:
                writer.write(b"changed")
        except OSError:
            writer_denied["value"] = True
        real_copy(source_stream, destination_stream, *args, **kwargs)

    monkeypatch.setattr(analysis.shutil, "copyfileobj", probe_writer)

    copied_path = analysis._copy_rerun_input(
        str(source),
        str(destination),
        current_user="OWNER01",
        db=db_session,
    )

    assert writer_denied["value"] is True
    assert Path(copied_path).read_bytes() == b"locked-input"


def test_rerun_rejects_source_path_swap_during_copy(
    db_session,
    tmp_path,
    monkeypatch,
):
    base = tmp_path / "userConnection"
    owned = base / "20260728_120000_OWNER01_TrussModelBuilder"
    destination = base / "rerun"
    owned.mkdir(parents=True)
    destination.mkdir()
    source = owned / "node.csv"
    replacement = owned / "replacement.csv"
    source.write_bytes(b"original")
    replacement.write_bytes(b"replaced")
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))
    real_copy = analysis.shutil.copyfileobj

    def swap_path(source_stream, destination_stream, *args, **kwargs):
        real_copy(source_stream, destination_stream, *args, **kwargs)
        os.replace(replacement, source)

    monkeypatch.setattr(analysis.shutil, "copyfileobj", swap_path)

    with pytest.raises(HTTPException) as exc_info:
        analysis._copy_rerun_input(
            str(source),
            str(destination),
            current_user="OWNER01",
            db=db_session,
        )

    assert exc_info.value.status_code == 409
    assert not (destination / "node.csv").exists()
    assert not any(item.name.startswith(".rerun-copy-") for item in destination.iterdir())
