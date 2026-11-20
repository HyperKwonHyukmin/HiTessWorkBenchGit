"""PSA 평가보고서 — Word(docx) 요소를 다루는 낮은 수준 도우미.

보고서 조립(psa_report_docx.py)과 검토용 표시(psa_report_review.py)가 함께 쓴다.
규칙: 글자를 바꿀 때 첫 글자 모양을 유지하고, 요소를 끼울 때 Word 스키마의 자식 순서를 지킨다
(순서가 어긋나면 Word 가 '읽을 수 없는 내용'으로 파일을 거부할 수 있다).
"""
from __future__ import annotations

import io
from copy import deepcopy
from typing import Iterable, Optional

from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.table import Table, _Cell
from docx.text.paragraph import Paragraph

EMU_PER_CM = 360000

# 스키마 자식 순서(뒤에 와야 하는 것들) — 새 요소를 그 앞에 끼운다
_RPR_AFTER_SHD = ("w:fitText", "w:vertAlign", "w:rtl", "w:cs", "w:em", "w:lang", "w:eastAsianLayout", "w:specVanish", "w:oMath")
_TCPR_AFTER_SHD = ("w:noWrap", "w:tcMar", "w:textDirection", "w:tcFitText", "w:vAlign", "w:hideMark")


# ── 읽기 ─────────────────────────────────────────────────────
def tag_of(el) -> str:
    return el.tag.split("}")[1]


def el_text(el) -> str:
    return "".join(t.text or "" for t in el.iter(qn("w:t")))


def style_id(el) -> str:
    ppr = el.find(qn("w:pPr"))
    if ppr is None or ppr.find(qn("w:pStyle")) is None:
        return ""
    return ppr.find(qn("w:pStyle")).get(qn("w:val")) or ""


def has_sectpr(el) -> bool:
    ppr = el.find(qn("w:pPr"))
    return ppr is not None and ppr.find(qn("w:sectPr")) is not None


def drawings(el) -> list:
    return list(el.iter(qn("w:drawing")))


def unique_cells(row) -> list:
    """가로 병합 칸은 같은 칸이 여러 번 나온다 — 한 번씩만."""
    seen, out = set(), []
    for c in row.cells:
        if id(c._tc) in seen:
            continue
        seen.add(id(c._tc))
        out.append(c)
    return out


def row_texts(row) -> list[str]:
    return [c.text.strip() for c in row.cells]


# ── 글자 넣기(첫 글자 모양 유지) ───────────────────────────────
def set_paragraph(p: Paragraph, text: str) -> None:
    runs = p.runs
    if not runs:
        p.add_run(text)
        return
    runs[0].text = text
    for r in runs[1:]:
        r._r.getparent().remove(r._r)


def set_paragraph_el(p_el, text: str, parent) -> None:
    set_paragraph(Paragraph(p_el, parent), text)


def set_cell(cell, text) -> None:
    """칸 글자를 바꾼다. 줄바꿈은 같은 모양의 문단으로 나눈다."""
    lines = str(text if text is not None else "").split("\n")
    paras = cell.paragraphs
    first = paras[0]
    for p in paras[1:]:
        p._p.getparent().remove(p._p)
    set_paragraph(first, lines[0])
    prev = first
    for ln in lines[1:]:
        el = deepcopy(first._p)
        prev._p.addnext(el)
        prev = Paragraph(el, cell)
        set_paragraph(prev, ln)


# ── 요소 복제 ────────────────────────────────────────────────
def clone(el):
    """본문 요소를 복제한다. 책갈피와 문단 id 는 떼어 낸다(같은 것이 두 번 있으면 Word 가 하나를 버린다)."""
    new = deepcopy(el)
    for tag in ("w:bookmarkStart", "w:bookmarkEnd"):
        for b in list(new.iter(qn(tag))):
            b.getparent().remove(b)
    for p in new.iter(qn("w:p")):
        for attr in list(p.attrib):
            if attr.endswith("}paraId") or attr.endswith("}textId"):
                del p.attrib[attr]
    return new


def _insert_before_any(parent, child, successors: Iterable[str]) -> None:
    for name in successors:
        nxt = parent.find(qn(name))
        if nxt is not None:
            nxt.addprevious(child)
            return
    parent.append(child)


def page_break_before(p_el) -> None:
    """문단 맨 앞에 쪽 나눔 문자를 넣는다(서식이 쓰던 방식).

    문단 속성(pageBreakBefore, keepNext, keepLines)은 쓰지 않는다 — 편집 기호를 켠 Word 에서 문단 앞에 네모점(■)으로 보여
    사용자가 지적했다(2026-11-12, 메모리 feedback_word_report_style).
    """
    r = OxmlElement("w:r")
    br = OxmlElement("w:br")
    br.set(qn("w:type"), "page")
    r.append(br)
    ppr = p_el.find(qn("w:pPr"))
    if ppr is not None:
        ppr.addnext(r)
    else:
        p_el.insert(0, r)


def drop_inline_page_breaks(p_el) -> None:
    """문단 안의 쪽 나눔(w:br type=page)을 뺀다 — 쪽 나눔은 문단 속성으로 한 곳에서만 준다."""
    for br in list(p_el.iter(qn("w:br"))):
        if br.get(qn("w:type")) == "page":
            br.getparent().remove(br)
    for el in list(p_el.iter(qn("w:lastRenderedPageBreak"))):
        el.getparent().remove(el)


# ── 표 ───────────────────────────────────────────────────────
def trim_table(tbl_el, keep_rows: int) -> None:
    """앞의 keep_rows 줄만 남긴다(견본 표를 가볍게)."""
    for tr in tbl_el.findall(qn("w:tr"))[keep_rows:]:
        tbl_el.remove(tr)


def set_table_font(tbl_el, header_rows: int, font: str = "Arial") -> None:
    """데이터 줄의 글꼴을 어느 PC 에나 있는 것으로 고정한다.

    서식의 결과 표는 'Arial Unicode MS'(엑셀에서 붙여 넣은 글꼴)인데, 이 글꼴이 없는 PC 에서는 폭이 넓은
    대체 글꼴로 바뀌어 '-133.2' 같은 숫자가 좁은 칸에서 두 줄로 꺾인다(2026-11-18 Word 변환으로 확인).
    """
    for tr in tbl_el.findall(qn("w:tr"))[header_rows:]:
        for rpr in tr.iter(qn("w:rPr")):
            fonts = rpr.find(qn("w:rFonts"))
            if fonts is None:
                continue
            for attr in list(fonts.attrib):
                del fonts.attrib[attr]
            for key in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
                fonts.set(qn(key), font)


def set_cell_margins(tbl_el, dxa: int) -> None:
    """표 칸의 좌우 안쪽 여백(1/20 pt). 좁은 숫자 칸에서 글자가 꺾이지 않게 줄일 때 쓴다."""
    tblpr = tbl_el.find(qn("w:tblPr"))
    if tblpr is None:
        return
    mar = tblpr.find(qn("w:tblCellMar"))
    if mar is None:
        mar = OxmlElement("w:tblCellMar")
        look = tblpr.find(qn("w:tblLook"))
        if look is not None:
            look.addprevious(mar)
        else:
            tblpr.append(mar)
    for side in ("w:left", "w:right"):
        el = mar.find(qn(side))
        if el is None:
            el = OxmlElement(side)
            mar.append(el)
        el.set(qn("w:w"), str(dxa))
        el.set(qn("w:type"), "dxa")


def align_left(p_el) -> None:
    ppr = p_el.get_or_add_pPr()
    jc = ppr.find(qn("w:jc"))
    if jc is None:
        jc = OxmlElement("w:jc")
        ppr.append(jc)
    jc.set(qn("w:val"), "left")


def rebuild_rows(table: Table, header_rows: int, rows: list[list]) -> list[list]:
    """머리 아래 줄을 지우고 첫 데이터 줄 모양으로 다시 만든다. 세로 병합 표시는 뗀다(줄마다 따로).

    머리 줄은 쪽이 넘어가면 다시 나오게 하고, 데이터 줄은 쪽 경계에서 쪼개지지 않게 한다.
    새 줄마다 칸 목록을 돌려준다. 줄이 수백 개인 표가 있어 python-docx 의 줄 조회(table.rows[i].cells)를 쓰지 않고
    XML 칸(w:tc)을 직접 다룬다(조회가 줄 수의 제곱으로 느려진다).
    """
    trs = table._tbl.findall(qn("w:tr"))
    proto = deepcopy(trs[header_rows]) if len(trs) > header_rows else deepcopy(trs[-1])
    for vm in list(proto.iter(qn("w:vMerge"))):
        vm.getparent().remove(vm)
    _row_flag(proto, "w:cantSplit")
    for tr in trs[:header_rows]:
        _row_flag(tr, "w:tblHeader")
    for tr in trs[header_rows:]:
        table._tbl.remove(tr)
    out = []
    for values in rows:
        tr = deepcopy(proto)
        table._tbl.append(tr)
        cells = [_Cell(tc, table) for tc in tr.findall(qn("w:tc"))]
        for c, v in zip(cells, values):
            set_cell(c, v)
        out.append(cells)
    return out


def _row_flag(tr, name: str) -> None:
    trpr = tr.find(qn("w:trPr"))
    if trpr is None:
        trpr = OxmlElement("w:trPr")
        # trPr 는 tblPrEx 다음, 칸(tc) 앞
        first_tc = tr.find(qn("w:tc"))
        if first_tc is not None:
            first_tc.addprevious(trpr)
        else:
            tr.append(trpr)
    if trpr.find(qn(name)) is None:
        trpr.append(OxmlElement(name))


def merge_row(cells: list, text: str) -> None:
    """한 줄의 모든 칸(rebuild_rows 가 돌려준 칸 목록)을 하나로 합치고 글을 가운데에 넣는다('자료 없음' 줄)."""
    if not cells:
        return
    first = cells[0]
    if len(cells) > 1:
        first = first.merge(cells[-1])
    set_cell(first, text)
    for p in first.paragraphs:
        ppr = p._p.get_or_add_pPr()
        jc = ppr.find(qn("w:jc"))
        if jc is None:
            jc = OxmlElement("w:jc")
            ppr.append(jc)
        jc.set(qn("w:val"), "center")
    # 합치면 칸마다 있던 빈 문단이 남는다 — 첫 문단만 둔다
    for p in first.paragraphs[1:]:
        if not p.text.strip():
            p._p.getparent().remove(p._p)


# ── 색 표시(검토용) ──────────────────────────────────────────
def _shd(fill: str):
    el = OxmlElement("w:shd")
    el.set(qn("w:val"), "clear")
    el.set(qn("w:color"), "auto")
    el.set(qn("w:fill"), fill)
    return el


def shade_cell(cell, fill: str) -> None:
    tcpr = cell._tc.get_or_add_tcPr()
    old = tcpr.find(qn("w:shd"))
    if old is not None:
        tcpr.remove(old)
    _insert_before_any(tcpr, _shd(fill), _TCPR_AFTER_SHD)


def shade_runs(p_el, fill: str) -> None:
    for r in p_el.iter(qn("w:r")):
        if r.find(qn("w:t")) is None:
            continue
        rpr = r.get_or_add_rPr()
        old = rpr.find(qn("w:shd"))
        if old is not None:
            rpr.remove(old)
        _insert_before_any(rpr, _shd(fill), _RPR_AFTER_SHD)


def make_run(text: str, *, italic: bool = False, bold: bool = False, color: Optional[str] = None, size_pt: Optional[float] = None):
    r = OxmlElement("w:r")
    rpr = OxmlElement("w:rPr")
    if bold:
        rpr.append(OxmlElement("w:b"))
    if italic:
        rpr.append(OxmlElement("w:i"))
    if color:
        c = OxmlElement("w:color")
        c.set(qn("w:val"), color)
        rpr.append(c)
    if size_pt:
        for name in ("w:sz", "w:szCs"):
            s = OxmlElement(name)
            s.set(qn("w:val"), str(int(round(size_pt * 2))))
            rpr.append(s)
    if len(rpr):
        r.append(rpr)
    t = OxmlElement("w:t")
    t.text = text
    t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    r.append(t)
    return r


# ── 제목(캡션) ───────────────────────────────────────────────
def set_caption(p_el, title: str, chapter: Optional[int] = None, number: Optional[int] = None) -> None:
    """'Table 6.1 제목' 문단의 제목 글을 바꾼다. 번호는 Word 필드(STYLEREF, SEQ)라 그대로 두되,
    필드를 갱신하지 않고 열어도 맞게 보이도록 미리 적힌 값(chapter, number)도 고친다."""
    flds = p_el.findall(qn("w:fldSimple"))
    if not flds:  # 번호를 글자로 박아 둔 캡션 — 통째로 바꿀 수 없으니 제목만 덧쓴다
        return
    last = flds[-1]
    proto_rpr = None
    for sib in list(last.itersiblings()):
        if sib.tag == qn("w:r"):
            if proto_rpr is None and sib.find(qn("w:rPr")) is not None:
                proto_rpr = deepcopy(sib.find(qn("w:rPr")))
            p_el.remove(sib)
    r = OxmlElement("w:r")
    if proto_rpr is not None:
        r.append(proto_rpr)
    t = OxmlElement("w:t")
    t.text = " " + title
    t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    r.append(t)
    last.addnext(r)
    cached = [(last, number)] + ([(flds[0], chapter)] if len(flds) >= 2 else [])
    for fld, value in cached:
        if value is None:
            continue
        for t_el in fld.iter(qn("w:t")):
            t_el.text = str(value)


# ── 그림 ─────────────────────────────────────────────────────
def _run_of(drawing):
    el = drawing
    while el is not None and el.tag != qn("w:r"):
        el = el.getparent()
    return el


def set_picture(doc, drawing, blob: bytes, max_w_cm: Optional[float] = None, max_h_cm: Optional[float] = None) -> None:
    """서식의 그림 자리에 새 그림을 넣는다. 자리 크기(또는 준 상한) 안에서 가로세로 비율을 지킨다."""
    rid, image = doc.part.get_or_add_image(io.BytesIO(blob))
    ext = drawing.xpath(".//wp:extent")[0]
    box_w = int(max_w_cm * EMU_PER_CM) if max_w_cm else int(ext.get("cx"))
    box_h = int(max_h_cm * EMU_PER_CM) if max_h_cm else int(ext.get("cy"))
    pw, ph = max(1, image.px_width), max(1, image.px_height)
    scale = min(box_w / pw, box_h / ph)
    cx, cy = int(pw * scale), int(ph * scale)
    ext.set("cx", str(cx))
    ext.set("cy", str(cy))
    for e in drawing.xpath(".//a:xfrm/a:ext"):
        e.set("cx", str(cx))
        e.set("cy", str(cy))
    for b in drawing.xpath(".//a:blip"):
        b.set(qn("r:embed"), rid)
    for crop in drawing.xpath(".//a:srcRect"):  # 옛 그림의 잘라내기 값은 새 그림에 맞지 않는다
        crop.getparent().remove(crop)


def drawing_size_cm(drawing) -> tuple[float, float]:
    """서식 그림 자리의 (폭, 높이) cm."""
    ext = drawing.xpath(".//wp:extent")[0]
    return int(ext.get("cx")) / EMU_PER_CM, int(ext.get("cy")) / EMU_PER_CM


def remove_drawing(drawing) -> None:
    """그림 자리 하나를 run 째 지운다(한 문단에 그림이 둘인 자리를 한 그림으로 합칠 때)."""
    run = _run_of(drawing)
    target = run if run is not None else drawing
    target.getparent().remove(target)


def drop_unused_images(doc) -> int:
    """본문에서 더는 쓰지 않는 그림을 파일에서 뺀다. 서식(견본 보고서)의 그림이 보이지 않는 채 결과 파일에 따라가지 않게."""
    part = doc.part
    used = set(part.element.xpath("//@r:embed | //@r:link | //@r:id | //@r:pict"))
    dropped = 0
    for rid, rel in list(part.rels.items()):
        if rel.reltype.endswith("/image") and rid not in used:
            part.rels.pop(rid)
            dropped += 1
    return dropped


def drawing_to_text(drawing, text: str):
    """그림을 지우고 그 자리에 글 한 줄을 둔다(그림 자료가 없을 때). 새 run 을 돌려준다."""
    run = _run_of(drawing)
    new = make_run(text, italic=True, color="7F7F7F")
    if run is None:
        drawing.getparent().replace(drawing, new)
    else:
        run.addprevious(new)
        run.getparent().remove(run)
    return new
