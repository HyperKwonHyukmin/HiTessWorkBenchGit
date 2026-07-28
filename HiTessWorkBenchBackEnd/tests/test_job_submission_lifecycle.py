"""작업 폴더/제출/종료 생명주기의 호환성 회귀 테스트."""
import ast
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
import threading
import time

import pytest
from fastapi import HTTPException

from app.routers import _intake
from app.services import job_manager
from app.services.job_manager import JobMetadata
from app.services.workspace import create_analysis_workspace


class _FakeStore:
    def __init__(self):
        self.entries = {}
        self.updates = []

    def set(self, job_id, data):
        self.entries[job_id] = dict(data)

    def update_job(self, job_id, updates):
        self.entries.setdefault(job_id, {}).update(updates)
        self.updates.append((job_id, dict(updates)))


def test_workspace_preserves_legacy_name_and_avoids_same_second_collision(tmp_path):
    fixed = datetime(2026, 7, 28, 9, 10, 11)

    first, first_timestamp = create_analysis_workspace(
        str(tmp_path), "E100", "TrussAssessment", now=fixed,
    )
    second, second_timestamp = create_analysis_workspace(
        str(tmp_path), "E100", "TrussAssessment", now=fixed,
    )

    assert first_timestamp == "20260728_091011"
    assert second_timestamp == "20260728_091012"
    assert first != second
    assert _intake._infer_work_folder_metadata(first) == (None, None)
    assert first.endswith("20260728_091011_E100_TrussAssessment")
    assert second.endswith("20260728_091012_E100_TrussAssessment")


def test_workspace_is_atomic_for_concurrent_requests(tmp_path):
    fixed = datetime(2026, 7, 28, 9, 10, 11)

    def create_one(_):
        return create_analysis_workspace(
            str(tmp_path), "E100", "DoublePipeFuelLine", now=fixed,
        )

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(create_one, range(12)))

    paths = [path for path, _timestamp in results]
    timestamps = [timestamp for _path, timestamp in results]
    assert len(set(paths)) == 12
    assert len(set(timestamps)) == 12
    assert all(datetime.strptime(value, "%Y%m%d_%H%M%S") for value in timestamps)


def test_intake_workspace_remains_parseable_by_owner_parser(tmp_path, monkeypatch):
    monkeypatch.setattr(_intake, "USER_CONNECTION_DIR", str(tmp_path))

    work_dir, timestamp = _intake.make_work_dir("E100", "ModuleStability")

    assert _intake._infer_work_folder_metadata(work_dir) == ("E100", "ModuleStability")
    assert work_dir.endswith(f"{timestamp}_E100_ModuleStability")


def test_explicit_metadata_does_not_change_task_call_contract(monkeypatch):
    store = _FakeStore()
    submitted = {}
    monkeypatch.setattr(_intake, "job_status_store", store)
    monkeypatch.setattr(_intake, "_record_pending_analysis", lambda *args: True)

    class _Executor:
        def submit(self, *args):
            submitted["args"] = args
            return None

    monkeypatch.setattr(_intake, "analysis_executor", _Executor())

    def task_fn(job_id, first, second):
        return None

    job_id = _intake.submit_analysis_job(
        task_fn,
        "first",
        "second",
        metadata=JobMetadata(employee_id="E200", program_name="ExplicitProgram"),
    )

    assert submitted["args"] == (task_fn, job_id, "first", "second")
    assert store.entries[job_id]["employee_id"] == "E200"
    assert store.entries[job_id]["_metadata"] == JobMetadata("E200", "ExplicitProgram")
    assert JobMetadata.__dataclass_params__.frozen is True


def test_legacy_metadata_inference_still_populates_public_employee_id(
    tmp_path, monkeypatch,
):
    store = _FakeStore()
    monkeypatch.setattr(_intake, "USER_CONNECTION_DIR", str(tmp_path))
    monkeypatch.setattr(_intake, "job_status_store", store)
    monkeypatch.setattr(_intake, "_record_pending_analysis", lambda *args: True)
    monkeypatch.setattr(_intake.analysis_executor, "submit", lambda *args: None)
    work_dir, timestamp = _intake.make_work_dir("E300", "LegacyProgram")

    def task_execute_legacy(job_id, path, employee_id, task_timestamp):
        return None

    job_id = _intake.submit_analysis_job(
        task_execute_legacy, work_dir, "E300", timestamp,
    )

    assert store.entries[job_id]["employee_id"] == "E300"
    assert store.entries[job_id]["_metadata"].program_name == "LegacyProgram"


def test_pending_db_failure_keeps_compatibility_mode_running(monkeypatch):
    store = _FakeStore()
    submitted = []
    monkeypatch.delenv("WORKBENCH_REQUIRE_PENDING_PERSISTENCE", raising=False)
    monkeypatch.setattr(_intake, "job_status_store", store)
    monkeypatch.setattr(_intake, "_record_pending_analysis", lambda *args: False)
    monkeypatch.setattr(
        _intake.analysis_executor, "submit",
        lambda *args: submitted.append(args),
    )

    job_id = _intake.submit_analysis_job(
        lambda job_id: None,
        metadata=JobMetadata("E400", "CompatibilityProgram"),
    )

    assert job_id in store.entries
    assert len(submitted) == 1


def test_pending_db_failure_is_503_before_store_and_submit_in_strict_mode(monkeypatch):
    store = _FakeStore()
    submitted = []
    monkeypatch.setenv("WORKBENCH_REQUIRE_PENDING_PERSISTENCE", "true")
    monkeypatch.setattr(_intake, "job_status_store", store)
    monkeypatch.setattr(_intake, "_record_pending_analysis", lambda *args: False)
    monkeypatch.setattr(
        _intake.analysis_executor, "submit",
        lambda *args: submitted.append(args),
    )

    with pytest.raises(HTTPException) as exc_info:
        _intake.submit_analysis_job(
            lambda job_id: None,
            metadata=JobMetadata("E500", "StrictProgram"),
        )

    assert exc_info.value.status_code == 503
    assert store.entries == {}
    assert submitted == []


def test_strict_pending_failure_removes_only_workspace_created_by_request(
    tmp_path, monkeypatch,
):
    store = _FakeStore()
    monkeypatch.setenv("WORKBENCH_REQUIRE_PENDING_PERSISTENCE", "true")
    monkeypatch.setattr(_intake, "USER_CONNECTION_DIR", str(tmp_path))
    monkeypatch.setattr(_intake, "job_status_store", store)
    monkeypatch.setattr(_intake, "_record_pending_analysis", lambda *args: False)
    monkeypatch.setattr(_intake.analysis_executor, "submit", lambda *args: None)
    work_dir, timestamp = _intake.make_work_dir("E501", "StrictProgram")
    input_path = Path(work_dir) / "input.csv"
    input_path.write_text("header\n", encoding="utf-8")
    unrelated = tmp_path / "20260728_120000_E501_StrictProgram"
    unrelated.mkdir()
    (unrelated / "keep.txt").write_text("keep", encoding="utf-8")

    with pytest.raises(HTTPException) as exc_info:
        _intake.submit_analysis_job(
            lambda *_: None,
            str(input_path), work_dir, "E501", timestamp,
            metadata=JobMetadata("E501", "StrictProgram"),
            owned_work_dir=work_dir,
        )

    assert exc_info.value.status_code == 503
    assert not input_path.exists()
    assert not Path(work_dir).exists()
    assert (unrelated / "keep.txt").read_text(encoding="utf-8") == "keep"


def test_strict_failure_never_deletes_upload_only_or_followup_parent(
    tmp_path, monkeypatch,
):
    """task args 경로 추론으로 기존 부모 폴더를 삭제하던 회귀를 막는다."""
    store = _FakeStore()
    monkeypatch.setenv("WORKBENCH_REQUIRE_PENDING_PERSISTENCE", "true")
    monkeypatch.setattr(_intake, "USER_CONNECTION_DIR", str(tmp_path))
    monkeypatch.setattr(_intake, "job_status_store", store)
    monkeypatch.setattr(_intake, "_record_pending_analysis", lambda *args: False)
    monkeypatch.setattr(_intake.analysis_executor, "submit", lambda *args: None)

    upload_only_dir, timestamp = _intake.make_work_dir("E502", "DrawingToAnalysis")
    parent_path = Path(upload_only_dir)
    persisted = parent_path / "uploaded.pdf"
    persisted.write_bytes(b"%PDF")

    with pytest.raises(HTTPException):
        _intake.submit_analysis_job(
            lambda *_: None,
            str(persisted), str(parent_path / "solve_20260728_120000"),
            "E502", timestamp,
            metadata=JobMetadata("E502", "DrawingSolve"),
            # 후속 요청은 기존 부모를 소유하지 않으므로 owned_work_dir를 전달하지 않는다.
        )

    assert persisted.read_bytes() == b"%PDF"
    assert parent_path.is_dir()


def test_plain_path_cannot_impersonate_owned_workspace_for_cleanup(
    tmp_path, monkeypatch,
):
    store = _FakeStore()
    monkeypatch.setenv("WORKBENCH_REQUIRE_PENDING_PERSISTENCE", "true")
    monkeypatch.setattr(_intake, "USER_CONNECTION_DIR", str(tmp_path))
    monkeypatch.setattr(_intake, "job_status_store", store)
    monkeypatch.setattr(_intake, "_record_pending_analysis", lambda *args: False)

    existing = tmp_path / "20260728_120000_E503_Existing"
    existing.mkdir()
    marker = existing / "keep.txt"
    marker.write_text("keep", encoding="utf-8")

    with pytest.raises(HTTPException):
        _intake.submit_analysis_job(
            lambda *_: None,
            str(existing),
            metadata=JobMetadata("E503", "Existing"),
            owned_work_dir=str(existing),
        )

    assert marker.read_text(encoding="utf-8") == "keep"


def test_analysis_routes_explicitly_pass_newly_created_workspace_ownership():
    """make_work_dir와 submit을 함께 쓰는 요청은 정리 capability를 명시해야 한다."""
    route_path = Path(_intake.__file__).with_name("analysis.py")
    tree = ast.parse(route_path.read_text(encoding="utf-8-sig"))
    missing = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        calls = [child for child in ast.walk(node) if isinstance(child, ast.Call)]
        creates_workspace = any(
            isinstance(call.func, ast.Name) and call.func.id == "make_work_dir"
            for call in calls
        )
        if not creates_workspace:
            continue
        for call in calls:
            if not (
                isinstance(call.func, ast.Name)
                and call.func.id == "submit_analysis_job"
            ):
                continue
            if "owned_work_dir" not in {kw.arg for kw in call.keywords}:
                missing.append((node.name, call.lineno))

    assert missing == []


def test_executor_submit_failure_marks_failed_and_returns_503(monkeypatch):
    store = _FakeStore()
    monkeypatch.setattr(_intake, "job_status_store", store)
    monkeypatch.setattr(_intake, "_record_pending_analysis", lambda *args: True)

    def fail_submit(*args):
        raise RuntimeError("executor unavailable")

    monkeypatch.setattr(_intake.analysis_executor, "submit", fail_submit)

    with pytest.raises(HTTPException) as exc_info:
        _intake.submit_analysis_job(
            lambda job_id: None,
            metadata=JobMetadata("E600", "SubmitFailure"),
        )

    assert exc_info.value.status_code == 503
    assert len(store.updates) == 1
    _job_id, update = store.updates[0]
    assert update["status"] == "Failed"
    assert update["progress"] == 100


def test_shutdown_job_manager_is_idempotent_and_does_not_cancel_futures(monkeypatch):
    calls = []

    class _Store:
        def shutdown(self):
            calls.append(("store",))

    class _Executor:
        def shutdown(self, **kwargs):
            calls.append(("executor", kwargs))

    monkeypatch.setattr(job_manager, "job_status_store", _Store())
    monkeypatch.setattr(job_manager, "analysis_executor", _Executor())
    monkeypatch.setattr(job_manager, "_job_manager_shutdown", False)

    job_manager.shutdown_job_manager()
    job_manager.shutdown_job_manager()

    assert calls == [
        ("store",),
        ("executor", {"wait": False, "cancel_futures": False}),
    ]


def test_managed_executor_refuses_restart_until_old_pool_drains():
    executor = job_manager.ManagedAnalysisExecutor(max_workers=1)
    first_started = threading.Event()
    release_first = threading.Event()
    second_started = threading.Event()

    def first():
        first_started.set()
        release_first.wait(timeout=2)

    def second():
        second_started.set()

    first_future = executor.submit(first)
    second_future = executor.submit(second)
    assert first_started.wait(timeout=1)

    executor.shutdown(wait=False, cancel_futures=False)
    with pytest.raises(RuntimeError, match="still draining"):
        executor.start()
    assert not second_started.is_set()

    release_first.set()
    first_future.result(timeout=2)
    second_future.result(timeout=2)
    deadline = time.monotonic() + 1
    while executor._inflight and time.monotonic() < deadline:
        time.sleep(0.01)

    executor.start()
    assert executor.submit(lambda: "restarted").result(timeout=1) == "restarted"
    executor.shutdown(wait=True, cancel_futures=False)
