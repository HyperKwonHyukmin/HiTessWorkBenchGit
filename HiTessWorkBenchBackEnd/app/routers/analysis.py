"""해석 요청, 상태 조회, 이력 관리 API 라우터."""
import io
import os
import shutil
import uuid
import urllib.parse
import zipfile
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy import func
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form, Query, Request
from pydantic import BaseModel
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
from ..services.hitess_modelflow_service import (
    task_execute_modelflow,
    task_execute_apply_edit,
    detect_edit_json,
    detect_edited_artifacts,
    scan_f06_diagnostics,
)
from ..services.f06parser_service import task_execute_f06parser

router = APIRouter(prefix="/api", tags=["analysis"])

# 파일 다운로드 허용 기준 경로: userConnection/ 디렉터리만 허용
_ROUTER_DIR = os.path.dirname(os.path.abspath(__file__))         # app/routers
_BACKEND_DIR = os.path.dirname(os.path.dirname(_ROUTER_DIR))     # HiTessWorkBenchBackEnd
_USER_CONNECTION_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))
_ALLOWED_DOWNLOAD_BASE = _USER_CONNECTION_DIR
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
    work_dir = os.path.abspath(os.path.join(_USER_CONNECTION_DIR, unique_folder))

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
    work_dir = os.path.abspath(os.path.join(_USER_CONNECTION_DIR, unique_folder))

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
        program_name: str = Form("BdfScanner"),
        current_user: str = Depends(require_auth)
):
    """
    BDF Scanner 작업을 요청받아 BDF 파일을 저장하고 백그라운드 작업을 실행합니다.
    use_nastran=True 이면 --nastran 옵션으로 Nastran 해석 후 F06 요약까지 수행합니다.
    program_name 으로 userConnection 하위 폴더 접미사를 지정합니다 (기본값: BdfScanner).
    """
    base_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(os.path.dirname(base_dir))
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    safe_name = "".join(c for c in program_name if c.isalnum() or c in "_-")[:40] or "BdfScanner"
    unique_folder = f"{timestamp}_{employee_id}_{safe_name}"
    work_dir = os.path.abspath(os.path.join(_USER_CONNECTION_DIR, unique_folder))
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
    work_dir = os.path.abspath(os.path.join(_USER_CONNECTION_DIR, unique_folder))
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
    work_dir = os.path.abspath(os.path.join(_USER_CONNECTION_DIR, unique_folder))

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


# ==================== HiTess Model Builder (Cmb.Cli build-full) ====================

@router.post("/analysis/modelflow/request")
async def request_modelflow_analysis(
    stru_file: UploadFile = File(...),
    pipe_file: Optional[UploadFile] = File(None),
    equip_file: Optional[UploadFile] = File(None),
    employee_id: str = Form(...),
    source: str = Form("Workbench"),
    current_user: str = Depends(require_auth),
    mesh_size: float = Form(500.0),
    ubolt_full_fix: bool = Form(False),
    run_nastran: bool = Form(False),
    nastran_path: Optional[str] = Form(None),
    leg_z_tol: Optional[float] = Form(None),
    mesh_size_structure: Optional[float] = Form(None),
    mesh_size_pipe: Optional[float] = Form(None),
):
    """Cmb.Cli build-full 한 번 호출로 phase JSON/BDF + InputAudit + StageSummary 생성.

    옵션은 README §5.1 매핑 그대로:
      mesh_size            → --mesh-size <MM>
      mesh_size_structure  → --mesh-size-structure <MM>
      mesh_size_pipe       → --mesh-size-pipe <MM>
      ubolt_full_fix       → --ubolt-full-fix
      run_nastran          → --run-nastran (+ --nastran-path / --leg-z-tol)
    """
    base_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(os.path.dirname(base_dir))
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    unique_folder = f"{timestamp}_{employee_id}_HiTessModelBuilder"
    work_dir = os.path.abspath(os.path.join(_USER_CONNECTION_DIR, unique_folder))
    os.makedirs(work_dir, exist_ok=True)

    stru_path = os.path.join(work_dir, os.path.basename(stru_file.filename))
    try:
        with open(stru_path, "wb") as f:
            f.write(await stru_file.read())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 저장 오류: {str(e)}")

    pipe_path = None
    if pipe_file and pipe_file.filename:
        pipe_path = os.path.join(work_dir, os.path.basename(pipe_file.filename))
        try:
            with open(pipe_path, "wb") as f:
                f.write(await pipe_file.read())
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"배관 파일 저장 오류: {str(e)}")

    equip_path = None
    if equip_file and equip_file.filename:
        equip_path = os.path.join(work_dir, os.path.basename(equip_file.filename))
        try:
            with open(equip_path, "wb") as f:
                f.write(await equip_file.read())
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"장비 파일 저장 오류: {str(e)}")

    exe_path = os.path.abspath(os.path.join(
        _BACKEND_DIR, "InHouseProgram", "HiTessModeBuilder", "Cmb.Cli.exe"
    ))

    job_id = str(uuid.uuid4())
    job_status_store.set(job_id, {"status": "Pending", "progress": 0, "message": "해석 대기 중..."})

    analysis_executor.submit(
        task_execute_modelflow,
        job_id, stru_path, pipe_path, equip_path, work_dir, exe_path,
        employee_id, timestamp, source,
        mesh_size, ubolt_full_fix, run_nastran, nastran_path, leg_z_tol,
        mesh_size_structure, mesh_size_pipe,
    )

    return {"job_id": job_id}


# ==================== apply-edit-intent (Studio 편집 결과 적용) ====================

class ApplyEditPayload(BaseModel):
    output_dir: str
    strict: bool = False
    run_nastran: bool = True            # Edit BDF 에 Nastran 자동 실행 (기본 ON)
    nastran_path: Optional[str] = None  # 미지정 시 _DEFAULT_NASTRAN_PATH 사용
    parse_f06: bool = True              # F06Parser 자동 실행


def _validate_userconnection_path(p: str) -> str:
    """userConnection/ 외부 경로 차단. 절대경로로 정규화 후 반환."""
    abs_p = os.path.abspath(p)
    if not abs_p.startswith(_ALLOWED_DOWNLOAD_BASE):
        raise HTTPException(status_code=400, detail="허용되지 않은 경로")
    return abs_p


@router.get("/analysis/modelflow/edit-status")
def get_edit_status(
    output_dir: str = Query(..., description="build-full timestamp 폴더의 절대경로"),
    current_user: str = Depends(require_auth),
):
    """폴더 안 *_edit.json 존재 여부 + edited/ 산출물 존재 여부를 한 번에 반환.

    프론트는 Studio 종료 후 이 엔드포인트를 호출해 자동 적용 트리거 여부를 결정.
    """
    abs_dir = _validate_userconnection_path(output_dir)
    if not os.path.isdir(abs_dir):
        raise HTTPException(status_code=404, detail="output_dir 없음")

    edit_json = detect_edit_json(abs_dir)
    edited = detect_edited_artifacts(abs_dir)
    edit_json_mtime = os.path.getmtime(edit_json) if edit_json else None
    edited_bdf_mtime = (
        os.path.getmtime(edited["edited_bdf_path"])
        if edited.get("edited_bdf_path") else None
    )
    # 편집본이 최신 _edit.json 보다 오래됐으면 재적용이 필요한 상태
    needs_apply = (
        edit_json_mtime is not None and (
            edited_bdf_mtime is None or edited_bdf_mtime < edit_json_mtime
        )
    )
    # Nastran F06 FATAL/ERROR 진단 (있으면 sample 텍스트도 포함)
    f06_diag = scan_f06_diagnostics(edited.get("edited_f06_path")) if edited.get("edited_f06_path") else {"available": False}

    return {
        "has_edit_json":   edit_json is not None,
        "edit_json_path":  edit_json,
        "edit_json_mtime": edit_json_mtime,
        "has_edited":      edited.get("edited_bdf_path") is not None,
        "edited_dir":      edited.get("edited_dir"),
        "edited_bdf_path": edited.get("edited_bdf_path"),
        "edited_json_path": edited.get("edited_json_path"),
        "apply_trace_path": edited.get("apply_trace_path"),
        "edited_bdf_mtime": edited_bdf_mtime,
        "needs_apply":     needs_apply,
        "edited_f06_path":          edited.get("edited_f06_path"),
        "f06_diagnostics":          f06_diag,
    }


@router.get("/analysis/modelflow/result-zip")
def get_result_zip(
    output_dir: str = Query(..., description="userConnection 하위 build-full timestamp 폴더의 절대경로"),
    current_user: str = Depends(require_auth),
):
    """output_dir 의 모든 파일을 zip 으로 묶어 스트리밍 반환.

    백엔드와 사용자 PC 가 다른 머신일 때, 사용자 PC 가 결과 폴더를 직접 fs 로 못 읽으므로
    이 엔드포인트로 zip 을 받아 사용자 PC 로컬에 풀어 Studio 의 initialFolder 로 사용한다.
    """
    abs_dir = _validate_userconnection_path(output_dir)
    if not os.path.isdir(abs_dir):
        raise HTTPException(status_code=404, detail="output_dir 없음")

    # BytesIO 메모리 zip — DRM 의 디스크 후킹 우회 (export-xlsx 와 동일 패턴)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(abs_dir):
            for f in files:
                full = os.path.join(root, f)
                arcname = os.path.relpath(full, abs_dir)
                zf.write(full, arcname)
    buf.seek(0)

    fname = f"result-{os.path.basename(abs_dir)}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=\"{fname}\""},
    )


@router.post("/analysis/modelflow/upload-edit")
def upload_edit_file(
    target_dir: str = Form(..., description="userConnection 하위 백엔드 output_dir 절대경로"),
    file: UploadFile = File(..., description="Studio 가 작성한 *_edit.json"),
    current_user: str = Depends(require_auth),
):
    """사용자 PC 로컬에서 Studio 가 작성한 *_edit.json 을 백엔드 output_dir 로 업로드.

    apply-edit-intent 는 백엔드 로컬 파일을 읽으므로, Studio 가 사용자 PC 의 로컬 추출
    폴더에 *_edit.json 을 쓴 경우 이 엔드포인트로 백엔드에 먼저 올려야 적용 가능하다.
    """
    abs_dir = _validate_userconnection_path(target_dir)
    if not os.path.isdir(abs_dir):
        raise HTTPException(status_code=404, detail="target_dir 없음")

    fname = os.path.basename(file.filename or "")
    if not fname.endswith("_edit.json"):
        raise HTTPException(status_code=400, detail="파일명이 _edit.json 으로 끝나야 합니다.")
    # 추가 보안: 경로 구분자 차단
    if "/" in fname or "\\" in fname:
        raise HTTPException(status_code=400, detail="파일명에 경로 구분자 불가")

    dest = os.path.join(abs_dir, fname)
    with open(dest, "wb") as out:
        shutil.copyfileobj(file.file, out)

    return {"saved": dest, "size": os.path.getsize(dest)}


@router.post("/analysis/modelflow/apply-edit")
def request_apply_edit(
    payload: ApplyEditPayload,
    current_user: str = Depends(require_auth),
):
    """Studio 가 작성한 *_edit.json 을 base 모델에 적용하여 edited/ 폴더 생성."""
    abs_dir = _validate_userconnection_path(payload.output_dir)
    if not os.path.isdir(abs_dir):
        raise HTTPException(status_code=404, detail="output_dir 없음")

    if detect_edit_json(abs_dir) is None:
        raise HTTPException(status_code=404, detail="*_edit.json 을 찾을 수 없음")

    exe_path = os.path.abspath(os.path.join(
        _BACKEND_DIR, "InHouseProgram", "HiTessModeBuilder", "Cmb.Cli.exe"
    ))
    job_id = str(uuid.uuid4())
    job_status_store.set(job_id, {"status": "Pending", "progress": 0, "message": "편집 적용 대기 중..."})

    analysis_executor.submit(
        task_execute_apply_edit,
        job_id, abs_dir, exe_path, payload.strict,
        payload.run_nastran, payload.nastran_path, payload.parse_f06,
    )
    return {"job_id": job_id}


# ==================== Group Module Unit ====================

_GROUPMODULE_EXE = os.path.abspath(os.path.join(
    _BACKEND_DIR, "InHouseProgram", "GroupModuleAnalysis", "ModuleGroupUnitAnalysis.exe"
))


class CogRequest(BaseModel):
    bdf_path: str


@router.post("/analysis/groupmodule/cog")
def compute_cog(
    payload: CogRequest,
    current_user: str = Depends(require_auth),
):
    """BDF 파일에서 무게중심(COG)과 총 질량을 계산합니다.
    ModuleGroupUnitAnalysis.exe cog <bdf_path> 를 동기 실행하여 stdout JSON을 반환합니다.
    """
    import subprocess, json as _json

    decoded = os.path.abspath(urllib.parse.unquote(payload.bdf_path))
    if not decoded.startswith(_ALLOWED_DOWNLOAD_BASE):
        raise HTTPException(status_code=403, detail="접근 권한이 없는 BDF 경로입니다.")
    if not os.path.isfile(decoded):
        raise HTTPException(status_code=404, detail="BDF 파일을 찾을 수 없습니다.")
    if not os.path.isfile(_GROUPMODULE_EXE):
        raise HTTPException(status_code=500, detail="ModuleGroupUnitAnalysis.exe를 찾을 수 없습니다.")

    try:
        proc = subprocess.run(
            [_GROUPMODULE_EXE, "cog", decoded],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=60,
        )
        stdout = proc.stdout.decode("utf-8", errors="replace").strip()
        cog_data = _json.loads(stdout)
        return cog_data
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="COG 계산 시간 초과 (60초)")
    except _json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"COG 결과 파싱 실패: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"COG 계산 실패: {str(e)}")