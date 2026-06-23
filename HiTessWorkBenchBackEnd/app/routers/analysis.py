"""해석 요청, 상태 조회, 이력 관리 API 라우터."""
import io
import json
import logging
import os
import shutil
import urllib.parse
import zipfile

logger = logging.getLogger(__name__)
from datetime import datetime, timedelta, date as _date
from typing import Optional
from sqlalchemy import func, or_
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form, Query, Request
from pydantic import BaseModel
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy.orm import Session
from .. import models, database
from ..services.job_manager import job_status_store
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
from ..services.hull_acceleration_service import task_execute_hull_acceleration
from ..services.plate_structure_service import task_execute_plate_structure
from ..services.mooring_fitting_service import task_execute_mooring_fitting, task_solve_mooring_fitting
from ..services.drawing_to_analysis_service import (
    task_execute_drawing_to_analysis,
    task_execute_drawing_image_to_analysis,
    task_execute_drawing_rebuild,
    task_execute_drawing_solve,
)
from ..services.modelbuilder_solve_service import task_execute_modelbuilder_solve
from ._intake import make_work_dir, save_upload, submit_analysis_job
from ._access_control import (
    assert_current_user_can_access_job,
    assert_current_user_can_access_path,
)

router = APIRouter(prefix="/api", tags=["analysis"])

# 파일 다운로드 허용 기준 경로: userConnection/ 디렉터리만 허용
_ROUTER_DIR = os.path.dirname(os.path.abspath(__file__))         # app/routers
_BACKEND_DIR = os.path.dirname(os.path.dirname(_ROUTER_DIR))     # HiTessWorkBenchBackEnd
_USER_CONNECTION_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))
_ALLOWED_DOWNLOAD_BASE = _USER_CONNECTION_DIR
_PROGRAM_DOWNLOAD_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "DownloadProgram"))

import sys as _sys
# nastran_bridge.py(순수 stdlib 모듈) 탐색 후보 — 모두 백엔드 기준 상대경로.
# 배포본은 <backend>/InHouseProgram/Nastran_bridge 에 동봉되어 git pull/배포와 함께 따라오므로
# 절대경로(예: WorkBenchSubModule)에 의존하지 않는다. 개발 PC 는 WorkBenchSubModule 라이브 소스를 그대로 사용.
# 환경변수 NASTRAN_BRIDGE_DIR 로 강제 지정도 가능. 먼저 발견되어 import 성공하는 폴더를 채택.
_NB_CANDIDATES = [
    os.environ.get("NASTRAN_BRIDGE_DIR", "").strip(),                               # 명시적 override
    os.path.join(_BACKEND_DIR, "InHouseProgram", "Nastran_bridge"),                 # 배포 표준(서버)
    os.path.join(_BACKEND_DIR, "..", "..", "WorkBenchSubModule", "Nastran_bridge"), # 개발 PC 라이브 소스
    os.path.join(_BACKEND_DIR, "InHouseProgram", "NastranBridge"),                  # 대체 폴더명
]
_nb = None
_NB_AVAILABLE = False
for _cand in _NB_CANDIDATES:
    if not _cand:
        continue
    _cand = os.path.abspath(_cand)
    if not os.path.isdir(_cand):
        continue
    if _cand not in _sys.path:
        _sys.path.insert(0, _cand)
    try:
        import nastran_bridge as _nb
        _NB_AVAILABLE = True
        logger.info("[mooring-studio] nastran_bridge 로드 성공: %s", _cand)
        break
    except ImportError:
        continue
if not _NB_AVAILABLE:
    logger.warning(
        "[mooring-studio] nastran_bridge 임포트 실패 — 후보 경로: %s (viewer-zip/편집/해석 비활성)",
        [os.path.abspath(c) for c in _NB_CANDIDATES if c],
    )

# 외부(네트워크/공유) 위치에 보관하는 배포용 프로그램 화이트리스트.
# DownloadProgram/ 폴더에 없고 외부 경로에서 받아와야 하는 파일들을 등록.
# 보안: 화이트리스트 외 파일명은 절대 외부 경로로 매핑되지 않음.
_EXTERNAL_PROGRAM_PATHS = {
    "HiTESSBEAM.zip": r"\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\[Hi-TESS]\6_DownloadProgram\HiTESSBEAM.zip",
    # 레거시/외부 데스크탑 프로그램이 시작 시 C:\temp\ServerIP.txt 를 읽어 서버 주소를 찾는다.
    # 사용자가 Download Center 에서 최신 서버 주소 파일을 내려받거나 C:\temp 에 바로 적용할 수 있도록 노출.
    "ServerIP.txt": os.path.join(_BACKEND_DIR, "InHouseProgram", "DownloadCenter", "ServerIP.txt"),
}

# ──────────────────────────────────────────────────────────
# 샘플 실행(1-click 데모) 일일 카운터 — 사번별 1회/일.
# 관리자는 무제한. 자정에 자동 리셋(다음 날짜로 비교).
# 메모리 dict (서버 재시작 시 리셋). 단일 uvicorn 인스턴스 가정.
# ──────────────────────────────────────────────────────────
SAMPLE_DAILY_LIMIT = 1
SAMPLE_SOURCE_TAG = "WorkbenchSample"  # 일반 사용 기록과 구분하는 source 값
_SAMPLE_RUN_TRACKER: dict[tuple[str, str], _date] = {}

# SidePassage·ModuleUnitStudio 의 내부 하위 단계(권상 자세안정성 평가·Unit 구조 해석)는
# 부모 프로젝트(SidePassage/GroupModuleUnit) 안에서 수행되는 작업이므로, 사용자의 MyProjects
# 목록에는 별도 프로젝트로 노출하지 않는다. DB 레코드 자체는 감사/디버깅을 위해 유지하며,
# 관리자 전체 이력(/analysis/all)에는 그대로 보인다.
INTERNAL_SUBSTEP_PROGRAMS = ("ModuleStability", "UnitStructuralAnalysis")


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


def _is_within_dir(base_dir: str, candidate_path: str) -> bool:
    """candidate_path가 base_dir 하위인지 commonpath로 검증합니다."""
    try:
        base = os.path.abspath(base_dir)
        candidate = os.path.abspath(candidate_path)
        return os.path.commonpath([base, candidate]) == base
    except ValueError:
        return False


def _normalize_userconnection_path(path: str, *, status_code: int = 403) -> str:
    decoded = os.path.abspath(urllib.parse.unquote(path))
    if not _is_within_dir(_ALLOWED_DOWNLOAD_BASE, decoded):
        raise HTTPException(status_code=status_code, detail="접근 권한이 없는 경로입니다.")
    return decoded


# ==================== 통계 ====================

@router.get("/analysis/stats/monthly")
def get_monthly_analysis_count(
    employee_id: str = Query(..., description="사번"),
    year: int = Query(None),
    month: int = Query(None),
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """특정 사용자의 당월(또는 지정 연월) 해석 수행 건수를 반환합니다."""
    _verify_employee_self(employee_id, current_user)
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
    db: Session = Depends(database.get_db),
    _user: str = Depends(require_auth),
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
                if _is_within_dir(_ALLOWED_DOWNLOAD_BASE, path):
                    return os.path.exists(path)
    return False


def _serialize_analysis(record: models.Analysis) -> dict:
    d = {c.name: getattr(record, c.name) for c in record.__table__.columns}
    d['files_available'] = _files_available(record)
    return d


def _apply_analysis_filters(
    query,
    *,
    search: Optional[str] = None,
    program_name: Optional[str] = None,
    status: Optional[str] = None,
    date_from: Optional[_date] = None,
    date_to: Optional[_date] = None,
):
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(or_(
            models.Analysis.project_name.ilike(term),
            models.Analysis.program_name.ilike(term),
            models.Analysis.employee_id.ilike(term),
        ))
    if program_name and program_name != "All":
        query = query.filter(models.Analysis.program_name == program_name)
    if status and status != "All":
        query = query.filter(models.Analysis.status == status)
    if date_from:
        query = query.filter(models.Analysis.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        query = query.filter(models.Analysis.created_at <= datetime.combine(date_to, datetime.max.time()))
    return query


def _analysis_summary(query) -> dict:
    rows = query.all()
    total = len(rows)
    success = sum(1 for r in rows if r.status == "Success")
    module_count = {}
    expired_files = 0
    now = datetime.now()
    seven_days_ago = now - timedelta(days=7)
    prev_seven_days_ago = now - timedelta(days=14)
    this_week = 0
    prev_week = 0

    for r in rows:
        module_count[r.program_name or "Unknown"] = module_count.get(r.program_name or "Unknown", 0) + 1
        if not _files_available(r):
            expired_files += 1
        if r.created_at:
            created = r.created_at.replace(tzinfo=None) if getattr(r.created_at, "tzinfo", None) else r.created_at
            if created >= seven_days_ago:
                this_week += 1
            elif prev_seven_days_ago <= created < seven_days_ago:
                prev_week += 1

    module_entries = sorted(module_count.items(), key=lambda item: item[1], reverse=True)
    return {
        "total": total,
        "success": success,
        "successRate": round((success / total) * 100) if total else 0,
        "thisWeek": this_week,
        "weekDelta": this_week - prev_week,
        "topModule": module_entries[0][0] if module_entries else None,
        "topModuleCount": module_entries[0][1] if module_entries else 0,
        "moduleEntries": module_entries,
        "expiredFiles": expired_files,
        "availableFiles": total - expired_files,
    }


def _analysis_management_summary(query, users_by_employee_id: dict) -> Optional[dict]:
    rows = [r for r in query.all() if not getattr(users_by_employee_id.get(r.employee_id), "is_developer", False)]
    if not rows:
        return None

    rows.sort(key=lambda r: r.created_at or datetime.min)
    total = len(rows)
    first_date = rows[0].created_at.replace(tzinfo=None) if getattr(rows[0].created_at, "tzinfo", None) else rows[0].created_at
    last_date = rows[-1].created_at.replace(tzinfo=None) if getattr(rows[-1].created_at, "tzinfo", None) else rows[-1].created_at
    covered_days = max(1, (last_date.date() - first_date.date()).days + 1)

    program_map = {}
    user_map = {}
    dept_map = {}
    day_count_map = {}
    hour_buckets = [0] * 24
    weekday_buckets = [0] * 7

    for row in rows:
        created_at = row.created_at.replace(tzinfo=None) if getattr(row.created_at, "tzinfo", None) else row.created_at
        program_name = row.program_name or "Unknown"
        employee_id = row.employee_id or "unknown"
        user = users_by_employee_id.get(employee_id)
        department = user.department if user and user.department else "Unknown"
        user_name = user.name if user else "Deleted User"
        day_key = created_at.date().isoformat()

        program = program_map.setdefault(program_name, {"name": program_name, "count": 0, "users": set(), "lastRun": None})
        program["count"] += 1
        program["users"].add(employee_id)
        if not program["lastRun"] or created_at > program["lastRun"]:
            program["lastRun"] = created_at

        user_row = user_map.setdefault(employee_id, {
            "employee_id": employee_id,
            "name": user_name,
            "dept": department,
            "count": 0,
            "programs": set(),
            "firstRun": None,
            "lastRun": None,
        })
        user_row["count"] += 1
        user_row["programs"].add(program_name)
        if not user_row["firstRun"] or created_at < user_row["firstRun"]:
            user_row["firstRun"] = created_at
        if not user_row["lastRun"] or created_at > user_row["lastRun"]:
            user_row["lastRun"] = created_at

        dept_map[department] = dept_map.get(department, 0) + 1
        day_count_map[day_key] = day_count_map.get(day_key, 0) + 1
        hour_buckets[created_at.hour] += 1
        weekday_buckets[created_at.weekday()] += 1

    program_rows = sorted([
        {
            **{k: v for k, v in p.items() if k not in ("users", "lastRun")},
            "share": round((p["count"] / total) * 100),
            "userCount": len(p["users"]),
            "lastRunLabel": p["lastRun"].strftime("%Y-%m-%d %H:%M:%S") if p["lastRun"] else "-",
        }
        for p in program_map.values()
    ], key=lambda p: p["count"], reverse=True)

    user_rows = sorted([
        {
            **{k: v for k, v in u.items() if k not in ("programs", "firstRun", "lastRun")},
            "share": round((u["count"] / total) * 100),
            "programCount": len(u["programs"]),
            "lastRunLabel": u["lastRun"].strftime("%Y-%m-%d %H:%M:%S") if u["lastRun"] else "-",
            "firstRunIso": u["firstRun"].isoformat() if u["firstRun"] else None,
        }
        for u in user_map.values()
    ], key=lambda u: u["count"], reverse=True)

    trend_items = sorted(day_count_map.items(), key=lambda item: item[0])[-14:]
    max_day = max(day_count_map.values()) if day_count_map else 0
    peak_hour_index = max(range(24), key=lambda idx: hour_buckets[idx])
    cutoff = first_date + (last_date - first_date) * 0.7
    new_users = sum(1 for u in user_map.values() if u["firstRun"] and u["firstRun"] >= cutoff)
    weekday_labels = ["월", "화", "수", "목", "금", "토", "일"]

    return {
        "total": total,
        "activePrograms": len(program_map),
        "activeUsers": len(user_map),
        "activeDepartments": len(dept_map),
        "newUsers": new_users,
        "avgPerDay": f"{total / covered_days:.1f}",
        "maxDay": max_day,
        "coveredDays": covered_days,
        "busiestProgram": program_rows[0] if program_rows else None,
        "peakHour": f"{peak_hour_index:02d}시" if hour_buckets[peak_hour_index] else "-",
        "programRows": program_rows,
        "userRows": user_rows,
        "topPrograms": program_rows[:8],
        "topUsers": user_rows[:8],
        "trendData": [{"date": datetime.fromisoformat(day).strftime("%b %d"), "count": count} for day, count in trend_items],
        "hourData": [{"hour": f"{hour:02d}시", "count": count} for hour, count in enumerate(hour_buckets)],
        "weekdayData": [{"name": name, "count": weekday_buckets[index]} for index, name in enumerate(weekday_labels)],
        "deptData": sorted([{"name": name, "count": count} for name, count in dept_map.items()], key=lambda d: d["count"], reverse=True)[:8],
    }


@router.get("/analysis/history/{employee_id}")
def get_analysis_history(
    employee_id: str,
    skip: int = Query(0, ge=0, description="건너뛸 항목 수"),
    limit: int = Query(50, ge=1, le=100000, description="반환할 최대 항목 수"),
    search: Optional[str] = Query(None),
    program_name: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    file_status: Optional[str] = Query(None),
    include_summary: bool = Query(False),
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """
    특정 사용자의 해석 이력을 최신순으로 조회합니다. 페이지네이션 지원.
    """
    _verify_employee_self(employee_id, current_user)
    # 샘플 실행(WorkbenchSample)은 사용 기록에서 제외 — 신규 사용자 학습용
    # 내부 하위 단계(ModuleStability·UnitStructuralAnalysis)는 부모 SidePassage/GroupModuleUnit
    # 프로젝트에 포함된 작업이므로 별도 프로젝트로 노출하지 않는다(items·summary 모두 제외).
    base_q = db.query(models.Analysis).filter(
        models.Analysis.employee_id == employee_id,
        models.Analysis.source != SAMPLE_SOURCE_TAG,
        models.Analysis.program_name.notin_(INTERNAL_SUBSTEP_PROGRAMS),
    )
    base_q = _apply_analysis_filters(base_q, search=search, program_name=program_name, status=status)
    summary = _analysis_summary(base_q) if include_summary else None

    if file_status and file_status != "All":
        filtered = [
            r for r in base_q.order_by(models.Analysis.created_at.desc()).all()
            if ("expired" if not _files_available(r) else "available") == file_status
        ]
        total = len(filtered)
        history = filtered[skip:skip + limit]
    else:
        total = base_q.count()
        history = (
            base_q
            .order_by(models.Analysis.created_at.desc())
            .offset(skip).limit(limit)
            .all()
        )
    return {"total": total, "skip": skip, "limit": limit, "items": [_serialize_analysis(r) for r in history], "summary": summary}


@router.get("/analysis/all")
def get_all_analysis_history(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100000),
    search: Optional[str] = Query(None),
    date_from: Optional[_date] = Query(None),
    date_to: Optional[_date] = Query(None),
    include_summary: bool = Query(False),
    db: Session = Depends(database.get_db),
    _admin: str = Depends(require_admin),
):
    """
    관리자용 전체 해석 이력을 최신순으로 조회합니다. 페이지네이션 지원.
    상한 le=100000 — 통계 대시보드가 전체 이력을 받아 집계하기 위함.
    """
    # 샘플 실행(WorkbenchSample)은 통계·전체 이력에서 제외
    base_q = db.query(models.Analysis).filter(models.Analysis.source != SAMPLE_SOURCE_TAG)
    base_q = _apply_analysis_filters(base_q, search=search, date_from=date_from, date_to=date_to)
    users = db.query(models.User).all()
    users_by_employee_id = {u.employee_id: u for u in users}
    summary = _analysis_management_summary(base_q, users_by_employee_id) if include_summary else None
    total = base_q.count()
    items = (
        base_q
        .order_by(models.Analysis.created_at.desc())
        .offset(skip).limit(limit)
        .all()
    )
    serialized = []
    for item in items:
        payload = _serialize_analysis(item)
        user = users_by_employee_id.get(item.employee_id)
        payload.update({
            "department": user.department if user and user.department else "Unknown",
            "userName": user.name if user else "Deleted User",
            "isDeveloper": bool(user.is_developer) if user else False,
        })
        serialized.append(payload)
    return {"total": total, "skip": skip, "limit": limit, "items": serialized, "summary": summary}


@router.get("/download")
def download_file(filepath: str, req: Request, db: Session = Depends(database.get_db), employee_id: str = Depends(require_auth)):
    """
    지정된 경로의 파일을 다운로드합니다.
    보안: userConnection/ 디렉터리 내 파일만 허용합니다.
    """
    decoded_path = _normalize_userconnection_path(filepath)
    assert_current_user_can_access_path(decoded_path, employee_id, db, _ALLOWED_DOWNLOAD_BASE)
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
        if not _is_within_dir(_PROGRAM_DOWNLOAD_DIR, file_path):
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
    decoded_path = _normalize_userconnection_path(json_path)
    assert_current_user_can_access_path(decoded_path, employee_id, db, _ALLOWED_DOWNLOAD_BASE)
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


# ==================== DrawingToAnalysis ====================

@router.post("/analysis/drawing-to-analysis/request")
async def request_drawing_to_analysis(
    pdf_file: UploadFile = File(...),
    employee_id: str = Form(...),
    mesh_size: float = Form(10.0),
    source: str = Form("Workbench"),
    mode: Optional[str] = Form(None),
    current_user: str = Depends(require_auth),
):
    """DrawingToAnalysis 작업을 요청받아 PDF를 저장하고 BDF 변환 작업을 실행합니다.

    mode 미지정 시 파일명 prefix 로 자동 분기 (Lug_* → 'lug', BlockSupport_* → 'support', ...).
    """
    _verify_employee_self(employee_id, current_user)
    fname = pdf_file.filename or ""
    if not fname.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF 파일만 업로드 가능합니다.")

    # mode 자동 결정
    if mode:
        resolved_mode = mode.lower()
    else:
        category, _ = _categorize_catalogue_filename(fname)
        resolved_mode = _resolve_drawing_mode(category)

    work_dir, timestamp = make_work_dir(employee_id, "DrawingToAnalysis")
    pdf_path = await save_upload(pdf_file, work_dir, error_prefix="PDF 저장 오류")
    exe_path = os.path.abspath(os.path.join(
        _BACKEND_DIR, "InHouseProgram", "DrawingToAnalysis", "DrawingToAnalysis.exe"
    ))

    job_id = submit_analysis_job(
        task_execute_drawing_to_analysis,
        pdf_path, work_dir, exe_path, employee_id, timestamp, source, mesh_size, resolved_mode,
        queue_message="변환 대기 중...",
    )
    return {"job_id": job_id, "mode": resolved_mode}


@router.post("/analysis/drawing-to-analysis/image/request")
async def request_drawing_image_to_analysis(
    image_file: UploadFile = File(...),
    employee_id: str = Form(...),
    mesh_size: float = Form(10.0),
    reference_length_mm: Optional[float] = Form(None),
    source: str = Form("Workbench-Image"),
    current_user: str = Depends(require_auth),
):
    """JPG/PNG 도면 이미지를 업로드하여 반자동 ImageToAnalysis 작업을 실행합니다."""
    _verify_employee_self(employee_id, current_user)
    fname = image_file.filename or ""
    ext = os.path.splitext(fname)[1].lower()
    if ext not in {".png", ".jpg", ".jpeg"}:
        raise HTTPException(status_code=400, detail="PNG 또는 JPG 파일만 업로드 가능합니다.")

    work_dir, timestamp = make_work_dir(employee_id, "DrawingToAnalysis")
    image_path = await save_upload(
        image_file,
        work_dir,
        error_prefix="이미지 저장 오류",
        allowed_extensions={".png", ".jpg", ".jpeg"},
        max_bytes=50 * 1024 * 1024,
    )
    exe_path = os.path.abspath(os.path.join(
        _BACKEND_DIR, "InHouseProgram", "DrawingToAnalysis", "DrawingToAnalysis.exe"
    ))

    job_id = submit_analysis_job(
        task_execute_drawing_image_to_analysis,
        image_path, work_dir, exe_path, employee_id, timestamp, source, mesh_size, reference_length_mm,
        queue_message="이미지 변환 대기 중...",
    )
    return {"job_id": job_id, "mode": "lug", "image": os.path.basename(image_path)}


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


# -------------------- 도면 PDF 카탈로그 --------------------
# 관리자가 HiTessWorkBenchBackEnd/InHouseProgram/DrawingToAnalysis/PdfCatalogue/
# 폴더에 PDF를 둬두면 사용자가 워크벤치에서 둘러보고 그 PDF로 변환을 실행할 수 있다.
# (DrawingToAnalysis.exe 가 있는 InHouseProgram 폴더 하위에 함께 둠)

_DRAWING_CATALOGUE_DIR = os.path.abspath(os.path.join(
    _BACKEND_DIR, "InHouseProgram", "DrawingToAnalysis", "PdfCatalogue"
))


def _resolve_catalogue_pdf(filename: str) -> str:
    """카탈로그 폴더 내부의 PDF 경로를 안전하게 해석한다. 경로 탈출 방지."""
    safe = os.path.basename(filename or "")
    if not safe.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF 파일명이 아닙니다.")
    target = os.path.abspath(os.path.join(_DRAWING_CATALOGUE_DIR, safe))
    if not _is_within_dir(_DRAWING_CATALOGUE_DIR, target):
        raise HTTPException(status_code=400, detail="잘못된 파일 경로입니다.")
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="카탈로그에 해당 PDF가 없습니다.")
    return target


def _categorize_catalogue_filename(filename: str) -> tuple[str, str]:
    """카탈로그 PDF 파일명을 (category, label) 로 변환한다.

    규칙: stem(확장자 제외)을 '_' 로 분리, 첫 토큰 = 카테고리, 나머지 = '-' 로 연결한 라벨.
      'Lug_L_25.pdf'      → ('Lug',     'L-25')
      'Bracket_BR_01.pdf' → ('Bracket', 'BR-01')
      'Single.pdf'        → ('Other',   'Single')
    """
    stem = os.path.splitext(os.path.basename(filename))[0]
    parts = stem.split('_')
    if len(parts) >= 2 and parts[0]:
        return parts[0], '-'.join(parts[1:])
    return 'Other', stem


def _resolve_drawing_mode(category_or_filename: str) -> str:
    """카테고리 또는 파일명에서 DrawingToAnalysis 엔진 모드를 결정한다.

    'BlockSupport', 'Support', 'BS_*'  → 'support'
    그 외 (Lug 포함)                   → 'lug'
    """
    c = (category_or_filename or "").lower()
    if "support" in c or c.startswith("bs_") or c.startswith("bs.") or c == "bs":
        return "support"
    return "lug"


@router.get("/analysis/drawing-to-analysis/catalogue")
async def list_drawing_catalogue(current_user: str = Depends(require_auth)):
    """카탈로그 폴더의 PDF 목록 반환.

    응답:
      {
        items: [{ filename, category, label, size_bytes, page_count|None }],
        categories: [{ name, count }],
        catalogue_dir: str
      }
    """
    os.makedirs(_DRAWING_CATALOGUE_DIR, exist_ok=True)
    try:
        names = sorted(os.listdir(_DRAWING_CATALOGUE_DIR))
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"카탈로그 폴더 읽기 실패: {e}")

    items = []
    counts: dict[str, int] = {}
    for name in names:
        if not name.lower().endswith(".pdf"):
            continue
        full = os.path.join(_DRAWING_CATALOGUE_DIR, name)
        if not os.path.isfile(full):
            continue
        page_count = None
        try:
            import fitz
            with fitz.open(full) as doc:
                page_count = doc.page_count
        except Exception:
            page_count = None
        category, label = _categorize_catalogue_filename(name)
        items.append({
            "filename":   name,
            "category":   category,
            "label":      label,
            "size_bytes": os.path.getsize(full),
            "page_count": page_count,
        })
        counts[category] = counts.get(category, 0) + 1

    categories = [{"name": c, "count": n} for c, n in sorted(counts.items())]
    return {
        "items": items,
        "categories": categories,
        "catalogue_dir": _DRAWING_CATALOGUE_DIR,
    }


def _find_catalogue_png(stem: str) -> Optional[str]:
    """관리자가 미리 만들어 둔 동명 PNG 가 있으면 그 경로를 반환.

    위치: HiTessWorkBenchBackEnd/InHouseProgram/DrawingToAnalysis/PdfCatalogue/PNG/{stem}.png
    PNG 가 있으면 카탈로그 미리보기에서 그대로 사용한다 (PDF 렌더링보다 깔끔).
    """
    png_dir = os.path.join(_DRAWING_CATALOGUE_DIR, "PNG")
    candidate = os.path.abspath(os.path.join(png_dir, stem + ".png"))
    if not _is_within_dir(os.path.abspath(png_dir), candidate):
        return None
    return candidate if os.path.isfile(candidate) else None


@router.get("/analysis/drawing-to-analysis/catalogue/{filename}/preview")
async def preview_drawing_catalogue(
    filename: str,
    current_user: str = Depends(require_auth),
):
    """카탈로그 미리보기 — 관리자가 만든 PNG 가 있으면 그대로, 없으면 PyMuPDF fallback.

    PNG 우선 정책:
      1) PdfCatalogue/PNG/{stem}.png 가 존재하면 그 파일을 그대로 반환 (디자인 그대로).
      2) 없으면 PDF 첫 페이지를 PyMuPDF 로 렌더링해서 반환 (원본 품질, 후처리 없음).
    """
    path = _resolve_catalogue_pdf(filename)
    stem = os.path.splitext(os.path.basename(path))[0]

    # 1) 사용자 정의 PNG 우선
    png_path = _find_catalogue_png(stem)
    if png_path:
        return FileResponse(png_path, media_type="image/png", filename=stem + ".png")

    # 2) Fallback: PyMuPDF 렌더링 (후처리 없이 원본 그대로)
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise HTTPException(status_code=500, detail="서버에 PyMuPDF가 설치되어 있지 않습니다.")
    try:
        with fitz.open(path) as doc:
            if doc.page_count == 0:
                raise HTTPException(status_code=400, detail="빈 PDF입니다.")
            pix = doc.load_page(0).get_pixmap(
                matrix=fitz.Matrix(3.5, 3.5),
                alpha=False,
                colorspace=fitz.csRGB,
            )
            png_bytes = pix.tobytes("png")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"미리보기 생성 실패: {e}")
    return StreamingResponse(io.BytesIO(png_bytes), media_type="image/png")


@router.post("/analysis/drawing-to-analysis/catalogue/{filename}/run")
async def run_drawing_catalogue(
    filename: str,
    employee_id: str = Form(...),
    mesh_size: float = Form(10.0),
    source: str = Form("Workbench-Catalogue"),
    current_user: str = Depends(require_auth),
):
    """카탈로그 PDF로 BDF 변환 작업을 큐에 등록한다.

    카테고리(파일명 prefix)에 따라 자동으로 mode를 결정한다:
      Lug_*           → mode='lug'        (exe all)
      BlockSupport_*  → mode='support'    (exe support all)
    """
    _verify_employee_self(employee_id, current_user)
    src_path = _resolve_catalogue_pdf(filename)
    safe_name = os.path.basename(src_path)
    category, _ = _categorize_catalogue_filename(safe_name)
    resolved_mode = _resolve_drawing_mode(category)

    work_dir, timestamp = make_work_dir(employee_id, "DrawingToAnalysis")
    pdf_path = os.path.join(work_dir, safe_name)
    try:
        shutil.copy2(src_path, pdf_path)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"PDF 복사 실패: {e}")

    exe_path = os.path.abspath(os.path.join(
        _BACKEND_DIR, "InHouseProgram", "DrawingToAnalysis", "DrawingToAnalysis.exe"
    ))
    job_id = submit_analysis_job(
        task_execute_drawing_to_analysis,
        pdf_path, work_dir, exe_path, employee_id, timestamp, source, mesh_size, resolved_mode,
        queue_message="변환 대기 중...",
    )
    return {"job_id": job_id, "filename": safe_name, "mode": resolved_mode, "category": category}


# -------------------- 도면 → 모델 재구축 (파라미터 편집) --------------------

class DrawingRebuildRequest(BaseModel):
    """파라미터 편집 후 모델 재구축 요청."""
    employee_id: str
    work_dir: str               # 이전 작업 폴더 (절대 경로)
    mode: str                   # 'lug' | 'support'
    params: dict                # 편집된 LugParams / SupportParams JSON
    original_pdf_path: Optional[str] = None  # Support 모드에서 필수
    source: str = "Workbench-Rebuild"


def _find_pdf_in_dir(work_dir: str) -> Optional[str]:
    """폴더 안에서 카탈로그/업로드 원본 PDF 를 찾는다 (engine 정규화 산출물 제외)."""
    if not os.path.isdir(work_dir):
        return None
    try:
        for name in sorted(os.listdir(work_dir)):
            if not name.lower().endswith(".pdf"):
                continue
            if name.startswith("input_pdf_for_engine"):
                continue
            return os.path.join(work_dir, name)
    except OSError:
        pass
    return None


@router.post("/analysis/drawing-to-analysis/rebuild")
async def rebuild_drawing_model(
    payload: DrawingRebuildRequest,
    current_user: str = Depends(require_auth),
):
    """편집한 파라미터로 BDF/메시 재구축.

    결과 저장 위치: <이전 작업 폴더>/rebuild_<timestamp>/
    → 사용자가 동일 변환의 변형들을 한 폴더 안에서 관리할 수 있도록 한다.
    """
    _verify_employee_self(payload.employee_id, current_user)

    mode = (payload.mode or "lug").lower()
    if mode not in ("lug", "support"):
        raise HTTPException(status_code=400, detail=f"알 수 없는 mode: {payload.mode}")

    # ── 이전 작업 폴더 검증 ──────────────────────────────────────
    prev_dir = os.path.abspath(payload.work_dir or "")
    if not _is_within_dir(_USER_CONNECTION_DIR, prev_dir):
        raise HTTPException(status_code=400, detail="허용되지 않은 work_dir 입니다.")
    if not os.path.isdir(prev_dir):
        raise HTTPException(status_code=404, detail=f"이전 작업 폴더를 찾을 수 없습니다: {prev_dir}")

    # ── 재구축 폴더: 이전 폴더 하위에 rebuild_<timestamp>/ ─────
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    rebuild_dir = os.path.join(prev_dir, f"rebuild_{timestamp}")
    try:
        os.makedirs(rebuild_dir, exist_ok=True)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"재구축 폴더 생성 실패: {e}")

    # ── Support 재구축은 'support from-params' CLI 가 SupportParams JSON 만으로 동작 ──
    # → 원본 PDF 가 필요 없음 (PDF 재해석 거치지 않음)
    original_pdf: Optional[str] = None

    exe_path = os.path.abspath(os.path.join(
        _BACKEND_DIR, "InHouseProgram", "DrawingToAnalysis", "DrawingToAnalysis.exe"
    ))
    job_id = submit_analysis_job(
        task_execute_drawing_rebuild,
        rebuild_dir, exe_path, payload.employee_id, timestamp, payload.source,
        mode, payload.params, original_pdf,
        queue_message="모델 재구축 대기 중...",
    )
    return {
        "job_id":      job_id,
        "work_dir":    rebuild_dir,
        "parent_dir":  prev_dir,
        "mode":        mode,
        "original_pdf": original_pdf,
    }


# -------------------- 구조 해석 (하중/경계조건 → Nastran) --------------------

class DrawingLoadSet(BaseModel):
    """하중 세트 — 선택 노드에 동일한 힘 벡터(N)를 적용."""
    nodes: list[int]
    fx: float = 0.0
    fy: float = 0.0
    fz: float = 0.0


class DrawingBcSet(BaseModel):
    """경계조건 세트 — 선택 노드를 dof 문자열(예: '123456')로 구속."""
    nodes: list[int]
    dof: str = "123456"


class DrawingRbeCenter(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


class DrawingHoleRbe(BaseModel):
    """Lug Hole RBE2 — 중심 독립노드 + hole edge ring 종속노드 (순수 강체 결합).

    하중은 자동 적용하지 않는다. 중심 노드(center_id)를 하중 영역에서 선택해
    일반 load set 으로 Force 를 주면 하중 조합(LC)에 포함된다.
    """
    center_id: int = 0          # 중심 독립노드 GRID id (프론트가 max+1 로 부여)
    center: DrawingRbeCenter = DrawingRbeCenter()
    ring_node_ids: list[int] = []


class DrawingRbe3Set(BaseModel):
    """Area RBE3 — 넓은 영역에 총합 하중을 분배하기 위한 하중분배 요소.

    기준노드(ref_id)에 일반 load set 으로 총 Force 를 주면 RBE3 가 영역 노드들로
    가중분배한다. RBE2 와 달리 강성을 추가하지 않아 플레이트가 자유롭게 변형된다.
    """
    ref_id: int = 0             # 기준(REFGRID) 노드 GRID id (프론트가 부여, 하중 적용 대상)
    center: DrawingRbeCenter = DrawingRbeCenter()
    node_ids: list[int] = []    # 분배 대상(독립) grid 들


class DrawingLoadCase(BaseModel):
    """Load Case — 경계조건 세트(bc_ids)와 하중 세트(load_ids)의 조합 = SUBCASE.

    bc_ids / load_ids 는 bcs / loads 배열의 인덱스(0-base).
    RBE 중심 하중은 별도 load set(중심 노드 선택)으로 처리되므로 여기서 다루지 않는다.
    """
    name: str = ""
    bc_ids: list[int] = []
    load_ids: list[int] = []


class DrawingSolveRequest(BaseModel):
    """변환된 BDF 에 하중/경계조건을 반영해 Nastran 해석을 실행하는 요청."""
    employee_id: str
    work_dir: str               # 변환/재구축 결과 폴더 (BDF 가 있는 폴더, 절대 경로)
    bdf_path: str               # 해석 대상 BDF 절대 경로
    mode: str = "lug"           # 'lug' | 'support'
    loads: list[DrawingLoadSet] = []
    bcs: list[DrawingBcSet] = []
    hole_rbe: Optional[DrawingHoleRbe] = None
    rbe3_sets: list[DrawingRbe3Set] = []
    load_cases: list[DrawingLoadCase] = []
    source: str = "Workbench-Solve"


@router.post("/analysis/drawing-to-analysis/solve")
async def solve_drawing_model(
    payload: DrawingSolveRequest,
    current_user: str = Depends(require_auth),
):
    """변환된 BDF 에 사용자 하중/경계조건을 주입하고 Nastran(SOL 101)을 실행.

    결과 저장 위치: <work_dir>/solve_<timestamp>/
    """
    _verify_employee_self(payload.employee_id, current_user)

    mode = (payload.mode or "lug").lower()

    # ── work_dir / bdf 경로 검증 (userConnection 외부 접근 차단) ──
    work_dir = os.path.abspath(payload.work_dir or "")
    if not _is_within_dir(_USER_CONNECTION_DIR, work_dir):
        raise HTTPException(status_code=400, detail="허용되지 않은 work_dir 입니다.")
    if not os.path.isdir(work_dir):
        raise HTTPException(status_code=404, detail=f"작업 폴더를 찾을 수 없습니다: {work_dir}")

    bdf_path = os.path.abspath(payload.bdf_path or "")
    if not _is_within_dir(_USER_CONNECTION_DIR, bdf_path):
        raise HTTPException(status_code=400, detail="허용되지 않은 BDF 경로입니다.")
    if not os.path.isfile(bdf_path):
        raise HTTPException(status_code=404, detail=f"BDF 파일을 찾을 수 없습니다: {bdf_path}")

    # ── 하중/경계조건 검증 ──────────────────────────────────────
    # load_cases 가 bcs/loads 를 인덱스로 참조하므로 배열을 필터링하지 않고 그대로 전달한다
    # (빈 세트는 _build_solved_bdf 가 스킵). 단, 유효 경계조건이 하나도 없으면 거부.
    if not any(b.nodes for b in payload.bcs):
        raise HTTPException(status_code=400, detail="경계조건(구속) 세트를 최소 1개 이상 지정하세요.")
    bcs = [b.model_dump() for b in payload.bcs]
    loads = [l.model_dump() for l in payload.loads]
    hole_rbe = (
        payload.hole_rbe.model_dump()
        if payload.hole_rbe and payload.hole_rbe.ring_node_ids
        else None
    )
    rbe3_sets = [r.model_dump() for r in payload.rbe3_sets if r.node_ids]
    load_cases = [lc.model_dump() for lc in payload.load_cases]

    # ── 해석 폴더: <work_dir>/solve_<timestamp>/ ─────────────────
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    solve_dir = os.path.join(work_dir, f"solve_{timestamp}")
    try:
        os.makedirs(solve_dir, exist_ok=True)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"해석 폴더 생성 실패: {e}")

    job_id = submit_analysis_job(
        task_execute_drawing_solve,
        solve_dir, bdf_path, payload.employee_id, timestamp, payload.source,
        mode, loads, bcs, hole_rbe, load_cases, rbe3_sets,
        queue_message="구조 해석 대기 중...",
    )
    return {
        "job_id":     job_id,
        "work_dir":   solve_dir,
        "parent_dir": work_dir,
        "mode":       mode,
        "load_sets":  len(loads),
        "bc_sets":    len(bcs),
        "rbe3_sets":  len(rbe3_sets),
        "load_cases": len(load_cases),
    }


# -------------------- ModelBuilder Analysis 구조 해석 (Stage 1: SPC1 + FORCE + SUBCASE) --------------------

class ModelBuilderBcSet(BaseModel):
    """경계조건 세트 — 선택 노드를 dof 문자열(예: '123456')로 구속 → SPC1."""
    nodes: list[int]
    dof: str = "123456"


class ModelBuilderLoadSet(BaseModel):
    """하중 세트 — 선택 노드에 동일한 힘 벡터(N)를 적용 → FORCE."""
    nodes: list[int]
    fx: float = 0.0
    fy: float = 0.0
    fz: float = 0.0


class ModelBuilderGravitySet(BaseModel):
    """중력 세트 — 가속도 크기 g(mm/s²)와 방향 (nx,ny,nz) → GRAV.

    GRAV SID 는 FORCE 와 ID 공간이 겹치지 않게 백엔드가 별도(2001+)로 부여한다.
    """
    g: float = 9810.0
    nx: float = 0.0
    ny: float = 0.0
    nz: float = -1.0


class ModelBuilderLoadCase(BaseModel):
    """Load Case — 경계조건(bc_ids)·하중(load_ids)·중력(gravity_ids) 세트의 조합 = SUBCASE.

    bc_ids / load_ids / gravity_ids 는 각각 bcs / loads / gravities 배열의 인덱스(0-base).
    """
    name: str = ""
    bc_ids: list[int] = []
    load_ids: list[int] = []
    gravity_ids: list[int] = []


class ModelBuilderAddedRigid(BaseModel):
    """Studio 편집으로 추가된 강체(RBE2) — 독립노드 1 + 종속노드 N + 성분(cm)."""
    independent_node: int
    dependent_nodes: list[int] = []
    cm: str = "123456"


class ModelBuilderEdits(BaseModel):
    """Studio(model-studio) 모델 편집 결과 — 실제 Nastran ID 로 해소된 삭제/추가 목록.

    그룹 삭제 등 편집을 해석용 BDF 에 그대로 반영하기 위한 입력.
    (deleteGroup → computeDeleteMask 가 노드/요소/RBE 실제 ID 로 변환해 전달)
    """
    deleted_node_ids: list[int] = []
    deleted_element_ids: list[int] = []
    removed_rigid_ids: list[int] = []
    added_rigids: list[ModelBuilderAddedRigid] = []


class ModelBuilderSolveRequest(BaseModel):
    """ModelFlow 빌드 BDF 에 하중/경계조건/중력을 반영해 Nastran 해석을 실행하는 요청.

    SPC + FORCE + GRAV(중력) + 모델 편집(삭제/추가) + 다중 SUBCASE 지원.
    """
    employee_id: str
    work_dir: str               # ModelFlow 빌드 결과 폴더 (BDF 가 있는 폴더, 절대 경로)
    bdf_path: str               # 해석 대상 BDF 절대 경로 (ModelFlow 최종 산출)
    bcs: list[ModelBuilderBcSet] = []
    loads: list[ModelBuilderLoadSet] = []
    gravities: list[ModelBuilderGravitySet] = []
    load_cases: list[ModelBuilderLoadCase] = []
    edits: Optional[ModelBuilderEdits] = None   # Studio 모델 편집(그룹/요소 삭제 등) 반영
    source: str = "ModelBuilder-Solve"


def _resolve_final_bdf(work_dir: str) -> Optional[str]:
    """work_dir 에서 ModelFlow 최종 산출 BDF(<designName>.bdf)를 자동으로 찾는다.

    제외 대상:
      - phase 파일: 이름이 두 자리 숫자 + '_' 로 시작(예: 00_InputAudit, 03_Mesh.bdf)
      - 과거 solve 산출물: solved_model.bdf
    여러 후보가 있으면 가장 최근 수정본을 고른다. 후보가 없으면 None.
    (재귀 탐색하지 않으므로 solve_<ts>/ 하위의 solved_model.bdf 는 자연히 제외된다.)
    """
    try:
        names = os.listdir(work_dir)
    except OSError:
        return None
    candidates: list[str] = []
    for fn in names:
        low = fn.lower()
        if not low.endswith(".bdf"):
            continue
        if low == "solved_model.bdf":
            continue
        if len(fn) >= 3 and fn[0:2].isdigit() and fn[2] == "_":
            continue  # phase 파일
        full = os.path.join(work_dir, fn)
        if os.path.isfile(full):
            candidates.append(full)
    if not candidates:
        return None
    candidates.sort(key=lambda pth: os.path.getmtime(pth), reverse=True)
    return candidates[0]


@router.post("/analysis/modelbuilder/solve")
async def solve_modelbuilder_model(
    payload: ModelBuilderSolveRequest,
    current_user: str = Depends(require_auth),
):
    """ModelFlow 빌드 BDF 에 사용자 SPC1/FORCE/SUBCASE 를 주입하고 Nastran(SOL 101)을 실행.

    결과 저장 위치: <work_dir>/solve_<timestamp>/
    """
    _verify_employee_self(payload.employee_id, current_user)

    # ── work_dir / bdf 경로 검증 (userConnection 외부 접근 차단) ──
    work_dir = os.path.abspath(payload.work_dir or "")
    if not _is_within_dir(_USER_CONNECTION_DIR, work_dir):
        raise HTTPException(status_code=400, detail="허용되지 않은 work_dir 입니다.")
    if not os.path.isdir(work_dir):
        raise HTTPException(status_code=404, detail=f"작업 폴더를 찾을 수 없습니다: {work_dir}")

    bdf_path_raw = (payload.bdf_path or "").strip()
    if bdf_path_raw:
        bdf_path = os.path.abspath(bdf_path_raw)
        if not _is_within_dir(_USER_CONNECTION_DIR, bdf_path):
            raise HTTPException(status_code=400, detail="허용되지 않은 BDF 경로입니다.")
        if not os.path.isfile(bdf_path):
            raise HTTPException(status_code=404, detail=f"BDF 파일을 찾을 수 없습니다: {bdf_path}")
    else:
        # Studio 는 서버측 최종 BDF 경로를 모르므로 bdf_path 를 비워 보낸다.
        # → work_dir(ModelFlow 빌드 산출 폴더)에서 phase 파일(NN_*.bdf)·과거 solve 산출물을 제외한
        #   "최종 산출 BDF"(<designName>.bdf)를 자동 해소한다(빌드 최종 산출물이 하나라는 전제).
        bdf_path = _resolve_final_bdf(work_dir)
        if not bdf_path:
            raise HTTPException(
                status_code=404,
                detail="work_dir 에서 최종 BDF 를 찾을 수 없습니다. ModelFlow 빌드를 먼저 완료하세요.",
            )

    # ── 하중/경계조건 검증 ──────────────────────────────────────
    # load_cases 가 bcs/loads 를 인덱스로 참조하므로 배열을 필터링하지 않고 그대로 전달한다
    # (빈 세트는 _build_solved_bdf 가 스킵). 단, 유효 경계조건이 하나도 없으면 거부.
    if not any(b.nodes for b in payload.bcs):
        raise HTTPException(status_code=400, detail="경계조건(구속) 세트를 최소 1개 이상 지정하세요.")
    bcs = [b.model_dump() for b in payload.bcs]
    loads = [l.model_dump() for l in payload.loads]
    gravities = [g.model_dump() for g in payload.gravities]
    load_cases = [lc.model_dump() for lc in payload.load_cases]
    edits = payload.edits.model_dump() if payload.edits else None

    # ── 해석 폴더: <work_dir>/solve_<timestamp>/ ─────────────────
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    solve_dir = os.path.join(work_dir, f"solve_{timestamp}")
    try:
        os.makedirs(solve_dir, exist_ok=True)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"해석 폴더 생성 실패: {e}")

    job_id = submit_analysis_job(
        task_execute_modelbuilder_solve,
        solve_dir, bdf_path, payload.employee_id, timestamp, payload.source,
        loads, bcs, load_cases, gravities, edits,
        queue_message="ModelBuilder 구조 해석 대기 중...",
    )
    return {
        "job_id":     job_id,
        "work_dir":   solve_dir,
        "parent_dir": work_dir,
        "load_sets":  len(loads),
        "bc_sets":    len(bcs),
        "grav_sets":  len(gravities),
        "load_cases": len(load_cases),
        "edits": {
            "deleted_nodes":    len((edits or {}).get("deleted_node_ids") or []),
            "deleted_elements": len((edits or {}).get("deleted_element_ids") or []),
            "removed_rigids":   len((edits or {}).get("removed_rigid_ids") or []),
            "added_rigids":     len((edits or {}).get("added_rigids") or []),
        } if edits else None,
    }


# ==================== 단건 조회 ====================

@router.get("/analysis/{analysis_id}")
def get_analysis_by_id(analysis_id: int, db: Session = Depends(database.get_db), current_user: str = Depends(require_auth)):
    """DB에 저장된 특정 해석 기록을 ID로 조회합니다."""
    record = db.query(models.Analysis).filter(models.Analysis.id == analysis_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Analysis record not found")
    if record.employee_id != current_user:
        user = db.query(models.User).filter(models.User.employee_id == current_user).first()
        if not user or not user.is_admin:
            raise HTTPException(status_code=403, detail="접근 권한이 없는 해석 기록입니다.")
    return _serialize_analysis(record)


# ==================== 작업 상태 조회 ====================

@router.get("/analysis/status/{job_id}")
def get_job_status(job_id: str, db: Session = Depends(database.get_db), current_user: str = Depends(require_auth)):
    """
    특정 Job ID의 현재 진행 상태를 반환합니다.
    """
    status = job_status_store.get(job_id)
    if status:
        assert_current_user_can_access_job(job_id, current_user, db, status)
        return status
    record = db.query(models.Analysis).filter(models.Analysis.job_id == job_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Job not found")
    if record.employee_id != current_user:
        user = db.query(models.User).filter(models.User.employee_id == current_user).first()
        if not user or not user.is_admin:
            raise HTTPException(status_code=403, detail="접근 권한이 없는 작업입니다.")
    return {
        "status": record.job_status or record.status,
        "progress": record.progress if record.progress is not None else 100,
        "message": record.job_message or record.status,
        "project": _serialize_analysis(record),
    }


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
        if parent.program_name not in ("GroupModuleUnit", "SidePassage"):
            raise HTTPException(
                status_code=400,
                detail=f"Parent program_name '{parent.program_name}' is not supported",
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
    if not _is_within_dir(user_root_cmp, bdf_cmp):
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
    if not _is_within_dir(work_dir, target_path):
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
    if not _is_within_dir(user_root, posture_abs):
        raise HTTPException(
            status_code=400,
            detail="posturePath 가 userConnection 디렉터리 밖에 있습니다.",
        )
    if not os.path.isfile(posture_abs):
        raise HTTPException(status_code=400, detail=f"posturePath 가 파일이 아닙니다: {posture_abs}")

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    job_id = submit_analysis_job(
        task_execute_module_stability,
        posture_abs,
        current_user,
        timestamp,
        req.source or "ModuleUnitStudio",
        queue_message="자세안정성 해석 대기 중...",
    )

    return {"job_id": job_id, "jobId": job_id}


@router.get("/analysis/module-stability/{job_id}/status")
async def get_module_stability_status(
    job_id: str,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """ModuleUnitStudio 전용 job status alias."""
    return get_job_status(job_id, db, current_user)


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
    NastranBridge (`nastran_bridge.py`) 로 BDF 모델 JSON 을 산출하고
    프론트 ValidationStepLog 가 기대하는 step1 schema 로 변환한다.
    use_nastran=True 인 경우 추후 단계에서 validate-run 으로 F06 검증까지 확장한다.
    """
    _verify_employee_self(employee_id, current_user)
    program_name = "SidePassage" if str(source).lower() == "sidepassage" else "GroupModuleUnit"
    work_dir, timestamp = make_work_dir(employee_id, program_name)
    bdf_path = await save_upload(bdf_file, work_dir, error_prefix="파일 저장 오류")
    job_id = submit_analysis_job(
        task_execute_groupmoduleunit,
        bdf_path, work_dir, employee_id, timestamp, source, use_nastran, program_name,
    )
    return {"job_id": job_id}


@router.post("/analysis/sidepassage/request")
async def request_sidepassage(
        bdf_file: UploadFile = File(...),
        employee_id: str = Form(...),
        use_nastran: bool = Form(False),
        source: str = Form("Workbench"),
        current_user: str = Depends(require_auth)
):
    """
    Side Passage Assessment — Step1 BDF 입력 검증.
    GroupModuleUnit 검증 엔진은 재사용하되 userConnection 폴더명과 DB program_name 은
    SidePassage 로 기록한다.
    """
    _verify_employee_self(employee_id, current_user)
    work_dir, timestamp = make_work_dir(employee_id, "SidePassage")
    bdf_path = await save_upload(bdf_file, work_dir, error_prefix="파일 저장 오류")
    job_id = submit_analysis_job(
        task_execute_groupmoduleunit,
        bdf_path, work_dir, employee_id, timestamp, source, use_nastran, "SidePassage",
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
    if not _is_within_dir(_USER_CONNECTION_DIR, abs_path):
        raise HTTPException(status_code=400, detail="허용되지 않은 파일 경로입니다.")
    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="BDF 파일을 찾을 수 없습니다.")

    program_name = "SidePassage" if str(source).lower() == "sidepassage" else "GroupModuleUnit"
    work_dir, timestamp = make_work_dir(employee_id, program_name)
    bdf_path = os.path.join(work_dir, os.path.basename(abs_path))
    try:
        shutil.copy2(abs_path, bdf_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 복사 오류: {str(e)}")

    job_id = submit_analysis_job(
        task_execute_groupmoduleunit,
        bdf_path, work_dir, employee_id, timestamp, source, use_nastran, program_name,
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
        if parent.program_name not in ("GroupModuleUnit", "SidePassage"):
            raise HTTPException(status_code=400,
                                detail=f"Parent program_name '{parent.program_name}' is not supported")
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
    if not _is_within_dir(user_root_abs, stab_abs):
        raise HTTPException(status_code=400,
                            detail="stability_path 가 userConnection 디렉터리 안에 있지 않습니다.")
    if os.path.dirname(stab_abs) != bdf_dir_abs:
        raise HTTPException(status_code=400,
                            detail="stability_path 가 parent BDF 와 같은 폴더에 있지 않습니다.")
    if not os.path.exists(stab_abs):
        raise HTTPException(status_code=400, detail=f"stability_path 파일을 찾을 수 없습니다: {stab_abs}")

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    job_id = submit_analysis_job(
        task_execute_unit_structural,
        parent_analysis_id, stab_abs,
        safety_factor, allowable_mpa,
        employee_id, timestamp, source,
        queue_message="Waiting in Queue...",
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


# ==================== 선급 Rule 기반 선체 가속도 Calculation ====================

@router.post("/analysis/hullacceleration/request")
async def request_hull_acceleration(
        pdf_file: UploadFile = File(...),
        employee_id: str = Form(...),
        source: str = Form("Workbench"),
        constants: Optional[str] = Form(None),
        condition_overrides: Optional[str] = Form(None),
        current_user: str = Depends(require_auth)
):
    """
    선급 Rule 기반 선체 가속도 Calculation 요청.
    Trim & Stability Booklet 류 PDF 를 저장하고 백그라운드로 엔진을 실행하여
    'Summary of Loading Conditions' 표를 JSON/CSV/TXT 로 추출합니다.
    """
    _verify_employee_self(employee_id, current_user)
    work_dir, timestamp = make_work_dir(employee_id, "HullAcceleration")
    pdf_path = await save_upload(pdf_file, work_dir, error_prefix="파일 저장 오류")
    constants_path = os.path.join(work_dir, "constants.json")
    overrides_path = os.path.join(work_dir, "condition_overrides.json")
    try:
        with open(constants_path, "w", encoding="utf-8") as f:
            json.dump(json.loads(constants) if constants else {}, f, ensure_ascii=False, indent=2)
        if condition_overrides:
            with open(overrides_path, "w", encoding="utf-8") as f:
                json.dump(json.loads(condition_overrides), f, ensure_ascii=False, indent=2)
        else:
            overrides_path = None
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"constants JSON 형식이 올바르지 않습니다: {exc}") from exc
    job_id = submit_analysis_job(
        task_execute_hull_acceleration, pdf_path, work_dir, employee_id, timestamp, source, constants_path, overrides_path,
    )
    return {"job_id": job_id}


# ==================== Mooring Fitting Assessment ====================

@router.post("/analysis/mooring-fitting/request")
async def request_mooring_fitting(
        structure_file: UploadFile = File(...),
        load_file: UploadFile = File(...),
        employee_id: str = Form(...),
        source: str = Form("Workbench"),
        mf_safety_factor: str = Form("1.25"),
        current_user: str = Depends(require_auth)
):
    """
    Mooring Fitting Assessment 해석 요청.
    Structure CSV 와 Load CSV 를 userConnection 작업 폴더에 표준 파일명
    (MooringFittingData.csv, MooringFittingDataLoad.csv) 으로 저장한 뒤
    MooringFitting.exe build-full <work_dir> --mf-sf=<sf> 를 백그라운드로 실행한다.

    mf_safety_factor: MF(Mooring Fitting) 하중 전용 안전계수(기본 1.25). Winch 하중에는 미적용.
    엔진이 P = SWL × 1000 × SF 로 곱한다. 비정상/≤0 값은 1.25로 폴백(엔진도 2중 검증).
    """
    _verify_employee_self(employee_id, current_user)
    try:
        mf_sf = float(mf_safety_factor)
        if mf_sf <= 1e-9:
            mf_sf = 1.25
    except (TypeError, ValueError):
        mf_sf = 1.25
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
        employee_id, timestamp, source, mf_sf,
    )
    return {"job_id": job_id}


# 최종 element 끝점이 원본 부재 선분 위에 있다고 볼 허용 수직거리(mm).
# 파이프라인의 collinearDistTolMm(20) 보다 약간 넉넉히 — 분할/스냅 오차 흡수.
_ELEM_NAME_MATCH_TOL_MM = 25.0


def _build_mooring_element_names(out_dir: str, stage07_data: dict) -> dict:
    """STAGE_00.initial.json 의 원본 부재(소스 CSV 행)에 최종 element 를 기하 매칭한다.

    초기 FE 모델(STAGE_00.initial.json)의 각 element 는 source.id(=CSV B열 고유명),
    source.lineNumber(=CSV 행번호), source.kind, feCoords(끝점 선분)를 보유한다.
    최종 element(stage07)의 양 끝점이 어떤 원본 선분 위에(허용오차 이내) 놓이는지로
    부재명을 전파한다 → mesh refine / collinear overlap / intersection 으로 쪼개진
    조각까지 모두 원본 부재명을 회수(LINEAGE derivatives 만으로는 미추적되는 부분 포함).
    어느 원본 선분과도 떨어진 연결부(ExtendToBBoxIntersect 등)는 매칭에서 제외된다.

    반환: { "<EID>": {"name": str, "line": int|None, "kind": str|None} }
    """
    import json as _json

    init_path = os.path.join(out_dir, "STAGE_00.initial.json")
    if not os.path.isfile(init_path):
        return {}
    try:
        with open(init_path, "r", encoding="utf-8") as fh:
            init = _json.load(fh)
    except Exception as exc:
        logger.warning("[mooring viewer-zip] initial.json 파싱 실패: %s", exc)
        return {}

    # 원본 named 선분 수집: (name, kind, line, ax, ay, az, bx, by, bz)
    segs = []
    for el in (init.get("elements") or []):
        src = el.get("source") or {}
        name = src.get("id") or (el.get("extraData") or {}).get("ID")
        if not name:
            continue
        fc = el.get("feCoords") or {}
        a, b = fc.get("a"), fc.get("b")
        if not (a and b):
            oc = src.get("originalCoords") or {}
            a, b = oc.get("a"), oc.get("b")
        if not (a and b) or len(a) < 3 or len(b) < 3:
            continue
        try:
            segs.append((str(name), src.get("kind"), src.get("lineNumber"),
                         float(a[0]), float(a[1]), float(a[2]),
                         float(b[0]), float(b[1]), float(b[2])))
        except (TypeError, ValueError):
            continue
    if not segs:
        return {}

    npos = {n.get("id"): n for n in (stage07_data.get("nodes") or [])}
    tol2 = _ELEM_NAME_MATCH_TOL_MM * _ELEM_NAME_MATCH_TOL_MM

    def _pt_seg_d2(px, py, pz, ax, ay, az, bx, by, bz):
        """점(p)–선분(a,b) 최단거리². 투영 매개변수 t 는 [0,1] 로 클램프(끝 넘어가면 거리↑)."""
        dx, dy, dz = bx - ax, by - ay, bz - az
        lsq = dx * dx + dy * dy + dz * dz
        if lsq <= 1e-9:
            ex, ey, ez = px - ax, py - ay, pz - az
            return ex * ex + ey * ey + ez * ez
        t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / lsq
        t = 0.0 if t < 0 else (1.0 if t > 1 else t)
        cx, cy, cz = ax + t * dx, ay + t * dy, az + t * dz
        ex, ey, ez = px - cx, py - cy, pz - cz
        return ex * ex + ey * ey + ez * ez

    out = {}
    for el in (stage07_data.get("elements") or []):
        sn, en = el.get("startNode"), el.get("endNode")
        if sn is None or en is None:
            continue   # 빔(라인) element 만 — 쉘/기타 제외
        na, nb = npos.get(sn), npos.get(en)
        if not na or not nb:
            continue
        ax, ay, az = na.get("x"), na.get("y"), na.get("z")
        bx, by, bz = nb.get("x"), nb.get("y"), nb.get("z")
        if None in (ax, ay, az, bx, by, bz):
            continue
        best = None
        best_d = tol2
        for s in segs:
            da = _pt_seg_d2(ax, ay, az, *s[3:])
            if da > best_d:
                continue
            db = _pt_seg_d2(bx, by, bz, *s[3:])
            d = da if da > db else db   # 두 끝점 모두 선분 위 → 더 먼 쪽 기준
            if d <= best_d:
                best_d = d
                best = s
        if best is None:
            continue
        entry = {"name": best[0]}
        if best[2] is not None:
            entry["line"] = best[2]
        if best[1]:
            entry["kind"] = best[1]
        out[str(el.get("id"))] = entry
    return out


@router.get("/analysis/mooring-fitting/viewer-zip")
def get_mooring_fitting_viewer_zip(
    output_dir: str = Query(..., description="MooringFitting out/ 폴더 절대경로 (userConnection 하위)"),
    current_user: str = Depends(require_auth),
    db: Session = Depends(database.get_db),
):
    """out/ 폴더의 Stage_00/07 BDF 를 nastran_bridge 로 변환 후 zip 반환.

    StreamingResponse + BytesIO 조합은 h11 LocalProtocolError 를 유발하므로
    bytes 를 일괄 빌드한 뒤 Response 로 반환한다 (modelflow/result-zip 과 동일 패턴).
    """
    if not _NB_AVAILABLE:
        raise HTTPException(status_code=500, detail="nastran_bridge 모듈 없음")

    try:
        abs_dir = _validate_userconnection_path(output_dir)
        assert_current_user_can_access_path(abs_dir, current_user, db, _ALLOWED_DOWNLOAD_BASE)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"경로 검증 실패: {e}")

    if not os.path.isdir(abs_dir):
        raise HTTPException(status_code=404, detail=f"output_dir 없음: {abs_dir}")

    bdf_map = {
        "stage00.json": "STAGE_00_BuildRaw.bdf",
        "stage07.json": "STAGE_07_FinalValidation.bdf",
    }
    # Studio 의 readJsonFolderRecursive 는 .json 만 읽으므로
    # MF/Winch 하중 리포트 CSV 를 백엔드에서 JSON 으로 변환해 zip 에 동봉한다.
    loads_csv_map = {
        "loads_mf.json":    "Report_LoadCalculation_MF.csv",
        "loads_winch.json": "Report_LoadCalculation_Winch.csv",
    }

    import csv as _csv
    import json as _json

    def _read_csv_rows(path: str) -> list[dict]:
        try:
            with open(path, "r", encoding="utf-8-sig", newline="") as fh:
                return list(_csv.DictReader(fh))
        except Exception as exc:
            logger.warning("[mooring viewer-zip] CSV 읽기 실패: %s — %s", path, exc)
            return []

    buf = io.BytesIO()
    stage07_data = None   # 변환된 최종 모델(노드 좌표+element) — element_names 기하 매칭용
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for json_name, bdf_name in bdf_map.items():
            bdf_path = os.path.join(abs_dir, bdf_name)
            if not os.path.isfile(bdf_path):
                logger.warning("[mooring viewer-zip] BDF 없음, 스킵: %s", bdf_path)
                continue
            try:
                from pathlib import Path as _Path
                data = _nb.convert_bdf(_Path(bdf_path))
                zf.writestr(json_name, _json.dumps(data, ensure_ascii=False))
                if json_name == "stage07.json":
                    stage07_data = data
                logger.info("[mooring viewer-zip] 변환 완료: %s → %s", bdf_name, json_name)
            except Exception as e:
                logger.exception("[mooring viewer-zip] BDF 변환 실패: %s", bdf_path)
                raise HTTPException(status_code=500, detail=f"BDF 변환 실패 ({bdf_name}): {e}")

        # Loads CSV → JSON 동봉 (없으면 스킵)
        for out_name, csv_name in loads_csv_map.items():
            csv_path = os.path.join(abs_dir, csv_name)
            if not os.path.isfile(csv_path):
                logger.info("[mooring viewer-zip] CSV 없음, 스킵: %s", csv_path)
                continue
            rows = _read_csv_rows(csv_path)
            payload = {"source": csv_name, "rows": rows}
            # MF 하중에만 안전계수 노출: 리포트 SF 컬럼의 첫 유효 데이터행 값을 top-level 로 끌어올린다.
            # (Studio MF Loads 배지가 payload.safetyFactor 를 우선 읽고, 없으면 rows[].SF 로 폴백).
            if out_name == "loads_mf.json":
                sf_val = None
                for _r in rows:
                    _raw = (_r.get("SF") or "").strip()
                    if _raw:
                        try:
                            sf_val = float(_raw)
                            break
                        except ValueError:
                            continue
                payload["safetyFactor"] = sf_val if sf_val is not None else 1.0
            zf.writestr(out_name, _json.dumps(payload, ensure_ascii=False))
            logger.info("[mooring viewer-zip] CSV 동봉: %s (%d rows)", out_name, len(rows))

        # element_names.json — 최종 EID → 원본 부재(CSV B열 고유명 + CSV 행번호).
        # STAGE_00.initial.json 의 named 선분에 기하 매칭. 뷰어에서 부재 선택 시 CSV 대조용.
        # 파일 없거나 실패하면 조용히 스킵(뷰어가 폴백 처리).
        try:
            if stage07_data is not None:
                names = _build_mooring_element_names(abs_dir, stage07_data)
                if names:
                    zf.writestr(
                        "element_names.json",
                        _json.dumps(
                            {"source": "STAGE_00.initial.json", "names": names},
                            ensure_ascii=False,
                        ),
                    )
                    logger.info("[mooring viewer-zip] element_names 동봉: %d개", len(names))
        except Exception as exc:
            logger.warning("[mooring viewer-zip] element_names 생성 실패(스킵): %s", exc)

    body = buf.getvalue()
    if not body:
        raise HTTPException(status_code=500, detail="zip 이 비어 있음 — BDF 파일을 확인하세요")

    fname = f"mooring-studio-{os.path.basename(os.path.dirname(abs_dir))}.zip"
    return Response(
        content=body,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.post("/analysis/mooring-fitting/apply-edit")
async def apply_mooring_fitting_edit(
    request: Request,
    current_user: str = Depends(require_auth),
    db: Session = Depends(database.get_db),
):
    """intents 를 원본 STAGE_07 BDF 에 적용해 편집 반영 solvable BDF 를 저장한다.

    Body JSON: { folderPath: str, intents: list }
      folderPath = userConnection 하위 MooringFitting out/ 폴더 (원본 STAGE_07 BDF 보유).
    동작(solve 와 동일한 BDF 빌드, Nastran 실행만 생략):
      STAGE_07_FinalValidation.bdf → convert_bdf → apply_edit_json(intents)
      → _build_solvable_edited_bdf → mooring_fitting_edited.bdf 저장.
      stage07.json(디스크 미존재) 의존을 제거하여 mooring out 폴더에서 항상 동작.
    반환: { ok, bdfPath, summary }  → 호출측이 /api/download 로 회수.
    """
    if not _NB_AVAILABLE:
        raise HTTPException(status_code=500, detail="nastran_bridge 모듈 없음")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="JSON body 파싱 실패")

    folder_path = body.get("folderPath")
    intents = body.get("intents")
    if not folder_path or not isinstance(intents, list):
        raise HTTPException(status_code=400, detail="folderPath 와 intents 는 필수")

    try:
        abs_folder = _validate_userconnection_path(folder_path)
        assert_current_user_can_access_path(abs_folder, current_user, db, _ALLOWED_DOWNLOAD_BASE)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"경로 검증 실패: {e}")

    bdf_path = os.path.join(abs_folder, "STAGE_07_FinalValidation.bdf")
    if not os.path.isfile(bdf_path):
        raise HTTPException(status_code=404, detail=f"원본 BDF 없음: {bdf_path}")

    import copy as _copy
    from pathlib import Path as _Path

    try:
        base_data = _nb.convert_bdf(_Path(bdf_path))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BDF 변환 실패: {e}")

    edited = base_data
    summary = {"applied": 0}
    if intents:
        try:
            edited, summary = _nb.apply_edit_json(
                _copy.deepcopy(base_data), {"schemaVersion": "1.0", "intents": intents}
            )
        except SystemExit as e:
            raise HTTPException(status_code=400, detail=f"편집 적용 실패: {e}")
        except Exception as e:
            logger.exception("[mooring apply-edit] apply_edit_json 실패")
            raise HTTPException(status_code=500, detail=f"편집 적용 실패: {e}")

    try:
        original_text = _Path(bdf_path).read_text(encoding="utf-8", errors="replace")
        bdf_text = _build_solvable_edited_bdf(original_text, edited)
    except Exception as e:
        logger.exception("[mooring apply-edit] solvable BDF 생성 실패")
        raise HTTPException(status_code=500, detail=f"BDF 생성 실패: {e}")

    output_bdf = os.path.join(abs_folder, "mooring_fitting_edited.bdf")
    try:
        _Path(output_bdf).write_text(bdf_text, encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BDF 저장 실패: {e}")

    logger.info("[mooring apply-edit] 완료: %s (applied=%d)", output_bdf, summary.get("applied", 0))
    return {"ok": True, "bdfPath": output_bdf, "summary": summary}


# ── Side Passage Studio: Check Plate → 원본 양식 보존 최종 BDF ──────────────
# 스튜디오의 손실 JS 라이터(bdfExport.js: free-field CBAR/PBAR, CONM2/하중/deck 누락) 대신
# 원본 업로드 BDF 를 convert_bdf → convert_json_to_bdf 로 재생성해 양식을 보존한다(라이터 일원화).
# check plate 는 좌표 기반 스펙(cornerCoords)이라 원본 BDF 의 노드 id 체계와 무관하게 반영된다.
_SP_DERIVED_BDF_SUFFIXES = (
    "_lifting.bdf", "_checkplate.bdf", "_edited.bdf", "_edit.bdf", "_solve.bdf",
)


def _find_original_sidepassage_bdf(abs_folder: str, bdf_name: str | None) -> str | None:
    """SidePassage 폴더에서 '원본' 업로드 BDF 경로를 고른다.

    bdf_name(파일명) 이 주어지고 실제 존재하면 그걸 신뢰한다. 없으면 폴더의 .bdf 중
    파생본(_lifting/_checkplate/_edited…)을 제외한 것을 우선 후보로 삼고 사전순 첫 항목을 쓴다.
    """
    if isinstance(bdf_name, str) and bdf_name.strip():
        cand = os.path.join(abs_folder, os.path.basename(bdf_name.strip()))
        if os.path.isfile(cand):
            return cand
    try:
        bdfs = [f for f in os.listdir(abs_folder) if f.lower().endswith(".bdf")]
    except OSError:
        return None
    originals = [f for f in bdfs
                 if not any(f.lower().endswith(s) for s in _SP_DERIVED_BDF_SUFFIXES)]
    pick = sorted(originals or bdfs)
    return os.path.join(abs_folder, pick[0]) if pick else None


@router.post("/analysis/sidepassage/checkplate-export")
async def export_sidepassage_checkplate(
    request: Request,
    current_user: str = Depends(require_auth),
    db: Session = Depends(database.get_db),
):
    """Side Passage Studio Check Plate → 원본 BDF 양식을 보존한 최종 BDF 생성.

    Body JSON: { folderPath: str, checkPlates: list, bdfName?: str }
      folderPath = userConnection 하위 SidePassage 폴더(원본 업로드 BDF 보유).
      checkPlates = 스튜디오가 만든 check plate 스펙 목록(cornerCoords/gridLines/thickness…).
      bdfName(선택) = 원본 BDF 파일명. 없으면 파생본 제외 후 추정.
    동작: 원본 BDF → convert_bdf(deck/CONM2/PBEAML 보존) → data["checkPlates"]=specs →
          convert_json_to_bdf(8칸 고정필드 재생성 + CQUAD4/PSHELL/RBE2 추가).
    반환: { ok, bdfPath, stats }  → 호출측이 /api/download 로 회수.
    """
    if not _NB_AVAILABLE:
        raise HTTPException(status_code=500, detail="nastran_bridge 모듈 없음")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="JSON body 파싱 실패")

    folder_path = body.get("folderPath")
    check_plates = body.get("checkPlates")
    bdf_name = body.get("bdfName")
    edit_intents = body.get("editIntents")  # Studio 편집 의도(RBE2 추가/삭제 등) — 선택
    if not folder_path or not isinstance(check_plates, list):
        raise HTTPException(status_code=400, detail="folderPath 와 checkPlates 는 필수")

    try:
        abs_folder = _validate_userconnection_path(folder_path)
        assert_current_user_can_access_path(abs_folder, current_user, db, _ALLOWED_DOWNLOAD_BASE)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"경로 검증 실패: {e}")
    if not os.path.isdir(abs_folder):
        raise HTTPException(status_code=404, detail=f"폴더 없음: {abs_folder}")

    bdf_path = _find_original_sidepassage_bdf(abs_folder, bdf_name)
    if not bdf_path or not os.path.isfile(bdf_path):
        raise HTTPException(status_code=404, detail="원본 BDF 를 찾을 수 없습니다.")

    from pathlib import Path as _Path
    try:
        data = _nb.convert_bdf(_Path(bdf_path))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BDF 변환 실패: {e}")

    # Studio 편집 의도(RBE2 추가/삭제·그룹 삭제 등)를 check plate 보다 먼저 반영한다.
    # ModelBuilder/Mooring 의 apply-edit-intent 와 동일한 apply_edit_json 을 사용 →
    # 사용자가 Studio 에서 만든 RBE 가 data["rigids"] 에 들어가 최종 BDF 에 RBE2 로 출력된다.
    # (편집 의도가 없으면 빈 intents 로 no-op. apply_edit_json 은 오류 시 SystemExit 을 던지므로 변환.)
    if isinstance(edit_intents, dict) and _nb.is_edit_json(edit_intents):
        try:
            data, _edit_summary = _nb.apply_edit_json(data, edit_intents)
        except SystemExit as e:
            raise HTTPException(status_code=400, detail=f"편집 적용 실패: {e}")
        except Exception as e:
            logger.exception("[sidepassage checkplate] 편집 적용 실패")
            raise HTTPException(status_code=500, detail=f"편집 적용 실패: {e}")

    # 절점 공유 RBE 정규화 — 서로 다른 RBE2 가 한 Node 에서 만나면 안 된다(사용자 규칙).
    # 편집으로 추가된 충돌은 add_rigid_from_params 가 막지만, 입력 BDF 에 이미 들어있던
    # 공유(이전 저장본 재사용 등)까지 강제 해소한다. check plate RBE2 추가 '전' 에 수행해 셸 스티치는 보존.
    try:
        merged_rbe = _nb.normalize_rigid_node_sharing(data)
        if merged_rbe:
            logger.info("[sidepassage checkplate] 절점 공유 RBE %d개 병합(절점 공유 강제 해소)", merged_rbe)
    except Exception:
        logger.exception("[sidepassage checkplate] RBE 절점공유 정규화 실패(무시)")

    # check plate 스펙 부착 → convert_json_to_bdf 내부 materialize_check_plates 가 셸/빔분할/RBE2 반영.
    specs = [s for s in check_plates if isinstance(s, dict)]
    data["checkPlates"] = specs
    try:
        bdf_text = _nb.convert_json_to_bdf(data)
    except Exception as e:
        logger.exception("[sidepassage checkplate] BDF 생성 실패")
        raise HTTPException(status_code=500, detail=f"BDF 생성 실패: {e}")

    base = os.path.splitext(os.path.basename(bdf_path))[0]
    out_path = os.path.join(abs_folder, f"{base}_checkplate.bdf")
    try:
        _Path(out_path).write_text(bdf_text, encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BDF 저장 실패: {e}")

    def _count(card: str) -> int:
        return sum(1 for ln in bdf_text.splitlines()
                   if ln[:8].strip().upper().rstrip("*") == card)
    stats = {
        "quadCount": _count("CQUAD4"),
        "triCount": _count("CTRIA3"),
        "beamCount": _count("CBEAM") + _count("CBAR"),
        "rbe2Count": _count("RBE2"),
        "checkPlates": len(specs),
    }
    logger.info("[sidepassage checkplate] 완료: %s (quad=%d, rbe2=%d)",
                out_path, stats["quadCount"], stats["rbe2Count"])
    return {"ok": True, "bdfPath": out_path, "stats": stats}


# ── Mooring 구조해석: 편집 반영 solvable BDF 생성 ──────────────────────────
# 편집 출력(convert_json_to_bdf)은 하중·구속·SUBCASE 가 없어 solve 불가하므로,
# 원본 solvable BDF 의 case control/하중/구속은 그대로 두고 element/RBE2 만 편집 반영한다.

# 8-컬럼 fixed small-field 기준 카드 분류용 집합
_SOLVE_ELEMENT_CARDS = {"CBEAM", "CBAR", "CROD", "CONROD", "CBUSH", "CTUBE", "CBEND",
                        "CQUAD4", "CTRIA3", "CHEXA", "CPENTA", "CTETRA"}
_SOLVE_RIGID_CARDS = {"RBE2", "RBE3", "RBAR", "RROD", "RTRPLT", "RSPLINE"}
# 단일 노드(필드 index 2)를 참조하는 하중/구속 카드 — 삭제 노드를 참조하면 제거
_SOLVE_SINGLE_NODE_CARDS = {"FORCE", "FORCE1", "FORCE2", "MOMENT", "MOMENT1", "MOMENT2", "SPC", "SPCD"}
# PID 가 필드 index 2(cols 16:24)에 오는 beam 계열 카드 — changeElementProperty/보강 PID 패치 대상.
# CONROD(재료 직접참조)·shell(CQUAD4/CTRIA3 의 field2 는 PID 가 아님 또는 노드)은 제외해 오패치 방지.
_PID_AT_FIELD2 = {"CBEAM", "CBAR", "CROD", "CTUBE", "CBEND", "CBUSH"}


def _build_solvable_edited_bdf(original_bdf_text: str, edited: dict) -> str:
    """원본 solvable BDF 에 편집(edited model)을 텍스트 수준으로 반영해 solvable deck 을 만든다.

    solve 가능성 보장 원칙:
      - executive/case control(SOL 101, CEND, SUBCASE, SPC=, LOAD=) 은 원본 그대로 유지.
      - GRID/element 카드는 편집 후 생존(surviving) id 만 유지 → deleteGroup 반영.
      - 하중(FORCE/MOMENT)·구속(SPC) 단일노드 카드는 생존 노드 참조분만 유지 → dangling 방지.
      - rigid 카드(RBE2 등)는 전부 제거 후 edited.rigids 로부터 재생성 → add/delete/editDependents 반영.
      - 그 외(PBEAML/MAT1/PARAM 등)는 원본 그대로 유지.
    """
    as_int = _nb.as_int
    surv_nodes = {as_int(n.get("id")) for n in (edited.get("nodes") or []) if as_int(n.get("id")) is not None}
    surv_elems = {as_int(e.get("id")) for e in (edited.get("elements") or []) if as_int(e.get("id")) is not None}
    # 노드 연결(RBE)로 종속노드가 된 노드 — 기존 SPC 제거 대상(m-set+SPC 충돌 FATAL 2101 방지)
    cleared_spc = {as_int(n) for n in (edited.get("clearedSpcNodes") or []) if as_int(n) is not None}

    lines = original_bdf_text.splitlines()
    begin_idx = None
    for i, line in enumerate(lines):
        if line.strip().upper().startswith("BEGIN BULK"):
            begin_idx = i
            break
    if begin_idx is None:
        raise ValueError("원본 BDF 에 BEGIN BULK 가 없습니다 — solvable deck 아님")
    end_idx = len(lines)
    for i in range(begin_idx + 1, len(lines)):
        if lines[i].strip().upper().startswith("ENDDATA"):
            end_idx = i
            break

    header = lines[:begin_idx + 1]          # SOL/CEND/case control + 'BEGIN BULK'
    bulk = lines[begin_idx + 1:end_idx]

    def field(line: str, n: int) -> str:
        return line[n * 8:(n + 1) * 8].strip()

    def is_continuation(line: str) -> bool:
        head = line[0:8].strip()
        return head == "" or head.startswith("+") or head.startswith("*")

    out: list[str] = []
    orig_elem_blocks: dict[int, list[str]] = {}   # 원본 element 블록(EID→블록) — 보강 복제 시 그대로 복사
    orig_node_ids: set[int] = set()               # 원본 GRID id — 편집으로 추가된 신규 노드(중심노드) 판별용
    # 편집 모델의 element(EID→dict) — 생존 element 의 PID 변경(changeElementProperty)을 deck 에 패치하기 위함.
    edited_elems_by_id = {
        as_int(e.get("id")): e
        for e in (edited.get("elements") or [])
        if as_int(e.get("id")) is not None
    }

    def _patch_pid(head: str, new_pid: int) -> str:
        """8-col 고정필드 head 라인의 PID 필드(index 2, cols 16:24)를 new_pid 로 교체."""
        return head[:16] + str(new_pid).ljust(8)[:8] + head[24:]

    i = 0
    while i < len(bulk):
        line = bulk[i]
        if not line.strip():
            i += 1
            continue
        if is_continuation(line):
            i += 1
            continue
        name = line[0:8].strip().upper().rstrip("*")
        block = [line]
        j = i + 1
        while j < len(bulk) and is_continuation(bulk[j]):
            block.append(bulk[j])
            j += 1
        i = j

        if name in _SOLVE_RIGID_CARDS:
            continue                         # 재생성
        if name in _SOLVE_ELEMENT_CARDS:
            eid = as_int(field(line, 1))
            if eid is not None:
                orig_elem_blocks[eid] = block
            if eid in surv_elems:
                # 생존 element 의 단면(PID) 변경분을 deck 에 반영(changeElementProperty).
                ej = edited_elems_by_id.get(eid)
                if name in _PID_AT_FIELD2 and ej is not None:
                    orig_pid = as_int(field(line, 2))
                    new_pid = as_int(ej.get("propertyId"))
                    if orig_pid is not None and new_pid is not None and new_pid != orig_pid:
                        out.append(_patch_pid(block[0], new_pid))
                        out.extend(block[1:])
                        continue
                out.extend(block)
            continue
        if name == "GRID":
            nid = as_int(field(line, 1))
            if nid is not None:
                orig_node_ids.add(nid)
            if nid in surv_nodes:
                out.extend(block)
            continue
        if name in _SOLVE_SINGLE_NODE_CARDS:
            gid = as_int(field(line, 2))
            # 노드 연결(RBE)된 종속 노드의 SPC/SPCD 카드는 제거(m-set+SPC 충돌 방지).
            if name in ("SPC", "SPCD") and gid is not None and gid in cleared_spc:
                continue
            if gid is None or gid in surv_nodes:
                out.extend(block)
            continue
        out.extend(block)                    # 그 외 verbatim

    # 편집으로 추가된 노드(원본 BDF 에 없던 GRID — 예: 노드 연결 중심노드) 출력. bulk 순서는 무관.
    # 원본 deck 과 동일한 고정필드(8칸) 양식으로 출력 — HyperMesh 등 프리프로세서가 free-field 카드를
    # 화면에 그리지 못하는 문제 방지(좌표는 real8 로 소수점 포함 8칸 실수).
    for node in (edited.get("nodes") or []):
        nid = as_int(node.get("id"))
        if nid is None or nid in orig_node_ids:
            continue
        out.append(_nb.bdf_line_fixed(
            "GRID", nid, "",
            _nb.as_float(node.get("x"), 0.0),
            _nb.as_float(node.get("y"), 0.0),
            _nb.as_float(node.get("z"), 0.0),
        ))

    # 편집으로 추가된 보강 element(원본 BDF 라인 없음) — reinforceOf 원본 블록을 새 EID 로 복제 출력.
    # 원본 블록을 통째로 복사하므로 PID/방향/offset/pin 등 모든 필드가 원본과 동일(=참된 이중부재).
    orig_elem_ids = set(orig_elem_blocks.keys())
    for elem in (edited.get("elements") or []):
        eid = as_int(elem.get("id"))
        if eid is None or eid in orig_elem_ids:
            continue                         # 원본에 있던 element(생존분은 위 루프에서 처리)
        ga = as_int(elem.get("startNode"))
        gb = as_int(elem.get("endNode"))
        if ga not in surv_nodes or gb not in surv_nodes:
            continue                         # 끊긴 노드 참조 방지
        src_block = orig_elem_blocks.get(as_int(elem.get("reinforceOf")))
        if not src_block:
            continue                         # 복제 출처 불명(현재 범위는 duplicateElement 만)
        head = src_block[0]
        head = head[:8] + str(eid).ljust(8)[:8] + head[16:]        # 카드명 유지 + EID 필드 교체
        # 참조 단면 복사 등으로 clone 의 PID 가 source 와 다르면 PID 필드도 패치(beam 계열만).
        name = src_block[0][0:8].strip().upper().rstrip("*")
        if name in _PID_AT_FIELD2:
            clone_pid = as_int(elem.get("propertyId"))
            src_pid = as_int(field(src_block[0], 2))
            if clone_pid is not None and src_pid is not None and clone_pid != src_pid:
                head = _patch_pid(head, clone_pid)
        out.append(head)
        out.extend(src_block[1:])                                   # 연속행(offset/pin 등) 그대로

    for rigid in sorted(edited.get("rigids") or [], key=lambda r: as_int(r.get("id")) or 0):
        rid = as_int(rigid.get("id"))
        if rid is None:
            continue
        indep = as_int(rigid.get("independentNode"))
        cm = rigid.get("cm") or "123456"
        deps = [n for n in (as_int(v) for v in (rigid.get("dependentNodes") or [])) if n is not None]
        if not deps:
            continue
        # 원본 deck 과 동일한 고정필드(8칸) 양식으로 RBE2 출력 — HyperMesh 가 화면에 표시하도록.
        # (free-field 콤마 양식은 Nastran 은 풀지만 일부 프리프로세서가 렌더링하지 못함)
        out.extend(_nb.rbe2_fixed_lines(rid, indep, cm, deps))

    return "\n".join([*header, *out, "ENDDATA"]) + "\n"


@router.post("/analysis/mooring-fitting/solve")
async def solve_mooring_fitting(
    request: Request,
    current_user: str = Depends(require_auth),
    db: Session = Depends(database.get_db),
):
    """Studio 편집 모델 구조해석.

    Body JSON: { output_dir: str, intents?: list, yieldStrength?: float, gammaM?: float }
      output_dir = userConnection 하위 MooringFitting out/ 폴더 (원본 STAGE_07 BDF 보유).
      yieldStrength = 항복강도 σy [MPa] (기본 315, AH32). gammaM = 재료계수 γM (기본 1.0).
    동작: 원본 BDF → convert_bdf → apply_edit_json(intents) → 편집 반영 solvable BDF +
          편집 모델 JSON 저장 → MooringFitting.exe solve-bdf 백그라운드 실행 (von Mises + Usage 판정).
    반환: { job_id }  → 이후 /analysis/status/{job_id} 폴링, result_info.nastranResultJson 회수.
    """
    if not _NB_AVAILABLE:
        raise HTTPException(status_code=500, detail="nastran_bridge 모듈 없음")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="JSON body 파싱 실패")

    output_dir = body.get("output_dir") or body.get("outputDir")
    intents = body.get("intents") or []
    if not output_dir:
        raise HTTPException(status_code=400, detail="output_dir 는 필수입니다")
    if not isinstance(intents, list):
        raise HTTPException(status_code=400, detail="intents 는 list 여야 합니다")

    # 평가 파라미터 — Usage = σeff/(σy/γM). 비정상/누락 값은 기본값으로 폴백.
    def _pos_float(val, default: float) -> float:
        try:
            f = float(val)
            return f if f > 1e-9 else default
        except (TypeError, ValueError):
            return default

    yield_strength = _pos_float(body.get("yieldStrength"), 315.0)
    gamma_m = _pos_float(body.get("gammaM"), 1.0)

    try:
        abs_dir = _validate_userconnection_path(output_dir)
        assert_current_user_can_access_path(abs_dir, current_user, db, _ALLOWED_DOWNLOAD_BASE)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"경로 검증 실패: {e}")
    if not os.path.isdir(abs_dir):
        raise HTTPException(status_code=404, detail=f"output_dir 없음: {abs_dir}")

    bdf_path = os.path.join(abs_dir, "STAGE_07_FinalValidation.bdf")
    if not os.path.isfile(bdf_path):
        raise HTTPException(status_code=404, detail=f"원본 BDF 없음: {bdf_path}")

    import copy as _copy
    import json as _json
    import time as _time
    from pathlib import Path as _Path

    try:
        base_data = _nb.convert_bdf(_Path(bdf_path))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BDF 변환 실패: {e}")

    edited = base_data
    edit_summary = {"applied": 0}
    if intents:
        try:
            edited, edit_summary = _nb.apply_edit_json(
                _copy.deepcopy(base_data), {"schemaVersion": "1.0", "intents": intents}
            )
        except SystemExit as e:
            raise HTTPException(status_code=400, detail=f"편집 적용 실패: {e}")
        except Exception as e:
            logger.exception("[mooring solve] apply_edit_json 실패")
            raise HTTPException(status_code=500, detail=f"편집 적용 실패: {e}")

    try:
        original_text = _Path(bdf_path).read_text(encoding="utf-8", errors="replace")
        solve_bdf_text = _build_solvable_edited_bdf(original_text, edited)
    except Exception as e:
        logger.exception("[mooring solve] solvable BDF 생성 실패")
        raise HTTPException(status_code=500, detail=f"solvable BDF 생성 실패: {e}")

    solve_bdf_path   = os.path.join(abs_dir, "mooring_solve.bdf")
    solve_model_path = os.path.join(abs_dir, "mooring_solve.model.json")
    result_json_path = os.path.join(abs_dir, "mooring_solve.result.json")
    try:
        _Path(solve_bdf_path).write_text(solve_bdf_text, encoding="utf-8")
        _Path(solve_model_path).write_text(_json.dumps(edited, ensure_ascii=False), encoding="utf-8")
        if os.path.isfile(result_json_path):
            os.remove(result_json_path)   # stale 결과 제거
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"solve 입력 저장 실패: {e}")

    exe_path = os.path.abspath(os.path.join(
        _BACKEND_DIR, "InHouseProgram", "MooringFitting", "MooringFitting.exe"
    ))
    timestamp = _time.strftime("%Y%m%d_%H%M%S")
    job_id = submit_analysis_job(
        task_solve_mooring_fitting,
        solve_bdf_path, solve_model_path, result_json_path, exe_path,
        abs_dir, current_user, timestamp, "Studio",
        yield_strength, gamma_m,
    )
    logger.info("[mooring solve] job 제출: %s (intents=%d, applied=%d, σy=%s, γM=%s)",
                job_id, len(intents), edit_summary.get("applied", 0), yield_strength, gamma_m)
    return {"job_id": job_id, "editSummary": edit_summary,
            "assessment": {"yieldStrength": yield_strength, "gammaM": gamma_m}}


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
    stru_file: Optional[UploadFile] = File(None),
    pipe_file: Optional[UploadFile] = File(None),
    equip_file: Optional[UploadFile] = File(None),
    employee_id: str = Form(...),
    source: str = Form("Workbench"),
    current_user: str = Depends(require_auth),
    mesh_size: float = Form(200.0),
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

    # Structural / Piping 중 하나만 있어도 실행 가능(둘 다 없으면 거절).
    has_stru = bool(stru_file and stru_file.filename)
    has_pipe = bool(pipe_file and pipe_file.filename)
    if not has_stru and not has_pipe:
        raise HTTPException(
            status_code=400,
            detail="Structural 또는 Piping CSV 파일 중 하나 이상이 필요합니다.",
        )

    work_dir, timestamp = make_work_dir(employee_id, "HiTessModelBuilder")

    stru_path = None
    if has_stru:
        stru_path = await save_upload(stru_file, work_dir, error_prefix="파일 저장 오류")

    pipe_path = None
    if has_pipe:
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
    옵션은 기본값(mesh_size=200.0, run_nastran=False)으로 고정 — 빠른 데모 목적.
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
        200.0,   # mesh_size
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
    if not _is_within_dir(_ALLOWED_DOWNLOAD_BASE, abs_p):
        raise HTTPException(status_code=400, detail="허용되지 않은 경로")
    return abs_p


@router.get("/analysis/modelflow/edit-status")
def get_edit_status(
    output_dir: str = Query(..., description="build-full timestamp 폴더의 절대경로"),
    current_user: str = Depends(require_auth),
    db: Session = Depends(database.get_db),
):
    """폴더 안 *_edit.json 존재 여부 + edited/ 산출물 존재 여부를 한 번에 반환.

    프론트는 Studio 종료 후 이 엔드포인트를 호출해 자동 적용 트리거 여부를 결정.
    """
    abs_dir = _validate_userconnection_path(output_dir)
    assert_current_user_can_access_path(abs_dir, current_user, db, _ALLOWED_DOWNLOAD_BASE)
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
    db: Session = Depends(database.get_db),
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
        assert_current_user_can_access_path(abs_dir, current_user, db, _ALLOWED_DOWNLOAD_BASE)
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

                    if _is_within_dir(abs_dir_norm, full_norm):
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
    db: Session = Depends(database.get_db),
):
    """사용자 PC 로컬에서 Studio 가 작성한 *_edit.json 을 백엔드 output_dir 로 업로드.

    apply-edit-intent 는 백엔드 로컬 파일을 읽으므로, Studio 가 사용자 PC 의 로컬 추출
    폴더에 *_edit.json 을 쓴 경우 이 엔드포인트로 백엔드에 먼저 올려야 적용 가능하다.
    """
    abs_dir = _validate_userconnection_path(target_dir)
    assert_current_user_can_access_path(abs_dir, current_user, db, _ALLOWED_DOWNLOAD_BASE)
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
    db: Session = Depends(database.get_db),
):
    """Studio 가 작성한 *_edit.json 을 base 모델에 적용하여 edited/ 폴더 생성."""
    abs_dir = _validate_userconnection_path(payload.output_dir)
    assert_current_user_can_access_path(abs_dir, current_user, db, _ALLOWED_DOWNLOAD_BASE)
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
    if not _is_within_dir(_ALLOWED_DOWNLOAD_BASE, decoded):
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
