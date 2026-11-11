"""치공구표준집 색인 만들기 — Drawing to Analysis '치공구표준집 찾기' (계획 docs/plans/2026-11-11-drawing-catalogue-search.md 0단계).

도면집 목차(PDF 3~6쪽, 글자 층 있음)를 열 위치로 읽어 부재 155종의 기호·명칭·쪽을 뽑고,
계열·용도·하중·해석 대상 여부를 붙인다. --engine 을 주면 새 러그 엔진(lugshell) 템플릿을 쪽마다 돌려
'바로 변환' 여부(convertible)까지 채운다 — 템플릿이 늘면 다시 돌린다.

실행(70, lugshell 가상환경 — pymupdf·numpy·jsonschema 필요):
  <DrawingToAnalysis>/lugshell/.venv/Scripts/python -X utf8 scripts/drawing_book_index.py <도면집.pdf> --engine <DrawingToAnalysis>/lugshell
결과: HiTessWorkBenchBackEnd/DrawingBook/book_index.json (git 추적, 서버는 git pull 로 받는다)
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import re
import sys
from datetime import date
from pathlib import Path

import pymupdf

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "HiTessWorkBenchBackEnd" / "DrawingBook" / "book_index.json"

TOC_PAGES = (3, 4, 5, 6)      # PDF 쪽(1부터)
PAGE_OFFSET = 11              # 도면 쪽 번호 = PDF 쪽 - 11
# 목차 표의 열 경계(x, pt) — 2018 FINAL 판에서 잰 값. 판이 바뀌면 검사(check)가 잡는다.
COL_NAME, COL_CODE, COL_PAGE, COL_NOTE = 95, 305, 445, 495

# 묶음 — 도면 쪽 범위(목차의 소제목 순서와 같다)
GROUPS = [
    ("lug", "LIFTING LUG", 1, 46),
    ("rigging", "LIFTING 기자재", 47, 55),
    ("support_bracket", "지주 BRACKET·PIPE 지주", 56, 71),
    ("erection_piece", "탑재용 PIECE", 72, 96),
    ("beam", "운반·보강 BEAM", 97, 106),
    ("block_support", "BLOCK SUPPORT·TOWER", 107, 126),
    ("dunnage", "반목(콘크리트·목재·플라스틱)", 127, 155),
]

# 러그 계열과 용도 — PDF 7쪽 '1-1. LIFTING LUG 종류 및 용도' 표를 옮긴 것(표에 없는 계열은 용도를 비운다)
LUG_USAGE = {
    "D": "수직 LIFTING 및 T/O 보조",
    "T": "T/O 전용",
    "A": "T/O 전용(곡부)",
    "L": "LAPPING 취부",
    "B": "STIFF SIDE 취부",
}
# 해석 대상이 아닌 것 — 찾기는 되고 화면에 '해석 대상 아님'
NOT_ANALYSABLE_GROUPS = {"dunnage"}
NOT_ANALYSABLE_PREFIX = ("SH-",)   # U-SHACKLE (구매품)


# 쪽 범위와 다른 묶음 — 목차의 반목 소제목 끝에 붙어 있지만 LIFTING 하중조절 JIG 는 해석 대상인 리깅 기자재다
GROUP_OVERRIDE = {"EX-057": "rigging", "EX-058": "rigging"}


def group_of(book_page: int, code: str = "") -> tuple[str, str]:
    if code in GROUP_OVERRIDE:
        gid = GROUP_OVERRIDE[code]
        return gid, next(l for g, l, _, _ in GROUPS if g == gid)
    for gid, label, a, b in GROUPS:
        if a <= book_page <= b:
            return gid, label
    return "other", "기타"


def norm_code(s: str) -> str:
    """검색용 기호 정규화: 'AS - 011' → 'AS-011', 대문자, 공백 제거."""
    return re.sub(r"\s+", "", s).upper()


def expand_aliases(raw: str) -> list[str]:
    """목차 기호 칸을 낱낱의 기호로 편다(가능한 만큼, 원문은 따로 둔다).

    'D-2, D-2A, D-2P' → D-2, D-2A, D-2P · 'SH-12, -16' → SH-12, SH-16 · 'D-35-55R, -35R' → D-35-55R, D-35-35R
    'D-16S, 25S' → D-16S, D-25S · 'LDP1 ~ LDP4' → LDP1..LDP4 · 'NSB-11~14' → NSB-11..NSB-14 · 'EX-057 (1.7M)' → EX-057
    """
    raw = re.sub(r"\(.*?\)", "", raw)
    tokens = [norm_code(t) for t in raw.split(",") if t.strip()]
    if not tokens:
        return []
    out: list[str] = []
    first = tokens[0]
    for t in tokens:
        m = re.match(r"^(.*?)(\d+)~(?:([A-Z\-]*?))?(\d+)$", t)
        if m and (not m.group(3) or m.group(1).endswith(m.group(3)) or m.group(3) == m.group(1)):
            pre, a, b = m.group(1), int(m.group(2)), int(m.group(4))
            if 0 < b - a <= 20:
                width = len(m.group(2))
                out += [f"{pre}{str(n).zfill(width)}" for n in range(a, b + 1)]
                continue
        if t.startswith("-"):
            t = first.rsplit("-", 1)[0] + t
        elif re.match(r"^\d+[A-Z]?$", t) and t != first:  # '25S'·'16'·'2' 처럼 숫자만 남은 것만 앞 기호를 이어 붙인다
            if "-" in first:
                t = first.rsplit("-", 1)[0] + "-" + t
            elif re.match(r"^[A-Z]+", first):
                t = re.match(r"^[A-Z]+", first).group(0) + t
        out.append(t)
    seen, uniq = set(), []
    for t in out:
        if t and t not in seen:
            seen.add(t)
            uniq.append(t)
    return uniq


def lug_family(code: str) -> str | None:
    if re.match(r"^D-\d+-\d+R", code):
        return "D-R"      # 곡가공 D
    if re.match(r"^(RB|LDP)", code) or re.match(r"^[DT]-\d+S$", code):
        return "BKT"      # 보강·지지 BRACKET, DOUBLE PLATE
    m = re.match(r"^(TD|D|T|L|A|B|E)-\d", code)
    return m.group(1) if m else None


def swl_of(code: str, family: str | None) -> float | None:
    if family not in {"D", "T", "TD", "L", "A", "B", "E", "D-R"}:
        return None
    m = re.match(r"^[A-Z]+-(\d+)", code)
    return float(m.group(1)) if m else None


def read_toc(doc) -> list[dict]:
    rows = []
    for pno in TOC_PAGES:
        lines: dict[int, list] = {}
        for w in doc[pno - 1].get_text("words"):
            lines.setdefault(round(w[1] / 4), []).append(w)
        for k in sorted(lines):
            ws = sorted(lines[k], key=lambda w: w[0])
            no = [w[4] for w in ws if w[0] < COL_NAME]
            name = [w[4] for w in ws if COL_NAME <= w[0] < COL_CODE]
            code = [w[4] for w in ws if COL_CODE <= w[0] < COL_PAGE]
            page = [w[4] for w in ws if COL_PAGE <= w[0] < COL_NOTE]
            note = [w[4] for w in ws if w[0] >= COL_NOTE]
            if not (no and no[0].isdigit() and page and page[0].isdigit() and name):
                continue
            # 기호가 길면 첫 기호가 명칭 열로 넘어온다 — 'D-16S,' (쉼표로 끝나는 기호) · 'NPB' + '- 1, -2' (기호가 '-' 로 시작)
            while len(name) > 1 and (re.match(r"^[A-Z]+-\d+[A-Z]*,$", name[-1])
                                     or (code and code[0].startswith("-") and re.match(r"^[A-Z]{2,}$", name[-1]))):
                code.insert(0, name.pop())
            rows.append({"no": int(no[0]), "name": " ".join(name), "code": " ".join(code),
                         "bookPage": int(page[0]), "note": " ".join(note), "tocPage": pno})
    return rows


def run_engine(engine_root: Path, book: str, pdf_page: int) -> dict:
    """lugshell 템플릿을 그 쪽에 돌려 본다. 성공하면 템플릿 이름·확인 항목 수·도면과 다른 값."""
    from lugshell.extract import pdf_vectors  # noqa: E402
    from lugshell.extract.templates import TEMPLATES  # noqa: E402
    import check_lug  # noqa: E402

    page = pdf_vectors.load(book, pdf_page - 1)
    for name, tpl in TEMPLATES.items():
        try:
            d, trace = tpl.extract(page, f"book_p{pdf_page}")
        except Exception:  # noqa: BLE001 — 템플릿이 모르는 모양(ZeroDivisionError 포함)은 '안 됨'
            continue
        tmp = engine_root / "out" / "book_index_check.json"
        tmp.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            ok = check_lug.main(str(tmp)) == 0
        if ok:
            return {"template": name, "review": len(d.get("review", [])),
                    "mismatch": sorted({x["name"] for x in trace["trace"] if x["status"] == "mismatch"})}
    return {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("book", help="치공구표준집 PDF (평문 — UNC UnLock\\PDF 사본)")
    ap.add_argument("--engine", help="lugshell 폴더 — 주면 쪽마다 변환 가능 여부를 잰다")
    ap.add_argument("--out", default=str(OUT))
    a = ap.parse_args()

    raw = Path(a.book).read_bytes()
    if not raw.startswith(b"%PDF"):
        print("PDF 가 아님(DRM 암호문?) — UNC UnLock\\PDF 의 평문 사본을 주세요", file=sys.stderr)
        return 2
    doc = pymupdf.open(stream=raw, filetype="pdf")

    if a.engine:
        root = Path(a.engine).resolve()
        sys.path[:0] = [str(root), str(root / "tools")]

    toc = read_toc(doc)
    items = []
    for r in toc:
        bp = r["bookPage"]
        aliases = expand_aliases(r["code"])
        first = aliases[0] if aliases else norm_code(r["code"])
        gid, glabel = group_of(bp, first)
        fam = lug_family(first) if gid == "lug" else None
        item = {
            "code": r["code"],
            "aliases": aliases,
            "name": r["name"],
            "group": gid,
            "groupLabel": glabel,
            "bookPage": bp,
            "pdfPage": bp + PAGE_OFFSET,
            "family": fam,
            "usage": LUG_USAGE.get(fam or ""),
            "swl_t": swl_of(first, fam),
            "analysable": not (gid in NOT_ANALYSABLE_GROUPS or first.startswith(NOT_ANALYSABLE_PREFIX)),
            "note": r["note"] or None,
        }
        if a.engine and item["analysable"]:
            conv = run_engine(Path(a.engine).resolve(), a.book, item["pdfPage"])
            item["convertible"] = bool(conv)
            if conv:
                item["engine"] = conv
        items.append(item)
        print(f"b{bp:3d} {first:12s} {gid:16s} {fam or '':4s} {'변환' if item.get('convertible') else ''}", flush=True)

    # 검사 — 판이 바뀌거나 열 경계가 어긋나면 여기서 잡는다
    pages = [i["bookPage"] for i in items]
    problems = []
    if sorted(pages) != list(range(1, 156)):
        problems.append(f"도면 쪽이 1~155 가 아님: 빠짐 {sorted(set(range(1, 156)) - set(pages))}, 중복 {sorted({p for p in pages if pages.count(p) > 1})}")
    for i in items:
        if not i["aliases"]:
            problems.append(f"b{i['bookPage']} 기호 없음: {i['name']}")
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1

    out = {
        "schema": "hitess.drawing_book_index.v1",
        "book": {
            "title": "치공구표준집 (FINAL, 2018.12.3)",
            "file": Path(a.book).name,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "pdfPages": doc.page_count,
            "pageOffset": PAGE_OFFSET,
        },
        "generated": date.today().isoformat(),
        "engineChecked": bool(a.engine),
        "groups": [{"id": g, "label": l, "fromPage": f, "toPage": t} for g, l, f, t in GROUPS],
        "lugUsage": LUG_USAGE,
        "items": items,
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n{len(items)}종 → {a.out} (바로 변환 {sum(1 for i in items if i.get('convertible'))})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
