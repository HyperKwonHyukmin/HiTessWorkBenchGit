"""PSA 평가보고서 — 결과 폴더 업로드 라우트 (routers/psa_report.py)."""
import os

import pytest

from app.routers import _intake


@pytest.fixture()
def client(switchable_client, tmp_path, monkeypatch):
    monkeypatch.setattr(_intake, "USER_CONNECTION_DIR", str(tmp_path / "userConnection"))
    switchable_client.as_user()
    switchable_client.uc = tmp_path / "userConnection"
    return switchable_client


def _upload(client, ws, target, items, reset=True):
    files = [("files", (os.path.basename(rel), data, "application/octet-stream")) for rel, data in items]
    data = {"workspace": ws, "target": target, "reset": "true" if reset else "false", "paths": [rel for rel, _ in items]}
    return client.post("/api/analysis/psa-report/folder-upload", data=data, files=files)


def test_workspace_then_upload_keeps_folder_structure(client):
    ws = client.post("/api/analysis/psa-report/workspace").json()["workspace"]
    assert ws.endswith("_EMP001_PsaReport")

    r = _upload(client, ws, "TD01", [("a.f06", b"F06"), ("fig/sub/b.png", b"PNG1"), ("readme.txt", b"x")])
    assert r.status_code == 200, r.text
    assert r.json()["saved"] == 3
    base = client.uc / ws / "TD01"
    assert (base / "a.f06").read_bytes() == b"F06"
    assert (base / "fig" / "sub" / "b.png").read_bytes() == b"PNG1"

    # 두 번째 묶음(reset 거짓)은 더한다
    assert _upload(client, ws, "TD01", [("c.csv", b"1,2")], reset=False).status_code == 200
    desc = client.get("/api/analysis/psa-report/workspace", params={"workspace": ws}).json()
    assert desc["targets"]["TD01"]["fileCount"] == 4

    # 다시 고르면(reset 참) 비우고 새로
    assert _upload(client, ws, "TD01", [("new.f06", b"N")]).status_code == 200
    assert sorted(os.listdir(base)) == ["new.f06"]

    # COMP.RM, Figures 도 대상 이름으로 된다
    assert _upload(client, ws, "COMP.RM", [("x.f06", b"1")]).status_code == 200
    assert _upload(client, ws, "Figures", [("p/1.png", b"1")]).status_code == 200
    assert (client.uc / ws / "COMP.RM" / "x.f06").exists()

    r = client.post("/api/analysis/psa-report/folder-remove", data={"workspace": ws, "target": "TD01"})
    assert r.json() == {"removed": True}
    assert not base.exists()


@pytest.mark.parametrize("rel", ["../evil.txt", "a/../../evil.txt", "C:/x.txt", "nul", "a/con.txt", "a?b.txt"])
def test_rejects_escaping_or_bad_paths(client, rel):
    ws = client.post("/api/analysis/psa-report/workspace").json()["workspace"]
    r = _upload(client, ws, "TD01", [(rel, b"x")])
    assert r.status_code == 400
    assert not (client.uc / "evil.txt").exists()


@pytest.mark.parametrize("target", ["..", "../TD01", "a/b", "nul", "TD01.", ""])
def test_rejects_bad_target(client, target):
    ws = client.post("/api/analysis/psa-report/workspace").json()["workspace"]
    assert _upload(client, ws, target, [("a.txt", b"x")]).status_code in (400, 422)


def test_bad_batch_writes_nothing(client):
    ws = client.post("/api/analysis/psa-report/workspace").json()["workspace"]
    r = _upload(client, ws, "TD02", [("ok.txt", b"1"), ("../bad.txt", b"2")])
    assert r.status_code == 400
    assert not (client.uc / ws / "TD02").exists()


def test_too_long_path_is_400_with_name(client):
    ws = client.post("/api/analysis/psa-report/workspace").json()["workspace"]
    long_rel = "/".join(["d" * 50] * 5) + "/f.txt"
    r = _upload(client, ws, "TD01", [(long_rel, b"x")])
    assert r.status_code == 400
    assert "너무 깁니다" in r.json()["detail"]


def test_other_users_workspace_is_403_and_missing_is_404(client):
    client.as_admin()
    ws_admin = client.post("/api/analysis/psa-report/workspace").json()["workspace"]
    client.as_user()
    assert _upload(client, ws_admin, "TD01", [("a.txt", b"x")]).status_code == 403
    assert client.get("/api/analysis/psa-report/workspace", params={"workspace": "20260101_000000_EMP001_PsaReport"}).status_code == 404
    assert _upload(client, "20260101_000000_EMP001_Other", "TD01", [("a.txt", b"x")]).status_code == 400


def test_drm_wrapped_file_is_reported(client):
    ws = client.post("/api/analysis/psa-report/workspace").json()["workspace"]
    r = _upload(client, ws, "TD01", [("r.pdf", b"HHIDRMC" + b"\0" * 20), ("ok.txt", b"1")])
    assert r.json()["drmFiles"] == ["r.pdf"]


def test_route_is_guarded():
    from app.services.app_settings import GUARDED_ROUTES
    assert ("/api/analysis/psa-report/", "PSA 평가보고서 자동화 프로그램") in GUARDED_ROUTES


def test_input_json_saved_and_loaded(client):
    ws = client.post("/api/analysis/psa-report/workspace").json()["workspace"]
    body = {"workspace": ws, "input": {"version": 2, "lines": [{"lineNo": "TD01"}], "displacement": {"sun": "0.3"}}}
    r = client.put("/api/analysis/psa-report/input", json=body)
    assert r.status_code == 200, r.text
    saved = (client.uc / ws / "psa_input.json").read_text(encoding="utf-8")
    assert '"TD01"' in saved
    assert client.get("/api/analysis/psa-report/input", params={"workspace": ws}).json()["displacement"]["sun"] == "0.3"
    # 다시 저장하면 덮어쓴다
    body["input"]["displacement"]["sun"] = "0.4"
    client.put("/api/analysis/psa-report/input", json=body)
    assert client.get("/api/analysis/psa-report/input", params={"workspace": ws}).json()["displacement"]["sun"] == "0.4"


def test_input_json_rejects_non_psa_and_other_user(client):
    ws = client.post("/api/analysis/psa-report/workspace").json()["workspace"]
    assert client.put("/api/analysis/psa-report/input", json={"workspace": ws, "input": {"a": 1}}).status_code == 400
    assert client.get("/api/analysis/psa-report/input", params={"workspace": ws}).status_code == 404
    client.as_admin()
    ws_admin = client.post("/api/analysis/psa-report/workspace").json()["workspace"]
    client.as_user()
    assert client.put("/api/analysis/psa-report/input", json={"workspace": ws_admin, "input": {"lines": []}}).status_code == 403
