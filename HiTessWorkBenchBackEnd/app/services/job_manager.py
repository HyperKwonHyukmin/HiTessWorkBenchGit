"""
해석 작업 큐 및 상태 관리 모듈.
ThreadPoolExecutor 기반의 동시 실행 제한과 메모리 기반 작업 상태 저장소를 제공합니다.
스레드 안전(Thread-safe) 클래스로 구현되어 있으며, 완료된 작업은 24시간 후 자동 만료됩니다.
"""
import logging
import subprocess
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timedelta

from .. import database, models

logger = logging.getLogger(__name__)

MAX_CONCURRENT_JOBS = 5

JOB_RETENTION_SECONDS = 86400  # 24시간
PERSISTED_STATUS_FIELDS = {"status", "progress", "message"}
# 취소 확정 이후 서비스가 되돌리지 못하도록 얼리는 필드.
FROZEN_AFTER_CANCEL_FIELDS = {"status", "progress", "message"}

# 프론트/백엔드가 함께 참조하는 종료 상태 집합. `Interrupted` 는 서버 재시작 유실,
# `Cancelled` 는 사용자 명시 중단으로 구분된다.
TERMINAL_STATUSES: frozenset[str] = frozenset({"Success", "Failed", "Interrupted", "Cancelled"})

CANCELLED_MESSAGE = "사용자 요청으로 해석을 중단했습니다."
CANCELLED_QUEUE_MESSAGE = "사용자 요청으로 대기열에서 제거했습니다."
DEFAULT_CANCEL_GRACE_SECONDS = 5.0


class JobCancelledError(RuntimeError):
    """취소가 요청된 작업이 새 프로세스를 띄우려 할 때 공용 래퍼가 던진다."""


_CURRENT_JOB_ID: ContextVar[str | None] = ContextVar("_CURRENT_JOB_ID", default=None)


def current_job_id() -> str | None:
    """executor worker 스레드 안에서 지금 실행 중인 job_id. 밖에서는 None."""
    return _CURRENT_JOB_ID.get()


def _load_psutil():
    """psutil 을 지연 import 한다. 테스트는 이 함수를 monkeypatch 로 None 으로 만든다."""
    try:
        import psutil
        return psutil
    except Exception:
        return None


def _taskkill_tree(pid: int) -> bool:
    """Windows 폴백: taskkill /F /T /PID. 성공(returncode==0)만 True."""
    if not pid:
        return False
    try:
        result = subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(pid)],
            capture_output=True, timeout=30,
        )
        return result.returncode == 0
    except Exception:
        return False


def _kill_process_tree(popen, grace_seconds: float = DEFAULT_CANCEL_GRACE_SECONDS) -> bool:
    """Popen 과 그 자손을 terminate → grace → kill. 유예 안에 popen 을 회수하면 True.

    설계:
      1) psutil 로 부모가 살아 있을 때 자식 트리를 스냅샷한다(부모가 먼저 죽으면 손자는 고아).
      2) 스냅샷 전부 + 부모 terminate() → wait_procs(grace) + popen.wait(grace).
      3) 생존자 kill() → popen.wait(grace) 로 최종 회수.
      4) taskkill /F /T /PID 는 psutil 스냅샷이 실패했을 때만 폴백. 부모가 아직 살아 있을 때만 유효.

    grace 초과 시에도 상태 전이는 진행한다(반환값 False).
    """
    if popen is None:
        return True
    try:
        if popen.poll() is not None:
            return True
    except Exception:
        pass

    psutil = _load_psutil()
    children: list = []
    snapshot_ok = False
    if psutil is not None:
        try:
            parent = psutil.Process(popen.pid)
            children = parent.children(recursive=True)
            snapshot_ok = True
        except Exception:
            snapshot_ok = False

    if not snapshot_ok:
        # 스냅샷 없음 → 부모가 아직 살아 있을 때만 taskkill /T 로 손자까지 한 번 정리 시도.
        try:
            if popen.poll() is None:
                _taskkill_tree(popen.pid)
        except Exception:
            pass

    for child in children:
        try:
            child.terminate()
        except Exception:
            pass
    try:
        popen.terminate()
    except Exception:
        pass

    if psutil is not None and children:
        try:
            psutil.wait_procs(children, timeout=grace_seconds)
        except Exception:
            pass
    try:
        popen.wait(timeout=grace_seconds)
        # 부모 회수 성공 — 생존한 자식만 마저 정리(있으면).
        if psutil is not None:
            for child in children:
                try:
                    if child.is_running():
                        child.kill()
                except Exception:
                    pass
        return True
    except Exception:
        pass

    # 유예 안에 못 죽음 → kill 승격.
    if psutil is not None:
        for child in children:
            try:
                child.kill()
            except Exception:
                pass
    try:
        popen.kill()
    except Exception:
        pass
    try:
        popen.wait(timeout=grace_seconds)
        return True
    except Exception:
        logger.warning("[취소경고] pid=%s 회수 실패(잔여 프로세스 가능성)", getattr(popen, "pid", "?"))
        return False


def _notify_job_terminal(db, record, status: str) -> None:
    """작업 종료 알림. 알림 실패가 상태 저장을 되돌리면 안 되므로 commit 뒤에 따로 감싼다.

    notification_service 는 지연 import 한다(마스터 §2.1 규약) — 이 모듈이 알림 모듈 없이도
    import 되게 하고, 테스트가 notification_service.notify_job_terminal 을 monkeypatch 할 수 있다.
    """
    try:
        from . import notification_service
    except ImportError:
        return
    try:
        notification_service.notify_job_terminal(db, record, status)
    except Exception:
        db.rollback()
        logger.warning("작업 %s 종료 알림 생성 실패", record.job_id, exc_info=True)


@dataclass(frozen=True)
class JobMetadata:
    """제출 시 명시할 수 있는 작업 소유권/프로그램 메타데이터."""

    employee_id: str | None
    program_name: str


class JobStatusStore:
    """
    스레드 안전한 작업 상태 저장소(취소 지원).
    - RLock으로 모든 읽기/쓰기를 보호합니다.
    - 완료(Success/Failed/Interrupted/Cancelled) 상태의 작업은 JOB_RETENTION_SECONDS 이후 자동 삭제됩니다.
    - 취소 상태 관리:
        * `_futures[job_id]`    : 제출 시 붙인 Future(대기 중 취소용)
        * `_processes[job_id]`  : 서비스가 띄운 Popen 리스트(실행 중 트리 종료용)
        * `cancel_requested`    : 취소 요청이 들어온 job_id 집합(공용 래퍼/서비스가 사전 체크)
    """

    def __init__(self):
        self._store: dict = {}
        self._lock = threading.RLock()
        self._cleanup_stop = threading.Event()
        # 제출(등록) 순서를 결정적으로 매기기 위한 단조 증가 카운터.
        # datetime 해상도에 의존하지 않고 대기열 순번(queuePosition)을 계산하는 데 쓰인다.
        self._seq_counter = 0
        self._futures: dict[str, Future] = {}
        self._processes: dict[str, list] = {}
        self.cancel_requested: set[str] = set()
        self._cleanup_thread = threading.Thread(target=self._cleanup_loop, daemon=True)
        self._cleanup_thread.start()

    def set(self, job_id: str, data: dict):
        """새 작업을 등록합니다."""
        with self._lock:
            self._seq_counter += 1
            self._store[job_id] = {**data, "_created_at": datetime.now(), "_seq": self._seq_counter}
        self._write_through(job_id, data)

    def update_job(self, job_id: str, updates: dict):
        """기존 작업 상태를 원자적으로 갱신합니다.

        취소 이후에는 status/progress/message 를 얼립니다(FROZEN_AFTER_CANCEL_FIELDS). 서비스가
        나중에 Failed/Success 를 쓰려 해도 사용자가 본 결과(Cancelled)를 뒤집지 않기 위함입니다.
        얼리지 않는 필드(engine_log 등)는 그대로 반영해 진단 정보를 남깁니다.
        """
        effective = updates
        with self._lock:
            entry = self._store.get(job_id)
            if entry is not None:
                if entry.get("status") == "Cancelled":
                    effective = {k: v for k, v in updates.items()
                                 if k not in FROZEN_AFTER_CANCEL_FIELDS}
                entry.update(effective)
        self._write_through(job_id, effective)

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

    # ---- 취소 코어 ------------------------------------------------------

    def attach_future(self, job_id: str, future: Future) -> None:
        """대기 중 취소를 위해 Future 를 붙인다. 종료 후 자동으로 참조를 해제한다."""
        if not job_id or future is None:
            return
        with self._lock:
            self._futures[job_id] = future
        try:
            future.add_done_callback(lambda _f, jid=job_id: self._drop_future(jid))
        except Exception:
            pass

    def _drop_future(self, job_id: str) -> None:
        with self._lock:
            self._futures.pop(job_id, None)

    def register_process(self, job_id: str, popen) -> None:
        """서비스가 띄운 Popen 을 job 에 매다는 훅.

        등록 시점에 이미 취소가 요청되어 있으면 즉시 종료한다(기동 직후 취소 경합 대비).
        """
        if not job_id or popen is None:
            return
        immediate_kill = False
        with self._lock:
            if job_id in self.cancel_requested:
                immediate_kill = True
            else:
                self._processes.setdefault(job_id, []).append(popen)
        if immediate_kill:
            _kill_process_tree(popen)

    def unregister_process(self, job_id: str, popen) -> None:
        """정상 종료한 Popen 의 참조를 해제한다(취소가 죽은 객체를 건드리지 않게)."""
        with self._lock:
            arr = self._processes.get(job_id)
            if not arr:
                return
            try:
                arr.remove(popen)
            except ValueError:
                pass
            if not arr:
                self._processes.pop(job_id, None)

    def is_cancel_requested(self, job_id: str | None) -> bool:
        if not job_id:
            return False
        with self._lock:
            return job_id in self.cancel_requested

    def cancel(self, job_id: str, *, grace_seconds: float = DEFAULT_CANCEL_GRACE_SECONDS) -> bool:
        """작업 취소 진입점.

        반환 규약:
          - 스토어에 없음 → False
          - 이미 terminal(Success/Failed/Interrupted/Cancelled) → False
          - Pending + future.cancel() 성공 → Cancelled/100/CANCELLED_QUEUE_MESSAGE, True
          - 그 외(Running / future.cancel() False) → cancel_requested 추가 후
            등록된 Popen 전부 _kill_process_tree → Cancelled/100/CANCELLED_MESSAGE, True
        """
        with self._lock:
            entry = self._store.get(job_id)
            if entry is None:
                return False
            status = entry.get("status")
            if status in TERMINAL_STATUSES:
                return False
            future = self._futures.get(job_id)
            queue_kill = False
            if status == "Pending" and future is not None:
                try:
                    if future.cancel():
                        queue_kill = True
                except Exception:
                    queue_kill = False
            if not queue_kill:
                self.cancel_requested.add(job_id)
            processes = list(self._processes.get(job_id, ())) if not queue_kill else []

        # Popen 종료는 락 밖에서(실제로 wait 하므로 락을 오래 잡으면 안 된다).
        for popen in processes:
            try:
                _kill_process_tree(popen, grace_seconds=grace_seconds)
            except Exception:
                logger.warning("[취소경고] job=%s pid=%s 트리 종료 실패",
                               job_id, getattr(popen, "pid", "?"), exc_info=True)

        message = CANCELLED_QUEUE_MESSAGE if queue_kill else CANCELLED_MESSAGE
        with self._lock:
            entry = self._store.get(job_id)
            if entry is None:
                return True
            # 취소 직전에 정상 종료(Success)했다면 그 사실이 우선.
            if entry.get("status") == "Success":
                return False
            entry["status"] = "Cancelled"
            entry["progress"] = 100
            entry["message"] = message
        self._write_through(job_id, {"status": "Cancelled", "progress": 100, "message": message})
        return True

    # ---- write-through / cleanup ---------------------------------------

    def _write_through(self, job_id: str, updates: dict) -> None:
        """Analysis 레코드가 존재하면 메모리 상태를 DB에도 반영합니다.

        Success/Failed 반영이 끝나면 소유자에게 알림(알림 센터)을 남긴다 — 모든 해석
        서비스가 update_job() 으로 종료를 알리므로 발신 지점은 여기 한 곳이면 된다.
        Cancelled 는 record.status 까지 확정하되 알림은 남기지 않는다(취소는 사용자가
        직접 누른 행위라 자기 자신에게 알릴 필요가 없다).
        """
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
                if status in ("Success", "Failed", "Cancelled"):
                    record.status = status
            if "progress" in updates:
                record.progress = updates.get("progress")
            if "message" in updates:
                record.job_message = updates.get("message")
            record.updated_at = now
            db.commit()
            if status in ("Success", "Failed"):
                _notify_job_terminal(db, record, status)
        except Exception:
            db.rollback()
        finally:
            db.close()

    def _sweep_expired(self) -> None:
        """만료된 terminal 작업과 그에 딸린 취소 메타데이터를 함께 비웁니다."""
        cutoff = datetime.now() - timedelta(seconds=JOB_RETENTION_SECONDS)
        with self._lock:
            expired = [
                job_id for job_id, entry in self._store.items()
                if entry.get("status") in TERMINAL_STATUSES
                and entry.get("_created_at", datetime.now()) < cutoff
            ]
            for job_id in expired:
                self._store.pop(job_id, None)
                self.cancel_requested.discard(job_id)
                self._futures.pop(job_id, None)
                self._processes.pop(job_id, None)

    def _cleanup_once(self) -> None:
        """테스트/서비스에서 한 번만 sweep 하고 싶을 때 쓰는 진입점."""
        self._sweep_expired()

    def _cleanup_loop(self):
        """1시간마다 만료된 terminal 작업(Success/Failed/Interrupted/Cancelled)을 삭제합니다."""
        while not self._cleanup_stop.wait(3600):
            self._sweep_expired()

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


def _bind_job_context(fn, job_id: str):
    """worker 스레드에서 `_CURRENT_JOB_ID` 를 job_id 로 세트한 뒤 fn(*args, **kwargs) 를 부른다.

    ContextVar.set() 이 돌려주는 Token 을 reset 해, 재사용되는 풀 스레드의 다음 작업으로
    컨텍스트가 새지 않게 한다.
    """
    def _run(*args, **kwargs):
        token = _CURRENT_JOB_ID.set(job_id)
        try:
            return fn(*args, **kwargs)
        finally:
            _CURRENT_JOB_ID.reset(token)

    return _run


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
        """작업을 제출합니다.

        계약(`routers/_intake.py` 의 submit_analysis_job 이 이 형태로 호출):
            submit(task_fn, job_id, *task_args, **kwargs)

        - 첫 위치 인자가 str 이면 job_id 로 해석해 worker 스레드에 `_CURRENT_JOB_ID` 로 주입하고
          Future 를 `JobStatusStore.attach_future(job_id, future)` 로 붙인다(대기 중 취소용).
        - 첫 인자가 str 이 아니면(이 계약을 쓰지 않는 호출) 컨텍스트 주입도 attach 도 하지 않고
          기존과 똑같이 실행한다.
        """
        job_id = args[0] if args and isinstance(args[0], str) else None
        wrapped = _bind_job_context(fn, job_id) if job_id is not None else fn

        with self._lock:
            executor = self._executor
            if executor is None or not self._accepting:
                raise RuntimeError("analysis executor has been shut down")
            # submit 직후 작업이 끝나 callback 이 동기 실행되는 경우에도 카운터가 음수가 되지
            # 않도록 제출 전에 예약한다. submit 자체 실패 시에는 즉시 되돌린다.
            self._inflight += 1
            try:
                future = executor.submit(wrapped, *args, **kwargs)
            except BaseException:
                self._inflight -= 1
                raise
        # 완료된 Future 에 callback 을 붙이면 현재 스레드에서 즉시 호출될 수 있으므로
        # self._lock 밖에서 등록한다.
        future.add_done_callback(self._future_done)
        if job_id is not None:
            job_status_store.attach_future(job_id, future)
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
