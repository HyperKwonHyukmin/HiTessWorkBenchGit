"""Unit 구조 해석 실패 사유 문구.

회귀 배경(2026-10-02, 3542_m09.bdf): F06 FATAL 로 실패해도 job.message 가 고정 문구
'Unit 구조 해석 실패' 뿐이라 Studio 에 '실행 실패' 만 뜨고 원인을 알 수 없었다.
"""
from app.services.unit_structural_service import describe_f06_fatal


def test_fatal_reason_lists_codes_in_order_with_hint_and_first_message():
    payload = {"fatalMessages": [
        {"code": "9994", "message": "*** USER FATAL MESSAGE 9994 (BULKIN)   First Field Violation near line 16"},
        {"code": "9994", "message": "x"},
        {"code": "300", "message": "y"},
        {"code": "", "message": "z"},
        {"code": "6498", "message": "w"},
    ]}
    text = describe_f06_fatal(payload)
    assert "FATAL 5건(코드 9994 · 300 · 6498)" in text
    assert "BDF 카드 형식 오류" in text
    assert "First Field Violation near line 16" in text
    assert "   " not in text  # 공백 정리


def test_many_codes_are_truncated():
    payload = {"fatalMessages": [{"code": str(c), "message": "m"} for c in (1, 2, 3, 4, 5)]}
    assert "코드 1 · 2 · 3 · 4 등" in describe_f06_fatal(payload)


def test_mechanism_hint():
    text = describe_f06_fatal({"fatalMessages": [{"code": "9050", "message": "m"}]})
    assert "Mechanism" in text


def test_no_detail_still_explains():
    assert "FATAL" in describe_f06_fatal({})
