"""All Projects BDF 3D 미리보기(`GET /api/admin/projects/{id}/model-preview`) — 합성 BDF 만 쓴다."""
import gzip
import json
import struct
from datetime import datetime

import pytest

from app import models
from app.routers import analysis as analysis_router
from app.services.bdf_preview import service as preview

FOLDER = "20261001_090000_EMP001_GroupModuleUnit"

INCLUDED = b"GRID,3,,0.,1000.,0.\nCQUAD4,10,2,1,2,3,3\n"
MAIN = (b"SOL 101\nCEND\nBEGIN BULK\n"
        b"GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\n"
        b"CBAR,1,1,1,2,0.,0.,1.\nPBARL,1,1,,L\n,100.,100.,10.,10.\n"
        b"PSHELL,2,1,10.\nMAT1,1,206000.,,0.3,7.85-9\n"
        b"INCLUDE 'sub/part.dat'\nENDDATA\n")


@pytest.fixture()
def user_conn(tmp_path, monkeypatch):
    base = tmp_path / "userConnection"
    base.mkdir()
    monkeypatch.setattr(analysis_router, "_USER_CONNECTION_DIR", str(base))
    monkeypatch.setattr(analysis_router, "_ALLOWED_DOWNLOAD_BASE", str(base))
    preview.clear_cache()
    return base


def _record(db, base, files):
    root = base / FOLDER
    for rel, data in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    a = models.Analysis(employee_id="EMP001", program_name="GroupModuleUnit", project_name="미리보기",
                        status="Success", input_info={"bdf_model": str(root / "model.bdf")}, result_info={},
                        created_at=datetime(2026, 10, 1, 9, 0, 0))
    db.add(a)
    db.commit()
    db.refresh(a)
    return a, root


def _header(raw: bytes) -> dict:
    assert raw[:4] == b"LBM1"
    (hlen,) = struct.unpack("<I", raw[4:8])
    return json.loads(raw[8:8 + hlen])


def test_preview_requires_admin(switchable_client):
    switchable_client.as_user()
    assert switchable_client.get("/api/admin/projects/1/model-preview", params={"path": "x.bdf"}).status_code == 403


def test_preview_returns_lbm_with_include(switchable_client, db_session, user_conn):
    a, root = _record(db_session, user_conn, {"model.bdf": MAIN, "sub/part.dat": INCLUDED})
    r = switchable_client.get(f"/api/admin/projects/{a.id}/model-preview", params={"path": str(root / "model.bdf")})
    assert r.status_code == 200, r.text
    assert r.headers["x-lbm-version"] == str(preview.LBM_VERSION)
    raw = r.content if r.content[:4] == b"LBM1" else gzip.decompress(r.content)
    h = _header(raw)
    assert h["blocks"]["node_ids"]["count"] == 3          # INCLUDE 안의 GRID 3 까지
    assert h["blocks"]["beams"]["count"] == 1
    assert h["blocks"]["quads"]["count"] == 1


def test_preview_rejects_outside_and_non_bdf(switchable_client, db_session, user_conn, tmp_path):
    a, root = _record(db_session, user_conn, {"model.bdf": MAIN, "sub/part.dat": INCLUDED, "step1.json": b"{}"})
    outside = tmp_path / "other.bdf"
    outside.write_bytes(MAIN)
    url = f"/api/admin/projects/{a.id}/model-preview"
    assert switchable_client.get(url, params={"path": str(outside)}).status_code == 422
    assert switchable_client.get(url, params={"path": str(root / "step1.json")}).status_code == 422


def test_preview_drm_and_no_elements(switchable_client, db_session, user_conn):
    a, root = _record(db_session, user_conn, {
        "model.bdf": b"HHIDRMC" + b"\0" * 64,
        "empty.bdf": b"BEGIN BULK\nGRID,1,,0.,0.,0.\nENDDATA\n",
    })
    url = f"/api/admin/projects/{a.id}/model-preview"
    r = switchable_client.get(url, params={"path": str(root / "model.bdf")})
    assert r.status_code == 422 and "DRM" in r.json()["detail"]
    r = switchable_client.get(url, params={"path": str(root / "empty.bdf")})
    assert r.status_code == 422 and "요소" in r.json()["detail"]


def test_preview_include_cannot_escape_folder(user_conn, tmp_path):
    root = user_conn / FOLDER
    root.mkdir()
    (tmp_path / "secret.dat").write_bytes(INCLUDED)
    (root / "m.bdf").write_bytes(b"BEGIN BULK\nGRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nCROD,1,1,1,2\n"
                                 b"INCLUDE '../../secret.dat'\nENDDATA\n")
    out = preview.build_preview(str(root), "m.bdf")
    assert out["counts"]["GRID"] == 2                        # 루트 밖 INCLUDE 는 읽지 않는다
    assert out["missing"] == ["../../secret.dat"]
