"""표준집 러그 치수 → 형상 → (해석 때) 메시 (2026-11-12, 계획 docs/plans/2026-11-12-lug-param-catalogue-plan.md).

치수 → 형상은 엔진의 lugshell.params 를 import 한다(services/lug_params). 모듈이 없는 PC(서버에 InHouse 복사본이
아직 없을 때)는 건너뛴다. 저장소의 실제 치수 파일(DrawingBook/params)로 시험한다.
"""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import database
from app.dependencies import require_auth
from app.routers import analysis
from app.services import drawing_book, lug_params

try:
    lug_params.module()
except lug_params.LugParamsUnavailable:  # pragma: no cover — 모듈 없는 PC
    pytest.skip("lugparams 모듈이 없음", allow_module_level=True)


def _client(db_session, employee_id="OWNER01"):
    app = FastAPI()
    app.include_router(analysis.router)

    def override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = override_db
    app.dependency_overrides[require_auth] = lambda: employee_id
    return TestClient(app)


def _page(code):
    return next(i["pdfPage"] for i in drawing_book.load_index()["items"] if i["aliases"][0] == code)


@pytest.mark.parametrize("code,plates,mass", [("D-50", 7, 42.82), ("D-25", 7, 21.8), ("L-25", 1, 16.16)])
def test_catalogue_params_build_same_shape(code, plates, mass):
    pf = lug_params.load_params(code)
    assert pf and pf["source"] in ("auto", "hand")
    design, info = lug_params.build(pf["form"], pf["values"], code, pf.get("review"))
    assert len(design["plates"]) == plates
    assert info["mass_kg"] == pytest.approx(mass, abs=0.1)
    assert info["mass_kg"] == pytest.approx(pf["mass_kg"], abs=0.01)  # 색인 때 잰 질량과 같다


def test_every_convertible_item_has_params():
    items = [i for i in drawing_book.load_index()["items"] if i.get("convertible")]
    assert len(items) == 11
    for i in items:
        assert i.get("params") and lug_params.load_params(i["aliases"][0]) is not None, i["code"]


def test_contradiction_is_reason_not_crash():
    pf = lug_params.load_params("D-50")
    bad = dict(pf["values"], arc_R=400)  # 위 원과 옆 오목 원이 겹침
    with pytest.raises(ValueError, match="치수 모순"):
        lug_params.build(pf["form"], bad)
    with pytest.raises(ValueError, match="비어 있음"):
        lug_params.build(pf["form"], {k: v for k, v in pf["values"].items() if k != "hole_d"})


def test_load_params_rejects_path_tricks():
    assert lug_params.load_params("../book_index") is None
    assert lug_params.load_params("D-50/../x") is None


def test_params_route_returns_geometry(db_session):
    r = _client(db_session).get(f"/api/analysis/drawing-to-analysis/book/{_page('D-50')}/params")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["form"] == "d_type_lug" and len(d["design"]["plates"]) == 7
    assert {f["name"] for f in d["fields"]} >= set(d["values"]) - {"material"} | {"material"}


def test_params_route_404_for_item_without_params(db_session):
    page = next(i["pdfPage"] for i in drawing_book.load_index()["items"] if not i.get("params"))
    assert _client(db_session).get(f"/api/analysis/drawing-to-analysis/book/{page}/params").status_code == 404


def test_geometry_route_422_on_contradiction(db_session):
    pf = lug_params.load_params("L-25")
    c = _client(db_session)
    ok = c.post("/api/analysis/drawing-to-analysis/lug-geometry", json={"form": pf["form"], "values": pf["values"]})
    assert ok.status_code == 200 and ok.json()["mass_kg"] == pytest.approx(16.16, abs=0.1)
    bad = c.post("/api/analysis/drawing-to-analysis/lug-geometry",
                 json={"form": pf["form"], "values": dict(pf["values"], hole_d=300)})
    assert bad.status_code == 422 and "치수 모순" in bad.json()["detail"]


def test_run_params_writes_design_and_marks_edits(db_session, tmp_path, monkeypatch):
    work = tmp_path / "work"
    work.mkdir()
    submitted = []
    monkeypatch.setattr(analysis, "make_work_dir", lambda emp, prog: (str(work), "20261112_150000"))
    monkeypatch.setattr(analysis, "submit_analysis_job", lambda *a, **k: submitted.append(a) or "job-params")
    monkeypatch.setattr(drawing_book, "extract_page_pdf", lambda page, dst: None)
    pf = lug_params.load_params("D-50")
    vals = dict(pf["values"], base_width=700)
    r = _client(db_session).post(f"/api/analysis/drawing-to-analysis/book/{_page('D-50')}/run-params",
                                 json={"employee_id": "OWNER01", "values": vals, "mesh_size": 12})
    assert r.status_code == 200, r.text
    design = json.loads((work / "lug_design.json").read_text(encoding="utf-8"))
    assert design["analysis"]["mesh_size"] == 12
    assert any("base_width: 사용자가 치수 수정 660.0 → 700" in x["note"] for x in design["review"])
    assert submitted and submitted[0][-1] == str(work / "lug_design.json")  # design_path 로 넘김


def test_run_params_other_employee_forbidden(db_session):
    pf = lug_params.load_params("D-50")
    r = _client(db_session, "OTHER99").post(f"/api/analysis/drawing-to-analysis/book/{_page('D-50')}/run-params",
                                            json={"employee_id": "OWNER01", "values": pf["values"]})
    assert r.status_code == 403


def test_params_route_returns_marks_for_fields(db_session):
    """치수 칸을 누르면 형상에서 강조할 판과 치수선 — 값이 있는 형상 칸마다 있어야 한다."""
    r = _client(db_session).get(f"/api/analysis/drawing-to-analysis/book/{_page('D-50')}/params")
    body = r.json()
    marks = body["marks"]
    assert marks["base_width"]["plates"] == ["main"]
    assert marks["base_width"]["lines"] == [[[-330.0, 0.0, 0.0], [330.0, 0.0, 0.0]]]
    assert set(marks["bracket_outer_h"]["plates"]) == {"br_xp_yp", "br_xp_yn", "br_xn_yp", "br_xn_yn"}
    for f in body["fields"]:
        if f["name"] in ("material", "swl_t", "daf"):
            continue
        assert f["name"] in marks, f["name"]


def _run(db_session, tmp_path, monkeypatch, extra):
    work = tmp_path / "work"
    work.mkdir()
    monkeypatch.setattr(analysis, "make_work_dir", lambda emp, prog: (str(work), "20261112_150000"))
    monkeypatch.setattr(analysis, "submit_analysis_job", lambda *a, **k: "job-params")
    monkeypatch.setattr(drawing_book, "extract_page_pdf", lambda page, dst: None)
    pf = lug_params.load_params("D-50")
    r = _client(db_session).post(f"/api/analysis/drawing-to-analysis/book/{_page('D-50')}/run-params",
                                 json={"employee_id": "OWNER01", "values": pf["values"], **extra})
    design = json.loads((work / "lug_design.json").read_text(encoding="utf-8")) if r.status_code == 200 else None
    return r, design


def test_run_params_replaces_load_cases(db_session, tmp_path, monkeypatch):
    """하중 및 경계 단계: 케이스 목록 전체를 보낸다 — 각도 수정, 새 케이스, 빠진 케이스가 설계와 확인 항목에 남는다."""
    r, d = _run(db_session, tmp_path, monkeypatch, {"cases": [
        {"id": "LC1_vertical", "alpha_deg": 0, "beta_deg": 0},
        {"id": "LC2_inplane_45", "alpha_deg": 30, "beta_deg": 0},
        {"id": "LC_NEW1", "alpha_deg": 60, "beta_deg": 5},
    ]})
    assert r.status_code == 200, r.text
    ids = [c["id"] for c in d["load_cases"]]
    assert ids == ["LC1_vertical", "LC2_inplane_45", "LC3_user"]
    assert d["load_cases"][1]["alpha_deg"] == 30
    assert d["load_cases"][2]["swl_t"] == 50 and d["load_cases"][2]["beta_deg"] == 5
    note = next(x["note"] for x in d["review"] if x["note"].startswith("load_angles:"))
    assert "추가 LC3_user" in note and "뺌 LC3_inplane_90, LC4_outplane_10" in note and "α 45→30" in note


@pytest.mark.parametrize("cases, msg", [
    ([], "1~8"),
    ([{"id": "x", "alpha_deg": 0, "beta_deg": 90}], "±90"),
    ([{"id": "x", "alpha_deg": 120, "beta_deg": 0}], "범위"),
])
def test_run_params_rejects_bad_cases(db_session, tmp_path, monkeypatch, cases, msg):
    r, _ = _run(db_session, tmp_path, monkeypatch, {"cases": cases})
    assert r.status_code == 422 and msg in r.json()["detail"]


def test_run_params_without_cases_keeps_form_defaults(db_session, tmp_path, monkeypatch):
    r, d = _run(db_session, tmp_path, monkeypatch, {})
    assert r.status_code == 200
    assert [c["id"] for c in d["load_cases"]] == ["LC1_vertical", "LC2_inplane_45", "LC3_inplane_90", "LC4_outplane_10"]


def test_run_params_case_force_sets_case_swl(db_session, tmp_path, monkeypatch):
    """케이스별 하중 크기(kN): 엔진이 쓰는 swl_t 로 바꿔 넣고(P = swl_t × g × daf), 다른 케이스는 그대로."""
    r, d = _run(db_session, tmp_path, monkeypatch, {"cases": [
        {"id": "LC1_vertical", "alpha_deg": 0, "beta_deg": 0, "p_kn": 700},
        {"id": "LC2_inplane_45", "alpha_deg": 45, "beta_deg": 0},
        {"id": "LC_NEW1", "alpha_deg": 0, "beta_deg": 5, "p_kn": 300},
    ]})
    assert r.status_code == 200, r.text
    g = d["analysis"].get("g", 9.81)
    p = [c["swl_t"] * g * c["daf"] for c in d["load_cases"]]
    assert p[0] == pytest.approx(700) and p[2] == pytest.approx(300)
    assert d["load_cases"][1]["swl_t"] == 50
    note = next(x["note"] for x in d["review"] if x["note"].startswith("load_angles:"))
    assert "LC1_vertical" in note and "700 kN" in note and "LC3_user" in note and "300 kN" in note


def test_run_params_rejects_bad_force(db_session, tmp_path, monkeypatch):
    r, _ = _run(db_session, tmp_path, monkeypatch, {"cases": [{"id": "LC1_vertical", "alpha_deg": 0, "beta_deg": 0, "p_kn": 0}]})
    assert r.status_code == 422 and "p_kn" in r.json()["detail"]


@pytest.fixture(autouse=True)
def _engine_knows_design(monkeypatch):
    """run-params 는 작업 전에 exe 의 --design 지원을 묻는다(exe 기동 10초) — 시험에서는 지원한다고 둔다."""
    from app.services import drawing_to_analysis_service as svc
    monkeypatch.setattr(svc, "engine_supports_lugshell_design", lambda exe: True)


def test_run_params_untouched_values_from_browser_are_not_edits(db_session, tmp_path, monkeypatch):
    """화면은 파일의 270.0 을 270 으로 보낸다 — 손대지 않았으면 '사용자가 치수 수정' 이 하나도 없어야 한다."""
    pf = lug_params.load_params("D-50")
    as_browser = json.loads(json.dumps({k: (int(v) if isinstance(v, float) and v.is_integer() else v)
                                        for k, v in pf["values"].items()}))
    r, d = _run(db_session, tmp_path, monkeypatch, {"values": as_browser})
    assert r.status_code == 200, r.text
    assert not [x for x in d["review"] if "사용자가 치수 수정" in x["note"]]


def test_run_params_rejects_unknown_material(db_session, tmp_path, monkeypatch):
    pf = lug_params.load_params("D-50")
    r, _ = _run(db_session, tmp_path, monkeypatch, {"values": dict(pf["values"], material="XYZ999")})
    assert r.status_code == 422 and "모르는 재질" in r.json()["detail"]


def test_run_params_409_when_engine_lacks_design(db_session, tmp_path, monkeypatch):
    from app.services import drawing_to_analysis_service as svc
    monkeypatch.setattr(svc, "engine_supports_lugshell_design", lambda exe: False)
    r, _ = _run(db_session, tmp_path, monkeypatch, {})
    assert r.status_code == 409
