"""D-Type Lug Calculation EXE bridge."""
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
_PROGRAM_DIR = os.path.join(
    _BACKEND_DIR, "InHouseProgram", "D_TypeLugCalculation"
)
_EXE_PATH = os.path.join(_PROGRAM_DIR, "D_TypeLugCalculation.exe")


def _make_work_dir(employee_id: str) -> tuple[str, str]:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_employee_id = (employee_id or "unknown").replace(os.sep, "_")
    folder_name = f"{timestamp}_{safe_employee_id}_DTypeLugCalculation"
    work_dir = os.path.abspath(os.path.join(_USER_CONNECTION_DIR, folder_name))
    os.makedirs(work_dir, exist_ok=True)
    return work_dir, timestamp


def run_d_type_lug(inputs: dict, employee_id: str) -> dict:
    """D-Type Lug 강도 계산을 수행하고 JSON 입출력 이력을 저장합니다."""
    if not os.path.exists(_EXE_PATH):
        logger.error("D_TypeLugCalculation.exe not found at: %s", _EXE_PATH)
        raise HTTPException(
            status_code=503,
            detail="D-Type Lug 계산 실행 파일을 찾을 수 없습니다. 서버 관리자에게 문의하세요.",
        )

    work_dir, timestamp = _make_work_dir(employee_id)
    input_path = os.path.join(work_dir, "input.json")
    output_path = os.path.join(work_dir, "result.json")

    with open(input_path, "w", encoding="utf-8") as f:
        json.dump(inputs, f, ensure_ascii=False, indent=2)

    cmd = [_EXE_PATH, input_path, "-o", output_path, "--pretty"]
    logger.info("Running: %s", " ".join(cmd))

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            cwd=_PROGRAM_DIR,
        )
    except subprocess.TimeoutExpired as exc:
        logger.error("D_TypeLugCalculation timed out")
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

    overall = {}
    try:
        overall = {
            name: (data.get("max_usage_factor") or {}).get("overall")
            for name, data in (result.get("results") or {}).items()
        }
    except AttributeError:
        overall = {}

    db = database.SessionLocal()
    try:
        new_analysis = models.Analysis(
            project_name=f"DTypeLug_{timestamp}",
            program_name="D Type Lug Assessment",
            employee_id=employee_id,
            status="Success",
            input_info=inputs,
            result_info={
                "input_json": input_path,
                "output_json": output_path,
                "max_usage_factor": overall,
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
