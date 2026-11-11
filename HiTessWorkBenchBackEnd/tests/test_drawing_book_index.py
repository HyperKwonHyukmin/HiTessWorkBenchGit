"""치공구표준집 색인(DrawingBook/book_index.json) 이 깨지지 않았는지 — 찾기 API·화면이 이 파일을 그대로 믿는다.

색인은 scripts/drawing_book_index.py 가 만든다(계획 docs/plans/2026-11-11-drawing-catalogue-search.md 0단계).
"""
import json
from collections import Counter
from pathlib import Path

INDEX = Path(__file__).resolve().parent.parent / "DrawingBook" / "book_index.json"


def _load():
    return json.loads(INDEX.read_text(encoding="utf-8"))


def test_every_drawing_page_once_and_pdf_page_offset():
    d = _load()
    items = d["items"]
    assert sorted(i["bookPage"] for i in items) == list(range(1, 156))
    off = d["book"]["pageOffset"]
    assert all(i["pdfPage"] == i["bookPage"] + off for i in items)
    assert all(i["pdfPage"] <= d["book"]["pdfPages"] for i in items)


def test_codes_present_and_mostly_unique():
    items = _load()["items"]
    assert all(i["aliases"] for i in items)
    counts = Counter(a for i in items for a in i["aliases"])
    dup = {a for a, n in counts.items() if n > 1}
    assert not dup, f"같은 기호가 여러 쪽에: {sorted(dup)}"


def test_groups_and_analysable_rules():
    d = _load()
    gids = {g["id"] for g in d["groups"]}
    by = {i["aliases"][0]: i for i in d["items"]}
    assert all(i["group"] in gids for i in d["items"])
    assert by["L-25"]["group"] == "lug" and by["L-25"]["family"] == "L" and by["L-25"]["swl_t"] == 25.0
    assert by["D-16S"]["family"] == "BKT"          # 기호가 명칭 열로 넘어오던 줄(목차 b43)
    assert by["SH-12"]["analysable"] is False        # 샤클 = 구매품
    assert by["NCB-1"]["analysable"] is False        # 반목
    assert by["EX-057"]["group"] == "rigging" and by["EX-057"]["analysable"] is True  # 쪽 범위와 다른 묶음


def test_convertible_matches_engine_check():
    d = _load()
    assert d["engineChecked"] is True
    conv = sorted(i["aliases"][0] for i in d["items"] if i.get("convertible"))
    # 2026-11-11 새 러그 엔진 lapping_lug 템플릿 기준. 템플릿이 늘면 색인을 다시 만들고 이 목록을 고친다.
    assert conv == ["L-25", "L-30", "L-40", "L-50"]
    assert all(i.get("engine", {}).get("template") for i in d["items"] if i.get("convertible"))
