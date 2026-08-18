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


def test_applied_form_is_stated_on_the_cover_row_not_buried_in_notices(tmp_path):
    """서식 종류는 표지의 「적용 양식」 행이 말한다.

    유의 사항 블록은 이 해석 고유의 경고만 담는다 — 문서 메타 정보를 섞으면
    '왜 판정이 비었는가' 같은 정작 중요한 줄이 묻힌다.
    """
    _, data = build_report_xlsx(_record(), user_connection_base=str(tmp_path))
    wb = openpyxl.load_workbook(io.BytesIO(data))
    values = [cell.value for row in wb["표지"].iter_rows() for cell in row]

    assert "범용 서식" in values
    assert not any(isinstance(v, str) and "범용 서식으로 생성" in v for v in values)


def test_an_adapter_returning_the_wrong_type_falls_back_like_an_exception(tmp_path, monkeypatch):
    """예외만 막으면 폴백이 반쪽이다 — 조용한 None 반환도 같게 취급해야 한다."""
    from app.services.report import service as service_module

    monkeypatch.setattr(service_module, "get_adapter", lambda key: (lambda payload, meta: None))

    filename, data = build_report_xlsx(_record(), user_connection_base=str(tmp_path))

    assert data
    wb = openpyxl.load_workbook(io.BytesIO(data))
    values = [cell.value for row in wb["표지"].iter_rows() for cell in row]
    assert "전용 어댑터가 실패해 기본 서식으로 생성되었습니다." in values


def test_failed_provenance_lookup_is_distinguished_from_having_no_artifacts(tmp_path, monkeypatch):
    """'조회 실패'와 '원래 없음'은 다른 사실이다 — 같은 문구로 쓰면 승인자가 오해한다."""
    from app.services.report import service as service_module

    def _boom(*args, **kwargs):
        raise RuntimeError("passport 실패")

    monkeypatch.setattr(service_module, "build_analysis_passport", _boom)

    _, data = build_report_xlsx(_record(), user_connection_base=str(tmp_path))

    wb = openpyxl.load_workbook(io.BytesIO(data))
    values = [cell.value for sheet in wb for row in sheet.iter_rows() for cell in row]
    assert "조회 실패" in values
    assert "기록 없음" not in values
    assert any(isinstance(v, str) and "계보를 조회하지 못했습니다" in v for v in values)


def test_capabilities_lists_registered_programs():
    caps = report_capabilities()
    assert caps["truss-assessment"]["reportable"] is True
    assert caps["truss-assessment"]["hasTemplate"] is False
    assert "displayName" in caps["truss-assessment"]
