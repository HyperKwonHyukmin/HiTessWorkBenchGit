# Admin Usage Reports (Daily/Weekly/Monthly) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new admin-only page that shows Daily/Weekly/Monthly structural analysis usage statistics with period-over-period comparison and Excel export.

**Architecture:** New FastAPI endpoints (`GET /api/analysis/report` and `/api/analysis/report/export-xlsx`) backed by a pure-function service module (`usage_report_service.py`). New React page (`pages/Administration/UsageReports.jsx`) composed from 8 small focused components. Existing `analysis` table reused — no DB schema change.

**Tech Stack:** FastAPI, SQLAlchemy, openpyxl, pytest (new for this project), python-dateutil; React 18, Recharts, lucide-react, Tailwind.

**Spec:** [`docs/superpowers/specs/2026-05-21-admin-usage-reports-design.md`](../specs/2026-05-21-admin-usage-reports-design.md)

**Important codebase facts (verified before writing this plan):**
- `require_admin` dependency already exists at `HiTessWorkBenchBackEnd/app/dependencies.py:18-23`.
- `User.is_developer` column exists at `models.py:17`.
- Backend has **no `tests/` directory and no pytest installed** → Task 1 creates infrastructure.
- Sidebar menu entries live in `HiTessWorkBench/frontend/src/components/layout/Sidebar.jsx`, ADMINISTRATION array around line 67-72. Actual neighbor names are `"User Management"`, `"Analysis Management"`, `"System Management"` (not `"System Settings"` as some docs say).
- App-level routing switch is in `HiTessWorkBench/frontend/src/App.jsx:246-`.
- All `DateTime(timezone=True)` columns use `datetime.now` default — naive `datetime.now()` at instant of insert. KST machine assumed.

---

## File Structure

### Backend (create / modify)

| Path | Status | Responsibility |
|------|--------|----------------|
| `HiTessWorkBenchBackEnd/app/services/usage_report_service.py` | create | `resolve_period`, `aggregate_period`, `compute_deltas`, `build_report_xlsx` |
| `HiTessWorkBenchBackEnd/app/schemas/usage_report.py` | create | Pydantic response models |
| `HiTessWorkBenchBackEnd/app/routers/analysis.py` | modify | Add two endpoints |
| `HiTessWorkBenchBackEnd/tests/__init__.py` | create | Empty marker |
| `HiTessWorkBenchBackEnd/tests/conftest.py` | create | In-memory SQLite fixture + session override |
| `HiTessWorkBenchBackEnd/tests/test_usage_report_service.py` | create | Unit tests for service module |
| `HiTessWorkBenchBackEnd/tests/test_usage_report_api.py` | create | API-level tests (admin gate, response shape) |
| `HiTessWorkBenchBackEnd/requirements.txt` | modify | Add pytest, httpx |
| `HiTessWorkBenchBackEnd/pytest.ini` | create | rootdir + testpaths |

### Frontend (create / modify)

| Path | Status | Responsibility |
|------|--------|----------------|
| `HiTessWorkBench/frontend/src/api/reports.js` | create | `getUsageReport`, `downloadUsageReportXlsx` |
| `HiTessWorkBench/frontend/src/pages/Administration/UsageReports.jsx` | create | Page container, state machine, layout |
| `HiTessWorkBench/frontend/src/components/admin/reports/PeriodTabs.jsx` | create | D/W/M tab selector |
| `HiTessWorkBench/frontend/src/components/admin/reports/PeriodNavigator.jsx` | create | ◀/▶ + date picker, future guard |
| `HiTessWorkBench/frontend/src/components/admin/reports/ReportKpiGrid.jsx` | create | KPI cards with ▲▼ deltas |
| `HiTessWorkBench/frontend/src/components/admin/reports/PeriodTimeChart.jsx` | create | hour/weekday/day-of-month chart |
| `HiTessWorkBench/frontend/src/components/admin/reports/ReportProgramsTable.jsx` | create | Programs ranking |
| `HiTessWorkBench/frontend/src/components/admin/reports/ReportUsersTable.jsx` | create | Users ranking |
| `HiTessWorkBench/frontend/src/components/admin/reports/ReportDepartmentChart.jsx` | create | Departments distribution |
| `HiTessWorkBench/frontend/src/components/admin/reports/ExportXlsxButton.jsx` | create | Excel download trigger |
| `HiTessWorkBench/frontend/src/App.jsx` | modify | Add `case 'Usage Reports'` to renderPage |
| `HiTessWorkBench/frontend/src/components/layout/Sidebar.jsx` | modify | Insert "Usage Reports" between Analysis Management and System Management |
| `CLAUDE.md` | modify | Add page entry in admin pages table |

---

## Task 1: Set up pytest infrastructure

**Why first:** Backend has no tests. We need infrastructure before TDD.

**Files:**
- Create: `HiTessWorkBenchBackEnd/tests/__init__.py`
- Create: `HiTessWorkBenchBackEnd/tests/conftest.py`
- Create: `HiTessWorkBenchBackEnd/pytest.ini`
- Modify: `HiTessWorkBenchBackEnd/requirements.txt`

- [ ] **Step 1: Add pytest + httpx to requirements.txt**

Append these lines to `HiTessWorkBenchBackEnd/requirements.txt`:

```text
pytest>=8.0.0
httpx>=0.27.0
```

- [ ] **Step 2: Install**

```powershell
cd HiTessWorkBenchBackEnd
WorkBenchEnv\Scripts\activate
pip install pytest httpx
```

Expected: `Successfully installed pytest-... httpx-...`

- [ ] **Step 3: Create empty `tests/__init__.py`**

```python
# Empty marker so pytest treats `tests` as a package.
```

- [ ] **Step 4: Create `pytest.ini`**

`HiTessWorkBenchBackEnd/pytest.ini`:

```ini
[pytest]
testpaths = tests
python_files = test_*.py
addopts = -ra -q
```

- [ ] **Step 5: Create `tests/conftest.py` with in-memory SQLite + session fixture**

```python
"""공통 pytest fixture — 인메모리 SQLite + dependency override."""
import os
import pytest
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from app import database, models
from app.main import app
from app.dependencies import require_auth, require_admin


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    TestingSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    models.Base.metadata.create_all(bind=engine)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()
        models.Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def admin_client(db_session):
    """is_admin=True 사용자로 요청을 보내는 TestClient."""
    def _override_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[database.get_db] = _override_db
    app.dependency_overrides[require_auth] = lambda: "ADMIN001"
    app.dependency_overrides[require_admin] = lambda: "ADMIN001"

    # 시드: admin 사용자
    admin = models.User(
        employee_id="ADMIN001", name="관리자", company="HHI",
        is_active=True, is_admin=True, is_developer=False,
    )
    db_session.add(admin)
    db_session.commit()

    yield TestClient(app)

    app.dependency_overrides.clear()


@pytest.fixture()
def make_analysis(db_session):
    """Analysis 행 생성 헬퍼."""
    def _make(employee_id, program_name, created_at, status="success"):
        a = models.Analysis(
            employee_id=employee_id,
            program_name=program_name,
            project_name="test-project",
            status=status,
            created_at=created_at,
        )
        db_session.add(a)
        db_session.commit()
        return a
    return _make


@pytest.fixture()
def make_user(db_session):
    """User 행 생성 헬퍼."""
    def _make(employee_id, name="홍길동", department="구조해석팀", is_developer=False):
        u = models.User(
            employee_id=employee_id, name=name, company="HHI",
            department=department, is_active=True, is_developer=is_developer,
        )
        db_session.add(u)
        db_session.commit()
        return u
    return _make
```

- [ ] **Step 6: Smoke-test the infrastructure**

Create `HiTessWorkBenchBackEnd/tests/test_smoke.py`:

```python
def test_smoke(db_session, make_user):
    from app import models
    make_user("E001")
    found = db_session.query(models.User).filter_by(employee_id="E001").first()
    assert found is not None
    assert found.name == "홍길동"
```

Run:

```powershell
cd HiTessWorkBenchBackEnd
WorkBenchEnv\Scripts\activate
pytest -v
```

Expected: `1 passed`

- [ ] **Step 7: Delete smoke test and commit**

```powershell
rm tests/test_smoke.py
```

```powershell
git add HiTessWorkBenchBackEnd/requirements.txt HiTessWorkBenchBackEnd/pytest.ini HiTessWorkBenchBackEnd/tests/__init__.py HiTessWorkBenchBackEnd/tests/conftest.py
git commit -m "🧪 test: pytest 인프라 도입 (인메모리 SQLite + fixture)"
```

---

## Task 2: `resolve_period()` — daily, weekly, monthly + future guard (TDD)

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/usage_report_service.py`
- Create: `HiTessWorkBenchBackEnd/tests/test_usage_report_service.py`

- [ ] **Step 1: Write failing tests**

`HiTessWorkBenchBackEnd/tests/test_usage_report_service.py`:

```python
"""Usage Report Service unit tests."""
from datetime import datetime, date
import pytest

from app.services.usage_report_service import resolve_period, PeriodBounds


class TestResolvePeriodDaily:
    def test_daily_single_day(self):
        b = resolve_period("daily", date(2026, 5, 20))
        assert b.start == datetime(2026, 5, 20, 0, 0, 0)
        assert b.end   == datetime(2026, 5, 20, 23, 59, 59, 999999)
        assert b.prev_start == datetime(2026, 5, 19, 0, 0, 0)
        assert b.prev_end   == datetime(2026, 5, 19, 23, 59, 59, 999999)
        assert "2026-05-20" in b.label
        assert b.type == "daily"

    def test_daily_default_is_yesterday(self):
        b = resolve_period("daily", None, today=date(2026, 5, 21))
        assert b.start.date() == date(2026, 5, 20)


class TestResolvePeriodWeekly:
    def test_weekly_simple(self):
        # 2026-05-13 is a Wednesday → week is Mon 05-11 to Sun 05-17
        b = resolve_period("weekly", date(2026, 5, 13))
        assert b.start == datetime(2026, 5, 11, 0, 0, 0)
        assert b.end   == datetime(2026, 5, 17, 23, 59, 59, 999999)
        assert b.prev_start == datetime(2026, 5, 4, 0, 0, 0)
        assert b.prev_end   == datetime(2026, 5, 10, 23, 59, 59, 999999)

    def test_weekly_crosses_month(self):
        # 2026-05-31 is Sunday → week is Mon 05-25 to Sun 05-31
        b = resolve_period("weekly", date(2026, 5, 31))
        assert b.start.date() == date(2026, 5, 25)
        assert b.end.date()   == date(2026, 5, 31)
        assert b.prev_start.date() == date(2026, 5, 18)
        assert b.prev_end.date()   == date(2026, 5, 24)

    def test_weekly_default_is_last_week(self):
        # today = 2026-05-21 (Thursday) → last week = Mon 05-11 ~ Sun 05-17
        b = resolve_period("weekly", None, today=date(2026, 5, 21))
        assert b.start.date() == date(2026, 5, 11)
        assert b.end.date()   == date(2026, 5, 17)


class TestResolvePeriodMonthly:
    def test_monthly_simple(self):
        b = resolve_period("monthly", date(2026, 5, 13))
        assert b.start == datetime(2026, 5, 1, 0, 0, 0)
        assert b.end.date() == date(2026, 5, 31)
        assert b.prev_start.date() == date(2026, 4, 1)
        assert b.prev_end.date()   == date(2026, 4, 30)

    def test_monthly_leap_year(self):
        b = resolve_period("monthly", date(2024, 2, 15))
        assert b.start.date() == date(2024, 2, 1)
        assert b.end.date()   == date(2024, 2, 29)

    def test_monthly_non_leap(self):
        b = resolve_period("monthly", date(2025, 2, 15))
        assert b.end.date() == date(2025, 2, 28)

    def test_monthly_default_is_last_month(self):
        b = resolve_period("monthly", None, today=date(2026, 5, 21))
        assert b.start.date() == date(2026, 4, 1)
        assert b.end.date()   == date(2026, 4, 30)


class TestResolvePeriodGuards:
    def test_invalid_period_raises(self):
        with pytest.raises(ValueError, match="period"):
            resolve_period("yearly", date(2026, 5, 13))

    def test_future_date_raises(self):
        with pytest.raises(ValueError, match="미래"):
            resolve_period("daily", date(2099, 1, 1), today=date(2026, 5, 21))
```

- [ ] **Step 2: Run tests to confirm they fail**

```powershell
pytest tests/test_usage_report_service.py -v
```

Expected: `ImportError: cannot import name 'resolve_period'`

- [ ] **Step 3: Implement `resolve_period`**

`HiTessWorkBenchBackEnd/app/services/usage_report_service.py`:

```python
"""Daily/Weekly/Monthly 사용량 리포트 — 기간 계산·집계·Excel 빌더."""
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from calendar import monthrange
from typing import Optional, Literal

PeriodType = Literal["daily", "weekly", "monthly"]
_WEEKDAY_KR = ["월", "화", "수", "목", "금", "토", "일"]


@dataclass(frozen=True)
class PeriodBounds:
    type: PeriodType
    start: datetime
    end: datetime
    prev_start: datetime
    prev_end: datetime
    label: str
    prev_label: str


def _end_of_day(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, 23, 59, 59, 999999)


def _start_of_day(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, 0, 0, 0)


def resolve_period(
    period: str,
    target: Optional[date],
    today: Optional[date] = None,
) -> PeriodBounds:
    """`period`가 가리키는 달력 기간의 경계를 반환.

    target이 None이면 '직전의 완료된 기간'을 기본값으로 사용한다.
    today는 테스트용 주입 포인트(없으면 실제 오늘).
    """
    if period not in ("daily", "weekly", "monthly"):
        raise ValueError(f"period는 daily, weekly, monthly 중 하나여야 합니다 (받은 값: {period!r})")

    today = today or date.today()

    # 기본값 보정
    if target is None:
        if period == "daily":
            target = today - timedelta(days=1)
        elif period == "weekly":
            target = today - timedelta(days=7)
        else:  # monthly
            target = today.replace(day=1) - timedelta(days=1)

    if target > today:
        raise ValueError("미래 기간은 조회할 수 없습니다.")

    if period == "daily":
        start_d = target
        end_d = target
        prev_start_d = target - timedelta(days=1)
        prev_end_d = prev_start_d
        weekday = _WEEKDAY_KR[start_d.weekday()]
        label = f"{start_d.isoformat()} ({weekday})"
        prev_label = prev_start_d.isoformat()

    elif period == "weekly":
        # Monday=0
        start_d = target - timedelta(days=target.weekday())
        end_d = start_d + timedelta(days=6)
        prev_start_d = start_d - timedelta(days=7)
        prev_end_d = end_d - timedelta(days=7)
        label = f"{start_d.isoformat()} ~ {end_d.isoformat()}"
        prev_label = f"{prev_start_d.isoformat()} ~ {prev_end_d.isoformat()}"

    else:  # monthly
        start_d = target.replace(day=1)
        last_day = monthrange(start_d.year, start_d.month)[1]
        end_d = start_d.replace(day=last_day)
        prev_end_d = start_d - timedelta(days=1)
        prev_start_d = prev_end_d.replace(day=1)
        label = f"{start_d.year}-{start_d.month:02d}"
        prev_label = f"{prev_start_d.year}-{prev_start_d.month:02d}"

    return PeriodBounds(
        type=period,
        start=_start_of_day(start_d),
        end=_end_of_day(end_d),
        prev_start=_start_of_day(prev_start_d),
        prev_end=_end_of_day(prev_end_d),
        label=label,
        prev_label=prev_label,
    )
```

- [ ] **Step 4: Run tests to confirm they pass**

```powershell
pytest tests/test_usage_report_service.py -v
```

Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add HiTessWorkBenchBackEnd/app/services/usage_report_service.py HiTessWorkBenchBackEnd/tests/test_usage_report_service.py
git commit -m "✨ feat(report): resolve_period() — D/W/M 기간 계산 + future guard"
```

---

## Task 3: `aggregate_period()` — counts, developer exclusion, empty (TDD)

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/usage_report_service.py`
- Modify: `HiTessWorkBenchBackEnd/tests/test_usage_report_service.py`

- [ ] **Step 1: Write failing tests** (append to existing test file)

```python
from datetime import datetime
from app.services.usage_report_service import aggregate_period


class TestAggregatePeriod:
    def test_empty_period_returns_zero(self, db_session):
        result = aggregate_period(
            db_session, "daily",
            start=datetime(2026, 5, 20, 0, 0, 0),
            end=datetime(2026, 5, 20, 23, 59, 59, 999999),
        )
        assert result["total"] == 0
        assert result["programs"] == []
        assert result["users"] == []
        assert result["departments"] == []

    def test_basic_counts(self, db_session, make_user, make_analysis):
        make_user("E001", name="홍길동", department="구조해석팀")
        make_user("E002", name="김철수", department="설계팀")
        make_analysis("E001", "Truss Assessment", datetime(2026, 5, 20, 9, 0))
        make_analysis("E001", "Truss Assessment", datetime(2026, 5, 20, 10, 0))
        make_analysis("E001", "BDF Scanner",     datetime(2026, 5, 20, 11, 0))
        make_analysis("E002", "Truss Assessment", datetime(2026, 5, 20, 14, 0))

        result = aggregate_period(
            db_session, "daily",
            start=datetime(2026, 5, 20, 0, 0, 0),
            end=datetime(2026, 5, 20, 23, 59, 59, 999999),
        )
        assert result["total"] == 4
        assert result["activePrograms"] == 2
        assert result["activeUsers"] == 2
        assert result["activeDepartments"] == 2
        # Programs sorted by count desc
        assert result["programs"][0]["name"] == "Truss Assessment"
        assert result["programs"][0]["count"] == 3
        assert result["programs"][0]["userCount"] == 2
        # Users sorted by count desc
        assert result["users"][0]["employeeId"] == "E001"
        assert result["users"][0]["count"] == 3
        assert result["users"][0]["programCount"] == 2
        # busiestProgram + peakHour summary
        assert result["busiestProgram"] == "Truss Assessment"

    def test_excludes_developers_from_stats(self, db_session, make_user, make_analysis):
        make_user("E001", department="구조해석팀", is_developer=False)
        make_user("E002", department="개발팀",   is_developer=True)
        make_analysis("E001", "Truss Assessment", datetime(2026, 5, 20, 9, 0))
        make_analysis("E002", "Truss Assessment", datetime(2026, 5, 20, 10, 0))

        result = aggregate_period(
            db_session, "daily",
            start=datetime(2026, 5, 20, 0, 0, 0),
            end=datetime(2026, 5, 20, 23, 59, 59, 999999),
        )
        assert result["total"] == 1
        assert result["activeUsers"] == 1
        # developer 행은 raw_rows에는 포함되지만 통계엔 없음
        assert "raw_rows" in result
        assert len(result["raw_rows"]) == 2
```

- [ ] **Step 2: Run tests to confirm they fail**

```powershell
pytest tests/test_usage_report_service.py::TestAggregatePeriod -v
```

Expected: `ImportError: cannot import name 'aggregate_period'`

- [ ] **Step 3: Implement `aggregate_period`**

Append to `HiTessWorkBenchBackEnd/app/services/usage_report_service.py`:

```python
from collections import Counter
from sqlalchemy.orm import Session
from app import models


def aggregate_period(db: Session, period: str, start: datetime, end: datetime) -> dict:
    """기간 [start, end] 범위의 해석 데이터를 집계."""
    rows = (
        db.query(models.Analysis, models.User)
          .outerjoin(models.User, models.Analysis.employee_id == models.User.employee_id)
          .filter(models.Analysis.created_at >= start)
          .filter(models.Analysis.created_at <= end)
          .all()
    )
    raw_rows = list(rows)
    stats_rows = [(a, u) for a, u in rows if not (u and u.is_developer)]
    total = len(stats_rows)

    if total == 0:
        return {
            "total": 0, "activePrograms": 0, "activeUsers": 0, "activeDepartments": 0,
            "avgPerDay": 0.0, "maxDay": 0,
            "busiestProgram": None, "peakHour": None, "newUsers": 0,
            "programs": [], "users": [], "departments": [],
            "timeBuckets": {"type": _bucket_type(period), "data": _empty_buckets(period, start, end)},
            "raw_rows": raw_rows,
        }

    program_map: dict[str, dict] = {}
    user_map: dict[str, dict] = {}
    dept_counter = Counter()
    day_counter = Counter()
    hour_counts = [0] * 24
    weekday_counts = [0] * 7

    for a, u in stats_rows:
        pname = a.program_name or "Unknown"
        eid = a.employee_id or "unknown"
        dept = (u.department if u and u.department else "Unknown")
        name = (u.name if u else "Deleted User")
        ts = a.created_at

        p = program_map.setdefault(pname, {"name": pname, "count": 0, "_users": set(), "lastRun": None})
        p["count"] += 1
        p["_users"].add(eid)
        if not p["lastRun"] or ts > p["lastRun"]:
            p["lastRun"] = ts

        u_row = user_map.setdefault(eid, {
            "employeeId": eid, "name": name, "department": dept,
            "count": 0, "_programs": set(), "lastRun": None,
        })
        u_row["count"] += 1
        u_row["_programs"].add(pname)
        if not u_row["lastRun"] or ts > u_row["lastRun"]:
            u_row["lastRun"] = ts

        dept_counter[dept] += 1
        day_counter[ts.date().isoformat()] += 1
        hour_counts[ts.hour] += 1
        weekday_counts[ts.weekday()] += 1

    programs = sorted(
        [
            {
                "name": p["name"],
                "count": p["count"],
                "share": round(p["count"] * 100 / total),
                "userCount": len(p["_users"]),
                "lastRun": p["lastRun"].isoformat() if p["lastRun"] else None,
            }
            for p in program_map.values()
        ],
        key=lambda r: r["count"], reverse=True,
    )
    users = sorted(
        [
            {
                "employeeId": u["employeeId"],
                "name": u["name"],
                "department": u["department"],
                "count": u["count"],
                "share": round(u["count"] * 100 / total),
                "programCount": len(u["_programs"]),
                "lastRun": u["lastRun"].isoformat() if u["lastRun"] else None,
            }
            for u in user_map.values()
        ],
        key=lambda r: r["count"], reverse=True,
    )

    covered_days = max(1, (end.date() - start.date()).days + 1)
    busiest_program = programs[0]["name"] if programs else None
    peak_hour_idx = max(range(24), key=lambda i: hour_counts[i]) if any(hour_counts) else None
    peak_hour = f"{peak_hour_idx:02d}시" if peak_hour_idx is not None else None

    time_buckets = _build_time_buckets(period, start, end, hour_counts, weekday_counts, day_counter)

    return {
        "total": total,
        "activePrograms": len(program_map),
        "activeUsers": len(user_map),
        "activeDepartments": len(dept_counter),
        "avgPerDay": round(total / covered_days, 1),
        "maxDay": max(day_counter.values()) if day_counter else 0,
        "busiestProgram": busiest_program,
        "peakHour": peak_hour,
        "newUsers": 0,  # Task 4에서 채움
        "programs": programs,
        "users": users,
        "departments": [{"name": k, "count": v} for k, v in dept_counter.most_common()],
        "timeBuckets": time_buckets,
        "raw_rows": raw_rows,
    }


def _bucket_type(period: str) -> str:
    return {"daily": "hour", "weekly": "weekday", "monthly": "dayOfMonth"}[period]


def _empty_buckets(period: str, start: datetime, end: datetime) -> list[dict]:
    if period == "daily":
        return [{"label": f"{h:02d}시", "count": 0} for h in range(24)]
    if period == "weekly":
        return [{"label": _WEEKDAY_KR[i], "count": 0} for i in range(7)]
    # monthly
    days = (end.date() - start.date()).days + 1
    return [{"label": str(d), "count": 0} for d in range(1, days + 1)]


def _build_time_buckets(period, start, end, hour_counts, weekday_counts, day_counter) -> dict:
    if period == "daily":
        data = [{"label": f"{h:02d}시", "count": hour_counts[h]} for h in range(24)]
    elif period == "weekly":
        data = [{"label": _WEEKDAY_KR[i], "count": weekday_counts[i]} for i in range(7)]
    else:  # monthly
        days = (end.date() - start.date()).days + 1
        data = []
        for offset in range(days):
            d = (start.date() + timedelta(days=offset))
            data.append({"label": str(d.day), "count": day_counter.get(d.isoformat(), 0)})
    return {"type": _bucket_type(period), "data": data}
```

- [ ] **Step 4: Run tests to confirm they pass**

```powershell
pytest tests/test_usage_report_service.py::TestAggregatePeriod -v
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add HiTessWorkBenchBackEnd/app/services/usage_report_service.py HiTessWorkBenchBackEnd/tests/test_usage_report_service.py
git commit -m "✨ feat(report): aggregate_period() — 통계 집계 + 개발자 제외 + timeBuckets"
```

---

## Task 4: New-user detection + period-over-period deltas (TDD)

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/usage_report_service.py`
- Modify: `HiTessWorkBenchBackEnd/tests/test_usage_report_service.py`

- [ ] **Step 1: Write failing tests**

Append to test file:

```python
class TestNewUsersDetection:
    def test_first_run_in_period_counts_as_new(self, db_session, make_user, make_analysis):
        make_user("E001"); make_user("E002")
        # E001은 5/10에 첫 실행(범위 밖)
        make_analysis("E001", "Truss Assessment", datetime(2026, 5, 10, 9, 0))
        make_analysis("E001", "Truss Assessment", datetime(2026, 5, 20, 9, 0))
        # E002는 5/20에 첫 실행(범위 안)
        make_analysis("E002", "BDF Scanner",      datetime(2026, 5, 20, 10, 0))

        result = aggregate_period(
            db_session, "daily",
            start=datetime(2026, 5, 20, 0, 0, 0),
            end=datetime(2026, 5, 20, 23, 59, 59, 999999),
        )
        assert result["newUsers"] == 1  # E002만


class TestComputeDeltas:
    def test_basic_delta(self):
        from app.services.usage_report_service import compute_deltas
        current = {"total": 122, "activeUsers": 23, "activePrograms": 8, "avgPerDay": 17.4}
        previous = {"total": 100, "activeUsers": 20, "activePrograms": 9, "avgPerDay": 14.3}
        d = compute_deltas(current, previous)
        assert d["total"]["abs"] == 22
        assert d["total"]["pct"] == 22.0
        assert d["activePrograms"]["abs"] == -1
        assert d["activePrograms"]["pct"] == pytest.approx(-11.1, abs=0.1)

    def test_previous_zero_yields_null_pct(self):
        from app.services.usage_report_service import compute_deltas
        d = compute_deltas({"total": 5}, {"total": 0})
        assert d["total"]["abs"] == 5
        assert d["total"]["pct"] is None
```

- [ ] **Step 2: Run tests to confirm they fail**

```powershell
pytest tests/test_usage_report_service.py::TestNewUsersDetection tests/test_usage_report_service.py::TestComputeDeltas -v
```

Expected: 1 fail (newUsers=0), 2 fail (compute_deltas not found).

- [ ] **Step 3: Implement new-user detection**

In `aggregate_period`, replace the `"newUsers": 0,` line with a call to a helper, and add the helper:

```python
def _count_new_users(db: Session, start: datetime, end: datetime, user_ids: set[str]) -> int:
    """user_ids 중, 전체 이력상 첫 실행이 [start, end] 안에 있는 사용자 수."""
    if not user_ids:
        return 0
    from sqlalchemy import func
    rows = (
        db.query(models.Analysis.employee_id, func.min(models.Analysis.created_at))
          .filter(models.Analysis.employee_id.in_(user_ids))
          .group_by(models.Analysis.employee_id)
          .all()
    )
    return sum(1 for _, first_run in rows if start <= first_run <= end)
```

And in `aggregate_period`, replace `"newUsers": 0,` with:

```python
        "newUsers": _count_new_users(db, start, end, set(user_map.keys())),
```

- [ ] **Step 4: Implement `compute_deltas`**

Append to `usage_report_service.py`:

```python
def compute_deltas(current: dict, previous: dict) -> dict:
    """current/previous summary 딕셔너리의 주요 필드 차이를 계산."""
    keys = ("total", "activeUsers", "activePrograms", "avgPerDay")
    out = {}
    for k in keys:
        cur = current.get(k, 0)
        prev = previous.get(k, 0)
        abs_delta = round(cur - prev, 1) if isinstance(cur, float) or isinstance(prev, float) else cur - prev
        if prev == 0:
            pct = None
        else:
            pct = round((cur - prev) * 100 / prev, 1)
        out[k] = {"abs": abs_delta, "pct": pct}
    return out
```

- [ ] **Step 5: Run all service tests to confirm green**

```powershell
pytest tests/test_usage_report_service.py -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add HiTessWorkBenchBackEnd/app/services/usage_report_service.py HiTessWorkBenchBackEnd/tests/test_usage_report_service.py
git commit -m "✨ feat(report): newUsers 탐지 + compute_deltas() 전 기간 대비 증감"
```

---

## Task 5: Pydantic response schemas

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/schemas/__init__.py` (if not exists)
- Create: `HiTessWorkBenchBackEnd/app/schemas/usage_report.py`

- [ ] **Step 1: Check if `app/schemas` is a package**

```powershell
ls HiTessWorkBenchBackEnd/app/schemas/ 2>$null
```

If directory doesn't exist (file `schemas.py` exists instead), still create the new file inside a new package directory (the codebase already imports from `app.schemas` flat module, but new code can use `app.schemas.usage_report`). Create directory and an `__init__.py` that re-exports nothing new.

Actually simpler: just put usage_report schemas in a single new file `app/schemas/usage_report.py`. If `app/schemas.py` exists as a flat module, Python won't allow `app/schemas/` as a package with the same name. **Verify first**:

```powershell
ls HiTessWorkBenchBackEnd/app/schemas*
```

- If `schemas.py` exists → use a NEW flat file `app/usage_report_schemas.py` instead. Adjust imports later.
- If `schemas/` package exists → put it at `app/schemas/usage_report.py`.

Pick the path that works; for the rest of this plan we assume `app/schemas/usage_report.py`. If you took the alternate path, adjust import statements throughout.

- [ ] **Step 2: Create the schema file**

```python
"""Usage Report API 응답 스키마."""
from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel


class PeriodMeta(BaseModel):
    type: Literal["daily", "weekly", "monthly"]
    start: datetime
    end: datetime
    label: str


class PrevPeriodMeta(BaseModel):
    start: datetime
    end: datetime
    label: str


class DeltaValue(BaseModel):
    abs: float
    pct: Optional[float] = None


class Summary(BaseModel):
    total: int
    activePrograms: int
    activeUsers: int
    activeDepartments: int
    avgPerDay: float
    maxDay: int
    busiestProgram: Optional[str]
    peakHour: Optional[str]
    newUsers: int


class ProgramRow(BaseModel):
    name: str
    count: int
    share: int
    userCount: int
    lastRun: Optional[str]


class UserRow(BaseModel):
    employeeId: str
    name: str
    department: str
    count: int
    share: int
    programCount: int
    lastRun: Optional[str]


class DeptRow(BaseModel):
    name: str
    count: int


class TimeBucketItem(BaseModel):
    label: str
    count: int


class TimeBuckets(BaseModel):
    type: Literal["hour", "weekday", "dayOfMonth"]
    data: list[TimeBucketItem]


class UsageReportResponse(BaseModel):
    period: PeriodMeta
    previous: PrevPeriodMeta
    summary: Summary
    deltas: dict[str, DeltaValue]
    programs: list[ProgramRow]
    users: list[UserRow]
    departments: list[DeptRow]
    timeBuckets: TimeBuckets
```

- [ ] **Step 3: Commit**

```powershell
git add HiTessWorkBenchBackEnd/app/schemas/usage_report.py
git commit -m "✨ feat(report): UsageReportResponse Pydantic 스키마"
```

---

## Task 6: `GET /api/analysis/report` endpoint (TDD)

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/routers/analysis.py`
- Create: `HiTessWorkBenchBackEnd/tests/test_usage_report_api.py`

- [ ] **Step 1: Write failing API tests**

`HiTessWorkBenchBackEnd/tests/test_usage_report_api.py`:

```python
from datetime import datetime, date


def test_report_endpoint_returns_200(admin_client, make_user, make_analysis):
    make_user("E001", department="구조해석팀")
    make_analysis("E001", "Truss Assessment", datetime(2026, 5, 20, 9, 0))
    r = admin_client.get("/api/analysis/report?period=daily&date=2026-05-20")
    assert r.status_code == 200
    body = r.json()
    assert body["period"]["type"] == "daily"
    assert body["summary"]["total"] == 1
    assert body["programs"][0]["name"] == "Truss Assessment"


def test_report_endpoint_default_date_yesterday(admin_client):
    r = admin_client.get("/api/analysis/report?period=daily")
    assert r.status_code == 200
    # 기본값 = 어제: total==0 도 정상 응답
    assert "summary" in r.json()


def test_report_endpoint_invalid_period(admin_client):
    r = admin_client.get("/api/analysis/report?period=yearly")
    assert r.status_code in (400, 422)  # FastAPI Literal 검증은 422


def test_report_endpoint_future_date(admin_client):
    r = admin_client.get("/api/analysis/report?period=daily&date=2099-01-01")
    assert r.status_code == 400


def test_report_endpoint_requires_admin(db_session, make_user):
    """admin_client 대신 비-admin 사용자 토큰으로 직접 테스트."""
    from fastapi.testclient import TestClient
    from app.main import app
    from app import database
    from app.dependencies import require_auth

    make_user("USER001", is_developer=False)

    def _override_db():
        yield db_session
    app.dependency_overrides[database.get_db] = _override_db
    app.dependency_overrides[require_auth] = lambda: "USER001"

    client = TestClient(app)
    r = client.get("/api/analysis/report?period=daily")
    assert r.status_code == 403
    app.dependency_overrides.clear()
```

- [ ] **Step 2: Run tests to confirm they fail (route doesn't exist yet)**

```powershell
pytest tests/test_usage_report_api.py -v
```

Expected: 404s.

- [ ] **Step 3: Add endpoint to `routers/analysis.py`**

Find the `# ==================== 통계 ====================` section in `app/routers/analysis.py` and insert this NEW block after the existing top-programs endpoint (around line 138-140):

```python
# ==================== Usage Report (Daily/Weekly/Monthly) ====================

from datetime import date as _date
from app.services import usage_report_service
from app.schemas.usage_report import UsageReportResponse


@router.get("/analysis/report", response_model=UsageReportResponse)
def get_usage_report(
    period: str = Query(..., description="daily | weekly | monthly"),
    date: Optional[_date] = Query(None, description="기간이 속하는 날짜 (YYYY-MM-DD)"),
    db: Session = Depends(database.get_db),
    _admin: str = Depends(require_admin),
):
    """관리자 전용 D/W/M 사용량 리포트."""
    try:
        bounds = usage_report_service.resolve_period(period, date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    current = usage_report_service.aggregate_period(db, period, bounds.start, bounds.end)
    previous = usage_report_service.aggregate_period(db, period, bounds.prev_start, bounds.prev_end)
    deltas = usage_report_service.compute_deltas(current, previous)

    return {
        "period": {
            "type": bounds.type, "start": bounds.start, "end": bounds.end, "label": bounds.label,
        },
        "previous": {
            "start": bounds.prev_start, "end": bounds.prev_end, "label": bounds.prev_label,
        },
        "summary": {k: current[k] for k in (
            "total", "activePrograms", "activeUsers", "activeDepartments",
            "avgPerDay", "maxDay", "busiestProgram", "peakHour", "newUsers",
        )},
        "deltas": deltas,
        "programs": current["programs"],
        "users": current["users"],
        "departments": current["departments"],
        "timeBuckets": current["timeBuckets"],
    }
```

Verify the imports at the top of `analysis.py` include `Optional`, `Query`, `Depends`, `Session`, `HTTPException`, `require_admin`, `database`. Add what's missing.

- [ ] **Step 4: Run API tests to confirm they pass**

```powershell
pytest tests/test_usage_report_api.py -v
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add HiTessWorkBenchBackEnd/app/routers/analysis.py HiTessWorkBenchBackEnd/tests/test_usage_report_api.py
git commit -m "✨ feat(report): GET /api/analysis/report 엔드포인트 + admin 게이트"
```

---

## Task 7: `build_report_xlsx()` — 6 시트 (TDD)

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/usage_report_service.py`
- Modify: `HiTessWorkBenchBackEnd/tests/test_usage_report_service.py`

- [ ] **Step 1: Write failing test**

Append to `test_usage_report_service.py`:

```python
class TestBuildReportXlsx:
    def test_xlsx_has_six_sheets(self, db_session, make_user, make_analysis):
        from app.services.usage_report_service import build_report_xlsx, aggregate_period, resolve_period, compute_deltas
        from openpyxl import load_workbook
        import io

        make_user("E001", department="구조해석팀")
        make_analysis("E001", "Truss Assessment", datetime(2026, 5, 20, 9, 0))
        make_analysis("E001", "BDF Scanner",      datetime(2026, 5, 20, 10, 0))

        bounds = resolve_period("daily", date(2026, 5, 20))
        cur = aggregate_period(db_session, "daily", bounds.start, bounds.end)
        prev = aggregate_period(db_session, "daily", bounds.prev_start, bounds.prev_end)
        deltas = compute_deltas(cur, prev)

        buf = build_report_xlsx(bounds, cur, prev, deltas)
        wb = load_workbook(io.BytesIO(buf.getvalue()))
        assert set(wb.sheetnames) == {"Summary", "Programs", "Users", "Departments", "Time Distribution", "Raw Data"}

    def test_xlsx_summary_total_matches_json(self, db_session, make_user, make_analysis):
        from app.services.usage_report_service import build_report_xlsx, aggregate_period, resolve_period, compute_deltas
        from openpyxl import load_workbook
        import io

        make_user("E001")
        for h in range(5):
            make_analysis("E001", "Truss Assessment", datetime(2026, 5, 20, 9 + h, 0))

        bounds = resolve_period("daily", date(2026, 5, 20))
        cur = aggregate_period(db_session, "daily", bounds.start, bounds.end)
        prev = aggregate_period(db_session, "daily", bounds.prev_start, bounds.prev_end)
        deltas = compute_deltas(cur, prev)

        buf = build_report_xlsx(bounds, cur, prev, deltas)
        wb = load_workbook(io.BytesIO(buf.getvalue()))
        summary_sheet = wb["Summary"]
        # 첫 컬럼은 라벨, 두번째 컬럼은 값. "총 실행 수" 행 찾기.
        values = {row[0].value: row[1].value for row in summary_sheet.iter_rows() if row[0].value}
        assert values.get("총 실행 수") == 5
```

- [ ] **Step 2: Run test to confirm it fails**

```powershell
pytest tests/test_usage_report_service.py::TestBuildReportXlsx -v
```

Expected: `ImportError: cannot import name 'build_report_xlsx'`

- [ ] **Step 3: Implement `build_report_xlsx`**

Append to `app/services/usage_report_service.py`:

```python
import io
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill


def build_report_xlsx(bounds: PeriodBounds, current: dict, previous: dict, deltas: dict) -> io.BytesIO:
    """6개 시트의 Excel 리포트를 BytesIO로 반환."""
    wb = Workbook()
    _build_summary_sheet(wb, bounds, current, previous, deltas)
    _build_table_sheet(wb, "Programs", current["programs"],
                       columns=[("순위", None), ("프로그램", "name"), ("실행수", "count"),
                                ("점유율(%)", "share"), ("사용자수", "userCount"), ("최근실행", "lastRun")])
    _build_table_sheet(wb, "Users", current["users"],
                       columns=[("순위", None), ("사번", "employeeId"), ("이름", "name"),
                                ("부서", "department"), ("실행수", "count"), ("점유율(%)", "share"),
                                ("사용프로그램수", "programCount"), ("최근실행", "lastRun")])
    _build_dept_sheet(wb, current)
    _build_time_sheet(wb, current["timeBuckets"])
    _build_raw_sheet(wb, current["raw_rows"])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


_HEADER_FONT = Font(bold=True, color="FFFFFFFF")
_HEADER_FILL = PatternFill("solid", fgColor="FF2563EB")


def _apply_header_style(cell):
    cell.font = _HEADER_FONT
    cell.fill = _HEADER_FILL
    cell.alignment = Alignment(horizontal="center")


def _build_summary_sheet(wb, bounds: PeriodBounds, current: dict, previous: dict, deltas: dict):
    ws = wb.active
    ws.title = "Summary"
    ws.append(["항목", "값", "전 기간 대비"])
    for c in ws[1]:
        _apply_header_style(c)

    rows = [
        ("기간", bounds.label, ""),
        ("이전 기간", bounds.prev_label, ""),
        ("총 실행 수", current["total"], _fmt_delta(deltas.get("total"))),
        ("활성 프로그램 수", current["activePrograms"], _fmt_delta(deltas.get("activePrograms"))),
        ("활성 사용자 수", current["activeUsers"], _fmt_delta(deltas.get("activeUsers"))),
        ("활성 부서 수", current["activeDepartments"], ""),
        ("일평균 실행 수", current["avgPerDay"], _fmt_delta(deltas.get("avgPerDay"))),
        ("최대 일일 실행 수", current["maxDay"], ""),
        ("최다 사용 프로그램", current["busiestProgram"] or "-", ""),
        ("피크 시간대", current["peakHour"] or "-", ""),
        ("신규 사용자 수", current["newUsers"], ""),
    ]
    for r in rows:
        ws.append(list(r))
    for col in (1, 2, 3):
        ws.column_dimensions[chr(64 + col)].width = 24


def _fmt_delta(d: Optional[dict]) -> str:
    if not d:
        return ""
    sign = "+" if d["abs"] >= 0 else ""
    pct = "" if d["pct"] is None else f" ({sign}{d['pct']}%)"
    return f"{sign}{d['abs']}{pct}"


def _build_table_sheet(wb, title: str, rows: list[dict], columns: list[tuple]):
    ws = wb.create_sheet(title)
    headers = [c[0] for c in columns]
    ws.append(headers)
    for c in ws[1]:
        _apply_header_style(c)
    for i, r in enumerate(rows, start=1):
        row_values = []
        for label, key in columns:
            if key is None:
                row_values.append(i)
            else:
                row_values.append(r.get(key, ""))
        ws.append(row_values)
    for idx in range(1, len(headers) + 1):
        ws.column_dimensions[chr(64 + idx)].width = 18


def _build_dept_sheet(wb, current: dict):
    ws = wb.create_sheet("Departments")
    ws.append(["부서", "실행수", "점유율(%)"])
    for c in ws[1]:
        _apply_header_style(c)
    total = current["total"] or 1
    for d in current["departments"]:
        ws.append([d["name"], d["count"], round(d["count"] * 100 / total)])
    for idx in range(1, 4):
        ws.column_dimensions[chr(64 + idx)].width = 20


def _build_time_sheet(wb, time_buckets: dict):
    ws = wb.create_sheet("Time Distribution")
    label_header = {"hour": "시간대", "weekday": "요일", "dayOfMonth": "일자"}[time_buckets["type"]]
    ws.append([label_header, "실행수"])
    for c in ws[1]:
        _apply_header_style(c)
    for b in time_buckets["data"]:
        ws.append([b["label"], b["count"]])
    for idx in range(1, 3):
        ws.column_dimensions[chr(64 + idx)].width = 18


def _build_raw_sheet(wb, raw_rows):
    ws = wb.create_sheet("Raw Data")
    ws.append(["ID", "프로젝트", "프로그램", "사번", "이름", "부서", "상태", "실행시각", "개발자"])
    for c in ws[1]:
        _apply_header_style(c)
    for a, u in raw_rows:
        ws.append([
            a.id,
            getattr(a, "project_name", "") or "",
            a.program_name or "",
            a.employee_id or "",
            (u.name if u else "Deleted User"),
            (u.department if u and u.department else "Unknown"),
            a.status or "",
            a.created_at.isoformat() if a.created_at else "",
            "Y" if (u and u.is_developer) else "",
        ])
    widths = [8, 24, 28, 12, 14, 18, 12, 22, 8]
    for idx, w in enumerate(widths, start=1):
        ws.column_dimensions[chr(64 + idx)].width = w
```

- [ ] **Step 4: Run tests to confirm they pass**

```powershell
pytest tests/test_usage_report_service.py::TestBuildReportXlsx -v
```

Expected: both pass.

- [ ] **Step 5: Commit**

```powershell
git add HiTessWorkBenchBackEnd/app/services/usage_report_service.py HiTessWorkBenchBackEnd/tests/test_usage_report_service.py
git commit -m "✨ feat(report): build_report_xlsx() — 6개 시트 Excel 빌더"
```

---

## Task 8: `GET /api/analysis/report/export-xlsx` endpoint (TDD)

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/routers/analysis.py`
- Modify: `HiTessWorkBenchBackEnd/tests/test_usage_report_api.py`

- [ ] **Step 1: Write failing test**

Append to `test_usage_report_api.py`:

```python
def test_xlsx_endpoint_returns_xlsx(admin_client, make_user, make_analysis):
    make_user("E001", department="구조해석팀")
    make_analysis("E001", "Truss Assessment", datetime(2026, 5, 20, 9, 0))
    r = admin_client.get("/api/analysis/report/export-xlsx?period=daily&date=2026-05-20")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "WorkBench_UsageReport" in r.headers.get("content-disposition", "")

    # 응답 본문이 실제 유효한 xlsx인지 확인
    from openpyxl import load_workbook
    import io
    wb = load_workbook(io.BytesIO(r.content))
    assert "Summary" in wb.sheetnames


def test_xlsx_endpoint_requires_admin(db_session, make_user):
    from fastapi.testclient import TestClient
    from app.main import app
    from app import database
    from app.dependencies import require_auth

    make_user("USER001")

    def _override_db():
        yield db_session
    app.dependency_overrides[database.get_db] = _override_db
    app.dependency_overrides[require_auth] = lambda: "USER001"

    r = TestClient(app).get("/api/analysis/report/export-xlsx?period=daily")
    assert r.status_code == 403
    app.dependency_overrides.clear()
```

- [ ] **Step 2: Run test to confirm it fails**

```powershell
pytest tests/test_usage_report_api.py::test_xlsx_endpoint_returns_xlsx -v
```

Expected: 404.

- [ ] **Step 3: Add endpoint to `routers/analysis.py`**

Right below the `get_usage_report` function, add:

```python
from fastapi.responses import StreamingResponse


@router.get("/analysis/report/export-xlsx")
def export_usage_report_xlsx(
    period: str = Query(...),
    date: Optional[_date] = Query(None),
    db: Session = Depends(database.get_db),
    _admin: str = Depends(require_admin),
):
    try:
        bounds = usage_report_service.resolve_period(period, date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    current = usage_report_service.aggregate_period(db, period, bounds.start, bounds.end)
    previous = usage_report_service.aggregate_period(db, period, bounds.prev_start, bounds.prev_end)
    deltas = usage_report_service.compute_deltas(current, previous)

    try:
        buf = usage_report_service.build_report_xlsx(bounds, current, previous, deltas)
    except Exception as e:
        raise HTTPException(status_code=500, detail="Excel 생성 중 오류가 발생했습니다.") from e

    fname = (
        f"WorkBench_UsageReport_{period.capitalize()}_"
        f"{bounds.start.date().strftime('%Y%m%d')}_{bounds.end.date().strftime('%Y%m%d')}.xlsx"
    )
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
```

- [ ] **Step 4: Run tests to confirm they pass**

```powershell
pytest tests/test_usage_report_api.py -v
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add HiTessWorkBenchBackEnd/app/routers/analysis.py HiTessWorkBenchBackEnd/tests/test_usage_report_api.py
git commit -m "✨ feat(report): GET /api/analysis/report/export-xlsx — Excel 다운로드"
```

---

## Task 9: Frontend API client (`api/reports.js`)

**Files:**
- Create: `HiTessWorkBench/frontend/src/api/reports.js`

- [ ] **Step 1: Create the file**

```javascript
import axios from 'axios';
import { getApiBaseUrl } from '../config';

function authHeaders() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    const token = user?.token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/**
 * D/W/M 사용량 리포트 조회.
 * @param {object} params
 * @param {'daily'|'weekly'|'monthly'} params.period
 * @param {string|null} [params.date] - YYYY-MM-DD
 * @param {AbortSignal} [params.signal]
 */
export function getUsageReport({ period, date, signal }) {
  const url = `${getApiBaseUrl()}/api/analysis/report`;
  return axios.get(url, {
    params: { period, ...(date ? { date } : {}) },
    headers: authHeaders(),
    signal,
  });
}

/**
 * 리포트 Excel 다운로드 — Blob을 받아 브라우저 다운로드 트리거.
 */
export async function downloadUsageReportXlsx({ period, date }) {
  const url = `${getApiBaseUrl()}/api/analysis/report/export-xlsx`;
  const res = await axios.get(url, {
    params: { period, ...(date ? { date } : {}) },
    headers: authHeaders(),
    responseType: 'blob',
  });

  const disposition = res.headers['content-disposition'] || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match ? match[1] : `WorkBench_UsageReport_${period}_${date || ''}.xlsx`;

  const blobUrl = URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
}
```

- [ ] **Step 2: Verify the existing pattern**

Confirm `getApiBaseUrl()` exists in `src/config.js`. If function name differs (e.g., `DEFAULT_API_BASE_URL` is exported as a constant), adjust accordingly. CLAUDE.md mentions `setApiBaseUrl()`, so `getApiBaseUrl()` likely exists too.

- [ ] **Step 3: Commit**

```powershell
git add HiTessWorkBench/frontend/src/api/reports.js
git commit -m "✨ feat(report): api/reports.js — getUsageReport + downloadUsageReportXlsx"
```

---

## Task 10: Refactor `AnalysisStatsDashboard` to export sub-components

**Why:** Report components reuse `KpiCard` and tables. Current file defines them internally.

**Files:**
- Modify: `HiTessWorkBench/frontend/src/components/admin/AnalysisStatsDashboard.jsx`

- [ ] **Step 1: Open file, locate internal `function KpiCard`, `function ProgramTable`, `function UserTable` (etc.)**

- [ ] **Step 2: Add `export` keyword to each of these inner function declarations**

Example: change

```javascript
function KpiCard({ label, value, sub, icon: Icon, color }) {
```

to

```javascript
export function KpiCard({ label, value, sub, icon: Icon, color }) {
```

Do the same for `ProgramTable`, `UserTable`, and any other internal helper that the Report components will need (`COLORS` constant too, if used).

- [ ] **Step 3: Verify nothing broke**

```powershell
cd HiTessWorkBench
npm run dev
```

Open the existing `Analysis Management` page in browser, confirm it still renders correctly.

Press Ctrl+C to stop dev server.

- [ ] **Step 4: Commit**

```powershell
git add HiTessWorkBench/frontend/src/components/admin/AnalysisStatsDashboard.jsx
git commit -m "♻️ refactor(admin): KpiCard/ProgramTable/UserTable export — 리포트 페이지 재사용"
```

---

## Task 11: `PeriodTabs.jsx` + `PeriodNavigator.jsx`

**Files:**
- Create: `HiTessWorkBench/frontend/src/components/admin/reports/PeriodTabs.jsx`
- Create: `HiTessWorkBench/frontend/src/components/admin/reports/PeriodNavigator.jsx`

- [ ] **Step 1: PeriodTabs.jsx**

```jsx
import React from 'react';
import { CalendarDays, CalendarRange, Calendar } from 'lucide-react';

const TABS = [
  { key: 'daily',   label: 'Daily',   icon: CalendarDays },
  { key: 'weekly',  label: 'Weekly',  icon: CalendarRange },
  { key: 'monthly', label: 'Monthly', icon: Calendar },
];

export default function PeriodTabs({ value, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
      {TABS.map(t => {
        const Icon = t.icon;
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`flex items-center gap-2 px-5 py-2 text-sm font-bold transition ${
              active
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Icon size={16} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: PeriodNavigator.jsx**

```jsx
import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

function fmtToday() {
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(period, dateISO, direction) {
  const d = new Date(dateISO + 'T00:00:00');
  if (period === 'daily')   d.setDate(d.getDate() + direction);
  if (period === 'weekly')  d.setDate(d.getDate() + 7 * direction);
  if (period === 'monthly') d.setMonth(d.getMonth() + direction);
  return d.toISOString().slice(0, 10);
}

export default function PeriodNavigator({ period, date, label, onChange }) {
  const today = fmtToday();
  const isFutureNext = useMemo(() => shiftDate(period, date, +1) > today, [period, date, today]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(shiftDate(period, date, -1))}
        className="p-2 rounded-md border border-slate-200 bg-white hover:bg-slate-50"
        aria-label="이전 기간"
      >
        <ChevronLeft size={18} className="text-slate-600" />
      </button>
      <div className="px-4 py-2 min-w-[260px] text-center rounded-md border border-slate-200 bg-white text-sm font-bold text-slate-800">
        {label || '—'}
      </div>
      <button
        type="button"
        disabled={isFutureNext}
        onClick={() => onChange(shiftDate(period, date, +1))}
        className={`p-2 rounded-md border border-slate-200 bg-white ${isFutureNext ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-50'}`}
        aria-label="다음 기간"
      >
        <ChevronRight size={18} className="text-slate-600" />
      </button>
      <div className="flex items-center gap-1 px-3 py-2 rounded-md border border-slate-200 bg-white">
        <Calendar size={16} className="text-slate-500" />
        <input
          type="date"
          value={date}
          max={today}
          onChange={e => onChange(e.target.value)}
          className="text-sm text-slate-700 bg-transparent outline-none"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```powershell
git add HiTessWorkBench/frontend/src/components/admin/reports/PeriodTabs.jsx HiTessWorkBench/frontend/src/components/admin/reports/PeriodNavigator.jsx
git commit -m "✨ feat(report): PeriodTabs + PeriodNavigator (▶ 미래 가드 포함)"
```

---

## Task 12: `ReportKpiGrid.jsx` (KPI cards + delta indicators)

**Files:**
- Create: `HiTessWorkBench/frontend/src/components/admin/reports/ReportKpiGrid.jsx`

- [ ] **Step 1: Create file**

```jsx
import React from 'react';
import { Activity, Users, Layers, Building2, TrendingUp, Trophy, Sun, CalendarDays } from 'lucide-react';
import { KpiCard } from '../AnalysisStatsDashboard';

function DeltaBadge({ delta }) {
  if (!delta || delta.abs === 0) return null;
  const positive = delta.abs > 0;
  const pct = delta.pct;
  const text = pct === null ? `${positive ? '+' : ''}${delta.abs}` : `${positive ? '+' : ''}${pct}%`;
  return (
    <span className={`ml-1 text-xs font-bold ${positive ? 'text-emerald-600' : 'text-rose-600'}`}>
      {positive ? '▲' : '▼'} {text}
    </span>
  );
}

export default function ReportKpiGrid({ summary, deltas }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiCard label="총 실행 수"        value={<>{summary.total}<DeltaBadge delta={deltas?.total} /></>}        icon={Activity} color="blue"    />
      <KpiCard label="활성 사용자"        value={<>{summary.activeUsers}<DeltaBadge delta={deltas?.activeUsers} /></>}    icon={Users}    color="emerald" />
      <KpiCard label="활성 프로그램"      value={<>{summary.activePrograms}<DeltaBadge delta={deltas?.activePrograms} /></>} icon={Layers}   color="amber"  />
      <KpiCard label="활성 부서"          value={summary.activeDepartments}                                          icon={Building2} color="violet" />
      <KpiCard label="일평균 실행"        value={<>{summary.avgPerDay}<DeltaBadge delta={deltas?.avgPerDay} /></>} icon={TrendingUp} color="blue"   />
      <KpiCard label="최대 일일 실행"     value={summary.maxDay}             icon={CalendarDays} color="emerald" />
      <KpiCard label="최다 사용 프로그램" value={summary.busiestProgram || '-'} icon={Trophy}      color="amber"   />
      <KpiCard label="피크 시간대 / 신규" value={`${summary.peakHour || '-'} · 신규 ${summary.newUsers}명`} icon={Sun} color="violet" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```powershell
git add HiTessWorkBench/frontend/src/components/admin/reports/ReportKpiGrid.jsx
git commit -m "✨ feat(report): ReportKpiGrid — KPI + ▲▼ 전 기간 대비 표시"
```

---

## Task 13: `PeriodTimeChart.jsx`

**Files:**
- Create: `HiTessWorkBench/frontend/src/components/admin/reports/PeriodTimeChart.jsx`

- [ ] **Step 1: Create file**

```jsx
import React from 'react';
import { Clock3 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const TITLE_MAP = {
  hour:       '시간대별 실행 분포',
  weekday:    '요일별 실행 분포',
  dayOfMonth: '일자별 실행 분포',
};

export default function PeriodTimeChart({ timeBuckets }) {
  if (!timeBuckets || !timeBuckets.data?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <Clock3 size={16} className="text-blue-600" />
        <h3 className="text-sm font-bold text-slate-800">{TITLE_MAP[timeBuckets.type] || '시간 분포'}</h3>
      </div>
      <div className="p-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={timeBuckets.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```powershell
git add HiTessWorkBench/frontend/src/components/admin/reports/PeriodTimeChart.jsx
git commit -m "✨ feat(report): PeriodTimeChart — 기간 맞춤 시간축 막대 차트"
```

---

## Task 14: Programs / Users / Departments tables

**Files:**
- Create: `HiTessWorkBench/frontend/src/components/admin/reports/ReportProgramsTable.jsx`
- Create: `HiTessWorkBench/frontend/src/components/admin/reports/ReportUsersTable.jsx`
- Create: `HiTessWorkBench/frontend/src/components/admin/reports/ReportDepartmentChart.jsx`

- [ ] **Step 1: ReportProgramsTable.jsx**

```jsx
import React from 'react';
import { Layers } from 'lucide-react';

export default function ReportProgramsTable({ programs }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Layers size={16} className="text-blue-600" /> 프로그램별 사용 통계
        </h3>
        <span className="text-xs text-slate-400">사용량순</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-5 py-3 text-left font-bold">프로그램</th>
              <th className="px-4 py-3 text-right font-bold">실행</th>
              <th className="px-4 py-3 text-right font-bold">점유율</th>
              <th className="px-4 py-3 text-right font-bold">사용자</th>
              <th className="px-5 py-3 text-right font-bold">최근 실행</th>
            </tr>
          </thead>
          <tbody>
            {programs.length === 0 ? (
              <tr><td className="px-5 py-6 text-center text-slate-400" colSpan={5}>데이터 없음</td></tr>
            ) : programs.map(p => (
              <tr key={p.name} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-5 py-3 font-medium text-slate-800">{p.name}</td>
                <td className="px-4 py-3 text-right text-slate-700">{p.count}</td>
                <td className="px-4 py-3 text-right text-slate-500">{p.share}%</td>
                <td className="px-4 py-3 text-right text-slate-700">{p.userCount}</td>
                <td className="px-5 py-3 text-right text-xs text-slate-500">
                  {p.lastRun ? new Date(p.lastRun).toLocaleString() : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: ReportUsersTable.jsx**

```jsx
import React from 'react';
import { Users } from 'lucide-react';

export default function ReportUsersTable({ users }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Users size={16} className="text-emerald-600" /> 사용자별 사용 통계
        </h3>
        <span className="text-xs text-slate-400">실행 횟수순</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-5 py-3 text-left font-bold">사번</th>
              <th className="px-4 py-3 text-left font-bold">이름</th>
              <th className="px-4 py-3 text-left font-bold">부서</th>
              <th className="px-4 py-3 text-right font-bold">실행</th>
              <th className="px-4 py-3 text-right font-bold">점유율</th>
              <th className="px-4 py-3 text-right font-bold">사용 앱 수</th>
              <th className="px-5 py-3 text-right font-bold">최근 실행</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td className="px-5 py-6 text-center text-slate-400" colSpan={7}>데이터 없음</td></tr>
            ) : users.map(u => (
              <tr key={u.employeeId} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-5 py-3 font-mono text-xs text-slate-600">{u.employeeId}</td>
                <td className="px-4 py-3 text-slate-800">{u.name}</td>
                <td className="px-4 py-3 text-slate-600">{u.department}</td>
                <td className="px-4 py-3 text-right text-slate-700">{u.count}</td>
                <td className="px-4 py-3 text-right text-slate-500">{u.share}%</td>
                <td className="px-4 py-3 text-right text-slate-700">{u.programCount}</td>
                <td className="px-5 py-3 text-right text-xs text-slate-500">
                  {u.lastRun ? new Date(u.lastRun).toLocaleString() : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: ReportDepartmentChart.jsx**

```jsx
import React from 'react';
import { Building2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function ReportDepartmentChart({ departments }) {
  if (!departments?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <Building2 size={16} className="text-violet-600" />
        <h3 className="text-sm font-bold text-slate-800">부서별 실행 분포</h3>
      </div>
      <div className="p-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={departments.slice(0, 8)} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={120} />
            <Tooltip />
            <Bar dataKey="count" fill="#7c3aed" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```powershell
git add HiTessWorkBench/frontend/src/components/admin/reports/ReportProgramsTable.jsx HiTessWorkBench/frontend/src/components/admin/reports/ReportUsersTable.jsx HiTessWorkBench/frontend/src/components/admin/reports/ReportDepartmentChart.jsx
git commit -m "✨ feat(report): Programs/Users/Department 시각화 컴포넌트"
```

---

## Task 15: `ExportXlsxButton.jsx`

**Files:**
- Create: `HiTessWorkBench/frontend/src/components/admin/reports/ExportXlsxButton.jsx`

- [ ] **Step 1: Create file**

```jsx
import React, { useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { downloadUsageReportXlsx } from '../../../api/reports';
import { useToast } from '../../../contexts/ToastContext';

export default function ExportXlsxButton({ period, date, disabled }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const onClick = async () => {
    setBusy(true);
    try {
      await downloadUsageReportXlsx({ period, date });
      toast?.success?.('Excel 다운로드 완료');
    } catch (e) {
      toast?.error?.('Excel 다운로드 실패 — 다시 시도해주세요');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-md transition shadow-sm
        ${disabled || busy ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                           : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
    >
      {busy ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
      Excel 다운로드
    </button>
  );
}
```

- [ ] **Step 2: Confirm `useToast` shape**

Open `src/contexts/ToastContext.jsx` and verify the hook returns an object with `success`/`error` methods. If the API differs (e.g., `toast.show(msg, 'error')`), adjust calls. CLAUDE.md confirms `useToast` exists but doesn't specify the API.

- [ ] **Step 3: Commit**

```powershell
git add HiTessWorkBench/frontend/src/components/admin/reports/ExportXlsxButton.jsx
git commit -m "✨ feat(report): ExportXlsxButton — Excel 다운로드 트리거"
```

---

## Task 16: `UsageReports.jsx` page container + integration

**Files:**
- Create: `HiTessWorkBench/frontend/src/pages/Administration/UsageReports.jsx`

- [ ] **Step 1: Create the page container**

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getUsageReport } from '../../api/reports';
import PeriodTabs from '../../components/admin/reports/PeriodTabs';
import PeriodNavigator from '../../components/admin/reports/PeriodNavigator';
import ReportKpiGrid from '../../components/admin/reports/ReportKpiGrid';
import PeriodTimeChart from '../../components/admin/reports/PeriodTimeChart';
import ReportProgramsTable from '../../components/admin/reports/ReportProgramsTable';
import ReportUsersTable from '../../components/admin/reports/ReportUsersTable';
import ReportDepartmentChart from '../../components/admin/reports/ReportDepartmentChart';
import ExportXlsxButton from '../../components/admin/reports/ExportXlsxButton';

function defaultDateFor(period) {
  const d = new Date();
  if (period === 'daily') {
    d.setDate(d.getDate() - 1);
  } else if (period === 'weekly') {
    d.setDate(d.getDate() - 7);
  } else if (period === 'monthly') {
    // 이번달 1일에서 하루 빼면 지난달 말일
    d.setDate(1);
    d.setDate(0);
  }
  return d.toISOString().slice(0, 10);
}

export default function UsageReports() {
  const [period, setPeriod] = useState('daily');
  const [date, setDate] = useState(() => defaultDateFor('daily'));
  const [retryTick, setRetryTick] = useState(0);   // 동일 (period,date)로 강제 재요청
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  // period 변경 시 date도 기본값으로 리셋
  const handlePeriodChange = (p) => {
    setPeriod(p);
    setDate(defaultDateFor(p));
  };

  useEffect(() => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    getUsageReport({ period, date, signal: controller.signal })
      .then(res => {
        setData(res.data);
        setLoading(false);
      })
      .catch(err => {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
        setError(err?.response?.data?.detail || err?.message || '리포트를 불러올 수 없습니다.');
        setLoading(false);
      });

    return () => controller.abort();
  }, [period, date, retryTick]);

  const total = data?.summary?.total ?? 0;
  const isEmpty = data && total === 0;

  return (
    <div className="max-w-7xl mx-auto pb-10 animate-fade-in-up">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-4">
          <PeriodTabs value={period} onChange={handlePeriodChange} />
          {data?.period && (
            <PeriodNavigator
              period={period}
              date={date}
              label={data.period.label}
              onChange={setDate}
            />
          )}
        </div>
        <ExportXlsxButton period={period} date={date} disabled={loading || error || isEmpty} />
      </div>

      {/* 본문 */}
      {loading ? (
        <div className="flex justify-center py-20"><RefreshCw className="animate-spin text-blue-500" size={40}/></div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-rose-500 mb-3">{error}</p>
          <button onClick={() => setRetryTick(t => t + 1)} className="px-4 py-2 text-sm font-bold rounded-md bg-blue-600 text-white hover:bg-blue-700">
            다시 시도
          </button>
        </div>
      ) : isEmpty ? (
        <div className="text-center py-20 text-slate-400">
          {data.period.label} 기간에 해석 기록이 없습니다.
        </div>
      ) : data && (
        <div className="space-y-6">
          <ReportKpiGrid summary={data.summary} deltas={data.deltas} />
          <PeriodTimeChart timeBuckets={data.timeBuckets} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ReportProgramsTable programs={data.programs} />
            <ReportUsersTable users={data.users} />
          </div>
          <ReportDepartmentChart departments={data.departments} />
        </div>
      )}
    </div>
  );
}
```

**Note on `defaultDateFor` for monthly:** The current implementation `d.setDate(1); d.setDate(0);` first sets day to 1, then `setDate(0)` rolls back one day → last day of previous month. Verify behavior manually in a browser console before relying on it.

- [ ] **Step 2: Commit**

```powershell
git add HiTessWorkBench/frontend/src/pages/Administration/UsageReports.jsx
git commit -m "✨ feat(report): UsageReports.jsx 페이지 컨테이너 — 통합 + AbortController"
```

---

## Task 17: Wire up routing — `App.jsx` + `Sidebar.jsx`

**Files:**
- Modify: `HiTessWorkBench/frontend/src/App.jsx`
- Modify: `HiTessWorkBench/frontend/src/components/layout/Sidebar.jsx`

- [ ] **Step 1: Add `UsageReports` import + route in `App.jsx`**

In `App.jsx`, find the section with existing `Administration` imports (search for `import UserManagement` or similar). Add:

```javascript
import UsageReports from './pages/Administration/UsageReports';
```

Then in `renderPage()` switch, after `case 'Analysis Management': return <AnalysisManagement />;` (or in the same vicinity), add:

```javascript
      case 'Usage Reports': return <UsageReports />;
```

- [ ] **Step 2: Add menu entry to `Sidebar.jsx`**

In `HiTessWorkBench/frontend/src/components/layout/Sidebar.jsx`, find the ADMINISTRATION items array (around line 67-72). Add an import at the top for an icon (`BarChartHorizontal` is appropriate but not used yet, or reuse `BarChart3`):

```javascript
import { ..., FileBarChart2 } from 'lucide-react';
```

(Adjust the existing import list — keep all existing icons.)

Modify the items array to insert "Usage Reports" between "Analysis Management" and "System Management":

```javascript
      items.push({
        category: "ADMINISTRATION",
        items: [
          { icon: ShieldAlert,    label: "User Management" },
          { icon: BarChart3,      label: "Analysis Management" },
          { icon: FileBarChart2,  label: "Usage Reports" },
          { icon: Settings,       label: "System Management" },
          { icon: Webhook,        label: "API Apps" },
          { icon: BookMarked,     label: "Developer Runbooks" },
        ]
      });
```

If `FileBarChart2` is not available in this version of lucide-react, fall back to `BarChart3` or `LineChart`.

- [ ] **Step 3: Run dev server and verify menu shows**

```powershell
cd HiTessWorkBench
npm run dev
```

Log in as admin → confirm "Usage Reports" appears between Analysis Management and System Management → click it → page loads with Daily tab showing yesterday's data.

Ctrl+C to stop dev server.

- [ ] **Step 4: Commit**

```powershell
git add HiTessWorkBench/frontend/src/App.jsx HiTessWorkBench/frontend/src/components/layout/Sidebar.jsx
git commit -m "✨ feat(report): Administration ▸ Usage Reports 메뉴 + 라우팅 연결"
```

---

## Task 18: Manual verification + CLAUDE.md update + final commit

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run end-to-end manual verification**

Start both backend and frontend, log in as admin. Walk through the checklist from the spec (`docs/superpowers/specs/2026-05-21-admin-usage-reports-design.md` §7-2):

- [ ] Sidebar menu appears for admin only (verify non-admin user does NOT see it)
- [ ] Daily tab opens with yesterday's date by default
- [ ] Weekly / Monthly tab switches correctly load expected ranges (verify period label)
- [ ] ◀ moves to previous period, ▶ moves forward (disabled when next > today)
- [ ] Date picker accepts any past date, blocks future
- [ ] When no data exists for the selected period → "기록이 없습니다" empty state
- [ ] KPI cards display ▲▼ deltas (try Daily on a high-traffic day vs adjacent low-traffic day to see both directions)
- [ ] Time chart adapts: 24 hours for Daily, 7 weekdays for Weekly, 28-31 days for Monthly
- [ ] Programs / Users / Departments tables populate correctly
- [ ] Excel download produces a file; open it in Excel/LibreOffice → confirm all 6 sheets are present, Summary KPI values match the on-screen numbers
- [ ] Open browser DevTools → log in as a regular (non-admin) user → manually fetch `/api/analysis/report?period=daily` → confirm 403

- [ ] **Step 2: Run all backend tests one final time**

```powershell
cd HiTessWorkBenchBackEnd
WorkBenchEnv\Scripts\activate
pytest -v
```

Expected: all tests green.

- [ ] **Step 3: Update CLAUDE.md**

In `CLAUDE.md`, find the "Support / 관리자" section (around line 134-145, the admin-pages table). Add a new row after `Analysis Management`:

```markdown
| `'Usage Reports'` | `Administration/UsageReports.jsx` | 관리자: 일/주/월 사용량 정형 리포트, Excel 내보내기 |
```

- [ ] **Step 4: Final commit**

```powershell
git add CLAUDE.md
git commit -m "📝 docs: CLAUDE.md — Usage Reports 페이지 안내 추가"
```

- [ ] **Step 5: Bump version**

Per memory `[버전 범프 시 수정 파일 3개]`: update three files

- `HiTessWorkBench/package.json` → bump `version`
- `HiTessWorkBench/frontend/package.json` → bump `version`
- `HiTessWorkBenchBackEnd/app/routers/system.py` → bump `SERVER_VERSION`

Use minor bump (e.g., `1.1.9` → `1.2.0`) since this is a new feature.

```powershell
git add HiTessWorkBench/package.json HiTessWorkBench/frontend/package.json HiTessWorkBenchBackEnd/app/routers/system.py
git commit -m "🔖 release: v1.1.9 → v1.2.0"
```

---

## Final Verification Gate

After Task 18, the engineer must confirm:

1. ✅ All backend pytest tests pass
2. ✅ All manual UI checklist items pass
3. ✅ Excel download opens cleanly and Summary sheet matches on-screen KPIs
4. ✅ Non-admin user cannot access the page or API
5. ✅ No regressions in existing `Analysis Management` page

If any check fails, **do not** mark the feature complete — open the spec, find the relevant requirement, write a regression test, and fix.
