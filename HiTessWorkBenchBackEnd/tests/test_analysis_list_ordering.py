"""이력 목록이 created_at 내림차순을 유지하는지 — 정렬 버퍼 회피 리팩터링의 회귀 방지.

MySQL 은 filesort 시 선택한 모든 컬럼을 정렬 버퍼에 담는다. analysis 행에는 JSON 컬럼이
있어 ORM 행 전체를 ORDER BY 로 가져오면 (1038, 'Out of sort memory') 로 터진다(운영 실측).
그래서 _ordered_analysis_rows 는 id 로만 정렬한 뒤 본문을 되가져와 순서를 복원한다.
이 테스트는 그 '순서 복원' 이 실제로 되는지를 고정한다 — in_() 조회는 순서를 보장하지 않으므로
복원 로직이 빠지면 목록이 뒤섞인다.
"""
from datetime import datetime, timedelta

from app import models
from app.routers import analysis as ar


def _seed(db_session, count: int, employee_id: str = "ADMIN001"):
    base = datetime(2026, 9, 1, 9, 0, 0)
    for i in range(count):
        db_session.add(models.Analysis(
            employee_id=employee_id,
            program_name="BDF Scanner",
            project_name=f"p{i}",
            status="Success",
            source="Workbench",
            input_info={}, result_info={},
            created_at=base + timedelta(hours=i),
        ))
    db_session.commit()


def test_ordered_rows_are_newest_first(db_session):
    _seed(db_session, 5)
    query = db_session.query(models.Analysis)
    rows = ar._ordered_analysis_rows(db_session, query)
    created = [r.created_at for r in rows]
    assert created == sorted(created, reverse=True)


def test_ordered_rows_respect_skip_and_limit(db_session):
    _seed(db_session, 5)
    query = db_session.query(models.Analysis)
    page = ar._ordered_analysis_rows(db_session, query, skip=1, limit=2)
    everything = ar._ordered_analysis_rows(db_session, query)
    assert [r.id for r in page] == [r.id for r in everything[1:3]]


def test_ordered_rows_empty_result(db_session):
    query = db_session.query(models.Analysis).filter(models.Analysis.id < 0)
    assert ar._ordered_analysis_rows(db_session, query) == []


def test_history_endpoint_is_newest_first(admin_client, db_session):
    _seed(db_session, 4)
    body = admin_client.get("/api/analysis/history/ADMIN001").json()
    stamps = [item["created_at"] for item in body["items"]]
    assert stamps == sorted(stamps, reverse=True)
    assert body["total"] == 4


def test_all_endpoint_is_newest_first(admin_client, db_session):
    _seed(db_session, 4)
    body = admin_client.get("/api/analysis/all", params={"limit": 3}).json()
    stamps = [item["created_at"] for item in body["items"]]
    assert stamps == sorted(stamps, reverse=True)
    assert len(body["items"]) == 3
    assert body["total"] == 4
