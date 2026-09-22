# 결과 파일 보관 연장·핀 + 만료 D-7 경고 (Plan B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 `MyProjects` 에서 해석 기록을 **핀 고정**하거나 **최대 180일까지 누적 연장**할 수 있게 하고, `cleanup_service` 가 폴더 나이 하나로만 판정하던 삭제 규칙을 `pinned > retain_until > 폴더 나이` 순서로 바꾼다. 매일 자정 스캔에서 만료 7일 전 폴더의 **대표 해석 1건**에 `notify(kind="retention.expiring", dedupe_key=f"retention:{id}")` 로 알림을 남긴다(알림 센터가 없어도 조용히 건너뛴다). 프론트 행 액션 1개(다이얼로그) + 파일 상태 카드 3장(보관 중 / 7일 내 만료 / 만료) + 상세 모달 만료일 표시.

**Architecture:** 백엔드 — `Analysis` 두 컬럼(`retain_until`, `pinned`) + `schema_bootstrap.ensure_analysis_retention_columns` + **순수 로직 모듈** `services/retention_service.py`(`folder_created_at`, `work_folder_of`, `base_expiry`, `effective_expiry`, `classify`, `retention_state`, `apply_retention_change`, `primary_record`, `decide_folder`, `load_retention_index`) + `cleanup_service.run_cleanup` 판정 교체(`_get_folder_age_days` 폴더명 우선 파싱 fix 포함) + `_notify_expiring` 지연 import + `analysis` 라우터 `POST /analysis/{id}/retention` 신설 및 `_serialize_analysis` 에 `retention` 블록 확장 + `history` `file_status` 어휘 확장(`expiring`/`pinned`) + `_analysis_summary` 에 `expiringSoon`/`pinnedFiles` 추가. 프론트 — `api/analysis.js` `updateAnalysisRetention()` + `StatusBadge.STATUS_META` 확장 + 신규 `components/analysis/RetentionExtendDialog.jsx` + `MyProjects.jsx` 행 액션·스탯 카드·상세 모달·필터 확장.

**Tech Stack:** Python 3.14 / FastAPI / SQLAlchemy(MySQL 운영, SQLite 테스트) / pytest — React 18 + Vite + Tailwind + lucide-react 0.284 + axios. 신규 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-18-result-retention-extend-design.md` (마스터: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1·§2.1·§2.3)

**규칙(마스터 §1):** 커밋은 사용자가 직접 한다 — 각 Task 마지막 단계는 **"커밋 준비 완료 — 변경 파일 목록을 사용자에게 보고"** 다. `HiTessWorkBench/frontend/src/config.js` 는 절대 스테이징하지 않는다. `Darkmode.js/` 는 건드리지 않는다. 백엔드는 TDD(실패 테스트 → 최소 구현 → 통과). 프론트는 러너가 없으므로 수동 검증 절차를 단계로 적는다. 문서·주석·UI 문구는 한국어, 식별자는 영어.

**테스트 실행 위치:** 모든 pytest 명령은 `C:\Coding\WorkBench\HiTessWorkBenchBackEnd` 에서 `WorkBenchEnv/Scripts/python.exe -m pytest tests/<file> -q` 로 실행한다. 프론트 빌드는 `C:\Coding\WorkBench\HiTessWorkBench\frontend` 에서 `npm run build`.

**의존 순서:** 마스터 §3 대로 Plan A(알림 센터) 다음 실행이 이상적이지만, `_notify_expiring` 이 `notification_service.notify` 를 **지연 import** 로만 참조하므로 알림 센터 없이도 이 plan 은 단독으로 동작한다(만료 경고만 조용히 건너뜀). Plan A 가 나중에 들어오면 코드 수정 없이 알림이 켜진다.

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `HiTessWorkBenchBackEnd/app/models.py` | 수정 | `Analysis` 에 `retain_until`, `pinned` 컬럼 추가 |
| `HiTessWorkBenchBackEnd/app/schema_bootstrap.py` | 수정 | `ensure_analysis_retention_columns()` + `run_schema_bootstrap()` 호출 |
| `HiTessWorkBenchBackEnd/app/services/retention_service.py` | 생성 | 판정 순수 로직(폴더명 파싱·만료 계산·연장 상한·`decide_folder`·`load_retention_index`) |
| `HiTessWorkBenchBackEnd/app/services/cleanup_service.py` | 수정 | `_get_folder_age_days` 폴더명 우선 파싱 + `run_cleanup` 판정 교체(핀/연장/skip/delete + D-7 목록 수집) + `_notify_expiring` |
| `HiTessWorkBenchBackEnd/app/routers/analysis.py` | 수정 | `POST /analysis/{id}/retention` 신설, `_serialize_analysis` 에 `retention` 블록, `get_history` 의 `file_status` 어휘 확장, `_analysis_summary` 에 `expiringSoon`/`pinnedFiles` 추가 |
| `HiTessWorkBench/frontend/src/api/analysis.js` | 수정 | `updateAnalysisRetention(analysisId, { extendDays, pinned })` |
| `HiTessWorkBench/frontend/src/components/ui/StatusBadge.jsx` | 수정 | `STATUS_META` 에 `pinned`, `expiring` 추가 |
| `HiTessWorkBench/frontend/src/components/analysis/RetentionExtendDialog.jsx` | 생성 | 연장 30/90일 라디오 + 핀 토글 다이얼로그 |
| `HiTessWorkBench/frontend/src/pages/analysis/MyProjects.jsx` | 수정 | `fileStatusOf` 확장, 파일 상태 카드 3장, 필터 옵션 2개, 행 액션 "보관 연장/핀" + 다이얼로그, 상세 모달 만료일 표시 |
| `HiTessWorkBenchBackEnd/tests/test_schema_bootstrap_retention.py` | 생성 | 레거시 `analysis` 테이블에 두 컬럼 보강, 멱등 |
| `HiTessWorkBenchBackEnd/tests/test_retention_service.py` | 생성 | 순수 로직 계약(폴더명 파싱·`classify`·`decide_folder`·`apply_retention_change`·`primary_record`·`load_retention_index`) |
| `HiTessWorkBenchBackEnd/tests/test_cleanup_retention.py` | 생성 | `_USER_CONN_DIR` 를 `tmp_path` 로 주입한 통합 테스트: 핀/연장/일반 폴더 판정 + D-7 `notify` 호출 + DB 실패 시 삭제 0 |
| `HiTessWorkBenchBackEnd/tests/test_analysis_retention_api.py` | 생성 | `POST /analysis/{id}/retention` 권한·422·409·409·200 · `_serialize_analysis` retention 블록 · `file_status=expiring/pinned` 필터 · `summary.expiringSoon` |

---

### Task 1: 모델 두 컬럼 + `ensure_analysis_retention_columns`

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/models.py:78-94`(`Analysis`)
- Modify: `HiTessWorkBenchBackEnd/app/schema_bootstrap.py:79-88`(뒤에 신규 함수), `:152-160`(`run_schema_bootstrap` 호출)
- Create: `HiTessWorkBenchBackEnd/tests/test_schema_bootstrap_retention.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_schema_bootstrap_retention.py`:

```python
"""Analysis 테이블에 retain_until / pinned 컬럼을 멱등하게 보강하는지 검증한다.

운영 DB(MySQL)에는 두 컬럼이 없다. create_all 로 만드는 신규 테스트 DB에는 처음부터
있고, 운영 DB는 서버 기동 시 ensure_analysis_retention_columns() 가 채운다.
"""
from datetime import datetime

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app import models
from app.schema_bootstrap import ensure_analysis_retention_columns, run_schema_bootstrap


def _sqlite_engine():
    return create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def test_create_all_makes_retention_columns():
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("analysis")}
    assert "retain_until" in cols
    assert "pinned" in cols


def test_pinned_default_is_false(db_session):
    a = models.Analysis(employee_id="EMP001", program_name="Truss Assessment",
                        project_name="p", status="Success",
                        created_at=datetime(2026, 9, 18, 9, 0, 0))
    db_session.add(a)
    db_session.commit()
    db_session.refresh(a)
    assert a.pinned is False
    assert a.retain_until is None


def test_bootstrap_adds_missing_retention_columns():
    """운영 DB 처럼 analysis 테이블에 두 컬럼이 없어도 bootstrap 이 채운다(멱등)."""
    engine = _sqlite_engine()
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE analysis ("
            " id INTEGER PRIMARY KEY, job_id VARCHAR(50),"
            " project_name VARCHAR(200), program_name VARCHAR(100),"
            " employee_id VARCHAR(50), status VARCHAR(50),"
            " job_status VARCHAR(20), progress INTEGER, job_message TEXT,"
            " input_info JSON, result_info JSON, source VARCHAR(50),"
            " created_at DATETIME, started_at DATETIME, updated_at DATETIME)"
        ))

    ensure_analysis_retention_columns(engine=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("analysis")}
    assert {"retain_until", "pinned"} <= cols

    # 두 번 돌려도 예외 없이 같은 결과
    ensure_analysis_retention_columns(engine=engine)
    assert {c["name"] for c in inspect(engine).get_columns("analysis")} == cols


def test_run_schema_bootstrap_calls_retention_bootstrap(monkeypatch):
    called = []
    import app.schema_bootstrap as sb
    monkeypatch.setattr(sb, "ensure_analysis_retention_columns",
                        lambda *, engine=None: called.append("r"))
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    run_schema_bootstrap(engine=engine)
    assert called == ["r"]
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_schema_bootstrap_retention.py -q
```
기대: `ImportError: cannot import name 'ensure_analysis_retention_columns'` 로 수집 단계 실패(`1 error`).

- [ ] **Step 3: 모델 컬럼 추가** — `app/models.py:78-94` 의 `Analysis` 를 아래로 교체(들여쓰기 2칸 유지):

```python
class Analysis(Base):
  __tablename__ = "analysis"
  id = Column(Integer, primary_key=True, index=True)
  job_id = Column(String(50), unique=True, index=True, nullable=True)
  project_name = Column(String(200), nullable=True)
  program_name = Column(String(100))
  employee_id = Column(String(50), index=True)
  status = Column(String(50))
  job_status = Column(String(20), default="completed")
  progress = Column(Integer, default=100)
  job_message = Column(Text, nullable=True)
  input_info = Column(JSON)
  result_info = Column(JSON)
  source = Column(String(50), default="Workbench")
  created_at = Column(DateTime(timezone=True), server_default=func.now())
  started_at = Column(DateTime(timezone=True), nullable=True)
  updated_at = Column(DateTime(timezone=True), nullable=True)
  # Plan B — 결과 파일 보관 정책. 판정 우선순위: pinned > retain_until > 폴더 나이(30일).
  # retain_until 은 연장된 만료 시각(없으면 폴더 생성+30일 규칙), pinned=True 면 자동 삭제 제외.
  # created_at 과 마찬가지로 naive datetime 으로 비교한다(라우터 replace(tzinfo=None) 패턴).
  retain_until = Column(DateTime(timezone=True), nullable=True)
  pinned = Column(Boolean, default=False, nullable=False)
```

- [ ] **Step 4: 부트스트랩 함수 추가** — `app/schema_bootstrap.py` 의 `ensure_analysis_job_columns`(79~87행) 바로 아래에:

```python


def ensure_analysis_retention_columns(*, engine=None) -> None:
    """analysis 테이블에 결과 보관 정책 컬럼(retain_until, pinned)을 멱등하게 보강한다.

    운영 DB(MySQL)에는 두 컬럼이 없다. 서버 기동 시 ALTER TABLE 로 채워 넣어야 하며,
    없으면 이력 조회 응답 직렬화 단계에서 500 이 난다(마스터 규약 §1.3).

    pinned 는 NOT NULL DEFAULT FALSE 로 만들어 기존 행이 즉시 False 를 얻게 하고,
    retain_until 은 NULL 허용(연장 안 된 기록).
    """
    _add_missing_columns("analysis", {
        "retain_until": "ALTER TABLE analysis ADD COLUMN retain_until DATETIME NULL",
        "pinned": "ALTER TABLE analysis ADD COLUMN pinned BOOL NOT NULL DEFAULT FALSE",
    }, engine=engine)
```

그리고 `run_schema_bootstrap()`(152~160행)의 `ensure_analysis_job_columns(engine=engine)` 다음 줄에 호출을 추가:

```python
    ensure_analysis_job_columns(engine=engine)
    ensure_analysis_retention_columns(engine=engine)
    ensure_app_community_columns(engine=engine)
```

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_schema_bootstrap_retention.py -q
```
기대: `4 passed`.

전체 회귀(모델 변경이라 한 번 돈다):
```
WorkBenchEnv/Scripts/python.exe -m pytest tests -q -x
```
기대: 기존 전부 통과(실패 0). `make_analysis` fixture 는 새 컬럼을 채우지 않지만 두 값 모두 기본값이 있어(retain_until=None, pinned=False) 회귀는 없다.

- [ ] **Step 6: 커밋 준비 완료** — 변경 파일 목록을 사용자에게 보고: `app/models.py`, `app/schema_bootstrap.py`, `tests/test_schema_bootstrap_retention.py`.

---

### Task 2: `retention_service` 순수 로직 모듈 + `cleanup_service` 판정 교체

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/retention_service.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/cleanup_service.py:15-17`(import), `:36-58`(`_get_folder_age_days`), `:120-185`(`run_cleanup`)
- Create: `HiTessWorkBenchBackEnd/tests/test_retention_service.py`
- Create: `HiTessWorkBenchBackEnd/tests/test_cleanup_retention.py`(D-7 알림 부분은 Task 3 에서 채운다 — 이 Task 는 판정 부분까지)

- [ ] **Step 1: 순수 로직 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_retention_service.py`:

```python
"""retention_service — 폴더명 파싱·만료 계산·연장 상한·decide_folder·load_retention_index."""
from datetime import datetime, timedelta

import pytest

from app import models
from app.services import retention_service as rs
from app.services.retention_service import (
    EXPIRING_SOON_DAYS,
    EXTEND_CHOICES,
    EXTENSION_MAX_DAYS,
    RETENTION_DAYS,
    RetentionLimitError,
    apply_retention_change,
    base_expiry,
    classify,
    days_left,
    decide_folder,
    effective_expiry,
    extension_used_days,
    folder_created_at,
    load_retention_index,
    primary_record,
    retention_state,
    work_folder_of,
)


# ── 상수 ────────────────────────────────────────────────────────────────────

def test_constants_match_spec():
    """마스터 §2.3 확정값 — 다른 plan 이 이 상수를 읽는다."""
    assert RETENTION_DAYS == 30
    assert EXTENSION_MAX_DAYS == 180
    assert EXPIRING_SOON_DAYS == 7
    assert EXTEND_CHOICES == (30, 90)


# ── 폴더명 → 생성 시각 ─────────────────────────────────────────────────────

def test_folder_created_at_parses_workspace_pattern():
    """`YYYYMMDD_HHMMSS_<eid>_<prog>` — workspace.py 가 만드는 표준 이름."""
    got = folder_created_at("20260918_085221_A476854_SidePassage")
    assert got == datetime(2026, 9, 18, 8, 52, 21)


def test_folder_created_at_parses_underscore_variants():
    """이름에 언더스코어가 여러 개여도 앞 15자만 본다."""
    got = folder_created_at("20260918_085221_A476854_HiTess_Model_Builder_something")
    assert got == datetime(2026, 9, 18, 8, 52, 21)


def test_folder_created_at_returns_none_for_non_matching():
    assert folder_created_at("random_folder") is None
    assert folder_created_at("20260918-085221_EMP") is None  # 하이픈
    assert folder_created_at("20261332_085221_EMP_SidePassage") is None  # 13월


# ── 기록 → work_folder ─────────────────────────────────────────────────────

def _record(program="Truss Assessment", employee="EMP001",
            input_info=None, result_info=None, retain_until=None, pinned=False,
            created_at=datetime(2026, 8, 20, 9, 0, 0), rid=1):
    a = models.Analysis(
        id=rid, program_name=program, employee_id=employee,
        project_name="proj", status="Success",
        input_info=input_info or {}, result_info=result_info or {},
        created_at=created_at, retain_until=retain_until, pinned=pinned,
    )
    return a


def test_work_folder_of_prefers_input_info_first_path():
    base = r"C:\Coding\WorkBench\HiTessWorkBenchBackEnd\userConnection"
    rec = _record(input_info={
        "bdf_file": rf"{base}\20260820_090000_EMP001_TrussAssessment\model.bdf",
    })
    assert work_folder_of(rec, base) == "20260820_090000_EMP001_TrussAssessment"


def test_work_folder_of_falls_back_to_result_info():
    base = r"C:\Coding\WorkBench\HiTessWorkBenchBackEnd\userConnection"
    rec = _record(
        input_info={"note": "no path"},
        result_info={"f06": rf"{base}\20260820_090000_EMP001_TrussAssessment\out.f06"},
    )
    assert work_folder_of(rec, base) == "20260820_090000_EMP001_TrussAssessment"


def test_work_folder_of_returns_none_when_no_userconnection_path():
    base = r"C:\Coding\WorkBench\HiTessWorkBenchBackEnd\userConnection"
    rec = _record(input_info={"note": "text"}, result_info={"other": r"C:\other\file.txt"})
    assert work_folder_of(rec, base) is None


# ── 만료 계산 ──────────────────────────────────────────────────────────────

def test_base_expiry_uses_folder_timestamp_when_available():
    rec = _record(created_at=datetime(2026, 8, 20, 10, 0, 0))
    got = base_expiry(rec, "20260818_090000_EMP001_TrussAssessment")
    assert got == datetime(2026, 8, 18, 9, 0, 0) + timedelta(days=RETENTION_DAYS)


def test_base_expiry_falls_back_to_created_at_when_folder_missing():
    rec = _record(created_at=datetime(2026, 8, 20, 10, 0, 0))
    got = base_expiry(rec, None)
    assert got == datetime(2026, 8, 20, 10, 0, 0) + timedelta(days=RETENTION_DAYS)


def test_effective_expiry_priority_pinned_over_retain_until():
    """D1: pinned > retain_until > base."""
    later = datetime(2026, 12, 25, 0, 0, 0)
    rec = _record(pinned=True, retain_until=later)
    assert effective_expiry(rec, "20260820_090000_EMP001_TA") is None  # 영구


def test_effective_expiry_uses_retain_until_when_set():
    rec = _record(pinned=False, retain_until=datetime(2026, 10, 20, 0, 0, 0))
    assert effective_expiry(rec, "20260820_090000_EMP001_TA") == datetime(2026, 10, 20, 0, 0, 0)


def test_effective_expiry_falls_through_to_base():
    rec = _record(pinned=False, retain_until=None,
                  created_at=datetime(2026, 8, 20, 0, 0, 0))
    assert effective_expiry(rec, "20260820_090000_EMP001_TA") == datetime(2026, 9, 19, 0, 0, 0)


def test_extension_used_days_measures_from_base():
    rec = _record(
        retain_until=datetime(2026, 8, 20, 0, 0, 0) + timedelta(days=RETENTION_DAYS + 45),
        created_at=datetime(2026, 8, 20, 0, 0, 0),
    )
    assert extension_used_days(rec, "20260820_000000_EMP001_TA") == 45


def test_extension_used_days_zero_when_no_retain_until():
    rec = _record(retain_until=None)
    assert extension_used_days(rec, "20260820_090000_EMP001_TA") == 0


def test_days_left_returns_none_for_none_expiry():
    assert days_left(None, datetime(2026, 9, 18)) is None


def test_days_left_rounds_up():
    now = datetime(2026, 9, 18, 12, 0, 0)
    # 만료가 3.5일 남으면 4일로 표시 — UI 는 남은 "일"을 하루 단위로 보여줘야 오해가 없다.
    assert days_left(now + timedelta(days=3, hours=12), now) == 4
    assert days_left(now, now) == 0
    assert days_left(now - timedelta(days=1), now) == -1


# ── classify ──────────────────────────────────────────────────────────────

def test_classify_expired_takes_precedence_over_pinned():
    """파일이 이미 없으면 무엇이든 expired — 되돌릴 수 없는 상태."""
    rec = _record(pinned=True)
    got = classify(rec, "20260820_090000_EMP001_TA",
                   files_available=False, now=datetime(2026, 9, 18))
    assert got == "expired"


def test_classify_pinned_shows_pinned_when_files_present():
    rec = _record(pinned=True)
    got = classify(rec, "20260820_090000_EMP001_TA",
                   files_available=True, now=datetime(2026, 9, 18))
    assert got == "pinned"


def test_classify_expiring_within_seven_days():
    now = datetime(2026, 9, 18)
    rec = _record(created_at=now - timedelta(days=25))  # 만료 5일 남음
    got = classify(rec, "20260824_090000_EMP001_TA", files_available=True, now=now)
    assert got == "expiring"


def test_classify_available_when_far_from_expiry():
    now = datetime(2026, 9, 18)
    rec = _record(created_at=now - timedelta(days=10))
    got = classify(rec, "20260908_090000_EMP001_TA", files_available=True, now=now)
    assert got == "available"


# ── retention_state (직렬화) ───────────────────────────────────────────────

def test_retention_state_shape_for_available():
    now = datetime(2026, 9, 18)
    rec = _record(created_at=now - timedelta(days=10))
    state = retention_state(rec, "20260908_090000_EMP001_TA",
                            files_available=True, now=now)
    assert state["status"] == "available"
    assert state["pinned"] is False
    assert state["retain_until"] is None
    assert state["base_expires_at"] == (now - timedelta(days=10) + timedelta(days=30)).isoformat()
    assert state["expires_at"] == state["base_expires_at"]
    assert state["days_left"] == 20
    assert state["extension_used_days"] == 0
    assert state["extension_remaining_days"] == EXTENSION_MAX_DAYS


def test_retention_state_shape_for_pinned():
    now = datetime(2026, 9, 18)
    rec = _record(created_at=now - timedelta(days=10), pinned=True)
    state = retention_state(rec, "20260908_090000_EMP001_TA",
                            files_available=True, now=now)
    assert state["status"] == "pinned"
    assert state["pinned"] is True
    assert state["expires_at"] is None
    assert state["days_left"] is None


# ── apply_retention_change ─────────────────────────────────────────────────

def test_apply_retention_change_extends_from_current_expiry():
    now = datetime(2026, 9, 18)
    rec = _record(created_at=datetime(2026, 8, 20))  # 기본 만료 2026-09-19
    apply_retention_change(rec, "20260820_000000_EMP001_TA",
                           extend_days=30, pinned=None, now=now)
    assert rec.retain_until == datetime(2026, 9, 19) + timedelta(days=30)


def test_apply_retention_change_from_expired_uses_now_as_base():
    """이미 만료된 시각을 기준으로 잡으면 '지금부터 30일' 이 아니라 '과거+30일'이 돼 즉시 재만료된다."""
    now = datetime(2026, 10, 15)  # 기본 만료(2026-09-19) 이후
    rec = _record(created_at=datetime(2026, 8, 20))
    apply_retention_change(rec, "20260820_000000_EMP001_TA",
                           extend_days=30, pinned=None, now=now)
    assert rec.retain_until == now + timedelta(days=30)


def test_apply_retention_change_raises_when_cumulative_exceeds_180():
    now = datetime(2026, 9, 18)
    rec = _record(created_at=datetime(2026, 8, 20),
                  retain_until=datetime(2026, 9, 19) + timedelta(days=160))
    with pytest.raises(RetentionLimitError):
        apply_retention_change(rec, "20260820_000000_EMP001_TA",
                               extend_days=30, pinned=None, now=now)


def test_apply_retention_change_at_exactly_180_is_ok():
    now = datetime(2026, 9, 18)
    rec = _record(created_at=datetime(2026, 8, 20),
                  retain_until=datetime(2026, 9, 19) + timedelta(days=150))
    apply_retention_change(rec, "20260820_000000_EMP001_TA",
                           extend_days=30, pinned=None, now=now)
    assert extension_used_days(rec, "20260820_000000_EMP001_TA") == 180


def test_apply_retention_change_toggles_pinned_only_when_bool():
    now = datetime(2026, 9, 18)
    rec = _record()
    apply_retention_change(rec, "20260820_000000_EMP001_TA",
                           extend_days=None, pinned=True, now=now)
    assert rec.pinned is True
    apply_retention_change(rec, "20260820_000000_EMP001_TA",
                           extend_days=None, pinned=None, now=now)
    assert rec.pinned is True   # None 은 유지
    apply_retention_change(rec, "20260820_000000_EMP001_TA",
                           extend_days=None, pinned=False, now=now)
    assert rec.pinned is False


# ── primary_record / decide_folder (D5·D7) ────────────────────────────────

def test_primary_record_prefers_non_internal_substep():
    """SidePassage/GroupModuleUnit 하나의 폴더에 부모+하위단계가 섞일 수 있다."""
    parent = _record(program="SidePassage", rid=100)
    substep = _record(program="ModuleStability", rid=101)
    # 하위 단계가 id 가 더 커도 부모가 대표.
    assert primary_record([substep, parent]).id == 100


def test_primary_record_falls_back_to_min_id_when_all_internal():
    substep_a = _record(program="ModuleStability", rid=50)
    substep_b = _record(program="ModuleHoistOptimize", rid=51)
    assert primary_record([substep_b, substep_a]).id == 50


def test_decide_folder_keep_pinned():
    rec = _record(pinned=True)
    d = decide_folder("20260820_090000_EMP001_TA", [rec],
                      folder_age_days=100.0, now=datetime(2026, 12, 1))
    assert d.action == "keep_pinned"
    assert d.expires_at is None
    assert d.record is rec


def test_decide_folder_keep_extended_when_retain_until_in_future():
    rec = _record(retain_until=datetime(2027, 1, 1))
    d = decide_folder("20260820_090000_EMP001_TA", [rec],
                      folder_age_days=60.0, now=datetime(2026, 12, 1))
    assert d.action == "keep_extended"
    assert d.expires_at == datetime(2027, 1, 1)


def test_decide_folder_delete_when_retain_until_in_past():
    rec = _record(retain_until=datetime(2026, 11, 20))
    d = decide_folder("20260820_090000_EMP001_TA", [rec],
                      folder_age_days=100.0, now=datetime(2026, 12, 1))
    assert d.action == "delete"


def test_decide_folder_delete_when_no_records_and_age_over_30():
    d = decide_folder("20260820_090000_EMP001_TA", [],
                      folder_age_days=45.0, now=datetime(2026, 10, 5))
    assert d.action == "delete"


def test_decide_folder_keep_when_no_records_and_age_under_30():
    d = decide_folder("20260820_090000_EMP001_TA", [],
                      folder_age_days=10.0, now=datetime(2026, 8, 30))
    assert d.action == "keep"


def test_decide_folder_uses_max_retain_until_across_records():
    """D5: 한 폴더에 여러 기록이면 만료는 그 최대치."""
    parent = _record(rid=100, retain_until=datetime(2026, 10, 1))
    child = _record(rid=101, retain_until=datetime(2026, 11, 1), program="ModuleStability")
    d = decide_folder("20260820_090000_EMP001_TA", [parent, child],
                      folder_age_days=45.0, now=datetime(2026, 10, 15))
    assert d.action == "keep_extended"
    assert d.expires_at == datetime(2026, 11, 1)
    # 대표는 부모(하위 단계가 아닌 기록)
    assert d.record is parent


# ── load_retention_index ───────────────────────────────────────────────────

def test_load_retention_index_groups_by_work_folder(db_session, make_analysis):
    now = datetime(2026, 9, 18)
    base = r"C:\test\userConnection"
    a = make_analysis("EMP001", "SidePassage", now - timedelta(days=25))
    a.input_info = {"bdf": rf"{base}\20260824_090000_EMP001_SidePassage\struData.bdf"}
    a.pinned = False
    b = make_analysis("EMP001", "ModuleStability", now - timedelta(days=25))
    b.input_info = {"bdf": rf"{base}\20260824_090000_EMP001_SidePassage\struData.bdf"}
    # 무관 폴더(핀 or retain_until 도 없고 D-7 창도 아님) — 인덱스에 안 나온다.
    make_analysis("EMP001", "Truss Assessment", now - timedelta(days=1))
    db_session.commit()

    idx = load_retention_index(db_session, base, now=now)
    assert set(idx) == {"20260824_090000_EMP001_SidePassage"}
    assert {r.id for r in idx["20260824_090000_EMP001_SidePassage"]} == {a.id, b.id}
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_retention_service.py -q
```
기대: `ModuleNotFoundError: No module named 'app.services.retention_service'` (`1 error`).

- [ ] **Step 3: 순수 로직 모듈 구현** — `HiTessWorkBenchBackEnd/app/services/retention_service.py`:

```python
"""결과 파일 보관 정책 순수 로직 — 라우터와 cleanup_service 가 같은 판정을 쓴다.

FastAPI·파일 삭제·알림에 의존하지 않는다. 그래서 어느 쪽에서 import 해도 순환이 없고,
테스트도 인메모리 datetime 만으로 검증한다.

용어
----
- work_folder      : ``userConnection/<YYYYMMDD_HHMMSS_<eid>_<program>>``. 실제 작업 파일이 사는 폴더.
- base_expiry      : 폴더 생성 시각 + 30일. 폴더명을 못 읽으면 record.created_at 로 폴백.
- effective_expiry : pinned → None, retain_until 있으면 그 값, 아니면 base_expiry.
- 판정 우선순위    : pinned > retain_until > 폴더 나이(30일).  — spec §2 D1
"""
from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models
from .program_registry import internal_substep_programs

# ── 상수(마스터 §2.3 확정값) ────────────────────────────────────────────
RETENTION_DAYS = 30            # 기본 보관 기간(cleanup_service.RETENTION_DAYS 와 같은 값을 유지)
EXTENSION_MAX_DAYS = 180       # 누적 연장 상한 — base_expiry 로부터의 최대 추가 일수
EXPIRING_SOON_DAYS = 7         # 만료 D-7 창(자정 스캔 알림 대상)
EXTEND_CHOICES = (30, 90)      # UI 라디오 선택지

# workspace.create_analysis_workspace 규약: YYYYMMDD_HHMMSS_<eid>_<program>
_FOLDER_TS_RE = re.compile(r"^(\d{8})_(\d{6})_")


class RetentionLimitError(ValueError):
    """연장 누적이 EXTENSION_MAX_DAYS 를 넘으면 발생. 라우터가 400 으로 매핑한다."""


# ── 폴더명 → 생성 시각 ─────────────────────────────────────────────────
def folder_created_at(folder_name: str) -> datetime | None:
    """`YYYYMMDD_HHMMSS_<eid>_<program>` → datetime. 실패 시 None.

    cleanup_service._get_folder_age_days 의 기존 파서 결함(prefix.split('_')[0] 이 8자리라
    len==14 검사에 걸려 stat 폴백으로 떨어짐)을 보완한 정확 구현이다.
    """
    if not isinstance(folder_name, str):
        return None
    match = _FOLDER_TS_RE.match(folder_name)
    if not match:
        return None
    stamp = f"{match.group(1)}_{match.group(2)}"
    try:
        return datetime.strptime(stamp, "%Y%m%d_%H%M%S")
    except ValueError:
        return None


# ── 기록 → work_folder ─────────────────────────────────────────────────
def work_folder_of(record: models.Analysis, user_connection_dir: str) -> str | None:
    """input_info→result_info 순으로 첫 번째 userConnection 하위 경로의 최상위 폴더명."""
    base_abs = os.path.abspath(user_connection_dir)
    base_norm = os.path.normcase(base_abs)
    for info in (record.input_info, record.result_info):
        if not isinstance(info, dict):
            continue
        for value in info.values():
            if not isinstance(value, str) or not value:
                continue
            path_abs = os.path.abspath(value)
            path_norm = os.path.normcase(path_abs)
            if not path_norm.startswith(base_norm + os.sep):
                continue
            rel = os.path.relpath(path_abs, base_abs)
            first = rel.split(os.sep, 1)[0]
            if first and first not in (".", ".."):
                return first
    return None


# ── 만료 계산 ──────────────────────────────────────────────────────────
def _naive(dt: datetime | None) -> datetime | None:
    """MySQL DATETIME 은 naive 로 저장되며, 라우터도 replace(tzinfo=None) 로 벗겨 쓴다.
    라우터·cleanup·판정이 같은 시간축을 쓰도록 여기서 tzinfo 를 제거한다."""
    if dt is None:
        return None
    return dt.replace(tzinfo=None) if getattr(dt, "tzinfo", None) else dt


def base_expiry(record: models.Analysis, folder_name: str | None) -> datetime:
    created = folder_created_at(folder_name) if folder_name else None
    if created is None:
        created = _naive(record.created_at) or datetime.now()
    return created + timedelta(days=RETENTION_DAYS)


def effective_expiry(record: models.Analysis, folder_name: str | None) -> datetime | None:
    if record.pinned:
        return None
    if record.retain_until is not None:
        return _naive(record.retain_until)
    return base_expiry(record, folder_name)


def extension_used_days(record: models.Analysis, folder_name: str | None) -> int:
    if record.retain_until is None:
        return 0
    delta = _naive(record.retain_until) - base_expiry(record, folder_name)
    return max(0, math.ceil(delta.total_seconds() / 86400))


def days_left(expiry: datetime | None, now: datetime) -> int | None:
    if expiry is None:
        return None
    return math.ceil((expiry - now).total_seconds() / 86400)


# ── classify / retention_state ─────────────────────────────────────────
def classify(record, folder_name, *, files_available, now):
    if not files_available:
        return "expired"
    if record.pinned:
        return "pinned"
    left = days_left(effective_expiry(record, folder_name), now)
    if left is not None and left <= EXPIRING_SOON_DAYS:
        return "expiring"
    return "available"


def retention_state(record, folder_name, *, files_available, now) -> dict:
    status = classify(record, folder_name, files_available=files_available, now=now)
    base = base_expiry(record, folder_name)
    expires = effective_expiry(record, folder_name)
    used = extension_used_days(record, folder_name)
    return {
        "status": status,
        "pinned": bool(record.pinned),
        "retain_until": record.retain_until.isoformat() if record.retain_until else None,
        "base_expires_at": base.isoformat(),
        "expires_at": expires.isoformat() if expires else None,
        "days_left": days_left(expires, now),
        "extension_used_days": used,
        "extension_remaining_days": max(0, EXTENSION_MAX_DAYS - used),
    }


# ── apply_retention_change ─────────────────────────────────────────────
def apply_retention_change(record, folder_name, *, extend_days, pinned, now) -> None:
    """record 를 in-place 로 갱신한다. commit 은 호출자 책임.

    - extend_days=None → 연장 없음. 정수면 1~180 범위여야 하고 누적 상한을 넘으면 RetentionLimitError.
    - pinned=None → 변경 없음. True/False 면 그 값으로 설정.
    - 이미 만료된 시각을 기준으로 잡으면 즉시 재만료되므로 max(현재 만료, now) + extend_days 로 계산한다.
    """
    if extend_days is not None:
        if not isinstance(extend_days, int) or extend_days < 1 or extend_days > EXTENSION_MAX_DAYS:
            raise ValueError(f"extend_days out of range: {extend_days!r}")
        current = effective_expiry(record, folder_name) or now
        anchor = max(current, now)
        record.retain_until = anchor + timedelta(days=extend_days)
        used = extension_used_days(record, folder_name)
        if used > EXTENSION_MAX_DAYS:
            # 이 요청 시도가 상한을 넘겼다 — 이전 값 복원은 호출자가 rollback 으로 처리.
            raise RetentionLimitError(
                f"누적 연장이 {EXTENSION_MAX_DAYS}일을 초과합니다 (요청 후 {used}일)."
            )
    if pinned is not None:
        record.pinned = bool(pinned)


# ── primary_record / decide_folder ─────────────────────────────────────
@dataclass(frozen=True)
class FolderDecision:
    action: str                  # "keep_pinned" | "keep_extended" | "keep" | "delete"
    expires_at: datetime | None
    days_left: int | None
    record: models.Analysis | None


def primary_record(records):
    """spec §2 D5·D7: 하위 단계가 아닌 기록 우선, 그중 id 최소.

    ModuleStability/ModuleHoistOptimize/UnitStructuralAnalysis 같은 내부 단계는 부모
    (SidePassage/GroupModuleUnit) 폴더의 경로를 그대로 가리키므로 알림을 이들 각각에
    보내면 같은 폴더에 여러 개가 쌓인다. 사용자에게 보이는 기록에만 보낸다.
    """
    internal = frozenset(internal_substep_programs())
    non_internal = [r for r in records if r.program_name not in internal]
    pool = non_internal if non_internal else list(records)
    if not pool:
        return None
    return min(pool, key=lambda r: r.id)


def decide_folder(folder_name, records, *, folder_age_days, now) -> FolderDecision:
    """폴더 하나에 대한 삭제/보존 판정. spec §2 D1·D5·D6 구현."""
    if records:
        if any(r.pinned for r in records):
            pinned_rec = next(r for r in records if r.pinned)
            return FolderDecision("keep_pinned", None, None, pinned_rec)
        with_retain = [r for r in records if r.retain_until is not None]
        if with_retain:
            expires = max(_naive(r.retain_until) for r in with_retain)
            left = days_left(expires, now)
            rep = primary_record(records)
            if expires > now:
                return FolderDecision("keep_extended", expires, left, rep)
            return FolderDecision("delete", expires, left, rep)
    # 폴더 나이 규칙 (records 가 없거나, 있어도 pinned/retain_until 모두 없음)
    if folder_age_days < RETENTION_DAYS:
        rep = primary_record(records) if records else None
        # 대표 기록의 base_expiry 로 days_left 를 계산해 D-7 알림 판정에 쓸 수 있게 한다.
        if rep is not None:
            expires = base_expiry(rep, folder_name)
            return FolderDecision("keep", expires, days_left(expires, now), rep)
        return FolderDecision("keep", None, None, None)
    return FolderDecision("delete", None, None, primary_record(records) if records else None)


# ── load_retention_index ───────────────────────────────────────────────
def load_retention_index(db: Session, user_connection_dir: str, *, now) -> dict:
    """보호(pinned/retain_until) 또는 D-7 창(기본 만료 7일 이내)에 든 기록만 폴더명으로 묶는다.

    무관한 오래된 기록까지 읽지 않도록 3-way OR 로 한 번에 조회한다. `created_at BETWEEN
    now−31일 AND now−22일` 은 폴더 생성이 record.created_at 과 초 단위 차이라 근사로 충분하고,
    폴더명이 있으면 decide_folder 가 정확한 시각으로 재판정한다.
    """
    from_dt = now - timedelta(days=RETENTION_DAYS + 1)
    to_dt = now - timedelta(days=RETENTION_DAYS - EXPIRING_SOON_DAYS - 1)
    q = db.query(models.Analysis).filter(
        or_(
            models.Analysis.pinned.is_(True),
            models.Analysis.retain_until.isnot(None),
            models.Analysis.created_at.between(from_dt, to_dt),
        )
    )
    index: dict[str, list[models.Analysis]] = {}
    for record in q.all():
        folder = work_folder_of(record, user_connection_dir)
        if folder is None:
            continue
        index.setdefault(folder, []).append(record)
    return index
```

- [ ] **Step 4: 통과 확인 (순수 로직만)**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_retention_service.py -q
```
기대: `29 passed`.

- [ ] **Step 5: cleanup 테스트(판정 부분) 작성**

`HiTessWorkBenchBackEnd/tests/test_cleanup_retention.py`:

```python
"""run_cleanup 이 pinned / retain_until / 폴더 나이 순서로 판정하는지 검증한다.

- _USER_CONN_DIR 를 tmp_path 로 monkeypatch 해 실제 폴더를 만들고 지운다.
- database.SessionLocal 을 conftest 의 인메모리 세션으로 바꿔 retention_service 가
  같은 세션을 보게 한다.
- 알림(_notify_expiring) 은 Task 3 에서 채운다 — 이 파일의 D-7 관련 테스트는 그때 함께 통과.
"""
from datetime import datetime, timedelta
from pathlib import Path

from app import database, models
from app.services import cleanup_service


def _make_folder(root: Path, folder: str) -> Path:
    p = root / folder
    p.mkdir()
    (p / "marker.txt").write_text("x", encoding="utf-8")
    return p


def _seed(db, employee_id, folder_name, program, work_root, **overrides):
    """work_folder_of 가 잡을 수 있는 input_info 경로를 넣어 준다."""
    bdf_path = str(Path(work_root) / folder_name / "input.bdf")
    rec = models.Analysis(
        employee_id=employee_id, program_name=program,
        project_name="proj", status="Success",
        input_info={"bdf_file": bdf_path},
        created_at=overrides.get("created_at", datetime.now() - timedelta(days=25)),
        retain_until=overrides.get("retain_until"),
        pinned=overrides.get("pinned", False),
    )
    db.add(rec)
    db.commit()
    return rec


def test_pinned_folder_is_skipped_even_when_60_days_old(
    tmp_path, db_session, monkeypatch
):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))

    # 폴더는 60일 전 이름을 갖는다.
    stamp = (datetime.now() - timedelta(days=60)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_TrussAssessment"
    _make_folder(tmp_path, folder)
    _seed(db_session, "EMP001", folder, "Truss Assessment", tmp_path,
          created_at=datetime.now() - timedelta(days=60), pinned=True)

    result = cleanup_service.run_cleanup()

    assert result["deleted"] == []
    assert result["pinned"] == 1
    assert (tmp_path / folder).is_dir()


def test_retain_until_in_future_is_kept():
    """extended 로 분류돼 실제 폴더는 보존된다."""


def test_retain_until_in_future_is_kept(tmp_path, db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))

    stamp = (datetime.now() - timedelta(days=45)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_TrussAssessment"
    _make_folder(tmp_path, folder)
    _seed(db_session, "EMP001", folder, "Truss Assessment", tmp_path,
          created_at=datetime.now() - timedelta(days=45),
          retain_until=datetime.now() + timedelta(days=30))

    result = cleanup_service.run_cleanup()
    assert result["deleted"] == []
    assert result["extended"] == 1
    assert (tmp_path / folder).is_dir()


def test_retain_until_in_past_is_deleted(tmp_path, db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))

    stamp = (datetime.now() - timedelta(days=45)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_TrussAssessment"
    _make_folder(tmp_path, folder)
    _seed(db_session, "EMP001", folder, "Truss Assessment", tmp_path,
          created_at=datetime.now() - timedelta(days=45),
          retain_until=datetime.now() - timedelta(days=1))

    result = cleanup_service.run_cleanup()
    assert [d["folder"] for d in result["deleted"]] == [folder]
    assert not (tmp_path / folder).exists()


def test_ordinary_folder_over_30_days_is_deleted(tmp_path, db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))

    stamp = (datetime.now() - timedelta(days=40)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_TrussAssessment"
    _make_folder(tmp_path, folder)
    # 기록을 심지 않아도 (인덱스에 안 나와도) 폴더 나이가 30일을 넘으면 삭제된다.

    result = cleanup_service.run_cleanup()
    assert [d["folder"] for d in result["deleted"]] == [folder]
    assert not (tmp_path / folder).exists()


def test_folder_age_uses_folder_timestamp_over_stat(tmp_path, db_session, monkeypatch):
    """폴더명이 60일 전이지만 폴더 stat 은 방금 만든 것 — 새 파서는 폴더명을 우선한다."""
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))

    stamp = (datetime.now() - timedelta(days=60)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_TrussAssessment"
    _make_folder(tmp_path, folder)

    result = cleanup_service.run_cleanup()
    assert [d["folder"] for d in result["deleted"]] == [folder]


def test_dry_run_does_not_delete(tmp_path, db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))

    stamp = (datetime.now() - timedelta(days=40)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_TrussAssessment"
    _make_folder(tmp_path, folder)

    result = cleanup_service.run_cleanup(dry_run=True)
    assert [d["folder"] for d in result["deleted"]] == [folder]
    assert (tmp_path / folder).is_dir()


def test_db_failure_deletes_nothing(tmp_path, monkeypatch):
    """D6: 보호 인덱스를 못 읽으면 그 회차는 아무 폴더도 지우지 않는다.

    핀 데이터 삭제는 비가역이라 하루 건너뛰는 편이 안전하다.
    """
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))

    def _boom():
        raise RuntimeError("mysql-down")
    monkeypatch.setattr(database, "SessionLocal", _boom)

    stamp = (datetime.now() - timedelta(days=60)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_TrussAssessment"
    _make_folder(tmp_path, folder)

    result = cleanup_service.run_cleanup()
    assert result["deleted"] == []
    assert result["errors"] == [{"error": "retention_index_unavailable"}]
    assert (tmp_path / folder).is_dir()
```

- [ ] **Step 6: cleanup 판정 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_cleanup_retention.py -q
```
기대: 대부분 실패(`KeyError: 'pinned'` · `KeyError: 'extended'` 또는 폴더가 지워지지 않음).

- [ ] **Step 7: `_get_folder_age_days` 폴더명 파싱 fix + `run_cleanup` 판정 교체** — `app/services/cleanup_service.py`

(a) 17행 `from .activity_service import ACTIVITY_LOG_RETENTION_DAYS, prune_activity_logs` 아래에 추가:

```python
from . import retention_service
```

(b) 36~58행의 `_get_folder_age_days` 를 아래로 교체(D8 — 폴더명 우선 파싱 fix):

```python
def _get_folder_age_days(folder_path: str, now: datetime | None = None) -> float:
    """폴더명(`YYYYMMDD_HHMMSS_<eid>_<program>`) 을 우선 파싱하고, 실패 시 stat 폴백.

    기존 구현은 ``prefix.split("_")[0]`` 로 8자리를 얻어 ``len(prefix) == 14`` 검사에 걸려
    항상 stat 폴백으로 떨어지는 결함이 있었다(파일 복사·백업 복원 시 mtime 이 갱신되면
    실제보다 어린 폴더로 오판). 이 판정을 retention_service 로 위임해 라우터·cleanup 이
    같은 규약을 쓴다.
    """
    reference = now or datetime.now()
    folder_name = os.path.basename(folder_path)
    created = retention_service.folder_created_at(folder_name)
    if created is not None:
        return (reference - created).total_seconds() / 86400
    # fallback: stat 기반 (mtime/ctime 중 더 오래된 값)
    try:
        stat_result = os.stat(folder_path)
        oldest_ts = min(
            stat_result.st_mtime,
            getattr(stat_result, "st_birthtime", stat_result.st_ctime),
        )
        return (time.time() - oldest_ts) / 86400
    except OSError:
        return 0.0
```

(c) 120~185행의 `run_cleanup` 을 아래로 교체:

```python
def run_cleanup(dry_run: bool = False, *, now: datetime | None = None,
                db=None) -> dict:
    """
    userConnection/ 하위 폴더를 pinned > retain_until > 폴더 나이 순으로 판정합니다.

    Parameters
    ----------
    dry_run : bool
        True이면 실제 삭제 없이 대상 목록만 반환합니다.
    now : datetime | None
        판정 기준 시각(테스트 주입용). 기본은 datetime.now().
    db : Session | None
        보호 인덱스 조회용 세션(테스트 주입용). 기본은 database.SessionLocal() 로 새로 연다.

    Returns
    -------
    dict
        {
          "deleted": [{"folder", "age_days", ...}],
          "errors": [...],                    # 폴더 삭제 실패 + 인덱스 실패
          "skipped": int,                     # 일반 폴더(<30일) 유지
          "pinned": int,                      # 핀 폴더 유지
          "extended": int,                    # retain_until 로 유지
          "expiring": [                       # Task 3 가 알림으로 소비
              {"folder", "analysis_id", "employee_id", "project_name",
               "program_name", "expires_at", "days_left"}, ...
          ],
          "notified": int,                    # Task 3 가 채운다 — 이 시점엔 0
        }
    """
    reference = now or datetime.now()
    result = {
        "deleted": [], "errors": [], "skipped": 0,
        "pinned": 0, "extended": 0, "expiring": [], "notified": 0,
    }

    if not os.path.isdir(_USER_CONN_DIR):
        logger.warning("[Cleanup] userConnection 디렉터리가 존재하지 않습니다: %s", _USER_CONN_DIR)
        return result

    # 보호 인덱스 조회. 실패하면 D6: 아무것도 지우지 않는다.
    owns_session = False
    try:
        session = db if db is not None else database.SessionLocal()
        owns_session = db is None
        index = retention_service.load_retention_index(session, _USER_CONN_DIR, now=reference)
    except Exception as exc:
        # 오류 원문에는 DB URL/파일 경로가 포함될 수 있어 type만 기록한다.
        logger.error("[Cleanup] 보호 인덱스 조회 실패 (%s)", type(exc).__name__)
        result["errors"].append({"error": "retention_index_unavailable"})
        if owns_session:
            try:
                session.close()
            except Exception:
                pass
        return result

    try:
        try:
            entries = os.listdir(_USER_CONN_DIR)
        except OSError as exc:
            logger.error(
                "[Cleanup] 디렉터리 목록 조회 실패 (%s)",
                type(exc).__name__,
            )
            return result

        for entry in entries:
            folder_path = os.path.join(_USER_CONN_DIR, entry)
            if not os.path.isdir(folder_path):
                continue

            age_days = _get_folder_age_days(folder_path, now=reference)
            decision = retention_service.decide_folder(
                entry, index.get(entry, []),
                folder_age_days=age_days, now=reference,
            )

            if decision.action == "keep_pinned":
                result["pinned"] += 1
                continue
            if decision.action == "keep_extended":
                result["extended"] += 1
                _record_expiring(result, entry, decision, reference)
                continue
            if decision.action == "keep":
                result["skipped"] += 1
                _record_expiring(result, entry, decision, reference)
                continue

            # decision.action == "delete"
            if dry_run:
                result["deleted"].append({"folder": entry, "age_days": round(age_days, 1)})
                continue
            try:
                _force_rmtree(folder_path)
                result["deleted"].append({"folder": entry, "age_days": round(age_days, 1)})
                logger.info("[Cleanup] 삭제 완료: %s (%.1f일 경과)", entry, age_days)
            except OSError as exc:
                error_type = type(exc).__name__
                result["errors"].append({
                    "folder": entry,
                    "error": "filesystem_cleanup_failed",
                    "error_type": error_type,
                })
                logger.error("[Cleanup] 삭제 실패: %s (%s)", entry, error_type)

        logger.info(
            "[Cleanup] 완료 — 삭제: %d개, 오류: %d개, 유지: %d개, 핀: %d개, 연장: %d개",
            len(result["deleted"]), len(result["errors"]),
            result["skipped"], result["pinned"], result["extended"],
        )
        # Task 3 에서 notify 훅을 여기에 붙인다.
        result["notified"] = _notify_expiring(session, result["expiring"], dry_run=dry_run)
        return result
    finally:
        if owns_session:
            try:
                session.close()
            except Exception:
                logger.warning("[Cleanup] retention session close failed")


def _record_expiring(result: dict, folder: str, decision, now: datetime) -> None:
    """decision.days_left 가 1~EXPIRING_SOON_DAYS 사이일 때만 D-7 목록에 담는다.

    0 이하(만료됨)와 None(pinned/무기록) 은 건너뛴다.
    """
    left = decision.days_left
    if left is None or left <= 0 or left > retention_service.EXPIRING_SOON_DAYS:
        return
    rec = decision.record
    if rec is None:
        return
    result["expiring"].append({
        "folder": folder,
        "analysis_id": rec.id,
        "employee_id": rec.employee_id,
        "project_name": rec.project_name,
        "program_name": rec.program_name,
        "expires_at": decision.expires_at.isoformat() if decision.expires_at else None,
        "days_left": left,
    })


def _notify_expiring(_session, _items, *, dry_run: bool) -> int:
    """Task 3 에서 채운다 — Plan A(알림 센터) 지연 import."""
    return 0
```

- [ ] **Step 8: cleanup 판정 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_cleanup_retention.py tests/test_retention_service.py -q
```
기대: 각 테스트에서 `pinned`/`extended`/`deleted`/`errors` 키가 새 구조를 반영하고, 일반 40일 폴더 삭제·핀 60일 보존·retain_until 30일 연장 보존·retain_until 만료 삭제·DB 실패 시 삭제 0 이 모두 통과.

- [ ] **Step 9: 기존 회귀 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_runtime_services_lifecycle.py tests/test_scheduler_recovery.py -q
```
기대: 통과. 스케줄러(`_cleanup_loop`·`start_cleanup_scheduler`)는 변경 없음. `run_all_cleanup` 이 반환하는 `user_connection` 값의 키 집합이 늘었지만 stub 하는 곳이 있으면 dict 확장에 관대해야 한다(`grep -n "run_all_cleanup" tests/*.py` 로 확인, 스텁이 있으면 새 키를 함께 넘겨준다).

- [ ] **Step 10: 커밋 준비 완료** — 보고: `app/services/retention_service.py`, `app/services/cleanup_service.py`, `tests/test_retention_service.py`, `tests/test_cleanup_retention.py`.

---

### Task 3: D-7 자정 스캔 → `notify(kind="retention.expiring")` 지연 import

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/cleanup_service.py` — `_notify_expiring` 본체 채우기
- Modify: `HiTessWorkBenchBackEnd/tests/test_cleanup_retention.py` — 알림 훅 검증 추가

- [ ] **Step 1: 실패 테스트 추가** — `tests/test_cleanup_retention.py` 파일 끝에 추가:

```python


# ── D-7 만료 경고 알림 ─────────────────────────────────────────────────────


def _fake_notification_module(sink):
    """마스터 §2.1 지연 import 규약에 맞춰 sys.modules 에 심는 최소 스텁.

    Plan A(notification_service)가 아직 없어도, 이 모듈이 sys.modules 에 있으면
    cleanup_service._notify_expiring 이 지연 import 로 잡아 호출한다.
    """
    import sys, types
    mod = types.ModuleType("app.services.notification_service")

    def notify(db, *, employee_id, kind, title, body="", link=None, dedupe_key=None):
        sink.append({
            "employee_id": employee_id, "kind": kind,
            "title": title, "body": body, "link": link, "dedupe_key": dedupe_key,
        })
        return True

    mod.notify = notify
    sys.modules["app.services.notification_service"] = mod
    return mod


def test_expiring_folder_notifies_representative_record(tmp_path, db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))
    sink = []
    _fake_notification_module(sink)

    # 만료 5일 전(생성 25일 전)
    stamp = (datetime.now() - timedelta(days=25)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_SidePassage"
    _make_folder(tmp_path, folder)
    rec = _seed(db_session, "EMP001", folder, "SidePassage", tmp_path,
                created_at=datetime.now() - timedelta(days=25))

    result = cleanup_service.run_cleanup()

    assert result["notified"] == 1
    assert result["expiring"] and result["expiring"][0]["analysis_id"] == rec.id
    assert result["expiring"][0]["days_left"] in (5, 4, 6)   # 실행 시각에 따라 4~6일 사이
    assert sink[0]["kind"] == "retention.expiring"
    assert sink[0]["dedupe_key"] == f"retention:{rec.id}"
    assert sink[0]["link"] == {"menu": "My Projects", "params": {"analysis_id": rec.id}}
    assert "만료" in sink[0]["title"]


def test_expiring_folder_notifies_parent_only_when_substep_present(
    tmp_path, db_session, monkeypatch
):
    """spec §2 D5: SidePassage(부모) + ModuleStability(하위 단계) 가 같은 폴더를
    가리켜도 알림은 부모 기록 1건에만 간다.
    """
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))
    sink = []
    _fake_notification_module(sink)

    stamp = (datetime.now() - timedelta(days=25)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_SidePassage"
    _make_folder(tmp_path, folder)
    parent = _seed(db_session, "EMP001", folder, "SidePassage", tmp_path,
                   created_at=datetime.now() - timedelta(days=25))
    _seed(db_session, "EMP001", folder, "ModuleStability", tmp_path,
          created_at=datetime.now() - timedelta(days=25))

    result = cleanup_service.run_cleanup()

    assert result["notified"] == 1
    assert [n["dedupe_key"] for n in sink] == [f"retention:{parent.id}"]


def test_dry_run_does_not_notify(tmp_path, db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))
    sink = []
    _fake_notification_module(sink)

    stamp = (datetime.now() - timedelta(days=25)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_SidePassage"
    _make_folder(tmp_path, folder)
    _seed(db_session, "EMP001", folder, "SidePassage", tmp_path,
          created_at=datetime.now() - timedelta(days=25))

    result = cleanup_service.run_cleanup(dry_run=True)

    assert result["notified"] == 0
    assert result["expiring"]     # 목록엔 담긴다(집계용)
    assert sink == []


def test_notification_module_absent_is_silent(tmp_path, db_session, monkeypatch):
    """Plan A 없이도 이 plan 이 단독 동작해야 한다 — ImportError 를 조용히 삼킨다."""
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))
    import sys
    sys.modules.pop("app.services.notification_service", None)

    stamp = (datetime.now() - timedelta(days=25)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_SidePassage"
    _make_folder(tmp_path, folder)
    _seed(db_session, "EMP001", folder, "SidePassage", tmp_path,
          created_at=datetime.now() - timedelta(days=25))

    result = cleanup_service.run_cleanup()

    assert result["notified"] == 0
    # 삭제/보존 판정은 정상적으로 수행됐어야 한다.
    assert result["expiring"] and result["deleted"] == []


def test_notify_failure_does_not_stop_cleanup(tmp_path, db_session, monkeypatch, caplog):
    """알림 실패가 삭제 결과 반환을 막으면 안 된다 — 로그만 남기고 계속."""
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))

    import sys, types
    mod = types.ModuleType("app.services.notification_service")
    def _boom(*_a, **_kw):
        raise RuntimeError("notifications table missing")
    mod.notify = _boom
    sys.modules["app.services.notification_service"] = mod

    stamp = (datetime.now() - timedelta(days=25)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_SidePassage"
    _make_folder(tmp_path, folder)
    _seed(db_session, "EMP001", folder, "SidePassage", tmp_path,
          created_at=datetime.now() - timedelta(days=25))

    result = cleanup_service.run_cleanup()

    assert result["notified"] == 0
    assert any("만료 경고 알림 실패" in r.getMessage() for r in caplog.records)
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_cleanup_retention.py -q -k "expiring or dry_run_does_not_notify or module_absent or notify_failure"
```
기대: `notified == 1` 을 기대하는 테스트가 `notified == 0` 을 받고 실패.

- [ ] **Step 3: `_notify_expiring` 본체 구현** — `app/services/cleanup_service.py` 의 `_notify_expiring` 스텁을 아래로 교체:

```python
def _notify_expiring(session, items, *, dry_run: bool) -> int:
    """만료 D-7 대표 기록에 알림을 남긴다.

    - Plan A(알림 센터)가 없으면 조용히 0. 마스터 §2.1 지연 import 규약을 따른다.
    - dry_run 이면 아무것도 보내지 않는다 — 자정 스캔은 dry_run=False 로만 돌린다.
    - dedupe_key=f"retention:{analysis_id}" 로 같은 알림이 매일 쌓이지 않게 한다.
    - link 는 프론트 sessionStorage('workbench:open-project-detail') 패턴에 맞게 analysis_id 만 넘긴다.
    - 알림 실패가 삭제 결과를 되돌리면 안 되므로 개별 항목은 예외를 로그로만 남긴다.
    """
    if dry_run or not items:
        return 0
    try:
        from . import notification_service
    except ImportError:
        return 0
    notify_fn = getattr(notification_service, "notify", None)
    if notify_fn is None:
        return 0

    sent = 0
    for item in items:
        analysis_id = item.get("analysis_id")
        employee_id = item.get("employee_id")
        days_left = item.get("days_left")
        if not employee_id or analysis_id is None or days_left is None:
            continue
        try:
            notify_fn(
                session,
                employee_id=employee_id,
                kind="retention.expiring",
                title=f"결과 파일이 {days_left}일 후 만료됩니다",
                body=(item.get("project_name") or item.get("program_name") or ""),
                link={"menu": "My Projects", "params": {"analysis_id": analysis_id}},
                dedupe_key=f"retention:{analysis_id}",
            )
            sent += 1
        except Exception:
            logger.warning(
                "[Cleanup] 만료 경고 알림 실패 (analysis_id=%s)",
                analysis_id, exc_info=True,
            )
    return sent
```

- [ ] **Step 4: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_cleanup_retention.py -q
```
기대: 모두 통과(판정 6건 + 알림 5건).

- [ ] **Step 5: 커밋 준비 완료** — 보고: `app/services/cleanup_service.py`, `tests/test_cleanup_retention.py`.

---

### Task 4: `POST /api/analysis/{id}/retention` + 직렬화·이력·서머리 확장

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/routers/analysis.py`
  - `_serialize_analysis`(364~368행) — `retention` 블록 추가
  - `_analysis_summary`(398~433행) — `expiringSoon`/`pinnedFiles` 추가
  - `get_history` `file_status` 필터(682~697행) — `expiring`/`pinned` 어휘 확장
  - `POST /analysis/{id}/retention` — `get_analysis_passport`(1668~1679행) 바로 뒤에 신설
- Create: `HiTessWorkBenchBackEnd/tests/test_analysis_retention_api.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_analysis_retention_api.py`:

```python
"""보관 연장·핀 API + 직렬화 확장.

- POST /api/analysis/{id}/retention: 소유자 200, 타인 403, 관리자 200, 404, 422/400, 409.
- _serialize_analysis: retention 블록이 붙는가.
- GET /api/analysis/history: file_status 어휘(expiring, pinned) + summary(expiringSoon, pinnedFiles).
"""
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from app import models


def _analysis(db, employee_id="EMP001", program="Truss Assessment",
              folder="20260820_090000_EMP001_TrussAssessment",
              base_dir=None, created_at=None, retain_until=None, pinned=False):
    base_dir = base_dir or r"C:\Coding\WorkBench\HiTessWorkBenchBackEnd\userConnection"
    rec = models.Analysis(
        job_id=None,
        employee_id=employee_id, program_name=program,
        project_name="proj", status="Success",
        input_info={"bdf_file": rf"{base_dir}\{folder}\input.bdf"},
        result_info={},
        created_at=created_at or datetime(2026, 8, 20, 9, 0, 0),
        retain_until=retain_until, pinned=pinned,
    )
    db.add(rec)
    db.commit()
    return rec


# ── _serialize_analysis retention 블록 ─────────────────────────────────

def test_get_analysis_by_id_returns_retention_block(admin_client, db_session):
    rec = _analysis(db_session, employee_id="ADMIN001")
    res = admin_client.get(f"/api/analysis/{rec.id}")
    assert res.status_code == 200
    body = res.json()
    r = body["retention"]
    assert r["status"] in ("available", "expiring", "expired")
    assert r["pinned"] is False
    assert r["retain_until"] is None
    assert r["extension_used_days"] == 0
    assert r["extension_remaining_days"] == 180
    assert "base_expires_at" in r and "expires_at" in r


def test_retention_status_pinned_when_flag_true(admin_client, db_session):
    rec = _analysis(db_session, employee_id="ADMIN001", pinned=True)
    body = admin_client.get(f"/api/analysis/{rec.id}").json()
    assert body["retention"]["status"] == "pinned"
    assert body["retention"]["expires_at"] is None
    assert body["retention"]["days_left"] is None


# ── POST /analysis/{id}/retention — 권한 ────────────────────────────────

def test_extend_requires_ownership_or_admin(switchable_client, db_session):
    """EMP001 이 만든 기록은 EMP001·관리자만 만질 수 있다."""
    rec = _analysis(db_session, employee_id="EMP001")

    switchable_client.as_user()   # EMP001
    r = switchable_client.post(f"/api/analysis/{rec.id}/retention",
                               json={"extend_days": 30})
    assert r.status_code == 200

    # 관리자도 통과
    switchable_client.as_admin()
    r = switchable_client.post(f"/api/analysis/{rec.id}/retention",
                               json={"extend_days": 30})
    assert r.status_code == 200


def test_extend_rejects_other_user(switchable_client, db_session, make_user):
    """다른 사용자는 403 — spec §2 D3."""
    other = _analysis(db_session, employee_id="OTHER01")
    make_user("OTHER01")

    switchable_client.as_user()   # EMP001
    r = switchable_client.post(f"/api/analysis/{other.id}/retention",
                               json={"extend_days": 30})
    assert r.status_code == 403


def test_extend_returns_404_when_missing(admin_client):
    r = admin_client.post("/api/analysis/999999/retention", json={"extend_days": 30})
    assert r.status_code == 404


# ── POST /analysis/{id}/retention — 검증 ───────────────────────────────

def test_extend_rejects_empty_body(admin_client, db_session):
    rec = _analysis(db_session, employee_id="ADMIN001")
    r = admin_client.post(f"/api/analysis/{rec.id}/retention",
                          json={"extend_days": None, "pinned": None})
    assert r.status_code == 400
    assert "변경" in r.json()["detail"] or "extend" in r.json()["detail"].lower()


def test_extend_rejects_out_of_range(admin_client, db_session):
    rec = _analysis(db_session, employee_id="ADMIN001")
    assert admin_client.post(f"/api/analysis/{rec.id}/retention",
                             json={"extend_days": 0}).status_code == 422
    assert admin_client.post(f"/api/analysis/{rec.id}/retention",
                             json={"extend_days": 181}).status_code == 422
    assert admin_client.post(f"/api/analysis/{rec.id}/retention",
                             json={"extend_days": "30"}).status_code == 422


def test_extend_rejects_cumulative_over_180(admin_client, db_session):
    """spec §2 D2: 이미 150일 연장된 기록에 30일 더 하면 상한 초과 → 400."""
    rec = _analysis(
        db_session, employee_id="ADMIN001",
        created_at=datetime(2026, 3, 1, 0, 0, 0),
        # base_expiry = 2026-03-31. 150일 연장.
        retain_until=datetime(2026, 3, 31) + timedelta(days=150),
    )
    r = admin_client.post(f"/api/analysis/{rec.id}/retention",
                          json={"extend_days": 60})
    assert r.status_code == 400
    assert "180" in r.json()["detail"]


def test_extend_rejects_when_files_already_expired(admin_client, db_session):
    """spec §2 D4: 보호할 파일이 없으면 409 — 폴더 이름은 있지만 실제 폴더는 없다."""
    rec = _analysis(
        db_session, employee_id="ADMIN001",
        folder="20260101_090000_ADMIN001_TrussAssessment",
        created_at=datetime(2026, 1, 1, 9, 0, 0),
    )
    r = admin_client.post(f"/api/analysis/{rec.id}/retention",
                          json={"extend_days": 30})
    assert r.status_code == 409


# ── POST /analysis/{id}/retention — 정상 ───────────────────────────────

def test_extend_sets_retain_until_and_returns_record(
    admin_client, db_session, tmp_path, monkeypatch
):
    """실제 폴더가 있어야 D4 검사를 통과한다 — tmp_path 를 userConnection 으로 쓴다."""
    from app.routers import analysis as ar
    monkeypatch.setattr(ar, "_USER_CONNECTION_DIR", str(tmp_path))
    monkeypatch.setattr(ar, "_ALLOWED_DOWNLOAD_BASE", str(tmp_path))

    folder = "20260820_090000_ADMIN001_TrussAssessment"
    (tmp_path / folder).mkdir()
    (tmp_path / folder / "input.bdf").write_text("$", encoding="utf-8")

    rec = _analysis(db_session, employee_id="ADMIN001",
                    folder=folder, base_dir=str(tmp_path),
                    created_at=datetime(2026, 8, 20, 9, 0, 0))

    r = admin_client.post(f"/api/analysis/{rec.id}/retention",
                          json={"extend_days": 30})
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == rec.id
    assert body["retention"]["status"] in ("available", "expiring", "pinned")
    assert body["retention"]["extension_used_days"] == 30
    assert body["retain_until"] is not None
    db_session.refresh(rec)
    assert rec.retain_until is not None


def test_pin_toggles_flag(admin_client, db_session, tmp_path, monkeypatch):
    from app.routers import analysis as ar
    monkeypatch.setattr(ar, "_USER_CONNECTION_DIR", str(tmp_path))
    monkeypatch.setattr(ar, "_ALLOWED_DOWNLOAD_BASE", str(tmp_path))
    folder = "20260820_090000_ADMIN001_TrussAssessment"
    (tmp_path / folder).mkdir()
    (tmp_path / folder / "input.bdf").write_text("$", encoding="utf-8")
    rec = _analysis(db_session, employee_id="ADMIN001",
                    folder=folder, base_dir=str(tmp_path))

    r = admin_client.post(f"/api/analysis/{rec.id}/retention",
                          json={"pinned": True})
    assert r.status_code == 200 and r.json()["pinned"] is True
    assert r.json()["retention"]["status"] == "pinned"

    r2 = admin_client.post(f"/api/analysis/{rec.id}/retention",
                           json={"pinned": False})
    assert r2.status_code == 200 and r2.json()["pinned"] is False


# ── history — file_status 필터 확장 ────────────────────────────────────

def test_history_file_status_expiring_filters_only_expiring(
    admin_client, db_session, tmp_path, monkeypatch
):
    from app.routers import analysis as ar
    monkeypatch.setattr(ar, "_USER_CONNECTION_DIR", str(tmp_path))
    monkeypatch.setattr(ar, "_ALLOWED_DOWNLOAD_BASE", str(tmp_path))
    # 5일 남은(만료 임박) 기록
    stamp = (datetime.now() - timedelta(days=25)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_ADMIN001_TrussAssessment"
    (tmp_path / folder).mkdir()
    (tmp_path / folder / "input.bdf").write_text("$", encoding="utf-8")
    a = _analysis(db_session, employee_id="ADMIN001", folder=folder,
                  base_dir=str(tmp_path),
                  created_at=datetime.now() - timedelta(days=25))
    # 여유 있는(20일 남은) 기록
    stamp2 = (datetime.now() - timedelta(days=10)).strftime("%Y%m%d_%H%M%S")
    folder2 = f"{stamp2}_ADMIN001_TrussAssessment"
    (tmp_path / folder2).mkdir()
    (tmp_path / folder2 / "input.bdf").write_text("$", encoding="utf-8")
    _analysis(db_session, employee_id="ADMIN001", folder=folder2,
              base_dir=str(tmp_path),
              created_at=datetime.now() - timedelta(days=10))

    r = admin_client.get("/api/analysis/history/ADMIN001",
                         params={"file_status": "expiring"})
    ids = {item["id"] for item in r.json()["items"]}
    assert ids == {a.id}


def test_history_file_status_pinned_filters_only_pinned(
    admin_client, db_session, tmp_path, monkeypatch
):
    from app.routers import analysis as ar
    monkeypatch.setattr(ar, "_USER_CONNECTION_DIR", str(tmp_path))
    monkeypatch.setattr(ar, "_ALLOWED_DOWNLOAD_BASE", str(tmp_path))
    folder = "20260820_090000_ADMIN001_TrussAssessment"
    (tmp_path / folder).mkdir()
    (tmp_path / folder / "input.bdf").write_text("$", encoding="utf-8")
    pinned_rec = _analysis(db_session, employee_id="ADMIN001", folder=folder,
                           base_dir=str(tmp_path), pinned=True)
    folder2 = "20260821_090000_ADMIN001_TrussAssessment"
    (tmp_path / folder2).mkdir()
    (tmp_path / folder2 / "input.bdf").write_text("$", encoding="utf-8")
    _analysis(db_session, employee_id="ADMIN001", folder=folder2,
              base_dir=str(tmp_path))

    r = admin_client.get("/api/analysis/history/ADMIN001",
                         params={"file_status": "pinned"})
    ids = {item["id"] for item in r.json()["items"]}
    assert ids == {pinned_rec.id}


def test_history_summary_includes_expiring_and_pinned_counts(
    admin_client, db_session, tmp_path, monkeypatch
):
    from app.routers import analysis as ar
    monkeypatch.setattr(ar, "_USER_CONNECTION_DIR", str(tmp_path))
    monkeypatch.setattr(ar, "_ALLOWED_DOWNLOAD_BASE", str(tmp_path))
    # 임박 1, 핀 1, 여유 1
    for label, created, pinned in [
        ("expiring", datetime.now() - timedelta(days=25), False),
        ("pinned",   datetime.now() - timedelta(days=1), True),
        ("available", datetime.now() - timedelta(days=1), False),
    ]:
        stamp = created.strftime("%Y%m%d_%H%M%S")
        folder = f"{stamp}_ADMIN001_TrussAssessment_{label}"
        (tmp_path / folder).mkdir()
        (tmp_path / folder / "input.bdf").write_text("$", encoding="utf-8")
        _analysis(db_session, employee_id="ADMIN001", folder=folder,
                  base_dir=str(tmp_path), created_at=created, pinned=pinned)

    body = admin_client.get("/api/analysis/history/ADMIN001",
                            params={"include_summary": True}).json()
    summary = body["summary"]
    assert summary["expiringSoon"] == 1
    assert summary["pinnedFiles"] == 1
    # 기존 키는 유지
    assert "expiredFiles" in summary and "availableFiles" in summary
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_analysis_retention_api.py -q
```
기대: `POST /retention` 이 404 (라우트 없음) — 대부분 실패.

- [ ] **Step 3: `_serialize_analysis` retention 블록 추가** — `app/routers/analysis.py:364-368`:

(a) 파일 상단(78~82행 `_access_control` import 다음)에 추가:

```python
from ..services import retention_service
from ..services.retention_service import RetentionLimitError
```

(b) 364~368행의 `_serialize_analysis` 를 아래로 교체:

```python
def _serialize_analysis(record: models.Analysis) -> dict:
    d = {c.name: getattr(record, c.name) for c in record.__table__.columns}
    d['employee_id'] = _norm_eid(d.get('employee_id'))
    files_available = _files_available(record)
    d['files_available'] = files_available
    folder = retention_service.work_folder_of(record, _USER_CONNECTION_DIR)
    d['retention'] = retention_service.retention_state(
        record, folder,
        files_available=files_available, now=datetime.now(),
    )
    return _enrich_legacy_doublepipe_payload(d)
```

- [ ] **Step 4: `_analysis_summary` 확장** — 398~433행의 함수 본문 안에서 `expired_files = 0` 다음 줄에 추가하고 반환 dict 를 확장:

```python
    expired_files = 0
    expiring_soon = 0
    pinned_files = 0
    now = datetime.now()
    ...
    for r in rows:
        module_count[r.program_name or "Unknown"] = module_count.get(r.program_name or "Unknown", 0) + 1
        files_available = _files_available(r)
        if not files_available:
            expired_files += 1
        else:
            folder = retention_service.work_folder_of(r, _USER_CONNECTION_DIR)
            status = retention_service.classify(
                r, folder, files_available=True, now=now,
            )
            if status == "pinned":
                pinned_files += 1
            elif status == "expiring":
                expiring_soon += 1
        if r.created_at:
            created = r.created_at.replace(tzinfo=None) if getattr(r.created_at, "tzinfo", None) else r.created_at
            if created >= seven_days_ago:
                this_week += 1
            elif prev_seven_days_ago <= created < seven_days_ago:
                prev_week += 1
    ...
    return {
        ...,
        "expiredFiles": expired_files,
        "availableFiles": total - expired_files,
        "expiringSoon": expiring_soon,
        "pinnedFiles": pinned_files,
    }
```

- [ ] **Step 5: `get_history` file_status 필터 확장** — 682~697행의 `if file_status …` 블록을 아래로 교체:

```python
    if file_status and file_status != "All":
        target = file_status
        now = datetime.now()
        base_dir = _USER_CONNECTION_DIR
        def _matches(record):
            available = _files_available(record)
            folder = retention_service.work_folder_of(record, base_dir)
            status = retention_service.classify(record, folder,
                                                files_available=available, now=now)
            # UI 'available' 은 파일이 있는 상태 전체(핀·임박 포함)를 뜻한다.
            if target == "available":
                return available
            return status == target
        filtered = [r for r in base_q.order_by(models.Analysis.created_at.desc()).all() if _matches(r)]
        total = len(filtered)
        history = filtered[skip:skip + limit]
    else:
        total = base_q.count()
        history = (
            base_q
            .order_by(models.Analysis.created_at.desc())
            .offset(skip).limit(limit)
            .all()
        )
```

- [ ] **Step 6: `POST /analysis/{id}/retention` 신설** — `get_analysis_passport`(1668~1679행) 바로 뒤에:

```python


class RetentionUpdateRequest(BaseModel):
    """POST /api/analysis/{id}/retention 요청 본문.

    - extend_days: 1~180. null 이면 연장 없음.
    - pinned: null 이면 변경 없음(마스터 §2.3 의 bool 을 포함하는 상위 집합).
    - 둘 다 null 이면 400.
    """
    extend_days: Optional[int] = None
    pinned: Optional[bool] = None

    class Config:
        extra = "forbid"


@router.post("/analysis/{analysis_id}/retention")
def update_analysis_retention(
    analysis_id: int,
    payload: RetentionUpdateRequest = Body(...),
    request: Request = None,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """해석 기록의 보관 정책(연장·핀)을 변경한다.

    - 404: 존재하지 않음
    - 403: 소유자/관리자가 아님 (spec §2 D3)
    - 400: 요청이 비었거나 extend_days 범위 밖 · 누적 상한(180일) 초과
    - 409: 이미 파일이 만료 (spec §2 D4)
    - 200: 갱신된 record 를 _serialize_analysis 그대로 반환
    """
    record = db.query(models.Analysis).filter(models.Analysis.id == analysis_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Analysis record not found")
    assert_current_user_can_access_owner(record.employee_id, current_user, db)

    if payload.extend_days is None and payload.pinned is None:
        raise HTTPException(status_code=400, detail="변경 사항이 없습니다.")
    if payload.extend_days is not None:
        if payload.extend_days < 1 or payload.extend_days > retention_service.EXTENSION_MAX_DAYS:
            # pydantic Config.extra=forbid 로 잡히지 않는 경계 값 방어(1~180).
            raise HTTPException(status_code=422, detail="extend_days 는 1~180 사이여야 합니다.")

    files_available = _files_available(record)
    if not files_available:
        raise HTTPException(status_code=409, detail="파일이 이미 만료되어 연장할 수 없습니다.")

    folder = retention_service.work_folder_of(record, _USER_CONNECTION_DIR)
    prev_retain, prev_pinned = record.retain_until, record.pinned
    try:
        retention_service.apply_retention_change(
            record, folder,
            extend_days=payload.extend_days, pinned=payload.pinned,
            now=datetime.now(),
        )
    except RetentionLimitError as exc:
        # in-place 변경을 되돌린다 — session commit 은 아직 안 했지만 field 자체가 바뀌었다.
        record.retain_until = prev_retain
        record.pinned = prev_pinned
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        record.retain_until = prev_retain
        record.pinned = prev_pinned
        raise HTTPException(status_code=422, detail=str(exc))

    record.updated_at = datetime.now()
    db.commit()
    db.refresh(record)
    log_activity(
        db, "RETENTION_UPDATE",
        employee_id=current_user,
        action_detail={
            "analysis_id": record.id,
            "extend_days": payload.extend_days,
            "pinned": payload.pinned,
            "retain_until": record.retain_until.isoformat() if record.retain_until else None,
        },
        ip_address=request.client.host if request and request.client else None,
    )
    return _serialize_analysis(record)
```

⚠️ pydantic `extra="forbid"` 로 알 수 없는 키는 422 로 걸린다. `extend_days=0` 은 pydantic 이 허용하는 int 지만 `<1` 이라 위 명시 검증에서 422 로 걸린다.

- [ ] **Step 7: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_analysis_retention_api.py -q
```
기대: 전부 통과. `test_extend_rejects_when_files_already_expired` 는 실제 폴더가 없어야 하므로 tmp_path 를 건드리지 않는 유일한 케이스다.

전체 회귀:
```
WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
기대: 실패 0. 기존 이력·직렬화 테스트가 `retention` 새 키에 관대하다(추가만 하므로).

- [ ] **Step 8: 커밋 준비 완료** — 보고: `app/routers/analysis.py`, `tests/test_analysis_retention_api.py`.

---

### Task 5: 프론트 `api/analysis.js` `updateAnalysisRetention()`

**Files:**
- Modify: `HiTessWorkBench/frontend/src/api/analysis.js:25-30`(뒤에 신규 함수 삽입)

- [ ] **Step 1: 함수 추가** — `rerunAnalysisProject`(25~30행) 바로 아래에:

```js
/**
 * 해석 기록의 결과 파일 보관 정책을 변경합니다.
 *
 *  - extendDays : 1~180. null|undefined 면 연장 없음.
 *  - pinned     : true/false 면 핀 상태를 그 값으로 설정, null|undefined 면 변경 없음.
 *  - 성공 시 갱신된 프로젝트(`{ ..., retention: {...}, retain_until, pinned }`) 를 그대로 돌려준다.
 *
 * 상태 코드:
 *  - 400 : 요청 비었거나 누적 상한(180일) 초과 · 422 : extend_days 범위/타입 오류
 *  - 403 : 소유자/관리자 아님 · 404 : 기록 없음 · 409 : 파일이 이미 만료
 */
export const updateAnalysisRetention = (analysisId, { extendDays = null, pinned = null } = {}) =>
  axios.post(
    `${API_BASE_URL}/api/analysis/${analysisId}/retention`,
    {
      extend_days: extendDays == null ? null : Number(extendDays),
      pinned: pinned == null ? null : Boolean(pinned),
    },
    { headers: getAuthHeaders() },
  );
```

- [ ] **Step 2: 빌드 확인** (`C:\Coding\WorkBench\HiTessWorkBench\frontend` 에서)

```
npm run build
```
기대: 오류 없음. 함수가 아직 어디서도 import 되지 않아 tree-shake 되지만 정상.

- [ ] **Step 3: 커밋 준비 완료** — 보고: `src/api/analysis.js`.

---

### Task 6: `MyProjects` UI 확장 + `RetentionExtendDialog` + `StatusBadge`

**Files:**
- Modify: `HiTessWorkBench/frontend/src/components/ui/StatusBadge.jsx:13-25`
- Create: `HiTessWorkBench/frontend/src/components/analysis/RetentionExtendDialog.jsx`
- Modify: `HiTessWorkBench/frontend/src/pages/analysis/MyProjects.jsx`
  - import (1~26행) — `updateAnalysisRetention`, `RetentionExtendDialog`, `Pin`/`CalendarPlus` 아이콘
  - `fileStatusOf`(30행) — `project.retention.status` 우선
  - `FileRetentionBadge`(35~38행) — 4상태 반영
  - `FILE_STATUS_FILTERS`(643행) — `expiring`, `pinned` 옵션 2개 추가
  - 상단 통계 카드(984~1013행) — 3장(보관 중 / 7일 내 만료 / 만료)
  - 행 액션(1137~1171행) — "보관 연장/핀" 버튼 1개 + 다이얼로그 상태
  - 상세 모달 — Task 범위 밖(YAGNI). 다음 세션에서 붙일 여지만 남긴다.

- [ ] **Step 1: StatusBadge 확장** — `src/components/ui/StatusBadge.jsx`

(a) 3~10행 lucide-react import 에 `Pin`, `CalendarClock` 을 추가한다:

```jsx
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileOutput,
  FileX,
  Loader2,
  Pin,
  XCircle,
} from 'lucide-react';
```

(b) 13~25행의 `STATUS_META` 에 `pinned`·`expiring` 두 줄을 추가:

```jsx
const STATUS_META = {
  Success: { variant: 'success', label: '해석 완료', icon: CheckCircle2 },
  Failed: { variant: 'error', label: '해석 실패', icon: XCircle },
  Pending: { variant: 'neutral', label: '대기 중', icon: AlertCircle },
  Running: { variant: 'info', label: '실행 중', icon: Loader2, spin: true },
  Solving: { variant: 'info', label: '해석 중', icon: Clock },
  Interrupted: { variant: 'warning', label: '중단됨', icon: AlertCircle },
  Active: { variant: 'success', label: '서비스 중', icon: CheckCircle2 },
  Developing: { variant: 'warning', label: '개발중', icon: Clock },
  Planned: { variant: 'info', label: '출시 예정', icon: Clock },
  available: { variant: 'info', label: '파일 보관 중', icon: FileOutput },
  expiring: { variant: 'warning', label: '만료 임박', icon: CalendarClock },
  pinned: { variant: 'success', label: '보관 고정', icon: Pin },
  expired: { variant: 'neutral', label: '파일 만료', icon: FileX },
};
```

- [ ] **Step 2: `RetentionExtendDialog` 컴포넌트 생성** — `src/components/analysis/RetentionExtendDialog.jsx`:

```jsx
/**
 * @fileoverview 결과 파일 보관 연장·핀 다이얼로그.
 *
 *  - 연장: 30일 / 90일 라디오. 남은 한도(EXTENSION_MAX_DAYS - extension_used_days)를 초과하는
 *    선택지는 비활성. 한도 0 이면 라디오 전체 비활성 + 안내 문구.
 *  - 핀: 별도 토글 버튼(체크박스). 저장 시 pinned=true/false 가 함께 전송된다.
 *  - 만료 임박/여유는 상태 배지로, 실제 만료일은 절대 시각으로 표시한다.
 *
 * 서버 계약(POST /api/analysis/{id}/retention):
 *   { extend_days: 30 | 90 | null, pinned: true | false | null }
 * 성공 응답은 갱신된 project 객체 — 부모가 이 값을 그대로 행에 반영한다.
 */
import React, { useMemo, useState } from 'react';
import { CalendarPlus, Pin, X } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import StatusBadge from '../ui/StatusBadge';
import { useToast } from '../../contexts/ToastContext';
import { updateAnalysisRetention } from '../../api/analysis';

const EXTEND_CHOICES = [30, 90];
const EXTENSION_MAX_DAYS = 180;

const formatDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
};

export default function RetentionExtendDialog({ isOpen, project, onClose, onUpdated }) {
  const { showToast } = useToast();
  const retention = project?.retention ?? {};
  const remaining = Number.isFinite(retention.extension_remaining_days)
    ? retention.extension_remaining_days
    : EXTENSION_MAX_DAYS;
  const usedDays = Number.isFinite(retention.extension_used_days)
    ? retention.extension_used_days
    : 0;

  const [selectedDays, setSelectedDays] = useState(() =>
    EXTEND_CHOICES.find(d => d <= remaining) ?? null
  );
  const [pinChecked, setPinChecked] = useState(Boolean(retention.pinned));
  const [submitting, setSubmitting] = useState(false);

  const hasChange = useMemo(() => {
    const wantsExtend = selectedDays != null;
    const wantsPinToggle = pinChecked !== Boolean(retention.pinned);
    return wantsExtend || wantsPinToggle;
  }, [selectedDays, pinChecked, retention.pinned]);

  if (!isOpen || !project) return null;

  const handleSubmit = async () => {
    if (!hasChange || submitting) return;
    setSubmitting(true);
    try {
      const res = await updateAnalysisRetention(project.id, {
        extendDays: selectedDays,
        // 다이얼로그 첫 진입 시 값과 같으면 서버에는 null 을 보내 '변경 없음' 으로 한다.
        pinned: pinChecked === Boolean(retention.pinned) ? null : pinChecked,
      });
      showToast('보관 정책이 갱신되었습니다.', 'success', 4000);
      onUpdated?.(res.data);
      onClose?.();
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || '보관 정책 갱신에 실패했습니다.';
      const tone = status === 400 || status === 409 ? 'warning' : 'error';
      showToast(String(detail), tone, 6000);
    } finally {
      setSubmitting(false);
    }
  };

  const cannotExtend = remaining <= 0;
  const alreadyExpired = retention.status === 'expired';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="결과 파일 보관 연장 / 핀" size="sm">
      <div className="space-y-5 px-1 py-2">
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700">현재 상태</span>
            <StatusBadge status={retention.status || 'available'} size="sm" />
          </div>
          <div className="flex items-baseline justify-between">
            <span>만료 예정</span>
            <span className="font-mono text-slate-800">
              {retention.pinned ? '영구 보관(핀)' : formatDate(retention.expires_at)}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span>누적 연장</span>
            <span className="font-mono text-slate-800">
              {usedDays}일 / {EXTENSION_MAX_DAYS}일 (남은 한도 {remaining}일)
            </span>
          </div>
        </section>

        <section>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
            보관 연장
          </h4>
          {alreadyExpired ? (
            <p className="text-xs text-slate-500">파일이 이미 만료되어 연장할 수 없습니다.</p>
          ) : cannotExtend ? (
            <p className="text-xs text-amber-700">
              누적 연장 한도 180일을 이미 사용했습니다. 추가 연장이 필요하면 관리자에게 문의하세요.
            </p>
          ) : (
            <div className="flex gap-2">
              {EXTEND_CHOICES.map(days => {
                const disabled = days > remaining;
                const active = selectedDays === days;
                return (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setSelectedDays(active ? null : days)}
                    disabled={disabled}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${
                      active
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                    title={disabled ? '남은 한도 초과' : `${days}일 연장`}
                  >
                    <CalendarPlus size={14} className="inline mr-1.5" />
                    {days}일
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
            영구 보관 핀
          </h4>
          <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 cursor-pointer hover:bg-slate-50">
            <input
              type="checkbox"
              checked={pinChecked}
              onChange={(e) => setPinChecked(e.target.checked)}
              disabled={alreadyExpired}
              className="h-4 w-4 rounded border-slate-300"
            />
            <div className="flex-1">
              <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <Pin size={13} />
                자동 삭제에서 제외
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                핀을 걸면 30일·연장과 무관하게 파일이 보존됩니다. 언제든 해제할 수 있습니다.
              </p>
            </div>
          </label>
        </section>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            <X size={14} /> 취소
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!hasChange || submitting || alreadyExpired}
          >
            {submitting ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: `MyProjects.jsx` 확장**

(a) 1~26행 import 블록 정리:

```jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getAnalysisHistory, downloadFileBlob, exportAssessmentXlsx,
  rerunAnalysisProject, updateAnalysisRetention,
} from '../../api/analysis';
import { extractFilename } from '../../utils/fileHelper';
import {
  Search, Filter, Download, RefreshCw,
  ChevronRight, ChevronLeft, Box,
  CheckCircle2,
  FileCode, Database, FileOutput, Eye, FileX,
  CalendarClock, CalendarPlus, Pin,
  TrendingUp, Award, BarChart3, Minus,
  GitCompare, Play, Square, CheckSquare, Fingerprint,
  Clock3, ListChecks, Pipette, Terminal,
} from 'lucide-react';

import BdfViewerModal from '../../components/modals/BdfViewerModal';
import AssessmentResultViewerModal from '../../components/modals/AssessmentResultViewerModal';
import HpScrViewerModal from '../../components/modals/HpScrViewerModal';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import PageHeader from '../../components/ui/PageHeader';
import StatusBadge from '../../components/ui/StatusBadge';
import FeedbackState from '../../components/ui/FeedbackState';
import AssessmentProjectModal from '../../components/analysis/AssessmentProjectModal';
import RetentionExtendDialog from '../../components/analysis/RetentionExtendDialog';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { findAppByProgramName, getDisplayProgramName, useGlobalJobs } from '../../contexts/DashboardContext';
import { isDoublePipeProject, normalizeDoublePipeProject } from '../../utils/doublePipeProject';
```

(b) 30행 `fileStatusOf` 를 아래로 교체 — `project.retention.status` 를 우선으로 삼는다:

```jsx
const fileStatusOf = (project) => {
  // 백엔드가 새 응답에는 retention.status 를 채워 준다(available|expiring|pinned|expired).
  // 구 클라이언트 호환: retention 이 없으면 files_available 로 폴백.
  const rs = project?.retention?.status;
  if (rs) return rs;
  return project?.files_available === false ? 'expired' : 'available';
};
```

(c) 35~38행 `FileRetentionBadge` 를 아래로 교체:

```jsx
const FileRetentionBadge = ({ project }) => {
  const status = fileStatusOf(project);
  return <StatusBadge status={status} size="md" className="whitespace-nowrap" />;
};
```

(d) 643~647행 `FILE_STATUS_FILTERS` 를 아래로 교체:

```jsx
const FILE_STATUS_FILTERS = [
  { value: 'All', label: 'All Files' },
  { value: 'available', label: 'Files Available' },
  { value: 'expiring', label: '7일 내 만료' },
  { value: 'pinned', label: '보관 고정' },
  { value: 'expired', label: 'Files Expired' },
];
```

(e) 664행 상태 선언(선택 프로젝트 근처)에 추가:

```jsx
  const [retentionDialogProject, setRetentionDialogProject] = useState(null);
```

(f) 984~1013행 통계 카드 블록을 3장 그리드로 교체:

```jsx
      {!loading && stats.total > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6 animate-fade-in-up">
          <button
            type="button"
            onClick={() => setFileStatusFilter('available')}
            className={`text-left bg-white rounded-xl border shadow-sm p-4 transition-colors cursor-pointer ${
              fileStatusFilter === 'available' ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200 hover:border-blue-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">파일 보관 중</span>
              <FileOutput size={16} className="text-blue-500" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-slate-800">
              {stats.availableFiles}<span className="ml-1 text-xs text-slate-400">건</span>
            </p>
            {Number.isFinite(stats.pinnedFiles) && stats.pinnedFiles > 0 && (
              <p className="mt-1 text-[11px] text-emerald-600 font-bold flex items-center gap-1">
                <Pin size={11} /> 보관 고정 {stats.pinnedFiles}건 포함
              </p>
            )}
          </button>
          <button
            type="button"
            onClick={() => setFileStatusFilter('expiring')}
            className={`text-left bg-white rounded-xl border shadow-sm p-4 transition-colors cursor-pointer ${
              fileStatusFilter === 'expiring' ? 'border-amber-400 ring-2 ring-amber-100' : 'border-slate-200 hover:border-amber-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">7일 내 만료</span>
              <CalendarClock size={16} className="text-amber-500" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-slate-800">
              {stats.expiringSoon ?? 0}<span className="ml-1 text-xs text-slate-400">건</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-500">보관 연장 또는 핀 고정으로 유지할 수 있습니다.</p>
          </button>
          <button
            type="button"
            onClick={() => setFileStatusFilter('expired')}
            className={`text-left bg-white rounded-xl border shadow-sm p-4 transition-colors cursor-pointer ${
              fileStatusFilter === 'expired' ? 'border-slate-400 ring-2 ring-slate-100' : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">파일 만료</span>
              <FileX size={16} className="text-slate-500" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-slate-800">
              {stats.expiredFiles}<span className="ml-1 text-xs text-slate-400">건</span>
            </p>
          </button>
        </div>
      )}
```

⚠️ `stats` 는 기존 코드에서 `summary` 를 변환한 값이다(이미 `stats.availableFiles`/`expiredFiles` 를 쓴다). `expiringSoon`/`pinnedFiles` 는 백엔드가 새로 채우므로 `stats` 매핑 함수(대략 `useMemo` 로 묶여 있음)에도 두 필드를 그대로 통과시킨다. `grep -n "expiredFiles" src/pages/analysis/MyProjects.jsx` 로 매핑 위치를 확인하고 spread 로 함께 실린다면 코드 변경이 필요 없다.

(g) 1136~1172행 행 액션(td) 을 아래로 교체 — `w-24` 를 `w-32` 로 넓히고 세 번째 버튼("보관 연장/핀") 추가:

```jsx
                <th className="py-4 px-4 font-semibold text-center w-32">Actions</th>
```

행 렌더:

```jsx
                    <td className="py-4 px-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRerun(project);
                          }}
                          disabled={
                            rerunningIds.has(project.id)
                            || project.files_available === false
                            || !supportsProjectRerun(project)
                          }
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-35"
                          title={
                            project.files_available === false
                              ? '입력 파일 보관 기간이 만료되었습니다.'
                              : supportsProjectRerun(project)
                                ? '동일 입력으로 다시 실행'
                                : '이 앱은 저장 파일 기반 재실행을 지원하지 않습니다.'
                          }
                          aria-label={`${project.project_name} 동일 입력 재실행`}
                        >
                          {rerunningIds.has(project.id)
                            ? <RefreshCw size={16} className="animate-spin" />
                            : <Play size={16} />}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setRetentionDialogProject(project);
                          }}
                          disabled={fileStatusOf(project) === 'expired'}
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-35"
                          title={
                            fileStatusOf(project) === 'expired'
                              ? '파일이 이미 만료되어 연장할 수 없습니다.'
                              : project.retention?.pinned
                                ? '보관 정책 변경 (현재 핀 고정 중)'
                                : '보관 연장 / 핀 고정'
                          }
                          aria-label={`${project.project_name} 보관 연장 / 핀`}
                        >
                          {project.retention?.pinned
                            ? <Pin size={16} className="text-emerald-500" />
                            : <CalendarPlus size={16} />}
                        </button>
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-blue-600"
                          title="프로젝트 상세"
                          aria-label={`${project.project_name} 상세 열기`}
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                    </td>
```

(h) 상세 모달 렌더링(약 1253행 `{selectedProject?.program_name === 'Truss Assessment' ...}`) 근처, `HpScrViewerModal` 뒤에 다이얼로그를 배치:

```jsx
      <RetentionExtendDialog
        isOpen={!!retentionDialogProject}
        project={retentionDialogProject}
        onClose={() => setRetentionDialogProject(null)}
        onUpdated={(updated) => {
          // 서버가 갱신된 record 를 그대로 돌려주므로 목록의 한 행을 교체한다.
          setProjects(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
          // 상단 카운트(보관 중/임박/만료/핀)를 재계산하려면 summary 를 다시 받는다.
          fetchHistory();
        }}
      />
```

- [ ] **Step 4: 빌드 확인**

```
npm run build
```
기대: 오류 없음.

- [ ] **Step 5: 수동 검증**

백엔드 `uvicorn app.main:app --host 0.0.0.0 --port 9091 --reload` + `HiTessWorkBench` 에서 `npm run dev`.

1. 로그인 → `My Projects` 진입.
2. 상단 카드 3장이 보인다: **파일 보관 중** / **7일 내 만료** / **파일 만료**. "보관 중" 카드 아래에 핀 개수 주석(있을 때).
3. 상단 필터 드롭다운의 파일 상태 옵션에 "7일 내 만료" · "보관 고정" 이 새로 있다.
4. 아무 행의 `📅+` (달력+) 아이콘을 클릭 → **보관 연장/핀** 다이얼로그가 뜬다. 표시 값:
   - 현재 상태 배지(available/expiring/pinned).
   - 만료 예정 절대 시각 · 핀이면 "영구 보관(핀)".
   - 누적 연장 X일 / 180일 (남은 한도 Y일).
   - 30일 · 90일 라디오 — 남은 한도를 넘는 선택지는 비활성.
   - "자동 삭제에서 제외" 체크박스.
5. 30일을 고르고 저장 → 초록 토스트 "보관 정책이 갱신되었습니다." + 다이얼로그 닫힘 + 행의 파일 상태가 `available`(연장돼 여유) 또는 `pinned` 로 즉시 바뀜.
6. 핀 체크 → 저장 → 행 아이콘이 `Pin` 초록으로 바뀜. 다시 열어 체크 해제하면 원복.
7. 이미 만료된(파일 없음) 행은 달력 버튼이 비활성 상태로 보이고 hover 시 툴팁 "파일이 이미 만료되어…".
8. 누적 연장이 이미 180일에 가까운 기록에서 30일 선택 후 저장 → 노란 경고 토스트에 "누적 연장이 180일을 초과합니다".
9. 다른 사용자 기록(만약 있다면 관리자 계정에서만 보임)에 대해 저장 → 관리자는 성공. 일반 사용자는 접근 자체를 못 함(목록에 없다).
10. 필터를 "7일 내 만료" 로 걸면 목록이 그 기록만 남는다. "보관 고정" 도 마찬가지.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `src/components/ui/StatusBadge.jsx`, `src/components/analysis/RetentionExtendDialog.jsx`, `src/pages/analysis/MyProjects.jsx`.

---

### Task 7: 최종 회귀 + 서버(145) 반영 안내 + 커밋 준비 완료

- [ ] **Step 1: 백엔드 전체 회귀**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
기대: 실패 0. 신규 파일 4개 합계 **약 55건** 통과:
- `test_schema_bootstrap_retention.py` 4건
- `test_retention_service.py` 29건
- `test_cleanup_retention.py` 11건 (판정 6 + 알림 5)
- `test_analysis_retention_api.py` 11건

- [ ] **Step 2: 프론트 빌드**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && npm run build
```
기대: 오류 없음.

- [ ] **Step 3: 스테이징 점검** — `git status` 에서 `HiTessWorkBench/frontend/src/config.js` 가 변경돼 있으면 **스테이징하지 않는다**(로컬 백엔드 토글). `Darkmode.js/` 미포함 확인.

- [ ] **Step 4: 사용자 보고(커밋은 사용자가 직접)** — 변경 파일 전체 목록(파일 구조 표) + 아래 서버 반영 구분을 그대로 전달.

**서버(145) 반영:**
- **백엔드 — `git pull` + 백엔드 재시작으로 끝.** 변경은 전부 git 추적 파일(`models.py`, `schema_bootstrap.py`, `services/retention_service.py`, `services/cleanup_service.py`, `routers/analysis.py`). 재시작 시 `run_schema_bootstrap()` 이 `retain_until` / `pinned` 컬럼을 자동으로 추가한다. 신규 pip 의존성 없음(`requirements.txt` 변경 없음).
- **프론트 재배포 필요.** WorkBench 포터블 exe 를 `npm run dist` 로 다시 빌드해 배포(파일 상태 카드 3장, 행 액션 "보관 연장/핀", 다이얼로그, StatusBadge 아이콘).
- **InHouse 프로그램 — 없음.** `InHouseProgram/` 수동 교체 대상 없음.
- **Plan A(알림 센터) 상태별 동작:**
  - Plan A 가 아직 없으면 D-7 스캔은 `notified: 0` 으로 조용히 건너뛴다. 사용자 경험은 그대로 유지되고 판정/삭제만 새 규칙으로 적용된다.
  - Plan A 를 이미 배포했으면(`services/notification_service.py` 존재), 자정 스캔이 대표 기록에 `retention.expiring` 알림을 남기고 헤더 종 아이콘 배지가 자연스럽게 오른다. 코드 수정 없이 켜진다.
- 구 클라이언트(Plan B 이전 exe)는 응답의 새 `retention` 블록을 무시하고 `files_available` 만 읽으므로 백엔드 선반영은 안전하다.

---

## 자기 검토

- **spec 커버리지**: §2 확정 결정 D1~D10 을 다음처럼 구현했다.
  - D1(우선순위): `retention_service.effective_expiry` + `decide_folder` → Task 2·3.
  - D2(누적 180일 상한): `apply_retention_change` + `RetentionLimitError` + 라우터 400 매핑 → Task 2·4.
  - D3(권한): `assert_current_user_can_access_owner` 재사용 → Task 4.
  - D4(만료 후 연장 불가): 라우터 409 → Task 4.
  - D5(폴더 보호 = 최댓값, 대표 기록): `decide_folder` + `primary_record` → Task 2, 검증 Task 3.
  - D6(인덱스 실패 시 삭제 0): `run_cleanup` 예외 처리 + `retention_index_unavailable` → Task 2.
  - D7(D-7 대표 기록 알림): `_record_expiring` + `_notify_expiring` + `dedupe_key=f"retention:{id}"` → Task 3.
  - D8(폴더명 우선 파싱 fix): `folder_created_at` + `_get_folder_age_days` 재작성 → Task 2.
  - D9(프론트 UI): 파일 상태 카드 3장 + 필터 옵션 2개 + 행 버튼 1개 + 다이얼로그 → Task 5·6.
  - D10(GUARDED_ROUTES 미등록): 라우터 프리픽스 그대로 `/api/analysis/...` — App 별이 아닌 플랫폼 공통 기능 → Task 4(등록 안 함으로 만족).
- **§4 순수 로직 모듈**: `retention_service.py` 의 11개 심볼(`RETENTION_DAYS`, `EXTENSION_MAX_DAYS`, `EXPIRING_SOON_DAYS`, `EXTEND_CHOICES`, `folder_created_at`, `work_folder_of`, `base_expiry`, `effective_expiry`, `extension_used_days`, `days_left`, `classify`, `retention_state`, `apply_retention_change`, `primary_record`, `decide_folder`, `load_retention_index`, `RetentionLimitError`) 를 그대로 노출하고 테스트 파일이 이 목록을 import 로 고정한다.
- **§5 API 계약**: `POST /api/analysis/{id}/retention` 은 `{extend_days: int|null, pinned: bool|null}` 을 받아 400/403/404/409/422/200 을 spec 대로 돌려주고, `_serialize_analysis` 는 8개 키(`status`, `pinned`, `retain_until`, `base_expires_at`, `expires_at`, `days_left`, `extension_used_days`, `extension_remaining_days`) 를 가진 `retention` 블록을 항상 붙인다. `file_status` 어휘는 `All|available|expiring|pinned|expired` 5개. `summary` 는 기존 `expiredFiles`/`availableFiles` 를 유지하고 `expiringSoon`/`pinnedFiles` 를 새로 채운다.
- **§6 cleanup 변경**: `run_cleanup` 의 반환 키는 기존 `deleted/errors/skipped` 위에 `pinned/extended/expiring/notified` 4개가 더 붙는다. 스케줄러(`_cleanup_loop`·`start_cleanup_scheduler`·`shutdown_cleanup_scheduler`)는 변경 없음. `run_all_cleanup` 도 그대로.
- **§7 프론트 UI**: `MyProjects` 만 손댄다. 새 페이지 없음. `Truss Assessment` 전용 상세 모달(`AssessmentProjectModal`)은 spec §10 범위 밖(행 액션 버튼이 모든 프로그램을 덮으므로).
- **§8 테스트**: 4개 파일 신설(`test_schema_bootstrap_retention.py`, `test_retention_service.py`, `test_cleanup_retention.py`, `test_analysis_retention_api.py`) 로 D1~D8 을 모두 검증. 프론트는 러너가 없어 Task 6 Step 5 에 10개 단계 수동 검증.
- **§9 서버 반영**: `git pull` + 재시작 + 프론트 재배포. InHouse 수동 교체 없음. Task 7 에 그대로.
- **의존 순서**: Task 1 (모델/부트스트랩) → Task 2 (retention_service + cleanup 판정) → Task 3 (알림 훅) → Task 4 (라우터·직렬화·이력·서머리) → Task 5 (프론트 API) → Task 6 (UI) → Task 7 (회귀). Task 2 의 `_notify_expiring` 을 스텁으로 먼저 두고 Task 3 에서 채우는 방식으로 판정 테스트와 알림 테스트를 분리해 리팩터 리스크를 낮췄다.
- **YAGNI**: `retain_until` 인덱스는 두지 않는다(cleanup 이 하루 1회 OR 조회만). 관리자 화면·프로젝트 상세 모달의 별도 보관 섹션은 만들지 않는다. Truss Assessment 전용 모달의 보관 UI 도 안 만든다 — 행 액션 버튼이 모든 프로그램을 덮는다.
- **호환성**: 구 클라이언트가 이 응답을 받아도 `retention` 블록을 무시하고 `files_available` 만 읽으면 정상 동작. 구 백엔드가 새 프론트를 만나면 `project.retention` 이 undefined 라 `fileStatusOf` 가 `files_available` 로 폴백해 기존 `available/expired` 만 표시된다(카드 3장에서 `expiring`/`pinned` 값이 0 이거나 undefined 로 나옴).
- **누락 방지**: 알림 링크 경로는 spec §6 대로 `{"menu":"My Projects","params":{"analysis_id": id}}` — Plan A 의 `resolveNotificationTarget` + `sessionStorage('workbench:open-project-detail')` 패턴과 정확히 맞는 shape. `notify` 시그니처는 마스터 §2.1 `notify(db, *, employee_id, kind, title, body, link, dedupe_key)` 를 그대로 호출한다(선택 매개변수 `dedupe_unread_only` 는 기본값 사용).
