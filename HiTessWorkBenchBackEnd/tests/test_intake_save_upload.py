"""save_upload(dest_name=...) — 표준 파일명 강제 저장 동작 검증."""
import asyncio
import io
import os
import pytest
from fastapi import UploadFile

from app.routers._intake import save_upload


def _make_upload(filename: str, content: bytes) -> UploadFile:
    return UploadFile(filename=filename, file=io.BytesIO(content))


def test_save_upload_uses_original_filename_when_dest_name_none(tmp_path):
    """기존 동작: dest_name 미지정 → 업로드된 파일명을 그대로 사용."""
    upload = _make_upload("Vessel_X.csv", b"hello,world\n")
    saved = asyncio.run(save_upload(upload, str(tmp_path)))
    assert os.path.basename(saved) == "Vessel_X.csv"
    assert os.path.exists(saved)
    with open(saved, "rb") as f:
        assert f.read() == b"hello,world\n"


def test_save_upload_forces_filename_when_dest_name_given(tmp_path):
    """신규 동작: dest_name 지정 → 그 이름으로 강제 저장."""
    upload = _make_upload("Vessel_X.csv", b"a,b,c\n")
    saved = asyncio.run(save_upload(upload, str(tmp_path), dest_name="MooringFittingData.csv"))
    assert os.path.basename(saved) == "MooringFittingData.csv"
    assert os.path.exists(saved)
    # 원본 파일명 파일은 존재하지 않아야 한다
    assert not os.path.exists(os.path.join(str(tmp_path), "Vessel_X.csv"))
