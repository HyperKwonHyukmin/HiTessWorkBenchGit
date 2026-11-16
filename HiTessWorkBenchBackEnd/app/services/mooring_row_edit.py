"""Mooring Fitting — 구조 CSV 행 단위 단면·재질 편집.

Studio 는 부재 하나가 아니라 CSV 행을 고친다. 한 행이 여러 요소로 쪼개져 있어 부재마다 고치면
같은 행의 조각끼리 단면이 달라지고, 바뀐 값을 CSV 로 되돌려 Aveva Marine 에 넣을 수도 없다.

대상 요소는 화면이 보낸 번호가 아니라 엔진의 출신 기록(MODEL_EVIDENCE.json)으로 찾는다.
새 PBEAML 치수는 기존 치수에서 CSV 값이 정하는 칸만 바꿔 만든다 — 유효폭·갑판 두께는 CSV 칸과
1:1 이 아니어서 다시 계산하면 엔진(PbeamlDimMapper)과 어긋난다.

부식 마진(2026-11-12): 엔진이 구조 CSV 'corrosion' 값(tc, mm)을 모든 판 두께에서 빼고 단면을 만든다.
여기서 새 치수를 만들 때도 두께 칸에서 같은 tc 를 빼야 한다 — 빼지 않으면 '이 행의 단면인가' 검사가
모든 행에서 거짓이 되어 크기 편집이 조용히 건너뛰어진다. tc 의 원본은 MODEL_EVIDENCE caseFacts.corrosionMm
(없으면 옛 결과 = 총두께 BDF 라 0). Studio utils/sectionSketch.js rowDims 가 이 규칙의 사본이다.

등급 → 항복강도는 여기서 정하지 않는다. 바뀐 등급 글자만 <bdf 이름>.grades.json 으로 넘기고
엔진 SteelGrade 가 해석·보고서 양쪽에서 같은 규칙으로 읽는다.
"""
import json
import os

INTENT_KIND = "editCsvRow"
STRUCTURE_CSV = "MooringFittingData.csv"
EVIDENCE_FILE = "MODEL_EVIDENCE.json"

# 행 형식별 편집 칸 (0부터 센 칸, 화면 이름). 등급 칸 위치는 엔진 StructureCsvParser 와 같아야 한다.
_ANGLE_SIZES = [(2, "웹 높이"), (3, "웹 두께"), (4, "플랜지 폭"), (5, "플랜지 두께")]
_FLATBAR_SIZES = [(2, "웹 높이"), (3, "웹 두께")]
_PLATE_BELOW_SIZES = [(4, "높이"), (5, "두께")]
_PLATE_ABOVE_SIZES = [(15, "두께")]
_STIFFENER_GRADES = [(6, "보강재 등급"), (26, "부착판 등급")]
# PBEAML 은 8칸 표기라 CSV 값과 끝자리가 다를 수 있다.
_DIM_TOLERANCE = 0.1


def _layout(parts: list[str]):
    """(크기 칸, 등급 칸). 편집 대상이 아닌 행이면 None."""
    kind = parts[0].strip().upper()
    if kind in ("ANGLE", "TBAR"):
        return _ANGLE_SIZES, _STIFFENER_GRADES
    if kind == "FLATBAR":
        return _FLATBAR_SIZES, _STIFFENER_GRADES
    if kind in ("PLATE", "BRACKET") and len(parts) > 2:
        if parts[2].strip().lower() == "below":
            return _PLATE_BELOW_SIZES, [(6, "등급")]
        return _PLATE_ABOVE_SIZES, [(16, "등급")]
    return None


def read_csv_rows(case_dir: str) -> dict[int, dict]:
    """구조 CSV 의 부재 행을 {행 번호: 정보} 로 읽는다. 행 번호는 엔진과 같은 1부터."""
    path = os.path.join(case_dir, STRUCTURE_CSV)
    with open(path, "r", encoding="utf-8-sig", errors="replace", newline="") as fh:
        lines = fh.read().split("\n")

    rows = {}
    for number, raw in enumerate(lines, start=1):
        raw = raw.rstrip("\r")
        parts = raw.split(",")
        layout = _layout(parts) if len(parts) > 1 else None
        if layout is None:
            continue
        sizes, grades = layout
        rows[number] = {
            "kind": parts[0].strip().upper(),
            "name": parts[1].strip(),
            "cells": parts,
            "sizeCells": [{"cell": c, "label": label} for c, label in sizes if c < len(parts)],
            "gradeCells": [{"cell": c, "label": label} for c, label in grades if c < len(parts)],
        }
    return rows


def read_csv_lines(case_dir: str) -> list[list[str]]:
    """구조 CSV 의 모든 줄을 칸 그대로. i 번째 = (i+1)행 — 엑셀 행 번호와 같다. 끝의 빈 줄은 뺀다.

    Studio '구조 CSV' 표가 머리글·corrosion·MF 줄까지 원문 그대로 보이는 데 쓴다.
    """
    path = os.path.join(case_dir, STRUCTURE_CSV)
    with open(path, "r", encoding="utf-8-sig", errors="replace", newline="") as fh:
        lines = [raw.rstrip("\r").split(",") for raw in fh.read().split("\n")]
    while lines and not any(c.strip() for c in lines[-1]):
        lines.pop()
    return lines


def _elements_by_line(out_dir: str) -> dict[int, list[int]]:
    path = os.path.join(out_dir, EVIDENCE_FILE)
    if not os.path.isfile(path):
        raise ValueError("이 결과는 부재 출신 기록이 없어 행 편집을 할 수 없습니다. 모델을 다시 생성하세요.")
    with open(path, "r", encoding="utf-8") as fh:
        elements = json.load(fh).get("elements") or []
    by_line: dict[int, list[int]] = {}
    for el in elements:
        origin = el.get("origin") or {}
        if origin.get("kind") == "derived" and origin.get("csvLine"):
            by_line.setdefault(origin["csvLine"], []).append(el.get("elementId"))
    return by_line


def corrosion_info(out_dir: str) -> dict:
    """엔진이 단면에서 뺀 부식 마진. {"mm": 값, "source": "csv" | "missing" | "unknown"}.

    csv = 구조 CSV corrosion 줄 값을 뺌 · missing = 그 줄이 없어 총두께 · unknown = 부식 마진을 기록하기 전
    엔진의 결과(총두께로 만든 BDF 라 mm = 0 으로 계산하면 맞다).
    """
    path = os.path.join(out_dir, EVIDENCE_FILE)
    try:
        with open(path, "r", encoding="utf-8") as fh:
            facts = json.load(fh).get("caseFacts") or {}
    except (OSError, ValueError):
        return {"mm": 0.0, "source": "unknown"}
    source = facts.get("corrosionSource")
    if source not in ("csv", "missing"):
        return {"mm": 0.0, "source": "unknown"}
    try:
        return {"mm": float(facts.get("corrosionMm") or 0.0), "source": source}
    except (TypeError, ValueError):
        return {"mm": 0.0, "source": "unknown"}


def corrosion_mm(out_dir: str) -> float:
    """엔진이 단면에서 뺀 부식 마진(mm). 기록이 없는 옛 결과·corrosion 줄이 없는 입력은 0."""
    return corrosion_info(out_dir)["mm"]


def _new_dims(row: dict, prop: dict, cells: list[str], corrosion: float = 0.0) -> list[float]:
    """기존 PBEAML 치수에서 CSV 값이 정하는 칸만 바꾼다. 칸 순서는 엔진 PbeamlDimMapper.

    두께 칸은 부식 마진(corrosion, mm)을 뺀 순두께로 넣는다. 갑판 두께(dims 의 갑판 칸)는
    엔진이 이미 순두께로 만든 값을 그대로 쓴다.
    """
    size = lambda i: float(cells[i])   # noqa: E731

    def net(i: int) -> float:
        value = size(i) - corrosion
        if value <= 0:
            raise ValueError(f"{i}번 칸 두께 {cells[i]} mm 에서 부식 마진 {corrosion:g} mm 를 빼면 0 이하입니다.")
        return value

    dims = [float(v) for v in prop.get("dims") or []]
    kind = str(prop.get("kind") or "").upper()
    row_kind = row["kind"]
    below = row["cells"][2].strip().lower() == "below"
    if row_kind in ("ANGLE", "TBAR") and kind == "I" and len(dims) >= 6:
        dims[0], dims[1], dims[3], dims[4] = size(2) + dims[5], size(4), net(3), net(5)
    elif row_kind == "FLATBAR" and kind == "T" and len(dims) >= 4:
        dims[1], dims[3] = size(2) + dims[2], net(3)
    elif row_kind in ("PLATE", "BRACKET") and below and kind == "T" and len(dims) >= 4:
        # 2026-11-03 부터 PLATE below = T(갑판 + 판, 면재 없음) = [유효폭, 갑판+높이, 갑판, 두께]
        dims[1], dims[3] = size(4) + dims[2], net(5)
    elif row_kind in ("PLATE", "BRACKET") and below and kind == "I" and len(dims) >= 6:
        # 옛 결과 — 면재 90×10 을 붙인 I
        dims[0], dims[3] = dims[4] + size(4) + dims[5], net(5)
    elif row_kind in ("PLATE", "BRACKET") and not below and kind == "T" and len(dims) >= 4:
        dims[3] = net(15)
    else:
        raise ValueError(f"{row_kind} 행의 단면(PID {prop.get('id')}, {kind})을 바꿀 수 없습니다.")
    return dims


def _section_is_from_row(row: dict, prop: dict, corrosion: float = 0.0) -> bool:
    """이 단면이 이 행의 치수로 만들어졌는가.

    겹친 부재를 합칠 때(01_CollinearOverlap) 요소가 다른 행의 단면을 물려받는 경우가 있다
    (NewCase_02 1,748개 중 86개). 그런 요소에 이 행의 칸을 대입하면 엉뚱한 치수가 나오므로
    행의 원래 값으로 다시 계산해 지금 단면과 같을 때만 이 행의 단면으로 본다.
    """
    try:
        expected = _new_dims(row, prop, row["cells"], corrosion)
    except (ValueError, IndexError):
        return False
    current = [float(v) for v in prop.get("dims") or []]
    return all(abs(a - b) < _DIM_TOLERANCE for a, b in zip(expected, current))


def _duplicate_rows(out_dir: str) -> dict[int, int]:
    """엔진이 '다른 행과 모든 칸이 같아' 뺀 행 → 앞 행 번호. CSV_Parse_Skips.csv 의 DuplicateRow 묶음."""
    path = os.path.join(out_dir, "CSV_Parse_Skips.csv")
    if not os.path.isfile(path):
        return {}
    import csv
    import re
    out: dict[int, int] = {}
    with open(path, "r", encoding="utf-8-sig", errors="replace", newline="") as fh:
        for rec in csv.DictReader(fh):
            if (rec.get("RowType") or "") != "DuplicateRow":
                continue
            m = re.match(r"\s*(\d+)행", rec.get("Reason") or "")
            for part in (rec.get("LineNumbers") or "").split(";"):
                if part.strip().isdigit() and m:
                    out[int(part)] = int(m.group(1))
    return out


def annotate_row_sections(rows: dict, out_dir: str, model: dict) -> None:
    """행마다 크기를 바꿀 수 있는 요소 수(ownElements)와 없는 요소 수(foreignElements)를 적는다."""
    duplicates = _duplicate_rows(out_dir)
    by_line = _elements_by_line(out_dir)
    corrosion = corrosion_mm(out_dir)
    elements = {e.get("id"): e for e in model.get("elements") or []}
    props = {p.get("id"): p for p in model.get("properties") or []}
    for line, row in rows.items():
        own = foreign = 0
        for eid in by_line.get(line, []):
            prop = props.get((elements.get(eid) or {}).get("propertyId"))
            if prop is not None:
                if _section_is_from_row(row, prop, corrosion):
                    own += 1
                else:
                    foreign += 1
        row["ownElements"], row["foreignElements"] = own, foreign
        if line in duplicates:
            row["duplicateOf"] = duplicates[line]


def _find_or_add_property(edited: dict, source: dict, dims: list[float]) -> int:
    props = edited.setdefault("properties", [])
    for p in props:
        if (p.get("card") == source.get("card") and p.get("kind") == source.get("kind")
                and p.get("materialId") == source.get("materialId")
                and [float(v) for v in p.get("dims") or []] == dims):
            return p["id"]
    new_id = max(int(p["id"]) for p in props) + 1
    props.append({**source, "id": new_id, "dims": dims})
    return new_id


def is_row_edit(intent: dict) -> bool:
    return isinstance(intent, dict) and intent.get("kind") == INTENT_KIND


def apply_row_edits(edited: dict, intents: list[dict], out_dir: str) -> dict:
    """edited 모델에 행 편집을 반영한다. 입력이 잘못되면 ValueError(사유는 사용자에게 보인다).

    반환: {"rows": 적용한 행 수, "gradeOverrides": {요소 번호: [등급 칸들]},
           "skippedElements": 다른 행 단면이라 크기를 안 바꾼 요소 수}
    """
    rows = read_csv_rows(os.path.dirname(os.path.normpath(out_dir)))
    by_line = _elements_by_line(out_dir)
    corrosion = corrosion_mm(out_dir)
    elements = {e.get("id"): e for e in edited.get("elements") or []}
    props = {p.get("id"): p for p in edited.get("properties") or []}
    overrides: dict[str, list[str]] = {}
    skipped = 0

    for intent in intents:
        params = intent.get("params") or {}
        line = params.get("csvLine")
        row = rows.get(line)
        if row is None:
            raise ValueError(f"CSV {line}행은 편집할 수 있는 부재 행이 아닙니다.")

        size_cells = [c["cell"] for c in row["sizeCells"]]
        grade_cells = [c["cell"] for c in row["gradeCells"]]
        cells = list(row["cells"])
        for key, value in (params.get("cells") or {}).items():
            index = int(key)
            if index not in size_cells and index not in grade_cells:
                raise ValueError(f"CSV {line}행의 {index}번 칸은 편집할 수 없습니다.")
            cells[index] = str(value).strip()

        size_changed = False
        for index in size_cells:
            try:
                value = float(cells[index])
            except ValueError:
                raise ValueError(f"CSV {line}행의 {index}번 칸 값이 숫자가 아닙니다: {cells[index]!r}")
            if value <= 0:
                raise ValueError(f"CSV {line}행의 {index}번 칸은 0보다 커야 합니다: {cells[index]}")
            size_changed = size_changed or value != float(row["cells"][index])
        grade_changed = any(cells[c] != row["cells"][c].strip() for c in grade_cells)

        targets = [eid for eid in by_line.get(line, []) if eid in elements]
        if not targets:
            raise ValueError(f"CSV {line}행의 부재가 모델에 남아 있지 않습니다.")
        # 같은 단면으로 복제한 보강 부재와 부재 나누기 조각(splitOf, 2026-11-12)은 원본을 따라간다.
        # 나눈 조각을 다시 나눌 수 있어 더 늘지 않을 때까지 따라간다. 다른 단면을 복사해 넣은 것은 그대로 둔다.
        target_set = set(targets)
        grew = True
        while grew:
            grew = False
            for eid, el in elements.items():
                if eid in target_set:
                    continue
                source = el.get("reinforceOf", el.get("splitOf"))
                if source in target_set and el.get("propertyId") == elements[source].get("propertyId"):
                    targets.append(eid)
                    target_set.add(eid)
                    grew = True

        if size_changed:
            own = [eid for eid in targets
                   if _section_is_from_row(row, props[elements[eid].get("propertyId")], corrosion)]
            if not own:
                raise ValueError(f"CSV {line}행의 부재는 모두 다른 행과 합쳐진 단면이라 크기를 바꿀 수 없습니다.")
            skipped += len(targets) - len(own)
            for eid in own:
                prop = props[elements[eid].get("propertyId")]
                new_id = _find_or_add_property(edited, prop, _new_dims(row, prop, cells, corrosion))
                elements[eid]["propertyId"] = new_id
                props = {p.get("id"): p for p in edited["properties"]}
        if grade_changed:
            grades = [cells[c] for c in grade_cells]
            for eid in targets:
                overrides[str(eid)] = grades

    return {"rows": len(intents), "gradeOverrides": overrides, "skippedElements": skipped}


def _member_grades(out_dir: str) -> dict[int, list[str]]:
    """엔진 재질표(MEMBER_MATERIAL.json) → 요소 번호: [보강재 등급, 부착판 등급]."""
    path = os.path.join(out_dir, "MEMBER_MATERIAL.json")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            members = json.load(fh).get("elements") or {}
    except (OSError, ValueError):
        return {}
    out: dict[int, list[str]] = {}
    for eid, m in members.items():
        try:
            out[int(eid)] = [str(m.get("grade") or ""), str(m.get("plateGrade") or m.get("grade") or "")]
        except (TypeError, ValueError):
            continue
    return out


def new_member_grade_overrides(edited: dict, base_ids: set, intents: list, out_dir: str) -> dict[str, list[str]]:
    """부재 나누기 조각·새 부재의 등급(2026-11-12). 엔진 재질표에 없는 번호라 그냥 두면 235 '등급 미확인' 이 된다.

    나눈 조각 = 원래 부재 등급 · 새 부재 = 화면에서 고른 등급(addElement params.grades), 없으면 참조 부재 등급.
    출처가 다시 편집으로 생긴 요소면 사슬을 따라 원본 부재까지 간다. 반환 = write_grade_overrides 형식.
    """
    chosen = {}
    for intent in intents:
        params = intent.get("params") or {}
        if intent.get("kind") == "addElement" and isinstance(params.get("grades"), list) and params.get("elementId") is not None:
            chosen[int(params["elementId"])] = [str(g or "") for g in params["grades"]][:2]
    table = _member_grades(out_dir)
    elements = {e.get("id"): e for e in edited.get("elements") or []}
    out: dict[str, list[str]] = {}
    for eid, el in elements.items():
        if eid in base_ids:
            continue
        # 참조 복사(보강) 클론은 넣지 않는다 — 엔진이 grades.json 을 먼저 적용한 뒤 model.json 의 reinforceOf 로
        # 원본의 '지금' 등급(행 등급 편집, 새 부재에서 고른 등급 포함)을 물려준다. 여기서 편집 전 등급을 박으면
        # 행 등급을 바꿔도 클론만 옛 등급으로 판정됐다(커밋 전 리뷰 2026-11-16).
        if el.get("reinforceOf") is not None:
            continue
        if eid in chosen:
            out[str(eid)] = chosen[eid]
            continue
        cur, seen = el, set()
        while cur is not None:
            src = cur.get("splitOf", cur.get("addedFrom", cur.get("reinforceOf")))
            if src is None or src in seen:
                break
            if src in chosen:
                out[str(eid)] = chosen[src]
                break
            if src in table and src in base_ids:
                out[str(eid)] = table[src]
                break
            seen.add(src)
            cur = elements.get(src)
        # 사슬이 중간에서 끊겼으면(조각이 그룹 삭제로 지워짐) 원래 부재 번호로 찾는다(커밋 전 리뷰).
        origin = el.get("originElementId")
        if str(eid) not in out and origin in table and origin in base_ids:
            out[str(eid)] = table[origin]
    return out


def write_grade_overrides(solve_bdf_path: str, overrides: dict) -> None:
    """엔진이 읽는 <bdf 이름>.grades.json. 등급 편집이 없으면 이전 실행의 파일을 지운다."""
    path = os.path.splitext(solve_bdf_path)[0] + ".grades.json"
    if overrides:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"overrides": overrides}, fh, ensure_ascii=False)
    elif os.path.isfile(path):
        os.remove(path)
