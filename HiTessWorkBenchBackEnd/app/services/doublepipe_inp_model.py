"""이중관 PSA 작업 폴더의 Abaqus 모델(inp)에서 Node 좌표와 Element 연결만 읽는다.

화면의 3D 배관 모델 위에서 'Node / Element 번호 찾기'에 쓴다. 엔진이 만든 inp 를 읽기만 하고
고치지 않는다(엔진은 외부 연구원 소유 — CLAUDE.md '이중관 연료배관 PSA').

엔진(ExportINP)의 출력 모양:
  *NODE                           →  id, x, y, z   (mm, 입력 CSV 와 같은 좌표계)
  *ELEMENT,TYPE=B32,ELSET=Line1   →  id, n1, n_mid, n2
  *ELEMENT,TYPE=ELBOW31B,ELSET=.. →  id, n1, n2, n_center(곡률 중심)
  *ELEMENT,TYPE=CONN3D2,ELSET=..  →  id, n1, n2     (U-bolt 연결)
  *BEAM SECTION, ELSET=Line1, MATERIAL= A312_TP316L_o, SECTION=PIPE  →  다음 줄 첫 값 = 반지름
      재질 이름 끝 _o = 외관, _i = 내관. 이것으로 요소마다 group(outer / inner / connector)을 붙인다.

⚠ 엔진은 해석 모델에서 외관을 내관 옆(Y 로 5 mm)으로 옮긴다 — 입력 CSV 는 두 관을 15000 mm 떨어뜨려 그린다.
  화면(입력 CSV 로 그린 3D)에 맞추는 이동은 프론트 utils/doublePipeFind.js 가 group 별로 계산한다.
"""
import os
import re

_LOAD_CASE_INP_RE = re.compile(r"^L\d+_", re.IGNORECASE)
_MAX_INP_BYTES = 200 * 1024 * 1024


def find_base_inp(job_dir: str) -> str | None:
    """작업 폴더에서 엔진이 처음 만든 모델 inp(<입력 CSV 이름>.inp)를 찾는다.

    하중 케이스별 사본(L1_OPE_….inp, *_iter01.inp)도 같은 메시라 기본 inp 가 없을 때만 대신 쓴다.
    """
    if not job_dir or not os.path.isdir(job_dir):
        return None
    names = sorted(os.listdir(job_dir))
    lower = {n.lower(): n for n in names}
    for name in names:
        stem, ext = os.path.splitext(name)
        if ext.lower() == ".csv":
            inp = lower.get(f"{stem}.inp".lower())
            if inp:
                return os.path.join(job_dir, inp)
    fallback = [
        n for n in names
        if n.lower().endswith(".inp") and not _LOAD_CASE_INP_RE.match(n) and "_iter" not in n.lower()
    ] or [n for n in names if n.lower().endswith(".inp")]
    return os.path.join(job_dir, fallback[0]) if fallback else None


def _keyword_params(line: str) -> tuple[str, dict]:
    parts = [p.strip() for p in line[1:].split(",")]
    keyword = parts[0].upper()
    params = {}
    for part in parts[1:]:
        if "=" in part:
            key, value = part.split("=", 1)
            params[key.strip().upper()] = value.strip()
    return keyword, params


def parse_inp_model(text: str) -> dict:
    """inp 글 → {"nodes": {id: [x, y, z]}, "elements": {id: {"type", "elset", "nodes"}}}."""
    nodes: dict[int, list[float]] = {}
    elements: dict[int, dict] = {}
    sections: dict[str, dict] = {}   # ELSET → {material, radius}
    pending_section = None
    section = None
    element_type = ""
    element_set = ""
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("**"):
            continue
        if line.startswith("*"):
            keyword, params = _keyword_params(line)
            if keyword == "NODE" and "NSET" not in params:
                section = "node"
            elif keyword == "BEAM SECTION" and params.get("ELSET"):
                section = "beam_section"
                pending_section = {"material": params.get("MATERIAL", ""), "radius": None}
                sections[params["ELSET"].upper()] = pending_section
            elif keyword == "ELEMENT":
                section = "element"
                element_type = params.get("TYPE", "").upper()
                element_set = params.get("ELSET", "")
            else:
                section = None
            continue
        if section is None:
            continue
        if section == "beam_section":
            if pending_section is not None and pending_section["radius"] is None:
                try:
                    pending_section["radius"] = float(line.split(",")[0])
                except ValueError:
                    pass
            continue
        fields = [f.strip() for f in line.split(",") if f.strip()]
        try:
            if section == "node" and len(fields) >= 4:
                nodes[int(fields[0])] = [float(fields[1]), float(fields[2]), float(fields[3])]
            elif section == "element" and len(fields) >= 3:
                elements[int(fields[0])] = {
                    "type": element_type,
                    "elset": element_set,
                    "nodes": [int(f) for f in fields[1:]],
                }
        except ValueError:
            continue
    _assign_groups(elements, sections)
    return {"nodes": nodes, "elements": elements}


def _assign_groups(elements: dict, sections: dict) -> None:
    """요소마다 group = outer | inner | connector | other.

    재질 이름 끝(_o, _i)이 먼저, 없으면 단면 반지름이 큰 쪽을 외관으로 본다.
    """
    radii = [s["radius"] for s in sections.values() if s.get("radius")]
    threshold = (max(radii) + min(radii)) / 2 if radii and max(radii) - min(radii) > 1e-6 else None
    for element in elements.values():
        if element["type"].startswith("CONN"):
            element["group"] = "connector"
            continue
        sec = sections.get(element["elset"].upper())
        material = (sec or {}).get("material", "").strip().lower()
        if material.endswith("_o"):
            group = "outer"
        elif material.endswith("_i"):
            group = "inner"
        elif sec and sec.get("radius") and threshold is not None:
            group = "outer" if sec["radius"] > threshold else "inner"
        elif sec and threshold is None:
            group = "outer"   # 관이 한 종류뿐이면 화면도 외관 하나로 그린다
        else:
            group = "other"
        element["group"] = group


def load_job_inp_model(job_dir: str) -> dict | None:
    """작업 폴더의 기본 inp 를 읽어 모델을 돌려준다. inp 가 없으면 None."""
    path = find_base_inp(job_dir)
    if not path:
        return None
    if os.path.getsize(path) > _MAX_INP_BYTES + 8192:
        raise ValueError("모델 파일(inp)이 너무 큽니다.")
    with open(path, "rb") as handle:
        data = handle.read()
    if data[:7] == b"HHIDRMC":
        raise ValueError("모델 파일(inp)이 회사 DRM 으로 암호화되어 읽을 수 없습니다.")
    model = parse_inp_model(data.decode("utf-8", errors="replace"))
    model["file"] = os.path.basename(path)
    return model
