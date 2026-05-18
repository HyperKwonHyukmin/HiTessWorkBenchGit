"""Simple Beam Assessment 해석 백그라운드 실행 로직."""
import os
import logging
from datetime import datetime

from .analysis_runner import (
    get_backend_dir,
    mark_complete,
    mark_running,
    record_analysis,
    run_engine,
    update_progress,
)

logger = logging.getLogger(__name__)


def task_execute_beam(job_id: str, input_json_path: str, work_dir: str, employee_id: str, timestamp: str, source: str):
  mark_running(job_id, "Initiating Beam Solver...", progress=10)

  status_msg = "Success"
  engine_output = ""

  base_filename = os.path.splitext(os.path.basename(input_json_path))[0]
  result_filename = f"{base_filename}_Result.json"
  result_json_path = os.path.join(work_dir, result_filename)

  default_exe = os.path.join(get_backend_dir(), "InHouseProgram", "SimpleBeamAssessment", "HiTESS.FemEngine.Adapter.exe")
  exe_path = os.getenv("BEAM_EXE_PATH", default_exe)

  try:
    update_progress(job_id, 40, "Executing Solver...")

    status_msg, engine_output = run_engine(
      [exe_path, input_json_path, work_dir], work_dir, timeout=600, engine_label="SimpleBeam",
    )

    if status_msg == "Success":
      if not os.path.exists(result_json_path):
        raise Exception(
          f"해석은 종료되었으나, 결과 파일({result_filename})이 생성되지 않았습니다. "
          f"C# 내부 에러를 확인하세요.\n로그: {engine_output}"
        )
      update_progress(job_id, 80, "Parsing Results...")
  except Exception as e:
    # 결과 파일 미존재 등을 일괄 처리.
    # subprocess 자체 오류는 run_engine 내부에서 (Failed, 메시지) 반환으로 처리됨.
    status_msg = "Failed"
    logger.error("SimpleBeam unexpected error: %s", str(e), exc_info=True)
    engine_output = "예기치 않은 오류가 발생했습니다. 관리자에게 문의하세요."

  update_progress(job_id, 95, "Saving to Database...")

  project_data, db_err = record_analysis(
    project_name=f"SimpleBeam_{timestamp}",
    program_name="Simple Beam Assessment",
    employee_id=employee_id,
    status=status_msg,
    input_info={"input_json": input_json_path},
    result_info={"result_json": result_json_path},
    source=source,
  )
  if db_err is not None:
    status_msg = "Failed"
    engine_output += f"\nDB 기록 오류: {db_err}"

  mark_complete(
    job_id, status_msg, engine_output, project_data,
    extra={"result_path": result_json_path if status_msg == "Success" else None},
  )
