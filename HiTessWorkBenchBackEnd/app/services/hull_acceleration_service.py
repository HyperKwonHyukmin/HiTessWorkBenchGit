"""선급 Rule 기반 선체 가속도 Calculation 서비스.

Trim & Stability Booklet PDF 에서 'Summary of Loading Conditions' 표를 추출하고
5개 선급 Rule 기반 X/Y/Z 선체 가속도 및 Envelope 를 계산한다.

출력 파일(work_dir):
  - SummaryLoadingConditions.json : 프론트 테이블 렌더용 구조화 JSON (headers + rows)
  - SummaryLoadingConditions.csv  : 원본 셀 CSV
  - SummaryLoadingConditions.txt  : 매칭 페이지 표 원문 텍스트
  - HullAccelerationResult.json   : 계산 결과(conditions/rules/envelope)
"""
import os
import sys
import logging

from .analysis_runner import (
    get_backend_dir,
    mark_complete,
    mark_running,
    record_analysis,
    run_engine,
    update_progress,
)

logger = logging.getLogger(__name__)

PROGRAM_NAME = "선급 Rule 기반 선체 가속도 Calculation"


def task_execute_hull_acceleration(
    job_id: str,
    pdf_path: str,
    work_dir: str,
    employee_id: str,
    timestamp: str,
    source: str,
    constants_path: str | None = None,
    condition_overrides_path: str | None = None,
):
    """PDF 에서 Summary 표를 추출하고 선급 Rule 기반 가속도를 계산한다."""
    mark_running(job_id, "PDF 분석 초기화 중...", progress=10)

    status_msg = "Success"
    engine_output = ""
    result_data = {}

    script_path = os.path.join(
        get_backend_dir(), "InHouseProgram", "TS", "ts_hull_acceleration.py"
    )
    json_path = os.path.join(work_dir, "SummaryLoadingConditions.json")
    csv_path = os.path.join(work_dir, "SummaryLoadingConditions.csv")
    txt_path = os.path.join(work_dir, "SummaryLoadingConditions.txt")
    result_json_path = os.path.join(work_dir, "HullAccelerationResult.json")

    try:
        if not os.path.exists(script_path):
            raise FileNotFoundError(f"실행 스크립트를 찾을 수 없습니다: {script_path}")

        cmd_args = [
            sys.executable, script_path, pdf_path,
            "--out", result_json_path,
            "--work-dir", work_dir,
        ]
        if constants_path:
            cmd_args.extend(["--constants", constants_path])
        if condition_overrides_path:
            cmd_args.extend(["--condition-overrides", condition_overrides_path])

        update_progress(job_id, 40, "Loading Conditions 추출 및 Rule 계산 중...")

        logger.info("[HullAccel] script: %s (exists=%s)", script_path, os.path.exists(script_path))
        logger.info("[HullAccel] pdf   : %s (exists=%s)", pdf_path, os.path.exists(pdf_path))
        logger.info("[HullAccel] cwd   : %s", work_dir)

        status_msg, engine_output = run_engine(
            cmd_args,
            work_dir=work_dir,
            timeout=300,
            engine_label="HullAcceleration",
        )

        if status_msg == "Success":
            update_progress(job_id, 80, "결과 파일 수집 중...")

            if os.path.exists(result_json_path):
                result_data["json_result"] = result_json_path
                result_data["json_loading_conditions"] = result_json_path
            else:
                status_msg = "Failed"
                engine_output += "\n[Error] 계산 결과 JSON 이 생성되지 않았습니다."

            if os.path.exists(csv_path):
                result_data["csv_loading_conditions"] = csv_path
            if os.path.exists(txt_path):
                result_data["txt_loading_conditions"] = txt_path
            particulars_image_path = os.path.join(work_dir, "ShipParticulars.png")
            if os.path.exists(particulars_image_path):
                result_data["ship_particulars_image"] = particulars_image_path
            result_data["pdf"] = pdf_path

            logger.info("[HullAccel] 수집된 결과 파일: %s", list(result_data.keys()))

    except Exception as e:
        status_msg = "Failed"
        logger.error("HullAcceleration 예기치 않은 오류: %s", str(e), exc_info=True)
        engine_output = f"예기치 않은 오류가 발생했습니다: {str(e)}"

    update_progress(job_id, 90, "데이터베이스 저장 중...")

    project_data, db_err = record_analysis(
        job_id=job_id,
        project_name=f"HullAcceleration_{timestamp}",
        program_name=PROGRAM_NAME,
        employee_id=employee_id,
        status=status_msg,
        input_info={
            "pdf_file": pdf_path,
            "constants": constants_path,
            "condition_overrides": condition_overrides_path,
        },
        result_info=result_data if status_msg == "Success" else None,
        source=source,
    )
    if db_err is not None:
        status_msg = "Failed"
        engine_output += f"\nDB Error: {db_err}"

    mark_complete(
        job_id, status_msg, engine_output, project_data,
        success_message="가속도 계산 완료",
        failure_message="가속도 계산 실패",
    )
