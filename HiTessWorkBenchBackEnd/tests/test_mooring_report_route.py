"""Mooring Fitting 보고서 라우트 회귀 테스트.

순수 함수 테스트만으로는 라우트가 실제로 열리는지, 경로 검증 헬퍼를 올바른
인자 순서로 부르는지 알 수 없다(module_ocean 에서 같은 실수가 배포된 적 있음).
엔진 실행은 build_report 를 가로채 대체한다 — exe 유무와 무관하게 배선만 검증.
"""
import os

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import database
from app.dependencies import require_auth
from app.routers import analysis as mod


def _client(db_session, employee_id: str) -> TestClient:
    app = FastAPI()
    app.include_router(mod.router)

    def override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = override_db
    app.dependency_overrides[require_auth] = lambda: employee_id
    return TestClient(app)


def _workspace(tmp_path, monkeypatch, owner="OWNER01"):
    """userConnection/<ts>_<owner>_MooringFitting/out 구조를 만든다."""
    base = tmp_path / "userConnection"
    case_dir = base / f"20260903_120000_{owner}_MooringFitting"
    out_dir = case_dir / "out"
    out_dir.mkdir(parents=True)
    # 보고서는 Studio 구조해석 결과로만 만든다 — 기본 fixture 는 '해석 완료' 상태로 둔다.
    (out_dir / "mooring_solve_CalcVerify.csv").write_text("header", encoding="utf-8")
    monkeypatch.setattr(mod, "_ALLOWED_DOWNLOAD_BASE", str(base))
    monkeypatch.setattr(mod, "assert_current_user_can_access_path",
                        lambda *a, **k: None)
    return str(case_dir), str(out_dir)


def test_report_passes_case_dir_not_out_dir(db_session, tmp_path, monkeypatch):
    """엔진 report verb 는 out/ 이 아니라 '케이스 폴더'를 받아야 한다."""
    case_dir, out_dir = _workspace(tmp_path, monkeypatch)
    seen = {}

    def fake_build_report(cd, exe, **kw):
        seen["case_dir"] = cd
        seen["kw"] = kw
        return {"xlsx_path": os.path.join(cd, "out", mod.REPORT_FILE_NAME),
                "log": "ok", "pages": 33, "warnings": ["결과 CSV 가 오래됐습니다"]}

    monkeypatch.setattr(mod, "build_report", fake_build_report)

    res = _client(db_session, "OWNER01").post(
        "/api/analysis/mooring-fitting/report",
        json={"output_dir": out_dir, "hull_no": "1234", "fitting": "MF-F08(P)"},
    )

    assert res.status_code == 200, res.text
    assert seen["case_dir"] == case_dir          # out/ 의 부모
    assert seen["kw"]["hull_no"] == "1234"
    body = res.json()
    assert body["pages"] == 33
    assert body["warnings"] == ["결과 CSV 가 오래됐습니다"]


def test_report_rejects_path_outside_userconnection(db_session, tmp_path, monkeypatch):
    _workspace(tmp_path, monkeypatch)
    res = _client(db_session, "OWNER01").post(
        "/api/analysis/mooring-fitting/report",
        json={"output_dir": str(tmp_path / "elsewhere")},
    )
    assert res.status_code == 400


def test_report_requires_output_dir(db_session, tmp_path, monkeypatch):
    _workspace(tmp_path, monkeypatch)
    res = _client(db_session, "OWNER01").post(
        "/api/analysis/mooring-fitting/report", json={})
    assert res.status_code == 400


def test_report_rejects_nonpositive_top(db_session, tmp_path, monkeypatch):
    _, out_dir = _workspace(tmp_path, monkeypatch)
    res = _client(db_session, "OWNER01").post(
        "/api/analysis/mooring-fitting/report",
        json={"output_dir": out_dir, "top": 0})
    assert res.status_code == 400


def test_report_download_streams_read_bytes(db_session, tmp_path, monkeypatch):
    """DRM 때문에 stat 크기가 아니라 read() 바이트 길이로 나가야 한다."""
    case_dir, out_dir = _workspace(tmp_path, monkeypatch)
    blob = b"PK\x03\x04" + b"x" * 500
    with open(os.path.join(case_dir, "out", mod.REPORT_FILE_NAME), "wb") as fh:
        fh.write(blob)

    res = _client(db_session, "OWNER01").get(
        "/api/analysis/mooring-fitting/report-download",
        params={"output_dir": out_dir})

    assert res.status_code == 200
    assert res.content == blob
    assert int(res.headers["content-length"]) == len(blob)
    assert mod.REPORT_FILE_NAME in res.headers["content-disposition"]


def test_report_download_404_before_generation(db_session, tmp_path, monkeypatch):
    _, out_dir = _workspace(tmp_path, monkeypatch)
    res = _client(db_session, "OWNER01").get(
        "/api/analysis/mooring-fitting/report-download",
        params={"output_dir": out_dir})
    assert res.status_code == 404


def test_report_plan_returns_plan_content(db_session, tmp_path, monkeypatch):
    case_dir, out_dir = _workspace(tmp_path, monkeypatch)
    plan_path = os.path.join(case_dir, "out", mod.REPORT_FILE_NAME.replace(
        "MooringFitting_Report.xlsx", "REPORT_PLAN.json"))

    def fake_plan(cd, exe, **kw):
        with open(plan_path, "w", encoding="utf-8") as fh:
            fh.write('{"byCase": []}')
        return {"plan_path": plan_path, "log": "ok"}

    monkeypatch.setattr(mod, "build_report_plan", fake_plan)

    res = _client(db_session, "OWNER01").post(
        "/api/analysis/mooring-fitting/report-plan",
        json={"output_dir": out_dir, "top": 30})

    assert res.status_code == 200, res.text
    assert res.json()["plan"] == {"byCase": []}


def test_report_maps_precondition_exit_to_409(db_session, tmp_path, monkeypatch):
    """구조해석 결과가 없어 엔진이 exit 2 로 끝나면 500 이 아니라 409 로 알린다."""
    _, out_dir = _workspace(tmp_path, monkeypatch)

    def boom(cd, exe, **kw):
        raise mod.ReportEngineError("응력 결과 CSV 가 없습니다", 2)

    monkeypatch.setattr(mod, "build_report", boom)

    res = _client(db_session, "OWNER01").post(
        "/api/analysis/mooring-fitting/report", json={"output_dir": out_dir})
    assert res.status_code == 409
    assert "응력 결과 CSV" in res.json()["detail"]


# ── Studio 캡쳐 업로드 ─────────────────────────────────────────────────
import base64

_PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 40).decode()


def test_report_figures_saves_whitelisted_names(db_session, tmp_path, monkeypatch):
    """엔진이 찾는 이름(model/boundary/loads/lc_N)만 figures_studio 에 저장한다."""
    case_dir, out_dir = _workspace(tmp_path, monkeypatch)

    res = _client(db_session, "OWNER01").post(
        "/api/analysis/mooring-fitting/report-figures",
        json={"output_dir": out_dir, "figures": [
            {"name": "model.png", "data": f"data:image/png;base64,{_PNG}"},
            {"name": "lc_8.png", "data": _PNG},
        ]},
    )

    assert res.status_code == 200, res.text
    figdir = os.path.join(case_dir, "out", "figures_studio")
    assert sorted(os.listdir(figdir)) == ["lc_8.png", "model.png"]
    assert res.json()["saved"] == 2


def test_report_figures_rejects_path_traversal(db_session, tmp_path, monkeypatch):
    """이름은 화이트리스트 정규식으로만 통과 — 경로 조작을 파일명으로 못 넣는다."""
    _, out_dir = _workspace(tmp_path, monkeypatch)
    res = _client(db_session, "OWNER01").post(
        "/api/analysis/mooring-fitting/report-figures",
        json={"output_dir": out_dir,
              "figures": [{"name": "../../evil.png", "data": _PNG}]},
    )
    assert res.status_code == 400


def test_report_figures_rejects_non_png(db_session, tmp_path, monkeypatch):
    """PNG 매직이 아니면 거부 — 엔진이 읽다 깨지느니 여기서 막는다."""
    _, out_dir = _workspace(tmp_path, monkeypatch)
    res = _client(db_session, "OWNER01").post(
        "/api/analysis/mooring-fitting/report-figures",
        json={"output_dir": out_dir,
              "figures": [{"name": "model.png",
                           "data": base64.b64encode(b"not a png").decode()}]},
    )
    assert res.status_code == 400


def test_report_requires_studio_solve(db_session, tmp_path, monkeypatch):
    """구조해석 전에는 보고서를 만들지 않는다 — 응력 0 짜리 '전 부재 Pass' 를 막는 전제."""
    case_dir, out_dir = _workspace(tmp_path, monkeypatch)
    os.remove(os.path.join(case_dir, "out", "mooring_solve_CalcVerify.csv"))

    called = {"n": 0}
    monkeypatch.setattr(mod, "build_report",
                        lambda *a, **k: called.__setitem__("n", called["n"] + 1))

    res = _client(db_session, "OWNER01").post(
        "/api/analysis/mooring-fitting/report", json={"output_dir": out_dir})

    assert res.status_code == 409
    assert "구조해석" in res.json()["detail"]
    assert called["n"] == 0          # 엔진을 부르지도 않는다


def test_report_plan_requires_studio_solve(db_session, tmp_path, monkeypatch):
    case_dir, out_dir = _workspace(tmp_path, monkeypatch)
    os.remove(os.path.join(case_dir, "out", "mooring_solve_CalcVerify.csv"))

    res = _client(db_session, "OWNER01").post(
        "/api/analysis/mooring-fitting/report-plan", json={"output_dir": out_dir})
    assert res.status_code == 409


def test_report_forwards_gamma_m(db_session, tmp_path, monkeypatch):
    """Studio 가 보낸 γM 이 엔진까지 그대로 가야 화면과 보고서 판정이 일치한다."""
    case_dir, out_dir = _workspace(tmp_path, monkeypatch)
    seen = {}
    monkeypatch.setattr(mod, "build_report", lambda cd, exe, **kw: (
        seen.update(kw) or {"xlsx_path": os.path.join(cd, "out", mod.REPORT_FILE_NAME),
                            "log": "ok", "pages": 33, "warnings": []}))

    res = _client(db_session, "OWNER01").post(
        "/api/analysis/mooring-fitting/report",
        json={"output_dir": out_dir, "yield_strength": 355, "gamma_m": 1.15})

    assert res.status_code == 200, res.text
    assert seen["yield_strength"] == 355.0
    assert seen["gamma_m"] == 1.15


def test_report_rejects_nonpositive_gamma(db_session, tmp_path, monkeypatch):
    _, out_dir = _workspace(tmp_path, monkeypatch)
    res = _client(db_session, "OWNER01").post(
        "/api/analysis/mooring-fitting/report",
        json={"output_dir": out_dir, "gamma_m": 0})
    assert res.status_code == 400
