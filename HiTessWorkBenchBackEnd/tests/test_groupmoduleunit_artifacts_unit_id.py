from datetime import datetime

from app import models


def _parent(db_session, tmp_path):
    folder = tmp_path / "20260907_000000_EMP001_GroupModuleUnit"
    folder.mkdir()
    bdf = folder / "m.bdf"
    bdf.write_text("CEND\nBEGIN BULK\nENDDATA\n")
    parent = models.Analysis(employee_id="EMP001", program_name="GroupModuleUnit", project_name="p", status="Success",
                             created_at=datetime(2026, 9, 7, 10), input_info={"bdf_model": str(bdf)})
    db_session.add(parent)
    db_session.commit()
    return parent


def test_artifacts_include_latest_success_unit_structural_id(switchable_client, db_session, tmp_path, monkeypatch):
    from app.routers import analysis as router
    monkeypatch.setattr(router, "_USER_CONNECTION_DIR", str(tmp_path))
    parent = _parent(db_session, tmp_path)
    older = models.Analysis(employee_id="EMP001", program_name="UnitStructuralAnalysis", project_name="u1", status="Success",
                            created_at=datetime(2026, 9, 7, 11), input_info={"parent_analysis_id": parent.id})
    failed = models.Analysis(employee_id="EMP001", program_name="UnitStructuralAnalysis", project_name="u2", status="Failed",
                             created_at=datetime(2026, 9, 7, 13), input_info={"parent_analysis_id": parent.id})
    newest = models.Analysis(employee_id="EMP001", program_name="UnitStructuralAnalysis", project_name="u3", status="Success",
                             created_at=datetime(2026, 9, 7, 12), input_info={"parent_analysis_id": parent.id})
    db_session.add_all([older, failed, newest])
    db_session.commit()
    switchable_client.as_user()
    res = switchable_client.get(f"/api/analysis/groupmoduleunit/{parent.id}/artifacts")
    assert res.status_code == 200, res.text
    assert res.json()["unitStructuralAnalysisId"] == newest.id


def test_artifacts_unit_id_null_when_none(switchable_client, db_session, tmp_path, monkeypatch):
    from app.routers import analysis as router
    monkeypatch.setattr(router, "_USER_CONNECTION_DIR", str(tmp_path))
    parent = _parent(db_session, tmp_path)
    switchable_client.as_user()
    res = switchable_client.get(f"/api/analysis/groupmoduleunit/{parent.id}/artifacts")
    assert res.status_code == 200, res.text
    assert res.json()["unitStructuralAnalysisId"] is None
