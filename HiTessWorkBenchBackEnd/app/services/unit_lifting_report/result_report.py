"""사내 표준 서식(ver2609) 기반 '결과 레포트' 생성.

`ReportFormat/ver02/260907_Unit_Lifting_Report_ver2609.xlsx` 를 그대로 서식으로 쓰고
해석 결과와 3D 캡처만 채운다. 서식의 셀 배치·수식·인쇄 설정은 건드리지 않는다.

  페이지 1 (행 1–54)   : 제목 · 주의사항 · 요약표 · 권상 위치 3D(평면/등각)
  페이지 2 (행 55–108) : 1. 구조 해석 결과 — 변위·응력 3D + Hook/Trolley 반력표
  페이지 3 (행 109–162): 2. 서포트 배치 — 가서포트가 없으면 통째로 삭제한다(사용자 결정)

서식 원본은 사내 DRM 대상(.xlsx)이라 `.bin` 사본을 배포본으로 둔다. [[reference_drm_xlsx_template_pattern]]
"""
from __future__ import annotations

import copy
import io
import math
import os
import re
from datetime import datetime
from typing import Any, Optional

from openpyxl import load_workbook

from .collector import ReportOptions, collect, format_contact
from . import figures3d

TEMPLATE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "templates"))
TEMPLATE_BIN = os.path.join(TEMPLATE_DIR, "unit_lifting_result_template.bin")
TEMPLATE_XLSX = os.path.join(TEMPLATE_DIR, "unit_lifting_result_template.xlsx")

# 서식의 캡처 자리(이미지 3~8) 순서. 앞 3개(0~2)는 HD 로고라 보존한다.
IMAGE_SLOTS = ("modelTop", "modelHome", "displacement", "stress", "supportTop", "supportHome")
LOGO_COUNT = 3
SUPPORT_PAGE_FIRST_ROW = 109
SUPPORT_PAGE_LAST_ROW = 162
SUPPORT_PAGE_BREAK_ID = 108
TON_FORCE_N = 9800.0

# Hook/Trolley 표: 그룹 블록 시작 행과 블록당 wire 행 수
HOOK_BLOCK_ROWS = (92, 96, 100)
WIRES_PER_BLOCK = 4


def generate_result_report(result_info: dict[str, Any], options: dict[str, Any] | None = None, *,
                           generated_by: str = "", generator: dict[str, Any] | None = None,
                           ) -> tuple[str, bytes, list[str], dict[str, Any]]:
    """``(파일명, xlsx 바이트, 경고, 요약)``. 디스크에 쓰지 않는다."""
    opts = ReportOptions.from_payload(options)
    if not opts.author:
        opts.author = generated_by or "-"
    opts.contact = opts.contact or format_contact(generator, generated_by)   # 바닥글 '문의' 줄
    now = datetime.now()
    data = collect(result_info, opts, generated_at=now.strftime("%Y-%m-%d %H:%M"))
    warnings: list[str] = list(data.warnings)

    figs, fig_errors = figures3d.render_result_figures(data)
    for key, why in fig_errors.items():
        warnings.append(f"3D 캡처 '{key}' 렌더 실패: {why}")

    wb = _load_template()
    ws = wb["Report"]
    # ⚠ 서식 원본에는 print_title_rows='$1:$3' (1~3행을 매 페이지 상단에 반복 인쇄) 가 남아 있다.
    # 이 서식은 페이지마다 자체 머리글(행 57·111)을 이미 갖고 있어서, 2·3페이지 맨 위에
    # 1페이지 머리글이 한 번 더 찍혀 겹친다(원본 서식을 그대로 인쇄해도 재현된다). 내용은
    # 건드리지 않고 이 반복 인쇄 설정만 끈다.
    # openpyxl 의 print_title_rows setter 는 None 을 무시하므로 내부 속성을 직접 비운다.
    ws._print_rows = None
    ws.print_title_rows = None
    has_support = bool(data.edits and data.edits.support_beams)
    _fill_titles(ws, data, has_support)
    _fill_summary(ws, data)
    _fill_hook_table(ws, data, warnings)
    _replace_images(ws, figs, has_support, warnings)
    if not has_support:
        _drop_support_page(ws)

    buf = io.BytesIO()
    wb.save(buf)

    i = data.identity
    name = (f"{_safe(i.hull_no)}-{_safe(i.unit_no)}_{_safe(i.lifting_method)}_"
            f"{_safe(i.title_prefix)}_권상_구조_해석_보고서_{now:%Y%m%d}.xlsx")
    summary = {
        "totalMassTon": data.model.total_mass_ton,
        "yieldStrengthMPa": data.results.yield_mpa,
        "allowableMPa": data.results.allowable_mpa,
        "maxDisplacementMm": data.results.max_displacement_mm,
        "maxStressMPa": data.results.max_stress_mpa,
        "structure": data.verdicts.structure,
        "jigRequired": data.verdicts.jig_required,
        "supportPage": has_support,
        "figureCount": len(figs),
        "warningCount": len(warnings),
    }
    return name, buf.getvalue(), warnings, summary


# ── 서식 로드 ────────────────────────────────────────────────────────────────
def _load_template():
    """DRM 상태와 무관하게 열리는 서식을 고른다(.bin 우선, 없으면 .xlsx)."""
    tried: list[str] = []
    for path in (TEMPLATE_BIN, TEMPLATE_XLSX):
        if not os.path.isfile(path):
            continue
        with open(path, "rb") as fh:
            raw = fh.read()
        if raw[:2] != b"PK":
            tried.append(f"{os.path.basename(path)}(DRM 암호화 상태)")
            continue
        return load_workbook(io.BytesIO(raw), keep_links=False)
    detail = f" — 시도: {', '.join(tried)}" if tried else ""
    raise FileNotFoundError(f"결과 레포트 서식을 열 수 없습니다: {TEMPLATE_BIN}{detail}")


# ── 셀 채우기 ────────────────────────────────────────────────────────────────
def _fill_titles(ws, d, has_support: bool):
    """페이지마다 반복되는 제목·호선·유닛·권상방식."""
    title = f"{d.identity.title_prefix} 권상 구조 해석 보고서"
    rows = [(3, 4), (57, 58)] + ([(111, 112)] if has_support else [])
    for title_row, info_row in rows:
        ws[f"O{title_row}"] = title
        ws[f"O{info_row}"] = f"HULL NO. {d.identity.hull_no}"
        ws[f"Y{info_row}"] = f"UNIT NO. {d.identity.unit_no}"
        ws[f"AI{info_row}"] = d.identity.lifting_method
    # 문의처는 보고서를 만든 WorkBench 사용자(이름/직급/부서) — 표지의 '작성자' 입력과 별개다
    footer = ("본 보고서는 Hi-TESS WorkBench를 통해 자동 생성되었습니다.\n"
              f"문의 | {d.identity.contact}   생성일 {d.identity.generated_at}")
    for row in ([52, 106] + ([160] if has_support else [])):
        ws[f"F{row}"] = footer


def _fill_summary(ws, d):
    """요약표 — 허용응력(V13)·검토결과(AT13)는 서식의 수식을 그대로 둔다."""
    r = d.results
    ws["F13"] = round(d.model.total_mass_ton, 3)
    ws["N13"] = round(r.yield_mpa, 1)
    ws["AD13"] = round(r.max_displacement_mm, 2)
    ws["AL13"] = round(r.max_stress_mpa, 2)
    ws["N74"] = f"[ 최대 변형 결과 : {r.max_displacement_mm:.4g} mm ]"
    ws["N88"] = f"[ 최대 응력 결과 : {r.max_stress_mpa:.4g} MPa ]"


def _fill_hook_table(ws, d, warnings: list[str]):
    """Hook/Trolley 별 반력·장력. 서식은 3그룹 × 4 wire 까지만 표시한다."""
    ws["AD92"] = d.options.jig_limit_ton                  # 안전 하중 기준(기본 6.2 ton)
    for start in HOOK_BLOCK_ROWS:                          # 서식 초기값 비우기
        ws[f"F{start}"] = None
        ws[f"R{start}"] = None
    for row in range(HOOK_BLOCK_ROWS[0], HOOK_BLOCK_ROWS[-1] + WIRES_PER_BLOCK):
        ws[f"X{row}"] = None

    by_group: dict[int, list] = {}
    for w in d.results.wires:
        by_group.setdefault(w.group_id, []).append(w)
    group_ids = sorted(by_group)
    if len(group_ids) > len(HOOK_BLOCK_ROWS):
        warnings.append(f"서식은 Hook/Trolley {len(HOOK_BLOCK_ROWS)}개까지 표시합니다. "
                        f"{len(group_ids)}개 중 앞의 {len(HOOK_BLOCK_ROWS)}개만 기록했습니다.")

    for block, start in enumerate(HOOK_BLOCK_ROWS):
        for offset in range(WIRES_PER_BLOCK):
            ws[f"L{start + offset}"] = None
        if block >= len(group_ids):
            ws[f"F{start}"] = "-"
            for offset in range(WIRES_PER_BLOCK):
                ws[f"AJ{start + offset}"] = None
            continue
        gid = group_ids[block]
        wires = sorted(by_group[gid], key=lambda w: (w.lug_node_id, w.wire_element_id))
        # 그룹·러그를 캡처 그림의 라벨(G1·N34)과 같은 표기로 적어 어느 와이어인지 그림에서 찾을 수 있게 한다
        ws[f"F{start}"] = f"G{gid}"
        if len(wires) > WIRES_PER_BLOCK:
            warnings.append(f"그룹 {gid}의 wire {len(wires)}개 중 {WIRES_PER_BLOCK}개만 서식에 기록했습니다.")
        for offset in range(len(wires), WIRES_PER_BLOCK):
            ws[f"AJ{start + offset}"] = None          # 없는 wire 행에 '지그 불요' 가 뜨지 않게
        reaction = 0.0
        has_reaction = False
        for offset, w in enumerate(wires[:WIRES_PER_BLOCK]):
            ws[f"L{start + offset}"] = f"G{gid}-N{w.lug_node_id}"
            ws[f"X{start + offset}"] = round(w.tension_ton, 3)
            if w.vertical_ton is not None:
                reaction += w.vertical_ton
                has_reaction = True
            else:
                warnings.append(f"그룹 {gid}, Lug {w.lug_node_id}의 슬링각이 없어 반력을 기록하지 못했습니다.")
        if has_reaction:
            ws[f"R{start}"] = round(reaction, 3)


# ── 이미지 ───────────────────────────────────────────────────────────────────
def _replace_images(ws, figs: dict[str, bytes], has_support: bool, warnings: list[str]):
    """서식의 캡처 자리(이미지 3~8)를 새 3D 렌더로 갈아끼운다. 앞 3개 로고는 보존."""
    from openpyxl.drawing.image import Image as XLImage

    existing = list(ws._images)
    if len(existing) < LOGO_COUNT + len(IMAGE_SLOTS):
        raise ValueError(f"서식의 이미지 자리 수가 예상과 다릅니다 "
                         f"(expected >= {LOGO_COUNT + len(IMAGE_SLOTS)}, got {len(existing)}).")
    logos = existing[:LOGO_COUNT]
    if not has_support:
        logos = [im for im in logos if im.anchor._from.row < SUPPORT_PAGE_FIRST_ROW - 1]
    placeholders = existing[LOGO_COUNT:LOGO_COUNT + len(IMAGE_SLOTS)]
    ws._images = logos

    slots = IMAGE_SLOTS if has_support else IMAGE_SLOTS[:4]
    for key, placeholder in zip(slots, placeholders):
        png = figs.get(key)
        if png is None:
            warnings.append(f"{key} 캡처가 없어 해당 자리를 비웠습니다.")
            continue
        image = XLImage(io.BytesIO(png))
        image.width, image.height = _contain(image.width, image.height, placeholder.width, placeholder.height)
        image.anchor = copy.copy(placeholder.anchor)
        ws.add_image(image)


def _contain(w: float, h: float, max_w: float, max_h: float) -> tuple[int, int]:
    """비율을 유지한 채 서식 자리 안에 들어가게 축소한다(왜곡 없음)."""
    if w <= 0 or h <= 0:
        return (int(max_w), int(max_h))
    scale = min(max_w / w, max_h / h)
    return (max(1, int(w * scale)), max(1, int(h * scale)))


# ── 서포트 페이지 삭제 ────────────────────────────────────────────────────────
def _drop_support_page(ws):
    """가서포트가 없으면 3페이지를 통째로 지운다(사용자 결정)."""
    ws.delete_rows(SUPPORT_PAGE_FIRST_ROW, SUPPORT_PAGE_LAST_ROW - SUPPORT_PAGE_FIRST_ROW + 1)
    # RowBreak.count 는 읽기 전용이라 brk 리스트만 갈아끼운다(count 는 파생 값).
    ws.row_breaks.brk = [b for b in ws.row_breaks.brk if b.id != SUPPORT_PAGE_BREAK_ID]
    area = ws.print_area[0] if isinstance(ws.print_area, list) and ws.print_area else ws.print_area
    if area:
        ws.print_area = re.sub(r"\$\d+$", f"${SUPPORT_PAGE_FIRST_ROW - 1}", area)


def _safe(v) -> str:
    return re.sub(r'[<>:"/\\|?*\s]+', "_", str(v or "unknown")).strip("_.") or "unknown"
