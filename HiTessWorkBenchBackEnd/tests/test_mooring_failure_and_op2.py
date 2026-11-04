"""Mooring 구조해석 실패 문구(위치 후보 절점·원인 조치)와 OP2 내려받기 경로."""
import os
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import database
from app.dependencies import require_auth
from app.routers import analysis as mod
from app.services.mooring_fitting_service import _solve_failure_message

F06_4698 = """\
 *** USER WARNING MESSAGE 4698 (DCMPD)
     STATISTICS FOR DECOMPOSITION OF MATRIX KLL  .
     THE FOLLOWING DEGREES OF FREEDOM HAVE FACTOR DIAGONAL RATIOS GREATER THAN
     GRID POINT ID       DEGREE OF FREEDOM         MATRIX/FACTOR DIAGONAL RATIO        MATRIX DIAGONAL
             2108               R3                      1.2E+12                             3.4E+05
             2093               T2                      5.0E+08                             1.1E+03
 *** SYSTEM FATAL MESSAGE 9050 (SEKRRS)
"""


def test_failure_message_carries_location_and_engine_guides(tmp_path):
    f06 = tmp_path / "mooring_solve.f06"
    started = time.time() - 5
    f06.write_text(F06_4698, encoding="latin-1")
    message = _solve_failure_message("Nastran FATAL\n• 구속이 부족합니다 (SPC 확인)\n기타", str(f06), started)
    lines = message.splitlines()
    assert lines[0].startswith("Mooring 구조해석 실패 위치 후보 절점: 2108, 2093")
    assert lines[1] == "• 구속이 부족합니다 (SPC 확인)"


def test_failure_message_ignores_f06_from_previous_run(tmp_path):
    f06 = tmp_path / "mooring_solve.f06"
    f06.write_text(F06_4698, encoding="latin-1")
    old = time.time() - 600
    os.utime(f06, (old, old))
    assert _solve_failure_message("", str(f06), time.time()) == "Mooring 구조해석 실패"


def _client(db_session, monkeypatch, tmp_path):
    base = tmp_path / "userConnection"
    out_dir = base / "20261103_120000_OWNER01_MooringFitting" / "out"
    out_dir.mkdir(parents=True)
    monkeypatch.setattr(mod, "_ALLOWED_DOWNLOAD_BASE", str(base))
    monkeypatch.setattr(mod, "_USER_CONNECTION_DIR", str(base))
    monkeypatch.setattr(mod, "assert_current_user_can_access_path", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(mod.router)

    def override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = override_db
    app.dependency_overrides[require_auth] = lambda: "OWNER01"
    return TestClient(app), out_dir


def test_op2_route_returns_bytes(db_session, monkeypatch, tmp_path):
    client, out_dir = _client(db_session, monkeypatch, tmp_path)
    (out_dir / "mooring_solve.op2").write_bytes(b"OP2DATA")
    res = client.get("/api/analysis/mooring-fitting/op2", params={"output_dir": str(out_dir)})
    assert res.status_code == 200
    assert res.content == b"OP2DATA"
    assert "mooring_solve.op2" in res.headers["content-disposition"]


def test_op2_route_404_before_solve(db_session, monkeypatch, tmp_path):
    client, out_dir = _client(db_session, monkeypatch, tmp_path)
    res = client.get("/api/analysis/mooring-fitting/op2", params={"output_dir": str(out_dir)})
    assert res.status_code == 404


def test_solve_summary_route(db_session, monkeypatch, tmp_path):
    client, out_dir = _client(db_session, monkeypatch, tmp_path)
    assert client.get("/api/analysis/mooring-fitting/solve-summary", params={"output_dir": str(out_dir)}).json() == {"summary": None}
    (out_dir / "mooring_solve.result.json").write_text('{"verdictCounts": {"OK": 2, "MATERIAL_CHANGE": 0, "NOT_OK": 1}, "ok": false}', encoding="utf-8")
    res = client.get("/api/analysis/mooring-fitting/solve-summary", params={"output_dir": str(out_dir)})
    assert res.status_code == 200
    assert res.json()["summary"]["verdictCounts"]["NOT_OK"] == 1


def test_clean_load_rows_drops_appendix_text_and_keeps_excluded_cases():
    """옛 엔진 MF 표 끝 부록이 행으로 읽혀 유령 케이스 '0' 이 생겼다(2026-11-03)."""
    from app.services.mooring_fitting_service import clean_load_rows
    rows = [
        {"LoadCaseID": "1001", "MF_ID": "MF-F05"},
        {"LoadCaseID": "", "MF_ID": "========"},
        {"LoadCaseID": "0", "MF_ID": "- Case2: F2 = P * v2"},
        {"LoadCaseID": "-", "CaseName": "CableLifter LC"},   # 하중 0 — 해석 제외 케이스
        {"LoadCaseID": None},
    ]
    assert [r["LoadCaseID"] for r in clean_load_rows(rows)] == ["1001", "-"]
