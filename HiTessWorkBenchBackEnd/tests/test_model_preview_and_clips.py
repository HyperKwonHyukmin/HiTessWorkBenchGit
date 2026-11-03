"""대시보드 모델 벽의 BDF 고르기와 앱 카드 미리보기 표."""
import json

import pytest
from fastapi import HTTPException

from app.routers import videos
from app.services.bdf_preview.service import find_model_bdf


def test_find_model_bdf_prefers_result_and_stays_inside_base(tmp_path):
    base = tmp_path / "userConnection"
    base.mkdir()
    result_bdf = base / "out.bdf"
    input_bdf = base / "in.bdf"
    result_bdf.write_text("x")
    input_bdf.write_text("x")
    outside = tmp_path / "secret.bdf"
    outside.write_text("x")

    assert find_model_bdf({"bdf": str(result_bdf)}, {"bdf_model": str(input_bdf)}, str(base)) == str(result_bdf.resolve())
    assert find_model_bdf({"bdf": str(base / "gone.bdf")}, {"bdf_model": str(input_bdf)}, str(base)) == str(input_bdf.resolve())
    assert find_model_bdf({"bdf": str(outside)}, None, str(base)) is None
    assert find_model_bdf({"bdf": str(tmp_path / "userConnection2" / "a.bdf")}, None, str(base)) is None
    assert find_model_bdf({"json": str(result_bdf)}, "not-a-dict", str(base)) is None


@pytest.fixture
def clips(tmp_path, monkeypatch):
    monkeypatch.setattr(videos, "PREVIEW_DIR", tmp_path)
    (tmp_path / "a.mp4").write_bytes(b"\x00" * 16)
    (tmp_path / "previews.json").write_text(json.dumps({"앱": "a.mp4", "없는 파일": "b.mp4"}), encoding="utf-8")
    return tmp_path


def test_previews_list_only_existing_files_with_valid_ticket(clips):
    listing = videos.get_previews("A123456")
    assert list(listing) == ["앱"]
    preview_id = listing["앱"].split("/")[-1].split("?")[0]
    ticket = listing["앱"].split("?t=")[1]
    assert videos.verify_ticket(preview_id, ticket) == "A123456"
    with pytest.raises(HTTPException):
        videos.verify_ticket("other-clip", ticket)


def test_clips_stay_out_of_story_list(clips, monkeypatch):
    monkeypatch.setattr(videos, "VIDEO_DIR", clips.parent)
    assert all(item["file"] != "a.mp4" for item in videos.list_videos())
