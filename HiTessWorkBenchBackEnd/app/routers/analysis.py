"""해석 요청, 상태 조회, 이력 관리 API 라우터."""
import os
import uuid
import urllib.parse
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from .. import models, database
from ..services.job_manager import job_status_store, analysis_executor
from ..services.truss_service import task_execute_truss
from ..services.assessment_service import task_execute_assessment
from ..services.beam_service import task_execute_beam

router = APIRouter(prefix="/api", tags=["analysis"])


# ==================== 이력 및 다운로드 ====================

@router.get("/analysis/history/{employee_id}")
def get_analysis_history(employee_id: str, db: Session = Depends(database.get_db)):
  history = db.query(models.Analysis).filter(models.Analysis.employee_id == employee_id).order_by(
    models.Analysis.created_at.desc()).all()
  return history


@router.get("/analysis/all")
def get_all_analysis_history(db: Session = Depends(database.get_db)):
  """관리자용 전체 해석 이력 조회"""
  return db.query(models.Analysis).order_by(models.Analysis.created_at.desc()).all()


@router.get("/download")
def download_file(filepath: str):
  decoded_path = urllib.parse.unquote(filepath)
  if not os.path.exists(decoded_path):
    raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
  filename = os.path.basename(decoded_path)
  return FileResponse(path=decoded_path, filename=filename, media_type='application/octet-stream')


# ==================== 작업 상태 조회 ====================

@router.get("/analysis/status/{job_id}")
def get_job_status(job_id: str):
  if job_id not in job_status_store:
    raise HTTPException(status_code=404, detail="Job not found")
  return job_status_store[job_id]


# ==================== Truss Model Builder ====================

@router.post("/analysis/truss/request")
async def request_truss_analysis(
        node_file: UploadFile = File(...),
        member_file: UploadFile = File(...),
        employee_id: str = Form(...),
        source: str = Form("Workbench")
):
  base_dir = os.path.dirname(os.path.abspath(__file__))
  parent_dir = os.path.dirname(os.path.dirname(base_dir))
  timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
  unique_folder = f"{employee_id}_{timestamp}"
  work_dir = os.path.abspath(os.path.join(parent_dir, "userConnection", unique_folder))
  os.makedirs(work_dir, exist_ok=True)

  node_path = os.path.join(work_dir, node_file.filename)
  member_path = os.path.join(work_dir, member_file.filename)

  try:
    with open(node_path, "wb") as buffer:
      buffer.write(await node_file.read())
    with open(member_path, "wb") as buffer:
      buffer.write(await member_file.read())
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"File save error: {str(e)}")

  exe_dir = os.path.abspath(os.path.join(parent_dir, "InHouseProgram", "TrussModelBuilder"))
  exe_path = os.path.join(exe_dir, "TrussModelBuilder.exe")

  job_id = str(uuid.uuid4())
  job_status_store[job_id] = {"status": "Pending", "progress": 0, "message": "Waiting in Queue..."}

  analysis_executor.submit(
    task_execute_truss, job_id, node_path, member_path, work_dir, exe_path, exe_dir, employee_id, timestamp, source
  )

  return {"job_id": job_id}


# ==================== Truss Structural Assessment ====================

@router.post("/analysis/assessment/request")
async def request_truss_assessment(
        bdf_file: UploadFile = File(...),
        employee_id: str = Form(...),
        source: str = Form("Workbench")
):
  base_dir = os.path.dirname(os.path.abspath(__file__))
  parent_dir = os.path.dirname(os.path.dirname(base_dir))
  timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

  unique_folder = f"{employee_id}_assessment_{timestamp}"
  work_dir = os.path.abspath(os.path.join(parent_dir, "userConnection", unique_folder))

  os.makedirs(work_dir, exist_ok=True)

  bdf_path = os.path.join(work_dir, bdf_file.filename)

  try:
    with open(bdf_path, "wb") as buffer:
      buffer.write(await bdf_file.read())
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"File save error: {str(e)}")

  job_id = str(uuid.uuid4())
  job_status_store[job_id] = {"status": "Pending", "progress": 0, "message": "Waiting in Queue..."}

  analysis_executor.submit(
    task_execute_assessment, job_id, bdf_path, work_dir, employee_id, timestamp, source
  )

  return {"job_id": job_id}


# ==================== Simple Beam Assessment ====================

@router.post("/analysis/beam/request")
async def request_beam_analysis(
        beam_file: UploadFile = File(...),
        employee_id: str = Form(...),
        source: str = Form("Workbench")
):
  base_dir = os.path.dirname(os.path.abspath(__file__))
  parent_dir = os.path.dirname(os.path.dirname(base_dir))

  timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

  unique_folder = f"{timestamp}_{employee_id}_SimpleBeam"
  work_dir = os.path.abspath(os.path.join(parent_dir, "userConnection", unique_folder))

  os.makedirs(work_dir, exist_ok=True)

  input_json_path = os.path.join(work_dir, beam_file.filename)
  try:
    with open(input_json_path, "wb") as buffer:
      buffer.write(await beam_file.read())
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"File save error: {str(e)}")

  job_id = str(uuid.uuid4())
  job_status_store[job_id] = {
    "status": "Pending",
    "progress": 0,
    "message": "Waiting in Queue..."
  }

  analysis_executor.submit(
    task_execute_beam, job_id, input_json_path, work_dir, employee_id, timestamp, source
  )

  return {"job_id": job_id}
