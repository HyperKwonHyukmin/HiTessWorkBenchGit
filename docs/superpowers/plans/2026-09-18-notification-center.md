# 알림 센터 + 해석 완료 통지 (Plan A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버가 사용자별 인앱 알림(`notifications`)을 남기는 단일 창구 `notify()` 를 만들고, 해석 작업이 Success/Failed 로 끝나는 순간 소유자에게 알림을 남긴다. WorkBench 헤더의 종 아이콘·미읽음 배지·인박스 패널·인앱/데스크톱 토스트로 30초 폴링해 보여 주고, 클릭하면 My Projects 상세 모달로 간다. 90일 지난 알림은 자정 정리한다.

**Architecture:** 백엔드 — `models.Notification`·`models.UserPreference`(§2.2 정의 그대로 선점 생성) + `schema_bootstrap.ensure_notification_columns` + `services/notification_service.py`(`notify`, `notify_job_terminal`, `get_notification_prefs`, `prune_notifications`) + `job_manager._write_through` 훅 + `cleanup_service.run_notification_cleanup` + `routers/notifications.py`(4 엔드포인트). 프론트 — `api/notifications.js` + 순수 유틸 `utils/notificationLink.js` + `hooks/useNotifications.js`(30초 폴링) + `utils/desktopNotification.js` + `components/platform/NotificationCenter.jsx`(헤더 종·패널) + `Layout.jsx` 배치 + `MyProjects.jsx` 이벤트 1개. Electron main 은 `app.setAppUserModelId` 1줄.

**Tech Stack:** Python 3.14 / FastAPI / SQLAlchemy(MySQL 운영, SQLite 테스트) / pytest — React 18 + Vite + Tailwind + lucide-react 0.284 + axios — Electron 36. 신규 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-18-notification-center-design.md` (마스터: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1·§2.1·§2.2)

**규칙(마스터 §1):** 커밋은 사용자가 직접 한다 — 각 Task 마지막 단계는 **"커밋 준비 완료 — 변경 파일 목록을 사용자에게 보고"** 다. `HiTessWorkBench/frontend/src/config.js` 는 절대 스테이징하지 않는다. `Darkmode.js/` 는 건드리지 않는다. 백엔드는 TDD(실패 테스트 → 최소 구현 → 통과). 프론트는 러너가 없으므로 수동 검증 절차를 따른다(순수 유틸만 `node --test`). 문서·주석·UI 문구는 한국어, 식별자는 영어.

**테스트 실행 위치:** 모든 pytest 명령은 `C:\Coding\WorkBench\HiTessWorkBenchBackEnd` 에서 `WorkBenchEnv/Scripts/python.exe -m pytest …` 로 실행한다. 프론트 `node --test` 는 `C:\Coding\WorkBench\HiTessWorkBench\frontend` 에서 실행한다.

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `HiTessWorkBenchBackEnd/app/models.py` | 수정 | `Notification`, `UserPreference` 모델 추가(파일 끝) |
| `HiTessWorkBenchBackEnd/app/schema_bootstrap.py` | 수정 | `ensure_notification_columns()` + `run_schema_bootstrap()` 호출 |
| `HiTessWorkBenchBackEnd/app/services/notification_service.py` | 생성 | `NOTIFICATION_KINDS`, `notify`, `notify_job_terminal`, `get_notification_prefs`, `serialize_notification`, `prune_notifications` |
| `HiTessWorkBenchBackEnd/app/services/job_manager.py` | 수정 | `_write_through` 종료 시점 알림 훅(`_notify_job_terminal`) |
| `HiTessWorkBenchBackEnd/app/services/cleanup_service.py` | 수정 | `run_notification_cleanup` + `run_all_cleanup` 키 |
| `HiTessWorkBenchBackEnd/app/routers/notifications.py` | 생성 | `GET /api/notifications`, `POST …/read-all`, `POST …/{id}/read`, `DELETE …/{id}` |
| `HiTessWorkBenchBackEnd/app/main.py` | 수정 | import + `include_router(notifications.router)` |
| `HiTessWorkBenchBackEnd/tests/test_notification_models.py` | 생성 | 테이블 생성·부트스트랩 멱등 |
| `HiTessWorkBenchBackEnd/tests/test_notification_service.py` | 생성 | 서비스 계약 |
| `HiTessWorkBenchBackEnd/tests/test_job_manager_notify.py` | 생성 | `_write_through` 훅 |
| `HiTessWorkBenchBackEnd/tests/test_notification_cleanup.py` | 생성 | 90일 정리 |
| `HiTessWorkBenchBackEnd/tests/test_notifications_router.py` | 생성 | API |
| `HiTessWorkBench/frontend/src/api/notifications.js` | 생성 | axios 함수 4개 |
| `HiTessWorkBench/frontend/src/hooks/pollingPolicy.js` | 수정 | `notificationsIntervalMs: 30000` |
| `HiTessWorkBench/frontend/src/utils/notificationLink.js` | 생성 | 순수 유틸(링크 해석·병합·kind 메타·시각) |
| `HiTessWorkBench/frontend/src/utils/notificationLink.test.js` | 생성 | `node:test` |
| `HiTessWorkBench/frontend/src/hooks/useNotifications.js` | 생성 | 30초 폴링·낙관적 읽음/삭제 |
| `HiTessWorkBench/frontend/src/utils/desktopNotification.js` | 생성 | 렌더러 `new Notification()` 래퍼 |
| `HiTessWorkBench/frontend/src/components/platform/NotificationCenter.jsx` | 생성 | 헤더 종 + 배지 + 인박스 패널 + 토스트 발화 + 링크 이동 |
| `HiTessWorkBench/frontend/src/components/layout/Layout.jsx` | 수정 | 헤더에 `<NotificationCenter />` 배치 |
| `HiTessWorkBench/frontend/src/pages/analysis/MyProjects.jsx` | 수정 | `workbench:open-project-detail` 이벤트 수신 |
| `HiTessWorkBench/electron/index.js` | 수정 | `app.setAppUserModelId('com.hitess.workbench')` |

---

### Task 1: 모델 2개 + 스키마 부트스트랩

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/models.py` (파일 끝, 현재 342행 `RegisteredModelArtifact.created_at` 뒤)
- Modify: `HiTessWorkBenchBackEnd/app/schema_bootstrap.py:116-121` 뒤, `:152-160`
- Create: `HiTessWorkBenchBackEnd/tests/test_notification_models.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_notification_models.py`:

```python
"""알림 센터 테이블 2종(notifications, user_preferences)의 생성·부트스트랩 회귀 테스트."""
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app import models
from app.schema_bootstrap import ensure_notification_columns, run_schema_bootstrap


def _sqlite_engine():
    return create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def test_create_all_makes_both_tables():
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    tables = set(inspect(engine).get_table_names())
    assert "notifications" in tables
    assert "user_preferences" in tables

    cols = {c["name"] for c in inspect(engine).get_columns("notifications")}
    assert cols == {
        "id", "employee_id", "kind", "title", "body", "link",
        "dedupe_key", "read_at", "created_at",
    }
    pref_cols = {c["name"] for c in inspect(engine).get_columns("user_preferences")}
    assert pref_cols == {"employee_id", "prefs", "updated_at"}


def test_notification_model_defaults(db_session):
    row = models.Notification(employee_id="EMP001", kind="job.completed", title="t")
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    assert row.body == ""
    assert row.read_at is None
    assert row.created_at is not None
    assert row.link is None


def test_bootstrap_adds_missing_notification_columns():
    """운영 DB 에 컬럼이 빠진 채 테이블만 있어도 bootstrap 이 채운다(멱등)."""
    engine = _sqlite_engine()
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE notifications ("
            " id INTEGER PRIMARY KEY, employee_id VARCHAR(50) NOT NULL,"
            " kind VARCHAR(50) NOT NULL, title VARCHAR(200) NOT NULL,"
            " created_at DATETIME)"
        ))

    ensure_notification_columns(engine=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("notifications")}
    assert {"body", "link", "dedupe_key", "read_at"} <= cols

    # 두 번 돌려도 예외 없이 같은 결과
    ensure_notification_columns(engine=engine)
    assert {c["name"] for c in inspect(engine).get_columns("notifications")} == cols


def test_run_schema_bootstrap_calls_notification_bootstrap(monkeypatch):
    called = []
    import app.schema_bootstrap as sb
    monkeypatch.setattr(sb, "ensure_notification_columns", lambda *, engine=None: called.append("n"))
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    run_schema_bootstrap(engine=engine)
    assert called == ["n"]
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_notification_models.py -q
```
기대: `ImportError: cannot import name 'ensure_notification_columns'` 로 수집 단계 실패(`1 error`).

- [ ] **Step 3: 모델 추가** — `app/models.py` 파일 끝(342행 `created_at = Column(DateTime(timezone=True), server_default=func.now())` 뒤)에 추가. 이 파일은 클래스 본문이 **2칸 들여쓰기**다.

```python


class Notification(Base):
  """사용자별 인앱 알림(알림 센터). 서버가 남기고 클라이언트가 30초 폴링으로 가져간다.

  - employee_id : 수신자 사번
  - kind        : notification_service.NOTIFICATION_KINDS 어휘(job.completed 등)
  - link        : {"menu": <NavigationContext 메뉴명>, "params": {...}} — 클릭 시 이동처
  - dedupe_key  : 같은 키의 미읽음 알림이 있으면 새로 만들지 않는다(만료 경고를 매일 돌려도 1건)
  - read_at     : NULL = 미읽음
  보관은 cleanup_service 가 90일(NOTIFICATION_RETENTION_DAYS) 로 정리한다.
  """

  __tablename__ = "notifications"
  id = Column(Integer, primary_key=True, index=True)
  employee_id = Column(String(50), nullable=False, index=True)
  kind = Column(String(50), nullable=False)
  title = Column(String(200), nullable=False)
  body = Column(String(1000), nullable=False, default="")
  link = Column(JSON, nullable=True)
  dedupe_key = Column(String(200), nullable=True, index=True)
  read_at = Column(DateTime, nullable=True)
  created_at = Column(DateTime, default=datetime.now, index=True)


class UserPreference(Base):
  """사용자 환경설정(즐겨찾기·최근 앱·알림 설정·시작 메뉴) — 소유는 Plan E.

  마스터 설계 §2.2 정의 그대로다. 알림 센터(Plan A)는 prefs["notifications"] 를
  {"muted_kinds": [...], "desktop_toast": bool} 로 읽기만 하고, 쓰기 엔드포인트
  (GET/PUT /api/preferences)는 Plan E 가 만든다. Plan E 는 이 클래스가 이미 있으면 건너뛴다.
  """

  __tablename__ = "user_preferences"
  employee_id = Column(String(50), primary_key=True)
  prefs = Column(JSON, nullable=False, default=dict)
  updated_at = Column(DateTime, nullable=True)
```

- [ ] **Step 4: 부트스트랩 함수 추가** — `app/schema_bootstrap.py` 의 `ensure_chat_message_columns`(116~121행) 바로 아래에:

```python


def ensure_notification_columns(*, engine=None) -> None:
    """알림 센터 notifications 테이블의 컬럼을 멱등하게 보강합니다.

    테이블 자체는 create_all 로 생기지만, 이후 컬럼이 늘어날 때 운영 DB 에서 500 이
    나지 않도록 전 컬럼을 여기에 둔다(마스터 규약 §1.3).
    """
    _add_missing_columns("notifications", {
        "body": "ALTER TABLE notifications ADD COLUMN body VARCHAR(1000) NOT NULL DEFAULT ''",
        "link": "ALTER TABLE notifications ADD COLUMN link JSON NULL",
        "dedupe_key": "ALTER TABLE notifications ADD COLUMN dedupe_key VARCHAR(200) NULL",
        "read_at": "ALTER TABLE notifications ADD COLUMN read_at DATETIME NULL",
    }, engine=engine)
    _add_missing_indexes("notifications", {
        "ix_notifications_employee_id": (
            "CREATE INDEX ix_notifications_employee_id ON notifications (employee_id)"
        ),
        "ix_notifications_dedupe_key": (
            "CREATE INDEX ix_notifications_dedupe_key ON notifications (dedupe_key)"
        ),
        "ix_notifications_created_at": (
            "CREATE INDEX ix_notifications_created_at ON notifications (created_at)"
        ),
    }, engine=engine)
```

그리고 `run_schema_bootstrap()`(현재 152~160행)의 `ensure_chat_message_columns(engine=engine)` 다음 줄에 호출을 추가:

```python
    ensure_chat_message_columns(engine=engine)
    ensure_notification_columns(engine=engine)
    ensure_app_spaces(engine=engine)
```

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_notification_models.py -q
```
기대: `4 passed`.

전체 회귀(모델 변경이라 한 번 돈다):
```
WorkBenchEnv/Scripts/python.exe -m pytest tests -q -x
```
기대: 기존 전부 통과(실패 0).

- [ ] **Step 6: 커밋 준비 완료** — 변경 파일 목록을 사용자에게 보고: `app/models.py`, `app/schema_bootstrap.py`, `tests/test_notification_models.py`.

---

### Task 2: `notification_service` — `notify()` 계약

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/notification_service.py`
- Create: `HiTessWorkBenchBackEnd/tests/test_notification_service.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_notification_service.py`:

```python
"""알림 서비스 계약(마스터 §2.1) 테스트 — notify / notify_job_terminal / prefs / prune."""
from datetime import datetime, timedelta

import pytest

from app import models
from app.services.notification_service import (
    NOTIFICATION_KINDS,
    NOTIFICATION_RETENTION_DAYS,
    get_notification_prefs,
    notify,
    notify_job_terminal,
    prune_notifications,
    serialize_notification,
)
from app.services.program_registry import internal_substep_programs


def test_kind_vocabulary_matches_master_spec():
    assert NOTIFICATION_KINDS == frozenset({
        "job.completed", "job.failed", "job.cancelled",
        "retention.expiring", "retention.expired",
        "batch.completed", "share.received",
        "feature_request.status_changed", "notice.published",
    })
    assert NOTIFICATION_RETENTION_DAYS == 90


def test_notify_rejects_unknown_kind(db_session):
    with pytest.raises(ValueError):
        notify(db_session, employee_id="EMP001", kind="job.done", title="x")


def test_notify_creates_unread_row_with_link(db_session):
    row = notify(
        db_session, employee_id="EMP001", kind="job.completed",
        title="Truss Assessment 해석 완료", body="3496 유닛",
        link={"menu": "My Projects", "params": {"analysis_id": 7}},
        dedupe_key="job:abc:job.completed",
    )
    assert row.id is not None
    assert row.read_at is None
    assert row.link == {"menu": "My Projects", "params": {"analysis_id": 7}}
    assert row.dedupe_key == "job:abc:job.completed"
    assert db_session.query(models.Notification).count() == 1


def test_notify_skips_blank_employee(db_session):
    assert notify(db_session, employee_id="  ", kind="job.completed", title="x") is None
    assert db_session.query(models.Notification).count() == 0


def test_notify_truncates_title_and_body(db_session):
    row = notify(db_session, employee_id="EMP001", kind="job.failed",
                 title="t" * 300, body="b" * 2000)
    assert len(row.title) == 200
    assert len(row.body) == 1000


def test_notify_respects_muted_kinds_from_user_preferences(db_session):
    db_session.add(models.UserPreference(
        employee_id="EMP001",
        prefs={"notifications": {"muted_kinds": ["job.completed"], "desktop_toast": False}},
    ))
    db_session.commit()
    assert notify(db_session, employee_id="EMP001", kind="job.completed", title="x") is None
    assert notify(db_session, employee_id="EMP001", kind="job.failed", title="x") is not None


def test_get_notification_prefs_defaults_and_shape(db_session):
    assert get_notification_prefs(db_session, "NOBODY") == {"muted_kinds": [], "desktop_toast": True}
    db_session.add(models.UserPreference(employee_id="EMP002", prefs={"notifications": "garbage"}))
    db_session.commit()
    assert get_notification_prefs(db_session, "EMP002") == {"muted_kinds": [], "desktop_toast": True}


def test_dedupe_key_blocks_only_while_unread(db_session):
    first = notify(db_session, employee_id="EMP001", kind="retention.expiring",
                   title="만료 예정", dedupe_key="retention:5")
    assert first is not None
    assert notify(db_session, employee_id="EMP001", kind="retention.expiring",
                  title="만료 예정", dedupe_key="retention:5") is None
    first.read_at = datetime.now()
    db_session.commit()
    again = notify(db_session, employee_id="EMP001", kind="retention.expiring",
                   title="만료 예정", dedupe_key="retention:5")
    assert again is not None and again.id != first.id


def test_dedupe_key_is_per_employee(db_session):
    notify(db_session, employee_id="EMP001", kind="share.received", title="x", dedupe_key="k")
    assert notify(db_session, employee_id="EMP002", kind="share.received", title="x", dedupe_key="k") is not None


def test_dedupe_any_state_blocks_even_after_read(db_session):
    first = notify(db_session, employee_id="EMP001", kind="job.completed", title="x",
                   dedupe_key="job:1:job.completed", dedupe_unread_only=False)
    first.read_at = datetime.now()
    db_session.commit()
    assert notify(db_session, employee_id="EMP001", kind="job.completed", title="x",
                  dedupe_key="job:1:job.completed", dedupe_unread_only=False) is None


def _analysis(make_analysis, program_name, **overrides):
    a = make_analysis("EMP001", program_name, datetime(2026, 9, 18, 9, 0, 0), status="Running")
    a.job_id = overrides.get("job_id", "job-1")
    a.project_name = overrides.get("project_name", "3496 유닛 권상")
    a.job_message = overrides.get("job_message")
    return a


def test_notify_job_terminal_success(db_session, make_analysis):
    a = _analysis(make_analysis, "Truss Assessment")
    db_session.commit()
    row = notify_job_terminal(db_session, a, "Success")
    assert row.kind == "job.completed"
    assert row.title == "Truss Assessment 해석 완료"
    assert row.body == "3496 유닛 권상"
    assert row.link == {
        "menu": "My Projects",
        "params": {"analysis_id": a.id, "program_name": "Truss Assessment", "job_id": "job-1"},
    }
    assert row.dedupe_key == "job:job-1:job.completed"
    # 같은 작업의 Success 가 두 번 반영돼도 알림은 1건
    assert notify_job_terminal(db_session, a, "Success") is None


def test_notify_job_terminal_failed_prefers_job_message(db_session, make_analysis):
    a = _analysis(make_analysis, "BdfScanner", job_id="job-2", job_message="Nastran FATAL 2101")
    db_session.commit()
    row = notify_job_terminal(db_session, a, "Failed")
    assert row.kind == "job.failed"
    assert row.title == "BDF Scanner 해석 실패"      # registry display_name
    assert row.body == "Nastran FATAL 2101"


def test_notify_job_terminal_unknown_program_uses_raw_name(db_session, make_analysis):
    a = _analysis(make_analysis, "SomethingNew", job_id="job-3")
    db_session.commit()
    row = notify_job_terminal(db_session, a, "Success")
    assert row.title == "SomethingNew 해석 완료"


def test_notify_job_terminal_skips_internal_substep_and_non_terminal(db_session, make_analysis):
    internal = internal_substep_programs()[0]
    a = _analysis(make_analysis, internal, job_id="job-4")
    db_session.commit()
    assert notify_job_terminal(db_session, a, "Success") is None

    b = _analysis(make_analysis, "Truss Assessment", job_id="job-5")
    db_session.commit()
    assert notify_job_terminal(db_session, b, "Running") is None
    assert db_session.query(models.Notification).count() == 0


def test_notify_job_terminal_without_owner(db_session, make_analysis):
    a = _analysis(make_analysis, "Truss Assessment", job_id="job-6")
    a.employee_id = None
    db_session.commit()
    assert notify_job_terminal(db_session, a, "Success") is None


def test_serialize_notification(db_session):
    row = notify(db_session, employee_id="EMP001", kind="job.completed", title="t", body="b",
                 link={"menu": "My Projects", "params": {}})
    data = serialize_notification(row)
    assert data["id"] == row.id
    assert data["kind"] == "job.completed"
    assert data["is_read"] is False
    assert data["read_at"] is None
    assert data["created_at"] == row.created_at.isoformat()
    assert data["link"] == {"menu": "My Projects", "params": {}}


def test_prune_notifications_deletes_only_old_rows(db_session):
    old = notify(db_session, employee_id="EMP001", kind="job.completed", title="old")
    old.created_at = datetime.now() - timedelta(days=NOTIFICATION_RETENTION_DAYS + 1)
    notify(db_session, employee_id="EMP001", kind="job.completed", title="new")
    db_session.commit()
    assert prune_notifications(db_session) == 1
    remaining = db_session.query(models.Notification).all()
    assert [r.title for r in remaining] == ["new"]
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_notification_service.py -q
```
기대: `ModuleNotFoundError: No module named 'app.services.notification_service'` (`1 error`).

- [ ] **Step 3: 서비스 구현** — `HiTessWorkBenchBackEnd/app/services/notification_service.py`:

```python
"""알림 센터 — 서버가 사용자에게 남기는 인앱 알림의 단일 생성 창구(마스터 설계 §2.1).

다른 plan(보관 만료·취소·공유·배치·기능요청) 은 아래 규약으로 지연 import 해서 호출한다:

    try:
        from app.services.notification_service import notify
    except ImportError:
        notify = None

그래야 이 모듈 없이도 각 plan 이 단독으로 동작한다. 이 모듈은 다른 plan 의 영역을
구현하지 않는다 — user_preferences 는 읽기만(쓰기는 Plan E).
"""
import logging
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from .. import models
from .program_registry import resolve_program

logger = logging.getLogger(__name__)

# kind 어휘는 고정이다(마스터 §2.1). 새 kind 는 마스터 문서를 먼저 고친다.
NOTIFICATION_KINDS = frozenset({
    "job.completed",
    "job.failed",
    "job.cancelled",
    "retention.expiring",
    "retention.expired",
    "batch.completed",
    "share.received",
    "feature_request.status_changed",
    "notice.published",
})

NOTIFICATION_RETENTION_DAYS = 90
TITLE_MAX_LEN = 200
BODY_MAX_LEN = 1000
DEFAULT_NOTIFICATION_PREFS = {"muted_kinds": [], "desktop_toast": True}

# _write_through 가 알림을 남기는 종료 상태. Interrupted(서버 재시작)는 raw UPDATE 라 여기 안 온다.
_TERMINAL_KIND_BY_STATUS = {"Success": "job.completed", "Failed": "job.failed"}


def get_notification_prefs(db: Session, employee_id: str) -> dict:
    """user_preferences.prefs["notifications"] 를 읽어 {"muted_kinds", "desktop_toast"} 로 정규화한다.

    행이 없거나 형식이 틀리면 기본값. Plan E 이전에도 안전하게 동작해야 하므로 어떤 값도 믿지 않는다.
    """
    prefs = {"muted_kinds": list(DEFAULT_NOTIFICATION_PREFS["muted_kinds"]),
             "desktop_toast": DEFAULT_NOTIFICATION_PREFS["desktop_toast"]}
    row = (
        db.query(models.UserPreference)
        .filter(models.UserPreference.employee_id == employee_id)
        .first()
    )
    raw = (row.prefs or {}).get("notifications") if row and isinstance(row.prefs, dict) else None
    if not isinstance(raw, dict):
        return prefs
    muted = raw.get("muted_kinds")
    if isinstance(muted, list):
        prefs["muted_kinds"] = [str(k) for k in muted if isinstance(k, str)]
    if isinstance(raw.get("desktop_toast"), bool):
        prefs["desktop_toast"] = raw["desktop_toast"]
    return prefs


def notify(
    db: Session,
    *,
    employee_id: str,
    kind: str,
    title: str,
    body: str = "",
    link: dict | None = None,
    dedupe_key: str | None = None,
    dedupe_unread_only: bool = True,
) -> models.Notification | None:
    """알림 1건을 만들고 commit 한다. 만들지 않은 경우(None) 는 정상 흐름이다.

    - kind 가 어휘 밖이면 ValueError(호출자 버그를 조용히 삼키지 않는다).
    - employee_id 가 비면 None. muted_kinds 에 든 kind 면 None.
    - dedupe_key 가 같은 (employee_id, dedupe_key) 의 미읽음 알림이 있으면 None.
      dedupe_unread_only=False 면 읽음 여부와 무관하게 1건이면 None(작업 종료 알림용).
    """
    if kind not in NOTIFICATION_KINDS:
        raise ValueError(f"unknown notification kind: {kind!r}")
    employee_id = (employee_id or "").strip()
    if not employee_id:
        return None
    if kind in get_notification_prefs(db, employee_id)["muted_kinds"]:
        return None

    if dedupe_key:
        query = db.query(models.Notification).filter(
            models.Notification.employee_id == employee_id,
            models.Notification.dedupe_key == dedupe_key,
        )
        if dedupe_unread_only:
            query = query.filter(models.Notification.read_at.is_(None))
        if query.first() is not None:
            return None

    row = models.Notification(
        employee_id=employee_id,
        kind=kind,
        title=(title or "").strip()[:TITLE_MAX_LEN],
        body=(body or "").strip()[:BODY_MAX_LEN],
        link=link if isinstance(link, dict) else None,
        dedupe_key=(dedupe_key or None),
        created_at=datetime.now(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def notify_job_terminal(
    db: Session,
    record: models.Analysis,
    status: str,
) -> models.Notification | None:
    """해석 작업이 Success/Failed 로 끝났을 때 소유자에게 알림을 남긴다.

    job_manager.JobStatusStore._write_through 가 DB 반영 직후 호출한다. 이력에 보이지 않는
    내부 단계 프로그램(history_visible=False)은 알리지 않는다 — 사용자가 이력에서도 못 보는
    항목이라 소음이 된다.
    """
    kind = _TERMINAL_KIND_BY_STATUS.get(status)
    if kind is None or not (record.employee_id or "").strip():
        return None
    spec = resolve_program(record.program_name)
    if spec is not None and not spec.history_visible:
        return None

    display_name = spec.display_name if spec else (record.program_name or "해석")
    verb = "완료" if kind == "job.completed" else "실패"
    project_name = (record.project_name or "").strip()
    job_message = (record.job_message or "").strip()
    # 성공은 '무엇이 끝났나'(프로젝트), 실패는 '왜'(엔진 메시지)가 먼저다.
    body = (project_name or job_message) if kind == "job.completed" else (job_message or project_name)
    link = {
        "menu": "My Projects",
        "params": {
            "analysis_id": record.id,
            "program_name": record.program_name,
            "job_id": record.job_id,
        },
    }
    return notify(
        db,
        employee_id=record.employee_id,
        kind=kind,
        title=f"{display_name} 해석 {verb}",
        body=body,
        link=link,
        dedupe_key=f"job:{record.job_id or record.id}:{kind}",
        dedupe_unread_only=False,
    )


def serialize_notification(row: models.Notification) -> dict:
    return {
        "id": row.id,
        "kind": row.kind,
        "title": row.title,
        "body": row.body or "",
        "link": row.link,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "read_at": row.read_at.isoformat() if row.read_at else None,
        "is_read": row.read_at is not None,
    }


def prune_notifications(db: Session, retention_days: int = NOTIFICATION_RETENTION_DAYS) -> int:
    """보존 기간을 넘긴 알림을 읽음 여부와 무관하게 삭제하고 건수를 돌려준다."""
    cutoff = datetime.now() - timedelta(days=retention_days)
    deleted = (
        db.query(models.Notification)
        .filter(models.Notification.created_at < cutoff)
        .delete(synchronize_session=False)
    )
    db.commit()
    return int(deleted)
```

- [ ] **Step 4: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_notification_service.py -q
```
기대: `17 passed`.

- [ ] **Step 5: 커밋 준비 완료** — 보고: `app/services/notification_service.py`, `tests/test_notification_service.py`.

---

### Task 3: `job_manager._write_through` 종료 훅

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/job_manager.py:6-16`(import/logger), `:110-138`(`_write_through`)
- Create: `HiTessWorkBenchBackEnd/tests/test_job_manager_notify.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_job_manager_notify.py`:

```python
"""JobStatusStore._write_through 가 Success/Failed 반영 직후 알림을 남기는지 검증한다.

database.SessionLocal 을 conftest 의 인메모리 SQLite 세션으로 바꿔 write-through 가 그 세션에
쓰게 한다(test_doublepipe_psa_persistence.py 와 같은 패턴). _write_through 는 finally 에서
db.close() 를 부르지만 SQLAlchemy Session 은 close 뒤 재사용이 가능하다.
"""
from datetime import datetime

from app import database, models
from app.services import job_manager, notification_service


def _running_analysis(make_analysis, job_id, program="Truss Assessment"):
    a = make_analysis("EMP001", program, datetime(2026, 9, 18, 9, 0, 0), status="Running")
    a.job_id = job_id
    a.project_name = "3496 유닛 권상"
    return a


def test_success_write_through_creates_completed_notification(db_session, make_analysis, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    a = _running_analysis(make_analysis, "job-wt-1")
    db_session.commit()

    job_manager.job_status_store.update_job("job-wt-1", {"status": "Success", "progress": 100, "message": "완료"})

    db_session.expire_all()
    rows = db_session.query(models.Notification).all()
    assert len(rows) == 1
    assert rows[0].employee_id == "EMP001"
    assert rows[0].kind == "job.completed"
    assert rows[0].link["params"]["analysis_id"] == a.id
    saved = db_session.get(models.Analysis, a.id)
    assert saved.job_status == "Success" and saved.status == "Success"


def test_failed_write_through_creates_failed_notification_with_message(db_session, make_analysis, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    _running_analysis(make_analysis, "job-wt-2")
    db_session.commit()

    job_manager.job_status_store.update_job("job-wt-2", {"status": "Failed", "progress": 100, "message": "Nastran FATAL"})

    db_session.expire_all()
    row = db_session.query(models.Notification).one()
    assert row.kind == "job.failed"
    assert row.body == "Nastran FATAL"


def test_running_and_progress_updates_do_not_notify(db_session, make_analysis, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    _running_analysis(make_analysis, "job-wt-3")
    db_session.commit()

    job_manager.job_status_store.update_job("job-wt-3", {"status": "Running", "progress": 10})
    job_manager.job_status_store.update_job("job-wt-3", {"progress": 50, "message": "solving"})

    db_session.expire_all()
    assert db_session.query(models.Notification).count() == 0


def test_notification_failure_does_not_undo_status_write(db_session, make_analysis, monkeypatch, caplog):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    a = _running_analysis(make_analysis, "job-wt-4")
    db_session.commit()

    def _boom(*_args, **_kwargs):
        raise RuntimeError("notifications table is gone")
    monkeypatch.setattr(notification_service, "notify_job_terminal", _boom)

    job_manager.job_status_store.update_job("job-wt-4", {"status": "Success", "progress": 100})

    db_session.expire_all()
    assert db_session.get(models.Analysis, a.id).job_status == "Success"
    assert db_session.query(models.Notification).count() == 0
    assert any("종료 알림 생성 실패" in r.getMessage() for r in caplog.records)


def test_write_through_without_record_is_silent(db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    job_manager.job_status_store.update_job("job-no-record", {"status": "Success", "progress": 100})
    assert db_session.query(models.Notification).count() == 0
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_manager_notify.py -q
```
기대: `3 failed, 2 passed` — `test_success_…`, `test_failed_…`(알림 0건), `test_notification_failure_…`(caplog 문구 없음) 실패.

- [ ] **Step 3: 훅 구현** — `app/services/job_manager.py`

(a) 6~11행 import 블록을 아래로 교체(`logging` 추가 + logger):

```python
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta

from .. import database, models

logger = logging.getLogger(__name__)
```

(b) `_write_through`(110~138행) 안에서 `db.commit()` 다음 줄에 알림 호출을 추가. 수정 후 함수 전체:

```python
    def _write_through(self, job_id: str, updates: dict) -> None:
        """Analysis 레코드가 존재하면 메모리 상태를 DB에도 반영합니다.

        Success/Failed 반영이 끝나면 소유자에게 알림(알림 센터)을 남긴다 — 모든 해석
        서비스가 update_job() 으로 종료를 알리므로 발신 지점은 여기 한 곳이면 된다.
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
                if status in ("Success", "Failed"):
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
```

(c) `JobStatusStore` 클래스 **앞**(현재 `PERSISTED_STATUS_FIELDS` 정의 아래, `@dataclass` 위)에 모듈 함수 추가:

```python


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
```

- [ ] **Step 4: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_job_manager_notify.py tests/test_job_submission_lifecycle.py tests/test_queue_visibility.py tests/test_system_jobs.py -q
```
기대: 전부 통과(`test_job_manager_notify.py` 5건 포함).

- [ ] **Step 5: 커밋 준비 완료** — 보고: `app/services/job_manager.py`, `tests/test_job_manager_notify.py`.

---

### Task 4: 90일 정리 훅 (`cleanup_service`)

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/cleanup_service.py:15-17`(import), `:269`(함수 추가), `:272-278`(`run_all_cleanup`)
- Create: `HiTessWorkBenchBackEnd/tests/test_notification_cleanup.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_notification_cleanup.py`:

```python
"""알림 90일 정리 — cleanup_service.run_notification_cleanup / run_all_cleanup 키."""
from datetime import datetime, timedelta

from app import database, models
from app.services import cleanup_service
from app.services.notification_service import NOTIFICATION_RETENTION_DAYS, notify


def _seed(db):
    old = notify(db, employee_id="EMP001", kind="job.completed", title="old")
    old.created_at = datetime.now() - timedelta(days=NOTIFICATION_RETENTION_DAYS + 3)
    notify(db, employee_id="EMP001", kind="job.completed", title="fresh")
    db.commit()


def test_dry_run_counts_without_deleting(db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    _seed(db_session)
    result = cleanup_service.run_notification_cleanup(dry_run=True)
    assert result == {"deleted": 1, "errors": []}
    assert db_session.query(models.Notification).count() == 2


def test_real_run_deletes_old_rows(db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    _seed(db_session)
    result = cleanup_service.run_notification_cleanup()
    assert result == {"deleted": 1, "errors": []}
    db_session.expire_all()
    assert [r.title for r in db_session.query(models.Notification).all()] == ["fresh"]


def test_errors_are_reported_by_type_only(db_session, monkeypatch):
    def _broken():
        raise RuntimeError("secret://dsn")
    monkeypatch.setattr(database, "SessionLocal", _broken)
    result = cleanup_service.run_notification_cleanup()
    assert result["deleted"] == 0
    assert result["errors"] == ["RuntimeError"]


def test_run_all_cleanup_includes_notifications(db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    result = cleanup_service.run_all_cleanup(dry_run=True)
    assert set(result) == {"user_connection", "activity_logs", "sessions", "notifications"}
    assert result["notifications"] == {"deleted": 0, "errors": []}
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_notification_cleanup.py -q
```
기대: `4 failed`(`AttributeError: … has no attribute 'run_notification_cleanup'` 3건 + `run_all_cleanup` 키 집합 불일치 1건).

- [ ] **Step 3: 구현** — `app/services/cleanup_service.py`

(a) 17행 `from .activity_service import ACTIVITY_LOG_RETENTION_DAYS, prune_activity_logs` 아래에:

```python
from .notification_service import NOTIFICATION_RETENTION_DAYS, prune_notifications
```

(b) `run_session_cleanup`(230~269행) 바로 아래, `run_all_cleanup` 위에 추가:

```python


def run_notification_cleanup(dry_run: bool = False) -> dict:
    """
    notifications 테이블에서 90일(NOTIFICATION_RETENTION_DAYS) 초과 알림을 읽음 여부와 무관하게 삭제합니다.

    Parameters
    ----------
    dry_run : bool
        True이면 삭제하지 않고 대상 건수만 반환합니다.
    """
    result = {"deleted": 0, "errors": []}
    db = None
    try:
        db = database.SessionLocal()
        if dry_run:
            cutoff = datetime.now() - timedelta(days=NOTIFICATION_RETENTION_DAYS)
            result["deleted"] = (
                db.query(models.Notification)
                .filter(models.Notification.created_at < cutoff)
                .count()
            )
        else:
            result["deleted"] = prune_notifications(db)
        logger.info("[Cleanup] 알림 정리 완료 — 삭제: %d건", result["deleted"])
    except Exception as exc:
        if db is not None:
            try:
                db.rollback()
            except Exception:
                pass
        # DB driver 오류 원문에는 접속 정보가 포함될 수 있어 type만 기록한다.
        error_type = type(exc).__name__
        result["errors"].append(error_type)
        logger.error("[Cleanup] 알림 정리 실패 (%s)", error_type)
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                logger.warning("[Cleanup] 알림 DB session close failed")
    return result
```

(c) `run_all_cleanup` 을 아래로 교체:

```python
def run_all_cleanup(dry_run: bool = False) -> dict:
    """파일 작업 폴더, Activity Log, 만료 세션, 알림 보존 정책을 함께 적용합니다."""
    return {
        "user_connection": run_cleanup(dry_run=dry_run),
        "activity_logs": run_activity_log_cleanup(dry_run=dry_run),
        "sessions": run_session_cleanup(dry_run=dry_run),
        "notifications": run_notification_cleanup(dry_run=dry_run),
    }
```

- [ ] **Step 4: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_notification_cleanup.py tests/test_runtime_services_lifecycle.py -q
```
기대: 전부 통과(신규 4건 포함). `run_all_cleanup` 을 stub 하는 기존 테스트가 있으면 키 4개 dict 를 돌려주도록만 맞춘다(있는지 `grep -n "run_all_cleanup" tests/*.py` 로 확인).

- [ ] **Step 5: 커밋 준비 완료** — 보고: `app/services/cleanup_service.py`, `tests/test_notification_cleanup.py`.

---

### Task 5: 라우터 `/api/notifications` + `main.py` 등록

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/routers/notifications.py`
- Modify: `HiTessWorkBenchBackEnd/app/main.py:20-45`(import), `:212`(include)
- Create: `HiTessWorkBenchBackEnd/tests/test_notifications_router.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_notifications_router.py`:

```python
"""알림 센터 API — 목록(델타)/읽음/모두 읽음/삭제/권한.

conftest 의 admin_client 는 require_auth 를 ADMIN001 로 고정한다. 다른 사용자 시점은
test_chat_router.py 와 같은 _act_as() 로 require_auth override 만 교체한다.
"""
from app import models
from app.dependencies import require_auth
from app.main import app
from app.services.notification_service import notify


def _act_as(employee_id: str):
    app.dependency_overrides[require_auth] = lambda: employee_id


def _seed(db, employee_id, n, kind="job.completed"):
    return [notify(db, employee_id=employee_id, kind=kind, title=f"{employee_id}-{i}") for i in range(n)]


def test_list_returns_only_mine_newest_first_with_unread_count(admin_client, db_session):
    mine = _seed(db_session, "ADMIN001", 3)
    _seed(db_session, "EMP001", 2)

    data = admin_client.get("/api/notifications").json()
    assert [n["id"] for n in data["items"]] == [mine[2].id, mine[1].id, mine[0].id]
    assert data["unread_count"] == 3
    assert data["latest_id"] == mine[2].id
    assert data["prefs"] == {"muted_kinds": [], "desktop_toast": True}
    item = data["items"][0]
    assert set(item) == {"id", "kind", "title", "body", "link", "created_at", "read_at", "is_read"}


def test_list_since_returns_delta_but_counts_are_global(admin_client, db_session):
    first = _seed(db_session, "ADMIN001", 2)
    later = _seed(db_session, "ADMIN001", 2)

    data = admin_client.get(f"/api/notifications?since={first[1].id}").json()
    assert [n["id"] for n in data["items"]] == [later[1].id, later[0].id]
    assert data["unread_count"] == 4
    assert data["latest_id"] == later[1].id


def test_list_limit_and_unread_only(admin_client, db_session):
    rows = _seed(db_session, "ADMIN001", 5)
    admin_client.post(f"/api/notifications/{rows[4].id}/read")

    data = admin_client.get("/api/notifications?limit=2").json()
    assert len(data["items"]) == 2

    data = admin_client.get("/api/notifications?unread_only=true").json()
    assert rows[4].id not in {n["id"] for n in data["items"]}
    assert len(data["items"]) == 4

    assert admin_client.get("/api/notifications?limit=0").status_code == 422
    assert admin_client.get("/api/notifications?limit=101").status_code == 422


def test_list_reflects_user_preferences(admin_client, db_session):
    db_session.add(models.UserPreference(
        employee_id="ADMIN001",
        prefs={"notifications": {"muted_kinds": ["job.failed"], "desktop_toast": False}},
    ))
    db_session.commit()
    data = admin_client.get("/api/notifications").json()
    assert data["prefs"] == {"muted_kinds": ["job.failed"], "desktop_toast": False}


def test_mark_read_and_read_all(admin_client, db_session):
    rows = _seed(db_session, "ADMIN001", 3)

    r = admin_client.post(f"/api/notifications/{rows[0].id}/read")
    assert r.status_code == 200 and r.json() == {"ok": True, "id": rows[0].id}
    db_session.expire_all()
    assert db_session.get(models.Notification, rows[0].id).read_at is not None
    assert admin_client.get("/api/notifications").json()["unread_count"] == 2

    # 멱등
    assert admin_client.post(f"/api/notifications/{rows[0].id}/read").status_code == 200

    r = admin_client.post("/api/notifications/read-all")
    assert r.json() == {"updated": 2}
    assert admin_client.get("/api/notifications").json()["unread_count"] == 0
    assert admin_client.post("/api/notifications/read-all").json() == {"updated": 0}


def test_delete_own_notification(admin_client, db_session):
    rows = _seed(db_session, "ADMIN001", 2)
    r = admin_client.delete(f"/api/notifications/{rows[0].id}")
    assert r.status_code == 200 and r.json() == {"ok": True}
    db_session.expire_all()
    assert db_session.get(models.Notification, rows[0].id) is None
    assert admin_client.delete(f"/api/notifications/{rows[0].id}").status_code == 404


def test_other_users_notification_is_404_for_read_and_delete(admin_client, db_session):
    theirs = _seed(db_session, "EMP001", 1)[0]
    assert admin_client.post(f"/api/notifications/{theirs.id}/read").status_code == 404
    assert admin_client.delete(f"/api/notifications/{theirs.id}").status_code == 404

    _act_as("EMP001")
    assert admin_client.post(f"/api/notifications/{theirs.id}/read").status_code == 200
    db_session.expire_all()
    assert db_session.get(models.Notification, theirs.id).read_at is not None


def test_read_all_only_touches_mine(admin_client, db_session):
    _seed(db_session, "ADMIN001", 1)
    theirs = _seed(db_session, "EMP001", 1)[0]
    assert admin_client.post("/api/notifications/read-all").json() == {"updated": 1}
    db_session.expire_all()
    assert db_session.get(models.Notification, theirs.id).read_at is None


def test_requires_auth(admin_client):
    saved = app.dependency_overrides.pop(require_auth)
    try:
        assert admin_client.get("/api/notifications").status_code == 401
        assert admin_client.post("/api/notifications/read-all").status_code == 401
    finally:
        app.dependency_overrides[require_auth] = saved
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_notifications_router.py -q
```
기대: `9 failed`(전부 404 — 라우터 미등록).

- [ ] **Step 3: 라우터 구현** — `HiTessWorkBenchBackEnd/app/routers/notifications.py`:

```python
"""알림 센터 API — 사용자별 인앱 알림 목록/읽음/삭제.

polling 기반(WebSocket 없음, presence/chat 과 같은 철학): 클라이언트가 30초마다
GET /api/notifications?since=<마지막 id> 로 델타를 받고, 헤더 종 아이콘의 미읽음 배지를 갱신한다.
알림 '생성' 은 services/notification_service.notify() 한 곳이며 이 라우터는 만들지 않는다.

플랫폼 공통 기능이라 app_settings.GUARDED_ROUTES 에 등록하지 않는다.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import database, models
from ..dependencies import require_auth
from ..services.notification_service import get_notification_prefs, serialize_notification

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

DEFAULT_LIMIT = 50
MAX_LIMIT = 100


def _mine(db: Session, me: str, notification_id: int) -> models.Notification:
    """내 알림 1건. 남의 것은 존재 자체를 노출하지 않도록 404 로 통일한다."""
    row = (
        db.query(models.Notification)
        .filter(
            models.Notification.id == notification_id,
            models.Notification.employee_id == me,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="알림을 찾을 수 없습니다.")
    return row


@router.get("")
def list_notifications(
    since: int | None = Query(default=None, ge=0),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    unread_only: bool = False,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """내 알림 목록(id 내림차순). since 가 있으면 그 id 이후(델타)만 돌려준다.

    unread_count / latest_id 는 since·limit 과 무관하게 항상 전체 기준이다 — 배지는 델타가 아니라
    현재 상태를 보여 줘야 한다. prefs 는 user_preferences 의 알림 설정(Plan E 이전에는 기본값).
    """
    query = db.query(models.Notification).filter(models.Notification.employee_id == me)
    if since is not None:
        query = query.filter(models.Notification.id > since)
    if unread_only:
        query = query.filter(models.Notification.read_at.is_(None))
    items = query.order_by(models.Notification.id.desc()).limit(limit).all()

    unread_count = (
        db.query(func.count(models.Notification.id))
        .filter(models.Notification.employee_id == me, models.Notification.read_at.is_(None))
        .scalar()
    ) or 0
    latest_id = (
        db.query(func.max(models.Notification.id))
        .filter(models.Notification.employee_id == me)
        .scalar()
    ) or 0

    return {
        "items": [serialize_notification(n) for n in items],
        "unread_count": int(unread_count),
        "latest_id": int(latest_id),
        "prefs": get_notification_prefs(db, me),
    }


@router.post("/read-all")
def mark_all_read(
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """내 미읽음 알림을 전부 읽음 처리하고 건수를 돌려준다."""
    updated = (
        db.query(models.Notification)
        .filter(models.Notification.employee_id == me, models.Notification.read_at.is_(None))
        .update({"read_at": datetime.now()}, synchronize_session=False)
    )
    db.commit()
    return {"updated": int(updated)}


@router.post("/{notification_id}/read")
def mark_read(
    notification_id: int,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """알림 1건 읽음 처리(멱등)."""
    row = _mine(db, me, notification_id)
    if row.read_at is None:
        row.read_at = datetime.now()
        db.commit()
    return {"ok": True, "id": row.id}


@router.delete("/{notification_id}")
def delete_notification(
    notification_id: int,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """알림 1건 삭제(내 것만)."""
    row = _mine(db, me, notification_id)
    db.delete(row)
    db.commit()
    return {"ok": True}
```

- [ ] **Step 4: `main.py` 등록**

(a) 20~45행 import 목록에서 `newsletters,` 다음 줄에 `notifications,` 를 추가(알파벳 순):

```python
    newsletters,
    notifications,
    presentations,
```

(b) 212행 `application.include_router(reports.router)` 다음 줄에:

```python
    application.include_router(notifications.router)
```

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_notifications_router.py -q
```
기대: `9 passed`.

전체 백엔드 회귀:
```
WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
기대: 실패 0.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/routers/notifications.py`, `app/main.py`, `tests/test_notifications_router.py`. (백엔드 완료 시점 — 사용자가 여기서 한 번 커밋할 수 있도록 Task 1~5 파일을 묶어 다시 나열한다.)

---

### Task 6: 프론트 API 모듈 + 폴링 정책 + 순수 유틸(`node --test`)

**Files:**
- Create: `HiTessWorkBench/frontend/src/api/notifications.js`
- Modify: `HiTessWorkBench/frontend/src/hooks/pollingPolicy.js`
- Create: `HiTessWorkBench/frontend/src/utils/notificationLink.js`
- Create: `HiTessWorkBench/frontend/src/utils/notificationLink.test.js`

- [ ] **Step 1: 순수 유틸 실패 테스트 작성** — `src/utils/notificationLink.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NOTIFICATION_LIST_CAP,
  formatNotificationTime,
  mergeNotifications,
  notificationKindMeta,
  resolveNotificationTarget,
  toastToneFor,
} from './notificationLink.js';

test('링크에서 메뉴·params·analysisId 를 꺼낸다', () => {
  const t = resolveNotificationTarget({ menu: ' My Projects ', params: { analysis_id: '12', job_id: 'j' } });
  assert.deepEqual(t, { menu: 'My Projects', params: { analysis_id: '12', job_id: 'j' }, analysisId: 12 });
});

test('menu 가 없거나 링크가 아니면 null', () => {
  assert.equal(resolveNotificationTarget(null), null);
  assert.equal(resolveNotificationTarget({ params: {} }), null);
  assert.equal(resolveNotificationTarget({ menu: '   ' }), null);
});

test('analysis_id 가 정수가 아니면 analysisId 는 null', () => {
  assert.equal(resolveNotificationTarget({ menu: 'My Projects', params: { analysis_id: 'abc' } }).analysisId, null);
  assert.equal(resolveNotificationTarget({ menu: 'My Projects', params: { analysis_id: 0 } }).analysisId, null);
  assert.deepEqual(resolveNotificationTarget({ menu: 'Dashboard' }).params, {});
});

test('병합은 새 항목 우선·id 내림차순·중복 제거·캡', () => {
  const prev = [{ id: 3, title: 'old3' }, { id: 1, title: 'old1' }];
  const fresh = [{ id: 5, title: 'n5' }, { id: 3, title: 'new3' }];
  const merged = mergeNotifications(prev, fresh);
  assert.deepEqual(merged.map(n => n.id), [5, 3, 1]);
  assert.equal(merged[1].title, 'new3');

  const many = Array.from({ length: NOTIFICATION_LIST_CAP + 20 }, (_, i) => ({ id: i + 1 }));
  assert.equal(mergeNotifications([], many).length, NOTIFICATION_LIST_CAP);
  assert.equal(mergeNotifications([], many)[0].id, NOTIFICATION_LIST_CAP + 20);
});

test('병합은 id 가 없는 쓰레기를 버린다', () => {
  assert.deepEqual(mergeNotifications([null, { id: 'x' }], [{ id: 2 }]), [{ id: 2 }]);
});

test('kind 메타와 토스트 톤', () => {
  assert.equal(notificationKindMeta('job.completed').tone, 'success');
  assert.equal(notificationKindMeta('job.failed').tone, 'error');
  assert.equal(notificationKindMeta('unknown.kind').label, '알림');
  assert.equal(toastToneFor('retention.expired'), 'info');   // neutral → info
  assert.equal(toastToneFor('job.failed'), 'error');
});

test('상대 시각', () => {
  const now = Date.parse('2026-09-18T10:00:00');
  assert.equal(formatNotificationTime('2026-09-18T09:59:40', now), '방금');
  assert.equal(formatNotificationTime('2026-09-18T09:30:00', now), '30분 전');
  assert.equal(formatNotificationTime('2026-09-18T07:00:00', now), '3시간 전');
  assert.equal(formatNotificationTime('2026-09-15T10:00:00', now), '3일 전');
  assert.equal(formatNotificationTime('2026-09-01T10:00:00', now), '9/1');
  assert.equal(formatNotificationTime('garbage', now), '');
});
```

- [ ] **Step 2: 실패 확인** (`C:\Coding\WorkBench\HiTessWorkBench\frontend` 에서)

```
node --test src/utils/notificationLink.test.js
```
기대: `Cannot find module … notificationLink.js` 로 실패(`fail 1`).

- [ ] **Step 3: 순수 유틸 구현** — `src/utils/notificationLink.js`:

```js
/**
 * 알림 센터 순수 유틸 — 부수효과 없음(node --test 로 검증).
 * 링크 해석·목록 병합·kind 표시 메타·상대 시각.
 */

export const NOTIFICATION_LIST_CAP = 100;

// kind 어휘는 백엔드 notification_service.NOTIFICATION_KINDS 와 같다.
// tone 은 ToastContext 의 type(success/error/warning/info) 또는 neutral.
const KIND_META = {
  'job.completed': { label: '해석 완료', tone: 'success' },
  'job.failed': { label: '해석 실패', tone: 'error' },
  'job.cancelled': { label: '해석 중단', tone: 'warning' },
  'retention.expiring': { label: '보관 만료 예정', tone: 'warning' },
  'retention.expired': { label: '보관 만료', tone: 'neutral' },
  'batch.completed': { label: '배치 완료', tone: 'success' },
  'share.received': { label: '공유', tone: 'info' },
  'feature_request.status_changed': { label: '기능 요청', tone: 'info' },
  'notice.published': { label: '공지', tone: 'info' },
};

export function notificationKindMeta(kind) {
  return KIND_META[kind] || { label: '알림', tone: 'info' };
}

/** ToastContext 의 type 으로 변환(neutral 은 info). */
export function toastToneFor(kind) {
  const { tone } = notificationKindMeta(kind);
  return tone === 'neutral' ? 'info' : tone;
}

/**
 * 서버 link({menu, params}) → {menu, params, analysisId|null}. 이동 불가면 null.
 * analysisId 는 My Projects 상세 모달 자동 오픈에 쓴다.
 */
export function resolveNotificationTarget(link) {
  if (!link || typeof link !== 'object') return null;
  const menu = typeof link.menu === 'string' ? link.menu.trim() : '';
  if (!menu) return null;
  const params = link.params && typeof link.params === 'object' ? link.params : {};
  const raw = Number(params.analysis_id);
  const analysisId = Number.isInteger(raw) && raw > 0 ? raw : null;
  return { menu, params, analysisId };
}

/** 델타 병합: fresh 가 prev 를 덮고, id 내림차순, 중복 제거, cap 건. */
export function mergeNotifications(prev, fresh, cap = NOTIFICATION_LIST_CAP) {
  const byId = new Map();
  for (const item of [...(fresh || []), ...(prev || [])]) {
    if (!item || !Number.isInteger(item.id)) continue;
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, cap);
}

/** ISO 시각 → '방금 | n분 전 | n시간 전 | n일 전 | M/D'. 파싱 실패는 ''. */
export function formatNotificationTime(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const minutes = Math.floor(Math.max(0, now - t) / 60000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
```

- [ ] **Step 4: 통과 확인**

```
node --test src/utils/notificationLink.test.js
```
기대: `pass 7`, `fail 0`.

- [ ] **Step 5: API 모듈** — `src/api/notifications.js`(`api/chat.js` 와 같은 형태):

```js
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/**
 * 내 알림 목록 (헤더 종 아이콘 30초 폴링용).
 * since 가 있으면 그 id 이후 델타만 온다. unread_count / latest_id 는 항상 전체 기준.
 */
export const getNotifications = ({ since, limit = 50, unreadOnly = false } = {}) =>
  axios.get(`${API_BASE_URL}/api/notifications`, {
    params: {
      ...(since != null ? { since } : {}),
      limit,
      unread_only: unreadOnly,
    },
    headers: getAuthHeaders(),
  });

/** 알림 1건 읽음 처리(멱등) */
export const markNotificationRead = (id) =>
  axios.post(`${API_BASE_URL}/api/notifications/${id}/read`, {}, { headers: getAuthHeaders() });

/** 내 미읽음 전부 읽음 처리 */
export const markAllNotificationsRead = () =>
  axios.post(`${API_BASE_URL}/api/notifications/read-all`, {}, { headers: getAuthHeaders() });

/** 알림 1건 삭제(내 것만) */
export const deleteNotification = (id) =>
  axios.delete(`${API_BASE_URL}/api/notifications/${id}`, { headers: getAuthHeaders() });
```

- [ ] **Step 6: 폴링 정책** — `src/hooks/pollingPolicy.js` 를 아래로 교체:

```js
export const POLLING_POLICY = {
  analysisIntervalMs: 1500,
  analysisMaxRetries: 120,
  longAnalysisMaxRetries: 240,
  systemIntervalMs: 3000,
  externalAppIntervalMs: 20000,
  // 알림 센터(헤더 종 아이콘). presence 45초·chat 5초 사이 — 서버가 남긴 통지는 30초면 충분하다.
  notificationsIntervalMs: 30000,
};
```

- [ ] **Step 7: 빌드 확인**

```
npm run build
```
기대: 오류 없이 `dist/` 생성(모듈이 아직 어디서도 import 되지 않으므로 tree-shake 되어도 정상).

- [ ] **Step 8: 커밋 준비 완료** — 보고: `src/api/notifications.js`, `src/hooks/pollingPolicy.js`, `src/utils/notificationLink.js`, `src/utils/notificationLink.test.js`. (`config.js` 는 스테이징 금지.)

---

### Task 7: `useNotifications` 폴링 훅

**Files:**
- Create: `HiTessWorkBench/frontend/src/hooks/useNotifications.js`

- [ ] **Step 1: 훅 구현**

```js
/**
 * 알림 센터 폴링 훅 — 30초 주기(POLLING_POLICY.notificationsIntervalMs), WebSocket 없음.
 *
 *  - 첫 폴링: since 없이 50건 → 전체 목록. baseline 이므로 onNew 를 부르지 않는다(ChatDock 과 동일).
 *  - 이후: since=latest_id 델타만 받아 mergeNotifications 로 합치고, 새 항목이 있으면 onNew(items).
 *  - 창이 다시 보이거나(visibilitychange) 포커스를 받으면 즉시 1회(5초 스로틀).
 *  - 읽음/삭제는 낙관적 갱신 후 API. 실패해도 되돌리지 않는다(다음 폴링이 unread_count 를 서버 값으로 맞춘다).
 *
 * currentUserId 가 없으면 아무것도 하지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/notifications';
import { POLLING_POLICY } from './pollingPolicy';
import { mergeNotifications } from '../utils/notificationLink';

const FOCUS_POLL_THROTTLE_MS = 5000;
const DEFAULT_PREFS = { muted_kinds: [], desktop_toast: true };

export function useNotifications({ currentUserId, onNew }) {
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [loading, setLoading] = useState(false);

  // null = 아직 첫 폴링 전(무음 baseline). 이후엔 서버 latest_id.
  const latestIdRef = useRef(null);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;
  const lastPollAtRef = useRef(0);
  const inFlightRef = useRef(false);

  const poll = useCallback(async ({ full = false } = {}) => {
    if (!currentUserId || inFlightRef.current) return;
    inFlightRef.current = true;
    lastPollAtRef.current = Date.now();
    const since = full ? null : latestIdRef.current;
    try {
      if (full) setLoading(true);
      const res = await getNotifications(since == null ? {} : { since });
      const data = res.data || {};
      const fresh = Array.isArray(data.items) ? data.items : [];
      setUnreadCount(Number(data.unread_count) || 0);
      if (data.prefs && typeof data.prefs === 'object') {
        setPrefs({ ...DEFAULT_PREFS, ...data.prefs });
      }
      if (since == null) {
        setItems(fresh);
      } else if (fresh.length > 0) {
        setItems(prev => mergeNotifications(prev, fresh));
        onNewRef.current?.(fresh);
      }
      latestIdRef.current = Math.max(Number(data.latest_id) || 0, since || 0);
    } catch {
      // 폴링 실패는 조용히 무시 — 다음 주기에 복구.
    } finally {
      inFlightRef.current = false;
      if (full) setLoading(false);
    }
  }, [currentUserId]);

  // 주기 폴링 + 창 복귀 시 즉시 폴링.
  useEffect(() => {
    if (!currentUserId) {
      latestIdRef.current = null;
      setItems([]);
      setUnreadCount(0);
      return undefined;
    }
    latestIdRef.current = null;
    poll({ full: true });
    const timer = setInterval(() => poll(), POLLING_POLICY.notificationsIntervalMs);

    const onResume = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (Date.now() - lastPollAtRef.current < FOCUS_POLL_THROTTLE_MS) return;
      poll();
    };
    window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onResume);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onResume);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, [currentUserId, poll]);

  /** 패널을 열 때 전체 목록을 다시 받는다(다른 창에서 읽음 처리한 상태 반영). */
  const reload = useCallback(() => poll({ full: true }), [poll]);

  const markRead = useCallback(async (id) => {
    const now = new Date().toISOString();
    let changed = false;
    setItems(prev => prev.map(n => {
      if (n.id !== id || n.is_read) return n;
      changed = true;
      return { ...n, is_read: true, read_at: now };
    }));
    if (changed) setUnreadCount(c => Math.max(0, c - 1));
    try { await markNotificationRead(id); } catch { /* 다음 폴링이 맞춘다 */ }
  }, []);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setItems(prev => prev.map(n => (n.is_read ? n : { ...n, is_read: true, read_at: now })));
    setUnreadCount(0);
    try { await markAllNotificationsRead(); } catch { /* 다음 폴링이 맞춘다 */ }
  }, []);

  const remove = useCallback(async (id) => {
    let wasUnread = false;
    setItems(prev => prev.filter(n => {
      if (n.id !== id) return true;
      wasUnread = !n.is_read;
      return false;
    }));
    if (wasUnread) setUnreadCount(c => Math.max(0, c - 1));
    try { await deleteNotification(id); } catch { /* 다음 폴링이 맞춘다 */ }
  }, []);

  return { items, unreadCount, prefs, loading, reload, markRead, markAllRead, remove };
}
```

- [ ] **Step 2: 빌드 확인**

```
npm run build
```
기대: 오류 없음.

- [ ] **Step 3: 커밋 준비 완료** — 보고: `src/hooks/useNotifications.js`.

---

### Task 8: 데스크톱 토스트 래퍼 + Electron AUMID

**Files:**
- Create: `HiTessWorkBench/frontend/src/utils/desktopNotification.js`
- Modify: `HiTessWorkBench/electron/index.js:2537` (`app.whenReady().then(() => {` 직후)

- [ ] **Step 1: 래퍼 구현** — `src/utils/desktopNotification.js`:

```js
/**
 * 데스크톱(OS) 토스트 — 렌더러의 표준 Notification API 를 그대로 쓴다. IPC 채널 추가 없음.
 *
 * Electron 렌더러는 Notification.permission 이 기본 'granted' 다. 브라우저(npm run dev 를
 * 크롬에서 열 때)는 'default' 라 첫 사용자 제스처에서 ensureDesktopNotificationPermission() 을 부른다.
 * Windows 가 토스트에 앱 이름/아이콘을 붙이려면 main 이 app.setAppUserModelId(...) 를 설정해야 한다.
 * 실패는 전부 조용히 무시한다 — 인앱 토스트(ToastContext)가 이미 떠 있다.
 */

export function canShowDesktopNotification(win = globalThis) {
  const N = win?.Notification;
  return typeof N === 'function' && N.permission === 'granted';
}

export async function ensureDesktopNotificationPermission(win = globalThis) {
  const N = win?.Notification;
  if (typeof N !== 'function') return 'unsupported';
  if (N.permission === 'default' && typeof N.requestPermission === 'function') {
    try { return await N.requestPermission(); } catch { return N.permission; }
  }
  return N.permission;
}

/**
 * @param {{title: string, body?: string, tag?: string, onClick?: Function}} opts
 * @returns {Notification|null}
 */
export function showDesktopNotification({ title, body = '', tag, onClick }, win = globalThis) {
  if (!title || !canShowDesktopNotification(win)) return null;
  try {
    const n = new win.Notification(title, { body, tag });
    if (typeof onClick === 'function') {
      n.onclick = () => {
        try { win.focus?.(); } catch { /* 포커스 거부는 무시 */ }
        onClick();
        try { n.close?.(); } catch { /* 이미 닫힘 */ }
      };
    }
    return n;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Electron AUMID** — `electron/index.js` 2537행 `app.whenReady().then(() => {` 바로 다음 줄(현재 "외부 회사 네트워크…" 주석 앞)에 추가:

```js
  // Windows 토스트(렌더러 new Notification())가 앱을 식별하도록 AUMID 를 고정한다.
  // package.json build.appId 와 같은 값이어야 설치본·포터블 모두 같은 앱으로 묶인다.
  app.setAppUserModelId('com.hitess.workbench');

```

(`preload.js` 는 손대지 않는다 — Notification 은 Web API 라 IPC 가 필요 없다. CSP(`response-security.js`)도 Notification 을 막지 않는다.)

- [ ] **Step 3: 확인** — `C:\Coding\WorkBench\HiTessWorkBench` 에서

```
node --check electron/index.js
```
기대: 출력 없음(구문 OK). `cd frontend && npm run build` 도 오류 없음.

- [ ] **Step 4: 커밋 준비 완료** — 보고: `frontend/src/utils/desktopNotification.js`, `electron/index.js`.

---

### Task 9: `NotificationCenter` 컴포넌트 + 헤더 배치

**Files:**
- Create: `HiTessWorkBench/frontend/src/components/platform/NotificationCenter.jsx`
- Modify: `HiTessWorkBench/frontend/src/components/layout/Layout.jsx:1-19`(import), `:316-328`(배치)

- [ ] **Step 1: 컴포넌트 구현** — `src/components/platform/NotificationCenter.jsx`:

```jsx
/**
 * @fileoverview 헤더 알림 센터 — 종 아이콘 + 미읽음 배지 + 인박스 드롭다운 패널.
 *
 * 서버가 남긴 알림(notifications)을 useNotifications 가 30초 폴링으로 가져온다.
 *  - 새 알림 → 인앱 토스트(항상) + 데스크톱 토스트(창이 포커스를 잃었고 prefs.desktop_toast 일 때)
 *  - 항목 클릭 → 읽음 처리 + link 로 이동. link.params.analysis_id 가 있으면 해당 해석 행을 받아
 *    Dashboard→MyProjects 와 같은 sessionStorage('workbench:open-project-detail') 로 넘겨 상세 모달을 연다.
 *    이동은 기존 'workbench:navigate' 이벤트(Layout 의 handleNavigate, 관리자 게이트 포함)를 쓴다.
 * 우하단 UtilityDock(작업 진행)과 역할이 다르다 — 여기는 '서버가 남긴 통지'다.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Bell, CheckCheck, CheckCircle2, Info, Trash2, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useNotifications } from '../../hooks/useNotifications';
import { getAnalysisById } from '../../api/analysis';
import {
  formatNotificationTime,
  notificationKindMeta,
  resolveNotificationTarget,
  toastToneFor,
} from '../../utils/notificationLink';
import { ensureDesktopNotificationPermission, showDesktopNotification } from '../../utils/desktopNotification';

// Dashboard.jsx / MyProjects.jsx 가 쓰는 키·이벤트 이름과 같아야 한다.
const OPEN_PROJECT_DETAIL_KEY = 'workbench:open-project-detail';
const OPEN_PROJECT_DETAIL_EVENT = 'workbench:open-project-detail';

const TONE_ICON = {
  success: <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />,
  error: <AlertCircle size={16} className="shrink-0 text-red-500" />,
  warning: <AlertCircle size={16} className="shrink-0 text-amber-500" />,
  info: <Info size={16} className="shrink-0 text-blue-500" />,
  neutral: <Info size={16} className="shrink-0 text-slate-400" />,
};

/**
 * 알림 링크로 이동한다. analysis_id 가 있으면 해석 행을 받아 My Projects 상세 모달을 자동으로 연다.
 * 행 조회 실패(삭제·권한)는 경고만 하고 목록 화면으로는 이동한다.
 */
async function openNotificationLink(link, showToast) {
  const target = resolveNotificationTarget(link);
  if (!target) return;
  if (target.analysisId) {
    try {
      const res = await getAnalysisById(target.analysisId);
      if (res?.data && typeof res.data === 'object') {
        try {
          sessionStorage.setItem(OPEN_PROJECT_DETAIL_KEY, JSON.stringify(res.data));
        } catch {
          // sessionStorage 가 막힌 환경에서는 목록으로만 이동한다.
        }
        window.dispatchEvent(new CustomEvent(OPEN_PROJECT_DETAIL_EVENT));
      }
    } catch {
      showToast?.('해석 기록을 찾을 수 없습니다. 삭제됐거나 권한이 없는 항목입니다.', 'warning');
    }
  }
  window.dispatchEvent(new CustomEvent('workbench:navigate', { detail: { menu: target.menu } }));
}

function NotificationItem({ item, onOpen, onRemove }) {
  const meta = notificationKindMeta(item.kind);
  return (
    <li className={`group flex items-start gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 ${item.is_read ? 'bg-white' : 'bg-blue-50/40'}`}>
      <span className="mt-0.5">{TONE_ICON[meta.tone] || TONE_ICON.info}</span>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30"
      >
        <div className="flex items-center gap-2">
          <p className={`truncate text-sm ${item.is_read ? 'font-semibold text-slate-700' : 'font-bold text-slate-900'}`} title={item.title}>
            {item.title}
          </p>
          {!item.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" aria-label="미읽음" />}
        </div>
        {item.body && (
          <p className="mt-0.5 truncate text-xs text-slate-500" title={item.body}>{item.body}</p>
        )}
        <p className="mt-1 text-[10px] font-semibold text-slate-400">
          {meta.label} · {formatNotificationTime(item.created_at)}
        </p>
      </button>
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        className="rounded-lg p-1.5 text-slate-300 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30 group-hover:opacity-100"
        title="알림 삭제"
        aria-label={`${item.title} 알림 삭제`}
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}

export default function NotificationCenter() {
  const { user } = useAuth();
  const currentUserId = user?.employee_id || null;
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const prefsRef = useRef({ muted_kinds: [], desktop_toast: true });

  // 새 알림 도착(폴링 델타) — 최신 1건만 토스트로 알린다(여러 건이면 건수를 덧붙인다).
  const handleNew = useCallback((fresh) => {
    const newest = fresh[0];
    if (!newest) return;
    const extra = fresh.length > 1 ? ` 외 ${fresh.length - 1}건` : '';
    const open = () => openNotificationLink(newest.link, showToast);
    showToast(`${newest.title}${extra}`, toastToneFor(newest.kind), 8000, {
      onClick: open,
      actionLabel: '열기',
    });
    const focused = typeof document !== 'undefined' && typeof document.hasFocus === 'function'
      ? document.hasFocus()
      : true;
    if (prefsRef.current.desktop_toast && !focused) {
      showDesktopNotification({
        title: newest.title,
        body: newest.body || '',
        tag: `workbench-notification-${newest.id}`,
        onClick: open,
      });
    }
  }, [showToast]);

  const { items, unreadCount, prefs, loading, reload, markRead, markAllRead, remove } =
    useNotifications({ currentUserId, onNew: handleNew });

  useEffect(() => { prefsRef.current = prefs; }, [prefs]);

  // 바깥 클릭·Esc 로 닫기.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    setOpen(prev => {
      const next = !prev;
      if (next) {
        reload();
        // 브라우저(dev)에서는 첫 사용자 제스처에서 권한을 묻는다. Electron 은 이미 granted.
        ensureDesktopNotificationPermission();
      }
      return next;
    });
  };

  const handleOpenItem = async (item) => {
    setOpen(false);
    if (!item.is_read) markRead(item.id);
    await openNotificationLink(item.link, showToast);
  };

  if (!currentUserId) return null;

  const badge = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        className={`relative rounded-lg p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          open ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
        }`}
        title={unreadCount > 0 ? `읽지 않은 알림 ${unreadCount}건` : '알림'}
        aria-label="알림"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-4 text-white">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="알림 센터"
          className="absolute right-0 top-full z-[99] mt-2 flex max-h-[min(520px,calc(100vh-6rem))] w-[min(384px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        >
          <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <Bell size={16} className="text-brand-blue" />
            <h2 className="text-sm font-bold text-slate-800">알림</h2>
            {unreadCount > 0 && (
              <span className="rounded-full bg-blue-600 px-2 text-[10px] font-bold leading-5 text-white">{badge}</span>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={markAllRead}
              disabled={unreadCount === 0}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
              title="모두 읽음"
            >
              <CheckCheck size={14} />
              모두 읽음
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="알림 닫기"
            >
              <X size={16} />
            </button>
          </header>

          <div className="overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <Bell size={30} className="mx-auto text-slate-300" />
                <p className="mt-3 text-sm font-bold text-slate-700">
                  {loading ? '알림을 불러오는 중…' : '새 알림이 없습니다.'}
                </p>
                <p className="mt-1 text-xs text-slate-500">해석이 끝나면 여기에 알림이 쌓입니다. 90일 동안 보관됩니다.</p>
              </div>
            ) : (
              <ul>
                {items.map(item => (
                  <NotificationItem key={item.id} item={item} onOpen={handleOpenItem} onRemove={remove} />
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 헤더 배치** — `src/components/layout/Layout.jsx`

(a) 18행 `import CommandPalette from '../platform/CommandPalette';` 아래에:

```js
import NotificationCenter from '../platform/NotificationCenter';
```

(b) 316~327행의 `networkEvents` 경고 버튼 블록(`{networkEvents.length > 0 && ( … )}`) 바로 뒤, 328행 `<div className="h-6 w-px bg-gray-200 mx-0.5 lg:mx-1"></div>` 앞에 한 줄:

```jsx
            <NotificationCenter />
```

결과(327~329행 근처):

```jsx
            )}
            <NotificationCenter />
            <div className="h-6 w-px bg-gray-200 mx-0.5 lg:mx-1"></div>
```

- [ ] **Step 3: 빌드 + 수동 검증 1(표시)**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && npm run build
```
기대: 오류 없음.

수동 검증(백엔드 `uvicorn app.main:app --host 0.0.0.0 --port 9091 --reload` 기동 + `HiTessWorkBench` 에서 `npm run dev`):
1. 로그인 → 헤더 우측(서버 상태 버튼과 사용자 이름 사이)에 **종 아이콘**이 보인다. 배지 없음.
2. 종 클릭 → "알림" 패널이 아래로 열리고 "새 알림이 없습니다." 빈 상태. 바깥 클릭·Esc 로 닫힌다.
3. DevTools Network 에서 `GET /api/notifications` 가 로그인 직후 1회, 이후 **30초 간격**으로 `since=<id>` 를 달고 호출된다. 다른 창을 갔다 돌아오면 즉시 1회 더 호출된다(5초 내 반복은 안 함).

- [ ] **Step 4: 수동 검증 2(알림 흐름)** — 백엔드 셸에서 알림을 직접 심는다:

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd
WorkBenchEnv/Scripts/python.exe -c "from app import database; from app.services.notification_service import notify; db=database.SessionLocal(); print(notify(db, employee_id='<내 사번>', kind='job.completed', title='Truss Assessment 해석 완료', body='수동 검증', link={'menu':'My Projects','params':{'analysis_id': <내 해석 id 하나>}}).id)"
```
기대:
1. 30초 이내(또는 창 포커스 복귀 즉시) 우상단에 **초록 인앱 토스트** "Truss Assessment 해석 완료" + "열기 →" 가 뜨고, 종 배지에 **1**.
2. WorkBench 창의 포커스를 다른 앱으로 옮긴 뒤 같은 명령을 다시(같은 `analysis_id`, dedupe 없음이라 새 알림) 실행 → **Windows 데스크톱 토스트**가 뜬다(제목/본문). 토스트 클릭 → WorkBench 창이 앞으로 오고 My Projects 상세 모달이 열린다.
   - 토스트가 안 뜨면: Windows 설정 > 알림에서 "HiTESS WorkBench"(개발 중엔 electron) 허용 여부 확인. 그래도 안 뜨면 포터블 exe 에 시작 메뉴 바로가기가 없어서일 수 있다 — 인앱 토스트·배지는 정상이어야 하며 데스크톱 토스트는 best-effort 다(spec §7.1).
3. 종 → 패널에서 항목이 **파란 배경 + 파란 점**(미읽음). 클릭 → 패널 닫힘, `My Projects` 로 이동, 해당 해석 **상세 모달 자동 오픈**, 다시 종을 열면 항목이 흰 배경(읽음), 배지 사라짐.
4. "모두 읽음" 이 미읽음 0 이면 비활성. 항목 hover 시 휴지통 → 삭제되고 목록에서 사라진다(새로고침 후에도 없음).
5. `analysis_id` 를 존재하지 않는 값(예 999999)으로 심은 알림을 클릭 → 노란 경고 토스트 "해석 기록을 찾을 수 없습니다…" 후 My Projects 목록으로는 이동한다.

- [ ] **Step 5: 커밋 준비 완료** — 보고: `src/components/platform/NotificationCenter.jsx`, `src/components/layout/Layout.jsx`.

---

### Task 10: `MyProjects` 이벤트 수신 + 해석 완료 end-to-end

**Files:**
- Modify: `HiTessWorkBench/frontend/src/pages/analysis/MyProjects.jsx:673-685`

- [ ] **Step 1: 마운트 읽기를 함수로 빼고 이벤트도 듣는다** — 673~685행의 `useEffect` 를 아래로 교체:

```jsx
  // 대시보드 "프로젝트 이력" 행 또는 알림 센터에서 넘어온 경우, 해당 프로젝트 상세 모달을 자동으로 연다.
  // (Dashboard.jsx / NotificationCenter.jsx 의 OPEN_PROJECT_DETAIL 키·이벤트와 동일)
  // 마운트 시 1회 + 'workbench:open-project-detail' 이벤트 — 이미 이 화면에 있을 때
  // setCurrentMenu('My Projects') 는 no-op 이라 마운트 effect 가 다시 돌지 않기 때문이다.
  useEffect(() => {
    const consumePendingProjectDetail = () => {
      try {
        const raw = sessionStorage.getItem('workbench:open-project-detail');
        if (!raw) return;
        sessionStorage.removeItem('workbench:open-project-detail');
        const project = JSON.parse(raw);
        if (project && typeof project === 'object') setSelectedProject(project);
      } catch {
        // 잘못된 값이면 자동 오픈하지 않는다
      }
    };
    consumePendingProjectDetail();
    window.addEventListener('workbench:open-project-detail', consumePendingProjectDetail);
    return () => window.removeEventListener('workbench:open-project-detail', consumePendingProjectDetail);
  }, []);
```

- [ ] **Step 2: 빌드**

```
npm run build
```
기대: 오류 없음.

- [ ] **Step 3: 수동 검증(실제 해석 종료 → 알림)** — 백엔드(9091) + `npm run dev`:
1. **이미 My Projects 화면에 있는 상태**에서 Task 9 Step 4 의 명령으로 알림을 심고 토스트의 "열기" 클릭 → 페이지 이동 없이 **상세 모달이 바로 열린다**(이벤트 경로).
2. `Truss Structural Assessment` 에서 작은 BDF(예 `tests/fixtures` 의 샘플 또는 기존 이력의 파일)를 업로드해 해석 실행 → 완료되면 30초 이내에 "Truss Assessment 해석 완료" 토스트 + 배지 1. 알림 본문은 프로젝트명. 패널 항목 클릭 → 그 해석의 상세 모달.
3. 일부러 깨진 BDF 로 실행 → "Truss Assessment 해석 실패"(빨간 토스트), 본문에 엔진 메시지.
4. 같은 작업이 두 번 알리지 않는다(패널에 1건). DB 확인: `SELECT kind, title, dedupe_key FROM notifications ORDER BY id DESC LIMIT 5;` 에 `job:<job_id>:job.completed` 1행.
5. HiTESS Model Builder 에서 Studio 해석(내부 단계 `ModelBuilderAnalysis` 등)을 돌려도 **내부 단계 알림은 없고** 사용자 화면에 보이는 해석만 알린다.
6. 로그아웃 → 종 아이콘 사라짐, Network 에 `/api/notifications` 호출이 멈춘다. 재로그인 → 첫 폴링은 토스트 없이(baseline) 배지만 갱신.

- [ ] **Step 4: 커밋 준비 완료** — 보고: `src/pages/analysis/MyProjects.jsx`.

---

### Task 11: 최종 점검 + 서버(145) 반영 안내

- [ ] **Step 1: 백엔드 전체 회귀**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
기대: 실패 0. 신규 파일 5개(`test_notification_models`, `test_notification_service`, `test_job_manager_notify`, `test_notification_cleanup`, `test_notifications_router`) 합계 **39건** 통과(4+17+5+4+9).

- [ ] **Step 2: 프론트 순수 유틸 + 빌드**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && node --test src/utils/notificationLink.test.js && npm run build
```
기대: `pass 7`, 빌드 성공.

- [ ] **Step 3: 스테이징 점검** — `git status` 에서 `HiTessWorkBench/frontend/src/config.js` 가 변경돼 있으면 **스테이징하지 않는다**(로컬 백엔드 토글). `Darkmode.js/` 미포함 확인.

- [ ] **Step 4: 사용자 보고(커밋은 사용자가 직접)** — 변경 파일 전체 목록(파일 구조 표) + 아래 서버 반영 구분을 그대로 전달.

**서버(145) 반영:**
- **백엔드 — `git pull` + 백엔드 재시작으로 끝.** `notifications`·`user_preferences` 테이블은 기동 시 `create_all`, 컬럼/인덱스는 `run_schema_bootstrap`(`ensure_notification_columns`). 신규 pip 의존성 없음(`requirements.txt` 변경 없음).
- **프론트 — 재배포 필요.** WorkBench 포터블 exe 를 `npm run dist` 로 다시 빌드해 배포(헤더 종 아이콘·폴링·Electron main 의 `setAppUserModelId`).
- **InHouse 프로그램 — 없음.** `InHouseProgram/` 수동 교체 대상 없음.

---

## 자기 검토

- **spec 커버리지**: §3 모델(Task 1) · §4 서비스(Task 2) · §5.1 훅(Task 3) · §5.2 정리(Task 4) · §6 API(Task 5) · §7.1 종/배지/패널/토스트(Task 9) · §7.2 링크 이동(Task 9 `openNotificationLink` + Task 10 이벤트) · §7.3 폴링(Task 7) · §7.4 순수 유틸(Task 6) · 데스크톱 토스트+AUMID(Task 8) · §8 보관(Task 4) · §10 서버 반영(Task 11). §2.2 `UserPreference` 선점 생성(Task 1). 비목표(§11)는 만들지 않는다.
- **플레이스홀더 없음**: 모든 코드 step 이 실제 코드다. 프론트는 러너가 없어 수동 절차를 단계·기대 동작으로 적었다.
- **타입/이름 일관성**: `notify(db, *, employee_id, kind, title, body, link, dedupe_key, dedupe_unread_only)` 는 마스터 §2.1 시그니처 + 옵션 1개(기본값이 마스터 동작). `serialize_notification` 의 8개 키 = 라우터 테스트 `set(item)` = 프론트 `useNotifications` 가 읽는 `is_read/read_at/link/title/body/kind/id/created_at`. `link` 형태 `{"menu","params":{"analysis_id","program_name","job_id"}}` 는 서비스 테스트 · `resolveNotificationTarget` · `openNotificationLink` 세 곳이 같은 키를 쓴다. sessionStorage 키/이벤트 이름 `'workbench:open-project-detail'` 은 Dashboard·MyProjects·NotificationCenter 가 동일. `POLLING_POLICY.notificationsIntervalMs` 를 훅이 그대로 쓴다. `program_registry.resolve_program().display_name`(예 `BDF Scanner`)이 알림 제목에 들어가며 서비스 테스트가 그 값을 고정한다.
- **의존 순서**: Task 2 가 정의한 `notify_job_terminal`·`prune_notifications`·`serialize_notification`·`get_notification_prefs` 를 Task 3·4·5 가 쓴다. Task 6 의 `mergeNotifications`·`resolveNotificationTarget`·`toastToneFor` 를 Task 7·9 가, Task 7 훅과 Task 8 래퍼를 Task 9 가 쓴다.
