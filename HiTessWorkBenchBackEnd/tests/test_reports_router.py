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


def test_user_connection_base_matches_the_download_endpoint():
    """경로가 한 단계만 어긋나도 결과 파일과 근거 섹션이 조용히 사라진다.

    예외가 안 나도록 만들어 둔 설계라 깨져도 소리가 안 난다 — 여기서 고정한다.
    """
    import os

    from app.routers import analysis as analysis_router
    from app.routers import reports as reports_router

    assert reports_router._USER_CONNECTION_DIR == analysis_router._USER_CONNECTION_DIR
    assert os.path.basename(reports_router._USER_CONNECTION_DIR) == "userConnection"


def test_output_json_under_user_connection_reaches_the_report(admin_client, db_session, tmp_path, monkeypatch):
    """단위 테스트는 base 를 직접 넘겨 받으므로 라우터의 배선 실수를 잡지 못한다.

    라우터가 실제로 쓰는 상수를 통해 결과 파일이 리포트에 실리는지 확인한다.
    """
    import io
    import json

    import openpyxl

    from app.routers import reports as reports_router

    base = tmp_path / "userConnection"
    job = base / "20260818_ADMIN001_Job"
    job.mkdir(parents=True)
    out = job / "result.json"
    out.write_text(json.dumps({"members": [{"id": 7, "stress": 123.0}]}), encoding="utf-8")
    monkeypatch.setattr(reports_router, "_USER_CONNECTION_DIR", str(base))

    record = _seed(db_session, employee_id="ADMIN001")
    record.result_info = {"output_json": str(out)}
    db_session.commit()

    res = admin_client.post("/api/reports/generate", json={"analysis_id": record.id})

    assert res.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(res.content))
    values = [cell.value for sheet in wb for row in sheet.iter_rows() for cell in row]
    assert 123.0 in values
