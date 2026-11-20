"""소모듈 Case (Truss Lifting Studio) — 한 부모 BDF 아래 소모듈 여러 개를 따로 해석하는 이름 규칙.

Studio 가 Case 마다 `<bdfStem>__<caseId>_edited.json / _posture.json` 을 올리고 자세안정성이
`<bdfStem>__<caseId>_stability.json` 을 만든다. 구조 해석은 그 이름에서 Case 를 읽어 산출물을
`<bdfStem>__<caseId>_lifting.*` 으로 쓴다. Case 표식이 없는 이름은 예전 그대로여야 한다(MU, Side Passage).
"""
import os
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import database, models
from app.dependencies import require_auth
from app.routers import analysis
from app.services.lifting_artifacts import scan_lifting_artifacts
from app.services.unit_structural_service import build_lifting_bdf, read_case_name, resolve_work_stem


@pytest.mark.parametrize("stability, expected", [
    ("M_stability.json", ("M", None)),                      # MU, Side Passage, 옛 Truss Studio
    ("M_edit_stability.json", ("M", None)),                 # 밑줄 하나 — Case 아님
    ("M__c1_stability.json", ("M__c1", "c1")),
    ("M__mlx3k2a0_stability.json", ("M__mlx3k2a0", "mlx3k2a0")),
    ("M__c1_STABILITY.JSON", ("M__c1", "c1")),              # Windows 는 대소문자를 가리지 않는다
    ("M__a_b_stability.json", ("M", None)),                 # Case id 는 영문과 숫자만
    ("M___stability.json", ("M", None)),                    # 빈 Case id
    ("Other__c1_stability.json", ("M", None)),              # 다른 BDF 의 이름
    ("M__c1_posture.json", ("M", None)),                    # stability 파일이 아님
    ("", ("M", None)),
    (None, ("M", None)),
])
def test_resolve_work_stem(stability, expected, tmp_path):
    bdf = str(tmp_path / "M.bdf")
    path = str(tmp_path / stability) if stability else stability
    assert resolve_work_stem(bdf, path) == expected


def test_resolve_work_stem_keeps_dots_and_underscores_of_the_bdf_name(tmp_path):
    bdf = str(tmp_path / "174k_2tk_rev5_DesignNo.6.bdf")
    stem = "174k_2tk_rev5_DesignNo.6"
    assert resolve_work_stem(bdf, str(tmp_path / f"{stem}__m1_stability.json")) == (f"{stem}__m1", "m1")
    assert resolve_work_stem(bdf, str(tmp_path / f"{stem}_stability.json")) == (stem, None)


def test_case_run_without_its_module_model_fails_instead_of_solving_the_global_bdf(tmp_path):
    """Case 의 소모듈 모델이 없으면 글로벌 BDF 로 넘어가지 않는다 — 조용히 전체 모델을 풀면 결과가 그럴듯하게 틀린다."""
    bdf = tmp_path / "M.bdf"
    bdf.write_text("CEND\nBEGIN BULK\nENDDATA\n", encoding="utf-8")
    stab = tmp_path / "M__c1_stability.json"
    stab.write_text("{}", encoding="utf-8")
    with pytest.raises(FileNotFoundError) as err:
        build_lifting_bdf(str(bdf), str(stab), 1.2,
                          str(tmp_path / "M__c1_lifting.bdf"), str(tmp_path / "M__c1_lifting_meta.json"),
                          str(tmp_path / "M__c1_edited.bdf"), work_stem="M__c1")
    assert "M__c1_edited.json" in str(err.value)


def test_read_case_name(tmp_path):
    good = tmp_path / "a.json"
    good.write_text('{"meta": {"trussModule": {"name": "소모듈 2"}}}', encoding="utf-8")
    assert read_case_name(str(good)) == "소모듈 2"
    plain = tmp_path / "b.json"
    plain.write_text('{"meta": {}}', encoding="utf-8")
    assert read_case_name(str(plain)) is None
    assert read_case_name(str(tmp_path / "missing.json")) is None
    broken = tmp_path / "c.json"
    broken.write_text("{", encoding="utf-8")
    assert read_case_name(str(broken)) is None


def test_exact_scan_does_not_borrow_another_case_file(tmp_path):
    (tmp_path / "M__c1_lifting.bdf").write_text("x", encoding="utf-8")
    (tmp_path / "M__c1_lifting.f06").write_text("x", encoding="utf-8")
    (tmp_path / "M__c2_lifting.bdf").write_text("x", encoding="utf-8")
    c2 = scan_lifting_artifacts(str(tmp_path), "M__c2", exact=True)
    assert [os.path.basename(a["path"]) for a in c2] == ["M__c2_lifting.bdf"]   # c1 의 f06 을 집지 않는다
    # 예전 호출(글롭 폴백)은 그대로다
    assert any(a["kind"] == "liftingBdf" for a in scan_lifting_artifacts(str(tmp_path), "Nope"))


# ── 라우트 ──────────────────────────────────────────────────────────

def _client(db_session, employee_id: str) -> TestClient:
    app = FastAPI()
    app.include_router(analysis.router)

    def override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = override_db
    app.dependency_overrides[require_auth] = lambda: employee_id
    return TestClient(app)


def _workspace(tmp_path, monkeypatch, db_session, owner="OWNER01"):
    base = tmp_path / "userConnection"
    work_dir = base / f"20261118_100000_{owner}_TrussModuleLifting"
    work_dir.mkdir(parents=True)
    bdf_path = work_dir / "G.bdf"
    bdf_path.write_text("CEND\nBEGIN BULK\nENDDATA\n", encoding="utf-8")
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))
    monkeypatch.setattr(analysis, "_ALLOWED_DOWNLOAD_BASE", str(base))
    parent = models.Analysis(
        employee_id=owner, program_name="TrussModuleLifting", project_name="p",
        status="Success", input_info={"bdf_model": str(bdf_path)}, result_info={},
    )
    db_session.add(parent)
    db_session.commit()
    return work_dir, bdf_path, parent


def test_lifting_bdf_preview_of_a_case_uses_the_case_stem(db_session, tmp_path, monkeypatch):
    work_dir, _bdf, parent = _workspace(tmp_path, monkeypatch, db_session)
    stability = work_dir / "G__c2_stability.json"
    stability.write_text("{}", encoding="utf-8")
    calls = {}

    def fake_build(bdf, stab, sf, lifting_bdf, meta, edited_bdf, job_id=None, work_stem=None):
        calls.update(lifting_bdf=lifting_bdf, edited_bdf=edited_bdf, work_stem=work_stem)
        with open(lifting_bdf, "w", encoding="utf-8", newline="") as f:
            f.write("SOL 101\n")
        return ""

    monkeypatch.setattr(analysis, "build_lifting_bdf", fake_build)
    res = _client(db_session, "OWNER01").post("/api/analysis/unit-structural/lifting-bdf", json={
        "parentAnalysisId": parent.id, "stabilityPath": str(stability), "safetyFactor": 1.2,
    })
    assert res.status_code == 200, res.text
    assert calls["work_stem"] == "G__c2"
    assert os.path.basename(calls["lifting_bdf"]) == "G__c2_lifting.bdf"
    assert os.path.basename(calls["edited_bdf"]) == "G__c2_edited.bdf"


def test_artifacts_list_each_case_with_its_latest_success(db_session, tmp_path, monkeypatch):
    work_dir, _bdf, parent = _workspace(tmp_path, monkeypatch, db_session)
    for name in ("G__c1_lifting.bdf", "G__c1_lifting.f06", "G__c2_lifting.bdf"):
        (work_dir / name).write_text("x", encoding="utf-8")

    def unit(hour, status, case_id=None, case_name=None):
        info = {"parent_analysis_id": parent.id}
        if case_id:
            info.update(case_id=case_id, case_name=case_name)
        rec = models.Analysis(employee_id="OWNER01", program_name="UnitStructuralAnalysis", project_name=f"u{hour}",
                              status=status, created_at=datetime(2026, 11, 18, hour), input_info=info)
        db_session.add(rec)
        db_session.commit()
        return rec

    old_c1 = unit(10, "Success", "c1", "소모듈 1")
    new_c1 = unit(12, "Success", "c1", "소모듈 1")
    c2 = unit(11, "Success", "c2", "소모듈 2")
    unit(13, "Failed", "c2", "소모듈 2")

    res = _client(db_session, "OWNER01").get(f"/api/analysis/groupmoduleunit/{parent.id}/artifacts")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["unitStructuralAnalysisId"] == new_c1.id                     # 예전 값은 그대로(가장 최근 성공)
    by_case = {c["caseId"]: c for c in body["cases"]}
    assert set(by_case) == {"c1", "c2"}
    assert by_case["c1"]["unitStructuralAnalysisId"] == new_c1.id != old_c1.id
    assert by_case["c1"]["caseName"] == "소모듈 1"
    assert by_case["c2"]["unitStructuralAnalysisId"] == c2.id
    assert sorted(os.path.basename(a["path"]) for a in by_case["c1"]["artifacts"]) == ["G__c1_lifting.bdf", "G__c1_lifting.f06"]
    assert [os.path.basename(a["path"]) for a in by_case["c2"]["artifacts"]] == ["G__c2_lifting.bdf"]


def test_artifacts_without_cases_return_an_empty_list(db_session, tmp_path, monkeypatch):
    _work, _bdf, parent = _workspace(tmp_path, monkeypatch, db_session)
    rec = models.Analysis(employee_id="OWNER01", program_name="UnitStructuralAnalysis", project_name="u",
                          status="Success", input_info={"parent_analysis_id": parent.id})
    db_session.add(rec)
    db_session.commit()
    body = _client(db_session, "OWNER01").get(f"/api/analysis/groupmoduleunit/{parent.id}/artifacts").json()
    assert body["cases"] == [] and body["unitStructuralAnalysisId"] == rec.id
