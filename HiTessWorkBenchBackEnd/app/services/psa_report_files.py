"""PSA 평가보고서 — Line 폴더 안에서 보고서에 필요한 파일을 찾는다(체크리스트).

보고서 생성이 쓰는 파일 종류(kind):
  restraint        CAESAR II Restraint Summary Extended 내보내기(xlsx) → 6.x 최대 반력, 모멘트, 변위 표
  codeCompliance   CAESAR II Code Compliance 내보내기(xlsx)          → 6.x Stress summary 표
                   (Line 폴더에 Code Compliance 파일이 없으면 'Stress Summary (Legacy)' 시트가 든 엑셀을 후보로 —
                    3441 Line 별 묶음 엑셀은 Restraint 와 Legacy 시트가 한 파일에 있다. 2026-11-19)
  iso              Isometric drawing PDF                               → 부록 Isometric Drawings
  inputEcho        CAESAR II Input Echo PDF                            → 부록 CAESAR II Input Echo
  nozzleCompressor / nozzleHeatExchanger  노즐 검토 엑셀(COMP.RM 만)   → 7장 노즐 표

엑셀은 이름이 아니라 시트 이름으로 판별한다(3441 TD03 의 Code Compliance 파일 이름이 '222222.xlsx' 였다).
시트 이름은 zip 안 xl/workbook.xml 만 읽는다 — 엑셀을 통째로 열면 폴더 하나(엑셀 80개)에 수십 초가 걸린다.
규칙 원본 = 이 모듈. 화면 표시 이름은 프론트 utils/psaReport.js CHECKLIST_KINDS(사본).
계획: docs/plans/2026-11-17-psa-report-automation-plan.md
"""
from __future__ import annotations

import os
import re
import zipfile
from typing import Dict, List

KINDS = ("restraint", "codeCompliance", "iso", "inputEcho", "nozzleCompressor", "nozzleHeatExchanger")
_DRM_MAGIC = b"HHIDRMC"
_SHEET_RE = re.compile(rb'<sheet\b[^>]*\bname="([^"]*)"')
_TEMP_RE = re.compile(r"(^~\$)|(\.tmp$)", re.IGNORECASE)
# 손 계산 중간본(원본 내보내기를 복사해 정리한 것) — 원본이 아니므로 후보에서 뺀다.
_HAND_CALC_NAME = re.compile(r"수계산")
_HAND_CALC_SHEET = "결과값 정리"


def xlsx_sheet_names(path: str) -> List[str] | None:
    """xlsx 시트 이름 목록. 읽을 수 없으면(DRM 암호문, 깨진 파일) None."""
    try:
        with open(path, "rb") as f:
            head = f.read(7)
        if head.startswith(_DRM_MAGIC) or not head.startswith(b"PK"):
            return None
        with zipfile.ZipFile(path) as z:
            xml = z.read("xl/workbook.xml")
        return [m.decode("utf-8", "replace").replace("&amp;", "&") for m in _SHEET_RE.findall(xml)]
    except (OSError, KeyError, zipfile.BadZipFile):
        return None


def classify_file(rel_path: str, abs_path: str) -> str | None:
    """파일 하나 → kind 또는 None."""
    name = os.path.basename(rel_path)
    low = name.lower()
    if _TEMP_RE.search(name):
        return None
    if low.endswith(".pdf"):
        if "input echo" in low or "input_echo" in low or "inputecho" in low:
            return "inputEcho"
        if re.search(r"(^|[^a-z])iso([^a-z]|$)", low):
            return "iso"
        return None
    if not low.endswith(".xlsx"):
        return None
    if "nozzle" in low:
        if "압축기" in name or "compressor" in low:
            return "nozzleCompressor"
        if "열교환기" in name or "exchanger" in low:
            return "nozzleHeatExchanger"
    sheets = xlsx_sheet_names(abs_path)
    if not sheets:
        return None
    lowered = [s.strip().lower() for s in sheets]
    if "restraint summary extended" in lowered:
        if _HAND_CALC_NAME.search(name) or _HAND_CALC_SHEET in sheets:
            return None
        return "restraint"
    if "code compliance" in lowered:
        return "codeCompliance"
    return None


_LEGACY_SHEET = "stress summary (legacy)"


def legacy_stress_file(rel_path: str, abs_path: str) -> bool:
    """Code Compliance 대신 쓸 수 있는 엑셀(Stress Summary (Legacy) 시트, 손 계산본 아님)."""
    name = os.path.basename(rel_path)
    if _TEMP_RE.search(name) or not name.lower().endswith(".xlsx") or _HAND_CALC_NAME.search(name):
        return False
    sheets = xlsx_sheet_names(abs_path) or []
    lowered = [s.strip().lower() for s in sheets]
    return _LEGACY_SHEET in lowered and "code compliance" not in lowered and _HAND_CALC_SHEET not in sheets


_MONTHS = {m: i for i, m in enumerate(
    ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"), start=1)}
_HEAD_DATE_RE = re.compile(r"Date:\s*([A-Z]{3})\s+(\d{1,2}),\s*(\d{4})\s+Time:\s*(\d{1,2}):(\d{1,2})")
_HEAD_VER_RE = re.compile(r"Ver\.?\s*([\d.]+)")
_CASE_RE = re.compile(r"^CASE\s+\d+\s*\(")
_HULL_RE = re.compile(r"^\s*(\d{4})")


def caesar_xlsx_meta(path: str, kind: str) -> Dict[str, object]:
    """CAESAR II 내보내기 엑셀의 머리글 정보 — 후보를 파일명이 아니라 내용으로 고르게.
    { version, exportedAt('YYYY-MM-DDTHH:MM'), job, jobHull(앞 4자리 숫자), loadCases, supports(restraint 만) }
    """
    import openpyxl  # 지연 import(이 모듈을 쓰지 않는 경로의 기동 시간에 영향 없게)
    meta: Dict[str, object] = {}
    try:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        # 그 종류의 시트를 이름으로(묶음 엑셀은 시트 순서가 파일마다 다르다 — 3441 TD-04~06 은 Legacy 가 첫 시트)
        want = {"restraint": ("restraint summary extended",),
                "codeCompliance": ("code compliance", "stress summary (legacy)")}.get(kind, ())
        by_name = {w.title.strip().lower(): w for w in wb.worksheets}
        ws = next((by_name[n] for n in want if n in by_name), wb.worksheets[0])
        cases = supports = 0
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            a = row[0] if row else None
            s = str(a).strip() if a is not None else ""
            if i == 0:
                m = _HEAD_DATE_RE.search(s)
                if m and m.group(1).upper() in _MONTHS:
                    mon = _MONTHS[m.group(1).upper()]
                    meta["exportedAt"] = f"{m.group(3)}-{mon:02d}-{int(m.group(2)):02d}T{int(m.group(4)):02d}:{int(m.group(5)):02d}"
                v = _HEAD_VER_RE.search(s)
                if v:
                    meta["version"] = v.group(1)
            if s.startswith("Job Name"):
                job = s.split(":", 1)[1].strip() if ":" in s else ""
                meta["job"] = job
                h = _HULL_RE.match(job)
                if h:
                    meta["jobHull"] = h.group(1)
            elif _CASE_RE.match(s):
                cases += 1
            elif kind == "restraint" and isinstance(a, (int, float)) and len(row) > 2 \
                    and isinstance(row[2], str) and row[2].startswith("TYPE=") and "Displ. Reaction" not in row[2]:
                supports += 1
        wb.close()
        meta["loadCases"] = cases
        if kind == "restraint":
            meta["supports"] = supports
    except Exception:  # 머리글을 못 읽어도 후보에서는 빼지 않는다
        meta["error"] = "unreadable"
    return meta


def pdf_meta(path: str) -> Dict[str, object]:
    try:
        import fitz
        with fitz.open(path) as doc:
            return {"pages": doc.page_count}
    except Exception:
        return {}


def file_meta(abs_path: str, kind: str) -> Dict[str, object]:
    st = os.stat(abs_path)
    meta: Dict[str, object] = {"size": st.st_size}
    if kind in ("restraint", "codeCompliance"):
        meta.update(caesar_xlsx_meta(abs_path, kind))
    elif abs_path.lower().endswith(".pdf"):
        meta.update(pdf_meta(abs_path))
    return meta


def scan_target(target_dir: str, with_meta: bool = True) -> Dict[str, object]:
    """Line 폴더 하나 → { kinds: {kind: [상대경로…]}, meta: {상대경로: {...}}, unreadable: [DRM 등으로 못 읽은 xlsx] }"""
    kinds: Dict[str, List[str]] = {k: [] for k in KINDS}
    meta: Dict[str, Dict[str, object]] = {}
    unreadable: List[str] = []
    legacy: List[str] = []
    for root, _dirs, files in os.walk(target_dir):
        for fn in files:
            abs_path = os.path.join(root, fn)
            rel = os.path.relpath(abs_path, target_dir).replace(os.sep, "/")
            kind = classify_file(rel, abs_path)
            if kind:
                kinds[kind].append(rel)
                if with_meta:
                    meta[rel] = file_meta(abs_path, kind)
            elif fn.lower().endswith(".xlsx") and not _TEMP_RE.search(fn) and xlsx_sheet_names(abs_path) is None:
                unreadable.append(rel)
            if kind in (None, "restraint") and legacy_stress_file(rel, abs_path):
                legacy.append(rel)
                if with_meta and rel not in meta:
                    meta[rel] = file_meta(abs_path, "codeCompliance")
    # 진짜 Code Compliance 내보내기가 있으면 그것만(Legacy 는 소수 1자리 요약이라 대신일 뿐)
    if not kinds["codeCompliance"]:
        kinds["codeCompliance"] = legacy
    for k in kinds:
        kinds[k].sort(key=lambda p: p.lower())
    return {"kinds": kinds, "meta": meta, "unreadable": sorted(unreadable)}
