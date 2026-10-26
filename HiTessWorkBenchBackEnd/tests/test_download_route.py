"""/api/download — 길이를 디스크 크기로 단정하지 않고 읽은 바이트를 그대로 보낸다(DRM 크기 불일치 방지)."""

from app.routers import analysis


def test_download_streams_read_bytes_without_stat_length(admin_client, tmp_path, monkeypatch):
    base = tmp_path / "userConnection"
    job = base / "20261026_ADMIN001_DoublePipe"
    job.mkdir(parents=True)
    report = job / "Report for PSA.xlsx"
    report.write_bytes(b"PK" + b"x" * 3_000_000)
    monkeypatch.setattr(analysis, "_ALLOWED_DOWNLOAD_BASE", str(base))
    monkeypatch.setattr(analysis, "_normalize_userconnection_path", lambda p: p)
    monkeypatch.setattr(analysis, "assert_current_user_can_access_path", lambda *a, **k: None)

    res = admin_client.get("/api/download", params={"filepath": str(report)})

    assert res.status_code == 200
    assert res.content == report.read_bytes()
    assert "content-length" not in res.headers  # chunked — stat 크기를 약속하지 않는다
    assert "Report%20for%20PSA.xlsx" in res.headers["content-disposition"]


def test_download_missing_file_is_404(admin_client, tmp_path, monkeypatch):
    monkeypatch.setattr(analysis, "_normalize_userconnection_path", lambda p: p)
    monkeypatch.setattr(analysis, "assert_current_user_can_access_path", lambda *a, **k: None)
    assert admin_client.get("/api/download", params={"filepath": str(tmp_path / "none.xlsx")}).status_code == 404


def test_download_locked_file_is_409_not_500(admin_client, tmp_path, monkeypatch):
    report = tmp_path / "Report for PSA.xlsx"
    report.write_bytes(b"PK")
    monkeypatch.setattr(analysis, "_normalize_userconnection_path", lambda p: p)
    monkeypatch.setattr(analysis, "assert_current_user_can_access_path", lambda *a, **k: None)
    real_open = open

    def locked_open(path, mode="r", *args, **kwargs):
        if str(path) == str(report) and "b" in mode:
            raise PermissionError("locked by DRM")
        return real_open(path, mode, *args, **kwargs)

    monkeypatch.setattr("builtins.open", locked_open)
    res = admin_client.get("/api/download", params={"filepath": str(report)})
    assert res.status_code == 409
    assert "다시" in res.json()["detail"]


def test_download_directory_is_404_not_409(admin_client, tmp_path, monkeypatch):
    monkeypatch.setattr(analysis, "_normalize_userconnection_path", lambda p: p)
    monkeypatch.setattr(analysis, "assert_current_user_can_access_path", lambda *a, **k: None)
    assert admin_client.get("/api/download", params={"filepath": str(tmp_path)}).status_code == 404
