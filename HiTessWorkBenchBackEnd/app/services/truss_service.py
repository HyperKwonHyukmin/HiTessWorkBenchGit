"""Truss Model Builder 해석 백그라운드 실행 로직."""
import os
import subprocess
from datetime import datetime
from .. import models, database
from .job_manager import job_status_store


def task_execute_truss(job_id: str, node_path: str, member_path: str, work_dir: str, exe_path: str, exe_dir: str,
                       employee_id: str, timestamp: str, source: str):
  job_status_store[job_id].update({"status": "Running", "progress": 10, "message": "Initiating Truss Solver..."})

  input_data = {"node_csv": node_path, "member_csv": member_path}
  result_data = {}
  status_msg = "Success"
  engine_output = ""
  final_bdf_path = None
  project_data = None

  db = database.SessionLocal()

  try:
    if not os.path.exists(exe_path):
      status_msg = "Failed"
      engine_output = f"Executable not found: {exe_path}"
    else:
      job_status_store[job_id].update({"progress": 40, "message": "Solving Linear Equations..."})
      cmd_args = [exe_path, exe_dir, node_path, member_path]

      try:
        result = subprocess.run(cmd_args, capture_output=True, text=True, check=True)
        engine_output = result.stdout

        job_status_store[job_id].update({"progress": 80, "message": "Extracting Results & Writing BDF..."})

        # [핵심 수정 구간]
        # 1. 레퍼런스(Material_Property_Info) 파일 제외
        # 2. 파일 수정 시간(mtime) 기준 내림차순 정렬하여 가장 마지막에 생성된 결과 BDF를 명시적으로 타겟팅
        bdf_files = [f for f in os.listdir(work_dir) if f.endswith('.bdf') and "Material" not in f]

        if bdf_files:
          # 시간 기준 최신 정렬
          bdf_files.sort(key=lambda x: os.path.getmtime(os.path.join(work_dir, x)), reverse=True)
          final_bdf_path = os.path.join(work_dir, bdf_files[0])
          result_data = {"bdf": final_bdf_path}
        else:
          status_msg = "Failed"
          engine_output += "\n[Error] Engine execution finished, but no .bdf file was created."

      except subprocess.CalledProcessError as e:
        status_msg = "Failed"
        engine_output = e.stderr if e.stderr else e.stdout
      except Exception as e:
        status_msg = "Failed"
        engine_output = f"System Error: {str(e)}"

    job_status_store[job_id].update({"progress": 95, "message": "Saving to Database..."})

    try:
      new_analysis = models.Analysis(
        project_name=f"Truss_Job_{timestamp}",
        program_name="TrussModelBuilder",
        employee_id=employee_id,
        status=status_msg,
        input_info=input_data,
        result_info=result_data if status_msg == "Success" else None,
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

    job_status_store[job_id].update({
      "status": status_msg,
      "progress": 100,
      "message": "Analysis Completed Successfully" if status_msg == "Success" else "Analysis Failed",
      "engine_log": engine_output,
      "bdf_path": final_bdf_path,
      "project": project_data
    })

  finally:
    db.close()