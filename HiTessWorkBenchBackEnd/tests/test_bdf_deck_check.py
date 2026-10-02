"""BDF deck 구간 경계 검사·자동 수정 (GMU 권상 BDF 검증).

회귀 배경(2026-10-02, 3542_m09.bdf): BEGIN BULK 줄이 없는 BDF 가 검증은 통과했는데
Wire 포함 구조 해석에서 Nastran FATAL 로 멈췄다. 검증 단계에서 잡아 사용자 확인 후 고친다.
"""
from app.services.bdf_deck_check import (
    apply_deck_fixes,
    apply_deck_fixes_lines,
    inspect_deck,
    inspect_deck_lines,
    merge_into_step1,
)

NO_BEGIN_BULK = [
    "$COG: 1,2,3\r\n",
    "SOL 101\r\n",
    "CEND\r\n",
    "  DISPLACEMENT(SORT1,PLOT) = ALL\r\n",
    "SUBCASE       1\r\n",
    "  LABEL= LC1\r\n",
    "\r\n",
    "PARAM,POST,-1\r\n",
    "GRID           9        202754.0  -410.0 26256.0\r\n",
    "ENDDATA\r\n",
]

CASE_IN_BULK = [
    "SOL 101\n",
    "CEND\n",
    "SUBCASE 1\n",
    "BEGIN BULK\n",
    "SOL 101\n",
    "CEND\n",
    "  STRESS(SORT1,PLOT) = ALL\n",
    "SUBCASE       1\n",
    "SPC            1       9  123456\n",
    "GRID,10,,0.,0.,0.\n",
    "=,*1,,=,*1.,==\n",
    "ENDDATA\n",
]


def codes(issues):
    return [i["code"] for i in issues]


def test_missing_begin_bulk_detected_and_fixed():
    issues = inspect_deck_lines(NO_BEGIN_BULK)
    assert codes(issues) == ["missing_begin_bulk"]
    assert issues[0]["severity"] == "warning" and issues[0]["lines"] == [8]

    fixed, applied = apply_deck_fixes_lines(NO_BEGIN_BULK)
    assert codes(applied) == ["missing_begin_bulk"]
    assert fixed[7] == "BEGIN BULK\r\n"           # 원본 개행 형식(CRLF) 유지
    assert fixed[8] == "PARAM,POST,-1\r\n"
    assert len(fixed) == len(NO_BEGIN_BULK) + 1   # 다른 줄은 그대로
    assert inspect_deck_lines(fixed) == []         # 고친 뒤 다시 보면 문제 없음


def test_case_control_lines_inside_bulk_detected_and_removed():
    issues = inspect_deck_lines(CASE_IN_BULK)
    assert codes(issues) == ["case_control_in_bulk"]
    assert issues[0]["severity"] == "error"
    assert issues[0]["lines"] == [5, 6, 7, 8]       # SPC 카드·free-field 복제('=') 줄은 bulk 그대로

    fixed, _ = apply_deck_fixes_lines(CASE_IN_BULK)
    assert fixed[:4] == CASE_IN_BULK[:4]            # 앞쪽 Case Control 은 그대로
    assert "SPC            1       9  123456\n" in fixed
    assert "=,*1,,=,*1.,==\n" in fixed
    assert inspect_deck_lines(fixed) == []


def test_clean_deck_and_pure_bulk_have_no_issues():
    assert inspect_deck_lines(["SOL 101\n", "CEND\n", "BEGIN BULK\n", "GRID,1,,0.,0.,0.\n", "ENDDATA\n"]) == []
    assert inspect_deck_lines(["GRID,1,,0.,0.,0.\n", "ENDDATA\n"]) == []


def test_apply_only_selected_codes():
    lines = NO_BEGIN_BULK[:7] + ["SOL 101\r\n"] + NO_BEGIN_BULK[7:]
    _, applied = apply_deck_fixes_lines(lines, codes=["missing_begin_bulk"])
    assert codes(applied) == ["missing_begin_bulk"]


def test_file_roundtrip_keeps_cp949_bytes(tmp_path):
    src = tmp_path / "a.bdf"
    korean = "$ 한글 주석\r\n".encode("cp949")
    src.write_bytes(korean + "".join(NO_BEGIN_BULK).encode("ascii"))
    assert codes(inspect_deck(str(src))) == ["missing_begin_bulk"]
    dst = tmp_path / "b.bdf"
    apply_deck_fixes(str(src), str(dst))
    data = dst.read_bytes()
    assert data.startswith(korean)
    assert b"BEGIN BULK\r\nPARAM,POST,-1" in data


def test_merge_into_step1_counts_and_status():
    step1 = {"status": "pass", "summary": {"totalErrors": 0, "totalWarnings": 0}, "validationResults": []}
    merge_into_step1(step1, inspect_deck_lines(CASE_IN_BULK))
    assert step1["status"] == "error"
    assert step1["summary"]["totalErrors"] == 1
    assert step1["validationResults"][0]["cardType"] == "DECK"
    assert step1["deckIssues"][0]["fixable"] is True

    clean = {"status": "pass", "summary": {}, "validationResults": []}
    merge_into_step1(clean, [])
    assert clean["status"] == "pass" and clean["deckIssues"] == []
