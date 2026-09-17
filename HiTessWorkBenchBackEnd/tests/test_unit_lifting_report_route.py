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


def test_side_passage_parent_titles_the_report(switchable_client, db_session, tmp_path, monkeypatch):
    """projectKind 가 없는 과거 기록도 부모(SidePassage)를 찾아 보고서 제목을 정한다."""
    import urllib.parse
    from app.routers import analysis as router
    monkeypatch.setattr(router, "_USER_CONNECTION_DIR", str(tmp_path))
    parent = models.Analysis(employee_id="EMP001", program_name="SidePassage", project_name="p",
                             status="Success", created_at=datetime.now())
    db_session.add(parent)
    db_session.commit()
    a = _record(db_session, tmp_path)
    a.input_info = {"parent_analysis_id": parent.id}
    db_session.commit()
    switchable_client.as_user()
    res = switchable_client.post("/api/analysis/unit-structural/report", json={"analysisId": a.id})
    assert res.status_code == 200, res.text
    name = urllib.parse.unquote(res.headers["X-Report-Filename"])
    assert "Side_Passage" in name, name


def test_pdf_format_returns_pdf(switchable_client, db_session, tmp_path, monkeypatch):
    """format=pdf 는 xlsx 를 변환해 application/pdf 로 내려준다 (변환기는 대역).

    실제 Excel 변환은 tests/test_xlsx_to_pdf.py 가 (Excel 있는 환경에서) 검증한다.
    여기서는 라우터의 형식 분기 — 헤더·확장자 — 만 본다.
    """
    import urllib.parse
    from app.routers import analysis as router
    monkeypatch.setattr(router, "_USER_CONNECTION_DIR", str(tmp_path))
    seen = {}

    def fake_convert(data, sheet_name="Report"):
        seen["bytes"] = data[:2]
        seen["sheet"] = sheet_name
        return b"%PDF-1.7 fake"

    monkeypatch.setattr(router, "convert_xlsx_to_pdf", fake_convert)
    a = _record(db_session, tmp_path)
    switchable_client.as_user()
    res = switchable_client.post("/api/analysis/unit-structural/report",
                                 json={"analysisId": a.id, "format": "pdf"})
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("application/pdf")
    assert res.headers["X-Report-Format"] == "pdf"
    assert res.content == b"%PDF-1.7 fake"
    # 데이터 시트가 붙지 않도록 Report 시트만 넘겼는가
    assert seen == {"bytes": b"PK", "sheet": "Report"}
    name = urllib.parse.unquote(res.headers["X-Report-Filename"])
    assert name.endswith(".pdf") and ".xlsx" not in name, name


def test_pdf_conversion_failure_is_503(switchable_client, db_session, tmp_path, monkeypatch):
    """Excel 이 없는 서버에서는 깨진 파일 대신 사유가 담긴 503 이 나가야 한다."""
    from app.routers import analysis as router
    from app.services.xlsx_to_pdf import PdfConversionError
    monkeypatch.setattr(router, "_USER_CONNECTION_DIR", str(tmp_path))

    def boom(data, sheet_name="Report"):
        raise PdfConversionError("Excel 을 실행할 수 없습니다")

    monkeypatch.setattr(router, "convert_xlsx_to_pdf", boom)
    a = _record(db_session, tmp_path)
    switchable_client.as_user()
    res = switchable_client.post("/api/analysis/unit-structural/report",
                                 json={"analysisId": a.id, "format": "pdf"})
    assert res.status_code == 503
    assert "Excel" in res.json()["detail"]


def test_unknown_format_rejected(switchable_client, db_session, tmp_path, monkeypatch):
    from app.routers import analysis as router
    monkeypatch.setattr(router, "_USER_CONNECTION_DIR", str(tmp_path))
    a = _record(db_session, tmp_path)
    switchable_client.as_user()
    res = switchable_client.post("/api/analysis/unit-structural/report",
                                 json={"analysisId": a.id, "format": "docx"})
    assert res.status_code == 400


def test_pdf_end_to_end_with_real_excel(switchable_client, db_session, tmp_path, monkeypatch):
    """Excel 이 있는 환경(서버·dev PC)에서 라우터가 실제 PDF 를 내려주는지 — 전 구간 1회 확인.

    결과 레포트만 돈다(상세는 21p 라 ~15s). 변환 자체의 세부는 test_xlsx_to_pdf.py 가 본다.
    """
    import pytest
    from tests.test_xlsx_to_pdf import _excel_available

    if not _excel_available():
        pytest.skip("MS Excel 미설치 환경")
    fitz = pytest.importorskip("fitz")

    from app.routers import analysis as router
    monkeypatch.setattr(router, "_USER_CONNECTION_DIR", str(tmp_path))
    a = _record(db_session, tmp_path)
    switchable_client.as_user()
    res = switchable_client.post("/api/analysis/unit-structural/report",
                                 json={"analysisId": a.id, "format": "pdf"})
    assert res.status_code == 200, res.text
    assert res.content.startswith(b"%PDF"), res.content[:16]
    # 사내 표준 서식은 A4 세로 2페이지. 데이터 시트가 섞여 들어오면 여기서 늘어난다.
    doc = fitz.open(stream=res.content, filetype="pdf")
    assert doc.page_count == 2, doc.page_count
    assert round(doc[0].rect.width) == 595 and round(doc[0].rect.height) == 842
