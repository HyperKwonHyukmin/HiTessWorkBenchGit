"""HiTESS 소개 영상 — 로그인 표(ticket)로만 스트리밍한다."""

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import videos


@pytest.fixture()
def video_dir(tmp_path, monkeypatch):
    (tmp_path / "b.mp4").write_bytes(b"0123456789" * 10)  # 100 바이트
    (tmp_path / "a.mp4").write_bytes(b"A" * 20)
    (tmp_path / "note.txt").write_text("not a video", encoding="utf-8")
    (tmp_path / videos.MANIFEST_NAME).write_text(
        json.dumps([{"file": "b.mp4", "title": "비 영상", "subtitle": "설명"}, {"file": "missing.mp4", "title": "없음"}]),
        encoding="utf-8",
    )
    monkeypatch.setattr(videos, "VIDEO_DIR", tmp_path)
    return tmp_path


def _ticket(admin_client, video_id):
    res = admin_client.post(f"/api/videos/{video_id}/ticket")
    assert res.status_code == 200
    return res.json()


def test_list_follows_manifest_then_filename(admin_client, video_dir):
    items = admin_client.get("/api/videos").json()
    assert [i["title"] for i in items] == ["비 영상", "a"]
    assert items[0]["subtitle"] == "설명"
    assert "file" not in items[0]  # 파일명·경로는 내보내지 않는다


def test_list_requires_login(video_dir):
    assert TestClient(app).get("/api/videos").status_code == 401


def test_ticket_gives_watermark_and_stream_plays_full_and_range(admin_client, video_dir):
    vid = videos._video_id("b.mp4")
    ticket = _ticket(admin_client, vid)
    assert ticket["watermark"] == "관리자 ADMIN001"

    full = admin_client.get(ticket["streamPath"])
    assert full.status_code == 200
    assert full.content == b"0123456789" * 10
    assert full.headers["accept-ranges"] == "bytes"
    assert full.headers["cache-control"] == "no-store"

    part = admin_client.get(ticket["streamPath"], headers={"Range": "bytes=10-19"})
    assert part.status_code == 206
    assert part.content == b"0123456789"
    assert part.headers["content-range"] == "bytes 10-19/100"

    tail = admin_client.get(ticket["streamPath"], headers={"Range": "bytes=95-"})
    assert tail.content == b"56789"
    suffix = admin_client.get(ticket["streamPath"], headers={"Range": "bytes=-3"})
    assert suffix.content == b"789"

    bad = admin_client.get(ticket["streamPath"], headers={"Range": "bytes=200-"})
    assert bad.status_code == 416


def test_stream_rejects_missing_forged_other_video_and_expired_ticket(admin_client, video_dir):
    vid_b = videos._video_id("b.mp4")
    vid_a = videos._video_id("a.mp4")
    client = TestClient(app)
    assert client.get(f"/api/videos/stream/{vid_b}").status_code == 403
    assert client.get(f"/api/videos/stream/{vid_b}?t=ADMIN001.9999999999.deadbeef").status_code == 403
    # b 의 표로 a 를 받을 수 없다
    ticket_b = videos.make_ticket(vid_b, "ADMIN001")
    assert client.get(f"/api/videos/stream/{vid_a}?t={ticket_b}").status_code == 403
    # 만료
    old = videos.make_ticket(vid_b, "ADMIN001", now=0)
    res = client.get(f"/api/videos/stream/{vid_b}?t={old}")
    assert res.status_code == 403
    assert "다시 열어" in res.json()["detail"]


def test_ticket_logs_play_activity(admin_client, video_dir, db_session):
    from app import models
    _ticket(admin_client, videos._video_id("b.mp4"))
    log = db_session.query(models.ActivityLog).filter_by(action_type="VIDEO_PLAY").one()
    assert log.employee_id == "ADMIN001"
    assert log.action_detail["video"] == "비 영상"


def test_unknown_video_is_404(admin_client, video_dir):
    assert admin_client.post("/api/videos/nope/ticket").status_code == 404


def test_stream_does_not_promise_content_length(admin_client, video_dir):
    ticket = _ticket(admin_client, videos._video_id("b.mp4"))
    res = admin_client.get(ticket["streamPath"], headers={"Range": "bytes=0-9"})
    assert res.status_code == 206
    assert "content-length" not in res.headers  # stat 과 실제 바이트가 달라도 끊기지 않게
