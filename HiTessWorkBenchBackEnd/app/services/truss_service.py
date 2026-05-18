"""Truss Model Builder 해석 백그라운드 실행 로직."""
import os
import logging
from datetime import datetime

from .analysis_runner import (
    mark_complete,
    mark_running,
    record_analysis,
    run_engine,
    update_progress,
)

logger = logging.getLogger(__name__)


def task_execute_truss(job_id: str, node_path: str, member_path: str, work_dir: str, exe_path: str, exe_dir: str,
                       employee_id: str, timestamp: str, source: str):
  mark_running(job_id, "Initiating Truss Solver...", progress=10)

  input_data = {"node_csv": node_path, "member_csv": member_path}
  result_data = {}
  status_msg = "Success"
  engine_output = ""
  final_bdf_path = None

  if not os.path.exists(exe_path):
    # 기존 로직: exe 미존재 시 raise 하지 않고 status만 Failed로 표시 후 DB 기록 단계로 진행.
    status_msg = "Failed"
    engine_output = f"Executable not found: {exe_path}"
  else:
    update_progress(job_id, 40, "Solving Linear Equations...")

    try:
      # 기존 동작: subprocess.run cwd 미지정 (현재 프로세스 cwd 기준 실행).
      status_msg, engine_output = run_engine(
        [exe_path, exe_dir, node_path, member_path],
        work_dir=None,
        timeout=600,
        engine_label="TrussModelBuilder",
      )

      if status_msg == "Success":
        update_progress(job_id, 80, "Extracting Results & Writing BDF...")

        # 레퍼런스(Material_Property_Info) 파일 제외 + mtime 내림차순 정렬로 최신 결과 BDF 타겟팅
        bdf_files = [f for f in os.listdir(work_dir) if f.endswith('.bdf') and "Material" not in f]

        if bdf_files:
          bdf_files.sort(key=lambda x: os.path.getmtime(os.path.join(work_dir, x)), reverse=True)
          final_bdf_path = os.path.join(work_dir, bdf_files[0])
          result_data = {"bdf": final_bdf_path}
        else:
          status_msg = "Failed"
          engine_output += "\n[Error] Engine execution finished, but no .bdf file was created."
    except Exception as e:
      # 결과 BDF 스캔 중 예외 일괄 처리 (기존 generic Exception 핸들러와 동일)
      status_msg = "Failed"
      logger.error("TrussModelBuilder unexpected error: %s", str(e), exc_info=True)
      engine_output = "예기치 않은 오류가 발생했습니다. 관리자에게 문의하세요."

  update_progress(job_id, 95, "Saving to Database...")

  project_data, db_err = record_analysis(
    project_name=f"Truss Model Builder_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
    program_name="TrussModelBuilder",
    employee_id=employee_id,
    status=status_msg,
    input_info=input_data,
    result_info=result_data,
    source=source,
  )
  if db_err is not None:
    status_msg = "Failed"
    engine_output += f"\nDB 기록 오류: {db_err}"

  mark_complete(
    job_id, status_msg, engine_output, project_data,
    extra={"bdf_path": final_bdf_path},
  )
