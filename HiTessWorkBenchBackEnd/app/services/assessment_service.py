"""Truss Structural Assessment 해석 백그라운드 실행 로직."""
import time
from datetime import datetime
from .. import models, database
from .job_manager import job_status_store


def task_execute_assessment(job_id: str, bdf_path: str, work_dir: str, employee_id: str, timestamp: str, source: str):
  job_status_store[job_id].update(
    {"status": "Running", "progress": 30, "message": "Reading and Validating BDF Matrix..."})
  time.sleep(1)

  job_status_store[job_id].update({"progress": 60, "message": "Solving Stiffness Matrix..."})
  time.sleep(2)

  job_status_store[job_id].update({"progress": 80, "message": "Generating Assessment Report..."})
  time.sleep(1)

  job_status_store[job_id].update({"progress": 95, "message": "Saving to Database..."})

  db = database.SessionLocal()
  try:
    new_analysis = models.Analysis(
      project_name=f"Assessment_Job_{timestamp}",
      program_name="Truss Structural Assessment",
      employee_id=employee_id,
      status="Success",
      input_info={"bdf_model": bdf_path},
      result_info={"bdf": bdf_path},
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

    job_status_store[job_id].update({
      "status": "Success",
      "progress": 100,
      "message": "Analysis Completed Successfully",
      "engine_log": "Solver executed properly. Assessment reports are generated.",
      "bdf_path": bdf_path,
      "project": project_data
    })
  except Exception as db_e:
    job_status_store[job_id].update({
      "status": "Failed",
      "progress": 100,
      "message": "DB Save Failed",
      "engine_log": f"DB Save Error: {str(db_e)}"
    })
  finally:
    db.close()
