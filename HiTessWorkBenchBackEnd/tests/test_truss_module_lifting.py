"""Truss 소모듈 권상 연결 (2026-11-17, docs/plans/2026-11-17-truss-module-lifting-plan.md 1단계 7번).

- 새 입력 검증 라우트가 TrussModuleLifting 기록을 만든다(GMU 검증 작업 재사용).
- 권상 부모 목록에 TrussModuleLifting 이 들어가 Studio 업로드가 막히지 않는다. GMU, Side Passage 는 예전과 같다.
- 구조 해석 뒤 소모듈 평가 exe 결과를 결과 JSON 에 trussAssessment 로 싣는다(exe 없음, 실패도 경고로).
"""
import json
import os

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import database, models
from app.dependencies import require_auth
from app.routers import analysis
from app.services import app_settings, truss_module_assessment, usage_rollup
from app.services.lifting_programs import LIFTING_PARENT_PROGRAMS, TRUSS_LIFTING_PROGRAM


def _client(db_session, employee_id: str) -> TestClient:
    app = FastAPI()
    app.include_router(analysis.router)

    def override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = override_db
    app.dependency_overrides[require_auth] = lambda: employee_id
    return TestClient(app)


def _workspace(tmp_path, monkeypatch, owner="OWNER01"):
    base = tmp_path / "userConnection"
    work_dir = base / f"20261117_120000_{owner}_TrussModuleLifting"
    work_dir.mkdir(parents=True)
    bdf_path = work_dir / "truss.bdf"
    bdf_path.write_text("CEND\nBEGIN BULK\nENDDATA\n", encoding="utf-8")
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))
    monkeypatch.setattr(analysis, "_ALLOWED_DOWNLOAD_BASE", str(base))
    return base, work_dir, bdf_path


def test_lifting_parent_programs_keep_existing_and_add_truss():
    assert LIFTING_PARENT_PROGRAMS[:2] == ("GroupModuleUnit", "SidePassage")
    assert TRUSS_LIFTING_PROGRAM in LIFTING_PARENT_PROGRAMS
    assert TRUSS_LIFTING_PROGRAM in usage_rollup.ROLLUP_PARENTS


def test_trusslifting_request_records_truss_program(db_session, tmp_path, monkeypatch):
    base, _work_dir, _bdf = _workspace(tmp_path, monkeypatch)
    calls = {}

    def fake_submit(task, *args, **kwargs):
        calls["task"] = task
        calls["args"] = args
        return "job-truss"

    monkeypatch.setattr(analysis, "submit_analysis_job", fake_submit)
    monkeypatch.setattr(analysis, "make_work_dir", lambda emp, prog: (str(base / f"x_{emp}_{prog}"), "20261117_120000"))
    (base / "x_OWNER01_TrussModuleLifting").mkdir()

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/trusslifting/request",
        data={"employee_id": "OWNER01"},
        files={"bdf_file": ("truss.bdf", b"CEND\nBEGIN BULK\nENDDATA\n", "application/octet-stream")},
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"job_id": "job-truss"}
    assert calls["task"] is analysis.task_execute_groupmoduleunit
    # (bdf_path, work_dir, employee_id, timestamp, source, use_nastran, program_name)
    assert calls["args"][5] is False
    assert calls["args"][6] == TRUSS_LIFTING_PROGRAM


def test_trusslifting_sample_uses_fixed_174k_bdf(db_session, tmp_path, monkeypatch):
    """샘플은 SampleFile/TrussLifting/174k_2tk_rev5_DesignNo.6.bdf 하나로 고정(2026-11-18 사용자 지시)."""
    base = tmp_path / "userConnection"
    base.mkdir()
    sample_dir = tmp_path / "SampleFile" / "TrussLifting"
    sample_dir.mkdir(parents=True)
    (sample_dir / "aaa_other.bdf").write_text("CEND\n", encoding="utf-8")       # 이름순 앞 파일로 넘어가면 안 된다
    (sample_dir / analysis.TRUSS_LIFTING_SAMPLE_BDF).write_text("CEND\nBEGIN BULK\nENDDATA\n", encoding="utf-8")
    monkeypatch.setattr(analysis, "_BACKEND_DIR", str(tmp_path))
    work = base / "x_OWNER01_TrussModuleLifting"
    work.mkdir()
    monkeypatch.setattr(analysis, "make_work_dir", lambda emp, prog: (str(work), "20261118_120000"))
    calls = {}

    def fake_submit(task, *args, **kwargs):
        calls["task"], calls["args"] = task, args
        return "job-sample"

    monkeypatch.setattr(analysis, "submit_analysis_job", fake_submit)
    client = _client(db_session, "OWNER01")
    assert client.get("/api/analysis/trusslifting/sample-status").status_code == 200
    response = client.post("/api/analysis/trusslifting/run-sample")
    assert response.status_code == 200, response.text
    assert response.json()["job_id"] == "job-sample"
    assert calls["task"] is analysis.task_execute_groupmoduleunit
    assert calls["args"][0].endswith(analysis.TRUSS_LIFTING_SAMPLE_BDF)
    assert calls["args"][4] == analysis.SAMPLE_SOURCE_TAG
    assert calls["args"][6] == TRUSS_LIFTING_PROGRAM
    assert (work / analysis.TRUSS_LIFTING_SAMPLE_BDF).exists()


def test_trusslifting_sample_missing_file_is_404(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(analysis, "_BACKEND_DIR", str(tmp_path))
    analysis._SAMPLE_RUN_TRACKER.clear()
    response = _client(db_session, "OWNER02").post("/api/analysis/trusslifting/run-sample")
    assert response.status_code == 404
    assert analysis.TRUSS_LIFTING_SAMPLE_BDF in response.json()["detail"]


def test_studio_upload_accepts_truss_parent(db_session, tmp_path, monkeypatch):
    _base, work_dir, bdf_path = _workspace(tmp_path, monkeypatch)
    parent = models.Analysis(
        employee_id="OWNER01", program_name=TRUSS_LIFTING_PROGRAM, project_name="truss",
        status="Success", input_info={"bdf_model": str(bdf_path)}, result_info={},
    )
    db_session.add(parent)
    db_session.commit()
    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-stability/upload",
        data={"employee_id": "OWNER01", "parent_analysis_id": str(parent.id), "artifact_kind": "edited"},
        files={"file": ("truss_edited.json", b'{"nodes": []}', "application/json")},
    )
    assert response.status_code == 200, response.text
    assert (work_dir / "truss_edited.json").exists()


def test_studio_upload_still_rejects_other_programs(db_session, tmp_path, monkeypatch):
    _base, _work_dir, bdf_path = _workspace(tmp_path, monkeypatch)
    parent = models.Analysis(
        employee_id="OWNER01", program_name="TrussAssessment", project_name="t",
        status="Success", input_info={"bdf_model": str(bdf_path)}, result_info={},
    )
    db_session.add(parent)
    db_session.commit()
    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-stability/upload",
        data={"employee_id": "OWNER01", "parent_analysis_id": str(parent.id), "artifact_kind": "edited"},
        files={"file": ("truss_edited.json", b"{}", "application/json")},
    )
    assert response.status_code == 400


def test_truss_entry_route_is_gated_separately():
    prefixes = dict(app_settings.GUARDED_ROUTES)
    assert prefixes["/api/analysis/trusslifting/"] == "Truss Module Lifting"


def test_assessment_missing_exe_is_reported_not_raised(tmp_path, monkeypatch):
    monkeypatch.setattr(truss_module_assessment, "resolve_exe", lambda: None)
    r = truss_module_assessment.run_truss_module_assessment(str(tmp_path / "a.bdf"), str(tmp_path / "a.f06"))
    assert r["ok"] is False and "찾을 수 없습니다" in r["error"]


def _fake_run_writing(summary_text, returncode):
    """평가 exe 대역 — <stem>_module.json 을 쓰고 지정한 종료 코드로 끝난다."""
    def fake(args, cwd, **_kw):
        stem = os.path.splitext(os.path.basename(args[1]))[0]
        with open(os.path.join(cwd, stem + "_module.json"), "w", encoding="utf-8") as fh:
            fh.write(summary_text)

        class Done:
            pass
        Done.returncode = returncode
        Done.stdout = b""
        return Done()
    return fake


def test_assessment_broken_summary_is_warning_not_raised(tmp_path, monkeypatch):
    """깨진 요약 JSON 이 예외로 번지면 Nastran 까지 끝난 구조 해석 job 전체가 Failed 가 된다(2026-11-20 리뷰)."""
    bdf = tmp_path / "m_lifting.bdf"; bdf.write_text("BEGIN BULK\nENDDATA\n")
    f06 = tmp_path / "m_lifting.f06"; f06.write_text("F06")
    monkeypatch.setattr(truss_module_assessment, "resolve_exe", lambda: "fake.exe")
    monkeypatch.setattr(truss_module_assessment.subprocess, "run", _fake_run_writing("{ broken", 0))
    r = truss_module_assessment.run_truss_module_assessment(str(bdf), str(f06))
    assert r["ok"] is False and "평가 실패" in r["error"]


def test_assessment_tolerates_drm_crash_after_complete_summary(tmp_path, monkeypatch):
    """요약을 끝까지 쓴 뒤 종료 순간 0xC0000005 로 끝나면 결과를 그대로 쓴다(GMU 검증과 같은 규칙)."""
    bdf = tmp_path / "m_lifting.bdf"; bdf.write_text("BEGIN BULK\nENDDATA\n")
    f06 = tmp_path / "m_lifting.f06"; f06.write_text("F06")
    monkeypatch.setattr(truss_module_assessment, "resolve_exe", lambda: "fake.exe")
    monkeypatch.setattr(truss_module_assessment.subprocess, "run", _fake_run_writing('{"verdict": "OK"}', 3221225477))
    r = truss_module_assessment.run_truss_module_assessment(str(bdf), str(f06))
    assert r["ok"] is True and r["summary"] == {"verdict": "OK"}


def test_assessment_reads_outputs_and_attaches_to_result(tmp_path, monkeypatch):
    bdf = tmp_path / "m_lifting.bdf"; bdf.write_text("BEGIN BULK\nENDDATA\n")
    f06 = tmp_path / "m_lifting.f06"; f06.write_text("F06")
    monkeypatch.setattr(truss_module_assessment, "resolve_exe", lambda: "fake.exe")
    seen = {}

    class Done:
        returncode = 0
        stdout = b""
        stderr = b""

    def fake_run(args, cwd, **kwargs):
        seen["args"] = args
        # exe 가 쓰는 파일을 흉내 낸다
        (tmp_path / "truss_assessment" / "m_lifting_module.json").write_text(json.dumps({"loadCases": [{"maxUc": 0.8, "failCount": 0}]}), encoding="utf-8")
        (tmp_path / "truss_assessment" / "m_lifting.json").write_text(json.dumps({"loadCases": [{"elementAssessment": [{"element": 1, "assessment": 0.8, "result": "OK"}]}]}), encoding="utf-8")
        return Done()

    monkeypatch.setattr(truss_module_assessment.subprocess, "run", fake_run)
    r = truss_module_assessment.run_truss_module_assessment(str(bdf), str(f06))
    assert r["ok"] is True
    assert seen["args"][1].endswith("truss_assessment\\m_lifting.bdf") or seen["args"][1].endswith("truss_assessment/m_lifting.bdf")
    assert seen["args"][2:] == ["--f06", seen["args"][2 + 1], "--case", "lifting"]
    assert r["summary"]["loadCases"][0]["maxUc"] == 0.8
    assert r["elements"][0]["element"] == 1

    result_json = tmp_path / "m_lifting_nastranResult.json"
    payload = {"summary": {}, "warnings": []}
    block = truss_module_assessment.attach_to_result(str(result_json), payload, r)
    saved = json.loads(result_json.read_text(encoding="utf-8"))
    assert saved["trussAssessment"]["ok"] is True
    assert saved["trussAssessment"]["elements"][0]["assessment"] == 0.8
    assert block["summary"]["loadCases"][0]["failCount"] == 0
