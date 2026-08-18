"""ReportDoc 중간표현의 불변 계약."""
import dataclasses

import pytest

from app.services.report.models import (
    STANDARD_SECTION_ORDER,
    ReportDoc,
    ReportField,
    ReportMeta,
    ReportSection,
    ReportTable,
)


def _meta() -> ReportMeta:
    return ReportMeta(
        program_id="column-buckling",
        display_name="Column Buckling Load Calculator",
        analysis_id=7,
        project_name="ColumnBuckling_20260818",
        employee_id="EMP001",
        created_at=None,
        status="Success",
    )


def test_report_doc_is_frozen():
    doc = ReportDoc(meta=_meta(), verdict="합격", sections=())
    with pytest.raises(dataclasses.FrozenInstanceError):
        doc.verdict = "불합격"


def test_section_defaults_are_empty_tuples():
    section = ReportSection(key="input", title="입력 조건")
    assert section.fields == ()
    assert section.tables == ()


def test_standard_section_order_is_the_agreed_five():
    assert STANDARD_SECTION_ORDER == (
        "overview",
        "input",
        "result",
        "verdict",
        "provenance",
    )


def test_sort_sections_puts_standard_keys_first_and_keeps_unknown_at_end():
    doc = ReportDoc(
        meta=_meta(),
        verdict=None,
        sections=(
            ReportSection(key="custom", title="비고"),
            ReportSection(key="result", title="해석 결과"),
            ReportSection(key="overview", title="개요"),
        ),
    )
    assert [s.key for s in doc.ordered_sections()] == ["overview", "result", "custom"]


def test_field_and_table_carry_units_and_notes():
    field = ReportField(label="최대 허용 하중", value=12.5, unit="ton", note="AISC")
    table = ReportTable(
        title="후보",
        columns=("호칭", "두께"),
        rows=((1, 2), (3, 4)),
        note="상위 2건",
    )
    assert field.unit == "ton"
    assert table.rows[1] == (3, 4)
