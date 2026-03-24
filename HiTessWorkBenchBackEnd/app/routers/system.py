"""시스템 모니터링 및 서버 상태 API 라우터."""
import time
import psutil
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from .. import database
from ..services.job_manager import job_status_store, MAX_CONCURRENT_JOBS

SERVER_VERSION = "1.0.0"

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/version")
def check_version():
  return {"version": SERVER_VERSION}


@router.get("/system/status")
def get_system_status(db: Session = Depends(database.get_db)):
  cpu_usage = psutil.cpu_percent(interval=0.1)

  mem = psutil.virtual_memory()
  mem_used_gb = round(mem.used / (1024 ** 3), 1)
  mem_total_gb = round(mem.total / (1024 ** 3), 1)

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
    "db_status": db_status,
    "latency_ms": latency_ms
  }


@router.get("/system/queue-status")
def get_queue_status():
  """현재 실행 중인 해석과 큐에서 대기 중인 해석 건수를 반환합니다."""
  running_count = sum(1 for job in job_status_store.values() if job["status"] == "Running")
  pending_count = sum(1 for job in job_status_store.values() if job["status"] == "Pending")

  return {
    "running": running_count,
    "pending": pending_count,
    "limit": MAX_CONCURRENT_JOBS
  }
