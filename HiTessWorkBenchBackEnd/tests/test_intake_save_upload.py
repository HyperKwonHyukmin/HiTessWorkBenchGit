"""save_upload(dest_name=...) — 표준 파일명 강제 저장 동작 검증."""
import asyncio
import io
import os
import pytest
from fastapi import UploadFile
from fastapi import HTTPException

from app.routers._intake import USER_CONNECTION_DIR, _infer_work_folder_metadata, save_upload


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
    with open(saved, "rb") as f:
        assert f.read() == b"a,b,c\n"


def test_save_upload_strips_path_components_from_dest_name(tmp_path):
    """dest_name 에 경로 구분자가 포함돼도 work_dir 바깥으로 빠지지 않아야 한다."""
    upload = _make_upload("Vessel_X.csv", b"x,y,z\n")
    saved = asyncio.run(save_upload(upload, str(tmp_path), dest_name="../escape.csv"))
    # basename 적용으로 work_dir 안 'escape.csv' 로 저장되어야 한다
    assert os.path.basename(saved) == "escape.csv"
    assert os.path.exists(saved)
    # 부모 디렉터리로 탈출하지 않았는지 확인
    parent = os.path.dirname(str(tmp_path))
    assert not os.path.exists(os.path.join(parent, "escape.csv"))


def test_save_upload_rejects_disallowed_extension_when_policy_given(tmp_path):
    """선택 정책을 지정한 신규 호출부에서만 확장자 제한이 적용되어야 한다."""
    upload = _make_upload("bad.exe", b"data")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(save_upload(upload, str(tmp_path), allowed_extensions={".csv"}))
    assert exc.value.status_code == 400


def test_save_upload_rejects_large_file_when_policy_given(tmp_path):
    """선택 정책을 지정한 신규 호출부에서만 크기 제한이 적용되어야 한다."""
    upload = _make_upload("ok.csv", b"123456")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(save_upload(upload, str(tmp_path), max_bytes=3))
    assert exc.value.status_code == 413


def test_infer_work_folder_metadata_from_nested_output_path():
    """Studio 하위 산출 폴더 경로에서도 최상위 작업 폴더의 사번/프로그램명을 추론한다."""
    nested = os.path.join(
        USER_CONNECTION_DIR,
        "20260615_101112_A123456_HiTessModelBuilder",
        "20260615_101215",
        "edited",
    )
    employee_id, program_name = _infer_work_folder_metadata(nested)
    assert employee_id == "A123456"
    assert program_name == "HiTessModelBuilder"
