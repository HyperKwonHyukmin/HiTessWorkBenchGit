"""PSA 평가보고서 생성 — CAESAR 엑셀 표 규칙과 서식(docx) 채우기."""
import io
import json
import os
import struct
import zlib
from urllib.parse import unquote

import openpyxl
import pytest
from docx import Document
from docx.oxml.ns import qn

from app.routers import _intake
from app.services.psa_report_docx import (
    MARK, NO_DATA, NO_FIGURE, NOT_PROVIDED, TEMPLATE_PATH, build_report, figure_slots, match_figure, model_label, scan_figures,
)
from app.services.psa_report_tables import compliance_rows, restraint_rows

needs_template = pytest.mark.skipif(not open(TEMPLATE_PATH, "rb").read(2) == b"PK", reason="서식이 DRM 암호문")


def _restraint_xlsx(path):
    """지지 Node 10(MAX 줄 있음) + 연결 Node(Displ. Reaction) 11, 하중 경우 2개."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Restraint Summary Extended"
    ws.append(["CAESAR II"])
    ws.append([10, None, "TYPE=Rigid ANC;"])
    #                     Fx     Fy    Fz  Mx  My  Mz   Dx    Dy   Dz
    ws.append([None, "  1(OPE)", 1000, -2000, 0, 0, 0, 0, 5.0, -1.0, 0.0])
    ws.append([None, "  2(OPE)", -3000, 500, 0, 0, 0, 0, -2.0, 4.0, 0.0])
    ws.append([None, "MAX", "-3000/L2", "-2000/L1", 0, 0, 0, 0])
    ws.append([11, None, "TYPE=Displ. Reaction;"])
    ws.append([None, "  1(OPE)", 0, 0, 0, 0, 0, 0, 1.0, 0.0, 0.0])
    ws.append([None, "  2(OPE)", 0, 0, 0, 0, 0, 0, 1.0, 0.0, 0.0])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    wb.save(path)


def _cc_xlsx(path, ng=True):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Code Compliance"
    ws.append(["CASE 16 (OCC) W+D1+P1+U1"])
    # 한 줄 = (From) 응력, 허용, 비 / (To) 응력, 허용, 비 — 경우마다 가장 큰 비를 쓴다
    ws.append(["16(OCC)", "10-20", 50.0, 153.14, 32.6, None, 64.87, 153.14, 42.4])
    ws.append(["16(OCC)", "20-30", 20.0, 153.14, 13.1, None, 21.0, 153.14, 13.7])
    if ng:
        ws.append(["17(OCC)", "10-20", 160.0, 153.14, 104.5, None, 1.0, 153.14, 0.7])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    wb.save(path)


def _png(w=40, h=20) -> bytes:
    """작은 PNG(회색) — 그림 자리 시험용."""
    raw = b"".join(b"\x00" + b"\x80\x80\x80" * w for _ in range(h))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def test_restraint_rule(tmp_path):
    p = tmp_path / "r.xlsx"
    _restraint_xlsx(str(p))
    rows = restraint_rows(str(p))
    assert len(rows) == 1  # 연결 Node 블록은 줄이 아니다
    node, fx, fy, fz, mx, my, mz, dxp, dxm, dyp, dym, dzp, dzm = rows[0]
    assert node == 10
    assert (fx, fy) == (-3.0, -2.0)  # MAX 줄 ÷ 1000
    assert (dxp, dxm) == (4.0, -3.0)  # Node − Cnode: 5−1, −2−1
    assert (dyp, dym) == (4.0, -1.0)
    assert (dzp, dzm) == (0.0, 0.0)


def test_compliance_rule(tmp_path):
    p = tmp_path / "c.xlsx"
    _cc_xlsx(str(p))
    assert compliance_rows(str(p)) == [
        {"case": "L16", "stress": 64.87, "allowable": 153.14, "ratio": 42.4},
        {"case": "L17", "stress": 160.0, "allowable": 153.14, "ratio": 104.5},
    ]


def _legacy_xlsx(path):
    """3441 Line 별 묶음 엑셀 모양 — Legacy 가 첫 시트, Restraint 가 둘째(시트 순서는 파일마다 다름)."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Stress Summary (Legacy)"
    ws.append(["CAESAR II  Ver.14.00.00.0910"])
    ws.append(["CASE 21 (OCC) W+D1+P1-U1"])  # 정의 목록은 줄이 아니다
    for case, ratio, code, allow in ((39, 99.4, 286.1, 287.8), (21, 43.3, 66.2, 153.1), (40, 101.2, 291.0, 287.8)):
        ws.append([f" CODE STRESS CHECK PASSED      : LOADCASE {case} (EXP) X"])
        ws.append([f"Highest Stresses: (N./sq.mm. ) LOADCASE {case} (EXP) X"])
        ws.append([f"Ratio (%):                     {ratio}       @Node   2130"])
        ws.append([f"Code Stress:                  {code}       Allowable Stress:        {allow}  "])
        ws.append(["Axial Stress:                  28.5       @Node    860  "])
    wb.create_sheet("Restraint Summary Extended")
    wb.create_sheet("Sheet1")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    wb.save(path)


def test_compliance_falls_back_to_legacy_sheet(tmp_path):
    from app.services.psa_report_tables import compliance_sheet
    p = tmp_path / "TD-01.xlsx"
    _legacy_xlsx(str(p))
    assert compliance_rows(str(p)) == [
        {"case": "L21", "stress": 66.2, "allowable": 153.1, "ratio": 43.3},
        {"case": "L39", "stress": 286.1, "allowable": 287.8, "ratio": 99.4},
        {"case": "L40", "stress": 291.0, "allowable": 287.8, "ratio": 101.2},
    ]
    assert compliance_sheet(str(p)) == "Stress Summary (Legacy)"
    c = tmp_path / "c.xlsx"
    _cc_xlsx(str(c))
    assert compliance_sheet(str(c)) == "Code Compliance"


DOC_INFO = {
    "title": "H9999 Design Basis of Pipe Stress Analysis", "client": "OWNER", "project": "200K LNG Carrier", "shipClass": "ABS",
    "hullNo": "9999-9998", "hullLabel": "9999s", "date": "2026.11.18", "revisionNo": "ORI", "latestRevisionDate": "2026.11.18",
    "department": "Dept", "preparedBy": "A", "reviewedBy": "B", "approvedBy": "C", "status": "Final", "secretLevel": "Secret",
    "software": "CAESAR II 2019", "accelClass": "ABS", "accelRuleRef": "ABS Rules 5C-8", "pidDrawingNo": "9T-0000-001",
}


def _input(lines, **extra):
    data = {
        "sourceFolder": "9999 PSA REPORT",
        "lines": lines,
        "report": {"process": [{"lineNo": l["lineNo"], "minTemp": "-163°C", "maxTemp": "45°C", "pressure": "10barg",
                                "fluid": "NG", "density": "25 kg/m³", "insulation": "A"} for l in lines]},
        "processNotes": "First note.\n- bullet one\n- bullet two",
        "displacement": {"tdSeaHog": "0.81", "tdSeaSag": "-0.87"},
        "accelPositions": [{"uid": "P1", "discipline": "Trunk Deck", "x": "1", "y": "2", "z": "3"}],
        "accelLoads": [{"uid": "A1", "positionUid": "P1", "loadCondition": "Sea", "lines": "All", "x": "0.1", "y": "0.2", "z": "0.3"}],
        "manifold": [{"uid": "M1", "lineUid": "L1", "size": "400",
                      "loads": {"fx": 75000, "fy": 100000, "fz": 100000, "mxz": 130000, "my": 5000}}],
    }
    data.update(extra)
    return data


def _lines():
    return [
        {"uid": "L1", "lineNo": "TD02", "pipeLine": "Vapour", "modelCount": 1, "folder": {"name": "TD-02", "target": "TD02"},
         "material": "A312 TP316L", "wallThickness": "Sch. 10s", "files": {"restraint": ["r.xlsx"], "codeCompliance": ["c.xlsx"]}},
        {"uid": "L2", "lineNo": "TD06", "pipeLine": "Vent", "modelCount": 2, "folder": {"name": "TD-06", "target": "TD06"}, "files": {}},
        {"uid": "L3", "lineNo": "TD09", "pipeLine": "New", "modelCount": 1, "folder": None, "files": {}},
    ]


def _resolver(tmp_path):
    def resolve(line, kind, model):
        picks = (line.get("files") or {}).get(kind) or []
        rel = picks[model] if model < len(picks) else ""
        return str(tmp_path / line["folder"]["target"] / rel) if rel and line.get("folder") else None

    return resolve


def _tables(doc, first):
    return [t for t in doc.tables if t.rows[0].cells[0].text.strip().startswith(first)]


def _text(doc):
    return "\n".join(p.text for p in doc.paragraphs)


@needs_template
def test_build_report_fills_template(tmp_path):
    _restraint_xlsx(str(tmp_path / "TD02" / "r.xlsx"))
    _cc_xlsx(str(tmp_path / "TD02" / "c.xlsx"))
    data, warnings = build_report(_input(_lines()), _resolver(tmp_path))
    doc = Document(io.BytesIO(data))
    assert warnings == []

    scope = _tables(doc, "Line No.")[0]
    assert [r.cells[0].text for r in scope.rows[1:]] == ["TD02", "TD06", "TD09"]
    proc = _tables(doc, "Line No.")[1]
    assert proc.rows[1].cells[1].text == "-163℃"

    # 6장은 Line 마다 새로 만든다 — 서식에 없던 Line(TD09)도 절이 생긴다
    heads = [p.text for p in doc.paragraphs if p.style.name == "Heading 2" and p.text[:2] == "TD"]
    assert heads == ["TD02 - Vapour", "TD06 - Vent", "TD09 - New"]

    res = _tables(doc, "Node")
    assert len(res) == 1 + 2 + 1
    assert [c.text for c in res[0].rows[2].cells][:3] == ["10", "-3.0", "-2.0"]
    assert res[1].rows[2].cells[0].text == NO_DATA
    cc = _tables(doc, "Case No")
    assert [[c.text for c in r.cells] for r in cc[0].rows[1:]] == [
        ["L16", "64.87", "153.14", "42.4", "OK"], ["L17", "160.00", "153.14", "104.5", "NG"]]  # 자릿수 고정(Code Compliance 2자리)
    assert len(cc) == 4 and cc[1].rows[1].cells[0].text == NO_DATA

    disp = _tables(doc, "Position")[0]
    assert disp.rows[1].cells[3].text == "+0.81 mm/m" and disp.rows[2].cells[3].text == "-0.87 mm/m"
    assert disp.rows[3].cells[3].text == NOT_PROVIDED  # 빈 칸은 서식 값을 남기지 않는다
    man = _tables(doc, "System")[0]
    assert [c.text for c in man.rows[1].cells] == ["TD02", "400A", "75,000", "100,000", "100,000", "130,000", "5,000"]
    assert doc.settings.element.find(
        "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}updateFields") is not None


@needs_template
def test_numbering_and_statements(tmp_path):
    """표 번호와 본문 참조, 결론 문장이 결과(OK / 초과 / 자료 없음)를 따른다."""
    _restraint_xlsx(str(tmp_path / "TD02" / "r.xlsx"))
    _cc_xlsx(str(tmp_path / "TD02" / "c.xlsx"))
    doc = Document(io.BytesIO(build_report(_input(_lines()), _resolver(tmp_path))[0]))
    text = _text(doc)
    assert "The table 6.1 shows" in text  # TD02: 표 6.1(반력), 6.2(응력)
    assert "The tables 6.3 and 6.4 show" in text  # TD06 모델 2개: 6.3, 6.4(반력) · 6.5, 6.6(응력)
    assert "Stress summary for TD06-2" in text and "Piping model for TD06-1" in text
    assert "exceed the specified allowable limits (TD02: L17)" in text
    assert "code stress results for this line were not provided" in text  # TD06, TD09
    assert "stress levels exceed the allowable limit defined by ASME B31.3 for TD02" in text  # 초록
    assert "TD06-1, TD06-2 and TD09 were not provided" in text

    # 모두 OK 이면 서식 문장 그대로
    _cc_xlsx(str(tmp_path / "TD02" / "c.xlsx"), ng=False)
    ok_doc = Document(io.BytesIO(build_report(_input(_lines()[:1]), _resolver(tmp_path))[0]))
    ok_text = _text(ok_doc)
    assert "calculated highest stresses are within the specified allowable limits" in ok_text
    assert "were not provided" not in ok_text.split("STRESS ANALYSIS")[-1].split("NOZZLE")[0]


@needs_template
def test_doc_info_and_missing_marks(tmp_path):
    """표지와 호선 문장은 입력에서 온다. 입력이 없으면 서식의 3441 글자를 남기지 않고 표시한다."""
    summary = {}
    filled = Document(io.BytesIO(build_report(_input(_lines()[:1], docInfo=DOC_INFO,
                                                     revisions=[{"no": "0", "date": "2026.11.18", "contents": "First issue"}]),
                                              _resolver(tmp_path), summary=summary)[0]))
    cover = "\n".join(c.text for r in filled.tables[0].rows for c in r.cells)
    for value in ("H9999 Design Basis", "OWNER", "200K LNG Carrier", "ABS", "9999-9998", "■ Final", "□ Preliminary", "■ Secret"):
        assert value in cover, value
    text = _text(filled)
    assert "(Hull No. 9999s)" in text and "3441" not in text and "3441" not in cover
    assert "Intergraph CAESAR II 2019." in text and "CAESAR II 2019 by Intergraph" in text
    assert "ABS classification(ABS Rules 5C-8)" in text and "defined by ABS classification" in text
    assert "9T-0000-001" in text
    assert "First note." in text and "bullet two" in text
    rev = _tables(filled, "No.")[0]
    assert [c.text for c in rev.rows[1].cells] == ["0", "2026.11.18", "First issue"] and len(rev.rows) == 2
    assert not any(m["where"].startswith("표지 ›") for m in summary["missing"])

    summary = {}
    bare = Document(io.BytesIO(build_report(_input(_lines()[:1]), _resolver(tmp_path), summary=summary)[0]))
    cover = "\n".join(c.text for r in bare.tables[0].rows for c in r.cells)
    assert MARK not in cover and "NYK" not in cover and "Junseok" not in cover  # 표지 빈칸은 빈칸 그대로
    text = _text(bare)
    assert MARK in text  # 문장에 끼는 값(해석 프로그램, 선급, 도면 번호)은 [Not provided]
    rev = _tables(bare, "No.")[0]
    assert [c.text for c in rev.rows[1].cells] == ["", "", ""]
    assert "(Hull No. 9999)" in text  # 보고서 정보가 없으면 최상위 폴더 이름의 호선
    assert "3441" not in text and "3441" not in cover
    wheres = [m["where"] for m in summary["missing"]]
    assert "표지 › Title" in wheres and "Revision Summary 표" in wheres and any("Figure 1.1" in w for w in wheres)


@needs_template
def test_figures_and_review(tmp_path):
    """올린 그림은 자리에 들어가고, 없는 그림은 자리 표시가 남는다. 검토용은 색과 점검표가 붙는다."""
    data = _input(_lines()[:2], docInfo=DOC_INFO)
    figs = {"pid": ("PID.png", _png()), "model:TD02": ("TD02.png", _png(60, 30))}
    normal, _ = build_report(data, _resolver(tmp_path), figures=figs)
    doc = Document(io.BytesIO(normal))
    text = _text(doc)
    assert text.count(NO_FIGURE) >= 2 + 2  # TD06 모델 2개 + Hogging/Sagging 등
    assert "검토용 점검표" not in text
    # 서식의 견본 그림(3441)은 결과 파일에 남지 않는다 — 올린 그림과 공통 그림만
    images = [r for r in doc.part.rels.values() if r.reltype.endswith("/image")]
    assert 0 < len(images) <= 6
    assert b"w:shd" not in doc.element.body.xml.encode() or "FBD9B5" not in doc.element.body.xml

    review, _ = build_report(data, _resolver(tmp_path), figures=figs, review=True, meta={"workspace": "WS1"})
    rdoc = Document(io.BytesIO(review))
    xml = rdoc.element.body.xml
    assert "DCE9F8" in xml and "FBD9B5" in xml and "E9E1F5" in xml  # 입력, 자료 없음, 올린 그림
    rtext = _text(rdoc)
    assert "검토용 점검표" in rtext and "WS1" in rtext
    assert rdoc.paragraphs[0].text == "검토용 보고서 읽는 법"  # 표지 앞 안내 쪽
    assert "원본 파일 계산" in rtext and "색이 없는 글과 표는 서식" in rtext
    assert rdoc.element.body[0].tag.endswith("}p") and not doc.paragraphs[0].text.startswith("검토용")
    audit = "\n".join(c.text for t in rdoc.tables[-3:] for r in t.rows for c in r.cells)
    assert "그림 폴더 › TD02.png" in audit and "Table 2.1 Unit system" in audit


def test_figure_matching(tmp_path):
    data = {"lines": [{"lineNo": "TD01", "modelCount": 1}, {"lineNo": "TD06", "modelCount": 4}, {"lineNo": "COMP.RM", "modelCount": 1}]}
    assert model_label(data["lines"][1], 2) == "TD06-3" and model_label(data["lines"][2], 0) == "Compressor Room"
    # 파일 이름 = 보고서 제목 그대로(번호, 대소문자, 띄어쓰기, 기호 무시)
    assert match_figure("Piping & Instrument Diagram for Cargo System", data) == "pid"
    assert match_figure("Figure 1.1 Piping & Instrument Diagram for Cargo System", data) == "pid"
    assert match_figure("piping_instrument_diagram_for_cargo_system", data) == "pid"
    assert match_figure("Hogging and sagging on each frames", data) == "hogsag"
    assert match_figure("Bending moment and section modulus on each frames", data) == "bending"
    assert match_figure("Table 7.1 Summary for compressor equipment nozzle loads", data) == "nozzleCompressor"
    assert match_figure("Summary of static equipment nozzle loads", data) == "nozzleStatic"
    assert match_figure("Piping model for TD01", data) == "model:TD01"
    assert match_figure("Figure 6.3 Piping model for TD06-3", data) == "model:TD06-3"
    assert match_figure("Piping model for Compressor Room", data) == "model:Compressor Room"
    # 옛 짧은 이름, 다른 글자는 맞추지 않는다
    for stem in ("PID", "Hogging", "TD01", "Piping model for TD06", "Piping model for TD06-30", "random"):
        assert match_figure(stem, data) is None, stem
    assert [s["hint"] for s in figure_slots(data)][-6:] == [
        "Piping model for TD01.png", "Piping model for TD06-1.png", "Piping model for TD06-2.png",
        "Piping model for TD06-3.png", "Piping model for TD06-4.png", "Piping model for Compressor Room.png"]

    fig = tmp_path / "Figures"
    fig.mkdir()
    for name in ("Piping model for TD01.png", "sub.txt", "TD01.png"):
        (fig / name).write_bytes(_png())
    matched, unmatched = scan_figures(str(tmp_path), data)
    assert matched == {"model:TD01": "Piping model for TD01.png"} and unmatched == ["TD01.png"]


@pytest.fixture()
def client(switchable_client, tmp_path, monkeypatch):
    monkeypatch.setattr(_intake, "USER_CONNECTION_DIR", str(tmp_path / "userConnection"))
    switchable_client.as_user()
    switchable_client.uc = tmp_path / "userConnection"
    return switchable_client


def test_report_route(client):
    ws = client.post("/api/analysis/psa-report/workspace").json()["workspace"]
    base = client.uc / ws
    _restraint_xlsx(str(base / "TD02" / "r.xlsx"))
    (base / "Figures").mkdir(parents=True)
    (base / "Figures" / "Piping model for TD02.png").write_bytes(_png())
    lines = [{"uid": "L1", "lineNo": "TD02", "pipeLine": "Vapour", "modelCount": 1,
              "folder": {"name": "TD02", "target": "TD02"}, "files": {"restraint": ["r.xlsx"], "codeCompliance": [""]}}]
    payload = _input(lines, docInfo={**DOC_INFO, "hullLabel": "9999s"})
    assert client.put("/api/analysis/psa-report/input", json={"workspace": ws, "input": payload}).status_code == 200

    figs = client.get("/api/analysis/psa-report/figures", params={"workspace": ws}).json()
    by_slot = {s["slot"]: s["file"] for s in figs["slots"]}
    assert by_slot["model:TD02"] == "Piping model for TD02.png" and by_slot["pid"] == ""

    r = client.post("/api/analysis/psa-report/report", json={"workspace": ws})
    assert r.status_code == 200, r.text
    assert r.content[:2] == b"PK"
    assert "H9999s_Pipe%20Stress%20Analysis.docx" in r.headers["content-disposition"]
    assert json.loads(unquote(r.headers["x-report-warnings"])) == []
    assert int(r.headers["x-report-missing"]) > 0  # Code Compliance 등

    review = client.post("/api/analysis/psa-report/review",
                         json={"workspace": ws, "pending": [{"lineNo": "TD02", "kind": "codeCompliance", "model": 0}]}).json()
    assert review["filename"].startswith("H9999s_") and review["filled"] > 0
    assert review["kinds"]["missing"]["fill"] == "#FBD9B5" and review["kinds"]["input"]["label"] == "입력값"
    assert any("아직 고르지 않음" in i["source"] for i in review["items"] if i["kind"] == "missing")
    kinds = {i["kind"] for i in review["items"]}
    assert {"input", "calc", "figure", "missing"} <= kinds
    assert any(i["where"].startswith("6장 Table 6.1") and i["kind"] == "calc" for i in review["items"])
    assert review["templateFixed"] and review["missing"]

    rv = client.post("/api/analysis/psa-report/report", json={"workspace": ws, "review": True})
    assert rv.status_code == 200
    assert unquote(rv.headers["content-disposition"]).endswith("_검토용.docx")
    assert "검토용 점검표" in _text(Document(io.BytesIO(rv.content)))


def test_review_without_input_is_404(client):
    """검토는 보고서를 먼저 만들 필요가 없지만, 저장된 입력은 있어야 한다."""
    ws = client.post("/api/analysis/psa-report/workspace").json()["workspace"]
    assert client.post("/api/analysis/psa-report/review", json={"workspace": ws}).status_code == 404


def test_report_route_rejects_escaping_path(client):
    """고른 파일 경로가 작업 폴더 밖이면 무시하고 'Data not provided'."""
    ws = client.post("/api/analysis/psa-report/workspace").json()["workspace"]
    _restraint_xlsx(str(client.uc / "outside.xlsx"))
    lines = [{"uid": "L1", "lineNo": "TD02", "pipeLine": "V", "modelCount": 1,
              "folder": {"name": "TD02", "target": "TD02"}, "files": {"restraint": ["../../outside.xlsx"]}}]
    client.put("/api/analysis/psa-report/input", json={"workspace": ws, "input": _input(lines)})
    r = client.post("/api/analysis/psa-report/report", json={"workspace": ws})
    assert r.status_code == 200
    doc = Document(io.BytesIO(r.content))
    assert _tables(doc, "Node")[0].rows[2].cells[0].text == NO_DATA


def _all_text(doc):
    from app.services import psa_report_docops as ops
    return "\n".join(ops.el_text(el) for el in doc.element.body.iterchildren())


@needs_template
def test_no_comp_room_drops_its_template_parts_and_toc_follows_headings(tmp_path):
    """Scope 에 COMP.RM 이 없으면 Compressor Room 전용 자리를 빼고, 목차는 실제 제목으로 다시 쓴다(2026-11-19)."""
    from app.services import psa_report_docops as ops
    data = _input(_lines()[:1], docInfo=DOC_INFO, processNotes="(*) liquid note\n(**) marked in compressor room, applied differently")
    out, _ = build_report(data, _resolver(tmp_path), figures={"nozzleStatic": ("n.png", _png())})
    doc = Document(io.BytesIO(out))
    text = _all_text(doc)
    assert "Load Cases (In Compressor Room" not in text and "compressor equipment nozzle loads" not in text
    assert "(**) marked in compressor room" not in text and "(*) liquid note" in text
    assert "(*) marked in compressor room, Acceleration" not in text
    assert "Table 5.1, 5.2 and 5.3" in text and "in Table 7.1\n" in text + "\n"
    assert "Table 7.1 Summary of static equipment nozzle loads" in text  # 7.2 → 7.1
    disp = _tables(doc, "Position")[0]
    assert not any("Compressor" in c.text for r in disp.rows for c in r.cells)
    pos = [t for t in doc.tables if t.rows[0].cells[0].text.strip() == "Discipline"]
    assert pos and not any("Compressor" in c.text for t in pos for r in t.rows for c in r.cells)
    # 목차: 본문 제목 그대로(6.1 TD02, 6.1.1 Analysis model), 서식의 옛 항목(CR01, 1/2/3/4_Tank Vent) 없음, 책갈피 이름 중복 없음
    toc = [ops.el_text(el) for el in doc.element.body.iterchildren() if ops.tag_of(el) == "p" and ops.style_id(el) in ("11", "21", "32")]
    joined = "\n".join(toc)
    assert "6.1.TD02 - Vapour" in joined and "6.1.1.Analysis model" in joined and "7.NOZZLE LOAD ASSESSMENT" in joined
    assert "CR01" not in joined and "Tank Vent(No.1/2/3/4)" not in joined
    assert joined.startswith("ABSTRACT") and "A.REFERENCE" in joined
    names = [b.get(qn("w:name")) for b in doc.element.body.iter(qn("w:bookmarkStart"))]
    toc_names = [n for n in names if n and n.startswith("_Toc")]
    assert len(toc_names) == len(set(toc_names))


@needs_template
def test_comp_room_line_keeps_its_template_parts(tmp_path):
    lines = _lines()[:1] + [{"uid": "C", "lineNo": "COMP.RM", "pipeLine": "In Compressor Room", "modelCount": 1, "folder": None, "files": {}}]
    out, _ = build_report(_input(lines, docInfo=DOC_INFO), _resolver(tmp_path))
    text = _all_text(Document(io.BytesIO(out)))
    assert "Load Cases (In Compressor Room" in text and "compressor equipment nozzle loads" in text
    assert "Table 5.1, 5.2, 5.3 and 5.4" in text
    data = {"lines": lines}
    assert "nozzleCompressor" in [s["slot"] for s in figure_slots(data)]
    assert "nozzleCompressor" not in [s["slot"] for s in figure_slots({"lines": lines[:1]})]


def test_fixed_decimals():
    from app.services.psa_report_docx import _fixed
    assert _fixed(83.0, 1) == "83.0" and _fixed(160, 2) == "160.00" and _fixed(-0.0001, 1) == "0.0"
