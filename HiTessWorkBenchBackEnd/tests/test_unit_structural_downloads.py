"""Unit 구조 해석 — Wire 포함 BDF / 결과 OP2 다운로드 라우트 회귀 테스트.

Studio Analysis 탭의 'Wire 포함 BDF 다운로드'(자세안정성 평가 후)와
Analysis·Save 탭의 'OP2 다운로드'(구조 해석 성공 후)가 쓰는 엔드포인트다.
"""
import os
import urllib.parse

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import database, models
from app.dependencies import require_auth
from app.routers import analysis
from app.services.unit_structural_service import find_lifting_op2


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
    work_dir = base / f"20260928_100000_{owner}_GroupModuleUnit"
    work_dir.mkdir(parents=True)
    bdf_path = work_dir / "Model_A.bdf"
    bdf_path.write_text("CEND\nBEGIN BULK\nENDDATA\n", encoding="utf-8")
    stability = work_dir / "Model_A_stability.json"
    stability.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))
    monkeypatch.setattr(analysis, "_ALLOWED_DOWNLOAD_BASE", str(base))
    parent = models.Analysis(
        employee_id=owner, program_name="GroupModuleUnit", project_name="p",
        status="Success", input_info={"bdf_model": str(bdf_path)}, result_info={},
    )
    db_session.add(parent)
    db_session.commit()
    return work_dir, bdf_path, stability, parent


def _unit_record(db_session, work_dir, status="Success", owner="OWNER01", op2=True):
    lifting_bdf = work_dir / "Model_A_lifting.bdf"
    lifting_bdf.write_bytes(b"SOL 101\n$ solved\n")
    info = {"liftingBdf": str(lifting_bdf)}
    if op2:
        # Nastran 은 출력 파일명을 소문자로 쓴다.
        (work_dir / "model_a_lifting.op2").write_bytes(b"\x00OP2DATA\xff")
    record = models.Analysis(
        employee_id=owner, program_name="UnitStructuralAnalysis", project_name="u",
        status=status, input_info={}, result_info=info,
    )
    db_session.add(record)
    db_session.commit()
    return record


def test_lifting_bdf_preview_uses_shared_builder_in_temp_folder(db_session, tmp_path, monkeypatch):
    work_dir, bdf_path, stability, parent = _workspace(tmp_path, monkeypatch, db_session)
    calls = {}

    def fake_build(bdf, stab, sf, lifting_bdf, meta, edited_bdf, job_id=None):
        calls.update(bdf=bdf, stab=stab, sf=sf, lifting_bdf=lifting_bdf, job_id=job_id)
        with open(lifting_bdf, "w", encoding="utf-8", newline="") as f:
            f.write("SOL 101\n$ wire\n")
        with open(meta, "w", encoding="utf-8") as f:
            f.write("{}")
        return ""

    monkeypatch.setattr(analysis, "build_lifting_bdf", fake_build)
    res = _client(db_session, "OWNER01").post("/api/analysis/unit-structural/lifting-bdf", json={
        "parentAnalysisId": parent.id, "stabilityPath": str(stability), "safetyFactor": 1.25,
    })

    assert res.status_code == 200, res.text
    assert res.text == "SOL 101\n$ wire\n"
    assert urllib.parse.unquote(res.headers["x-filename"]) == "Model_A_lifting.bdf"
    assert calls["sf"] == 1.25 and calls["job_id"] is None
    # 해석과 같은 파일명으로 만들되, 해석 산출물 자리(work_dir 바로 아래)는 건드리지 않는다.
    assert os.path.basename(calls["lifting_bdf"]) == "Model_A_lifting.bdf"
    assert os.path.dirname(calls["lifting_bdf"]) != str(work_dir)
    assert not (work_dir / "Model_A_lifting.bdf").exists()
    # 임시 폴더는 응답 후 지워진다.
    assert not os.path.exists(os.path.dirname(calls["lifting_bdf"]))


def test_lifting_bdf_with_analysis_id_returns_the_solved_bdf(db_session, tmp_path, monkeypatch):
    work_dir, _bdf, _stab, parent = _workspace(tmp_path, monkeypatch, db_session)
    record = _unit_record(db_session, work_dir)
    monkeypatch.setattr(analysis, "build_lifting_bdf", lambda *a, **k: (_ for _ in ()).throw(AssertionError("재생성 금지")))

    res = _client(db_session, "OWNER01").post("/api/analysis/unit-structural/lifting-bdf", json={
        "parentAnalysisId": parent.id, "analysisId": record.id,
    })

    assert res.status_code == 200, res.text
    assert res.text == "SOL 101\n$ solved\n"


def test_lifting_bdf_rejects_other_user_and_bad_safety_factor(db_session, tmp_path, monkeypatch):
    _work, _bdf, stability, parent = _workspace(tmp_path, monkeypatch, db_session)
    body = {"parentAnalysisId": parent.id, "stabilityPath": str(stability), "safetyFactor": 1.2}

    assert _client(db_session, "OTHER01").post(
        "/api/analysis/unit-structural/lifting-bdf", json=body).status_code == 403
    bad = _client(db_session, "OWNER01").post(
        "/api/analysis/unit-structural/lifting-bdf", json={**body, "safetyFactor": 0})
    assert bad.status_code == 400
    assert "safetyFactor" in bad.json()["detail"]


def test_lifting_bdf_rejects_stability_outside_parent_folder(db_session, tmp_path, monkeypatch):
    work_dir, _bdf, _stab, parent = _workspace(tmp_path, monkeypatch, db_session)
    other = work_dir.parent / "other"
    other.mkdir()
    (other / "x_stability.json").write_text("{}", encoding="utf-8")
    res = _client(db_session, "OWNER01").post("/api/analysis/unit-structural/lifting-bdf", json={
        "parentAnalysisId": parent.id, "stabilityPath": str(other / "x_stability.json"),
    })
    assert res.status_code == 400


def test_op2_download_returns_bytes_named_like_bdf(db_session, tmp_path, monkeypatch):
    work_dir, _bdf, _stab, _parent = _workspace(tmp_path, monkeypatch, db_session)
    record = _unit_record(db_session, work_dir)

    res = _client(db_session, "OWNER01").get(f"/api/analysis/unit-structural/{record.id}/op2")

    assert res.status_code == 200, res.text
    assert res.content == b"\x00OP2DATA\xff"
    assert urllib.parse.unquote(res.headers["x-filename"]) == "Model_A_lifting.op2"


def test_op2_download_errors(db_session, tmp_path, monkeypatch):
    work_dir, _bdf, _stab, _parent = _workspace(tmp_path, monkeypatch, db_session)
    missing = _unit_record(db_session, work_dir, op2=False)
    client = _client(db_session, "OWNER01")
    assert client.get(f"/api/analysis/unit-structural/{missing.id}/op2").status_code == 404

    failed = _unit_record(db_session, work_dir, status="Failed")
    assert client.get(f"/api/analysis/unit-structural/{failed.id}/op2").status_code == 409
    assert _client(db_session, "OTHER01").get(
        f"/api/analysis/unit-structural/{failed.id}/op2").status_code == 403


def test_find_lifting_op2_matches_case_insensitively(tmp_path):
    bdf = tmp_path / "Model_B_lifting.bdf"
    bdf.write_text("", encoding="utf-8")
    assert find_lifting_op2(str(bdf)) is None
    (tmp_path / "model_b_lifting.op2").write_bytes(b"x")
    found = find_lifting_op2(str(bdf))
    assert found and found.lower().endswith("model_b_lifting.op2")
    assert find_lifting_op2("") is None


# ── 결과 확인(Step 3)·My Projects 산출물 목록 ─────────────────────────────

def test_artifacts_offer_source_bdf_before_wire_analysis(tmp_path):
    from app.services.lifting_artifacts import scan_lifting_artifacts
    src = tmp_path / "Model_C.bdf"
    src.write_bytes(b"CEND\n")
    arts = scan_lifting_artifacts(str(tmp_path), "Model_C", source_bdf=str(src))
    assert [a["kind"] for a in arts] == ["sourceBdf"]
    assert arts[0]["fileName"] == "Model_C.bdf"


def test_artifacts_prefer_wire_bdf_and_list_op2_after_analysis(tmp_path):
    from app.services.lifting_artifacts import scan_lifting_artifacts
    src = tmp_path / "Model_C.bdf"
    src.write_bytes(b"CEND\n")
    (tmp_path / "Model_C_lifting.bdf").write_bytes(b"SOL 101\n")
    (tmp_path / "model_c_lifting.op2").write_bytes(b"\x00")
    kinds = [a["kind"] for a in scan_lifting_artifacts(str(tmp_path), "Model_C", source_bdf=str(src))]
    assert "sourceBdf" not in kinds          # Wire 해석본이 있으면 그것만
    assert "liftingBdf" in kinds and "op2" in kinds


def test_artifacts_route_includes_source_bdf(db_session, tmp_path, monkeypatch):
    _work, _bdf, _stab, parent = _workspace(tmp_path, monkeypatch, db_session)
    res = _client(db_session, "OWNER01").get(f"/api/analysis/groupmoduleunit/{parent.id}/artifacts")
    assert res.status_code == 200, res.text
    assert [a["kind"] for a in res.json()["artifacts"]] == ["sourceBdf"]