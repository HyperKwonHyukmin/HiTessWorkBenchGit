# Mooring Fitting Assessment — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 워크벤치 File-Based Apps에 Mooring Fitting Assessment 페이지를 신설해 사용자가 CSV 2종(Structure/Load)을 업로드하면 `MooringFitting.exe build-full` 이 userConnection 작업 폴더에서 실행되어 산출물을 생성하고 다운로드 가능하도록 한다. 결과 시각화는 Phase 2 이후 분리.

**Architecture:** TrussAnalysis / BdfScanner와 동일한 패턴 — `POST /api/analysis/mooring-fitting/request` 라우터가 `_intake` 헬퍼로 폴더 생성·파일 저장 후 `submit_analysis_job` 으로 작업 큐에 등록, 별도 스레드에서 `subprocess.run(MooringFitting.exe build-full <work_dir>, cwd=work_dir)` 실행, out/ 폴더 산출물을 glob 수집해 DB result_info에 기록. 프론트엔드는 `DashboardContext`/`App.jsx` 등록 + 신규 페이지에서 업로드·폴링·다운로드.

**Tech Stack:** FastAPI + SQLAlchemy + ThreadPoolExecutor (백엔드), React + Tailwind + usePolling 훅 (프론트), .NET 8 self-contained single-file exe (해석 엔진), pytest + TestClient (테스트).

**Reference spec:** `docs/superpowers/specs/2026-05-27-mooring-fitting-assessment-phase1-design.md`

**Source project:** `C:\Coding\WorkBenchSubModule\MooringFitting\` (CLI: README §2)

---

## File Structure

| 경로 | 변경 종류 | 책임 |
|---|---|---|
| `HiTessWorkBenchBackEnd/app/routers/_intake.py` | **편집** | `save_upload()` 에 `dest_name: str \| None = None` 옵션 추가 (비파괴) |
| `HiTessWorkBenchBackEnd/app/services/mooring_fitting_service.py` | **신규** | `collect_artifacts()` 헬퍼 + `task_execute_mooring_fitting()` 백그라운드 실행 |
| `HiTessWorkBenchBackEnd/app/routers/analysis.py` | **편집** | `POST /api/analysis/mooring-fitting/request` 엔드포인트 추가, service import |
| `HiTessWorkBenchBackEnd/tests/test_intake_save_upload.py` | **신규** | `save_upload` 의 `dest_name` 동작 단위 테스트 |
| `HiTessWorkBenchBackEnd/tests/test_mooring_fitting_service.py` | **신규** | `collect_artifacts()` 단위 테스트 |
| `HiTessWorkBenchBackEnd/tests/test_mooring_fitting_router.py` | **신규** | 라우터 통합 테스트 (executor mock) |
| `HiTessWorkBench/frontend/src/contexts/DashboardContext.jsx` | **편집** | `RAW_ANALYSIS_DATA` 항목 + `APP_REGISTRY_OVERRIDES` |
| `HiTessWorkBench/frontend/src/pages/analysis/MooringFittingAssessment.jsx` | **신규** | 업로드 2개 + Run + 폴링 + 결과 트리 |
| `HiTessWorkBench/frontend/src/App.jsx` | **편집** | `renderPage()` switch case + import 추가 |
| `HiTessWorkBenchBackEnd/InHouseProgram/MooringFitting/MooringFitting.exe` | **수동 배포** | 사용자가 `dotnet publish` 산출물을 rename 복사 |

---

## Task 1: `save_upload()` 비파괴 확장 — `dest_name` 옵션 추가

**Files:**
- Test: `HiTessWorkBenchBackEnd/tests/test_intake_save_upload.py` (신규)
- Modify: `HiTessWorkBenchBackEnd/app/routers/_intake.py:45-62`

- [ ] **Step 1: Write the failing test**

새 파일 `HiTessWorkBenchBackEnd/tests/test_intake_save_upload.py`:

```python
"""save_upload(dest_name=...) — 표준 파일명 강제 저장 동작 검증."""
import asyncio
import io
import os
import pytest
from fastapi import UploadFile

from app.routers._intake import save_upload


def _make_upload(filename: str, content: bytes) -> UploadFile:
    return UploadFile(filename=filename, file=io.BytesIO(content))


def test_save_upload_uses_original_filename_when_dest_name_none(tmp_path):
    """기존 동작: dest_name 미지정 → 업로드된 파일명을 그대로 사용."""
    upload = _make_upload("Vessel_X.csv", b"hello,world\n")
    saved = asyncio.run(save_upload(upload, str(tmp_path)))
    assert os.path.basename(saved) == "Vessel_X.csv"
    assert os.path.exists(saved)
    with open(saved, "rb") as f:
        assert f.read() == b"hello,world\n"


def test_save_upload_forces_filename_when_dest_name_given(tmp_path):
    """신규 동작: dest_name 지정 → 그 이름으로 강제 저장."""
    upload = _make_upload("Vessel_X.csv", b"a,b,c\n")
    saved = asyncio.run(save_upload(upload, str(tmp_path), dest_name="MooringFittingData.csv"))
    assert os.path.basename(saved) == "MooringFittingData.csv"
    assert os.path.exists(saved)
    # 원본 파일명 파일은 존재하지 않아야 한다
    assert not os.path.exists(os.path.join(str(tmp_path), "Vessel_X.csv"))
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd
.\WorkBenchEnv\Scripts\Activate.ps1
pytest tests/test_intake_save_upload.py -v
```

Expected: `test_save_upload_forces_filename_when_dest_name_given` FAIL (`save_upload` got an unexpected keyword argument 'dest_name'). 첫 번째 테스트는 PASS.

- [ ] **Step 3: Implement minimal change to `_intake.py`**

`HiTessWorkBenchBackEnd/app/routers/_intake.py` 의 `save_upload` 함수를 다음과 같이 교체:

```python
async def save_upload(
    upload: UploadFile,
    work_dir: str,
    error_prefix: str = "File save error",
    dest_name: str | None = None,
) -> str:
    """
    단일 UploadFile을 work_dir에 저장하고 절대 경로를 반환합니다.

    dest_name 이 주어지면 사용자 업로드 파일명을 무시하고 그 이름으로 저장합니다.
    None(기본) 이면 기존 동작 — 업로드 파일명을 그대로 사용.

    실패 시 기존 라우터와 동일한 메시지로 HTTP 500을 발생시킵니다.
    error_prefix를 통해 라우터별 한글 메시지("파일 저장 오류" 등)도 유지할 수 있습니다.
    """
    fname = dest_name if dest_name else os.path.basename(upload.filename)
    dest_path = os.path.join(work_dir, fname)
    try:
        with open(dest_path, "wb") as buffer:
            buffer.write(await upload.read())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{error_prefix}: {str(e)}")
    return dest_path
```

- [ ] **Step 4: Run test to verify it passes**

```powershell
pytest tests/test_intake_save_upload.py -v
```

Expected: 두 테스트 모두 PASS.

- [ ] **Step 5: Run full backend test suite to ensure no regression**

```powershell
pytest tests/ -v
```

Expected: 모든 기존 테스트(test_usage_report_*) 도 PASS — `dest_name=None` 기본값이므로 기존 호출자 영향 없음.

- [ ] **Step 6: Commit**

```powershell
cd C:\Coding\WorkBench
git add HiTessWorkBenchBackEnd/app/routers/_intake.py HiTessWorkBenchBackEnd/tests/test_intake_save_upload.py
git commit -m "♻️ refactor(intake): save_upload에 dest_name 옵션 추가 — 표준 파일명 강제 저장 지원"
```

---

## Task 2: `collect_artifacts()` 헬퍼 — out/ 폴더 산출물 수집 (TDD)

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/mooring_fitting_service.py`
- Test: `HiTessWorkBenchBackEnd/tests/test_mooring_fitting_service.py` (신규)

- [ ] **Step 1: Write the failing test**

새 파일 `HiTessWorkBenchBackEnd/tests/test_mooring_fitting_service.py`:

```python
"""collect_artifacts() — MooringFitting out/ 폴더 산출물 수집 동작."""
import os

import pytest

from app.services.mooring_fitting_service import collect_artifacts


def _touch(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("{}")


def test_collect_artifacts_missing_out_dir(tmp_path):
    """out/ 폴더 자체가 없으면 _artifacts_missing=True 만 표시."""
    work_dir = str(tmp_path)
    out_dir = os.path.join(work_dir, "out")
    result = collect_artifacts(out_dir, work_dir)
    assert result["_artifacts_missing"] is True
    assert result["out_dir"] == out_dir


def test_collect_artifacts_full_case(tmp_path):
    """8단계 산출물 + 핵심 5개 + LINEAGE/Report 가 모두 있으면 분류해서 반환."""
    work_dir = str(tmp_path)
    out_dir = os.path.join(work_dir, "out")
    # STAGE 00 ~ 07 산출물 (json + bdf + bdf.verification.json) — 모의 빈 파일
    stages = [
        ("STAGE_00_BuildRaw",          "STAGE_00.raw.json"),
        ("STAGE_01_CollinearOverlap",  None),
        ("STAGE_02_ElementSplit",      None),
        ("STAGE_03_DuplicatePolicy",   None),
        ("STAGE_04_Connectivity",      None),
        ("STAGE_05_MeshRefinement",    None),
        ("STAGE_06_LoadGen",           None),
        ("STAGE_07_FinalValidation",   "STAGE_07_FinalValidation.validation.json"),
    ]
    for stem, extra in stages:
        _touch(os.path.join(out_dir, f"{stem}.json"))
        _touch(os.path.join(out_dir, f"{stem}.bdf"))
        _touch(os.path.join(out_dir, f"{stem}.bdf.verification.json"))
        if extra:
            _touch(os.path.join(out_dir, extra))
    _touch(os.path.join(out_dir, "STAGE_00.initial.json"))
    _touch(os.path.join(out_dir, "LINEAGE.json"))
    _touch(os.path.join(out_dir, "Report_LoadCalculation_MF.csv"))
    _touch(os.path.join(out_dir, "Report_LoadCalculation_Winch.csv"))

    result = collect_artifacts(out_dir, work_dir)

    # 부재 flag 없어야 한다
    assert "_artifacts_missing" not in result
    # 핵심 5개
    assert result["final_bdf"].endswith("STAGE_07_FinalValidation.bdf")
    assert result["validation_json"].endswith("STAGE_07_FinalValidation.validation.json")
    assert result["lineage_json"].endswith("LINEAGE.json")
    assert result["report_mf_csv"].endswith("Report_LoadCalculation_MF.csv")
    assert result["report_winch_csv"].endswith("Report_LoadCalculation_Winch.csv")
    # 보조 — stage_jsons 는 8개 STAGE_NN_*.json (verification 제외, raw/initial 별도)
    assert len(result["stage_jsons"]) == 8
    assert all(p.endswith(".json") and ".verification." not in p for p in result["stage_jsons"])
    assert len(result["stage_bdfs"]) == 8
    assert len(result["stage_verifications"]) == 8
    assert result["raw_json"].endswith("STAGE_00.raw.json")
    assert result["initial_json"].endswith("STAGE_00.initial.json")


def test_collect_artifacts_partial(tmp_path):
    """일부 산출물만 있으면 핵심 키는 None, stage 리스트는 존재하는 것만."""
    work_dir = str(tmp_path)
    out_dir = os.path.join(work_dir, "out")
    _touch(os.path.join(out_dir, "STAGE_00_BuildRaw.json"))
    _touch(os.path.join(out_dir, "STAGE_00_BuildRaw.bdf"))
    # STAGE_07 등 핵심 파일 없음

    result = collect_artifacts(out_dir, work_dir)
    assert result["final_bdf"] is None
    assert result["validation_json"] is None
    assert result["lineage_json"] is None
    assert result["report_mf_csv"] is None
    assert result["report_winch_csv"] is None
    assert len(result["stage_jsons"]) == 1
    assert len(result["stage_bdfs"]) == 1
    assert result["stage_verifications"] == []
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pytest tests/test_mooring_fitting_service.py -v
```

Expected: 모두 FAIL — `mooring_fitting_service` 모듈이 없음.

- [ ] **Step 3: Create minimal `mooring_fitting_service.py` with `collect_artifacts()`**

새 파일 `HiTessWorkBenchBackEnd/app/services/mooring_fitting_service.py`:

```python
"""Mooring Fitting Assessment 서비스 — CSV 2종 → MooringFitting.exe build-full 실행 + 산출물 수집."""
import logging
import os
import subprocess

from .analysis_runner import (
    get_backend_dir,
    mark_complete,
    mark_running,
    record_analysis,
    update_progress,
)

logger = logging.getLogger(__name__)

PROGRAM_NAME = "MooringFitting"
TIMEOUT_SECONDS = 600


def collect_artifacts(out_dir: str, work_dir: str) -> dict:
    """
    MooringFitting.exe 가 생성한 out/ 폴더 산출물을 분류·수집한다.

    핵심 5개(페이지 기본 노출):
        final_bdf, validation_json, lineage_json, report_mf_csv, report_winch_csv
    보조(Phase 2 뷰어용 펼치기 영역):
        stage_jsons, stage_bdfs, stage_verifications, raw_json, initial_json

    out/ 폴더 자체가 없으면 {_artifacts_missing: True, out_dir} 만 반환.
    """
    if not os.path.isdir(out_dir):
        return {
            "case_dir": work_dir,
            "out_dir": out_dir,
            "_artifacts_missing": True,
        }

    files = os.listdir(out_dir)
    file_set = set(files)
    pick = lambda name: os.path.join(out_dir, name) if name in file_set else None

    stage_jsons = sorted(
        os.path.join(out_dir, f) for f in files
        if f.startswith("STAGE_") and f.endswith(".json")
        and ".verification." not in f
        and not f.endswith(".raw.json")
        and not f.endswith(".initial.json")
        and not f.endswith(".validation.json")
    )
    stage_bdfs = sorted(
        os.path.join(out_dir, f) for f in files
        if f.startswith("STAGE_") and f.endswith(".bdf")
    )
    stage_verifications = sorted(
        os.path.join(out_dir, f) for f in files
        if f.endswith(".bdf.verification.json")
    )

    return {
        "case_dir": work_dir,
        "out_dir": out_dir,
        "final_bdf":         pick("STAGE_07_FinalValidation.bdf"),
        "validation_json":   pick("STAGE_07_FinalValidation.validation.json"),
        "lineage_json":      pick("LINEAGE.json"),
        "report_mf_csv":     pick("Report_LoadCalculation_MF.csv"),
        "report_winch_csv":  pick("Report_LoadCalculation_Winch.csv"),
        "stage_jsons":          stage_jsons,
        "stage_bdfs":           stage_bdfs,
        "stage_verifications":  stage_verifications,
        "raw_json":             pick("STAGE_00.raw.json"),
        "initial_json":         pick("STAGE_00.initial.json"),
    }
```

- [ ] **Step 4: Run test to verify it passes**

```powershell
pytest tests/test_mooring_fitting_service.py -v
```

Expected: 세 테스트 모두 PASS.

- [ ] **Step 5: Commit**

```powershell
cd C:\Coding\WorkBench
git add HiTessWorkBenchBackEnd/app/services/mooring_fitting_service.py HiTessWorkBenchBackEnd/tests/test_mooring_fitting_service.py
git commit -m "✨ feat(mooring): collect_artifacts() — out/ 산출물 분류 헬퍼 추가"
```

---

## Task 3: `task_execute_mooring_fitting()` 백그라운드 실행 함수

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/mooring_fitting_service.py` (append)

> 이 함수는 실제 exe + ThreadPoolExecutor + DB 의 통합 동작이므로 단위 테스트 비용이 크다. 라우터 통합 테스트(Task 4) 와 E2E (Task 10) 에서 검증하고, 본 task는 구현만 진행한다. 동일한 비-TDD 결정이 `bdfscanner_service.py` 에도 적용되어 있다.

- [ ] **Step 1: `mooring_fitting_service.py` 하단에 함수 추가**

```python
def task_execute_mooring_fitting(
    job_id: str,
    structure_path: str,
    load_path: str,
    work_dir: str,
    exe_path: str,
    employee_id: str,
    timestamp: str,
    source: str,
):
    """
    MooringFitting.exe build-full <work_dir> 를 호출한다.

    동작:
      - work_dir 안에 MooringFittingData.csv / MooringFittingDataLoad.csv 가 표준명으로 이미 저장되어 있다고 가정 (라우터 책임).
      - exe 는 cwd=work_dir 로 실행되며 out/ 폴더에 산출물을 생성한다.
      - exit code 0 = Success, 그 외 = Failed (stdout/stderr 통합해 engine_output 에 노출).
      - record_analysis 로 DB 기록 + mark_complete 로 job_status_store 마감.
    """
    mark_running(job_id, "MooringFitting 초기화 중...", progress=10)

    status_msg = "Success"
    engine_output = ""
    result_data = {}

    try:
        if not os.path.exists(exe_path):
            raise FileNotFoundError(f"실행 파일을 찾을 수 없습니다: {exe_path}")

        update_progress(job_id, 30, "BDF 파이프라인 실행 중...")
        logger.info("[MooringFitting] exe=%s, work_dir=%s", exe_path, work_dir)

        result = subprocess.run(
            [exe_path, "build-full", work_dir],
            cwd=work_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=TIMEOUT_SECONDS,
        )
        engine_output = result.stdout.decode("utf-8", errors="replace")
        stderr_text = result.stderr.decode("utf-8", errors="replace")
        if stderr_text.strip():
            engine_output += f"\n[stderr] {stderr_text.strip()}"
        if result.returncode != 0:
            status_msg = "Failed"
            engine_output += f"\n[Exit code: {result.returncode}]"

        update_progress(job_id, 80, "결과 파일 수집 중...")
        out_dir = os.path.join(work_dir, "out")
        result_data = collect_artifacts(out_dir, work_dir)
        if result_data.get("_artifacts_missing"):
            status_msg = "Failed"
            engine_output += "\n[Error] out/ 폴더가 생성되지 않았습니다. exe 실행 로그를 확인하세요."

    except subprocess.TimeoutExpired:
        status_msg = "Failed"
        engine_output = f"MooringFitting 실행 시간이 초과되었습니다 ({TIMEOUT_SECONDS // 60}분)."
    except FileNotFoundError as e:
        status_msg = "Failed"
        engine_output = str(e)
    except Exception as e:
        status_msg = "Failed"
        logger.error("MooringFitting unexpected error: %s", str(e), exc_info=True)
        engine_output = f"예기치 않은 오류가 발생했습니다: {str(e)}"

    update_progress(job_id, 95, "데이터베이스 저장 중...")
    project_data, db_err = record_analysis(
        project_name=f"{PROGRAM_NAME}_{timestamp}",
        program_name=PROGRAM_NAME,
        employee_id=employee_id,
        status=status_msg,
        input_info={"structure_csv": structure_path, "load_csv": load_path},
        result_info=result_data if result_data else None,
        source=source,
    )
    if db_err is not None:
        status_msg = "Failed"
        engine_output += f"\nDB Error: {db_err}"

    mark_complete(
        job_id, status_msg, engine_output, project_data,
        success_message="MooringFitting 해석 완료",
        failure_message="MooringFitting 해석 실패",
    )
```

- [ ] **Step 2: 기존 테스트 재실행 (회귀 없는지)**

```powershell
pytest tests/ -v
```

Expected: 모든 테스트 PASS (`task_execute_mooring_fitting` 은 단위 테스트 없음 — Task 4에서 라우터 통합 테스트로 호출 경로를 검증).

- [ ] **Step 3: Commit**

```powershell
cd C:\Coding\WorkBench
git add HiTessWorkBenchBackEnd/app/services/mooring_fitting_service.py
git commit -m "✨ feat(mooring): task_execute_mooring_fitting() — build-full 호출 + 산출물 DB 기록"
```

---

## Task 4: 라우터 엔드포인트 — `POST /api/analysis/mooring-fitting/request`

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/routers/analysis.py`
- Test: `HiTessWorkBenchBackEnd/tests/test_mooring_fitting_router.py` (신규)

- [ ] **Step 1: Write the failing integration test**

새 파일 `HiTessWorkBenchBackEnd/tests/test_mooring_fitting_router.py`:

```python
"""POST /api/analysis/mooring-fitting/request — 라우터 통합 테스트.

executor 의 실제 task 실행은 mock 으로 차단하고 다음만 검증:
  - 200 응답 + job_id 반환
  - userConnection/{ts}_{eid}_MooringFitting/ 폴더 생성
  - 두 CSV가 표준 파일명(MooringFittingData.csv, MooringFittingDataLoad.csv)으로 저장
  - submit 인자에 표준 경로가 그대로 전달됨
"""
import io
import os
from unittest.mock import patch

import pytest


@pytest.fixture
def auth_client(db_session):
    """일반 사용자(HHI123)로 인증되는 TestClient."""
    from fastapi.testclient import TestClient
    from app import database, models
    from app.dependencies import require_auth
    from app.main import app

    def _override_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[database.get_db] = _override_db
    app.dependency_overrides[require_auth] = lambda: "HHI123"

    user = models.User(
        employee_id="HHI123", name="테스트사용자", company="HHI",
        is_active=True, is_admin=False, is_developer=False,
    )
    db_session.add(user)
    db_session.commit()

    yield TestClient(app)
    app.dependency_overrides.clear()


def test_request_saves_csvs_with_standard_filenames(auth_client, tmp_path, monkeypatch):
    """업로드된 임의 파일명이 표준명으로 강제 저장되어야 한다."""
    captured = {}

    def fake_submit(task_fn, *args, **kwargs):
        # task_fn 실행 차단 — 인자만 캡쳐
        captured["args"] = args

    monkeypatch.setattr(
        "app.services.job_manager.analysis_executor.submit", fake_submit
    )

    files = {
        "structure_file": ("Vessel_X_data.csv", b"MF,F1,Pipe,0,0,0,...\n", "text/csv"),
        "load_file":      ("Vessel_X_load.csv", b"LOADCASE,F1,1,2,3,...\n", "text/csv"),
    }
    data = {"employee_id": "HHI123", "source": "Workbench"}
    res = auth_client.post("/api/analysis/mooring-fitting/request", files=files, data=data)

    assert res.status_code == 200, res.text
    body = res.json()
    assert "job_id" in body

    # work_dir 가 userConnection 하위에 생성되었는지
    structure_path = captured["args"][0]
    load_path = captured["args"][1]
    work_dir = captured["args"][2]

    assert "userConnection" in work_dir
    assert "_HHI123_MooringFitting" in os.path.basename(work_dir)
    assert os.path.basename(structure_path) == "MooringFittingData.csv"
    assert os.path.basename(load_path) == "MooringFittingDataLoad.csv"
    assert os.path.isfile(structure_path)
    assert os.path.isfile(load_path)
    # 사용자 임의 파일명으로는 저장되지 않아야
    assert not os.path.exists(os.path.join(work_dir, "Vessel_X_data.csv"))
    assert not os.path.exists(os.path.join(work_dir, "Vessel_X_load.csv"))


def test_request_rejects_mismatched_employee_id(auth_client, monkeypatch):
    """Form 의 employee_id 가 인증 사용자와 다르면 403."""
    monkeypatch.setattr(
        "app.services.job_manager.analysis_executor.submit", lambda *a, **k: None
    )
    files = {
        "structure_file": ("a.csv", b"x\n", "text/csv"),
        "load_file":      ("b.csv", b"y\n", "text/csv"),
    }
    data = {"employee_id": "OTHER999", "source": "Workbench"}
    res = auth_client.post("/api/analysis/mooring-fitting/request", files=files, data=data)
    assert res.status_code == 403
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pytest tests/test_mooring_fitting_router.py -v
```

Expected: 두 테스트 모두 FAIL — 엔드포인트 미존재 (404).

- [ ] **Step 3: Add endpoint to `analysis.py`**

`HiTessWorkBenchBackEnd/app/routers/analysis.py` 의 import 섹션 (상단) 에 추가:

```python
from ..services.mooring_fitting_service import task_execute_mooring_fitting
```

그리고 라우터 본문 적당한 위치 (예: `# ==================== Simple Beam Assessment ====================` 섹션 위) 에 추가:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
pytest tests/test_mooring_fitting_router.py -v
```

Expected: 두 테스트 모두 PASS.

- [ ] **Step 5: Run full backend test suite**

```powershell
pytest tests/ -v
```

Expected: 모든 테스트 PASS.

- [ ] **Step 6: Commit**

```powershell
cd C:\Coding\WorkBench
git add HiTessWorkBenchBackEnd/app/routers/analysis.py HiTessWorkBenchBackEnd/tests/test_mooring_fitting_router.py
git commit -m "✨ feat(api): POST /api/analysis/mooring-fitting/request 엔드포인트 추가"
```

---

## Task 5: 프론트엔드 — `DashboardContext.jsx` 에 앱 등록

**Files:**
- Modify: `HiTessWorkBench/frontend/src/contexts/DashboardContext.jsx`

- [ ] **Step 1: `RAW_ANALYSIS_DATA` 배열에 항목 추가**

`HiTessWorkBench/frontend/src/contexts/DashboardContext.jsx` 의 `RAW_ANALYSIS_DATA` 배열 — `File-Based Apps … Developing` 섹션 (현재 `Group & Module Unit 권상 구조 해석` / `DrawingToAnalysis` 항목들 옆) 에 다음 한 줄을 추가:

```js
  { mode: "File", category: "MooringFitting", title: "Mooring Fitting Assessment", description: "Mooring Fitting / Winch 보강 구조의 CSV 2종을 입력받아 8단계 BDF 파이프라인을 자동 생성합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["Mooring", "Winch", "BDF", "Pipeline"], devStatus: "Developing", contributor: "권혁민" },
```

- [ ] **Step 2: `APP_REGISTRY_OVERRIDES` 객체에 매핑 추가**

같은 파일의 `APP_REGISTRY_OVERRIDES` 객체 — `"Group & Module Unit 권상 구조 해석": { ... }` 항목 근처에 다음을 추가:

```js
  "Mooring Fitting Assessment": {
    menuName: "Mooring Fitting Assessment",
    programNames: ["MooringFitting", "Mooring Fitting Assessment"],
    apiEndpoint: "/api/analysis/mooring-fitting/request",
  },
```

- [ ] **Step 3: Commit**

```powershell
cd C:\Coding\WorkBench
git add HiTessWorkBench/frontend/src/contexts/DashboardContext.jsx
git commit -m "✨ feat(catalog): Mooring Fitting Assessment 카탈로그 항목 등록"
```

---

## Task 6: 프론트엔드 — 페이지 컴포넌트 `MooringFittingAssessment.jsx`

**Files:**
- Create: `HiTessWorkBench/frontend/src/pages/analysis/MooringFittingAssessment.jsx`

> 본 페이지는 `TrussAnalysis.jsx` 의 업로드/폴링/결과 표시 구조를 참고하되, Mooring Fitting 의 산출물 구성(핵심 5 + 펼치기) 에 맞춘다. 페이지 내 모든 의존 컴포넌트는 기존 파일을 import 만 한다 — 새 공통 컴포넌트를 만들지 않는다.

- [ ] **Step 1: 기존 TrussAnalysis.jsx 의 import 라인과 폴링/업로드 패턴 파악**

```powershell
# 참고용 — 실제 import 경로/시그니처를 그대로 차용
code HiTessWorkBench\frontend\src\pages\analysis\TrussAnalysis.jsx
```

확인 포인트:
- `useNavigation`, `useDashboard`, `useToast` 훅 사용처
- `usePolling` 또는 `setInterval` 기반 status 폴링 패턴
- `getApiBaseUrl()` 호출 위치
- `localStorage` 에서 `user` employee_id 꺼내는 방식

- [ ] **Step 2: 새 페이지 컴포넌트 작성**

새 파일 `HiTessWorkBench/frontend/src/pages/analysis/MooringFittingAssessment.jsx`:

```jsx
import React, { useState, useEffect, useRef } from 'react';
import { UploadCloud, FileText, Download, ChevronDown, ChevronUp, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { getApiBaseUrl } from '../../config';

const API_ENDPOINT = '/api/analysis/mooring-fitting/request';
const STATUS_ENDPOINT = (jobId) => `/api/analysis/status/${jobId}`;
const DOWNLOAD_ENDPOINT = (path) => `/api/download?filepath=${encodeURIComponent(path)}`;

export default function MooringFittingAssessment() {
  const [structureFile, setStructureFile] = useState(null);
  const [loadFile, setLoadFile] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null); // { status, progress, message, engine_log, project }
  const [showAll, setShowAll] = useState(false);
  const pollRef = useRef(null);
  const { addToast } = useToast();
  const { startGlobalJob } = useDashboard();

  // 진행 폴링 — 1.5초 간격
  useEffect(() => {
    if (!jobId) return;
    const tick = async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}${STATUS_ENDPOINT(jobId)}`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        setJobStatus(data);
        if (data.status === 'Success' || data.status === 'Failed') {
          clearInterval(pollRef.current);
        }
      } catch (e) { /* network blip — keep polling */ }
    };
    tick();
    pollRef.current = setInterval(tick, 1500);
    return () => clearInterval(pollRef.current);
  }, [jobId]);

  const handleRun = async () => {
    if (!structureFile || !loadFile) {
      addToast('Structure CSV와 Load CSV를 모두 선택하세요', 'error');
      return;
    }
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user?.employee_id) {
      addToast('로그인 정보가 없습니다.', 'error');
      return;
    }
    const fd = new FormData();
    fd.append('structure_file', structureFile);
    fd.append('load_file', loadFile);
    fd.append('employee_id', user.employee_id);
    fd.append('source', 'Workbench');
    try {
      const res = await fetch(`${getApiBaseUrl()}${API_ENDPOINT}`, {
        method: 'POST', body: fd, credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `요청 실패 (${res.status})`);
      }
      const data = await res.json();
      setJobId(data.job_id);
      setJobStatus({ status: 'Pending', progress: 0, message: '대기 중...' });
      startGlobalJob?.({ jobId: data.job_id, programName: 'Mooring Fitting Assessment' });
    } catch (e) {
      addToast(`해석 요청 실패: ${e.message}`, 'error');
    }
  };

  const isRunning = jobStatus && jobStatus.status !== 'Success' && jobStatus.status !== 'Failed';
  const isSuccess = jobStatus?.status === 'Success';
  const isFailed = jobStatus?.status === 'Failed';
  const result = jobStatus?.project?.result_info;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="border-b pb-4">
        <h1 className="text-2xl font-bold">Mooring Fitting Assessment</h1>
        <p className="text-sm text-gray-500 mt-1">
          Structure CSV 와 Load CSV 를 업로드하면 MooringFitting.exe 가 8단계 BDF 파이프라인을 자동 실행하고 결과 산출물을 제공합니다.
        </p>
      </div>

      {/* 업로드 카드 2-column */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UploadBox
          title="Structure CSV"
          hint="MooringFittingData.csv 형식 (MF/PLATE/BRACKET/ANGLE/FLATBAR/TBAR)"
          file={structureFile}
          onChange={setStructureFile}
          disabled={isRunning}
        />
        <UploadBox
          title="Load CSV"
          hint="MooringFittingDataLoad.csv 형식 (LOADCASE 행)"
          file={loadFile}
          onChange={setLoadFile}
          disabled={isRunning}
        />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          업로드 파일명은 무관 — 서버에서 표준 파일명으로 자동 저장됩니다.
        </p>
        <button
          onClick={handleRun}
          disabled={isRunning || !structureFile || !loadFile}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded font-medium"
        >
          {isRunning ? <span className="flex items-center gap-2"><Loader2 className="animate-spin" size={16}/>해석 중…</span> : 'Run Analysis'}
        </button>
      </div>

      {/* 진행 패널 */}
      {isRunning && (
        <div className="bg-gray-50 border rounded p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">{jobStatus.message}</span>
            <span className="text-sm text-gray-500">{jobStatus.progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${jobStatus.progress}%` }} />
          </div>
        </div>
      )}

      {/* 결과 패널 */}
      {isFailed && (
        <div className="bg-red-50 border border-red-300 rounded p-4">
          <div className="flex items-center gap-2 text-red-800 font-semibold mb-2">
            <AlertCircle size={18}/> 해석 실패
          </div>
          <details className="text-xs text-gray-700">
            <summary className="cursor-pointer">실행 로그</summary>
            <pre className="whitespace-pre-wrap mt-2 p-2 bg-white border rounded max-h-60 overflow-auto">{jobStatus.engine_log}</pre>
          </details>
        </div>
      )}

      {isSuccess && result && !result._artifacts_missing && (
        <ResultPanel result={result} showAll={showAll} setShowAll={setShowAll} />
      )}
    </div>
  );
}

function UploadBox({ title, hint, file, onChange, disabled }) {
  const inputRef = useRef(null);
  return (
    <div className="border-2 border-dashed rounded p-5 hover:border-blue-400 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium">{title}</h3>
        {file && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 size={14}/>{file.name}</span>}
      </div>
      <p className="text-xs text-gray-500 mb-3">{hint}</p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="w-full py-2 border rounded text-sm hover:bg-gray-50 flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <UploadCloud size={16}/> CSV 파일 선택
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
    </div>
  );
}

function ResultPanel({ result, showAll, setShowAll }) {
  const coreItems = [
    { key: 'final_bdf',        label: '최종 BDF (STAGE_07_FinalValidation.bdf)' },
    { key: 'validation_json',  label: '최종 검증 결과 (validation.json)' },
    { key: 'lineage_json',     label: 'ID Timeline (LINEAGE.json)' },
    { key: 'report_mf_csv',    label: 'MF 하중 리포트 (CSV)' },
    { key: 'report_winch_csv', label: 'Winch 하중 리포트 (CSV)' },
  ];
  return (
    <div className="bg-green-50 border border-green-300 rounded p-4">
      <div className="flex items-center gap-2 text-green-800 font-semibold mb-3">
        <CheckCircle2 size={18}/> 해석 완료
      </div>
      <p className="text-xs text-gray-600 mb-3">
        작업 폴더: <code className="bg-white px-1.5 py-0.5 border rounded text-[11px]">{result.case_dir}</code>
      </p>

      <h4 className="text-sm font-semibold mb-2">핵심 산출물</h4>
      <ul className="space-y-1 mb-4">
        {coreItems.map(({ key, label }) => {
          const path = result[key];
          return (
            <li key={key} className="flex items-center justify-between text-sm bg-white border rounded px-3 py-2">
              <span className="flex items-center gap-2 truncate"><FileText size={14}/>{label}</span>
              {path ? (
                <a href={`${getApiBaseUrl()}${DOWNLOAD_ENDPOINT(path)}`} target="_blank" rel="noreferrer"
                   className="text-blue-600 hover:underline flex items-center gap-1">
                  <Download size={14}/>다운로드
                </a>
              ) : (
                <span className="text-gray-400 text-xs">미생성</span>
              )}
            </li>
          );
        })}
      </ul>

      <button
        onClick={() => setShowAll(!showAll)}
        className="text-sm text-blue-600 hover:underline flex items-center gap-1"
      >
        {showAll ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
        전체 8단계 산출물 {showAll ? '닫기' : '펼치기'}
      </button>

      {showAll && (
        <div className="mt-3 space-y-2">
          <ArtifactList title="STAGE_NN.json (8개)" paths={result.stage_jsons} />
          <ArtifactList title="STAGE_NN.bdf (8개)" paths={result.stage_bdfs} />
          <ArtifactList title="STAGE_NN.bdf.verification.json (8개)" paths={result.stage_verifications} />
          {result.raw_json && <ArtifactList title="STAGE_00.raw.json" paths={[result.raw_json]} />}
          {result.initial_json && <ArtifactList title="STAGE_00.initial.json" paths={[result.initial_json]} />}
        </div>
      )}
    </div>
  );
}

function ArtifactList({ title, paths }) {
  if (!paths || paths.length === 0) return null;
  return (
    <div>
      <h5 className="text-xs font-semibold text-gray-600 mb-1">{title}</h5>
      <ul className="space-y-1">
        {paths.map((p) => (
          <li key={p} className="flex items-center justify-between text-xs bg-white border rounded px-2 py-1">
            <span className="truncate">{p.split(/[\\/]/).pop()}</span>
            <a href={`${getApiBaseUrl()}${DOWNLOAD_ENDPOINT(p)}`} target="_blank" rel="noreferrer"
               className="text-blue-600 hover:underline flex items-center gap-1">
              <Download size={12}/>다운로드
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```powershell
cd C:\Coding\WorkBench
git add HiTessWorkBench/frontend/src/pages/analysis/MooringFittingAssessment.jsx
git commit -m "✨ feat(page): Mooring Fitting Assessment 페이지 — 업로드/폴링/결과 트리"
```

---

## Task 7: 프론트엔드 — `App.jsx` 라우팅 추가

**Files:**
- Modify: `HiTessWorkBench/frontend/src/App.jsx`

- [ ] **Step 1: import 라인 추가**

`App.jsx` 상단의 기존 페이지 import 블록 (예: `import TrussAnalysis ...` 옆) 에 추가:

```jsx
import MooringFittingAssessment from './pages/analysis/MooringFittingAssessment';
```

- [ ] **Step 2: `renderPage()` switch 에 case 추가**

기존 `case 'Truss Structural Assessment': return <TrussAssessment />;` (또는 다른 File-Based 케이스) 옆에:

```jsx
case 'Mooring Fitting Assessment': return <MooringFittingAssessment />;
```

- [ ] **Step 3: Commit**

```powershell
cd C:\Coding\WorkBench
git add HiTessWorkBench/frontend/src/App.jsx
git commit -m "✨ feat(routing): Mooring Fitting Assessment 페이지 라우팅 연결"
```

---

## Task 8: exe 빌드 + 배포 (사용자 수동)

> 사용자가 직접 수행하는 단계. agent 가 실행하지 않음.

**Files:**
- Build source: `C:\Coding\WorkBenchSubModule\MooringFitting\src\MooringFitting.App\`
- Deploy target: `C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\MooringFitting\MooringFitting.exe`

- [ ] **Step 1: dotnet publish 단일 파일 빌드**

```powershell
cd C:\Coding\WorkBenchSubModule\MooringFitting
dotnet publish src/MooringFitting.App -c Release -r win-x64 `
  --self-contained -p:PublishSingleFile=true `
  -o C:\Coding\WorkBenchSubModule\MooringFitting\publish
```

- [ ] **Step 2: rename 복사**

```powershell
# InHouseProgram\MooringFitting\ 폴더가 비어 있어야 함 (이미 존재 확인됨)
Copy-Item `
  C:\Coding\WorkBenchSubModule\MooringFitting\publish\MooringFitting.App.exe `
  C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\MooringFitting\MooringFitting.exe `
  -Force
```

- [ ] **Step 3: 단독 동작 검증 — 샘플 케이스로 직접 호출**

```powershell
# 임시 작업 폴더에 샘플 CSV 복사
$work = "C:\Temp\mooring_smoke_$(Get-Date -Format yyyyMMdd_HHmmss)"
New-Item -ItemType Directory -Path $work -Force | Out-Null
Copy-Item C:\Coding\WorkBenchSubModule\MooringFitting\csv\NewCase_01\MooringFittingData.csv $work
Copy-Item C:\Coding\WorkBenchSubModule\MooringFitting\csv\NewCase_01\MooringFittingDataLoad.csv $work

# exe 직접 호출
& C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\MooringFitting\MooringFitting.exe build-full $work
$lastExit = $LASTEXITCODE
Write-Host "Exit code: $lastExit"
Get-ChildItem "$work\out"
```

Expected: exit code 0, `$work\out\` 에 STAGE_00 ~ STAGE_07 산출물 + LINEAGE.json + Report_*.csv 생성.

---

## Task 9: 백엔드 + 프론트엔드 동시 실행으로 E2E 스모크 테스트

**Files:**
- 없음 (수동 실행)

- [ ] **Step 1: 백엔드 기동**

```powershell
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd
.\WorkBenchEnv\Scripts\Activate.ps1
uvicorn app.main:app --host 0.0.0.0 --port 9091 --reload
```

- [ ] **Step 2: 프론트엔드 + Electron 기동 (별도 PowerShell 창)**

```powershell
cd C:\Coding\WorkBench\HiTessWorkBench
npm run dev
```

- [ ] **Step 3: UI 시나리오 검증**

브라우저(또는 Electron 창) 에서:

1. 로그인 → File-Based Apps 메뉴 → 'Mooring Fitting Assessment' 카드가 보이고 클릭 가능.
2. 페이지에서 Structure CSV 박스에 `C:\Coding\WorkBenchSubModule\MooringFitting\csv\NewCase_01\MooringFittingData.csv` 업로드, Load CSV 박스에 `MooringFittingDataLoad.csv` 업로드.
3. `Run Analysis` 클릭 → 진행률 0% → 100% 까지 polling, 메시지가 "초기화 → 파이프라인 실행 → 수집 → 저장 → 완료" 순서로 갱신.
4. 완료 후 결과 패널에 핵심 5개 다운로드 링크 노출. `최종 BDF` 다운로드 클릭 → `STAGE_07_FinalValidation.bdf` 가 정상 다운로드 됨.
5. `전체 8단계 산출물 펼치기` 클릭 → STAGE_NN.json 8개, .bdf 8개, .bdf.verification.json 8개 리스트 표시.

- [ ] **Step 4: 부정 케이스 — exe 부재 시나리오**

```powershell
# exe 임시 rename 해서 부재 상태 만들기
Rename-Item C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\MooringFitting\MooringFitting.exe `
            C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\MooringFitting\MooringFitting.exe.bak
```

UI에서 다시 Run → "해석 실패 — 실행 파일을 찾을 수 없습니다: …\MooringFitting.exe" 가 실행 로그에 노출되는지 확인.

다시 원복:
```powershell
Rename-Item C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\MooringFitting\MooringFitting.exe.bak `
            C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\MooringFitting\MooringFitting.exe
```

- [ ] **Step 5: 부정 케이스 — 임의 파일명 업로드 → 표준명 강제 저장 검증**

UI에서 임의 파일명(`vessel_X.csv` / `vessel_Y.csv`) 으로 업로드 후 Run.
백엔드 콘솔 로그에서 `[MooringFitting] exe=..., work_dir=...\userConnection\..._MooringFitting` 라인 확인.
파일 탐색기로 해당 work_dir 열어 `MooringFittingData.csv` / `MooringFittingDataLoad.csv` 가 표준명으로 저장돼 있는지 확인.

- [ ] **Step 6: 이력 확인**

워크벤치 좌측 메뉴 → `My Projects` → 최신 항목으로 `MooringFitting_<timestamp>` (program_name=MooringFitting, status=Success) 가 보이는지 확인.

- [ ] **Step 7: 모든 단계 PASS 시 작업 완료**

수정사항 없으면 별도 commit 불필요 (Task 1~7에서 분할 커밋 완료).
변경 누적 확인:
```powershell
cd C:\Coding\WorkBench
git log --oneline -n 10
```

Expected: Task 1~7의 7개 커밋이 보임.

---

## Self-Review 결과

**Spec coverage check** — 스펙 각 섹션이 어느 task 에서 처리되는지:

| Spec 섹션 | 처리 task |
|---|---|
| §3 추가/변경 파일 맵 (백엔드 3개, 프론트 3개, 배포 1개) | Task 1~8 모두 |
| §4 명명 규칙 (program_name, 폴더 접미사, 엔드포인트, exe 경로 등) | Task 3, 4, 5 |
| §5 데이터 흐름 | Task 3, 4, 6 |
| §6 collect_artifacts() | Task 2 |
| §7 에러 처리 매트릭스 (exe 부재 / timeout / 422 / 403 / out 부재 / DB 실패) | Task 3 (서비스 로직), Task 4 (라우터 + 통합 테스트), Task 9 (E2E 검증) |
| §8 save_upload 비파괴 확장 | Task 1 |
| §9 ANALYSIS_DATA 등록 | Task 5 |
| §10 페이지 컴포넌트 골격 | Task 6 |
| §11 테스트 시나리오 1~7 | Task 9 Steps 3~6 |
| §12 Phase 2 이후 확장 포인트 | 본 plan 범위 외 — 의도적 제외 |

**Placeholder scan** — TBD/TODO/"적절한 에러 처리" 등 없음. 모든 step에 실제 코드/명령어 포함.

**Type consistency** — `task_execute_mooring_fitting(job_id, structure_path, load_path, work_dir, exe_path, employee_id, timestamp, source)` 시그니처가 Task 3 정의와 Task 4 호출(`submit_analysis_job(task_execute_mooring_fitting, structure_path, load_path, work_dir, exe_path, employee_id, timestamp, source)`) 에서 일치. `collect_artifacts(out_dir, work_dir)` 도 Task 2 정의·Task 3 호출 일치. result_info 키 (`final_bdf`, `validation_json`, `lineage_json`, `report_mf_csv`, `report_winch_csv`, `stage_jsons`, `stage_bdfs`, `stage_verifications`, `raw_json`, `initial_json`, `case_dir`, `out_dir`) 가 Task 2 구현 / Task 6 페이지 소비에서 정확히 매칭.
