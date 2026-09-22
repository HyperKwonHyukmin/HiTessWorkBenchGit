# 작업 취소 일반화 (Plan D) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `doublepipe_psa_service.cancel_psa_job` 한 곳에만 있던 **취소 패턴**을 `job_manager` 로 일반화한다. 대기 중 작업은 `future.cancel()`, 실행 중 작업은 서비스가 띄운 `Popen` 트리를 `terminate() → 5초 → kill()` 로 회수하고, 상태를 새 값 `Cancelled` 로 전이한다(`Interrupted` 와 구분 — 서버 재시작 유실이 아니라 사용자 중단). 5개 `Popen` 서비스에 등록 훅을 걸고, `subprocess.run()` 기반 서비스는 사전 체크만 심는다. API `POST /api/analysis/{job_id}/cancel`, 프론트 Job Center / MyProjects 에 "중단" 버튼(+`ConfirmDialog`). 이중관 PSA 의 자체 취소는 얇게 위임하고 기존 라우트 `POST /run-psa/cancel` 는 응답 형태를 그대로 유지한다.

**Architecture:** 백엔드 — `job_manager` 확장(`cancel_requested`, `_process_registry`, `_submitted_futures`, `attach_future`, `register_process`, `is_cancel_requested`, `cancel`, `TERMINAL_STATUSES`, `_kill_process_tree`) + `ManagedAnalysisExecutor.submit(fn, job_id, *args)` 시그니처 명시 + 5개 `Popen` 서비스에 `register_process` 훅 + `subprocess.run()` 서비스에 `is_cancel_requested` 사전 체크 + `POST /api/analysis/{job_id}/cancel`(권한 = 소유자/관리자, 알림 지연 import) + `_cleanup_loop` 에 `Cancelled` 24h 정리 + `doublepipe_psa_service.cancel_psa_job` → `job_manager` 위임 + `POST /run-psa/cancel` 호환 유지. 프론트 — `api/analysis.js` `cancelJob()` + `utils/globalJobs.js` `TERMINAL_JOB_STATUSES` 에 `Cancelled` + `StatusBadge` / `UtilityDock` STATUS 메타에 `Cancelled` + `UtilityDock` `JobRow` 에 "중단" 버튼 + `ConfirmDialog` + `MyProjects.jsx` 행 액션 "중단" + `STATUS_FILTERS` 에 `Cancelled`.

**Tech Stack:** Python 3.14 / FastAPI / SQLAlchemy (MySQL 운영, SQLite 테스트) / `psutil==7.2.2`(이미 `requirements.txt:25`) / pytest — React 18 + Vite + Tailwind + lucide-react + `@headlessui/react`(기존) + axios. 신규 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-18-job-cancel-design.md` (마스터: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1·§2.1·§2.5·§3)

**규칙(마스터 §1):** 커밋은 사용자가 직접 한다 — 각 Task 마지막 단계는 **"커밋 준비 완료 — 변경 파일 목록을 사용자에게 보고"** 다. `HiTessWorkBench/frontend/src/config.js` 는 절대 스테이징하지 않는다. `Darkmode.js/` 는 건드리지 않는다. 백엔드는 TDD(실패 테스트 → 최소 구현 → 통과). 프론트는 러너가 없으므로 수동 검증 절차를 따른다. 문서·주석·UI 문구는 한국어, 식별자는 영어.

**테스트 실행 위치:** 모든 pytest 명령은 `C:\Coding\WorkBench\HiTessWorkBenchBackEnd` 에서 `WorkBenchEnv/Scripts/python.exe -m pytest …` 로 실행한다. 프론트 `node --test` 는 `C:\Coding\WorkBench\HiTessWorkBench\frontend` 에서 실행한다.

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `HiTessWorkBenchBackEnd/app/services/job_manager.py` | 수정 | `TERMINAL_STATUSES`·`CANCELLED_*` 상수, `JobCancelledError`, `_CURRENT_JOB_ID`/`current_job_id`, `_kill_process_tree`(신규), `JobStatusStore` 확장(취소 코어), `ManagedAnalysisExecutor.submit(fn, job_id, *args)` 시그니처 명시 + `attach_future` 자동 |
| `HiTessWorkBenchBackEnd/app/services/analysis_runner.py` | 수정 | `run_subprocess_killtree(cmd_args, *, cwd, timeout, job_id=None)` — Popen 등록 훅 통합. 반환/예외 계약 무변경 |
| `HiTessWorkBenchBackEnd/app/services/doublepipe_psa_service.py` | 수정 | `_kill_process_tree` 를 `job_manager._kill_process_tree(popen, …)` 로 얇게 위임(pid 우회 경로만 유지), `cancel_psa_job` 은 라이센스 슬롯 로직 유지하며 등록 훅 활용 |
| `HiTessWorkBenchBackEnd/app/services/mooring_fitting_service.py` | 수정 | `_run_capture(cmd, cwd, timeout, *, job_id=None)` — Popen 생성 직후 `register_process`, 취소 사전 체크, TimeoutExpired 시 `job_manager._kill_process_tree(proc)` |
| `HiTessWorkBenchBackEnd/app/services/doublepipe_modeshape_service.py` | 수정 | 뷰어 상주 프로세스라 취소 대상 아님 — 등록 훅 X, 계속 `subprocess.Popen` 그대로 |
| `HiTessWorkBenchBackEnd/app/services/remote_session_service.py` | 수정 | 20초 이내 동기 RDP 조회라 취소 대상 아님 — 등록 훅 X, 그대로 |
| `HiTessWorkBenchBackEnd/app/services/unit_structural_service.py` 등 5+ 서비스 | 수정 | `subprocess.run()` 앞뒤로 `job_manager.is_cancel_requested(job_id)` 사전 체크(Task 5 표) |
| `HiTessWorkBenchBackEnd/app/services/job_cancel_service.py` | 생성 | `JobLocation`·`locate_job`·`cancel_located` — 라우터가 붙이는 얇은 헬퍼 |
| `HiTessWorkBenchBackEnd/app/routers/analysis.py` | 수정 | `POST /api/analysis/{job_id}/cancel` 엔드포인트 + `notify` 지연 import |
| `HiTessWorkBenchBackEnd/app/routers/doublepipe.py` | 수정 | `POST /run-psa/cancel` 를 `job_cancel_service.cancel_located` 위임으로 대체(응답 형태 유지) |
| `HiTessWorkBenchBackEnd/tests/test_job_cancel_store.py` | 생성 | `JobStatusStore` 취소 코어(4행 표) + 동결 규칙 + `_kill_process_tree` 승격 |
| `HiTessWorkBenchBackEnd/tests/test_job_cancel_executor.py` | 생성 | `submit(fn, job_id, …)` 계약 + `current_job_id()` context + `attach_future` |
| `HiTessWorkBenchBackEnd/tests/test_job_cancel_runner.py` | 생성 | `run_subprocess_killtree` 의 등록/취소 사전 체크 + `record_analysis` 의 `Cancelled` 강제 |
| `HiTessWorkBenchBackEnd/tests/test_job_cancel_route.py` | 생성 | 라우트 200/403/404/409 + PSA 위임 + `/run-psa/cancel` 호환 + `notify` 지연 import |
| `HiTessWorkBenchBackEnd/tests/test_job_cancel_services_guard.py` | 생성 | Popen 서비스 5곳이 `register_process` 를 호출한다 / `subprocess.run` 서비스가 `is_cancel_requested` 를 부른다 |
| `HiTessWorkBench/frontend/src/api/analysis.js` | 수정 | `cancelAnalysisJob(jobId)` 추가 |
| `HiTessWorkBench/frontend/src/utils/globalJobs.js` | 수정 | `TERMINAL_JOB_STATUSES` 에 `Cancelled` |
| `HiTessWorkBench/frontend/src/components/ui/StatusBadge.jsx` | 수정 | `STATUS_META.Cancelled` |
| `HiTessWorkBench/frontend/src/components/platform/UtilityDock.jsx` | 수정 | `STATUS_CONFIG.Cancelled`, `TERMINAL_STATUSES` 에 추가, `JobRow` 에 "중단" 버튼, 도크 레벨 `ConfirmDialog` |
| `HiTessWorkBench/frontend/src/pages/analysis/MyProjects.jsx` | 수정 | 행 액션에 "중단" 버튼(+`ConfirmDialog`), `STATUS_FILTERS` 에 `Cancelled` |

---

### Task 1: `JobStatusStore` 취소 코어

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/job_manager.py` — 6~16행(import) 확장 + `TERMINAL_STATUSES` 상수 + `JobCancelledError` + `_CURRENT_JOB_ID` / `current_job_id` + `JobStatusStore` 확장(`_futures`, `_processes`, `cancel_requested`, `attach_future`, `register_process`, `unregister_process`, `is_cancel_requested`, `cancel`, `update_job` 동결 규칙, `_write_through` `Cancelled` 반영, `_cleanup_loop` `Cancelled` 정리)
- Create: `HiTessWorkBenchBackEnd/tests/test_job_cancel_store.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_job_cancel_store.py`:

```python
"""JobStatusStore 취소 코어 — Pending/Running 전이, 동결 규칙, _kill_process_tree 승격.

FakePopen 은 실제 프로세스를 쓰지 않는다: terminate() 에 죽는 것(die_on_terminate=True)과
무시하는 것(die_on_terminate=False, die_on_kill=True) 두 가지로 5초 유예의 승격 동작을 검증한다.
_kill_process_tree 는 psutil 을 통해 자식 트리 스냅샷을 뜨는데 우리는 가짜 PID(4242)를 쓰므로
autouse fixture 로 psutil 로딩과 taskkill 을 no-op 으로 만든다(실 프로세스에 닿으면 위험).
"""
import threading
import time

import pytest

from app import database, models
from app.services import job_manager
from app.services.job_manager import (
    CANCELLED_MESSAGE,
    CANCELLED_QUEUE_MESSAGE,
    DEFAULT_CANCEL_GRACE_SECONDS,
    JobStatusStore,
    TERMINAL_STATUSES,
    job_status_store,
)


@pytest.fixture(autouse=True)
def _isolate_psutil_and_taskkill(monkeypatch):
    """psutil 스냅샷과 Windows taskkill 을 no-op 으로 대체해 실 프로세스에 닿지 않게 한다."""
    monkeypatch.setattr(job_manager, "_load_psutil", lambda: None, raising=False)
    monkeypatch.setattr(job_manager, "_taskkill_tree", lambda pid: False, raising=False)
    yield


@pytest.fixture()
def store():
    """모듈 싱글턴 대신 격리된 store 로 검사(모듈 싱글턴은 백그라운드 cleanup 스레드가 돈다)."""
    s = JobStatusStore()
    s.shutdown()  # cleanup 스레드 중지(테스트 시간 조작 방지)
    return s


class FakePopen:
    """subprocess.Popen 대체 — terminate/kill 응답과 poll() 결과를 시나리오로 지정한다."""

    def __init__(self, *, die_on_terminate=True, die_on_kill=True):
        self.pid = 4242
        self._alive = True
        self._die_on_terminate = die_on_terminate
        self._die_on_kill = die_on_kill
        self.terminate_calls = 0
        self.kill_calls = 0
        self.wait_calls = 0

    def poll(self):
        return None if self._alive else 0

    def terminate(self):
        self.terminate_calls += 1
        if self._die_on_terminate:
            self._alive = False

    def kill(self):
        self.kill_calls += 1
        if self._die_on_kill:
            self._alive = False

    def wait(self, timeout=None):
        self.wait_calls += 1
        if not self._alive:
            return 0
        # 유예 기다린 뒤 timeout 예외 흉내
        time.sleep(min(timeout or 0.01, 0.01))
        if not self._alive:
            return 0
        raise TimeoutError(timeout)


def test_terminal_statuses_covers_four_values():
    assert TERMINAL_STATUSES == frozenset({"Success", "Failed", "Interrupted", "Cancelled"})


def test_cancel_unknown_job_returns_false(store):
    assert store.cancel("no-such") is False


def test_cancel_terminal_job_returns_false_without_marking(store):
    store.set("j1", {"status": "Success", "progress": 100, "message": "ok"})
    assert store.cancel("j1") is False
    assert store.is_cancel_requested("j1") is False


def test_cancel_pending_uses_future_cancel_and_marks_cancelled(store):
    class FakeFuture:
        cancelled_calls = 0
        def cancel(self):
            type(self).cancelled_calls += 1
            return True
    store.set("j1", {"status": "Pending", "progress": 0, "message": "대기"})
    fut = FakeFuture()
    store.attach_future("j1", fut)

    assert store.cancel("j1") is True
    entry = store.get("j1")
    assert entry["status"] == "Cancelled"
    assert entry["progress"] == 100
    assert entry["message"] == CANCELLED_QUEUE_MESSAGE
    assert FakeFuture.cancelled_calls == 1
    # 이 경로에서는 Popen 이 없으므로 cancel_requested 는 True 여도 되고 아니어도 상관없다.


def test_cancel_running_terminates_registered_popen_and_marks_cancelled(store):
    store.set("j1", {"status": "Running", "progress": 30, "message": "solving"})
    popen = FakePopen(die_on_terminate=True)
    store.register_process("j1", popen)

    assert store.cancel("j1", grace_seconds=0.05) is True
    assert popen.terminate_calls == 1
    entry = store.get("j1")
    assert entry["status"] == "Cancelled"
    assert entry["message"] == CANCELLED_MESSAGE
    assert store.is_cancel_requested("j1") is True


def test_cancel_pending_but_future_started_falls_through_to_terminate(store):
    class FakeFuture:
        def cancel(self):
            return False  # 이미 실행 시작
    store.set("j1", {"status": "Pending", "progress": 0, "message": "대기"})
    store.attach_future("j1", FakeFuture())
    popen = FakePopen(die_on_terminate=True)
    store.register_process("j1", popen)

    assert store.cancel("j1", grace_seconds=0.05) is True
    entry = store.get("j1")
    assert entry["status"] == "Cancelled"
    assert popen.terminate_calls == 1


def test_terminate_grace_escalates_to_kill(store):
    """terminate() 는 무시하고 kill() 에서만 죽는 프로세스는 유예 후 kill 로 승격한다."""
    store.set("j1", {"status": "Running", "progress": 30, "message": "solving"})
    popen = FakePopen(die_on_terminate=False, die_on_kill=True)
    store.register_process("j1", popen)

    assert store.cancel("j1", grace_seconds=0.05) is True
    assert popen.terminate_calls == 1
    assert popen.kill_calls >= 1


def test_terminate_returns_true_when_process_already_gone(store):
    """이미 정상 종료된 Popen 도 cancel() 은 True — 하지만 상태는 진행 중 값을 유지한다.

    (진행 중이라면 register_process 해제 후 종료됐을 것이므로 이 경로는 실무에선 드물다.)
    """
    store.set("j1", {"status": "Running", "progress": 30, "message": "solving"})
    popen = FakePopen()
    popen._alive = False   # 이미 죽어 있음
    store.register_process("j1", popen)

    assert store.cancel("j1", grace_seconds=0.05) is True
    entry = store.get("j1")
    assert entry["status"] == "Cancelled"


def test_update_job_freezes_status_progress_message_after_cancel(store):
    """취소 이후 서비스가 Failed/Success 로 덮으려 해도 status/progress/message 는 얼어붙는다."""
    store.set("j1", {"status": "Running", "progress": 30, "message": "solving"})
    store.register_process("j1", FakePopen())
    store.cancel("j1", grace_seconds=0.05)

    store.update_job("j1", {"status": "Failed", "progress": 100, "message": "엔진 오류"})
    entry = store.get("j1")
    assert entry["status"] == "Cancelled"
    assert entry["message"] == CANCELLED_MESSAGE


def test_update_job_accepts_non_frozen_fields_after_cancel(store):
    """engine_log·project·기타 필드는 취소 후에도 반영된다(사용자에게 진단이 남아야 한다)."""
    store.set("j1", {"status": "Running", "progress": 30, "message": "solving"})
    store.register_process("j1", FakePopen())
    store.cancel("j1", grace_seconds=0.05)

    store.update_job("j1", {"engine_log": "종료 로그", "status": "Failed"})
    entry = store.get("j1")
    assert entry["status"] == "Cancelled"
    assert entry.get("engine_log") == "종료 로그"


def test_register_process_after_cancel_terminates_immediately(store):
    """cancel 이 먼저 도착하고 Popen 이 뒤에 등록되면 register 가 즉시 종료한다(경합 대비)."""
    store.set("j1", {"status": "Running", "progress": 30, "message": "solving"})
    store.cancel("j1", grace_seconds=0.05)  # 등록된 프로세스 없음 — 그래도 cancel_requested True
    popen = FakePopen(die_on_terminate=True)
    store.register_process("j1", popen)
    assert popen.terminate_calls == 1


def test_is_cancel_requested_for_unknown_returns_false(store):
    assert store.is_cancel_requested("no-such") is False


def test_attach_future_drops_reference_when_future_done(store):
    """future 종료 후 done 콜백이 자기 참조를 지운다(메모리 누수 방지)."""
    class FakeFuture:
        def __init__(self):
            self._cbs = []
        def add_done_callback(self, cb):
            self._cbs.append(cb)
        def cancel(self):
            return True
        def done_now(self):
            for cb in self._cbs:
                cb(self)

    store.set("j1", {"status": "Pending", "progress": 0, "message": "대기"})
    fut = FakeFuture()
    store.attach_future("j1", fut)
    fut.done_now()  # 완료 시뮬레이션
    # 내부적으로 참조가 사라졌는지 = cancel() 이 이제 Pending 을 Cancelled 로 만들지 못한다.
    assert store.cancel("j1") is True  # register_process 도 없으니 cancel_requested 만 True
    # 두 번째 cancel 은 이미 terminal(Cancelled)이라 False
    assert store.cancel("j1") is False


def test_write_through_persists_cancelled_status(db_session, make_analysis, monkeypatch):
    """_write_through 가 status=='Cancelled' 를 만나면 record.status·job_status 양쪽에 반영한다."""
    from datetime import datetime
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    a = make_analysis("EMP001", "Truss Assessment", datetime(2026, 9, 18, 9, 0, 0), status="Running")
    a.job_id = "wt-c"
    db_session.commit()

    job_status_store.set("wt-c", {"status": "Running", "progress": 30, "message": "solving"})
    job_status_store.register_process("wt-c", FakePopen())
    assert job_status_store.cancel("wt-c", grace_seconds=0.05) is True

    db_session.expire_all()
    saved = db_session.get(models.Analysis, a.id)
    assert saved.job_status == "Cancelled"
    assert saved.status == "Cancelled"
    assert saved.progress == 100


def test_cleanup_loop_considers_cancelled(store, monkeypatch):
    """_cleanup_loop 이 만료 판단에서 Cancelled 를 다른 terminal 상태와 동일하게 취급한다."""
    from datetime import datetime, timedelta
    store.set("j1", {"status": "Cancelled", "progress": 100, "message": CANCELLED_MESSAGE})
    # 24h+ 전에 만든 것으로 위조
    with store._lock:
        store._store["j1"]["_created_at"] = datetime.now() - timedelta(seconds=job_manager.JOB_RETENTION_SECONDS + 5)
    # _cleanup_loop 는 블로킹이므로 만료 검사만 별도로 부른다.
    store._cleanup_once()   # 신설(테스트용): 한 번만 sweep 하고 반환
    assert store.get("j1") is None
    assert store.is_cancel_requested("j1") is False   # cleanup 이 cancel_requested 도 함께 비운다
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_cancel_store.py -q
```
기대: 수집 단계 실패(`ImportError: cannot import name 'TERMINAL_STATUSES'`) 또는 대부분 fail(`AttributeError: attach_future`).

- [ ] **Step 3: `job_manager.py` 확장**

(a) 6~16행 import 블록 아래로 교체 + 상수·예외·컨텍스트 추가:

```python
import contextlib
import logging
import subprocess
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Callable

from .. import database, models

logger = logging.getLogger(__name__)

MAX_CONCURRENT_JOBS = 5

JOB_RETENTION_SECONDS = 86400  # 24시간
PERSISTED_STATUS_FIELDS = {"status", "progress", "message"}
FROZEN_AFTER_CANCEL_FIELDS = {"status", "progress", "message"}

# 프론트/백엔드가 함께 참조하는 종료 상태 집합. `Interrupted` 는 서버 재시작 유실,
# `Cancelled` 는 사용자 명시 중단으로 구분된다.
TERMINAL_STATUSES: frozenset[str] = frozenset({"Success", "Failed", "Interrupted", "Cancelled"})

CANCELLED_MESSAGE = "사용자 요청으로 해석을 중단했습니다."
CANCELLED_QUEUE_MESSAGE = "사용자 요청으로 대기열에서 제거했습니다."
DEFAULT_CANCEL_GRACE_SECONDS = 5.0


class JobCancelledError(RuntimeError):
    """취소가 요청된 작업이 새 프로세스를 띄우려 할 때 `tracked_popen` 이 던진다."""


_CURRENT_JOB_ID: ContextVar[str | None] = ContextVar("_CURRENT_JOB_ID", default=None)


def current_job_id() -> str | None:
    """executor worker 스레드 안에서 지금 실행 중인 job_id. 밖에서는 None."""
    return _CURRENT_JOB_ID.get()


def _load_psutil():
    """psutil 을 지연 import 한다. 테스트는 이 함수를 monkeypatch 로 None 으로 만든다."""
    try:
        import psutil  # noqa: WPS433
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

    설계(spec §2, 결정 3):
      1) psutil 로 부모가 살아 있을 때 자식 트리를 스냅샷한다(부모가 먼저 죽으면 손자는 고아).
      2) 스냅샷 전부 + 부모 terminate() → wait_procs(grace) + popen.wait(grace).
      3) 생존자 kill() → popen.wait(grace) 로 최종 회수.
      4) taskkill /F /T /PID 는 psutil 스냅샷이 실패했을 때만 폴백. 부모가 아직 살아 있을 때만 유효.

    grace 초과 시에도 상태 전이는 진행한다(반환값 False). PSA 처럼 라이센스 슬롯을 지연 해제할
    필요가 없다 — 여기의 nastran 은 solver 쪽에서 라이센스 큐잉이 되기 때문이다.
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


@dataclass(frozen=True)
class JobMetadata:
    """제출 시 명시할 수 있는 작업 소유권/프로그램 메타데이터."""

    employee_id: str | None
    program_name: str


class JobStatusStore:
    """스레드 안전한 작업 상태 저장소(취소 지원).

    - RLock 으로 모든 읽기/쓰기를 보호합니다.
    - 완료(Success/Failed/Interrupted/Cancelled) 상태의 작업은 JOB_RETENTION_SECONDS 이후 자동 삭제됩니다.
    - 취소 상태 관리:
        * `_futures[job_id]`      : ManagedAnalysisExecutor.submit 이 붙인 Future(대기 취소용)
        * `_processes[job_id]`    : 서비스가 띄운 Popen 리스트(실행 중 트리 종료용)
        * `cancel_requested`      : 취소 요청이 들어온 job_id 집합(공용 래퍼/서비스가 사전 체크)
    """

    def __init__(self):
        self._store: dict = {}
        self._lock = threading.RLock()
        self._cleanup_stop = threading.Event()
        self._seq_counter = 0
        self._futures: dict[str, Future] = {}
        self._processes: dict[str, list] = {}
        self.cancel_requested: set[str] = set()
        self._cleanup_thread = threading.Thread(target=self._cleanup_loop, daemon=True)
        self._cleanup_thread.start()

    # ---- 기존 인터페이스 -------------------------------------------------

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
        """
        with self._lock:
            entry = self._store.get(job_id)
            if not entry:
                return
            effective = dict(updates)
            if entry.get("status") == "Cancelled":
                for key in FROZEN_AFTER_CANCEL_FIELDS:
                    effective.pop(key, None)
            entry.update(effective)
        self._write_through(job_id, effective)

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            entry = self._store.get(job_id)
            if entry is None:
                return None
            return {k: v for k, v in entry.items() if not k.startswith("_")}

    def __contains__(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._store

    def get_all_values(self) -> list:
        with self._lock:
            return [{k: v for k, v in entry.items() if not k.startswith("_")}
                    for entry in self._store.values()]

    def get_queue_stats(self, job_id: str | None = None) -> dict:
        """(변경 없음 — 기존 로직 유지). 대기열 순번과 실행 중 건수를 반환합니다."""
        with self._lock:
            running = 0
            pending: list[tuple[int, str]] = []
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

        등록 시점에 이미 취소가 요청되어 있으면 즉시 종료한다(publish 직후 취소 경합 대비).
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

        반환 규약(spec §3.1):
          - 스토어에 없음 → False
          - 이미 terminal → False
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

        # Popen 종료는 락 밖에서(진짜로 wait 하므로 락을 오래 잡으면 안 된다).
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
                if status in ("Success", "Failed", "Cancelled"):
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

    def _sweep_expired(self) -> None:
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
        """정리 스레드를 멱등하게 종료합니다."""
        self._cleanup_stop.set()
        if self._cleanup_thread is not threading.current_thread():
            self._cleanup_thread.join(timeout=1)

    def start(self) -> None:
        with self._lock:
            if self._cleanup_thread.is_alive():
                return
            self._cleanup_stop = threading.Event()
            self._cleanup_thread = threading.Thread(target=self._cleanup_loop, daemon=True)
            self._cleanup_thread.start()
```

- [ ] **Step 4: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_cancel_store.py -q
```
기대: 15건 통과.

- [ ] **Step 5: 회귀**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_submission_lifecycle.py tests/test_queue_visibility.py tests/test_system_jobs.py -q
```
기대: 기존 통과 유지(취소 기능 추가는 기존 계약을 안 바꾼다).

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/services/job_manager.py`, `tests/test_job_cancel_store.py`.

---

### Task 2: `_kill_process_tree` 위임 — 이중관 PSA 서비스

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/doublepipe_psa_service.py:1251` — `_kill_process_tree(pid, job_id)` 는 라이센스 로그·job 트래킹을 유지한 채 **부모 회수는 `job_manager._kill_process_tree(popen)` 로 위임**하는 얇은 껍데기로 전환.
- Modify: 같은 파일 `:785` 부근 `_run_pipeline` — Popen publish 직후 `job_status_store.register_process(job_id, proc)` 훅을 추가한다(취소 API 가 라우팅될 수 있도록).

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_job_cancel_store.py` 에 클래스 밖으로 추가:

```python
def test_psa_service_delegates_kill_to_job_manager(monkeypatch):
    """doublepipe_psa_service._kill_process_tree 가 job_manager._kill_process_tree 를 부른다."""
    from app.services import doublepipe_psa_service as psa

    calls = []
    def fake_km(popen, grace_seconds=None):
        calls.append(popen)
        return True

    class FakePopen2:
        pid = 4242
        def poll(self): return None

    # 서비스가 job 스토어에서 popen 을 찾도록 세팅
    psa._jobs["j-psa"] = {"status": "running", "_process": FakePopen2()}
    monkeypatch.setattr("app.services.job_manager._kill_process_tree", fake_km)
    monkeypatch.setattr(psa, "_load_psutil", lambda: None, raising=False)

    # 서비스의 _kill_process_tree(pid, job_id) 는 job 안의 Popen 을 꺼내 job_manager 로 위임.
    psa._kill_process_tree(4242, "j-psa")
    assert len(calls) == 1

    # 정리
    del psa._jobs["j-psa"]
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_cancel_store.py::test_psa_service_delegates_kill_to_job_manager -q
```
기대: 실패(현재 서비스는 taskkill 을 직접 호출한다).

- [ ] **Step 3: 서비스 `_kill_process_tree` 를 얇은 위임으로 축소**

`doublepipe_psa_service.py:1251` 부근의 `_kill_process_tree(pid, job_id)` 를 아래로 대체(라이센스 추적·로그 유지):

```python
def _kill_process_tree(pid: int, job_id: str) -> bool:
    """공용 `job_manager._kill_process_tree` 로 위임한다.

    PSA 는 라이센스 슬롯 회수를 지연시키기 위해 트리 종료가 실제로 성공했음을 검증해야 하므로,
    공용 함수가 True 를 돌려주면 그 사실을 job 에 마킹한다. False 면 `_terminationVerificationPending`
    을 유지해 재시도 경로에 남긴다.
    """
    from . import job_manager

    with _jobs_lock:
        job = _jobs.get(job_id)
        popen = (job or {}).get("_process")
    if popen is None:
        with _jobs_lock:
            if job_id in _jobs:
                _jobs[job_id]["_terminationVerificationPending"] = True
        return False

    ok = job_manager._kill_process_tree(popen)
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            return ok
        if ok:
            job.pop("_terminationVerificationPending", None)
        else:
            job["_terminationVerificationPending"] = True
    if not ok:
        _append_log(job_id, f"[중단경고] PID {pid} 트리 회수 실패 — 다음 취소 시 재시도합니다.")
    return ok
```

⚠ `_kill_process_tree` 의 예전 psutil·taskkill·`_terminationTrackedProcesses` 로직은 **모두 삭제한다** — 같은 일을 `job_manager._kill_process_tree` 가 하고, PSA 가 추가로 관리하는 것은 라이센스 슬롯 해제 지연뿐이다(위 코드가 남긴다).

- [ ] **Step 4: `_run_pipeline` publish 훅**

`doublepipe_psa_service.py:785` 의 Popen 생성 직후, 기존 `_jobs[job_id]["_process"] = proc` 라인 바로 다음에:

```python
        _jobs[job_id]["_process"] = proc
        _jobs[job_id]["pid"] = proc.pid
        _jobs[job_id]["_processReady"].set()
        # 공용 취소 API(/api/analysis/{job_id}/cancel) 가 이 Popen 을 찾아 종료할 수 있도록 등록.
        from . import job_manager
        job_manager.job_status_store.register_process(job_id, proc)
```

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_cancel_store.py tests/test_doublepipe_psa_persistence.py tests/test_doublepipe_run_psa_cancel.py -q
```
기대: 전부 통과.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/services/doublepipe_psa_service.py`, `tests/test_job_cancel_store.py`.

---

### Task 3: `ManagedAnalysisExecutor.submit(fn, job_id, *args)` 명시 + `attach_future`

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/job_manager.py:169` `ManagedAnalysisExecutor.submit` — 첫 위치 인자 `job_id` 를 문서화된 계약으로 명시, `_bind_job_context` 로 worker 스레드에 `_CURRENT_JOB_ID` 를 심고, `attach_future` 를 자동 호출한다.
- Create: `HiTessWorkBenchBackEnd/tests/test_job_cancel_executor.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
"""ManagedAnalysisExecutor.submit(fn, job_id, *args) 계약 + current_job_id() 컨텍스트 전파."""
import threading
import time

from concurrent.futures import Future

from app.services import job_manager


def test_submit_binds_current_job_id_in_worker_thread():
    executor = job_manager.ManagedAnalysisExecutor(max_workers=1)
    try:
        seen: dict = {}
        done = threading.Event()

        def task(job_id):
            seen["worker_job_id"] = job_manager.current_job_id()
            done.set()

        job_manager.job_status_store.set("j-ctx-1", {"status": "Pending", "progress": 0, "message": "대기"})
        executor.submit(task, "j-ctx-1")
        assert done.wait(2)
        assert seen["worker_job_id"] == "j-ctx-1"
        assert job_manager.current_job_id() is None  # 밖에서는 None
    finally:
        executor.shutdown(wait=True)


def test_submit_attaches_future_to_store():
    executor = job_manager.ManagedAnalysisExecutor(max_workers=1)
    try:
        # 첫 작업은 slot 하나를 점유해서 두 번째가 큐에서 대기하게 만든다.
        gate = threading.Event()
        release = threading.Event()

        def blocker(job_id):
            gate.set()
            release.wait(5)

        job_manager.job_status_store.set("j-fut-1", {"status": "Pending", "progress": 0, "message": "대기"})
        job_manager.job_status_store.set("j-fut-2", {"status": "Pending", "progress": 0, "message": "대기"})
        executor.submit(blocker, "j-fut-1")
        assert gate.wait(2)

        future = executor.submit(lambda job_id: None, "j-fut-2")
        # 대기 중 Future 가 store 에 붙었다.
        assert job_manager.job_status_store._futures.get("j-fut-2") is future

        # 취소가 Future 로 이어진다 — future.cancel() 이 성공하고 상태가 Cancelled.
        assert job_manager.job_status_store.cancel("j-fut-2") is True
        entry = job_manager.job_status_store.get("j-fut-2")
        assert entry["status"] == "Cancelled"

        release.set()
    finally:
        executor.shutdown(wait=True)


def test_submit_without_job_id_still_works():
    """계약을 지키지 않는 옛 호출부(첫 인자가 str 이 아님)도 그냥 실행된다(attach_future 없이)."""
    executor = job_manager.ManagedAnalysisExecutor(max_workers=1)
    try:
        done = threading.Event()
        executor.submit(lambda: done.set())
        assert done.wait(2)
    finally:
        executor.shutdown(wait=True)


def test_bind_job_context_resets_after_completion():
    """current_job_id 가 다음 작업의 컨텍스트로 새지 않는다."""
    executor = job_manager.ManagedAnalysisExecutor(max_workers=1)
    try:
        job_manager.job_status_store.set("j-a", {"status": "Pending", "progress": 0, "message": "대기"})
        job_manager.job_status_store.set("j-b", {"status": "Pending", "progress": 0, "message": "대기"})

        seen: list = []
        def cap(job_id):
            seen.append((job_id, job_manager.current_job_id()))

        fa = executor.submit(cap, "j-a")
        fb = executor.submit(cap, "j-b")
        fa.result(timeout=2); fb.result(timeout=2)
        assert ("j-a", "j-a") in seen
        assert ("j-b", "j-b") in seen
    finally:
        executor.shutdown(wait=True)
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_cancel_executor.py -q
```
기대: `AssertionError`(현재 submit 은 컨텍스트를 바인딩하지 않고 attach_future 도 안 부른다).

- [ ] **Step 3: `submit` 개편**

`job_manager.py:184` 부근 `ManagedAnalysisExecutor.submit` 을 아래로 교체:

```python
    def submit(self, fn, /, *args, **kwargs):
        """작업을 제출합니다.

        계약(`_intake.py:171` 이 이 형태로 호출):
            submit(task_fn, job_id, *task_args, **kwargs)

        - 첫 위치 인자가 str 이면 job_id 로 해석해 worker 스레드에 `_CURRENT_JOB_ID` 로 주입하고
          Future 를 `JobStatusStore.attach_future(job_id, future)` 로 붙인다.
        - 첫 인자가 str 이 아니면(옛 계약을 안 지키는 호출) 컨텍스트 주입도 attach 도 하지 않는다.
        """
        job_id = args[0] if args and isinstance(args[0], str) else None
        wrapped = _bind_job_context(fn, job_id) if job_id is not None else fn

        with self._lock:
            executor = self._executor
            if executor is None or not self._accepting:
                raise RuntimeError("analysis executor has been shut down")
            self._inflight += 1
            try:
                future = executor.submit(wrapped, *args, **kwargs)
            except BaseException:
                self._inflight -= 1
                raise
        future.add_done_callback(self._future_done)
        if job_id is not None:
            job_status_store.attach_future(job_id, future)
        return future
```

같은 파일 모듈 수준 함수 추가(`ManagedAnalysisExecutor` 위):

```python
def _bind_job_context(fn: Callable, job_id: str) -> Callable:
    """worker 스레드에서 `_CURRENT_JOB_ID` 를 job_id 로 세트한 뒤 fn(*args, **kwargs) 를 부른다.

    ContextVar.set() 이 돌려주는 Token 을 reset 해 다음 작업으로 새지 않게 한다.
    """
    def _run(*args, **kwargs):
        token = _CURRENT_JOB_ID.set(job_id)
        try:
            return fn(*args, **kwargs)
        finally:
            _CURRENT_JOB_ID.reset(token)
    return _run
```

`job_status_store` 심볼을 `submit` 안에서 참조하려면 파일 아래쪽의 싱글턴 정의가 더 위로 갈 필요는 없다 — 파이썬은 함수 호출 시점에 이름을 찾는다. 순환 참조는 없다.

- [ ] **Step 4: `_handle_future_result` 취소 처리 확인**

`app/routers/_intake.py:192` 부근 `_handle_future_result` 는 `future.cancelled()` 를 먼저 확인해 조용히 return 한다(취소된 Future 의 `.result()` 는 `CancelledError` 를 던져 "task 외부 예외" 로 오인·`Failed` 마킹을 유도 — 동결 규칙이 막지만 로그가 남는다). 현재 구현이 이미 하는지 확인만 하고, 하지 않으면 아래 3줄을 함수 시작 부분에 추가:

```python
    if future is not None and getattr(future, "cancelled", lambda: False)():
        return
```

(테스트에서 `future.result()` 가 `CancelledError` 를 던져도 이 체크로 걸러진다.)

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_cancel_executor.py tests/test_job_submission_lifecycle.py -q
```
기대: 신규 4건 + 기존 계약 테스트 통과.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/services/job_manager.py`, `app/routers/_intake.py`, `tests/test_job_cancel_executor.py`.

---

### Task 4: 5개 `Popen` 서비스 등록 훅

**대상(spec §1.4 A/§3.4 실측, 2026-09-18 기준):**

| 파일 | Popen 라인 | 취소 대상? | 처리 |
|---|---|---|---|
| `app/services/analysis_runner.py` | `:147` | ✅ 예 | `run_subprocess_killtree` 안에서 자동 등록/해제 (Task 4a) |
| `app/services/mooring_fitting_service.py` | `:60` | ✅ 예 | `_run_capture` 에 `job_id=None` 인자 + 등록/해제 (Task 4b) |
| `app/services/doublepipe_psa_service.py` | `:785` | ✅ 예 | Task 2 에서 이미 등록 훅 추가 완료 |
| `app/services/doublepipe_modeshape_service.py` | `:286` | ❌ 아니오 | 뷰어 상주 프로세스(streamlit) — job 안에서 도는 게 아님. 무수정 |
| `app/services/remote_session_service.py` | `:233` | ❌ 아니오 | ≤20초 동기 RDP 조회. job 안에서 도는 게 아님. 무수정 |

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/analysis_runner.py` — `run_subprocess_killtree` 에 `job_id: str | None = None` 인자 + `job_status_store.register_process`/`unregister_process` 훅 + 진입 직전 `is_cancel_requested` 사전 체크(`JobCancelledError` 로 승격 대신 조용히 `TimeoutExpired` 로 잘라 기존 catch 를 재사용). 반환/예외 계약(bytes `CompletedProcess`, `TimeoutExpired` 재-raise) 무변경.
- Modify: `HiTessWorkBenchBackEnd/app/services/mooring_fitting_service.py:49` — `_run_capture(cmd, cwd, timeout, *, job_id=None)` 로 시그니처 확장. Popen 생성 직후 `job_status_store.register_process`, 성공/타임아웃 어느 경로든 `unregister_process`. TimeoutExpired 시 자체 `_kill_process_tree(proc.pid)` 대신 `job_manager._kill_process_tree(proc)` 를 부른다. 호출부 3곳(`:247` build-full, `:448` solve-bdf, `:561` report verb)은 `job_id=job_manager.current_job_id()` 를 명시 인자로 넘긴다(첫 인자가 아니라 키워드라 기존 위치 인자를 안 바꾼다).

- [ ] **Step 1: 실패 테스트 작성** — `tests/test_job_cancel_runner.py`:

```python
"""공용 래퍼(run_subprocess_killtree)와 Mooring _run_capture 의 Popen 등록/해제 검증."""
import subprocess

import pytest

from app.services import analysis_runner, job_manager


class FakePopen:
    """subprocess.Popen 대체. communicate 는 즉시 반환하며 pid 만 흉내낸다."""
    def __init__(self, *args, **kwargs):
        self.pid = 4242
        self._alive = True
        self.args = args[0] if args else []
    def poll(self):
        return None if self._alive else 0
    def communicate(self, timeout=None):
        self._alive = False
        return (b"OK", b"")
    def wait(self, timeout=None):
        self._alive = False
        return 0
    def terminate(self):
        self._alive = False
    def kill(self):
        self._alive = False


@pytest.fixture(autouse=True)
def _isolate_psutil(monkeypatch):
    monkeypatch.setattr(job_manager, "_load_psutil", lambda: None, raising=False)
    monkeypatch.setattr(job_manager, "_taskkill_tree", lambda pid: False, raising=False)


def test_run_subprocess_killtree_registers_and_unregisters_popen(monkeypatch):
    seen = {"reg": [], "unreg": []}
    def _reg(job_id, popen): seen["reg"].append((job_id, popen))
    def _unreg(job_id, popen): seen["unreg"].append((job_id, popen))
    monkeypatch.setattr(job_manager.job_status_store, "register_process", _reg)
    monkeypatch.setattr(job_manager.job_status_store, "unregister_process", _unreg)
    monkeypatch.setattr(analysis_runner.subprocess, "Popen", FakePopen)
    # psutil 이 있는 경로(폴백 아님)를 강제
    monkeypatch.setattr(analysis_runner, "psutil", object(), raising=False)

    analysis_runner.run_subprocess_killtree(
        ["fake"], cwd=None, timeout=1, job_id="j-run-1",
    )

    assert seen["reg"] and seen["reg"][0][0] == "j-run-1"
    assert seen["unreg"] and seen["unreg"][0][0] == "j-run-1"


def test_run_subprocess_killtree_skips_when_cancel_already_requested(monkeypatch):
    """이미 취소가 요청된 job 이 새 프로세스를 띄우려 하면 TimeoutExpired 로 잘라 기존 catch 재사용."""
    monkeypatch.setattr(
        job_manager.job_status_store, "is_cancel_requested", lambda jid: jid == "j-can",
    )
    monkeypatch.setattr(analysis_runner.subprocess, "Popen", FakePopen)

    with pytest.raises(subprocess.TimeoutExpired):
        analysis_runner.run_subprocess_killtree(
            ["fake"], cwd=None, timeout=1, job_id="j-can",
        )


def test_run_subprocess_killtree_infers_job_id_from_context(monkeypatch):
    """job_id 를 명시하지 않으면 current_job_id() 를 쓴다."""
    seen = {"reg": []}
    monkeypatch.setattr(
        job_manager.job_status_store, "register_process",
        lambda jid, popen: seen["reg"].append(jid),
    )
    monkeypatch.setattr(job_manager.job_status_store, "unregister_process", lambda *_a: None)
    monkeypatch.setattr(analysis_runner.subprocess, "Popen", FakePopen)

    token = job_manager._CURRENT_JOB_ID.set("j-ctx")
    try:
        analysis_runner.run_subprocess_killtree(["fake"], timeout=1)
    finally:
        job_manager._CURRENT_JOB_ID.reset(token)
    assert seen["reg"] == ["j-ctx"]


def test_mooring_run_capture_registers_and_delegates_kill_on_timeout(monkeypatch):
    from app.services import mooring_fitting_service as mfs

    class SlowPopen(FakePopen):
        def communicate(self, timeout=None):
            raise subprocess.TimeoutExpired(cmd=self.args, timeout=timeout)

    monkeypatch.setattr(mfs.subprocess, "Popen", SlowPopen)

    reg_calls, unreg_calls, kill_calls = [], [], []
    monkeypatch.setattr(
        job_manager.job_status_store, "register_process",
        lambda jid, popen: reg_calls.append(jid),
    )
    monkeypatch.setattr(
        job_manager.job_status_store, "unregister_process",
        lambda jid, popen: unreg_calls.append(jid),
    )
    monkeypatch.setattr(
        "app.services.job_manager._kill_process_tree",
        lambda popen, grace_seconds=None: kill_calls.append(popen) or True,
    )

    with pytest.raises(subprocess.TimeoutExpired):
        mfs._run_capture(["mf.exe"], cwd=".", timeout=1, job_id="j-mf")

    assert reg_calls == ["j-mf"]
    assert unreg_calls == ["j-mf"]
    assert len(kill_calls) == 1
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_cancel_runner.py -q
```
기대: `TypeError` 또는 `AssertionError`(현재 시그니처에 `job_id` 인자가 없음).

- [ ] **Step 3: `analysis_runner.run_subprocess_killtree` 개편**

`analysis_runner.py:119` 부근 함수 전체를 아래로 교체(반환/예외 계약은 그대로):

```python
def run_subprocess_killtree(
    cmd_args,
    *,
    cwd: Optional[str] = None,
    timeout: Optional[float] = None,
    job_id: Optional[str] = None,
) -> subprocess.CompletedProcess:
    """subprocess.run(stdout=PIPE, stderr=PIPE) 대체 + 자식 트리 정리 + job 취소 훅.

    반환/예외 계약(무변경):
      - 성공: `CompletedProcess(cmd, returncode, stdout:bytes, stderr:bytes)`
      - 초과: `subprocess.TimeoutExpired` 재-raise (호출부의 기존 except 재사용)

    취소 훅:
      - Popen 생성 직전에 `job_status_store.is_cancel_requested(job_id)` 를 검사.
        True 면 프로세스를 만들지 않고 `TimeoutExpired` 로 잘라 호출부의 실패 경로를 재사용한다.
      - Popen 생성 직후 `register_process(job_id, proc)`, 종료 시 `unregister_process`.
      - job_id 를 명시하지 않으면 `job_manager.current_job_id()` 를 쓴다.
    """
    from . import job_manager

    effective_job_id = job_id or job_manager.current_job_id()
    if effective_job_id and job_manager.job_status_store.is_cancel_requested(effective_job_id):
        raise subprocess.TimeoutExpired(cmd_args, timeout, output=b"", stderr=b"")

    try:
        import psutil
    except Exception:
        psutil = None

    if psutil is None:
        # psutil 없으면 트리 정리 능력이 없지만 취소 훅은 여전히 유효하다.
        proc = subprocess.Popen(
            cmd_args, cwd=cwd,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        if effective_job_id:
            job_manager.job_status_store.register_process(effective_job_id, proc)
        try:
            out, err = proc.communicate(timeout=timeout)
            return subprocess.CompletedProcess(cmd_args, proc.returncode, out, err)
        finally:
            if effective_job_id:
                job_manager.job_status_store.unregister_process(effective_job_id, proc)

    proc = subprocess.Popen(
        cmd_args, cwd=cwd,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if effective_job_id:
        job_manager.job_status_store.register_process(effective_job_id, proc)
    try:
        out, err = proc.communicate(timeout=timeout)
        return subprocess.CompletedProcess(cmd_args, proc.returncode, out, err)
    except subprocess.TimeoutExpired:
        try:
            parent = psutil.Process(proc.pid)
            victims = parent.children(recursive=True)
            victims.append(parent)
            for p in victims:
                try:
                    p.kill()
                except Exception:
                    pass
            psutil.wait_procs(victims, timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        try:
            out, err = proc.communicate(timeout=5)
        except Exception:
            out, err = b"", b""
        raise subprocess.TimeoutExpired(cmd_args, timeout, output=out, stderr=err)
    finally:
        if effective_job_id:
            job_manager.job_status_store.unregister_process(effective_job_id, proc)
```

- [ ] **Step 4: `mooring_fitting_service._run_capture` 개편**

`mooring_fitting_service.py:49` 부근 함수를 아래로 교체:

```python
def _run_capture(cmd: list[str], cwd: str, timeout: int, *, job_id: str | None = None):
    """
    subprocess.run(timeout=...) 대체 — 자식 트리 정리 + job 취소 훅.

    - MooringFitting.exe → cmd.exe → nastran.exe → analysis.exe 손자까지 회수해 MSC 라이선스
      slot 이 좀비로 남지 않게 한다(위 `run_subprocess_killtree` 와 같은 이유).
    - `job_id` 는 컨텍스트(`job_manager.current_job_id()`) 폴백을 갖는다.
    - Popen publish 후 `job_status_store.register_process`, 성공/타임아웃 어느 경로든 unregister.
    - TimeoutExpired 시 자체 taskkill 대신 공용 `job_manager._kill_process_tree(proc)` 를 부른다.

    반환: (returncode, stdout_bytes, stderr_bytes)
    """
    from . import job_manager

    effective_job_id = job_id or job_manager.current_job_id()
    if effective_job_id and job_manager.job_status_store.is_cancel_requested(effective_job_id):
        raise subprocess.TimeoutExpired(cmd, timeout, output=b"", stderr=b"")

    proc = subprocess.Popen(
        cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if effective_job_id:
        job_manager.job_status_store.register_process(effective_job_id, proc)
    try:
        stdout_b, stderr_b = proc.communicate(timeout=timeout)
        return proc.returncode, stdout_b, stderr_b
    except subprocess.TimeoutExpired:
        job_manager._kill_process_tree(proc)
        try:
            proc.communicate(timeout=10)
        except Exception:
            pass
        raise
    finally:
        if effective_job_id:
            job_manager.job_status_store.unregister_process(effective_job_id, proc)
```

호출부 3곳(`:247` build-full, `:448` solve-bdf, `:561` report verb)은 시그니처를 안 바꿔도 된다(키워드 인자만 추가). 다만 명시성을 위해 `job_id=job_manager.current_job_id()` 를 넘기고 싶다면 각 호출부 위쪽에 `from . import job_manager` 를 추가하고 인자를 붙일 수 있다(선택). 기본값이 `current_job_id()` 폴백이라 그냥 둬도 동작한다.

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_cancel_runner.py tests/test_analysis_runner_subprocess.py -q
```
기대: 신규 4건 + 기존 회귀 통과.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/services/analysis_runner.py`, `app/services/mooring_fitting_service.py`, `tests/test_job_cancel_runner.py`.

---

### Task 5: `subprocess.run()` 블로킹 서비스 사전 체크

**대상 서비스(spec §1.4 B — Popen 이 아니라 `subprocess.run()` 블로킹):** `unit_structural_service.py:204`, `module_ocean_structural_service.py:126/138`, `groupmoduleunit_service.py:633`, `plate_structure_service.py:371/391`, `modelbuilder_solve_service.py:218`, `hitess_modelflow_service.py:153/458/490/552`, `module_stability_service.py:61/172`, `bdfscanner_service.py:67`, `hpscr_service.py:124`, `drawing_to_analysis_service.py:383/675/729/2428`.

**전략:** 마스터 §2.5 결정 — 이 서비스들은 Popen 전환하지 **않는다**. 대신 각 `subprocess.run()` **직전**에 `job_manager.is_cancel_requested(job_id)` 를 부르고, True 면 실행하지 않고 실패 경로로 잘라 준다. `nastran.exe` 처럼 20~30분짜리는 위 Task 4 의 `run_subprocess_killtree`(=Popen 기반) 를 이미 쓰거나 이번에 그쪽으로 교체된 경로이므로 이 사전 체크만으로도 실사용에서 즉시성 손해가 없다.

**Files:**
- Modify: 위 표의 각 서비스 파일 — 각 subprocess.run 호출 위에 3~5줄 사전 체크 삽입. 함수 시그니처는 안 바꾼다(대부분 `job_id` 를 이미 받거나 컨텍스트로 조회 가능).
- Create: `HiTessWorkBenchBackEnd/tests/test_job_cancel_services_guard.py`

- [ ] **Step 1: 가드 테스트 작성**

```python
"""서비스가 subprocess 를 부르기 전에 취소 사전 체크를 하는지 정적 검사.

각 서비스 파일에 아래 두 문자열이 함께 있는지만 확인한다(구현 형태는 서비스별로 다르다):
  - "is_cancel_requested" 참조
  - "subprocess.run" 또는 "run_subprocess_killtree" 참조
동시에 등장하면 사전 체크가 있다고 본다.

Popen 서비스는 `register_process` 를 부르는지도 확인한다.
"""
from pathlib import Path
import pytest

BACKEND = Path(__file__).resolve().parent.parent / "app" / "services"

SUBPROCESS_GATE_SERVICES = [
    "unit_structural_service.py",
    "module_ocean_structural_service.py",
    "groupmoduleunit_service.py",
    "plate_structure_service.py",
    "modelbuilder_solve_service.py",
    "hitess_modelflow_service.py",
    "module_stability_service.py",
    "bdfscanner_service.py",
    "hpscr_service.py",
    # drawing_to_analysis_service 는 2,400줄이라 파일 단위 가드에서 제외(spec §1.4 마지막 문단)
]

POPEN_REGISTER_SERVICES = [
    "analysis_runner.py",
    "mooring_fitting_service.py",
    "doublepipe_psa_service.py",
]


@pytest.mark.parametrize("service", SUBPROCESS_GATE_SERVICES)
def test_service_calls_is_cancel_requested(service):
    src = (BACKEND / service).read_text(encoding="utf-8")
    assert "is_cancel_requested" in src, (
        f"{service} 에 취소 사전 체크가 없다. "
        "각 subprocess.run 앞에 job_manager.job_status_store.is_cancel_requested(job_id) 를 추가하라."
    )


@pytest.mark.parametrize("service", POPEN_REGISTER_SERVICES)
def test_popen_service_calls_register_process(service):
    src = (BACKEND / service).read_text(encoding="utf-8")
    assert "register_process" in src, (
        f"{service} 의 Popen 생성 직후 job_status_store.register_process 를 부르지 않는다."
    )
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_cancel_services_guard.py -q
```
기대: 대상 서비스 파일에 `is_cancel_requested` 문자열이 없어 대다수 fail.

- [ ] **Step 3: 각 서비스에 사전 체크 삽입**

각 대상 서비스에서 `subprocess.run(` 이 나오는 함수의 **호출 직전**에 아래 스니펫을 추가한다(함수 시그니처가 `job_id` 를 받으면 그대로, 아니면 `job_manager.current_job_id()` 폴백):

```python
        # 사용자가 이미 취소를 요청했으면 해석기를 띄우지 않는다.
        from .job_manager import job_status_store, current_job_id
        if job_status_store.is_cancel_requested(job_id or current_job_id()):
            raise RuntimeError("cancelled")   # 상위 except 가 이 예외를 Failed 로 마킹 → 동결 규칙으로 Cancelled 유지
```

파일별 실제 위치와 삽입 지침:

| 파일 | 삽입 지점 | 예외 처리 |
|---|---|---|
| `unit_structural_service.py:204` (`_run_nastran`) | `subprocess.run([...])` 앞. 함수 인자 `job_id` 이용 | 상위 `except Exception` 에서 `mark_complete("Failed")` 그대로 |
| `module_ocean_structural_service.py:126/138` | 두 곳 각각. `run_subprocess_killtree` 로 이미 감싼 경로면 Task 4 훅이 자동으로 처리하므로 사전 체크만 |
| `groupmoduleunit_service.py:633` (`_run_nastran_validate`) | subprocess.run 앞. `job_id` 를 함수 인자로 받는다 |
| `plate_structure_service.py:371/391` (`task_execute_plate_structure`) | 두 곳 모두. 같은 함수라 상단에 한 번만 검사하고 두 번째 subprocess.run 앞에도 별도 게이트 추가(첫 subprocess.run 이 몇 분 걸릴 수 있어) |
| `modelbuilder_solve_service.py:218` (`task_execute_modelbuilder_solve.step`) | 내부 helper `step()` 함수 위쪽 |
| `hitess_modelflow_service.py:153/458/490/552` | 네 곳 모두. `_run_nastran_on_bdf`·`_run_f06parser`·`task_execute_apply_edit` 각각 |
| `module_stability_service.py:61/172` | `task_execute_module_stability`·`task_optimize_module_hoist_positions` 각각 |
| `bdfscanner_service.py:67` (`task_execute_bdfscanner`) | subprocess.run 앞 |
| `hpscr_service.py:124` (`task_execute_hpscr`) | subprocess.run 앞 (`:90` fs 도구는 건너뛴다 — 짧다) |

⚠ **드로잉 서비스는 `is_cancel_requested` 문자열이 파일 안에 있어야만** 가드 테스트가 통과한다 — drawing 은 위 표에서 제외했지만, 취소 즉시성이 필요하면 같은 스니펫을 각 subprocess.run 앞에 추가할 수 있다(가드에서 파일이 빠져 있으므로 추가하지 않아도 테스트는 안 깨진다).

- [ ] **Step 4: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_cancel_services_guard.py -q
```
기대: 12건 전부 통과(9개 subprocess 게이트 + 3개 Popen 등록).

- [ ] **Step 5: 회귀**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_unit_structural.py tests/test_hitess_modelflow.py tests/test_bdfscanner.py -q
```
기대: 서비스별 기존 통합 테스트는 영향 없음(cancel_requested 가 비어 있으면 `is_cancel_requested` 는 False 를 돌려주므로).

- [ ] **Step 6: 커밋 준비 완료** — 보고: 위 표의 서비스 파일 목록 + `tests/test_job_cancel_services_guard.py`.

---

### Task 6: 취소 API + 알림 지연 import

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/job_cancel_service.py`
- Modify: `HiTessWorkBenchBackEnd/app/routers/analysis.py` — 파일 끝에 `POST /api/analysis/{job_id}/cancel` 엔드포인트 + `notify(kind="job.cancelled")` 지연 import
- Create: `HiTessWorkBenchBackEnd/tests/test_job_cancel_route.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
"""취소 API — 소유자·관리자·타인·not-found·terminal 케이스 + PSA 위임 + 알림 지연 import."""
import types
from datetime import datetime

import pytest

from app import models
from app.services import doublepipe_psa_service, job_manager


def _make_owner_analysis(db, employee_id, job_id):
    a = models.Analysis(
        employee_id=employee_id,
        program_name="Truss Assessment",
        project_name="row",
        status="Running",
        job_id=job_id,
        job_status="Running",
        created_at=datetime.now(),
    )
    db.add(a); db.commit(); db.refresh(a)
    return a


def test_cancel_success_as_owner(switchable_client, db_session, monkeypatch):
    _make_owner_analysis(db_session, "EMP001", "j-cancel-1")
    job_manager.job_status_store.set("j-cancel-1", {"status": "Running", "progress": 30, "message": "solving"})

    called = {}
    monkeypatch.setattr(
        job_manager.job_status_store, "cancel",
        lambda jid, grace_seconds=None: called.setdefault("id", jid) or True,
    )

    switchable_client.as_user()
    r = switchable_client.post("/api/analysis/j-cancel-1/cancel")
    assert r.status_code == 200
    body = r.json()
    assert body["job_id"] == "j-cancel-1"
    assert body["kind"] == "queue"
    assert body["cancelled"] is True
    assert body["status"] == "Cancelled"


def test_cancel_success_as_admin(switchable_client, db_session, monkeypatch):
    _make_owner_analysis(db_session, "EMP001", "j-cancel-2")
    job_manager.job_status_store.set("j-cancel-2", {"status": "Running", "progress": 30, "message": "solving"})
    monkeypatch.setattr(job_manager.job_status_store, "cancel", lambda *_a, **_k: True)

    switchable_client.as_admin()
    assert switchable_client.post("/api/analysis/j-cancel-2/cancel").status_code == 200


def test_cancel_forbidden_when_not_owner_nor_admin(switchable_client, db_session):
    _make_owner_analysis(db_session, "OTHER", "j-cancel-3")
    job_manager.job_status_store.set("j-cancel-3", {"status": "Running", "progress": 30, "message": "solving", "employee_id": "OTHER"})

    switchable_client.as_user()   # EMP001 이 OTHER 의 작업 취소 시도
    assert switchable_client.post("/api/analysis/j-cancel-3/cancel").status_code == 403


def test_cancel_not_found(switchable_client):
    switchable_client.as_admin()
    assert switchable_client.post("/api/analysis/no-such/cancel").status_code == 404


def test_cancel_conflict_when_terminal_in_store(switchable_client, db_session):
    _make_owner_analysis(db_session, "EMP001", "j-cancel-4")
    job_manager.job_status_store.set("j-cancel-4", {"status": "Success", "progress": 100, "message": "완료"})

    switchable_client.as_user()
    r = switchable_client.post("/api/analysis/j-cancel-4/cancel")
    assert r.status_code == 409
    assert "Success" in r.json().get("detail", "")


def test_cancel_conflict_when_only_in_db(switchable_client, db_session):
    """스토어에서 만료된 완료 작업은 DB 만 남는다 — 취소 대상이 아님."""
    _make_owner_analysis(db_session, "EMP001", "j-cancel-5")
    # 스토어에는 없다.
    switchable_client.as_user()
    r = switchable_client.post("/api/analysis/j-cancel-5/cancel")
    assert r.status_code == 409


def test_cancel_delegates_to_psa_service(switchable_client, db_session, monkeypatch):
    """PSA 자체 스토어에 있는 job 은 doublepipe_psa_service.cancel_psa_job 으로 위임된다."""
    monkeypatch.setitem(doublepipe_psa_service._jobs, "psa-1", {
        "status": "running", "employeeId": "EMP001",
    })
    calls = []
    monkeypatch.setattr(
        doublepipe_psa_service, "cancel_psa_job",
        lambda jid, owner: calls.append((jid, owner)) or {"cancelled": True},
    )

    switchable_client.as_user()
    r = switchable_client.post("/api/analysis/psa-1/cancel")
    assert r.status_code == 200
    assert r.json()["kind"] == "psa"
    assert calls == [("psa-1", "EMP001")]


def test_run_psa_cancel_compat_route_still_works(switchable_client, db_session, monkeypatch):
    """구 라우트 POST /api/doublepipe/run-psa/cancel 도 같은 서비스 함수로 위임된다."""
    monkeypatch.setitem(doublepipe_psa_service._jobs, "psa-2", {
        "status": "running", "employeeId": "EMP001",
    })
    called = []
    monkeypatch.setattr(
        doublepipe_psa_service, "cancel_psa_job",
        lambda jid, owner: called.append(jid) or {"cancelled": True},
    )

    switchable_client.as_user()
    r = switchable_client.post(
        "/api/doublepipe/run-psa/cancel",
        json={"jobId": "psa-2", "employee_id": "EMP001"},
    )
    assert r.status_code == 200
    assert called == ["psa-2"]


def test_cancel_calls_notify_when_service_available(switchable_client, db_session, monkeypatch):
    _make_owner_analysis(db_session, "EMP001", "j-cancel-6")
    job_manager.job_status_store.set("j-cancel-6", {"status": "Running", "progress": 30, "message": "solving"})
    monkeypatch.setattr(job_manager.job_status_store, "cancel", lambda *_a, **_k: True)

    called = []
    fake = types.SimpleNamespace(
        notify=lambda db, **kwargs: called.append(kwargs.get("kind")),
    )
    monkeypatch.setitem(__import__("sys").modules, "app.services.notification_service", fake)

    switchable_client.as_user()
    switchable_client.post("/api/analysis/j-cancel-6/cancel")
    assert called == ["job.cancelled"]


def test_cancel_ignores_notify_when_service_missing(switchable_client, db_session, monkeypatch):
    _make_owner_analysis(db_session, "EMP001", "j-cancel-7")
    job_manager.job_status_store.set("j-cancel-7", {"status": "Running", "progress": 30, "message": "solving"})
    monkeypatch.setattr(job_manager.job_status_store, "cancel", lambda *_a, **_k: True)

    # notification_service 를 import 실패시키기
    import sys
    monkeypatch.setitem(sys.modules, "app.services.notification_service", None)

    switchable_client.as_user()
    r = switchable_client.post("/api/analysis/j-cancel-7/cancel")
    assert r.status_code == 200
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_cancel_route.py -q
```
기대: 대다수 404(라우트 미등록).

- [ ] **Step 3: `job_cancel_service.py` 생성**

```python
"""작업 취소 위치 판정 + 위임 — 라우터가 붙이는 얇은 헬퍼(마스터 §2.5)."""
from dataclasses import dataclass
import logging
from typing import Any

from sqlalchemy.orm import Session

from .. import models
from . import job_manager
from . import doublepipe_psa_service

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class JobLocation:
    kind: str                 # "queue" | "psa" | "record"
    owner_id: str | None
    status: str | None


def locate_job(job_id: str, db: Session) -> JobLocation | None:
    """job_id 가 어디 있는지 찾아 소유자/상태와 함께 돌려준다.

    우선순위: JobStatusStore(공용 큐) → doublepipe_psa_service._jobs(자체 스토어) → DB Analysis(만료).
    아무 데도 없으면 None.
    """
    entry = job_manager.job_status_store.get(job_id)
    if entry is not None:
        owner = entry.get("employee_id")
        if not owner:
            # 스토어에 소유자가 없으면 DB 에서 보강.
            record = db.query(models.Analysis).filter(models.Analysis.job_id == job_id).first()
            owner = getattr(record, "employee_id", None) if record else None
        return JobLocation(kind="queue", owner_id=owner, status=entry.get("status"))

    psa_job = doublepipe_psa_service._jobs.get(job_id)
    if psa_job is not None:
        return JobLocation(kind="psa", owner_id=psa_job.get("employeeId"), status=psa_job.get("status"))

    record = db.query(models.Analysis).filter(models.Analysis.job_id == job_id).first()
    if record is not None:
        return JobLocation(kind="record", owner_id=record.employee_id, status=record.status)
    return None


def cancel_located(
    job_id: str,
    location: JobLocation,
    *,
    requester: str,
    db: Session,
) -> dict[str, Any]:
    """실제 취소 수행 + 알림. 라우터는 권한 검사만 하고 이 함수를 부른다.

    반환:
      - queue/성공: {"cancelled": True, "status": "Cancelled", "message": ..., "kind": "queue"}
      - queue/직전에 성공: {"cancelled": False, "status": <실제 상태>, ...}
      - psa: doublepipe_psa_service.cancel_psa_job 의 응답 + kind
    """
    if location.kind == "psa":
        raw = doublepipe_psa_service.cancel_psa_job(job_id, location.owner_id or requester)
        response = {"job_id": job_id, "kind": "psa", **raw}
        if raw.get("cancelled"):
            _notify_cancelled(db, employee_id=location.owner_id or requester, job_id=job_id)
        return response

    if location.kind == "queue":
        ok = job_manager.job_status_store.cancel(job_id)
        entry = job_manager.job_status_store.get(job_id) or {}
        status = entry.get("status") or location.status or "Unknown"
        message = entry.get("message")
        if ok:
            _notify_cancelled(db, employee_id=location.owner_id or requester, job_id=job_id)
        return {
            "job_id": job_id,
            "kind": "queue",
            "cancelled": bool(ok),
            "status": status,
            "message": message,
        }

    # record 는 라우터에서 409 로 잘리므로 여기 오면 계약 위반.
    raise RuntimeError(f"cancel_located called on non-cancellable location: {location}")


def _notify_cancelled(db: Session, *, employee_id: str | None, job_id: str) -> None:
    """알림 서비스 지연 import — Plan A(notification_service) 없이도 안전하게 동작."""
    if not employee_id:
        return
    try:
        from . import notification_service   # noqa: WPS433 (지연 import 는 설계)
    except ImportError:
        return
    if notification_service is None or not hasattr(notification_service, "notify"):
        return
    record = db.query(models.Analysis).filter(models.Analysis.job_id == job_id).first()
    program = getattr(record, "program_name", None) or "해석"
    try:
        notification_service.notify(
            db,
            employee_id=employee_id,
            kind="job.cancelled",
            title=f"{program} 해석을 중단했습니다",
            body=job_id,
            link={"menu": "My Projects", "params": {"analysis_id": getattr(record, "id", None), "job_id": job_id}},
            dedupe_key=f"job.cancelled:{job_id}",
        )
    except Exception:
        logger.warning("job.cancelled 알림 생성 실패 job=%s", job_id, exc_info=True)
```

- [ ] **Step 4: 라우터 엔드포인트 추가**

`app/routers/analysis.py` 파일 끝(마지막 라우트 뒤)에 추가:

```python
from ..services import job_cancel_service   # 파일 상단 import 블록으로 옮겨도 됨


@router.post("/{job_id}/cancel", tags=["analysis"])
def cancel_analysis_job(
    job_id: str,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """실행/대기 중인 해석 작업을 중단합니다(소유자 또는 관리자)."""
    location = job_cancel_service.locate_job(job_id, db)
    if location is None:
        raise HTTPException(status_code=404, detail="해당 작업을 찾을 수 없습니다.")
    assert_current_user_can_access_owner(location.owner_id, current_user, db)
    if location.kind == "record":
        raise HTTPException(
            status_code=409,
            detail=f"이미 종료된 작업입니다(상태: {location.status or '?'})",
        )
    if location.status in ("Success", "Failed", "Interrupted", "Cancelled"):
        raise HTTPException(
            status_code=409,
            detail=f"이미 종료된 작업입니다(상태: {location.status})",
        )
    return job_cancel_service.cancel_located(job_id, location, requester=current_user, db=db)
```

`analysis.py` 상단 import 블록의 `from ._access_control import (…)` 를 훑어 `assert_current_user_can_access_owner` 가 이미 들어와 있는지 확인(기존 라인 `1678` 등에서 이미 씀).

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_cancel_route.py -q
```
기대: 10건 통과.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/services/job_cancel_service.py`, `app/routers/analysis.py`, `tests/test_job_cancel_route.py`.

---

### Task 7: `_cleanup_loop` — `Cancelled` 24h 정리

**대상:** Task 1 에서 `_sweep_expired` 를 `TERMINAL_STATUSES` 기준으로 만들었으므로 자동으로 `Cancelled` 도 24h 후 정리된다. 이 Task 는 그 동작이 실제로 도는지 스토어 스냅샷 검사만 한다.

**Files:**
- Create: 기존 `tests/test_job_cancel_store.py` 에 통합 회귀 케이스 추가(별도 파일 없음 — Task 1 파일 확장).

- [ ] **Step 1: 테스트 추가** — `tests/test_job_cancel_store.py` 파일 끝에:

```python
def test_cleanup_removes_all_four_terminal_statuses(store):
    """Success/Failed/Interrupted/Cancelled 모두 24h 후 정리된다."""
    from datetime import datetime, timedelta

    for jid, status in [("j-s", "Success"), ("j-f", "Failed"), ("j-i", "Interrupted"), ("j-c", "Cancelled")]:
        store.set(jid, {"status": status, "progress": 100, "message": "-"})
        with store._lock:
            store._store[jid]["_created_at"] = datetime.now() - timedelta(seconds=job_manager.JOB_RETENTION_SECONDS + 5)

    store._cleanup_once()
    for jid in ("j-s", "j-f", "j-i", "j-c"):
        assert store.get(jid) is None
    # Cancelled 는 cancel_requested 에서도 같이 지워진다.
    assert "j-c" not in store.cancel_requested
```

- [ ] **Step 2: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_cancel_store.py::test_cleanup_removes_all_four_terminal_statuses -q
```
기대: 1건 통과.

- [ ] **Step 3: 커밋 준비 완료** — 보고: `tests/test_job_cancel_store.py`.

---

### Task 8: `POST /run-psa/cancel` 호환 유지(얇은 위임)

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/routers/doublepipe.py:305` — `cancel_psa` 를 `job_cancel_service.cancel_located` 위임으로 대체(응답 형태는 유지 + `kind:"psa"`).

- [ ] **Step 1: 라우트 수정**

기존:

```python
@router.post("/run-psa/cancel")
def cancel_psa(req, ...):
    ...
    return cancel_psa_job(req.jobId, owner or current_user)
```

를 아래로 교체:

```python
@router.post("/run-psa/cancel")
def cancel_psa(
    req: CancelPsaRequest,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """실행 중인 PSA 해석을 소유자가 중단합니다(공용 API 로 위임)."""
    from ..services import job_cancel_service

    location = job_cancel_service.locate_job(req.jobId, db)
    if location is None or location.kind != "psa":
        raise HTTPException(status_code=404, detail="해당 해석 작업을 찾을 수 없습니다.")
    assert_current_user_can_access_owner(location.owner_id, current_user, db)
    authenticated_employee_id(req.employee_id, current_user)
    result = job_cancel_service.cancel_located(
        req.jobId, location, requester=current_user, db=db,
    )
    # DoublePipePsaTray(프론트)가 기대하는 최소 스키마 보장 — kind/job_id 는 상위 호환 추가 필드.
    return result
```

DoublePipePsaTray 는 `cancelled: bool`, `status?`, `message?` 만 읽고 넘어서는 필드는 무시하도록 이미 방어적이다(추가 필드는 무해). `test_job_cancel_route.py::test_run_psa_cancel_compat_route_still_works` 가 이 경로를 검증한다.

- [ ] **Step 2: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_cancel_route.py tests/test_doublepipe_run_psa_cancel.py -q
```
기대: 신규 + 기존 회귀 통과.

- [ ] **Step 3: 커밋 준비 완료** — 보고: `app/routers/doublepipe.py`.

---

### Task 9: 프론트 API — `cancelAnalysisJob(jobId)`

**Files:**
- Modify: `HiTessWorkBench/frontend/src/api/analysis.js` — 파일 끝에 `cancelAnalysisJob` 추가.

- [ ] **Step 1: 함수 추가** — `api/analysis.js` 마지막에:

```js
/**
 * 실행/대기 중인 해석 작업을 중단한다. 소유자 또는 관리자만 허용된다.
 * @param {string} jobId
 * @returns {Promise<{data: {job_id: string, kind: 'queue'|'psa', cancelled: boolean, status: string, message?: string}}>}
 */
export const cancelAnalysisJob = (jobId) =>
  axios.post(
    `${API_BASE_URL}/api/analysis/${encodeURIComponent(jobId)}/cancel`,
    {},
    { headers: getAuthHeaders() },
  );
```

- [ ] **Step 2: 빌드**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && npm run build
```
기대: 오류 없음.

- [ ] **Step 3: 커밋 준비 완료** — 보고: `src/api/analysis.js`.

---

### Task 10: Job Center / MyProjects "중단" 버튼 + `ConfirmDialog` + `Cancelled` 뱃지 + 수동 검증

**Files:**
- Modify: `HiTessWorkBench/frontend/src/utils/globalJobs.js` — `TERMINAL_JOB_STATUSES` 에 `'Cancelled'`.
- Modify: `HiTessWorkBench/frontend/src/components/ui/StatusBadge.jsx:19` 부근 — `STATUS_META` 에 `Cancelled` 추가.
- Modify: `HiTessWorkBench/frontend/src/components/platform/UtilityDock.jsx` — `TERMINAL_STATUSES` 에 `'Cancelled'`, `STATUS_CONFIG.Cancelled`, `JobRow` 에 "중단" 버튼, 도크 레벨 `ConfirmDialog` + `cancelAnalysisJob` 호출.
- Modify: `HiTessWorkBench/frontend/src/pages/analysis/MyProjects.jsx:642` — `STATUS_FILTERS` 에 `'Cancelled'`. `:1140` 행 액션에 "중단" 버튼 + `ConfirmDialog`.

- [ ] **Step 1: `globalJobs.js` — Cancelled 를 terminal 로**

`src/utils/globalJobs.js:19` 를 교체:

```js
const TERMINAL_JOB_STATUSES = new Set(['Success', 'Failed', 'Interrupted', 'Cancelled']);
```

- [ ] **Step 2: `StatusBadge.jsx` — 뱃지 메타 추가**

`src/components/ui/StatusBadge.jsx:19` 다음 줄에 추가(`Interrupted` 뒤):

```js
  Cancelled: { variant: 'warning', label: '사용자 중단', icon: XCircle },
```

- [ ] **Step 3: `UtilityDock.jsx` — 상태 메타 + 중단 버튼 + ConfirmDialog**

(a) 파일 상단 import 에 아래를 추가(이미 있는 것 제외):

```js
import { Ban } from 'lucide-react';
import { cancelAnalysisJob } from '../../api/analysis';
import { useToast } from '../../contexts/ToastContext';
import ConfirmDialog from '../ui/ConfirmDialog';
```

(b) `TERMINAL_STATUSES` 상수를 `Cancelled` 포함으로 교체:

```js
const TERMINAL_STATUSES = new Set(['Success', 'Failed', 'Interrupted', 'Cancelled']);
```

(c) `STATUS_CONFIG` 에 `Cancelled` 항목 추가(`Interrupted` 다음 줄):

```js
  Cancelled: {
    label: '사용자 중단',
    badge: 'warning',
    icon: Ban,
    iconClass: 'text-amber-600',
  },
```

(d) `JobRow` 에 "중단" 버튼 삽입 — 기존 휴지통 버튼 앞. `job.status` 가 `Pending` 이거나 `Running` 일 때만 렌더한다:

```jsx
        {(job.status === 'Pending' || job.status === 'Running') && (
          <button
            type="button"
            onClick={() => onRequestCancel(job)}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-amber-50 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            title="해석 중단"
            aria-label={`${job.displayName || job.menu} 해석 중단`}
          >
            <Ban size={14} />
          </button>
        )}
```

(e) `JobRow` prop 시그니처를 `{ job, onNavigate, onDismiss, onRequestCancel }` 로 확장.

(f) `UtilityDock` 컴포넌트 안에 취소 상태 훅 + 다이얼로그:

```jsx
  const { showToast } = useToast();
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  const requestCancel = (job) => setCancelTarget(job);
  const confirmCancel = async () => {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    try {
      const res = await cancelAnalysisJob(cancelTarget.jobId);
      const body = res?.data || {};
      if (body.cancelled) {
        // 폴러가 다음 tick 에 갱신하지만 즉시 반영해 사용자 피드백을 높인다.
        showToast('해석을 중단했습니다.', 'success');
      } else {
        showToast(body.message || '이미 종료된 작업입니다.', 'info');
      }
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      if (status === 403) showToast('본인이 시작한 해석만 중단할 수 있습니다.', 'error');
      else if (status === 404) showToast('작업을 찾을 수 없습니다(이미 만료됐거나 삭제됨).', 'error');
      else showToast(detail || '중단 요청에 실패했습니다.', 'error');
    } finally {
      setCancelling(false);
      setCancelTarget(null);
    }
  };
```

(g) `JobRow` 호출에 새 prop 을 넘긴다:

```jsx
              <JobRow
                key={job.jobId}
                job={job}
                onNavigate={navigateToJob}
                onDismiss={clearGlobalJob}
                onRequestCancel={requestCancel}
              />
```

(h) 컴포넌트 최상단 return 안(맨 뒤 `</nav>` 뒤)에 `ConfirmDialog` 추가:

```jsx
      <ConfirmDialog
        isOpen={!!cancelTarget}
        onCancel={() => (cancelling ? null : setCancelTarget(null))}
        onConfirm={confirmCancel}
        title="해석 중단"
        message={
          cancelTarget
            ? `『${cancelTarget.displayName || cancelTarget.menu}』 해석을 중단할까요? ` +
              '실행 중인 해석기 프로세스를 종료하며 되돌릴 수 없습니다.'
            : ''
        }
        confirmLabel={cancelling ? '중단 중…' : '중단'}
        cancelLabel="유지"
        variant="warning"
      />
```

(i) 프로그레스바 색 분기의 `Interrupted` 옆에 `Cancelled` 추가:

```jsx
              job.status === 'Failed' || job.status === 'Interrupted' || job.status === 'Cancelled'
```

(j) `failedJobCount` useMemo 에서 `Cancelled` 는 실패로 세지 않는다(사용자가 의도적으로 중단한 것이므로) — 그대로 둔다.

- [ ] **Step 4: `MyProjects.jsx` — 필터 추가 + 행 액션 "중단" 버튼**

(a) `:642` 근처:

```js
const STATUS_FILTERS = ['All', 'Success', 'Failed', 'Cancelled'];
```

(b) `:1140` 행 액션 flex 안, "동일 입력 재실행" 버튼과 상세 버튼 사이에 취소 버튼 추가(`project.status === 'Pending' || project.status === 'Running'` 일 때만):

```jsx
                        {(project.status === 'Pending' || project.status === 'Running') && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setCancelTarget(project);
                            }}
                            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-amber-50 hover:text-amber-700"
                            title="해석 중단"
                            aria-label={`${project.project_name} 해석 중단`}
                          >
                            <Ban size={16} />
                          </button>
                        )}
```

(c) 컴포넌트 상단에 상태·다이얼로그·핸들러 추가(파일 상단 import 에 `Ban`, `ConfirmDialog`, `cancelAnalysisJob` 이 없으면 함께):

```js
import { Ban } from 'lucide-react';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { cancelAnalysisJob } from '../../api/analysis';
```

그리고 컴포넌트 함수 안:

```js
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const confirmCancel = async () => {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    try {
      await cancelAnalysisJob(cancelTarget.job_id);
      showToast('해석 중단 요청을 보냈습니다.', 'success');
      // 목록 새로고침 (기존 프로젝트 재조회 함수 재사용)
      if (typeof loadProjects === 'function') loadProjects();
    } catch (err) {
      const status = err?.response?.status;
      showToast(status === 403 ? '권한이 없습니다.' : status === 404 ? '작업이 없습니다.' : '중단 실패', 'error');
    } finally {
      setCancelling(false);
      setCancelTarget(null);
    }
  };
```

(d) 페이지 return JSX 끝(가장 바깥 `</div>` 앞)에 다이얼로그:

```jsx
      <ConfirmDialog
        isOpen={!!cancelTarget}
        onCancel={() => (cancelling ? null : setCancelTarget(null))}
        onConfirm={confirmCancel}
        title="해석 중단"
        message={
          cancelTarget
            ? `『${cancelTarget.project_name || cancelTarget.program_name}』 해석을 중단할까요? ` +
              '실행 중인 해석기 프로세스를 종료하며 되돌릴 수 없습니다.'
            : ''
        }
        confirmLabel={cancelling ? '중단 중…' : '중단'}
        cancelLabel="유지"
        variant="warning"
      />
```

- [ ] **Step 5: 빌드**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && npm run build
```
기대: 오류 없음.

- [ ] **Step 6: 수동 검증 1(Job Center 취소)**

백엔드 `uvicorn app.main:app --host 0.0.0.0 --port 9091 --reload` + `npm run dev`:

1. Truss Structural Assessment 로 큰 BDF 를 업로드해 해석 시작 → Job Center 카드에 "실행 중" 표시.
2. 카드의 호박색 **Ban 아이콘**(휴지통 왼쪽) 클릭 → `ConfirmDialog` "해석 중단" 이 뜬다.
3. "중단" 확정 → 카드가 잠깐 스피너 → 곧 **"사용자 중단"**(호박색) 뱃지, 진행률 100%, 폴러 중지.
4. Windows 작업 관리자에서 nastran/solver 프로세스가 사라졌는지 확인. 백엔드 로그에 `[취소]` 흔적.
5. 해석 페이지로 돌아가면 실패 메시지가 뜬다(내용: `사용자 요청으로 해석을 중단했습니다.`).

- [ ] **Step 7: 수동 검증 2(대기열에서 취소)**

1. 풀 5개를 채우기 위해 6개의 해석을 연속 실행 → 마지막(6번째)이 대기 상태.
2. Job Center 에서 마지막 카드의 Ban → 확인 → 카드가 **"사용자 중단"**·"대기열에서 제거…" 메시지.
3. 백엔드 로그: 이 job 은 task 시작 흔적(mark_running) 없이 곧바로 Cancelled 마킹.

- [ ] **Step 8: 수동 검증 3(MyProjects 행 취소 + 권한)**

1. My Projects 화면에서 실행 중 행의 Ban 아이콘 → 확인 → 상태가 `Cancelled` 로 변경.
2. `STATUS_FILTERS` 드롭다운에 `Cancelled` 옵션이 보이고 그 값을 선택하면 방금 취소한 행이 필터된다.
3. 다른 사용자의 해석 job_id 로 `curl -X POST http://.../api/analysis/<other_job>/cancel` → HTTP 403.
4. 이미 Success 로 끝난 job_id → HTTP 409, `detail` 에 상태 문자열.
5. 존재하지 않는 job_id → HTTP 404.

- [ ] **Step 9: 수동 검증 4(이중관 PSA 호환)**

1. DoublePipePsaTray 에서 PSA 해석 시작 후 트레이의 기존 "중단" 버튼 클릭 → 응답 `{"cancelled": true}` 로 UI 동작 무변경.
2. 별도 창에서 새 API `POST /api/analysis/<psa_job_id>/cancel` 을 호출해도 같은 결과(응답에 `kind: "psa"`).

- [ ] **Step 10: 커밋 준비 완료** — 보고: `src/utils/globalJobs.js`, `src/components/ui/StatusBadge.jsx`, `src/components/platform/UtilityDock.jsx`, `src/pages/analysis/MyProjects.jsx`.

---

### Task 11: 최종 점검 + 서버(145) 반영 안내

- [ ] **Step 1: 백엔드 전체 회귀**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
기대: 실패 0. 신규 파일 5개(`test_job_cancel_store`, `test_job_cancel_executor`, `test_job_cancel_runner`, `test_job_cancel_route`, `test_job_cancel_services_guard`) 합계 **35+건** 통과.

- [ ] **Step 2: 프론트 빌드**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && npm run build
```
기대: 오류 없음.

- [ ] **Step 3: 스테이징 점검**

`git status` 에서 `HiTessWorkBench/frontend/src/config.js` 가 변경돼 있으면 **스테이징하지 않는다**(로컬 백엔드 토글). `Darkmode.js/` 미포함 확인. `HiTessWorkBenchBackEnd/InHouseProgram/` 은 이번 계획에서 손대지 않는다.

- [ ] **Step 4: 사용자 보고(커밋은 사용자가 직접)** — 변경 파일 전체 목록(파일 구조 표) + 아래 서버 반영 안내를 그대로 전달.

**서버(145) 반영:**
- **백엔드 — `git pull` + 백엔드 재시작으로 끝.** 신규 pip 의존성 없음(`psutil==7.2.2` 는 이미 `requirements.txt:25`). 스키마 변경 없음(`Analysis.status = "Cancelled"` 는 기존 `String` 컬럼 값). `MEMORY.md` "InHouse 수동 교체" 대상 없음.
- **프론트 — 재배포 필요.** WorkBench 포터블 `.exe` 를 `npm run dist` 로 다시 빌드해 배포(`TERMINAL_JOB_STATUSES` 확장·"중단" 버튼·`Cancelled` 뱃지·`STATUS_FILTERS`). 구 클라이언트는 `Cancelled` 를 모르는 상태로 폴링을 계속하다 3분 타임아웃에 `Failed` 로 표시 — 기능 저하일 뿐 오류는 아님(구 클라이언트 사용자에게는 재로그인 안내).
- **InHouse 프로그램 — 없음.** `MooringFitting.exe`·`Cmb.Cli.exe`·`nastran_bridge.py`·`F06Parser.Console.exe` 등 수동 교체 대상 없음.

---

## 자기 검토

- **spec 커버리지**: §2.1 상태 어휘(`Cancelled` — Task 1) · §2.2 대기 취소(future.cancel — Task 1·3) · §2.3 실행 취소(`_kill_process_tree` — Task 1·2) · §2.4 등록 훅(공용 래퍼 — Task 4) · §2.5 job_id 컨텍스트(`ContextVar` — Task 3) · §2.6 동결 규칙(Cancelled 는 Failed 로 덮이지 않음 — Task 1) · §2.7 경합 3가지(선요청·publish 직후·정상 종료 직후 — Task 1) · §3.1 인터페이스(TERMINAL_STATUSES, cancel, register_process, is_cancel_requested, attach_future — Task 1) · §3.2 submit(fn, job_id, *args) — Task 3 · §3.3 `analysis_runner` — Task 4 · §3.4 서비스 표(Popen 3, subprocess.run 다수 — Task 4·5) · §4 취소 시퀀스(라우터 → locate → cancel_located — Task 6) · §5 API(`POST /api/analysis/{job_id}/cancel` + `POST /run-psa/cancel` 호환 — Task 6·8) · §6 알림 지연 import — Task 6 · §7 프론트("중단" 버튼·`ConfirmDialog`·`Cancelled` 뱃지·`STATUS_FILTERS` — Task 9·10) · §8 테스트(5개 파일 — Task 1·3·4·6 + 가드 Task 5). 비목표(§10)는 만들지 않는다.
- **플레이스홀더 없음**: 모든 코드 step 이 실제 코드다. 프론트는 러너가 없어 수동 절차를 단계·기대 동작으로 적었다.
- **5개 Popen 사이트 실측(2026-09-18 grep)**:
  - `HiTessWorkBenchBackEnd/app/services/analysis_runner.py:147` — `run_subprocess_killtree`(공용 래퍼 안 Popen) → Task 4 에서 등록/해제 훅 추가.
  - `HiTessWorkBenchBackEnd/app/services/doublepipe_modeshape_service.py:286` — 뷰어 상주 프로세스 → **대상 아님**, 무수정.
  - `HiTessWorkBenchBackEnd/app/services/doublepipe_psa_service.py:785` — PSA 파이프라인 → Task 2 에서 `register_process` + `_kill_process_tree` 위임.
  - `HiTessWorkBenchBackEnd/app/services/mooring_fitting_service.py:60` — `_run_capture` → Task 4 에서 훅 + 공용 kill 위임.
  - `HiTessWorkBenchBackEnd/app/services/remote_session_service.py:233` — RDP 조회 → **대상 아님**, 무수정.
- **`cancel_psa_job` 시그니처 실측**: `def cancel_psa_job(job_id: str, employee_id: str) -> dict:` (line 1558, `doublepipe_psa_service.py`). 반환 dict 는 `{cancelled: bool, status?: str, message?: str}` 셋. Task 6 의 `cancel_located` 가 이 형태에 `kind: "psa"`·`job_id` 를 얹어 응답한다.
- **타입/이름 일관성**: `TERMINAL_STATUSES` 는 백엔드 `job_manager.TERMINAL_STATUSES`(4-원소 frozenset) = 프론트 `globalJobs.TERMINAL_JOB_STATUSES`(Set) = `UtilityDock.TERMINAL_STATUSES`(Set) 세 곳에서 같은 값(`Success/Failed/Interrupted/Cancelled`). `Cancelled` 라벨은 UI 3곳(`StatusBadge`·`UtilityDock STATUS_CONFIG`·`toastToneFor`)에서 `"사용자 중단"` 으로 통일. `CANCELLED_MESSAGE`/`CANCELLED_QUEUE_MESSAGE` 는 백엔드 상수 → 프론트 토스트는 서버 응답 `message` 를 그대로 표시. API path `POST /api/analysis/{job_id}/cancel` 은 `api/analysis.js cancelAnalysisJob(jobId)` 가 유일한 호출자. `POST /run-psa/cancel` 요청·응답 형태는 무변경(추가 필드만).
- **의존 순서**: Task 1 이 정의한 `TERMINAL_STATUSES`·`JobCancelledError`·`current_job_id`·`_kill_process_tree`·`JobStatusStore.cancel` 을 Task 2·3·4·6 이 쓴다. Task 3 의 `_bind_job_context` 로 심어진 `_CURRENT_JOB_ID` 를 Task 4 의 공용 래퍼가 `current_job_id()` 로 읽는다. Task 6 의 `job_cancel_service.cancel_located` 를 Task 8 이 얇게 위임한다.
- **경합 안전(§4)**: (a) Popen 생성 직전 취소 = `is_cancel_requested` 로 잘림 → `TimeoutExpired` 로 승격해 기존 except 재사용. (b) Popen 생성 직후·등록 직전 취소 = `register_process` 가 `cancel_requested` 를 보고 즉시 `_kill_process_tree`. (c) 프로세스 정상 종료 직후 취소 = `_kill_process_tree` 가 `popen.poll() is not None` 이면 True 즉시 반환하고 `cancel()` 이 스토어를 `Cancelled` 로 전이 — 서비스가 뒤이어 `Success` 를 쓰면 동결 규칙이 `status` 를 버려 `Cancelled` 가 유지된다. Success 가 취소 요청 **이전**에 이미 있으면 `cancel()` 의 terminal 검사에서 False → 그대로 Success.
- **YAGNI**: 관리자 System Settings 의 타인 작업 취소 UI, 취소된 작업의 work_dir 즉시 정리, PSA 상태 어휘 통일(failed/-3/cancelled → Cancelled)은 이번 범위에서 제외(spec §10).
