"""
[TEMP] HiTessBeam 임시 라우터
향후 HiTESS Model Builder 통합 시 제거 예정.
제거 방법:
  1. 이 파일 삭제
  2. InHouseProgram/HiTessBeam/ModuleUnit_HiTESS.exe 삭제
  3. main.py의 hitessbeam import/include_router 두 줄 제거
"""
import os
import io
import pickle
import re
import subprocess
import traceback
import uuid
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .. import database
from ..dependencies import optional_auth
from ._access_control import assert_current_user_can_access_path

router = APIRouter(prefix="/hitessbeam", tags=["hitessbeam-temp"])

# ⚠️ 이 라우터만 require_auth 가 아니라 optional_auth 를 쓴다 — 의도적 예외다.
#
# 여기 붙는 클라이언트는 WorkBench 앱이 아니라 **사내에 이미 배포된 실행 파일**이다
# (HiTESS Beam 이 띄우는 ModuleUnitAnalysis.exe = MU_Client.py 빌드본, CSV→BDF 클라이언트).
# 사용자 PC 에 깔린 exe 라 Authorization 헤더를 붙이도록 고칠 수 없다. 2026-07-28 에
# 이 창구를 require_auth 로 닫았다가 배포본이 전부 `401 인증이 필요합니다.` 로 죽었다.
#
# 대신 '토큰이 오면 끝까지 검증한다' — 잘못된 토큰은 401, 신원과 다른 userID 는 403,
# 남의 작업 폴더 다운로드는 403. 익명 요청도 경로 탈출·pickle 실행·크기 제한 방어는
# 그대로 받는다. 보안 점검으로 이 파일을 다시 잠그기 전에
# tests/test_hitessbeam_legacy_client.py 를 먼저 읽을 것.

_ROUTER_DIR = os.path.dirname(os.path.abspath(__file__))          # app/routers
_BACKEND_DIR = os.path.dirname(os.path.dirname(_ROUTER_DIR))      # HiTessWorkBenchBackEnd
_EXE_PATH = os.path.abspath(
    os.path.join(_BACKEND_DIR, "InHouseProgram", "HiTessBeam", "CsvToBdf_HiTESS.exe")
)
_MAX_CSV_BYTES = 25 * 1024 * 1024
_MAX_BDF_BYTES = 100 * 1024 * 1024
_MAX_PICKLE_BYTES = 16 * 1024
_CSV_TO_BDF_MAX_FILES = 4


class _PrimitiveListUnpickler(pickle.Unpickler):
    """Unpickler that cannot import/call globals.

    The legacy client contract is retained, but only pickle's primitive
    list/string opcodes are accepted.  Any class/function reconstruction is
    rejected before execution.
    """

    def find_class(self, module, name):
        raise pickle.UnpicklingError("global objects are not allowed")


def _load_role_list(content: bytes) -> list[str]:
    if not content or len(content) > _MAX_PICKLE_BYTES:
        raise ValueError("input.pkl 크기가 허용 범위를 벗어났습니다.")
    stream = io.BytesIO(content)
    value = _PrimitiveListUnpickler(stream).load()
    if stream.read(1):
        raise ValueError("input.pkl 뒤에 불필요한 데이터가 있습니다.")
    if (
        not isinstance(value, list)
        or len(value) != 3
        or any(not isinstance(item, str) for item in value)
    ):
        raise ValueError("input.pkl은 파일명 문자열 3개의 목록이어야 합니다.")
    for item in value:
        if len(item) > 255 or (item.lower() != "none" and os.path.basename(item) != item):
            raise ValueError("input.pkl에는 경로가 아닌 파일명만 사용할 수 있습니다.")
    return value


async def _read_limited(upload: UploadFile, max_bytes: int) -> bytes:
    content = await upload.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"{upload.filename or '업로드 파일'} 크기가 너무 큽니다.")
    return content


# 익명(레거시) 요청의 userID 는 작업 폴더 이름에 그대로 들어간다. 경로 구분자·상위 참조가
# 섞이면 userConnection 밖으로 나갈 수 있으므로 형식을 좁힌다. '_' 는 제외 — 폴더명에서
# 소유자 사번을 되읽는 _access_control.WORK_FOLDER_RE 가 '_' 를 구분자로 쓴다.
_LEGACY_EMPLOYEE_ID_RE = re.compile(r"^[A-Za-z0-9.-]{1,32}$")


def _resolve_employee_id(user_id: str, current_user: str | None) -> str:
    """폼 userID 와 (있다면) 인증 신원을 대조해 작업 폴더에 쓸 사번을 정한다.

    토큰이 있으면 신원이 우선이고 다른 사번을 주장하면 거부한다. 로그인이 사번을
    대문자로 정규화하므로 비교는 대소문자를 무시한다(소문자 사번으로 실행해도 통과).

    토큰이 없으면 레거시 클라이언트다. 인증 이전과 같이 userID 를 그대로 쓰되,
    폴더명으로 안전한 형태만 통과시키고 나머지는 'undefined' 로 떨어뜨린다
    (예전 클라이언트가 보내던 'false'/'null' 문자열 처리와 같은 취급).
    """
    employee_id = (user_id or "").strip()

    if current_user is not None:
        if employee_id.casefold() != current_user.strip().casefold():
            raise HTTPException(status_code=403, detail="userID가 인증 사용자와 일치하지 않습니다.")
        return current_user

    if not employee_id:
        raise HTTPException(status_code=400, detail="userID is required")
    if employee_id.lower() in ("false", "null", "none"):
        return "undefined"
    if not _LEGACY_EMPLOYEE_ID_RE.fullmatch(employee_id):
        return "undefined"
    return employee_id


def _write_bytes(file_path: str, content: bytes) -> None:
    with open(file_path, "wb") as output:
        output.write(content)


@router.post("/csvToBdf")
async def csv_to_bdf(
    userID: str = Form(...),
    file: List[UploadFile] = File(...),
    current_user: str | None = Depends(optional_auth),
):
    """
    CSV → BDF 변환 엔드포인트.
    multipart/form-data로 file(여러 파일)와 userID를 받습니다.
    input.pkl 파일이 반드시 포함되어야 합니다.
    """
    employee_id = _resolve_employee_id(userID, current_user)
    files = file
    if len(files) > _CSV_TO_BDF_MAX_FILES:
        raise HTTPException(status_code=400, detail="input.pkl과 CSV 파일은 최대 4개까지 업로드할 수 있습니다.")

    # Validate and bound every upload before creating a persistent work folder.
    uploads: list[tuple[str, bytes]] = []
    seen_names: set[str] = set()
    pickle_content = None
    for upload in files:
        filename = os.path.basename(upload.filename or "")
        if not filename or filename != (upload.filename or ""):
            raise HTTPException(status_code=400, detail="유효하지 않은 업로드 파일명입니다.")
        normalized_name = filename.casefold()
        if normalized_name in seen_names:
            raise HTTPException(status_code=400, detail=f"중복 파일명은 사용할 수 없습니다: {filename}")
        seen_names.add(normalized_name)
        extension = os.path.splitext(filename)[1].lower()
        if extension not in {".csv", ".pkl"}:
            raise HTTPException(status_code=400, detail="CSV와 input.pkl 파일만 업로드할 수 있습니다.")
        if extension == ".pkl" and filename.casefold() != "input.pkl":
            raise HTTPException(status_code=400, detail="pickle 매핑 파일명은 input.pkl이어야 합니다.")
        content = await _read_limited(
            upload,
            _MAX_PICKLE_BYTES if extension == ".pkl" else _MAX_CSV_BYTES,
        )
        if extension == ".pkl":
            if pickle_content is not None:
                raise HTTPException(status_code=400, detail="input.pkl은 하나만 업로드할 수 있습니다.")
            pickle_content = content
        uploads.append((filename, content))

    if pickle_content is None:
        raise HTTPException(status_code=400, detail="input.pkl 파일이 포함되어야 합니다.")
    try:
        original_list = _load_role_list(pickle_content)
    except (pickle.UnpicklingError, EOFError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=f"input.pkl 형식이 올바르지 않습니다: {exc}") from exc

    # ── 작업 폴더 생성 ──────────────────────────────────────────
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    work_dir = os.path.abspath(
        os.path.join(
            _BACKEND_DIR,
            "userConnection",
            f"{timestamp}_{employee_id}_CsvToBdf_{uuid.uuid4().hex[:8]}",
        )
    )
    await run_in_threadpool(os.makedirs, work_dir, exist_ok=True)

    # ── 파일 저장 ────────────────────────────────────────────────
    saved_files = []
    for filename, content in uploads:
        save_path = os.path.join(work_dir, filename)
        try:
            await run_in_threadpool(_write_bytes, save_path, content)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"파일 저장 오류: {str(e)}")
        saved_files.append(save_path)

    role_keys = ["stru", "pipe", "equi"]
    role_files = {k: None for k in role_keys}
    for i, key in enumerate(role_keys):
        if i < len(original_list) and original_list[i] and str(original_list[i]).lower() != "none":
            target_name = os.path.basename(original_list[i])
            matched = next((p for p in saved_files if os.path.basename(p) == target_name), None)
            if matched:
                role_files[key] = matched

    if not role_files["stru"]:
        raise HTTPException(status_code=400, detail="구조(stru) CSV 파일이 필요합니다.")

    # ── exe 존재 확인 ────────────────────────────────────────────
    if not os.path.exists(_EXE_PATH):
        raise HTTPException(
            status_code=500,
            detail="실행 파일을 찾을 수 없습니다. 서버 관리자에게 문의하세요."
        )

    # ── BDF 출력 경로 결정 ────────────────────────────────────────
    csv_name = os.path.basename(role_files["stru"])
    bdf_filename = os.path.splitext(csv_name)[0] + ".bdf"
    bdf_file = os.path.join(work_dir, bdf_filename)

    stru = role_files["stru"]
    pipe = role_files["pipe"] or "None"
    equi = role_files["equi"] or "None"

    # ── exe 실행 ─────────────────────────────────────────────────
    cmd_args = [_EXE_PATH, stru, pipe, equi, bdf_file]
    try:
        await run_in_threadpool(
            subprocess.run,
            cmd_args,
            shell=False,
            check=False,
            timeout=600,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"exe 실행 오류: {str(e)}")

    # ── GRAV 카드 정리 ────────────────────────────────────────────
    await run_in_threadpool(_clean_grav_card, bdf_file)

    if not os.path.exists(bdf_file):
        raise HTTPException(status_code=500, detail="BDF 파일 생성에 실패했습니다.")

    return {
        "message": "서버에서 BDF 변환이 완료되었습니다.",
        "userFolder": os.path.basename(work_dir),
        "bdfFilename": bdf_filename,
    }


_USER_CONN_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))


@router.get("/csvToBdf/download/{user_folder}/{filename}")
def download_bdf(
    user_folder: str,
    filename: str,
    db: Session = Depends(database.get_db),
    current_user: str | None = Depends(optional_auth),
):
    """
    BDF 파일 다운로드 엔드포인트.
    userConnection/{user_folder}/{filename} 경로의 파일을 반환합니다.
    """
    file_path = os.path.abspath(os.path.join(_USER_CONN_DIR, user_folder, filename))

    # 경로 탈출 방지 (userConnection/ 외부 접근 차단)
    if not file_path.startswith(_USER_CONN_DIR + os.sep):
        raise HTTPException(status_code=400, detail="잘못된 파일 경로입니다.")
    # 레거시 클라이언트(토큰 없음)는 업로드 응답으로 받은 자기 폴더명을 그대로 되돌려주는
    # 흐름이라 소유자 검사를 걸 신원 자체가 없다. 토큰을 보낸 요청에는 그대로 강제한다.
    if current_user is not None:
        assert_current_user_can_access_path(file_path, current_user, db, _USER_CONN_DIR)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")

    return FileResponse(
        path=file_path,
        filename=filename,
        media_type="application/octet-stream",
    )


# ══════════════════════════════════════════════════════════════════════════════
# [TEMP] moduleUnit 블록 시작
# 제거 시: 이 블록 전체 + InHouseProgram/HiTessBeam/ModuleUnit_HiTESS.exe 삭제
# ══════════════════════════════════════════════════════════════════════════════

_MODULE_UNIT_EXE = os.path.abspath(
    os.path.join(_BACKEND_DIR, "InHouseProgram", "HiTessBeam", "ModuleUnit_HiTESS.exe")
)


def _write_error_fallback(user_folder: str, filename: str, exc: Exception) -> dict:
    """오류 발생 시 더미 bdf/f06 + 에러 리포트 txt를 생성하고 200 응답 바디를 반환합니다.
    Flask 원본의 graceful 에러 반환 동작을 이식한 것입니다.
    """
    bdf_filename = filename.replace(".bdf", "_r.bdf")
    f06_filename = filename.replace(".bdf", "_r.f06")
    txt_filename = filename.replace(".bdf", "_r.txt")

    error_txt_path = os.path.join(user_folder, txt_filename)
    try:
        with open(error_txt_path, "w", encoding="utf-8") as err_f:
            err_f.write("======================================================\n")
            err_f.write("Module Unit 해석 준비 중 치명적 오류(FATAL) 발생\n")
            err_f.write("======================================================\n\n")
            err_f.write(f"오류 원인: {str(exc)}\n\n")
            err_f.write("상세 로그 (서버 에러 트레이스):\n")
            err_f.write(traceback.format_exc())
    except Exception:
        pass

    # 클라이언트 일괄 다운로드가 404로 깨지지 않도록 빈 더미 파일 생성
    for dummy_name in (bdf_filename, f06_filename):
        try:
            with open(os.path.join(user_folder, dummy_name), "w"):
                pass
        except Exception:
            pass

    return {
        "message": "서버 처리 중 오류가 발생하여 에러 로그를 반환합니다.",
        "userFolder": os.path.basename(user_folder),
        "bdf_filename": bdf_filename,
        "f06_filename": f06_filename,
        "txt_filename": txt_filename,
    }


@router.post("/moduleUnit")
async def module_unit(
    userID: str = Form(...),
    programName: str = Form(...),
    file: UploadFile = File(...),
    current_user: str | None = Depends(optional_auth),
):
    """
    ModuleUnit / GroupUnit BDF 해석 엔드포인트.
    multipart/form-data: file(.bdf), userID, programName("ModuleUnit"|"GroupUnit")
    """
    user_folder = None
    filename = None

    try:
        # ── 1. 파일 검증 ─────────────────────────────────────────────
        filename = os.path.basename(file.filename or "")
        if not filename or not filename.lower().endswith(".bdf"):
            raise HTTPException(status_code=400, detail="유효한 .bdf 파일이 필요합니다.")

        # ── 2. 작업 폴더 생성 + 파일 저장 ────────────────────────────
        employee_id = _resolve_employee_id(userID, current_user)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        user_folder = os.path.abspath(os.path.join(
            _BACKEND_DIR, "userConnection",
            f"{timestamp}_{employee_id}_ModuleUnit_{uuid.uuid4().hex[:8]}"
        ))
        await run_in_threadpool(os.makedirs, user_folder, exist_ok=True)
        input_bdf = os.path.join(user_folder, filename)
        output_bdf = os.path.join(user_folder, filename.replace(".bdf", "_r.bdf"))
        input_content = await _read_limited(file, _MAX_BDF_BYTES)
        await run_in_threadpool(_write_bytes, input_bdf, input_content)

        # ── 3. programName 검증 ───────────────────────────────────────
        prog = programName.strip()
        if prog not in ("ModuleUnit", "GroupUnit"):
            raise HTTPException(
                status_code=400,
                detail=f"알 수 없는 programName: '{prog}' (예상값: 'ModuleUnit' 또는 'GroupUnit')"
            )

        # ── 4. exe 존재 확인 ──────────────────────────────────────────
        if not os.path.exists(_MODULE_UNIT_EXE):
            raise RuntimeError(f"실행 파일을 찾을 수 없습니다: {_MODULE_UNIT_EXE}")

        # ── 5. subprocess 실행 (csvToBdf 패턴과 동일) ─────────────────
        cmd_args = [_MODULE_UNIT_EXE, input_bdf, output_bdf, prog]
        proc = await run_in_threadpool(
            subprocess.run,
            cmd_args,
            shell=False,
            capture_output=True,
            text=True,
            timeout=600,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f"ModuleUnit_HiTESS.exe 실패 (rc={proc.returncode}):\n{proc.stderr}"
            )

        # ── 6. 결과 파일 확인 ─────────────────────────────────────────
        if not os.path.exists(output_bdf) or os.path.getsize(output_bdf) == 0:
            raise RuntimeError("해석 결과 BDF 파일이 비어있습니다.")

        # ── 7. 성공 응답 ──────────────────────────────────────────────
        bdf_out = os.path.basename(output_bdf)
        return {
            "message": "서버에서 BDF 변환 및 해석이 완료되었습니다.",
            "userFolder": os.path.basename(user_folder),
            "bdf_filename": bdf_out,
            "f06_filename": bdf_out.replace(".bdf", ".f06"),
            "txt_filename": bdf_out.replace(".bdf", ".txt"),
        }

    except HTTPException:
        raise
    except Exception as e:
        if user_folder and filename:
            return await run_in_threadpool(_write_error_fallback, user_folder, filename, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/moduleUnit/download/{user_folder}/{filename}")
def download_module_unit(
    user_folder: str,
    filename: str,
    db: Session = Depends(database.get_db),
    current_user: str | None = Depends(optional_auth),
):
    """ModuleUnit 결과 파일 다운로드.
    경로 탈출 방지 로직은 csvToBdf/download와 동일합니다.
    """
    file_path = os.path.abspath(os.path.join(_USER_CONN_DIR, user_folder, filename))
    if not file_path.startswith(_USER_CONN_DIR + os.sep):
        raise HTTPException(status_code=400, detail="잘못된 파일 경로입니다.")
    # 레거시 클라이언트(토큰 없음)는 업로드 응답으로 받은 자기 폴더명을 그대로 되돌려주는
    # 흐름이라 소유자 검사를 걸 신원 자체가 없다. 토큰을 보낸 요청에는 그대로 강제한다.
    if current_user is not None:
        assert_current_user_can_access_path(file_path, current_user, db, _USER_CONN_DIR)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    return FileResponse(
        path=file_path,
        filename=filename,
        media_type="application/octet-stream",
    )


# ══════════════════════════════════════════════════════════════════════════════
# [TEMP] moduleUnit 블록 끝
# ══════════════════════════════════════════════════════════════════════════════


def _clean_grav_card(file_path: str) -> None:
    """BDF 내 GRAV* (Long Field) 카드를 단일 Small Field 포맷으로 교체합니다."""
    if not os.path.exists(file_path):
        return

    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    new_lines = []
    skip_next = False
    for line in lines:
        if skip_next:
            skip_next = False
            continue
        if line.strip().startswith("GRAV*"):
            new_lines.append("GRAV           2          9800.0     0.0     0.0    -1.2\n")
            skip_next = True  # 연속 줄(continuation) 제거
        else:
            new_lines.append(line)

    with open(file_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)
