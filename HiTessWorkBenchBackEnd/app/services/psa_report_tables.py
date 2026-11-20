"""PSA 평가보고서 — CAESAR II 엑셀에서 보고서 표 값을 뽑는다.

- Restraint Summary Extended → 6.x 'Maximum Forces and Moments and Displacement' 표
  힘, 모멘트 = 지지 Node 의 MAX 줄(CAESAR 가 고른 값) ÷ 1000(N → kN, N·m → kN·m).
  변위 = 하중 경우마다 Node − 연결 Node(Cnode, 바로 다음 'Displ. Reaction' 블록), 그중 최대(+)와 최소(−).
         부호가 맞지 않으면 0(+ 칸에 음수가 오지 않게).
  3441 R2 보고서와 대조: TD03 263/263, TD06-2~4 전부 일치. 다른 줄은 보고서를 손으로 고친 자리(수계산 값).
- Code Compliance → 6.x 'Stress summary' 표
  하중 경우(CASE k → Lk)마다 응력비가 가장 큰 요소의 응력, 허용응력, 응력비. TD03 18줄 모두 일치.
  Code Compliance 시트가 없으면 'Stress Summary (Legacy)' 시트(CAESAR 가 경우마다 고른 최고 응력비 블록)를 읽는다
  (2026-11-19, 3441 Line 별 묶음 엑셀 TD-01~06 — 소수 1자리, TD01 은 R2 와 20줄 중 16줄 같음).
"""
from __future__ import annotations

import io
import re

import openpyxl

RESTRAINT_SHEET = "Restraint Summary Extended"
COMPLIANCE_SHEET = "Code Compliance"
LEGACY_STRESS_SHEET = "Stress Summary (Legacy)"

_CASE_ROW = re.compile(r"^\s*(\d+)\((\w+)\)\s*$")
_CC_CASE_HEAD = re.compile(r"^CASE\s+(\d+)\s*\((\w+)\)")
_LG_HEAD = re.compile(r"^Highest Stresses:.*?LOADCASE\s+(\d+)\s*\(", re.IGNORECASE)
_LG_RATIO = re.compile(r"^Ratio\s*\(%\)\s*:\s*([-\d.]+)", re.IGNORECASE)
_LG_CODE = re.compile(r"^Code Stress\s*:\s*([-\d.]+)\s+Allowable Stress\s*:\s*([-\d.]+)", re.IGNORECASE)


def _open(path: str):
    # 회사 DRM: 백엔드 프로세스가 read() 로 받은 바이트는 평문이다(경로를 넘기면 다른 경로로 읽을 수 있어 바이트로)
    with open(path, "rb") as f:
        data = f.read()
    return openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)


def _sheet(wb, name: str):
    for ws in wb.worksheets:
        if ws.title.strip().lower() == name.lower():
            return ws
    raise ValueError(f"'{name}' 시트가 없습니다")


def _num(v):
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).split("/")[0])
    except (TypeError, ValueError):
        return None


def restraint_rows(path: str) -> list[list]:
    """[[node, Fx, Fy, Fz, Mx, My, Mz, +Dx, -Dx, +Dy, -Dy, +Dz, -Dz], …] 파일 순서 그대로."""
    wb = _open(path)
    try:
        ws = _sheet(wb, RESTRAINT_SHEET)
        blocks = []
        cur = None
        for row in ws.iter_rows(values_only=True):
            if not row:
                continue
            a = row[0]
            b = row[1] if len(row) > 1 else None
            c = row[2] if len(row) > 2 else None
            if isinstance(a, (int, float)) and b is None and isinstance(c, str) and c.startswith("TYPE="):
                cur = {"node": int(a), "type": c[5:].strip().rstrip(";"), "cases": {}, "max": None}
                blocks.append(cur)
                continue
            if cur is None or not isinstance(b, str):
                continue
            m = _CASE_ROW.match(b)
            if m:
                cur["cases"][int(m.group(1))] = [v if isinstance(v, (int, float)) else None for v in row[2:11]]
            elif b.strip() == "MAX":
                cur["max"] = [_num(v) for v in row[2:11]]
    finally:
        wb.close()

    out = []
    for i, blk in enumerate(blocks):
        if blk["type"].startswith("Displ. Reaction"):
            continue
        nxt = blocks[i + 1] if i + 1 < len(blocks) else None
        cn = nxt if nxt and nxt["type"].startswith("Displ. Reaction") else None
        cases = sorted(blk["cases"])
        forces = []
        for j in range(6):
            if blk["max"] and blk["max"][j] is not None:
                forces.append(blk["max"][j])
                continue
            vals = [blk["cases"][k][j] for k in cases if blk["cases"][k][j] is not None]
            forces.append(max(vals, key=abs) if vals else 0.0)
        disp = []
        for j in range(6, 9):
            rel = []
            for k in cases:
                nv = blk["cases"][k][j]
                if nv is None:
                    continue
                cv = cn["cases"].get(k, [None] * 9)[j] if cn else 0.0
                rel.append(nv - (cv or 0.0))
            rel = rel or [0.0]
            plus, minus = max(rel), min(rel)
            disp += [plus if plus > 0 else 0.0, minus if minus < 0 else 0.0]
        out.append([blk["node"]] + [f / 1000 for f in forces] + disp)
    return out


def _has_sheet(wb, name: str) -> bool:
    return any(ws.title.strip().lower() == name.lower() for ws in wb.worksheets)


def compliance_sheet(path: str) -> str:
    """응력 요약을 읽을 시트 이름 — Code Compliance 가 있으면 그것, 없으면 Legacy(검토용 출처 표시에 쓴다)."""
    wb = _open(path)
    try:
        return COMPLIANCE_SHEET if _has_sheet(wb, COMPLIANCE_SHEET) or not _has_sheet(wb, LEGACY_STRESS_SHEET) else LEGACY_STRESS_SHEET
    finally:
        wb.close()


def _legacy_rows(ws) -> list[dict]:
    """Stress Summary (Legacy): 'Highest Stresses … LOADCASE k' 블록마다 Ratio(%) 와 Code Stress / Allowable Stress."""
    out: dict[int, dict] = {}
    cur: dict[str, float] | None = None
    for row in ws.iter_rows(values_only=True):
        if not row or row[0] is None:
            continue
        s = str(row[0]).strip()
        m = _LG_HEAD.match(s)
        if m:
            cur = {"case": int(m.group(1))}
            continue
        if cur is None:
            continue
        m = _LG_RATIO.match(s)
        if m:
            cur["ratio"] = float(m.group(1))
            continue
        m = _LG_CODE.match(s)
        if m:
            cur["stress"], cur["allowable"] = float(m.group(1)), float(m.group(2))
        if {"ratio", "stress", "allowable"} <= cur.keys():
            out[int(cur["case"])] = cur
            cur = None
    return [{"case": f"L{k}", "stress": v["stress"], "allowable": v["allowable"], "ratio": v["ratio"]} for k, v in sorted(out.items())]


def compliance_rows(path: str) -> list[dict]:
    """[{case: 'L16', stress, allowable, ratio}, …] 하중 경우 번호 순. 응력비 = 그 경우에서 가장 큰 값.
    Code Compliance 시트가 없고 Stress Summary (Legacy) 가 있으면 그 시트로."""
    wb = _open(path)
    try:
        if not _has_sheet(wb, COMPLIANCE_SHEET) and _has_sheet(wb, LEGACY_STRESS_SHEET):
            return _legacy_rows(_sheet(wb, LEGACY_STRESS_SHEET))
        ws = _sheet(wb, COMPLIANCE_SHEET)
        best: dict[int, tuple] = {}
        for row in ws.iter_rows(values_only=True):
            if not row or row[0] is None:
                continue
            s = str(row[0]).strip()
            if _CC_CASE_HEAD.match(s):
                continue
            m = _CASE_ROW.match(s)
            if not m or len(row) < 9:
                continue
            k = int(m.group(1))
            # 한 줄에 요소 양 끝(From, To) 두 벌: (응력, 허용, 비) × 2
            for st, al, ra in ((row[2], row[3], row[4]), (row[6], row[7], row[8])):
                st, al, ra = _num(st), _num(al), _num(ra)
                if st is None or al is None or ra is None:
                    continue
                if k not in best or ra > best[k][0]:
                    best[k] = (ra, st, al)
    finally:
        wb.close()
    return [{"case": f"L{k}", "stress": v[1], "allowable": v[2], "ratio": v[0]} for k, v in sorted(best.items())]
