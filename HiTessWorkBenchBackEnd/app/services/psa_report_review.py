"""PSA 평가보고서 — 채운 자리 기록(Trace)과 '검토용' 표시.

보고서 조립은 값을 넣을 때마다 Trace 에 한 줄을 남긴다(어디에, 무엇을, 어디서 가져왔나).
검토용(review=True)으로 만들면 그 자리를 색으로 칠하고, 표 아래에 출처를 적고, 맨 끝에 점검표를 붙인다.
일반 보고서에는 색과 점검표가 들어가지 않는다(선주 제출용).

구분(kind)
  input   = 화면 입력값          (연한 파랑)
  calc    = 원본 파일에서 계산   (연한 초록)
  figure  = 올린 그림 파일       (연한 보라)
  missing = 자료가 없어 비운 자리 (주황) — 일반 보고서에도 'Not provided' 글자로 남는다
"""
from __future__ import annotations

from dataclasses import dataclass, field

from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt

from . import psa_report_docops as ops

KIND_FILL = {"input": "DCE9F8", "calc": "DDF2DD", "figure": "E9E1F5", "missing": "FBD9B5"}
KIND_LABEL = {"input": "입력값", "calc": "원본 파일 계산", "figure": "올린 그림", "missing": "자료 없음"}
KIND_MEANING = {
    "input": "화면에 입력한 값으로 채운 자리",
    "calc": "고른 CAESAR 엑셀에서 계산해 채운 자리",
    "figure": "올린 그림 파일을 넣은 자리",
    "missing": "자료가 없어 비우거나 Not provided 로 적은 자리",
}

# 프로그램이 손대지 않는 자리 — 호선이 바뀌어도 서식 글자 그대로 나간다. 검토용 점검표에 늘 적는다.
TEMPLATE_FIXED = [
    ("표지 'Number of Pages', 'Total Number of Copies'", "빈 칸(직접 적음)"),
    ("표지 Keyword(s), 저작권 문구, 머리글 로고", "사내 공통"),
    ("1장 문장, 2.1 Design codes, 2.3 Coordinate system", "사내 공통 문장"),
    ("Table 2.1 Unit system, Table 2.2 Material(A312 TP316/316L)", "재질이 다르면 서식을 바꿔야 함"),
    ("2.7 Displacement 설명 문장, 2.10 Boundary condition", "사내 공통 문장"),
    ("Table 2.8 Friction Factor, Table 2.9 Insulation 두께", "프로젝트 기준이 다르면 서식을 바꿔야 함"),
    ("3장 Fatigue, 4장 허용응력 115.14 / 153.13 MPa", "재질, 기준이 다르면 서식을 바꿔야 함"),
    ("Table 5.1~5.4 Load cases, 기호 설명 표", "하중 조합이 다르면 서식을 바꿔야 함"),
    ("그림: 좌표계, Manifold 하중 방향, Stress range factor", "사내 공통 그림"),
    ("부록 A Reference(도면 번호 줄 제외), 부록 B 제목", "ISO, Input Echo PDF 는 보고서에 넣지 않음(따로 첨부)"),
]


@dataclass
class Item:
    where: str
    value: str
    kind: str
    source: str = ""


@dataclass
class Trace:
    review: bool = False
    items: list[Item] = field(default_factory=list)

    def add(self, where: str, value, kind: str, source: str = "") -> None:
        text = str(value if value is not None else "")
        self.items.append(Item(where, text if len(text) <= 90 else text[:87] + "…", kind, source))

    # ── 색 표시(검토용일 때만) ──
    def cells(self, cells, kind: str) -> None:
        if not self.review:
            return
        for c in cells:
            ops.shade_cell(c, KIND_FILL[kind])

    def rows(self, rows, kind: str) -> None:
        if not self.review:
            return
        for cells in rows:  # rebuild_rows 가 돌려준 줄마다의 칸 목록
            self.cells(cells, kind)

    def paragraph(self, p_el, kind: str) -> None:
        if self.review:
            ops.shade_runs(p_el, KIND_FILL[kind])

    def missing(self) -> list[Item]:
        return [i for i in self.items if i.kind == "missing"]


def source_note(text: str):
    """표나 그림 아래에 붙이는 작은 출처 줄(검토용)."""
    p = OxmlElement("w:p")
    ppr = OxmlElement("w:pPr")
    sp = OxmlElement("w:spacing")
    sp.set(qn("w:before"), "0")
    sp.set(qn("w:after"), "60")
    ppr.append(sp)
    jc = OxmlElement("w:jc")
    jc.set(qn("w:val"), "left")
    ppr.append(jc)
    p.append(ppr)
    p.append(ops.make_run("〔검토용〕 " + text, italic=True, color="5B6B7F", size_pt=8))
    return p


# ── 맨 끝 점검표 ─────────────────────────────────────────────
def _border(tbl) -> None:
    tblpr = tbl._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "4")
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), "9AA5B1")
        borders.append(el)
    old = tblpr.find(qn("w:tblBorders"))
    if old is not None:
        tblpr.remove(old)
    # tblPr 자식 순서: … tblW, jc, tblCellSpacing, tblInd, tblBorders, shd, tblLayout, tblCellMar, tblLook
    for name in ("w:shd", "w:tblLayout", "w:tblCellMar", "w:tblLook", "w:tblCaption", "w:tblDescription"):
        nxt = tblpr.find(qn(name))
        if nxt is not None:
            nxt.addprevious(borders)
            return
    tblpr.append(borders)


def _cell_text(cell, text: str, *, bold: bool = False, fill: str = "") -> None:
    p = cell.paragraphs[0]
    ops.align_left(p._p)
    run = p.add_run(text)
    run.font.size = Pt(8)
    run.bold = bold
    if fill:
        ops.shade_cell(cell, fill)


def _table(doc, header: list[str], rows: list[tuple], fills: list[str] | None = None):
    tbl = doc.add_table(rows=1 + len(rows), cols=len(header))
    _border(tbl)
    width = tbl._tbl.tblPr.find(qn("w:tblW"))  # 쪽 폭에 맞춘다
    if width is not None:
        width.set(qn("w:type"), "pct")
        width.set(qn("w:w"), "5000")
    for c, h in zip(tbl.rows[0].cells, header):
        _cell_text(c, h, bold=True, fill="E7ECF2")
    for i, row in enumerate(rows):
        for c, v in zip(tbl.rows[1 + i].cells, row):
            _cell_text(c, str(v), fill=(fills[i] if fills else ""))
    return tbl


def _para(doc, text: str, *, bold: bool = False, size: float = 9, break_before: bool = False, fill: str = ""):
    p = doc.add_paragraph()
    ops.align_left(p._p)
    run = p.add_run(text)
    run.font.size = Pt(size)
    run.bold = bold
    if break_before:
        ops.page_break_before(p._p)
    if fill:
        ops.shade_runs(p._p, fill)
    return p


def prepend_legend(doc, trace: Trace, meta: dict) -> None:
    """검토용 파일 맨 앞(표지 앞)에 '읽는 법' 한 쪽을 넣는다. 표지는 첫 쪽에 맞춰져 있어 그 위에 끼우지 않고 따로 한 쪽으로."""
    body = doc.element.body
    first = body[0]
    missing = len(trace.missing())
    filled = len([i for i in trace.items if i.kind != "missing"])
    made = []
    made.append(_para(doc, "검토용 보고서 읽는 법", bold=True, size=16))
    made.append(_para(doc, "이 쪽과 맨 끝 '검토용 점검표'는 검토용 파일에만 있습니다. 제출에는 [보고서 만들기]로 받은 파일을 쓰세요.", size=9))
    made.append(_para(doc, f"만든 때 {meta.get('generated', '')}   작업 폴더 {meta.get('workspace', '')}   입력 호선 {meta.get('hull') or '모름'}", size=8))
    made.append(_para(doc, "색 뜻", bold=True, size=11))
    for kind in ("input", "calc", "figure", "missing"):
        p = _para(doc, f"  {KIND_LABEL[kind]}  ", bold=True, size=10, fill=KIND_FILL[kind])
        run = p.add_run(f"   {KIND_MEANING[kind]}")
        run.font.size = Pt(10)
        made.append(p)
    made.append(_para(doc, "색이 없는 글과 표는 서식(견본 보고서) 그대로입니다. 호선이 달라도 바뀌지 않으니 직접 확인하세요.", size=10))
    made.append(_para(doc, "6장 표 제목 아래의 작은 '〔검토용〕' 줄은 그 표를 만든 파일, 시트, 줄 수, 계산 규칙입니다.", size=10))
    made.append(_para(doc, f"이 보고서: 프로그램이 넣은 자리 {filled}곳, 자료가 없는 자리 {missing}곳. 자리마다의 목록은 맨 끝 점검표에 있습니다.", bold=True, size=10))
    end = _para(doc, "", size=10)
    end.add_run().add_break(__import__("docx.enum.text", fromlist=["WD_BREAK"]).WD_BREAK.PAGE)
    made.append(end)
    for p in made:  # add_paragraph 는 문서 끝에 붙인다 → 표지 앞으로 옮긴다
        first.addprevious(p._p)


def append_audit(doc, trace: Trace, meta: dict, warnings: list[str]) -> None:
    """문서 맨 끝에 '검토용 점검표'를 붙인다 — 프로그램이 넣은 자리, 빠진 자료, 서식 그대로인 자리."""
    _para(doc, "검토용 점검표 (이 쪽은 검토용 파일에만 있습니다)", bold=True, size=13, break_before=True)
    _para(doc, f"만든 때 {meta.get('generated', '')} · 작업 폴더 {meta.get('workspace', '')} · 입력 호선 {meta.get('hull') or '모름'}", size=8)
    _para(doc, "색 뜻", bold=True)
    for kind in ("input", "calc", "figure", "missing"):
        _para(doc, f"  {KIND_LABEL[kind]}  ", fill=KIND_FILL[kind], size=8.5)
    _para(doc, "색이 없는 글과 표는 서식(견본 보고서) 그대로입니다.", size=8.5)

    missing = trace.missing()
    _para(doc, f"1. 자료가 없어 비운 자리 ({len(missing)}곳)", bold=True)
    if missing:
        _table(doc, ["위치", "보고서에 적힌 글", "필요한 자료"], [(m.where, m.value, m.source) for m in missing],
               fills=[KIND_FILL["missing"]] * len(missing))
    else:
        _para(doc, "없음", size=8.5)

    filled = [i for i in trace.items if i.kind != "missing"]
    _para(doc, f"2. 프로그램이 넣은 자리 ({len(filled)}곳)", bold=True)
    _table(doc, ["위치", "넣은 값", "구분", "가져온 곳"],
           [(i.where, i.value, KIND_LABEL.get(i.kind, i.kind), i.source) for i in filled],
           fills=[KIND_FILL.get(i.kind, "") for i in filled])

    _para(doc, "3. 서식 그대로인 자리 (호선, 대상이 달라도 바뀌지 않음 — 직접 확인)", bold=True)
    _table(doc, ["자리", "비고"], TEMPLATE_FIXED)

    if warnings:
        _para(doc, f"4. 만들면서 생긴 경고 ({len(warnings)}건)", bold=True)
        for w in warnings:
            _para(doc, "- " + w, size=8.5)
