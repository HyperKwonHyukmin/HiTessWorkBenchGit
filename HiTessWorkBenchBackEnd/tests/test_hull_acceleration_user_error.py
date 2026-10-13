"""선체 가속도 엔진 실패 사유 전달 — 사용자가 고칠 수 있는 원인만 화면에 보낸다(2026-10-13)."""
from app.services.hull_acceleration_service import GENERIC_ENGINE_FAILURE, user_facing_failure


def test_marked_engine_reason_is_passed_through():
    raw = (
        "some log\n"
        "[USER_ERROR] PDF 에서 선박 주요 치수를 찾지 못했습니다(누락: Breadth).\n"
    )
    assert user_facing_failure(raw) == "PDF 에서 선박 주요 치수를 찾지 못했습니다(누락: Breadth)."


def test_traceback_without_mark_is_hidden():
    raw = 'Traceback (most recent call last):\n  File "C:\\server\\path.py", line 1\nValueError: boom'
    assert user_facing_failure(raw) == GENERIC_ENGINE_FAILURE


def test_empty_output_falls_back_to_generic():
    assert user_facing_failure("") == GENERIC_ENGINE_FAILURE
    assert user_facing_failure("[USER_ERROR]   ") == GENERIC_ENGINE_FAILURE
