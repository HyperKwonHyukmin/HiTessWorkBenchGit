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


# ── 판정을 읽히게 만들기 ────────────────────────────────────────────────
# 결재자가 긴 표를 훑을 때 실패 행이 눈에 걸려야 한다. 색만으로 알리지는 않는다
# (글자는 그대로 '불합격'), 색을 아예 안 쓰지도 않는다.

def _cells(ws):
    return [cell for row in ws.iter_rows() for cell in row]


def _table_doc(rows, columns=("부재", "판정")):
    return _doc(
        sections=(
            ReportSection(
                key="result",
                title="해석 결과",
                tables=(ReportTable(title="부재", columns=columns, rows=rows),),
            ),
        )
    )


def test_failing_table_row_is_filled_and_passing_row_is_not():
    ws = _load(render_generic_xlsx(_table_doc((("A", "합격"), ("B", "불합격")))))["해석 결과"]

    fail_cell = next(c for c in _cells(ws) if c.value == "불합격")
    pass_cell = next(c for c in _cells(ws) if c.value == "합격")

    assert fail_cell.fill.patternType == "solid"
    assert fail_cell.font.color.rgb.endswith("CC0000")
    assert pass_cell.fill.patternType is None


def test_verdict_cell_on_cover_is_coloured_as_well_as_written():
    ws = _load(render_generic_xlsx(_doc(verdict="불합격")))["표지"]
    cell = next(c for c in _cells(ws) if c.value == "불합격")
    assert cell.font.color.rgb.endswith("CC0000")


def test_wide_table_columns_are_sized_to_their_content():
    doc = _table_doc(
        rows=(("H-300x300", 300, 10, 94.0, "합격"),),
        columns=("호칭", "외경", "두께", "중량(kg/m)", "판정"),
    )
    ws = _load(render_generic_xlsx(doc))["해석 결과"]

    # 고정 폭이던 시절 D·E 열은 기본값(약 8.43)이라 헤더가 잘렸다.
    assert ws.column_dimensions["D"].width >= len("중량(kg/m)")
    assert ws.column_dimensions["E"].width >= 10
