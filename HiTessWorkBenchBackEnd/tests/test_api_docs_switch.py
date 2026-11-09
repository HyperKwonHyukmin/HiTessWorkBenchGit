"""API 설명서 화면은 기본으로 꺼져 있고 .env API_DOCS=1 일 때만 켜진다(app/main.py)."""

from fastapi.testclient import TestClient

from app.main import create_app


def _paths(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("API_DOCS", raising=False)
    else:
        monkeypatch.setenv("API_DOCS", value)
    client = TestClient(create_app())
    return {p: client.get(p).status_code for p in ("/docs", "/redoc", "/openapi.json")}


def test_docs_off_by_default(monkeypatch):
    assert set(_paths(monkeypatch, None).values()) == {404}
    assert set(_paths(monkeypatch, "0").values()) == {404}


def test_docs_on_with_switch(monkeypatch):
    assert set(_paths(monkeypatch, "1").values()) == {200}
