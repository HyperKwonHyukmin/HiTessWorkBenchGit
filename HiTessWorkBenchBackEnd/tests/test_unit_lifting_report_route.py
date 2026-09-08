import os
import shutil
from datetime import datetime

from app import models

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "unit_lifting_report")
STEM = "3496-35210-A508372_20260108_edit"
COPY = ("_lifting_nastranResult.json", "_stability.json", "_lifting_meta.json", "_edited.json", ".json",
        "_posture.json", "_hoist_optimization.json", "_validation_step1.json")


def _record(db, root, owner="EMP001"):
    folder = root / f"20260907_000000_{owner}_GroupModuleUnit"
    folder.mkdir(exist_ok=True)
    for n in COPY:
        shutil.copy(os.path.join(FIX, f"{STEM}{n}"), folder / f"{STEM}{n}")
    a = models.Analysis(
        employee_id=owner, program_name="UnitStructuralAnalysis", project_name="t", status="Success",
        created_at=datetime.now(),
        result_info={"nastranResultJson": str(folder / f"{STEM}_lifting_nastranResult.json"),
                     "stabilityJson": str(folder / f"{STEM}_stability.json"),
                     "liftingMetaJson": str(folder / f"{STEM}_lifting_meta.json"),
                     "bdf": str(folder / f"{STEM}.bdf")})
    db.add(a)
    db.commit()
    return a


def test_owner_gets_xlsx(switchable_client, db_session, tmp_path, monkeypatch):
    from app.routers import analysis as router
    monkeypatch.setattr(router, "_USER_CONNECTION_DIR", str(tmp_path))
    a = _record(db_session, tmp_path)
    switchable_client.as_user()
    res = switchable_client.post("/api/analysis/unit-structural/report",
                                 json={"analysisId": a.id, "options": {"revision": "0"}})
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("application/vnd.openxmlformats")
    assert "X-Report-Summary" in res.headers
    assert res.content[:2] == b"PK"


def test_other_user_forbidden(switchable_client, db_session, tmp_path, monkeypatch):
    from app.routers import analysis as router
    monkeypatch.setattr(router, "_USER_CONNECTION_DIR", str(tmp_path))
    a = _record(db_session, tmp_path, owner="SOMEONE")
    switchable_client.as_user()
    res = switchable_client.post("/api/analysis/unit-structural/report", json={"analysisId": a.id})
    assert res.status_code == 403


def test_bad_option_rejected(switchable_client, db_session, tmp_path, monkeypatch):
    from app.routers import analysis as router
    monkeypatch.setattr(router, "_USER_CONNECTION_DIR", str(tmp_path))
    a = _record(db_session, tmp_path)
    switchable_client.as_user()
    res = switchable_client.post("/api/analysis/unit-structural/report",
                                 json={"analysisId": a.id, "options": {"jigLimitTon": -1}})
    assert res.status_code == 400
