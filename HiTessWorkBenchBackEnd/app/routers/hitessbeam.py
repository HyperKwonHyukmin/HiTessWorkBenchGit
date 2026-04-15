"""
[TEMP] HiTessBeam 임시 라우터
향후 HiTess ModelFlow 통합 시 제거 예정.
제거 방법: 이 파일 삭제 + main.py의 import/include_router 한 줄 제거
"""
import os
import pickle
import subprocess
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
            detail=f"실행 파일을 찾을 수 없습니다: {_EXE_PATH}"
        )

    # ── BDF 출력 경로 결정 ────────────────────────────────────────
    csv_name = os.path.basename(role_files["stru"])
    bdf_filename = os.path.splitext(csv_name)[0] + ".bdf"
    bdf_file = os.path.join(work_dir, bdf_filename)

    stru = role_files["stru"]
    pipe = role_files["pipe"] or "None"
    equi = role_files["equi"] or "None"

    # ── exe 실행 ─────────────────────────────────────────────────
    cmd = f'"{_EXE_PATH}" "{stru}" "{pipe}" "{equi}" "{bdf_file}"'
    try:
        subprocess.Popen(cmd, shell=True).wait()
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
