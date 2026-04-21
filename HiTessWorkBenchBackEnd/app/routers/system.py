"""시스템 모니터링 및 서버 상태 API 라우터."""
import os
import time
import glob
import psutil
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from .. import database
from ..services.job_manager import job_status_store, MAX_CONCURRENT_JOBS
from ..services.cleanup_service import run_cleanup, _USER_CONN_DIR, RETENTION_DAYS
from ..state import server_state
from ..dependencies import require_admin, require_auth
from ..services.activity_service import log_activity

SERVER_VERSION = "0.1.1"

# 최신 클라이언트 exe 폴더 — 환경변수로 오버라이드 가능
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
LATEST_CLIENT_DIR = Path(os.environ.get("LATEST_CLIENT_DIR", str(_BACKEND_DIR / "LastestVersionProgram")))

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/version")
def check_version():
  return {"version": SERVER_VERSION}


@router.get("/download/client")
def download_client(req: Request, db: Session = Depends(database.get_db), employee_id: str = Depends(require_auth)):
  """최신 클라이언트 exe를 다운로드합니다."""
  if not LATEST_CLIENT_DIR.exists():
    raise HTTPException(status_code=404, detail="클라이언트 폴더를 찾을 수 없습니다.")

  exe_files = sorted(LATEST_CLIENT_DIR.glob("*.exe"), key=lambda f: f.stat().st_mtime, reverse=True)
  if not exe_files:
    raise HTTPException(status_code=404, detail="클라이언트 exe 파일이 없습니다. 서버 관리자에게 문의하세요.")

  latest_exe = exe_files[0]
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
def get_system_status(db: Session = Depends(database.get_db)):
  cpu_usage = psutil.cpu_percent(interval=0.1)

  mem = psutil.virtual_memory()
  mem_used_gb = round(mem.used / (1024 ** 3), 1)
  mem_total_gb = round(mem.total / (1024 ** 3), 1)

  disk = psutil.disk_usage('/')
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
def preview_cleanup():
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
    gate_password = os.environ.get("ADMIN_GATE_PASSWORD", "str_2006")
    if payload.get("password") != gate_password:
        raise HTTPException(status_code=403, detail="비밀번호가 올바르지 않습니다.")
    return {"ok": True}


@router.get("/system/queue-status")
def get_queue_status():
  """현재 실행 중인 해석과 큐에서 대기 중인 해석 건수를 반환합니다."""
  all_jobs = job_status_store.get_all_values()
  running_count = sum(1 for job in all_jobs if job.get("status") == "Running")
  pending_count = sum(1 for job in all_jobs if job.get("status") == "Pending")

  return {
    "running": running_count,
    "pending": pending_count,
    "limit": MAX_CONCURRENT_JOBS
  }
