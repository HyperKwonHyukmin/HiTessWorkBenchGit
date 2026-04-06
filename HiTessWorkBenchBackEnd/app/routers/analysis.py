"""해석 요청, 상태 조회, 이력 관리 API 라우터."""
import io
import os
import uuid
import urllib.parse
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form, Query
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from .. import models, database
from ..services.job_manager import job_status_store, analysis_executor
from ..services.truss_service import task_execute_truss
from ..services.assessment_service import task_execute_assessment, _json_to_xlsx_bytes
from ..services.beam_service import task_execute_beam

router = APIRouter(prefix="/api", tags=["analysis"])

# 파일 다운로드 허용 기준 경로: userConnection/ 디렉터리만 허용
_ROUTER_DIR = os.path.dirname(os.path.abspath(__file__))         # app/routers
_BACKEND_DIR = os.path.dirname(os.path.dirname(_ROUTER_DIR))     # HiTessWorkBenchBackEnd
_ALLOWED_DOWNLOAD_BASE = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))


# ==================== 이력 및 다운로드 ====================

@router.get("/analysis/history/{employee_id}")
def get_analysis_history(
    employee_id: str,
    skip: int = Query(0, ge=0, description="건너뛸 항목 수"),
    limit: int = Query(50, ge=1, le=200, description="반환할 최대 항목 수"),
    db: Session = Depends(database.get_db)
):
    """
    특정 사용자의 해석 이력을 최신순으로 조회합니다. 페이지네이션 지원.
    """
    total = db.query(models.Analysis).filter(models.Analysis.employee_id == employee_id).count()
    history = (
        db.query(models.Analysis)
        .filter(models.Analysis.employee_id == employee_id)
        .order_by(models.Analysis.created_at.desc())
        .offset(skip).limit(limit)
        .all()
    )
    return {"total": total, "skip": skip, "limit": limit, "items": history}


@router.get("/analysis/all")
def get_all_analysis_history(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(database.get_db)
):
    """
    관리자용 전체 해석 이력을 최신순으로 조회합니다. 페이지네이션 지원.
    """
    total = db.query(models.Analysis).count()
    items = (
        db.query(models.Analysis)
        .order_by(models.Analysis.created_at.desc())
        .offset(skip).limit(limit)
        .all()
    )
    return {"total": total, "skip": skip, "limit": limit, "items": items}


@router.get("/download")
def download_file(filepath: str):
    """
    지정된 경로의 파일을 다운로드합니다.
    보안: userConnection/ 디렉터리 내 파일만 허용합니다.
    """
    decoded_path = os.path.abspath(urllib.parse.unquote(filepath))
    if not decoded_path.startswith(_ALLOWED_DOWNLOAD_BASE):
        raise HTTPException(status_code=403, detail="접근 권한이 없는 경로입니다.")
    if not os.path.exists(decoded_path):
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    filename = os.path.basename(decoded_path)
    return FileResponse(path=decoded_path, filename=filename, media_type='application/octet-stream')


@router.get("/analysis/export-xlsx")
def export_assessment_xlsx(json_path: str):
    """
    TrussAssessment JSON 결과를 XLSX로 변환하여 반환합니다.
    openpyxl로 메모리(BytesIO)에서만 생성하므로 디스크에 저장되지 않아
    회사 DRM 소프트웨어의 자동 암호화를 피할 수 있습니다.
    """
    decoded_path = os.path.abspath(urllib.parse.unquote(json_path))
    if not decoded_path.startswith(_ALLOWED_DOWNLOAD_BASE):
        raise HTTPException(status_code=403, detail="접근 권한이 없는 경로입니다.")
    if not os.path.exists(decoded_path):
        raise HTTPException(status_code=404, detail="JSON 파일을 찾을 수 없습니다.")

    base_name = os.path.splitext(os.path.basename(decoded_path))[0]
    xlsx_filename = f"{base_name}_Results.xlsx"

    try:
        xlsx_bytes = _json_to_xlsx_bytes(decoded_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Excel 변환 실패: {str(e)}")

    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': f'attachment; filename="{xlsx_filename}"'}
    )


# ==================== 작업 상태 조회 ====================

@router.get("/analysis/status/{job_id}")
def get_job_status(job_id: str):
    """
    특정 Job ID의 현재 진행 상태를 반환합니다.
    """
    if job_id not in job_status_store:
        raise HTTPException(status_code=404, detail="Job not found")
    return job_status_store.get(job_id)


# ==================== Truss Model Builder ====================

@router.post("/analysis/truss/request")
async def request_truss_analysis(
        node_file: UploadFile = File(...),
        member_file: UploadFile = File(...),
        employee_id: str = Form(...),
        source: str = Form("Workbench")
):
    """
    Truss Model Builder 해석을 요청받아 파일을 저장하고 백그라운드 작업을 실행합니다.
    """
    base_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(os.path.dirname(base_dir))
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    # [변경 사항] 기존 사번_시간 포맷에서 시간_사번_모듈명 포맷으로 일관성 확보
    unique_folder = f"{timestamp}_{employee_id}_TrussModelBuilder"
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
    job_status_store.set(job_id, {"status": "Pending", "progress": 0, "message": "Waiting in Queue..."})

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
    """
    Truss Structural Assessment 해석을 요청받아 BDF 파일을 저장하고 백그라운드 작업을 실행합니다.
    """
    base_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(os.path.dirname(base_dir))
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    # [변경 사항] 일관성을 위해 Assessment 폴더명도 시간_사번_모듈명 구조로 통일
    unique_folder = f"{timestamp}_{employee_id}_TrussAssessment"
    work_dir = os.path.abspath(os.path.join(parent_dir, "userConnection", unique_folder))

    os.makedirs(work_dir, exist_ok=True)

    bdf_path = os.path.join(work_dir, bdf_file.filename)

    try:
        with open(bdf_path, "wb") as buffer:
            buffer.write(await bdf_file.read())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"File save error: {str(e)}")

    job_id = str(uuid.uuid4())
    job_status_store.set(job_id, {"status": "Pending", "progress": 0, "message": "Waiting in Queue..."})

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
    """
    Simple Beam Assessment 해석을 요청받아 JSON 파일을 저장하고 백그라운드 작업을 실행합니다.
    """
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
    job_status_store.set(job_id, {
        "status": "Pending",
        "progress": 0,
        "message": "Waiting in Queue..."
    })

    analysis_executor.submit(
        task_execute_beam, job_id, input_json_path, work_dir, employee_id, timestamp, source
    )

    return {"job_id": job_id}