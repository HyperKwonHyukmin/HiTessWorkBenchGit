"""웹 뉴스레터 공개 페이지(app/routers/newsletter_web.py) — 로그인 없이 열린다."""

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import newsletter_web


def _issue(root, issue_id, title, html="<!doctype html><title>뉴스</title>"):
    folder = root / issue_id
    (folder / "img").mkdir(parents=True)
    (folder / "index.html").write_text(html, encoding="utf-8")
    (folder / "issue.json").write_text(json.dumps({"title": title, "date": issue_id[:7]}, ensure_ascii=False), encoding="utf-8")
    (folder / "img" / "a.jpg").write_bytes(b"\xff\xd8\xff jpg")
    return folder


@pytest.fixture()
def web_dir(tmp_path, monkeypatch):
    _issue(tmp_path, "2026-06", "26년 6월호")
    _issue(tmp_path, "2026-11", "26년 11월호", "<!doctype html><title>11월</title><img src=\"img/a.jpg\">")
    (tmp_path / "draft").mkdir()  # 호 이름 규칙 밖 폴더는 목록에 안 나온다
    (tmp_path / "2026-12").mkdir()  # index.html 이 없으면 목록에 안 나온다
    monkeypatch.setattr(newsletter_web, "NEWSLETTER_WEB_DIR", tmp_path)
    return tmp_path


def test_latest_redirect_without_login(web_dir):
    client = TestClient(app)
    res = client.get("/newsletter", follow_redirects=False)
    assert res.status_code == 307 and res.headers["location"] == "/newsletter/2026-11/"
    page = client.get("/newsletter")
    assert page.status_code == 200 and "11월" in page.text and "text/html" in page.headers["content-type"]


def test_issue_page_needs_trailing_slash_for_relative_assets(web_dir):
    client = TestClient(app)
    res = client.get("/newsletter/2026-06", follow_redirects=False)
    assert res.status_code == 307 and res.headers["location"] == "/newsletter/2026-06/"
    img = client.get("/newsletter/2026-11/img/a.jpg")
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    assert img.content.startswith(b"\xff\xd8")


def test_issues_json_newest_first(web_dir):
    data = TestClient(app).get("/newsletter/issues.json").json()["issues"]
    assert [item["id"] for item in data] == ["2026-11", "2026-06"]
    assert data[0]["title"] == "26년 11월호" and data[0]["url"] == "/newsletter/2026-11/"


def test_bad_paths_are_404(web_dir):
    client = TestClient(app)
    (web_dir / "2026-11" / "secret.py").write_text("x", encoding="utf-8")
    (web_dir / "outside.jpg").write_bytes(b"\xff\xd8")
    for path in (
        "/newsletter/nope/",
        "/newsletter/2026-12/",
        "/newsletter/2026-11/secret.py",
        "/newsletter/2026-11/img/none.jpg",
        "/newsletter/2026-11/..%2Foutside.jpg",
        "/newsletter/2026-11/..%5Coutside.jpg",
    ):
        assert client.get(path).status_code == 404, path


def test_drm_wrapped_file_is_refused(web_dir):
    (web_dir / "2026-11" / "img" / "a.jpg").write_bytes(b"HHIDRMC" + b"\0" * 10)
    res = TestClient(app).get("/newsletter/2026-11/img/a.jpg")
    assert res.status_code == 500 and "DRM" in res.json()["detail"]


def test_empty_folder_is_404(tmp_path, monkeypatch):
    monkeypatch.setattr(newsletter_web, "NEWSLETTER_WEB_DIR", tmp_path / "none")
    client = TestClient(app)
    assert client.get("/newsletter", follow_redirects=False).status_code == 404
    assert client.get("/newsletter/issues.json").json() == {"issues": []}


def test_repo_issue_is_served():
    """저장소에 든 실제 호가 열리고 그림 경로가 모두 살아 있는지."""
    issues = newsletter_web.list_issues()
    assert issues, "NewsLetterWeb 에 호가 없다"
    client = TestClient(app)
    page = client.get(issues[0]["url"])
    assert page.status_code == 200
    import re
    refs = set(re.findall(r'(?:src|url|poster)\(?=?"((?:img|fonts|media)/[^"]+)"', page.text))
    assert refs
    for ref in refs:
        res = client.get(issues[0]["url"] + ref)
        assert res.status_code == 200, ref


def test_bad_issue_json_and_numeric_suffix(web_dir):
    """issue.json 이 객체가 아니어도 목록이 살아 있고, 같은 달 -10 이 -9 보다 최신이다."""
    (web_dir / "2026-11" / "issue.json").write_text("[]", encoding="utf-8")
    _issue(web_dir, "2026-11-9", "9번")
    _issue(web_dir, "2026-11-10", "10번")
    client = TestClient(app)
    ids = [item["id"] for item in client.get("/newsletter/issues.json").json()["issues"]]
    assert ids == ["2026-11-10", "2026-11-9", "2026-11", "2026-06"]
    assert client.get("/newsletter", follow_redirects=False).headers["location"] == "/newsletter/2026-11-10/"


def test_head_requests_for_link_checkers(web_dir):
    client = TestClient(app)
    assert client.head("/newsletter", follow_redirects=False).status_code == 307
    assert client.head("/newsletter/2026-11/").status_code == 200
    assert client.head("/newsletter/2026-11/img/a.jpg").status_code == 200


def test_video_range_requests(web_dir):
    """영상은 구간 요청(Range)을 받아야 브라우저에서 넘겨 볼 수 있다(2026-11 1분 영상)."""
    body = bytes(range(256)) * 4
    (web_dir / "2026-11" / "media").mkdir()
    (web_dir / "2026-11" / "media" / "v.mp4").write_bytes(body)
    client = TestClient(app)
    url = "/newsletter/2026-11/media/v.mp4"
    full = client.get(url)
    assert full.status_code == 200 and full.content == body
    assert full.headers["content-type"] == "video/mp4" and full.headers["accept-ranges"] == "bytes"
    part = client.get(url, headers={"Range": "bytes=10-19"})
    assert part.status_code == 206 and part.content == body[10:20]
    assert part.headers["content-range"] == f"bytes 10-19/{len(body)}"
    open_end = client.get(url, headers={"Range": "bytes=1000-"})
    assert open_end.status_code == 206 and open_end.content == body[1000:]
    tail = client.get(url, headers={"Range": "bytes=-24"})
    assert tail.status_code == 206 and tail.content == body[-24:]
    bad = client.get(url, headers={"Range": f"bytes={len(body)}-"})
    assert bad.status_code == 416 and bad.headers["content-range"] == f"bytes */{len(body)}"
