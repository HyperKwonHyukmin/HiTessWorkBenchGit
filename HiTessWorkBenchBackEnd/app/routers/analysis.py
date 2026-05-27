"""해석 요청, 상태 조회, 이력 관리 API 라우터."""
import io
import logging
import os
import shutil
import uuid
import urllib.parse
import zipfile

logger = logging.getLogger(__name__)
from datetime import datetime, timedelta, date as _date
from typing import Optional
from sqlalchemy import func
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form, Query, Request
from pydantic import BaseModel
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy.orm import Session
from .. import models, database
from ..services.job_manager import job_status_store, analysis_executor
from ..dependencies import require_auth, require_admin
from ..services.activity_service import log_activity
from ..services.truss_service import task_execute_truss
from ..services.assessment_service import task_execute_assessment, _json_to_xlsx_bytes
from ..services.beam_service import task_execute_beam
from ..services.bdfscanner_service import task_execute_bdfscanner
from ..services.hpscr_service import task_execute_hpscr
from ..services.groupmoduleunit_service import task_execute_groupmoduleunit
from ..services.unit_structural_service import task_execute_unit_structural
from ..services.module_stability_service import task_execute_module_stability
from ..services.hitess_modelflow_service import (
    task_execute_modelflow,
    task_execute_apply_edit,
    detect_edit_json,
    detect_edited_artifacts,
    scan_f06_diagnostics,
)
from ..services.f06parser_service import task_execute_f06parser
from ..services.plate_structure_service import task_execute_plate_structure
from ..services.mooring_fitting_service import task_execute_mooring_fitting
from ._intake import make_work_dir, save_upload, submit_analysis_job

router = APIRouter(prefix="/api", tags=["analysis"])

# 파일 다운로드 허용 기준 경로: userConnection/ 디렉터리만 허용
_ROUTER_DIR = os.path.dirname(os.path.abspath(__file__))         # app/routers
_BACKEND_DIR = os.path.dirname(os.path.dirname(_ROUTER_DIR))     # HiTessWorkBenchBackEnd
_USER_CONNECTION_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))
_ALLOWED_DOWNLOAD_BASE = _USER_CONNECTION_DIR
_PROGRAM_DOWNLOAD_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "DownloadProgram"))

# 외부(네트워크/공유) 위치에 보관하는 배포용 프로그램 화이트리스트.
# DownloadProgram/ 폴더에 없고 외부 경로에서 받아와야 하는 파일들을 등록.
# 보안: 화이트리스트 외 파일명은 절대 외부 경로로 매핑되지 않음.
_EXTERNAL_PROGRAM_PATHS = {
    "HiTESSBEAM.zip": r"\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\[Hi-TESS]\6_DownloadProgram\HiTESSBEAM.zip",
}

# ──────────────────────────────────────────────────────────
# 샘플 실행(1-click 데모) 일일 카운터 — 사번별 1회/일.
# 관리자는 무제한. 자정에 자동 리셋(다음 날짜로 비교).
# 메모리 dict (서버 재시작 시 리셋). 단일 uvicorn 인스턴스 가정.
# ──────────────────────────────────────────────────────────
SAMPLE_DAILY_LIMIT = 1
SAMPLE_SOURCE_TAG = "WorkbenchSample"  # 일반 사용 기록과 구분하는 source 값
_SAMPLE_RUN_TRACKER: dict[tuple[str, str], _date] = {}


def _check_sample_quota(program_key: str, employee_id: str, db: Session) -> dict:
    """샘플 실행 한도 체크. 관리자는 무제한 통과.

    Returns: { allowed, remaining, is_admin, reason }
    """
    user = db.query(models.User).filter(models.User.employee_id == employee_id).first()
    is_admin = bool(user and user.is_admin)
    if is_admin:
        return {"allowed": True, "remaining": SAMPLE_DAILY_LIMIT, "is_admin": True, "reason": None}
    today = _date.today()
    last = _SAMPLE_RUN_TRACKER.get((program_key, employee_id))
    if last == today:
        return {
            "allowed": False, "remaining": 0, "is_admin": False,
            "reason": "샘플 실행은 일일 1회로 제한됩니다. 자정 이후 다시 시도해주세요.",
        }
    return {"allowed": True, "remaining": SAMPLE_DAILY_LIMIT, "is_admin": False, "reason": None}


def _consume_sample_quota(program_key: str, employee_id: str) -> None:
    """샘플 실행 카운트 소비 — 호출 시점을 오늘 날짜로 기록."""
    _SAMPLE_RUN_TRACKER[(program_key, employee_id)] = _date.today()


def _verify_employee_self(form_employee_id: str, current_user: str) -> None:
    """request 핸들러의 Form employee_id 가 인증 사용자(current_user) 와 일치하는지 검증.

    Form 으로 전달된 employee_id 는 클라이언트 임의값이므로 인증 토큰의 사번과
    반드시 대조해야 한다. 정상 클라이언트는 본인 사번을 보내므로 동작 영향 없음.
    """
    if form_employee_id != current_user:
        raise HTTPException(
            status_code=403,
            detail="employee_id 가 인증 사용자와 일치하지 않습니다.",
        )


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
    limit: int = Query(50, ge=1, le=100000, description="반환할 최대 항목 수"),
    db: Session = Depends(database.get_db)
):
    """
    특정 사용자의 해석 이력을 최신순으로 조회합니다. 페이지네이션 지원.
    """
    # 샘플 실행(WorkbenchSample)은 사용 기록에서 제외 — 신규 사용자 학습용
    base_q = db.query(models.Analysis).filter(
        models.Analysis.employee_id == employee_id,
        models.Analysis.source != SAMPLE_SOURCE_TAG,
    )
    total = base_q.count()
    history = (
        base_q
        .order_by(models.Analysis.created_at.desc())
        .offset(skip).limit(limit)
        .all()
    )
    return {"total": total, "skip": skip, "limit": limit, "items": [_serialize_analysis(r) for r in history]}


@router.get("/analysis/all")
def get_all_analysis_history(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100000),
    db: Session = Depends(database.get_db)
):
    """
    관리자용 전체 해석 이력을 최신순으로 조회합니다. 페이지네이션 지원.
    상한 le=100000 — 통계 대시보드가 전체 이력을 받아 집계하기 위함.
    """
    # 샘플 실행(WorkbenchSample)은 통계·전체 이력에서 제외
    base_q = db.query(models.Analysis).filter(models.Analysis.source != SAMPLE_SOURCE_TAG)
    total = base_q.count()
    items = (
        base_q
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
    배포용 프로그램 파일을 다운로드합니다.
    파일 위치 우선순위:
      1) _EXTERNAL_PROGRAM_PATHS 화이트리스트 (네트워크/공유 폴더 등 외부 경로)
      2) DownloadProgram/ 로컬 디렉터리 (path traversal 차단)
    """
    safe_name = os.path.basename(filename)

    # 1) 외부 화이트리스트 우선 매칭
    file_path = _EXTERNAL_PROGRAM_PATHS.get(safe_name)
    if not file_path:
        # 2) 로컬 DownloadProgram/ fallback
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
def export_assessment_xlsx(
    json_path: str,
    req: Request,
    db: Session = Depends(database.get_db),
    employee_id: str = Depends(require_auth),
):
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

    log_activity(
        db,
        "EXPORT_XLSX",
        employee_id=employee_id,
        action_detail={"filename": xlsx_filename, "json_path": json_path},
        ip_address=req.client.host if req.client else None,
    )

    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': f'attachment; filename="{xlsx_filename}"'}
    )


# ==================== Usage Report (Daily/Weekly/Monthly) ====================

from ..services import usage_report_service as _urs
from ..usage_report_schemas import UsageReportResponse
from datetime import date as _DateType


@router.get("/analysis/report", response_model=UsageReportResponse)
def get_usage_report(
    period: str = Query(..., description="daily | weekly | monthly"),
    date: Optional[_DateType] = Query(None, description="기간이 속하는 날짜 (YYYY-MM-DD)"),
    db: Session = Depends(database.get_db),
    _admin: str = Depends(require_admin),
):
    """관리자 전용 D/W/M 사용량 리포트."""
    try:
        bounds = _urs.resolve_period(period, date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    current = _urs.aggregate_period(db, period, bounds.start, bounds.end)
    previous = _urs.aggregate_period(db, period, bounds.prev_start, bounds.prev_end)
    deltas = _urs.compute_deltas(current, previous)

    return {
        "period": {
            "type": bounds.type,
            "start": bounds.start,
            "end": bounds.end,
            "label": bounds.label,
        },
        "previous": {
            "start": bounds.prev_start,
            "end": bounds.prev_end,
            "label": bounds.prev_label,
        },
        "summary": {k: current[k] for k in (
            "total", "activePrograms", "activeUsers", "activeDepartments",
            "avgPerDay", "maxDay", "busiestProgram", "peakHour", "newUsers",
        )},
        "deltas": deltas,
        "programs": current["programs"],
        "users": current["users"],
        "departments": current["departments"],
        "timeBuckets": current["timeBuckets"],
    }


@router.get("/analysis/report/export-xlsx")
def export_usage_report_xlsx(
    period: str = Query(...),
    date: Optional[_DateType] = Query(None),
    db: Session = Depends(database.get_db),
    _admin: str = Depends(require_admin),
):
    try:
        bounds = _urs.resolve_period(period, date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    current = _urs.aggregate_period(db, period, bounds.start, bounds.end)
    previous = _urs.aggregate_period(db, period, bounds.prev_start, bounds.prev_end)
    deltas = _urs.compute_deltas(current, previous)

    try:
        buf = _urs.build_report_xlsx(bounds, current, previous, deltas)
    except Exception as e:
        raise HTTPException(status_code=500, detail="Excel 생성 중 오류가 발생했습니다.") from e

    fname = (
        f"WorkBench_UsageReport_{period.capitalize()}_"
        f"{bounds.start.date().strftime('%Y%m%d')}_{bounds.end.date().strftime('%Y%m%d')}.xlsx"
    )
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ==================== DrawingToAnalysis — PDF 저장 테스트 ====================

@router.post("/analysis/drawing-to-analysis/upload")
async def drawing_to_analysis_upload(
    pdf_file: UploadFile = File(...),
    employee_id: str = Depends(require_auth),
):
    """DrawingToAnalysis (개발 중) — PDF 1개를 userConnection 폴더에 저장만 한다.

    변환 로직은 아직 없음. 업로드 동작 검증용 임시 엔드포인트.
    """
    fname = pdf_file.filename or ""
    if not fname.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF 파일만 업로드 가능합니다.")
    work_dir, timestamp = make_work_dir(employee_id, "DrawingToAnalysis")
    saved_path = await save_upload(pdf_file, work_dir, error_prefix="PDF 저장 오류")
    return {
        "ok": True,
        "filename": os.path.basename(saved_path),
        "saved_path": saved_path,
        "work_dir": work_dir,
        "timestamp": timestamp,
    }


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
    _verify_employee_self(employee_id, current_user)
    work_dir, timestamp = make_work_dir(employee_id, "TrussModelBuilder")
    node_path = await save_upload(node_file, work_dir)
    member_path = await save_upload(member_file, work_dir)

    exe_dir = os.path.abspath(os.path.join(_BACKEND_DIR, "InHouseProgram", "TrussModelBuilder"))
    exe_path = os.path.join(exe_dir, "TrussModelBuilder.exe")

    job_id = submit_analysis_job(
        task_execute_truss, node_path, member_path, work_dir, exe_path, exe_dir, employee_id, timestamp, source,
    )
    return {"job_id": job_id}


@router.get("/analysis/truss/sample-status")
def get_truss_sample_status(
        employee_id: str = Depends(require_auth),
        db: Session = Depends(database.get_db),
):
    """Truss 샘플 실행 잔여 횟수 조회 — 페이지 진입 시 prefetch 용도."""
    quota = _check_sample_quota("truss", employee_id, db)
    return {
        "remaining": quota["remaining"],
        "limit": SAMPLE_DAILY_LIMIT,
        "is_admin": quota["is_admin"],
    }


@router.post("/analysis/truss/run-sample")
async def run_truss_sample(
        employee_id: str = Depends(require_auth),
        db: Session = Depends(database.get_db),
):
    """
    Truss Model Builder — 사내 표준 샘플 CSV(NODE/WAY)로 즉시 해석 실행.
    신규 사용자가 실제 입력 파일 없이도 동작과 결과 형식을 확인할 수 있도록 함.

    제한: 사번별 일일 1회 (관리자 무제한). source="WorkbenchSample" 로 기록되어
    사용 이력 / 통계 / 활동 로그에서 모두 제외됨.
    """
    quota = _check_sample_quota("truss", employee_id, db)
    if not quota["allowed"]:
        raise HTTPException(status_code=429, detail=quota["reason"])

    sample_dir = os.path.abspath(os.path.join(_BACKEND_DIR, "SampleFile", "TrussModelBuilder"))
    if not os.path.isdir(sample_dir):
        raise HTTPException(status_code=404, detail="샘플 폴더가 없습니다.")

    node_src, member_src = None, None
    for fname in sorted(os.listdir(sample_dir)):
        if not fname.lower().endswith(".csv"):
            continue
        low = fname.lower()
        if "node" in low and node_src is None:
            node_src = os.path.join(sample_dir, fname)
        elif ("way" in low or "member" in low) and member_src is None:
            member_src = os.path.join(sample_dir, fname)
    if not node_src or not member_src:
        raise HTTPException(status_code=404, detail="샘플 CSV(NODE/WAY)를 찾을 수 없습니다.")

    work_dir, timestamp = make_work_dir(employee_id, "TrussModelBuilder")
    node_path = os.path.join(work_dir, os.path.basename(node_src))
    member_path = os.path.join(work_dir, os.path.basename(member_src))
    shutil.copyfile(node_src, node_path)
    shutil.copyfile(member_src, member_path)

    exe_dir = os.path.abspath(os.path.join(_BACKEND_DIR, "InHouseProgram", "TrussModelBuilder"))
    exe_path = os.path.join(exe_dir, "TrussModelBuilder.exe")

    job_id = submit_analysis_job(
        task_execute_truss, node_path, member_path, work_dir, exe_path, exe_dir,
        employee_id, timestamp, SAMPLE_SOURCE_TAG,
    )
    # 관리자가 아니면 카운트 소비 (관리자는 무제한이라 추적하지 않음)
    if not quota["is_admin"]:
        _consume_sample_quota("truss", employee_id)
    return {
        "job_id": job_id,
        "source": SAMPLE_SOURCE_TAG,
        "remaining": SAMPLE_DAILY_LIMIT if quota["is_admin"] else 0,
        "is_admin": quota["is_admin"],
    }


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
    _verify_employee_self(employee_id, current_user)
    work_dir, timestamp = make_work_dir(employee_id, "TrussAssessment")
    bdf_path = await save_upload(bdf_file, work_dir)
    job_id = submit_analysis_job(
        task_execute_assessment, bdf_path, work_dir, employee_id, timestamp, source,
    )
    return {"job_id": job_id}


@router.get("/analysis/assessment/sample-status")
def get_assessment_sample_status(
        employee_id: str = Depends(require_auth),
        db: Session = Depends(database.get_db),
):
    quota = _check_sample_quota("assessment", employee_id, db)
    return {"remaining": quota["remaining"], "limit": SAMPLE_DAILY_LIMIT, "is_admin": quota["is_admin"]}


@router.post("/analysis/assessment/run-sample")
async def run_assessment_sample(
        employee_id: str = Depends(require_auth),
        db: Session = Depends(database.get_db),
):
    """Truss Structural Assessment — 사내 표준 샘플 BDF로 즉시 해석 실행."""
    quota = _check_sample_quota("assessment", employee_id, db)
    if not quota["allowed"]:
        raise HTTPException(status_code=429, detail=quota["reason"])

    sample_dir = os.path.abspath(os.path.join(_BACKEND_DIR, "SampleFile", "TrussStructuralAssessment"))
    if not os.path.isdir(sample_dir):
        raise HTTPException(status_code=404, detail="샘플 폴더가 없습니다.")
    bdf_src = next((os.path.join(sample_dir, f) for f in sorted(os.listdir(sample_dir)) if f.lower().endswith(".bdf")), None)
    if not bdf_src:
        raise HTTPException(status_code=404, detail="샘플 BDF 파일을 찾을 수 없습니다.")

    work_dir, timestamp = make_work_dir(employee_id, "TrussAssessment")
    bdf_path = os.path.join(work_dir, os.path.basename(bdf_src))
    shutil.copyfile(bdf_src, bdf_path)

    job_id = submit_analysis_job(
        task_execute_assessment, bdf_path, work_dir, employee_id, timestamp, SAMPLE_SOURCE_TAG,
    )
    if not quota["is_admin"]:
        _consume_sample_quota("assessment", employee_id)
    return {
        "job_id": job_id, "source": SAMPLE_SOURCE_TAG,
        "remaining": SAMPLE_DAILY_LIMIT if quota["is_admin"] else 0,
        "is_admin": quota["is_admin"],
    }


# ==================== BDF Scanner ====================

# ==================== Plate Structure Analysis (Plate Studio) ====================

@router.post("/analysis/plate-structure/request")
async def request_plate_structure(
        bdf_file: UploadFile = File(...),
        employee_id: str = Form(...),
        source: str = Form("PlateStudio"),
        current_user: str = Depends(require_auth)
):
    """Plate Studio 가 내보낸 BDF 를 받아 Nastran SOL 101 해석 + 결과 파싱 작업을 시작한다.

    저장 위치: userConnection/{timestamp}_{employee_id}_PlateStructure/
    """
    _verify_employee_self(employee_id, current_user)
    work_dir, timestamp = make_work_dir(employee_id, "PlateStructure")
    bdf_path = await save_upload(bdf_file, work_dir, error_prefix="파일 저장 오류")
    job_id = submit_analysis_job(
        task_execute_plate_structure,
        bdf_path, work_dir, employee_id, timestamp, source,
        queue_message="대기 중...",
    )
    return {"job_id": job_id}


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
    _verify_employee_self(employee_id, current_user)
    safe_name = "".join(c for c in program_name if c.isalnum() or c in "_-")[:40] or "BdfScanner"
    work_dir, timestamp = make_work_dir(employee_id, safe_name)
    bdf_path = await save_upload(bdf_file, work_dir, error_prefix="파일 저장 오류")
    job_id = submit_analysis_job(
        task_execute_bdfscanner, bdf_path, work_dir, employee_id, timestamp, source, use_nastran,
    )
    return {"job_id": job_id}


# ==================== HP-SCR 배관응력 해석 ====================

@router.post("/analysis/hpscr/request")
async def request_hpscr(
        bdf_file: UploadFile = File(...),
        employee_id: str = Form(...),
        analysis_mode: str = Form(...),
        source: str = Form("Workbench"),
        current_user: str = Depends(require_auth)
):
    """
    HP-SCR 배관응력 해석을 요청받아 BDF 파일을 저장하고 백그라운드 작업을 실행합니다.

    analysis_mode : 'PSA' | 'POR'
      - PSA → InHouseProgram/HPSCR/PSA_Assessment_CLI.exe
      - POR → InHouseProgram/HPSCR/POR_Assessment_CLI.exe
    공통 결과: HP-SCR-PSA-REPORT.xlsx
    """
    _verify_employee_self(employee_id, current_user)

    mode = (analysis_mode or "").upper()
    if mode not in ("PSA", "POR"):
        raise HTTPException(status_code=400, detail="analysis_mode 는 'PSA' 또는 'POR' 만 허용됩니다.")

    work_dir, timestamp = make_work_dir(employee_id, f"HpScr{mode}")
    bdf_path = await save_upload(bdf_file, work_dir, error_prefix="파일 저장 오류")
    job_id = submit_analysis_job(
        task_execute_hpscr, bdf_path, work_dir, employee_id, timestamp, source, mode
    )

    return {"job_id": job_id}


@router.get("/analysis/hpscr/sample-status")
def get_hpscr_sample_status(
        employee_id: str = Depends(require_auth),
        db: Session = Depends(database.get_db),
):
    quota = _check_sample_quota("hpscr", employee_id, db)
    return {"remaining": quota["remaining"], "limit": SAMPLE_DAILY_LIMIT, "is_admin": quota["is_admin"]}


@router.post("/analysis/hpscr/run-sample")
async def run_hpscr_sample(
        mode: str = Query("PSA", description="PSA | POR — 샘플 실행 모드"),
        employee_id: str = Depends(require_auth),
        db: Session = Depends(database.get_db),
):
    """HP-SCR — 사내 표준 샘플 BDF 로 PSA 또는 POR 즉시 실행.
    mode 에 따라 SampleFile/HPSCR 내의 *PSA*.bdf / *POR*.bdf 자동 선택.
    """
    m = (mode or "").upper()
    if m not in ("PSA", "POR"):
        raise HTTPException(status_code=400, detail="mode 는 'PSA' 또는 'POR' 만 허용됩니다.")

    quota = _check_sample_quota("hpscr", employee_id, db)
    if not quota["allowed"]:
        raise HTTPException(status_code=429, detail=quota["reason"])

    sample_dir = os.path.abspath(os.path.join(_BACKEND_DIR, "SampleFile", "HPSCR"))
    if not os.path.isdir(sample_dir):
        raise HTTPException(status_code=404, detail="샘플 폴더가 없습니다.")
    bdf_src = next(
        (os.path.join(sample_dir, f) for f in sorted(os.listdir(sample_dir))
         if f.lower().endswith(".bdf") and m.lower() in f.lower()),
        None,
    )
    if not bdf_src:
        raise HTTPException(status_code=404, detail=f"샘플 {m} BDF 파일을 찾을 수 없습니다.")

    work_dir, timestamp = make_work_dir(employee_id, f"HpScr{m}")
    bdf_path = os.path.join(work_dir, os.path.basename(bdf_src))
    shutil.copyfile(bdf_src, bdf_path)

    job_id = submit_analysis_job(
        task_execute_hpscr, bdf_path, work_dir, employee_id, timestamp, SAMPLE_SOURCE_TAG, m,
    )
    if not quota["is_admin"]:
        _consume_sample_quota("hpscr", employee_id)
    return {
        "job_id": job_id, "source": SAMPLE_SOURCE_TAG, "mode": m,
        "remaining": SAMPLE_DAILY_LIMIT if quota["is_admin"] else 0,
        "is_admin": quota["is_admin"],
    }


# ==================== ModuleUnitStudio 자세안정성 해석 ====================

class ModuleStabilityRequest(BaseModel):
    posturePath: str
    source: Optional[str] = "ModuleUnitStudio"


@router.post("/analysis/module-stability/upload")
async def upload_module_stability_artifact(
        file: UploadFile = File(...),
        employee_id: str = Form(...),
        parent_analysis_id: int = Form(...),
        artifact_kind: str = Form("posture"),
        current_user: str = Depends(require_auth)
):
    """
    ModuleUnitStudio 자세안정성 평가 입력 파일을 GroupModuleUnit BDF 폴더로 업로드한다.
    Studio (Electron) 가 자기 PC 의 로컬 폴더에만 파일을 갖고 있을 때, 서버 PC 가 그 파일을
    읽을 수 있도록 원본 BDF 와 같은 폴더로 옮긴다.

    body (multipart/form-data):
      file           : 업로드 파일 (예: <stem>_edit_posture.json 또는 <stem>_edited.json)
      employee_id    : 업로드 주체 사번 (require_auth 의 current_user 와 같아야 한다)
      parent_analysis_id : BDF 검증으로 생성된 GroupModuleUnit Analysis.id
      artifact_kind  : 'posture' | 'edited' — 로깅/식별용. 폴더 분기는 안 함.

    반환: { ok, remotePath, folderPath, fileName }
      remotePath  = 절대경로. 이후 /api/analysis/module-stability/request 의 posturePath 로 사용.
    """
    if employee_id != current_user:
        raise HTTPException(status_code=403, detail="employee_id 가 인증 사용자와 일치하지 않습니다.")

    db = database.SessionLocal()
    try:
        parent = db.query(models.Analysis).filter(
            models.Analysis.id == parent_analysis_id
        ).first()
        if parent is None:
            raise HTTPException(status_code=404, detail=f"Parent Analysis (id={parent_analysis_id}) not found")
        if parent.employee_id != current_user:
            raise HTTPException(status_code=403, detail="Parent Analysis 의 사용자와 인증 사용자가 일치하지 않습니다.")
        if parent.program_name != "GroupModuleUnit":
            raise HTTPException(
                status_code=400,
                detail=f"Parent program_name '{parent.program_name}' is not 'GroupModuleUnit'",
            )
        bdf_path = (parent.input_info or {}).get("bdf_model")
    finally:
        db.close()

    if not bdf_path or not os.path.exists(bdf_path):
        raise HTTPException(status_code=400, detail=f"Parent BDF 파일을 찾을 수 없습니다: {bdf_path}")

    user_root_abs = os.path.abspath(_USER_CONNECTION_DIR)
    bdf_abs = os.path.abspath(bdf_path)
    user_root_cmp = os.path.normcase(user_root_abs)
    bdf_cmp = os.path.normcase(bdf_abs)
    if not bdf_cmp.startswith(user_root_cmp + os.sep):
        raise HTTPException(status_code=403, detail="Parent BDF 경로가 userConnection 디렉터리 밖에 있습니다.")

    # ModuleAnalysis.Cli 와 unit-structural endpoint 모두 posture/stability 파일이
    # parent BDF 와 같은 폴더에 있다고 가정한다.
    work_dir = os.path.dirname(bdf_abs)

    # 파일명에 경로 분리자 차단 (..\ ../ 등 보안).
    safe_name = os.path.basename(file.filename or "artifact.json")
    if not safe_name or safe_name in (".", ".."):
        raise HTTPException(status_code=400, detail="유효하지 않은 파일명입니다.")

    target_path = os.path.abspath(os.path.join(work_dir, safe_name))
    # 경로 탈출 차단 — work_dir 외부로 못 빠져나가게.
    if not target_path.startswith(work_dir + os.sep) and target_path != work_dir:
        raise HTTPException(status_code=400, detail="경로 탈출 시도 차단")

    try:
        with open(target_path, "wb") as buffer:
            buffer.write(await file.read())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 저장 오류: {str(e)}")

    return {
        "ok": True,
        "remotePath": target_path,
        "folderPath": work_dir,
        "fileName": safe_name,
        "artifactKind": artifact_kind,
    }


@router.post("/analysis/module-stability/request")
async def request_module_stability(
        req: ModuleStabilityRequest,
        current_user: str = Depends(require_auth)
):
    """
    ModuleUnitStudio 자세안정성 해석 요청.
    Electron viewer host adapter 가 _posture.json 절대경로를 넘기면 백엔드가
    ModuleAnalysis.Cli.exe 를 실행하고 _stability.json 결과를 job 상태에 보관한다.
    """
    # posturePath 는 Studio (viewer) 가 제공하는 절대경로. 반드시 userConnection 디렉터리 내부여야 한다.
    # prefix 검사 누락 시 서버 디스크의 임의 JSON 파일을 ModuleAnalysis.Cli.exe 에 spawn 인자로 넘길 수 있다.
    posture_abs = os.path.abspath(req.posturePath or "")
    user_root = _USER_CONNECTION_DIR
    if not (posture_abs == user_root or posture_abs.startswith(user_root + os.sep)):
        raise HTTPException(
            status_code=400,
            detail="posturePath 가 userConnection 디렉터리 밖에 있습니다.",
        )
    if not os.path.isfile(posture_abs):
        raise HTTPException(status_code=400, detail=f"posturePath 가 파일이 아닙니다: {posture_abs}")

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    job_id = str(uuid.uuid4())
    job_status_store.set(job_id, {"status": "Pending", "progress": 0, "message": "자세안정성 해석 대기 중..."})

    analysis_executor.submit(
        task_execute_module_stability,
        job_id,
        posture_abs,
        current_user,
        timestamp,
        req.source or "ModuleUnitStudio",
    )

    return {"job_id": job_id, "jobId": job_id}


@router.get("/analysis/module-stability/{job_id}/status")
async def get_module_stability_status(job_id: str):
    """ModuleUnitStudio 전용 job status alias."""
    if job_id not in job_status_store:
        raise HTTPException(status_code=404, detail="Job not found")
    return job_status_store.get(job_id)


# ==================== Group & Module Unit 권상 구조 해석 ====================

@router.post("/analysis/groupmoduleunit/request")
async def request_groupmoduleunit(
        bdf_file: UploadFile = File(...),
        employee_id: str = Form(...),
        use_nastran: bool = Form(False),
        source: str = Form("Workbench"),
        current_user: str = Depends(require_auth)
):
    """
    Group & Module Unit 권상 구조 해석 — Step1 BDF 입력 검증.
    NastranBridge (`nastran_bridge.exe`) 로 BDF 모델 JSON 을 산출하고
    프론트 ValidationStepLog 가 기대하는 step1 schema 로 변환한다.
    use_nastran=True 인 경우 추후 단계에서 validate-run 으로 F06 검증까지 확장한다.
    """
    _verify_employee_self(employee_id, current_user)
    work_dir, timestamp = make_work_dir(employee_id, "GroupModuleUnit")
    bdf_path = await save_upload(bdf_file, work_dir, error_prefix="파일 저장 오류")
    job_id = submit_analysis_job(
        task_execute_groupmoduleunit,
        bdf_path, work_dir, employee_id, timestamp, source, use_nastran,
    )
    return {"job_id": job_id}


@router.get("/analysis/groupmoduleunit/sample-status")
def get_gmu_sample_status(
        employee_id: str = Depends(require_auth),
        db: Session = Depends(database.get_db),
):
    quota = _check_sample_quota("groupmoduleunit", employee_id, db)
    return {"remaining": quota["remaining"], "limit": SAMPLE_DAILY_LIMIT, "is_admin": quota["is_admin"]}


@router.post("/analysis/groupmoduleunit/run-sample")
async def run_gmu_sample(
        employee_id: str = Depends(require_auth),
        db: Session = Depends(database.get_db),
):
    """Group & Module Unit 권상 — 사내 표준 샘플 BDF로 즉시 Step1 검증 실행 (use_nastran=False)."""
    quota = _check_sample_quota("groupmoduleunit", employee_id, db)
    if not quota["allowed"]:
        raise HTTPException(status_code=429, detail=quota["reason"])

    sample_dir = os.path.abspath(os.path.join(_BACKEND_DIR, "SampleFile", "GroupModuleUnit"))
    if not os.path.isdir(sample_dir):
        raise HTTPException(status_code=404, detail="샘플 폴더가 없습니다.")
    bdf_src = next((os.path.join(sample_dir, f) for f in sorted(os.listdir(sample_dir)) if f.lower().endswith(".bdf")), None)
    if not bdf_src:
        raise HTTPException(status_code=404, detail="샘플 BDF 파일을 찾을 수 없습니다.")

    work_dir, timestamp = make_work_dir(employee_id, "GroupModuleUnit")
    bdf_path = os.path.join(work_dir, os.path.basename(bdf_src))
    shutil.copyfile(bdf_src, bdf_path)

    job_id = submit_analysis_job(
        task_execute_groupmoduleunit,
        bdf_path, work_dir, employee_id, timestamp, SAMPLE_SOURCE_TAG, False,  # use_nastran=False
    )
    if not quota["is_admin"]:
        _consume_sample_quota("groupmoduleunit", employee_id)
    return {
        "job_id": job_id, "source": SAMPLE_SOURCE_TAG,
        "remaining": SAMPLE_DAILY_LIMIT if quota["is_admin"] else 0,
        "is_admin": quota["is_admin"],
    }


@router.post("/analysis/groupmoduleunit/request-from-path")
async def request_groupmoduleunit_from_path(
        bdf_server_path: str = Form(...),
        employee_id: str = Form(...),
        use_nastran: bool = Form(False),
        source: str = Form("Workbench"),
        current_user: str = Depends(require_auth)
):
    """
    기존 서버 BDF 경로로 GMU 검증을 요청합니다.
    HiTESS Model Builder 등 다른 프로그램에서 생성된 BDF를 프로그램 간 연계로 바로 넘길 때 사용합니다.
    """
    _verify_employee_self(employee_id, current_user)

    abs_path = os.path.abspath(bdf_server_path)
    if not abs_path.startswith(_USER_CONNECTION_DIR):
        raise HTTPException(status_code=400, detail="허용되지 않은 파일 경로입니다.")
    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="BDF 파일을 찾을 수 없습니다.")

    work_dir, timestamp = make_work_dir(employee_id, "GroupModuleUnit")
    bdf_path = os.path.join(work_dir, os.path.basename(abs_path))
    try:
        shutil.copy2(abs_path, bdf_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 복사 오류: {str(e)}")

    job_id = submit_analysis_job(
        task_execute_groupmoduleunit,
        bdf_path, work_dir, employee_id, timestamp, source, use_nastran,
    )
    return {"job_id": job_id}


# ==================== Unit Structural Analysis (Lifting + Nastran) ===========

@router.post("/analysis/unit-structural/request")
async def request_unit_structural(
        stability_path: str = Form(...),
        parent_analysis_id: int = Form(...),
        safety_factor: float = Form(1.2),
        allowable_mpa: float = Form(220.0),
        employee_id: str = Form(...),
        source: str = Form("Studio"),
        current_user: str = Depends(require_auth)
):
    """
    Unit 구조 해석 요청 — 자세 안정성 PASS 후 wire 포함 BDF 빌드 + Nastran SOL 101 + F06 매핑.

    Studio (Workbench Electron main) 가 이미 백엔드 폴더에 저장된 stability JSON 의
    절대경로를 직접 전달한다. 보안: stability_path 는 parent BDF 와 같은 디렉터리,
    그리고 _USER_CONNECTION_DIR 하위에 있어야 한다.
    """
    _verify_employee_self(employee_id, current_user)
    if safety_factor <= 0:
        raise HTTPException(status_code=400, detail="safety_factor must be > 0")
    if allowable_mpa <= 0:
        raise HTTPException(status_code=400, detail="allowable_mpa must be > 0")

    db = database.SessionLocal()
    try:
        parent = db.query(models.Analysis).filter(
            models.Analysis.id == parent_analysis_id
        ).first()
        if parent is None:
            raise HTTPException(status_code=404,
                                detail=f"Parent Analysis (id={parent_analysis_id}) not found")
        if parent.program_name != "GroupModuleUnit":
            raise HTTPException(status_code=400,
                                detail=f"Parent program_name '{parent.program_name}' is not 'GroupModuleUnit'")
        if parent.status != "Success":
            raise HTTPException(status_code=400,
                                detail=f"Parent BDF 검증이 성공 상태가 아닙니다 (status={parent.status})")
        bdf_path = (parent.input_info or {}).get("bdf_model")
        if not bdf_path or not os.path.exists(bdf_path):
            raise HTTPException(status_code=400,
                                detail=f"Parent BDF 파일을 찾을 수 없습니다: {bdf_path}")
    finally:
        db.close()

    # 보안 — stability_path 는 (1) 절대경로, (2) parent BDF 와 같은 폴더 안,
    # (3) userConnection 디렉터리 하위, (4) .json 확장자, (5) 실제 존재 — 모두 만족해야 함.
    stab_abs = os.path.abspath(stability_path)
    bdf_dir_abs = os.path.dirname(os.path.abspath(bdf_path))
    user_root_abs = os.path.abspath(_USER_CONNECTION_DIR)
    if not os.path.isabs(stability_path):
        raise HTTPException(status_code=400, detail="stability_path 는 절대경로여야 합니다.")
    if not stab_abs.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="stability_path 는 .json 파일이어야 합니다.")
    if not stab_abs.startswith(user_root_abs):
        raise HTTPException(status_code=400,
                            detail="stability_path 가 userConnection 디렉터리 안에 있지 않습니다.")
    if os.path.dirname(stab_abs) != bdf_dir_abs:
        raise HTTPException(status_code=400,
                            detail="stability_path 가 parent BDF 와 같은 폴더에 있지 않습니다.")
    if not os.path.exists(stab_abs):
        raise HTTPException(status_code=400, detail=f"stability_path 파일을 찾을 수 없습니다: {stab_abs}")

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    job_id = str(uuid.uuid4())
    job_status_store.set(job_id, {
        "status": "Pending", "progress": 0, "message": "Waiting in Queue...",
    })

    analysis_executor.submit(
        task_execute_unit_structural,
        job_id, parent_analysis_id, stab_abs,
        safety_factor, allowable_mpa,
        employee_id, timestamp, source,
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
    _verify_employee_self(employee_id, current_user)
    work_dir, timestamp = make_work_dir(employee_id, "F06Parser")
    f06_path = await save_upload(f06_file, work_dir, error_prefix="파일 저장 오류")
    job_id = submit_analysis_job(
        task_execute_f06parser, f06_path, work_dir, employee_id, timestamp, source,
    )
    return {"job_id": job_id}


# ==================== Mooring Fitting Assessment ====================

@router.post("/analysis/mooring-fitting/request")
async def request_mooring_fitting(
        structure_file: UploadFile = File(...),
        load_file: UploadFile = File(...),
        employee_id: str = Form(...),
        source: str = Form("Workbench"),
        current_user: str = Depends(require_auth)
):
    """
    Mooring Fitting Assessment 해석 요청.
    Structure CSV 와 Load CSV 를 userConnection 작업 폴더에 표준 파일명
    (MooringFittingData.csv, MooringFittingDataLoad.csv) 으로 저장한 뒤
    MooringFitting.exe build-full <work_dir> 를 백그라운드로 실행한다.
    """
    _verify_employee_self(employee_id, current_user)
    work_dir, timestamp = make_work_dir(employee_id, "MooringFitting")
    structure_path = await save_upload(
        structure_file, work_dir,
        error_prefix="Structure CSV 저장 오류",
        dest_name="MooringFittingData.csv",
    )
    load_path = await save_upload(
        load_file, work_dir,
        error_prefix="Load CSV 저장 오류",
        dest_name="MooringFittingDataLoad.csv",
    )

    exe_path = os.path.abspath(os.path.join(
        _BACKEND_DIR, "InHouseProgram", "MooringFitting", "MooringFitting.exe"
    ))

    job_id = submit_analysis_job(
        task_execute_mooring_fitting,
        structure_path, load_path, work_dir, exe_path,
        employee_id, timestamp, source,
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
    _verify_employee_self(employee_id, current_user)
    work_dir, timestamp = make_work_dir(employee_id, "SimpleBeam")
    input_json_path = await save_upload(beam_file, work_dir)
    job_id = submit_analysis_job(
        task_execute_beam, input_json_path, work_dir, employee_id, timestamp, source,
    )
    return {"job_id": job_id}


# ==================== HiTESS Model Builder (Cmb.Cli build-full) ====================

@router.post("/analysis/modelflow/request")
async def request_modelflow_analysis(
    stru_file: UploadFile = File(...),
    pipe_file: Optional[UploadFile] = File(None),
    equip_file: Optional[UploadFile] = File(None),
    employee_id: str = Form(...),
    source: str = Form("Workbench"),
    current_user: str = Depends(require_auth),
    mesh_size: float = Form(300.0),
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
    _verify_employee_self(employee_id, current_user)
    work_dir, timestamp = make_work_dir(employee_id, "HiTessModelBuilder")
    stru_path = await save_upload(stru_file, work_dir, error_prefix="파일 저장 오류")

    pipe_path = None
    if pipe_file and pipe_file.filename:
        pipe_path = await save_upload(pipe_file, work_dir, error_prefix="배관 파일 저장 오류")

    equip_path = None
    if equip_file and equip_file.filename:
        equip_path = await save_upload(equip_file, work_dir, error_prefix="장비 파일 저장 오류")

    exe_path = os.path.abspath(os.path.join(
        _BACKEND_DIR, "InHouseProgram", "HiTessModeBuilder", "Cmb.Cli.exe"
    ))

    job_id = submit_analysis_job(
        task_execute_modelflow,
        stru_path, pipe_path, equip_path, work_dir, exe_path,
        employee_id, timestamp, source,
        mesh_size, ubolt_full_fix, run_nastran, nastran_path, leg_z_tol,
        mesh_size_structure, mesh_size_pipe,
        queue_message="해석 대기 중...",
    )

    return {"job_id": job_id}


@router.get("/analysis/modelflow/sample-status")
def get_modelflow_sample_status(
        employee_id: str = Depends(require_auth),
        db: Session = Depends(database.get_db),
):
    quota = _check_sample_quota("modelflow", employee_id, db)
    return {"remaining": quota["remaining"], "limit": SAMPLE_DAILY_LIMIT, "is_admin": quota["is_admin"]}


@router.post("/analysis/modelflow/run-sample")
async def run_modelflow_sample(
        employee_id: str = Depends(require_auth),
        db: Session = Depends(database.get_db),
):
    """HiTESS Model Builder — 사내 표준 샘플 CSV(stru/pipe/equip)로 즉시 build-full 실행.
    옵션은 기본값(mesh_size=300.0, run_nastran=False)으로 고정 — 빠른 데모 목적.
    """
    quota = _check_sample_quota("modelflow", employee_id, db)
    if not quota["allowed"]:
        raise HTTPException(status_code=429, detail=quota["reason"])

    sample_dir = os.path.abspath(os.path.join(_BACKEND_DIR, "SampleFile", "ModelBuilder"))
    if not os.path.isdir(sample_dir):
        raise HTTPException(status_code=404, detail="샘플 폴더가 없습니다.")

    stru_src, pipe_src, equip_src = None, None, None
    for fname in sorted(os.listdir(sample_dir)):
        if not fname.lower().endswith(".csv"):
            continue
        low = fname.lower()
        if "stru" in low and stru_src is None:
            stru_src = os.path.join(sample_dir, fname)
        elif "pipe" in low and pipe_src is None:
            pipe_src = os.path.join(sample_dir, fname)
        elif ("equip" in low or "equp" in low) and equip_src is None:
            equip_src = os.path.join(sample_dir, fname)
    if not stru_src:
        raise HTTPException(status_code=404, detail="샘플 구조(stru) CSV를 찾을 수 없습니다.")

    work_dir, timestamp = make_work_dir(employee_id, "HiTessModelBuilder")
    stru_path = os.path.join(work_dir, os.path.basename(stru_src))
    shutil.copyfile(stru_src, stru_path)
    pipe_path = None
    if pipe_src:
        pipe_path = os.path.join(work_dir, os.path.basename(pipe_src))
        shutil.copyfile(pipe_src, pipe_path)
    equip_path = None
    if equip_src:
        equip_path = os.path.join(work_dir, os.path.basename(equip_src))
        shutil.copyfile(equip_src, equip_path)

    exe_path = os.path.abspath(os.path.join(_BACKEND_DIR, "InHouseProgram", "HiTessModeBuilder", "Cmb.Cli.exe"))

    job_id = submit_analysis_job(
        task_execute_modelflow,
        stru_path, pipe_path, equip_path, work_dir, exe_path,
        employee_id, timestamp, SAMPLE_SOURCE_TAG,
        300.0,   # mesh_size
        False,   # ubolt_full_fix
        False,   # run_nastran (빠른 데모)
        None, None, None, None,
        queue_message="해석 대기 중...",
    )
    if not quota["is_admin"]:
        _consume_sample_quota("modelflow", employee_id)
    return {
        "job_id": job_id, "source": SAMPLE_SOURCE_TAG,
        "remaining": SAMPLE_DAILY_LIMIT if quota["is_admin"] else 0,
        "is_admin": quota["is_admin"],
    }


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
    """output_dir 의 모든 파일을 zip 으로 묶어 반환.

    백엔드와 사용자 PC 가 다른 머신일 때, 사용자 PC 가 결과 폴더를 직접 fs 로 못 읽으므로
    이 엔드포인트로 zip 을 받아 사용자 PC 로컬에 풀어 Studio 의 initialFolder 로 사용한다.

    StreamingResponse + BytesIO 조합은 BytesIO 가 줄 단위로 이터레이트되어
    바이너리 zip 의 chunk 가 어긋나며 h11 LocalProtocolError 를 유발하므로,
    bytes 를 일괄 빌드한 뒤 Response 로 한 번에 회신한다.
    """
    try:
        abs_dir = _validate_userconnection_path(output_dir)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[result-zip] path validation 실패: %r", output_dir)
        raise HTTPException(status_code=400, detail=f"경로 검증 실패: {type(e).__name__}: {e}")

    if not os.path.isdir(abs_dir):
        logger.error("[result-zip] output_dir 없음: %s", abs_dir)
        raise HTTPException(status_code=404, detail=f"output_dir 없음: {abs_dir}")

    # arcname 계산은 os.path.relpath() 를 피하고 prefix 제거로 처리.
    # relpath 내부의 abspath() 가 Windows 예약 디바이스명(NUL/CON/PRN/AUX/COM*/LPT*) 을
    # 만나면 '\\.\nul' 같은 디바이스 경로로 변환돼 ValueError 가 발생하기 때문.
    abs_dir_norm = os.path.normpath(abs_dir)
    prefix_len = len(abs_dir_norm) + 1  # 끝 separator 포함

    skipped: list[str] = []
    buf = io.BytesIO()
    try:
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, _, files in os.walk(abs_dir):
                for f in files:
                    full = os.path.join(root, f)
                    full_norm = os.path.normpath(full)

                    if full_norm.startswith(abs_dir_norm):
                        arcname = full_norm[prefix_len:]
                    else:
                        # os.walk 가 abs_dir 외부를 반환하는 일은 거의 없지만 방어적 처리
                        arcname = f
                    if not arcname:
                        continue

                    try:
                        zf.write(full, arcname)
                    except OSError as e:
                        # 잠긴 파일/접근 거부 — 스킵하고 zip 은 계속 빌드
                        skipped.append(f"{arcname} ({e})")
                        continue
                    except ValueError as e:
                        # 예약 디바이스명 등 zipfile 내부 abspath 실패
                        skipped.append(f"{arcname} (ValueError: {e})")
                        continue
                    except Exception as e:
                        skipped.append(f"{arcname} ({type(e).__name__}: {e})")
                        continue
    except Exception as e:
        logger.exception("[result-zip] zip 빌드 실패: abs_dir=%s", abs_dir)
        raise HTTPException(
            status_code=500,
            detail=f"zip 빌드 실패: {type(e).__name__}: {e}",
        )

    if skipped:
        logger.warning("[result-zip] 스킵된 파일 %d 개 (앞 5건): %s", len(skipped), skipped[:5])

    body = buf.getvalue()
    if not body:
        logger.error("[result-zip] 빈 zip — abs_dir=%s, skipped=%d", abs_dir, len(skipped))
        raise HTTPException(status_code=500, detail="zip 이 비어 있음 (모든 파일 스킵됨)")

    fname = f"result-{os.path.basename(abs_dir)}.zip"
    logger.info("[result-zip] 응답 준비 완료: %s (size=%d bytes)", fname, len(body))
    return Response(
        content=body,
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
    job_id = submit_analysis_job(
        task_execute_apply_edit,
        abs_dir, exe_path, payload.strict,
        payload.run_nastran, payload.nastran_path, payload.parse_f06,
        queue_message="편집 적용 대기 중...",
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
