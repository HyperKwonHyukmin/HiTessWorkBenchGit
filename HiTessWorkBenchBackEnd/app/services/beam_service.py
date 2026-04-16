"""Simple Beam Assessment 해석 백그라운드 실행 로직."""
import os
import logging
import subprocess
from datetime import datetime
from .. import models, database
from .job_manager import job_status_store

logger = logging.getLogger(__name__)


def task_execute_beam(job_id: str, input_json_path: str, work_dir: str, employee_id: str, timestamp: str, source: str):
  job_status_store.update_job(job_id, {
    "status": "Running",
    "progress": 10,
    "message": "Initiating Beam Solver..."
  })

  db = database.SessionLocal()
  status_msg = "Success"
  engine_output = ""

  base_filename = os.path.splitext(os.path.basename(input_json_path))[0]
  result_filename = f"{base_filename}_Result.json"
  result_json_path = os.path.join(work_dir, result_filename)

  base_dir = os.path.dirname(os.path.abspath(__file__))  # app/services
  app_dir = os.path.dirname(base_dir)                    # app
  backend_dir = os.path.dirname(app_dir)                 # HiTessWorkBenchBackEnd
  default_exe = os.path.join(backend_dir, "InHouseProgram", "SimpleBeamAssessment", "HiTESS.FemEngine.Adapter.exe")
  exe_path = os.getenv("BEAM_EXE_PATH", default_exe)

  try:
    job_status_store.update_job(job_id, {"progress": 40, "message": "Executing Solver..."})

    cmd_args = [exe_path, input_json_path, work_dir]

    result = subprocess.run(
      cmd_args,
      cwd=work_dir,
      capture_output=True,
      text=True,
      check=True,
      timeout=600
    )
    engine_output = result.stdout

    if not os.path.exists(result_json_path):
      raise Exception(f"해석은 종료되었으나, 결과 파일({result_filename})이 생성되지 않았습니다. C# 내부 에러를 확인하세요.\n로그: {engine_output}")

    job_status_store.update_job(job_id, {"progress": 80, "message": "Parsing Results..."})

  except subprocess.TimeoutExpired:
    status_msg = "Failed"
    logger.error("SimpleBeam subprocess timed out after 600s")
    engine_output = "해석 엔진이 제한 시간(600초)을 초과했습니다. 관리자에게 문의하세요."
  except subprocess.CalledProcessError as e:
    status_msg = "Failed"
    logger.error("SimpleBeam subprocess failed: %s", e.stderr or e.stdout)
    engine_output = "해석 엔진 실행 중 오류가 발생했습니다. 관리자에게 문의하세요."
  except Exception as e:
    status_msg = "Failed"
    logger.error("SimpleBeam unexpected error: %s", str(e), exc_info=True)
    engine_output = "예기치 않은 오류가 발생했습니다. 관리자에게 문의하세요."

  job_status_store.update_job(job_id, {"progress": 95, "message": "Saving to Database..."})
  project_data = None

  try:
    new_analysis = models.Analysis(
      project_name=f"SimpleBeam_{timestamp}",
      program_name="Simple Beam Assessment",
      employee_id=employee_id,
      status=status_msg,
      input_info={"input_json": input_json_path},
      result_info={"result_json": result_json_path} if status_msg == "Success" else None,
      source=source
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
      "created_at": new_analysis.created_at.isoformat() if new_analysis.created_at else datetime.now().isoformat()
    }
  except Exception as db_e:
    status_msg = "Failed"
    engine_output += f"\nDB 기록 오류: {str(db_e)}"
  finally:
    db.close()

  job_status_store.update_job(job_id, {
    "status": status_msg,
    "progress": 100,
    "message": "Analysis Completed Successfully" if status_msg == "Success" else "Analysis Failed",
    "engine_log": engine_output,
    "result_path": result_json_path if status_msg == "Success" else None,
    "project": project_data
  })
