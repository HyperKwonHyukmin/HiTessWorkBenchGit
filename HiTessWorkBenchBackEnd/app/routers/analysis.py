"""해석 요청, 상태 조회, 이력 관리 API 라우터."""
import io
import os
import shutil
import uuid
import urllib.parse
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy import func
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from .. import models, database
from ..services.job_manager import job_status_store, analysis_executor
from ..dependencies import require_auth
from ..services.activity_service import log_activity
from ..services.truss_service import task_execute_truss
from ..services.assessment_service import task_execute_assessment, _json_to_xlsx_bytes
from ..services.beam_service import task_execute_beam
from ..services.bdfscanner_service import task_execute_bdfscanner
from ..services.hitess_modelflow_service import task_execute_modelflow
from ..services.f06parser_service import task_execute_f06parser

router = APIRouter(prefix="/api", tags=["analysis"])

# 파일 다운로드 허용 기준 경로: userConnection/ 디렉터리만 허용
_ROUTER_DIR = os.path.dirname(os.path.abspath(__file__))         # app/routers
_BACKEND_DIR = os.path.dirname(os.path.dirname(_ROUTER_DIR))     # HiTessWorkBenchBackEnd
_ALLOWED_DOWNLOAD_BASE = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))
_PROGRAM_DOWNLOAD_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "DownloadProgram"))


# ==================== 통계 ====================

@router.get("/analysis/stats/monthly")
def get_monthly_analysis_count(
    employee_id: str = Query(..., description="사번"),
    year: int = Query(None),
    month: int = Query(None),
    db: Session = Depends(database.get_db)
):
    """특정 사용자의 당월(또는 지정 연월) 해석 수행 건수를 반환합니다."""
    now = datetime.now()
    y = year or now.year
    m = month or now.month
    date_from = datetime(y, m, 1)
    if m == 12:
        date_to = datetime(y + 1, 1, 1)
    else:
        date_to = datetime(y, m + 1, 1)

    count = (
        db.query(func.count(models.Analysis.id))
        .filter(
            models.Analysis.employee_id == employee_id,
            models.Analysis.created_at >= date_from,
            models.Analysis.created_at < date_to,
        )
        .scalar()
    )
    return {"year": y, "month": m, "count": count}


@router.get("/analysis/stats/top-programs")
def get_top_programs(
    days: int = Query(30, ge=0, description="집계 기간(일). 0이면 전체 기간"),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(database.get_db)
):
    """프로그램별 사용 건수 집계 (대시보드 Top 5 / 전체 기간 순위 모달용)."""
    query = db.query(
        models.Analysis.program_name,
        func.count(models.Analysis.id).label("count")
    )
    if days > 0:
        since = datetime.now() - timedelta(days=days)
        query = query.filter(models.Analysis.created_at >= since)
    results = (
        query
        .group_by(models.Analysis.program_name)
        .order_by(func.count(models.Analysis.id).desc())
        .limit(limit)
        .all()
    )
    return [{"program_name": r.program_name, "count": r.count} for r in results]


# ==================== 이력 및 다운로드 ====================

def _files_available(record: models.Analysis) -> bool:
    """input_info 또는 result_info의 첫 번째 파일 경로 존재 여부로 파일 만료 판단."""
    for info in (record.input_info, record.result_info):
        if not isinstance(info, dict):
            continue
        for v in info.values():
            if isinstance(v, str) and v:
                path = os.path.abspath(urllib.parse.unquote(v))
                if path.startswith(_ALLOWED_DOWNLOAD_BASE):
                    return os.path.exists(path)
    return False


def _serialize_analysis(record: models.Analysis) -> dict:
    d = {c.name: getattr(record, c.name) for c in record.__table__.columns}
    d['files_available'] = _files_available(record)
    return d


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
    return {"total": total, "skip": skip, "limit": limit, "items": [_serialize_analysis(r) for r in history]}


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
    return {"total": total, "skip": skip, "limit": limit, "items": [_serialize_analysis(r) for r in items]}


@router.get("/download")
def download_file(filepath: str, req: Request, db: Session = Depends(database.get_db), employee_id: str = Depends(require_auth)):
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
    log_activity(
        db, "FILE_DOWNLOAD",
        employee_id=employee_id,
        action_detail={"filename": filename, "filepath": filepath},
        ip_address=req.client.host if req.client else None,
    )
    return FileResponse(path=decoded_path, filename=filename, media_type='application/octet-stream')


@router.get("/download/program/{filename}")
def download_program(filename: str, req: Request, db: Session = Depends(database.get_db), employee_id: str = Depends(require_auth)):
    """
    DownloadProgram/ 디렉터리의 배포용 프로그램 파일을 다운로드합니다.
    보안: DownloadProgram/ 디렉터리 내 파일만 허용하며 경로 탈출을 차단합니다.
    """
    safe_name = os.path.basename(filename)
    file_path = os.path.abspath(os.path.join(_PROGRAM_DOWNLOAD_DIR, safe_name))
    if not file_path.startswith(_PROGRAM_DOWNLOAD_DIR + os.sep) and file_path != _PROGRAM_DOWNLOAD_DIR:
        raise HTTPException(status_code=403, detail="접근 권한이 없는 경로입니다.")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다. 관리자에게 문의하세요.")
    log_activity(
        db, "PROGRAM_DOWNLOAD",
        employee_id=employee_id,
        action_detail={"filename": safe_name},
        ip_address=req.client.host if req.client else None,
    )
    return FileResponse(path=file_path, filename=safe_name, media_type='application/octet-stream')


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
        raise HTTPException(status_code=500, detail="Excel 변환 중 오류가 발생했습니다.")

    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': f'attachment; filename="{xlsx_filename}"'}
    )


# ==================== 단건 조회 ====================

@router.get("/analysis/{analysis_id}")
def get_analysis_by_id(analysis_id: int, db: Session = Depends(database.get_db)):
    """DB에 저장된 특정 해석 기록을 ID로 조회합니다."""
    record = db.query(models.Analysis).filter(models.Analysis.id == analysis_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Analysis record not found")
    return _serialize_analysis(record)


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
        source: str = Form("Workbench"),
        current_user: str = Depends(require_auth)
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

    node_path = os.path.join(work_dir, os.path.basename(node_file.filename))
    member_path = os.path.join(work_dir, os.path.basename(member_file.filename))

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
        source: str = Form("Workbench"),
        current_user: str = Depends(require_auth)
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

    bdf_path = os.path.join(work_dir, os.path.basename(bdf_file.filename))

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


# ==================== BDF Scanner ====================

@router.post("/analysis/bdfscanner/request")
async def request_bdfscanner(
        bdf_file: UploadFile = File(...),
        employee_id: str = Form(...),
        use_nastran: bool = Form(False),
        source: str = Form("Workbench"),
        current_user: str = Depends(require_auth)
):
    """
    BDF Scanner 작업을 요청받아 BDF 파일을 저장하고 백그라운드 작업을 실행합니다.
    use_nastran=True 이면 --nastran 옵션으로 Nastran 해석 후 F06 요약까지 수행합니다.
    """
    base_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(os.path.dirname(base_dir))
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    unique_folder = f"{timestamp}_{employee_id}_BdfScanner"
    work_dir = os.path.abspath(os.path.join(parent_dir, "userConnection", unique_folder))
    os.makedirs(work_dir, exist_ok=True)

    bdf_path = os.path.join(work_dir, os.path.basename(bdf_file.filename))
    try:
        with open(bdf_path, "wb") as buffer:
            buffer.write(await bdf_file.read())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 저장 오류: {str(e)}")

    job_id = str(uuid.uuid4())
    job_status_store.set(job_id, {"status": "Pending", "progress": 0, "message": "Waiting in Queue..."})

    analysis_executor.submit(
        task_execute_bdfscanner, job_id, bdf_path, work_dir, employee_id, timestamp, source, use_nastran
    )

    return {"job_id": job_id}


# ==================== F06 Parser ====================

@router.post("/analysis/f06parser/request")
async def request_f06parser(
        f06_file: UploadFile = File(...),
        employee_id: str = Form(...),
        source: str = Form("Workbench"),
        current_user: str = Depends(require_auth)
):
    """
    F06 Parser 작업을 요청받아 F06 파일을 저장하고 백그라운드 작업을 실행합니다.
    Displacement, SPC Force, CBAR/CBEAM/CROD Force/Stress를 추출합니다.
    """
    base_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(os.path.dirname(base_dir))
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    unique_folder = f"{timestamp}_{employee_id}_F06Parser"
    work_dir = os.path.abspath(os.path.join(parent_dir, "userConnection", unique_folder))
    os.makedirs(work_dir, exist_ok=True)

    f06_path = os.path.join(work_dir, os.path.basename(f06_file.filename))
    try:
        with open(f06_path, "wb") as buffer:
            buffer.write(await f06_file.read())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 저장 오류: {str(e)}")

    job_id = str(uuid.uuid4())
    job_status_store.set(job_id, {"status": "Pending", "progress": 0, "message": "Waiting in Queue..."})

    analysis_executor.submit(
        task_execute_f06parser, job_id, f06_path, work_dir, employee_id, timestamp, source
    )

    return {"job_id": job_id}


# ==================== Simple Beam Assessment ====================

@router.post("/analysis/beam/request")
async def request_beam_analysis(
        beam_file: UploadFile = File(...),
        employee_id: str = Form(...),
        source: str = Form("Workbench"),
        current_user: str = Depends(require_auth)
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

    input_json_path = os.path.join(work_dir, os.path.basename(beam_file.filename))
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


# ==================== HiTess Model Builder ====================

@router.post("/analysis/modelflow/request")
async def request_modelflow_analysis(
    stru_file: UploadFile = File(...),
    pipe_file: Optional[UploadFile] = File(None),
    equip_file: Optional[UploadFile] = File(None),
    employee_id: str = Form(...),
    source: str = Form("Workbench"),
    current_user: str = Depends(require_auth),
    stop_mode: str = Form("7"),         # 항상 --stage 3 (힐링 전체, BDF 생성)
    ubolt: bool = Form(False),          # U-bolt RBE2 강체 고정 여부
    mesh_size: float = Form(500.0),     # 목표 메시 크기 (mm)
    verbose: bool = Form(False),        # 요소별 세부 처리 로그 출력
    csvdebug: bool = Form(True),        # CSV 파싱 디버그 출력
    femodeldebug: bool = Form(True),    # 초기 FE 모델 디버그 출력
    pipelinedebug: bool = Form(True),   # 파이프라인 스테이지 배너 및 통계 출력
    spc_z_band: float = Form(-1.0),    # SPC Z-band 필터 (mm). -1이면 비활성
    debug_stages: bool = Form(False),  # 힐링 단계별 BDF 스냅샷
    stop_at: int = Form(0),            # 0=전체 실행, 1~5=지정 단계까지
):
    """
    HiTess Model Builder 파이프라인 전 과정 실행 (--stage 3).
    mesh_size → --mesh {mm} 로 전달.
    ubolt=True → U-bolt RBE2를 123456 DOF로 강제 고정 (--ubolt true)
    verbose/csvdebug/femodeldebug/pipelinedebug → 디버그 출력 제어
    """
    base_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(os.path.dirname(base_dir))
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    unique_folder = f"{timestamp}_{employee_id}_HiTessModelBuilder"
    work_dir = os.path.abspath(os.path.join(parent_dir, "userConnection", unique_folder))
    os.makedirs(work_dir, exist_ok=True)

    # 구조물 CSV (필수)
    stru_path = os.path.join(work_dir, os.path.basename(stru_file.filename))
    try:
        with open(stru_path, "wb") as f:
            f.write(await stru_file.read())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 저장 오류: {str(e)}")

    # 배관 CSV (선택)
    pipe_path = None
    if pipe_file and pipe_file.filename:
        pipe_path = os.path.join(work_dir, os.path.basename(pipe_file.filename))
        try:
            with open(pipe_path, "wb") as f:
                f.write(await pipe_file.read())
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"배관 파일 저장 오류: {str(e)}")

    # 장비 CSV (선택)
    equip_path = None
    if equip_file and equip_file.filename:
        equip_path = os.path.join(work_dir, os.path.basename(equip_file.filename))
        try:
            with open(equip_path, "wb") as f:
                f.write(await equip_file.read())
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"장비 파일 저장 오류: {str(e)}")

    # HiTessModelBuilder exe 경로
    _ROUTER_DIR_LOCAL = os.path.dirname(os.path.abspath(__file__))
    _BACKEND_DIR_LOCAL = os.path.dirname(os.path.dirname(_ROUTER_DIR_LOCAL))
    exe_dir  = os.path.abspath(os.path.join(_BACKEND_DIR_LOCAL, "InHouseProgram", "HiTessModeBuilder"))
    exe_path = os.path.join(exe_dir, "HiTessModelBuilder_26_01.exe")

    job_id = str(uuid.uuid4())
    job_status_store.set(job_id, {"status": "Pending", "progress": 0, "message": "해석 대기 중..."})

    analysis_executor.submit(
        task_execute_modelflow,
        job_id, stru_path, pipe_path, equip_path, work_dir, exe_path,
        employee_id, timestamp, source,
        stop_mode, ubolt, mesh_size, verbose, csvdebug, femodeldebug, pipelinedebug,
        spc_z_band, debug_stages, stop_at,
    )

    return {"job_id": job_id}


# ==================== HiTess Model Builder — Nastran 해석 (Stage 4) ====================

@router.post("/analysis/modelflow/nastran-request")
async def request_modelflow_nastran(
    bdf_path: str = Form(...),
    work_dir: str = Form(...),
    employee_id: str = Form(...),
    source: str = Form("Workbench"),
    current_user: str = Depends(require_auth),
):
    """
    Stage 3에서 생성된 STAGE_07 BDF에 BdfScanner --nastran을 실행합니다.
    보안: bdf_path 및 work_dir은 userConnection/ 하위만 허용합니다.
    """
    decoded_bdf = os.path.abspath(urllib.parse.unquote(bdf_path))
    decoded_work = os.path.abspath(urllib.parse.unquote(work_dir))
    if not decoded_bdf.startswith(_ALLOWED_DOWNLOAD_BASE):
        raise HTTPException(status_code=403, detail="접근 권한이 없는 BDF 경로입니다.")
    if not decoded_work.startswith(_ALLOWED_DOWNLOAD_BASE):
        raise HTTPException(status_code=403, detail="접근 권한이 없는 작업 디렉터리입니다.")
    if not os.path.exists(decoded_bdf):
        raise HTTPException(status_code=404, detail="BDF 파일을 찾을 수 없습니다.")

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    job_id = str(uuid.uuid4())
    job_status_store.set(job_id, {"status": "Pending", "progress": 0, "message": "Nastran 해석 대기 중..."})

    analysis_executor.submit(
        task_execute_bdfscanner,
        job_id, decoded_bdf, decoded_work, employee_id, timestamp, source, True,
    )

    return {"job_id": job_id}


@router.post("/analysis/modelflow/ubolt-retry")
async def request_ubolt_retry(
    stru_path: str = Form(...),
    pipe_path: Optional[str] = Form(None),
    equip_path: Optional[str] = Form(None),
    work_dir: str = Form(...),
    employee_id: str = Form(...),
    source: str = Form("Workbench"),
    current_user: str = Depends(require_auth),
):
    """
    U-bolt RBE2를 강체(123456 DOF)로 고정한 BDF를 재생성합니다.
    기존 작업 디렉터리 내 ubolt_rigid/ 서브폴더에 CSV를 복사하고
    HiTessModelBuilder.exe --ubolt를 실행합니다.
    보안: 모든 경로는 userConnection/ 하위만 허용합니다.
    """
    decoded_stru = os.path.abspath(urllib.parse.unquote(stru_path))
    decoded_work = os.path.abspath(urllib.parse.unquote(work_dir))

    for path in [decoded_stru, decoded_work]:
        if not path.startswith(_ALLOWED_DOWNLOAD_BASE):
            raise HTTPException(status_code=403, detail=f"접근 권한이 없는 경로입니다: {path}")
    if not os.path.exists(decoded_stru):
        raise HTTPException(status_code=404, detail="Structural CSV 파일을 찾을 수 없습니다.")

    # ubolt_rigid/ 서브폴더 생성 및 CSV 복사
    ubolt_dir = os.path.join(decoded_work, "ubolt_rigid")
    os.makedirs(ubolt_dir, exist_ok=True)

    new_stru = os.path.join(ubolt_dir, os.path.basename(decoded_stru))
    shutil.copy2(decoded_stru, new_stru)

    new_pipe = None
    if pipe_path:
        decoded_pipe = os.path.abspath(urllib.parse.unquote(pipe_path))
        if decoded_pipe.startswith(_ALLOWED_DOWNLOAD_BASE) and os.path.exists(decoded_pipe):
            new_pipe = os.path.join(ubolt_dir, os.path.basename(decoded_pipe))
            shutil.copy2(decoded_pipe, new_pipe)

    new_equip = None
    if equip_path:
        decoded_equip = os.path.abspath(urllib.parse.unquote(equip_path))
        if decoded_equip.startswith(_ALLOWED_DOWNLOAD_BASE) and os.path.exists(decoded_equip):
            new_equip = os.path.join(ubolt_dir, os.path.basename(decoded_equip))
            shutil.copy2(decoded_equip, new_equip)

    # HiTessModelBuilder exe 경로
    _ROUTER_DIR_LOCAL = os.path.dirname(os.path.abspath(__file__))
    _BACKEND_DIR_LOCAL = os.path.dirname(os.path.dirname(_ROUTER_DIR_LOCAL))
    exe_dir = os.path.abspath(os.path.join(_BACKEND_DIR_LOCAL, "InHouseProgram", "HiTessModeBuilder"))
    exe_path = os.path.join(exe_dir, "HiTessModelBuilder_26_01.exe")

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    job_id = str(uuid.uuid4())
    job_status_store.set(job_id, {"status": "Pending", "progress": 0, "message": "U-bolt Rigid 모드 재실행 대기 중..."})

    analysis_executor.submit(
        task_execute_modelflow,
        job_id, new_stru, new_pipe, new_equip, ubolt_dir, exe_path, employee_id, timestamp, source, "7", True,
    )

    return {"job_id": job_id}