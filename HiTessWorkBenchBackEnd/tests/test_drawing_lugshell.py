"""DrawingToAnalysis 새 러그 엔진(LugShell, 2026-11-10) 연결 — 엔진 지원 확인·요약·모델 하중 그대로 해석."""
import json
import os
import types

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import database
from app.dependencies import require_auth
from app.routers import analysis
from app.services import drawing_to_analysis_service as svc

LUGSHELL_BDF = """$ LugShell - L25
SOL 101
CEND
TITLE = LugShell L25
ECHO = NONE
SPC = 1
DISPLACEMENT(PLOT) = ALL
STRESS(PLOT,CORNER) = ALL
SPCFORCES(PLOT) = ALL
SUBCASE 1
  SUBTITLE = LC1_axial
  LOAD = 101
SUBCASE 2
  SUBTITLE = LC2_inplane_30
  LOAD = 102
BEGIN BULK
PARAM,POST,-1
SPC1,1,123456,1,2
FORCE,101,3,0,1.,0.,0.,100.
FORCE,102,3,0,1.,50.,0.,86.6
ENDDATA
"""


def test_with_print_outputs_keeps_model_loads_and_prints_results():
    out = svc.with_print_outputs(LUGSHELL_BDF)
    case, bulk = out.split("BEGIN BULK")
    # 하중·경계·SUBCASE 는 그대로
    assert "SPC = 1" in case and "LOAD = 101" in case and "LOAD = 102" in case
    assert case.count("SUBCASE") == 2
    assert "SPC1,1,123456,1,2" in bulk and "FORCE,102,3,0,1.,50.,0.,86.6" in bulk
    # 출력 요청은 F06 인쇄 3줄로 (CORNER 요청은 빠짐, 중복 없음)
    assert "CORNER" not in case
    assert case.count("DISPLACEMENT(PLOT,PRINT) = ALL") == 1
    assert case.count("STRESS(PLOT,PRINT) = ALL") == 1
    assert case.count("SPCFORCES(PLOT,PRINT) = ALL") == 1
    lines = case.splitlines()
    assert lines[lines.index("CEND") + 1] == "DISPLACEMENT(PLOT,PRINT) = ALL"


def test_engine_supports_lugshell_reads_help_and_caches_by_mtime(tmp_path, monkeypatch):
    exe = tmp_path / "DrawingToAnalysis.exe"
    exe.write_bytes(b"x")
    calls = []

    def fake_run(args, **kw):
        calls.append(args)
        return types.SimpleNamespace(stdout=b"{all,lug-from-params,lugshell,support}", stderr=b"", returncode=0)

    monkeypatch.setattr(svc.subprocess, "run", fake_run)
    svc._lugshell_support_cache.clear()
    assert svc.engine_supports_lugshell(str(exe)) is True
    assert svc.engine_supports_lugshell(str(exe)) is True
    assert len(calls) == 1  # 같은 exe(수정 시각)는 다시 묻지 않는다


def test_engine_supports_lugshell_false_for_old_exe_or_missing(tmp_path, monkeypatch):
    exe = tmp_path / "old.exe"
    exe.write_bytes(b"x")
    monkeypatch.setattr(svc.subprocess, "run", lambda *a, **k: types.SimpleNamespace(
        stdout=b"{all,lug-from-params,support,lightingpost}", stderr=b"", returncode=0))
    svc._lugshell_support_cache.clear()
    assert svc.engine_supports_lugshell(str(exe)) is False
    assert svc.engine_supports_lugshell(str(tmp_path / "none.exe")) is False


def test_lugshell_summary(tmp_path):
    design = {
        "meta": {"template": "lapping_lug", "source": {"scale": "1:5.522"}},
        "materials": [{"id": "SWS400B"}],
        "plates": [{"id": "main", "role": "main", "t": 25}],
        "pin": {"hole_d": 61},
        "load_cases": [{"id": "LC1_axial", "swl_t": 25.0}, {"id": "LC2_inplane_30", "swl_t": 25.0}],
        "review": [{"path": "/load_cases", "status": "missing", "note": "daf: 도면에 DAF 없음"}],
    }
    hand = {"criteria": {"name": "임시"}, "cases": [
        {"id": "LC1_axial", "checks": [{"check": "핀 구멍 지압", "uc": 0.77}, {"check": "하단", "uc": 0.22}]},
        {"id": "LC2_inplane_30", "checks": [{"check": "하단", "uc": 0.43}]}]}
    dp, hp = tmp_path / "lug_design.json", tmp_path / "lug_handcalc.json"
    dp.write_text(json.dumps(design, ensure_ascii=False), encoding="utf-8")
    hp.write_text(json.dumps(hand, ensure_ascii=False), encoding="utf-8")
    s = svc.lugshell_summary(str(dp), str(hp))
    assert s["thickness"] == 25 and s["material"] == "SWS400B" and s["hole_d"] == 61 and s["swl_t"] == 25.0
    assert s["review"][0]["status"] == "missing"
    assert s["handcalc_max"] == {"uc": 0.77, "check": "핀 구멍 지압", "case": "LC1_axial", "criteria": "임시"}
    assert svc.lugshell_summary(str(tmp_path / "none.json"), None) == {}


def _client(db_session, employee_id):
    app = FastAPI()
    app.include_router(analysis.router)

    def override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = override_db
    app.dependency_overrides[require_auth] = lambda: employee_id
    return TestClient(app)


def test_solve_use_model_loads_needs_no_bcs(db_session, tmp_path, monkeypatch):
    base = tmp_path / "userConnection"
    work_dir = base / "20261110_120000_OWNER01_DrawingToAnalysis"
    work_dir.mkdir(parents=True)
    bdf = work_dir / "lug_model.bdf"
    bdf.write_text(LUGSHELL_BDF, encoding="utf-8")
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))
    monkeypatch.setattr(analysis, "_ALLOWED_DOWNLOAD_BASE", str(base))
    submitted = []
    monkeypatch.setattr(analysis, "submit_analysis_job", lambda *a, **k: submitted.append(a) or "job-test")
    client = _client(db_session, "OWNER01")
    body = {"employee_id": "OWNER01", "work_dir": str(work_dir), "bdf_path": str(bdf)}

    r = client.post("/api/analysis/drawing-to-analysis/solve", json=body)
    assert r.status_code == 400  # 예전 계약: 경계조건 없으면 거부

    r = client.post("/api/analysis/drawing-to-analysis/solve", json={**body, "use_model_loads": True})
    assert r.status_code == 200, r.text
    assert submitted[-1][-1] is True  # task 의 use_model_loads 인자


def test_request_rejects_page_zero(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(analysis, "submit_analysis_job", lambda *a, **k: "job-test")
    client = _client(db_session, "OWNER01")
    r = client.post("/api/analysis/drawing-to-analysis/request",
                    files={"pdf_file": ("Lug_L_25.pdf", b"%PDF-1.4\n", "application/pdf")},
                    data={"employee_id": "OWNER01", "page": "0"})
    assert r.status_code == 400


def test_lugshell_failure_reason_appends_engine_line():
    # 엔진 실제 출력(2026-11-11 Test8_NotLug_SU145.pdf, 종료 코드 2)
    out = ("[lugshell] 1/3 PDF 추출 (선 글자 인식·치수 연결·템플릿)\r\n"
           "추출 실패: 축척을 정할 수 없음 (선형 치수도 SCALE 표기도 없음)\r\n"
           "[lugshell] 추출 실패 — 지원하지 않는 도면 형식이거나 치수를 읽지 못함\r\n")
    msg = svc.lugshell_failure_reason(svc.FAIL_LUGSHELL_UNSUPPORTED, out)
    assert msg.startswith(svc.FAIL_LUGSHELL_UNSUPPORTED)
    assert msg.endswith("(엔진: 축척을 정할 수 없음 (선형 치수도 SCALE 표기도 없음))")
    # 사유 줄이 없으면 분류 문구 그대로 ('— ' 로 끝나는 요약 줄은 사유로 잡지 않는다)
    assert svc.lugshell_failure_reason(svc.FAIL_LUGSHELL_MODEL,
                                       "[lugshell] 모델 검증 실패 — lug_report.json 의 fails 확인\n") == svc.FAIL_LUGSHELL_MODEL


def test_lugshell_failure_reason_uses_checker_line_for_design_redo():
    out = ("[lugshell] 1/3 설계 JSON 검사 (도면 읽기 건너뜀 — 고친 값으로 다시 만들기)\n"
           "핀 지름 65 ≥ 구멍 지름 61.0\n"
           "[lugshell] 설계 JSON 검사 실패 — 고친 값을 확인\n")
    assert svc.lugshell_failure_reason(svc.FAIL_LUGSHELL_MODEL, out).endswith("(엔진: 핀 지름 65 ≥ 구멍 지름 61.0)")


def _design():
    return {
        "meta": {"template": "lapping_lug"},
        "pin": {"hole_d": 61.0, "pin_d": 60.0},
        "load_cases": [
            {"id": "LC1_axial", "swl_t": 25.0, "daf": 1.0, "alpha_deg": 0, "beta_deg": 0},
            {"id": "LC2_inplane_30", "swl_t": 25.0, "daf": 1.0, "alpha_deg": 30, "beta_deg": 0},
        ],
        "review": [
            {"path": "/load_cases", "status": "single_source", "note": "swl_t: 주석만"},
            {"path": "/load_cases", "status": "missing", "note": "daf: 도면에 DAF 없음 — 1 임시"},
            {"path": "/load_cases", "status": "missing", "note": "load_angles: 도면에 하중 각도 없음"},
            {"path": "/pin", "status": "missing", "note": "pin_d: 도면에 핀 지름 없음 — 60 임시"},
        ],
    }


def test_apply_lugshell_edits_sets_values_and_marks_review():
    src = _design()
    d, changed = svc.apply_lugshell_edits(src, {"daf": 1.3, "pin_d": 58,
                                       "cases": [{"id": "LC2_inplane_30", "alpha_deg": 45}]})
    assert src["load_cases"][0]["daf"] == 1.0  # 원본 불변
    assert [lc["daf"] for lc in d["load_cases"]] == [1.3, 1.3]
    assert d["load_cases"][1]["alpha_deg"] == 45 and d["load_cases"][0]["alpha_deg"] == 0
    assert d["pin"]["pin_d"] == 58
    st = {r["note"].split(":")[0]: r for r in d["review"]}
    assert st["daf"]["status"] == "user_fixed" and "1.3" in st["daf"]["note"]
    assert st["load_angles"]["status"] == "user_fixed" and "LC2_inplane_30 α 30→45" in st["load_angles"]["note"]
    assert st["pin_d"]["status"] == "user_fixed"
    assert st["swl_t"]["status"] == "single_source"  # 안 고친 항목은 그대로
    assert [e["item"] for e in changed] == ["daf", "pin_d", "load_angles"]
    assert set(d["meta"]) == {"template"}  # 엔진 스키마가 meta 에 다른 칸을 받지 않는다


def test_apply_lugshell_edits_same_value_is_not_an_edit():
    d, changed = svc.apply_lugshell_edits(_design(), {"swl_t": 25, "daf": 1.0, "cases": [{"id": "LC1_axial", "alpha_deg": 0}]})
    assert changed == []
    assert all(r["status"] != "user_fixed" for r in d["review"])


def test_apply_lugshell_edits_rejects_out_of_range():
    import pytest
    for edits in ({"daf": 0.9}, {"swl_t": 0}, {"pin_d": 61}, {"pin_d": "x"},
                  {"cases": [{"id": "LC1_axial", "beta_deg": 120}]}, {"cases": [{"id": "LC9", "alpha_deg": 0}]}):
        with pytest.raises(ValueError):
            svc.apply_lugshell_edits(_design(), edits)


def test_lugshell_redo_route_writes_edited_design_in_rebuild_dir(db_session, tmp_path, monkeypatch):
    base = tmp_path / "userConnection"
    work_dir = base / "20261111_082608_OWNER01_DrawingToAnalysis"
    work_dir.mkdir(parents=True)
    (work_dir / "Lug_L_25.pdf").write_bytes(b"%PDF-1.4\n")
    (work_dir / "lug_design.json").write_text(json.dumps(_design(), ensure_ascii=False), encoding="utf-8")
    (work_dir / "lug_trace.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))
    monkeypatch.setattr(analysis, "_ALLOWED_DOWNLOAD_BASE", str(base))
    submitted = []
    monkeypatch.setattr(analysis, "submit_analysis_job", lambda *a, **k: submitted.append(a) or "job-redo")
    client = _client(db_session, "OWNER01")
    url = "/api/analysis/drawing-to-analysis/lugshell-redo"

    # 옛 엔진(--design 모름)이면 작업을 띄우지 않고 409 — 화면의 직전 모델을 지우지 않게
    monkeypatch.setattr(svc, "engine_supports_lugshell_design", lambda exe: False)
    r = client.post(url, json={"employee_id": "OWNER01", "work_dir": str(work_dir), "edits": {"daf": 1.3}})
    assert r.status_code == 409 and "엔진" in r.json()["detail"] and not submitted
    assert not any(n.startswith("rebuild_") for n in os.listdir(work_dir))
    monkeypatch.setattr(svc, "engine_supports_lugshell_design", lambda exe: True)

    r = client.post(url, json={"employee_id": "OWNER01", "work_dir": str(work_dir), "edits": {"daf": 9}})
    assert r.status_code == 400 and "daf" in r.json()["detail"]

    r = client.post(url, json={"employee_id": "OWNER01", "work_dir": str(work_dir), "edits": {"daf": 1.3}})
    assert r.status_code == 200, r.text
    redo = r.json()["work_dir"]
    assert os.path.dirname(redo) == str(work_dir) and os.path.basename(redo).startswith("rebuild_")
    saved = json.loads(open(os.path.join(redo, "lug_design.json"), encoding="utf-8").read())
    assert saved["load_cases"][0]["daf"] == 1.3
    assert os.path.isfile(os.path.join(redo, "lug_trace.json"))
    args = submitted[-1]
    assert args[0] is svc.task_execute_drawing_to_analysis
    assert args[1].endswith("Lug_L_25.pdf") and args[-1] == os.path.join(redo, "lug_design.json")

    # 다시 만든 결과에서 또 고쳐도 처음 폴더 바로 아래에 만든다
    r2 = client.post(url, json={"employee_id": "OWNER01", "work_dir": redo, "edits": {"daf": 1.5}})
    assert r2.status_code == 200, r2.text
    assert os.path.dirname(r2.json()["work_dir"]) == str(work_dir)
    log = json.loads(open(os.path.join(r2.json()["work_dir"], "lug_user_edits.json"), encoding="utf-8").read())
    assert [(e["item"], e["new"]) for e in log["edits"]] == [("daf", 1.3), ("daf", 1.5)]  # 앞 기록 + 이번 기록

    other = client.post(url, json={"employee_id": "OWNER01", "work_dir": str(tmp_path), "edits": {}})
    assert other.status_code == 400


def test_bridge_json_kept_when_bridge_dies_after_writing(tmp_path):
    # 2026-11-11 실제: DRM(HIDRMH.DLL)이 bridge 를 종료 순간 0xC0000005 로 죽였지만 JSON 은 다 써 놓았다
    # → 결과에서 model_json 이 빠져 3D·확인 항목·해석 버튼이 안 뜨고 '진행이 안 됨'.
    ok = tmp_path / "ok.json"
    ok.write_text(json.dumps({"nodes": [{"id": 1}], "elements": [{"id": 1}]}), encoding="utf-8")
    half = tmp_path / "half.json"
    half.write_text('{"nodes": [{"id": 1}], "elem', encoding="utf-8")
    empty = tmp_path / "empty.json"
    empty.write_text(json.dumps({"nodes": [], "elements": []}), encoding="utf-8")
    assert svc.bridge_model_json_usable(0, str(ok)) is True
    assert svc.bridge_model_json_usable(3221225477, str(ok)) is True        # 다 쓰고 죽음 → 받는다
    assert svc.bridge_model_json_usable(3221225477, str(half)) is False     # 쓰다가 죽음 → 버린다
    assert svc.bridge_model_json_usable(3221225477, str(empty)) is False
    assert svc.bridge_model_json_usable(1, str(ok)) is False                # 보통 실패는 그대로 실패
    assert svc.bridge_model_json_usable(3221225477, str(tmp_path / "none.json")) is False
