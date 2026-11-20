"""PSA 평가보고서 — 사내 보고서 서식(R2 Word)에 입력값과 CAESAR 결과를 넣어 docx 를 만든다.

서식 = app/templates/psa_report/report_template.bin. 3441 R2 보고서를 scripts/psa_report_slim_template.py 로 손질한 것
(6장은 첫 Line 절만, 표는 머리 줄 + 한 줄. 확장자 .bin 은 DRM 재암호화 방지).
서식은 '견본'이다. 호선과 대상에 따라 달라지는 자리는 모두 입력(psa_input.json)이나 원본 파일에서 채우고,
자료가 없으면 서식의 3441 글자를 남기지 않고 'Not provided' 로 표시한다(2026-11-18 사용자 결정).

채우는 자리
  표지 요약표, 개정 표, 호선 문장, 사용 프로그램, 가속도 기준 선급, P&ID 도면 번호      ← docInfo, revisions
    (표지와 개정 표는 비우면 빈칸, 문장에 끼는 값은 비우면 '[Not provided]' — 문장이 깨지지 않게)
  Table 1.1 Scope · 2.3 Process(+ 아래 설명) · Displacement · Acceleration · Manifold    ← 화면 입력
  그림: P&ID, Hogging/Sagging, Bending moment, Line 별 배관 모델, 7장 노즐 표             ← 올린 그림 파일
  6장: 서식의 첫 Line 절을 견본으로 Line 마다 새로 만든다(모델 수만큼 그림, 최대 반력 표, 응력 요약 표).
       표와 그림 번호, 본문의 'table 6.x' 참조, 결론 문장(OK / 초과 / 자료 없음)을 결과에 맞춘다.
검토용(review=True): 채운 자리를 색으로 칠하고 출처를 적고 맨 끝에 점검표를 붙인다(psa_report_review.py).
목차와 번호는 Word 필드라 파일을 열 때 갱신하도록 표시해 둔다(updateFields).
"""
from __future__ import annotations

import io
import os
import re
from datetime import datetime
from typing import Callable, Optional

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.table import Table

from . import psa_report_docops as ops
from .psa_report_review import KIND_FILL, KIND_LABEL, KIND_MEANING, TEMPLATE_FIXED, Trace, append_audit, prepend_legend, source_note
from .psa_report_tables import COMPLIANCE_SHEET, compliance_rows, compliance_sheet, restraint_rows

TEMPLATE_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates", "psa_report", "report_template.bin")
COMP_RM = "COMP.RM"
FIGURE_FOLDER = "Figures"

# 자료가 없는 자리에 적는 글(보고서는 영문)
NOT_PROVIDED = "Not provided"
MARK = "[Not provided]"
NO_DATA = "Data not provided"
NO_FIGURE = "[ Figure not provided ]"

_H1, _H2, _H3, _CAPTION, _BULLET = "1", "2", "3", "a7", "ad"  # 서식의 스타일 id
_IMAGE_EXT = (".png", ".jpg", ".jpeg", ".bmp", ".gif")

SRC_INPUT = "화면 입력"


# ── 숫자 표기 ────────────────────────────────────────────────
def _f1(v: float) -> str:
    s = f"{v:.1f}"
    return "0.0" if s == "-0.0" else s


def _fixed(v: float, nd: int) -> str:
    """자릿수 고정(83 → 83.0) — 같은 표 안에서 자릿수가 들쭉날쭉하지 않게(2026-11-19 사용자 지시)."""
    s = f"{v:.{nd}f}"
    return s[1:] if s.startswith("-") and float(s) == 0 else s


def _trim(v: float, nd: int) -> str:
    s = f"{v:.{nd}f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _thousands(n) -> str:
    return f"{int(n):,}"


def _disp(v) -> str:
    s = str(v or "").strip()
    if not s:
        return ""
    if not s.startswith(("-", "+")):
        s = "+" + s
    return f"{s} mm/m"


def _report_text(s) -> str:
    return str(s or "").replace("°C", "℃")  # 화면 표기 → 서식 표기


def _blank(v) -> bool:
    return v is None or str(v).strip() == ""


def _src_path(folder: str, rel: str) -> str:
    """검토용 출처의 파일 자리 — Line 칸 이름이 그 엑셀 이름이면(엑셀 하나 = Line 하나, 2026-11-19) 한 번만."""
    return rel if not folder or folder == rel else f"{folder}/{rel}"


def _join(names: list[str]) -> str:
    names = [n for n in names if n]
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]


# ── 입력에서 읽는 값 ─────────────────────────────────────────
def model_count(line: dict) -> int:
    try:
        n = int(line.get("modelCount") or 1)
    except (TypeError, ValueError):
        n = 1
    return max(1, min(8, n))


def line_title(line: dict) -> str:
    no = str(line.get("lineNo") or "").strip()
    return "Compressor Room" if no.upper() == COMP_RM else no


def model_label(line: dict, i: int) -> str:
    """보고서에 쓰는 해석 모델 이름 — TD01, TD06-2, Compressor Room."""
    base = line_title(line)
    return base if model_count(line) == 1 else f"{base}-{i + 1}"


def hull_of(data: dict) -> str:
    """호선 네 자리 — 보고서 정보의 호선 표기, 없으면 최상위 폴더 이름에서."""
    for src in ((data.get("docInfo") or {}).get("hullLabel"), data.get("sourceFolder")):
        m = re.search(r"(\d{4})", str(src or ""))
        if m:
            return m.group(1)
    return ""


# ── 그림 자리 ────────────────────────────────────────────────
# 그림 파일 이름 = 보고서 그림(표) 제목 그대로(2026-11-19 사용자 결정). 앞의 'Figure 1.1', 'Table 7.1' 번호는 붙여도 되고,
# 대소문자, 띄어쓰기, 기호(& - . 등)는 보지 않는다. 확장자는 _IMAGE_EXT 중 아무것이나.
# Figure 2.1 은 서식에 그림 두 장(Hogging, Sagging)이 있지만 제목이 하나라 파일 한 장으로 받아 두 자리를 한 그림으로 바꾼다.
FIXED_FIGURES = [
    {"slot": "pid", "label": "Figure 1.1", "caption": "Piping & Instrument Diagram for Cargo System"},
    {"slot": "hogsag", "label": "Figure 2.1", "caption": "Hogging and sagging on each frames"},
    {"slot": "bending", "label": "Figure 2.2", "caption": "Bending moment and section modulus on each frames"},
    {"slot": "nozzleCompressor", "label": "Table 7.1", "caption": "Summary for compressor equipment nozzle loads"},
    {"slot": "nozzleStatic", "label": "Table 7.2", "caption": "Summary of static equipment nozzle loads"},
]
_NUMBER_PREFIX = re.compile(r"^\s*(figure|fig\.?|table)\s*[\d.\-]+\s*", re.IGNORECASE)


# Scope 에 COMP.RM 이 없을 때 빼는 서식 자리(drop_comp_room)의 기록 문구
NO_COMP_NOTE = "Scope 에 COMP.RM(Compressor Room) Line 이 없어 서식의 그 자리를 뺌"
_COMP_TEXT = re.compile(r"compressor\s*room|comp\.?\s*rm", re.IGNORECASE)


def has_comp_room(data: dict) -> bool:
    return any(str(l.get("lineNo") or "").strip().upper() == COMP_RM for l in data.get("lines") or [])


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9가-힣]", "", str(s).lower())


def _with_hint(slot: dict) -> dict:
    return {**slot, "hint": slot["caption"] + ".png", "label": f"{slot['label']} {slot['caption']}"}


def figure_slots(data: dict) -> list[dict]:
    """보고서에 들어가는 그림 자리 전부 — 고정 그림 + Line(모델)마다 배관 모델 그림.
    { slot, label(보고서 번호와 제목), caption(파일 이름으로 쓸 제목), hint(예시 파일 이름) }"""
    slots = [_with_hint(f) for f in FIXED_FIGURES if f["slot"] != "nozzleCompressor" or has_comp_room(data)]
    for line in data.get("lines") or []:
        for i in range(model_count(line)):
            label = model_label(line, i)
            slots.append(_with_hint({"slot": f"model:{label}", "label": "6장", "caption": f"Piping model for {label}"}))
    return slots


def match_figure(stem: str, data: dict) -> Optional[str]:
    """그림 파일 이름(확장자 뺌) → 그림 자리. 보고서 제목과 글자가 같아야 한다(번호, 대소문자, 띄어쓰기, 기호 무시)."""
    n = _norm(_NUMBER_PREFIX.sub("", str(stem)))
    if not n:
        return None
    for slot in figure_slots(data):
        if _norm(slot["caption"]) == n:
            return slot["slot"]
    return None


def scan_figures(workspace_dir: str, data: dict) -> tuple[dict, list[str]]:
    """작업 폴더의 Figures 폴더 → ({자리: 상대 경로}, [어느 자리에도 맞지 않은 그림]). 같은 자리에 둘이면 이름순 첫 파일."""
    folder = os.path.join(workspace_dir, FIGURE_FOLDER)
    matched: dict = {}
    unmatched: list[str] = []
    if not os.path.isdir(folder):
        return matched, unmatched
    found = []
    for dp, _, fns in os.walk(folder):
        for fn in fns:
            if fn.lower().endswith(_IMAGE_EXT):
                found.append(os.path.relpath(os.path.join(dp, fn), folder).replace(os.sep, "/"))
    for rel in sorted(found):
        slot = match_figure(os.path.splitext(os.path.basename(rel))[0], data)
        if slot and slot not in matched:
            matched[slot] = rel
        else:
            unmatched.append(rel)
    return matched, unmatched


def load_figures(workspace_dir: str, data: dict) -> dict:
    """작업 폴더의 Figures 폴더에서 그림을 읽어 {자리: (파일 이름, 바이트)}."""
    matched, _ = scan_figures(workspace_dir, data)
    out: dict = {}
    for slot, rel in matched.items():
        with open(os.path.join(workspace_dir, FIGURE_FOLDER, *rel.split("/")), "rb") as f:
            out[slot] = (rel, f.read())
    return out


# ── 서식에서 찾기 ────────────────────────────────────────────
def _find_table(doc, pred) -> Optional[Table]:
    for t in doc.tables:
        try:
            if pred([ops.row_texts(r) for r in t.rows[:2]]):
                return t
        except IndexError:
            continue
    return None


def _stress_sections(doc) -> list[dict]:
    """[{heading, elements:[…]}] — 'STRESS ANALYSIS' Heading 1 아래 Heading 2 절."""
    started = False
    sections: list[dict] = []
    cur = None
    for el in list(doc.element.body.iterchildren()):
        tag = ops.tag_of(el)
        sid = ops.style_id(el) if tag == "p" else ""
        if tag == "p" and sid == _H1:
            if started:
                break
            started = "STRESS ANALYSIS" in ops.el_text(el).upper()
            continue
        if not started:
            continue
        if tag == "p" and sid == _H2:
            cur = {"heading": ops.el_text(el).strip(), "elements": [el]}
            sections.append(cur)
        elif cur is not None:
            cur["elements"].append(el)
    return sections


class _Proto:
    """6장 Line 절의 견본 요소(서식의 첫 Line 절에서 뜬다)."""

    def __init__(self, elements: list):
        self.h2 = elements[0]
        self.h3 = []
        self.blank = self.bullet = self.fig_para = self.fig_caption = None
        self.model_text = self.result_text = self.cc_text = None
        self.table_captions, self.tables = [], []
        for el in elements[1:]:
            tag = ops.tag_of(el)
            if tag == "tbl":
                self.tables.append(el)
                continue
            if tag != "p":
                continue
            sid, text = ops.style_id(el), ops.el_text(el).strip()
            # lxml 요소는 자식이 없으면 거짓이라 'a or b' 로 고르지 않는다
            if ops.drawings(el):
                if self.fig_para is None:
                    self.fig_para = el
            elif sid == _H3:
                self.h3.append(el)
            elif sid == _BULLET:
                if self.bullet is None:
                    self.bullet = el
            elif sid == _CAPTION and text.startswith("Figure"):
                if self.fig_caption is None:
                    self.fig_caption = el
            elif sid == _CAPTION and text.startswith("Table"):
                self.table_captions.append(el)
            elif not text:
                if not sid and self.blank is None:
                    self.blank = el
            elif text.startswith("The following figure"):
                self.model_text = el
            elif text.startswith("Reaction forces"):
                self.result_text = el
            elif text.startswith("This piping stress analysis"):
                self.cc_text = el

    def ok(self) -> bool:
        parts = (self.blank, self.bullet, self.fig_para, self.fig_caption, self.model_text, self.result_text, self.cc_text)
        return len(self.h3) >= 2 and len(self.tables) >= 2 and len(self.table_captions) >= 2 and all(p is not None for p in parts)

    def freeze(self) -> None:
        """본문에서 떼기 전에 복제해 둔다(견본 표는 머리 줄 + 한 줄만)."""
        for name in ("h2", "blank", "bullet", "fig_para", "fig_caption", "model_text", "result_text", "cc_text"):
            setattr(self, name, ops.clone(getattr(self, name)))
        self.h3 = [ops.clone(e) for e in self.h3[:2]]
        self.table_captions = [ops.clone(e) for e in self.table_captions[:2]]
        self.tables = [ops.clone(e) for e in self.tables[:2]]
        ops.trim_table(self.tables[0], 3)  # 최대 반력: 머리 2줄 + 1줄
        ops.trim_table(self.tables[1], 2)  # 응력 요약: 머리 1줄 + 1줄
        for tbl, head in ((self.tables[0], 2), (self.tables[1], 1)):
            ops.set_table_font(tbl, head)
        ops.set_cell_margins(self.tables[0], 40)  # 13칸 숫자 표: 좌우 여백을 줄여 '-1234.5' 도 한 줄에
        ops.drop_inline_page_breaks(self.h2)


class _Report:
    def __init__(self, doc, data: dict, resolve, figures: dict, trace: Trace, warnings: list[str],
                 pending: Optional[set] = None):
        self.doc, self.data, self.resolve = doc, data, resolve
        self.pending = pending or set()  # {(lineNo, kind, model)} = 후보가 여럿인데 아직 안 고른 칸(검토 때만 옴)
        self.figures, self.trace, self.warnings = figures or {}, trace, warnings
        self.info = data.get("docInfo") or {}
        self.lines = data.get("lines") or []
        self.proc = {str(p.get("lineNo")): p for p in ((data.get("report") or {}).get("process") or [])}
        self.has_comp = has_comp_room(data)  # Scope 에 COMP.RM 이 없으면 서식의 Compressor Room 자리를 뺀다
        self.cc_status: dict[str, str] = {}  # 모델 이름 → ok | ng | missing
        self.ng_cases: dict[str, list[str]] = {}

    # ── 공통 ──
    def _given(self, value, where: str, need: str = SRC_INPUT, source: str = SRC_INPUT, missing_text: str = MARK) -> tuple[str, str]:
        """값이 있으면 (글, 'input'), 없으면 (표시 글, 'missing'). 어느 쪽이든 기록한다."""
        if _blank(value):
            self.trace.add(where, missing_text, "missing", need)
            return missing_text, "missing"
        text = str(value).strip()
        self.trace.add(where, text, "input", source)
        return text, "input"

    def _body_paragraphs(self):
        return [el for el in self.doc.element.body.iterchildren() if ops.tag_of(el) == "p"]

    def _rewrite(self, p_el, text: str, kind: str, parent=None) -> None:
        ops.set_paragraph_el(p_el, text, parent if parent is not None else self.doc._body)
        self.trace.paragraph(p_el, kind)

    # ── 표지, 문서 정보 ──
    def cover(self) -> None:
        doc, info = self.doc, self.info
        t = doc.tables[0] if doc.tables else None
        if t is None or "REPORT SUMMARY" not in " ".join(ops.row_texts(t.rows[0])).upper():
            self.warnings.append("서식에서 표지 요약표를 찾지 못함")
            t = None
        rows = [ops.unique_cells(r) for r in t.rows] if t is not None else []

        def after(label: str):
            for cells in rows:
                for i, c in enumerate(cells):
                    if c.text.strip().rstrip(":") == label and i + 1 < len(cells):
                        return cells[i + 1]
            return None

        def put(cell, key: str, where: str) -> None:
            if cell is None:
                self.warnings.append(f"서식 표지에서 '{where}' 칸을 찾지 못함")
                return
            # 표지 칸은 비우면 보고서에도 빈칸(사용자 결정 2026-11-18). 검토용에서는 주황으로 보인다.
            text, kind = self._given(info.get(key), f"표지 › {where}", need="보고서 정보 단계", missing_text="")
            ops.set_cell(cell, text)
            self.trace.cells([cell], kind)

        for label, key in (("Title", "title"), ("Project", "project"), ("Ship Classification", "shipClass"), ("Hull No.", "hullNo"),
                           ("Date", "date"), ("Revision No.", "revisionNo"), ("Latest Revision Date", "latestRevisionDate"),
                           ("Department", "department"), ("Prepared by", "preparedBy"), ("Reviewed by", "reviewedBy"),
                           ("Approved by", "approvedBy")):
            put(after(label), key, label)
        for ri, cells in enumerate(rows):  # Client 값은 'Client:' 아랫줄 첫 칸
            if cells and cells[0].text.strip().rstrip(":") == "Client" and ri + 1 < len(rows):
                put(rows[ri + 1][0], "client", "Client")
                break
        for label, key in (("Status", "status"), ("Secret Level", "secretLevel")):
            chosen = str(info.get(key) or "").strip().lower()
            for cells in rows:
                if not cells or cells[0].text.strip() != label:
                    continue
                names = [c.text.strip().lstrip("■□ ").strip() for c in cells[1:]]
                hit = chosen in [n.lower() for n in names]
                for c, name in zip(cells[1:], names):
                    ops.set_cell(c, f"{'■' if name.lower() == chosen else '□'} {name}")
                    self.trace.cells([c], "input" if hit else "missing")
                self.trace.add(f"표지 › {label}", info.get(key) if hit else "(고르지 않음)", "input" if hit else "missing",
                               SRC_INPUT if hit else "보고서 정보 단계")

        # 개정 표
        rev = _find_table(doc, lambda h: h[0][:3] == ["No.", "Date", "Contents"])
        revisions = [r for r in (self.data.get("revisions") or []) if any(not _blank(r.get(k)) for k in ("no", "date", "contents"))]
        if rev is not None:
            if revisions:
                new = ops.rebuild_rows(rev, 1, [[r.get("no", ""), r.get("date", ""), r.get("contents", "")] for r in revisions])
                self.trace.rows(new, "input")
                self.trace.add("Revision Summary 표", f"{len(revisions)}줄", "input", SRC_INPUT)
            else:
                new = ops.rebuild_rows(rev, 1, [["", "", ""]])  # 비우면 빈 줄 하나(표지 칸과 같은 규칙)
                self.trace.rows(new, "missing")
                self.trace.add("Revision Summary 표", "(빈 줄)", "missing", "보고서 정보 단계(개정 이력)")

        # 호선 문장(초록, 1장, 표지 요약 칸)
        hull_label = str(info.get("hullLabel") or "").strip() or hull_of(self.data)
        hull_kind = "input" if hull_label else "missing"
        hull_text = f"(Hull No. {hull_label or MARK})"
        pat = re.compile(r"\(Hull No\.\s*[^)]*\)")
        count = 0
        cover_paras = [(p._p, c) for cells in rows for c in cells for p in c.paragraphs]
        for p_el, parent in [(p, None) for p in self._body_paragraphs()] + cover_paras:
            text = ops.el_text(p_el)
            if pat.search(text):
                self._rewrite(p_el, pat.sub(hull_text, text), hull_kind, parent)
                count += 1
        self.trace.add(f"호선 문장 {count}곳 (초록, 1장, 표지)", hull_text, hull_kind,
                       ("보고서 정보의 호선 표기" if info.get("hullLabel") else "최상위 폴더 이름") if hull_label else "보고서 정보 단계(호선 표기)")

        # 사용 프로그램, 가속도 기준 선급, P&ID 도면 번호
        software, sw_kind = self._given(info.get("software"), "1장, 2.2 사용 프로그램", need="보고서 정보 단계")
        cls, cls_kind = self._given(info.get("accelClass"), "2.8 가속도 기준 선급", need="보고서 정보 단계")
        ref, ref_kind = self._given(info.get("accelRuleRef"), "2.8 가속도 기준 규정", need="보고서 정보 단계")
        pid, pid_kind = self._given(info.get("pidDrawingNo"), "부록 A › P&ID 도면 번호", need="보고서 정보 단계")
        for p_el in self._body_paragraphs():
            text = ops.el_text(p_el)
            if "Intergraph CAESAR II" in text and "carried out" in text:
                self._rewrite(p_el, re.sub(r"Intergraph CAESAR II.*?\.(?=\s+Load)", f"Intergraph {software}.", text), sw_kind)
            elif re.search(r"performed with the CAESAR II[^.]* by Intergraph", text):
                self._rewrite(p_el, re.sub(r"the CAESAR II[^.]*? by Intergraph", f"{software} by Intergraph", text), sw_kind)
            elif text.startswith("Acceleration by ship motion"):
                new = re.sub(r"\w+ classification\([^)]*\)", f"{cls} classification({ref})", text)
                new = re.sub(r"defined by \w+ classification", f"defined by {cls} classification", new)
                kind = "missing" if "missing" in (cls_kind, ref_kind) else "input"
                self._rewrite(p_el, new, kind)
            elif "Cargo Piping & Instrument Diagram" in text and ops.style_id(p_el) != _CAPTION:
                self._rewrite(p_el, f"{pid}, “Cargo Piping & Instrument Diagram”", pid_kind)

    # ── 앞쪽 입력 표 ──
    def inputs(self) -> None:
        doc, data, lines, tr = self.doc, self.data, self.lines, self.trace

        t = _find_table(doc, lambda h: h[0][:2] == ["Line No.", "Pipe Line"])
        if t is not None:
            rows = ops.rebuild_rows(t, 1, [[l.get("lineNo", ""), l.get("pipeLine") or NOT_PROVIDED] for l in lines])
            tr.rows(rows, "input")
            tr.add("Table 1.1 Scope of Piping Lines", f"{len(lines)}줄", "input", "화면 입력(Scope)")
            for l in lines:
                if _blank(l.get("pipeLine")):
                    tr.add(f"Table 1.1 › {l.get('lineNo')} Pipe Line", NOT_PROVIDED, "missing", "Scope 단계의 Pipe Line 이름")
        else:
            self.warnings.append("서식에서 Scope 표를 찾지 못함")

        t = _find_table(doc, lambda h: h[0][0] == "Line No." and len(h[0]) > 2 and h[0][1].startswith("Min. operating"))
        if t is not None:
            values = []
            for l in lines:
                p = self.proc.get(str(l.get("lineNo")), {})
                no = str(l.get("lineNo", ""))
                cells = [_report_text(p.get("minTemp")), _report_text(p.get("maxTemp")), _report_text(p.get("pressure")),
                         p.get("fluid", ""), _report_text(p.get("density")), p.get("insulation", "")]
                values.append([no + ("\n(**)" if no.upper() == COMP_RM else "")] + [c if not _blank(c) else NOT_PROVIDED for c in cells])
            rows = ops.rebuild_rows(t, 1, values)
            tr.add("Table 2.3 Process conditions", f"{len(lines)}줄", "input", "화면 입력(Process Condition)")
            for cells, vals in zip(rows, values):
                tr.cells([c for c, v in zip(cells, vals) if v != NOT_PROVIDED], "input")
                empty = [c for c, v in zip(cells, vals) if v == NOT_PROVIDED]
                if empty:
                    tr.cells(empty, "missing")
                    tr.add(f"Table 2.3 › {vals[0].splitlines()[0]}", f"빈 칸 {len(empty)}개 → {NOT_PROVIDED}", "missing", "Process Condition 단계")
            self._process_notes(t)
        else:
            self.warnings.append("서식에서 Process conditions 표를 찾지 못함")

        disp = data.get("displacement") or {}
        keys = ["tdSeaHog", "tdSeaSag", "tdTermHog", "tdTermSag", "crSeaHog", "crSeaSag", "sun", "cold"]
        t = _find_table(doc, lambda h: h[0][0] == "Position" and any("Displacement" in x for x in h[0]))
        if t is not None and len(t.rows) >= 1 + len(keys):
            empty = 0
            for i, k in enumerate(keys):
                cell = t.rows[1 + i].cells[3]
                text = _disp(disp.get(k))
                ops.set_cell(cell, text or NOT_PROVIDED)
                tr.cells([cell], "input" if text else "missing")
                empty += 0 if text else 1
            tr.add("Table 2.4 Displacement", f"{len(keys) - empty}칸", "input", "화면 입력(Displacement)")
            if not self.has_comp:  # Compressor Room 두 줄(crSeaHog, crSeaSag)
                for r in [t.rows[1 + keys.index("crSeaHog")], t.rows[1 + keys.index("crSeaSag")]]:
                    r._tr.getparent().remove(r._tr)
                tr.add("Table 2.4 › Compressor Room 2줄", "뺌", "input", NO_COMP_NOTE)
            if empty:
                tr.add("Table 2.4 Displacement", f"빈 칸 {empty}개 → {NOT_PROVIDED}", "missing", "Displacement 단계")
        else:
            self.warnings.append("서식에서 Displacement 표를 찾지 못함")

        positions = data.get("accelPositions") or []
        loads = data.get("accelLoads") or []
        if not self.has_comp:
            gone = {p.get("uid") for p in positions if _COMP_TEXT.search(str(p.get("discipline") or ""))}
            positions = [p for p in positions if p.get("uid") not in gone]
            loads = [a for a in loads if a.get("positionUid") not in gone]
        t = _find_table(doc, lambda h: h[0][0] == "Discipline" and "Position" in h[0][1])
        if t is not None:
            self._simple_rows(t, 2, [[p.get("discipline", ""), p.get("x", ""), p.get("y", ""), p.get("z", "")] for p in positions],
                              "Table 2.5 Calculation Position", "Acceleration 단계(위치)")
        pos_name = {p.get("uid"): p.get("discipline", "") for p in positions}
        t = _find_table(doc, lambda h: h[0][:2] == ["Discipline", "Load condition"])
        if t is not None:
            self._simple_rows(t, 2, [[pos_name.get(a.get("positionUid"), ""), a.get("loadCondition", ""), a.get("lines", ""),
                                      a.get("x", ""), a.get("y", ""), a.get("z", "")] for a in loads],
                              "Table 2.6 Uniform Acceleration Loads", "Acceleration 단계(하중)")

        uid_no = {l.get("uid"): l.get("lineNo", "") for l in lines}
        t = _find_table(doc, lambda h: h[0][:2] == ["System", "Pipe size"])
        if t is not None:
            rows = []
            for m in data.get("manifold") or []:
                ld = m.get("loads") or {}
                if not ld:
                    continue
                rows.append([uid_no.get(m.get("lineUid"), ""), f"{m.get('size')}A", _thousands(ld["fx"]), _thousands(ld["fy"]),
                             _thousands(ld["fz"]), _thousands(ld["mxz"]), _thousands(ld["my"])])
            self._simple_rows(t, 1, rows, "Table 2.7 Maximum Allowable Loads", "Manifold Load 단계", fill_blank=False)

    def _simple_rows(self, table: Table, header_rows: int, rows: list[list], where: str, need: str, fill_blank: bool = True) -> None:
        tr = self.trace
        if not rows:
            new = ops.rebuild_rows(table, header_rows, [[NO_DATA]])
            ops.merge_row(new[0], NO_DATA)
            tr.rows(new, "missing")
            tr.add(where, NO_DATA, "missing", need)
            return
        values = [[(v if not _blank(v) else NOT_PROVIDED) if fill_blank else v for v in r] for r in rows]
        new = ops.rebuild_rows(table, header_rows, values)
        empty = 0
        for cells, vals in zip(new, values):
            tr.cells([c for c, v in zip(cells, vals) if v != NOT_PROVIDED], "input")
            gone = [c for c, v in zip(cells, vals) if v == NOT_PROVIDED]
            tr.cells(gone, "missing")
            empty += len(gone)
        tr.add(where, f"{len(rows)}줄", "input", f"화면 입력({need.split(' 단계')[0]})")
        if empty:
            tr.add(where, f"빈 칸 {empty}개 → {NOT_PROVIDED}", "missing", need)

    def _process_notes(self, table: Table) -> None:
        """Process 표 아래 설명 문단을 입력 글(processNotes)로 바꾼다. '- ' 로 시작하는 줄은 목록."""
        old, plain, bullet = [], None, None
        el = table._tbl.getnext()
        while el is not None and not (ops.tag_of(el) == "p" and ops.style_id(el) in (_H1, _H2)):
            if ops.tag_of(el) == "p" and not ops.has_sectpr(el) and ops.el_text(el).strip():
                old.append(el)
                if ops.style_id(el) == _BULLET:
                    bullet = el if bullet is None else bullet
                else:
                    plain = el if plain is None else plain
            el = el.getnext()
        if not old:
            return
        notes = [ln.rstrip() for ln in str(self.data.get("processNotes") or "").splitlines() if ln.strip()]
        if not self.has_comp:  # '(**) marked in compressor room …' 줄
            notes = [ln for ln in notes if not (ln.lstrip().startswith("(**)") and _COMP_TEXT.search(ln))]
        plain = old[0] if plain is None else plain
        plain_proto, bullet_proto = ops.clone(plain), ops.clone(plain if bullet is None else bullet)
        anchor = old[0]
        for ln in notes:
            is_bullet = ln.lstrip().startswith("- ")
            new = ops.clone(bullet_proto if is_bullet else plain_proto)
            anchor.addprevious(new)
            self._rewrite(new, _report_text(ln.lstrip()[2:] if is_bullet else ln), "input")
        for e in old:
            e.getparent().remove(e)
        if notes:
            self.trace.add("2.6 Process conditions 아래 설명", f"{len(notes)}줄", "input", "화면 입력(Process Condition 설명)")

    # ── 그림 ──
    def _place_figure(self, drawing, slot: str, where: str, max_w=None, max_h=None) -> bool:
        got = self.figures.get(slot)
        if got:
            name, blob = got
            try:
                ops.set_picture(self.doc, drawing, blob, max_w, max_h)
                self.trace.add(where, name, "figure", f"그림 폴더 › {name}")
                return True
            except Exception as e:  # noqa: BLE001 — 그림 하나가 깨져도 보고서는 만든다
                self.warnings.append(f"{where}: 그림 파일을 읽지 못함({name}): {e}")
        run = ops.drawing_to_text(drawing, NO_FIGURE)
        if self.trace.review:
            ops.shade_runs(run.getparent(), "FBD9B5")
        hint = next((f["hint"] for f in figure_slots(self.data) if f["slot"] == slot), "")
        self.trace.add(where, NO_FIGURE, "missing", f"그림 폴더에 '{hint}' 이름의 그림(보고서 제목과 같은 이름)")
        return False

    def drop_comp_room(self) -> None:
        """Scope 에 COMP.RM 이 없으면 서식의 Compressor Room 전용 자리를 뺀다(2026-11-19 사용자 지시 — 안 맞으면 지움).
        Table 5.4, Table 7.1(압축기 노즐), 2.8 아래 '(*) marked in compressor room' 문단, 그 표들을 가리키는 문장."""
        if self.has_comp:
            return
        tr = self.trace
        els = list(self.doc.element.body.iterchildren())
        for i, el in enumerate(els):
            if ops.tag_of(el) != "p":
                continue
            text = ops.el_text(el)
            if ops.style_id(el) == _CAPTION and "Load Cases (In Compressor Room" in text:
                nxt = el.getnext()
                if nxt is not None and ops.tag_of(nxt) == "tbl":
                    nxt.getparent().remove(nxt)
                el.getparent().remove(el)
                tr.add("Table 5.4 Load Cases (In Compressor Room)", "뺌", "input", NO_COMP_NOTE)
            elif ops.style_id(el) == _CAPTION and "compressor equipment nozzle loads" in text:
                nxt = el.getnext()
                if nxt is not None and ops.tag_of(nxt) == "p" and ops.drawings(nxt):
                    nxt.getparent().remove(nxt)
                el.getparent().remove(el)
                tr.add("7장 Table 7.1 압축기 노즐 하중 표", "뺌", "input", NO_COMP_NOTE)
            elif text.strip().startswith("(*) marked in compressor room"):
                el.getparent().remove(el)
                tr.add("2.8 '(*) marked in compressor room' 문단", "뺌", "input", NO_COMP_NOTE)
            elif "Table 5.1, 5.2, 5.3 and 5.4" in text:
                self._rewrite(el, text.replace("Table 5.1, 5.2, 5.3 and 5.4", "Table 5.1, 5.2 and 5.3"), "input")
            elif text.strip() == "in Table 7.1 and 7.2":
                self._rewrite(el, "in Table 7.1", "input")
            elif ops.style_id(el) == _CAPTION and "static equipment nozzle loads" in text:
                flds = el.findall(qn("w:fldSimple"))
                if flds:  # Table 7.2 → 7.1 (Word 가 필드를 갱신해도 같은 값)
                    for t_el in flds[-1].iter(qn("w:t")):
                        t_el.text = "1"

    def fixed_figures(self) -> None:
        els = list(self.doc.element.body.iterchildren())

        def near(i: int, step: int):
            j = i + step
            while 0 <= j < len(els) and abs(j - i) <= 3:
                if ops.tag_of(els[j]) == "p" and ops.drawings(els[j]):
                    return els[j]
                j += step
            return None

        nozzle_ok = []
        for i, el in enumerate(els):
            if ops.tag_of(el) != "p" or ops.style_id(el) != _CAPTION:
                continue
            text = ops.el_text(el)
            if "Piping & Instrument Diagram" in text:
                p = near(i, -1)
                if p is not None:
                    self._place_figure(ops.drawings(p)[0], "pid", "Figure 1.1 P&ID")
            elif "Hogging and sagging" in text:
                p = near(i, -1)
                ds = ops.drawings(p) if p is not None else []
                if ds:
                    # 서식의 두 자리(Hogging 왼쪽, Sagging 오른쪽)를 그림 한 장으로 — 첫 자리를 두 자리 폭만큼 넓히고 나머지는 지운다
                    width_cm = sum(ops.drawing_size_cm(d)[0] for d in ds)
                    # 높이는 서식(2.9 cm)보다 넉넉히 — 위아래로 붙인 그림도 작아지지 않게. 비율은 그대로 지킨다
                    height_cm = max(8.0, max(ops.drawing_size_cm(d)[1] for d in ds))
                    for d in ds[1:]:
                        ops.remove_drawing(d)
                    self._place_figure(ds[0], "hogsag", "Figure 2.1 Hogging and sagging", width_cm, height_cm)
            elif "Bending moment and section modulus" in text:
                p = near(i, -1)
                if p is not None:
                    self._place_figure(ops.drawings(p)[0], "bending", "Figure 2.2 Bending moment")
            elif "compressor equipment nozzle loads" in text or "static equipment nozzle loads" in text:
                slot = "nozzleCompressor" if "compressor" in text else "nozzleStatic"
                where = "7장 Table 7.1 압축기 노즐 하중 표" if slot == "nozzleCompressor" else "7장 Table 7.2 정적 장비 노즐 하중 표"
                p = near(i, +1)
                if p is not None:
                    nozzle_ok.append(self._place_figure(ops.drawings(p)[0], slot, where, 23.5, 11.5))
                    if slot == "nozzleStatic":  # 7장 끝의 빈 문단이 빈 쪽을 만든다 — 구역 나눔 앞까지 걷는다
                        nxt = p.getnext()
                        while nxt is not None and ops.tag_of(nxt) == "p" and not ops.has_sectpr(nxt) and not ops.el_text(nxt).strip() \
                                and not ops.drawings(nxt):
                            gone, nxt = nxt, nxt.getnext()
                            gone.getparent().remove(gone)
        if nozzle_ok and not any(nozzle_ok):
            # 결과가 없는데 '허용 하중 이내'라고 적지 않는다
            for p_el in self._body_paragraphs():
                text = ops.el_text(p_el).strip()
                if text.startswith("All loads on connected to equipment nozzle"):
                    self._rewrite(p_el, "The nozzle load assessment results were not provided. "
                                        "The loads on equipment nozzles could not be confirmed in this report.", "missing")
                    nxt = p_el.getnext()
                    if nxt is not None and ops.el_text(nxt).strip().startswith("in Table 7"):
                        ops.set_paragraph_el(nxt, "", self.doc._body)
                    self.trace.add("7장 결론 문장", "'results were not provided' 문장으로 바꿈", "missing", "노즐 하중 표 그림 2개")
                    break

    # ── 6장 ──
    def chapter6(self) -> None:
        sections = _stress_sections(self.doc)
        if not sections:
            self.warnings.append("서식에서 6장 Line 절을 찾지 못해 해석 결과를 넣지 못했습니다")
            return
        proto = _Proto(sections[0]["elements"])
        if not proto.ok():
            self.warnings.append("서식 6장 첫 절의 구성이 예상과 달라 해석 결과를 넣지 못했습니다")
            return
        proto.freeze()
        self.p6 = proto
        body = self.doc.element.body
        tail = sections[-1]["elements"][-1].getnext()
        anchor = None
        for sec in sections:
            for el in sec["elements"]:
                if ops.tag_of(el) == "p" and ops.has_sectpr(el):  # 구역 나눔 문단은 남긴다(쪽 방향, 머리말 유지)
                    for child in list(el):
                        if child.tag != qn("w:pPr"):
                            el.remove(child)
                    if anchor is None:
                        anchor = el
                    continue
                el.getparent().remove(el)
        if anchor is None:
            anchor = tail if tail is not None else body.find(qn("w:sectPr"))
        self._anchor = anchor
        self._table_no = self._figure_no = 0
        if not self.lines:
            p = self._emit(proto.model_text)
            self._rewrite(p, "No piping line was provided for the stress analysis.", "missing")
            self.trace.add("6장", "Line 없음", "missing", "Scope 단계의 Piping line")
            return
        for idx, line in enumerate(self.lines):
            self._line_section(line, first=(idx == 0))

    def _emit(self, proto_el):
        el = ops.clone(proto_el)
        self._anchor.addprevious(el)
        return el

    def _gap(self) -> None:
        self._emit(self.p6.blank)

    def _line_section(self, line: dict, first: bool) -> None:
        proto, tr = self.p6, self.trace
        no = str(line.get("lineNo") or "").strip()
        n = model_count(line)
        labels = [model_label(line, i) for i in range(n)]
        process = self.proc.get(no, {})
        folder = (line.get("folder") or {}).get("name") or (line.get("folder") or {}).get("target") or ""

        h2 = self._emit(proto.h2)
        title = no + (f" - {line.get('pipeLine')}" if not _blank(line.get("pipeLine")) else "")
        ops.set_paragraph_el(h2, title, self.doc._body)
        tr.paragraph(h2, "input")
        if not first:
            ops.page_break_before(h2)
        self._gap()

        # 해석 모델
        self._emit(proto.h3[0])
        p = self._emit(proto.model_text)
        if n > 1:
            ops.set_paragraph_el(p, "The following figures show the CAESAR II models for this analysis.", self.doc._body)
        self._gap()
        insulation = str(process.get("insulation") or "").strip()
        ins_text = {"A": "Application", "N/A": "N/A"}.get(insulation, insulation)
        fluid = str(process.get("fluid") or "").strip()
        if "&" in fluid:
            fluid += " (applied differently for each pipe lines)"
        if "&" in ins_text:
            ins_text += " (applied differently for each pipe lines)"
        for name, value, need in (("Material", line.get("material"), "Scope 단계의 재질"),
                                  ("Wall thickness", line.get("wallThickness"), "Scope 단계의 두께(Schedule)"),
                                  ("Fluid type    ", fluid, "Process Condition 단계의 Fluid"),
                                  ("Insulation    ", ins_text, "Process Condition 단계의 Insulation")):
            text, kind = self._given(value, f"6장 {no} › {name.strip()}", need=need, missing_text=NOT_PROVIDED)
            b = self._emit(proto.bullet)
            self._rewrite(b, f"{name} : {text}", kind)
        self._gap()
        for i, label in enumerate(labels):
            fig = self._emit(proto.fig_para)
            self._figure_no += 1
            self._place_figure(ops.drawings(fig)[0], f"model:{label}", f"6장 Figure 6.{self._figure_no} Piping model for {label}",
                               16.0, 12.0 if n == 1 else 8.5)
            cap = self._emit(proto.fig_caption)
            ops.set_caption(cap, f"Piping model for {label}", 6, self._figure_no)
            self._gap()

        # 해석 결과: 최대 반력
        self._emit(proto.h3[1])
        res_nos = list(range(self._table_no + 1, self._table_no + n + 1))
        cc_nos = list(range(self._table_no + n + 1, self._table_no + 2 * n + 1))
        self._table_no += 2 * n
        ref = (f"The table 6.{res_nos[0]} shows" if n == 1 else f"The tables {_join([f'6.{k}' for k in res_nos])} show")
        p = self._emit(proto.result_text)
        ops.set_paragraph_el(p, re.sub(r"The tables? [\d., and]+ shows?", ref, ops.el_text(p)), self.doc._body)
        self._gap()
        for i, label in enumerate(labels):
            cap = self._emit(proto.table_captions[0])
            ops.set_caption(cap, f"Maximum Forces and Moments and Displacement ({label})", 6, res_nos[i])
            tbl = Table(self._emit(proto.tables[0]), self.doc._body)
            rel = self._pick(line, "restraint", i)
            rows = self._read(restraint_rows, line, "restraint", i, f"{no} 모델 {i + 1} Restraint 엑셀")
            where = f"6장 Table 6.{res_nos[i]} 최대 반력 ({label})"
            if rows:
                new = ops.rebuild_rows(tbl, 2, [[str(r[0])] + [_f1(v) for v in r[1:]] for r in rows])
                tr.rows(new, "calc")
                src = f"{_src_path(folder, rel)} · 시트 Restraint Summary Extended · 지지 Node {len(rows)}개"
                tr.add(where, f"{len(rows)}줄", "calc", src)
                self._note(cap, "출처: " + src + " · 힘과 모멘트 = MAX 줄 ÷ 1000, 변위 = Node − 연결 Node 의 최대(+)와 최소(−)")
            else:
                new = ops.rebuild_rows(tbl, 2, [[NO_DATA]])
                ops.merge_row(new[0], NO_DATA)
                tr.rows(new, "missing")
                tr.add(where, NO_DATA, "missing", "CAESAR II Restraint Summary Extended 엑셀" + self._why(line, "restraint", i, rel))
            self._gap()

        # 해석 결과: 응력 요약
        statement = self._emit(proto.cc_text)
        self._gap()
        for i, label in enumerate(labels):
            cap = self._emit(proto.table_captions[1])
            ops.set_caption(cap, f"Stress summary for {label}", 6, cc_nos[i])
            tbl = Table(self._emit(proto.tables[1]), self.doc._body)
            rel = self._pick(line, "codeCompliance", i)
            rows = self._read(compliance_rows, line, "codeCompliance", i, f"{no} 모델 {i + 1} Code Compliance 엑셀")
            where = f"6장 Table 6.{cc_nos[i]} 응력 요약 ({label})"
            if rows:
                ng = [r["case"] for r in rows if r["ratio"] > 100.0]
                # 응력 자릿수 = 원본 자릿수(Code Compliance 2자리, Legacy 1자리), 응력비 1자리 — 모두 고정
                nd = 1 if self._read(compliance_sheet, line, "codeCompliance", i, f"{no} 모델 {i + 1} 응력 시트 이름") not in (None, COMPLIANCE_SHEET) else 2
                new = ops.rebuild_rows(tbl, 1, [[r["case"], _fixed(r["stress"], nd), _fixed(r["allowable"], nd), _fixed(r["ratio"], 1),
                                                "OK" if r["ratio"] <= 100.0 else "NG"] for r in rows])
                tr.rows(new, "calc")
                sheet = self._read(compliance_sheet, line, "codeCompliance", i, f"{no} 모델 {i + 1} 응력 시트 이름") or COMPLIANCE_SHEET
                legacy = sheet != COMPLIANCE_SHEET
                src = f"{_src_path(folder, rel)} · 시트 {sheet} · 하중 경우 {len(rows)}개"
                tr.add(where, f"{len(rows)}줄" + (f", NG {len(ng)}건" if ng else ", 모두 OK"), "calc", src)
                self._note(cap, "출처: " + src + (" · CAESAR 가 하중 경우마다 고른 최고 응력비(소수 1자리)" if legacy
                                                 else " · 하중 경우마다 응력비가 가장 큰 요소"))
                self.cc_status[label] = "ng" if ng else "ok"
                if ng:
                    self.ng_cases[label] = ng
            else:
                new = ops.rebuild_rows(tbl, 1, [[NO_DATA]])
                ops.merge_row(new[0], NO_DATA)
                tr.rows(new, "missing")
                tr.add(where, NO_DATA, "missing", "CAESAR II Code Compliance 엑셀" + self._why(line, "codeCompliance", i, rel))
                self.cc_status[label] = "missing"
            if i < n - 1:
                self._gap()
        self._cc_statement(statement, labels, no)

    def _why(self, line: dict, kind: str, i: int, rel: str) -> str:
        """파일 자리가 비었을 때 필요한 자료 글 뒤에 붙일 이유."""
        if rel:
            return f" (고른 파일 {rel} 을 읽지 못함)"
        if (str(line.get("lineNo") or ""), kind, i) in self.pending:
            return " (후보가 여러 개라 아직 고르지 않음)"
        return ""

    def _pick(self, line: dict, kind: str, i: int) -> str:
        picks = (line.get("files") or {}).get(kind) or []
        return picks[i] if i < len(picks) and picks[i] else ""

    def _read(self, reader, line: dict, kind: str, i: int, what: str):
        path = self.resolve(line, kind, i)
        if not path:
            return None
        try:
            return reader(path) or None
        except Exception as e:  # noqa: BLE001 — 파일 하나가 깨져도 보고서는 만든다
            self.warnings.append(f"{what}을 읽지 못함: {e}")
            return None

    def _note(self, after_el, text: str) -> None:
        if self.trace.review:
            after_el.addnext(source_note(text))

    def _cc_statement(self, p_el, labels: list[str], no: str) -> None:
        """응력 결과 문장 — 결과가 있는 만큼만 말한다(자료가 없는데 '허용 이내'라고 적지 않는다)."""
        head = "This piping stress analysis is performed in compliance with code ASME B31.3. "
        ok = [l for l in labels if self.cc_status.get(l) == "ok"]
        ng = [l for l in labels if self.cc_status.get(l) == "ng"]
        missing = [l for l in labels if self.cc_status.get(l) == "missing"]
        if not ng and not missing:
            return  # 서식 문장 그대로
        parts = []
        if ng:
            detail = "; ".join(f"{l}: {', '.join(self.ng_cases[l])}" for l in ng)
            parts.append(f"The results of code stress calculation indicate that the calculated stresses exceed the specified allowable limits "
                         f"({detail}). Further review is required.")
        if ok:
            scope = "" if len(labels) == 1 else f" for {_join(ok)}"
            parts.append(f"The calculated highest stresses{scope} are within the specified allowable limits.")
        if missing:
            scope = "this line" if len(labels) == len(missing) else _join(missing)
            parts.append(f"The code stress results for {scope} were not provided, and compliance could not be confirmed in this report.")
        kind = "missing" if missing and not ng else "calc"
        self._rewrite(p_el, head + " ".join(parts), kind)
        self.trace.add(f"6장 {no} › 응력 결과 문장", "허용 초과 문장으로 바꿈" if ng else "'results were not provided' 문장으로 바꿈", kind,
                       "Code Compliance 엑셀" if missing else "Code Compliance 결과")

    # ── 초록의 결론 문장 ──
    def conclusion(self) -> None:
        ok = [l for l, s in self.cc_status.items() if s == "ok"]
        ng = [l for l, s in self.cc_status.items() if s == "ng"]
        missing = [l for l, s in self.cc_status.items() if s == "missing"]
        if self.cc_status and not ng and not missing:
            return
        text = "The systems have been evaluated by carrying out stress analysis. "
        if ng:
            text += f"From the analysis results, the stress levels exceed the allowable limit defined by ASME B31.3 for {_join(ng)}. "
        if ok:
            text += f"The stress levels for {_join(ok)} are within the allowable limit defined by ASME B31.3. "
        if missing:
            text += f"The code stress results for {_join(missing)} were not provided."
        if not self.cc_status:
            text += "The stress analysis results were not provided."
        kind = "missing" if (missing or not self.cc_status) and not ng else "calc"
        cover = self.doc.tables[0] if self.doc.tables else None
        targets = [(p, None) for p in self._body_paragraphs()]
        if cover is not None:
            targets += [(p._p, c) for r in cover.rows for c in ops.unique_cells(r) for p in c.paragraphs]
        count = 0
        for p_el, parent in targets:
            if ops.el_text(p_el).strip().startswith("The systems have been evaluated"):
                self._rewrite(p_el, text.strip(), kind, parent)
                count += 1
        self.trace.add(f"결론 문장 {count}곳 (초록, 표지)", "허용 초과 Line 을 적음" if ng else "결과가 없는 Line 을 적음", kind,
                       "Code Compliance 엑셀" if kind == "missing" else "Code Compliance 결과")


def _mark_update_fields(doc) -> None:
    """열 때 목차, 표 번호를 갱신하도록(Word 가 한 번 묻는다)."""
    settings = doc.settings.element
    el = settings.find(qn("w:updateFields"))
    if el is None:
        el = OxmlElement("w:updateFields")
        settings.append(el)
    el.set(qn("w:val"), "true")


_W_ID = qn("w:id")
_W_NAME = qn("w:name")


def rebuild_toc(doc, warnings: Optional[list] = None) -> int:
    """목차(TOC) 항목을 실제 본문 제목으로 다시 쓴다(2026-11-19 사용자 지시 — 서식의 옛 항목 6.6 TD06, 6.7 CR01 이 남던 것).
    번호(1., 6.3., 6.3.1.)와 제목, 연결(책갈피)까지 채운다. 쪽 번호는 Word 가 쪽을 나눠 봐야 알 수 있어
    비워 두고, 열 때 필드 갱신(updateFields)으로 채운다. 앞의 ABSTRACT, CONTENTS 와 뒤의 부록(A., B.) 항목은 그대로.
    반환 = 새로 쓴 항목 수."""
    body = doc.element.body
    els = list(body.iterchildren())
    num_re = re.compile(r"^\d+(\.\d+)*\.$")

    def entry_number(p):
        ts = list(p.iter(qn("w:t")))
        return ts[0].text.strip() if ts and ts[0].text else ""

    toc = [el for el in els if ops.tag_of(el) == "p" and ops.style_id(el) in _TOC_STYLES and num_re.match(entry_number(el))]
    if not toc:
        if warnings is not None:
            warnings.append("서식에서 목차 항목을 찾지 못해 목차를 다시 쓰지 못함")
        return 0
    protos = {}
    for el in toc:
        protos.setdefault(ops.style_id(el), el)
    if set(protos) != set(_TOC_STYLES):
        if warnings is not None:
            warnings.append("목차 항목 서식이 모자라 목차를 다시 쓰지 못함")
        return 0
    anchor = toc[-1].getnext()
    start = els.index(toc[0])
    used_ids = [int(b.get(_W_ID)) for b in body.iter(qn("w:bookmarkStart")) if str(b.get(_W_ID) or "").isdigit()]
    next_id = max(used_ids, default=0) + 1
    seen: set = set()
    counters = [0, 0, 0]
    new_entries = []
    for el in els[start:]:
        if ops.tag_of(el) != "p" or ops.style_id(el) not in (_H1, _H2, _H3):
            continue
        title = ops.el_text(el).strip()
        if not title:
            continue
        lv = (_H1, _H2, _H3).index(ops.style_id(el))
        counters[lv] += 1
        for k in range(lv + 1, 3):
            counters[k] = 0
        number = ".".join(str(c) for c in counters[:lv + 1]) + "."
        # 제목의 책갈피 — 서식 제목은 그대로, 복제한 제목(6장)은 이름이 겹치므로 새로
        name = next((b.get(_W_NAME) for b in el.findall(qn("w:bookmarkStart")) if str(b.get(_W_NAME) or "").startswith("_Toc")), None)
        if not name or name in seen:
            for b in el.findall(qn("w:bookmarkStart")) + el.findall(qn("w:bookmarkEnd")):
                el.remove(b)
            name = f"_TocPsa{next_id:06d}"
            start_b = OxmlElement("w:bookmarkStart")
            start_b.set(_W_ID, str(next_id))
            start_b.set(_W_NAME, name)
            end_b = OxmlElement("w:bookmarkEnd")
            end_b.set(_W_ID, str(next_id))
            ppr = el.find(qn("w:pPr"))
            (ppr.addnext if ppr is not None else (lambda x: el.insert(0, x)))(start_b)
            el.append(end_b)
            next_id += 1
        seen.add(name)
        entry = ops.clone(protos[_TOC_STYLES[lv]])
        link = entry.find(qn("w:hyperlink"))
        if link is not None:
            link.set(qn("w:anchor"), name)
        ts = list(entry.iter(qn("w:t")))
        if len(ts) >= 3:
            ts[0].text, ts[1].text, ts[2].text = number, title, ""
        for it in entry.iter(qn("w:instrText")):
            if "PAGEREF" in (it.text or ""):
                it.text = f" PAGEREF {name} \\h "
        new_entries.append(entry)
    for el in toc:
        el.getparent().remove(el)
    for e in new_entries:
        anchor.addprevious(e)
    return len(new_entries)


_TOC_STYLES = ("11", "21", "32")  # 서식의 목차 1~3 수준 스타일 id


def build_report(data: dict, resolve: Callable[[dict, str, int], Optional[str]], template_bytes: Optional[bytes] = None,
                 update_fields: bool = True, *, review: bool = False, figures: Optional[dict] = None,
                 meta: Optional[dict] = None, summary: Optional[dict] = None,
                 pending: Optional[set] = None) -> tuple[bytes, list[str]]:
    """psa_input.json(dict) → (docx 바이트, 경고 목록).

    resolve(line, kind, model) → 그 파일의 실제 경로(없으면 None). 고른 파일은 line.files[kind][model].
    figures = {그림 자리: (파일 이름, 바이트)} (load_figures). review = 검토용 표시와 점검표.
    summary 에 dict 를 주면 채운 자리 수와 빠진 자리 목록을 담아 돌려준다.
    pending = {(lineNo, kind, model)} 아직 고르지 않은 파일 칸 — '자료 없음' 이유에 적는다(검토용).
    """
    if template_bytes is None:
        with open(TEMPLATE_PATH, "rb") as f:
            template_bytes = f.read()
    if not template_bytes.startswith(b"PK"):
        raise RuntimeError("보고서 서식 파일이 회사 DRM 으로 암호화되어 있습니다(서버의 report_template.bin 확인)")
    doc = Document(io.BytesIO(template_bytes))
    warnings: list[str] = []
    trace = Trace(review=review)
    rep = _Report(doc, data, resolve, figures or {}, trace, warnings, pending)

    rep.cover()
    rep.inputs()
    rep.drop_comp_room()
    rep.fixed_figures()
    rep.chapter6()
    rep.conclusion()
    rebuild_toc(doc, warnings)
    if review:
        info = dict(meta or {})
        info.setdefault("generated", datetime.now().strftime("%Y-%m-%d %H:%M"))
        info.setdefault("hull", hull_of(data))
        append_audit(doc, trace, info, warnings)
        prepend_legend(doc, trace, info)
    ops.drop_unused_images(doc)
    if update_fields:
        _mark_update_fields(doc)
    if summary is not None:
        summary["filled"] = len([i for i in trace.items if i.kind != "missing"])
        summary["missing"] = [{"where": i.where, "need": i.source} for i in trace.missing()]
        # 화면의 '검토 결과' 창이 쓰는 전체 기록(검토용 docx 의 색, 점검표와 같은 내용)
        summary["items"] = [{"kind": i.kind, "where": i.where, "value": i.value, "source": i.source} for i in trace.items]
        summary["templateFixed"] = [{"where": w, "note": n} for w, n in TEMPLATE_FIXED]
        # 색 정의는 여기 한 곳(검토용 docx 의 칠과 화면 칩이 같은 값을 쓴다)
        summary["kinds"] = {k: {"label": KIND_LABEL[k], "fill": "#" + KIND_FILL[k], "meaning": KIND_MEANING[k]}
                            for k in ("input", "calc", "figure", "missing")}
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue(), warnings


_SAFE_PART = re.compile(r"^[^<>:\"|?*\x00-\x1f]+$")


def make_resolver(workspace_dir: str) -> Callable[[dict, str, int], Optional[str]]:
    """작업 폴더 안 '<Line 폴더>/<고른 상대 경로>' 를 찾는다. 작업 폴더 밖으로 나가는 경로는 무시."""
    base = os.path.realpath(workspace_dir)

    def resolve(line: dict, kind: str, model: int) -> Optional[str]:
        folder = (line.get("folder") or {}).get("target")
        picks = (line.get("files") or {}).get(kind) or []
        rel = picks[model] if model < len(picks) else ""
        if not folder or not rel:
            return None
        parts = [p for p in re.split(r"[\\/]+", rel) if p]
        if not parts or any(p in (".", "..") or not _SAFE_PART.match(p) for p in parts):
            return None
        path = os.path.realpath(os.path.join(base, folder, *parts))
        if not path.startswith(base + os.sep) or not os.path.isfile(path):
            return None
        return path

    return resolve
