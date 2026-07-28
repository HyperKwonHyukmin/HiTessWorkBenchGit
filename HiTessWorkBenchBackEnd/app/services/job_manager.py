"""
해석 작업 큐 및 상태 관리 모듈.
ThreadPoolExecutor 기반의 동시 실행 제한과 메모리 기반 작업 상태 저장소를 제공합니다.
스레드 안전(Thread-safe) 클래스로 구현되어 있으며, 완료된 작업은 24시간 후 자동 만료됩니다.
"""
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta

from .. import database, models

MAX_CONCURRENT_JOBS = 5

JOB_RETENTION_SECONDS = 86400  # 24시간
PERSISTED_STATUS_FIELDS = {"status", "progress", "message"}


@dataclass(frozen=True)
class JobMetadata:
    """제출 시 명시할 수 있는 작업 소유권/프로그램 메타데이터."""

    employee_id: str | None
    program_name: str


class JobStatusStore:
    """
    스레드 안전한 작업 상태 저장소.
    - RLock으로 모든 읽기/쓰기를 보호합니다.
    - 완료(Success/Failed) 상태의 작업은 JOB_RETENTION_SECONDS 이후 자동 삭제됩니다.
    """

    def __init__(self):
        self._store: dict = {}
        self._lock = threading.RLock()
        self._cleanup_stop = threading.Event()
        # 제출(등록) 순서를 결정적으로 매기기 위한 단조 증가 카운터.
        # datetime 해상도에 의존하지 않고 대기열 순번(queuePosition)을 계산하는 데 쓰인다.
        self._seq_counter = 0
        self._cleanup_thread = threading.Thread(target=self._cleanup_loop, daemon=True)
        self._cleanup_thread.start()

    def set(self, job_id: str, data: dict):
        """새 작업을 등록합니다."""
        with self._lock:
            self._seq_counter += 1
            self._store[job_id] = {**data, "_created_at": datetime.now(), "_seq": self._seq_counter}
        self._write_through(job_id, data)

    def update_job(self, job_id: str, updates: dict):
        """기존 작업 상태를 원자적으로 갱신합니다."""
        with self._lock:
            if job_id in self._store:
                self._store[job_id].update(updates)
        self._write_through(job_id, updates)

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

    def get_queue_stats(self, job_id: str | None = None) -> dict:
        """현재 실행 중/대기 중 작업 수와, 지정 job 의 대기 순번을 계산합니다.

        반환 키:
        - runningJobs: status == "Running" 작업 수 (풀에서 실제 실행 중, 근사).
        - queuedJobs: status == "Pending" 작업 수 (풀이 꽉 차 대기 중).
        - queuePosition: job_id 가 Pending 이면 제출 순번(_seq) 기준 대기열 내 1-based 순번.
          1 이면 다음에 실행될 작업. 이미 실행/완료된 job 이면 키 자체를 넣지 않는다.

        ThreadPoolExecutor 내부 대기열은 직접 볼 수 없으므로, store 의 status 와 제출
        순번(_seq)으로 근사한다. 집계는 실제 풀 상태(Running/Pending)를 반영하며, 순번은
        dict 삽입 순서가 아니라 _seq 로 정렬해 결정적이다.
        """
        with self._lock:
            running = 0
            pending: list[tuple[int, str]] = []  # (_seq, job_id)
            for jid, entry in self._store.items():
                status = entry.get("status")
                if status == "Running":
                    running += 1
                elif status == "Pending":
                    pending.append((entry.get("_seq", 0), jid))
            stats: dict = {"runningJobs": running, "queuedJobs": len(pending)}
            if job_id is not None:
                entry = self._store.get(job_id)
                if entry is not None and entry.get("status") == "Pending":
                    pending.sort(key=lambda item: item[0])
                    for idx, (_, jid) in enumerate(pending):
                        if jid == job_id:
                            stats["queuePosition"] = idx + 1
                            break
            return stats

    def _write_through(self, job_id: str, updates: dict) -> None:
        """Analysis 레코드가 존재하면 메모리 상태를 DB에도 반영합니다."""
        if not job_id:
            return
        if not PERSISTED_STATUS_FIELDS.intersection(updates):
            return
        db = database.SessionLocal()
        try:
            record = db.query(models.Analysis).filter(models.Analysis.job_id == job_id).first()
            if not record:
                return
            status = updates.get("status")
            now = datetime.now()
            if status:
                record.job_status = status
                if status == "Running" and not record.started_at:
                    record.started_at = now
                if status in ("Success", "Failed"):
                    record.status = status
            if "progress" in updates:
                record.progress = updates.get("progress")
            if "message" in updates:
                record.job_message = updates.get("message")
            record.updated_at = now
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()

    def _cleanup_loop(self):
        """1시간마다 만료된 완료/실패 작업을 삭제합니다."""
        while not self._cleanup_stop.wait(3600):
            cutoff = datetime.now() - timedelta(seconds=JOB_RETENTION_SECONDS)
            with self._lock:
                expired = [
                    job_id for job_id, entry in self._store.items()
                    if entry.get("status") in ("Success", "Failed")
                    and entry.get("_created_at", datetime.now()) < cutoff
                ]
                for job_id in expired:
                    del self._store[job_id]

    def shutdown(self) -> None:
        """정리 스레드를 멱등하게 종료한다."""
        self._cleanup_stop.set()
        if self._cleanup_thread is not threading.current_thread():
            self._cleanup_thread.join(timeout=1)

    def start(self) -> None:
        """반복 lifespan/테스트 환경에서 종료된 정리 스레드를 다시 시작한다."""
        with self._lock:
            if self._cleanup_thread.is_alive():
                return
            self._cleanup_stop = threading.Event()
            self._cleanup_thread = threading.Thread(target=self._cleanup_loop, daemon=True)
            self._cleanup_thread.start()


class ManagedAnalysisExecutor:
    """기존 ``submit`` 계약을 유지하면서 lifespan 재진입을 지원하는 executor.

    ``shutdown(wait=False, cancel_futures=False)`` 는 실행/대기 작업을 살려 둔다. 그 상태에서
    새 풀을 즉시 만들면 이전 풀과 새 풀이 동시에 실행되어 전역 동시 실행 상한을 초과할 수
    있으므로, 이전 풀의 모든 Future 가 끝날 때까지 재시작을 거부한다.
    """

    def __init__(self, max_workers: int):
        self._max_workers = max_workers
        self._lock = threading.Lock()
        self._executor: ThreadPoolExecutor | None = ThreadPoolExecutor(max_workers=max_workers)
        self._accepting = True
        self._inflight = 0

    def submit(self, fn, /, *args, **kwargs):
        with self._lock:
            executor = self._executor
            if executor is None or not self._accepting:
                raise RuntimeError("analysis executor has been shut down")
            # submit 직후 작업이 끝나 callback 이 동기 실행되는 경우에도 카운터가 음수가 되지
            # 않도록 제출 전에 예약한다. submit 자체 실패 시에는 즉시 되돌린다.
            self._inflight += 1
            try:
                future = executor.submit(fn, *args, **kwargs)
            except BaseException:
                self._inflight -= 1
                raise
        # 완료된 Future 에 callback 을 붙이면 현재 스레드에서 즉시 호출될 수 있으므로
        # self._lock 밖에서 등록한다.
        future.add_done_callback(self._future_done)
        return future

    def _future_done(self, _future) -> None:
        with self._lock:
            self._inflight -= 1
            if self._inflight == 0 and not self._accepting:
                # shutdown 된 이전 executor가 완전히 drain 되었음을 표시한다. executor 자체는
                # shutdown 호출을 이미 받았으므로 이후 start 에서 안전하게 새 풀로 교체한다.
                self._executor = None

    def shutdown(self, *, wait: bool = False, cancel_futures: bool = False) -> None:
        with self._lock:
            executor = self._executor
            if executor is None or not self._accepting:
                return
            self._accepting = False
            if self._inflight == 0:
                self._executor = None
        if executor is not None:
            executor.shutdown(wait=wait, cancel_futures=cancel_futures)

    def start(self) -> None:
        with self._lock:
            if self._accepting:
                return
            if self._inflight:
                raise RuntimeError(
                    "analysis executor is still draining previously submitted jobs"
                )
            self._executor = ThreadPoolExecutor(max_workers=self._max_workers)
            self._accepting = True


# 모듈 수준 싱글턴 인스턴스
job_status_store = JobStatusStore()
analysis_executor = ManagedAnalysisExecutor(MAX_CONCURRENT_JOBS)

_shutdown_lock = threading.Lock()
_job_manager_shutdown = False


def shutdown_job_manager() -> None:
    """정리 스레드와 executor를 멱등하게 종료한다.

    이미 실행 중이거나 대기 중인 작업을 취소하지 않는다. 서버 프로세스 종료 과정에서
    새 작업 제출만 막고, 실행 중 작업을 강제로 중단하는 기존에 없던 동작은 추가하지 않는다.
    """
    global _job_manager_shutdown
    with _shutdown_lock:
        if _job_manager_shutdown:
            return
        _job_manager_shutdown = True
        job_status_store.shutdown()
        analysis_executor.shutdown(wait=False, cancel_futures=False)


def start_job_manager() -> None:
    """종료된 매니저를 반복 lifespan 환경에서 안전하게 재가동한다."""
    global _job_manager_shutdown
    with _shutdown_lock:
        if not _job_manager_shutdown:
            return
        analysis_executor.start()
        job_status_store.start()
        _job_manager_shutdown = False
