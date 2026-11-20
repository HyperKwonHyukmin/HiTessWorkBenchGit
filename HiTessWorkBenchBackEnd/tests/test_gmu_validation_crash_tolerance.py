"""GMU BDF 검증 — bridge 가 결과를 다 쓰고 종료 순간 DRM 에 끊겨도 검증을 계속한다(2026-11-12 실제 사례).

20261112_101950_A476854_GroupModuleUnit: 모델 JSON(1.3 MB, 노드 2,717)을 10:19:51 에 끝까지 쓴 1초 뒤
python.exe 가 HIDRMH.DLL 에서 0xC0000005 → 화면에 'BDF 검증 실패 — 프로그램 비정상 종료'.
구조 해석 쪽(test_exit_codes_crash_tolerance.py)과 같은 판정(exit_codes.outputs_complete_after_crash)을 쓴다.
"""
import json
import os
import subprocess

import pytest

from app.services import groupmoduleunit_service as svc

CRASH = 3221225477  # 0xC0000005

MODEL = {"meta": {}, "nodes": [], "elements": [], "rigids": [], "properties": [], "materials": [], "pointMasses": []}


def _bdf(path, ended=True):
    with open(path, "w", encoding="latin-1") as f:
        f.write("BEGIN BULK\nGRID           1               0.0     0.0     0.0\n")
        if ended:
            f.write("ENDDATA\n")


@pytest.fixture
def job(tmp_path, monkeypatch):
    """작업 함수가 부르는 진행 표시·DB 기록을 가짜로 바꾸고 완료 호출을 모은다."""
    bridge = tmp_path / "nastran_bridge.py"
    bridge.write_text("", encoding="utf-8")
    monkeypatch.setattr(svc, "get_nastran_bridge_script_path", lambda: str(bridge))
    monkeypatch.setattr(svc, "mark_running", lambda *a, **k: None)
    monkeypatch.setattr(svc, "update_progress", lambda *a, **k: None)
    monkeypatch.setattr(svc, "is_cancel_requested", lambda *a, **k: False)
    monkeypatch.setattr(svc, "record_analysis", lambda **k: ({"result_info": k.get("result_info")}, None))
    done = {}

    def mark_complete(job_id, status, log, project, **kw):
        done.update(status=status, log=log, project=project, **kw)
    monkeypatch.setattr(svc, "mark_complete", mark_complete)
    work = tmp_path / "work"
    work.mkdir()
    _bdf(work / "m.bdf")
    return work, done


def _parse_run(json_text, code):
    def run(args, cwd=None, **_kw):
        if json_text is not None:
            with open(os.path.join(cwd, "m.json"), "w", encoding="utf-8") as f:
                f.write(json_text)
        return subprocess.CompletedProcess(args, code, b"Wrote m.json\n", b"")
    return run


def _run_task(work):
    svc.task_execute_groupmoduleunit("job1", str(work / "m.bdf"), str(work), "A000000", "ts", "test", False)


def test_parse_crash_after_complete_json_continues(job, monkeypatch):
    work, done = job
    monkeypatch.setattr(svc.subprocess, "run", _parse_run(json.dumps(MODEL), CRASH))
    _run_task(work)
    assert done["status"] == "Success"
    assert "계속 진행합니다" in done["log"] and "0xC0000005" in done["log"]
    assert os.path.exists(work / "m_validation_step1.json")


def test_parse_crash_with_half_json_still_fails(job, monkeypatch):
    work, done = job
    monkeypatch.setattr(svc.subprocess, "run", _parse_run('{"nodes": [', CRASH))
    _run_task(work)
    assert done["status"] == "Failed"
    assert "실행 환경 문제" in done["failure_message"]


def test_parse_ordinary_failure_still_fails(job, monkeypatch):
    work, done = job
    monkeypatch.setattr(svc.subprocess, "run", _parse_run(json.dumps(MODEL), 1))
    _run_task(work)
    assert done["status"] == "Failed"
    assert done["failure_message"] == "BDF 검증 실패"


def _prepare_env(work, monkeypatch, ended):
    def run(args, cwd=None, **_kw):
        with open(os.path.join(cwd, "m_validation.json"), "w", encoding="utf-8") as f:
            json.dump({"ok": True}, f)
        _bdf(os.path.join(cwd, "m_validation.bdf"), ended=ended)
        return subprocess.CompletedProcess(args, CRASH, b"", b"")
    monkeypatch.setattr(svc.subprocess, "run", run)
    monkeypatch.setattr(svc, "_rigid_dependent_nodes", lambda *_a: set())
    monkeypatch.setattr(svc, "_rewrite_validation_spc", lambda *_a: (0, [], None))
    monkeypatch.setattr(svc, "_ensure_validation_stabilization_params", lambda *_a: [])
    monkeypatch.setattr(svc, "_parse_f06_fatals", lambda *_a: None)
    monkeypatch.setattr(svc, "run_subprocess_killtree",
                        lambda args, **_k: subprocess.CompletedProcess(args, 0, b"", b""))


def test_prepare_crash_after_complete_continues(job, monkeypatch):
    work, _done = job
    _prepare_env(work, monkeypatch, ended=True)
    ok, log, path = svc._run_nastran_validate("m.bdf", str(work), "nastran")
    assert ok is True and path
    assert "계속 진행합니다" in log


def test_prepare_crash_with_half_bdf_fails(job, monkeypatch):
    work, _done = job
    _prepare_env(work, monkeypatch, ended=False)
    ok, _log, path = svc._run_nastran_validate("m.bdf", str(work), "nastran")
    assert ok is False and path is None
