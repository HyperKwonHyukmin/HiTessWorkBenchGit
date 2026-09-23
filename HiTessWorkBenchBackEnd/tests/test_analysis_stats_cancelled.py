"""취소(Cancelled)가 '실패' 로 집계되지 않는지 검증한다.

Plan D 로 사용자가 해석을 중단할 수 있게 되면서 status 어휘에 Cancelled 가 늘었다.
통계는 `fail = total - success` 였기 때문에, 손대지 않으면 사용자가 스스로 중단한
작업이 전부 프로그램의 '실패' 로 잡혀 성공률이 왜곡된다.

규약: 취소는 성공도 실패도 아니다 — fail 에서 빼고, 성공률 분모에서도 뺀다.
"""
from datetime import datetime

from app import models


def _seed(db_session, statuses, program_name="BDF Scanner", employee_id="ADMIN001"):
    for index, status in enumerate(statuses):
        db_session.add(models.Analysis(
            employee_id=employee_id,
            program_name=program_name,
            status=status,
            source="Workbench",
            input_info={}, result_info={},
            created_at=datetime(2026, 9, 20, 9, index % 60),
        ))
    db_session.commit()


def test_cancelled_is_not_counted_as_failure(admin_client, db_session):
    # 성공 2 · 실패 1 · 취소 2
    _seed(db_session, ["Success", "Success", "Failed", "Cancelled", "Cancelled"])

    body = admin_client.get("/api/analysis/stats/program/BDF%20Scanner").json()
    summary = body["summary"]

    assert summary["total"] == 5
    assert summary["success"] == 2
    assert summary["fail"] == 1, "취소가 실패로 섞이면 안 된다"
    assert summary["cancelled"] == 2


def test_success_rate_excludes_cancelled_from_denominator(admin_client, db_session):
    # 성공 1 · 취소 3 — 취소를 분모에 두면 25%, 빼면 100%
    _seed(db_session, ["Success", "Cancelled", "Cancelled", "Cancelled"])

    summary = admin_client.get("/api/analysis/stats/program/BDF%20Scanner").json()["summary"]

    assert summary["successRate"] == 100, "사용자가 중단한 작업이 프로그램 성공률을 깎으면 안 된다"


def test_all_cancelled_does_not_divide_by_zero(admin_client, db_session):
    _seed(db_session, ["Cancelled", "Cancelled"])

    summary = admin_client.get("/api/analysis/stats/program/BDF%20Scanner").json()["summary"]

    assert summary["total"] == 2
    assert summary["success"] == 0
    assert summary["fail"] == 0
    assert summary["cancelled"] == 2
    assert summary["successRate"] == 0


def test_user_rows_success_rate_excludes_cancelled(admin_client, db_session):
    _seed(db_session, ["Success", "Cancelled"], employee_id="ADMIN001")

    body = admin_client.get("/api/analysis/stats/program/BDF%20Scanner").json()
    row = next(r for r in body["userRanking"] if r["employee_id"] == "ADMIN001")

    assert row["count"] == 2, "총 실행 건수는 취소도 포함한다"
    assert row["successRate"] == 100, "성공률 분모에서는 취소를 뺀다"


def test_existing_keys_are_preserved(admin_client, db_session):
    """기존 소비자(ProgramDetailModal)가 읽는 키가 사라지면 안 된다."""
    _seed(db_session, ["Success", "Failed"])

    summary = admin_client.get("/api/analysis/stats/program/BDF%20Scanner").json()["summary"]

    for key in ("total", "success", "fail", "successRate", "userCount", "deptCount"):
        assert key in summary, key
    assert summary["fail"] == 1
    assert summary["successRate"] == 50
