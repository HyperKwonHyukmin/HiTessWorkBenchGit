"""리포트 오케스트레이터 — 레코드에서 bytes 까지."""
import io

import openpyxl
import pytest

from app import models
from app.services.report.service import (
    ReportNotAvailable,
    build_report_xlsx,
    report_capabilities,
)


def _record(**kwargs) -> models.Analysis:
    defaults = {
        "id": 7,
        "employee_id": "EMP001",
        "program_name": "Column Buckling Load Calculator",
        "project_name": "p",
        "status": "Success",
        "input_info": {"length_mm": 3000},
        "result_info": {"maxWorkingLoadTon": 12.5},
    }
    defaults.update(kwargs)
    return models.Analysis(**defaults)


def test_builds_xlsx_for_an_app_without_any_adapter(tmp_path):
    filename, data = build_report_xlsx(_record(), user_connection_base=str(tmp_path))

    assert filename.endswith(".xlsx")
    wb = openpyxl.load_workbook(io.BytesIO(data))
    assert wb.sheetnames[0] == "표지"


def test_filename_carries_program_and_analysis_id(tmp_path):
    filename, _ = build_report_xlsx(_record(), user_connection_base=str(tmp_path))
    assert "column-buckling" in filename
    assert "7" in filename


def test_rejects_a_record_without_results(tmp_path):
    with pytest.raises(ReportNotAvailable):
        build_report_xlsx(_record(result_info=None), user_connection_base=str(tmp_path))


def test_rejects_a_failed_record(tmp_path):
    with pytest.raises(ReportNotAvailable):
        build_report_xlsx(_record(status="Failed"), user_connection_base=str(tmp_path))


def test_unknown_program_name_still_produces_a_report(tmp_path):
    record = _record(program_name="아직 등록 안 된 App")
    filename, data = build_report_xlsx(record, user_connection_base=str(tmp_path))
    assert data
    assert "unknown" in filename


def test_generic_path_records_a_notice_about_the_missing_form(tmp_path):
    _, data = build_report_xlsx(_record(), user_connection_base=str(tmp_path))
    wb = openpyxl.load_workbook(io.BytesIO(data))
    values = [cell.value for row in wb["표지"].iter_rows() for cell in row]
    assert "범용 서식" in values


def test_capabilities_lists_registered_programs():
    caps = report_capabilities()
    assert caps["truss-assessment"]["reportable"] is True
    assert caps["truss-assessment"]["hasTemplate"] is False
    assert "displayName" in caps["truss-assessment"]
