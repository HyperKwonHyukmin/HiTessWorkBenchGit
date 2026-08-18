"""reports 라우터 — 권한과 응답 계약."""
from datetime import datetime

from app import models


def _seed(db_session, employee_id="EMP001", status="Success"):
    record = models.Analysis(
        employee_id=employee_id,
        program_name="Column Buckling Load Calculator",
        project_name="p",
        status=status,
        input_info={"length_mm": 3000},
        result_info={"maxWorkingLoadTon": 12.5},
        created_at=datetime(2026, 8, 18, 9, 0, 0),
    )
    db_session.add(record)
    db_session.commit()
    return record


def test_capabilities_returns_a_program_map(admin_client):
    res = admin_client.get("/api/reports/capabilities")
    assert res.status_code == 200
    body = res.json()
    assert body["truss-assessment"]["reportable"] is True


def test_generate_returns_xlsx_bytes(admin_client, db_session):
    record = _seed(db_session, employee_id="ADMIN001")

    res = admin_client.post("/api/reports/generate", json={"analysis_id": record.id})

    assert res.status_code == 200
    assert res.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "attachment" in res.headers["content-disposition"]
    assert res.content[:2] == b"PK"


def test_generate_rejects_another_users_record(switchable_client, db_session):
    record = _seed(db_session, employee_id="ADMIN001")
    switchable_client.as_user()

    res = switchable_client.post("/api/reports/generate", json={"analysis_id": record.id})

    assert res.status_code == 403


def test_admin_can_generate_for_any_record(switchable_client, db_session):
    record = _seed(db_session, employee_id="EMP001")
    switchable_client.as_admin()

    res = switchable_client.post("/api/reports/generate", json={"analysis_id": record.id})

    assert res.status_code == 200


def test_generate_returns_404_for_unknown_id(admin_client):
    res = admin_client.post("/api/reports/generate", json={"analysis_id": 999999})
    assert res.status_code == 404


def test_generate_returns_400_for_an_incomplete_record(admin_client, db_session):
    record = _seed(db_session, employee_id="ADMIN001", status="Failed")
    res = admin_client.post("/api/reports/generate", json={"analysis_id": record.id})
    assert res.status_code == 400
