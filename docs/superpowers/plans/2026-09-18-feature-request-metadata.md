# 기능 요청 승격·게시판 통합 (Plan K) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `feature_requests` 테이블에 `module`·`priority` 컬럼을 승격하고, 기존 본문의 `[관련 모듈: X]\n[희망 중요도: Y]\n\n…` 접두를 1회 마이그레이션으로 컬럼에 옮긴 뒤, 두 게시판 화면(`Support/UserRequests.jsx` 전역, `components/analysis/AppCommunityHub.jsx` 앱별)이 동일한 `FeatureRequestBoard` 컴포넌트를 쓰도록 통합한다. `status` 어휘를 마스터 §2.11 이 지정한 4개(`Under Review | Planned | In Progress | Resolved`)로 정규화하고, 관리자가 상태를 바꾸는 순간 작성자에게 `notify(kind="feature_request.status_changed")` 알림 1건을 남긴다.

**Architecture:** 백엔드 — `models.FeatureRequest`(`module`/`priority` 컬럼 추가) + `schema_bootstrap.ensure_feature_request_columns` + `services/feature_request_service.py`(`normalize_status`, `parse_legacy_body`, `count_summary`, `list_autocomplete_modules`, `_migrate_feature_request_body_meta`) + `routers/support.py` 기존 라우트 5개에 컬럼/필터/알림 훅 + `GET /api/admin/feature-requests/summary` 신규. 프론트 — `api/featureRequests.js` 신규 + 순수 유틸 `utils/featureRequestBoard.js` + 공용 컴포넌트 `components/community/FeatureRequestBoard.jsx` + `Support/UserRequests.jsx` 축소 + `components/analysis/AppCommunityHub.jsx` `activeTab==='requests'` 블록 교체 + `components/admin/AdminFeatureRequestSummary.jsx`.

**Tech Stack:** Python 3.14 / FastAPI / SQLAlchemy(MySQL 운영, SQLite 테스트) / pytest — React 18 + Vite + Tailwind + lucide-react 0.284 + axios. 신규 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-18-feature-request-metadata-design.md` (마스터: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1·§2.11 — 이 plan 이 소유, §2.1 — 알림 서비스는 지연 import).

**규칙(마스터 §1):** 커밋은 사용자가 직접 한다 — 각 Task 마지막 단계는 **"커밋 준비 완료 — 변경 파일 목록을 사용자에게 보고"**. `HiTessWorkBench/frontend/src/config.js` 는 절대 스테이징하지 않는다. `Darkmode.js/` 는 건드리지 않는다. 백엔드는 TDD(실패 테스트 → 최소 구현 → 통과). 프론트는 러너가 없으므로 수동 검증 절차를 따른다(순수 유틸만 `node --test`). 문서·주석·UI 문구는 한국어, 식별자는 영어.

**테스트 실행 위치:** 모든 pytest 명령은 `C:\Coding\WorkBench\HiTessWorkBenchBackEnd` 에서 `WorkBenchEnv/Scripts/python.exe -m pytest …` 로 실행한다. 프론트 `node --test` 는 `C:\Coding\WorkBench\HiTessWorkBench\frontend` 에서 실행한다.

**Plan A(알림 센터) 와의 관계:** 이 plan 은 `notify()` 를 **지연 import** 로 호출한다(마스터 §2.1 규칙). Plan A 없이도 상태 변경 · 마이그레이션 · 필터 · 요약은 그대로 동작하며 알림만 건너뛴다. Plan A 가 있으면 `notify(kind="feature_request.status_changed", dedupe_key=f"fr:{id}:status", dedupe_unread_only=True)` 로 발신한다.

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `HiTessWorkBenchBackEnd/app/models.py` | 수정 | `FeatureRequest` 에 `module`, `priority` 컬럼 2개 추가 |
| `HiTessWorkBenchBackEnd/app/schemas.py` | 수정 | `FeatureRequestCreate`·`FeatureRequestUpdate`·`FeatureRequestResponse` 에 `module` / `priority` 옵셔널 추가 |
| `HiTessWorkBenchBackEnd/app/schema_bootstrap.py` | 수정 | `ensure_feature_request_columns()` + 마이그레이션 호출 + `run_schema_bootstrap()` 등록 |
| `HiTessWorkBenchBackEnd/app/services/feature_request_service.py` | 생성 | `normalize_status`, `parse_legacy_body`, `run_feature_request_migration`, `count_summary`, `list_autocomplete_modules` |
| `HiTessWorkBenchBackEnd/app/routers/support.py` | 수정 | `GET /feature-requests` 필터(module/priority/status/app_key/q), POST/PUT 컬럼 직접 저장 + legacy 자동 승격, `PUT …/comment` 정규화 + 알림 훅 |
| `HiTessWorkBenchBackEnd/app/routers/admin.py` | 수정 | `GET /api/admin/feature-requests/summary` 등록(require_admin) |
| `HiTessWorkBenchBackEnd/tests/test_feature_request_migration.py` | 생성 | 컬럼 추가·본문 파싱·멱등·status 정규화 |
| `HiTessWorkBenchBackEnd/tests/test_feature_request_service.py` | 생성 | `parse_legacy_body`·`normalize_status`·`count_summary` |
| `HiTessWorkBenchBackEnd/tests/test_feature_request_router.py` | 생성 | 필터·상태 변경 알림·요약 라우트 권한 |
| `HiTessWorkBenchBackEnd/tests/test_feature_request_schemas.py` | 생성 | Pydantic 스키마 옵셔널 필드 |
| `HiTessWorkBench/frontend/src/api/featureRequests.js` | 생성 | axios 함수 8개(list/create/update/upvote/delete/comment/summary/ app-scoped list) |
| `HiTessWorkBench/frontend/src/api/admin.js` | 수정 | 기존 기능요청 함수는 `featureRequests.js` 로 재-export(호출부는 그대로) |
| `HiTessWorkBench/frontend/src/api/appCommunity.js` | 수정 | 기존 request 계열 함수도 동일하게 재-export |
| `HiTessWorkBench/frontend/src/utils/featureRequestBoard.js` | 생성 | 순수 유틸(상태 정규화·모듈 어휘·filter·body 접두 감지) |
| `HiTessWorkBench/frontend/src/utils/featureRequestBoard.test.js` | 생성 | `node:test` |
| `HiTessWorkBench/frontend/src/components/community/FeatureRequestBoard.jsx` | 생성 | 공용 게시판(list+create+detail+filter) |
| `HiTessWorkBench/frontend/src/components/admin/AdminFeatureRequestSummary.jsx` | 생성 | 관리자 요약 카드(module × status 매트릭스) |
| `HiTessWorkBench/frontend/src/pages/Support/UserRequests.jsx` | 수정 | `<FeatureRequestBoard />` 로 축소, `stripMetaPreview` 삭제 |
| `HiTessWorkBench/frontend/src/components/analysis/AppCommunityHub.jsx` | 수정 | `activeTab==='requests'` 블록 → `<FeatureRequestBoard appKey={appKey} adminMode={isAdmin} />`, `REQUEST_STATUS` 4개로 축소 |

---

## 배경 확인 (사실 관계, 이 plan 이 밟고 갈 코드)

### 백엔드 현행

`HiTessWorkBenchBackEnd/app/models.py:163-175` — `FeatureRequest` 의 **실제 컬럼**:

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | `Integer PK` | |
| `app_key` | `String(100) NULL, index` | 전역이면 NULL, App 별 게시판이면 해당 key |
| `title` | `String(200)` | |
| `content` | `String(5000)` | ⚠️ **`description` 이 아니다** — 프론트가 모듈/중요도를 여기 앞머리에 박아 왔다 |
| `status` | `String(50) default="Under Review"` | |
| `upvotes` | `Integer default=0` | |
| `comments_count` | `Integer default=0` | `admin_comment` 존재 여부(0/1) 로 계속 사용 |
| `author_id` | `String(50)` | ⚠️ **`employee_id` 가 아니다** — Plan A 로 알림 발신 시 이 컬럼 값을 `notify(employee_id=…)` 에 넣는다 |
| `author_name` | `String(50)` | |
| `admin_comment` | `String(5000) NULL` | |
| `created_at` | `DateTime(timezone=True) default=datetime.now` | ⚠️ **`updated_at` 컬럼은 존재하지 않는다** — 이 plan 도 추가하지 않는다(§비목표) |

기존 라우트 (`HiTessWorkBenchBackEnd/app/routers/support.py`):

- `GET /feature-requests` (277~284): `app_key IS NULL` 만, `upvotes desc → created_at desc`.
- `GET /apps/{app_key}/feature-requests` (287~312): `board_enabled` 확인 후 반환.
- `POST /feature-requests` (315~321): `_request_payload(req, current_user, db)` 로 author_id/author_name 주입 후 저장.
- `PUT /feature-requests/{req_id}` (324~339): 작성자 or 관리자만. `title`·`content` 만 갱신.
- `PUT /feature-requests/{req_id}/upvote` (342~363): 유니크 제약(`FeatureRequestUpvote`) + 낙관적 갱신.
- `PUT /feature-requests/{req_id}/comment` (366~392): 관리자만, `status` + `admin_comment` + `comments_count = 1 if admin_comment else 0`. **여기가 알림 훅이 붙는 자리.**
- `DELETE /feature-requests/{req_id}` (395~): 작성자 or 관리자.

`HiTessWorkBenchBackEnd/app/schemas.py:59-87`:

```python
class FeatureRequestCreate(BaseModel):
    title: str
    content: str
    author_id: str
    author_name: str
    app_key: Optional[str] = None

class FeatureRequestUpdate(BaseModel):
    title: str
    content: str

class FeatureRequestResponse(FeatureRequestCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: str
    upvotes: int
    comments_count: int
    admin_comment: Optional[str] = None
    created_at: datetime
    upvoted_by_me: bool = False

class FeatureRequestComment(BaseModel):
    status: str
    admin_comment: str
```

`HiTessWorkBenchBackEnd/app/schema_bootstrap.py` — 이번 plan 이 추가할 자리:

- `_add_missing_columns(table, {col: ALTER…})` / `_add_missing_indexes(table, {ix: CREATE INDEX…})` 헬퍼는 이미 존재(1~55행).
- 기존 `ensure_app_community_columns()`(90~113)가 `feature_requests` 에 `app_key`·`ix_feature_requests_app_key` 를 이미 추가한다 — **같은 파일에** `ensure_feature_request_columns()` 를 추가해 두 번째 마이그레이션 창구를 만든다.
- `run_schema_bootstrap()`(152~160)의 `ensure_chat_message_columns(engine=engine)` 다음 줄에 호출 추가.

### 프론트 현행

**`HiTessWorkBench/frontend/src/pages/Support/UserRequests.jsx`** (검증):

- Line 12~15: `stripMetaPreview(content)` — 정규식 `/^\s*(\[[^\]]*\]\s*\n?)+/` 로 본문 앞의 `[…]` 대괄호 라인을 걷어낸다. 카드/리스트 미리보기 전용(175·208행에서 호출).
- Line 29~34: `formData` 기본값 `{module: '공통 (UI / UX / Dashboard)', priority: '보통 (업무 효율성 향상)', title: '', content: ''}`.
- Line 70: 저장 시 `finalContent = [관련 모듈: ${formData.module}]\n[희망 중요도: ${formData.priority}]\n\n${formData.content}` — 컬럼이 없으니 본문 앞에 박아 왔다.
- Line 104~110: `statusColors` 5개(`Under Review`·`Planned`·`In Progress`·`Resolved`·`Completed`).
- Line 112: `resolvedStatuses = new Set(['Resolved', 'Completed', 'Done', '해결 완료'])` — 완료 판정.
- Line 308~316: 모듈 select 옵션 4개 **하드코딩** — `공통 (UI / UX / Dashboard)`·`Truss Analysis`·`Pipe Analysis`·`Interactive Apps`. 중요도 select 옵션 3개 **하드코딩** — `낮음 (있으면 좋음)`·`보통 (업무 효율성 향상)`·`높음 (핵심 기능 버그/부재)`. ⚠ 마스터 §2.11 는 어휘 4개(`낮음`/`보통`/`높음`/`긴급`)를 명시했지만 현행에는 `긴급` 이 없다 — 새 UI 에 `긴급` 을 추가한다.

**`HiTessWorkBench/frontend/src/components/analysis/AppCommunityHub.jsx`** (검증):

- Line 48~54: `REQUEST_STATUS` — **5개**(`Under Review`, `Planned`, `In Progress`, `Resolved`, `Completed`). Plan K 이 4개로 축소.
- Line 151: `adminReply` 기본 status `'Under Review'`.
- Line 1117~1121: 상태 dropdown 옵션 5개 하드코딩(`<option value="Completed">완료</option>` 포함). Plan K 이 삭제.

**API 모듈 분할 현행:**

- `frontend/src/api/admin.js:72-89` — `getFeatureRequests`, `createFeatureRequest`, `upvoteFeatureRequest`, `commentFeatureRequest`, `deleteFeatureRequest` (5개, 전역 게시판용).
- `frontend/src/api/appCommunity.js:40-65` — App 스코프 list/create/update/delete/upvote/comment (6개). 프리픽스 `${appPath(appKey)}/feature-requests`.

Plan K 은 이 두 벌을 **`src/api/featureRequests.js`** 하나로 모으고, 기존 파일의 함수는 그 모듈에서 **재-export** 만 하도록 축소해 호출부는 점진 교체(수정 범위를 줄인다).

---

## Legacy 본문 파싱 규칙 (예시 표)

`services/feature_request_service.py::parse_legacy_body(content)` 가 처리할 실제 케이스. 정규식:

```
^\s*\[관련 모듈:\s*([^\]]*)\]\s*\n?
^\s*\[희망 중요도:\s*([^\]]*)\]\s*\n?
```

두 정규식을 앞머리에서 루프로 벗겨 낸 뒤 남은 앞쪽 공백/줄바꿈은 trim. 순서 무관.

| # | 원본 본문(literal, `⏎` = 개행) | `module` 결과 | `priority` 원본 | `priority` 정규화 | 남은 `content` |
|---|---|---|---|---|---|
| 1 | `[관련 모듈: 공통 (UI / UX / Dashboard)]⏎[희망 중요도: 보통 (업무 효율성 향상)]⏎⏎Truss 결과의 엑셀 다운로드 기능 추가` | `공통 (UI / UX / Dashboard)` | `보통 (업무 효율성 향상)` | `보통` | `Truss 결과의 엑셀 다운로드 기능 추가` |
| 2 | `[관련 모듈: Truss Analysis]⏎[희망 중요도: 낮음 (있으면 좋음)]⏎⏎Property ID 필터 UI` | `Truss Analysis` | `낮음 (있으면 좋음)` | `낮음` | `Property ID 필터 UI` |
| 3 | `[관련 모듈: Pipe Analysis]⏎[희망 중요도: 높음 (핵심 기능 버그/부재)]⏎⏎배관 요소 색상 커스터마이즈` | `Pipe Analysis` | `높음 (핵심 기능 버그/부재)` | `높음` | `배관 요소 색상 커스터마이즈` |
| 4 | `[희망 중요도: 보통 (업무 효율성 향상)]⏎[관련 모듈: Interactive Apps]⏎⏎순서 뒤바뀐 케이스` (사용자 손편집) | `Interactive Apps` | `보통 (업무 효율성 향상)` | `보통` | `순서 뒤바뀐 케이스` |
| 5 | `[관련 모듈: Truss Analysis]⏎⏎모듈만 있고 중요도 없음(과거 실수)` | `Truss Analysis` | — | `None` | `모듈만 있고 중요도 없음(과거 실수)` |
| 6 | `AppCommunityHub 에서 올린 글(접두 없음, 순수 본문)⏎여러 줄 이어짐` | `None` | — | `None` | 원본 그대로(파싱 no-op) |
| 7 | `[관련 모듈: ]⏎[희망 중요도: ]⏎⏎값이 빈 대괄호` | `None`(공백 → None) | 빈 값 | `None` | `값이 빈 대괄호` |
| 8 | `[관련 모듈: HiTess ModelFlow  ⏎  본문` (닫는 `]` 누락) | `None`(정규식 매치 실패) | — | `None` | 원본 그대로 |
| 9 | `[관련 모듈: 공통 (UI / UX / Dashboard)]⏎[희망 중요도: 긴급]⏎⏎신규 어휘 케이스(사용자가 직접 편집)` | `공통 (UI / UX / Dashboard)` | `긴급` | `긴급` | `신규 어휘 케이스(사용자가 직접 편집)` |
| 10 | `[관련 모듈: Pipe Analysis]⏎[희망 중요도: 매우 높음]⏎⏎어휘 밖(신중요도)` | `Pipe Analysis` | `매우 높음` | `None` (매치 실패 → priority=None, 본문에서는 두 줄 소비) | `어휘 밖(신중요도)` |

**규정:**

1. 정규화는 **접두 매치**로 한다. `낮음|보통|높음|긴급` 중 첫 어휘가 값의 시작이면 그 어휘를 채택. 매치 실패면 `None`.
2. 두 줄 다 매치되면 두 줄 모두 소비 후 남은 `\n` 도 trim. 하나만 매치되면 그 한 줄만 소비.
3. 어느 쪽도 매치 실패이면 `(None, None, content)` — 원본 그대로. 마이그레이션이 이 행에 `UPDATE` 를 걸지 않아 **두 번째 실행은 no-op**(멱등 sentinel).
4. `module` 은 자유 문자열이라 값을 그대로 저장(공백만 trim, 100자 초과 시 잘라 넣음). 빈 값은 `None`.

---

### Task 1: `FeatureRequest.module`·`priority` 컬럼 + 스키마 부트스트랩

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/models.py:163-175` (컬럼 2개 추가)
- Modify: `HiTessWorkBenchBackEnd/app/schemas.py:59-83` (Pydantic 3개 스키마)
- Modify: `HiTessWorkBenchBackEnd/app/schema_bootstrap.py:116-121` 뒤(함수 추가), `:152-160`(등록)
- Create: `HiTessWorkBenchBackEnd/tests/test_feature_request_migration.py`
- Create: `HiTessWorkBenchBackEnd/tests/test_feature_request_schemas.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_feature_request_migration.py`:

```python
"""feature_requests 컬럼(module/priority) 추가 및 본문 마이그레이션 회귀 테스트."""
from datetime import datetime

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app import models
from app.schema_bootstrap import (
    ensure_feature_request_columns,
    run_schema_bootstrap,
)


def _sqlite_engine():
    return create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def test_create_all_includes_module_and_priority():
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("feature_requests")}
    # 기존 컬럼은 그대로다(회귀).
    assert {
        "id", "app_key", "title", "content", "status", "upvotes",
        "comments_count", "author_id", "author_name", "admin_comment",
        "created_at",
    } <= cols
    # 신규 컬럼 2개.
    assert "module" in cols and "priority" in cols


def test_bootstrap_adds_missing_columns_and_indexes():
    """운영 DB 에 컬럼이 빠진 채 테이블만 있어도 bootstrap 이 채운다(멱등)."""
    engine = _sqlite_engine()
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE feature_requests ("
            " id INTEGER PRIMARY KEY,"
            " app_key VARCHAR(100) NULL,"
            " title VARCHAR(200), content VARCHAR(5000),"
            " status VARCHAR(50) DEFAULT 'Under Review',"
            " upvotes INTEGER DEFAULT 0, comments_count INTEGER DEFAULT 0,"
            " author_id VARCHAR(50), author_name VARCHAR(50),"
            " admin_comment VARCHAR(5000) NULL,"
            " created_at DATETIME)"
        ))

    ensure_feature_request_columns(engine=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("feature_requests")}
    assert {"module", "priority"} <= cols
    ix = {i["name"] for i in inspect(engine).get_indexes("feature_requests")}
    assert "ix_feature_requests_module" in ix
    assert "ix_feature_requests_priority" in ix

    # 두 번 돌려도 예외 없이 같은 결과
    ensure_feature_request_columns(engine=engine)
    assert {c["name"] for c in inspect(engine).get_columns("feature_requests")} == cols


def test_run_schema_bootstrap_calls_feature_request_bootstrap(monkeypatch):
    called = []
    import app.schema_bootstrap as sb
    monkeypatch.setattr(
        sb,
        "ensure_feature_request_columns",
        lambda *, engine=None: called.append("fr"),
    )
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    run_schema_bootstrap(engine=engine)
    assert "fr" in called


def _insert_legacy(db, **overrides):
    """schema 는 신규 컬럼을 갖고 있지만 값은 NULL 로 들어간 과거 행을 삽입한다."""
    row = models.FeatureRequest(
        title=overrides.get("title", "테스트 제안"),
        content=overrides["content"],
        status=overrides.get("status", "Under Review"),
        author_id=overrides.get("author_id", "EMP001"),
        author_name=overrides.get("author_name", "홍길동"),
        app_key=overrides.get("app_key"),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_migration_splits_legacy_body_into_columns(db_session):
    row = _insert_legacy(db_session, content=(
        "[관련 모듈: 공통 (UI / UX / Dashboard)]\n"
        "[희망 중요도: 보통 (업무 효율성 향상)]\n\n"
        "Truss 결과의 엑셀 다운로드 기능 추가"
    ))
    from app.services.feature_request_service import run_feature_request_migration
    run_feature_request_migration(db_session)

    db_session.expire_all()
    r = db_session.get(models.FeatureRequest, row.id)
    assert r.module == "공통 (UI / UX / Dashboard)"
    assert r.priority == "보통"
    assert r.content == "Truss 결과의 엑셀 다운로드 기능 추가"


def test_migration_handles_reversed_order(db_session):
    row = _insert_legacy(db_session, content=(
        "[희망 중요도: 낮음 (있으면 좋음)]\n"
        "[관련 모듈: Truss Analysis]\n\n"
        "순서 뒤바뀐 케이스"
    ))
    from app.services.feature_request_service import run_feature_request_migration
    run_feature_request_migration(db_session)

    db_session.expire_all()
    r = db_session.get(models.FeatureRequest, row.id)
    assert r.module == "Truss Analysis"
    assert r.priority == "낮음"
    assert r.content == "순서 뒤바뀐 케이스"


def test_migration_leaves_bodies_without_prefix_untouched(db_session):
    row = _insert_legacy(db_session, content="접두 없음 — 원본 그대로 유지되어야 한다")
    from app.services.feature_request_service import run_feature_request_migration
    run_feature_request_migration(db_session)

    db_session.expire_all()
    r = db_session.get(models.FeatureRequest, row.id)
    assert r.module is None and r.priority is None
    assert r.content == "접두 없음 — 원본 그대로 유지되어야 한다"


def test_migration_is_idempotent_on_second_run(db_session):
    _insert_legacy(db_session, content=(
        "[관련 모듈: Pipe Analysis]\n"
        "[희망 중요도: 높음 (핵심 기능 버그/부재)]\n\n"
        "배관 요소 색상 커스터마이즈"
    ))
    from app.services.feature_request_service import run_feature_request_migration
    first = run_feature_request_migration(db_session)
    second = run_feature_request_migration(db_session)
    assert first == 1
    assert second == 0


def test_migration_normalizes_legacy_status(db_session):
    r1 = _insert_legacy(db_session, content="완료 표기 정규화", status="Completed")
    r2 = _insert_legacy(db_session, content="Done 표기 정규화", status="Done")
    r3 = _insert_legacy(db_session, content="한글 표기 정규화", status="해결 완료")
    r4 = _insert_legacy(db_session, content="이미 Resolved", status="Resolved")
    r5 = _insert_legacy(db_session, content="Under Review 그대로", status="Under Review")

    from app.services.feature_request_service import run_feature_request_migration
    run_feature_request_migration(db_session)

    db_session.expire_all()
    for pk in (r1.id, r2.id, r3.id, r4.id):
        assert db_session.get(models.FeatureRequest, pk).status == "Resolved"
    assert db_session.get(models.FeatureRequest, r5.id).status == "Under Review"


def test_migration_ignores_body_with_broken_bracket(db_session):
    row = _insert_legacy(db_session, content=(
        "[관련 모듈: HiTess ModelFlow  \n"
        "  본문 (닫는 대괄호 누락)"
    ))
    from app.services.feature_request_service import run_feature_request_migration
    run_feature_request_migration(db_session)

    db_session.expire_all()
    r = db_session.get(models.FeatureRequest, row.id)
    assert r.module is None
    assert r.content.startswith("[관련 모듈: HiTess ModelFlow")
```

`HiTessWorkBenchBackEnd/tests/test_feature_request_schemas.py`:

```python
"""FeatureRequestCreate/Update/Response Pydantic 스키마 회귀."""
from app import schemas


def test_create_accepts_module_and_priority_as_optional():
    payload = schemas.FeatureRequestCreate(
        title="제안", content="본문",
        author_id="EMP001", author_name="홍길동",
    )
    assert payload.module is None and payload.priority is None

    with_meta = schemas.FeatureRequestCreate(
        title="제안", content="본문",
        author_id="EMP001", author_name="홍길동",
        module="Truss Analysis", priority="긴급",
    )
    assert with_meta.module == "Truss Analysis"
    assert with_meta.priority == "긴급"


def test_update_accepts_module_and_priority_as_optional():
    payload = schemas.FeatureRequestUpdate(
        title="제안 수정", content="본문 수정",
        module="Pipe Analysis", priority="높음",
    )
    assert payload.module == "Pipe Analysis"
    assert payload.priority == "높음"

    minimal = schemas.FeatureRequestUpdate(title="제안", content="본문")
    assert minimal.module is None and minimal.priority is None


def test_response_exposes_new_fields(db_session):
    from app import models
    row = models.FeatureRequest(
        title="제안", content="본문", author_id="EMP001", author_name="홍길동",
        module="Truss Analysis", priority="높음", status="Under Review",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)

    dumped = schemas.FeatureRequestResponse.model_validate(row).model_dump()
    assert dumped["module"] == "Truss Analysis"
    assert dumped["priority"] == "높음"
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_feature_request_migration.py tests/test_feature_request_schemas.py -q
```

기대: `ImportError` / `AttributeError` 로 수집 단계 실패 — `ensure_feature_request_columns`, `run_feature_request_migration`, `FeatureRequest.module`, `FeatureRequestCreate.module` 이 아직 없음.

- [ ] **Step 3: 모델 컬럼 추가** — `app/models.py` 163~175 행의 `FeatureRequest` 클래스에 컬럼 2줄 추가. 이 파일은 클래스 본문이 **2칸 들여쓰기**다. `admin_comment` 뒤, `created_at` 앞:

```python
class FeatureRequest(Base):
  __tablename__ = "feature_requests"
  id = Column(Integer, primary_key=True, index=True)
  app_key = Column(String(100), nullable=True, index=True)
  title = Column(String(200))
  content = Column(String(5000))
  status = Column(String(50), default="Under Review")
  upvotes = Column(Integer, default=0)
  comments_count = Column(Integer, default=0)
  author_id = Column(String(50))
  author_name = Column(String(50))
  admin_comment = Column(String(5000), nullable=True)
  # 관련 모듈: 마스터 §2.11 로 컬럼 승격됨(자유 문자열, 이전엔 본문 앞머리에 `[관련 모듈: …]` 로 박아 왔다).
  module = Column(String(100), nullable=True, index=True)
  # 희망 중요도: 어휘 4개(낮음/보통/높음/긴급). enum 은 강제하지 않고 서비스 계층이 정규화.
  priority = Column(String(20), nullable=True, index=True)
  created_at = Column(DateTime(timezone=True), default=datetime.now)
```

- [ ] **Step 4: Pydantic 스키마 확장** — `app/schemas.py:59-87` 을 아래로 교체:

```python
class FeatureRequestCreate(BaseModel):
    title: str
    content: str
    author_id: str
    author_name: str
    app_key: Optional[str] = None
    # 마스터 §2.11 — 컬럼 승격 후 프론트가 직접 넘긴다. 없으면 서비스가 legacy body 에서 파싱한다.
    module: Optional[str] = None
    priority: Optional[str] = None


class FeatureRequestUpdate(BaseModel):
    title: str
    content: str
    module: Optional[str] = None
    priority: Optional[str] = None


class FeatureRequestResponse(FeatureRequestCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    upvotes: int
    comments_count: int
    admin_comment: Optional[str] = None
    created_at: datetime
    # 요청 사용자가 이미 추천했는지 여부(앱 스코프 목록에서만 채워지며 그 외에는 False).
    upvoted_by_me: bool = False


class FeatureRequestComment(BaseModel):
    status: str
    admin_comment: str
```

- [ ] **Step 5: 부트스트랩 함수 추가** — `app/schema_bootstrap.py` 의 `ensure_chat_message_columns`(116~121행) 바로 아래에:

```python


def ensure_feature_request_columns(*, engine=None) -> None:
    """기능 요청 게시판(Plan K)의 컬럼·인덱스·본문 마이그레이션을 멱등하게 적용합니다.

    - module/priority 컬럼은 기존 운영 DB 에도 안전하게 추가한다.
    - 이후 서비스 계층의 run_feature_request_migration() 을 호출해 legacy 본문의
      `[관련 모듈: …]\\n[희망 중요도: …]` 접두를 컬럼으로 옮기고 본문에서 제거한다.
      이 마이그레이션은 파싱 결과가 (None, None) 이면 UPDATE 를 걸지 않아 **두 번째 실행은 no-op**.
    """
    _add_missing_columns("feature_requests", {
        "module": "ALTER TABLE feature_requests ADD COLUMN module VARCHAR(100) NULL",
        "priority": "ALTER TABLE feature_requests ADD COLUMN priority VARCHAR(20) NULL",
    }, engine=engine)
    _add_missing_indexes("feature_requests", {
        "ix_feature_requests_module": (
            "CREATE INDEX ix_feature_requests_module ON feature_requests (module)"
        ),
        "ix_feature_requests_priority": (
            "CREATE INDEX ix_feature_requests_priority ON feature_requests (priority)"
        ),
    }, engine=engine)
    # 본문 → 컬럼 승격은 지연 import: 이 함수가 서비스 모듈 없이도 import 될 수 있어야 한다.
    try:
        from .services.feature_request_service import run_feature_request_migration
    except ImportError:
        return
    from . import database as _database
    target_engine = engine or _database.engine
    from sqlalchemy.orm import Session
    with Session(target_engine) as session:
        run_feature_request_migration(session)
```

`run_schema_bootstrap()`(152~160) 의 `ensure_chat_message_columns(engine=engine)` 다음 줄에 호출을 추가:

```python
    ensure_chat_message_columns(engine=engine)
    ensure_feature_request_columns(engine=engine)
    ensure_app_spaces(engine=engine)
```

⚠ 이 시점에는 `feature_request_service.run_feature_request_migration` 이 아직 없다 — `try/except ImportError` 로 감쌌으므로 Task 2 가 서비스 모듈을 만들 때까지 no-op 이다. 테스트 `test_migration_splits_legacy_body_into_columns` 등은 Task 2 완료 후 통과한다.

- [ ] **Step 6: 통과 확인 (부분)**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_feature_request_migration.py::test_create_all_includes_module_and_priority tests/test_feature_request_migration.py::test_bootstrap_adds_missing_columns_and_indexes tests/test_feature_request_migration.py::test_run_schema_bootstrap_calls_feature_request_bootstrap tests/test_feature_request_schemas.py -q
```

기대: `6 passed`. 나머지 마이그레이션 케이스(파싱)는 Task 2 에서 통과.

전체 회귀(모델 변경이라 한 번 돈다):

```
WorkBenchEnv/Scripts/python.exe -m pytest tests -q -x --deselect tests/test_feature_request_migration.py::test_migration_splits_legacy_body_into_columns --deselect tests/test_feature_request_migration.py::test_migration_handles_reversed_order --deselect tests/test_feature_request_migration.py::test_migration_leaves_bodies_without_prefix_untouched --deselect tests/test_feature_request_migration.py::test_migration_is_idempotent_on_second_run --deselect tests/test_feature_request_migration.py::test_migration_normalizes_legacy_status --deselect tests/test_feature_request_migration.py::test_migration_ignores_body_with_broken_bracket
```

기대: 기존 회귀 실패 0.

- [ ] **Step 7: 커밋 준비 완료** — 보고: `app/models.py`, `app/schemas.py`, `app/schema_bootstrap.py`, `tests/test_feature_request_migration.py`, `tests/test_feature_request_schemas.py`.

---

### Task 2: `services/feature_request_service.py` — 계약과 마이그레이션

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/feature_request_service.py`
- Create: `HiTessWorkBenchBackEnd/tests/test_feature_request_service.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_feature_request_service.py`:

```python
"""feature_request_service — normalize_status / parse_legacy_body / summary / autocomplete."""
import pytest

from app import models
from app.services.feature_request_service import (
    FEATURE_REQUEST_STATUSES,
    FEATURE_REQUEST_PRIORITIES,
    count_summary,
    list_autocomplete_modules,
    normalize_status,
    parse_legacy_body,
)


def test_status_vocabulary_is_locked_to_four():
    """마스터 §2.11 는 Under Review / Planned / In Progress / Resolved 4개로 고정."""
    assert FEATURE_REQUEST_STATUSES == (
        "Under Review", "Planned", "In Progress", "Resolved",
    )


def test_priority_vocabulary():
    assert FEATURE_REQUEST_PRIORITIES == ("낮음", "보통", "높음", "긴급")


@pytest.mark.parametrize("legacy,expected", [
    ("Completed", "Resolved"),
    ("Done", "Resolved"),
    ("해결 완료", "Resolved"),
    ("완료", "Resolved"),
    ("Under Review", "Under Review"),
    ("Planned", "Planned"),
    ("In Progress", "In Progress"),
    ("Resolved", "Resolved"),
])
def test_normalize_status_maps_legacy(legacy, expected):
    assert normalize_status(legacy) == expected


def test_normalize_status_rejects_unknown():
    with pytest.raises(ValueError):
        normalize_status("Rejected")
    with pytest.raises(ValueError):
        normalize_status("")


def test_parse_legacy_body_both_in_order():
    module, priority, body = parse_legacy_body(
        "[관련 모듈: 공통 (UI / UX / Dashboard)]\n"
        "[희망 중요도: 보통 (업무 효율성 향상)]\n\n"
        "본문"
    )
    assert module == "공통 (UI / UX / Dashboard)"
    assert priority == "보통"
    assert body == "본문"


def test_parse_legacy_body_reversed_order():
    module, priority, body = parse_legacy_body(
        "[희망 중요도: 높음 (핵심 기능 버그/부재)]\n"
        "[관련 모듈: Truss Analysis]\n\n"
        "본문 두 번째"
    )
    assert module == "Truss Analysis"
    assert priority == "높음"
    assert body == "본문 두 번째"


def test_parse_legacy_body_only_module_present():
    module, priority, body = parse_legacy_body(
        "[관련 모듈: Interactive Apps]\n\n"
        "모듈만 있고 중요도 없음"
    )
    assert module == "Interactive Apps"
    assert priority is None
    assert body == "모듈만 있고 중요도 없음"


def test_parse_legacy_body_no_prefix_returns_original():
    module, priority, body = parse_legacy_body("접두 없음 — 원본 유지")
    assert (module, priority, body) == (None, None, "접두 없음 — 원본 유지")


def test_parse_legacy_body_empty_brackets_yield_none_but_consume_line():
    module, priority, body = parse_legacy_body(
        "[관련 모듈: ]\n[희망 중요도: ]\n\n값 없음"
    )
    assert module is None and priority is None
    assert body == "값 없음"


def test_parse_legacy_body_broken_bracket_is_pass_through():
    src = "[관련 모듈: HiTess ModelFlow  \n  본문 (닫는 대괄호 누락)"
    assert parse_legacy_body(src) == (None, None, src)


def test_parse_legacy_body_priority_urgent_new_vocab():
    module, priority, body = parse_legacy_body(
        "[관련 모듈: 공통 (UI / UX / Dashboard)]\n"
        "[희망 중요도: 긴급]\n\n"
        "긴급 문서 요청"
    )
    assert priority == "긴급"
    assert body == "긴급 문서 요청"


def test_parse_legacy_body_unknown_priority_stripped_but_none():
    """어휘 밖은 매치 실패로 priority=None 이 되지만 대괄호 줄은 소비된다."""
    module, priority, body = parse_legacy_body(
        "[관련 모듈: Pipe Analysis]\n"
        "[희망 중요도: 매우 높음]\n\n"
        "어휘 밖"
    )
    assert module == "Pipe Analysis"
    assert priority is None
    assert body == "어휘 밖"


def test_parse_legacy_body_truncates_module_to_100_chars():
    long_module = "A" * 200
    module, _, _ = parse_legacy_body(f"[관련 모듈: {long_module}]\n\n본문")
    assert module is not None
    assert len(module) == 100


def _make_request(db, *, module=None, priority=None, status="Under Review", app_key=None):
    row = models.FeatureRequest(
        title="제안", content="본문",
        author_id="EMP001", author_name="홍길동",
        module=module, priority=priority, status=status, app_key=app_key,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_count_summary_groups_by_module_and_status(db_session):
    _make_request(db_session, module="Truss Analysis", priority="높음", status="Under Review")
    _make_request(db_session, module="Truss Analysis", priority="보통", status="Planned")
    _make_request(db_session, module="Pipe Analysis",  priority="높음", status="Under Review")
    _make_request(db_session, module=None,             priority=None,   status="Resolved")

    summary = count_summary(db_session)
    assert summary["total"] == 4

    matrix = {(row["module"], row["status"]): row["count"] for row in summary["by_module_status"]}
    assert matrix[("Truss Analysis", "Under Review")] == 1
    assert matrix[("Truss Analysis", "Planned")] == 1
    assert matrix[("Pipe Analysis", "Under Review")] == 1
    assert matrix[(None, "Resolved")] == 1

    priorities = {row["priority"]: row["count"] for row in summary["by_priority"]}
    assert priorities.get("높음") == 2
    assert priorities.get("보통") == 1

    assert "Truss Analysis" in summary["modules"]


def test_autocomplete_modules_order_by_frequency(db_session):
    for _ in range(3):
        _make_request(db_session, module="Truss Analysis")
    for _ in range(2):
        _make_request(db_session, module="Pipe Analysis")
    _make_request(db_session, module="Interactive Apps")

    modules = list_autocomplete_modules(db_session)
    assert modules[0] == "Truss Analysis"
    assert modules[1] == "Pipe Analysis"
    assert "Interactive Apps" in modules
    # NULL 은 목록에 오지 않는다.
    assert None not in modules
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_feature_request_service.py -q
```

기대: `ModuleNotFoundError: No module named 'app.services.feature_request_service'`.

- [ ] **Step 3: 서비스 구현** — `HiTessWorkBenchBackEnd/app/services/feature_request_service.py`:

```python
"""기능 요청(feature_requests) 도메인 서비스 — 마스터 §2.11(Plan K) 소유.

책임:
  1. status 어휘 정규화(normalize_status) — Completed/Done/해결 완료/완료 → Resolved.
  2. legacy 본문 파싱(parse_legacy_body) — `[관련 모듈: …]` / `[희망 중요도: …]` 접두 해체.
  3. 1회 마이그레이션(run_feature_request_migration) — 컬럼 승격 이후 기존 행에 적용.
     파싱 결과가 (None, None) 이고 status 도 정상이면 UPDATE 를 걸지 않는다 → 멱등.
  4. 관리자 요약(count_summary) 과 자유 문자열 모듈 자동완성(list_autocomplete_modules).

지연 import 규약: `notify()` 는 이 모듈에서 부르지 않는다(라우터가 부른다) — 이 모듈은
notification_service 를 참조하지 않아 Plan A 없이도 완결된다.
"""
import re
from typing import Iterable

from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models

# 마스터 §2.11 — 4개로 고정. 새 상태 추가는 이 튜플과 마스터 문서를 함께 고친다.
FEATURE_REQUEST_STATUSES: tuple[str, ...] = (
    "Under Review",
    "Planned",
    "In Progress",
    "Resolved",
)

# 사용자 결정 — 4개(신규 어휘 '긴급' 포함). enum 은 강제하지 않고 정규화만.
FEATURE_REQUEST_PRIORITIES: tuple[str, ...] = ("낮음", "보통", "높음", "긴급")

_LEGACY_STATUS_ALIASES = {
    "completed": "Resolved",
    "done": "Resolved",
    "해결 완료": "Resolved",
    "완료": "Resolved",
}

_MODULE_LINE = re.compile(r"^\s*\[관련 모듈:\s*([^\]]*)\]\s*\n?")
_PRIORITY_LINE = re.compile(r"^\s*\[희망 중요도:\s*([^\]]*)\]\s*\n?")

_MODULE_MAX_LEN = 100
_PRIORITY_MAX_LEN = 20


def normalize_status(value: str | None) -> str:
    """어휘 4개로 강제 정규화한다. 어휘 밖(빈 값 포함)은 ValueError.

    write 경로(create · update · admin comment · 마이그레이션) 모두가 이 함수를 거친다.
    """
    if value is None:
        raise ValueError("status must not be None")
    text = value.strip()
    if not text:
        raise ValueError("status must not be blank")
    # 정규화 매핑을 대소문자·공백 무시로 조회한다.
    alias = _LEGACY_STATUS_ALIASES.get(text.lower())
    if alias:
        return alias
    alias = _LEGACY_STATUS_ALIASES.get(text)
    if alias:
        return alias
    if text in FEATURE_REQUEST_STATUSES:
        return text
    raise ValueError(f"unknown feature request status: {value!r}")


def _match_priority(raw: str | None) -> str | None:
    """중요도 원본에서 어휘 4개 중 하나를 뽑는다. 매치 실패면 None."""
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    for canonical in FEATURE_REQUEST_PRIORITIES:
        if text == canonical or text.startswith(canonical + " ") or text.startswith(canonical + "("):
            return canonical
    # 원문이 정확히 어휘 하나로만 이뤄진 경우.
    if text in FEATURE_REQUEST_PRIORITIES:
        return text
    return None


def _trim_module(raw: str | None) -> str | None:
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    return text[:_MODULE_MAX_LEN]


def parse_legacy_body(content: str) -> tuple[str | None, str | None, str]:
    """본문 앞머리의 `[관련 모듈:…]` / `[희망 중요도:…]` 접두를 벗겨 (module, priority, stripped_body).

    - 순서는 무관하다. 반복해서 앞머리를 벗기다가 어느 정규식도 매치되지 않으면 멈춘다.
    - 값이 빈 대괄호(`[관련 모듈: ]`)는 그 줄만 소비하고 값은 None.
    - 어느 접두도 없으면 (None, None, content) 를 그대로 돌려준다 — 마이그레이션의 no-op sentinel.
    - 닫는 `]` 가 없으면 정규식이 매치되지 않아 원본이 유지된다.
    """
    if not content:
        return None, None, content or ""

    module_raw: str | None = None
    priority_raw: str | None = None
    rest = content
    # 최대 2회 루프면 두 접두를 다 소비할 수 있다(같은 접두가 두 번 오는 이상 데이터도 방어).
    for _ in range(4):
        m = _MODULE_LINE.match(rest)
        if m:
            if module_raw is None:
                module_raw = m.group(1)
            rest = rest[m.end():]
            continue
        p = _PRIORITY_LINE.match(rest)
        if p:
            if priority_raw is None:
                priority_raw = p.group(1)
            rest = rest[p.end():]
            continue
        break

    if module_raw is None and priority_raw is None:
        # 아무 것도 못 벗겼다 — 원본 그대로.
        return None, None, content

    module = _trim_module(module_raw)
    priority = _match_priority(priority_raw)
    stripped = rest.lstrip("\r\n")
    return module, priority, stripped


def _needs_migration(row: models.FeatureRequest) -> bool:
    if row.module is None or row.priority is None:
        return True
    if row.status not in FEATURE_REQUEST_STATUSES:
        return True
    return False


def run_feature_request_migration(db: Session) -> int:
    """legacy 행 마이그레이션 — 승격된 행 수를 돌려준다.

    - `module` 또는 `priority` 가 NULL 이거나 status 가 legacy 표기인 행만 스캔한다.
    - `parse_legacy_body(content)` 결과가 (None, None) 이고 status 도 정상이면 UPDATE 건너뜀 → 멱등.
    - status 는 `normalize_status` 로 정규화. 어휘 밖(예: 'Rejected') 은 그 행만 건너뛰고 카운트 안 함.
    """
    scanned = (
        db.query(models.FeatureRequest)
        .filter(
            (models.FeatureRequest.module.is_(None))
            | (models.FeatureRequest.priority.is_(None))
            | (~models.FeatureRequest.status.in_(FEATURE_REQUEST_STATUSES))
        )
        .all()
    )
    updated = 0
    for row in scanned:
        module, priority, stripped = parse_legacy_body(row.content or "")
        try:
            new_status = normalize_status(row.status)
        except ValueError:
            new_status = row.status  # 어휘 밖은 그대로 두어 관리자가 손보게 한다.

        changed = False
        if module is not None and row.module is None:
            row.module = module
            changed = True
        if priority is not None and row.priority is None:
            row.priority = priority
            changed = True
        if stripped != (row.content or ""):
            row.content = stripped
            changed = True
        if new_status != row.status:
            row.status = new_status
            changed = True

        if changed:
            updated += 1
    if updated:
        db.commit()
    return updated


def _row_dict(module: str | None, status: str, count: int) -> dict:
    return {"module": module, "status": status, "count": int(count)}


def count_summary(db: Session) -> dict:
    """관리자 요약 — module × status 매트릭스 + 중요도 분포 + 자유 모듈 목록 + 전체 수."""
    module_status = (
        db.query(
            models.FeatureRequest.module,
            models.FeatureRequest.status,
            func.count(models.FeatureRequest.id),
        )
        .group_by(models.FeatureRequest.module, models.FeatureRequest.status)
        .all()
    )
    priority_rows = (
        db.query(models.FeatureRequest.priority, func.count(models.FeatureRequest.id))
        .group_by(models.FeatureRequest.priority)
        .all()
    )
    modules = list_autocomplete_modules(db)
    total = db.query(func.count(models.FeatureRequest.id)).scalar() or 0
    return {
        "by_module_status": [
            _row_dict(mod, status, count) for mod, status, count in module_status
        ],
        "by_priority": [
            {"priority": prio, "count": int(count)} for prio, count in priority_rows
        ],
        "modules": modules,
        "total": int(total),
    }


def list_autocomplete_modules(db: Session, limit: int = 50) -> list[str]:
    """자주 쓰인 모듈 top-N. NULL 은 제외, 사용 빈도 desc → 알파벳 asc 로 정렬."""
    rows = (
        db.query(
            models.FeatureRequest.module,
            func.count(models.FeatureRequest.id).label("cnt"),
        )
        .filter(models.FeatureRequest.module.isnot(None))
        .group_by(models.FeatureRequest.module)
        .order_by(func.count(models.FeatureRequest.id).desc(), models.FeatureRequest.module.asc())
        .limit(limit)
        .all()
    )
    return [module for module, _ in rows if module]
```

- [ ] **Step 4: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_feature_request_service.py tests/test_feature_request_migration.py -q
```

기대: `test_feature_request_service.py 22 passed`, `test_feature_request_migration.py 9 passed`(마이그레이션 케이스 포함 전체 통과).

- [ ] **Step 5: 커밋 준비 완료** — 보고: `app/services/feature_request_service.py`, `tests/test_feature_request_service.py`.

---

### Task 3: 라우터 확장 — 필터 · 컬럼 저장 · legacy 자동 승격 · 상태 알림

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/routers/support.py:60-73`(_request_payload), `:277-284`(GET list), `:315-321`(POST create), `:324-339`(PUT update), `:366-392`(PUT comment — 알림 훅)
- Create: `HiTessWorkBenchBackEnd/tests/test_feature_request_router.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_feature_request_router.py`:

```python
"""기능 요청 라우터 — 필터 querystring / 컬럼 저장 / legacy 자동 승격 / 상태 변경 알림."""
from unittest.mock import MagicMock

from app import models
from app.dependencies import require_auth
from app.main import app


def _act_as(employee_id: str):
    app.dependency_overrides[require_auth] = lambda: employee_id


def _make(db, *, title="제안", content="본문", module=None, priority=None,
          status="Under Review", app_key=None, author_id="EMP001",
          author_name="홍길동", upvotes=0):
    row = models.FeatureRequest(
        title=title, content=content,
        author_id=author_id, author_name=author_name,
        module=module, priority=priority, status=status,
        app_key=app_key, upvotes=upvotes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_list_filters_by_module_and_priority_and_status(admin_client, db_session):
    a = _make(db_session, module="Truss Analysis", priority="높음")
    b = _make(db_session, module="Pipe Analysis",  priority="높음", status="Planned")
    c = _make(db_session, module="Truss Analysis", priority="보통")

    ids = lambda res: [row["id"] for row in res.json()]

    r = admin_client.get("/api/feature-requests?module=Truss Analysis")
    assert set(ids(r)) == {a.id, c.id}

    r = admin_client.get("/api/feature-requests?priority=높음")
    assert set(ids(r)) == {a.id, b.id}

    r = admin_client.get("/api/feature-requests?status=Planned")
    assert set(ids(r)) == {b.id}

    r = admin_client.get("/api/feature-requests?module=Truss Analysis&priority=높음")
    assert ids(r) == [a.id]


def test_list_app_key_wildcard_returns_all(admin_client, db_session):
    _make(db_session)  # 전역
    _make(db_session, app_key="hitess-model-builder")
    _make(db_session, app_key="mooring-fitting-studio")

    r = admin_client.get("/api/feature-requests?app_key=*")
    assert len(r.json()) == 3

    r = admin_client.get("/api/feature-requests")  # 무필터 = 전역만(기존 동작)
    assert len(r.json()) == 1


def test_list_filters_by_query_string(admin_client, db_session):
    a = _make(db_session, title="엑셀 다운로드", content="본문 A")
    _make(db_session, title="회의록 정리", content="본문 B — 다운로드")
    r = admin_client.get("/api/feature-requests?q=다운로드")
    assert len(r.json()) == 2

    r = admin_client.get("/api/feature-requests?q=엑셀")
    assert [row["id"] for row in r.json()] == [a.id]


def test_create_persists_module_and_priority_from_payload(admin_client, db_session):
    r = admin_client.post("/api/feature-requests", json={
        "title": "제안", "content": "순수 본문",
        "author_id": "ADMIN001", "author_name": "관리자",
        "module": "Truss Analysis", "priority": "긴급",
    })
    assert r.status_code == 200
    row = db_session.get(models.FeatureRequest, r.json()["id"])
    assert row.module == "Truss Analysis"
    assert row.priority == "긴급"
    # 본문에서 접두를 자동으로 뽑지 않는다 — 프론트가 컬럼으로 넘겼기 때문.
    assert row.content == "순수 본문"


def test_create_accepts_legacy_body_and_promotes_to_columns(admin_client, db_session):
    """0.0 기존 프론트가 아직 본문 접두로 보내도 서버가 컬럼으로 승격한다."""
    r = admin_client.post("/api/feature-requests", json={
        "title": "제안", "content": (
            "[관련 모듈: Interactive Apps]\n"
            "[희망 중요도: 보통 (업무 효율성 향상)]\n\n"
            "본문 legacy"
        ),
        "author_id": "ADMIN001", "author_name": "관리자",
    })
    row = db_session.get(models.FeatureRequest, r.json()["id"])
    assert row.module == "Interactive Apps"
    assert row.priority == "보통"
    assert row.content == "본문 legacy"


def test_create_status_default_is_under_review(admin_client, db_session):
    r = admin_client.post("/api/feature-requests", json={
        "title": "제안", "content": "본문",
        "author_id": "ADMIN001", "author_name": "관리자",
    })
    row = db_session.get(models.FeatureRequest, r.json()["id"])
    assert row.status == "Under Review"


def test_update_writes_module_and_priority(admin_client, db_session):
    row = _make(db_session, author_id="ADMIN001")
    r = admin_client.put(f"/api/feature-requests/{row.id}", json={
        "title": "제안(수정)", "content": "본문(수정)",
        "module": "Pipe Analysis", "priority": "높음",
    })
    assert r.status_code == 200
    db_session.expire_all()
    updated = db_session.get(models.FeatureRequest, row.id)
    assert updated.module == "Pipe Analysis"
    assert updated.priority == "높음"


def test_comment_normalizes_legacy_status(admin_client, db_session):
    row = _make(db_session, author_id="EMP001")
    r = admin_client.put(f"/api/feature-requests/{row.id}/comment", json={
        "status": "Completed",  # legacy 표기
        "admin_comment": "완료 처리",
    })
    assert r.status_code == 200
    db_session.expire_all()
    assert db_session.get(models.FeatureRequest, row.id).status == "Resolved"


def test_comment_rejects_unknown_status(admin_client, db_session):
    row = _make(db_session, author_id="EMP001")
    r = admin_client.put(f"/api/feature-requests/{row.id}/comment", json={
        "status": "Rejected", "admin_comment": "x",
    })
    assert r.status_code == 400


def test_comment_calls_notify_when_status_changes(admin_client, db_session, monkeypatch):
    fake_notify = MagicMock(return_value=None)
    # 서비스 자체가 지연 import 하므로 sys.modules 로 stub 을 주입한다.
    import sys
    from app.services import notification_service as ns
    monkeypatch.setattr(ns, "notify", fake_notify, raising=False)
    sys.modules["app.services.notification_service"] = ns

    row = _make(db_session, author_id="EMP123", status="Under Review")
    r = admin_client.put(f"/api/feature-requests/{row.id}/comment", json={
        "status": "In Progress", "admin_comment": "검토 시작",
    })
    assert r.status_code == 200
    assert fake_notify.called
    kwargs = fake_notify.call_args.kwargs
    assert kwargs["employee_id"] == "EMP123"
    assert kwargs["kind"] == "feature_request.status_changed"
    assert kwargs["dedupe_key"] == f"fr:{row.id}:status"
    assert kwargs.get("dedupe_unread_only", True) is True


def test_comment_no_notify_when_status_unchanged(admin_client, db_session, monkeypatch):
    fake_notify = MagicMock()
    import sys
    from app.services import notification_service as ns
    monkeypatch.setattr(ns, "notify", fake_notify, raising=False)
    sys.modules["app.services.notification_service"] = ns

    row = _make(db_session, author_id="EMP001", status="Planned")
    admin_client.put(f"/api/feature-requests/{row.id}/comment", json={
        "status": "Planned", "admin_comment": "짧은 코멘트 추가",
    })
    assert not fake_notify.called


def test_comment_swallows_notify_error(admin_client, db_session, monkeypatch, caplog):
    """알림 실패가 상태 저장을 되돌리면 안 된다(마스터 §2.1 철학)."""
    def _boom(*_a, **_k):
        raise RuntimeError("notifications table missing")
    import sys
    from app.services import notification_service as ns
    monkeypatch.setattr(ns, "notify", _boom, raising=False)
    sys.modules["app.services.notification_service"] = ns

    row = _make(db_session, author_id="EMP001", status="Under Review")
    r = admin_client.put(f"/api/feature-requests/{row.id}/comment", json={
        "status": "Resolved", "admin_comment": "완료",
    })
    assert r.status_code == 200
    db_session.expire_all()
    assert db_session.get(models.FeatureRequest, row.id).status == "Resolved"
    assert any("기능 요청 상태 알림 실패" in r.getMessage() for r in caplog.records)


def test_admin_summary_requires_admin(admin_client, db_session):
    _make(db_session, module="Truss Analysis", priority="높음")
    r = admin_client.get("/api/admin/feature-requests/summary")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 1
    assert "by_module_status" in data and "by_priority" in data and "modules" in data


def test_admin_summary_forbidden_for_regular_user(admin_client, db_session):
    _make(db_session)
    _act_as("EMP001")
    try:
        r = admin_client.get("/api/admin/feature-requests/summary")
        assert r.status_code == 403
    finally:
        _act_as("ADMIN001")


def test_requires_auth_for_create(admin_client):
    from app.main import app
    saved = app.dependency_overrides.pop(require_auth)
    try:
        r = admin_client.post("/api/feature-requests", json={
            "title": "제안", "content": "본문",
            "author_id": "EMP001", "author_name": "홍길동",
        })
        assert r.status_code == 401
    finally:
        app.dependency_overrides[require_auth] = saved
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_feature_request_router.py -q
```

기대: 필터 미구현 → 목록 크기 오차, comment 정규화 미구현 → status 그대로, notify 훅 미구현 → `not called` 등으로 **최소 10건 실패**.

- [ ] **Step 3: 라우터 수정** — `app/routers/support.py`.

(a) 파일 상단 import 블록에 `Query` 추가(이미 있으면 skip). 파일 맨 위 `logger` 를 하나 확보:

```python
import logging
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
# ... (기존 import 유지)
from ..services import feature_request_service

logger = logging.getLogger(__name__)
```

(b) `_request_payload`(60~73행)를 legacy body 자동 승격을 포함하도록 수정:

```python
def _request_payload(
    request_data: schemas.FeatureRequestCreate,
    employee_id: str,
    db: Session,
) -> dict:
  payload = request_data.model_dump()
  user = db.query(models.User).filter(models.User.employee_id == employee_id).first()
  payload["author_id"] = employee_id
  payload["author_name"] = user.name if user else employee_id
  if payload.get("app_key"):
    app_space = _get_app_space(payload["app_key"], db)
    if not app_space.board_enabled:
      raise HTTPException(status_code=404, detail="이 App의 요청 게시판이 비활성화되어 있습니다.")

  # legacy 본문 접두(0.0 기존 프론트)를 서버에서 자동 승격한다. payload 가 이미 컬럼을 주면 그 값이 우선.
  module_from_body, priority_from_body, stripped_body = feature_request_service.parse_legacy_body(
      payload.get("content") or ""
  )
  if not payload.get("module") and module_from_body:
    payload["module"] = module_from_body
  if not payload.get("priority") and priority_from_body:
    payload["priority"] = priority_from_body
  if module_from_body or priority_from_body:
    payload["content"] = stripped_body
  return payload
```

(c) `get_feature_requests`(277~284행)를 필터 지원으로 교체:

```python
@router.get("/feature-requests", response_model=list[schemas.FeatureRequestResponse])
def get_feature_requests(
    module: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    status: str | None = Query(default=None),
    app_key: str | None = Query(default=None),
    q: str | None = Query(default=None),
    db: Session = Depends(database.get_db),
):
  """전역 목록. querystring 이 없으면 기존 동작(전역 = `app_key IS NULL`).

  - `app_key='*'` 는 전체 스코프(관리자 요약·검색용). 특정 key 는 그 App 만.
  - module/priority/status 는 정확 일치. `q` 는 title·content LIKE.
  """
  query = db.query(models.FeatureRequest)
  if app_key is None:
    query = query.filter(models.FeatureRequest.app_key.is_(None))
  elif app_key == "*":
    pass  # 전체
  else:
    query = query.filter(models.FeatureRequest.app_key == app_key)
  if module:
    query = query.filter(models.FeatureRequest.module == module)
  if priority:
    query = query.filter(models.FeatureRequest.priority == priority)
  if status:
    query = query.filter(models.FeatureRequest.status == status)
  if q:
    like = f"%{q}%"
    query = query.filter(
        (models.FeatureRequest.title.ilike(like))
        | (models.FeatureRequest.content.ilike(like))
    )
  return (
      query.order_by(
          models.FeatureRequest.upvotes.desc(),
          models.FeatureRequest.created_at.desc(),
      ).all()
  )
```

(d) `update_feature_request`(324~339)를 module/priority 저장 포함으로:

```python
@router.put("/feature-requests/{req_id}", response_model=schemas.FeatureRequestResponse)
def update_feature_request(
    req_id: int,
    payload: schemas.FeatureRequestUpdate,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
  req = get_or_404(db, models.FeatureRequest, req_id, _FEATURE_NOT_FOUND)
  if req.author_id != current_user and not _is_admin_employee(current_user, db):
    raise HTTPException(status_code=403, detail="본인이 작성한 게시글만 수정할 수 있습니다.")
  req.title = payload.title
  req.content = payload.content
  if payload.module is not None:
    req.module = payload.module or None
  if payload.priority is not None:
    req.priority = payload.priority or None
  db.commit()
  db.refresh(req)
  return req
```

(e) `comment_feature_request`(366~392)에 정규화 + 알림 훅. 함수 전체 교체:

```python
@router.put("/feature-requests/{req_id}/comment")
def comment_feature_request(
    req_id: int,
    comment_data: schemas.FeatureRequestComment,
    request: Request,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
  req = get_or_404(db, models.FeatureRequest, req_id, _FEATURE_NOT_FOUND)
  try:
    new_status = feature_request_service.normalize_status(comment_data.status)
  except ValueError as exc:
    raise HTTPException(status_code=400, detail=f"허용되지 않는 상태입니다: {exc}") from exc

  old_status = req.status
  req.status = new_status
  req.admin_comment = comment_data.admin_comment
  req.comments_count = 1 if comment_data.admin_comment else 0
  db.commit()
  db.refresh(req)

  log_activity(
      db,
      "REQUEST_STATUS_CHANGE",
      employee_id=current_admin,
      action_detail={
          "request_id": req_id,
          "status": req.status,
          "has_admin_comment": bool(req.admin_comment),
      },
      status="success",
      ip_address=request.client.host if request.client else None,
  )

  if old_status != new_status:
    _notify_feature_request_status(db, req, new_status)
  return req


def _notify_feature_request_status(db: Session, req: models.FeatureRequest, new_status: str) -> None:
  """작성자에게 상태 변경 알림 1건(마스터 §2.1). Plan A 없이도 라우터는 정상 동작한다."""
  try:
    from ..services.notification_service import notify
  except ImportError:
    return
  if not req.author_id:
    return
  try:
    notify(
        db,
        employee_id=req.author_id,
        kind="feature_request.status_changed",
        title=f"[{req.title}] 상태가 '{new_status}' 로 바뀌었습니다",
        body=(req.admin_comment or "")[:500],
        link={"menu": "Feature Requests", "params": {"request_id": req.id}},
        dedupe_key=f"fr:{req.id}:status",
        dedupe_unread_only=True,
    )
  except Exception:
    # 알림 실패가 상태 저장을 되돌리지 않는다(마스터 §2.1과 동일 철학).
    logger.warning("기능 요청 상태 알림 실패 (req_id=%s)", req.id, exc_info=True)
```

- [ ] **Step 4: 관리자 요약 라우트 등록** — `app/routers/admin.py` (또는 support.py 의 `/admin/…` 근처)에 다음 함수 추가:

```python
@router.get("/api/admin/feature-requests/summary")
def get_admin_feature_request_summary(
    db: Session = Depends(database.get_db),
    _admin: str = Depends(require_admin),
):
  """관리자 요약 — module × status 매트릭스 + 중요도 분포 + 모듈 자동완성 + 전체 수."""
  return feature_request_service.count_summary(db)
```

⚠️ 프리픽스가 이미 `/api` 인 라우터(예: `admin.py` 의 `router = APIRouter(prefix="/api/admin")`)라면 경로에서 `/api` 를 빼고 등록한다. 실제 파일에서 `router = APIRouter(...)` 선언을 확인하고 붙는 위치를 결정할 것(`grep -n 'APIRouter(' app/routers/admin.py`).

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_feature_request_router.py tests/test_feature_request_service.py tests/test_feature_request_migration.py tests/test_feature_request_schemas.py -q
```

기대: 신규 4개 파일 전부 통과.

기존 회귀:

```
WorkBenchEnv/Scripts/python.exe -m pytest tests -q -x
```

기대: 실패 0. (기존 `test_feature_requests*.py` 가 있으면 컬럼 추가로 payload 검증만 영향받는지 확인.)

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/routers/support.py`, `app/routers/admin.py`, `tests/test_feature_request_router.py`. (백엔드 완료 시점 — 사용자가 여기서 한 번 커밋할 수 있도록 Task 1~3 파일을 묶어 다시 나열한다.)

---

### Task 4: 프론트 API 모듈 통합 + 순수 유틸 (`node --test`)

**Files:**
- Create: `HiTessWorkBench/frontend/src/api/featureRequests.js`
- Modify: `HiTessWorkBench/frontend/src/api/admin.js:72-89`(재-export 로 축소)
- Modify: `HiTessWorkBench/frontend/src/api/appCommunity.js:40-65`(재-export 로 축소)
- Create: `HiTessWorkBench/frontend/src/utils/featureRequestBoard.js`
- Create: `HiTessWorkBench/frontend/src/utils/featureRequestBoard.test.js`

- [ ] **Step 1: 순수 유틸 실패 테스트 작성** — `src/utils/featureRequestBoard.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FEATURE_REQUEST_STATUSES,
  FEATURE_REQUEST_PRIORITIES,
  MODULE_STARTER_VOCAB,
  formatModuleLabel,
  isResolvedStatus,
  hasLegacyBodyPrefix,
  buildFilterParams,
  statusVariant,
  priorityVariant,
} from './featureRequestBoard.js';

test('status 어휘는 4개, priority 는 4개', () => {
  assert.deepEqual(FEATURE_REQUEST_STATUSES, [
    'Under Review', 'Planned', 'In Progress', 'Resolved',
  ]);
  assert.deepEqual(FEATURE_REQUEST_PRIORITIES, ['낮음', '보통', '높음', '긴급']);
});

test('starter vocab 은 UserRequests 기존 4개 + 자주 쓰는 App 을 포함한다', () => {
  assert.ok(MODULE_STARTER_VOCAB.includes('공통 (UI / UX / Dashboard)'));
  assert.ok(MODULE_STARTER_VOCAB.includes('Truss Analysis'));
  assert.ok(MODULE_STARTER_VOCAB.includes('Interactive Apps'));
  assert.ok(MODULE_STARTER_VOCAB.includes('Pipe Analysis'));
});

test('isResolvedStatus — 신규 어휘와 legacy 표기를 모두 인식(프론트 표시용)', () => {
  assert.equal(isResolvedStatus('Resolved'), true);
  assert.equal(isResolvedStatus('Completed'), true);
  assert.equal(isResolvedStatus('Done'), true);
  assert.equal(isResolvedStatus('해결 완료'), true);
  assert.equal(isResolvedStatus('완료'), true);
  assert.equal(isResolvedStatus('Under Review'), false);
  assert.equal(isResolvedStatus('In Progress'), false);
  assert.equal(isResolvedStatus(''), false);
  assert.equal(isResolvedStatus(undefined), false);
});

test('formatModuleLabel — 없으면 "미분류", 있으면 그대로', () => {
  assert.equal(formatModuleLabel(null), '미분류');
  assert.equal(formatModuleLabel(''), '미분류');
  assert.equal(formatModuleLabel(' Truss Analysis '), 'Truss Analysis');
});

test('hasLegacyBodyPrefix — 대괄호 접두를 감지한다(관리자 경고 표시)', () => {
  assert.equal(hasLegacyBodyPrefix('[관련 모듈: X]\n[희망 중요도: Y]\n\n본문'), true);
  assert.equal(hasLegacyBodyPrefix('[관련 모듈: X]\n본문'), true);
  assert.equal(hasLegacyBodyPrefix('접두 없음'), false);
  assert.equal(hasLegacyBodyPrefix(''), false);
  assert.equal(hasLegacyBodyPrefix(null), false);
});

test('buildFilterParams — 빈 값·"전체"는 잘라내고 나머지만 querystring 후보로', () => {
  const params = buildFilterParams({
    module: 'Truss Analysis',
    priority: '전체',
    status: '',
    appKey: 'hitess-model-builder',
    q: '  다운로드  ',
  });
  assert.deepEqual(params, {
    module: 'Truss Analysis',
    app_key: 'hitess-model-builder',
    q: '다운로드',
  });

  // 전역(무 appKey) 는 app_key 를 아예 붙이지 않는다.
  assert.deepEqual(buildFilterParams({}), {});
});

test('statusVariant / priorityVariant — 신규 어휘만 매핑', () => {
  assert.equal(statusVariant('Under Review'), 'warning');
  assert.equal(statusVariant('Planned'), 'success');
  assert.equal(statusVariant('In Progress'), 'info');
  assert.equal(statusVariant('Resolved'), 'neutral');
  assert.equal(statusVariant('Completed'), 'neutral'); // legacy fallback
  assert.equal(statusVariant('unknown'), 'neutral');

  assert.equal(priorityVariant('긴급'), 'error');
  assert.equal(priorityVariant('높음'), 'warning');
  assert.equal(priorityVariant('보통'), 'info');
  assert.equal(priorityVariant('낮음'), 'neutral');
  assert.equal(priorityVariant(null), 'neutral');
});
```

- [ ] **Step 2: 실패 확인** (`C:\Coding\WorkBench\HiTessWorkBench\frontend` 에서)

```
node --test src/utils/featureRequestBoard.test.js
```

기대: `Cannot find module … featureRequestBoard.js` 로 실패.

- [ ] **Step 3: 순수 유틸 구현** — `src/utils/featureRequestBoard.js`:

```js
/**
 * 기능 요청 게시판 순수 유틸 — 부수효과 없음(node --test 로 검증).
 * 백엔드 services/feature_request_service.py 의 어휘/정규화와 대칭이다.
 *
 * status 어휘 4개 · priority 어휘 4개 는 마스터 §2.11 로 고정. legacy 표기(Completed/Done/해결 완료)는
 * 서버가 정규화하므로 프론트는 표시에서만 'Resolved 로 취급' 하고 새로 보내지 않는다.
 */

export const FEATURE_REQUEST_STATUSES = [
  'Under Review',
  'Planned',
  'In Progress',
  'Resolved',
];

export const FEATURE_REQUEST_PRIORITIES = ['낮음', '보통', '높음', '긴급'];

// UserRequests 이전 드롭다운의 4개 + 자주 나오는 앱 이름을 시드로. 관리자 요약이 오면
// FeatureRequestBoard 가 이 배열 뒤에 서버 modules 를 이어 붙여 자동완성으로 노출한다.
export const MODULE_STARTER_VOCAB = Object.freeze([
  '공통 (UI / UX / Dashboard)',
  'Truss Analysis',
  'Pipe Analysis',
  'Interactive Apps',
  'HiTess ModelFlow',
  'Mooring Fitting Assessment',
  'Group & Module Unit 권상 구조 해석',
  'BDF Scanner',
]);

const LEGACY_RESOLVED = new Set(['Resolved', 'Completed', 'Done', '해결 완료', '완료']);

export function isResolvedStatus(value) {
  if (typeof value !== 'string' || !value) return false;
  return LEGACY_RESOLVED.has(value);
}

export function formatModuleLabel(value) {
  if (typeof value !== 'string') return '미분류';
  const trimmed = value.trim();
  return trimmed || '미분류';
}

// UserRequests 의 legacy stripMetaPreview 정규식과 같은 조건 — 관리자에게 "아직 legacy 접두가 남아 있음"을 알리는 용도.
const LEGACY_BODY_PREFIX = /^\s*\[[^\]]+\]\s*\n?/;

export function hasLegacyBodyPrefix(content) {
  if (typeof content !== 'string' || !content) return false;
  return LEGACY_BODY_PREFIX.test(content);
}

/**
 * 필터 상태 → axios params 로 변환.
 * `'전체'` · 빈 문자열 · null 은 제거한다. `q` 는 앞뒤 공백 trim.
 */
export function buildFilterParams({ module, priority, status, appKey, q } = {}) {
  const params = {};
  const put = (key, value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed || trimmed === '전체') return;
    params[key] = trimmed;
  };
  put('module', module);
  put('priority', priority);
  put('status', status);
  put('app_key', appKey);
  put('q', q);
  return params;
}

const STATUS_VARIANT = {
  'Under Review': 'warning',
  Planned: 'success',
  'In Progress': 'info',
  Resolved: 'neutral',
  // legacy fallback — 표시에서만 유지.
  Completed: 'neutral',
  Done: 'neutral',
  '해결 완료': 'neutral',
  '완료': 'neutral',
};

export function statusVariant(status) {
  return STATUS_VARIANT[status] || 'neutral';
}

const PRIORITY_VARIANT = {
  '낮음': 'neutral',
  '보통': 'info',
  '높음': 'warning',
  '긴급': 'error',
};

export function priorityVariant(priority) {
  return PRIORITY_VARIANT[priority] || 'neutral';
}
```

- [ ] **Step 4: 통과 확인**

```
node --test src/utils/featureRequestBoard.test.js
```

기대: `pass 7`, `fail 0`.

- [ ] **Step 5: API 모듈 통합** — `src/api/featureRequests.js`(신규):

```js
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/** 전역/앱 스코프 목록. filter querystring 은 buildFilterParams() 결과를 그대로 넘긴다. */
export const listFeatureRequests = (params = {}) =>
  axios.get(`${API_BASE_URL}/api/feature-requests`, {
    params,
    headers: getAuthHeaders(),
  });

/** App 스코프 전용 목록(upvoted_by_me 를 채움 — board_enabled 확인 포함). */
export const listAppFeatureRequests = (appKey) =>
  axios.get(`${API_BASE_URL}/api/apps/${encodeURIComponent(appKey)}/feature-requests`, {
    headers: getAuthHeaders(),
  });

/** 생성. payload = { title, content, author_id, author_name, app_key?, module?, priority? }. */
export const createFeatureRequest = (payload) =>
  axios.post(`${API_BASE_URL}/api/feature-requests`, payload, { headers: getAuthHeaders() });

/** 수정(작성자 or 관리자). payload = { title, content, module?, priority? }. */
export const updateFeatureRequest = (id, payload) =>
  axios.put(`${API_BASE_URL}/api/feature-requests/${id}`, payload, { headers: getAuthHeaders() });

/** 추천(멱등, 한 사용자 1회). */
export const upvoteFeatureRequest = (id) =>
  axios.put(`${API_BASE_URL}/api/feature-requests/${id}/upvote`, {}, { headers: getAuthHeaders() });

/** 관리자 답변 + 상태(정규화됨, 필요 시 알림 발신). */
export const commentFeatureRequest = (id, payload) =>
  axios.put(`${API_BASE_URL}/api/feature-requests/${id}/comment`, payload, { headers: getAuthHeaders() });

/** 삭제(작성자 or 관리자). */
export const deleteFeatureRequest = (id) =>
  axios.delete(`${API_BASE_URL}/api/feature-requests/${id}`, { headers: getAuthHeaders() });

/** 관리자 요약(require_admin). */
export const getFeatureRequestSummary = () =>
  axios.get(`${API_BASE_URL}/api/admin/feature-requests/summary`, { headers: getAuthHeaders() });
```

- [ ] **Step 6: 기존 API 파일 축소(재-export)**

`src/api/admin.js:72-89` 근처의 5개 함수를 삭제하고 파일 상단(다른 `export` 들 위)에 한 줄 재-export:

```js
export {
  listFeatureRequests as getFeatureRequests,
  createFeatureRequest,
  upvoteFeatureRequest,
  commentFeatureRequest,
  deleteFeatureRequest,
} from './featureRequests';
```

⚠ `getFeatureRequests` 는 인자 시그니처가 다르다(신규 = `(params={})`, 구 = `()`). 호출부(현재 `UserRequests.jsx:43 → getFeatureRequests()`)에서 인자 없이 호출해도 신규는 기본값이 있어 무필터 호출 시 기존 동작을 그대로 유지한다.

`src/api/appCommunity.js:40-65` 도 request 계열 6개를 삭제하고 재-export 로 축소:

```js
export {
  listAppFeatureRequests as listAppFeatureRequests,
  createFeatureRequest as createAppFeatureRequest,
  updateFeatureRequest as updateAppFeatureRequest,
  deleteFeatureRequest as deleteAppFeatureRequest,
  upvoteFeatureRequest as upvoteAppFeatureRequest,
  commentFeatureRequest as commentAppFeatureRequest,
} from './featureRequests';
```

⚠ 기존 함수명(예 `createRequest`)이 호출부에서 쓰이면 그 이름도 남긴다(`grep -n 'createRequest\|updateRequest' src/` 로 사전 확인).

- [ ] **Step 7: 빌드 확인**

```
npm run build
```

기대: 오류 없이 `dist/` 생성.

- [ ] **Step 8: 커밋 준비 완료** — 보고: `src/api/featureRequests.js`, `src/api/admin.js`, `src/api/appCommunity.js`, `src/utils/featureRequestBoard.js`, `src/utils/featureRequestBoard.test.js`. (`config.js` 는 스테이징 금지.)

---

### Task 5: 공용 컴포넌트 `FeatureRequestBoard`

**Files:**
- Create: `HiTessWorkBench/frontend/src/components/community/FeatureRequestBoard.jsx`

- [ ] **Step 1: 컴포넌트 구현** — `src/components/community/FeatureRequestBoard.jsx`:

```jsx
/**
 * @fileoverview 기능 요청 게시판 — 전역/앱 스코프 공용.
 *
 * Props:
 *   - appKey?: 있으면 App 스코프. 없으면 전역(`app_key IS NULL` 필터).
 *   - title/subtitle: 헤더 문구.
 *   - adminMode?: 관리자 액션 UI(상태 변경 · admin_comment · 모듈 자유입력) 노출.
 *
 * UserRequests.jsx / AppCommunityHub.jsx 의 목록·작성·상세·필터·정렬을 한 컴포넌트로 통합.
 * 상태 어휘·모듈 자동완성·필터 쿼리 조립은 utils/featureRequestBoard.js 순수 유틸에 위임.
 */
import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
  Archive, CheckCircle2, Flag, LayoutGrid, Lightbulb, List, MessageCircle, Plus,
  Search, Send, Tag, ThumbsUp, Trash2, X,
} from 'lucide-react';
import PageHeader from '../ui/PageHeader';
import ConfirmDialog from '../ui/ConfirmDialog';
import Badge from '../ui/Badge';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  createFeatureRequest,
  deleteFeatureRequest,
  listAppFeatureRequests,
  listFeatureRequests,
  upvoteFeatureRequest,
  commentFeatureRequest,
  updateFeatureRequest,
  getFeatureRequestSummary,
} from '../../api/featureRequests';
import {
  FEATURE_REQUEST_PRIORITIES,
  FEATURE_REQUEST_STATUSES,
  MODULE_STARTER_VOCAB,
  buildFilterParams,
  formatModuleLabel,
  hasLegacyBodyPrefix,
  isResolvedStatus,
  priorityVariant,
  statusVariant,
} from '../../utils/featureRequestBoard';

const STATUS_LABEL = {
  'Under Review': '검토 중',
  Planned: '계획됨',
  'In Progress': '진행 중',
  Resolved: '해결됨',
};

const EMPTY_FORM = { title: '', content: '', module: '', priority: '보통' };

export default function FeatureRequestBoard({
  appKey,
  title = '진행 중인 요청',
  subtitle = '',
  adminMode = false,
}) {
  const { user: currentUser } = useAuth();
  const { showToast } = useToast();
  const [requests, setRequests] = useState([]);
  const [modules, setModules] = useState([]);
  const [viewMode, setViewMode] = useState('card');

  const [filter, setFilter] = useState({
    module: '전체', priority: '전체', status: '전체', q: '',
  });
  const [sort, setSort] = useState('upvotes'); // 'upvotes' | 'newest'

  const [isWriteOpen, setIsWriteOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [formData, setFormData] = useState(EMPTY_FORM);
  const [adminReply, setAdminReply] = useState({ status: 'Under Review', admin_comment: '' });

  const params = useMemo(
    () => buildFilterParams({
      module: filter.module, priority: filter.priority, status: filter.status,
      appKey: appKey || null, q: filter.q,
    }),
    [filter, appKey],
  );

  const fetchRequests = useCallback(async () => {
    try {
      const res = appKey
        ? await listAppFeatureRequests(appKey)  // upvoted_by_me 를 채운 응답
        : await listFeatureRequests(params);
      const data = Array.isArray(res.data) ? res.data : [];
      setRequests(applyClientSort(applyClientFilter(data, params, !!appKey), sort));
    } catch (err) {
      console.error('기능 요청 목록 로드 실패', err);
    }
  }, [appKey, params, sort]);

  const fetchModules = useCallback(async () => {
    if (!adminMode) return;
    try {
      const res = await getFeatureRequestSummary();
      setModules(Array.isArray(res.data?.modules) ? res.data.modules : []);
    } catch { /* 관리자 권한 없으면 조용히 무시 */ }
  }, [adminMode]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);
  useEffect(() => { fetchModules(); }, [fetchModules]);

  const moduleVocab = useMemo(() => {
    const seen = new Set();
    const list = [];
    [...modules, ...MODULE_STARTER_VOCAB].forEach(v => {
      if (v && !seen.has(v)) { seen.add(v); list.push(v); }
    });
    return list;
  }, [modules]);

  // ── 액션 ─────────────────────────────────────────────
  const handleUpvote = async (id) => {
    try { await upvoteFeatureRequest(id); fetchRequests(); }
    catch (err) { console.error('추천 실패', err); }
  };

  const openWrite = () => {
    setFormData({ ...EMPTY_FORM, module: moduleVocab[0] || '' });
    setIsWriteOpen(true);
  };

  const openDetail = (row) => {
    setSelected(row);
    setAdminReply({
      status: FEATURE_REQUEST_STATUSES.includes(row.status) ? row.status : 'Under Review',
      admin_comment: row.admin_comment || '',
    });
    setIsViewOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentUser) { showToast('로그인이 필요합니다.', 'warning'); return; }
    try {
      await createFeatureRequest({
        title: formData.title,
        content: formData.content,  // 본문에 접두를 붙이지 않는다.
        module: formData.module?.trim() || null,
        priority: formData.priority || null,
        author_id: currentUser.employee_id,
        author_name: currentUser.name,
        app_key: appKey || null,
      });
      setIsWriteOpen(false);
      fetchRequests();
    } catch (err) {
      showToast('요청 제출 실패: ' + (err.response?.data?.detail || err.message), 'error');
    }
  };

  const handleAdminSave = async () => {
    try {
      await commentFeatureRequest(selected.id, adminReply);
      showToast('관리자 답변이 저장되었습니다.', 'success');
      setIsViewOpen(false);
      fetchRequests();
    } catch (err) {
      showToast('저장 실패: ' + (err.response?.data?.detail || err.message), 'error');
    }
  };

  const handleDelete = async () => {
    try {
      await deleteFeatureRequest(selected.id);
      setConfirmDelete(false);
      setIsViewOpen(false);
      fetchRequests();
    } catch (err) { showToast('삭제 실패: ' + err.message, 'error'); }
  };

  // ── 렌더 ─────────────────────────────────────────────
  const inProgress = requests.filter(r => !isResolvedStatus(r.status));
  const done = requests.filter(r => isResolvedStatus(r.status));

  return (
    <div className="space-y-6">
      <PageHeader title={title} icon={Lightbulb} subtitle={subtitle} rightSlot={
        <button
          onClick={openWrite}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-blue text-white font-bold rounded-xl hover:bg-brand-blue-dark shadow"
        >
          <Plus size={16} /> 새 요청
        </button>
      } />

      <FilterBar
        filter={filter}
        onChange={setFilter}
        moduleVocab={moduleVocab}
        allowFreeText={adminMode}
        sort={sort}
        onSortChange={setSort}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      <Section
        title="진행 중"
        icon={<MessageCircle size={16} />}
        rows={inProgress}
        viewMode={viewMode}
        onOpen={openDetail}
        onUpvote={handleUpvote}
        currentUser={currentUser}
      />
      <Section
        title="해결 완료"
        icon={<CheckCircle2 size={16} />}
        rows={done}
        viewMode={viewMode}
        onOpen={openDetail}
        onUpvote={handleUpvote}
        currentUser={currentUser}
        dim
      />

      <WriteDialog
        open={isWriteOpen}
        onClose={() => setIsWriteOpen(false)}
        formData={formData}
        setFormData={setFormData}
        onSubmit={handleSubmit}
        moduleVocab={moduleVocab}
        allowFreeModule={adminMode}
      />
      <DetailDialog
        open={isViewOpen}
        onClose={() => setIsViewOpen(false)}
        row={selected}
        adminReply={adminReply}
        setAdminReply={setAdminReply}
        onSave={handleAdminSave}
        onRequestDelete={() => setConfirmDelete(true)}
        adminMode={adminMode}
        currentUser={currentUser}
      />
      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="이 요청을 삭제할까요?"
        description="삭제된 요청은 복구할 수 없습니다."
      />
    </div>
  );
}

// ── 하위 컴포넌트 ─────────────────────────────────────

function FilterBar({ filter, onChange, moduleVocab, allowFreeText, sort, onSortChange, viewMode, onViewModeChange }) {
  const set = (patch) => onChange({ ...filter, ...patch });
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-slate-500">
        <Search size={14} />
        <input
          type="text"
          placeholder="제목/내용 검색"
          value={filter.q}
          onChange={e => set({ q: e.target.value })}
          className="w-52 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-blue"
        />
      </div>
      <FilterSelect
        label="모듈"
        value={filter.module}
        onChange={v => set({ module: v })}
        options={['전체', ...moduleVocab]}
        allowFreeText={allowFreeText}
      />
      <FilterSelect
        label="상태"
        value={filter.status}
        onChange={v => set({ status: v })}
        options={['전체', ...FEATURE_REQUEST_STATUSES]}
      />
      <FilterSelect
        label="중요도"
        value={filter.priority}
        onChange={v => set({ priority: v })}
        options={['전체', ...FEATURE_REQUEST_PRIORITIES]}
      />
      <div className="flex-1" />
      <select
        value={sort}
        onChange={e => onSortChange(e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-bold text-slate-700"
      >
        <option value="upvotes">추천순</option>
        <option value="newest">최신순</option>
      </select>
      <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white">
        <button
          onClick={() => onViewModeChange('card')}
          className={`px-2 py-1.5 ${viewMode === 'card' ? 'bg-blue-50 text-blue-700' : 'text-slate-500'}`}
          title="카드 뷰"
        >
          <LayoutGrid size={14} />
        </button>
        <button
          onClick={() => onViewModeChange('list')}
          className={`px-2 py-1.5 ${viewMode === 'list' ? 'bg-blue-50 text-blue-700' : 'text-slate-500'}`}
          title="리스트 뷰"
        >
          <List size={14} />
        </button>
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, allowFreeText = false }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500">
      {label}
      <input
        list={allowFreeText ? `fq-${label}` : undefined}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-bold text-slate-700"
        style={{ width: 148 }}
      />
      {!allowFreeText && (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="ml-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
        >
          {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      )}
      {allowFreeText && (
        <datalist id={`fq-${label}`}>
          {options.map(opt => <option key={opt} value={opt} />)}
        </datalist>
      )}
    </label>
  );
}

function Section({ title, icon, rows, viewMode, onOpen, onUpvote, currentUser, dim = false }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h3 className={`mb-2 flex items-center gap-2 text-sm font-extrabold ${dim ? 'text-slate-500' : 'text-slate-800'}`}>
        {icon}{title}
        <span className="rounded-full bg-slate-100 px-2 text-xs font-bold text-slate-500">{rows.length}</span>
      </h3>
      {viewMode === 'card' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(req => (
            <RequestCard key={req.id} req={req} onOpen={onOpen} onUpvote={onUpvote} currentUser={currentUser} />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {rows.map(req => (
            <RequestListRow key={req.id} req={req} onOpen={onOpen} onUpvote={onUpvote} currentUser={currentUser} />
          ))}
        </div>
      )}
    </section>
  );
}

function RequestCard({ req, onOpen, onUpvote, currentUser }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(req)}
      className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:shadow-md"
    >
      <div className="mb-2 flex items-center gap-2">
        <Badge variant={statusVariant(req.status)} dot>{STATUS_LABEL[req.status] || req.status}</Badge>
        {req.priority && <Badge variant={priorityVariant(req.priority)}><Flag size={11} />{req.priority}</Badge>}
        <Badge variant="neutral"><Tag size={11} />{formatModuleLabel(req.module)}</Badge>
      </div>
      <p className="line-clamp-2 text-sm font-extrabold text-slate-800" title={req.title}>{req.title}</p>
      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-slate-500 flex-1">{req.content}</p>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>{req.author_name || req.author_id}</span>
        <span
          onClick={e => { e.stopPropagation(); onUpvote(req.id); }}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${req.upvoted_by_me ? 'bg-blue-50 text-blue-700' : 'text-slate-400 hover:bg-slate-50'}`}
          title="추천"
        >
          <ThumbsUp size={12} /> {req.upvotes}
        </span>
      </div>
    </button>
  );
}

function RequestListRow({ req, onOpen, onUpvote, currentUser }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1" onClick={() => onOpen(req)} role="button">
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(req.status)}>{STATUS_LABEL[req.status] || req.status}</Badge>
          {req.priority && <Badge variant={priorityVariant(req.priority)}>{req.priority}</Badge>}
          <Badge variant="neutral">{formatModuleLabel(req.module)}</Badge>
          <p className="ml-1 truncate text-sm font-bold text-slate-800">{req.title}</p>
        </div>
        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-slate-500">{req.content}</p>
      </div>
      <button
        type="button"
        onClick={() => onUpvote(req.id)}
        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${req.upvoted_by_me ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}
      >
        <ThumbsUp size={12} /> {req.upvotes}
      </button>
    </div>
  );
}

function WriteDialog({ open, onClose, formData, setFormData, onSubmit, moduleVocab, allowFreeModule }) {
  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-start gap-3 border-b border-slate-100 bg-slate-50 px-6 py-4">
              <div className="flex-1">
                <Dialog.Title className="flex items-center gap-2 text-lg font-extrabold text-brand-blue">
                  <Lightbulb size={20} /> 시스템 기능 개선 제안
                </Dialog.Title>
                <p className="mt-1 text-xs font-bold text-brand-blue/70">여러분의 아이디어가 더 나은 워크벤치를 만듭니다.</p>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-white"><X size={20}/></button>
            </div>
            <form onSubmit={onSubmit} className="space-y-6 bg-slate-50 p-6">
              <div className="flex gap-4">
                <div className="w-1/2">
                  <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500"><Tag size={12}/> 관련 모듈</label>
                  {allowFreeModule ? (
                    <>
                      <input
                        list="request-modules"
                        value={formData.module}
                        onChange={e => setFormData({ ...formData, module: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm font-bold text-slate-700 outline-none focus:border-green-500"
                      />
                      <datalist id="request-modules">
                        {moduleVocab.map(v => <option key={v} value={v} />)}
                      </datalist>
                    </>
                  ) : (
                    <select
                      value={formData.module}
                      onChange={e => setFormData({ ...formData, module: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm font-bold text-slate-700"
                    >
                      {moduleVocab.map(v => <option key={v}>{v}</option>)}
                    </select>
                  )}
                </div>
                <div className="w-1/2">
                  <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500"><Flag size={12}/> 희망 중요도</label>
                  <select
                    value={formData.priority}
                    onChange={e => setFormData({ ...formData, priority: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm font-bold text-slate-700"
                  >
                    {FEATURE_REQUEST_PRIORITIES.map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">제안 요약</label>
                <input
                  type="text" required
                  placeholder="ex) Truss 결과의 엑셀 다운로드 기능 추가"
                  value={formData.title}
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 p-3 font-bold text-slate-800 outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">상세 제안 내용</label>
                <textarea
                  required rows={6}
                  placeholder="현재의 불편한 점과 개선점을 상세히 적어 주세요. (대괄호 접두는 붙이지 않아도 됩니다.)"
                  value={formData.content}
                  onChange={e => setFormData({ ...formData, content: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700 outline-none focus:border-green-500"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-6 py-2.5 font-bold text-slate-600">취소</button>
                <button type="submit" className="rounded-xl bg-brand-blue px-8 py-2.5 font-bold text-white shadow">제출</button>
              </div>
            </form>
          </Dialog.Panel>
        </div>
      </Dialog>
    </Transition>
  );
}

function DetailDialog({ open, onClose, row, adminReply, setAdminReply, onSave, onRequestDelete, adminMode, currentUser }) {
  if (!row) return null;
  const canDelete = adminMode || (currentUser?.employee_id === row.author_id);
  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-start gap-3 border-b border-slate-100 bg-slate-50 px-6 py-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(row.status)} dot>{STATUS_LABEL[row.status] || row.status}</Badge>
                  {row.priority && <Badge variant={priorityVariant(row.priority)}>{row.priority}</Badge>}
                  <Badge variant="neutral">{formatModuleLabel(row.module)}</Badge>
                </div>
                <Dialog.Title className="mt-2 text-lg font-extrabold text-slate-800">{row.title}</Dialog.Title>
                <p className="text-xs text-slate-500">{row.author_name || row.author_id} · 추천 {row.upvotes}</p>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-white"><X size={20}/></button>
            </div>

            <div className="space-y-4 p-6">
              {hasLegacyBodyPrefix(row.content) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  이 요청의 본문 앞에 legacy 대괄호 접두가 남아 있습니다. 관리자는 저장 시 자동으로 정리됩니다.
                </div>
              )}
              <p className="whitespace-pre-wrap rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700">{row.content}</p>

              {row.admin_comment && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <p className="text-xs font-bold text-blue-800">관리자 답변</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{row.admin_comment}</p>
                </div>
              )}

              {adminMode && (
                <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-bold text-slate-500">관리자 상태 변경</p>
                  <select
                    value={adminReply.status}
                    onChange={e => setAdminReply({ ...adminReply, status: e.target.value })}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-bold text-slate-700"
                  >
                    {FEATURE_REQUEST_STATUSES.map(v => <option key={v} value={v}>{STATUS_LABEL[v]}</option>)}
                  </select>
                  <textarea
                    rows={3}
                    placeholder="관리자 답변(선택)"
                    value={adminReply.admin_comment}
                    onChange={e => setAdminReply({ ...adminReply, admin_comment: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm outline-none focus:border-brand-blue"
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={onSave} className="inline-flex items-center gap-1 rounded-lg bg-brand-blue px-4 py-1.5 text-xs font-bold text-white shadow">
                      <Send size={12}/> 피드백 저장
                    </button>
                  </div>
                </div>
              )}

              {canDelete && (
                <div className="text-right">
                  <button
                    onClick={onRequestDelete}
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50"
                  >
                    <Trash2 size={12}/> 삭제
                  </button>
                </div>
              )}
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </Transition>
  );
}

// ── 클라이언트 유틸 ───────────────────────────────────

/** App 스코프 응답은 상태·모듈 필터가 서버에 없다 — 클라이언트에서 한 번 더 걸러 준다. */
function applyClientFilter(rows, params, isAppScope) {
  if (!isAppScope) return rows;
  return rows.filter(r => (
    (!params.module || r.module === params.module)
    && (!params.priority || r.priority === params.priority)
    && (!params.status || r.status === params.status)
    && (!params.q || (r.title || '').includes(params.q) || (r.content || '').includes(params.q))
  ));
}

function applyClientSort(rows, sort) {
  const copy = [...rows];
  if (sort === 'newest') {
    copy.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } else {
    copy.sort((a, b) => (b.upvotes - a.upvotes) || (new Date(b.created_at) - new Date(a.created_at)));
  }
  return copy;
}
```

- [ ] **Step 2: 빌드**

```
npm run build
```

기대: 오류 없음(아직 어디서도 import 되지 않으므로 tree-shake 되어도 정상).

- [ ] **Step 3: 커밋 준비 완료** — 보고: `src/components/community/FeatureRequestBoard.jsx`.

---

### Task 6: `UserRequests.jsx` → `<FeatureRequestBoard/>` 로 축소

**Files:**
- Modify: `HiTessWorkBench/frontend/src/pages/Support/UserRequests.jsx` (파일 전체 교체)

- [ ] **Step 1: 파일 축소** — `src/pages/Support/UserRequests.jsx` 를 아래로 교체:

```jsx
import React from 'react';
import FeatureRequestBoard from '../../components/community/FeatureRequestBoard';
import { useAuth } from '../../contexts/AuthContext';

export default function UserRequests() {
  const { isAdmin } = useAuth();
  return (
    <div className="max-w-7xl mx-auto pb-10 px-4 pt-6 space-y-6">
      <FeatureRequestBoard
        title="사용자 요청"
        subtitle="워크벤치를 더 낫게 만드는 아이디어를 남겨 주세요. 관리자가 검토 후 상태를 갱신합니다."
        adminMode={!!isAdmin}
      />
    </div>
  );
}
```

⚠ `stripMetaPreview`·`finalContent = [관련 모듈:…]` 조립·`formData.module` / `formData.priority` select 옵션·`statusColors`·`resolvedStatuses` 는 전부 삭제된다. 모듈/중요도/상태 어휘·정규화는 `utils/featureRequestBoard.js` 로 이관됐다.

- [ ] **Step 2: 빌드**

```
npm run build
```

기대: 오류 없음. dev 모드 warning 이 있으면 사용하지 않는 import 를 정리한다.

- [ ] **Step 3: 수동 검증 1(전역 게시판)**

백엔드(`uvicorn app.main:app --port 9091 --reload`) + 프론트(`npm run dev`):

1. 관리자 로그인 → 좌측 메뉴 **User Requests** 진입. 기존 요청이 카드 뷰로 보이고 각 카드에 3개 배지(상태 · 중요도 · 모듈)가 뜬다.
2. 검색어 `다운로드` 입력 → 목록이 클라이언트/서버 필터로 걸린다(관리자는 서버, 일반 사용자도 같은 UI).
3. 상단 dropdown "모듈: Truss Analysis" · "상태: Planned" 조합 → 서버 querystring `?module=Truss Analysis&status=Planned`.
4. **새 요청** 버튼 → 모달의 모듈 select 에 Task 5 `MODULE_STARTER_VOCAB` 값이 뜨고, 관리자는 datalist 자유입력이 열린다. `긴급` 이 중요도 옵션에 포함되어 있다.
5. 제출 → 카드에 접두 없이 순수 본문이 표시된다. DB 확인: `SELECT id, module, priority, LEFT(content, 50) FROM feature_requests ORDER BY id DESC LIMIT 1;` → `module/priority` 컬럼이 채워지고 `content` 에 접두가 없다.
6. 상세 모달 → 관리자면 상태 dropdown 4개(`Under Review` / `Planned` / `In Progress` / `Resolved`). `Completed` 는 사라짐.
7. legacy 접두가 남아 있는 이전 요청을 선택 → 상세 모달에 노란 경고(`hasLegacyBodyPrefix`)가 뜬다.

- [ ] **Step 4: 커밋 준비 완료** — 보고: `src/pages/Support/UserRequests.jsx`.

---

### Task 7: `AppCommunityHub.jsx` — 4개 상태 축소 + `<FeatureRequestBoard/>` 이관

**Files:**
- Modify: `HiTessWorkBench/frontend/src/components/analysis/AppCommunityHub.jsx` (line 48~54 `REQUEST_STATUS`, `activeTab === 'requests'` 블록 전체)

- [ ] **Step 1: `REQUEST_STATUS` 4개로 축소** — 48~54행을:

```js
const REQUEST_STATUS = {
  'Under Review': { label: '검토 중', variant: 'warning' },
  Planned: { label: '계획됨', variant: 'success' },
  'In Progress': { label: '진행 중', variant: 'info' },
  Resolved: { label: '해결됨', variant: 'neutral' },
};
```

`Completed` 키를 제거했다. `REQUEST_STATUS[row.status]` 조회가 미스나는 legacy 값(`Done`·`해결 완료`·`Completed`)은 이미 fallback `{ label: request.status, variant: 'neutral' }`(917행) 이 있어 표시 자체는 유지된다. 서버 정규화가 아직 안 된 과거 행이 그렇게 보일 수 있다.

- [ ] **Step 2: 상태 dropdown 옵션 축소** — 1117~1121행의 `<option value="Completed">완료</option>` 줄 삭제:

```jsx
<option value="Under Review">검토 중</option>
<option value="Planned">계획됨</option>
<option value="In Progress">진행 중</option>
<option value="Resolved">해결됨</option>
```

- [ ] **Step 3: `activeTab === 'requests'` 블록을 `<FeatureRequestBoard/>` 로 교체**

`AppCommunityHub.jsx` 의 request 관련 state(`requests`·`requestForm`·`editingRequest`·`selectedRequest`·`adminReply`·`deleteRequestCandidate`·`requestQuery`·`requestSort`)와 그 렌더 블록을 걷어 내고, 그 자리에:

```jsx
{activeTab === 'requests' && (
  <FeatureRequestBoard
    appKey={appKey}
    adminMode={isAdmin}
    title="App 요청 게시판"
    subtitle="이 App 에 국한된 개선 제안과 버그 리포트."
  />
)}
```

파일 상단 import 에 `import FeatureRequestBoard from '../community/FeatureRequestBoard';` 를 추가한다. 공지(Notice) 탭·진입 공지 배너·`REQUEST_STATUS` 는 다른 탭에서 여전히 쓰이므로 남긴다.

⚠ 이 컴포넌트는 400여 줄의 request 화면 코드가 통째로 사라져 diff 가 크다. **PR 단위로 나누고 싶다면** Task 7 을 두 번에 나눠 커밋한다(REQUEST_STATUS 축소 → 렌더 이관).

- [ ] **Step 4: 빌드 + 수동 검증 2(앱 게시판)**

```
npm run build
```

수동 검증:

1. Truss Analysis 등 커뮤니티가 켜진 App 진입 → "App 게시판" 탭 클릭 → 같은 `FeatureRequestBoard` UI 가 뜬다(전역과 동일한 필터 바 · 카드/리스트 뷰 · 관리자 상태 dropdown 4개).
2. App 게시판에서 **새 요청** 작성 → 저장. DB 확인: `SELECT id, app_key, module, priority FROM feature_requests WHERE app_key = 'truss-analysis' ORDER BY id DESC LIMIT 1;`(app_key 실제 키 대체) — `module` · `priority` 가 컬럼으로 저장된다. 이전에는 App 게시판이 이 두 값을 **아예 저장하지 않았다** — 이번 통합의 실이득.
3. 관리자 상태 변경 dropdown 에 `Completed` 옵션이 사라졌다. 신규 어휘 4개만 노출.

- [ ] **Step 5: 커밋 준비 완료** — 보고: `src/components/analysis/AppCommunityHub.jsx`.

---

### Task 8: 관리자 요약 카드 `AdminFeatureRequestSummary`

**Files:**
- Create: `HiTessWorkBench/frontend/src/components/admin/AdminFeatureRequestSummary.jsx`

- [ ] **Step 1: 컴포넌트 구현** — `src/components/admin/AdminFeatureRequestSummary.jsx`:

```jsx
/**
 * 관리자 요약 카드 — module × status 매트릭스 + 중요도 분포.
 * getFeatureRequestSummary() 한 방으로 채운다. 관리자 대시보드/User Requests 상단에 삽입 가능.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Flag, Lightbulb, Tag } from 'lucide-react';
import { getFeatureRequestSummary } from '../../api/featureRequests';
import {
  FEATURE_REQUEST_PRIORITIES,
  FEATURE_REQUEST_STATUSES,
  formatModuleLabel,
} from '../../utils/featureRequestBoard';

export default function AdminFeatureRequestSummary() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getFeatureRequestSummary()
      .then(res => setSummary(res.data))
      .catch(err => setError(err.response?.data?.detail || err.message));
  }, []);

  const matrix = useMemo(() => buildMatrix(summary), [summary]);

  if (error) {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>;
  }
  if (!summary) {
    return <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-500">요약 불러오는 중…</div>;
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <Lightbulb size={16} className="text-brand-blue" />
        <h3 className="text-sm font-extrabold text-slate-800">기능 요청 요약</h3>
        <span className="rounded-full bg-slate-100 px-2 text-xs font-bold text-slate-600">총 {summary.total}건</span>
      </header>

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 pr-3"><Tag size={12} className="inline" /> 모듈</th>
              {FEATURE_REQUEST_STATUSES.map(s => (
                <th key={s} className="px-2 py-1 text-right font-bold text-slate-500">{s}</th>
              ))}
              <th className="pl-2 py-1 text-right font-extrabold text-slate-700">합계</th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map(row => (
              <tr key={row.module || '__none__'} className="border-t border-slate-100">
                <td className="py-1 pr-3 font-bold text-slate-700">{formatModuleLabel(row.module)}</td>
                {FEATURE_REQUEST_STATUSES.map(s => (
                  <td key={s} className="px-2 py-1 text-right text-slate-600">{row.counts[s] || 0}</td>
                ))}
                <td className="pl-2 py-1 text-right font-extrabold text-slate-800">{row.total}</td>
              </tr>
            ))}
            {matrix.rows.length === 0 && (
              <tr>
                <td colSpan={FEATURE_REQUEST_STATUSES.length + 2} className="py-6 text-center text-slate-400">
                  아직 등록된 요청이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {FEATURE_REQUEST_PRIORITIES.map(p => {
          const found = summary.by_priority.find(x => x.priority === p);
          return (
            <span key={p} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
              <Flag size={11} /> {p} — {found?.count || 0}
            </span>
          );
        })}
      </div>
    </section>
  );
}

function buildMatrix(summary) {
  if (!summary) return { rows: [] };
  const byModule = new Map();
  for (const row of summary.by_module_status || []) {
    const key = row.module || '';
    if (!byModule.has(key)) {
      byModule.set(key, { module: row.module, counts: {}, total: 0 });
    }
    const bucket = byModule.get(key);
    bucket.counts[row.status] = (bucket.counts[row.status] || 0) + row.count;
    bucket.total += row.count;
  }
  const rows = [...byModule.values()].sort((a, b) => b.total - a.total);
  return { rows };
}
```

- [ ] **Step 2: `Support/UserRequests.jsx` 에 관리자만 노출**

```jsx
import AdminFeatureRequestSummary from '../../components/admin/AdminFeatureRequestSummary';

// 컴포넌트 상단(FeatureRequestBoard 앞)에:
{isAdmin && <AdminFeatureRequestSummary />}
```

- [ ] **Step 3: 빌드**

```
npm run build
```

기대: 오류 없음.

- [ ] **Step 4: 수동 검증 3(관리자 요약)**

1. 관리자 로그인 → User Requests 상단에 요약 카드가 뜬다. 표에 module × status 카운트, 아래에 중요도 4개 배지.
2. 일반 사용자 로그인 → 요약 카드는 보이지 않음(라우트 403 그대로).
3. 새 요청을 하나 만들고 페이지를 새로고침 → 표의 카운트가 1 증가한다.

- [ ] **Step 5: 커밋 준비 완료** — 보고: `src/components/admin/AdminFeatureRequestSummary.jsx`, `src/pages/Support/UserRequests.jsx`.

---

### Task 9: 최종 백엔드 회귀 + 마이그레이션 리허설

- [ ] **Step 1: 전체 백엔드 테스트**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd
WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```

기대: 실패 0. 신규 4개 파일(`test_feature_request_migration.py`, `test_feature_request_service.py`, `test_feature_request_router.py`, `test_feature_request_schemas.py`) 합계 **~40건** 통과. 기존 회귀도 0.

- [ ] **Step 2: 운영 유사 데이터로 마이그레이션 리허설**(선택, 로컬 MySQL 있을 때)

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_feature_request_migration.py -q -v
```

로그를 확인해 파싱 예시 표 10건(위)이 모두 통과하는지 확인. **회사 서버 DB 사본을 로컬에 로드해 한번 돌려 보는 것이 안전** — 실제 legacy 본문에는 예상 못 한 이형(空白 · 중복 접두 · HTML 엔티티)이 있을 수 있다.

로컬 리허설 절차(관리자만):

```
# 1) 서버 DB 스냅샷을 로컬 MySQL 로 로드
mysql -u root -p hitessworkbench < feature_requests_snapshot.sql
# 2) 로컬 백엔드 기동(schema_bootstrap 이 자동 마이그레이션)
WorkBenchEnv/Scripts/python.exe -m uvicorn app.main:app --port 9092
# 3) 결과 확인
mysql -u root -e "SELECT id, module, priority, status, LEFT(content, 40) FROM hitessworkbench.feature_requests WHERE id BETWEEN <n> AND <n+50>;"
```

기대: 로드된 legacy 행의 접두가 컬럼으로 옮겨졌고 `content` 앞에 대괄호 라인이 없다. status 는 4개 어휘 중 하나.

- [ ] **Step 3: 프론트 순수 유틸 + 빌드**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend
node --test src/utils/featureRequestBoard.test.js && npm run build
```

기대: `pass 7`, 빌드 성공.

- [ ] **Step 4: 스테이징 점검**

```
git status
```

`HiTessWorkBench/frontend/src/config.js` 가 변경돼 있으면 **스테이징하지 않는다**(로컬 백엔드 토글). `Darkmode.js/` 미포함 확인.

---

### Task 10: 수동 검증 (마이그레이션 전/후 + status → notify)

- [ ] **Step 1: 마이그레이션 전 상태 캡처**

로컬 백엔드 기동 전, 테이블 상태를 캡처:

```
mysql -u root -e "SELECT status, COUNT(*) FROM hitessworkbench.feature_requests GROUP BY status;"
mysql -u root -e "SELECT COUNT(*) FROM hitessworkbench.feature_requests WHERE content LIKE '[관련 모듈:%';"
```

기대(예시): status 는 5~7개 어휘(`Under Review`, `Planned`, `In Progress`, `Resolved`, `Completed`, `Done`, `해결 완료`)가 섞여 있고, 본문 접두를 가진 행이 N건.

- [ ] **Step 2: 백엔드 기동 → 마이그레이션 자동 실행**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd
WorkBenchEnv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9091 --reload
```

로그에서 다음 순서로 실행되는지 확인:

```
ensure_notice_columns … done
ensure_user_columns … done
…
ensure_feature_request_columns … done
```

- [ ] **Step 3: 마이그레이션 후 상태 캡처**

```
mysql -u root -e "SELECT status, COUNT(*) FROM hitessworkbench.feature_requests GROUP BY status;"
mysql -u root -e "SELECT COUNT(*) FROM hitessworkbench.feature_requests WHERE content LIKE '[관련 모듈:%';"
mysql -u root -e "SELECT id, module, priority FROM hitessworkbench.feature_requests WHERE module IS NOT NULL LIMIT 10;"
```

기대:
- status 는 `Under Review`, `Planned`, `In Progress`, `Resolved` **4개만** 남는다. `Completed`/`Done`/`해결 완료`/`완료` 는 0건.
- 본문 접두 잔존 = 0건.
- `module` / `priority` 가 채워진 행이 N건(마이그레이션 전 접두를 가졌던 그 N).

- [ ] **Step 4: 재기동(멱등 검증)**

백엔드를 한 번 더 재시작:

```
Ctrl+C → 다시 uvicorn
mysql -u root -e "SELECT COUNT(*) FROM hitessworkbench.feature_requests WHERE content LIKE '[관련 모듈:%';"
```

기대: 여전히 0건. `run_feature_request_migration()` 이 아무것도 안 바꾼다(파싱 결과 (None, None)).

- [ ] **Step 5: 상태 변경 → 알림 발신 (Plan A 있는 경우)**

Plan A 가 이미 배포되어 있으면:

1. 관리자 계정으로 User Requests → 미해결 요청 하나 선택 → 상태를 `In Progress` 로 변경 → 저장.
2. 작성자 계정으로 로그인 → 헤더 종 아이콘에 배지 1 → 클릭 → "[제목] 상태가 'In Progress' 로 바뀌었습니다" 알림 1건. 링크는 Feature Requests 메뉴로 이동.
3. 관리자가 다시 `Resolved` 로 바꿔도 (작성자가 알림을 아직 안 읽으면) 알림이 **1건으로 병합**(`dedupe_key=f"fr:{req.id}:status"` + `dedupe_unread_only=True`).
4. 작성자가 알림을 읽은 뒤 관리자가 상태를 또 바꾸면 새 알림 1건.
5. DB 확인: `SELECT kind, title, dedupe_key FROM notifications WHERE dedupe_key LIKE 'fr:%';`.

Plan A 없이:

1. 위 1) 을 수행하고 로그를 확인 → `ImportError` 는 조용히 무시되어 라우터는 200 반환. 알림 테이블에 아무 것도 안 생긴다(정상).
2. `_notify_feature_request_status` 안의 `try/except` 가 예외를 잡아 `기능 요청 상태 알림 실패` warning 이 뜨지 않는다(import 실패는 return, 예외는 warning). 상태 저장은 그대로 성공.

- [ ] **Step 6: 상태 어휘 밖 방어**

관리자가 브라우저 DevTools 에서 임의로 `PUT /api/feature-requests/{id}/comment` body 를 `{"status":"Rejected","admin_comment":"x"}` 로 보내는 경우:

```
curl -X PUT -H 'Content-Type: application/json' -H 'Authorization: Bearer <token>' \
  -d '{"status":"Rejected","admin_comment":"x"}' \
  http://localhost:9091/api/feature-requests/1/comment
```

기대: 400 `{"detail": "허용되지 않는 상태입니다: …"}` 로 거절.

---

### Task 11: 최종 점검 + 서버(145) 반영 안내

- [ ] **Step 1: 백엔드 전체 회귀**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```

기대: 실패 0.

- [ ] **Step 2: 프론트 순수 유틸 + 빌드**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && node --test src/utils/featureRequestBoard.test.js && npm run build
```

기대: `pass 7`, 빌드 성공.

- [ ] **Step 3: 스테이징 점검** — `git status` 에서 `HiTessWorkBench/frontend/src/config.js` 가 변경돼 있으면 **스테이징하지 않는다**(로컬 백엔드 토글). `Darkmode.js/` 미포함 확인.

- [ ] **Step 4: 사용자 보고(커밋은 사용자가 직접)** — 변경 파일 전체 목록(파일 구조 표) + 아래 서버 반영 구분을 그대로 전달.

**서버(145) 반영:**
- **백엔드 — `git pull` + 백엔드 재시작으로 끝.** 컬럼 추가(`module`, `priority`)·인덱스·본문 마이그레이션은 `run_schema_bootstrap()` → `ensure_feature_request_columns()` → `run_feature_request_migration()` 이 자동 실행(1회, 이후 no-op). 신규 pip 의존성 없음(`requirements.txt` 변경 없음).
- **프론트 — 재배포 필요.** WorkBench 포터블 exe 를 `npm run dist` 로 다시 빌드해 사용자 PC 갱신. `FeatureRequestBoard` 신설 + 두 페이지(`UserRequests`, `AppCommunityHub`) 축소가 번들에 들어간다.
- **InHouse 프로그램 — 없음.** `InHouseProgram/` 수동 교체 대상 없음.

---

### Task 12: 커밋 준비 완료

- [ ] **Step 1: 파일 목록 재확인**

**백엔드(Task 1~3):**
- `HiTessWorkBenchBackEnd/app/models.py`
- `HiTessWorkBenchBackEnd/app/schemas.py`
- `HiTessWorkBenchBackEnd/app/schema_bootstrap.py`
- `HiTessWorkBenchBackEnd/app/services/feature_request_service.py`
- `HiTessWorkBenchBackEnd/app/routers/support.py`
- `HiTessWorkBenchBackEnd/app/routers/admin.py`
- `HiTessWorkBenchBackEnd/tests/test_feature_request_migration.py`
- `HiTessWorkBenchBackEnd/tests/test_feature_request_schemas.py`
- `HiTessWorkBenchBackEnd/tests/test_feature_request_service.py`
- `HiTessWorkBenchBackEnd/tests/test_feature_request_router.py`

**프론트(Task 4~8):**
- `HiTessWorkBench/frontend/src/api/featureRequests.js`
- `HiTessWorkBench/frontend/src/api/admin.js`
- `HiTessWorkBench/frontend/src/api/appCommunity.js`
- `HiTessWorkBench/frontend/src/utils/featureRequestBoard.js`
- `HiTessWorkBench/frontend/src/utils/featureRequestBoard.test.js`
- `HiTessWorkBench/frontend/src/components/community/FeatureRequestBoard.jsx`
- `HiTessWorkBench/frontend/src/components/admin/AdminFeatureRequestSummary.jsx`
- `HiTessWorkBench/frontend/src/pages/Support/UserRequests.jsx`
- `HiTessWorkBench/frontend/src/components/analysis/AppCommunityHub.jsx`

- [ ] **Step 2: 스테이징 제외 대상 재확인**

- ⚠ `HiTessWorkBench/frontend/src/config.js` — **스테이징 금지**. 로컬 개발자 백엔드 토글용 로컬 전용 변경이다.
- ⚠ `Darkmode.js/` — 임베디드 저장소, 절대 커밋하지 않는다.

- [ ] **Step 3: 커밋 메시지 초안(사용자 참고용)**

```
✨ feat: 기능 요청 module/priority 컬럼 승격 및 게시판 통합(Plan K)

- feature_requests 에 module(String(100), index), priority(String(20), index) 컬럼 추가
- 기존 본문의 [관련 모듈: …]\n[희망 중요도: …] 접두를 1회 마이그레이션으로 컬럼 승격(멱등)
- status 어휘 4개(Under Review/Planned/In Progress/Resolved)로 정규화, Completed/Done/해결 완료/완료 → Resolved
- GET /api/feature-requests 에 module/priority/status/app_key/q 필터 querystring
- GET /api/admin/feature-requests/summary — module × status 매트릭스 + 중요도 + autocomplete
- 관리자 상태 변경 시 notify(kind="feature_request.status_changed",
  dedupe_key="fr:{id}:status", dedupe_unread_only=True) — Plan A 지연 import
- UserRequests / AppCommunityHub 게시판을 공용 FeatureRequestBoard 컴포넌트로 통합,
  legacy stripMetaPreview 제거, AppCommunityHub REQUEST_STATUS 4개로 축소
- src/api/featureRequests.js 로 API 함수 8개 통합(admin.js / appCommunity.js 는 재-export)

서버 반영: git pull + 백엔드 재시작(스키마 부트스트랩이 컬럼·인덱스·마이그레이션 자동 적용).
InHouse 교체 대상 없음. 프론트 재배포(npm run dist) 필요.
```

---

## 자기 검토

- **spec 커버리지**: §3.1 컬럼(Task 1) · §3.2 정규화(Task 2) · §3.3 부트스트랩(Task 1) · §4.1 계약 (Task 2) · §4.2 파싱(Task 2) · §4.3 마이그레이션(Task 2) · §5.1 상태 알림(Task 3) · §5.2 create/update(Task 3) · §6.1 스키마(Task 1) · §6.2 라우트(Task 3) · §6.3 관리자 라우팅(Task 3+Plan A 링크) · §7.1 공용 컴포넌트(Task 5) · §7.2 UserRequests 축소(Task 6) · §7.3 AppCommunityHub 축소(Task 7) · §7.4 API 모듈 통합(Task 4) · §8 보관(문서만) · §10 서버 반영(Task 11). 비목표(§11)는 만들지 않는다 — 스레드 댓글·로드맵·GitHub 동기화·이메일-in·모듈 taxonomy 관리 화면·`notice.published` 알림.
- **플레이스홀더 없음**: 모든 코드 step 이 실제 코드. 프론트는 러너가 없어 수동 절차를 단계·기대 동작으로 적었다.
- **타입/이름 일관성**:
  - `FeatureRequest.author_id` (not `employee_id`) → `_notify_feature_request_status` 가 `employee_id=req.author_id` 로 넘긴다.
  - `FeatureRequest.content` (not `description`) → `parse_legacy_body(content)` 시그니처와 일치.
  - `FEATURE_REQUEST_STATUSES` = 4개 문자열 튜플 = 프론트 유틸의 `FEATURE_REQUEST_STATUSES` 배열 = `AppCommunityHub` `REQUEST_STATUS` 키.
  - `FEATURE_REQUEST_PRIORITIES` = `('낮음','보통','높음','긴급')` = 프론트 배열 = 파서의 접두 매치 대상.
  - `dedupe_key = f"fr:{req.id}:status"` 는 백엔드 라우터와 라우터 테스트가 같은 문자열을 사용.
  - `notify` 시그니처는 마스터 §2.1: `(db, *, employee_id, kind, title, body, link, dedupe_key, dedupe_unread_only)` — Plan A 실제 구현과 일치(옵션 `dedupe_unread_only` 포함).
  - API 함수 8개(`listFeatureRequests` … `getFeatureRequestSummary`)는 `featureRequests.js` 에 정의, `admin.js`/`appCommunity.js` 는 재-export 만.
- **의존 순서**:
  - Task 1(모델·스키마·부트스트랩) → Task 2(서비스, 마이그레이션은 부트스트랩이 지연 import) → Task 3(라우터가 서비스의 `normalize_status`/`parse_legacy_body` 사용) → Task 4(프론트 API+유틸) → Task 5(공용 컴포넌트가 Task 4 를 import) → Task 6/7(UserRequests, AppCommunityHub 이 Task 5 를 사용) → Task 8(요약 카드가 Task 4 의 `getFeatureRequestSummary` 사용).
  - Plan A 는 지연 import 라 어느 순서로 들어와도 라우터/서비스는 안전.
- **회귀 방지 확인**:
  - `updated_at` 컬럼을 추가하지 않는다 — 모델에 원래 없다(§비목표).
  - `Analysis` · `Notice` 등 다른 테이블은 손대지 않는다(마스터 §7 YAGNI).
  - `FeatureRequestUpvote` 유니크 제약과 낙관적 갱신은 그대로 유지(§2 결정 7).
  - `admin_comment` 1슬롯 유지(§2 결정 8) — 댓글 스레드로 확장하지 않는다.
  - `GUARDED_ROUTES` 등록 안 함(§2 결정 12) — 플랫폼 공통 기능.
- **UI 텍스트**: 모든 라벨은 한국어(`검토 중`, `계획됨`, `진행 중`, `해결됨`, `미분류`, `추천`, `제출`, `피드백 저장`), 식별자는 영어.
- **테스트 커버리지 요약**:
  - `test_feature_request_migration.py` — 9건(스키마 create_all, 부트스트랩 멱등, 마이그레이션 순서/역순/접두없음/멱등/status 정규화/닫는 대괄호 누락).
  - `test_feature_request_service.py` — 22건(어휘 lock 2 + status 파라메트라이즈 8 + reject 2 + 파싱 8 + summary/autocomplete 2).
  - `test_feature_request_router.py` — 15건(필터 3 + 앱 와일드카드 + 쿼리 + 컬럼 저장 3 + 정규화 + 알림 3 + 요약 권한 2 + auth 1).
  - `test_feature_request_schemas.py` — 3건(create/update/response).
  - `test_featureRequestBoard.js` (node) — 7건(어휘 2 + starter + resolved + module label + legacy prefix + params + variant).
