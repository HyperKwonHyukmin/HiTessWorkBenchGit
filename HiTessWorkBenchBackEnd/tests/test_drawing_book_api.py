"""치공구표준집 찾기 API (계획 2026-11-11 1단계) — 색인·썸네일·쪽 바로 변환.

실제 도면집은 서버에만 있으므로 같은 쪽 수(166)의 가짜 PDF 로 시험한다.
"""
import fitz
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import database
from app.dependencies import require_auth
from app.routers import analysis
from app.services import drawing_book


@pytest.fixture()
def fake_book(tmp_path, monkeypatch):
    p = tmp_path / "ToolStandard_2018_FINAL.pdf"
    doc = fitz.open()
    for n in range(1, 167):
        page = doc.new_page(width=595, height=842)
        page.insert_text((60, 80), f"page {n}")
    doc.save(str(p))
    doc.close()
    monkeypatch.setattr(drawing_book, "book_path", lambda: str(p))
    monkeypatch.setattr(drawing_book, "edition_problem", lambda raw: None)   # 가짜 PDF 라 판(sha256)이 다르다
    drawing_book._pdf_cache.clear()
    drawing_book._thumb_cache.clear()
    yield p
    drawing_book._pdf_cache.clear()
    drawing_book._thumb_cache.clear()


def _client(db_session, employee_id="OWNER01"):
    app = FastAPI()
    app.include_router(analysis.router)

    def override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = override_db
    app.dependency_overrides[require_auth] = lambda: employee_id
    return TestClient(app)


def test_book_index_and_status(db_session, fake_book):
    r = _client(db_session).get("/api/analysis/drawing-to-analysis/book")
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["items"]) == 155 and d["status"] == {"available": True, "reason": None}


def test_book_status_when_missing_or_drm_wrapped(db_session, fake_book):
    fake_book.unlink()
    d = _client(db_session).get("/api/analysis/drawing-to-analysis/book").json()
    assert d["status"]["available"] is False and "없습니다" in d["status"]["reason"]
    # DRM 이 감싼 모양 — 70 개발 PC 는 DRM 에이전트가 이런 파일을 0바이트로 돌려주므로 문구는 단위 시험에서 본다
    fake_book.write_bytes(b"HHIDRMC\x00" + b"\x00" * 64)
    drawing_book._pdf_cache.clear()
    d = _client(db_session).get("/api/analysis/drawing-to-analysis/book").json()
    assert d["status"]["available"] is False
    r = _client(db_session).get("/api/analysis/drawing-to-analysis/book/33/thumb")
    assert r.status_code == 503


def test_book_bytes_problem_wording():
    assert drawing_book.book_bytes_problem(b"%PDF-1.7 ...") is None
    assert "DRM 에 감싸져" in drawing_book.book_bytes_problem(b"HHIDRMC\x00rest")
    assert "비어 있음" in drawing_book.book_bytes_problem(b"")
    assert "PDF 가 아닙니다" in drawing_book.book_bytes_problem(b"PK\x03\x04zip")


def test_thumb_png_sizes_and_bad_requests(db_session, fake_book):
    c = _client(db_session)
    small = c.get("/api/analysis/drawing-to-analysis/book/33/thumb")
    large = c.get("/api/analysis/drawing-to-analysis/book/33/thumb?size=large")
    assert small.status_code == 200 and small.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert len(large.content) > len(small.content)
    assert c.get("/api/analysis/drawing-to-analysis/book/5/thumb").status_code == 404     # 목차 쪽(색인 밖)
    assert c.get("/api/analysis/drawing-to-analysis/book/33/thumb?size=huge").status_code == 400


def test_run_extracts_one_page_and_submits(db_session, fake_book, tmp_path, monkeypatch):
    work = tmp_path / "work"
    work.mkdir()
    monkeypatch.setattr(analysis, "make_work_dir", lambda emp, prog: (str(work), "20261111_120000"))
    submitted = []
    monkeypatch.setattr(analysis, "submit_analysis_job", lambda *a, **k: submitted.append(a) or "job-book")
    c = _client(db_session)

    r = c.post("/api/analysis/drawing-to-analysis/book/33/run", data={"employee_id": "OWNER01"})
    assert r.status_code == 200, r.text
    assert r.json()["mode"] == "lug" and r.json()["item"]["aliases"][0] == "L-25"
    args = submitted[-1]
    pdf_path, mode, page = args[1], args[8], args[9]
    assert pdf_path.endswith("Book_b022_L-25.pdf") and mode == "lug" and page == 1
    with fitz.open(pdf_path) as one:
        assert one.page_count == 1 and "page 33" in one[0].get_text()


def test_run_rules(db_session, fake_book, tmp_path, monkeypatch):
    work = tmp_path / "work2"
    work.mkdir()
    monkeypatch.setattr(analysis, "make_work_dir", lambda emp, prog: (str(work), "20261111_120001"))
    submitted = []
    monkeypatch.setattr(analysis, "submit_analysis_job", lambda *a, **k: submitted.append(a) or "job")
    c = _client(db_session)
    url = "/api/analysis/drawing-to-analysis/book/{}/run"
    assert c.post(url.format(138), data={"employee_id": "OWNER01"}).status_code == 400   # NCB-1 반목
    assert c.post(url.format(5), data={"employee_id": "OWNER01"}).status_code == 404     # 색인 밖
    r = c.post(url.format(125), data={"employee_id": "OWNER01"})                          # SU-145
    assert r.status_code == 200 and r.json()["mode"] == "support"
    # 다른 BLOCK SUPPORT 는 옛 support 엔진에 보내지 않는다 — 그 엔진은 도면을 안 읽고 SU-145 값을 낸다(조용히 틀린 모델)
    r = c.post(url.format(118), data={"employee_id": "OWNER01"})                          # SU-A1
    assert r.status_code == 200 and r.json()["mode"] == "lug"
    assert "support" not in submitted[-1][1].lower()   # 파일 이름에 'support' 를 넣지 않는다(옛 화면 모드 판별)
    assert c.post(url.format(33), data={"employee_id": "OTHER99"}).status_code == 403


def test_edition_problem_when_book_differs_from_index():
    # 색인을 만든 판과 다른 도면집이면 쪽 번호가 어긋나 엉뚱한 도면을 변환한다 → 쓰지 않는다
    assert "다릅니다" in drawing_book.edition_problem(b"%PDF-1.7 another edition")


def test_support_engine_name_rule():
    # 옛 support 엔진은 도면을 안 읽고 SU-145 모델을 낸다 → 이름이 SU-145 일 때만
    ok = drawing_book.support_engine_allowed_for_name
    assert ok("BlockSupport_SU_145.pdf") and ok("block_support_su-145_rev1.pdf") and ok("SU145")
    assert not ok("BlockSupport_SU_A1.pdf") and not ok("BlockSupport_SU_1450.pdf") and not ok("SU-14")
    assert analysis._resolve_drawing_mode("BlockSupport_SU_145.pdf") == "support"
    assert analysis._resolve_drawing_mode("BlockSupport_SU_A1.pdf") == "lug"
    assert analysis._resolve_drawing_mode("my_support.pdf") == "lug"
    assert analysis._resolve_drawing_mode("Lug_L_25.pdf") == "lug"


def test_upload_request_support_only_for_su145(db_session, tmp_path, monkeypatch):
    work = tmp_path / "up"
    work.mkdir()
    monkeypatch.setattr(analysis, "make_work_dir", lambda emp, prog: (str(work), "20261111_130000"))
    submitted = []
    monkeypatch.setattr(analysis, "submit_analysis_job", lambda *a, **k: submitted.append(a) or "job")
    c = _client(db_session)
    url = "/api/analysis/drawing-to-analysis/request"

    def post(name, mode=None):
        data = {"employee_id": "OWNER01"}
        if mode:
            data["mode"] = mode
        return c.post(url, data=data, files={"pdf_file": (name, b"%PDF-1.4 x", "application/pdf")})

    # 화면이 support 를 보내도 SU-145 이름이 아니면 서버가 러그로 바꾼다(옛 화면·직접 호출 방어)
    r = post("my_support_SU_A1.pdf", mode="support")
    assert r.status_code == 200 and r.json()["mode"] == "lug" and submitted[-1][8] == "lug"
    r = post("BlockSupport_SU_145.pdf", mode="support")
    assert r.json()["mode"] == "support"
    r = post("BlockSupport_SU_145.pdf")
    assert r.json()["mode"] == "support"
    assert post("x.pdf", mode="weird").status_code == 400
