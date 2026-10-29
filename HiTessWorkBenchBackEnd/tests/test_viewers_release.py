"""Studio 릴리스 표(studio_release.json) — 운영(145)은 표의 버전만, 개발(70, STUDIO_CHANNEL=dev)은 최고 버전.

개발 PC 가 UNC 에 올린 베타가 145 사용자에게 바로 나가던 문제(2026-10-29)를 막는 규칙이다.
"""
import json
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import viewers

VID = "zz-release-test-studio"   # 실제 StudioProgram 폴더의 zip 과 겹치지 않는 이름


def _zip(d, ver, valid=True):
    path = d / f"{VID}-{ver}.zip"
    if valid:
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr("manifest.json", json.dumps({"id": VID, "version": ver}))
    else:
        path.write_bytes(b"not a zip")
    return path


@pytest.fixture()
def dirs(tmp_path, monkeypatch):
    a, b = tmp_path / "a", tmp_path / "b"
    a.mkdir()
    b.mkdir()
    table = tmp_path / "studio_release.json"
    monkeypatch.setenv("VIEWER_DIRS", f"{a},{b}")
    monkeypatch.setenv("STUDIO_RELEASE_FILE", str(table))
    monkeypatch.delenv("STUDIO_CHANNEL", raising=False)
    return a, b, table


def _pin(table, ver):
    table.write_text(json.dumps({"studios": {VID: ver}}), encoding="utf-8")


def test_표에_없으면_최고_버전(dirs):
    a, _, _ = dirs
    _zip(a, "0.0.9")
    _zip(a, "0.0.11")
    assert viewers._find_zip(VID).endswith(f"{VID}-0.0.11.zip")


def test_표에_있으면_그_버전만_다른_폴더에_있어도_찾는다(dirs):
    a, b, table = dirs
    _zip(a, "0.0.12")          # 첫 폴더에는 베타만
    _zip(b, "0.0.10")          # 릴리스 버전은 둘째 폴더(UNC 자리)
    _pin(table, "0.0.10")
    assert viewers._find_zip(VID).endswith(f"{VID}-0.0.10.zip")


def test_표_버전_zip_이_없으면_최고_버전으로_넘어가지_않는다(dirs):
    a, _, table = dirs
    _zip(a, "0.0.12")
    _pin(table, "0.0.10")
    assert viewers._find_zip(VID) is None


def test_표_버전_zip_이_깨져_있으면_없음으로_본다(dirs):
    a, _, table = dirs
    _zip(a, "0.0.10", valid=False)
    _zip(a, "0.0.12")
    _pin(table, "0.0.10")
    assert viewers._find_zip(VID) is None


def test_dev_채널은_표를_무시한다(dirs, monkeypatch):
    a, _, table = dirs
    _zip(a, "0.0.10")
    _zip(a, "0.0.12")
    _pin(table, "0.0.10")
    monkeypatch.setenv("STUDIO_CHANNEL", "dev")
    assert viewers._find_zip(VID).endswith(f"{VID}-0.0.12.zip")


def test_표가_깨지면_500(dirs):
    a, _, table = dirs
    _zip(a, "0.0.12")
    table.write_text("{ 깨진", encoding="utf-8")
    with pytest.raises(viewers.HTTPException) as e:
        viewers._find_zip(VID)
    assert e.value.status_code == 500


def test_manifest_응답에_채널과_표_버전(dirs):
    a, _, table = dirs
    _zip(a, "0.0.10")
    _zip(a, "0.0.12")
    _pin(table, "0.0.10")
    app = FastAPI()
    app.include_router(viewers.router)
    client = TestClient(app)
    r = client.get(f"/api/viewers/manifest/{VID}")
    assert r.status_code == 200
    body = r.json()
    assert body["manifest"]["version"] == "0.0.10"
    assert body["channel"] == "release"
    assert body["releasedVersion"] == "0.0.10"
    _pin(table, "0.0.99")
    r = client.get(f"/api/viewers/manifest/{VID}")
    assert r.status_code == 404
    assert r.json()["detail"]["releasedVersion"] == "0.0.99"


def test_저장소의_릴리스_표는_모든_배포_studio_를_담는다():
    with open(viewers._RELEASE_FILE, encoding="utf-8") as f:
        studios = json.load(f)["studios"]
    for vid in ("model-studio", "module-unit-studio", "mooring-fitting-studio", "plate-studio", "side-passage-studio"):
        assert vid in studios, vid
        assert all(p.isdigit() for p in studios[vid].split(".")), studios[vid]
