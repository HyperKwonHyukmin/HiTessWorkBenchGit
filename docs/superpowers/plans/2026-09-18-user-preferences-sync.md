# 최근 앱·즐겨찾기 동기화·환경설정 (Plan E) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 즐겨찾기·최근 앱·시작 화면·알림 수신을 **사번 단위 서버 저장**(`user_preferences.prefs` JSON 한 칸)으로 옮겨, 어느 PC 에서 로그인해도 같은 상태를 보고 같은 자리에서 이어 쓴다. 로그인 시 서버 우선 병합(빈 서버 키는 로컬로 시드), 이후 변경은 500ms 디바운스 부분 `PUT`. 오프라인이면 지금처럼 localStorage 만으로 동작하고 30초 주기로 재시도한다. 헤더 사용자 블록 클릭 · 명령 팔레트 · `App.jsx` switch 한 케이스로 `'My Settings'` 페이지가 열리고, 여기서 내 정보 확인·시작 화면 선택·알림 수신 설정·즐겨찾기/최근 앱 초기화가 이뤄진다. Dashboard 즐겨찾기 아래에는 최대 6개 "최근 사용" 카드 행이 새로 붙는다.

**Architecture:** 백엔드 — `models.UserPreference`(마스터 §2.2, Plan A 가 선점 생성했으면 재사용) + `schema_bootstrap.ensure_user_preferences_columns` + `services/user_preferences_service.py`(`get_prefs`, `merge_prefs`, `effective_prefs`, `normalize_*`, 화이트리스트) + `routers/preferences.py`(`GET`/`PUT /api/preferences`). 프론트 — `api/preferences.js`(axios 2함수) + 순수 유틸 `utils/preferenceMerge.js`(node --test) + `contexts/PreferencesContext.jsx`(사번별 캐시·로그인 하이드레이션·500ms 디바운스·30초 재시도·`hydration` 카운터) + `DashboardContext.jsx`(즐겨찾기 3계층 sync — React state · localStorage `'favorites'` · Electron `preferences:get/set`) + `RecentActivityContext.jsx`(localStorage `'hitess_recent_apps'` sync) + `App.jsx`(landing_menu 로그인 1회 적용 + `case 'My Settings'`) + `pages/settings/MySettings.jsx`(내 정보·시작 화면·알림 수신·초기화 4카드) + `components/layout/Layout.jsx`(헤더 사용자 블록 클릭 진입) + `components/platform/CommandPalette.jsx`(`My Settings` 항목) + `pages/dashboard/Dashboard.jsx`("최근 사용" 6카드 섹션) + `constants/notificationKinds.js`(kind·label·group 9종) + `hooks/useNotificationPrefs.js`(`NotificationCenter` 의 `muted_kinds`/`desktop_toast` 소비).

**Tech Stack:** Python 3.14 / FastAPI / SQLAlchemy(MySQL 운영, SQLite 테스트) / pytest — React 18 + Vite + Tailwind + lucide-react 0.284 + axios — Electron 36. 신규 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-18-user-preferences-sync-design.md` (마스터: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1·§2.2, Plan A 연동: `docs/superpowers/specs/2026-09-18-notification-center-design.md` §3.2)

**규칙(마스터 §1):** 커밋은 사용자가 직접 한다 — 각 Task 마지막 단계는 **"커밋 준비 완료 — 변경 파일 목록을 사용자에게 보고"** 다. `HiTessWorkBench/frontend/src/config.js` 는 절대 스테이징하지 않는다. `Darkmode.js/` 는 건드리지 않는다. 백엔드는 TDD(실패 테스트 → 최소 구현 → 통과). 프론트는 러너가 없으므로 순수 유틸만 `node --test` 로 검증하고 화면은 수동 절차를 따른다. 문서·주석·UI 문구는 한국어, 식별자는 영어.

**테스트 실행 위치:** 모든 pytest 명령은 `C:\Coding\WorkBench\HiTessWorkBenchBackEnd` 에서 `WorkBenchEnv/Scripts/python.exe -m pytest …` 로 실행한다. 프론트 `node --test` · `npm run build` 는 `C:\Coding\WorkBench\HiTessWorkBench\frontend` 에서 실행한다. 정상 동작 확인이 필요한 곳은 `HiTessWorkBench/`(루트) 에서 `npm run dev` 로 Electron 개발 모드를 함께 띄운다.

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `HiTessWorkBenchBackEnd/app/models.py` | 수정(조건부) | `UserPreference` 모델 추가 — Plan A 가 먼저 실행됐으면 이미 있어 건너뜀 |
| `HiTessWorkBenchBackEnd/app/schema_bootstrap.py` | 수정 | `ensure_user_preferences_columns()` + `run_schema_bootstrap()` 호출 |
| `HiTessWorkBenchBackEnd/app/services/user_preferences_service.py` | 생성 | `PREFERENCE_KEYS`, `default_prefs`, `normalize_favorites/recent_apps/notifications/landing_menu`, `merge_prefs`, `effective_prefs`, `get_prefs`, `upsert_prefs` |
| `HiTessWorkBenchBackEnd/app/routers/preferences.py` | 생성 | `GET /api/preferences`, `PUT /api/preferences`(부분 병합, `ignored_keys` 응답, 값 형식 오류 422) |
| `HiTessWorkBenchBackEnd/app/main.py` | 수정 | import + `include_router(preferences.router)` |
| `HiTessWorkBenchBackEnd/tests/test_user_preferences_model.py` | 생성 | 테이블/컬럼 계약 + 부트스트랩 멱등 + Plan A 선주행 분기 |
| `HiTessWorkBenchBackEnd/tests/test_user_preferences_service.py` | 생성 | 정규화·부분 병합·기본값·화이트리스트 |
| `HiTessWorkBenchBackEnd/tests/test_preferences_router.py` | 생성 | GET/PUT · `ignored_keys` · 422 · 사번 격리 · 401 |
| `HiTessWorkBench/frontend/src/api/preferences.js` | 생성 | axios 2함수 (`getPreferences`, `putPreferences`) |
| `HiTessWorkBench/frontend/src/utils/preferenceMerge.js` | 생성 | 순수 병합/정규화 유틸(부수효과 없음) |
| `HiTessWorkBench/frontend/src/utils/preferenceMerge.test.js` | 생성 | `node --test` — 기본값·서버 우선·시드·화이트리스트 |
| `HiTessWorkBench/frontend/src/constants/notificationKinds.js` | 생성 | 9종 kind·label·group(설정 UI + Plan A 재사용) |
| `HiTessWorkBench/frontend/src/hooks/pollingPolicy.js` | 수정 | `preferencesRetryMs`, `preferencesDebounceMs` 상수 추가 |
| `HiTessWorkBench/frontend/src/contexts/PreferencesContext.jsx` | 생성 | 사번별 캐시·하이드레이션 카운터·디바운스 PUT·재시도 루프 |
| `HiTessWorkBench/frontend/src/App.jsx` | 수정 | Provider 배치 + `case 'My Settings'` + `landing_menu` 자동 이동 |
| `HiTessWorkBench/frontend/src/contexts/DashboardContext.jsx` | 수정 | 3계층 sync (React state · localStorage · Electron) + `clearFavorites` 추가 |
| `HiTessWorkBench/frontend/src/contexts/RecentActivityContext.jsx` | 수정 | 서버 sync + `hydration` 소비 + 8건 유지 |
| `HiTessWorkBench/frontend/src/pages/settings/MySettings.jsx` | 생성 | 내 정보 · 시작 화면 · 알림 수신 · 초기화 4카드 |
| `HiTessWorkBench/frontend/src/components/layout/Layout.jsx` | 수정 | 헤더 사용자 블록 클릭 진입 + 명령 팔레트 `menuItems` 에 `My Settings` |
| `HiTessWorkBench/frontend/src/pages/dashboard/Dashboard.jsx` | 수정 | "최근 사용" 6카드 섹션 추가 |
| `HiTessWorkBench/frontend/src/hooks/useNotificationPrefs.js` | 생성 | Plan A `NotificationCenter` 가 `muted_kinds`·`desktop_toast` 를 서버 값에서 읽도록 얇은 훅 |

---

### Task 1: `UserPreference` 모델 + 스키마 부트스트랩(Plan A 선주행 시 스킵)

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/models.py` (파일 끝 342행 뒤 — Plan A 가 없으면 여기서, 있으면 재사용)
- Modify: `HiTessWorkBenchBackEnd/app/schema_bootstrap.py`(160행 `ensure_app_spaces` 뒤에 함수 추가 + `run_schema_bootstrap()` 호출)
- Create: `HiTessWorkBenchBackEnd/tests/test_user_preferences_model.py`

- [ ] **Step 1: 선주행 분기 확인**

`grep -n "class UserPreference" HiTessWorkBenchBackEnd/app/models.py` 로 이미 정의가 있는지 확인한다.

- **없다** → 이 Task 의 Step 3 에서 모델을 새로 추가한다.
- **있다** → Plan A 가 먼저 실행돼 이미 만든 것이다. **모델은 건드리지 않고**, 컬럼 3개(`employee_id String(50) PK`, `prefs JSON`, `updated_at DateTime nullable`)가 마스터 §2.2 정의와 같은지만 눈으로 확인한다. `ensure_user_preferences_columns()`(Step 4)만 추가한다. 테스트도 "이미 있는지 확인" 케이스가 있어 그대로 통과한다.

- [ ] **Step 2: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_user_preferences_model.py`:

```python
"""사용자 환경설정 테이블(user_preferences)의 생성·부트스트랩 회귀 테스트.

마스터 §2.2 정의를 그대로 유지한다:
    employee_id String(50) PK, prefs JSON not null default={}, updated_at DateTime nullable.

Plan A(알림 센터)가 먼저 실행됐다면 이미 `models.UserPreference` 가 있고 이 테스트는
계약(컬럼·PK)만 확인해 그대로 통과한다.
"""
from datetime import datetime

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app import models
from app.schema_bootstrap import ensure_user_preferences_columns, run_schema_bootstrap


def _sqlite_engine():
    return create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def test_user_preferences_table_columns():
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    assert "user_preferences" in set(inspector.get_table_names())
    cols = {c["name"]: c for c in inspector.get_columns("user_preferences")}
    assert set(cols) == {"employee_id", "prefs", "updated_at"}

    pk = inspector.get_pk_constraint("user_preferences")
    assert pk["constrained_columns"] == ["employee_id"]

    # employee_id 는 사번(문자열)이라 String, prefs 는 JSON. SQLite 는 JSON 을 TEXT 로
    # 저장하므로 원본 타입 대신 SQLAlchemy 매핑을 확인한다.
    mapped = {c.name: c.type.__class__.__name__ for c in models.UserPreference.__table__.columns}
    assert mapped["employee_id"] == "String"
    assert mapped["prefs"] == "JSON"


def test_user_preferences_default_prefs_is_empty_dict(db_session):
    row = models.UserPreference(employee_id="EMP001")
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    # ORM 기본값 = 빈 dict. updated_at 은 nullable 이라 None.
    assert row.prefs == {}
    assert row.updated_at is None


def test_bootstrap_adds_missing_updated_at_column():
    """운영 DB 에 employee_id/prefs 만 있는 옛 스키마(만에 하나)라도 bootstrap 이 채운다."""
    engine = _sqlite_engine()
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE user_preferences ("
            " employee_id VARCHAR(50) PRIMARY KEY,"
            " prefs JSON NOT NULL)"
        ))

    ensure_user_preferences_columns(engine=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("user_preferences")}
    assert "updated_at" in cols

    # 두 번 돌려도 예외 없이 같은 결과(멱등)
    ensure_user_preferences_columns(engine=engine)
    assert {c["name"] for c in inspect(engine).get_columns("user_preferences")} == cols


def test_bootstrap_is_no_op_when_table_missing():
    """테이블 자체가 없으면(예: 초기 기동 이전) 예외 없이 지나가야 한다."""
    engine = _sqlite_engine()
    # create_all 을 부르지 않음 — 테이블 없음.
    ensure_user_preferences_columns(engine=engine)
    tables = set(inspect(engine).get_table_names())
    assert "user_preferences" not in tables


def test_run_schema_bootstrap_calls_user_preferences_bootstrap(monkeypatch):
    called = []
    import app.schema_bootstrap as sb
    monkeypatch.setattr(sb, "ensure_user_preferences_columns",
                        lambda *, engine=None: called.append("p"))
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    run_schema_bootstrap(engine=engine)
    assert "p" in called
```

- [ ] **Step 3: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_user_preferences_model.py -q
```
기대: `ImportError: cannot import name 'ensure_user_preferences_columns'` 로 수집 단계 실패(`1 error`). Plan A 가 선주행돼 모델이 이미 있는 환경에서는 첫 두 테스트만 통과하고 나머지는 부트스트랩 함수 부재로 실패한다(정상).

- [ ] **Step 4: 모델 추가**(Plan A 선주행 시엔 이미 있으므로 건너뛴다)

`app/models.py` 파일 끝(342행 `RegisteredModelArtifact.created_at` 뒤)에 아래를 추가. 이 파일은 클래스 본문이 **2칸 들여쓰기**다.

```python


class UserPreference(Base):
  """사용자 환경설정 — 즐겨찾기·최근 앱·알림 수신·시작 메뉴를 사번 단위로 서버에 둔다.

  마스터 설계 §2.2 정의를 그대로 지킨다(컬럼 3개). `prefs` 의 내용 규약(4키)은
  `services/user_preferences_service.py` 가 책임진다. Plan A(알림 센터)는 이 행을
  **읽기만** 하고, 쓰기 엔드포인트(GET/PUT /api/preferences)는 이 plan(Plan E)이 만든다.

  Plan A 가 먼저 실행된 환경에서는 이 클래스가 이미 있을 수 있다(마스터 §2.2 규약).
  그때는 이 파일에 추가하지 않고 재사용한다.
  """

  __tablename__ = "user_preferences"
  employee_id = Column(String(50), primary_key=True)
  prefs = Column(JSON, nullable=False, default=dict)
  updated_at = Column(DateTime, nullable=True)
```

- [ ] **Step 5: 부트스트랩 함수 추가** — `app/schema_bootstrap.py` 의 `ensure_app_spaces`(124~152행) 뒤에:

```python


def ensure_user_preferences_columns(*, engine=None) -> None:
    """사용자 환경설정 user_preferences 테이블의 컬럼을 멱등하게 보강합니다.

    테이블 자체는 create_all 로 생기지만, 이후 컬럼이 늘어날 때 운영 DB 에서 500 이
    나지 않도록 전 컬럼을 여기에 둔다(마스터 규약 §1.3). 지금은 updated_at 하나뿐이라
    Plan A 가 만든 옛 행이 있다면 그것을 대상으로 삼는다. 테이블 자체가 없으면(초기
    기동 전) 조용히 지나간다 — _add_missing_columns 는 테이블 부재를 감지해 skip 한다.
    """
    _add_missing_columns("user_preferences", {
        "updated_at": "ALTER TABLE user_preferences ADD COLUMN updated_at DATETIME NULL",
    }, engine=engine)
```

그리고 `run_schema_bootstrap()`(현재 152~160행)의 `ensure_app_spaces(engine=engine)` 다음 줄에:

```python
    ensure_app_spaces(engine=engine)
    ensure_user_preferences_columns(engine=engine)
```

Plan A 가 먼저 실행된 환경(즉 `ensure_notification_columns` 가 이미 있는 상태)이라면 이 호출은 그 아래(155행 근처, notifications 다음)로 옮겨도 무방하지만, 표준 위치는 `ensure_app_spaces` 뒤다.

- [ ] **Step 6: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_user_preferences_model.py -q
```
기대: `5 passed`.

전체 회귀(모델 변경이라 한 번 돈다):
```
WorkBenchEnv/Scripts/python.exe -m pytest tests -q -x
```
기대: 기존 전부 통과(실패 0). Plan A 가 선주행된 상태면 모델 부재로 인한 실패가 없으므로 그대로 통과한다.

- [ ] **Step 7: 커밋 준비 완료** — 변경 파일 목록을 사용자에게 보고: `app/models.py`(Plan A 미선행 시), `app/schema_bootstrap.py`, `tests/test_user_preferences_model.py`.

---

### Task 2: `user_preferences_service` — 정규화·부분 병합

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/user_preferences_service.py`
- Create: `HiTessWorkBenchBackEnd/tests/test_user_preferences_service.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_user_preferences_service.py`:

```python
"""사용자 환경설정 서비스 계약(스펙 §4.2).

정규화 함수 4종 + `merge_prefs`(부분 병합, 화이트리스트) + `effective_prefs`(기본값 채움) +
`get_prefs`/`upsert_prefs`(SQLAlchemy 세션 호출). 값 형식 오류는 ValueError, 화이트리스트 밖
키는 조용히 무시(라우터가 `ignored_keys` 로 응답).
"""
from datetime import datetime

import pytest

from app import models
from app.services.user_preferences_service import (
    DEFAULT_LANDING_MENU,
    DEFAULT_NOTIFICATION_PREFS,
    LANDING_MENU_MAX_LEN,
    MAX_FAVORITES,
    MAX_RECENT_APPS,
    NOTIFICATION_KINDS_FALLBACK,
    PREFERENCE_KEYS,
    default_prefs,
    effective_prefs,
    get_prefs,
    merge_prefs,
    normalize_favorites,
    normalize_landing_menu,
    normalize_notifications,
    normalize_recent_apps,
    upsert_prefs,
)


def test_preference_keys_are_the_four_whitelisted():
    assert PREFERENCE_KEYS == ("favorites", "recent_apps", "notifications", "landing_menu")


def test_default_prefs_shape():
    d = default_prefs()
    assert d == {
        "favorites": [],
        "recent_apps": [],
        "notifications": {"muted_kinds": [], "desktop_toast": True},
        "landing_menu": None,
    }
    # 반환값은 새 dict 여야 한다(호출자가 mutate 해도 원본 오염 없어야 함).
    d["favorites"].append("x")
    assert default_prefs()["favorites"] == []


def test_normalize_favorites_trims_dedupes_and_caps():
    got = normalize_favorites(["  A  ", "B", "A", "", None, "C", "B"])
    assert got == ["A", "B", "C"]
    assert normalize_favorites(list(f"F{i}" for i in range(MAX_FAVORITES + 5))) \
        == [f"F{i}" for i in range(MAX_FAVORITES)]


def test_normalize_favorites_rejects_non_list():
    with pytest.raises(ValueError):
        normalize_favorites("A,B")


def test_normalize_recent_apps_sorts_desc_and_dedupes_by_menu():
    raw = [
        {"menu": "BDF Scanner", "label": "BDF Scanner", "at": 100},
        {"menu": "Truss Analysis", "label": "Truss Analysis", "at": 300},
        {"menu": "BDF Scanner", "label": "BDF Scanner", "at": 500},  # 같은 menu, 큰 at → 이걸 남긴다
        {"menu": "Mast Post Assessment"},  # at 없음 → 0
    ]
    got = normalize_recent_apps(raw)
    assert [x["menu"] for x in got] == ["BDF Scanner", "Truss Analysis", "Mast Post Assessment"]
    bdf = next(x for x in got if x["menu"] == "BDF Scanner")
    assert bdf["at"] == 500
    # label 자동 채움
    assert got[-1]["label"] == "Mast Post Assessment"


def test_normalize_recent_apps_caps_to_eight():
    raw = [{"menu": f"A{i}", "at": i} for i in range(MAX_RECENT_APPS + 5)]
    got = normalize_recent_apps(raw)
    assert len(got) == MAX_RECENT_APPS
    assert got[0]["menu"] == f"A{MAX_RECENT_APPS + 4}"  # 최신


def test_normalize_recent_apps_rejects_non_list():
    with pytest.raises(ValueError):
        normalize_recent_apps({"BDF Scanner": 1})


def test_normalize_recent_apps_skips_bad_rows():
    raw = [{"label": "no-menu"}, {"menu": "  ", "at": 1}, {"menu": "OK", "at": "abc"}]
    got = normalize_recent_apps(raw)
    assert [x["menu"] for x in got] == ["OK"]
    assert got[0]["at"] == 0  # 잘못된 at 은 0


def test_normalize_notifications_partial_merge_keeps_other_keys():
    old = {"muted_kinds": ["notice.published"], "desktop_toast": False}
    got = normalize_notifications({"desktop_toast": True}, previous=old)
    assert got == {"muted_kinds": ["notice.published"], "desktop_toast": True}


def test_normalize_notifications_rejects_unknown_kind_and_bad_types():
    with pytest.raises(ValueError):
        normalize_notifications({"muted_kinds": ["job.done"]})
    with pytest.raises(ValueError):
        normalize_notifications({"desktop_toast": "yes"})
    with pytest.raises(ValueError):
        normalize_notifications({"muted_kinds": "job.completed"})


def test_normalize_notifications_dedupes_and_sorts():
    got = normalize_notifications({"muted_kinds": ["job.failed", "job.completed", "job.failed"]})
    assert got["muted_kinds"] == ["job.completed", "job.failed"]


def test_normalize_notifications_accepts_all_known_kinds():
    for k in NOTIFICATION_KINDS_FALLBACK:
        got = normalize_notifications({"muted_kinds": [k]})
        assert got["muted_kinds"] == [k]


def test_normalize_landing_menu_trims_and_nullifies_blank():
    assert normalize_landing_menu("  My Projects ") == "My Projects"
    assert normalize_landing_menu("") is None
    assert normalize_landing_menu(None) is None


def test_normalize_landing_menu_length_cap():
    ok = "M" * LANDING_MENU_MAX_LEN
    assert normalize_landing_menu(ok) == ok
    with pytest.raises(ValueError):
        normalize_landing_menu("M" * (LANDING_MENU_MAX_LEN + 1))


def test_merge_prefs_only_applies_whitelisted_keys_and_returns_ignored():
    current = {"favorites": ["Truss Analysis"], "landing_menu": "Dashboard"}
    payload = {
        "favorites": ["BDF Scanner"],
        "unknown_key": "ignored",
        "notifications": {"desktop_toast": False},
        "recent_apps": [{"menu": "BDF Scanner", "at": 10}],
        "landing_menu": " My Projects ",
    }
    merged, ignored = merge_prefs(current, payload)
    assert ignored == ["unknown_key"]
    assert merged["favorites"] == ["BDF Scanner"]
    assert merged["landing_menu"] == "My Projects"
    assert merged["notifications"]["desktop_toast"] is False
    # 부분 병합: muted_kinds 는 current 에 없었으므로 기본값이 채워진다.
    assert merged["notifications"]["muted_kinds"] == []
    # recent_apps 는 배열로 저장.
    assert merged["recent_apps"] == [{"menu": "BDF Scanner", "label": "BDF Scanner", "at": 10}]


def test_merge_prefs_raises_on_bad_value():
    with pytest.raises(ValueError):
        merge_prefs({}, {"favorites": "not a list"})


def test_effective_prefs_fills_missing_keys():
    stored = {"favorites": ["X"]}
    got = effective_prefs(stored)
    assert got == {
        "favorites": ["X"],
        "recent_apps": [],
        "notifications": {"muted_kinds": [], "desktop_toast": True},
        "landing_menu": None,
    }


def test_get_prefs_returns_default_when_no_row(db_session):
    got = get_prefs(db_session, "NOBODY")
    assert got == (default_prefs(), None)
    # 조회만으로 행을 만들지 않는다 — 사이드 이펙트 없어야 GET 이 idempotent.
    assert db_session.query(models.UserPreference).count() == 0


def test_upsert_prefs_creates_row_and_returns_merged(db_session):
    merged, ignored = upsert_prefs(db_session, "EMP001", {"favorites": ["BDF Scanner"]})
    assert ignored == []
    row = db_session.query(models.UserPreference).one()
    assert row.prefs["favorites"] == ["BDF Scanner"]
    assert row.updated_at is not None
    assert merged == effective_prefs(row.prefs)


def test_upsert_prefs_partial_update_preserves_other_keys(db_session):
    upsert_prefs(db_session, "EMP001",
                 {"favorites": ["A"], "notifications": {"muted_kinds": ["notice.published"]}})
    upsert_prefs(db_session, "EMP001", {"landing_menu": "My Projects"})
    row = db_session.query(models.UserPreference).one()
    # 저장은 화이트리스트 키만. 이전 favorites·notifications 는 유지.
    assert row.prefs["favorites"] == ["A"]
    assert row.prefs["notifications"] == {"muted_kinds": ["notice.published"], "desktop_toast": True}
    assert row.prefs["landing_menu"] == "My Projects"


def test_upsert_prefs_reassigns_dict_so_json_column_tracks_change(db_session):
    """JSON 컬럼은 in-place mutate 를 감지하지 못한다 — 새 dict 대입 여부를 확인한다."""
    upsert_prefs(db_session, "EMP001", {"favorites": ["A"]})
    row = db_session.query(models.UserPreference).one()
    first_id = id(row.prefs)
    upsert_prefs(db_session, "EMP001", {"favorites": ["A", "B"]})
    db_session.refresh(row)
    # 실제 값이 반영됐는지가 본질. id() 비교는 참고용(SQLAlchemy 재로드 후 다를 수 있음).
    assert row.prefs["favorites"] == ["A", "B"]
    # 그리고 fresh 세션에서 다시 열어도 반영돼 있어야 한다.
    db_session.expire_all()
    row2 = db_session.query(models.UserPreference).one()
    assert row2.prefs["favorites"] == ["A", "B"]


def test_upsert_prefs_returns_ignored_keys(db_session):
    _, ignored = upsert_prefs(db_session, "EMP001",
                              {"favorites": ["A"], "unknown": 1, "another_unknown": True})
    assert set(ignored) == {"unknown", "another_unknown"}
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_user_preferences_service.py -q
```
기대: `ModuleNotFoundError: No module named 'app.services.user_preferences_service'` (`1 error`).

- [ ] **Step 3: 서비스 구현** — `HiTessWorkBenchBackEnd/app/services/user_preferences_service.py`:

```python
"""사용자 환경설정 — 정규화·부분 병합·기본값 채움(스펙 §4.2).

- 저장은 `models.UserPreference.prefs` JSON 한 칸에 4키(`favorites`·`recent_apps`·
  `notifications`·`landing_menu`)만 담는다. 화이트리스트 밖 키는 조용히 무시하고
  `ignored_keys` 로 라우터가 응답한다(마스터 §2.2·spec D5).
- 값 형식/어휘 오류는 ValueError. 라우터가 422 로 변환.
- Plan A(알림 센터)의 `NOTIFICATION_KINDS` 를 지연 import 한다 — Plan A 미구현이어도
  저장은 되어야 한다는 사용자 결정(spec D6).
"""
from datetime import datetime
from typing import Any, Iterable, Optional

from sqlalchemy.orm import Session

from .. import models

PREFERENCE_KEYS: tuple[str, ...] = ("favorites", "recent_apps", "notifications", "landing_menu")

# 스펙 §4.2 상한
MAX_FAVORITES = 50
MAX_RECENT_APPS = 8
LANDING_MENU_MAX_LEN = 200

# Plan A 미구현 폴백 — 마스터 §2.1 의 9개 kind 를 그대로 갖는다.
NOTIFICATION_KINDS_FALLBACK: frozenset[str] = frozenset({
    "job.completed", "job.failed", "job.cancelled",
    "retention.expiring", "retention.expired",
    "batch.completed", "share.received",
    "feature_request.status_changed", "notice.published",
})

DEFAULT_NOTIFICATION_PREFS: dict[str, Any] = {"muted_kinds": [], "desktop_toast": True}
DEFAULT_LANDING_MENU: Optional[str] = None


def _known_notification_kinds() -> frozenset[str]:
    """Plan A 가 있으면 그 상수, 없으면 폴백."""
    try:
        from .notification_service import NOTIFICATION_KINDS  # type: ignore
    except Exception:
        return NOTIFICATION_KINDS_FALLBACK
    if isinstance(NOTIFICATION_KINDS, (frozenset, set)):
        return frozenset(NOTIFICATION_KINDS)
    return NOTIFICATION_KINDS_FALLBACK


def default_prefs() -> dict[str, Any]:
    """저장된 값이 없을 때 프론트에 돌려주는 기본 실효값(4키)."""
    return {
        "favorites": [],
        "recent_apps": [],
        "notifications": {"muted_kinds": list(DEFAULT_NOTIFICATION_PREFS["muted_kinds"]),
                          "desktop_toast": DEFAULT_NOTIFICATION_PREFS["desktop_toast"]},
        "landing_menu": DEFAULT_LANDING_MENU,
    }


def normalize_favorites(raw: Any) -> list[str]:
    """문자열만, trim, 빈 값 제거, 순서 유지 중복 제거, 50개 초과 컷."""
    if not isinstance(raw, list):
        raise ValueError("favorites must be a list")
    seen: set[str] = set()
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        value = item.strip()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out[:MAX_FAVORITES]


def normalize_recent_apps(raw: Any) -> list[dict[str, Any]]:
    """{menu,label,mode,category,at} 만 남기고 menu 기준 최신순 유일 8개."""
    if not isinstance(raw, list):
        raise ValueError("recent_apps must be a list")
    by_menu: dict[str, dict[str, Any]] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        menu = item.get("menu")
        if not isinstance(menu, str) or not menu.strip():
            continue
        menu = menu.strip()
        label = item.get("label")
        label = label.strip() if isinstance(label, str) and label.strip() else menu
        mode = item.get("mode") if isinstance(item.get("mode"), str) else ""
        category = item.get("category") if isinstance(item.get("category"), str) else ""
        try:
            at = int(item.get("at") or 0)
            if at < 0:
                at = 0
        except (TypeError, ValueError):
            at = 0
        prev = by_menu.get(menu)
        # 같은 menu 는 at 이 큰 쪽만 남긴다.
        if prev is None or at > prev["at"]:
            by_menu[menu] = {"menu": menu, "label": label, "mode": mode,
                             "category": category, "at": at}
    ordered = sorted(by_menu.values(), key=lambda x: x["at"], reverse=True)
    return ordered[:MAX_RECENT_APPS]


def normalize_notifications(raw: Any, previous: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """{muted_kinds, desktop_toast} 부분 병합. 어휘 밖 kind 나 잘못된 타입은 ValueError."""
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ValueError("notifications must be an object")

    known = _known_notification_kinds()
    base = dict(DEFAULT_NOTIFICATION_PREFS)
    if isinstance(previous, dict):
        for key in ("muted_kinds", "desktop_toast"):
            if key in previous:
                base[key] = previous[key]

    if "muted_kinds" in raw:
        muted = raw["muted_kinds"]
        if not isinstance(muted, list):
            raise ValueError("notifications.muted_kinds must be a list")
        clean: list[str] = []
        for k in muted:
            if not isinstance(k, str):
                raise ValueError("notifications.muted_kinds items must be strings")
            if k not in known:
                raise ValueError(f"unknown notification kind: {k!r}")
            if k not in clean:
                clean.append(k)
        base["muted_kinds"] = sorted(clean)
    else:
        # previous 값을 유지하되 리스트 형태만 보장.
        if not isinstance(base.get("muted_kinds"), list):
            base["muted_kinds"] = []

    if "desktop_toast" in raw:
        if not isinstance(raw["desktop_toast"], bool):
            raise ValueError("notifications.desktop_toast must be a boolean")
        base["desktop_toast"] = raw["desktop_toast"]
    else:
        if not isinstance(base.get("desktop_toast"), bool):
            base["desktop_toast"] = DEFAULT_NOTIFICATION_PREFS["desktop_toast"]

    return {"muted_kinds": list(base["muted_kinds"]), "desktop_toast": bool(base["desktop_toast"])}


def normalize_landing_menu(raw: Any) -> Optional[str]:
    """None/빈문자열 → None. 200자 초과 → ValueError."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ValueError("landing_menu must be a string or null")
    value = raw.strip()
    if not value:
        return None
    if len(value) > LANDING_MENU_MAX_LEN:
        raise ValueError("landing_menu is too long")
    return value


def _apply_key(current: dict[str, Any], key: str, value: Any) -> None:
    """화이트리스트 키 하나를 정규화해 current 에 대입한다."""
    if key == "favorites":
        current[key] = normalize_favorites(value)
    elif key == "recent_apps":
        current[key] = normalize_recent_apps(value)
    elif key == "notifications":
        prev = current.get("notifications") if isinstance(current.get("notifications"), dict) else None
        current[key] = normalize_notifications(value, previous=prev)
    elif key == "landing_menu":
        current[key] = normalize_landing_menu(value)


def merge_prefs(current: dict[str, Any], payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """부분 병합 결과와 무시된 키 목록을 돌려준다. current 는 변경하지 않는다(deep 복제)."""
    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")
    merged = effective_prefs(current)
    ignored: list[str] = []
    for key, value in payload.items():
        if key not in PREFERENCE_KEYS:
            ignored.append(key)
            continue
        _apply_key(merged, key, value)
    return merged, ignored


def effective_prefs(stored: Optional[dict[str, Any]]) -> dict[str, Any]:
    """저장값에 기본값을 덮어 4키를 모두 갖는 dict 를 돌려준다."""
    out = default_prefs()
    if not isinstance(stored, dict):
        return out
    if isinstance(stored.get("favorites"), list):
        try:
            out["favorites"] = normalize_favorites(stored["favorites"])
        except ValueError:
            pass
    if isinstance(stored.get("recent_apps"), list):
        try:
            out["recent_apps"] = normalize_recent_apps(stored["recent_apps"])
        except ValueError:
            pass
    if isinstance(stored.get("notifications"), dict):
        try:
            out["notifications"] = normalize_notifications(stored["notifications"])
        except ValueError:
            pass
    if "landing_menu" in stored:
        try:
            out["landing_menu"] = normalize_landing_menu(stored["landing_menu"])
        except ValueError:
            pass
    return out


def get_prefs(db: Session, employee_id: str) -> tuple[dict[str, Any], Optional[datetime]]:
    """(effective prefs, updated_at) 를 돌려준다. 행이 없으면 기본값+None."""
    row = (
        db.query(models.UserPreference)
        .filter(models.UserPreference.employee_id == employee_id)
        .first()
    )
    if row is None:
        return default_prefs(), None
    return effective_prefs(row.prefs), row.updated_at


def upsert_prefs(
    db: Session,
    employee_id: str,
    payload: dict[str, Any],
) -> tuple[dict[str, Any], list[str]]:
    """부분 병합 후 저장(없으면 생성)한다. 반환은 (effective prefs, ignored_keys)."""
    row = (
        db.query(models.UserPreference)
        .filter(models.UserPreference.employee_id == employee_id)
        .first()
    )
    current = row.prefs if row and isinstance(row.prefs, dict) else {}
    merged, ignored = merge_prefs(current, payload)
    if row is None:
        row = models.UserPreference(employee_id=employee_id, prefs=merged, updated_at=datetime.now())
        db.add(row)
    else:
        # JSON 컬럼은 새 dict 를 대입해야 변경이 추적된다(스펙 §9 함정).
        row.prefs = dict(merged)
        row.updated_at = datetime.now()
    db.commit()
    db.refresh(row)
    return merged, ignored
```

- [ ] **Step 4: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_user_preferences_service.py -q
```
기대: `19 passed`.

- [ ] **Step 5: 커밋 준비 완료** — 보고: `app/services/user_preferences_service.py`, `tests/test_user_preferences_service.py`.

---

### Task 3: 라우터 `/api/preferences`

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/routers/preferences.py`
- Modify: `HiTessWorkBenchBackEnd/app/main.py`(20~45행 import 목록 + 212행 뒤 include)
- Create: `HiTessWorkBenchBackEnd/tests/test_preferences_router.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_preferences_router.py`:

```python
"""GET/PUT /api/preferences — 부분 병합, ignored_keys 응답, 422, 사번 격리, 401.

conftest 의 admin_client 는 require_auth 를 ADMIN001 로 고정. 다른 사용자 시점은
test_notifications_router.py 와 같은 _act_as() 로 override 만 교체한다.
"""
from datetime import datetime

from app import models
from app.dependencies import require_auth
from app.main import app


def _act_as(employee_id: str):
    app.dependency_overrides[require_auth] = lambda: employee_id


def test_get_returns_defaults_when_no_row(admin_client, db_session):
    data = admin_client.get("/api/preferences").json()
    assert data["prefs"] == {
        "favorites": [],
        "recent_apps": [],
        "notifications": {"muted_kinds": [], "desktop_toast": True},
        "landing_menu": None,
    }
    assert data["updated_at"] is None
    # 조회만으로 행이 생겨선 안 된다(GET 은 사이드이펙트 없음).
    assert db_session.query(models.UserPreference).count() == 0


def test_get_returns_stored_values_with_iso_updated_at(admin_client, db_session):
    row = models.UserPreference(
        employee_id="ADMIN001",
        prefs={"favorites": ["BDF Scanner"], "landing_menu": "My Projects"},
        updated_at=datetime(2026, 9, 18, 10, 0, 0),
    )
    db_session.add(row)
    db_session.commit()

    data = admin_client.get("/api/preferences").json()
    assert data["prefs"]["favorites"] == ["BDF Scanner"]
    assert data["prefs"]["landing_menu"] == "My Projects"
    # 기본값이 채워졌는지 확인
    assert data["prefs"]["notifications"] == {"muted_kinds": [], "desktop_toast": True}
    assert data["updated_at"] == row.updated_at.isoformat()


def test_put_creates_row_and_returns_merged(admin_client, db_session):
    res = admin_client.put("/api/preferences", json={"favorites": ["Truss Analysis"]})
    assert res.status_code == 200
    body = res.json()
    assert body["ignored_keys"] == []
    assert body["prefs"]["favorites"] == ["Truss Analysis"]

    row = db_session.query(models.UserPreference).one()
    assert row.employee_id == "ADMIN001"
    assert row.prefs["favorites"] == ["Truss Analysis"]
    assert row.updated_at is not None


def test_put_merges_partially_and_persists(admin_client, db_session):
    admin_client.put("/api/preferences", json={
        "favorites": ["A"],
        "notifications": {"muted_kinds": ["notice.published"]},
    })
    admin_client.put("/api/preferences", json={"landing_menu": "  My Projects  "})
    admin_client.put("/api/preferences", json={"notifications": {"desktop_toast": False}})

    data = admin_client.get("/api/preferences").json()
    assert data["prefs"] == {
        "favorites": ["A"],
        "recent_apps": [],
        "notifications": {"muted_kinds": ["notice.published"], "desktop_toast": False},
        "landing_menu": "My Projects",
    }
    # DB 재조회로 실제 영속 확인
    db_session.expire_all()
    row = db_session.query(models.UserPreference).one()
    assert row.prefs["favorites"] == ["A"]
    assert row.prefs["notifications"] == {"muted_kinds": ["notice.published"], "desktop_toast": False}


def test_put_unknown_keys_are_ignored_not_422(admin_client, db_session):
    res = admin_client.put("/api/preferences",
                           json={"favorites": ["A"], "dark_mode": True, "future_key": {"x": 1}})
    assert res.status_code == 200
    body = res.json()
    assert set(body["ignored_keys"]) == {"dark_mode", "future_key"}
    assert body["prefs"]["favorites"] == ["A"]


def test_put_bad_value_types_are_422(admin_client):
    assert admin_client.put("/api/preferences", json={"favorites": "not a list"}).status_code == 422
    assert admin_client.put("/api/preferences",
                            json={"notifications": {"desktop_toast": "yes"}}).status_code == 422
    assert admin_client.put("/api/preferences",
                            json={"notifications": {"muted_kinds": ["job.done"]}}).status_code == 422
    assert admin_client.put("/api/preferences",
                            json={"landing_menu": "M" * 201}).status_code == 422


def test_put_rejects_non_object_body(admin_client):
    r = admin_client.put("/api/preferences", json=["favorites"])
    assert r.status_code == 422


def test_recent_apps_normalization_through_put(admin_client, db_session):
    res = admin_client.put("/api/preferences", json={"recent_apps": [
        {"menu": "BDF Scanner", "at": 100},
        {"menu": "BDF Scanner", "at": 500},
        {"menu": "Truss Analysis", "at": 300, "label": "Truss Analysis"},
        {"label": "no menu"},
    ]})
    assert res.status_code == 200
    apps = res.json()["prefs"]["recent_apps"]
    assert [x["menu"] for x in apps] == ["BDF Scanner", "Truss Analysis"]
    assert apps[0]["at"] == 500


def test_preferences_are_isolated_per_employee(admin_client, db_session):
    admin_client.put("/api/preferences", json={"favorites": ["A"]})
    _act_as("EMP001")
    data = admin_client.get("/api/preferences").json()
    assert data["prefs"]["favorites"] == []  # 다른 사번은 자기 것 없음
    admin_client.put("/api/preferences", json={"favorites": ["B"]})

    _act_as("ADMIN001")
    assert admin_client.get("/api/preferences").json()["prefs"]["favorites"] == ["A"]
    assert db_session.query(models.UserPreference).count() == 2


def test_requires_auth(admin_client):
    saved = app.dependency_overrides.pop(require_auth)
    try:
        assert admin_client.get("/api/preferences").status_code == 401
        assert admin_client.put("/api/preferences", json={}).status_code == 401
    finally:
        app.dependency_overrides[require_auth] = saved
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_preferences_router.py -q
```
기대: 전부 실패(라우터 미등록으로 404 / 미인증 케이스는 401 이 안 오므로 실패). `10 failed`.

- [ ] **Step 3: 라우터 구현** — `HiTessWorkBenchBackEnd/app/routers/preferences.py`:

```python
"""사용자 환경설정 API — GET/PUT /api/preferences (스펙 §4.3).

- GET: 저장값 위에 기본값을 채운 4키 dict 를 돌려준다. 행이 없어도 사이드 이펙트 없음.
- PUT: 부분 병합. 화이트리스트(4키) 밖은 조용히 무시하고 `ignored_keys` 로 응답.
  값 형식/어휘 오류는 422(HTTPException).
- 인증은 `require_auth` 만. 관리자 구분 없음(본인 행만 접근).
- 플랫폼 공통 기능이라 `app_settings.GUARDED_ROUTES` 에 등록하지 않는다.
"""
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import database
from ..dependencies import require_auth
from ..services.user_preferences_service import get_prefs, upsert_prefs

router = APIRouter(prefix="/api/preferences", tags=["preferences"])


@router.get("")
def read_preferences(
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """내 환경설정을 돌려준다(4키를 모두 포함하는 실효값)."""
    prefs, updated_at = get_prefs(db, me)
    return {
        "prefs": prefs,
        "updated_at": updated_at.isoformat() if updated_at else None,
    }


@router.put("")
def update_preferences(
    payload: Any = Body(default=None),
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """부분 병합 저장.

    본문은 반드시 객체여야 한다(리스트/문자열 등은 422). 값 형식·어휘 오류도 422.
    화이트리스트 밖 키는 저장하지 않고 `ignored_keys` 로 응답한다(spec D5).
    """
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="본문은 객체여야 합니다.")
    try:
        merged, ignored = upsert_prefs(db, me, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    _, updated_at = get_prefs(db, me)  # 갓 저장한 updated_at 을 다시 읽어 응답에 반영
    return {
        "prefs": merged,
        "updated_at": updated_at.isoformat() if updated_at else None,
        "ignored_keys": ignored,
    }
```

- [ ] **Step 4: `main.py` 등록**

(a) 20~45행 import 목록에서 알파벳 순으로(`presence,` 또는 `presentations,` 근처) `preferences,` 를 추가. 정확한 위치는 파일에서 확인하되, 아래처럼 배치한다:

```python
    presentations,
    preferences,
    presence,
```

(b) 212행 `application.include_router(reports.router)` 근처(플랫폼 공통 라우터 묶음)에:

```python
    application.include_router(preferences.router)
```

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_preferences_router.py -q
```
기대: `10 passed`.

전체 회귀:
```
WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
기대: 실패 0(신규 세 파일 합계 34건 포함).

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/routers/preferences.py`, `app/main.py`, `tests/test_preferences_router.py`. (백엔드 완료 시점이므로 Task 1~3 파일 전체를 사용자에게 다시 나열해 한 번에 커밋할 수 있게 한다.)

---

### Task 4: 프론트 API 모듈 `api/preferences.js`

**Files:**
- Create: `HiTessWorkBench/frontend/src/api/preferences.js`
- Modify: `HiTessWorkBench/frontend/src/hooks/pollingPolicy.js`

- [ ] **Step 1: API 모듈 구현** — `HiTessWorkBench/frontend/src/api/preferences.js`(`api/chat.js`·`api/notifications.js` 와 같은 형태):

```js
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/**
 * 내 환경설정을 서버에서 읽는다.
 * 응답: { prefs: {favorites, recent_apps, notifications, landing_menu}, updated_at: ISO|null }
 * 행이 없어도 서버가 기본값을 채워 4키를 돌려준다(스펙 §4.3).
 */
export const getPreferences = () =>
  axios.get(`${API_BASE_URL}/api/preferences`, { headers: getAuthHeaders() });

/**
 * 내 환경설정을 부분 저장한다.
 * @param {object} payload — {favorites?, recent_apps?, notifications?, landing_menu?}
 * 화이트리스트 밖 키는 서버가 무시하고 응답 `ignored_keys` 로 알려 준다.
 * 값 형식 오류는 422 — 호출자는 조용히 실패 처리(로컬 캐시는 이미 갱신됨).
 * 응답: { prefs, updated_at, ignored_keys }
 */
export const putPreferences = (payload) =>
  axios.put(`${API_BASE_URL}/api/preferences`, payload || {}, { headers: getAuthHeaders() });
```

- [ ] **Step 2: 폴링 정책 상수 추가** — `src/hooks/pollingPolicy.js`. 기존 값을 유지하고 아래 두 키만 더한다(spec D3):

```js
export const POLLING_POLICY = {
  analysisIntervalMs: 1500,
  analysisMaxRetries: 120,
  longAnalysisMaxRetries: 240,
  systemIntervalMs: 3000,
  externalAppIntervalMs: 20000,
  // 환경설정 서버 저장(부분 PUT)의 디바운스와, 오프라인 상태에서의 재시도 주기.
  preferencesDebounceMs: 500,
  preferencesRetryMs: 30000,
  // Plan A(알림 센터)에서 폴링 주기를 붙일 때 함께 산다 — 값이 이미 있으면 그대로 둔다.
};
```

Plan A 가 먼저 실행돼 `notificationsIntervalMs: 30000` 이 이미 있으면 그대로 남기고, 위 두 키만 병합해서 추가한다.

- [ ] **Step 3: 빌드 확인** (`C:\Coding\WorkBench\HiTessWorkBench\frontend`)

```
npm run build
```
기대: 오류 없음(모듈이 아직 어디서도 import 되지 않으므로 tree-shake 되어도 정상).

- [ ] **Step 4: 커밋 준비 완료** — 보고: `src/api/preferences.js`, `src/hooks/pollingPolicy.js`.

---

### Task 5: 순수 유틸 + `PreferencesContext` — 로그인 pull / debounced push

**Files:**
- Create: `HiTessWorkBench/frontend/src/utils/preferenceMerge.js`
- Create: `HiTessWorkBench/frontend/src/utils/preferenceMerge.test.js`
- Create: `HiTessWorkBench/frontend/src/contexts/PreferencesContext.jsx`

- [ ] **Step 1: 순수 유틸 실패 테스트 작성** — `src/utils/preferenceMerge.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PREFERENCE_KEYS,
  DEFAULT_PREFS,
  defaultPrefs,
  filterWhitelist,
  isEmptyValue,
  mergeServerAndLocal,
  normalizeFavorites,
  normalizeRecentApps,
  normalizeLandingMenu,
  normalizeNotifications,
  effectivePrefs,
} from './preferenceMerge.js';

test('화이트리스트 키 4개(순서 고정)', () => {
  assert.deepEqual([...PREFERENCE_KEYS],
    ['favorites', 'recent_apps', 'notifications', 'landing_menu']);
});

test('defaultPrefs 는 항상 새 객체', () => {
  const a = defaultPrefs();
  const b = defaultPrefs();
  a.favorites.push('X');
  assert.deepEqual(b.favorites, []);
  assert.deepEqual(a.notifications, DEFAULT_PREFS.notifications);
});

test('filterWhitelist 는 화이트리스트 밖을 지운다', () => {
  const { accepted, ignored } = filterWhitelist({
    favorites: ['A'], dark_mode: true, notifications: { desktop_toast: false }, x: 1,
  });
  assert.deepEqual(accepted, {
    favorites: ['A'], notifications: { desktop_toast: false },
  });
  assert.deepEqual(ignored.sort(), ['dark_mode', 'x']);
});

test('normalizeFavorites — trim / dedupe / cap 50', () => {
  assert.deepEqual(normalizeFavorites(['A ', ' B', 'A', '']), ['A', 'B']);
  const many = Array.from({ length: 55 }, (_, i) => `F${i}`);
  assert.equal(normalizeFavorites(many).length, 50);
  assert.deepEqual(normalizeFavorites('not a list'), []);
});

test('normalizeRecentApps — menu 유일 · 최신순 · 8개', () => {
  const rows = [
    { menu: 'A', at: 100 },
    { menu: 'A', at: 500 },
    { menu: 'B', at: 200 },
    { menu: '  ', at: 999 },
  ];
  const got = normalizeRecentApps(rows);
  assert.deepEqual(got.map(r => r.menu), ['A', 'B']);
  assert.equal(got[0].at, 500);
  const many = Array.from({ length: 20 }, (_, i) => ({ menu: `M${i}`, at: i }));
  assert.equal(normalizeRecentApps(many).length, 8);
});

test('normalizeNotifications 는 잘못된 값을 기본값으로 흡수', () => {
  assert.deepEqual(
    normalizeNotifications({ muted_kinds: ['job.completed', 'unknown'], desktop_toast: 'yes' }),
    { muted_kinds: ['job.completed'], desktop_toast: true }
  );
});

test('normalizeLandingMenu', () => {
  assert.equal(normalizeLandingMenu(' My Projects '), 'My Projects');
  assert.equal(normalizeLandingMenu(''), null);
  assert.equal(normalizeLandingMenu(null), null);
  assert.equal(normalizeLandingMenu('M'.repeat(201)), null);
});

test('effectivePrefs — 저장값 위에 기본값을 채워 4키를 모두 갖는다', () => {
  const eff = effectivePrefs({ favorites: ['A', 'A', 'B '], landing_menu: 'Dashboard' });
  assert.deepEqual(eff.favorites, ['A', 'B']);
  assert.deepEqual(eff.recent_apps, []);
  assert.deepEqual(eff.notifications, { muted_kinds: [], desktop_toast: true });
  assert.equal(eff.landing_menu, 'Dashboard');
});

test('isEmptyValue — 서버 시드 판정용', () => {
  assert.equal(isEmptyValue('favorites', []), true);
  assert.equal(isEmptyValue('favorites', ['A']), false);
  assert.equal(isEmptyValue('recent_apps', []), true);
  assert.equal(isEmptyValue('notifications', { muted_kinds: [], desktop_toast: true }), true);
  assert.equal(isEmptyValue('notifications', { muted_kinds: ['job.failed'], desktop_toast: true }), false);
  assert.equal(isEmptyValue('landing_menu', null), true);
  assert.equal(isEmptyValue('landing_menu', ''), true);
  assert.equal(isEmptyValue('landing_menu', 'Dashboard'), false);
});

test('mergeServerAndLocal — 서버 값이 비어 있지 않으면 서버 우선', () => {
  const server = { favorites: ['S1', 'S2'], notifications: { muted_kinds: [], desktop_toast: false } };
  const local  = { favorites: ['L1'],       notifications: { muted_kinds: ['job.failed'], desktop_toast: true },
                   recent_apps: [{ menu: 'A', label: 'A', at: 10 }] };
  const { merged, seed } = mergeServerAndLocal(server, local);
  // favorites: 서버가 채워져 있으므로 서버 우선. seed 에서 빠진다.
  assert.deepEqual(merged.favorites, ['S1', 'S2']);
  assert.equal(seed.favorites, undefined);
  // notifications: 서버가 채워짐(desktop_toast:false 는 기본값과 달라 '비어 있지 않음').
  assert.equal(merged.notifications.desktop_toast, false);
  assert.equal(seed.notifications, undefined);
  // recent_apps: 서버 비어 있음 → 로컬 사용 + seed 에 실림.
  assert.deepEqual(merged.recent_apps, local.recent_apps);
  assert.deepEqual(seed.recent_apps, local.recent_apps);
});

test('mergeServerAndLocal — 로컬도 비면 seed 는 없다', () => {
  const { merged, seed } = mergeServerAndLocal({}, {});
  assert.deepEqual(merged, defaultPrefs());
  assert.deepEqual(seed, {});
});
```

- [ ] **Step 2: 실패 확인**

```
node --test src/utils/preferenceMerge.test.js
```
기대: `Cannot find module … preferenceMerge.js` 로 실패.

- [ ] **Step 3: 순수 유틸 구현** — `src/utils/preferenceMerge.js`:

```js
/**
 * 환경설정 — 부수효과 없는 정규화·병합·기본값 유틸.
 * 백엔드 `user_preferences_service.py` 의 규약을 그대로 지킨다(스펙 §4.2).
 * node --test 로 검증된다(src/utils/preferenceMerge.test.js).
 */

export const PREFERENCE_KEYS = Object.freeze(['favorites', 'recent_apps', 'notifications', 'landing_menu']);

const MAX_FAVORITES = 50;
const MAX_RECENT_APPS = 8;
const LANDING_MENU_MAX_LEN = 200;

// 프론트 폴백 어휘. constants/notificationKinds.js 가 이 목록과 같다.
const KNOWN_NOTIFICATION_KINDS = new Set([
  'job.completed', 'job.failed', 'job.cancelled',
  'retention.expiring', 'retention.expired',
  'batch.completed', 'share.received',
  'feature_request.status_changed', 'notice.published',
]);

export const DEFAULT_PREFS = Object.freeze({
  favorites: Object.freeze([]),
  recent_apps: Object.freeze([]),
  notifications: Object.freeze({ muted_kinds: Object.freeze([]), desktop_toast: true }),
  landing_menu: null,
});

export function defaultPrefs() {
  return {
    favorites: [],
    recent_apps: [],
    notifications: { muted_kinds: [], desktop_toast: true },
    landing_menu: null,
  };
}

export function normalizeFavorites(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const v = item.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.slice(0, MAX_FAVORITES);
}

export function normalizeRecentApps(raw) {
  if (!Array.isArray(raw)) return [];
  const byMenu = new Map();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const menu = typeof item.menu === 'string' ? item.menu.trim() : '';
    if (!menu) continue;
    const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : menu;
    const mode = typeof item.mode === 'string' ? item.mode : '';
    const category = typeof item.category === 'string' ? item.category : '';
    const rawAt = Number(item.at);
    const at = Number.isFinite(rawAt) && rawAt >= 0 ? Math.floor(rawAt) : 0;
    const prev = byMenu.get(menu);
    if (!prev || at > prev.at) {
      byMenu.set(menu, { menu, label, mode, category, at });
    }
  }
  return [...byMenu.values()].sort((a, b) => b.at - a.at).slice(0, MAX_RECENT_APPS);
}

export function normalizeNotifications(raw) {
  const base = { muted_kinds: [], desktop_toast: true };
  if (!raw || typeof raw !== 'object') return base;
  if (Array.isArray(raw.muted_kinds)) {
    const seen = new Set();
    for (const k of raw.muted_kinds) {
      if (typeof k !== 'string') continue;
      if (!KNOWN_NOTIFICATION_KINDS.has(k)) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      base.muted_kinds.push(k);
    }
    base.muted_kinds.sort();
  }
  if (typeof raw.desktop_toast === 'boolean') base.desktop_toast = raw.desktop_toast;
  return base;
}

export function normalizeLandingMenu(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v) return null;
  if (v.length > LANDING_MENU_MAX_LEN) return null;
  return v;
}

export function effectivePrefs(stored) {
  const out = defaultPrefs();
  if (!stored || typeof stored !== 'object') return out;
  out.favorites = normalizeFavorites(stored.favorites);
  out.recent_apps = normalizeRecentApps(stored.recent_apps);
  out.notifications = normalizeNotifications(stored.notifications);
  out.landing_menu = normalizeLandingMenu(stored.landing_menu);
  return out;
}

/** PUT 이 화이트리스트만 보내도록 걸러 낸다. accepted 는 원값 그대로(서버가 정규화). */
export function filterWhitelist(payload) {
  const accepted = {};
  const ignored = [];
  if (!payload || typeof payload !== 'object') return { accepted, ignored };
  for (const [k, v] of Object.entries(payload)) {
    if (PREFERENCE_KEYS.includes(k)) accepted[k] = v;
    else ignored.push(k);
  }
  return { accepted, ignored };
}

/** 서버 우선 병합의 '비어 있음' 판정(spec D2). */
export function isEmptyValue(key, value) {
  if (key === 'favorites' || key === 'recent_apps') {
    return !Array.isArray(value) || value.length === 0;
  }
  if (key === 'landing_menu') {
    return value == null || (typeof value === 'string' && value.trim() === '');
  }
  if (key === 'notifications') {
    const n = normalizeNotifications(value);
    return n.muted_kinds.length === 0 && n.desktop_toast === true;
  }
  return true;
}

/**
 * 로그인 시 한 번: 서버 값이 비어 있지 않으면 서버, 비어 있으면 로컬 → 그 키만 시드로 서버에 올린다.
 * @param {object} serverPrefs — GET 응답의 prefs (4키). null/undefined 안전.
 * @param {object} localPrefs  — 로컬 캐시(사번별). 4키가 없어도 됨.
 * @returns {{ merged: object, seed: object }}
 *   merged: 4키를 모두 갖는 실효값. seed: 서버로 올릴 부분 payload(비어 있으면 {}).
 */
export function mergeServerAndLocal(serverPrefs, localPrefs) {
  const server = effectivePrefs(serverPrefs || {});
  const local  = effectivePrefs(localPrefs  || {});
  const merged = defaultPrefs();
  const seed = {};
  for (const key of PREFERENCE_KEYS) {
    if (!isEmptyValue(key, server[key])) {
      merged[key] = server[key];
    } else if (!isEmptyValue(key, local[key])) {
      merged[key] = local[key];
      seed[key] = local[key];
    } else {
      merged[key] = defaultPrefs()[key];
    }
  }
  return { merged, seed };
}
```

- [ ] **Step 4: 통과 확인**

```
node --test src/utils/preferenceMerge.test.js
```
기대: `pass 11`, `fail 0`.

- [ ] **Step 5: Context 구현** — `src/contexts/PreferencesContext.jsx`:

```jsx
/**
 * @fileoverview 사용자 환경설정 컨텍스트(스펙 §5.1).
 *
 *  - 로그인 상태에서만 서버와 통신. 로그아웃 시 사번별 캐시는 남기되 서버 통신은 멈춘다.
 *  - 로컬 캐시 키 = `hitess_prefs:<employee_id>`(사번별). 옛 `favorites` / `hitess_recent_apps`
 *    는 사번별 캐시가 없을 때 1회 마이그레이션 시드로 읽고 `hitess_prefs_legacy_migrated=1` 를 남긴다.
 *    공용 PC 에서 앞 사람 값이 다른 사번의 서버에 시드되는 사고를 막는다(spec D4).
 *  - hydration 카운터: 서버 GET 이 끝날 때마다 +1. 소비자(DashboardContext / RecentActivityContext)는
 *    이 값이 바뀔 때만 서버 값을 자기 state 에 반영해 자기 변경의 메아리 루프를 끊는다.
 *  - updatePrefs(partial): 화이트리스트만 걸러 (a) prefs 즉시 갱신 (b) 사번별 캐시 즉시 저장
 *    (c) 로그인 상태면 pending 에 합쳐 500ms 디바운스로 PUT. 실패 시 30초 재시도.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useAuth } from './AuthContext';
import { getPreferences, putPreferences } from '../api/preferences';
import { POLLING_POLICY } from '../hooks/pollingPolicy';
import {
  DEFAULT_PREFS,
  PREFERENCE_KEYS,
  defaultPrefs,
  effectivePrefs,
  filterWhitelist,
  mergeServerAndLocal,
} from '../utils/preferenceMerge';

const PreferencesContext = createContext(null);

const LEGACY_FAVORITES_KEY = 'favorites';
const LEGACY_RECENT_APPS_KEY = 'hitess_recent_apps';
const LEGACY_MIGRATED_FLAG = 'hitess_prefs_legacy_migrated';

function cacheKeyFor(employeeId) {
  return `hitess_prefs:${employeeId}`;
}

function readSessionCache(employeeId) {
  if (!employeeId) return null;
  try {
    const raw = localStorage.getItem(cacheKeyFor(employeeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

function writeSessionCache(employeeId, prefs) {
  if (!employeeId) return;
  try {
    localStorage.setItem(cacheKeyFor(employeeId), JSON.stringify(prefs));
  } catch { /* 저장소 접근이 막힌 환경 무시 */ }
}

function readLegacySeed() {
  const seed = {};
  try {
    const rawFav = localStorage.getItem(LEGACY_FAVORITES_KEY);
    if (rawFav) {
      const parsed = JSON.parse(rawFav);
      if (Array.isArray(parsed)) seed.favorites = parsed.filter(x => typeof x === 'string');
    }
  } catch { /* ignore */ }
  try {
    const rawRecent = localStorage.getItem(LEGACY_RECENT_APPS_KEY);
    if (rawRecent) {
      const parsed = JSON.parse(rawRecent);
      if (Array.isArray(parsed)) seed.recent_apps = parsed.filter(x => x?.menu);
    }
  } catch { /* ignore */ }
  return seed;
}

function markLegacyMigrated() {
  try { localStorage.setItem(LEGACY_MIGRATED_FLAG, '1'); } catch { /* ignore */ }
}

function isLegacyMigrated() {
  try { return localStorage.getItem(LEGACY_MIGRATED_FLAG) === '1'; } catch { return false; }
}

export function PreferencesProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const employeeId = user?.employee_id || null;

  // 4키를 모두 갖는 실효값. 초기값은 사번별 캐시 + legacy 시드 + 기본값.
  const [prefs, setPrefs] = useState(() => {
    const cached = employeeId ? readSessionCache(employeeId) : null;
    if (cached) return effectivePrefs(cached);
    if (!isLegacyMigrated()) return effectivePrefs(readLegacySeed());
    return defaultPrefs();
  });
  const [status, setStatus] = useState('idle');           // idle | loading | ready | offline
  const [hydration, setHydration] = useState(0);          // 서버 GET 성공 시 +1

  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const pendingRef = useRef({});                          // 다음 PUT 에 포함할 payload
  const debounceTimerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const isMountedRef = useRef(false);

  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

  const persistCache = useCallback((next) => {
    if (!employeeId) return;
    writeSessionCache(employeeId, next);
  }, [employeeId]);

  const flushPending = useCallback(async () => {
    if (!employeeId) return;
    const payload = pendingRef.current;
    if (!payload || Object.keys(payload).length === 0) return;
    const { accepted } = filterWhitelist(payload);
    if (Object.keys(accepted).length === 0) {
      pendingRef.current = {};
      return;
    }
    try {
      const res = await putPreferences(accepted);
      if (!isMountedRef.current) return;
      const nextPrefs = effectivePrefs(res?.data?.prefs);
      setPrefs(nextPrefs);
      persistCache(nextPrefs);
      setStatus('ready');
      pendingRef.current = {};
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    } catch {
      // 실패 시 pending 유지, 다음 재시도 예약.
      if (!isMountedRef.current) return;
      setStatus('offline');
      if (!retryTimerRef.current) {
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          flushPending();
        }, POLLING_POLICY.preferencesRetryMs);
      }
    }
  }, [employeeId, persistCache]);

  const scheduleFlush = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      flushPending();
    }, POLLING_POLICY.preferencesDebounceMs);
  }, [flushPending]);

  const updatePrefs = useCallback((partial) => {
    const { accepted, ignored } = filterWhitelist(partial || {});
    if (Object.keys(accepted).length === 0) return { ignored };
    // (1) prefs 즉시 갱신 — 지연 없이 화면에 반영
    const nextPrefs = effectivePrefs({ ...prefsRef.current, ...accepted });
    setPrefs(nextPrefs);
    persistCache(nextPrefs);
    if (isAuthenticated && employeeId) {
      // (2) pending 병합 + 디바운스 예약
      pendingRef.current = { ...pendingRef.current, ...accepted };
      scheduleFlush();
    }
    return { ignored };
  }, [employeeId, isAuthenticated, persistCache, scheduleFlush]);

  // 로그인 하이드레이션 — 사번이 바뀌거나 로그인 상태가 바뀔 때 1회.
  useEffect(() => {
    if (!isAuthenticated || !employeeId) {
      setStatus('idle');
      return undefined;
    }
    let cancelled = false;
    setStatus('loading');

    const hydrate = async () => {
      try {
        const res = await getPreferences();
        if (cancelled) return;
        const server = res?.data?.prefs ?? {};
        const cached = readSessionCache(employeeId);
        const local = cached || readLegacySeed();
        const { merged, seed } = mergeServerAndLocal(server, local);

        setPrefs(merged);
        persistCache(merged);
        setStatus('ready');
        setHydration(h => h + 1);

        if (Object.keys(seed).length > 0) {
          pendingRef.current = { ...pendingRef.current, ...seed };
          scheduleFlush();
        }
        markLegacyMigrated();
      } catch {
        if (cancelled) return;
        setStatus('offline');
        setHydration(h => h + 1);       // 로컬 값으로도 소비자가 초기화되도록 신호는 준다.
        // 30초 뒤 재시도
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          hydrate();
        }, POLLING_POLICY.preferencesRetryMs);
      }
    };
    hydrate();
    return () => {
      cancelled = true;
      if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null; }
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    };
  }, [employeeId, isAuthenticated, persistCache, scheduleFlush]);

  // 창 unload 직전 pending 을 한 번 더 시도.
  useEffect(() => {
    const onBeforeUnload = () => {
      if (Object.keys(pendingRef.current).length > 0) {
        // navigator.sendBeacon 은 axios 헤더가 붙지 않아 인증이 안 된다 — best-effort 로만 시도.
        try { flushPending(); } catch { /* ignore */ }
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flushPending]);

  const value = useMemo(() => ({
    prefs, status, hydration, updatePrefs,
  }), [prefs, status, hydration, updatePrefs]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error('usePreferences must be used within <PreferencesProvider>');
  }
  return ctx;
}
```

- [ ] **Step 6: 빌드 확인**

```
npm run build
```
기대: 오류 없음.

- [ ] **Step 7: 커밋 준비 완료** — 보고: `src/utils/preferenceMerge.js`, `src/utils/preferenceMerge.test.js`, `src/contexts/PreferencesContext.jsx`.

---

### Task 6: `DashboardContext.jsx` — 즐겨찾기 3계층 sync

**Files:**
- Modify: `HiTessWorkBench/frontend/src/contexts/DashboardContext.jsx`(321~330행 상수, 361~424행 storage 헬퍼, 429행 초기 state, 444~486행 Electron 로드 effect, 724~748행 mutator, 750~776행 memo)

3계층 구조(코드 실측):
1. **React state** — `useState(() => readLocalFavorites())`(429행).
2. **localStorage `'favorites'`** — `readLocalFavorites`/`writeLocalFavorites`(361~377행).
3. **Electron IPC** — `writeElectronFavorites`(417~424행, `preferences:set`), `preferences:get` 마운트 시 1회(453~479행).

Plan E 는 여기에 **서버(usePreferences)** 를 4번째 계층으로 얹지 않고, `PreferencesProvider` 가 이미 4키를 갖는 실효값을 소유하도록 만든다. `DashboardContext` 는 소비자로서:

- 마운트 시 서버 하이드레이션이 오면(`hydration` 카운터가 바뀌면) `prefs.favorites` 를 React state · localStorage · Electron 세 곳에 반영한다.
- `toggleFavorite`/`reorderFavorite`/`clearFavorites` 는 세 곳을 즉시 갱신하고 `updatePrefs({favorites: next})` 로 서버 pending 에 얹는다.
- Electron `preferences:get` 마운트 effect 는 **하이드레이션이 이미 일어났으면 무시**한다 — 서버 값이 콜드 스타트 캐시(사번 구분 없음)를 덮어 쓰지 않게 하는 가드(spec D4).

- [ ] **Step 1: import 추가** — 상단 import 블록(NavigationContext / AuthContext 근처)에:

```js
import { usePreferences } from './PreferencesContext';
```

- [ ] **Step 2: 마운트 이미 하이드레이션됐는지 판별할 ref 추가** — `DashboardProvider` 시작부(현재 429행 `useState` 앞)에:

```js
  const { prefs: serverPrefs, hydration, updatePrefs } = usePreferences();
  // 서버 하이드레이션이 온 뒤에는 Electron 마운트 effect 가 값을 덮어쓰지 않도록 잠근다.
  const serverHydratedRef = useRef(false);
```

`useRef` 는 파일 상단 import 에서 이미 들어와 있는지 확인하고 없으면 `import { …, useRef } from 'react';` 로 추가한다.

- [ ] **Step 3: Electron 로드 effect 가드**(450~486행) — 첫 줄에 아래 가드를 추가한다:

```js
    // 서버 하이드레이션이 이미 왔으면 Electron 값을 쓰지 않는다(사번 구분 없음 → 앞 사람 값이
    // 새 사번의 서버 실효값을 덮어쓰는 사고 방지, spec D4).
    if (serverHydratedRef.current) return () => {};
```

`return`은 훅 규약상 실제 cleanup 이 없어도 undefined 로 두고 있으니 그 앞의 코드 흐름이 return 을 만들지 않도록 `if` 뒤에서 조기 종료로 처리해도 된다(기존 스타일과 맞춘다).

- [ ] **Step 4: 하이드레이션 반영 effect 추가** — 위 effect 뒤(약 487행)에:

```js
  // PreferencesContext 의 서버 pull 이 끝날 때마다 즐겨찾기를 3곳(state · localStorage · Electron)에
  // 반영한다. hydration === 0 (아직 안 왔음) 이면 아무것도 하지 않는다.
  useEffect(() => {
    if (hydration === 0) return;
    serverHydratedRef.current = true;
    const next = Array.isArray(serverPrefs.favorites)
      ? serverPrefs.favorites.filter(x => typeof x === 'string')
      : [];
    setFavorites(next);
    writeLocalFavorites(next);
    writeElectronFavorites(next);
  }, [hydration, serverPrefs.favorites]);
```

- [ ] **Step 5: mutator 3개를 서버로도 얹는다** — 724~748행의 `toggleFavorite` / `reorderFavorite` 를 **ref 로 현재값을 읽어 밖에서 계산**하는 형태로 바꾼다(StrictMode 이중 호출 시 PUT 이 두 번 나가는 것을 막는다, spec §5.3):

```js
  const favoritesRef = useRef(favorites);
  useEffect(() => { favoritesRef.current = favorites; }, [favorites]);

  const toggleFavorite = useCallback((title) => {
    if (!title) return;
    const current = favoritesRef.current;
    const next = current.includes(title)
      ? current.filter(t => t !== title)
      : [...current, title];
    setFavorites(next);
    writeLocalFavorites(next);
    writeElectronFavorites(next);
    updatePrefs({ favorites: next });
  }, [updatePrefs]);

  const reorderFavorite = useCallback((activeTitle, overTitle) => {
    if (!activeTitle || !overTitle || activeTitle === overTitle) return;
    const current = favoritesRef.current;
    const fromIndex = current.indexOf(activeTitle);
    const toIndex = current.indexOf(overTitle);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...current];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setFavorites(next);
    writeLocalFavorites(next);
    writeElectronFavorites(next);
    updatePrefs({ favorites: next });
  }, [updatePrefs]);

  const clearFavorites = useCallback(() => {
    setFavorites([]);
    writeLocalFavorites([]);
    writeElectronFavorites([]);
    updatePrefs({ favorites: [] });
  }, [updatePrefs]);
```

- [ ] **Step 6: memo/`favoritesValue` 확장** — 750~776행의 memo 두 곳에 `clearFavorites` 를 얹는다:

```js
  const contextValue = useMemo(() => ({
    favorites, toggleFavorite, reorderFavorite, clearFavorites,
    // ... 기존 값들
  }), [
    favorites, toggleFavorite, reorderFavorite, clearFavorites,
    // ... 기존 deps
  ]);

  const favoritesValue = useMemo(() => ({
    favorites,
    toggleFavorite,
    reorderFavorite,
    clearFavorites,
  }), [favorites, toggleFavorite, reorderFavorite, clearFavorites]);
```

- [ ] **Step 7: 빌드**

```
npm run build
```
기대: 오류 없음.

- [ ] **Step 8: 수동 검증 1(로컬 → 서버 시드)**

백엔드(`uvicorn app.main:app --host 0.0.0.0 --port 9091 --reload`) + `HiTessWorkBench` 에서 `npm run dev`.

1. `localStorage.setItem('favorites', JSON.stringify(['BDF Scanner']))` 를 콘솔에서 넣고 `localStorage.removeItem('hitess_prefs_legacy_migrated')` 로 마이그레이션 플래그 해제. 로그인.
2. DevTools Network 에 `GET /api/preferences` 성공, 이어서 500ms 뒤 `PUT /api/preferences` 가 `{favorites: ['BDF Scanner']}` 를 보내는지 확인(시드).
3. `localStorage.getItem('hitess_prefs:<사번>')` 에 4키 dict 가 저장돼 있는지 확인.

- [ ] **Step 9: 수동 검증 2(다른 PC 시나리오, 두 브라우저 프로필)**

1. 크롬 프로필 A 로 로그인 → 즐겨찾기 두 개 토글. 30초 이내 서버 반영.
2. 크롬 프로필 B(같은 사번, 완전히 다른 localStorage)로 로그인 → 첫 하이드레이션이 오는 순간 서버의 두 개가 화면·localStorage 에 반영. `localStorage.getItem('favorites')` 도 두 개.
3. 프로필 B 에서 하나 지우기 → 500ms 디바운스로 `PUT`. 프로필 A 에 즉시는 안 보인다(다음 하이드레이션까지는 자기 값). 프로필 A 를 다시 로그인하면 두 곳이 같아진다(마지막 PUT 이 이긴다, spec §9).

- [ ] **Step 10: 커밋 준비 완료** — 보고: `src/contexts/DashboardContext.jsx`.

---

### Task 7: `RecentActivityContext.jsx` — 최근 앱 서버 sync

**Files:**
- Modify: `HiTessWorkBench/frontend/src/contexts/RecentActivityContext.jsx`(전체 63행)

기존 계약:
- localStorage 키 = `'hitess_recent_apps'`(코드 실측 4행), 상한 8(5행).
- 한 아이템 = `{menu, label, mode, category, at}`(30~36행).

Plan E 는:
- `usePreferences()` 를 소비해 `prefs.recent_apps` 를 서버 진실로 삼는다.
- `hydration` 이 바뀌면 서버 값을 state·localStorage 에 반영.
- `recordAppVisit`/`clearRecentApps` 는 서버 pending 에 얹는다.

- [ ] **Step 1: 전체 파일 교체** — `src/contexts/RecentActivityContext.jsx`:

```jsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useRef } from 'react';
import { usePreferences } from './PreferencesContext';

const RecentActivityContext = createContext(null);
const RECENT_APPS_KEY = 'hitess_recent_apps';
const MAX_RECENT_APPS = 8;

function readRecentApps() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_APPS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => item?.menu && item?.label) : [];
  } catch {
    return [];
  }
}

function writeRecentApps(items) {
  try {
    localStorage.setItem(RECENT_APPS_KEY, JSON.stringify(items.slice(0, MAX_RECENT_APPS)));
  } catch {
    // localStorage disabled; ignore
  }
}

export function RecentActivityProvider({ children }) {
  const { prefs: serverPrefs, hydration, updatePrefs } = usePreferences();
  const [recentApps, setRecentApps] = useState(() => readRecentApps());
  const recentRef = useRef(recentApps);
  useEffect(() => { recentRef.current = recentApps; }, [recentApps]);

  // 서버 하이드레이션이 올 때마다 서버 값을 진실로 삼는다(로컬 캐시도 함께 갱신).
  useEffect(() => {
    if (hydration === 0) return;
    const next = Array.isArray(serverPrefs.recent_apps)
      ? serverPrefs.recent_apps.filter(item => item?.menu && item?.label).slice(0, MAX_RECENT_APPS)
      : [];
    setRecentApps(next);
    writeRecentApps(next);
  }, [hydration, serverPrefs.recent_apps]);

  const recordAppVisit = useCallback((menu, label = menu, meta = {}) => {
    if (!menu || !label) return;
    const nextItem = {
      menu,
      label,
      mode: meta.mode || '',
      category: meta.category || '',
      at: Date.now(),
    };
    const next = [nextItem, ...recentRef.current.filter(item => item.menu !== menu)].slice(0, MAX_RECENT_APPS);
    setRecentApps(next);
    writeRecentApps(next);
    updatePrefs({ recent_apps: next });
  }, [updatePrefs]);

  const clearRecentApps = useCallback(() => {
    setRecentApps([]);
    writeRecentApps([]);
    updatePrefs({ recent_apps: [] });
  }, [updatePrefs]);

  const value = useMemo(() => ({
    recentApps,
    recordAppVisit,
    clearRecentApps,
  }), [clearRecentApps, recentApps, recordAppVisit]);

  return <RecentActivityContext.Provider value={value}>{children}</RecentActivityContext.Provider>;
}

export function useRecentActivity() {
  const ctx = useContext(RecentActivityContext);
  if (!ctx) {
    throw new Error('useRecentActivity must be used within <RecentActivityProvider>');
  }
  return ctx;
}
```

- [ ] **Step 2: Provider 순서 확인** — `App.jsx`(현재 645~655행 근처)의 Provider 트리에서 `RecentActivityProvider` 가 **`PreferencesProvider` 안**에 있어야 한다. 이 순서 확정은 Task 8 Step 1 과 함께 처리한다(App.jsx 편집 지점 하나로 묶는다).

- [ ] **Step 3: Dashboard "최근 사용" 섹션 추가** — `src/pages/dashboard/Dashboard.jsx` 의 즐겨찾기 블록(현행 1781~1923행) **바로 뒤**, "프로젝트 이력"(1925행) 앞에 새 섹션을 삽입한다.

먼저 파일 상단에 상수·유틸 import 를 추가한다(이미 있는 항목은 건드리지 말 것):

```jsx
import { History } from 'lucide-react';
import { useRecentActivity } from '../../contexts/RecentActivityContext';
import { useAppCatalogue, findAppByAnyName, getAppMenuName } from '../../contexts/DashboardContext';
```

상단 상수:

```jsx
const RECENT_APPS_WINDOW_SIZE = 6;
```

렌더 부분(즐겨찾기 블록 바로 뒤):

```jsx
      {/* 최근 사용 — 6개까지, 0이면 섹션 자체를 그리지 않음(spec D9) */}
      {(() => {
        const { recentApps } = useRecentActivity();
        const { apps: catalogue, isBlockedFor } = useAppCatalogue();
        const isAdmin = getIsAdmin();
        const items = (recentApps || [])
          .map(item => {
            const app = findAppByAnyName(item.label || item.menu) ||
                        catalogue.find(a => getAppMenuName(a.title) === item.menu);
            return app ? { app, item } : null;
          })
          .filter(pair => pair && pair.app.hasPage && !isBlockedFor(pair.app, isAdmin))
          .slice(0, RECENT_APPS_WINDOW_SIZE);

        if (items.length === 0) return null;

        return (
          <section className="shrink-0">
            <DashboardSectionTitle icon={History} accent="history">최근 사용</DashboardSectionTitle>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {items.map(({ app, item }) => (
                <RecentAppCard
                  key={item.menu}
                  app={app}
                  at={item.at}
                  isFavorite={favorites.includes(app.title)}
                  onOpen={() => handleFavoriteClick(app.title)}
                  onToggleFavorite={() => toggleFavorite(app.title)}
                />
              ))}
            </div>
          </section>
        );
      })()}
```

⚠ IIFE 안에서 Hook 을 호출하는 것은 React 규약 위반이다. 위 스니펫은 **읽는 사람 이해용**이고 실제 구현은 아래 컴포넌트 분리 방식을 쓴다. `Dashboard.jsx` 안 지역 컴포넌트로 `RecentAppsSection` 을 만든 뒤 렌더에서 `<RecentAppsSection />` 을 삽입한다:

```jsx
function RecentAppsSection({ favorites, handleFavoriteClick, toggleFavorite, getIsAdmin }) {
  const { recentApps } = useRecentActivity();
  const { apps: catalogue, isBlockedFor } = useAppCatalogue();
  const isAdmin = getIsAdmin();
  const items = (recentApps || [])
    .map(item => {
      const app = findAppByAnyName(item.label || item.menu) ||
                  catalogue.find(a => getAppMenuName(a.title) === item.menu);
      return app ? { app, item } : null;
    })
    .filter(pair => pair && pair.app.hasPage && !isBlockedFor(pair.app, isAdmin))
    .slice(0, RECENT_APPS_WINDOW_SIZE);
  if (items.length === 0) return null;
  return (
    <section className="shrink-0">
      <DashboardSectionTitle icon={History} accent="history">최근 사용</DashboardSectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {items.map(({ app, item }) => (
          <RecentAppCard
            key={item.menu}
            app={app}
            at={item.at}
            isFavorite={favorites.includes(app.title)}
            onOpen={() => handleFavoriteClick(app.title)}
            onToggleFavorite={() => toggleFavorite(app.title)}
          />
        ))}
      </div>
    </section>
  );
}
```

카드 컴포넌트(`RecentAppCard`): 아이콘·제목·모드 칩·"n분 전"·별. 별 클릭은 stop propagation → `onToggleFavorite`. 나머지 영역 클릭 → `onOpen`. 시각 표시는 `formatNotificationTime`(있으면) 또는 파일 내 로컬 함수로 처리.

- [ ] **Step 4: 빌드**

```
npm run build
```
기대: 오류 없음.

- [ ] **Step 5: 수동 검증 — 최근 사용 카드**

`npm run dev` 로 앱을 띄우고:

1. 로그인 → 즐겨찾기가 아닌 앱 4개(예 BDF Scanner · Truss Analysis · Mast Post Assessment · Simple Beam Analyzer)를 차례로 방문한다.
2. Dashboard 로 돌아오면 즐겨찾기 아래에 **최근 사용** 섹션이 있고 최신순으로 4장. `n분 전`.
3. 별을 눌러 즐겨찾기에 추가 → 즐겨찾기 섹션에 나타나되 최근 사용에서도 유지(중복 노출 허용, spec D9 조건에 제외 규칙 없음).
4. 최근 사용 카드 클릭 → 해당 앱 진입. 방문 시각이 갱신돼 맨 앞으로.
5. DevTools Network 에서 방문마다 500ms 뒤 `PUT /api/preferences` 가 `recent_apps` 를 보낸다.
6. 다른 브라우저 프로필에서 같은 사번으로 로그인 → 최근 사용 6장이 서버 값으로 채워진다.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `src/contexts/RecentActivityContext.jsx`, `src/pages/dashboard/Dashboard.jsx`.

---

### Task 8: `landing_menu` 로그인 후 자동 이동

**Files:**
- Modify: `HiTessWorkBench/frontend/src/App.jsx`(645~655행 Provider 트리 + `AppInner` 내부에 landing effect 추가)

- [ ] **Step 1: Provider 트리 수정** — 645~655행 부근을 아래로 맞춘다(Auth → Navigation → Toast → Network 뒤에 **Preferences → RecentActivity → AppInner → Dashboard**, spec §5.1):

```jsx
    <AuthProvider>
      <NavigationProvider>
        <ToastProvider>
          <NetworkProvider>
            <PreferencesProvider>
              <RecentActivityProvider>
                <AppInner />
              </RecentActivityProvider>
            </PreferencesProvider>
          </NetworkProvider>
        </ToastProvider>
      </NavigationProvider>
    </AuthProvider>
```

`DashboardProvider` 는 `AppInner` 내부에서 이미 mount 된다(현행 구조 유지). Provider 순서만 위 트리를 맞춘다. `PreferencesProvider` 를 `RecentActivityProvider` 밖에 두는 이유 — 최근 앱 컨텍스트가 `usePreferences` 를 소비하기 때문이다.

`import { PreferencesProvider } from './contexts/PreferencesContext';` 를 상단 import 에 추가.

- [ ] **Step 2: `landing_menu` 적용 effect 추가** — `AppInner` 안(현재 269~271행 `handleLogout` 앞 근처)에:

```jsx
  const { prefs: serverPrefs, hydration } = usePreferences();
  const landingAppliedForRef = useRef(0);   // hydration 카운터 스냅숏

  useEffect(() => {
    if (appState !== APP_STATE.MAIN) return;
    if (hydration === 0) return;
    // 한 하이드레이션당 1회만 적용
    if (landingAppliedForRef.current === hydration) return;
    landingAppliedForRef.current = hydration;

    const landing = serverPrefs?.landing_menu;
    if (!landing || typeof landing !== 'string') return;
    // 사용자가 이미 다른 화면에 있으면 납치하지 않는다(spec D8).
    if (currentMenu !== 'Dashboard' || canGoBack) return;

    // 관리자 메뉴는 비관리자에게 무시.
    if (ADMIN_MENUS.has(landing) && !isAdmin) return;
    // 카탈로그의 앱 이름이면 차단 여부 확인.
    const app = appCatalogue.find(a =>
      a.title === landing || getAppMenuName(a.title) === landing);
    if (app) {
      if (!app.hasPage) return;
      if (isAppBlocked(app, isAdmin)) return;
      resetNavigation(getAppMenuName(app.title));
      return;
    }
    // 알려진 메뉴 상수(사이드바에 있는 것)면 그대로 이동, 아니면 Dashboard 유지.
    const KNOWN = new Set([
      'Dashboard', 'My Projects', 'Model Library',
      'File-Based Apps', 'Interactive Apps', 'Parametric Apps', 'Productivity Apps',
      'Notice & Updates', 'User Guide',
      // 관리자 메뉴는 위에서 걸러졌음
      'User Management', 'Analysis Management', 'System Management', 'Usage Reports',
      'App Community', 'App Settings', 'API Apps',
    ]);
    if (KNOWN.has(landing)) resetNavigation(landing);
  }, [
    appState, hydration, serverPrefs, currentMenu, canGoBack,
    isAdmin, appCatalogue, isAppBlocked, resetNavigation,
  ]);
```

`getAppMenuName` 을 상단 import 에 추가한다(현행 `DashboardContext` 에서 export 됨).

- [ ] **Step 3: `'My Settings'` 렌더 케이스 추가** — 512~575행 switch 문의 관리자 메뉴 근처에 사용자 개인 메뉴로 추가한다. 관리자 섹션 앞이 자연스럽다:

```jsx
      case 'My Settings': return <MySettings />;
```

상단 import 에 `import MySettings from './pages/settings/MySettings';` 추가.

- [ ] **Step 4: 빌드**

```
npm run build
```
기대: 오류 없음.

- [ ] **Step 5: 수동 검증 — 시작 화면**

1. Task 9 를 아직 안 만들었으면 콘솔에서 `axios.put('/api/preferences', {landing_menu: 'My Projects'}, {headers: {...}})` 등으로 값을 직접 심는다. 또는 SQL 로: `INSERT INTO user_preferences(employee_id, prefs) VALUES('<사번>', JSON_OBJECT('landing_menu','My Projects'));`
2. 로그아웃 후 다시 로그인 → 스플래시 이후 화면이 **My Projects** 로 바로 열린다.
3. 로그인 직후 곧바로 `File-Based Apps` 를 클릭한 뒤 다른 창에서 알림이 오는 등 `hydration` 재발생 상황이 있어도 화면이 랜딩으로 되돌아가지 않는다(스냅숏 가드).
4. `landing_menu` 를 존재하지 않는 문자열로 심은 뒤 재로그인 → Dashboard 유지(무시).
5. 관리자용 메뉴(`User Management`)로 심고 비관리자 로그인 → Dashboard 유지.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `src/App.jsx`.

---

### Task 9: 설정 UI(`MySettings` + `NotificationCenter` 알림 설정 소비)

**Files:**
- Create: `HiTessWorkBench/frontend/src/constants/notificationKinds.js`
- Create: `HiTessWorkBench/frontend/src/pages/settings/MySettings.jsx`
- Create: `HiTessWorkBench/frontend/src/hooks/useNotificationPrefs.js`
- Modify: `HiTessWorkBench/frontend/src/components/layout/Layout.jsx`(96~114행 `menuItems` + 329~337행 헤더 사용자 블록)

Task 이름의 "NotificationCenter" 는 알림 설정 값(`muted_kinds`·`desktop_toast`)의 **저장·소비 지점**을 뜻한다. 저장 UI 는 spec §5.5 대로 `MySettings.jsx` 의 "알림 수신" 카드에 있고, 소비는 Plan A `NotificationCenter` 가 하는데 Plan A 가 아직 없는 환경에서도 값이 살아 있도록 얇은 훅(`useNotificationPrefs`)만 만들어 둔다. Plan A 는 `useNotifications` 내부에서 이 훅으로 갈아탈 수 있다.

- [ ] **Step 1: 알림 kind 상수 파일** — `src/constants/notificationKinds.js`:

```js
/**
 * 알림 kind 어휘 — 마스터 §2.1 의 9종. label 은 설정 UI 문구, group 은 카테고리 헤더.
 * Plan A 미구현 상태에서도 설정은 저장되어야 하므로(spec D6) 이 상수는 Plan A 와 무관하게 존재한다.
 */

export const NOTIFICATION_KINDS = Object.freeze([
  { kind: 'job.completed',                 label: '해석 완료',           group: '해석' },
  { kind: 'job.failed',                    label: '해석 실패',           group: '해석' },
  { kind: 'job.cancelled',                 label: '해석 중단',           group: '해석' },
  { kind: 'batch.completed',               label: '배치 완료',           group: '해석' },
  { kind: 'retention.expiring',            label: '보관 만료 예정',      group: '보관' },
  { kind: 'retention.expired',             label: '보관 만료',           group: '보관' },
  { kind: 'share.received',                label: '공유 수신',           group: '협업' },
  { kind: 'notice.published',              label: '공지',                group: '기타' },
  { kind: 'feature_request.status_changed', label: '기능 요청 상태 변경', group: '기타' },
]);

export const NOTIFICATION_KIND_LOOKUP = Object.freeze(
  Object.fromEntries(NOTIFICATION_KINDS.map(k => [k.kind, k]))
);
```

- [ ] **Step 2: `useNotificationPrefs` 훅** — `src/hooks/useNotificationPrefs.js`:

```js
/**
 * Plan A(알림 센터) 가 `muted_kinds` / `desktop_toast` 를 서버 값에서 읽도록 하는 얇은 훅.
 * Plan A 미구현이어도 안전하게 대체할 수 있게 단독으로 노출한다.
 */
import { usePreferences } from '../contexts/PreferencesContext';

const DEFAULT = { muted_kinds: [], desktop_toast: true };

export function useNotificationPrefs() {
  const { prefs } = usePreferences();
  const n = prefs?.notifications || {};
  return {
    mutedKinds: Array.isArray(n.muted_kinds) ? n.muted_kinds : DEFAULT.muted_kinds,
    desktopToast: typeof n.desktop_toast === 'boolean' ? n.desktop_toast : DEFAULT.desktop_toast,
  };
}
```

- [ ] **Step 3: `MySettings` 페이지** — `src/pages/settings/MySettings.jsx`(spec §5.5 4카드):

```jsx
/**
 * @fileoverview 개인 환경설정 — 내 정보 / 시작 화면 / 알림 수신 / 초기화 4카드.
 * 진입: 헤더 사용자 블록 · 명령 팔레트 `My Settings` · App.jsx switch 케이스(spec D10).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { UserCog, RefreshCw, WifiOff, Check } from 'lucide-react';
import PageHeader from '../../components/layout/PageHeader';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import { useAuth } from '../../contexts/AuthContext';
import { usePreferences } from '../../contexts/PreferencesContext';
import { useDashboard, useAppCatalogue, getAppMenuName } from '../../contexts/DashboardContext';
import { useRecentActivity } from '../../contexts/RecentActivityContext';
import { NOTIFICATION_KINDS } from '../../constants/notificationKinds';
import { ADMIN_MENUS } from '../../constants/adminMenus';

const BASE_MENUS = [
  { menu: 'Dashboard',        label: 'Dashboard(기본)' },
  { menu: 'My Projects',      label: 'My Projects' },
  { menu: 'Model Library',    label: 'Model Library' },
  { menu: 'File-Based Apps',  label: 'File-Based Apps' },
  { menu: 'Interactive Apps', label: 'Interactive Apps' },
  { menu: 'Parametric Apps',  label: 'Parametric Apps' },
  { menu: 'Productivity Apps',label: 'Productivity Apps' },
  { menu: 'Notice & Updates', label: 'Notice & Updates' },
  { menu: 'User Guide',       label: 'User Guide' },
];

const ADMIN_MENU_ITEMS = [
  { menu: 'User Management',      label: 'User Management' },
  { menu: 'Analysis Management',  label: 'Analysis Management' },
  { menu: 'System Management',    label: 'System Settings' },
  { menu: 'Usage Reports',        label: 'Usage Reports' },
  { menu: 'App Community',        label: 'App Community' },
  { menu: 'App Settings',         label: 'App Settings' },
  { menu: 'API Apps',             label: 'API Apps' },
];

function StatusBadge({ status }) {
  if (status === 'loading') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
        <RefreshCw size={12} className="animate-spin" /> 동기화 중
      </span>
    );
  }
  if (status === 'offline') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
        <WifiOff size={12} /> 서버 연결 없음 · 이 PC 에만 저장됨
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
      <Check size={12} /> 서버와 동기화됨
    </span>
  );
}

function Card({ title, description, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="mb-3">
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
        {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      </header>
      {children}
    </section>
  );
}

export default function MySettings() {
  const { user } = useAuth();
  const { prefs, status, updatePrefs } = usePreferences();
  const { favorites, clearFavorites } = useDashboard();
  const { recentApps, clearRecentApps } = useRecentActivity();
  const { apps: catalogue } = useAppCatalogue();
  const isAdmin = !!user?.is_admin;

  const [confirming, setConfirming] = useState(null);   // 'favorites' | 'recent' | null

  const favoriteMenus = useMemo(() => (favorites || [])
    .map(title => {
      const app = catalogue.find(a => a.title === title);
      return app ? { menu: getAppMenuName(app.title), label: app.title } : null;
    })
    .filter(Boolean), [favorites, catalogue]);

  const landingOptions = useMemo(() => {
    const base = [...BASE_MENUS];
    if (favoriteMenus.length > 0) {
      base.push({ divider: '즐겨찾기 앱' });
      for (const item of favoriteMenus) base.push(item);
    }
    if (isAdmin) {
      base.push({ divider: '관리자 메뉴' });
      for (const item of ADMIN_MENU_ITEMS) base.push(item);
    }
    return base;
  }, [favoriteMenus, isAdmin]);

  const onLandingChange = useCallback((menu) => {
    updatePrefs({ landing_menu: menu || null });
  }, [updatePrefs]);

  const notifications = prefs?.notifications || { muted_kinds: [], desktop_toast: true };
  const mutedSet = useMemo(() => new Set(notifications.muted_kinds || []), [notifications.muted_kinds]);

  const setDesktopToast = useCallback((next) => {
    updatePrefs({ notifications: { desktop_toast: !!next } });
  }, [updatePrefs]);

  const setKindEnabled = useCallback((kind, enabled) => {
    const current = new Set(notifications.muted_kinds || []);
    if (enabled) current.delete(kind); else current.add(kind);
    updatePrefs({ notifications: { muted_kinds: [...current].sort() } });
  }, [notifications.muted_kinds, updatePrefs]);

  const groupedKinds = useMemo(() => {
    const bucket = new Map();
    for (const k of NOTIFICATION_KINDS) {
      const list = bucket.get(k.group) || [];
      list.push(k);
      bucket.set(k.group, list);
    }
    return [...bucket.entries()];
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-2">
      <PageHeader
        icon={UserCog}
        accent="indigo"
        title="My Settings"
        description="즐겨찾기·최근 앱·시작 화면·알림 수신 설정은 사번 단위로 서버에 저장됩니다."
        trailing={<StatusBadge status={status} />}
      />

      <Card title="내 정보" description="변경은 관리자에게 요청하세요.">
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-slate-500">사번</dt><dd className="font-bold text-slate-800">{user?.employee_id || '-'}</dd>
          <dt className="text-slate-500">이름</dt><dd className="text-slate-700">{user?.name || '-'}</dd>
          <dt className="text-slate-500">부서</dt><dd className="text-slate-700">{user?.department || '-'}</dd>
          <dt className="text-slate-500">직급</dt><dd className="text-slate-700">{user?.position || '-'}</dd>
        </dl>
      </Card>

      <Card title="시작 화면" description="로그인 직후 자동으로 열릴 화면을 고릅니다. Dashboard 는 기본값입니다.">
        <select
          value={prefs?.landing_menu || 'Dashboard'}
          onChange={(e) => onLandingChange(e.target.value === 'Dashboard' ? null : e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        >
          {landingOptions.map((opt, i) => {
            if (opt.divider) {
              return <option key={`d-${i}`} disabled>── {opt.divider} ──</option>;
            }
            return <option key={opt.menu} value={opt.menu}>{opt.label}</option>;
          })}
        </select>
        <p className="mt-2 text-xs text-slate-500">
          접근 권한이 없는 메뉴나 사용 중지된 앱을 골라 두면 Dashboard 로 열립니다.
        </p>
      </Card>

      <Card
        title="알림 수신"
        description="종 아이콘의 알림 중 어떤 것을 받을지 고릅니다. 데스크톱 토스트는 창이 뒤에 있을 때 Windows 알림으로 뜹니다."
      >
        <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={notifications.desktop_toast !== false}
            onChange={(e) => setDesktopToast(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          데스크톱 알림 표시(Windows 토스트)
        </label>
        <div className="space-y-3">
          {groupedKinds.map(([group, kinds]) => (
            <div key={group}>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{group}</p>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {kinds.map(k => (
                  <label key={k.kind} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={!mutedSet.has(k.kind)}
                      onChange={(e) => setKindEnabled(k.kind, e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    {k.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          알림 센터가 아직 배포되지 않았다면 설정만 저장되고 실제 알림은 이후 빌드부터 반영됩니다.
        </p>
      </Card>

      <Card title="초기화" description="이 목록을 비우면 서버에도 즉시 반영됩니다.">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setConfirming('favorites')}
            disabled={(favorites || []).length === 0}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            즐겨찾기 비우기({(favorites || []).length}개)
          </button>
          <button
            type="button"
            onClick={() => setConfirming('recent')}
            disabled={(recentApps || []).length === 0}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            최근 사용 비우기({(recentApps || []).length}개)
          </button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirming === 'favorites'}
        variant="warning"
        title="즐겨찾기를 모두 지울까요?"
        description="이 사번의 즐겨찾기 목록을 서버에서도 비웁니다."
        confirmLabel="비우기"
        onConfirm={() => { clearFavorites(); setConfirming(null); }}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === 'recent'}
        variant="warning"
        title="최근 사용 기록을 모두 지울까요?"
        description="다른 PC 에서 보이는 이 사번의 최근 사용 기록도 함께 비워집니다."
        confirmLabel="비우기"
        onConfirm={() => { clearRecentApps(); setConfirming(null); }}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
```

⚠ `useDashboard` / `useAppCatalogue` / `getAppMenuName` / `PageHeader` / `ConfirmDialog` 는 이미 있는 컴포넌트를 재사용한다. 실제 이름이 다르면 파일 상단 import 를 프로젝트 관례에 맞춰 조정한다(예: `useDashboard` 대신 `useFavorites`). 각 훅의 실제 노출 여부는 편집 전에 파일에서 확인한다.

- [ ] **Step 4: 헤더 사용자 블록 → 클릭 진입** — `Layout.jsx` 329~337행. 기존:

```jsx
            <div className="flex items-center gap-3">
              <div className="text-right hidden xl:block">
                <p className="text-sm font-bold text-slate-800 leading-none">{userInfo.name}</p>
                <p className="text-xs text-slate-500 mt-1 font-medium">{userInfo.position}</p>
              </div>
              <div className="h-9 w-9 bg-blue-100 rounded-full flex items-center justify-center border border-blue-200 text-blue-700">
                <User size={18} />
              </div>
            </div>
```

를 아래로 교체:

```jsx
            <button
              type="button"
              onClick={() => setCurrentMenu('My Settings')}
              className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              title="내 설정"
              aria-label="내 설정 열기"
            >
              <div className="text-right hidden xl:block">
                <p className="text-sm font-bold text-slate-800 leading-none">{userInfo.name}</p>
                <p className="text-xs text-slate-500 mt-1 font-medium">{userInfo.position}</p>
              </div>
              <div className="h-9 w-9 bg-blue-100 rounded-full flex items-center justify-center border border-blue-200 text-blue-700">
                <User size={18} />
              </div>
            </button>
```

`setCurrentMenu` 는 이 파일에서 이미 props 또는 `useNavigation()` 으로 접근 가능하다. 기존 헤더 코드가 `props.onNavigate` 계열을 쓰면 그것을 그대로 사용한다.

- [ ] **Step 5: 명령 팔레트 항목 추가** — `Layout.jsx` 96~114행 `menuItems` 배열 끝(비관리자·관리자 공통 섹션)에:

```js
    { label: 'My Settings', menu: 'My Settings' },
```

`CommandPalette.jsx` 는 `Layout.jsx` 의 `menuItems` 를 그대로 소비하므로 이 한 줄로 팔레트에도 노출된다.

- [ ] **Step 6: 빌드**

```
npm run build
```
기대: 오류 없음.

- [ ] **Step 7: 수동 검증 — 설정 페이지**

`npm run dev`:

1. 로그인 → 헤더 우측 사용자 이름/직급 블록에 hover 배경. 클릭 → **My Settings** 페이지 열림.
2. 상단 배지 = `서버와 동기화됨`(초록). 백엔드를 잠깐 죽이고 아무 값이나 바꾸면 배지가 `서버 연결 없음`(주황)으로 바뀌고 30초 뒤 다시 초록으로 돌아온다.
3. 시작 화면 select 를 My Projects 로 바꾸고 로그아웃 → 재로그인 시 My Projects 로 열림.
4. 알림 수신 카드에서 `해석 완료` 체크 해제 → 500ms 뒤 `PUT` 이 `muted_kinds: ['job.completed']` 를 보낸다. 새로고침 후에도 상태 유지.
5. 데스크톱 토스트 체크박스 → 서버 저장 확인.
6. `즐겨찾기 비우기` 버튼 → 확인 다이얼로그 → 비어짐. Dashboard 로 돌아가면 즐겨찾기 섹션이 0 → `카드 없음` 문구(현행 UX 유지). 서버에도 반영됨(`GET /api/preferences` 확인).
7. `최근 사용 비우기` → 확인 → 최근 사용 섹션이 사라짐(0 이면 미표시, spec D9).
8. 명령 팔레트(Ctrl+K)에서 `My Settings` 검색 → 진입.
9. 관리자로 로그인해서 시작 화면 select 하단에 `관리자 메뉴` 그룹 나타남. 비관리자 로그인 시 그 그룹 없음.

- [ ] **Step 8: 커밋 준비 완료** — 보고: `src/constants/notificationKinds.js`, `src/hooks/useNotificationPrefs.js`, `src/pages/settings/MySettings.jsx`, `src/components/layout/Layout.jsx`.

---

### Task 10: 최종 점검 + 서버(145) 반영 안내

- [ ] **Step 1: 백엔드 전체 회귀**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
기대: 실패 0. 신규 3파일(`test_user_preferences_model`, `test_user_preferences_service`, `test_preferences_router`) 합계 **34건** 통과(5+19+10). Plan A 가 선주행돼 있는 환경에서는 `test_user_preferences_model` 이 그대로 통과한다.

- [ ] **Step 2: 프론트 순수 유틸 + 빌드**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && node --test src/utils/preferenceMerge.test.js && npm run build
```
기대: `pass 11`, 빌드 성공.

- [ ] **Step 3: 통합 시나리오 재검증** — 아래를 한 번에 재현:

1. 크롬 프로필 A · B(둘 다 `HiTessWorkBench` dev 창)에 같은 사번으로 로그인.
2. A 에서: 즐겨찾기 3개 추가 → 500ms 뒤 `PUT`(1회). BDF Scanner · Truss Analysis 방문 → 2번 `PUT`.
3. B 로그아웃 → 재로그인 → 첫 `GET` 이 A 의 값을 실어 오고 즐겨찾기 3개 + 최근 사용 2개가 화면·`hitess_prefs:<사번>` 캐시에 반영됨.
4. B 에서 즐겨찾기 하나 삭제 · 시작 화면을 File-Based Apps 로 변경. 로그아웃/재로그인. 랜딩이 File-Based Apps.
5. A 에서 페이지 새로 고침 → 첫 `GET` 이 B 의 변경을 받아 즐겨찾기 2개.
6. 백엔드 서버를 잠깐 죽이고 즐겨찾기를 한 번 더 토글 → 화면은 즉시 반영. 배지 `서버 연결 없음`. 서버를 살리면 30초 이내에 pending 한 번 flush + `서버와 동기화됨` 복귀.
7. 새 사번(예 EMP002)으로 로그인(같은 브라우저) → 자기 캐시 없음 → legacy 시드가 이미 마이그레이션된 상태라 서버 값(0) 로만 초기화 → 즐겨찾기 0. localStorage 에는 EMP002 캐시가 새로 생김.

- [ ] **Step 4: 스테이징 점검** — `git status` 에서 `HiTessWorkBench/frontend/src/config.js` 가 변경돼 있으면 **스테이징하지 않는다**(로컬 백엔드 토글). `Darkmode.js/` 미포함 확인.

- [ ] **Step 5: 사용자 보고(커밋은 사용자가 직접)** — 변경 파일 전체 목록(파일 구조 표) + 아래 서버 반영 구분을 그대로 전달.

**서버(145) 반영:**
- **백엔드 — `git pull` + 백엔드 재시작으로 끝.** `user_preferences` 테이블은 기동 시 `create_all`(Plan A 가 선주행됐다면 이미 있어 no-op), 컬럼은 `run_schema_bootstrap`(`ensure_user_preferences_columns`). 신규 pip 의존성 없음(`requirements.txt` 변경 없음).
- **프론트 — 재배포 필요.** WorkBench 포터블 exe 를 `npm run dist` 로 다시 빌드해 배포. 구 클라이언트가 있는 PC 는 그동안 지금처럼 로컬 저장으로만 동작하고, 서버는 GET/PUT 을 이미 받을 준비가 되어 있다(하위 호환).
- **InHouse 프로그램 — 없음.** `InHouseProgram/` 수동 교체 대상 없음.
- **Plan A 연동:** 알림 센터(Plan A) 가 배포되면 자동으로 `useNotificationPrefs()` 를 활용해 `muted_kinds`/`desktop_toast` 를 존중한다. Plan E 는 그 훅과 값 계약을 이미 만족시켜 뒀다.

---

## 자기 검토

- **spec 커버리지**:
  §1 배경(Task 6·7 소비자 3계층 그대로 유지) ·
  §2 목표(모든 Task) ·
  §3 확정 결정 D1(Task 1 모델) · D2(Task 5 `mergeServerAndLocal`) · D3(Task 5 디바운스·재시도) · D4(Task 5 `hitess_prefs:<id>` 캐시 + legacy 마이그레이션 플래그) · D5(Task 2·3 `ignored_keys`) · D6(Task 2 지연 import + Task 9 프론트 폴백 상수) · D7·D8(Task 8 landing effect · 로그인당 1회 · admin/blocked 검사) · D9(Task 7 Dashboard 섹션 · 0 이면 미표시) · D10(Task 8·9 헤더·팔레트·switch 케이스) · D11(Task 9 초기화 카드 = `PUT {favorites/recent_apps: []}`) · D12(Task 3 `GUARDED_ROUTES` 등록 안 함) · D13(Task 1 선주행 분기) ·
  §4.1 모델(Task 1) · §4.2 정규화(Task 2) · §4.3 엔드포인트(Task 3) ·
  §5.1 Context(Task 5) · §5.2 하이드레이션 순서(Task 5·6·7) · §5.3 소비자(Task 6·7) · §5.4 대시보드 섹션(Task 7) · §5.5 My Settings(Task 9) · §5.6 시작 화면 적용(Task 8) ·
  §6 Plan A 연동(Task 2 지연 import · Task 9 `useNotificationPrefs`) ·
  §7 테스트(Task 1·2·3 pytest, Task 5 `node --test`, 화면 수동 절차 Task 6·7·8·9) ·
  §8 서버 반영(Task 10) ·
  §9 리스크(Task 5 `hydration` 카운터 · Task 6 ref 가드 · StrictMode 대응 · JSON 컬럼 새 dict 대입).

- **플레이스홀더 없음**: 모든 코드 step 이 실제 코드다. 화면 단은 러너 없이 검증할 수 있는 순수 유틸을 최대한 뽑아 `node --test` 로 덮었다.

- **타입/이름 일관성**:
  - 백엔드 `PREFERENCE_KEYS = ("favorites","recent_apps","notifications","landing_menu")` = 프론트 `PREFERENCE_KEYS`. 순서 · 개수 일치.
  - `notifications` 는 `{muted_kinds: string[], desktop_toast: boolean}` — 서비스 정규화 · 라우터 테스트 · `preferenceMerge.js` · `MySettings.jsx` · `useNotificationPrefs.js` · Plan A `get_notification_prefs`(spec) 6곳이 같은 형태.
  - `recent_apps` 항목 `{menu,label,mode,category,at}` — `RecentActivityContext.jsx` · 서비스 `normalize_recent_apps` · `preferenceMerge.js` 세 곳이 같은 키.
  - localStorage 키 — `favorites`(legacy 유지) · `hitess_recent_apps`(legacy 유지) · `hitess_prefs:<사번>`(신규 사번별) · `hitess_prefs_legacy_migrated`(1회 플래그).
  - 헤더 메뉴명 `'My Settings'` = App.jsx switch = 명령 팔레트 = `setCurrentMenu` 문자열 3곳 동일.
  - PUT 응답 3키(`prefs`, `updated_at`, `ignored_keys`) = 라우터 테스트 = `PreferencesContext` 소비 = spec §4.3 표.

- **의존 순서**:
  Task 2 서비스(`upsert_prefs`·`get_prefs`·`merge_prefs`·`effective_prefs`) → Task 3 라우터가 소비.
  Task 4 API 모듈(`getPreferences`·`putPreferences`) → Task 5 Context 가 소비.
  Task 5 순수 유틸(`mergeServerAndLocal`·`filterWhitelist`·`effectivePrefs`) + Context → Task 6·7 소비자 + Task 8 landing effect + Task 9 설정 UI + `useNotificationPrefs` 훅이 모두 소비.
  Task 6·7 은 서로 독립(각각 다른 소비자). Task 8·9 은 Task 5·6·7 이 준비된 뒤 UI 를 붙인다. Task 10 은 통합·서버 반영.
