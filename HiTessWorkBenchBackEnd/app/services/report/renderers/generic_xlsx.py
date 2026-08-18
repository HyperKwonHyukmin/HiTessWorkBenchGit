"""ReportDoc → XLSX bytes (양식 없는 범용 서식).

디스크에 쓰지 않는다 — 저장하는 순간 사내 DRM 이 암호화한다. BytesIO 만 쓴다.
색 팔레트는 assessment_service._json_to_xlsx_bytes 와 맞춘다(PRODUCT.md Trust Blue).
"""
from __future__ import annotations

import io

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

from ..models import ReportDoc, ReportSection

_HDR_FILL = PatternFill("solid", fgColor="002554")
_HDR_FONT = Font(bold=True, color="FFFFFF", size=9)
_SEC_FILL = PatternFill("solid", fgColor="D6E0F0")
_SEC_FONT = Font(bold=True, color="002554", size=10)
_TITLE_FONT = Font(bold=True, color="002554", size=14)
_BASE_FONT = Font(size=9)
_LABEL_FONT = Font(bold=True, size=9)
_LEFT = Alignment(horizontal="left", vertical="center")
_CENTER = Alignment(horizontal="center", vertical="center")

_SHEET_NAME_LIMIT = 31
# Excel 시트 이름에 쓸 수 없는 문자.
_FORBIDDEN = ':\\/?*[]'


def _safe_sheet_name(title: str, used: set[str]) -> str:
    cleaned = "".join("_" if ch in _FORBIDDEN else ch for ch in (title or "섹션")).strip() or "섹션"
    cleaned = cleaned[:_SHEET_NAME_LIMIT]
    candidate = cleaned
    suffix = 2
    while candidate.casefold() in used:
        tail = f"_{suffix}"
        candidate = cleaned[: _SHEET_NAME_LIMIT - len(tail)] + tail
        suffix += 1
    used.add(candidate.casefold())
    return candidate


def _write_cover(ws, doc: ReportDoc) -> None:
    ws["A1"] = f"{doc.meta.display_name} 해석 계산서"
    ws["A1"].font = _TITLE_FONT
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 46

    rows = [
        ("해석 App", doc.meta.display_name),
        ("프로젝트", doc.meta.project_name),
        ("수행자 사번", doc.meta.employee_id),
        ("수행 일시", doc.meta.created_at.strftime("%Y-%m-%d %H:%M") if doc.meta.created_at else None),
        ("작업 상태", doc.meta.status),
        ("판정", doc.verdict),
        ("적용 양식", "사내 표준 양식" if doc.template_applied else "범용 서식"),
    ]
    row_ptr = 3
    for label, value in rows:
        ws.cell(row=row_ptr, column=1, value=label).font = _LABEL_FONT
        ws.cell(row=row_ptr, column=1).alignment = _LEFT
        cell = ws.cell(row=row_ptr, column=2, value=value)
        cell.font = _BASE_FONT
        cell.alignment = _LEFT
        row_ptr += 1

    if doc.notices:
        row_ptr += 1
        header = ws.cell(row=row_ptr, column=1, value="유의 사항")
        header.fill = _SEC_FILL
        header.font = _SEC_FONT
        row_ptr += 1
        for notice in doc.notices:
            ws.cell(row=row_ptr, column=1, value=notice).font = _BASE_FONT
            row_ptr += 1


def _write_section(ws, section: ReportSection) -> None:
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 24
    ws.column_dimensions["C"].width = 12

    row_ptr = 1
    title = ws.cell(row=row_ptr, column=1, value=section.title)
    title.fill = _SEC_FILL
    title.font = _SEC_FONT
    title.alignment = _LEFT
    row_ptr += 2

    for item in section.fields:
        ws.cell(row=row_ptr, column=1, value=item.label).font = _LABEL_FONT
        ws.cell(row=row_ptr, column=2, value=item.value).font = _BASE_FONT
        if item.unit:
            ws.cell(row=row_ptr, column=3, value=item.unit).font = _BASE_FONT
        if item.note:
            ws.cell(row=row_ptr, column=4, value=item.note).font = _BASE_FONT
        row_ptr += 1

    for table in section.tables:
        row_ptr += 1
        caption = ws.cell(row=row_ptr, column=1, value=table.title)
        caption.font = _SEC_FONT
        row_ptr += 1
        for col_index, column in enumerate(table.columns, start=1):
            cell = ws.cell(row=row_ptr, column=col_index, value=column)
            cell.fill = _HDR_FILL
            cell.font = _HDR_FONT
            cell.alignment = _CENTER
        row_ptr += 1
        for row in table.rows:
            for col_index, value in enumerate(row, start=1):
                ws.cell(row=row_ptr, column=col_index, value=value).font = _BASE_FONT
            row_ptr += 1
        if table.note:
            ws.cell(row=row_ptr, column=1, value=table.note).font = _BASE_FONT
            row_ptr += 1


def render_generic_xlsx(doc: ReportDoc) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)

    used: set[str] = set()
    cover = wb.create_sheet(_safe_sheet_name("표지", used))
    _write_cover(cover, doc)

    for section in doc.ordered_sections():
        ws = wb.create_sheet(_safe_sheet_name(section.title, used))
        _write_section(ws, section)

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
