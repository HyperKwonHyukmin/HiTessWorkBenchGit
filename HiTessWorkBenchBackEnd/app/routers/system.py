"""시스템 모니터링 및 서버 상태 API 라우터."""
import logging
import os
import time
import glob
import psutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from .. import database, models
from ..services.job_manager import job_status_store, MAX_CONCURRENT_JOBS
from ..services.cleanup_service import run_cleanup, _USER_CONN_DIR, RETENTION_DAYS
from ..services.remote_session_service import get_remote_session_status
from ..state import server_state
from ..dependencies import require_admin, require_auth
from ..sessions import session_store
from ..services.activity_service import log_activity

logger = logging.getLogger(__name__)

SERVER_VERSION = "1.3.38"

# 최신 클라이언트 exe 폴더 — 환경변수로 오버라이드 가능
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
LATEST_CLIENT_DIR = Path(os.environ.get("LATEST_CLIENT_DIR", str(_BACKEND_DIR / "LastestVersionProgram")))
_DISK_ANCHOR = (
  Path(_USER_CONN_DIR).resolve().anchor
  or _BACKEND_DIR.resolve().anchor
  or os.path.abspath(os.sep)
)

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/version")
def check_version():
  return {"version": SERVER_VERSION}


@router.get("/health/live")
def get_liveness():
  """DB나 solver에 의존하지 않는 process liveness."""
  return {
    "status": "ok",
    "service": "HiTessWorkBench",
    "version": SERVER_VERSION,
  }


@router.get("/health/ready")
def get_readiness(request: Request):
  """Startup/schema 완료와 현재 DB SELECT 1 성공 여부를 분리해 반환합니다."""
  startup_ok = bool(getattr(request.app.state, "startup_complete", False))
  schema_ok = bool(getattr(request.app.state, "schema_ready", False))
  database_status = "not_checked"
  latency_ms = 0

  if startup_ok and schema_ok:
    db = None
    try:
      db = request.app.state.session_factory()
      started = time.perf_counter()
      db.execute(text("SELECT 1"))
      latency_ms = round((time.perf_counter() - started) * 1000)
      database_status = "ok"
    except Exception:
      database_status = "error"
      latency_ms = 0
    finally:
      if db is not None:
        try:
          db.close()
        except Exception:
          # readiness가 예외 응답으로 무너지는 것보다 보수적으로 503을 반환합니다.
          # 연결 문자열이나 driver 오류 원문은 credential을 포함할 수 있어 기록하지 않습니다.
          logger.warning("Readiness DB session close failed")
          database_status = "error"
          latency_ms = 0

  ready = startup_ok and schema_ok and database_status == "ok"
  payload = {
    "status": "ready" if ready else "not_ready",
    "checks": {
      "startup": "ok" if startup_ok else "not_ready",
      "schema": "ok" if schema_ok else "not_ready",
      "database": {
        "status": database_status,
        "latency_ms": latency_ms,
      },
    },
  }
  return JSONResponse(status_code=200 if ready else 503, content=payload)


def _configured_executable(env_name: str, default_path: str) -> bool:
  configured = os.environ.get(env_name, "").strip().strip('"')
  candidate = configured or default_path
  return bool(candidate and os.path.isfile(candidate))


@router.get("/system/capabilities")
def get_runtime_capabilities(
  request: Request,
  _user: str = Depends(require_auth),
):
  """외부 연결 없이 현재 process가 제공할 수 있는 기능을 안전하게 요약합니다."""
  startup_ok = bool(getattr(request.app.state, "startup_complete", False))
  schema_ok = bool(getattr(request.app.state, "schema_ready", False))
  storage_ok = os.path.isdir(_USER_CONN_DIR) and os.access(_USER_CONN_DIR, os.W_OK)
  nastran_ok = _configured_executable(
    "NASTRAN_EXE",
    r"C:\MSC.Software\MSC_Nastran\20131\bin\nastran.exe",
  )
  ollama_configured = bool(
    os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").strip()
  )

  return {
    "schema_version": "1.0",
    "server_version": SERVER_VERSION,
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "runtime": {
      "database": {
        "available": startup_ok and schema_ok,
        "reason_code": None if startup_ok and schema_ok else "startup_not_ready",
      },
      "storage": {
        "available": storage_ok,
        "reason_code": None if storage_ok else "storage_not_writable",
      },
      "analysis_queue": {
        "available": startup_ok,
        "reason_code": None if startup_ok else "startup_not_ready",
        "max_concurrent_jobs": MAX_CONCURRENT_JOBS,
      },
    },
    "programs": {
      "file-based-analysis": {
        "available": startup_ok and storage_ok,
        "reason_code": None if startup_ok and storage_ok else "runtime_not_ready",
        "resource_class": "generic",
      },
      "nastran-analysis": {
        "available": startup_ok and storage_ok and nastran_ok,
        "reason_code": (
          None
          if startup_ok and storage_ok and nastran_ok
          else "solver_not_configured"
        ),
        "resource_class": "nastran",
      },
      "ai-assistant": {
        # 네트워크 live probe는 하지 않으며 설정 존재 여부만 보고합니다.
        "available": ollama_configured,
        "reason_code": None if ollama_configured else "service_not_configured",
        "resource_class": "ollama",
        "availability_basis": "configuration_only",
      },
    },
  }


@router.get("/download/client")
def download_client(
  req: Request,
  db: Session = Depends(database.get_db),
  authorization: str = Header(default=None),
):
  """최신 클라이언트 exe를 다운로드합니다.

  자가 업데이트(구버전 클라이언트가 헤더 없이 호출하는 케이스 포함) 호환을 위해
  인증을 강제하지 않는다. 토큰이 있으면 활동 로그에 employee_id를 기록한다.
  """
  if not LATEST_CLIENT_DIR.exists():
    raise HTTPException(status_code=404, detail="클라이언트 폴더를 찾을 수 없습니다.")

  exe_files = sorted(LATEST_CLIENT_DIR.glob("*.exe"), key=lambda f: f.stat().st_mtime, reverse=True)
  if not exe_files:
    raise HTTPException(status_code=404, detail="클라이언트 exe 파일이 없습니다. 서버 관리자에게 문의하세요.")

  latest_exe = exe_files[0]

  # best-effort: 토큰 있으면 employee_id 추출
  employee_id = None
  if authorization and authorization.startswith("Bearer "):
    try:
      employee_id = session_store.get_employee_id(authorization.removeprefix("Bearer ").strip())
    except Exception:
      employee_id = None

  log_activity(
    db, "PROGRAM_DOWNLOAD",
    employee_id=employee_id,
    action_detail={"filename": latest_exe.name, "type": "client_update"},
    ip_address=req.client.host if req.client else None,
  )
  return FileResponse(
    path=str(latest_exe),
    filename=latest_exe.name,
    media_type="application/octet-stream"
  )


@router.get("/system/status")
def get_system_status(db: Session = Depends(database.get_db), _admin: str = Depends(require_admin)):
  cpu_usage = psutil.cpu_percent(interval=0.1)

  mem = psutil.virtual_memory()
  mem_used_gb = round(mem.used / (1024 ** 3), 1)
  mem_total_gb = round(mem.total / (1024 ** 3), 1)

  disk = psutil.disk_usage(_DISK_ANCHOR)
  disk_used_gb = round(disk.used / (1024 ** 3), 1)
  disk_total_gb = round(disk.total / (1024 ** 3), 1)

  db_status = "Disconnected"
  latency_ms = 0
  try:
    start_time = time.time()
    db.execute(text("SELECT 1"))
    latency_ms = round((time.time() - start_time) * 1000)
    db_status = "Connected"
  except Exception:
    db_status = "Disconnected"
    latency_ms = 0

  return {
    "cpu_usage": cpu_usage,
    "memory_used_gb": mem_used_gb,
    "memory_total_gb": mem_total_gb,
    "disk_used_gb": disk_used_gb,
    "disk_total_gb": disk_total_gb,
    "db_status": db_status,
    "latency_ms": latency_ms
  }


@router.get("/system/maintenance")
def get_maintenance_mode():
  """현재 유지보수 모드 상태를 반환합니다."""
  return {"maintenance": server_state["maintenance_mode"]}


@router.post("/system/maintenance")
def set_maintenance_mode(payload: dict, current_admin: str = Depends(require_admin)):
  """유지보수 모드를 설정합니다. {"maintenance": true/false}"""
  server_state["maintenance_mode"] = bool(payload.get("maintenance", False))
  return {"maintenance": server_state["maintenance_mode"]}


@router.get("/system/storage/preview")
def preview_cleanup(current_admin: str = Depends(require_admin)):
    """삭제 예정 폴더 목록을 dry-run으로 반환합니다 (실제 삭제 없음)."""
    result = run_cleanup(dry_run=True)
    return {
        "retention_days": RETENTION_DAYS,
        "user_connection_dir": _USER_CONN_DIR,
        "to_delete": result["deleted"],
        "to_keep": result["skipped"],
    }


@router.post("/system/storage/cleanup")
def manual_cleanup(current_admin: str = Depends(require_admin)):
    """30일 초과 폴더를 즉시 삭제합니다 (관리자 수동 실행용)."""
    result = run_cleanup(dry_run=False)
    return {
        "deleted_count": len(result["deleted"]),
        "error_count":   len(result["errors"]),
        "skipped_count": result["skipped"],
        "deleted":  result["deleted"],
        "errors":   result["errors"],
    }


@router.post("/admin/verify-gate")
def verify_admin_gate(payload: dict):
    """관리자 게이트 비밀번호를 검증합니다. 환경변수 ADMIN_GATE_PASSWORD로 비밀번호 설정.
    세션 의존 없이 비밀번호만 검증합니다 — 실제 관리자 API는 별도로 require_admin이 적용됩니다."""
    gate_password = os.environ.get("ADMIN_GATE_PASSWORD")
    if not gate_password:
        raise HTTPException(status_code=503, detail="관리자 게이트 비밀번호가 설정되지 않았습니다.")
    if payload.get("password") != gate_password:
        raise HTTPException(status_code=403, detail="비밀번호가 올바르지 않습니다.")
    return {"ok": True}


@router.get("/system/queue-status")
def get_queue_status(_user: str = Depends(require_auth)):
  """현재 실행 중인 해석과 큐에서 대기 중인 해석 건수를 반환합니다."""
  all_jobs = job_status_store.get_all_values()
  running_count = sum(1 for job in all_jobs if job.get("status") == "Running")
  pending_count = sum(1 for job in all_jobs if job.get("status") == "Pending")

  return {
    "running": running_count,
    "pending": pending_count,
    "limit": MAX_CONCURRENT_JOBS
  }


@router.get("/system/jobs/active")
def get_active_jobs(db: Session = Depends(database.get_db), _admin: str = Depends(require_admin)):
  """현재 실행 중(Running)이거나 큐 대기 중(Pending)인 해석 작업 상세 목록을 반환합니다(관리자 전용).

  메타데이터(사번/프로그램/시작시각)는 Analysis 레코드에서, 실시간 상태/진행률은 인메모리
  job_status_store 에서 결합한다. DB 는 Running/Pending 인데 인메모리 store 에 없으면
  (서버 재시작 등으로) 실제로는 끝났거나 유실된 유령 작업이므로 stale=True 로 표시한다.
  """
  now = datetime.now()
  rows = (
      db.query(models.Analysis, models.User)
      .outerjoin(models.User, models.Analysis.employee_id == models.User.employee_id)
      .filter(models.Analysis.job_status.in_(["Running", "Pending"]))
      # 'Running' > 'Pending' (알파벳) → desc 로 실행 중을 먼저, 그다음 오래된 대기 순.
      .order_by(models.Analysis.job_status.desc(), models.Analysis.created_at.asc())
      .all()
  )

  jobs = []
  for analysis, user in rows:
    live = job_status_store.get(analysis.job_id) if analysis.job_id else None
    status = (live or {}).get("status") or analysis.job_status
    progress = (live or {}).get("progress")
    if progress is None:
      progress = analysis.progress
    message = (live or {}).get("message") or analysis.job_message
    ref = analysis.started_at or analysis.created_at
    elapsed = int((now - ref).total_seconds()) if ref else None
    jobs.append({
        "job_id": analysis.job_id,
        "employee_id": analysis.employee_id,
        "name": user.name if user else None,
        "department": user.department if user else None,
        "program_name": analysis.program_name,
        "project_name": analysis.project_name,
        "job_status": status,
        "progress": progress,
        "message": message,
        "started_at": analysis.started_at.isoformat() if analysis.started_at else None,
        "created_at": analysis.created_at.isoformat() if analysis.created_at else None,
        "elapsed_seconds": elapsed,
        "stale": bool(analysis.job_id) and live is None,
    })

  running = sum(1 for job in jobs if job["job_status"] == "Running")
  pending = sum(1 for job in jobs if job["job_status"] == "Pending")
  return {
      "running": running,
      "pending": pending,
      "limit": MAX_CONCURRENT_JOBS,
      "jobs": jobs,
  }


@router.get("/system/remote-sessions")
def get_remote_sessions(fresh: bool = False, _admin: str = Depends(require_admin)):
  """Workbench 서버 컴퓨터의 현재 Windows 원격 접속 세션을 반환합니다.

  fresh=1 이면 IP 조회 캐시를 무시하고 즉시 재조회한다(수동 '원격 확인' 버튼용)."""
  return get_remote_session_status(include_ip=True, force_refresh=fresh)
