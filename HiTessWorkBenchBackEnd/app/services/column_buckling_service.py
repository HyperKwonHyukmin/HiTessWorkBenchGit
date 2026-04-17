"""ColumnBucklingApp.exe를 JSON I/O 방식으로 호출하는 서비스."""
import json
import os
import logging
import subprocess
from datetime import datetime
from fastapi import HTTPException
from .. import models, database

logger = logging.getLogger(__name__)

_SERVICES_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_SERVICES_DIR)
_BACKEND_DIR = os.path.dirname(_APP_DIR)
_EXE_PATH = os.path.join(
    _BACKEND_DIR, "InHouseProgram", "ColumnBucklingApp", "ColumnBucklingApp.exe"
)
_EXE_DIR = os.path.dirname(_EXE_PATH)
_USER_CONNECTION_DIR = os.path.join(_BACKEND_DIR, "userConnection")

def run_column_buckling(
    member_name: str,
    length_mm: float,
    employee_id: str,
) -> dict:
    """
    기둥 좌굴 허용 사용하중을 계산합니다. 편심량은 EXE 내부에서 20mm 고정 적용.
    1) userConnection에 input.json 저장
    2) ColumnBucklingApp.exe {input_path} {output_path} 실행
    3) output.json 읽어 반환
    """
    if not os.path.exists(_EXE_PATH):
        logger.error("ColumnBucklingApp.exe not found at: %s", _EXE_PATH)
        raise HTTPException(
            status_code=503,
            detail="계산 엔진을 찾을 수 없습니다. 서버 관리자에게 문의하세요.",
        )

    # 1. userConnection 작업 폴더 생성
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    folder_name = f"{timestamp}_{employee_id}_ColumnBuckling"
    work_dir = os.path.join(_USER_CONNECTION_DIR, folder_name)
    os.makedirs(work_dir, exist_ok=True)

    # 2. input.json 작성
    input_data = {
        "memberName": member_name,
        "columnLengthMm": int(length_mm),
    }
    input_path = os.path.join(work_dir, "input.json")
    output_path = os.path.join(work_dir, "output.json")
    with open(input_path, "w", encoding="utf-8") as f:
        json.dump(input_data, f, ensure_ascii=False, indent=2)

    # 3. exe 실행 (cwd=exe 폴더 — PropertyRefer.txt 위치)
    cmd = [_EXE_PATH, input_path, output_path]
    logger.info("Running: %s", " ".join(cmd))
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="cp949",
            errors="replace",
            timeout=30,
            cwd=_EXE_DIR,
        )
        if proc.returncode != 0:
            logger.error("exe stderr: %s | stdout: %s", proc.stderr, proc.stdout)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="계산 시간이 초과되었습니다.")

    # 4. output.json 읽기
    if not os.path.exists(output_path):
        logger.error("output.json not found. exe stdout: %s, stderr: %s", proc.stdout, proc.stderr)
        raise HTTPException(status_code=500, detail="계산 결과 파일이 생성되지 않았습니다.")

    with open(output_path, "r", encoding="utf-8") as f:
        result = json.load(f)

    # 5. error 필드 확인
    err = result.get("error")
    if err is not None:
        msg = err.get("message", "계산 중 오류가 발생했습니다.") if isinstance(err, dict) else str(err)
        raise HTTPException(status_code=500, detail=msg)

    # 6. DB 저장
    db = database.SessionLocal()
    try:
        new_analysis = models.Analysis(
            project_name=f"ColumnBuckling_{timestamp}",
            program_name="Column Buckling Load Calculator",
            employee_id=employee_id,
            status="Success",
            input_info=input_data,
            result_info={
                "input_json": input_path,
                "output_json": output_path,
                "maxWorkingLoadTon": (result.get("result") or {}).get("maxWorkingLoadTon"),
            },
            source="Workbench",
        )
        db.add(new_analysis)
        db.commit()
    except Exception as db_e:
        logger.error("DB save error: %s", str(db_e))
    finally:
        db.close()

    return result
