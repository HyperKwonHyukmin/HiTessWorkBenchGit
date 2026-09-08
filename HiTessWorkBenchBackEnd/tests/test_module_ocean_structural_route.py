"""POST /structural-run 라우트 회귀 테스트.

이 파일이 없어서 `assert_current_user_can_access_path` 를 잘못된 인자 순서·개수로
부른 버그가 그대로 배포됐다(요청 즉시 TypeError → 500, 브라우저에는 CORS 오류로 보임).
순수 함수 테스트만으로는 라우트가 실제로 열리는지 알 수 없다.
"""
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import database, models
from app.dependencies import require_auth
from app.routers import module_ocean_transport as mod


def _client(db_session, employee_id: str) -> TestClient:
    app = FastAPI()
    app.include_router(mod.router)

    def override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = override_db
    app.dependency_overrides[require_auth] = lambda: employee_id
    return TestClient(app)


def _workspace(tmp_path, monkeypatch, owner="OWNER01"):
    base = tmp_path / "userConnection"
    work_dir = base / f"20260903_120000_{owner}_{mod.PROGRAM_NAME}"
    work_dir.mkdir(parents=True)
    bdf_path = work_dir / "model.bdf"
    bdf_path.write_text("CEND\nBEGIN BULK\nENDDATA\n", encoding="utf-8")
    monkeypatch.setattr(mod, "_USER_CONNECTION_DIR", str(base))
    return bdf_path


def _body(bdf_path, **overrides):
    body = {
        "bdf_path": str(bdf_path),
        "deck_type": "A",
        "support_node_ids": [101, 102, 103],
        "placement": {
            "anchorMm": [143000.0, -13000.0, 29262.0],
            "rotationZDeg": 0.0,
            "offsetXMm": 0.0,
            "offsetYMm": 0.0,
        },
        "total_mass_t": 99.93,
        "total_cog_mm": [46589.0, -2075.0, 9840.0],
        "accel": {"ax": 0.3, "ay": 0.0, "az": -1.0},
        "material": {"sigmaYMPa": 275.0, "factor": 0.8},
    }
    body.update(overrides)
    return body


def _acceleration_body(**overrides):
    body = {
        "significantWaveHeightM": 2.0,
        "criticalDampingPct": 3,
        "cargoPosition": "single-center",
        "cargoWeightT": 207.7,
        "cargoVcgFromBottomM": 1.2,
        "bargeDepthM": 4.5,
        "supportHeightM": 3.4,
        "loadCase": "LC1",
    }
    body.update(overrides)
    return body


def test_acceleration_calculate_matches_excel_default(db_session):
    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/acceleration-calculate",
        json=_acceleration_body(),
    )

    assert response.status_code == 200, response.text
    result = response.json()
    assert result["dynamicAccelerationMS2"]["x"] == pytest.approx(0.610791949132211, abs=1e-6)
    assert result["totalAccelerationG"]["az"] == pytest.approx(-1.10938108161737, abs=1e-6)


def test_acceleration_calculate_rejects_out_of_range_input(db_session):
    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/acceleration-calculate",
        json=_acceleration_body(significantWaveHeightM=3.1),
    )

    assert response.status_code == 400
    assert "1~3" in response.json()["detail"]


def test_structural_run_accepts_owner_request(db_session, tmp_path, monkeypatch):
    """정상 요청이 202/200 으로 접수되는지 — 인자 순서 실수 같은 TypeError 를 잡는다."""
    bdf_path = _workspace(tmp_path, monkeypatch)
    submitted = {}

    def fake_submit(task_fn, payload, **kwargs):
        submitted["payload"] = payload
        submitted["kwargs"] = kwargs
        return "job-test"

    monkeypatch.setattr(mod, "submit_analysis_job", fake_submit)

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/structural-run",
        json=_body(bdf_path),
    )

    assert response.status_code == 200, response.text
    assert response.json()["job_id"] == "job-test"
    payload = submitted["payload"]
    assert payload["employee_id"] == "OWNER01"
    assert payload["bdf_path"] == os.path.abspath(str(bdf_path))
    assert payload["support_node_ids"] == [101, 102, 103]
    # 소유자 추론이 안 되는 payload 라 metadata 를 명시해야 한다.
    assert submitted["kwargs"]["metadata"].employee_id == "OWNER01"


def test_structural_run_verifies_and_preserves_acceleration_calculation(
    db_session, tmp_path, monkeypatch,
):
    bdf_path = _workspace(tmp_path, monkeypatch)
    submitted = {}

    def fake_submit(_task_fn, payload, **_kwargs):
        submitted["payload"] = payload
        return "job-accel"

    monkeypatch.setattr(mod, "submit_analysis_job", fake_submit)
    calculated = mod._calculate_barge_acceleration(mod.BargeAccelerationInput(**_acceleration_body()))
    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/structural-run",
        json=_body(
            bdf_path,
            accel=calculated["totalAccelerationG"],
            accelerationCalculation=_acceleration_body(),
        ),
    )

    assert response.status_code == 200, response.text
    assert submitted["payload"]["acceleration_calculation"]["loadCase"]["id"] == "LC1"


def test_structural_run_rejects_stale_calculated_acceleration(
    db_session, tmp_path, monkeypatch,
):
    bdf_path = _workspace(tmp_path, monkeypatch)
    monkeypatch.setattr(mod, "submit_analysis_job",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("제출되면 안 된다")))

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/structural-run",
        json=_body(bdf_path, accelerationCalculation=_acceleration_body()),
    )

    assert response.status_code == 400
    assert "일치하지 않습니다" in response.json()["detail"]


def test_structural_run_blocks_cross_user(db_session, tmp_path, monkeypatch):
    """남의 userConnection 폴더에 있는 BDF 로는 해석을 걸 수 없다."""
    bdf_path = _workspace(tmp_path, monkeypatch, owner="OWNER01")
    monkeypatch.setattr(mod, "submit_analysis_job",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("제출되면 안 된다")))

    response = _client(db_session, "OTHER01").post(
        "/api/analysis/module-ocean-transport/structural-run",
        json=_body(bdf_path),
    )

    assert response.status_code == 403, response.text


def test_structural_run_rejects_zero_acceleration(db_session, tmp_path, monkeypatch):
    """가속도가 0 이면 하중이 없어 해석 자체가 의미 없다."""
    bdf_path = _workspace(tmp_path, monkeypatch)
    monkeypatch.setattr(mod, "submit_analysis_job",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("제출되면 안 된다")))

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/structural-run",
        json=_body(bdf_path, accel={"ax": 0.0, "ay": 0.0, "az": 0.0}),
    )

    assert response.status_code == 400


def test_structural_run_rejects_unknown_deck(db_session, tmp_path, monkeypatch):
    bdf_path = _workspace(tmp_path, monkeypatch)
    monkeypatch.setattr(mod, "submit_analysis_job",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("제출되면 안 된다")))

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/structural-run",
        json=_body(bdf_path, deck_type="ZZ"),
    )

    assert response.status_code == 400


def test_structural_run_rejects_empty_supports(db_session, tmp_path, monkeypatch):
    bdf_path = _workspace(tmp_path, monkeypatch)
    monkeypatch.setattr(mod, "submit_analysis_job",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("제출되면 안 된다")))

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/structural-run",
        json=_body(bdf_path, support_node_ids=[]),
    )

    assert response.status_code == 400


def test_structural_run_rejects_path_outside_user_connection(db_session, tmp_path, monkeypatch):
    _workspace(tmp_path, monkeypatch)
    outside = tmp_path / "elsewhere.bdf"
    outside.write_text("CEND\n", encoding="utf-8")
    monkeypatch.setattr(mod, "submit_analysis_job",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("제출되면 안 된다")))

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/structural-run",
        json=_body(outside),
    )

    assert response.status_code == 400


# ── 1단계 접수: 작업 폴더 이름 ────────────────────────────────────────────
# 예전에는 프론트가 GMU 엔드포인트를 직접 불러 폴더가 `..._GroupModuleUnit` 이 됐고,
# 3단계 산출물까지 그 안에 쌓여 어느 앱의 해석인지 구분할 수 없었다.

def test_step1_request_uses_this_apps_program_name(db_session, tmp_path, monkeypatch):
    captured = {}

    def fake_make_work_dir(employee_id, program_name):
        captured["employee_id"] = employee_id
        captured["program_name"] = program_name
        d = tmp_path / f"20260903_120000_{employee_id}_{program_name}"
        d.mkdir(parents=True)
        return str(d), "20260903_120000"

    def fake_submit(task_fn, *args, **kwargs):
        captured["task"] = task_fn.__name__
        captured["args"] = args
        return "job-step1"

    monkeypatch.setattr(mod, "make_work_dir", fake_make_work_dir)
    monkeypatch.setattr(mod, "submit_analysis_job", fake_submit)

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/request",
        data={"employee_id": "OWNER01", "use_nastran": "false", "source": "Workbench"},
        files={"bdf_file": ("model.bdf", b"CEND\nBEGIN BULK\nENDDATA\n", "text/plain")},
    )

    assert response.status_code == 200, response.text
    assert response.json()["job_id"] == "job-step1"
    assert captured["program_name"] == "ModuleOceanMoving"
    # 검증 엔진은 GMU 것을 재사용한다 — 바뀐 것은 폴더/기록 이름뿐이다.
    assert captured["task"] == "task_execute_groupmoduleunit"
    # 마지막 인자가 task 로 넘어가는 program_name 이다(DB 기록에 그대로 쓰인다).
    assert captured["args"][-1] == "ModuleOceanMoving"


def test_step1_request_rejects_other_employee_id(db_session, tmp_path, monkeypatch):
    """Form 의 사번은 클라이언트 임의값이라 인증 사번과 대조해야 한다."""
    monkeypatch.setattr(mod, "make_work_dir",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("폴더가 만들어지면 안 된다")))

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/request",
        data={"employee_id": "OTHER01"},
        files={"bdf_file": ("model.bdf", b"CEND\n", "text/plain")},
    )
    assert response.status_code == 403


def test_structural_run_writes_into_the_step1_folder(db_session, tmp_path, monkeypatch):
    """3단계 산출물은 1단계와 **같은 폴더** 에 쌓여야 사용자가 한 자리에서 확인한다."""
    bdf_path = _workspace(tmp_path, monkeypatch)
    submitted = {}
    monkeypatch.setattr(mod, "submit_analysis_job",
                        lambda task, payload, **k: submitted.update(payload) or "job-test")

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/structural-run",
        json=_body(bdf_path),
    )

    assert response.status_code == 200, response.text
    assert submitted["work_dir"] == os.path.dirname(os.path.abspath(str(bdf_path)))
    assert os.path.basename(submitted["work_dir"]).endswith("_ModuleOceanMoving")
    assert mod.PROGRAM_NAME == "ModuleOceanMoving"


# ── 과정 2: Leg 용접부 평가 ───────────────────────────────────────────────

def test_structural_run_carries_the_weld_spec_into_the_job(db_session, tmp_path, monkeypatch):
    """화면에서 고친 용접 사양이 해석 job 까지 실려 가야 한다."""
    bdf_path = _workspace(tmp_path, monkeypatch)
    submitted = {}
    monkeypatch.setattr(mod, "submit_analysis_job",
                        lambda task, payload, **k: submitted.update(payload) or "job-test")

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/structural-run",
        json=_body(bdf_path, weld={
            "plateHeightMm": 600.0,
            "plateBreadthMm": 550.0,
            "weldLegMm": 12.0,
            "safetyFactor": 2.5,
        }),
    )

    assert response.status_code == 200, response.text
    assert submitted["weld_spec"]["plateHeightMm"] == 600.0
    assert submitted["weld_spec"]["plateBreadthMm"] == 550.0
    assert submitted["weld_spec"]["weldLegMm"] == 12.0
    assert submitted["weld_spec"]["tackCount"] == 4
    assert submitted["weld_spec"]["safetyFactor"] == 2.5
    # 안 보낸 항목은 Excel reference 화면의 기본값으로 채워진다.
    assert submitted["weld_spec"]["yieldMPa"] == 450.0


def test_structural_run_uses_default_weld_spec_when_omitted(db_session, tmp_path, monkeypatch):
    """용접 사양을 아예 안 보내는 옛 프론트도 계속 동작해야 한다."""
    bdf_path = _workspace(tmp_path, monkeypatch)
    submitted = {}
    monkeypatch.setattr(mod, "submit_analysis_job",
                        lambda task, payload, **k: submitted.update(payload) or "job-test")

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/structural-run", json=_body(bdf_path))

    assert response.status_code == 200, response.text
    assert submitted["weld_spec"] == {
        "yieldMPa": 450.0, "safetyFactor": 3.0,
        "plateHeightMm": 500.0, "plateBreadthMm": 500.0,
        "tackCount": 4, "weldLengthMm": 268.0, "weldLegMm": 10.0,
    }


def test_structural_run_expands_legacy_square_pad_input(db_session, tmp_path, monkeypatch):
    """schema v1 클라이언트의 padSizeMm도 동일한 정사각형 치수로 보존한다."""
    bdf_path = _workspace(tmp_path, monkeypatch)
    submitted = {}
    monkeypatch.setattr(mod, "submit_analysis_job",
                        lambda task, payload, **k: submitted.update(payload) or "job-test")

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/structural-run",
        json=_body(bdf_path, weld={
            "padSizeMm": 300.0,
            "weldLengthMm": 100.0,
            "weldLegMm": 8.0,
        }),
    )

    assert response.status_code == 200, response.text
    assert submitted["weld_spec"]["plateHeightMm"] == 300.0
    assert submitted["weld_spec"]["plateBreadthMm"] == 300.0
    assert "padSizeMm" not in submitted["weld_spec"]


def test_structural_run_rejects_weld_longer_than_plate(db_session, tmp_path, monkeypatch):
    bdf_path = _workspace(tmp_path, monkeypatch)
    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/structural-run",
        json=_body(bdf_path, weld={
            "plateHeightMm": 200.0,
            "plateBreadthMm": 300.0,
            "weldLengthMm": 250.0,
        }),
    )

    assert response.status_code == 422
    assert "Plate" in response.text


def _leg_result_file(tmp_path, monkeypatch, owner="OWNER01"):
    """과정 2 결과 파일이 놓인 작업 폴더를 만든다."""
    import json as _json
    base = tmp_path / "userConnection"
    work_dir = base / f"20260903_120000_{owner}_{mod.PROGRAM_NAME}"
    work_dir.mkdir(parents=True)
    path = work_dir / "model_ocean_legreact.json"
    path.write_text(_json.dumps({
        "legs": [
            {"index": 1, "jungbanNodeId": 102723, "x": 20260.0, "y": 5200.0, "z": -125.0,
             "fxN": -290.0, "fyN": -1960.0, "fzN": 6750.0,
             "mxNmm": 2.0e06, "myNmm": -7.15e05, "mzNmm": 1.0e05},
        ],
    }, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(mod, "_USER_CONNECTION_DIR", str(base))
    return path


def test_weld_assess_reevaluates_without_rerunning_nastran(db_session, tmp_path, monkeypatch):
    """사양만 바꾼 재평가 — 저장된 반력으로 즉시 판정하고 결과 파일을 남긴다."""
    leg_json = _leg_result_file(tmp_path, monkeypatch)

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/weld-assess",
        json={"leg_result_json": str(leg_json), "weld": {"weldLegMm": 8.0}},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["schema"] == "module-ocean-weld/2"
    assert body["method"] == "elastic-line-weld-group"
    assert body["legs"][0]["sigmaEqMPa"] > 0.0
    assert body["legs"][0]["tauTorsionMPa"] > 0.0
    assert body["legs"][0]["governingPoint"]["key"]
    assert body["legs"][0]["status"] == "OK"
    assert body["summary"]["allowableMPa"] == 150.0
    # 사용자가 폴더에서 확인할 수 있도록 반력 결과 옆에 저장된다.
    saved = leg_json.parent / "model_ocean_weld.json"
    assert saved.exists()
    assert body["resultJson"] == str(saved)


def test_weld_assess_spec_change_moves_the_result(db_session, tmp_path, monkeypatch):
    leg_json = _leg_result_file(tmp_path, monkeypatch)
    client = _client(db_session, "OWNER01")

    base = client.post("/api/analysis/module-ocean-transport/weld-assess",
                       json={"leg_result_json": str(leg_json)}).json()
    thick = client.post("/api/analysis/module-ocean-transport/weld-assess",
                        json={"leg_result_json": str(leg_json),
                              "weld": {"weldLegMm": 12.0}}).json()

    assert thick["summary"]["maxSigmaEqMPa"] < base["summary"]["maxSigmaEqMPa"]
    # 재평가는 같은 파일을 덮어써야 한다 — 폴더에 옛 판정이 남으면 안 된다.
    assert thick["resultJson"] == base["resultJson"]


def test_weld_assess_blocks_cross_user(db_session, tmp_path, monkeypatch):
    leg_json = _leg_result_file(tmp_path, monkeypatch, owner="OWNER01")
    response = _client(db_session, "OTHER01").post(
        "/api/analysis/module-ocean-transport/weld-assess",
        json={"leg_result_json": str(leg_json)},
    )
    assert response.status_code == 403


def test_weld_assess_rejects_path_outside_user_connection(db_session, tmp_path, monkeypatch):
    _leg_result_file(tmp_path, monkeypatch)
    outside = tmp_path / "elsewhere.json"
    outside.write_text('{"legs": []}', encoding="utf-8")

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/weld-assess",
        json={"leg_result_json": str(outside)},
    )
    assert response.status_code == 400


def test_weld_assess_rejects_absurd_spec(db_session, tmp_path, monkeypatch):
    """오타 방어 — 각장 800mm 를 넣으면 무엇이든 OK 로 통과해 버린다."""
    leg_json = _leg_result_file(tmp_path, monkeypatch)
    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/weld-assess",
        json={"leg_result_json": str(leg_json), "weld": {"weldLegMm": 800.0}},
    )
    assert response.status_code == 422


def test_weld_assess_reports_empty_legs_readably(db_session, tmp_path, monkeypatch):
    leg_json = _leg_result_file(tmp_path, monkeypatch)
    leg_json.write_text('{"legs": []}', encoding="utf-8")

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/weld-assess",
        json={"leg_result_json": str(leg_json)},
    )
    assert response.status_code == 400
    assert "Leg 반력" in response.json()["detail"]


def test_structural_run_defaults_small_bore_exclusion(db_session, tmp_path, monkeypatch):
    """요청이 값을 안 주면 서버가 기본 기준(2\" · OD 60.5mm)을 쓴다."""
    bdf_path = _workspace(tmp_path, monkeypatch)
    submitted = {}
    monkeypatch.setattr(mod, "submit_analysis_job",
                        lambda task_fn, payload, **kw: submitted.setdefault("p", payload) and "j" or "j")

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/structural-run", json=_body(bdf_path))

    assert response.status_code == 200, response.text
    assert submitted["p"]["small_bore_max_od_mm"] == mod.DEFAULT_SMALL_BORE_MAX_OD_MM


def test_structural_run_passes_zero_small_bore_through_as_no_exclusion(
        db_session, tmp_path, monkeypatch):
    """0 은 '제외 안 함'이라는 사용자 의도다 — falsy 라고 기본값으로 되살리면 안 된다."""
    bdf_path = _workspace(tmp_path, monkeypatch)
    submitted = {}
    monkeypatch.setattr(mod, "submit_analysis_job",
                        lambda task_fn, payload, **kw: submitted.setdefault("p", payload) and "j" or "j")

    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/structural-run",
        json=_body(bdf_path, small_bore_max_od_mm=0))

    assert response.status_code == 200, response.text
    assert submitted["p"]["small_bore_max_od_mm"] == 0.0


def test_structural_run_rejects_absurd_small_bore_threshold(db_session, tmp_path, monkeypatch):
    """배관 전체를 빼 버릴 만큼 큰 값은 막는다 — 부재 평가라는 취지가 무너진다."""
    bdf_path = _workspace(tmp_path, monkeypatch)
    response = _client(db_session, "OWNER01").post(
        "/api/analysis/module-ocean-transport/structural-run",
        json=_body(bdf_path, small_bore_max_od_mm=600))
    assert response.status_code == 422
