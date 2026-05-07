"""ModuleAnalysis posture stability evaluation service."""
from __future__ import annotations

import json
import logging
import os
import subprocess
from datetime import datetime
from typing import Any, Dict

from .. import database, models
from ..services.job_manager import job_status_store

logger = logging.getLogger(__name__)


def task_execute_module_stability(
    job_id: str,
    posture_json_path: str,
    employee_id: str,
    timestamp: str,
    source: str,
):
    """Run ModuleAnalysis.Cli.exe and store the generated stability report."""
    job_status_store.update_job(job_id, {
        "status": "Running",
        "progress": 10,
        "message": "ModuleAnalysis 초기화 중...",
    })

    db = database.SessionLocal()
    status_msg = "Success"
    engine_output = ""
    result_data: Dict[str, Any] = {}
    project_data = None

    base_dir = os.path.dirname(os.path.abspath(__file__))      # app/services
    app_dir = os.path.dirname(base_dir)                        # app
    backend_dir = os.path.dirname(app_dir)                     # HiTessWorkBenchBackEnd
    exe_path = os.path.join(
        backend_dir,
        "InHouseProgram",
        "GroupModuleAnalysis",
        "ModuleAnalysis.Cli.exe",
    )

    try:
        posture_abs = os.path.abspath(posture_json_path)
        if not os.path.isabs(posture_json_path):
            raise ValueError(f"_posture.json 경로는 절대경로여야 합니다: {posture_json_path}")
        if not os.path.exists(exe_path):
            raise FileNotFoundError(f"CLI 실행 파일을 찾을 수 없습니다: {exe_path}")
        if not os.path.exists(posture_abs):
            raise FileNotFoundError(f"_posture.json 을 찾을 수 없습니다: {posture_abs}")

        if posture_abs.lower().endswith("_posture.json"):
            stability_path = posture_abs[:-len("_posture.json")] + "_stability.json"
        else:
            root, _ = os.path.splitext(posture_abs)
            stability_path = f"{root}_stability.json"

        cmd_args = [exe_path, posture_abs, stability_path]
        job_status_store.update_job(job_id, {"progress": 40, "message": "CLI 실행 중..."})
        logger.info("[ModuleStability] cmd: %s", " ".join(cmd_args))

        result = subprocess.run(
            cmd_args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=180,
        )
        engine_output = result.stdout.decode("utf-8", errors="replace")
        stderr_text = result.stderr.decode("utf-8", errors="replace")
        if stderr_text.strip():
            engine_output += f"\n[stderr] {stderr_text.strip()}"

        if result.returncode == 2:
            raise RuntimeError("인자/입력 오류 (exit 2). _posture.json 절대경로를 확인하세요.")
        if result.returncode == 1:
            raise RuntimeError(f"실행 오류 (exit 1). stderr 참조.\n{stderr_text}")
        if result.returncode != 0:
            raise RuntimeError(f"ModuleAnalysis.Cli exit {result.returncode}")
        if not os.path.exists(stability_path):
            raise FileNotFoundError(f"결과 JSON 이 생성되지 않았습니다: {stability_path}")

        job_status_store.update_job(job_id, {"progress": 75, "message": "결과 JSON 로드 중..."})
        with open(stability_path, "r", encoding="utf-8") as f:
            stability_report = json.load(f)

        result_data = {
            "posture": posture_abs,
            "stabilityPath": stability_path,
            "stabilityReport": stability_report,
        }
        schema = (stability_report.get("meta") or {}).get("schema", "unknown")
        engine_output += f"\n[OK] 자세안정성 해석 완료 - schema {schema}"

    except subprocess.TimeoutExpired:
        status_msg = "Failed"
        engine_output += "\n[Error] CLI 실행 시간이 초과되었습니다 (3분)."
    except Exception as e:
        status_msg = "Failed"
        logger.error("ModuleStability 실행 오류: %s", str(e), exc_info=True)
        engine_output += f"\n[Error] {str(e)}"

    job_status_store.update_job(job_id, {"progress": 95, "message": "데이터베이스 저장 중..."})

    try:
        new_analysis = models.Analysis(
            project_name=f"ModuleStability_{timestamp}",
            program_name="ModuleStability",
            employee_id=employee_id,
            status=status_msg,
            input_info={"posture": posture_json_path},
            result_info=result_data if result_data else None,
            source=source,
        )
        db.add(new_analysis)
        db.commit()
        db.refresh(new_analysis)
        project_data = {
            "id": new_analysis.id,
            "project_name": new_analysis.project_name,
            "program_name": new_analysis.program_name,
            "employee_id": new_analysis.employee_id,
            "status": new_analysis.status,
            "input_info": new_analysis.input_info,
            "result_info": new_analysis.result_info,
            "created_at": (
                new_analysis.created_at.isoformat()
                if new_analysis.created_at
                else datetime.now().isoformat()
            ),
        }
    except Exception as db_e:
        status_msg = "Failed"
        engine_output += f"\nDB Error: {str(db_e)}"
    finally:
        db.close()

    job_status_store.update_job(job_id, {
        "status": status_msg,
        "progress": 100,
        "message": "자세안정성 해석 완료" if status_msg == "Success" else "자세안정성 해석 실패",
        "engine_log": engine_output,
        "project": project_data,
    })
