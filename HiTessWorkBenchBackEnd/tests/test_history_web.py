"""Hi-TESS 개발 연대기 공개 페이지(app/routers/history_web.py) — 로그인 없이 열린다."""

import json
import re

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import history_web


@pytest.fixture()
def web_dir(tmp_path, monkeypatch):
    (tmp_path / "fonts").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>연대기</title><script src=\"data.auto.js\"></script>", encoding="utf-8")
    (tmp_path / "data.auto.js").write_text("window.HISTORY_AUTO = {};", encoding="utf-8")
    (tmp_path / "fonts" / "a.woff2").write_bytes(b"wOF2 font")
    (tmp_path / "notes.txt").write_text("내부 메모", encoding="utf-8")
    (tmp_path.parent / "secret.js").write_text("바깥 파일", encoding="utf-8")
    monkeypatch.setattr(history_web, "HISTORY_WEB_DIR", tmp_path)
    return tmp_path


def test_page_opens_without_login(web_dir):
    client = TestClient(app)
    res = client.get("/history", follow_redirects=False)
    assert res.status_code == 307 and res.headers["location"] == "/history/"
    page = client.get("/history/")
    assert page.status_code == 200 and "연대기" in page.text and "text/html" in page.headers["content-type"]
    assert page.headers["cache-control"] == "no-cache"


def test_assets_are_limited_to_known_types(web_dir):
    client = TestClient(app)
    data = client.get("/history/data.auto.js")
    assert data.status_code == 200 and "javascript" in data.headers["content-type"]
    assert data.headers["cache-control"] == "no-cache"  # 자료는 고치면 바로 보여야 한다
    font = client.get("/history/fonts/a.woff2")
    assert font.status_code == 200 and font.headers["content-type"] == "font/woff2"
    assert client.get("/history/notes.txt").status_code == 404      # 허용 표에 없는 형식
    assert client.get("/history/missing.js").status_code == 404


def test_path_escape_is_blocked(web_dir):
    client = TestClient(app)
    assert client.get("/history/..%2Fsecret.js").status_code == 404
    assert client.get("/history/%2e%2e/secret.js").status_code == 404


def test_unc_and_absolute_paths_never_reach_the_filesystem(web_dir, monkeypatch):
    """`//호스트/공유/x.js` 는 resolve() 만 해도 서버가 그 호스트로 접속한다 — 경로 모양에서 먼저 끊는다."""
    from pathlib import Path

    def boom(self, *args, **kwargs):
        raise AssertionError(f"파일시스템에 닿았다: {self}")

    client = TestClient(app)
    monkeypatch.setattr(Path, "resolve", boom)
    for path in (
        "/history///localhost/none/x.js",
        "/history/%5C%5Clocalhost%5Cnone%5Cx.js",
        "/history/C:%5Cx.js",
        "/history/fonts%5Ca.woff2",
    ):
        assert client.get(path).status_code == 404, path


def test_drm_wrapped_file_is_reported_not_served(web_dir):
    (web_dir / "data.auto.js").write_bytes(b"HHIDRMC" + b"\x00" * 32)
    res = TestClient(app).get("/history/data.auto.js")
    assert res.status_code == 500 and "DRM" in res.json()["detail"]


def test_missing_folder_is_404(tmp_path, monkeypatch):
    monkeypatch.setattr(history_web, "HISTORY_WEB_DIR", tmp_path / "none")
    assert TestClient(app).get("/history/").status_code == 404


# ── 저장소에 실제로 들어 있는 페이지 — 145 가 git pull 만으로 열 수 있는 상태인지 ──

def _repo_text(name):
    data = (history_web.HISTORY_WEB_DIR / name).read_bytes()
    assert not data.startswith(b"HHIDRMC"), f"{name} 이 DRM 에 감싸진 채 저장소에 있다"
    return data.decode("utf-8")


def test_repo_page_files_exist_and_are_plain():
    html = _repo_text("index.html")
    # 페이지가 부르는 같은 폴더 파일이 모두 있고, 라우터가 내주는 형식이어야 한다
    # 주소(https:…)와 페이지 안 이동(#…)은 빼고, 같은 폴더 파일만
    refs = re.findall(r'(?:src|href)="([^":#]+)"', html) + re.findall(r'url\("([^":#]+)"\)', html)
    assert "data.auto.js" in refs and "data.events.js" in refs
    for ref in refs:
        target = history_web.HISTORY_WEB_DIR / ref
        assert target.is_file(), f"index.html 이 부르는 {ref} 이 없다"
        assert target.suffix.lower() in history_web._ASSET_TYPES
        assert not target.read_bytes().startswith(b"HHIDRMC")


def test_repo_auto_data_is_valid():
    text = _repo_text("data.auto.js")
    data = json.loads(text[text.index("{"):text.rindex("}") + 1])
    weeks = data["weeks"]
    assert len({len(v) for v in weeks.values()}) == 1 and len(weeks["wb"]) > 0
    assert data["latest"].startswith("v") and data["versions"]


def test_repo_page_served_by_route():
    client = TestClient(app)
    assert client.get("/history/").status_code == 200
    assert client.get("/history/data.events.js").status_code == 200
