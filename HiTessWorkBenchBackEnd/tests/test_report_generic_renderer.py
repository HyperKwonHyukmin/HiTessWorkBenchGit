"""GenericRenderer — ReportDoc 을 XLSX bytes 로."""
import io
import zipfile

import openpyxl

from app.services.report.models import (
    ReportDoc,
    ReportField,
    ReportMeta,
    ReportSection,
    ReportTable,
)
from app.services.report.renderers.generic_xlsx import render_generic_xlsx


def _doc(**overrides) -> ReportDoc:
    base = dict(
        meta=ReportMeta(
            program_id="column-buckling",
            display_name="Column Buckling Load Calculator",
            analysis_id=7,
            project_name="ColumnBuckling_20260818",
            employee_id="EMP001",
            created_at=None,
            status="Success",
        ),
        verdict="합격",
        sections=(
            ReportSection(
                key="overview",
                title="개요",
                fields=(ReportField(label="해석 App", value="Column Buckling Load Calculator"),),
            ),
            ReportSection(
                key="result",
                title="해석 결과",
                fields=(ReportField(label="최대 허용 하중", value=12.5, unit="ton"),),
                tables=(
                    ReportTable(
                        title="후보",
                        columns=("호칭", "중량"),
                        rows=((1, 2.0), (3, 4.0)),
                    ),
                ),
            ),
        ),
    )
    base.update(overrides)
    return ReportDoc(**base)


def _load(data: bytes):
    return openpyxl.load_workbook(io.BytesIO(data))


def test_returns_a_valid_xlsx_zip():
    data = render_generic_xlsx(_doc())
    assert zipfile.is_zipfile(io.BytesIO(data))


def test_creates_one_sheet_per_section_plus_cover():
    wb = _load(render_generic_xlsx(_doc()))
    assert wb.sheetnames[0] == "표지"
    assert "개요" in wb.sheetnames
    assert "해석 결과" in wb.sheetnames


def test_cover_shows_verdict_as_text():
    wb = _load(render_generic_xlsx(_doc()))
    cover = wb["표지"]
    values = [cell.value for row in cover.iter_rows() for cell in row]
    assert "합격" in values


def test_field_unit_lands_in_its_own_column():
    wb = _load(render_generic_xlsx(_doc()))
    ws = wb["해석 결과"]
    rows = [[c.value for c in row] for row in ws.iter_rows()]
    assert ["최대 허용 하중", 12.5, "ton"] in [row[:3] for row in rows]


def test_table_headers_and_rows_are_written():
    wb = _load(render_generic_xlsx(_doc()))
    ws = wb["해석 결과"]
    rows = [[c.value for c in row] for row in ws.iter_rows()]
    flat = [row[:2] for row in rows]
    assert ["호칭", "중량"] in flat
    assert [1, 2.0] in flat


def test_notices_are_written_on_the_cover():
    doc = _doc(notices=("표준 양식 미적용",))
    wb = _load(render_generic_xlsx(doc))
    values = [cell.value for row in wb["표지"].iter_rows() for cell in row]
    assert "표준 양식 미적용" in values


def test_duplicate_section_titles_get_unique_sheet_names():
    doc = _doc(
        sections=(
            ReportSection(key="overview", title="개요"),
            ReportSection(key="custom", title="개요"),
        )
    )
    wb = _load(render_generic_xlsx(doc))
    assert len(set(wb.sheetnames)) == len(wb.sheetnames)


def test_long_section_title_is_truncated_to_excel_sheet_limit():
    doc = _doc(sections=(ReportSection(key="overview", title="가" * 40),))
    wb = _load(render_generic_xlsx(doc))
    assert all(len(name) <= 31 for name in wb.sheetnames)
