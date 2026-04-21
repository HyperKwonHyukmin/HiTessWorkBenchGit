"""
[TEMP] HiTessBeam 임시 라우터
향후 HiTess Model Builder 통합 시 제거 예정.
제거 방법:
  1. 이 파일 삭제
  2. InHouseProgram/HiTessBeam/ModuleUnit_HiTESS.exe 삭제
  3. main.py의 hitessbeam import/include_router 두 줄 제거
"""
import os
import pickle
import subprocess
import traceback
from datetime import datetime
from typing import List

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

router = APIRouter(prefix="/hitessbeam", tags=["hitessbeam-temp"])

_ROUTER_DIR = os.path.dirname(os.path.abspath(__file__))          # app/routers
_BACKEND_DIR = os.path.dirname(os.path.dirname(_ROUTER_DIR))      # HiTessWorkBenchBackEnd
_EXE_PATH = os.path.abspath(
    os.path.join(_BACKEND_DIR, "InHouseProgram", "HiTessBeam", "CsvToBdf_HiTESS.exe")
)


@router.post("/csvToBdf")
async def csv_to_bdf(
    userID: str = Form(...),
    file: List[UploadFile] = File(...),
):
    """
    CSV → BDF 변환 엔드포인트.
    multipart/form-data로 file(여러 파일)와 userID를 받습니다.
    input.pkl 파일이 반드시 포함되어야 합니다.
    """
    employee_id = userID.strip()
    files = file
    if not employee_id:
        raise HTTPException(status_code=400, detail="employee_id is required")

    # ── 작업 폴더 생성 ──────────────────────────────────────────
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    work_dir = os.path.abspath(
        os.path.join(_BACKEND_DIR, "userConnection", f"{timestamp}_{employee_id}_CsvToBdf")
    )
    os.makedirs(work_dir, exist_ok=True)

    # ── 파일 저장 ────────────────────────────────────────────────
    saved_files = []
    pickle_path = None

    for f in files:
        filename = os.path.basename(f.filename or "")
        if not filename:
            continue
        save_path = os.path.join(work_dir, filename)
        try:
            with open(save_path, "wb") as buf:
                buf.write(await f.read())
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"파일 저장 오류: {str(e)}")
        saved_files.append(save_path)
        if filename.endswith(".pkl"):
            pickle_path = save_path

    if not pickle_path:
        raise HTTPException(status_code=400, detail="input.pkl 파일이 포함되어야 합니다.")

    # ── pickle로 역할(stru/pipe/equi) 파악 ──────────────────────
    try:
        with open(pickle_path, "rb") as pf:
            original_list = pickle.load(pf)  # ['stru.csv', 'None', 'equi.csv']
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"pickle 파일 읽기 실패: {str(e)}")

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
        subprocess.run(cmd_args, shell=False, check=False, timeout=600)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"exe 실행 오류: {str(e)}")

    # ── GRAV 카드 정리 ────────────────────────────────────────────
    _clean_grav_card(bdf_file)

    if not os.path.exists(bdf_file):
        raise HTTPException(status_code=500, detail="BDF 파일 생성에 실패했습니다.")

    return {
        "message": "서버에서 BDF 변환이 완료되었습니다.",
        "userFolder": os.path.basename(work_dir),
        "bdfFilename": bdf_filename,
    }


_USER_CONN_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))


@router.get("/csvToBdf/download/{user_folder}/{filename}")
def download_bdf(user_folder: str, filename: str):
    """
    BDF 파일 다운로드 엔드포인트.
    userConnection/{user_folder}/{filename} 경로의 파일을 반환합니다.
    """
    file_path = os.path.abspath(os.path.join(_USER_CONN_DIR, user_folder, filename))

    # 경로 탈출 방지 (userConnection/ 외부 접근 차단)
    if not file_path.startswith(_USER_CONN_DIR + os.sep):
        raise HTTPException(status_code=400, detail="잘못된 파일 경로입니다.")

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
        employee_id = userID.strip()
        if not employee_id:
            raise HTTPException(status_code=400, detail="userID is required")

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        user_folder = os.path.abspath(os.path.join(
            _BACKEND_DIR, "userConnection",
            f"{timestamp}_{employee_id}_ModuleUnit"
        ))
        os.makedirs(user_folder, exist_ok=True)
        input_bdf = os.path.join(user_folder, filename)
        output_bdf = os.path.join(user_folder, filename.replace(".bdf", "_r.bdf"))
        with open(input_bdf, "wb") as buf:
            buf.write(await file.read())

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
        proc = subprocess.run(cmd_args, shell=False, capture_output=True, text=True, timeout=600)
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
            return _write_error_fallback(user_folder, filename, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/moduleUnit/download/{user_folder}/{filename}")
def download_module_unit(user_folder: str, filename: str):
    """ModuleUnit 결과 파일 다운로드.
    경로 탈출 방지 로직은 csvToBdf/download와 동일합니다.
    """
    file_path = os.path.abspath(os.path.join(_USER_CONN_DIR, user_folder, filename))
    if not file_path.startswith(_USER_CONN_DIR + os.sep):
        raise HTTPException(status_code=400, detail="잘못된 파일 경로입니다.")
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
