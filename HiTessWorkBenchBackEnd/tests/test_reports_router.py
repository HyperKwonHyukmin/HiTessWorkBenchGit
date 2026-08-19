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


def test_generate_writes_an_export_activity_log(admin_client, db_session):
    """감사 기록이 없으면 누가 어떤 계산서를 뽑았는지 추적할 수 없다.

    결재에 붙는 문서라 발급 이력이 남아야 한다. 인자 순서 하나만 틀어져도
    조용히 사라지는 종류의 기능이라 테스트로 고정한다.
    """
    from app import models

    record = _seed(db_session, employee_id="ADMIN001")
    res = admin_client.post("/api/reports/generate", json={"analysis_id": record.id})
    assert res.status_code == 200

    logs = (
        db_session.query(models.ActivityLog)
        .filter(models.ActivityLog.action_type == "EXPORT_REPORT")
        .all()
    )
    assert len(logs) == 1
    assert logs[0].employee_id == "ADMIN001"
    assert logs[0].action_detail["analysis_id"] == record.id


def test_ownership_is_checked_before_completeness(switchable_client, db_session):
    """남의 미완료 레코드에 400 을 주면 그 레코드의 상태가 새어 나간다.

    소유권 검사가 완료 여부 검사보다 먼저여야 한다 — 순서가 뒤집히면
    비소유자가 400/403 차이로 레코드의 존재와 상태를 알아낼 수 있다.
    """
    record = _seed(db_session, employee_id="ADMIN001", status="Failed")
    switchable_client.as_user()

    res = switchable_client.post("/api/reports/generate", json={"analysis_id": record.id})

    assert res.status_code == 403


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


def test_content_disposition_is_exposed_to_the_browser(admin_client, db_session):
    """CORS 로 노출하지 않으면 브라우저가 JS 에게 Content-Disposition 을 숨긴다.

    그러면 프론트가 파일명을 못 읽고 App 이름 없는 폴백('WorkBench_Report_<id>')으로
    저장한다 — 백엔드가 이름에 App 을 넣어도 사용자에게 닿지 않는다.
    """
    record = _seed(db_session, employee_id="ADMIN001")

    res = admin_client.post(
        "/api/reports/generate",
        json={"analysis_id": record.id},
        headers={"Origin": "http://localhost:5173"},
    )

    exposed = res.headers.get("access-control-expose-headers", "")
    assert "content-disposition" in exposed.lower()


def test_content_disposition_keeps_an_ascii_fallback_and_a_utf8_name(admin_client, db_session):
    """한글을 raw 로 헤더에 넣으면 latin-1 인코딩에서 깨진다 — RFC 5987 두 벌 표기."""
    from urllib.parse import unquote

    record = _seed(db_session, employee_id="ADMIN001")
    record.project_name = "선체 보강 검토"
    db_session.commit()

    res = admin_client.post("/api/reports/generate", json={"analysis_id": record.id})

    disposition = res.headers["content-disposition"]
    ascii_part = disposition.split("filename=")[1].split(";")[0]
    assert ascii_part.isascii()
    # 한글 이름이 실제로 실려 있어야 한다 — filename* 이 있기만 해서는 소용없다.
    utf8_part = unquote(disposition.split("filename*=UTF-8''")[1])
    assert "선체_보강_검토" in utf8_part


def test_generate_rejects_an_app_that_is_not_a_report_target(admin_client, db_session):
    record = _seed(db_session, employee_id="ADMIN001")
    record.program_name = "HiTessModelBuilder"
    db_session.commit()

    res = admin_client.post("/api/reports/generate", json={"analysis_id": record.id})

    assert res.status_code == 400
    assert res.json()["detail"]


def test_capabilities_report_which_apps_are_excluded(admin_client):
    body = admin_client.get("/api/reports/capabilities").json()
    assert body["hitess-model-builder"]["reportable"] is False
    assert body["mast-post"]["reportable"] is True
