"""대시보드 '월간' 건수가 '누적(이력 total)'과 같은 기준으로 세어지는지 검증한다.

예전 /analysis/stats/monthly 는 샘플 실행과 권상 App 세부 검토(ModuleStability 등)까지 세고,
/analysis/history 는 둘 다 뺐다. 그래서 대시보드가 '누적 중 이번 달 25%'처럼 서로 다른 단위를
비교했다(실측: 월간 414 · 누적 1649, 월간 대부분이 세부 검토).
"""
from datetime import datetime

from app import models


def _add(db, program, *, source="Workbench", day=10):
    db.add(models.Analysis(
        employee_id="ADMIN001", program_name=program, status="Success", source=source,
        input_info={}, result_info={}, created_at=datetime(2026, 9, day, 9, 0),
    ))
    db.commit()


def test_monthly_count_matches_history_basis(admin_client, db_session):
    _add(db_session, "GroupModuleUnit")
    _add(db_session, "BDF Scanner")
    _add(db_session, "ModuleStability")          # 세부 검토 — 제외
    _add(db_session, "UnitStructuralAnalysis")   # 세부 검토 — 제외
    _add(db_session, "BDF Scanner", source="WorkbenchSample")  # 샘플 — 제외
    _add(db_session, "BDF Scanner", day=1)
    db_session.add(models.Analysis(  # 다른 달 — 제외
        employee_id="ADMIN001", program_name="BDF Scanner", status="Success", source="Workbench",
        input_info={}, result_info={}, created_at=datetime(2026, 8, 31, 23, 0),
    ))
    db_session.commit()

    monthly = admin_client.get(
        "/api/analysis/stats/monthly", params={"employee_id": "ADMIN001", "year": 2026, "month": 9},
    ).json()
    history = admin_client.get("/api/analysis/history/ADMIN001", params={"limit": 1}).json()

    assert monthly["count"] == 3
    assert history["total"] == 4, "이력은 다른 달 1건까지 포함한 누적"
    assert monthly["count"] <= history["total"]
