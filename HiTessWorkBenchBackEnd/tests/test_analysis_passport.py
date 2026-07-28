"""Analysis Passport endpoint safety and integrity tests."""
import os
from pathlib import Path

import pytest

from app import models
from app.dependencies import require_auth
from app.main import app
from app.routers import analysis
from app.services import analysis_passport


def _record(db_session, *, owner: str, input_info: dict, result_info: dict | None = None):
    record = models.Analysis(
        employee_id=owner,
        project_name="passport-project",
        program_name="BDF Scanner",
        status="Success",
        job_status="Completed",
        input_info=input_info,
        result_info=result_info or {},
        source="Workbench",
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def test_passport_hashes_owned_regular_files_without_exposing_paths(
    admin_client,
    db_session,
    tmp_path,
    monkeypatch,
):
    base = tmp_path / "userConnection"
    work = base / "20260728_120000_ADMIN001_BdfScanner"
    work.mkdir(parents=True)
    input_file = work / "model.bdf"
    result_file = work / "result.json"
    input_file.write_bytes(b"GRID,1\n")
    result_file.write_text('{"ok": true}', encoding="utf-8")
    record = _record(
        db_session,
        owner="ADMIN001",
        input_info={"bdf_model": str(input_file), "use_nastran": False},
        result_info={"nested": {"result_json": str(result_file)}},
    )
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))

    response = admin_client.get(f"/api/analysis/{record.id}/passport")

    assert response.status_code == 200
    payload = response.json()
    assert payload["integrity"]["status"] == "verified"
    assert payload["integrity"]["verifiedCount"] == 2
    assert {item["name"] for item in payload["artifacts"]} == {"model.bdf", "result.json"}
    assert all(len(item["sha256"]) == 64 for item in payload["artifacts"])
    serialized = response.text
    assert str(base) not in serialized
    assert str(input_file) not in serialized
    assert str(result_file) not in serialized


def test_passport_deduplicates_same_file_and_reports_unsafe_candidates(
    admin_client,
    db_session,
    tmp_path,
    monkeypatch,
):
    base = tmp_path / "userConnection"
    work = base / "20260728_120000_ADMIN001_BdfScanner"
    work.mkdir(parents=True)
    input_file = work / "model.bdf"
    input_file.write_bytes(b"GRID")
    outside = tmp_path / "outside.txt"
    outside.write_text("secret", encoding="utf-8")
    record = _record(
        db_session,
        owner="ADMIN001",
        input_info={"one": str(input_file), "duplicate": str(input_file)},
        result_info={"outside": str(outside)},
    )
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))

    payload = admin_client.get(f"/api/analysis/{record.id}/passport").json()

    assert payload["integrity"]["artifactCount"] == 2
    assert {item["status"] for item in payload["artifacts"]} == {
        "verified",
        "outside_workspace",
    }
    assert str(outside) not in str(payload)


def test_passport_enforces_file_and_total_hash_limits(
    admin_client,
    db_session,
    tmp_path,
    monkeypatch,
):
    base = tmp_path / "userConnection"
    work = base / "20260728_120000_ADMIN001_BdfScanner"
    work.mkdir(parents=True)
    first = work / "first.bin"
    second = work / "second.bin"
    first.write_bytes(b"12345")
    second.write_bytes(b"67890")
    record = _record(
        db_session,
        owner="ADMIN001",
        input_info={"first": str(first), "second": str(second)},
    )
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))
    monkeypatch.setenv("WORKBENCH_PASSPORT_MAX_FILE_BYTES", "5")
    monkeypatch.setenv("WORKBENCH_PASSPORT_MAX_TOTAL_BYTES", "7")

    payload = admin_client.get(f"/api/analysis/{record.id}/passport").json()

    assert [item["status"] for item in payload["artifacts"]] == [
        "verified",
        "total_limit_exceeded",
    ]
    assert payload["integrity"]["hashedBytes"] == 5


def test_passport_bounds_json_candidate_count_and_depth(
    admin_client,
    db_session,
    tmp_path,
    monkeypatch,
):
    base = tmp_path / "userConnection"
    base.mkdir()
    many_values = {f"value_{index}": f"metadata-{index}" for index in range(257)}
    many_values["too_deep"] = {
        "a": {"b": {"c": {"d": {"path": str(tmp_path / "outside.txt")}}}}
    }
    record = _record(
        db_session,
        owner="ADMIN001",
        input_info=many_values,
    )
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))

    payload = admin_client.get(f"/api/analysis/{record.id}/passport").json()

    assert payload["integrity"]["candidateLimitHit"] is True
    assert payload["integrity"]["status"] == "partial"
    assert payload["artifacts"] == []


def test_passport_rejects_record_artifact_owned_by_another_folder(
    admin_client,
    db_session,
    tmp_path,
    monkeypatch,
):
    base = tmp_path / "userConnection"
    work = base / "20260728_120000_OTHER01_BdfScanner"
    work.mkdir(parents=True)
    artifact = work / "model.bdf"
    artifact.write_bytes(b"GRID")
    record = _record(
        db_session,
        owner="ADMIN001",
        input_info={"bdf_model": str(artifact)},
    )
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))

    payload = admin_client.get(f"/api/analysis/{record.id}/passport").json()

    assert payload["artifacts"][0]["status"] == "owner_mismatch"
    assert payload["artifacts"][0]["sha256"] is None


def test_passport_record_is_owner_or_admin_only(
    admin_client,
    db_session,
):
    record = _record(
        db_session,
        owner="ADMIN001",
        input_info={},
    )
    db_session.add(models.User(
        employee_id="OTHER01",
        name="다른 사용자",
        company="HHI",
        is_active=True,
        is_admin=False,
    ))
    db_session.commit()
    app.dependency_overrides[require_auth] = lambda: "OTHER01"

    response = admin_client.get(f"/api/analysis/{record.id}/passport")

    assert response.status_code == 403


def test_passport_marks_file_changed_during_hash(
    admin_client,
    db_session,
    tmp_path,
    monkeypatch,
):
    base = tmp_path / "userConnection"
    work = base / "20260728_120000_ADMIN001_BdfScanner"
    work.mkdir(parents=True)
    artifact = work / "model.bdf"
    artifact.write_bytes(b"GRID")
    record = _record(
        db_session,
        owner="ADMIN001",
        input_info={"bdf_model": str(artifact)},
    )
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))
    real_stat = analysis_passport.os.stat
    calls = {"artifact": 0}

    def changing_stat(path, *args, **kwargs):
        result = real_stat(path, *args, **kwargs)
        if os.path.normcase(str(path)) == os.path.normcase(str(artifact)):
            calls["artifact"] += 1
            if calls["artifact"] >= 2:
                values = list(result)
                values[8] = result.st_mtime + 1
                return os.stat_result(values)
        return result

    monkeypatch.setattr(analysis_passport.os, "stat", changing_stat)

    payload = admin_client.get(f"/api/analysis/{record.id}/passport").json()

    assert payload["artifacts"][0]["status"] == "changed_during_read"
    assert payload["artifacts"][0]["sha256"] is None


def test_passport_does_not_follow_directory_or_outside_symlink(
    admin_client,
    db_session,
    tmp_path,
    monkeypatch,
):
    base = tmp_path / "userConnection"
    work = base / "20260728_120000_ADMIN001_BdfScanner"
    directory = work / "results"
    directory.mkdir(parents=True)
    outside = tmp_path / "outside.txt"
    outside.write_text("secret", encoding="utf-8")
    link = work / "linked.txt"
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip("Symlink creation is not permitted on this Windows host")
    record = _record(
        db_session,
        owner="ADMIN001",
        input_info={"directory": str(directory), "link": str(link)},
    )
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))

    payload = admin_client.get(f"/api/analysis/{record.id}/passport").json()

    assert {item["status"] for item in payload["artifacts"]} == {
        "not_regular_file",
        "outside_workspace",
    }
    assert all(item["sha256"] is None for item in payload["artifacts"])


def test_passport_stops_at_json_node_budget_without_string_candidates(
    admin_client,
    db_session,
    tmp_path,
    monkeypatch,
):
    base = tmp_path / "userConnection"
    base.mkdir()
    record = _record(
        db_session,
        owner="ADMIN001",
        input_info={"large": [[index, {"value": index}] for index in range(1000)]},
    )
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))
    monkeypatch.setenv("WORKBENCH_PASSPORT_MAX_JSON_NODES", "12")

    payload = admin_client.get(f"/api/analysis/{record.id}/passport").json()

    assert payload["integrity"]["nodeLimitHit"] is True
    assert payload["integrity"]["candidateLimitHit"] is False
    assert payload["integrity"]["status"] == "partial"
    assert payload["artifacts"] == []


def test_passport_never_reads_past_initial_size_when_file_grows(
    admin_client,
    db_session,
    tmp_path,
    monkeypatch,
):
    base = tmp_path / "userConnection"
    work = base / "20260728_120000_ADMIN001_BdfScanner"
    work.mkdir(parents=True)
    artifact = work / "growing.bdf"
    artifact.write_bytes(b"GRID")
    record = _record(
        db_session,
        owner="ADMIN001",
        input_info={"bdf_model": str(artifact)},
    )
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))
    monkeypatch.setenv("WORKBENCH_PASSPORT_MAX_FILE_BYTES", "8")
    monkeypatch.setenv("WORKBENCH_PASSPORT_MAX_TOTAL_BYTES", "8")
    real_read = analysis_passport.os.read
    requested = []

    def growing_read(fd, size):
        requested.append(size)
        chunk = real_read(fd, size)
        if len(requested) == 1:
            with artifact.open("ab") as stream:
                stream.write(b"-GROWN")
        return chunk

    monkeypatch.setattr(analysis_passport.os, "read", growing_read)

    payload = admin_client.get(f"/api/analysis/{record.id}/passport").json()

    assert sum(requested) == 4
    assert payload["integrity"]["hashedBytes"] == 4
    assert payload["artifacts"][0]["status"] == "changed_during_read"
    assert payload["artifacts"][0]["sha256"] is None
