"""관리자 업데이트 이력(`/api/admin/updates`) — 권한·데이터 모양·화면 문구 규칙."""
import json
import re

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers.updates import DATA, load_items

KINDS = {"기능", "개선", "수정", "정리", "운영"}


def test_requires_login():
    assert TestClient(app).get("/api/admin/updates").status_code == 401


def test_admin_only(switchable_client):
    switchable_client.as_user()
    assert switchable_client.get("/api/admin/updates").status_code == 403
    switchable_client.as_admin()
    r = switchable_client.get("/api/admin/updates")
    assert r.status_code == 200
    assert r.json()["items"] == load_items()


def test_data_shape():
    items = load_items()
    assert items
    for i in items:
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", i["date"]), i
        assert i["kind"] in KINDS, i["title"]
        assert i["title"].strip() and i["summary"].strip()
        if "version" in i:
            assert re.fullmatch(r"\d+\.\d+\.\d+", i["version"]), i["title"]
        assert isinstance(i.get("points", []), list)
        if "requester" in i:
            assert isinstance(i["requester"], str) and i["requester"].strip(), i["title"]


def test_newest_first():
    dates = [i["date"] for i in load_items()]
    assert dates == sorted(dates, reverse=True)


def test_no_em_dash_in_shown_text():
    """화면 문구에 em dash 를 쓰지 않는다(LogBook 업데이트 이력과 같은 기준)."""
    for i in load_items():
        assert "status" not in i, f"{i['title']}: 상태 칸은 쓰지 않는다(2026-10-22 사용자 결정)"
        shown = [i["title"], i["summary"], i.get("screen") or "",
                 i.get("requester") or ""] + i.get("points", [])
        assert not any("—" in t for t in shown), i["title"]


def test_broken_file_reports_reason(tmp_path):
    bad = tmp_path / "changelog.json"
    bad.write_text("{", encoding="utf-8")
    with pytest.raises(ValueError):
        load_items(bad)
    bad.write_text(json.dumps({"items": "x"}), encoding="utf-8")
    with pytest.raises(ValueError):
        load_items(bad)
    assert load_items(DATA)  # 실제 파일은 읽힌다
