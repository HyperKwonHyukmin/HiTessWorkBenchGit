"""PostDavitCalculation CLI를 호출하는 서비스."""
import os
import json
import logging
import subprocess
from datetime import datetime
from fastapi import HTTPException
from .. import models, database

logger = logging.getLogger(__name__)

_SERVICES_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_SERVICES_DIR)
_BACKEND_DIR = os.path.dirname(_APP_DIR)
_EXE_PATH = os.path.join(_BACKEND_DIR, "InHouseProgram", "PostDavitCalculation", "PostDavitCalculation.exe")
_USER_CONNECTION_DIR = os.path.join(_BACKEND_DIR, "userConnection")


def _make_work_dir(employee_id: str, program_name: str) -> tuple[str, str]:
    """userConnection/{timestamp}_{employee_id}_{ProgramName}/ 폴더 생성. (work_dir, timestamp) 반환"""
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    folder_name = f"{timestamp}_{employee_id}_{program_name}"
    work_dir = os.path.abspath(os.path.join(_USER_CONNECTION_DIR, folder_name))
    os.makedirs(work_dir, exist_ok=True)
    return work_dir, timestamp


def run_mast_post(height_mm: float, weight_kg: float, employee_id: str) -> dict:
    """
    Mast/Post 구조 설계 계산 후 DB에 이력을 저장합니다.
    CLI: PostDavitCalculation.exe mast-post <work_dir> <height_mm> <weight_kg>
    CLI가 work_dir/result.json 을 생성합니다.
    """
    if not os.path.exists(_EXE_PATH):
        logger.error("PostDavitCalculation.exe not found at: %s", _EXE_PATH)
        raise HTTPException(
            status_code=503,
            detail="계산 엔진을 찾을 수 없습니다. 서버 관리자에게 문의하세요."
        )

    work_dir, timestamp = _make_work_dir(employee_id, "PostDavitCalculation")
    output_json_path = os.path.join(work_dir, "result.json")

    cmd = [_EXE_PATH, "mast-post", work_dir, str(int(height_mm)), str(weight_kg)]
    logger.info("Running: %s", " ".join(cmd))

    status_msg = "Success"
    result_data = {}

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

        if proc.returncode != 0:
            logger.error("CLI stderr: %s | stdout: %s", proc.stderr, proc.stdout)
            status_msg = "Failed"
        elif not os.path.exists(output_json_path):
            logger.error("result.json not found in: %s", work_dir)
            status_msg = "Failed"
        else:
            with open(output_json_path, "r", encoding="utf-8") as f:
                result_data = json.load(f)

    except subprocess.TimeoutExpired:
        status_msg = "Failed"
        logger.error("PostDavitCalculation timed out")

    # ── DB 저장 ──────────────────────────────────────────────
    db = database.SessionLocal()
    try:
        new_analysis = models.Analysis(
            project_name=f"MastPost_{timestamp}",
            program_name="Mast Post Assessment",
            employee_id=employee_id,
            status=status_msg,
            input_info={"height_mm": height_mm, "weight_kg": weight_kg},
            result_info={"result_json": output_json_path} if status_msg == "Success" else None,
            source="Workbench"
        )
        db.add(new_analysis)
        db.commit()
    except Exception as db_e:
        logger.error("DB save error: %s", str(db_e))
    finally:
        db.close()

    if status_msg == "Failed":
        raise HTTPException(status_code=500, detail="계산 중 오류가 발생했습니다.")

    return result_data


def _run_jib_rest(cmd_name: str, inputs: dict, employee_id: str, program_name: str) -> dict:
    """Jib Rest 1단/2단 공통 실행 로직."""
    if not os.path.exists(_EXE_PATH):
        logger.error("PostDavitCalculation.exe not found at: %s", _EXE_PATH)
        raise HTTPException(
            status_code=503,
            detail="계산 엔진을 찾을 수 없습니다. 서버 관리자에게 문의하세요."
        )

    work_dir, timestamp = _make_work_dir(employee_id, "JibRestCalculation")
    input_json_path = os.path.join(work_dir, "input.json")
    output_json_path = os.path.join(work_dir, "result.json")

    with open(input_json_path, "w", encoding="utf-8") as f:
        json.dump(inputs, f)

    cmd = [_EXE_PATH, cmd_name, work_dir, input_json_path]
    logger.info("Running: %s", " ".join(cmd))

    status_msg = "Success"
    result_data = {}

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

        if proc.returncode != 0:
            logger.error("CLI stderr: %s | stdout: %s", proc.stderr, proc.stdout)
            status_msg = "Failed"
        elif not os.path.exists(output_json_path):
            logger.error("result.json not found in: %s", work_dir)
            status_msg = "Failed"
        else:
            with open(output_json_path, "r", encoding="utf-8") as f:
                result_data = json.load(f)

    except subprocess.TimeoutExpired:
        status_msg = "Failed"
        logger.error("PostDavitCalculation timed out")

    db = database.SessionLocal()
    try:
        new_analysis = models.Analysis(
            project_name=f"{program_name}_{timestamp}",
            program_name=program_name,
            employee_id=employee_id,
            status=status_msg,
            input_info={"input_json": input_json_path},
            result_info={"result_json": output_json_path} if status_msg == "Success" else None,
            source="Workbench"
        )
        db.add(new_analysis)
        db.commit()
    except Exception as db_e:
        logger.error("DB save error: %s", str(db_e))
    finally:
        db.close()

    if status_msg == "Failed":
        raise HTTPException(status_code=500, detail="계산 중 오류가 발생했습니다.")

    return result_data


def run_jib_rest_1dan(inputs: dict, employee_id: str) -> dict:
    """Jib Rest 1단 구조 설계 계산."""
    return _run_jib_rest("jib-rest-1dan", inputs, employee_id, "Jib Rest Assessment (1단)")


def run_jib_rest_2dan(inputs: dict, employee_id: str) -> dict:
    """Jib Rest 2단 구조 설계 계산."""
    return _run_jib_rest("jib-rest-2dan", inputs, employee_id, "Jib Rest Assessment (2단)")
