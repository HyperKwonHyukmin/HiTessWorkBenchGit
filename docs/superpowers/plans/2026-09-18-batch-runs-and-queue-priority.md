# 배치 실행 + 큐 우선순위 (Plan H) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ⚠️ **하드 의존 (읽고 시작)**: 이 plan 은 **Plan D(작업 취소)** 가 병합·배포된 뒤에만 시작할 수 있다.
> `job_status_store.cancel(job_id)`·`register_process`·`attach_future`·`current_job_id()`·`TERMINAL_STATUSES`·`JobCancelledError` 계약을 **없는 상태로 착수하면 Task 3(풀 분리)·Task 5(배치 서비스)·Task 6(집계 훅)·Task 7(취소 라우터)가 전부 구현 불능**이다.
> 마스터 §3 실행 순서 표에서 유일한 "hard" 의존이 이것이다. Plan D §10 의 접점 항목이 이 문서의 Task 3·Task 5·Task 6 이다.
> Plan D 가 아직 없다면 `docs/superpowers/plans/2026-09-18-job-cancel.md` 를 먼저 끝내고 이 문서로 돌아온다.

**Goal:** `job_manager` 를 **`heavy`(3) / `light`(4)** 두 개의 ThreadPoolExecutor 로 분리해 nastran/Cmb.Cli 계열이 계산기 큐를 굶기지 못하게 하고, 파라메트릭 8개 앱(`capabilities="calculator"` + `input_keys=("input_json",)`)에 공용 **`BatchRunPanel`** + `POST /api/analysis/batch` + `GET /api/analysis/batch/{id}` + `POST /api/analysis/batch/{id}/cancel` 를 붙여 케이스 표(최대 50건) → 다건 실행 → 서버 집계 진행률 → 개별/전체 취소 → 배치 완료 알림 1건 을 한 카드로 다룬다.

**Architecture:**
- 백엔드 — `models.BatchRun` + `Analysis.batch_id` + `schema_bootstrap.ensure_batch_runs_columns()` / `ensure_analysis_batch_column()`; `program_registry.ProgramSpec.queue_class` 필드; `job_manager` 를 `_pools: {"heavy": …, "light": …}` 로 리팩토링해 `submit(fn, job_id, *args, queue_class="light")` 를 지원; `routers/_intake.submit_analysis_job` 이 `resolve_program(program_name).queue_class` 로 라우팅; `services/batch_run_service.py` 가 `create_batch/mark_case_terminal/get_progress/cancel_batch` 를 소유; `job_manager._write_through` 가 케이스 terminal 마다 `mark_case_terminal` 을 호출; `routers/batch.py` 가 CRUD + cancel + 관리자 promote; `notification_service.notify_job_terminal` 이 `record.batch_id is not None` 이면 조기 반환(케이스 알림 억제)하고 배치가 terminal 로 갈 때만 `batch.completed` 1건.
- 프론트 — `api/analysis.js` 에 `createBatch/getBatchProgress/cancelBatch` 함수 3개; 공용 `components/analysis/BatchRunPanel.jsx`(케이스 표 편집기 + 진행률 카드 + CSV 붙여넣기); `MastPostAssessment.jsx` 에 아코디언으로 삽입(파일럿); `MyProjects.jsx` 에 `batch_id` 그룹 행(`BatchRowGroup.jsx`) + "배치만" 필터; `UtilityDock` 의 `patchGlobalJob` 이 `batch_id` 를 이해해 40 케이스 배치를 1 카드로 표시.

**Tech Stack:** Python 3.14 / FastAPI / SQLAlchemy(MySQL 운영, SQLite 테스트) / pytest — React 18 + Vite + Tailwind + lucide-react + axios — Electron 36. 신규 pip/npm 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-18-batch-runs-and-queue-priority-design.md`
(마스터: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1 · §2.1 · §2.5 · §2.8)
(하드 의존: `docs/superpowers/specs/2026-09-18-job-cancel-design.md` §3.1·§3.2)

**규칙(마스터 §1):**
- 커밋은 사용자가 직접 한다 — 각 Task 마지막 단계는 **"커밋 준비 완료 — 변경 파일 목록을 사용자에게 보고"** 다.
- `HiTessWorkBench/frontend/src/config.js` 는 절대 스테이징하지 않는다. `Darkmode.js/` 는 건드리지 않는다.
- 백엔드는 TDD(실패 테스트 → 최소 구현 → 통과). 프론트는 러너가 없으므로 수동 검증 절차를 따른다(순수 유틸만 `node --test`).
- 문서·주석·UI 문구는 한국어, 식별자는 영어. `GUARDED_ROUTES` 등록 안 함(마스터 §1-8, 플랫폼 공통 라우터).

**테스트 실행 위치:** 모든 pytest 명령은 `C:\Coding\WorkBench\HiTessWorkBenchBackEnd` 에서 `WorkBenchEnv/Scripts/python.exe -m pytest …` 로 실행한다. 프론트 `node --test` 는 `C:\Coding\WorkBench\HiTessWorkBench\frontend` 에서 실행한다.

**⚠ 서버 재시작 필수:** 이 plan 은 프로세스 전역 스레드 풀 개수를 5 → 3+4=7 로 바꾼다. `--reload` 개발 서버는 자동 재기동하지만, 운영 서버(145)는 **`git pull` 후 반드시 백엔드 서비스를 재시작**해야 새 풀이 뜬다(현행 5-worker 풀은 프로세스가 살아 있는 동안 그대로다).

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `HiTessWorkBenchBackEnd/app/models.py` | 수정 | `BatchRun` 모델 추가(파일 끝) + `Analysis.batch_id` 컬럼 |
| `HiTessWorkBenchBackEnd/app/schema_bootstrap.py` | 수정 | `ensure_analysis_batch_column()` + `ensure_batch_runs_columns()` + `run_schema_bootstrap()` 호출 |
| `HiTessWorkBenchBackEnd/app/services/program_registry.py` | 수정 | `ProgramSpec.queue_class` 필드 + `__post_init__` 검증 + 32개 spec 에 명시 |
| `HiTessWorkBenchBackEnd/app/services/job_manager.py` | 수정 | `HEAVY_MAX_WORKERS`/`LIGHT_MAX_WORKERS` + `ManagedAnalysisExecutor` 다중 풀 + `submit(..., queue_class=…)` + `get_queue_stats` 확장 + `_write_through` 배치 훅 |
| `HiTessWorkBenchBackEnd/app/routers/_intake.py` | 수정 | `submit_analysis_job` 이 `spec.queue_class` 로 라우팅 + `batch_id` 인자 수용 |
| `HiTessWorkBenchBackEnd/app/services/batch_run_service.py` | 생성 | `BatchCase` dataclass + `create_batch/mark_case_terminal/get_progress/cancel_batch/resolve_batch_status/promote_batch` |
| `HiTessWorkBenchBackEnd/app/services/notification_service.py` | 수정 | `notify_job_terminal` 에 배치 소속 조기 반환 (Plan A 배포 후에만 존재) |
| `HiTessWorkBenchBackEnd/app/services/cleanup_service.py` | 수정 | `run_batch_run_cleanup(dry_run)` + `run_all_cleanup` 키 추가 |
| `HiTessWorkBenchBackEnd/app/routers/batch.py` | 생성 | `POST /api/analysis/batch` + `GET /api/analysis/batch/{id}` + `POST /api/analysis/batch/{id}/cancel` + `POST /api/admin/analysis/batch/{id}/promote` |
| `HiTessWorkBenchBackEnd/app/main.py` | 수정 | import + `include_router(batch.router)` |
| `HiTessWorkBenchBackEnd/tests/test_batch_run_models.py` | 생성 | 테이블 생성·부트스트랩 멱등 |
| `HiTessWorkBenchBackEnd/tests/test_batch_run_service.py` | 생성 | `resolve_batch_status` 표 · `create_batch` · `mark_case_terminal` · `cancel_batch` |
| `HiTessWorkBenchBackEnd/tests/test_job_manager_pools.py` | 생성 | 다중 풀 격리 · 굶주림 방지 · `get_queue_stats.pools` |
| `HiTessWorkBenchBackEnd/tests/test_program_registry_queue_class.py` | 생성 | 32개 spec 의 `queue_class` 실측 검증 |
| `HiTessWorkBenchBackEnd/tests/test_batch_run_router.py` | 생성 | 라우터 API + 케이스 상한 + 권한 |
| `HiTessWorkBenchBackEnd/tests/test_batch_run_notify.py` | 생성 | 케이스별 알림 억제 + 배치 완료 알림 1건 |
| `HiTessWorkBenchBackEnd/tests/test_batch_run_cleanup.py` | 생성 | 90일 정리 + `run_all_cleanup` 반환 키 |
| `HiTessWorkBench/frontend/src/api/analysis.js` | 수정 | `createBatch/getBatchProgress/cancelBatch` axios 함수 |
| `HiTessWorkBench/frontend/src/utils/batchRun.js` | 생성 | 순수 유틸(케이스 검증·CSV 파싱·진행률 계산·상태 라벨) |
| `HiTessWorkBench/frontend/src/utils/batchRun.test.js` | 생성 | `node:test` |
| `HiTessWorkBench/frontend/src/components/analysis/BatchRunPanel.jsx` | 생성 | 케이스 표 편집기 + 진행률 카드(폴링) + 중단 버튼 |
| `HiTessWorkBench/frontend/src/components/analysis/BatchRowGroup.jsx` | 생성 | MyProjects 배치 부모/자식 접기 행 |
| `HiTessWorkBench/frontend/src/pages/analysis/MastPostAssessment.jsx` | 수정 | 파일럿 — 아래 아코디언에 `<BatchRunPanel programId="mast-post" .../>` |
| `HiTessWorkBench/frontend/src/pages/analysis/MyProjects.jsx` | 수정 | 필터 "배치만" 토글 + `BatchRowGroup` 렌더 분기 |
| `HiTessWorkBench/frontend/src/contexts/DashboardContext.jsx` | 수정 | `patchGlobalJob` 에 `batch_id` 전달 + `globalJobs` 배치별 1카드 병합 |
| `HiTessWorkBench/frontend/src/components/platform/UtilityDock.jsx` | 수정 | 배치 카드 렌더(진행률·중단 버튼) — 케이스별 카드는 만들지 않는다 |

---

## Task 1: `BatchRun` 모델 + `Analysis.batch_id` + 스키마 부트스트랩

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/models.py`(파일 끝 + `Analysis` 컬럼 추가)
- Modify: `HiTessWorkBenchBackEnd/app/schema_bootstrap.py:79-87`(analysis 컬럼 표), `:116-121` 뒤(새 bootstrap), `:152-160`(`run_schema_bootstrap`)
- Create: `HiTessWorkBenchBackEnd/tests/test_batch_run_models.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_batch_run_models.py`:

```python
"""배치 실행 테이블(batch_runs)과 Analysis.batch_id 컬럼의 생성·부트스트랩 회귀 테스트."""
from datetime import datetime

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app import models
from app.schema_bootstrap import (
    ensure_analysis_batch_column,
    ensure_batch_runs_columns,
    run_schema_bootstrap,
)


def _sqlite_engine():
    return create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def test_create_all_makes_batch_runs_table():
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    tables = set(inspect(engine).get_table_names())
    assert "batch_runs" in tables

    cols = {c["name"] for c in inspect(engine).get_columns("batch_runs")}
    assert cols == {
        "id", "employee_id", "program_id", "name",
        "status", "total", "done", "failed",
        "created_at", "updated_at",
    }
    analysis_cols = {c["name"] for c in inspect(engine).get_columns("analysis")}
    assert "batch_id" in analysis_cols


def test_batch_run_defaults(db_session):
    row = models.BatchRun(
        employee_id="EMP001",
        program_id="mast-post",
        name="후보 스캔",
        total=5,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    assert row.status == "Running"
    assert row.done == 0
    assert row.failed == 0
    assert row.created_at is not None
    assert row.updated_at is None


def test_analysis_batch_id_nullable(db_session, make_analysis):
    """단건 실행(비-배치)은 batch_id 가 NULL 인 채로 만들어져야 한다."""
    a = make_analysis("EMP001", "Truss Assessment", datetime(2026, 9, 18, 9, 0, 0))
    db_session.commit()
    db_session.refresh(a)
    assert a.batch_id is None


def test_bootstrap_adds_missing_analysis_batch_column():
    """운영 DB 에 batch_id 컬럼이 빠진 채여도 bootstrap 이 채운다(멱등)."""
    engine = _sqlite_engine()
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE analysis ("
            " id INTEGER PRIMARY KEY, employee_id VARCHAR(50),"
            " program_name VARCHAR(100), status VARCHAR(50), created_at DATETIME)"
        ))
    ensure_analysis_batch_column(engine=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("analysis")}
    assert "batch_id" in cols
    # 두 번 돌려도 예외 없이 같은 결과
    ensure_analysis_batch_column(engine=engine)
    assert {c["name"] for c in inspect(engine).get_columns("analysis")} == cols


def test_bootstrap_adds_batch_run_indexes():
    """MyProjects 정렬용 (employee_id, created_at) 인덱스가 있어야 한다."""
    engine = _sqlite_engine()
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE batch_runs ("
            " id INTEGER PRIMARY KEY, employee_id VARCHAR(50) NOT NULL,"
            " program_id VARCHAR(50) NOT NULL, name VARCHAR(200) NOT NULL DEFAULT '',"
            " status VARCHAR(20) NOT NULL DEFAULT 'Running',"
            " total INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0,"
            " failed INTEGER NOT NULL DEFAULT 0, created_at DATETIME, updated_at DATETIME)"
        ))
    ensure_batch_runs_columns(engine=engine)
    indexes = {ix["name"] for ix in inspect(engine).get_indexes("batch_runs")}
    assert "ix_batch_runs_employee_id" in indexes
    assert "ix_batch_runs_program_id" in indexes
    assert "ix_batch_runs_created_at" in indexes


def test_run_schema_bootstrap_calls_batch_bootstrap(monkeypatch):
    called = []
    import app.schema_bootstrap as sb
    monkeypatch.setattr(sb, "ensure_analysis_batch_column", lambda *, engine=None: called.append("a"))
    monkeypatch.setattr(sb, "ensure_batch_runs_columns", lambda *, engine=None: called.append("b"))
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    run_schema_bootstrap(engine=engine)
    assert "a" in called and "b" in called
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_batch_run_models.py -q
```
기대: `ImportError: cannot import name 'ensure_batch_runs_columns'` 로 수집 단계 실패(`1 error`).

- [ ] **Step 3: 모델 추가** — `app/models.py`

(a) `Analysis` 클래스(78~94행)의 마지막 컬럼 `updated_at = Column(DateTime(timezone=True), nullable=True)` 다음 줄에 배치 참조를 추가한다. `Analysis` 의 들여쓰기는 2칸이다. FK 는 걸지 않는다(spec §3.1 근거 — `analysis` 테이블이 대량이고 배치 삭제·재기동 시 스키마 부트스트랩이 서버 기동을 막지 않게).

```python
  # Plan H — 배치 실행. 케이스 배치가 아닌 개별 실행은 NULL 이다.
  batch_id = Column(Integer, nullable=True, index=True)
```

(b) 파일 끝(`RegisteredModelArtifact.created_at` 뒤)에 새 모델 클래스를 추가한다. 이 파일은 클래스 본문이 **2칸 들여쓰기**다.

```python


class BatchRun(Base):
  """파라메트릭 앱의 다건 배치 실행 요약(마스터 §2.8).

  케이스는 별도 Analysis 레코드로 그대로 존재하고, 여기는 진행률 집계·최종 상태·이름만 갖는다.
  - status : Running / Completed / Failed / Cancelled (마스터 어휘 재사용, Interrupted 는 배치엔 없다)
  - total  : 제출 시 확정, 이후 불변
  - done   : Success 로 마감된 케이스 수
  - failed : Failed·Cancelled 로 마감된 케이스 수(사용자 관점 '결과 없음')
  최종 상태 판정은 batch_run_service.resolve_batch_status() 순수함수가 한다.
  """

  __tablename__ = "batch_runs"
  id = Column(Integer, primary_key=True, index=True)
  employee_id = Column(String(50), nullable=False, index=True)
  program_id = Column(String(50), nullable=False, index=True)
  name = Column(String(200), nullable=False, default="")
  status = Column(String(20), nullable=False, default="Running")
  total = Column(Integer, nullable=False)
  done = Column(Integer, nullable=False, default=0)
  failed = Column(Integer, nullable=False, default=0)
  created_at = Column(DateTime, default=datetime.now, index=True)
  updated_at = Column(DateTime, nullable=True)
```

- [ ] **Step 4: 부트스트랩 함수 추가** — `app/schema_bootstrap.py`

(a) `ensure_analysis_job_columns`(79~87행)를 확장하지 말고, 별도 함수를 만든다(마스터 §1-3 — 컬럼 그룹별로 함수를 나누면 배포 순서가 뒤바뀌어도 서로 방해하지 않는다). `ensure_chat_message_columns`(116~121행) 아래에:

```python


def ensure_analysis_batch_column(*, engine=None) -> None:
    """Plan H — analysis.batch_id 컬럼과 인덱스를 멱등하게 보강합니다.

    새 컬럼은 create_all 이 만들어 주지만 운영 DB 는 이미 테이블이 있으므로 ALTER 로만
    추가할 수 있다. FK 를 걸지 않기 때문에 batch_runs 가 없어도 안전하다.
    """
    _add_missing_columns("analysis", {
        "batch_id": "ALTER TABLE analysis ADD COLUMN batch_id INT NULL",
    }, engine=engine)
    _add_missing_indexes("analysis", {
        "ix_analysis_batch_id": "CREATE INDEX ix_analysis_batch_id ON analysis (batch_id)",
    }, engine=engine)


def ensure_batch_runs_columns(*, engine=None) -> None:
    """Plan H — batch_runs 테이블의 컬럼·인덱스를 멱등하게 보강합니다.

    테이블 자체는 create_all 로 생기지만, 이후 컬럼이 늘어날 때 운영 DB 에서 500 이
    나지 않도록 전 컬럼을 여기에 둔다(마스터 규약 §1-3). 정렬용 (employee_id, created_at desc)
    인덱스는 MyProjects 배치 목록 페이지 로딩에 필수.
    """
    _add_missing_columns("batch_runs", {
        "name": "ALTER TABLE batch_runs ADD COLUMN name VARCHAR(200) NOT NULL DEFAULT ''",
        "status": "ALTER TABLE batch_runs ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'Running'",
        "done": "ALTER TABLE batch_runs ADD COLUMN done INT NOT NULL DEFAULT 0",
        "failed": "ALTER TABLE batch_runs ADD COLUMN failed INT NOT NULL DEFAULT 0",
        "updated_at": "ALTER TABLE batch_runs ADD COLUMN updated_at DATETIME NULL",
    }, engine=engine)
    _add_missing_indexes("batch_runs", {
        "ix_batch_runs_employee_id": (
            "CREATE INDEX ix_batch_runs_employee_id ON batch_runs (employee_id)"
        ),
        "ix_batch_runs_program_id": (
            "CREATE INDEX ix_batch_runs_program_id ON batch_runs (program_id)"
        ),
        "ix_batch_runs_created_at": (
            "CREATE INDEX ix_batch_runs_created_at ON batch_runs (created_at)"
        ),
    }, engine=engine)
```

(b) `run_schema_bootstrap()`(현재 152~160행)의 `ensure_chat_message_columns(engine=engine)` 다음 줄에 두 호출을 넣는다. 순서는 **`analysis` 먼저 → `batch_runs` 다음** — analysis.batch_id 를 참조하는 외래키는 없지만, 테스트가 `_write_through` 훅을 검증할 때 순서 의존성이 헷갈리는 것을 피하고 싶다.

```python
    ensure_chat_message_columns(engine=engine)
    ensure_analysis_batch_column(engine=engine)
    ensure_batch_runs_columns(engine=engine)
    ensure_app_spaces(engine=engine)
```

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_batch_run_models.py -q
```
기대: `6 passed`.

전체 회귀(모델·스키마 변경이라 한 번 돈다):
```
WorkBenchEnv/Scripts/python.exe -m pytest tests -q -x
```
기대: 기존 전부 통과(실패 0). `Analysis.batch_id` 는 nullable 이라 기존 레코드 생성 경로가 영향받지 않는다.

- [ ] **Step 6: 커밋 준비 완료** — 변경 파일 목록을 사용자에게 보고: `app/models.py`, `app/schema_bootstrap.py`, `tests/test_batch_run_models.py`.

---

## Task 2: `ProgramSpec.queue_class` — heavy/light 분류

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/program_registry.py:29-56`(dataclass + `__post_init__`), `:59-89`(`_spec`), `:94-307`(모든 spec)
- Create: `HiTessWorkBenchBackEnd/tests/test_program_registry_queue_class.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_program_registry_queue_class.py`:

```python
"""ProgramSpec.queue_class 값 표(마스터 §2.8·Plan H spec §3.3) 실측 검증.

heavy = nastran/Cmb.Cli/PSA/도면 엔진 = solver 내부에서 이미 다중 코어를 쓰므로 상한 3
light = 순수 계산·30초 이내 계산기 + external-app 프록시 = 워커 4
"""
import pytest

from app.services.program_registry import (
    PROGRAM_SPECS,
    ProgramSpec,
    get_program,
    resolve_program,
)


HEAVY_PROGRAM_IDS = frozenset({
    "truss-model-builder",
    "truss-assessment",
    "bdf-scanner",
    "hp-scr-psa",
    "hp-scr-por",
    "f06-parser",
    "mooring-fitting",
    "mooring-fitting-solve",
    "hitess-modelflow",
    "hitess-model-builder",
    "model-builder-analysis",
    "group-module-unit",
    "side-passage",
    "hull-acceleration",
    "drawing-to-analysis",
    "plate-structure",
    "double-pipe-fuel-line",
    "simple-beam",              # JSON 입력이지만 내부에서 nastran 을 돌린다
    "module-stability",
    "module-hoist-optimize",
    "unit-structural-analysis",
})

LIGHT_PROGRAM_IDS = frozenset({
    "carling-free",
    "carling-optimization",
    "column-buckling",
    "mast-post",
    "jib-rest",
    "d-type-lug",
    "hole-fatigue",
    "section-property",
    "independent-tank",
    "block-weld",
    "heavy-block-lifting",
})


def test_every_spec_declares_queue_class():
    """미분류 spec 이 있으면 기본값(light) 로 조용히 새어 nastran 이 계산기 풀을 굶긴다."""
    for spec in PROGRAM_SPECS:
        assert spec.queue_class in {"heavy", "light"}, (
            f"{spec.program_id} 의 queue_class 가 잘못됐다: {spec.queue_class!r}"
        )


def test_heavy_and_light_id_sets_are_disjoint_and_cover_all():
    ids = {spec.program_id for spec in PROGRAM_SPECS}
    assert HEAVY_PROGRAM_IDS.isdisjoint(LIGHT_PROGRAM_IDS)
    assert HEAVY_PROGRAM_IDS <= ids
    assert LIGHT_PROGRAM_IDS <= ids
    # 두 집합의 합이 전체 레지스트리와 같아야 한다.
    assert HEAVY_PROGRAM_IDS | LIGHT_PROGRAM_IDS == ids, (
        f"미분류: {ids - HEAVY_PROGRAM_IDS - LIGHT_PROGRAM_IDS}"
    )


def test_heavy_programs_are_marked_heavy():
    for pid in HEAVY_PROGRAM_IDS:
        spec = get_program(pid)
        assert spec is not None, pid
        assert spec.queue_class == "heavy", (
            f"{pid} 는 heavy 여야 한다(nastran/Cmb.Cli 계열). 실제={spec.queue_class}"
        )


def test_light_programs_are_marked_light():
    for pid in LIGHT_PROGRAM_IDS:
        spec = get_program(pid)
        assert spec is not None, pid
        assert spec.queue_class == "light", (
            f"{pid} 는 light 여야 한다(계산기·external-app). 실제={spec.queue_class}"
        )


def test_batch_target_eight_are_all_light_calculators_with_input_json():
    """배치 대상 = calculator + input_keys=('input_json',) + light. 정확히 8개."""
    batch_targets = [
        spec for spec in PROGRAM_SPECS
        if spec.queue_class == "light"
        and "calculator" in spec.capabilities
        and spec.input_keys == ("input_json",)
    ]
    ids = sorted(spec.program_id for spec in batch_targets)
    assert ids == sorted([
        "carling-free", "carling-optimization",
        "column-buckling", "mast-post", "jib-rest",
        "d-type-lug", "hole-fatigue", "section-property",
    ]), f"배치 대상 8개가 어긋난다: {ids}"


def test_program_spec_rejects_unknown_queue_class():
    with pytest.raises(ValueError):
        ProgramSpec(
            program_id="bad", display_name="Bad",
            aliases=("Bad",), capabilities=frozenset(),
            queue_class="realtime",
        )


def test_program_spec_default_queue_class_is_light():
    """기본이 heavy 면 미등록 프로그램이 nastran 풀로 새어 계산기가 굶는다.

    반대(기본 light) 라면 미등록 프로그램은 계산기 풀에서만 도는데, 그건 눈에 띈다
    (실측 15초짜리 계산기가 5분 대기하면 사용자가 신고한다).
    """
    spec = ProgramSpec(
        program_id="x", display_name="X",
        aliases=("X",), capabilities=frozenset(),
    )
    assert spec.queue_class == "light"


def test_resolve_program_preserves_queue_class():
    """resolve_program (별칭 → spec) 의 queue_class 가 원본과 같다."""
    for alias in ("Truss Assessment", "Truss Structural Assessment"):
        assert resolve_program(alias).queue_class == "heavy"
    for alias in ("Mast Post Assessment",):
        assert resolve_program(alias).queue_class == "light"
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_program_registry_queue_class.py -q
```
기대: `8 failed`(`ProgramSpec` 에 `queue_class` 없음 → AttributeError).

- [ ] **Step 3: dataclass 필드 추가** — `app/services/program_registry.py`

(a) `ProgramSpec`(29~56행)의 마지막 필드 `verdict_kind: str = "required"` 다음 줄에 필드를 추가하고, `__post_init__` 에 검증을 붙인다.

```python
@dataclass(frozen=True, slots=True)
class ProgramSpec:
    program_id: str
    display_name: str
    aliases: tuple[str, ...]
    capabilities: frozenset[str]
    history_visible: bool = True
    rerun_adapter: str | None = None
    input_keys: tuple[str, ...] = ()
    statistics_group: str | None = None
    report_adapter: str | None = None
    report_template: str | None = None
    report_scope: str = "not-applicable"
    verdict_kind: str = "required"
    # Plan H — heavy=nastran/Cmb.Cli/PSA 계열(워커 3), light=계산기·프록시(워커 4).
    # 기본이 light 이므로 미분류·미래 spec 이 계산기 풀로 흘러도 안전하다.
    queue_class: str = "light"

    def __post_init__(self) -> None:
        if not self.program_id or not self.aliases:
            raise ValueError("ProgramSpec requires a program_id and at least one alias")
        if len({alias.casefold() for alias in self.aliases}) != len(self.aliases):
            raise ValueError(f"Duplicate aliases in {self.program_id}")
        if self.report_scope not in REPORT_SCOPES:
            raise ValueError(
                f"Unknown report_scope {self.report_scope!r} in {self.program_id}"
            )
        if self.verdict_kind not in VERDICT_KINDS:
            raise ValueError(
                f"Unknown verdict_kind {self.verdict_kind!r} in {self.program_id}"
            )
        if self.queue_class not in {"heavy", "light"}:
            raise ValueError(
                f"Unknown queue_class {self.queue_class!r} in {self.program_id}"
            )
```

(b) `_spec` 팩토리(59~89행)에 `queue_class` 인자를 전달할 수 있게 한다. 기본은 그대로 `"light"`. 모든 헬퍼 인자를 keyword-only 로 유지한다.

```python
def _spec(
    program_id: str,
    display_name: str,
    *aliases: str,
    capabilities: tuple[str, ...] = (),
    history_visible: bool = True,
    rerun_adapter: str | None = None,
    input_keys: tuple[str, ...] = (),
    statistics_group: str | None = None,
    report_adapter: str | None = None,
    report_template: str | None = None,
    report_scope: str = "not-applicable",
    verdict_kind: str = "required",
    queue_class: str = "light",
) -> ProgramSpec:
    derived = (*capabilities, "report") if report_scope == "supported" else capabilities
    return ProgramSpec(
        program_id=program_id,
        display_name=display_name,
        aliases=tuple(dict.fromkeys((display_name, *aliases))),
        capabilities=frozenset(derived),
        history_visible=history_visible,
        rerun_adapter=rerun_adapter,
        input_keys=input_keys,
        statistics_group=statistics_group,
        report_adapter=report_adapter,
        report_template=report_template,
        report_scope=report_scope,
        verdict_kind=verdict_kind,
        queue_class=queue_class,
    )
```

- [ ] **Step 4: heavy 프로그램 21개에 `queue_class="heavy"` 명시** — spec §3.3 표 그대로.

`_spec` 호출부(94~307행)의 아래 program_id 21개에 `queue_class="heavy"` 인자를 추가한다. **파라메트릭 8개와 external-app 3개는 손대지 않는다**(기본값 light 유지).

| program_id | 추가 인자 | 근거(spec §3.3) |
|---|---|---|
| `truss-model-builder` | `queue_class="heavy"` | Cmb.Cli — nastran 손자 |
| `truss-assessment` | `queue_class="heavy"` | TrussAssessment.exe(내부 nastran) |
| `bdf-scanner` | `queue_class="heavy"` | BdfScanner.exe(내부 nastran 300s) |
| `hp-scr-psa` | `queue_class="heavy"` | HP-SCR PSA CLI |
| `hp-scr-por` | `queue_class="heavy"` | HP-SCR POR CLI |
| `f06-parser` | `queue_class="heavy"` | F06Parser.Console.exe |
| `mooring-fitting` | `queue_class="heavy"` | MooringFitting.exe(내부 nastran) |
| `mooring-fitting-solve` | `queue_class="heavy"` | solve-bdf — nastran 손자 |
| `hitess-modelflow` | `queue_class="heavy"` | Cmb.Cli build-full + nastran(1200s+1800s) |
| `hitess-model-builder` | `queue_class="heavy"` | Cmb.Cli 계열 |
| `model-builder-analysis` | `queue_class="heavy"` | apply-edit + nastran solve(900s) |
| `group-module-unit` | `queue_class="heavy"` | nastran validate-run(600s) |
| `side-passage` | `queue_class="heavy"` | unit_structural(nastran 1800s) |
| `hull-acceleration` | `queue_class="heavy"` | LR Rule 엔진 |
| `drawing-to-analysis` | `queue_class="heavy"` | 도면 엔진(600s) + nastran solve |
| `plate-structure` | `queue_class="heavy"` | nastran 1800s + bridge |
| `double-pipe-fuel-line` | `queue_class="heavy"` | PSA CLI |
| `simple-beam` | `queue_class="heavy"` | ⚠ JSON 입력이지만 내부에서 `analysis_runner.run_engine` = nastran 을 돌린다 |
| `module-stability` | `queue_class="heavy"` | GroupModuleAnalysis(180s) — 내부 substep |
| `module-hoist-optimize` | `queue_class="heavy"` | GroupModuleAnalysis(300s) — 내부 substep |
| `unit-structural-analysis` | `queue_class="heavy"` | 내부 substep, nastran 1800s |

예 — 첫 spec:

```python
    _spec(
        "truss-model-builder", "TrussModelBuilder", "Truss Model Builder",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="truss",
        input_keys=("node_csv", "member_csv"),
        queue_class="heavy",
    ),
```

**파라메트릭 8개**(carling-free / carling-optimization / column-buckling / mast-post / jib-rest / d-type-lug / hole-fatigue / section-property) 는 그대로 두면 기본 light 가 적용된다 — spec §2 결정 표 #2 "기본이 light 라서 미분류 프로그램·미래 스펙이 계산기 풀로 흘러도 안전(nastran 이 light 로 새면 눈에 띈다)" 원칙. 시각적 명료성을 위해 배치 대상 8개에도 `queue_class="light"` 를 **명시 표기**한다:

```python
    _spec(
        "carling-free", "Carling Free Calculator",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
        report_scope="supported",
        queue_class="light",
    ),
```

`independent-tank`·`block-weld`·`heavy-block-lifting`(external-app 프록시)는 job_manager 를 거의 안 쓰지만 기본값 `"light"` 로 두면 만약을 대비해 안전한 풀에 들어간다. 명시 표기는 하지 않는다(기본값이 정답).

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_program_registry_queue_class.py -q
```
기대: `8 passed`.

기존 program_registry 테스트도 함께:
```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_program_registry.py tests/test_program_registry_queue_class.py -q
```
기대: 전부 통과.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/services/program_registry.py`, `tests/test_program_registry_queue_class.py`.

---

## Task 3: `job_manager` — 다중 풀 리팩토링

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/job_manager.py:13`(상수), `:77-108`(`get_queue_stats`), `:169-230`(`ManagedAnalysisExecutor`), `:233-235`(싱글턴)
- Create: `HiTessWorkBenchBackEnd/tests/test_job_manager_pools.py`

> ⚠ **Plan D 접점**: `ManagedAnalysisExecutor.submit` 의 첫 위치 인자 = `job_id` 계약(Plan D §3.2)과 `attach_future(job_id, future)` 호출은 그대로 유지해야 한다. 이 Task 는 그 계약 위에 `queue_class` 를 얹는다.

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_job_manager_pools.py`:

```python
"""job_manager 풀 분리(마스터 §2.8) 회귀 테스트 — heavy/light 격리와 굶주림 방지."""
import threading
import time

import pytest

from app.services import job_manager
from app.services.job_manager import (
    HEAVY_MAX_WORKERS,
    LIGHT_MAX_WORKERS,
    MAX_CONCURRENT_JOBS,
    ManagedAnalysisExecutor,
    job_status_store,
)


def test_pool_size_constants():
    assert HEAVY_MAX_WORKERS == 3
    assert LIGHT_MAX_WORKERS == 4
    # 하위 호환 상수는 두 풀의 합.
    assert MAX_CONCURRENT_JOBS == HEAVY_MAX_WORKERS + LIGHT_MAX_WORKERS == 7


def test_submit_defaults_to_light_pool():
    """queue_class 를 안 주면 light 풀에 들어간다(spec §2 결정 #2)."""
    ex = ManagedAnalysisExecutor(heavy=1, light=1)
    try:
        gate = threading.Event()
        started = threading.Event()

        def blocker(_job_id):
            started.set()
            gate.wait(timeout=5.0)

        ex.submit(blocker, "job-l-1")
        assert started.wait(timeout=2.0)
        # heavy 풀은 비어 있어야 하고, light 풀에 1개 점유.
        stats = ex.pool_stats()
        assert stats["heavy"]["inflight"] == 0
        assert stats["light"]["inflight"] == 1
    finally:
        gate.set()
        ex.shutdown(wait=True)


def test_heavy_jobs_do_not_starve_light_jobs():
    """heavy 3개 풀을 다 채워도 light 잡은 즉시 실행돼야 한다(굶주림 방지)."""
    ex = ManagedAnalysisExecutor(heavy=2, light=2)
    try:
        heavy_started = [threading.Event() for _ in range(2)]
        light_started = threading.Event()
        gate = threading.Event()

        def heavy(_job_id, idx):
            heavy_started[idx].set()
            gate.wait(timeout=5.0)

        def light(_job_id):
            light_started.set()
            gate.wait(timeout=5.0)

        # heavy 를 상한까지 채운다.
        ex.submit(heavy, "job-h-1", 0, queue_class="heavy")
        ex.submit(heavy, "job-h-2", 1, queue_class="heavy")
        for ev in heavy_started:
            assert ev.wait(timeout=2.0)

        # 이 시점에 heavy 는 대기(대기열 진입), light 는 즉시 시작해야 한다.
        overflow = ex.submit(heavy, "job-h-3", 0, queue_class="heavy")
        ex.submit(light, "job-l-1")
        assert light_started.wait(timeout=2.0), (
            "heavy 풀이 꽉 찬 상황에서 light 가 굶었다 — 풀이 하나로 합쳐진 것"
        )
    finally:
        gate.set()
        ex.shutdown(wait=True)


def test_submit_rejects_unknown_queue_class():
    ex = ManagedAnalysisExecutor(heavy=1, light=1)
    try:
        with pytest.raises(ValueError):
            ex.submit(lambda job_id: None, "job-x", queue_class="critical")
    finally:
        ex.shutdown(wait=True)


def test_first_positional_argument_still_binds_job_id():
    """Plan D 계약: 첫 위치 인자가 str 이면 job_id 로 컨텍스트에 묶인다."""
    ex = ManagedAnalysisExecutor(heavy=1, light=1)
    captured = {}
    done = threading.Event()

    def task(job_id):
        # current_job_id() 는 Plan D 가 정의한다(이 테스트는 Plan D 이후에만 통과 가능).
        captured["job_id"] = job_id
        captured["current"] = job_manager.current_job_id()
        done.set()

    try:
        ex.submit(task, "job-ctx-1")
        assert done.wait(timeout=3.0)
        assert captured["job_id"] == "job-ctx-1"
        assert captured["current"] == "job-ctx-1"
    finally:
        ex.shutdown(wait=True)


def test_get_queue_stats_reports_pools_key():
    """get_queue_stats 는 하위 호환 키(runningJobs/queuedJobs)에 pools 를 추가한다."""
    for jid in list(job_status_store.get_all_values()):
        pass  # 테스트 초기 상태 정리는 conftest 몫

    stats = job_status_store.get_queue_stats()
    assert "runningJobs" in stats
    assert "queuedJobs" in stats
    assert set(stats["pools"].keys()) == {"heavy", "light"}
    assert set(stats["pools"]["heavy"].keys()) >= {"inflight", "capacity"}
    assert stats["pools"]["heavy"]["capacity"] == HEAVY_MAX_WORKERS
    assert stats["pools"]["light"]["capacity"] == LIGHT_MAX_WORKERS


def test_shutdown_and_start_are_idempotent_across_pools():
    ex = ManagedAnalysisExecutor(heavy=1, light=1)
    ex.shutdown(wait=True)
    ex.shutdown(wait=True)  # 이중 호출 무해
    ex.start()
    ex.start()              # 이중 호출 무해
    # 재기동 후 즉시 제출 가능해야 한다.
    done = threading.Event()
    ex.submit(lambda job_id: done.set(), "job-restart-1")
    assert done.wait(timeout=3.0)
    ex.shutdown(wait=True)
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_manager_pools.py -q
```
기대: 전부 실패 — `ImportError: HEAVY_MAX_WORKERS` / `ManagedAnalysisExecutor()` 시그니처 불일치.

- [ ] **Step 3: 풀 상수·시그니처 교체** — `app/services/job_manager.py:13`(현재 `MAX_CONCURRENT_JOBS = 5`) 를 아래로 교체:

```python
HEAVY_MAX_WORKERS = 3
LIGHT_MAX_WORKERS = 4
# 하위 호환 상수 — 기존 모니터링/알림/문서가 참조한다(spec §2 결정 #1). 계산식으로 남긴다.
MAX_CONCURRENT_JOBS = HEAVY_MAX_WORKERS + LIGHT_MAX_WORKERS

# job_manager.submit(fn, job_id, *args, queue_class="light") 의 알려진 값 집합.
KNOWN_QUEUE_CLASSES = frozenset({"heavy", "light"})
```

- [ ] **Step 4: `ManagedAnalysisExecutor` 다중 풀 리팩토링**

`ManagedAnalysisExecutor`(169~230행)를 아래로 교체. Plan D 의 `_bind_job_context`·`attach_future` 호출은 그대로 유지한다(주석으로 위치를 명시).

```python
class ManagedAnalysisExecutor:
    """queue_class 별로 격리된 ThreadPoolExecutor 를 관리한다(마스터 §2.8).

    - heavy: nastran/Cmb.Cli/PSA 계열, 상한 HEAVY_MAX_WORKERS(=3).
    - light: 계산기·external-app 프록시, 상한 LIGHT_MAX_WORKERS(=4).

    ``shutdown(wait=False, cancel_futures=False)`` 는 실행/대기 작업을 살려 둔다. 두 풀
    모두 drain 될 때까지 재시작을 거부해 이전 풀과 새 풀이 겹치는 것을 막는다(현행 단일 풀
    로직을 풀별 dict 로 복제).

    Plan D 계약(§3.2): 첫 위치 인자가 str 이면 job_id 로 간주해 ``_bind_job_context`` +
    ``job_status_store.attach_future`` 를 건다. 테스트는 그 계약이 풀 분리 후에도 유지되는지
    확인한다(``test_first_positional_argument_still_binds_job_id``).
    """

    def __init__(self, *, heavy: int, light: int):
        self._capacity = {"heavy": heavy, "light": light}
        self._lock = threading.Lock()
        self._pools: dict[str, ThreadPoolExecutor | None] = {
            "heavy": ThreadPoolExecutor(max_workers=heavy),
            "light": ThreadPoolExecutor(max_workers=light),
        }
        self._accepting = True
        self._inflight = {"heavy": 0, "light": 0}

    def _resolve_pool_key(self, queue_class: str) -> str:
        if queue_class not in KNOWN_QUEUE_CLASSES:
            raise ValueError(
                f"unknown queue_class {queue_class!r}; expected one of {sorted(KNOWN_QUEUE_CLASSES)}"
            )
        return queue_class

    def submit(self, fn, /, *args, queue_class: str = "light", **kwargs):
        pool_key = self._resolve_pool_key(queue_class)
        # Plan D §3.2: 첫 위치 인자가 str 이면 job_id, 그 외엔 None.
        job_id = args[0] if args and isinstance(args[0], str) else None

        with self._lock:
            executor = self._pools.get(pool_key)
            if executor is None or not self._accepting:
                raise RuntimeError("analysis executor has been shut down")
            self._inflight[pool_key] += 1
            try:
                # _bind_job_context 는 Plan D 가 도입한 헬퍼(functools.wraps + ContextVar).
                bound = _bind_job_context(fn, job_id) if job_id is not None else fn
                future = executor.submit(bound, *args, **kwargs)
            except BaseException:
                self._inflight[pool_key] -= 1
                raise
        future.add_done_callback(lambda f, key=pool_key: self._future_done(key, f))
        if job_id is not None:
            # Plan D 계약 — cancel() 이 대기 중 future 를 찾을 수 있게 한다.
            job_status_store.attach_future(job_id, future)
        return future

    def _future_done(self, pool_key: str, _future) -> None:
        with self._lock:
            self._inflight[pool_key] -= 1
            if all(v == 0 for v in self._inflight.values()) and not self._accepting:
                # 두 풀이 모두 drain 된 뒤에만 재시작을 허용.
                for k in list(self._pools):
                    self._pools[k] = None

    def shutdown(self, *, wait: bool = False, cancel_futures: bool = False) -> None:
        with self._lock:
            executors = [ex for ex in self._pools.values() if ex is not None]
            if not executors or not self._accepting:
                return
            self._accepting = False
            if all(v == 0 for v in self._inflight.values()):
                for k in list(self._pools):
                    self._pools[k] = None
        for ex in executors:
            ex.shutdown(wait=wait, cancel_futures=cancel_futures)

    def start(self) -> None:
        with self._lock:
            if self._accepting:
                return
            if any(v > 0 for v in self._inflight.values()):
                raise RuntimeError(
                    "analysis executor is still draining previously submitted jobs"
                )
            for key, cap in self._capacity.items():
                self._pools[key] = ThreadPoolExecutor(max_workers=cap)
            self._accepting = True

    def pool_stats(self) -> dict:
        """풀별 실행 중 개수와 상한. 테스트·모니터링용."""
        with self._lock:
            return {
                key: {"inflight": self._inflight[key], "capacity": self._capacity[key]}
                for key in ("heavy", "light")
            }
```

- [ ] **Step 5: `get_queue_stats` 확장** — `JobStatusStore.get_queue_stats`(77~108행)에 `pools` 키를 추가한다.

기존 반환 dict 마지막에 아래를 붙인다(다른 로직은 그대로):

```python
            # Plan H — 풀별 통계를 프론트 시스템 모니터/관리자 대시보드에 전달.
            try:
                pool_stats = analysis_executor.pool_stats()
            except Exception:
                pool_stats = {
                    "heavy": {"inflight": 0, "capacity": HEAVY_MAX_WORKERS},
                    "light": {"inflight": 0, "capacity": LIGHT_MAX_WORKERS},
                }
            stats["pools"] = pool_stats
            return stats
```

⚠ `analysis_executor` 참조가 모듈 전방참조라 `NameError` 가 나지 않도록 `get_queue_stats` 안에서 한 번 더 `from . import job_manager` 하지 않아도 된다 — `analysis_executor` 는 같은 모듈 하단에 이미 정의돼 있다. 다만 **테스트가 `ManagedAnalysisExecutor` 를 새로 만들 때**(모듈 싱글턴이 아니라 별도 인스턴스)는 해당 `pool_stats()` 만 검사하고, `job_status_store.get_queue_stats()` 는 모듈 싱글턴을 본다.

- [ ] **Step 6: 싱글턴 재구성** — `analysis_executor = ManagedAnalysisExecutor(MAX_CONCURRENT_JOBS)`(235행)을 아래로 교체:

```python
# 모듈 수준 싱글턴 인스턴스
job_status_store = JobStatusStore()
analysis_executor = ManagedAnalysisExecutor(heavy=HEAVY_MAX_WORKERS, light=LIGHT_MAX_WORKERS)
```

`shutdown_job_manager` / `start_job_manager` 모듈 함수(241~264행)는 인자 없이 그대로 동작한다(내부적으로 `analysis_executor.shutdown()` 을 호출).

- [ ] **Step 7: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_manager_pools.py tests/test_job_manager_notify.py tests/test_job_submission_lifecycle.py tests/test_queue_visibility.py tests/test_system_jobs.py -q
```
기대: 전부 통과. `test_first_positional_argument_still_binds_job_id` 가 통과하려면 **Plan D 의 `_bind_job_context`·`current_job_id()`·`attach_future` 가 이미 병합돼 있어야 한다** — 이 전제가 이 plan 의 하드 의존이다.

- [ ] **Step 8: 커밋 준비 완료** — 보고: `app/services/job_manager.py`, `tests/test_job_manager_pools.py`.

---

## Task 4: `_intake.submit_analysis_job` — `queue_class` 라우팅 + `batch_id` 인자

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/routers/_intake.py:26`(import), `:122-189`(`submit_analysis_job` + `_record_pending_analysis`)

기존 `submit_analysis_job` 은 `analysis_executor.submit(task_fn, job_id, *task_args)` 를 그대로 부른다(171행). 여기에 (1) `program_name` → `program_registry.resolve_program(...).queue_class` 조회, (2) 배치 서비스가 넘긴 `batch_id` 를 `Analysis` 레코드에 함께 저장하는 두 가지만 얹는다.

- [ ] **Step 1: 실패 테스트 확장** — 별도 파일을 만들지 않고 `test_job_submission_lifecycle.py` 계약 테스트가 `queue_class` 라우팅을 보증하도록 `test_batch_run_service.py`(Task 5) 안에서 검증한다. 이 Task 는 코드 수정만 담긴다(계약이 지켜지는지는 Task 5 통합 테스트에서 함께 드러난다).

- [ ] **Step 2: 라우팅 구현** — `_intake.py:26` 의 import 와 `submit_analysis_job` 본문을 아래로 교체:

```python
from ..services.job_manager import JobMetadata, analysis_executor, job_status_store
from ..services.program_registry import resolve_program
from ..services.workspace import create_analysis_workspace
```

`submit_analysis_job` 시그니처에 `batch_id: int | None = None` 를 추가:

```python
def submit_analysis_job(
    task_fn,
    *task_args,
    queue_message: str = "Waiting in Queue...",
    metadata: JobMetadata | None = None,
    owned_work_dir: str | None = None,
    batch_id: int | None = None,
) -> str:
    """
    job_id를 발급하고 Pending 상태로 등록한 뒤 analysis_executor에 작업을 제출합니다.

    Plan H 추가:
      - metadata.program_name 을 program_registry 로 해석해 queue_class 를 정한다.
        resolve_program 이 None(미등록 프로그램)이면 기본값 'light' 로 흐른다 —
        미분류가 heavy 로 새어 계산기 풀을 굶히지 않게 하기 위함이다(spec §2 결정 #2).
      - batch_id 가 주어지면 Pending Analysis 레코드에 함께 기록한다. 이후 _write_through
        가 종료 상태 반영 시 batch_run_service.mark_case_terminal 을 호출한다.
    """
    job_id = str(uuid.uuid4())
    if metadata is None:
        employee_id, program_name = _infer_job_metadata(task_fn, task_args)
        metadata = JobMetadata(employee_id=employee_id, program_name=program_name)
    else:
        employee_id = metadata.employee_id
        program_name = metadata.program_name

    pending_persisted = _record_pending_analysis(
        job_id, employee_id, program_name, queue_message, batch_id=batch_id,
    )
    if _require_pending_persistence() and not pending_persisted:
        _cleanup_owned_workspace(owned_work_dir, employee_id)
        raise HTTPException(
            status_code=503,
            detail="작업 접수 상태를 데이터베이스에 저장하지 못했습니다. 잠시 후 다시 시도하세요.",
        )
    job_status_store.set(job_id, {
        "status": "Pending",
        "progress": 0,
        "message": queue_message,
        "employee_id": employee_id,
        "_metadata": metadata,
    })

    spec = resolve_program(program_name)
    queue_class = spec.queue_class if spec is not None else "light"

    try:
        future = analysis_executor.submit(
            task_fn, job_id, *task_args, queue_class=queue_class,
        )
    except Exception as exc:
        logger.exception("작업 %s executor 제출 실패", job_id)
        job_status_store.update_job(job_id, {
            "status": "Failed",
            "progress": 100,
            "message": "작업 실행 대기열에 제출하지 못했습니다.",
        })
        _cleanup_owned_workspace(owned_work_dir, employee_id)
        raise HTTPException(
            status_code=503,
            detail="작업 실행 대기열에 제출하지 못했습니다. 잠시 후 다시 시도하세요.",
        ) from exc
    if future is not None and hasattr(future, "add_done_callback"):
        future.add_done_callback(lambda f, jid=job_id: _handle_future_result(jid, f))
    return job_id
```

- [ ] **Step 3: `_record_pending_analysis` 확장** — 동일 파일의 헬퍼 함수(파일 하단, `_infer_job_metadata` 근처)에 `batch_id: int | None = None` 인자를 추가하고 `Analysis(...)` 생성 시 함께 저장한다. 다른 호출부는 인자를 안 넘겨도 그대로(기본값 None) 동작한다.

```python
def _record_pending_analysis(
    job_id: str, employee_id: str | None, program_name: str, queue_message: str,
    *, batch_id: int | None = None,
) -> bool:
    """... (기존 doc string 유지) ...

    batch_id 는 Plan H 배치 서비스가 케이스별로 넘긴다. 단건 실행에서는 None.
    """
    if not employee_id:
        return False
    db = database.SessionLocal()
    try:
        record = models.Analysis(
            job_id=job_id,
            employee_id=employee_id,
            program_name=program_name,
            status="Running",
            job_status="Pending",
            progress=0,
            job_message=queue_message,
            batch_id=batch_id,   # NULL for 단건, int for 배치 케이스
            created_at=datetime.now(),
        )
        db.add(record)
        db.commit()
        return True
    except Exception:
        db.rollback()
        logger.warning("Pending Analysis 레코드 생성 실패: %s", job_id)
        return False
    finally:
        db.close()
```

⚠ 실제 `_record_pending_analysis` 는 파일 내 다른 필드(project_name·source 등)를 함께 채운다. 위 조각은 **`batch_id=batch_id` 인자 1줄만** 추가하는 것이 목적이다. 기존 컬럼 매핑은 손대지 말고, 원본을 그대로 두면서 `batch_id=batch_id` 만 끼워 넣는다(추가 fix 는 Task 5 통합 테스트에서 드러나면 그때 조정).

- [ ] **Step 4: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_submission_lifecycle.py tests/test_queue_visibility.py -q
```
기대: 전부 통과(기본값 인자만 늘렸으므로 기존 호출부에 회귀 없음).

- [ ] **Step 5: 커밋 준비 완료** — 보고: `app/routers/_intake.py`.

---

## Task 5: `batch_run_service` — `create_batch`/`mark_case_terminal`/`get_progress`/`cancel_batch`

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/batch_run_service.py`
- Create: `HiTessWorkBenchBackEnd/tests/test_batch_run_service.py`

> ⚠ **Plan D 접점**: `cancel_batch` 는 `job_status_store.cancel(job_id)` 를 케이스별로 순회한다(HTTP 재진입 금지). `cancel()` 의 반환 규약(Plan D §3.1) 을 그대로 신뢰한다.

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_batch_run_service.py`:

```python
"""배치 실행 서비스 계약(마스터 §2.8·Plan H spec §4.2) 테스트."""
from datetime import datetime
from unittest.mock import patch

import pytest

from app import database, models
from app.services import batch_run_service, job_manager
from app.services.batch_run_service import (
    BatchCase,
    cancel_batch,
    create_batch,
    get_progress,
    mark_case_terminal,
    promote_batch,
    resolve_batch_status,
)


# --- resolve_batch_status 결정표 (마스터 §2 결정 #9) --------------------------

@pytest.mark.parametrize("total,success,failed,cancelled,expected", [
    (5, 5, 0, 0, "Completed"),   # 전원 성공
    (5, 4, 1, 0, "Completed"),   # 부분 실패도 성공 계열(§2-9)
    (5, 4, 0, 1, "Completed"),   # 부분 취소도 성공 계열
    (5, 3, 1, 1, "Completed"),   # 성공 하나만 있어도 Completed
    (5, 0, 5, 0, "Failed"),      # 전원 실패
    (5, 0, 0, 5, "Cancelled"),   # 전원 취소
    (5, 0, 3, 2, "Failed"),      # 실패+취소 = success 0 → Failed
    (5, 3, 0, 0, "Running"),     # 진행 중(마감 3/5)
    (5, 0, 0, 0, "Running"),     # 초기
])
def test_resolve_batch_status_table(total, success, failed, cancelled, expected):
    assert resolve_batch_status(
        total=total, success=success, failed=failed, cancelled=cancelled,
    ) == expected


# --- create_batch ------------------------------------------------------------

def _stub_submit(job_ids):
    """submit_analysis_job 을 지정된 job_id 리스트로 대체한다."""
    iterator = iter(job_ids)

    def _stub(*args, **kwargs):
        return next(iterator)
    return _stub


def test_create_batch_persists_batchrun_and_populates_case_analyses(
    db_session, monkeypatch,
):
    """케이스 3개 배치 → BatchRun 1건 + Analysis 3건(batch_id 채워짐)."""
    submitted = []

    def fake_submit(task_fn, *task_args, metadata=None, batch_id=None, **_kwargs):
        # _record_pending_analysis 는 진짜 호출한다(같은 세션에서).
        job_id = f"job-{len(submitted)+1}"
        db_session.add(models.Analysis(
            job_id=job_id,
            employee_id=metadata.employee_id,
            program_name=metadata.program_name,
            status="Running", job_status="Pending", progress=0,
            batch_id=batch_id,
            created_at=datetime.now(),
        ))
        db_session.commit()
        submitted.append((task_fn.__name__, task_args, batch_id))
        return job_id

    monkeypatch.setattr(batch_run_service, "_submit_analysis_job", fake_submit)

    batch = create_batch(
        db_session,
        owner="EMP001",
        program_id="mast-post",
        name="H600 후보 스캔",
        cases=[
            BatchCase(label="Post 600×20", input_info={"height_mm": 600, "weight_kg": 200}),
            BatchCase(label="Post 700×20", input_info={"height_mm": 700, "weight_kg": 200}),
            BatchCase(label="Post 800×20", input_info={"height_mm": 800, "weight_kg": 200}),
        ],
    )

    assert batch.id is not None
    assert batch.employee_id == "EMP001"
    assert batch.program_id == "mast-post"
    assert batch.status == "Running"
    assert batch.total == 3
    assert batch.done == 0 and batch.failed == 0

    cases = db_session.query(models.Analysis).filter(
        models.Analysis.batch_id == batch.id
    ).all()
    assert len(cases) == 3
    for c in cases:
        assert c.employee_id == "EMP001"
        assert c.program_name == "Mast Post Assessment"


def test_create_batch_rejects_program_without_input_keys(db_session):
    """capabilities 에 calculator 가 없거나 input_keys 가 파일 계열이면 400."""
    with pytest.raises(ValueError):
        create_batch(
            db_session, owner="EMP001", program_id="truss-assessment",
            name="x", cases=[BatchCase(label="a", input_info={"bdf_model": "..."})],
        )


def test_create_batch_rejects_unknown_program(db_session):
    with pytest.raises(ValueError):
        create_batch(
            db_session, owner="EMP001", program_id="does-not-exist",
            name="x", cases=[BatchCase(label="a", input_info={})],
        )


def test_create_batch_rejects_empty_case_list(db_session):
    with pytest.raises(ValueError):
        create_batch(
            db_session, owner="EMP001", program_id="mast-post",
            name="빈 배치", cases=[],
        )


def test_create_batch_case_failure_does_not_abort_batch(db_session, monkeypatch):
    """케이스마다 submit 실패는 그 케이스만 Failed 처리하고 다음 케이스로 진행(§4.2-4)."""
    calls = {"i": 0}

    def flaky_submit(task_fn, *task_args, metadata=None, batch_id=None, **_kwargs):
        calls["i"] += 1
        if calls["i"] == 2:
            raise RuntimeError("executor busy")
        job_id = f"job-{calls['i']}"
        db_session.add(models.Analysis(
            job_id=job_id, employee_id=metadata.employee_id,
            program_name=metadata.program_name,
            status="Running", job_status="Pending", progress=0,
            batch_id=batch_id, created_at=datetime.now(),
        ))
        db_session.commit()
        return job_id

    monkeypatch.setattr(batch_run_service, "_submit_analysis_job", flaky_submit)

    batch = create_batch(
        db_session, owner="EMP001", program_id="mast-post", name="플레이키",
        cases=[BatchCase(label=str(i), input_info={"height_mm": 100 * i, "weight_kg": 200})
               for i in range(1, 4)],
    )
    assert batch.total == 3
    assert batch.failed == 1  # 2번째 케이스 즉시 실패
    assert batch.done == 0    # 아직 Success 는 없음
    assert batch.status == "Running"


# --- mark_case_terminal ------------------------------------------------------

def test_mark_case_terminal_increments_counters_and_finalizes(db_session):
    batch = models.BatchRun(
        employee_id="EMP001", program_id="mast-post", name="x", total=3,
    )
    db_session.add(batch)
    db_session.commit()

    mark_case_terminal(db_session, batch_id=batch.id, case_status="Success")
    mark_case_terminal(db_session, batch_id=batch.id, case_status="Failed")
    db_session.refresh(batch)
    assert batch.status == "Running"
    assert batch.done == 1 and batch.failed == 1

    mark_case_terminal(db_session, batch_id=batch.id, case_status="Success")
    db_session.refresh(batch)
    assert batch.status == "Completed"     # 성공 2·실패 1 → Completed(§2-9)
    assert batch.done == 2 and batch.failed == 1
    assert batch.updated_at is not None


def test_mark_case_terminal_all_cancelled_gives_cancelled(db_session):
    batch = models.BatchRun(
        employee_id="EMP001", program_id="mast-post", name="x", total=2,
    )
    db_session.add(batch)
    db_session.commit()
    mark_case_terminal(db_session, batch_id=batch.id, case_status="Cancelled")
    mark_case_terminal(db_session, batch_id=batch.id, case_status="Cancelled")
    db_session.refresh(batch)
    assert batch.status == "Cancelled"
    assert batch.failed == 2


def test_mark_case_terminal_missing_batch_is_silent(db_session):
    """이미 지워진 배치 id 로 훅이 들어와도 예외를 던지지 않는다."""
    assert mark_case_terminal(
        db_session, batch_id=999999, case_status="Success",
    ) is None


def test_mark_case_terminal_ignores_non_terminal(db_session):
    """Running 상태로는 카운터를 올리지 않는다."""
    batch = models.BatchRun(
        employee_id="EMP001", program_id="mast-post", name="x", total=1,
    )
    db_session.add(batch)
    db_session.commit()
    mark_case_terminal(db_session, batch_id=batch.id, case_status="Running")
    db_session.refresh(batch)
    assert batch.done == 0 and batch.failed == 0
    assert batch.status == "Running"


# --- get_progress ------------------------------------------------------------

def test_get_progress_returns_cases_and_summary(db_session, make_analysis):
    batch = models.BatchRun(
        employee_id="EMP001", program_id="mast-post", name="x", total=2,
        done=1, failed=0,
    )
    db_session.add(batch)
    db_session.commit()

    a = make_analysis("EMP001", "Mast Post Assessment", datetime(2026, 9, 18, 9, 0, 0),
                      status="Success")
    a.batch_id = batch.id
    a.job_id = "job-1"
    db_session.commit()

    data = get_progress(db_session, batch.id)
    assert data["total"] == 2
    assert data["done"] == 1
    assert data["failed"] == 0
    assert data["remaining"] == 1
    assert data["status"] == "Running"
    assert len(data["cases"]) == 1
    case = data["cases"][0]
    assert case["analysis_id"] == a.id
    assert case["job_id"] == "job-1"
    assert case["status"] == "Success"


# --- cancel_batch (Plan D API 직접 호출) -------------------------------------

def test_cancel_batch_dispatches_to_job_store(db_session, monkeypatch):
    batch = models.BatchRun(
        employee_id="EMP001", program_id="mast-post", name="x", total=3,
    )
    db_session.add(batch)
    db_session.commit()
    for jid in ("job-1", "job-2", "job-3"):
        db_session.add(models.Analysis(
            job_id=jid, employee_id="EMP001",
            program_name="Mast Post Assessment",
            status="Running", job_status="Pending",
            batch_id=batch.id, created_at=datetime.now(),
        ))
    db_session.commit()

    calls = []

    def fake_cancel(job_id, *, grace_seconds=5.0):
        calls.append(job_id)
        # job-3 은 이미 종료된 상황을 가장(§3.1 반환표 '이미 terminal').
        return False if job_id == "job-3" else True

    monkeypatch.setattr(job_manager.job_status_store, "cancel", fake_cancel)

    result = cancel_batch(db_session, batch_id=batch.id, requester="EMP001")
    assert sorted(calls) == ["job-1", "job-2", "job-3"]
    assert result["cancelled_cases"] == 2
    assert result["already_terminal"] == 1
    assert result["batch_id"] == batch.id


def test_promote_batch_admin_only(db_session):
    batch = models.BatchRun(
        employee_id="EMP001", program_id="mast-post", name="x", total=2,
    )
    db_session.add(batch)
    db_session.commit()
    # promote 는 아직 실행 안 한(Pending) 케이스만 이동.
    for i, status in enumerate(["Pending", "Running", "Success"], start=1):
        db_session.add(models.Analysis(
            job_id=f"job-{i}", employee_id="EMP001",
            program_name="Mast Post Assessment",
            status="Running" if status != "Success" else "Success",
            job_status=status,
            batch_id=batch.id, created_at=datetime.now(),
        ))
    db_session.commit()

    with patch.object(job_manager.job_status_store, "reassign_queue_class",
                      create=True, return_value=True) as m:
        result = promote_batch(db_session, batch_id=batch.id, queue_class="heavy")
    assert result["promoted"] == 1  # Pending 1건만 이동
```

⚠ `promote_batch` 는 spec §6 표의 관리자 액션이지만, `job_manager.job_status_store.reassign_queue_class` 는 Plan D 계약에 명시되지 않은 부속 기능이다. `create=True` 로 monkeypatch 하는 이유는 이 함수가 **Plan H 가 job_manager 에 조용히 추가하는 옵션 훅**이기 때문이다. Task 3 의 job_manager 변경 위에서 이 훅을 **재제출 가능한 경우에만** 붙인다(대기 중 Future 를 새 풀에 다시 submit; Running 은 무시). 상세는 Task 5 Step 3 에서.

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_batch_run_service.py -q
```
기대: `ModuleNotFoundError: No module named 'app.services.batch_run_service'` 로 수집 단계 실패.

- [ ] **Step 3: 서비스 구현** — `HiTessWorkBenchBackEnd/app/services/batch_run_service.py`:

```python
"""파라메트릭 배치 실행 서비스(마스터 §2.8) — 케이스 표를 받아 개별 Analysis 로 펼치고,
케이스가 terminal 로 갈 때마다 집계·최종 상태 판정·완료 알림을 처리한다.

Plan D 하드 의존:
    job_status_store.cancel(job_id)                # 개별 케이스 취소
    job_status_store.is_cancel_requested(job_id)   # (부수 확인)
Plan A 는 선택적 의존(지연 import): 알림 서비스가 없으면 조용히 건너뛴다(마스터 §2.1).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable

from sqlalchemy.orm import Session

from .. import models
from .job_manager import JobMetadata, job_status_store
from .program_registry import get_program

logger = logging.getLogger(__name__)

MAX_CASES_PER_BATCH = 50


# 이 함수 참조를 모듈 속성으로 노출해 테스트가 monkeypatch 하기 쉽게 한다.
# 실제 프로덕션에서는 아래 실제 구현이 쓰인다.
def _submit_analysis_job(
    task_fn, *task_args, metadata: JobMetadata, batch_id: int | None = None,
    queue_message: str = "Waiting in Queue...",
) -> str:
    """_intake.submit_analysis_job 을 내부에서 부른다(HTTP 재진입 없음)."""
    from ..routers._intake import submit_analysis_job
    return submit_analysis_job(
        task_fn, *task_args,
        queue_message=queue_message,
        metadata=metadata,
        batch_id=batch_id,
    )


# 파라메트릭 어댑터 — 프로그램별 CLI 태스크를 찾는다. rerun_adapter 와 같은 규약이라
# 새 프로그램을 추가할 때는 program_registry 의 rerun_adapter 만 지정하면 된다.
def _resolve_batch_task(program_id: str):
    """program_id 에 맞는 (task_fn, arg_builder) 를 돌려준다.

    task_fn 은 analysis_executor 에 제출할 콜러블, arg_builder 는 (owner, input_info) →
    tuple[task_args] 다. 이번 범위는 파라메트릭 8개(calculator + input_json) 뿐이라
    함수 하나로 처리한다: 각 앱의 rerun 어댑터가 이미 input_json 을 받는다.
    """
    # 파라메트릭 앱은 rerun 흐름이 이미 존재하고, 태스크 이름은 각 라우터가 공개한다.
    # 여기서는 `carling_service`·`davit_service`·... 를 지연 import 로 나열한다.
    from .rerun_adapters import get_rerun_adapter  # 기존 어댑터 레지스트리 재사용
    adapter = get_rerun_adapter(program_id)
    if adapter is None:
        raise ValueError(f"batch 미지원 프로그램: {program_id}")
    return adapter.task_fn, adapter.build_task_args


@dataclass(frozen=True)
class BatchCase:
    label: str
    input_info: dict


def resolve_batch_status(*, total: int, success: int, failed: int, cancelled: int) -> str:
    """spec §4.3 순수함수. 스키마를 늘리지 않기 위해 카운터는 batch 내부 집계로만 쓴다."""
    if success + failed + cancelled < total:
        return "Running"
    if cancelled == total:
        return "Cancelled"
    if success == 0:
        return "Failed"
    return "Completed"


def _validate_batch_target(program_id: str) -> None:
    spec = get_program(program_id)
    if spec is None:
        raise ValueError(f"미등록 프로그램: {program_id}")
    if "calculator" not in spec.capabilities:
        raise ValueError(
            f"{program_id} 는 배치 대상이 아니다(계산기 앱만 지원, 이번 범위)."
        )
    if spec.input_keys != ("input_json",):
        raise ValueError(
            f"{program_id} 는 input_json 스키마가 아니라 배치를 지원하지 않는다(파일 입력 배치는 범위 밖)."
        )
    if spec.queue_class != "light":
        raise ValueError(
            f"{program_id} 는 light 큐가 아니라 배치 대상이 아니다."
        )


def create_batch(
    db: Session,
    *,
    owner: str,
    program_id: str,
    name: str,
    cases: list[BatchCase],
) -> models.BatchRun:
    """배치 요약을 먼저 만들고, 케이스마다 _intake.submit_analysis_job 을 직접 호출한다.

    한 케이스의 제출이 실패해도 그 케이스만 `failed += 1` 로 기록하고 다음 케이스로 진행한다
    (spec §4.2-4). 케이스 상한은 라우터에서 확인한다 — 여기서는 방어적으로 한 번 더.
    """
    if not cases:
        raise ValueError("빈 배치는 만들 수 없습니다.")
    if len(cases) > MAX_CASES_PER_BATCH:
        raise ValueError(f"배치 케이스는 최대 {MAX_CASES_PER_BATCH} 건입니다.")
    _validate_batch_target(program_id)

    spec = get_program(program_id)
    display_name = spec.display_name

    batch = models.BatchRun(
        employee_id=owner,
        program_id=program_id,
        name=(name or "").strip()[:200],
        status="Running",
        total=len(cases),
        done=0,
        failed=0,
        created_at=datetime.now(),
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)

    task_fn, build_task_args = _resolve_batch_task(program_id)
    for case in cases:
        case_label = (case.label or "").strip() or f"case-{cases.index(case)+1}"
        project_name = f"{batch.name} · {case_label}" if batch.name else case_label
        metadata = JobMetadata(employee_id=owner, program_name=display_name)
        try:
            task_args = build_task_args(owner, case.input_info)
            _submit_analysis_job(
                task_fn, *task_args, metadata=metadata, batch_id=batch.id,
                queue_message=f"배치 대기 중… ({case_label})",
            )
        except Exception as exc:
            logger.warning(
                "배치 %s 케이스 %s 제출 실패: %s", batch.id, case_label, exc,
            )
            batch.failed += 1
    db.commit()
    db.refresh(batch)
    return batch


def mark_case_terminal(
    db: Session, *, batch_id: int, case_status: str,
) -> models.BatchRun | None:
    """케이스가 Success/Failed/Cancelled 로 마감될 때 호출된다.

    job_manager._write_through 가 DB 반영 직후 부른다(Task 6 훅). 여기서 카운터를 원자
    UPDATE 하고, 두 카운터의 합이 total 에 도달하면 §4.3 규칙으로 status 를 확정한다.
    최종 상태로 전이하는 순간에만 batch.completed 알림을 발신한다.
    """
    if case_status not in ("Success", "Failed", "Cancelled"):
        return None
    batch = db.query(models.BatchRun).filter(models.BatchRun.id == batch_id).first()
    if batch is None:
        return None

    if case_status == "Success":
        batch.done += 1
    else:
        # Failed·Cancelled 는 사용자 관점 '결과 없음' 이라 같은 카운터에 합산.
        batch.failed += 1
    batch.updated_at = datetime.now()

    # 이 케이스가 마지막 케이스라면 최종 상태를 찍는다. status 별 카운트는 위 훅에 남지
    # 않기 때문에 batch 소속 Analysis 를 다시 훑어야 한다(스키마를 늘리지 않는다는 §4.3 선택).
    finished = batch.done + batch.failed
    if finished >= batch.total and batch.status == "Running":
        success = db.query(models.Analysis).filter(
            models.Analysis.batch_id == batch.id,
            models.Analysis.status == "Success",
        ).count()
        cancelled = db.query(models.Analysis).filter(
            models.Analysis.batch_id == batch.id,
            models.Analysis.status == "Cancelled",
        ).count()
        failed = db.query(models.Analysis).filter(
            models.Analysis.batch_id == batch.id,
            models.Analysis.status == "Failed",
        ).count()
        batch.status = resolve_batch_status(
            total=batch.total, success=success, failed=failed, cancelled=cancelled,
        )
        db.commit()
        _emit_batch_completed(db, batch, success=success, failed=failed, cancelled=cancelled)
    else:
        db.commit()
    return batch


def _emit_batch_completed(
    db: Session, batch: models.BatchRun,
    *, success: int, failed: int, cancelled: int,
) -> None:
    """배치가 terminal 로 갈 때만 발신되는 알림 1건(§5.2)."""
    try:
        from .notification_service import notify
    except ImportError:
        return
    if notify is None:
        return
    spec = get_program(batch.program_id)
    display_name = spec.display_name if spec else batch.program_id
    if batch.status == "Completed":
        title = f"{display_name} 배치 완료"
    elif batch.status == "Failed":
        title = f"{display_name} 배치 실패"
    else:
        title = f"{display_name} 배치 중단"
    body = f"{success}/{batch.total} 성공"
    if failed:
        body += f", {failed} 실패"
    if cancelled:
        body += f", {cancelled} 중단"
    try:
        notify(
            db,
            employee_id=batch.employee_id,
            kind="batch.completed",
            title=title,
            body=body,
            link={"menu": "My Projects", "params": {"batch_id": batch.id}},
            dedupe_key=f"batch:{batch.id}",
            dedupe_unread_only=False,
        )
    except Exception:
        logger.warning("배치 %s 완료 알림 생성 실패", batch.id, exc_info=True)


def get_progress(db: Session, batch_id: int) -> dict:
    """진행률·케이스 리스트. 프론트 폴링(2s) 이 이걸 그대로 렌더한다."""
    batch = db.query(models.BatchRun).filter(models.BatchRun.id == batch_id).first()
    if batch is None:
        return {}
    cases_query = db.query(models.Analysis).filter(
        models.Analysis.batch_id == batch.id
    ).order_by(models.Analysis.id.asc())
    cases = [
        {
            "analysis_id": c.id,
            "job_id": c.job_id,
            "label": (c.project_name or "").rsplit("·", 1)[-1].strip(),
            "status": c.status,
            "progress": c.progress or 0,
            "job_message": c.job_message,
        }
        for c in cases_query
    ]
    return {
        "batch_id": batch.id,
        "name": batch.name,
        "program_id": batch.program_id,
        "status": batch.status,
        "total": batch.total,
        "done": batch.done,
        "failed": batch.failed,
        "remaining": max(0, batch.total - batch.done - batch.failed),
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
        "updated_at": batch.updated_at.isoformat() if batch.updated_at else None,
        "cases": cases,
    }


def cancel_batch(
    db: Session, *, batch_id: int, requester: str,
) -> dict:
    """배치 소속 케이스를 순회하며 Plan D `job_status_store.cancel(job_id)` 호출."""
    batch = db.query(models.BatchRun).filter(models.BatchRun.id == batch_id).first()
    if batch is None:
        raise ValueError("배치를 찾을 수 없습니다.")
    cases = db.query(models.Analysis).filter(
        models.Analysis.batch_id == batch.id
    ).all()

    cancelled_cases = 0
    already_terminal = 0
    for case in cases:
        if not case.job_id:
            continue
        if job_status_store.cancel(case.job_id):
            cancelled_cases += 1
        else:
            already_terminal += 1

    db.refresh(batch)
    return {
        "batch_id": batch.id,
        "status": batch.status,
        "cancelled_cases": cancelled_cases,
        "already_terminal": already_terminal,
    }


def promote_batch(
    db: Session, *, batch_id: int, queue_class: str,
) -> dict:
    """관리자 액션(§2-11) — 아직 실행 안 한 케이스를 다른 풀로 옮긴다.

    이미 실행 중(Running)이거나 마감된(Success/Failed/Cancelled) 케이스는 무시한다.
    job_manager 에 `reassign_queue_class(job_id, queue_class)` 훅이 있으면 부른다;
    없으면 실패 카운터로 남기지 않고 조용히 skip 한다(구 배포 호환).
    """
    if queue_class not in {"heavy", "light"}:
        raise ValueError(f"unknown queue_class: {queue_class}")
    batch = db.query(models.BatchRun).filter(models.BatchRun.id == batch_id).first()
    if batch is None:
        raise ValueError("배치를 찾을 수 없습니다.")
    pendings = db.query(models.Analysis).filter(
        models.Analysis.batch_id == batch.id,
        models.Analysis.job_status == "Pending",
    ).all()
    promoted = 0
    for case in pendings:
        reassign = getattr(job_status_store, "reassign_queue_class", None)
        if reassign is None:
            continue
        try:
            if reassign(case.job_id, queue_class=queue_class):
                promoted += 1
        except Exception:
            logger.warning("배치 %s 케이스 %s promote 실패", batch.id, case.job_id, exc_info=True)
    return {"promoted": promoted, "queue_class": queue_class}
```

⚠ **`_resolve_batch_task` 의 `rerun_adapters` 는 이미 존재하는 프로덕션 모듈이 아니다** — 이 plan 이 기존 어댑터(각 파라메트릭 라우터에 흩어져 있는 `task_execute_…` 함수)를 한 곳에 모으는 사전 정리 없이 그대로 쓰기는 어렵다. Task 5 Step 4 에서 최소 변경으로 그 다리를 놓는다.

- [ ] **Step 4: `rerun_adapters` 얇은 다리 추가** — Plan H spec §7.1 이 언급하는 "각 페이지의 단건 폼 로직·검증은 그대로 유지". 파라메트릭 8개는 이미 `/api/davit/mast-post` 같은 **동기 계산 라우터**를 갖고 있어 job_manager 를 거치지 않는다.

이번 배치는 **각 라우터의 계산 함수를 얇게 감싸 job_manager 위에 얹는다**. 정공법은 라우터 함수를 서비스로 리팩토링하는 것이지만 범위가 커지므로, `services/rerun_adapters/__init__.py` 에 최소 어댑터 8개를 만든다(모듈 파일은 이 Task 안에 함께 넣지 않고 별도 Task 로 분리하는 것도 가능하지만, 배치 서비스 계약을 완결시키기 위해 여기서 간단히 정의):

```python
# app/services/rerun_adapters/__init__.py
"""파라메트릭 앱 배치용 얇은 어댑터. 각 어댑터는 (task_fn, build_task_args) 만 제공한다.

배치 대상 8개(carling-free/carling-optimization/column-buckling/mast-post/jib-rest/
d-type-lug/hole-fatigue/section-property)만 등록한다. 라우터의 동기 계산 로직을 그대로
호출해 결과 dict 를 반환하는 태스크 함수를 만든다.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class RerunAdapter:
    task_fn: Callable
    build_task_args: Callable  # (owner, input_info) -> tuple


_REGISTRY: dict[str, RerunAdapter] = {}


def register(program_id: str, adapter: RerunAdapter) -> None:
    _REGISTRY[program_id] = adapter


def get_rerun_adapter(program_id: str) -> RerunAdapter | None:
    return _REGISTRY.get(program_id)


# 이 아래에서 실제 등록은 `app.services.rerun_adapters.calculators` 가 담당한다.
# 배치 서비스 import 시 순환 참조를 피하기 위해 지연 import 로 처리.
def _load_calculator_adapters() -> None:
    from . import calculators  # noqa: F401
_load_calculator_adapters()
```

⚠ 실제 8개 어댑터 몸통(`calculators.py`)은 각 파라메트릭 라우터의 계산 함수를 감싸 job_manager 태스크로 만드는 얇은 코드다. Task 5 최소 목표는 **`mast-post` 어댑터 하나**로 배치 서비스가 통과하는 것이고, 나머지 7개는 Task 10 파일럿 검증 후에 같은 패턴으로 확장한다. 이 plan 에서 8개를 한 번에 열지 말고, `mast-post` 만 등록하고 **다른 7개는 `create_batch` 가 400 을 던지도록 임시로 두는 편이 안전**하다.

`calculators.py` 최소본:

```python
# app/services/rerun_adapters/calculators.py
"""파라메트릭 계산기 배치 어댑터.

⚠ Task 5 최소 목표는 mast-post 만. 나머지 7개는 파일럿(Task 10) 이후 같은 패턴으로 추가.
"""
from __future__ import annotations

from . import RerunAdapter, register
from ...routers.davit import compute_mast_post_candidates  # 기존 라우터의 순수 계산 함수
from ..job_manager import job_status_store


def _mast_post_task(job_id: str, owner: str, input_info: dict) -> None:
    """job_manager 안에서 도는 태스크. 결과는 result_info 로 DB 저장."""
    from ... import database, models
    try:
        job_status_store.update_job(job_id, {"status": "Running", "progress": 10})
        candidates = compute_mast_post_candidates(
            vessel_size=input_info.get("vessel_size", "large"),
            height_mm=float(input_info["height_mm"]),
            weight_kg=float(input_info["weight_kg"]),
        )
        db = database.SessionLocal()
        try:
            rec = db.query(models.Analysis).filter(
                models.Analysis.job_id == job_id
            ).first()
            if rec is not None:
                rec.result_info = {"candidates": candidates}
            db.commit()
        finally:
            db.close()
        job_status_store.update_job(job_id, {
            "status": "Success", "progress": 100, "message": "완료",
        })
    except Exception as exc:
        job_status_store.update_job(job_id, {
            "status": "Failed", "progress": 100,
            "message": f"{type(exc).__name__}: {exc}",
        })


def _build_mast_post_args(owner: str, input_info: dict) -> tuple:
    return (owner, dict(input_info))


register("mast-post", RerunAdapter(
    task_fn=_mast_post_task,
    build_task_args=_build_mast_post_args,
))
```

⚠ **`compute_mast_post_candidates` 는 현재 `routers/davit.py` 의 라우트 함수 안에 인라인으로 있다.** 이 단계에서 라우트 몸통을 순수 함수로 추출해 두 곳(라우트 + 배치 어댑터)이 함께 쓴다. 라우트는 그 함수를 그대로 호출해 응답만 감싸면 되므로 외부 API 는 변하지 않는다.

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_batch_run_service.py -q
```
기대: 전부 통과. `test_create_batch_persists_batchrun_and_populates_case_analyses` 는 `_submit_analysis_job` 을 monkeypatch 하므로 실제 `_intake.submit_analysis_job` 을 부르지 않는다 — 배치 서비스 자체의 계약만 검증한다.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/services/batch_run_service.py`, `app/services/rerun_adapters/__init__.py`, `app/services/rerun_adapters/calculators.py`, `app/routers/davit.py`(순수 함수 추출), `tests/test_batch_run_service.py`.

---

## Task 6: `_write_through` 배치 훅 + `notify_job_terminal` 억제

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/job_manager.py:110-138`(`_write_through`)
- Modify: `HiTessWorkBenchBackEnd/app/services/notification_service.py`(`notify_job_terminal` 조기 반환) — Plan A 배포 후에만
- Create: `HiTessWorkBenchBackEnd/tests/test_batch_run_notify.py`

> ⚠ **의존 순서**: 이 Task 는 Plan D 가 `_write_through` 에 이미 손댄 상태를 전제한다. Plan D 배포본에서는 `_write_through` 가 `Cancelled` 를 이해하도록 확장돼 있고(Plan D §3.1), Plan A 배포본에서는 `notify_job_terminal` 이 호출된다. Plan H 는 그 두 훅 뒤에 배치 집계를 얹는다.

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_batch_run_notify.py`:

```python
"""배치 소속 케이스가 종료될 때: 케이스별 알림은 억제, 마지막 케이스에서 batch.completed 1건."""
from datetime import datetime

from app import database, models
from app.services import batch_run_service, job_manager, notification_service


def _running_case(db_session, batch_id, job_id, program="Mast Post Assessment"):
    a = models.Analysis(
        job_id=job_id, employee_id="EMP001", program_name=program,
        status="Running", job_status="Running", progress=0,
        batch_id=batch_id, created_at=datetime.now(),
    )
    db_session.add(a)
    db_session.commit()
    return a


def test_case_success_does_not_send_individual_notification(db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    batch = models.BatchRun(
        employee_id="EMP001", program_id="mast-post", name="x", total=3,
    )
    db_session.add(batch)
    db_session.commit()
    _running_case(db_session, batch.id, "job-b-1")

    job_manager.job_status_store.update_job("job-b-1", {
        "status": "Success", "progress": 100, "message": "완료",
    })

    db_session.expire_all()
    # 케이스별 job.completed 알림은 0건.
    rows = db_session.query(models.Notification).filter(
        models.Notification.kind == "job.completed"
    ).all()
    assert rows == []


def test_batch_completed_notification_only_when_all_cases_terminal(db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    batch = models.BatchRun(
        employee_id="EMP001", program_id="mast-post", name="x", total=2,
    )
    db_session.add(batch)
    db_session.commit()
    _running_case(db_session, batch.id, "job-b-2")
    _running_case(db_session, batch.id, "job-b-3")

    # 첫 케이스 종료 — 알림 없음
    job_manager.job_status_store.update_job("job-b-2", {"status": "Success", "progress": 100})
    db_session.expire_all()
    assert db_session.query(models.Notification).count() == 0

    # 두 번째(마지막) 케이스 종료 — batch.completed 1건
    job_manager.job_status_store.update_job("job-b-3", {"status": "Success", "progress": 100})
    db_session.expire_all()
    rows = db_session.query(models.Notification).filter(
        models.Notification.kind == "batch.completed"
    ).all()
    assert len(rows) == 1
    assert "완료" in rows[0].title
    assert rows[0].body == "2/2 성공"
    assert rows[0].dedupe_key == f"batch:{batch.id}"


def test_batch_partial_failure_body(db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    batch = models.BatchRun(
        employee_id="EMP001", program_id="mast-post", name="x", total=3,
    )
    db_session.add(batch)
    db_session.commit()
    _running_case(db_session, batch.id, "job-p-1")
    _running_case(db_session, batch.id, "job-p-2")
    _running_case(db_session, batch.id, "job-p-3")

    job_manager.job_status_store.update_job("job-p-1", {"status": "Success", "progress": 100})
    job_manager.job_status_store.update_job("job-p-2", {"status": "Failed", "progress": 100})
    job_manager.job_status_store.update_job("job-p-3", {"status": "Success", "progress": 100})

    db_session.expire_all()
    row = db_session.query(models.Notification).filter(
        models.Notification.kind == "batch.completed"
    ).one()
    assert row.body == "2/3 성공, 1 실패"


def test_notify_job_terminal_returns_none_for_batch_cases(db_session):
    """알림 서비스는 batch_id 가 있는 레코드에 대해 조기 반환한다(§5.1 억제)."""
    batch = models.BatchRun(
        employee_id="EMP001", program_id="mast-post", name="x", total=1,
    )
    db_session.add(batch)
    db_session.commit()
    a = models.Analysis(
        job_id="job-nt-1", employee_id="EMP001",
        program_name="Mast Post Assessment",
        status="Success", job_status="Success", progress=100,
        batch_id=batch.id, created_at=datetime.now(),
    )
    db_session.add(a)
    db_session.commit()

    assert notification_service.notify_job_terminal(db_session, a, "Success") is None
    assert db_session.query(models.Notification).count() == 0
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_batch_run_notify.py -q
```
기대: 4건 모두 실패(훅과 억제 규칙이 아직 없다).

- [ ] **Step 3: `_write_through` 훅 확장** — `app/services/job_manager.py:110-138` 의 `_write_through` 안, Plan D 가 이미 삽입한 `_notify_job_terminal(db, record, status)` 호출(마스터 §2.1) **바로 뒤에** 배치 훅을 추가한다.

Plan D 배포본의 `_write_through` 는 아래와 같은 모양이다(Plan D §3.1 기준):

```python
    if status in ("Success", "Failed", "Cancelled") and record.batch_id:
        try:
            from .batch_run_service import mark_case_terminal
            mark_case_terminal(db, batch_id=record.batch_id, case_status=status)
        except Exception:
            db.rollback()
            logger.warning(
                "케이스 %s 배치(batch_id=%s) 집계 실패",
                record.job_id, record.batch_id, exc_info=True,
            )
```

이 블록은 **`db.commit()` 그리고 `_notify_job_terminal` 호출 다음에** 놓는다. Plan D 의 `Cancelled` 지속성 규칙(§3.1 표) 은 `_write_through` 초입에서 실행되므로 여기 훅과 겹치지 않는다.

- [ ] **Step 4: `notify_job_terminal` 억제 규칙** — `app/services/notification_service.py:notify_job_terminal` 의 `spec is not None and not spec.history_visible: return None` 뒤(Plan A 참고: notification-center Task 2 Step 3 의 `spec` 조회 뒤)에 한 줄을 추가한다.

```python
def notify_job_terminal(
    db: Session, record: models.Analysis, status: str,
) -> models.Notification | None:
    kind = _TERMINAL_KIND_BY_STATUS.get(status)
    if kind is None or not (record.employee_id or "").strip():
        return None
    spec = resolve_program(record.program_name)
    if spec is not None and not spec.history_visible:
        return None
    # Plan H — 배치 소속 케이스는 개별 알림을 만들지 않는다.
    # 40 케이스 배치가 40건 알림을 쏘면 알림 센터가 무의미해진다(§2-7).
    if getattr(record, "batch_id", None) is not None:
        return None

    display_name = spec.display_name if spec else (record.program_name or "해석")
    # ... 이하 원본 유지 ...
```

⚠ **Plan A 가 아직 배포되지 않았다면 `notification_service.py` 파일 자체가 없다.** 그 경우엔 Task 6 Step 4 는 **skip 하고** Plan A 병합 때 함께 넣는다. `test_notify_job_terminal_returns_none_for_batch_cases` 도 그때까지 skip 대상 — pytest 마커로 조건부 실행하면 좋다:

```python
import pytest

pytestmark = pytest.mark.skipif(
    not hasattr(notification_service, "notify_job_terminal"),
    reason="Plan A(notification_service) 배포 전에는 스킵",
)
```

이 파일 헤더에 한 줄이면 된다.

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_batch_run_notify.py tests/test_job_manager_notify.py tests/test_batch_run_service.py -q
```
기대: 전부 통과. Plan A 없이 실행하면 `test_notify_job_terminal_returns_none_for_batch_cases` 하나가 skip 된다.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/services/job_manager.py`(훅), `app/services/notification_service.py`(억제 규칙, Plan A 배포 후에만), `tests/test_batch_run_notify.py`.

---

## Task 7: `POST /api/analysis/batch` 라우터 + `main.py` 등록

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/routers/batch.py`
- Modify: `HiTessWorkBenchBackEnd/app/main.py:20-45`(import), `:212`(include)
- Create: `HiTessWorkBenchBackEnd/tests/test_batch_run_router.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_batch_run_router.py`:

```python
"""배치 실행 API — 생성/조회/취소/관리자 promote/권한/케이스 상한."""
from datetime import datetime

from app import models
from app.dependencies import require_auth, require_admin
from app.main import app


def _act_as(employee_id: str):
    app.dependency_overrides[require_auth] = lambda: employee_id


def _act_admin(employee_id: str = "ADMIN001"):
    app.dependency_overrides[require_admin] = lambda: employee_id


def _payload(program_id="mast-post", name="스캔", count=3):
    cases = [
        {"label": f"case-{i}",
         "input_info": {"vessel_size": "large", "height_mm": 500 + 100 * i, "weight_kg": 200}}
        for i in range(1, count + 1)
    ]
    return {"program_id": program_id, "name": name, "cases": cases}


def test_create_batch_returns_202_with_case_ids(admin_client, monkeypatch):
    # submit 을 stub 해 실제 executor 로 밀어 넣지 않는다.
    from app.services import batch_run_service

    def fake_submit(task_fn, *task_args, metadata=None, batch_id=None, **_kwargs):
        # 실제 DB Analysis 를 만든다(라우터 응답이 그 id 를 돌려주기 때문).
        from app import database, models
        db = database.SessionLocal()
        try:
            n = db.query(models.Analysis).count() + 1
            a = models.Analysis(
                job_id=f"job-{n}", employee_id=metadata.employee_id,
                program_name=metadata.program_name,
                status="Running", job_status="Pending", progress=0,
                batch_id=batch_id, created_at=datetime.now(),
            )
            db.add(a)
            db.commit()
            return a.job_id
        finally:
            db.close()

    monkeypatch.setattr(batch_run_service, "_submit_analysis_job", fake_submit)

    r = admin_client.post("/api/analysis/batch", json=_payload(count=2))
    assert r.status_code == 202
    data = r.json()
    assert data["total"] == 2
    assert len(data["cases"]) == 2
    for case in data["cases"]:
        assert set(case) >= {"case_label", "analysis_id", "job_id"}


def test_case_limit_is_50(admin_client):
    r = admin_client.post("/api/analysis/batch", json=_payload(count=51))
    assert r.status_code == 422
    assert "50" in r.json()["detail"]


def test_empty_case_list_is_400(admin_client):
    payload = _payload(count=0)
    payload["cases"] = []
    r = admin_client.post("/api/analysis/batch", json=payload)
    assert r.status_code == 422


def test_file_based_program_is_400(admin_client):
    payload = _payload(program_id="truss-assessment")
    r = admin_client.post("/api/analysis/batch", json=payload)
    assert r.status_code == 400


def test_unknown_program_is_400(admin_client):
    r = admin_client.post("/api/analysis/batch", json=_payload(program_id="does-not-exist"))
    assert r.status_code == 400


def test_get_progress_returns_summary(admin_client, db_session):
    batch = models.BatchRun(
        employee_id="ADMIN001", program_id="mast-post", name="x", total=2,
        done=1, failed=0,
    )
    db_session.add(batch)
    db_session.commit()
    r = admin_client.get(f"/api/analysis/batch/{batch.id}")
    assert r.status_code == 200
    data = r.json()
    assert data["batch_id"] == batch.id
    assert data["total"] == 2
    assert data["remaining"] == 1


def test_get_progress_other_owner_is_404(admin_client, db_session):
    batch = models.BatchRun(
        employee_id="EMP001", program_id="mast-post", name="x", total=1,
    )
    db_session.add(batch)
    db_session.commit()
    r = admin_client.get(f"/api/analysis/batch/{batch.id}")
    # ADMIN001 은 관리자이므로 열람 가능해야 한다(spec §6 표 — 소유자 or 관리자).
    assert r.status_code == 200
    # 그러나 관리자가 아닌 다른 사용자는 404.
    _act_as("EMP002")
    r = admin_client.get(f"/api/analysis/batch/{batch.id}")
    assert r.status_code == 404


def test_cancel_batch_calls_job_store_cancel(admin_client, db_session, monkeypatch):
    batch = models.BatchRun(
        employee_id="ADMIN001", program_id="mast-post", name="x", total=2,
    )
    db_session.add(batch)
    db_session.commit()
    for i in range(1, 3):
        db_session.add(models.Analysis(
            job_id=f"job-c-{i}", employee_id="ADMIN001",
            program_name="Mast Post Assessment",
            status="Running", job_status="Running",
            batch_id=batch.id, created_at=datetime.now(),
        ))
    db_session.commit()

    calls = []
    from app.services.job_manager import job_status_store
    monkeypatch.setattr(job_status_store, "cancel",
                        lambda job_id, **_kw: (calls.append(job_id) or True))

    r = admin_client.post(f"/api/analysis/batch/{batch.id}/cancel")
    assert r.status_code == 200
    assert r.json()["cancelled_cases"] == 2
    assert sorted(calls) == ["job-c-1", "job-c-2"]


def test_admin_promote_requires_admin(admin_client, db_session):
    batch = models.BatchRun(
        employee_id="ADMIN001", program_id="mast-post", name="x", total=1,
    )
    db_session.add(batch)
    db_session.commit()
    r = admin_client.post(
        f"/api/admin/analysis/batch/{batch.id}/promote",
        json={"queue_class": "heavy"},
    )
    assert r.status_code == 200


def test_requires_auth(admin_client):
    saved = app.dependency_overrides.pop(require_auth)
    try:
        r = admin_client.get("/api/analysis/batch/1")
        assert r.status_code == 401
    finally:
        app.dependency_overrides[require_auth] = saved
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_batch_run_router.py -q
```
기대: 전부 404 로 실패(라우터 미등록).

- [ ] **Step 3: 라우터 구현** — `HiTessWorkBenchBackEnd/app/routers/batch.py`:

```python
"""배치 실행 API(마스터 §2.8). 파라메트릭 8개 계산기의 다건 실행을 다룬다.

플랫폼 공통 라우터이므로 app_settings.GUARDED_ROUTES 에 등록하지 않는다(§2-12).
개별 케이스는 여전히 원래 App 의 request 라우터(App Settings 게이트가 걸린 곳)를 통과
하지 않고 _intake.submit_analysis_job 을 직접 호출한다 — 대상 프로그램(program_registry
로 검증)이 파라메트릭 8개로 고정돼 있어 우회가 아니다.
"""
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import database, models
from ..dependencies import require_auth, require_admin
from ..services.batch_run_service import (
    MAX_CASES_PER_BATCH,
    BatchCase,
    cancel_batch,
    create_batch,
    get_progress,
    promote_batch,
)

router = APIRouter(prefix="/api/analysis", tags=["batch"])
admin_router = APIRouter(prefix="/api/admin/analysis", tags=["batch"])


class BatchCasePayload(BaseModel):
    label: str = Field(default="", max_length=100)
    input_info: dict = Field(default_factory=dict)


class CreateBatchPayload(BaseModel):
    program_id: str
    name: str = Field(default="", max_length=200)
    cases: list[BatchCasePayload]


def _load_batch(db: Session, batch_id: int, me: str, *, is_admin: bool) -> models.BatchRun:
    batch = db.query(models.BatchRun).filter(models.BatchRun.id == batch_id).first()
    if batch is None:
        raise HTTPException(status_code=404, detail="배치를 찾을 수 없습니다.")
    if batch.employee_id != me and not is_admin:
        raise HTTPException(status_code=404, detail="배치를 찾을 수 없습니다.")
    return batch


@router.post("/batch", status_code=202)
def create_batch_endpoint(
    payload: CreateBatchPayload = Body(...),
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    if not payload.cases:
        raise HTTPException(status_code=422, detail="케이스가 없습니다.")
    if len(payload.cases) > MAX_CASES_PER_BATCH:
        raise HTTPException(
            status_code=422,
            detail=f"배치 케이스는 최대 {MAX_CASES_PER_BATCH} 건입니다.",
        )
    cases = [BatchCase(label=c.label, input_info=dict(c.input_info)) for c in payload.cases]
    try:
        batch = create_batch(
            db,
            owner=me,
            program_id=payload.program_id,
            name=payload.name,
            cases=cases,
        )
    except ValueError as exc:
        # 미등록 프로그램 · 파일 계열 · calculator 아님 등은 클라이언트 오류.
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    cases_view = [
        {
            "case_label": (c.project_name or "").rsplit("·", 1)[-1].strip(),
            "analysis_id": c.id,
            "job_id": c.job_id,
        }
        for c in db.query(models.Analysis).filter(
            models.Analysis.batch_id == batch.id
        ).order_by(models.Analysis.id.asc())
    ]
    return {"batch_id": batch.id, "total": batch.total, "cases": cases_view}


@router.get("/batch/{batch_id}")
def read_progress(
    batch_id: int,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    is_admin = _is_admin(db, me)
    batch = _load_batch(db, batch_id, me, is_admin=is_admin)
    return get_progress(db, batch.id)


@router.post("/batch/{batch_id}/cancel")
def cancel_batch_endpoint(
    batch_id: int,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    is_admin = _is_admin(db, me)
    _load_batch(db, batch_id, me, is_admin=is_admin)
    try:
        return cancel_batch(db, batch_id=batch_id, requester=me)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@admin_router.post("/batch/{batch_id}/promote")
def promote_batch_endpoint(
    batch_id: int,
    body: dict = Body(...),
    db: Session = Depends(database.get_db),
    _admin: str = Depends(require_admin),
):
    queue_class = body.get("queue_class")
    if queue_class not in {"heavy", "light"}:
        raise HTTPException(status_code=400, detail="queue_class 는 'heavy' 또는 'light'.")
    try:
        return promote_batch(db, batch_id=batch_id, queue_class=queue_class)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _is_admin(db: Session, employee_id: str) -> bool:
    row = db.query(models.User).filter(models.User.employee_id == employee_id).first()
    return bool(row and row.is_admin)
```

- [ ] **Step 4: `main.py` 등록**

(a) 20~45행 import 목록의 알파벳 순 자리에 `batch,` 를 추가(`app_settings,` 뒤, `auth,` 앞):

```python
    activity,
    analysis,
    app_settings,
    batch,
    auth,
    carling,
```

⚠ 알파벳 순으로는 `batch` 가 `auth` 뒤에 와야 하지만 이 파일의 정렬은 완전한 사전순이 아니다(`app_settings` → `auth` 는 이미 그렇다). 기존 관례에 맞춰 `auth` 아래에 넣는다:

```python
    auth,
    batch,
    carling,
```

(b) 212행 `application.include_router(reports.router)` 다음 줄에 두 라우터를 등록한다:

```python
    application.include_router(batch.router)
    application.include_router(batch.admin_router)
```

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_batch_run_router.py -q
```
기대: `10 passed`.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/routers/batch.py`, `app/main.py`, `tests/test_batch_run_router.py`.

---

## Task 8: 프론트 API 모듈 확장 + `batchRun` 순수 유틸(`node --test`)

**Files:**
- Modify: `HiTessWorkBench/frontend/src/api/analysis.js`
- Create: `HiTessWorkBench/frontend/src/utils/batchRun.js`
- Create: `HiTessWorkBench/frontend/src/utils/batchRun.test.js`

- [ ] **Step 1: 순수 유틸 실패 테스트 작성** — `src/utils/batchRun.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_BATCH_CASES,
  formatBatchStatus,
  parseCasesFromCsv,
  progressRatio,
  validateCases,
} from './batchRun.js';

test('상한 상수', () => {
  assert.equal(MAX_BATCH_CASES, 50);
});

test('validateCases: 정상 3건', () => {
  const cases = [
    { label: 'a', input_info: { height_mm: 500, weight_kg: 200 } },
    { label: 'b', input_info: { height_mm: 600, weight_kg: 200 } },
    { label: 'c', input_info: { height_mm: 700, weight_kg: 200 } },
  ];
  const r = validateCases(cases, ['height_mm', 'weight_kg']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('validateCases: 필드 누락은 errors 로', () => {
  const r = validateCases(
    [{ label: 'x', input_info: { height_mm: 500 } }],
    ['height_mm', 'weight_kg'],
  );
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /weight_kg/);
});

test('validateCases: 빈 배열', () => {
  const r = validateCases([], ['height_mm']);
  assert.equal(r.ok, false);
});

test('validateCases: 상한 초과', () => {
  const cases = Array.from({ length: MAX_BATCH_CASES + 1 }, (_, i) => ({
    label: String(i), input_info: { height_mm: 500 },
  }));
  const r = validateCases(cases, ['height_mm']);
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /50/);
});

test('parseCasesFromCsv: 헤더 + 3행', () => {
  const csv = 'label,height_mm,weight_kg\nA,500,200\nB,600,220\nC,700,240';
  const cases = parseCasesFromCsv(csv, ['height_mm', 'weight_kg']);
  assert.equal(cases.length, 3);
  assert.deepEqual(cases[0], {
    label: 'A', input_info: { height_mm: 500, weight_kg: 200 },
  });
});

test('parseCasesFromCsv: 탭 구분(엑셀 붙여넣기)', () => {
  const tsv = 'label\theight_mm\tweight_kg\nA\t500\t200';
  const cases = parseCasesFromCsv(tsv, ['height_mm', 'weight_kg']);
  assert.equal(cases[0].input_info.height_mm, 500);
});

test('parseCasesFromCsv: 빈 문자열', () => {
  assert.deepEqual(parseCasesFromCsv('', ['x']), []);
  assert.deepEqual(parseCasesFromCsv('  \n\n', ['x']), []);
});

test('progressRatio: 0..1', () => {
  assert.equal(progressRatio({ total: 5, done: 0, failed: 0 }), 0);
  assert.equal(progressRatio({ total: 5, done: 3, failed: 1 }), 0.8);
  assert.equal(progressRatio({ total: 5, done: 5, failed: 0 }), 1);
  assert.equal(progressRatio({ total: 0, done: 0, failed: 0 }), 0);
});

test('formatBatchStatus', () => {
  assert.equal(formatBatchStatus('Running'), '진행 중');
  assert.equal(formatBatchStatus('Completed'), '완료');
  assert.equal(formatBatchStatus('Failed'), '실패');
  assert.equal(formatBatchStatus('Cancelled'), '중단');
  assert.equal(formatBatchStatus('nonexistent'), 'nonexistent');
});
```

- [ ] **Step 2: 실패 확인** (`C:\Coding\WorkBench\HiTessWorkBench\frontend` 에서)

```
node --test src/utils/batchRun.test.js
```
기대: `Cannot find module … batchRun.js` 로 실패(`fail 1`).

- [ ] **Step 3: 순수 유틸 구현** — `src/utils/batchRun.js`:

```js
/**
 * 배치 실행 순수 유틸 — 부수효과 없음(node --test 로 검증).
 * 케이스 표 검증·CSV 붙여넣기 파싱·진행률 계산·상태 라벨.
 */

export const MAX_BATCH_CASES = 50;

const STATUS_LABEL = {
  Running: '진행 중',
  Completed: '완료',
  Failed: '실패',
  Cancelled: '중단',
};

export function formatBatchStatus(status) {
  return STATUS_LABEL[status] || status;
}

/**
 * 케이스 표 검증.
 * inputKeys : ProgramSpec.input_keys 를 프론트가 명시적으로 전달(mast-post 는 프로그램 특유 키 배열).
 * 반환: {ok: boolean, errors: [{row, message}]}
 */
export function validateCases(cases, inputKeys) {
  const errors = [];
  if (!Array.isArray(cases) || cases.length === 0) {
    return { ok: false, errors: [{ row: -1, message: '케이스가 없습니다.' }] };
  }
  if (cases.length > MAX_BATCH_CASES) {
    return {
      ok: false,
      errors: [{ row: -1, message: `배치 케이스는 최대 ${MAX_BATCH_CASES} 건입니다.` }],
    };
  }
  cases.forEach((c, idx) => {
    const info = (c && c.input_info) || {};
    for (const key of inputKeys || []) {
      const v = info[key];
      if (v == null || v === '' || Number.isNaN(Number(v))) {
        errors.push({ row: idx, message: `${key} 값이 필요합니다.` });
      }
    }
  });
  return { ok: errors.length === 0, errors };
}

/**
 * CSV/TSV 붙여넣기 → 케이스 배열.
 * 첫 줄은 헤더(label + 입력 키). 값은 숫자로 파싱해 input_info 에 넣는다.
 */
export function parseCasesFromCsv(text, inputKeys) {
  if (!text || !String(text).trim()) return [];
  const rawLines = String(text).split(/\r?\n/).filter(l => l.trim().length > 0);
  if (rawLines.length === 0) return [];
  const header = _split(rawLines[0]).map(s => s.trim());
  const body = rawLines.slice(1);
  return body.map(line => {
    const cells = _split(line);
    const rec = {};
    header.forEach((h, i) => { rec[h] = (cells[i] ?? '').trim(); });
    const label = rec.label || rec.name || '';
    const input_info = {};
    for (const key of inputKeys) {
      const raw = rec[key];
      input_info[key] = raw == null || raw === '' ? '' : Number(raw);
    }
    return { label, input_info };
  });
}

function _split(line) {
  // 탭 구분자 우선(엑셀 붙여넣기), 없으면 콤마.
  return line.includes('\t') ? line.split('\t') : line.split(',');
}

/**
 * 서버 batch 요약을 0..1 진행률로.
 */
export function progressRatio({ total, done, failed } = {}) {
  const t = Number(total) || 0;
  if (t <= 0) return 0;
  const d = (Number(done) || 0) + (Number(failed) || 0);
  return Math.max(0, Math.min(1, d / t));
}
```

- [ ] **Step 4: 통과 확인**

```
node --test src/utils/batchRun.test.js
```
기대: `pass 10`, `fail 0`.

- [ ] **Step 5: API 모듈 확장** — `src/api/analysis.js` 의 파일 끝에 세 함수 추가:

```js
/** 배치 생성 — 케이스마다 개별 Analysis 를 만들고 batch_id 를 채워 반환한다. */
export const createBatch = (payload) =>
  axios.post(`${API_BASE_URL}/api/analysis/batch`, payload, { headers: getAuthHeaders() });

/** 배치 진행률 폴링 — 2초 간격 권장(정확한 값은 usePolling 정책). */
export const getBatchProgress = (batchId) =>
  axios.get(`${API_BASE_URL}/api/analysis/batch/${batchId}`, { headers: getAuthHeaders() });

/** 배치 취소 — 실행 중은 Plan D taskkill 트리, 대기 중은 future.cancel(). */
export const cancelBatch = (batchId) =>
  axios.post(`${API_BASE_URL}/api/analysis/batch/${batchId}/cancel`, {}, { headers: getAuthHeaders() });
```

- [ ] **Step 6: 빌드 확인**

```
npm run build
```
기대: 오류 없이 `dist/` 생성.

- [ ] **Step 7: 커밋 준비 완료** — 보고: `src/api/analysis.js`, `src/utils/batchRun.js`, `src/utils/batchRun.test.js`. (`config.js` 는 스테이징 금지.)

---

## Task 9: `BatchRunPanel` 컴포넌트

**Files:**
- Create: `HiTessWorkBench/frontend/src/components/analysis/BatchRunPanel.jsx`

- [ ] **Step 1: 컴포넌트 구현** — `src/components/analysis/BatchRunPanel.jsx`:

```jsx
/**
 * @fileoverview 파라메트릭 앱 공용 배치 실행 패널(마스터 §2.8·spec §7).
 *
 * props:
 *  - programId : ProgramSpec.program_id (예: "mast-post")
 *  - inputKeys : 각 케이스 input_info 필수 키 배열 (예: ["vessel_size","height_mm","weight_kg"])
 *  - defaultCases : 초기 케이스 표(단건 폼 값을 그대로 재사용해 첫 행을 채워 주면 UX 가 좋다)
 *  - onSubmitted(batchId) : 배치 생성 성공 콜백
 *
 * 표 편집기 + CSV 붙여넣기 + 진행률 카드(2초 폴링, 서버 집계 사용) + 중단 버튼.
 * 케이스별 카드는 만들지 않는다(§2-7 규칙과 같은 이유).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Play, Plus, StopCircle, Trash2 } from 'lucide-react';

import { cancelBatch, createBatch, getBatchProgress } from '../../api/analysis';
import { useToast } from '../../contexts/ToastContext';
import { useGlobalJobs } from '../../contexts/DashboardContext';
import ConfirmDialog from '../platform/ConfirmDialog';
import {
  MAX_BATCH_CASES,
  formatBatchStatus,
  parseCasesFromCsv,
  progressRatio,
  validateCases,
} from '../../utils/batchRun';

const POLL_INTERVAL_MS = 2000;

function emptyRow(inputKeys) {
  const info = {};
  inputKeys.forEach(k => { info[k] = ''; });
  return { label: '', input_info: info };
}

function CaseEditor({ inputKeys, rows, setRows, disabled }) {
  const columns = ['label', ...inputKeys];
  const setCell = (rowIdx, key, value) => setRows(prev => prev.map((r, i) => {
    if (i !== rowIdx) return r;
    if (key === 'label') return { ...r, label: value };
    return { ...r, input_info: { ...r.input_info, [key]: value } };
  }));
  return (
    <div className="border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
          <tr>
            {columns.map(c => (
              <th key={c} className="px-3 py-2 text-left font-bold">{c}</th>
            ))}
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className="border-t border-slate-100">
              {columns.map(c => (
                <td key={c} className="px-2 py-1.5">
                  <input
                    type="text"
                    disabled={disabled}
                    value={c === 'label' ? row.label : (row.input_info[c] ?? '')}
                    onChange={e => setCell(idx, c, e.target.value)}
                    placeholder={c}
                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20 disabled:bg-slate-50"
                  />
                </td>
              ))}
              <td className="px-2 py-1.5 text-center">
                <button
                  type="button"
                  disabled={disabled || rows.length <= 1}
                  onClick={() => setRows(prev => prev.filter((_, i) => i !== idx))}
                  className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-30"
                  aria-label="행 삭제"
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProgressCard({ progress, onCancel, canceling }) {
  const ratio = progressRatio(progress);
  const terminal = ['Completed', 'Failed', 'Cancelled'].includes(progress.status);
  return (
    <div className="mt-4 border rounded-xl p-4 bg-slate-50">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-bold text-slate-700">
          {progress.name || `배치 #${progress.batch_id}`}
        </div>
        <div className="text-xs font-bold text-slate-500">
          {formatBatchStatus(progress.status)} · {progress.done}/{progress.total} 성공
          {progress.failed > 0 && `, ${progress.failed} 실패`}
        </div>
      </div>
      <div className="h-2 bg-slate-200 rounded overflow-hidden">
        <div
          className="h-full bg-brand-blue transition-all"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
      {!terminal && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={canceling}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            <StopCircle size={14} />
            중단
          </button>
        </div>
      )}
    </div>
  );
}

export default function BatchRunPanel({
  programId,
  inputKeys,
  defaultCases = [],
  name: nameProp = '',
  onSubmitted,
}) {
  const { showToast } = useToast();
  const { startGlobalJob, patchGlobalJob } = useGlobalJobs();
  const [rows, setRows] = useState(() => (
    defaultCases.length > 0 ? defaultCases : [emptyRow(inputKeys)]
  ));
  const [batchName, setBatchName] = useState(nameProp);
  const [csvText, setCsvText] = useState('');
  const [batchId, setBatchId] = useState(null);
  const [progress, setProgress] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const validation = useMemo(
    () => validateCases(rows, inputKeys.filter(k => k !== 'label')),
    [rows, inputKeys],
  );

  // 폴링
  useEffect(() => {
    if (!batchId) return undefined;
    let cancelled = false;
    let timer;
    const tick = async () => {
      try {
        const res = await getBatchProgress(batchId);
        if (cancelled) return;
        setProgress(res.data);
        patchGlobalJob(`batch:${batchId}`, {
          batch_id: batchId,
          program_name: `배치 ${res.data.name || batchId}`,
          status: res.data.status,
          progress: Math.round(progressRatio(res.data) * 100),
          message: `${res.data.done}/${res.data.total} 성공${res.data.failed ? `, ${res.data.failed} 실패` : ''}`,
        });
        const terminal = ['Completed', 'Failed', 'Cancelled'].includes(res.data.status);
        if (!terminal) timer = setTimeout(tick, POLL_INTERVAL_MS);
      } catch {
        if (!cancelled) timer = setTimeout(tick, POLL_INTERVAL_MS * 2);
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [batchId, patchGlobalJob]);

  const addRow = () => setRows(prev => [...prev, emptyRow(inputKeys)]);
  const pasteCsv = () => {
    const parsed = parseCasesFromCsv(csvText, inputKeys.filter(k => k !== 'label'));
    if (parsed.length === 0) {
      showToast('CSV 를 인식하지 못했습니다. 첫 줄이 헤더인지 확인하세요.', 'warning');
      return;
    }
    setRows(parsed);
    setCsvText('');
    showToast(`${parsed.length} 케이스 불러왔습니다.`, 'success');
  };

  const submit = useCallback(async () => {
    if (!validation.ok) {
      showToast(validation.errors[0]?.message || '입력을 확인하세요.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        program_id: programId,
        name: batchName,
        cases: rows.map(r => ({
          label: r.label,
          input_info: Object.fromEntries(
            Object.entries(r.input_info).map(([k, v]) => [k, Number.isNaN(Number(v)) ? v : Number(v)]),
          ),
        })),
      };
      const res = await createBatch(payload);
      const id = res.data.batch_id;
      setBatchId(id);
      startGlobalJob(`batch:${id}`, {
        batch_id: id, program_name: `배치 ${batchName || id}`,
        status: 'Running', progress: 0, message: `${res.data.total} 케이스 접수`,
      });
      showToast(`${res.data.total} 케이스를 큐에 넣었습니다.`, 'success');
      onSubmitted?.(id);
    } catch (e) {
      showToast(e.response?.data?.detail || '배치 제출에 실패했습니다.', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [validation, rows, programId, batchName, startGlobalJob, showToast, onSubmitted]);

  const doCancel = async () => {
    setConfirmCancel(false);
    setCanceling(true);
    try {
      await cancelBatch(batchId);
      showToast('배치 중단 요청을 보냈습니다.', 'info');
    } catch (e) {
      showToast('중단 요청 실패: ' + (e.response?.data?.detail || '알 수 없음'), 'error');
    } finally {
      setCanceling(false);
    }
  };

  return (
    <section className="border rounded-2xl bg-white p-5">
      <header className="flex items-center gap-2 mb-3">
        <div className="text-sm font-extrabold text-slate-800">배치 실행</div>
        <span className="text-xs text-slate-400">최대 {MAX_BATCH_CASES} 케이스</span>
      </header>

      <div className="mb-3">
        <label className="block text-xs font-bold text-slate-500 mb-1">배치 이름</label>
        <input
          type="text"
          value={batchName}
          onChange={e => setBatchName(e.target.value)}
          placeholder="예: H600 후보 스캔"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
        />
      </div>

      <CaseEditor
        inputKeys={inputKeys}
        rows={rows}
        setRows={setRows}
        disabled={submitting || Boolean(batchId)}
      />

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={addRow}
          disabled={submitting || Boolean(batchId) || rows.length >= MAX_BATCH_CASES}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <Plus size={14} />행 추가
        </button>
        <span className="text-xs text-slate-400">{rows.length}/{MAX_BATCH_CASES}</span>
      </div>

      {!batchId && (
        <div className="mt-3">
          <label className="block text-xs font-bold text-slate-500 mb-1">CSV 붙여넣기 (엑셀에서 그대로 복붙)</label>
          <textarea
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
            rows={3}
            placeholder={`label,${inputKeys.filter(k => k !== 'label').join(',')}`}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
          />
          <div className="mt-1 flex justify-end">
            <button type="button" onClick={pasteCsv} className="text-xs font-bold text-brand-blue hover:underline">
              CSV 로 대체
            </button>
          </div>
        </div>
      )}

      {!validation.ok && validation.errors.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{validation.errors[0].message}</span>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !validation.ok || Boolean(batchId)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-4 py-2 text-sm font-bold text-white hover:bg-brand-blue/90 disabled:opacity-50"
        >
          <Play size={14} />
          {submitting ? '접수 중…' : '실행'}
        </button>
      </div>

      {progress && (
        <ProgressCard
          progress={progress}
          onCancel={() => setConfirmCancel(true)}
          canceling={canceling}
        />
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="배치를 중단할까요?"
          message={`남은 케이스 ${Math.max(0, progress?.total - progress?.done - progress?.failed || 0)} 건을 취소합니다. 이미 종료된 케이스의 결과는 유지됩니다.`}
          confirmLabel="중단"
          cancelLabel="계속"
          danger
          onConfirm={doCancel}
          onCancel={() => setConfirmCancel(false)}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 2: 빌드 확인**

```
npm run build
```
기대: 오류 없음. `ConfirmDialog` 는 Plan D 가 `components/platform/ConfirmDialog.jsx` 로 이미 만들어 뒀다(하드 의존).

- [ ] **Step 3: 커밋 준비 완료** — 보고: `src/components/analysis/BatchRunPanel.jsx`.

---

## Task 10: `MastPostAssessment.jsx` 파일럿 통합 + 수동 검증

**Files:**
- Modify: `HiTessWorkBench/frontend/src/pages/analysis/MastPostAssessment.jsx`

파일럿 대상은 Mast Post 하나. 나머지 7개 파라메트릭 앱은 같은 패턴으로 확장하되, 이번 plan 에서는 **파일럿 검증 후에** 시간이 남으면 붙인다(YAGNI — spec §7.1 은 "각 파라메트릭 페이지에 배치 아코디언 추가"를 말하지만, 어댑터가 8개 다 준비돼야 한다).

- [ ] **Step 1: 아코디언 통합** — `MastPostAssessment.jsx` 하단, 계산 결과 렌더 영역 아래에 `<BatchRunPanel />` 을 배치한다.

(a) 파일 상단 import 추가:

```jsx
import BatchRunPanel from '../../components/analysis/BatchRunPanel';
```

(b) `return (…)` 안의 마지막 카드 뒤(약 line 470 근처, 계산 결과가 없을 때/있을 때 공통으로 보이는 자리)에 아코디언을 붙인다:

```jsx
      <details className="mt-6 rounded-2xl border bg-white">
        <summary className="cursor-pointer px-5 py-4 text-sm font-extrabold text-slate-800">
          배치 실행 (여러 후보 한번에)
        </summary>
        <div className="px-5 pb-5">
          <BatchRunPanel
            programId="mast-post"
            inputKeys={['label', 'vessel_size', 'height_mm', 'weight_kg']}
            defaultCases={[{
              label: '단건 폼 값',
              input_info: {
                vessel_size: vesselSize,
                height_mm: Number(heightMm) || '',
                weight_kg: Number(weightKg) || '',
              },
            }]}
          />
        </div>
      </details>
```

- [ ] **Step 2: 빌드 확인**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && npm run build
```
기대: 오류 없음.

- [ ] **Step 3: 수동 검증 1(제출·진행·완료)** — 백엔드(`uvicorn app.main:app --host 0.0.0.0 --port 9091 --reload`) + `npm run dev`:

1. 로그인 → Parametric Apps → **Mast Post Assessment** → 하단 "배치 실행 (여러 후보 한번에)" 아코디언 펼침.
2. 표에 자동으로 단건 폼 값이 1행 채워져 있다. "행 추가" 로 3~5개 케이스를 만든다(예: height_mm 500/600/700, weight_kg 200 고정).
3. "실행" → 우상단 토스트 "N 케이스를 큐에 넣었습니다." → 진행률 카드 등장 → 우하단 UtilityDock 에 **배치 카드 1개**(케이스 3~5개가 개별로 안 쌓인다).
4. 2초마다 진행률 갱신, 모든 케이스 성공하면 status="완료" 로 바뀌고 폴링이 멈춘다. 우상단 토스트에 배치 완료 알림(Plan A 배포돼 있으면 알림 센터에도 `batch.completed` 1건).
5. DevTools Network 확인: `POST /api/analysis/batch` 1회 → `GET /api/analysis/batch/{id}` 2초 간격. 케이스 개별 `/status/{job_id}` 폴링은 발생하지 않는다.

- [ ] **Step 4: 수동 검증 2(중단)** — 3번째 케이스가 아직 대기 중일 때 진행률 카드의 "중단" 클릭 → `ConfirmDialog` "배치를 중단할까요?" → "중단":

1. `POST /api/analysis/batch/{id}/cancel` 요청.
2. 남은 케이스(대기 중)는 즉시 Cancelled, 실행 중이던 것은 Plan D `terminate_process_tree` 로 5초 내 종료.
3. 배치 status 가 "중단" 이 되면(전원 취소 시) 또는 실행 완료된 케이스가 하나라도 있으면 "완료(부분 실패)" — spec §2-9 규칙.
4. UtilityDock 카드 → terminal 로 바뀌면 카드가 회색으로 접힘.

- [ ] **Step 5: 수동 검증 3(CSV 붙여넣기)** — 새 배치 아코디언을 다시 연다:

1. Excel 에서 4열(label, vessel_size, height_mm, weight_kg) × 5행을 복사.
2. CSV 텍스트박스에 붙여넣기 → "CSV 로 대체" → 표에 5행이 채워지고 각 셀이 파싱된 값.
3. 실행 → 위와 같은 흐름.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `src/pages/analysis/MastPostAssessment.jsx`.

---

## Task 11: `MyProjects.jsx` 배치 그룹 행

**Files:**
- Create: `HiTessWorkBench/frontend/src/components/analysis/BatchRowGroup.jsx`
- Modify: `HiTessWorkBench/frontend/src/pages/analysis/MyProjects.jsx:641-647`(필터 상수), `:640-750`(부모/자식 렌더 분기)

- [ ] **Step 1: 배치 부모/자식 행 컴포넌트 — `src/components/analysis/BatchRowGroup.jsx`:

```jsx
/**
 * @fileoverview MyProjects 배치 그룹 행 — 부모 행(배치 요약) + 접힘/펼침 자식 행(케이스).
 *
 * spec §7.3 — batch_id 가 같은 케이스를 "부모 행 하나로 접기". 클릭하면 자식 케이스가
 * 펼쳐진다. 배치 상세 모달은 이번 범위 밖(케이스별 상세 모달을 그대로 재사용).
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';

import { formatBatchStatus } from '../../utils/batchRun';

function StatusPill({ status }) {
  const tone = status === 'Success' ? 'bg-emerald-100 text-emerald-700'
    : status === 'Failed' ? 'bg-red-100 text-red-700'
    : status === 'Cancelled' ? 'bg-slate-100 text-slate-500'
    : 'bg-blue-100 text-blue-700';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`}>
      {formatBatchStatus(status)}
    </span>
  );
}

export default function BatchRowGroup({ batchId, batchName, cases, renderCaseRow }) {
  const [open, setOpen] = useState(false);
  const total = cases.length;
  const done = cases.filter(c => c.status === 'Success').length;
  const failed = cases.filter(c => c.status === 'Failed' || c.status === 'Cancelled').length;
  const status = done + failed === total
    ? (done === 0 ? 'Failed' : (failed === total ? 'Cancelled' : 'Completed'))
    : 'Running';

  return (
    <>
      <tr className="border-t border-slate-200 bg-slate-50 hover:bg-slate-100 cursor-pointer"
          onClick={() => setOpen(o => !o)}>
        <td className="px-4 py-3" colSpan={99}>
          <div className="flex items-center gap-2">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Layers size={14} className="text-brand-blue" />
            <span className="text-sm font-bold text-slate-800">
              배치 · {batchName || `#${batchId}`}
            </span>
            <span className="text-xs text-slate-500">
              {done}/{total} 성공{failed ? `, ${failed} 실패` : ''}
            </span>
            <StatusPill status={status} />
          </div>
        </td>
      </tr>
      {open && cases.map(c => renderCaseRow(c))}
    </>
  );
}
```

- [ ] **Step 2: MyProjects 필터·렌더 분기**

(a) 파일 상단 import 추가:

```jsx
import BatchRowGroup from '../../components/analysis/BatchRowGroup';
```

(b) 641~647행 상수 뒤에 "배치만" 필터 상수를 추가:

```jsx
const BATCH_FILTERS = [
  { value: 'all', label: '전체' },
  { value: 'batch-only', label: '배치만' },
];
```

(c) 컴포넌트 상단(`useState` 근처):

```jsx
  const [batchFilter, setBatchFilter] = useState('all');
```

(d) 검색 필터 UI 옆에 세그먼티드 컨트롤 추가(기존 `programFilter` UI 근처):

```jsx
  <div className="flex gap-1 rounded-lg border border-slate-200 p-0.5">
    {BATCH_FILTERS.map(f => (
      <button key={f.value}
        onClick={() => setBatchFilter(f.value)}
        className={`px-3 py-1 text-xs font-bold rounded ${
          batchFilter === f.value ? 'bg-brand-blue text-white' : 'text-slate-600 hover:bg-slate-50'
        }`}
      >{f.label}</button>
    ))}
  </div>
```

(e) 렌더 분기 — 기존 `projects.map(project => <ProjectRow …/>)` 자리를 그룹화하는 로직으로 감싼다:

```jsx
  const groupedRows = useMemo(() => {
    const filtered = batchFilter === 'batch-only'
      ? projects.filter(p => p.batch_id != null)
      : projects;
    const groups = new Map();      // batch_id → cases[]
    const solo = [];
    for (const p of filtered) {
      if (p.batch_id == null) {
        solo.push({ kind: 'solo', project: p });
      } else {
        if (!groups.has(p.batch_id)) groups.set(p.batch_id, []);
        groups.get(p.batch_id).push(p);
      }
    }
    const rows = [
      ...[...groups.entries()].map(([batchId, cases]) => ({
        kind: 'batch',
        batchId,
        // 배치 이름은 첫 케이스 project_name 의 "이름 · 라벨" 앞부분에서 유추.
        batchName: cases[0]?.project_name?.split('·')[0]?.trim() || `#${batchId}`,
        cases,
      })),
      ...solo,
    ];
    return rows;
  }, [projects, batchFilter]);
```

렌더:

```jsx
  {groupedRows.map(row => row.kind === 'batch' ? (
    <BatchRowGroup
      key={`batch-${row.batchId}`}
      batchId={row.batchId}
      batchName={row.batchName}
      cases={row.cases}
      renderCaseRow={c => <ProjectRow key={c.id} project={c} … />}
    />
  ) : (
    <ProjectRow key={row.project.id} project={row.project} … />
  ))}
```

- [ ] **Step 3: 빌드 확인**

```
npm run build
```
기대: 오류 없음.

- [ ] **Step 4: 수동 검증** — Task 10 파일럿 검증에서 만든 배치가 My Projects 에 표시:

1. My Projects 진입 → 배치가 **부모 행 1개**로 접혀 있다("배치 · H600 후보 스캔 · 3/3 성공").
2. 부모 행 클릭 → 자식 케이스 5행이 펼쳐지고 각 케이스가 기존 `ProjectRow` 그대로 렌더 → 상세 모달·다시 실행 버튼이 동작한다.
3. 필터 "배치만" → 단건 실행이 목록에서 사라지고 배치만 남는다.

- [ ] **Step 5: 커밋 준비 완료** — 보고: `src/components/analysis/BatchRowGroup.jsx`, `src/pages/analysis/MyProjects.jsx`.

---

## Task 12: `UtilityDock` 배치 1카드 집계

**Files:**
- Modify: `HiTessWorkBench/frontend/src/contexts/DashboardContext.jsx:530-620`(`globalJobs` / `patchGlobalJob`)
- Modify: `HiTessWorkBench/frontend/src/components/platform/UtilityDock.jsx`

`patchGlobalJob` 이 `batch_id` 를 이해하도록 한다. 현재 카드 키는 `job_id` 인데, 배치는 `batch:<id>` 를 키로 쓰기로 Task 9 에서 정했다. 카드 하나가 계속 갱신되기만 하면 되므로 큰 변경은 없다.

- [ ] **Step 1: `patchGlobalJob` 이 `batch_id` 를 저장하도록 확장**

```jsx
  const patchGlobalJob = useCallback((key, patch) => {
    setGlobalJobs(prev => {
      const idx = prev.findIndex(j => j.key === key);
      const now = Date.now();
      if (idx < 0) {
        return [{ key, ...patch, updated_at: now }, ...prev].slice(0, 8);
      }
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch, updated_at: now };
      return next;
    });
  }, []);
```

`key` 는 job_id 든 `batch:<id>` 든 문자열이면 된다.

- [ ] **Step 2: `UtilityDock` 배치 카드 렌더**

카드 렌더 조건에 `job.batch_id != null` 이면 아이콘·라벨을 배치용으로 바꿔 준다:

```jsx
{jobs.map(job => (
  <JobCard key={job.key}
    icon={job.batch_id != null ? <Layers size={14} /> : <Play size={14} />}
    title={job.program_name}
    status={job.status}
    progress={job.progress}
    message={job.message}
    onCancel={job.batch_id != null
      ? () => cancelBatch(job.batch_id)
      : () => cancelJob(job.job_id)}
  />
))}
```

⚠ Plan D 가 `UtilityDock` 에 `cancelJob` 을 이미 심었다면(Plan D §7), 여기 `onCancel` 스위치는 그 위에 얹는 두 줄이다. `Layers` 아이콘은 `lucide-react` 에 있다.

- [ ] **Step 3: 수동 검증**

1. Mast Post 배치를 3케이스 접수 → UtilityDock 에 카드 1개(⌗ 아이콘, "배치 H600 후보 스캔", `2/3 성공, 1 실패`).
2. 카드의 "중단" 버튼 → `cancelBatch` 호출. 케이스별 카드는 안 뜬다.
3. 배치 완료되면 카드가 회색으로 접히고 몇 초 뒤 자동으로 스택에서 빠진다(기존 정책).

- [ ] **Step 4: 커밋 준비 완료** — 보고: `src/contexts/DashboardContext.jsx`, `src/components/platform/UtilityDock.jsx`.

---

## Task 13: 90일 정리 + 최종 점검

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/cleanup_service.py`(`run_batch_run_cleanup` + `run_all_cleanup` 키)
- Create: `HiTessWorkBenchBackEnd/tests/test_batch_run_cleanup.py`

- [ ] **Step 1: cleanup 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_batch_run_cleanup.py`:

```python
"""배치 90일 정리 — cleanup_service.run_batch_run_cleanup / run_all_cleanup 키(§8)."""
from datetime import datetime, timedelta

from app import database, models
from app.services import cleanup_service

BATCH_RETENTION_DAYS = 90


def _seed(db):
    old = models.BatchRun(
        employee_id="EMP001", program_id="mast-post", name="old",
        total=1, done=1, failed=0, status="Completed",
    )
    old.created_at = datetime.now() - timedelta(days=BATCH_RETENTION_DAYS + 3)
    old.updated_at = old.created_at
    fresh = models.BatchRun(
        employee_id="EMP001", program_id="mast-post", name="fresh",
        total=1, done=1, failed=0, status="Completed",
    )
    fresh.created_at = datetime.now()
    fresh.updated_at = fresh.created_at
    db.add_all([old, fresh])
    db.commit()


def test_dry_run_counts_without_deleting(db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    _seed(db_session)
    result = cleanup_service.run_batch_run_cleanup(dry_run=True)
    assert result["deleted"] >= 1
    assert result["errors"] == []
    assert db_session.query(models.BatchRun).count() == 2


def test_run_deletes_old_batches(db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    _seed(db_session)
    result = cleanup_service.run_batch_run_cleanup()
    assert result["deleted"] >= 1
    db_session.expire_all()
    remaining = [b.name for b in db_session.query(models.BatchRun).all()]
    assert remaining == ["fresh"]


def test_run_all_cleanup_includes_batch_runs(db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    result = cleanup_service.run_all_cleanup(dry_run=True)
    assert "batch_runs" in result
```

- [ ] **Step 2: cleanup 함수 구현** — `app/services/cleanup_service.py`

`run_notification_cleanup` 뒤에 다음을 추가:

```python


BATCH_RETENTION_DAYS = 90


def run_batch_run_cleanup(dry_run: bool = False) -> dict:
    """batch_runs 90일 초과 요약 삭제(§8).

    만료 판정 기준은 batch.updated_at 이 아니라 소속 케이스 중 가장 늦은 시각이다 —
    Plan B 의 retain_until 이 케이스에만 붙어 있어서, 배치 요약이 케이스보다 먼저
    사라지면 MyProjects 화면이 부서진다. 케이스가 하나도 없거나 전부 사라진 배치는
    updated_at 기준으로 정리 대상.
    """
    result = {"deleted": 0, "errors": []}
    db = None
    try:
        db = database.SessionLocal()
        cutoff = datetime.now() - timedelta(days=BATCH_RETENTION_DAYS)
        # 케이스가 없거나, 모든 케이스가 cutoff 이전인 배치를 삭제 대상으로 잡는다.
        candidates = db.query(models.BatchRun).filter(
            models.BatchRun.created_at < cutoff
        ).all()
        expired = []
        for batch in candidates:
            latest = db.query(models.Analysis).filter(
                models.Analysis.batch_id == batch.id
            ).order_by(models.Analysis.updated_at.desc()).first()
            if latest is None or (latest.updated_at or latest.created_at) < cutoff:
                expired.append(batch)
        if dry_run:
            result["deleted"] = len(expired)
        else:
            for batch in expired:
                db.delete(batch)
            db.commit()
            result["deleted"] = len(expired)
        logger.info("[Cleanup] 배치 정리 완료 — 삭제: %d건", result["deleted"])
    except Exception as exc:
        if db is not None:
            try:
                db.rollback()
            except Exception:
                pass
        result["errors"].append(type(exc).__name__)
        logger.error("[Cleanup] 배치 정리 실패 (%s)", type(exc).__name__)
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                logger.warning("[Cleanup] 배치 DB session close failed")
    return result
```

`run_all_cleanup` 을 확장:

```python
def run_all_cleanup(dry_run: bool = False) -> dict:
    result = {
        "user_connection": run_cleanup(dry_run=dry_run),
        "activity_logs": run_activity_log_cleanup(dry_run=dry_run),
        "sessions": run_session_cleanup(dry_run=dry_run),
        "batch_runs": run_batch_run_cleanup(dry_run=dry_run),
    }
    # Plan A 배포본이 있으면 알림도.
    if hasattr(cleanup_service, "run_notification_cleanup"):
        result["notifications"] = run_notification_cleanup(dry_run=dry_run)
    return result
```

- [ ] **Step 3: 백엔드 전체 회귀**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
기대: 실패 0. 신규 파일 6개(`test_batch_run_models`, `test_program_registry_queue_class`, `test_job_manager_pools`, `test_batch_run_service`, `test_batch_run_router`, `test_batch_run_notify`, `test_batch_run_cleanup`) 합계 **60건 내외** 통과.

- [ ] **Step 4: 프론트 순수 유틸 + 빌드**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && node --test src/utils/batchRun.test.js && npm run build
```
기대: `pass 10`, 빌드 성공.

- [ ] **Step 5: 스테이징 점검** — `git status` 에서 `HiTessWorkBench/frontend/src/config.js` 가 변경돼 있으면 **스테이징하지 않는다**(로컬 백엔드 토글). `Darkmode.js/` 미포함 확인.

- [ ] **Step 6: 사용자 보고(커밋은 사용자가 직접)** — 변경 파일 전체 목록(파일 구조 표) + 아래 서버 반영 구분을 그대로 전달.

**서버(145) 반영:**

- **백엔드 — `git pull` + 백엔드 재시작 필수.**
  - 이유: `MAX_CONCURRENT_JOBS` 상수는 상속되지만 **`ManagedAnalysisExecutor` 인스턴스가 새로 만들어져야** 다중 풀이 뜬다. 현행 5-worker 풀은 프로세스 전역이라 코드만 pull 해도 안 갈아탄다.
  - 스키마: `batch_runs` 는 `create_all` 로 자동 생성, `Analysis.batch_id` 는 `schema_bootstrap.ensure_analysis_batch_column()` 이 ALTER 로 붙인다(멱등).
  - 신규 pip 의존성 없음(`requirements.txt` 변경 없음).
- **프론트 — 재배포 필요.** WorkBench 포터블 exe 를 `npm run dist` 로 다시 빌드해 배포(`BatchRunPanel` · MyProjects 그룹 행 · UtilityDock 배치 카드).
- **InHouse 프로그램 — 없음.** 대상 8개 계산기는 모두 파이썬 In-Process 로직이라 exe 교체 없음.

**⚠ 배포 순서**: (1) 백엔드 재시작으로 다중 풀 뜸 확인(`/api/system/queue` 응답의 `pools` 키) → (2) 프론트 exe 재배포 → (3) Mast Post 5케이스 배치로 배포 검증. 순서를 뒤집으면 신규 프론트가 구 백엔드에 `POST /api/analysis/batch` 를 던져 404 가 뜬다.

---

## 자기 검토

- **spec 커버리지**:
  - §3.1 batch_runs 모델 → Task 1
  - §3.2 Analysis.batch_id → Task 1
  - §3.3 ProgramSpec.queue_class → Task 2 (32개 spec 실측 검증 포함)
  - §4.1 job_manager 풀 분리 → Task 3
  - §4.2 batch_run_service (create/mark_case_terminal/get_progress/cancel_batch/promote_batch) → Task 5
  - §4.3 resolve_batch_status → Task 5(순수함수 + 표 테스트 9행)
  - §5.1 _write_through 배치 훅 → Task 6
  - §5.2 batch.completed 알림 → Task 5·6
  - §6 API 4개 → Task 7
  - §7.1 BatchRunPanel → Task 9
  - §7.1 파일럿 통합(Mast Post) → Task 10
  - §7.2 진행률·취소 → Task 9
  - §7.3 MyProjects 그룹 행 → Task 11
  - §7.2 UtilityDock 배치 1카드 → Task 12
  - §8 보관 90일 → Task 13
  - §10 서버 반영 → Task 13 Step 6

- **하드 의존 접점(Plan D)**:
  - `job_status_store.cancel(job_id)` → Task 5 `cancel_batch` · Task 7 `POST /batch/{id}/cancel`
  - `attach_future(job_id, future)` → Task 3 `ManagedAnalysisExecutor.submit`
  - `current_job_id()` → Task 3 `test_first_positional_argument_still_binds_job_id`
  - `TERMINAL_STATUSES` / `Cancelled` 어휘 → Task 5·6
  - `ConfirmDialog` 컴포넌트 → Task 9
  - `_write_through` 확장 지점 → Task 6

- **비목표(spec §11)**: 파일 매트릭스 배치·크로스-프로그램 배치·케이스 간 의존성(DAG)·사용자 쿼터·2개 이상 우선순위 클래스·자동 재시도·배치 템플릿 저장·WebSocket 실시간 케이스 표는 **만들지 않는다**.

- **플레이스홀더 없음**: 모든 코드 step 이 실제 코드다. 프론트는 러너가 없어 수동 절차를 단계·기대 동작으로 적었다.

- **타입/이름 일관성**:
  - `BatchCase(label, input_info)` 는 서비스·라우터 페이로드·프론트 payload 가 동일 키.
  - `notify(kind="batch.completed", link={"menu":"My Projects","params":{"batch_id":…}})` 는 Plan A 의 `resolveNotificationTarget` 이 이해하는 형식(Plan A 는 `analysis_id` 를 특수 처리하고 나머지는 그대로 setCurrentMenu 로 이동).
  - `queue_class` 어휘 `{"heavy","light"}` 는 `KNOWN_QUEUE_CLASSES` 한 곳에만 상수로 있고 program_registry `__post_init__`, `ManagedAnalysisExecutor.submit`, `promote_batch` 가 그 상수를 참조한다.
  - `progressRatio({total, done, failed})` 서명은 서버 응답 스키마와 동일 키.

- **의존 순서**:
  - Task 1(모델) → Task 2(queue_class 필드) → Task 3(풀 분리) → Task 4(_intake 라우팅) → Task 5(배치 서비스) → Task 6(집계 훅) → Task 7(라우터) 는 백엔드 선형.
  - 프론트 Task 8(API+유틸) → Task 9(패널) → Task 10(파일럿) → Task 11(MyProjects) → Task 12(UtilityDock) → Task 13(cleanup+종합).

## 검증된 heavy/light 프로그램 목록

**heavy(21개, 워커 3)** — nastran/Cmb.Cli/PSA/도면 엔진(spec §3.3):
`truss-model-builder` · `truss-assessment` · `bdf-scanner` · `hp-scr-psa` · `hp-scr-por` · `f06-parser` · `mooring-fitting` · `mooring-fitting-solve` · `hitess-modelflow` · `hitess-model-builder` · `model-builder-analysis` · `group-module-unit` · `side-passage` · `hull-acceleration` · `drawing-to-analysis` · `plate-structure` · `double-pipe-fuel-line` · `simple-beam`(JSON 입력이나 내부에서 nastran) · `module-stability`(내부 substep) · `module-hoist-optimize`(내부 substep) · `unit-structural-analysis`(내부 substep)

**light(11개, 워커 4)** — 순수 계산·external-app:
- **배치 대상 8개**(`calculator` + `input_keys=("input_json",)`): `carling-free` · `carling-optimization` · `column-buckling` · `mast-post` · `jib-rest` · `d-type-lug` · `hole-fatigue` · `section-property`
- **external-app 프록시 3개**: `independent-tank` · `block-weld` · `heavy-block-lifting`

**합계 = 32개 = `program_registry.PROGRAM_SPECS` 전량**. 미분류 없음(`test_heavy_and_light_id_sets_are_disjoint_and_cover_all` 실측).
