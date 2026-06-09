"""Carling calculator EXE bridge."""
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
_USER_CONNECTION_DIR = os.path.join(_BACKEND_DIR, "userConnection")
_PROGRAM_DIR = os.path.join(_BACKEND_DIR, "InHouseProgram", "CarlingCalculator")
_EXE_PATH = os.path.join(_PROGRAM_DIR, "CarlingCalculator.exe")

_PROGRAM_NAMES = {
    "free": "Carling Free Calculator",
    "optimization": "Carling Design Optimization",
}

_YIELD_STRESS_BY_MATERIAL = {
    "Mild": 235.0,
    "HT32": 315.0,
    "HT36": 355.0,
}


def _material_from_inputs(inputs: dict, mode: str) -> str:
    if mode == "optimization":
        return (inputs.get("carling") or {}).get("material") or "Mild"
    return (inputs.get("hull") or {}).get("material") or "Mild"


def _assessment_from_checks(checks: dict) -> str:
    return "Total OK" if all(value == "OK" for value in checks.values()) else "Not OK"


def _apply_bending_allowable(result: dict, inputs: dict, mode: str) -> None:
    material = _material_from_inputs(inputs, mode)
    yield_stress = _YIELD_STRESS_BY_MATERIAL.get(material, _YIELD_STRESS_BY_MATERIAL["Mild"])
    bending_allowable = round(yield_stress * 0.6, 1)

    def update_block(block: dict) -> None:
        stress = block.get("stress") or block.get("intermediate")
        if not isinstance(stress, dict) or "sigma_B_allow_MPa" not in stress:
            return

        stress["sigma_B_allow_MPa"] = bending_allowable
        sigma_b_calc = stress.get("sigma_B_calc_MPa")
        checks = block.get("checks")
        if isinstance(checks, dict) and isinstance(sigma_b_calc, (int, float)):
            checks["bending"] = "OK" if sigma_b_calc <= bending_allowable else "Not OK"
            block["assessment"] = _assessment_from_checks(checks)

    result_block = result.get("result")
    if isinstance(result_block, dict):
        update_block(result_block)
        intermediate = result.get("intermediate")
        checks = result_block.get("checks")
        if isinstance(intermediate, dict) and "sigma_B_allow_MPa" in intermediate:
            intermediate["sigma_B_allow_MPa"] = bending_allowable
            sigma_b_calc = intermediate.get("sigma_B_calc_MPa")
            if isinstance(checks, dict) and isinstance(sigma_b_calc, (int, float)):
                checks["bending"] = "OK" if sigma_b_calc <= bending_allowable else "Not OK"
                result_block["assessment"] = _assessment_from_checks(checks)

    optimal = result.get("optimal")
    if isinstance(optimal, dict):
        update_block(optimal)

    for candidate in result.get("candidates") or []:
        if isinstance(candidate, dict):
            update_block(candidate)


def _make_work_dir(employee_id: str, mode: str) -> tuple[str, str]:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_employee_id = (employee_id or "unknown").replace(os.sep, "_")
    folder_name = f"{timestamp}_{safe_employee_id}_CarlingCalculator_{mode}"
    work_dir = os.path.abspath(os.path.join(_USER_CONNECTION_DIR, folder_name))
    os.makedirs(work_dir, exist_ok=True)
    return work_dir, timestamp


def run_carling(inputs: dict, employee_id: str, mode: str) -> dict:
    """Carling 계산을 수행하고 JSON 입출력 이력을 저장합니다."""
    if mode not in _PROGRAM_NAMES:
        raise HTTPException(status_code=400, detail="지원하지 않는 Carling 계산 모드입니다.")

    if not os.path.exists(_EXE_PATH):
        logger.error("CarlingCalculator.exe not found at: %s", _EXE_PATH)
        raise HTTPException(
            status_code=503,
            detail="Carling 계산 실행 파일을 찾을 수 없습니다. 서버 관리자에게 문의하세요.",
        )

    payload = {"mode": mode, **inputs}
    work_dir, timestamp = _make_work_dir(employee_id, mode)
    input_path = os.path.join(work_dir, "input.json")
    output_path = os.path.join(work_dir, "result.json")

    with open(input_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    cmd = [_EXE_PATH, input_path, "-o", output_path, "--pretty"]
    logger.info("Running: %s", " ".join(cmd))

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
            cwd=_PROGRAM_DIR,
        )
    except subprocess.TimeoutExpired as exc:
        logger.error("CarlingCalculator timed out")
        raise HTTPException(status_code=500, detail="계산 시간이 초과되었습니다.") from exc

    if proc.returncode != 0:
        logger.error("EXE stderr: %s | stdout: %s", proc.stderr, proc.stdout)
        detail = (proc.stderr or proc.stdout or "계산 중 오류가 발생했습니다.").strip()
        raise HTTPException(status_code=500, detail=detail)

    if not os.path.exists(output_path):
        logger.error("result.json not found. exe stdout: %s, stderr: %s", proc.stdout, proc.stderr)
        raise HTTPException(status_code=500, detail="계산 결과 파일이 생성되지 않았습니다.")

    with open(output_path, "r", encoding="utf-8") as f:
        result = json.load(f)

    _apply_bending_allowable(result, inputs, mode)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    result_summary = {
        "input_json": input_path,
        "output_json": output_path,
        "assessment": result.get("result", {}).get("assessment"),
        "optimal": result.get("optimal"),
        "candidate_count": len(result.get("candidates") or []),
    }

    db = database.SessionLocal()
    try:
        new_analysis = models.Analysis(
            project_name=f"Carling_{mode}_{timestamp}",
            program_name=_PROGRAM_NAMES[mode],
            employee_id=employee_id,
            status="Success",
            input_info=payload,
            result_info=result_summary,
            source="Workbench",
        )
        db.add(new_analysis)
        db.commit()
    except Exception as db_e:
        logger.error("DB save error: %s", str(db_e))
    finally:
        db.close()

    # 리포트가 이 계산 폴더 하위 Report/ 에 저장될 수 있도록 작업폴더 경로를 동봉
    result["_work_dir"] = work_dir
    return result
