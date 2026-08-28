"""DoublePipe PSA My Projects persistence regression tests."""

from __future__ import annotations

import json

import pytest

from app import database, models
from app.routers import analysis as analysis_router
from app.services import doublepipe_psa_service as service
from app.services.analysis_runner import record_analysis


@pytest.fixture(autouse=True)
def _isolated_psa_state():
    with service._jobs_lock:
        service._jobs.clear()
        service._active_job_id = None
    yield
    with service._jobs_lock:
        service._jobs.clear()
        service._active_job_id = None


def test_launch_persists_running_project_before_background_execution(monkeypatch, tmp_path):
    csv_path = tmp_path / "pipe.csv"
    csv_path.write_text("id,type\n1,TUBI\n", encoding="utf-8")
    captured = []

    monkeypatch.setattr(service.os.path, "isdir", lambda *_: True)
    monkeypatch.setattr(service.os.path, "isfile", lambda *_: True)
    monkeypatch.setattr(
        service,
        "_record_psa_analysis",
        lambda job: captured.append({"jobId": job["jobId"], "status": job["status"]}),
    )

    class _DeferredThread:
        def __init__(self, *args, **kwargs):
            pass

        def start(self):
            pass

    monkeypatch.setattr(service.threading, "Thread", _DeferredThread)

    launched = service._launch_job(str(csv_path), "E100")

    assert captured == [{"jobId": launched["jobId"], "status": "running"}]


class _DeferredThread:
    def __init__(self, *args, **kwargs):
        pass

    def start(self):
        pass


def _prepare_psa_program(monkeypatch, tmp_path):
    psa_dir = tmp_path / "psa-program"
    psa_dir.mkdir()
    (psa_dir / service._PSA_EXE_NAME).write_bytes(b"exe")
    monkeypatch.setattr(service, "_PSA_DIR", str(psa_dir))
    monkeypatch.setattr(service, "_USER_CONNECTION_DIR", str(tmp_path / "jobs"))
    monkeypatch.setattr(service.threading, "Thread", _DeferredThread)


def test_tab2_from_inner_support_persists_running_snapshot(monkeypatch, tmp_path):
    _prepare_psa_program(monkeypatch, tmp_path)
    job_dir = tmp_path / "jobs" / "20260828_101500_E100_DoublePipeFuelLine"
    job_dir.mkdir(parents=True)
    result_csv = job_dir / "outer_Y-15000.csv"
    result_csv.write_text("id,type\n1,TUBI\n", encoding="utf-8")
    config = {
        "inner_pipe": {"outDia": 88.9},
        "ubolt": {"mass": 0.2485},
        "load_conditions": {"Pref": 15.3},
    }
    (job_dir / "inner_pipe_config.json").write_text(json.dumps(config), encoding="utf-8")
    captured = []
    monkeypatch.setattr(
        service,
        "record_analysis",
        lambda **kwargs: (captured.append(kwargs) or ({"id": 1}, None)),
    )

    launched = service.start_psa_job(job_dir.name, result_csv.name, "E100", ["L18"])

    assert launched["jobId"] == captured[0]["job_id"]
    assert captured[0]["status"] == "Running"
    assert captured[0]["input_info"]["input_mode"] == "inner_support"
    assert captured[0]["input_info"]["inner_support_config"] == config
    assert captured[0]["input_info"]["load_cases"] == ["L18"]


def test_tab2_direct_upload_persists_running_snapshot(monkeypatch, tmp_path):
    _prepare_psa_program(monkeypatch, tmp_path)
    captured = []
    monkeypatch.setattr(
        service,
        "record_analysis",
        lambda **kwargs: (captured.append(kwargs) or ({"id": 2}, None)),
    )

    launched = service.start_psa_job_from_upload(
        b"id,type\n1,TUBI\n",
        "direct.csv",
        "E100",
        "L18,L20",
    )

    assert launched["jobId"] == captured[0]["job_id"]
    assert captured[0]["status"] == "Running"
    assert captured[0]["input_info"]["input_mode"] == "direct_upload"
    assert captured[0]["input_info"]["input_filename"] == "direct.csv"
    assert captured[0]["input_info"]["load_cases"] == ["L18", "L20"]


def test_persisted_snapshot_keeps_inputs_and_completion_details(monkeypatch, tmp_path):
    csv_path = tmp_path / "pipe.csv"
    csv_path.write_text("id,type\n1,TUBI\n", encoding="utf-8")
    config_path = tmp_path / "inner_pipe_config.json"
    config = {
        "inner_pipe": {"outDia": 88.9, "thick": 5.49},
        "ubolt": {"support_stiffness": 1.2e7},
        "load_conditions": {"temperature": 80, "pressure": 2.5},
    }
    config_path.write_text(json.dumps(config), encoding="utf-8")
    report_path = tmp_path / service._REPORT_NAME
    report_path.write_bytes(b"xlsx")

    captured = []
    monkeypatch.setattr(
        service,
        "record_analysis",
        lambda **kwargs: (captured.append(kwargs) or ({"id": 1}, None)),
    )

    job = {
        "jobId": "persist-job",
        "projectName": "이중관 연료배관 해석_20260828_101500",
        "status": "running",
        "returncode": None,
        "csvPath": str(csv_path),
        "logs": ["solver queued"],
        "reportPath": str(report_path),
        "reportReady": False,
        "employeeId": "E100",
        "loadCases": ["L17", "L18"],
        "startedAt": "2026-08-28T10:15:00",
        "startedAtEpoch": 100.0,
        "finishedAt": None,
    }

    service._record_psa_analysis(job)
    running = captured[-1]
    assert running["status"] == "Running"
    assert running["project_name"] == job["projectName"]
    assert running["input_info"]["input_csv"] == str(csv_path)
    assert running["input_info"]["input_mode"] == "inner_support"
    assert running["input_info"]["load_case_mode"] == "selected"
    assert running["input_info"]["load_cases"] == ["L17", "L18"]
    assert running["input_info"]["inner_support_config"] == config
    assert running["result_info"]["logs"] == ["solver queued"]

    job.update({
        "status": "done",
        "returncode": 0,
        "reportReady": True,
        "finishedAt": "2026-08-28T10:25:00",
        "logs": ["solver queued", "report complete"],
    })
    service._record_psa_analysis(job)
    completed = captured[-1]
    assert completed["status"] == "Success"
    assert completed["project_name"] == running["project_name"]
    assert completed["result_info"]["report"] == str(report_path)
    assert completed["result_info"]["report_ready"] is True
    assert completed["result_info"]["returncode"] == 0
    assert completed["result_info"]["duration_sec"] == 600
    assert completed["result_info"]["logs"] == ["solver queued", "report complete"]


def test_running_record_is_non_terminal_and_updates_in_place(monkeypatch, db_session):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)

    project, error = record_analysis(
        job_id="running-job",
        project_name="이중관 연료배관 해석_20260828_101500",
        program_name="DoublePipeFuelLine",
        employee_id="E100",
        status="Running",
        input_info={"input_csv": "pipe.csv"},
        result_info={"logs": []},
        source="Workbench",
    )

    assert error is None
    row = db_session.query(models.Analysis).filter_by(job_id="running-job").one()
    assert row.id == project["id"]
    assert row.status == "Running"
    assert row.job_status == "Running"
    assert row.progress == 0
    assert row.job_message == "해석 실행 중"
    assert db_session.query(models.ActivityLog).count() == 0

    completed, error = record_analysis(
        job_id="running-job",
        project_name="이중관 연료배관 해석_20260828_101500",
        program_name="DoublePipeFuelLine",
        employee_id="E100",
        status="Success",
        input_info={"input_csv": "pipe.csv"},
        result_info={"report": "report.xlsx"},
        source="Workbench",
    )

    assert error is None
    assert completed["id"] == row.id
    assert db_session.query(models.Analysis).count() == 1
    row = db_session.query(models.Analysis).filter_by(job_id="running-job").one()
    assert row.status == "Success"
    assert row.progress == 100
    assert row.job_message == "해석 완료"
    assert db_session.query(models.ActivityLog).count() == 1


def test_legacy_history_recovers_inner_support_config_from_retained_workspace(monkeypatch, tmp_path):
    csv_path = tmp_path / "legacy_pipe.csv"
    csv_path.write_text("id,type\n1,TUBI\n", encoding="utf-8")
    config = {
        "inner_pipe": {"outDia": 114.3, "thick": 3.05},
        "ubolt": {"mass": 0.2485},
        "load_conditions": {"Pref": 15.3},
    }
    config_path = tmp_path / "inner_pipe_config.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    monkeypatch.setattr(analysis_router, "_ALLOWED_DOWNLOAD_BASE", str(tmp_path))

    record = models.Analysis(
        job_id="legacy-doublepipe",
        project_name="legacy",
        program_name="DoublePipeFuelLine",
        employee_id="E100",
        status="Success",
        input_info={"input_csv": str(csv_path), "load_cases": "ALL(29)"},
        result_info={"work_dir": str(tmp_path)},
    )

    serialized = analysis_router._serialize_analysis(record)

    assert serialized["input_info"]["schema_version"] == 1
    assert serialized["input_info"]["input_mode"] == "inner_support"
    assert serialized["input_info"]["load_case_mode"] == "all"
    assert serialized["input_info"]["config_file"] == str(config_path)
    assert serialized["input_info"]["inner_support_config"] == config
