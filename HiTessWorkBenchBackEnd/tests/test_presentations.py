"""HiTESS 런칭 덱 고정 엔드포인트 계약 테스트."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import presentations


ENDPOINT = "/api/presentations/hitess-launch-deck"


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(presentations.router)
    return TestClient(app)


def _write_deck(directory, marker: str) -> str:
    directory.mkdir(parents=True, exist_ok=True)
    html = f"<!DOCTYPE html><html lang='ko'><title>{marker}</title><body>{marker}</body></html>"
    (directory / presentations._PRESENTATION_FILENAME).write_text(html, encoding="utf-8")
    return html


def test_repository_fallback_serves_utf8_html_without_frame_blocking(tmp_path, monkeypatch):
    fallback_dir = tmp_path / "fallback"
    expected_html = _write_deck(fallback_dir, "기준 소개자료")
    monkeypatch.delenv("INTRO_PRESENTATION_DIR", raising=False)
    monkeypatch.setattr(presentations, "_FALLBACK_PRESENTATION_DIR", fallback_dir)

    response = _client().get(ENDPOINT)

    assert response.status_code == 200
    assert response.content == expected_html.encode("utf-8")
    assert response.headers["content-type"].lower() == "text/html; charset=utf-8"
    assert response.headers["cache-control"] == "no-store"
    assert "x-frame-options" not in response.headers


def test_configured_directory_takes_precedence_and_query_cannot_select_a_path(
    tmp_path,
    monkeypatch,
):
    fallback_dir = tmp_path / "fallback"
    configured_dir = tmp_path / "runtime"
    _write_deck(fallback_dir, "fallback")
    expected_html = _write_deck(configured_dir, "runtime")
    outside_file = tmp_path / "outside.html"
    outside_file.write_text("outside", encoding="utf-8")
    monkeypatch.setattr(presentations, "_FALLBACK_PRESENTATION_DIR", fallback_dir)
    monkeypatch.setenv("INTRO_PRESENTATION_DIR", str(configured_dir))

    response = _client().get(ENDPOINT, params={"path": str(outside_file)})

    assert response.status_code == 200
    assert response.text == expected_html
    assert "outside" not in response.text


def test_configured_directory_does_not_fall_back_when_file_is_missing(tmp_path, monkeypatch):
    fallback_dir = tmp_path / "fallback"
    _write_deck(fallback_dir, "must-not-leak-through")
    monkeypatch.setattr(presentations, "_FALLBACK_PRESENTATION_DIR", fallback_dir)
    monkeypatch.setenv("INTRO_PRESENTATION_DIR", str(tmp_path / "missing-runtime"))

    response = _client().get(ENDPOINT)

    assert response.status_code == 404
    assert response.json() == {"detail": "HiTESS 소개자료를 찾을 수 없습니다."}


def test_missing_fallback_returns_404(tmp_path, monkeypatch):
    monkeypatch.delenv("INTRO_PRESENTATION_DIR", raising=False)
    monkeypatch.setattr(presentations, "_FALLBACK_PRESENTATION_DIR", tmp_path / "missing")

    response = _client().get(ENDPOINT)

    assert response.status_code == 404


def test_invalid_utf8_returns_safe_500(tmp_path, monkeypatch):
    configured_dir = tmp_path / "runtime"
    configured_dir.mkdir()
    (configured_dir / presentations._PRESENTATION_FILENAME).write_bytes(b"\xff\xfe")
    monkeypatch.setenv("INTRO_PRESENTATION_DIR", str(configured_dir))

    response = _client().get(ENDPOINT)

    assert response.status_code == 500
    assert response.json() == {"detail": "HiTESS 소개자료 형식이 올바르지 않습니다."}
    assert str(configured_dir) not in response.text


def test_repository_canonical_deck_is_present_and_self_contained(monkeypatch):
    monkeypatch.delenv("INTRO_PRESENTATION_DIR", raising=False)
    canonical_path = presentations._presentation_path()
    html = canonical_path.read_text(encoding="utf-8")

    assert canonical_path.name == "hitess-launch-deck.html"
    assert "<title>HiTESS WorkBench — 런칭 발표</title>" in html
    assert html.count('<div class="S ') == 21
    assert "https://" not in html
    assert "http://" not in html
    assert "fetch(" not in html
    assert "WebSocket" not in html
