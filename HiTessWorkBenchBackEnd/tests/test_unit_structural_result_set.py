"""지난 Unit 구조 해석을 Studio 로 다시 보기 — result-set 라우트 회귀 테스트.

계획: docs/plans/2026-11-11-mu-past-structural-result-view.md
결과 elementId 가 편집 모델 기준이라, 모델은 '그 실행이 실제로 쓴' 실행별 사본이 먼저여야 한다.
"""
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import database, models
from app.dependencies import require_auth
from app.routers import analysis
from app.services.lifting_review_archive import archive_lifting_review
from app.services.unit_structural_result_set import WORKDIR_MODEL_WARNING

STABILITY = {"visualization": {"wires": [{"groupId": 1}], "apexes": [{"groupId": 1, "pointMm": {"x": 0, "y": 0, "z": 9000}}]}}
RESULT = {"members": [{"elementId": 9001, "utilization": 0.4}], "summary": {"memberElementCount": 1}, "warnings": []}


def _client(db_session, employee_id):
    app = FastAPI()
    app.include_router(analysis.router)

    def override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = override_db
    app.dependency_overrides[require_auth] = lambda: employee_id
    return TestClient(app)


def _setup(tmp_path, monkeypatch, db_session, *, edited=True, archive=True, stability=True, owner="OWNER01"):
    base = tmp_path / "userConnection"
    work = base / f"20261111_090000_{owner}_GroupModuleUnit"
    work.mkdir(parents=True)
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))
    monkeypatch.setattr(analysis, "_ALLOWED_DOWNLOAD_BASE", str(base))
    bdf = work / "M02.bdf"
    bdf.write_text("CEND\nBEGIN BULK\nENDDATA\n", encoding="utf-8")
    (work / "M02.json").write_text(json.dumps({"tag": "original"}), encoding="utf-8")
    edited_json = work / "M02_edited.json"
    if edited:
        edited_json.write_text(json.dumps({"tag": "edited-at-solve"}), encoding="utf-8")
    result_json = work / "M02_lifting_nastranResult.json"
    result_json.write_text(json.dumps(RESULT), encoding="utf-8")
    stability_json = work / "M02_stability.json"
    if stability:
        stability_json.write_text(json.dumps(STABILITY), encoding="utf-8")
    parent = models.Analysis(employee_id=owner, program_name="GroupModuleUnit", project_name="p",
                             status="Success", input_info={"bdf_model": str(bdf), "hull_no": "3469"}, result_info={})
    db_session.add(parent)
    db_session.commit()
    info = {"parentAnalysisId": parent.id, "bdf": str(bdf), "liftingBdf": str(work / "M02_lifting.bdf"),
            "nastranResultJson": str(result_json), "stabilityJson": str(stability_json)}
    if archive:
        info["reviewManifestJson"] = archive_lifting_review(str(work), "job-1", {
            "editedModel": str(edited_json), "result": str(result_json), "stability": str(stability_json)}, {})
    record = models.Analysis(employee_id=owner, program_name="UnitStructuralAnalysis", project_name="u",
                             status="Success", input_info={}, result_info=info)
    db_session.add(record)
    db_session.commit()
    return work, record


def test_uses_archived_edited_model_even_if_workdir_changed(db_session, tmp_path, monkeypatch):
    work, record = _setup(tmp_path, monkeypatch, db_session)
    # 해석 뒤 Studio 에서 더 고쳐 작업 폴더 _edited.json 이 덮어써진 경우
    (work / "M02_edited.json").write_text(json.dumps({"tag": "edited-later"}), encoding="utf-8")

    res = _client(db_session, "OWNER01").get(f"/api/analysis/unit-structural/{record.id}/result-set")

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["model"] == {"tag": "edited-at-solve"}
    assert body["modelSource"] == "archive-edited"
    assert body["result"]["members"][0]["elementId"] == 9001
    assert body["warnings"] == []
    assert body["files"]["model"]["name"] == "M02_edited.json"
    assert body["files"]["result"]["name"] == "M02_lifting_nastranResult.json"
    assert body["hullNo"] == "3469" and body["name"] == "M02_lifting.bdf"
    # Wire·훅 위치를 그릴 자세안정성 결과도 그 실행의 사본으로 온다
    assert body["stability"] == STABILITY


def test_uses_archived_stability_even_if_workdir_changed(db_session, tmp_path, monkeypatch):
    work, record = _setup(tmp_path, monkeypatch, db_session)
    (work / "M02_stability.json").write_text(json.dumps({"visualization": {"wires": []}}), encoding="utf-8")

    body = _client(db_session, "OWNER01").get(f"/api/analysis/unit-structural/{record.id}/result-set").json()

    assert body["stability"] == STABILITY


def test_missing_stability_still_opens_with_warning(db_session, tmp_path, monkeypatch):
    _, record = _setup(tmp_path, monkeypatch, db_session, stability=False)

    res = _client(db_session, "OWNER01").get(f"/api/analysis/unit-structural/{record.id}/result-set")

    assert res.status_code == 200
    assert res.json()["stability"] is None
    assert any("Wire" in w for w in res.json()["warnings"])


def test_no_edits_uses_original_stage_json(db_session, tmp_path, monkeypatch):
    _, record = _setup(tmp_path, monkeypatch, db_session, edited=False)

    body = _client(db_session, "OWNER01").get(f"/api/analysis/unit-structural/{record.id}/result-set").json()

    assert body["model"] == {"tag": "original"}
    assert body["modelSource"] == "workdir-original"
    assert body["warnings"] == []


def test_old_record_without_archive_warns(db_session, tmp_path, monkeypatch):
    _, record = _setup(tmp_path, monkeypatch, db_session, archive=False)

    body = _client(db_session, "OWNER01").get(f"/api/analysis/unit-structural/{record.id}/result-set").json()

    assert body["model"] == {"tag": "edited-at-solve"}
    assert body["modelSource"] == "workdir-edited"
    assert body["warnings"] == [WORKDIR_MODEL_WARNING]


def test_missing_result_is_404(db_session, tmp_path, monkeypatch):
    work, record = _setup(tmp_path, monkeypatch, db_session, archive=False)
    (work / "M02_lifting_nastranResult.json").unlink()

    res = _client(db_session, "OWNER01").get(f"/api/analysis/unit-structural/{record.id}/result-set")

    assert res.status_code == 404


def test_drm_wrapped_model_is_422(db_session, tmp_path, monkeypatch):
    work, record = _setup(tmp_path, monkeypatch, db_session, archive=False)
    (work / "M02_edited.json").write_bytes(b"HHIDRMC" + b"\x00" * 64)

    res = _client(db_session, "OWNER01").get(f"/api/analysis/unit-structural/{record.id}/result-set")

    assert res.status_code == 422
    assert "DRM" in res.json()["detail"]


def test_other_user_is_forbidden(db_session, tmp_path, monkeypatch):
    _, record = _setup(tmp_path, monkeypatch, db_session)
    db_session.add(models.User(employee_id="OTHER01", name="x", is_active=True, is_admin=False))
    db_session.commit()

    res = _client(db_session, "OTHER01").get(f"/api/analysis/unit-structural/{record.id}/result-set")

    assert res.status_code == 403
