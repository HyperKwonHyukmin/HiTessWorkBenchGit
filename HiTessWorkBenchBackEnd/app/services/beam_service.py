"""Simple Beam Assessment 해석 백그라운드 실행 로직."""
import os
import subprocess
from datetime import datetime
from .. import models, database
from .job_manager import job_status_store


def task_execute_beam(job_id: str, input_json_path: str, work_dir: str, employee_id: str, timestamp: str, source: str):
  job_status_store[job_id].update({
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

  exe_path = r"C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\SimpleBeamAssessment\HiTESS.FemEngine.Adapter.exe"

  try:
    job_status_store[job_id].update({"progress": 40, "message": "Executing Solver..."})

    cmd_args = [exe_path, input_json_path, work_dir]

    result = subprocess.run(
      cmd_args,
      cwd=work_dir,
      capture_output=True,
      text=True,
      check=True
    )
    engine_output = result.stdout

    if not os.path.exists(result_json_path):
      raise Exception(f"해석은 종료되었으나, 결과 파일({result_filename})이 생성되지 않았습니다. C# 내부 에러를 확인하세요.\n로그: {engine_output}")

    job_status_store[job_id].update({"progress": 80, "message": "Parsing Results..."})

  except subprocess.CalledProcessError as e:
    status_msg = "Failed"
    engine_output = e.stderr if e.stderr else e.stdout
  except Exception as e:
    status_msg = "Failed"
    engine_output = f"System Error: {str(e)}"

  job_status_store[job_id].update({"progress": 95, "message": "Saving to Database..."})
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

  job_status_store[job_id].update({
    "status": status_msg,
    "progress": 100,
    "message": "Analysis Completed Successfully" if status_msg == "Success" else "Analysis Failed",
    "engine_log": engine_output,
    "result_path": result_json_path if status_msg == "Success" else None,
    "project": project_data
  })
