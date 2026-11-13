"""Model Builder 검증 표시(BDF 머리 `$ HiTessModelBuilder: Review=…`)를 받는 곳에서 읽어 경고하는지.

MB 계획서(2026-11-12) 6단계 '검토 흐름과 검증 표시' — 받는 곳(GMU 권상, Side Passage, 해상 운송 검증은
모두 덱 검사를 거친다)은 막지 않고 경고만 한다.
"""
from app.services.bdf_deck_check import (
    inspect_deck_lines, merge_into_step1, read_mb_review_marker, read_mb_review_marker_file,
)

HEAD = ["$ HiTessModelBuilder: HullNo=3454\n"]
BODY = ["SOL 101\n", "CEND\n", "BEGIN BULK\n", "GRID,1,,0.,0.,0.\n", "ENDDATA\n"]


def _codes(lines):
    return [i["code"] for i in inspect_deck_lines(lines)]


def test_required_marker_is_a_warning_not_an_error():
    lines = HEAD + ["$ HiTessModelBuilder: Review=REQUIRED Items=12\n"] + BODY
    issue = next(i for i in inspect_deck_lines(lines) if i["code"] == "mb_review_required")
    assert issue["severity"] == "warning"
    assert issue["fixable"] is False
    assert "12건" in issue["title"]
    assert issue["mbReview"] == {"status": "REQUIRED", "items": 12}


def test_manual_marker_warns_with_its_own_wording():
    lines = ["$ HiTessModelBuilder: Review=MANUAL Items=3\r\n"] + BODY
    issue = next(i for i in inspect_deck_lines(lines) if i["code"] == "mb_review_required")
    assert "손으로 고칠 것 3건" in issue["title"]


def test_none_done_and_missing_marker_do_not_warn():
    for status in ("NONE", "DONE"):
        assert "mb_review_required" not in _codes(HEAD + [f"$ HiTessModelBuilder: Review={status} Items=0\n"] + BODY)
    assert "mb_review_required" not in _codes(HEAD + BODY)


def test_marker_outside_head_comments_is_ignored():
    # 엔진 BdfReviewMarker.Read 와 같은 규칙 — 첫 카드 뒤의 주석은 표시가 아니다.
    lines = ["SOL 101\n", "$ HiTessModelBuilder: Review=REQUIRED Items=1\n", "CEND\n", "BEGIN BULK\n", "ENDDATA\n"]
    assert read_mb_review_marker(lines) is None
    assert "mb_review_required" not in _codes(lines)


def test_warning_lands_in_step1_without_failing_validation():
    lines = HEAD + ["$ HiTessModelBuilder: Review=REQUIRED Items=2\n"] + BODY
    step1 = merge_into_step1({"status": "pass", "summary": {}}, inspect_deck_lines(lines))
    assert step1["status"] == "warning"
    assert step1["summary"].get("totalErrors", 0) == 0
    assert step1["validationResults"][0]["fieldName"] == "mb_review_required"


def test_file_reader_stops_at_first_card(tmp_path):
    path = tmp_path / "m.bdf"
    path.write_text("".join(HEAD + ["$ HiTessModelBuilder: Review=required Items=5\n"] + BODY), encoding="latin-1")
    assert read_mb_review_marker_file(str(path)) == {"status": "REQUIRED", "items": 5}
    assert read_mb_review_marker_file(str(tmp_path / "없음.bdf")) is None
