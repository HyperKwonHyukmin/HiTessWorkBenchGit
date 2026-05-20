"""HoleCalculation.exe를 JSON I/O 방식으로 호출하는 서비스.

Simplified Hole Fatigue Assessment — DNVGL-RP-C203 기준 welded pipe penetration
피로 평가. exe는 input.json을 받아 결과 JSON을 stdout 또는 -o 출력 파일로 반환.
"""
import json
import logging
import os
import subprocess
from datetime import datetime

from fastapi import HTTPException

from .. import database, models

logger = logging.getLogger(__name__)

_SERVICES_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_SERVICES_DIR)
_BACKEND_DIR = os.path.dirname(_APP_DIR)
_EXE_PATH = os.path.join(
    _BACKEND_DIR, "InHouseProgram", "HoleCalculation", "HoleCalculation.exe"
)
_EXE_DIR = os.path.dirname(_EXE_PATH)
_USER_CONNECTION_DIR = os.path.join(_BACKEND_DIR, "userConnection")


def run_hole_calculation(input_payload: dict, employee_id: str) -> dict:
    """
    Hole fatigue assessment 계산을 실행합니다.
    1) userConnection 작업 폴더 생성
    2) input.json 작성
    3) HoleCalculation.exe input.json -o output.json 실행
    4) output.json 읽어 반환
    5) DB Analysis 저장
    """
    if not os.path.exists(_EXE_PATH):
        logger.error("HoleCalculation.exe not found at: %s", _EXE_PATH)
        raise HTTPException(
            status_code=503,
            detail="계산 엔진을 찾을 수 없습니다. 서버 관리자에게 문의하세요.",
        )

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    folder_name = f"{timestamp}_{employee_id}_HoleCalculation"
    work_dir = os.path.join(_USER_CONNECTION_DIR, folder_name)
    os.makedirs(work_dir, exist_ok=True)

    input_path = os.path.join(work_dir, "input.json")
    output_path = os.path.join(work_dir, "output.json")
    with open(input_path, "w", encoding="utf-8") as f:
        json.dump(input_payload, f, ensure_ascii=False, indent=2)

    cmd = [_EXE_PATH, input_path, "-o", output_path]
    logger.info("Running: %s", " ".join(cmd))
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            cwd=_EXE_DIR,
        )
        if proc.returncode != 0:
            logger.error("exe stderr: %s | stdout: %s", proc.stderr, proc.stdout)
            raise HTTPException(
                status_code=500,
                detail=f"계산 실행 실패: {proc.stderr or proc.stdout or '알 수 없는 오류'}",
            )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="계산 시간이 초과되었습니다.")

    if not os.path.exists(output_path):
        logger.error(
            "output.json not found. exe stdout: %s, stderr: %s",
            proc.stdout,
            proc.stderr,
        )
        raise HTTPException(
            status_code=500, detail="계산 결과 파일이 생성되지 않았습니다."
        )

    with open(output_path, "r", encoding="utf-8") as f:
        result = json.load(f)

    err = result.get("error")
    if err is not None:
        msg = (
            err.get("message", "계산 중 오류가 발생했습니다.")
            if isinstance(err, dict)
            else str(err)
        )
        raise HTTPException(status_code=500, detail=msg)

    db = database.SessionLocal()
    try:
        transverse = (result.get("fatigue_cracking_transverse_to_weld_toe") or {})
        parallel = (result.get("fatigue_cracking_parallel_to_weld_toe") or {})
        root = result.get("fatigue_cracking_from_weld_root") or {}
        new_analysis = models.Analysis(
            project_name=f"HoleFatigue_{timestamp}",
            program_name="Simplified Hole Fatigue Assessment",
            employee_id=employee_id,
            status="Success",
            input_info=input_payload,
            result_info={
                "input_json": input_path,
                "output_json": output_path,
                "usage_factor_transverse": transverse.get("usage_factor"),
                "usage_factor_parallel": parallel.get("usage_factor"),
                "usage_factor_root": root.get("usage_factor") if root else None,
                "conclusion": result.get("conclusion"),
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
