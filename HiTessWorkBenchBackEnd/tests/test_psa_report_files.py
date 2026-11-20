"""PSA 평가보고서 — Line 폴더 체크리스트 판별(services/psa_report_files.py)과 /checklist 경로."""
import os

import openpyxl
import pytest

from app.routers import _intake
from app.services.psa_report_files import classify_file, scan_target, xlsx_sheet_names


def _xlsx(path, *sheets):
    wb = openpyxl.Workbook()
    wb.active.title = sheets[0]
    for s in sheets[1:]:
        wb.create_sheet(s)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    wb.save(path)


def _touch(path, data=b"%PDF-1.4"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def test_classify_by_sheet_name_not_file_name(tmp_path):
    _xlsx(tmp_path / "a" / "222222.xlsx", "Code Compliance", "Sheet1")
    _xlsx(tmp_path / "a" / "TD01 RESTRAINT.xlsx", "Restraint Summary Extended", "Sheet1")
    _xlsx(tmp_path / "a" / "TD01 RESTRAINT - 수계산(19CASE).xlsx", "Restraint Summary Extended", "결과값 정리")
    _xlsx(tmp_path / "a" / "copy.xlsx", "Restraint Summary Extended", "결과값 정리")
    _xlsx(tmp_path / "a" / "data.xlsx", "Sheet1")
    _xlsx(tmp_path / "a" / "3441-Nozzle검토_(압축기)_250905.xlsx", "Sheet1")
    _xlsx(tmp_path / "a" / "3441-Nozzle검토_(열교환기)_250905.xlsx", "Sheet1")
    _touch(tmp_path / "a" / "3441_TD01-Liquid Main(ISO).pdf")
    _touch(tmp_path / "a" / "3441_INPUT ECHO(LQ).pdf")
    _touch(tmp_path / "a" / "Input Echo(NO.1).pdf")
    _touch(tmp_path / "a" / "CR03 ISO VIEW.pdf")
    _touch(tmp_path / "a" / "Isolation note.pdf")
    _touch(tmp_path / "a" / "~$TD01.xlsx", b"x")
    a = tmp_path / "a"
    got = {f: classify_file(f, str(a / f)) for f in os.listdir(a)}
    assert got["222222.xlsx"] == "codeCompliance"
    assert got["TD01 RESTRAINT.xlsx"] == "restraint"
    assert got["TD01 RESTRAINT - 수계산(19CASE).xlsx"] is None
    assert got["copy.xlsx"] is None
    assert got["data.xlsx"] is None
    assert got["3441-Nozzle검토_(압축기)_250905.xlsx"] == "nozzleCompressor"
    assert got["3441-Nozzle검토_(열교환기)_250905.xlsx"] == "nozzleHeatExchanger"
    assert got["3441_TD01-Liquid Main(ISO).pdf"] == "iso"
    assert got["CR03 ISO VIEW.pdf"] == "iso"
    assert got["3441_INPUT ECHO(LQ).pdf"] == "inputEcho"
    assert got["Input Echo(NO.1).pdf"] == "inputEcho"
    assert got["Isolation note.pdf"] is None
    assert got["~$TD01.xlsx"] is None


def test_scan_target_lists_candidates_and_unreadable(tmp_path):
    _xlsx(tmp_path / "NO.1" / "R1.xlsx", "Restraint Summary Extended")
    _xlsx(tmp_path / "NO.2" / "R2.xlsx", "Restraint Summary Extended")
    _touch(tmp_path / "NO.2" / "drm.xlsx", b"HHIDRMC" + b"\0" * 10)
    res = scan_target(str(tmp_path))
    assert res["kinds"]["restraint"] == ["NO.1/R1.xlsx", "NO.2/R2.xlsx"]
    assert res["kinds"]["codeCompliance"] == []
    assert res["unreadable"] == ["NO.2/drm.xlsx"]
    assert xlsx_sheet_names(str(tmp_path / "NO.2" / "drm.xlsx")) is None


def test_legacy_stress_sheet_is_code_compliance_fallback(tmp_path):
    # 3441 Line 별 묶음 엑셀: Restraint + Legacy 한 파일 → 두 칸 모두 후보
    _xlsx(tmp_path / "TD01" / "TD-01.xlsx", "Restraint Summary Extended", "Stress Summary (Legacy)", "Sheet1")
    _xlsx(tmp_path / "TD01" / "TD-01 수계산.xlsx", "Stress Summary (Legacy)")
    res = scan_target(str(tmp_path / "TD01"))
    assert res["kinds"]["restraint"] == ["TD-01.xlsx"]
    assert res["kinds"]["codeCompliance"] == ["TD-01.xlsx"]
    # 진짜 Code Compliance 내보내기가 있으면 그것만
    _xlsx(tmp_path / "TD01" / "cc.xlsx", "Code Compliance")
    assert scan_target(str(tmp_path / "TD01"))["kinds"]["codeCompliance"] == ["cc.xlsx"]


def test_meta_reads_named_sheet_not_first(tmp_path):
    p = tmp_path / "TD04" / "TD-04.xlsx"
    os.makedirs(p.parent)
    wb = openpyxl.Workbook()
    wb.active.title = "Stress Summary (Legacy)"
    wb.active.append(["CAESAR II"])
    r = wb.create_sheet("Restraint Summary Extended")
    r.append(["CAESAR II"])
    r.append([10, None, "TYPE=Rigid ANC;"])
    r.append([11, None, "TYPE=Displ. Reaction;"])
    r.append([20, None, "TYPE=Rigid Z;"])
    wb.save(p)
    assert scan_target(str(p.parent))["meta"]["TD-04.xlsx"]["supports"] == 2


@pytest.fixture()
def client(switchable_client, tmp_path, monkeypatch):
    monkeypatch.setattr(_intake, "USER_CONNECTION_DIR", str(tmp_path / "userConnection"))
    switchable_client.as_user()
    switchable_client.uc = tmp_path / "userConnection"
    return switchable_client


def test_checklist_route_skips_figures_and_others(client):
    ws = client.post("/api/analysis/psa-report/workspace").json()["workspace"]
    base = client.uc / ws
    _xlsx(base / "TD01" / "TD01 RESTRAINT.xlsx", "Restraint Summary Extended")
    _xlsx(base / "TD01" / "cc.xlsx", "Code Compliance")
    _touch(base / "TD01" / "x(ISO).pdf")
    _touch(base / "Figures" / "a(ISO).pdf")
    _touch(base / "Others" / "b(ISO).pdf")
    body = client.get("/api/analysis/psa-report/checklist", params={"workspace": ws}).json()
    assert list(body["targets"]) == ["TD01"]
    k = body["targets"]["TD01"]["kinds"]
    assert k["restraint"] == ["TD01 RESTRAINT.xlsx"] and k["codeCompliance"] == ["cc.xlsx"] and k["iso"] == ["x(ISO).pdf"]


def _caesar_xlsx(path, sheet, head, job, cases, supports=()):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet
    ws.append([head])
    ws.append([f"Job Name: {job}"])
    ws.append(["Licensed To: X"])
    for i in range(1, cases + 1):
        ws.append([f"CASE {i} (OPE) W+P1"])
    for n, t in supports:
        ws.append([n, None, t])
        ws.append([None, "  1(OPE)", 1, 2, 3])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    wb.save(path)


def test_meta_reads_caesar_header(tmp_path):
    _caesar_xlsx(tmp_path / "TD03" / "r.xlsx", "Restraint Summary Extended",
                 "CAESAR II  Ver.14.00.00.0910,  (Build 231113)   Date: JUN 17, 2026   Time: 9:57",
                 "3441-TD03-SPRAY", 15, [(10, "TYPE=Rigid ANC;"), (11, "TYPE=Displ. Reaction;"), (20, "TYPE=Rigid Z;")])
    _caesar_xlsx(tmp_path / "TD03" / "c.xlsx", "Code Compliance",
                 "CAESAR II  Ver.13.00.00.0890,  Date: MAY 7, 2025   Time: 16:06", "3341-OLD", 18)
    _touch(tmp_path / "TD03" / "a(ISO).pdf", b"not a pdf")
    res = scan_target(str(tmp_path / "TD03"))
    r = res["meta"]["r.xlsx"]
    assert r["exportedAt"] == "2026-06-17T09:57"
    assert r["version"] == "14.00.00.0910"
    assert r["job"] == "3441-TD03-SPRAY" and r["jobHull"] == "3441"
    assert r["loadCases"] == 15 and r["supports"] == 2
    c = res["meta"]["c.xlsx"]
    assert c["exportedAt"] == "2025-05-07T16:06" and c["jobHull"] == "3341" and c["loadCases"] == 18
    assert "supports" not in c
    # 깨진 PDF 도 후보로 남고 쪽수만 없다(크기는 회사 DRM 이 PDF 를 감싸면 +4096 이라 값을 보지 않는다)
    assert res["meta"]["a(ISO).pdf"]["size"] > 0 and "pages" not in res["meta"]["a(ISO).pdf"]
