"""Studio 사용 설명서 — 로그인 사용자에게 웹판·PDF 를 내준다(app/routers/manuals.py)."""

import gzip
import json
from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import manuals


@pytest.fixture()
def manual_dir(tmp_path, monkeypatch):
    folder = tmp_path / "module-unit"
    folder.mkdir()
    (folder / "manual.json").write_text(json.dumps({
        "id": "module-unit", "title": "Module Unit 권상 Studio 사용 설명서", "version": "02",
        "studio": "0.0.197", "date": "2026-11-09", "pdfFileName": "ModuleUnit_권상Studio_사용설명서_문서버전02.pdf",
    }, ensure_ascii=False), encoding="utf-8")
    (folder / "manual.html").write_text("<!doctype html><title>설명서</title>", encoding="utf-8")
    (folder / "manual.pdf.gz").write_bytes(gzip.compress(b"%PDF-1.4 test"))
    monkeypatch.setattr(manuals, "MANUALS_DIR", tmp_path)
    return folder


def test_requires_login(manual_dir):
    client = TestClient(app)
    for path in ("/api/manuals/module-unit", "/api/manuals/module-unit/web", "/api/manuals/module-unit/pdf"):
        assert client.get(path).status_code == 401


def test_info_web_pdf(admin_client, manual_dir):
    info = admin_client.get("/api/manuals/module-unit").json()
    assert info["version"] == "02" and info["hasPdf"] and info["hasWeb"]

    web = admin_client.get("/api/manuals/module-unit/web")
    assert web.status_code == 200 and "text/html" in web.headers["content-type"]
    assert "설명서" in web.text

    pdf = admin_client.get("/api/manuals/module-unit/pdf")
    assert pdf.status_code == 200 and pdf.content == b"%PDF-1.4 test"
    assert pdf.headers["content-type"] == "application/pdf"
    assert "content-length" not in pdf.headers  # DRM 길이 불일치 함정 — 길이를 약속하지 않는다
    assert "ModuleUnit_권상Studio_사용설명서_문서버전02.pdf" in unquote(pdf.headers["content-disposition"])


def test_unknown_or_bad_id_is_404(admin_client, manual_dir):
    assert admin_client.get("/api/manuals/nope").status_code == 404
    assert admin_client.get("/api/manuals/..%5Cmodule-unit").status_code == 404
    assert admin_client.get("/api/manuals/Module-Unit/pdf").status_code == 404


def test_drm_wrapped_pdf_is_refused(admin_client, manual_dir):
    (manual_dir / "manual.pdf.gz").write_bytes(b"HHIDRMC" + b"\0" * 20)
    res = admin_client.get("/api/manuals/module-unit/pdf")
    assert res.status_code == 500 and "DRM" in res.json()["detail"]


@pytest.mark.parametrize("manual_id", ["module-unit", "model-builder"])
def test_repo_manual_is_plain_pdf(manual_id):
    """git 에 실제로 들어가는 설명서가 평문 PDF 인지 — 암호문이 커밋되면 145 에서 깨진다."""
    folder = manuals.MANUALS_DIR / manual_id
    if not (folder / "manual.json").is_file():
        pytest.skip("설명서 미배포")
    meta = json.loads((folder / "manual.json").read_text(encoding="utf-8"))
    assert gzip.decompress((folder / "manual.pdf.gz").read_bytes())[:4] == b"%PDF"
    assert f"문서 버전 {meta['version']}" in (folder / "manual.html").read_text(encoding="utf-8")


def test_truncated_gzip_is_refused_with_message(admin_client, manual_dir):
    whole = gzip.compress(b"%PDF-1.4 " + bytes(range(256)) * 400)
    (manual_dir / "manual.pdf.gz").write_bytes(whole[:-200] + bytes(50))
    res = admin_client.get("/api/manuals/module-unit/pdf")
    assert res.status_code == 500 and "손상" in res.json()["detail"]
