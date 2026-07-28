"""ModuleAnalysis posture stability evaluation service."""
from __future__ import annotations

import json
import logging
import os
import subprocess
from typing import Any, Dict

from .analysis_runner import (
    get_backend_dir,
    mark_complete,
    mark_running,
    record_analysis,
    update_progress,
)

logger = logging.getLogger(__name__)


def task_execute_module_stability(
    job_id: str,
    posture_json_path: str,
    employee_id: str,
    timestamp: str,
    source: str,
):
    """Run ModuleAnalysis.Cli.exe and store the generated stability report."""
    mark_running(job_id, "ModuleAnalysis 초기화 중...", progress=10)

    status_msg = "Success"
    engine_output = ""
    result_data: Dict[str, Any] = {}

    exe_path = os.path.join(
        get_backend_dir(),
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
        update_progress(job_id, 40, "CLI 실행 중...")
        logger.info("[ModuleStability] cmd: %s", " ".join(cmd_args))

        result = subprocess.run(
            cmd_args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=180,
        )
        from ._subproc_decode import safe_decode
        engine_output = safe_decode(result.stdout)
        stderr_text = safe_decode(result.stderr)
        if stderr_text.strip():
            engine_output += f"\n[stderr] {stderr_text.strip()}"

        # ── ModuleAnalysis.Cli exit code 계약: 0=성공 / 1=예외 / 2=인자·입력오류(실패) ──
        # ⚠️ 여기서 exit 2 는 "입력오류=실패"다(산출물 없음). 팀 관례의 "0/2=산출 OK" 는
        #    다른 엔진(Cmb.Cli, ModelBuilder)의 계약이며 이 CLI 에는 적용되지 않는다. 혼동 금지.
        if result.returncode == 2:
            raise RuntimeError("인자/입력 오류 (exit 2). _posture.json 절대경로를 확인하세요.")
        if result.returncode == 1:
            raise RuntimeError(f"실행 오류 (exit 1). stderr 참조.\n{stderr_text}")
        if result.returncode != 0:
            raise RuntimeError(f"ModuleAnalysis.Cli exit {result.returncode}")
        if not os.path.exists(stability_path):
            raise FileNotFoundError(f"결과 JSON 이 생성되지 않았습니다: {stability_path}")

        update_progress(job_id, 75, "결과 JSON 로드 중...")
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

    # 실패 원인(엔진 stdout/stderr)을 DB result_info 에 영속화한다(서버 재시작 후에도 추적 가능).
    if status_msg == "Failed":
        result_data["engineLog"] = engine_output[-8000:]

    update_progress(job_id, 95, "데이터베이스 저장 중...")

    project_data, db_err = record_analysis(
        job_id=job_id,
        project_name=f"ModuleStability_{timestamp}",
        program_name="ModuleStability",
        employee_id=employee_id,
        status=status_msg,
        input_info={"posture": posture_json_path},
        result_info=result_data if result_data else None,
        source=source,
    )
    if db_err is not None:
        status_msg = "Failed"
        engine_output += f"\nDB Error: {db_err}"

    mark_complete(
        job_id, status_msg, engine_output, project_data,
        success_message="자세안정성 해석 완료",
        failure_message="자세안정성 해석 실패",
    )


def task_optimize_module_hoist_positions(
    job_id: str,
    posture_json_path: str,
    employee_id: str,
    timestamp: str,
    source: str,
):
    """Run ModuleAnalysis.Cli.exe --optimize and store the hoist optimization report."""
    mark_running(job_id, "권상 위치 최적화 초기화 중...", progress=10)

    status_msg = "Success"
    engine_output = ""
    result_data: Dict[str, Any] = {}

    exe_path = os.path.join(
        get_backend_dir(),
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
            optimization_path = posture_abs[:-len("_posture.json")] + "_hoist_optimization.json"
        else:
            root, _ = os.path.splitext(posture_abs)
            optimization_path = f"{root}_hoist_optimization.json"

        cmd_args = [exe_path, "--optimize", posture_abs, optimization_path]
        update_progress(job_id, 40, "권상 위치 후보 평가 중...")
        logger.info("[ModuleHoistOptimize] cmd: %s", " ".join(cmd_args))

        result = subprocess.run(
            cmd_args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=300,
        )
        from ._subproc_decode import safe_decode
        engine_output = safe_decode(result.stdout)
        stderr_text = safe_decode(result.stderr)
        if stderr_text.strip():
            engine_output += f"\n[stderr] {stderr_text.strip()}"

        # ── ModuleAnalysis.Cli exit code 계약: 0=성공 / 1=예외 / 2=인자·입력오류(실패) ──
        # ⚠️ 여기서 exit 2 는 "입력오류=실패"다(산출물 없음). 팀 관례의 "0/2=산출 OK" 는
        #    다른 엔진(Cmb.Cli, ModelBuilder)의 계약이며 이 CLI 에는 적용되지 않는다. 혼동 금지.
        if result.returncode == 2:
            raise RuntimeError("인자/입력 오류 (exit 2). _posture.json 절대경로를 확인하세요.")
        if result.returncode == 1:
            raise RuntimeError(f"실행 오류 (exit 1). stderr 참조.\n{stderr_text}")
        if result.returncode != 0:
            raise RuntimeError(f"ModuleAnalysis.Cli exit {result.returncode}")
        if not os.path.exists(optimization_path):
            raise FileNotFoundError(f"결과 JSON 이 생성되지 않았습니다: {optimization_path}")

        update_progress(job_id, 75, "최적화 결과 JSON 로드 중...")
        with open(optimization_path, "r", encoding="utf-8") as f:
            optimization_report = json.load(f)

        result_data = {
            "posture": posture_abs,
            "optimizationPath": optimization_path,
            "optimizationReport": optimization_report,
        }
        schema = optimization_report.get("schema") or (optimization_report.get("meta") or {}).get("schema", "unknown")
        best = optimization_report.get("best") or optimization_report.get("Best") or {}
        best_score = best.get("score") if isinstance(best, dict) else None
        if best_score is None and isinstance(best, dict):
            best_score = best.get("Score")
        engine_output += f"\n[OK] 권상 위치 최적화 완료 - schema {schema}, best score {best_score}"

    except subprocess.TimeoutExpired:
        status_msg = "Failed"
        engine_output += "\n[Error] CLI 실행 시간이 초과되었습니다 (5분)."
    except Exception as e:
        status_msg = "Failed"
        logger.error("ModuleHoistOptimize 실행 오류: %s", str(e), exc_info=True)
        engine_output += f"\n[Error] {str(e)}"

    # 실패 원인(엔진 stdout/stderr)을 DB result_info 에 영속화한다(서버 재시작 후에도 추적 가능).
    if status_msg == "Failed":
        result_data["engineLog"] = engine_output[-8000:]

    update_progress(job_id, 95, "데이터베이스 저장 중...")

    project_data, db_err = record_analysis(
        job_id=job_id,
        project_name=f"ModuleHoistOptimize_{timestamp}",
        program_name="ModuleHoistOptimize",
        employee_id=employee_id,
        status=status_msg,
        input_info={"posture": posture_json_path},
        result_info=result_data if result_data else None,
        source=source,
    )
    if db_err is not None:
        status_msg = "Failed"
        engine_output += f"\nDB Error: {db_err}"

    mark_complete(
        job_id, status_msg, engine_output, project_data,
        success_message="권상 위치 최적화 완료",
        failure_message="권상 위치 최적화 실패",
    )
