"""마지막 Studio 구조해석 요약 — WorkBench 판정을 해석 결과 기준으로 바꾸는 데 쓴다(2026-11-03)."""
import json
import os
import time

from app.services import mooring_fitting_service as M


def _write(path, data):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh)


def test_no_result_means_no_summary(tmp_path):
    assert M.read_solve_summary(str(tmp_path)) is None


def test_summary_file_is_used_when_newer_than_result(tmp_path):
    _write(tmp_path / M.SOLVE_RESULT_FILE, {"verdictCounts": {"OK": 1, "MATERIAL_CHANGE": 0, "NOT_OK": 0}})
    _write(tmp_path / M.SOLVE_SUMMARY_FILE, {"verdictCounts": {"OK": 5, "MATERIAL_CHANGE": 2, "NOT_OK": 1}, "solvedAt": 1})
    s = M.read_solve_summary(str(tmp_path))
    assert s["verdictCounts"]["NOT_OK"] == 1


def test_old_result_without_summary_file_is_read_from_result(tmp_path):
    _write(tmp_path / M.SOLVE_RESULT_FILE, {
        "verdictCounts": {"OK": 3, "MATERIAL_CHANGE": 1, "NOT_OK": 0}, "globalMaxUsage": 1.2, "ok": False, "cases": [],
    })
    s = M.read_solve_summary(str(tmp_path))
    assert s["verdictCounts"]["MATERIAL_CHANGE"] == 1
    assert s["globalMaxUsage"] == 1.2


def test_stale_summary_older_than_result_is_ignored(tmp_path):
    summary = tmp_path / M.SOLVE_SUMMARY_FILE
    _write(summary, {"verdictCounts": {"OK": 0, "MATERIAL_CHANGE": 0, "NOT_OK": 9}})
    old = time.time() - 100
    os.utime(summary, (old, old))
    _write(tmp_path / M.SOLVE_RESULT_FILE, {"verdictCounts": {"OK": 7, "MATERIAL_CHANGE": 0, "NOT_OK": 0}})
    assert M.read_solve_summary(str(tmp_path))["verdictCounts"]["NOT_OK"] == 0


def test_report_hull_falls_back_to_csv_header(tmp_path):
    (tmp_path / "MooringFittingData.csv").write_text("\ufeff//9999,A000001,2026-05-20 15:02,,,\ncorrosion,1.5\n", encoding="utf-8")
    assert M.csv_header_hull(str(tmp_path)) == "9999"


def test_report_hull_empty_without_header(tmp_path):
    (tmp_path / "MooringFittingData.csv").write_text("corrosion,1.5\n", encoding="utf-8")
    assert M.csv_header_hull(str(tmp_path)) == ""
    assert M.csv_header_hull(str(tmp_path / "none")) == ""
