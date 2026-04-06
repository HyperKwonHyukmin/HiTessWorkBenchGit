"""
해석 작업 큐 및 상태 관리 모듈.
ThreadPoolExecutor 기반의 동시 실행 제한과 메모리 기반 작업 상태 저장소를 제공합니다.
스레드 안전(Thread-safe) 클래스로 구현되어 있으며, 완료된 작업은 24시간 후 자동 만료됩니다.
"""
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

MAX_CONCURRENT_JOBS = 5
analysis_executor = ThreadPoolExecutor(max_workers=MAX_CONCURRENT_JOBS)

JOB_RETENTION_SECONDS = 86400  # 24시간


class JobStatusStore:
    """
    스레드 안전한 작업 상태 저장소.
    - RLock으로 모든 읽기/쓰기를 보호합니다.
    - 완료(Success/Failed) 상태의 작업은 JOB_RETENTION_SECONDS 이후 자동 삭제됩니다.
    """

    def __init__(self):
        self._store: dict = {}
        self._lock = threading.RLock()
        self._cleanup_thread = threading.Thread(target=self._cleanup_loop, daemon=True)
        self._cleanup_thread.start()

    def set(self, job_id: str, data: dict):
        """새 작업을 등록합니다."""
        with self._lock:
            self._store[job_id] = {**data, "_created_at": datetime.now()}

    def update_job(self, job_id: str, updates: dict):
        """기존 작업 상태를 원자적으로 갱신합니다."""
        with self._lock:
            if job_id in self._store:
                self._store[job_id].update(updates)

    def get(self, job_id: str) -> dict | None:
        """작업 상태를 복사본으로 반환합니다."""
        with self._lock:
            entry = self._store.get(job_id)
            if entry is None:
                return None
            # 내부 메타 키(_created_at) 제외
            return {k: v for k, v in entry.items() if not k.startswith("_")}

    def __contains__(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._store

    def get_all_values(self) -> list:
        """전체 작업 상태 스냅샷을 반환합니다 (시스템 모니터링용)."""
        with self._lock:
            return [{k: v for k, v in entry.items() if not k.startswith("_")}
                    for entry in self._store.values()]

    def _cleanup_loop(self):
        """1시간마다 만료된 완료/실패 작업을 삭제합니다."""
        while True:
            time.sleep(3600)
            cutoff = datetime.now() - timedelta(seconds=JOB_RETENTION_SECONDS)
            with self._lock:
                expired = [
                    job_id for job_id, entry in self._store.items()
                    if entry.get("status") in ("Success", "Failed")
                    and entry.get("_created_at", datetime.now()) < cutoff
                ]
                for job_id in expired:
                    del self._store[job_id]


# 모듈 수준 싱글턴 인스턴스
job_status_store = JobStatusStore()
