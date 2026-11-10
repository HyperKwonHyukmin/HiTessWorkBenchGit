"""메일·공지용 짧은 내려받기 주소 `/download` (2026-11-10) — 로그인 없이 최신 exe 를 준다."""
import os
import time

from fastapi.testclient import TestClient

from app import database
from app.main import app
from app.routers import system


def _client(db_session):
    def _override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = _override_db
    return TestClient(app)


def test_download_link_serves_latest_exe_without_login(db_session, tmp_path, monkeypatch):
    old = tmp_path / "HiTESS-WorkBench-v1.7.16.exe"
    new = tmp_path / "HiTESS-WorkBench-v1.7.17.exe"
    old.write_bytes(b"old")
    new.write_bytes(b"new-exe")
    os.utime(old, (time.time() - 100, time.time() - 100))
    monkeypatch.setattr(system, "LATEST_CLIENT_DIR", tmp_path)
    try:
        res = _client(db_session).get("/download")
        assert res.status_code == 200
        assert res.content == b"new-exe"
        assert "HiTESS-WorkBench-v1.7.17.exe" in res.headers["content-disposition"]
        # 앱 자체 업데이트 경로도 같은 파일
        assert _client(db_session).get("/api/download/client").content == b"new-exe"
    finally:
        app.dependency_overrides.clear()


def test_download_link_404_when_no_exe(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(system, "LATEST_CLIENT_DIR", tmp_path)
    try:
        assert _client(db_session).get("/download").status_code == 404
    finally:
        app.dependency_overrides.clear()
