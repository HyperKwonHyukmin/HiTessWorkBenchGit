# 전역 검색 (Plan J) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ctrl+K 명령 팔레트 안에 "데이터" 섹션을 추가해서, 해석 이력·프로젝트·공지·사용자 가이드를 **한 곳에서** 검색할 수 있게 한다. 백엔드는 얇은 `GET /api/search` 하나를 얹고, 서비스는 scope 별 리졸버 4개(analysis/notice/guide/project)를 순차 호출한다. 매칭 위치를 `<mark>` 로 감싼 스니펫을 백엔드가 만들어 프론트로 넘기고, 프론트는 300ms 디바운스 + `AbortController` 로 서버 왕복을 줄인다. 새 페이지·별도 단축키·URL 라우팅은 만들지 않는다.

**Architecture:** 백엔드 — `schema_bootstrap.ensure_search_indexes()`(MySQL FULLTEXT 시도, 실패 시 로그 후 무시) + 순수 유틸 `utils/search_snippet.py`(`make_snippet(text, query, radius=40)`) + `services/search_service.py`(`run_search`, scope 별 리졸버 4개, `can_view`·`_filter_published_notices` 조건 재조립 + Plan G 지연 import 폴백) + `routers/search.py`(단일 GET, `require_auth`). 프론트 — `api/search.js`(`runSearch(q, scope, signal)`) + 순수 유틸 `utils/searchDebounce.js`(`node --test`) + `CommandPalette.jsx` 확장("데이터" 섹션, scope 별 그룹 헤더, `sessionStorage` + `workbench:open-project-detail` 이벤트로 Plan A 규약 재사용). Layout 변경 없음, 새 컴포넌트 없음.

**Tech Stack:** Python 3.14 / FastAPI / SQLAlchemy(MySQL 운영, SQLite 테스트) / pytest — React 18 + Vite + Tailwind + lucide-react + axios. 신규 의존성 없음. 프론트 테스트 러너 없음(순수 유틸만 `node --test`).

**Spec:** `docs/superpowers/specs/2026-09-18-global-search-design.md`
(마스터: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1 · §2.10 · §2.7 · §3)

**규칙(마스터 §1):**
- 커밋은 사용자가 직접 한다 — 각 Task 마지막 단계는 **"커밋 준비 완료 — 변경 파일 목록을 사용자에게 보고"**.
- `HiTessWorkBench/frontend/src/config.js` 는 절대 스테이징하지 않는다. `Darkmode.js/` 는 건드리지 않는다.
- 백엔드는 TDD(실패 테스트 → 최소 구현 → 통과). 프론트는 순수 유틸만 `node --test` 로 검증하고 UI 통합은 수동 검증 절차를 따른다.
- 문서·주석·UI 문구는 한국어, 식별자는 영어.

**테스트 실행 위치:** 모든 pytest 명령은 `C:\Coding\WorkBench\HiTessWorkBenchBackEnd` 에서 `WorkBenchEnv/Scripts/python.exe -m pytest …` 로 실행한다. 프론트 `node --test` 는 `C:\Coding\WorkBench\HiTessWorkBench\frontend` 에서 실행한다. 빌드 확인은 `npm run build`.

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `HiTessWorkBenchBackEnd/app/schema_bootstrap.py` | 수정 | `ensure_search_indexes()` 함수 추가 + `run_schema_bootstrap()` 마지막 호출로 삽입 |
| `HiTessWorkBenchBackEnd/app/utils/__init__.py` | 확인·필요 시 생성 | 순수 유틸 서브패키지(이 plan 이 첫 도입이면 빈 파일 생성) |
| `HiTessWorkBenchBackEnd/app/utils/search_snippet.py` | 생성 | `make_snippet(text, query, radius=40)` — HTML escape + `<mark>` 감싸기 |
| `HiTessWorkBenchBackEnd/app/services/search_service.py` | 생성 | `run_search(db, user, q, scope, limit=8)` + scope 별 리졸버 4개 + Plan G 지연 import |
| `HiTessWorkBenchBackEnd/app/routers/search.py` | 생성 | `GET /api/search?q=&scope=&limit=` (require_auth) |
| `HiTessWorkBenchBackEnd/app/main.py` | 수정 | import + `include_router(search.router)` |
| `HiTessWorkBenchBackEnd/tests/test_search_snippet.py` | 생성 | 순수 유틸 회귀(빈 텍스트/한글/앞뒤 잘림/HTML escape/`<mark>` 감싸기/두 건 매치) |
| `HiTessWorkBenchBackEnd/tests/test_search_service.py` | 생성 | scope 별 리졸버 계약(권한·필터·정렬·LIKE escape) |
| `HiTessWorkBenchBackEnd/tests/test_search_router.py` | 생성 | API 계약(401·400·422·응답 스키마) |
| `HiTessWorkBenchBackEnd/tests/test_search_schema_bootstrap.py` | 생성 | SQLite 는 노옵·MySQL 은 시도 후 실패도 흡수 |
| `HiTessWorkBench/frontend/src/api/search.js` | 생성 | `runSearch({q, scope, limit, signal})` — `AbortController` 지원 |
| `HiTessWorkBench/frontend/src/utils/searchDebounce.js` | 생성 | `debouncePromise(fn, ms)` 순수 유틸 |
| `HiTessWorkBench/frontend/src/utils/searchDebounce.test.js` | 생성 | `node:test` 로 300ms 디바운스·마지막 인자 우선·취소 검증 |
| `HiTessWorkBench/frontend/src/components/platform/CommandPalette.jsx` | 수정 | "데이터" 섹션 + scope 별 그룹 헤더 + 항목 클릭 시 세션 키/이벤트 발행 |

`app/utils/` 서브패키지는 이미 다른 파일이 있을 수 있으므로 Task 2 Step 3 에서 `Glob` 으로 존재를 먼저 확인한다.

---

### Task 1: `schema_bootstrap.ensure_search_indexes()` — FULLTEXT 시도(멱등, 실패 흡수)

FULLTEXT 인덱스는 **본 판정 경로**(§2 결정 1)에 쓰이지 않는다 — 서비스는 `LIKE '%q%'` 만 쓴다.
이 함수는 향후 `MATCH() AGAINST()` 로 갈아탈 때를 위해 인덱스 **자리만** 잡아 둔다.
- MySQL 이 아닌 엔진(테스트의 SQLite)은 그대로 return.
- 재실행 시 `_add_missing_indexes` 가 이미 있는 이름을 건너뛰므로 두 번째 CREATE 는 나가지 않는다.
- charset · ngram parser · 엔진 조건이 안 맞아 실패해도 `OperationalError` 를 잡아 `WARNING` 한 줄만 남긴다(서버 기동은 계속).

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/schema_bootstrap.py:33-55`(`_add_missing_indexes` 위), `:152-160`(`run_schema_bootstrap()` 끝)
- Create: `HiTessWorkBenchBackEnd/tests/test_search_schema_bootstrap.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_search_schema_bootstrap.py`:

```python
"""전역 검색 FULLTEXT 인덱스 시도 — SQLite 는 노옵, MySQL 실패는 로그 후 흡수."""
import logging
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import OperationalError
from sqlalchemy.pool import StaticPool

from app import models
from app.schema_bootstrap import ensure_search_indexes, run_schema_bootstrap


def _sqlite_engine():
    return create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def test_ensure_search_indexes_is_noop_on_sqlite():
    """FULLTEXT 는 InnoDB 전용이라 SQLite 엔진은 시도조차 하지 말아야 한다."""
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    # 예외가 나오면 안 되고, 인덱스 목록도 그대로여야 한다.
    before = {i["name"] for i in inspect(engine).get_indexes("notices")}
    ensure_search_indexes(engine=engine)
    after = {i["name"] for i in inspect(engine).get_indexes("notices")}
    assert before == after


def test_ensure_search_indexes_swallows_operational_error(caplog):
    """운영 MySQL 이 charset 문제로 FULLTEXT 를 거부해도 서버는 기동해야 한다."""
    fake_engine = MagicMock()
    fake_engine.url.get_backend_name.return_value = "mysql"

    def _raise(*_args, **_kwargs):
        raise OperationalError("CREATE FULLTEXT", {}, Exception("charset"))

    with patch("app.schema_bootstrap._add_missing_indexes", side_effect=_raise):
        with caplog.at_level(logging.WARNING):
            ensure_search_indexes(engine=fake_engine)

    assert any("FULLTEXT" in rec.getMessage() for rec in caplog.records)


def test_run_schema_bootstrap_calls_search_indexes(monkeypatch):
    """run_schema_bootstrap 이 새 훅을 마지막 순서에서 부른다."""
    called = []
    import app.schema_bootstrap as sb
    monkeypatch.setattr(sb, "ensure_search_indexes", lambda *, engine=None: called.append("s"))

    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    run_schema_bootstrap(engine=engine)
    assert called == ["s"]
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_search_schema_bootstrap.py -q
```
기대: `ImportError: cannot import name 'ensure_search_indexes' from 'app.schema_bootstrap'` 로 수집 단계 실패(`1 error`).

- [ ] **Step 3: `ensure_search_indexes()` 추가** — `app/schema_bootstrap.py`

(a) 상단 `from sqlalchemy import inspect, text` 아래에 로거·예외 import 를 추가:

```python
import logging

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError

from . import database

logger = logging.getLogger(__name__)
```

(b) `ensure_app_spaces`(124~149행) 바로 아래, `run_schema_bootstrap` 위에 함수를 하나 둔다:

```python


def ensure_search_indexes(*, engine=None) -> None:
    """전역 검색용 FULLTEXT 인덱스를 시도만 하고 실패는 흡수합니다.

    서비스(services/search_service)는 이 인덱스를 **읽지 않고** 항상 LIKE 를 쓴다 —
    향후 MATCH() AGAINST() 도입 시 그대로 재활용할 수 있게 자리만 잡아 둔다.
    SQLite(tests) 는 FULLTEXT 를 지원하지 않으므로 진입하지 않고, MySQL 에서도 charset·
    엔진 조건이 맞지 않아 CREATE 가 실패할 수 있어 OperationalError 를 로그 한 줄로 넘긴다.
    """
    target_engine = engine or database.engine
    if target_engine.url.get_backend_name() != "mysql":
        return

    try:
        _add_missing_indexes(
            "notices",
            {
                "ft_notices_title_content": (
                    "CREATE FULLTEXT INDEX ft_notices_title_content "
                    "ON notices (title, content)"
                ),
            },
            engine=target_engine,
        )
        _add_missing_indexes(
            "user_guides",
            {
                "ft_user_guides_title_content": (
                    "CREATE FULLTEXT INDEX ft_user_guides_title_content "
                    "ON user_guides (title, content)"
                ),
            },
            engine=target_engine,
        )
        _add_missing_indexes(
            "analysis",
            {
                "ft_analysis_project_name": (
                    "CREATE FULLTEXT INDEX ft_analysis_project_name "
                    "ON analysis (project_name)"
                ),
            },
            engine=target_engine,
        )
    except OperationalError as exc:
        # utf8mb4 · ngram parser · 엔진(InnoDB→MyISAM) 조건이 안 맞으면 여기로 온다.
        logger.warning("[SchemaBootstrap] FULLTEXT 인덱스 생성을 건너뜁니다 — %s", exc)
```

(c) `run_schema_bootstrap()`(152~160행)의 마지막에 호출을 추가:

```python
def run_schema_bootstrap(*, engine=None) -> None:
    """기존 호출은 production engine을, 테스트는 주입된 engine을 사용합니다."""
    ensure_notice_columns(engine=engine)
    ensure_user_columns(engine=engine)
    ensure_user_presence_columns(engine=engine)
    ensure_analysis_job_columns(engine=engine)
    ensure_app_community_columns(engine=engine)
    ensure_chat_message_columns(engine=engine)
    ensure_app_spaces(engine=engine)
    ensure_search_indexes(engine=engine)
```

- [ ] **Step 4: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_search_schema_bootstrap.py -q
```
기대: `3 passed`.

기존 부트스트랩 회귀:
```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_database_lifecycle.py tests/test_notification_models.py -q
```
기대: 실패 0(존재하지 않는 파일은 건너뛰어도 됨 — 이 plan 은 A 와 독립).

- [ ] **Step 5: 커밋 준비 완료** — 보고: `app/schema_bootstrap.py`, `tests/test_search_schema_bootstrap.py`.

---

### Task 2: 순수 유틸 `utils/search_snippet.py` — HTML escape + `<mark>` 감싸기

프론트가 별도로 하이라이팅하지 않고 백엔드가 만든 HTML 조각(`<mark>…</mark>`)을 그대로 렌더한다.
그래서 **`text` 와 `q` 는 반드시 escape 후 매치를 찾는다** — 원문에 `<script>` 가 들어와도
프론트에 안전한 문자열이 넘어간다. 매치가 없으면 앞 `2·radius` 자를 잘라 반환한다(스니펫은 있어야 UI 가 자리 잡는다).

**Files:**
- Confirm/Create: `HiTessWorkBenchBackEnd/app/utils/__init__.py`
- Create: `HiTessWorkBenchBackEnd/app/utils/search_snippet.py`
- Create: `HiTessWorkBenchBackEnd/tests/test_search_snippet.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_search_snippet.py`:

```python
"""전역 검색 스니펫 순수 유틸 — HTML escape + <mark> 감싸기."""
from app.utils.search_snippet import make_snippet


def test_empty_text_returns_empty_string():
    assert make_snippet("", "abc") == ""
    assert make_snippet(None, "abc") == ""


def test_empty_query_returns_leading_slice():
    """질의가 비면 앞 2·radius 자를 그대로 자른다(HTML escape 만)."""
    text = "abcdefghij" * 20
    result = make_snippet(text, "", radius=10)
    # 매치가 없으므로 <mark> 없음
    assert "<mark>" not in result
    assert result.startswith("abcdefghij")


def test_center_match_is_wrapped_with_mark():
    text = "prefix words " + ("padding " * 20) + "TARGET" + (" padding" * 20) + " suffix"
    snippet = make_snippet(text, "target", radius=20)
    assert "<mark>TARGET</mark>" in snippet
    # 앞뒤로 잘린 흔적
    assert snippet.startswith("…") and snippet.endswith("…")


def test_head_match_no_leading_ellipsis():
    text = "TARGET is at the start"
    snippet = make_snippet(text, "TARGET", radius=40)
    assert snippet.startswith("<mark>TARGET</mark>")
    assert not snippet.startswith("…")


def test_tail_match_no_trailing_ellipsis():
    text = "end of the sentence hits TARGET"
    snippet = make_snippet(text, "target", radius=40)
    assert snippet.endswith("<mark>TARGET</mark>")
    assert not snippet.endswith("…")


def test_case_insensitive_match_preserves_original_casing():
    """대소문자 무시로 매치를 찾되, <mark> 안 원문 대소문자는 유지한다."""
    snippet = make_snippet("Truss Assessment 해석", "truss", radius=10)
    assert "<mark>Truss</mark>" in snippet


def test_korean_match():
    text = "3496 유닛 권상 구조해석 결과 요약"
    snippet = make_snippet(text, "권상", radius=6)
    assert "<mark>권상</mark>" in snippet


def test_html_injection_is_escaped():
    """원문·질의의 <, >, & 는 항상 escape 되고, <mark> 만 리터럴로 남는다."""
    text = 'name = <script>alert("x")</script>'
    snippet = make_snippet(text, "script", radius=20)
    assert "<script>" not in snippet
    assert "&lt;script&gt;" in snippet or "&lt;/script&gt;" in snippet
    assert "<mark>script</mark>" in snippet


def test_query_with_html_chars_is_escaped_before_matching():
    """질의에 <, > 가 들어와도 크래시하지 않고 매치 자체를 놓칠 뿐이다."""
    snippet = make_snippet("plain body", "<>", radius=5)
    # 매치 실패 → 앞부분만 잘라 반환
    assert "<mark>" not in snippet


def test_first_match_wins_and_second_is_not_wrapped():
    """radius 안에 두 번째 매치가 들어와도 이 유틸은 첫 매치만 감싼다(경계 애매함 방지).

    두 번째 이후 매치는 escape 된 원문 그대로 보인다.
    """
    text = "foo target bar target baz"
    snippet = make_snippet(text, "target", radius=40)
    # 정확히 한 번만 감싼다
    assert snippet.count("<mark>") == 1
    assert snippet.count("</mark>") == 1


def test_snippet_length_bounded_by_radius():
    """radius=40 이면 매치 앞뒤 최대 40자씩 + 매치 길이 + '…' 2개보다 길지 않다."""
    text = "x" * 500 + "TARGET" + "y" * 500
    snippet = make_snippet(text, "target", radius=40)
    # 태그·escape 제거 후 원문 길이 상한 확인은 생략, 대신 대략 상한만
    assert len(snippet) < 40 * 2 + len("TARGET") + len("<mark></mark>") + 4
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_search_snippet.py -q
```
기대: `ModuleNotFoundError: No module named 'app.utils.search_snippet'`(`1 error`).

- [ ] **Step 3: `app/utils/__init__.py` 존재 확인**

`HiTessWorkBenchBackEnd/app/utils/__init__.py` 가 있으면 그대로 두고, 없으면 빈 파일을 만든다:

```
Test-Path HiTessWorkBenchBackEnd\app\utils\__init__.py
```
없으면 Write 로 빈 문자열을 쓴다(모듈 인식용).

- [ ] **Step 4: 순수 유틸 구현** — `HiTessWorkBenchBackEnd/app/utils/search_snippet.py`:

```python
"""전역 검색용 스니펫 생성 — HTML escape + <mark> 감싸기(순수 함수).

프론트는 이 유틸이 만든 HTML 을 `dangerouslySetInnerHTML` 로 그대로 그린다 —
그래서 백엔드가 **먼저 escape 하고** 그 다음 매치 부분만 <mark>…</mark> 로 감싼다.
매치 검색은 대소문자 무시이며 원문 대소문자는 유지한다.

`services/search_service.run_search` 가 결과 아이템 하나마다 이 함수를 부른다.
"""
from html import escape


def make_snippet(text: str | None, query: str, radius: int = 40) -> str:
    """매칭 위치 앞뒤 `radius` 자를 잘라 스니펫 문자열을 만든다.

    - text 가 None/빈 문자열이면 "" 반환.
    - query 가 비거나 매치가 없으면 앞 2·radius 자를 잘라 반환(스니펫은 있어야 UI 가 자리 잡는다).
    - 매치를 찾으면 첫 매치만 <mark>…</mark> 로 감싼다(두 번째 이후 매치는 escape 만).
    - 앞/뒤가 잘리면 각 방향에 `…` 를 붙인다.
    """
    if not text:
        return ""
    if not query:
        # 매치 없이 앞 2·radius 자만
        head = text[: 2 * radius]
        suffix = "…" if len(text) > len(head) else ""
        return escape(head) + suffix

    lower_text = text.lower()
    lower_q = query.lower()
    idx = lower_text.find(lower_q)
    if idx < 0:
        head = text[: 2 * radius]
        suffix = "…" if len(text) > len(head) else ""
        return escape(head) + suffix

    start = max(0, idx - radius)
    end = min(len(text), idx + len(query) + radius)
    before = text[start:idx]
    matched = text[idx : idx + len(query)]
    after = text[idx + len(query) : end]

    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return f"{prefix}{escape(before)}<mark>{escape(matched)}</mark>{escape(after)}{suffix}"
```

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_search_snippet.py -q
```
기대: `11 passed`.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/utils/search_snippet.py`, `app/utils/__init__.py`(신규인 경우), `tests/test_search_snippet.py`.

---

### Task 3: `services/search_service.py` — `run_search()` 계약

scope 어휘 · 상한 8건 · `created_at DESC` · 각 리졸버가 리턴하는 항목 스키마
(`id, title, snippet, menu, params`)를 이 서비스가 확정한다. Plan G 의 `can_view` 는
**지연 import**(spec §5.1) 로 쓰고, 없으면 소유자/관리자 폴백. `notice` 는
`support.py:91-98` 의 `_filter_published_notices` 와 **완전히 같은 조건**을 서비스가
직접 조립한다(import cycle 회피 — support 가 이 서비스를 부를 일은 없지만 반대는 금지).

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/search_service.py`
- Create: `HiTessWorkBenchBackEnd/tests/test_search_service.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_search_service.py`:

```python
"""search_service.run_search 계약 — scope 별 리졸버·권한·필터·LIKE escape."""
from datetime import datetime, timedelta

import pytest

from app import models
from app.services.search_service import ALLOWED_SCOPES, run_search


# ---------- 헬퍼 ----------

def _admin(db):
    u = models.User(employee_id="ADMIN001", name="관리자", company="HHI",
                    is_active=True, is_admin=True, is_developer=False)
    db.add(u); db.commit(); return u


def _user(db, eid="EMP001", is_admin=False):
    u = models.User(employee_id=eid, name=eid, company="HHI",
                    is_active=True, is_admin=is_admin, is_developer=False)
    db.add(u); db.commit(); return u


def _make_notice(db, title, content="", **overrides):
    now = datetime.now()
    row = models.Notice(
        title=title, content=content,
        is_private=overrides.get("is_private", False),
        publish_status=overrides.get("publish_status", "published"),
        starts_at=overrides.get("starts_at"),
        ends_at=overrides.get("ends_at"),
        created_at=overrides.get("created_at", now),
    )
    db.add(row); db.commit(); return row


def _make_guide(db, title, category="일반", content="", **overrides):
    row = models.UserGuide(title=title, category=category, content=content,
                           created_at=overrides.get("created_at", datetime.now()))
    db.add(row); db.commit(); return row


# ---------- 어휘·게이트 ----------

def test_scope_vocabulary_is_fixed():
    assert ALLOWED_SCOPES == frozenset({"all", "analysis", "notice", "guide", "project"})


def test_short_query_raises_value_error(db_session):
    _admin(db_session)
    with pytest.raises(ValueError):
        run_search(db_session, "ADMIN001", "a")
    with pytest.raises(ValueError):
        run_search(db_session, "ADMIN001", "")
    with pytest.raises(ValueError):
        run_search(db_session, "ADMIN001", "   ")


def test_unknown_scope_raises_value_error(db_session):
    _admin(db_session)
    with pytest.raises(ValueError):
        run_search(db_session, "ADMIN001", "test", scope="something")


# ---------- scope=all 응답 스키마 ----------

def test_all_returns_four_groups_in_fixed_order(db_session):
    _admin(db_session)
    res = run_search(db_session, "ADMIN001", "테스트", scope="all")
    assert res["scope"] == "all"
    assert res["query"] == "테스트"
    assert [g["scope"] for g in res["groups"]] == ["analysis", "project", "notice", "guide"]


# ---------- analysis ----------

def test_analysis_matches_project_and_program_name(db_session, make_analysis):
    _user(db_session, "EMP001")
    a = make_analysis("EMP001", "Truss Assessment", datetime(2026, 9, 18, 9, 0, 0), status="Success")
    a.project_name = "3496 유닛 권상"; db_session.commit()

    hits = run_search(db_session, "EMP001", "3496", scope="analysis")["groups"][0]["items"]
    assert len(hits) == 1
    assert hits[0]["id"] == a.id
    assert "<mark>3496</mark>" in hits[0]["snippet"]
    assert hits[0]["menu"] == "My Projects"
    assert hits[0]["params"] == {"analysis_id": a.id}

    hits = run_search(db_session, "EMP001", "Truss", scope="analysis")["groups"][0]["items"]
    assert hits[0]["id"] == a.id


def test_analysis_owner_only_without_plan_g(db_session, make_analysis, monkeypatch):
    """Plan G 이전에는 소유자·관리자만 볼 수 있다(다른 사용자에게는 안 뜬다)."""
    _user(db_session, "EMP001")
    _user(db_session, "EMP002")
    a = make_analysis("EMP001", "Truss Assessment", datetime.now(), status="Success")
    a.project_name = "3496 SEARCHKEY"; db_session.commit()

    mine = run_search(db_session, "EMP001", "SEARCHKEY", scope="analysis")["groups"][0]["items"]
    theirs = run_search(db_session, "EMP002", "SEARCHKEY", scope="analysis")["groups"][0]["items"]
    assert [h["id"] for h in mine] == [a.id]
    assert theirs == []


def test_analysis_admin_sees_others(db_session, make_analysis):
    _admin(db_session)
    a = make_analysis("EMP001", "Truss Assessment", datetime.now(), status="Success")
    a.project_name = "3496 SEARCHKEY"; db_session.commit()

    hits = run_search(db_session, "ADMIN001", "SEARCHKEY", scope="analysis")["groups"][0]["items"]
    assert [h["id"] for h in hits] == [a.id]


def test_analysis_uses_plan_g_can_view_when_available(db_session, make_analysis, monkeypatch):
    """Plan G 가 설치돼 can_view 가 import 되면 그것을 우선한다."""
    _user(db_session, "EMP002")
    a = make_analysis("EMP001", "Truss Assessment", datetime.now(), status="Success")
    a.project_name = "3496 SEARCHKEY"; db_session.commit()

    # Plan G 규약: routers/_access_control.can_view(record, user) -> bool
    import app.services.search_service as ss

    class _Stub:
        @staticmethod
        def can_view(record, user):
            return True  # 멤버라고 가정

    monkeypatch.setattr(ss, "_load_access_control", lambda: _Stub)

    hits = run_search(db_session, "EMP002", "SEARCHKEY", scope="analysis")["groups"][0]["items"]
    assert [h["id"] for h in hits] == [a.id]


def test_analysis_orders_by_created_at_desc(db_session, make_analysis):
    _user(db_session, "EMP001")
    old = make_analysis("EMP001", "Truss Assessment", datetime(2026, 8, 1), status="Success")
    old.project_name = "3496 old"; db_session.commit()
    new = make_analysis("EMP001", "Truss Assessment", datetime(2026, 9, 20), status="Success")
    new.project_name = "3496 new"; db_session.commit()

    hits = run_search(db_session, "EMP001", "3496", scope="analysis")["groups"][0]["items"]
    assert [h["id"] for h in hits] == [new.id, old.id]


def test_analysis_scope_respects_limit(db_session, make_analysis):
    _user(db_session, "EMP001")
    for i in range(12):
        a = make_analysis("EMP001", "Truss Assessment", datetime(2026, 9, i + 1),
                          status="Success")
        a.project_name = f"KEY-{i:02d}"; db_session.commit()

    hits = run_search(db_session, "EMP001", "KEY-", scope="analysis", limit=5)["groups"][0]["items"]
    assert len(hits) == 5


# ---------- notice ----------

def test_notice_only_published_and_within_window(db_session):
    _user(db_session, "EMP001")
    now = datetime.now()
    ok = _make_notice(db_session, "공지 SEARCHKEY 하나")
    _make_notice(db_session, "비공개 SEARCHKEY", is_private=True)
    _make_notice(db_session, "미게시 SEARCHKEY", publish_status="draft")
    _make_notice(db_session, "종료된 SEARCHKEY", ends_at=now - timedelta(days=1))
    _make_notice(db_session, "미래 SEARCHKEY", starts_at=now + timedelta(days=1))

    hits = run_search(db_session, "EMP001", "SEARCHKEY", scope="notice")["groups"][0]["items"]
    assert [h["id"] for h in hits] == [ok.id]
    assert hits[0]["menu"] == "Notice & Updates"
    assert hits[0]["params"] == {"notice_id": ok.id}


def test_notice_matches_content(db_session):
    _user(db_session, "EMP001")
    row = _make_notice(db_session, "공지 제목", content="본문에 SEARCHKEY 가 들어 있다")
    hits = run_search(db_session, "EMP001", "SEARCHKEY", scope="notice")["groups"][0]["items"]
    assert [h["id"] for h in hits] == [row.id]
    assert "<mark>SEARCHKEY</mark>" in hits[0]["snippet"]


# ---------- guide ----------

def test_guide_matches_title_or_content_or_category(db_session):
    _user(db_session, "EMP001")
    _make_guide(db_session, "SEARCHKEY 로 시작하는 가이드")
    _make_guide(db_session, "다른 제목", content="본문에 SEARCHKEY")
    _make_guide(db_session, "카테고리 매치", category="SEARCHKEY-카테고리")
    _make_guide(db_session, "매치 없음", content="관련 없음")

    hits = run_search(db_session, "EMP001", "SEARCHKEY", scope="guide")["groups"][0]["items"]
    assert len(hits) == 3
    assert hits[0]["menu"] == "User Guide"
    assert "guide_id" in hits[0]["params"]
    assert "category" in hits[0]["params"]


# ---------- project (Plan G 미실행) ----------

def test_project_returns_empty_when_plan_g_absent(db_session):
    _user(db_session, "EMP001")
    res = run_search(db_session, "EMP001", "anything", scope="project")
    assert res["groups"][0]["items"] == []


# ---------- LIKE escape ----------

def test_like_wildcards_are_escaped(db_session, make_analysis):
    """검색어에 % 가 들어와도 전체 매치가 되면 안 된다."""
    _user(db_session, "EMP001")
    a = make_analysis("EMP001", "Truss Assessment", datetime.now(), status="Success")
    a.project_name = "일반 이름"; db_session.commit()
    b = make_analysis("EMP001", "Truss Assessment", datetime.now(), status="Success")
    b.project_name = "50%_할증"; db_session.commit()

    # '%' 를 리터럴로 취급해야 '50%_할증' 만 매치돼야 한다.
    hits = run_search(db_session, "EMP001", "%_", scope="analysis")["groups"][0]["items"]
    assert [h["id"] for h in hits] == [b.id]


def test_underscore_wildcard_is_escaped(db_session, make_analysis):
    _user(db_session, "EMP001")
    a = make_analysis("EMP001", "Truss Assessment", datetime.now(), status="Success")
    a.project_name = "abc_def"; db_session.commit()
    b = make_analysis("EMP001", "Truss Assessment", datetime.now(), status="Success")
    b.project_name = "abcXdef"; db_session.commit()

    hits = run_search(db_session, "EMP001", "abc_def", scope="analysis")["groups"][0]["items"]
    assert [h["id"] for h in hits] == [a.id]


# ---------- scope=all limit ----------

def test_all_scope_caps_each_group_at_limit(db_session, make_analysis):
    _user(db_session, "EMP001")
    for i in range(12):
        a = make_analysis("EMP001", "Truss Assessment", datetime(2026, 9, i + 1),
                          status="Success")
        a.project_name = f"CAPKEY-{i:02d}"; db_session.commit()
    for i in range(12):
        _make_notice(db_session, f"CAPKEY-{i:02d}")

    res = run_search(db_session, "EMP001", "CAPKEY", scope="all", limit=8)
    per = {g["scope"]: len(g["items"]) for g in res["groups"]}
    assert per["analysis"] == 8
    assert per["notice"] == 8
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_search_service.py -q
```
기대: `ModuleNotFoundError: No module named 'app.services.search_service'`(`1 error`).

- [ ] **Step 3: 서비스 구현** — `HiTessWorkBenchBackEnd/app/services/search_service.py`:

```python
"""전역 검색 서비스 — Ctrl+K 팔레트 "데이터" 섹션을 채우는 단일 진입점.

scope 별 리졸버 4개를 순차 호출하고, 각 결과 아이템에 스니펫(`<mark>` 감쌈)을 붙여
`{id, title, snippet, menu, params}` 로 정규화한다. 정렬은 각 리졸버 안에서
`created_at DESC` 만 — 랭킹(BM25/relevance)은 이번 범위 밖(spec §3-6).

권한 규약(§2.10 · §2.7):
  * analysis  — Plan G 의 can_view 우선, 없으면 소유자 or 관리자 폴백
  * notice    — 공개 · published · starts_at/ends_at 범위 안(support._filter_published_notices 와 동일 조건)
  * guide     — 로그인 사용자 전부
  * project   — 오너 or project_members 멤버(Plan G 이전에는 빈 배열)

이 모듈은 라우터를 갖지 않는다(라우터는 routers/search.py).
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal

from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models
from ..utils.search_snippet import make_snippet

logger = logging.getLogger(__name__)

SearchScope = Literal["all", "analysis", "notice", "guide", "project"]

ALLOWED_SCOPES = frozenset({"all", "analysis", "notice", "guide", "project"})
DEFAULT_LIMIT = 8
MAX_LIMIT = 20
MIN_QUERY_LEN = 2
SNIPPET_RADIUS = 40
# scope=all 응답 순서(사용 빈도) — spec §3-12
_ALL_SCOPE_ORDER = ("analysis", "project", "notice", "guide")


# ---------- 지연 import 헬퍼 ----------

def _load_access_control():
    """Plan G 가 배포됐다면 routers/_access_control 을 반환, 아니면 None."""
    try:
        from ..routers import _access_control  # type: ignore
        return _access_control
    except ImportError:
        return None


def _load_project_models():
    """Plan G 의 Project/ProjectMember 모델 — 없으면 None 을 돌려 project scope 는 빈 배열."""
    try:
        Project = getattr(models, "Project")
        ProjectMember = getattr(models, "ProjectMember")
        return Project, ProjectMember
    except AttributeError:
        return None


# ---------- LIKE escape ----------

_LIKE_ESCAPE = "\\"


def _escape_like(term: str) -> str:
    """LIKE 특수문자(`%`, `_`, `\\`)를 리터럴로 만든다.

    폴더명·타임스탬프에 `_` 가 흔해서 전량 매치 오탐을 낳는다 — SQLAlchemy `ilike(..., escape='\\')`
    로 escape 문자를 지정하고 term 안에서만 앞에 `\\` 를 붙인다.
    """
    return (
        term.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2)
            .replace("%", _LIKE_ESCAPE + "%")
            .replace("_", _LIKE_ESCAPE + "_")
    )


def _like_term(q: str) -> str:
    return f"%{_escape_like(q)}%"


# ---------- 공용 admin 판정 ----------

def _is_admin(db: Session, employee_id: str) -> bool:
    if not employee_id:
        return False
    row = (
        db.query(models.User)
        .filter(models.User.employee_id == employee_id)
        .first()
    )
    return bool(row and row.is_admin)


# ---------- 리졸버: analysis ----------

def _search_analyses(db: Session, user: str, q: str, limit: int) -> list[dict]:
    term = _like_term(q)
    query = (
        db.query(models.Analysis)
        .filter(
            or_(
                models.Analysis.project_name.ilike(term, escape=_LIKE_ESCAPE),
                models.Analysis.program_name.ilike(term, escape=_LIKE_ESCAPE),
                models.Analysis.job_id.ilike(term, escape=_LIKE_ESCAPE),
            )
        )
        .order_by(models.Analysis.created_at.desc())
    )
    # Plan G 이전 폴백: 소유자 or 관리자만.
    access = _load_access_control()
    is_admin = _is_admin(db, user)
    if access is None or not hasattr(access, "can_view"):
        if not is_admin:
            query = query.filter(models.Analysis.employee_id == user)
        rows = query.limit(limit).all()
    else:
        # can_view 는 Python 검사라 쿼리 뒤에 필터. 상한을 넉넉히(limit*3) 잡고 통과분만.
        candidates = query.limit(max(limit * 3, limit)).all()
        rows = []
        for row in candidates:
            try:
                if access.can_view(row, user):
                    rows.append(row)
                    if len(rows) >= limit:
                        break
            except Exception:
                # can_view 가 새 예외를 던지면 그 항목만 건너뛴다(다른 결과는 살린다).
                logger.debug("can_view 예외 — analysis_id=%s", getattr(row, "id", None),
                             exc_info=True)

    items = []
    for row in rows:
        title = (row.project_name or f"#{row.id} {row.program_name or ''}").strip()
        snippet_source = row.project_name or f"{row.program_name or ''} {row.job_id or ''}".strip()
        items.append({
            "id": row.id,
            "title": title,
            "snippet": make_snippet(snippet_source, q, radius=SNIPPET_RADIUS),
            "menu": "My Projects",
            "params": {"analysis_id": row.id},
        })
    return items


# ---------- 리졸버: notice ----------

def _search_notices(db: Session, q: str, limit: int) -> list[dict]:
    """support._filter_published_notices 와 같은 조건으로 published 공지만 매치."""
    now = datetime.now()
    term = _like_term(q)
    rows = (
        db.query(models.Notice)
        .filter(
            models.Notice.is_private == False,  # noqa: E712
            models.Notice.publish_status == "published",
            or_(models.Notice.starts_at.is_(None), models.Notice.starts_at <= now),
            or_(models.Notice.ends_at.is_(None), models.Notice.ends_at >= now),
            or_(
                models.Notice.title.ilike(term, escape=_LIKE_ESCAPE),
                models.Notice.content.ilike(term, escape=_LIKE_ESCAPE),
            ),
        )
        .order_by(models.Notice.created_at.desc())
        .limit(limit)
        .all()
    )
    items = []
    for row in rows:
        # 스니펫은 매치가 있는 쪽에서 만든다: title 매치가 있으면 title, 없으면 content.
        source = row.title or ""
        if q.lower() not in (source or "").lower():
            source = row.content or source
        items.append({
            "id": row.id,
            "title": (row.title or "(제목 없음)").strip(),
            "snippet": make_snippet(source, q, radius=SNIPPET_RADIUS),
            "menu": "Notice & Updates",
            "params": {"notice_id": row.id},
        })
    return items


# ---------- 리졸버: guide ----------

def _search_guides(db: Session, q: str, limit: int) -> list[dict]:
    term = _like_term(q)
    rows = (
        db.query(models.UserGuide)
        .filter(
            or_(
                models.UserGuide.title.ilike(term, escape=_LIKE_ESCAPE),
                models.UserGuide.content.ilike(term, escape=_LIKE_ESCAPE),
                models.UserGuide.category.ilike(term, escape=_LIKE_ESCAPE),
            )
        )
        .order_by(models.UserGuide.created_at.desc())
        .limit(limit)
        .all()
    )
    items = []
    for row in rows:
        source = row.title or ""
        if q.lower() not in (source or "").lower():
            source = row.content or source
        items.append({
            "id": row.id,
            "title": (row.title or "(제목 없음)").strip(),
            "snippet": make_snippet(source, q, radius=SNIPPET_RADIUS),
            "menu": "User Guide",
            "params": {"guide_id": row.id, "category": row.category or ""},
        })
    return items


# ---------- 리졸버: project (Plan G) ----------

def _search_projects(db: Session, user: str, q: str, limit: int) -> list[dict]:
    project_models = _load_project_models()
    if project_models is None:
        return []
    Project, ProjectMember = project_models

    term = _like_term(q)
    try:
        # 오너 or 멤버.
        member_project_ids = (
            db.query(ProjectMember.project_id)
            .filter(ProjectMember.employee_id == user)
            .subquery()
        )
        rows = (
            db.query(Project)
            .filter(
                or_(Project.owner_id == user, Project.id.in_(member_project_ids)),
                or_(
                    Project.name.ilike(term, escape=_LIKE_ESCAPE),
                    Project.description.ilike(term, escape=_LIKE_ESCAPE),
                ),
            )
            .order_by(Project.created_at.desc())
            .limit(limit)
            .all()
        )
    except Exception:
        logger.debug("project 검색 실패 — Plan G 스키마 미배포일 수 있음", exc_info=True)
        return []

    items = []
    for row in rows:
        source = row.name or ""
        if q.lower() not in source.lower():
            source = getattr(row, "description", None) or source
        items.append({
            "id": row.id,
            "title": (row.name or f"프로젝트 #{row.id}").strip(),
            "snippet": make_snippet(source, q, radius=SNIPPET_RADIUS),
            "menu": "My Projects",
            "params": {"tab": "projects", "project_id": row.id},
        })
    return items


# ---------- 공용 진입점 ----------

def run_search(
    db: Session,
    user: str,
    q: str,
    scope: SearchScope = "all",
    limit: int = DEFAULT_LIMIT,
) -> dict:
    """검색 결과를 `{query, scope, groups:[{scope, items}]}` 로 돌려준다.

    Parameters
    ----------
    db     : SQLAlchemy 세션
    user   : 로그인 사번(권한 판정용)
    q      : 검색어 — strip 후 len >= 2 만 허용, 아니면 ValueError
    scope  : "all"·"analysis"·"notice"·"guide"·"project" 중 하나(그 외 ValueError)
    limit  : 그룹당 상한(1..MAX_LIMIT)
    """
    q_clean = (q or "").strip()
    if len(q_clean) < MIN_QUERY_LEN:
        raise ValueError(f"검색어는 최소 {MIN_QUERY_LEN}자 이상이어야 합니다.")
    if scope not in ALLOWED_SCOPES:
        raise ValueError(f"unknown scope: {scope!r}")
    user_id = (user or "").strip()

    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))

    def _resolve(name: str) -> list[dict]:
        if name == "analysis":
            return _search_analyses(db, user_id, q_clean, limit)
        if name == "notice":
            return _search_notices(db, q_clean, limit)
        if name == "guide":
            return _search_guides(db, q_clean, limit)
        if name == "project":
            return _search_projects(db, user_id, q_clean, limit)
        return []

    if scope == "all":
        groups = [
            {"scope": name, "items": _resolve(name)}
            for name in _ALL_SCOPE_ORDER
        ]
    else:
        groups = [{"scope": scope, "items": _resolve(scope)}]

    return {"query": q_clean, "scope": scope, "groups": groups}
```

- [ ] **Step 4: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_search_service.py -q
```
기대: `17 passed`(위 테스트 17건 전부).

문제가 있으면 SQLite 의 `ILIKE` escape 옵션 지원(`sqlalchemy.ilike(..., escape='\\')`)을 확인.
SQLite 는 기본이 case-insensitive `LIKE` 라 `ilike` 를 그대로 해석한다.

- [ ] **Step 5: 커밋 준비 완료** — 보고: `app/services/search_service.py`, `tests/test_search_service.py`.

---

### Task 4: 라우터 `GET /api/search` + `main.py` 등록

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/routers/search.py`
- Modify: `HiTessWorkBenchBackEnd/app/main.py:20-45`(import), `:188-212`(include)
- Create: `HiTessWorkBenchBackEnd/tests/test_search_router.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_search_router.py`:

```python
"""GET /api/search — 요청 검증·인증·응답 스키마."""
from datetime import datetime

from app import models
from app.dependencies import require_auth
from app.main import app


def _act_as(employee_id: str):
    app.dependency_overrides[require_auth] = lambda: employee_id


def _seed_notice(db, title, content=""):
    row = models.Notice(title=title, content=content, is_private=False,
                        publish_status="published", created_at=datetime.now())
    db.add(row); db.commit(); return row


def test_requires_auth(admin_client):
    saved = app.dependency_overrides.pop(require_auth)
    try:
        assert admin_client.get("/api/search?q=abcd").status_code == 401
    finally:
        app.dependency_overrides[require_auth] = saved


def test_missing_q_is_400_or_422(admin_client):
    r = admin_client.get("/api/search")
    assert r.status_code in (400, 422)


def test_short_q_is_400(admin_client):
    r = admin_client.get("/api/search?q=a")
    assert r.status_code == 400
    assert "2자" in r.json().get("detail", "")


def test_whitespace_only_q_is_400(admin_client):
    r = admin_client.get("/api/search?q=%20%20")
    assert r.status_code == 400


def test_unknown_scope_is_422(admin_client):
    r = admin_client.get("/api/search?q=abcd&scope=weird")
    assert r.status_code == 422


def test_limit_bounds_are_enforced(admin_client):
    assert admin_client.get("/api/search?q=abcd&limit=0").status_code == 422
    assert admin_client.get("/api/search?q=abcd&limit=21").status_code == 422


def test_all_scope_returns_four_groups_in_order(admin_client, db_session):
    _seed_notice(db_session, "테스트 공지 SEARCHKEY")
    data = admin_client.get("/api/search?q=SEARCHKEY&scope=all").json()
    assert data["query"] == "SEARCHKEY"
    assert data["scope"] == "all"
    assert [g["scope"] for g in data["groups"]] == ["analysis", "project", "notice", "guide"]


def test_single_scope_returns_one_group(admin_client, db_session):
    _seed_notice(db_session, "테스트 공지 SEARCHKEY")
    data = admin_client.get("/api/search?q=SEARCHKEY&scope=notice").json()
    assert data["scope"] == "notice"
    assert len(data["groups"]) == 1
    assert data["groups"][0]["scope"] == "notice"
    items = data["groups"][0]["items"]
    assert len(items) == 1
    assert set(items[0]) == {"id", "title", "snippet", "menu", "params"}
    assert items[0]["menu"] == "Notice & Updates"


def test_default_limit_applied(admin_client, db_session):
    for i in range(12):
        _seed_notice(db_session, f"공지 CAPKEY-{i:02d}")
    data = admin_client.get("/api/search?q=CAPKEY&scope=notice").json()
    assert len(data["groups"][0]["items"]) == 8   # DEFAULT_LIMIT

    data = admin_client.get("/api/search?q=CAPKEY&scope=notice&limit=3").json()
    assert len(data["groups"][0]["items"]) == 3


def test_permission_boundary_in_router(admin_client, db_session, make_analysis):
    """다른 사람 해석은 관리자(admin_client 는 is_admin=True)만 보인다."""
    a = make_analysis("EMP001", "Truss Assessment", datetime.now(), status="Success")
    a.project_name = "3496 SEARCHKEY"; db_session.commit()

    # ADMIN001 (관리자) — 보인다
    data = admin_client.get("/api/search?q=SEARCHKEY&scope=analysis").json()
    assert [h["id"] for h in data["groups"][0]["items"]] == [a.id]

    # 사번 전환: 다른 사람 → 안 보인다
    _act_as("EMP999")
    db_session.add(models.User(
        employee_id="EMP999", name="다른 사용자", company="HHI",
        is_active=True, is_admin=False, is_developer=False,
    ))
    db_session.commit()
    data = admin_client.get("/api/search?q=SEARCHKEY&scope=analysis").json()
    assert data["groups"][0]["items"] == []
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_search_router.py -q
```
기대: 전부 404(라우터 미등록).

- [ ] **Step 3: 라우터 구현** — `HiTessWorkBenchBackEnd/app/routers/search.py`:

```python
"""전역 검색 API — Ctrl+K 팔레트 "데이터" 섹션의 단일 창구.

- `GET /api/search?q=&scope=&limit=` (require_auth) — 결과는 서비스가 만든 dict 그대로.
- 검색어 <2자 → 400(사용자에게 한국어 사유를 보여 준다). scope 어휘 밖 → 422(FastAPI 기본).
- `main.py include_router` 목록에 등록. 플랫폼 공통 기능이라 GUARDED_ROUTES 등록은 안 한다(§1.8).
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import database
from ..dependencies import require_auth
from ..services.search_service import (
    ALLOWED_SCOPES,
    DEFAULT_LIMIT,
    MAX_LIMIT,
    run_search,
)

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/search")
def search(
    q: str = Query(..., description="검색어(최소 2자)"),
    scope: str = Query(default="all"),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    if scope not in ALLOWED_SCOPES:
        # 어휘 밖은 pydantic Enum 대신 여기서 422 로 통일한다(에러 메시지가 명시적).
        raise HTTPException(status_code=422, detail=f"scope 값이 잘못됐습니다: {scope!r}")
    try:
        return run_search(db, me, q, scope=scope, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
```

- [ ] **Step 4: `main.py` 등록**

(a) `HiTessWorkBenchBackEnd/app/main.py:20-45` 의 import 목록에서 `reports,` 앞에 `search,` 를 추가(알파벳 순):

```python
    presence,
    reports,
    search,
    section_property,
```

(b) 212행 `application.include_router(reports.router)` 다음 줄에 추가:

```python
    application.include_router(reports.router)
    application.include_router(search.router)
```

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_search_router.py -q
```
기대: `10 passed`.

전체 백엔드 회귀:
```
WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
기대: 실패 0(다른 plan 을 아직 안 돌렸다면 기존 회귀 상태 유지).

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/routers/search.py`, `app/main.py`, `tests/test_search_router.py`. (백엔드 마무리 시점 — Task 1~4 파일을 함께 다시 나열해 사용자가 한 번 커밋할 수 있게 한다.)

---

### Task 5: 프론트 API 모듈 — `api/search.js` + `AbortController`

**Files:**
- Create: `HiTessWorkBench/frontend/src/api/search.js`

이 파일은 CommandPalette 가 `AbortController.signal` 을 넘겨받아 타자 중 이전 요청을 취소할 수 있게 한다.
axios 는 `signal` 옵션을 그대로 지원한다(v1 이상). 반환은 백엔드 응답 dict(`{query, scope, groups}`).

- [ ] **Step 1: 구현**

```js
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/**
 * 전역 검색(Ctrl+K 팔레트 "데이터" 섹션).
 *
 * @param {{q: string, scope?: string, limit?: number, signal?: AbortSignal}} opts
 * @returns {Promise<{query:string, scope:string, groups:{scope:string, items:{id:number,title:string,snippet:string,menu:string,params:object}[]}[]}>}
 *
 * 반환은 axios response 의 `data` 만 풀어서 준다(호출부가 헤더를 볼 필요 없음).
 * signal 이 abort 되면 axios 가 `CanceledError` 를 던진다 — 호출부에서 조용히 무시한다.
 */
export async function runSearch({ q, scope = 'all', limit = 8, signal }) {
  const res = await axios.get(`${API_BASE_URL}/api/search`, {
    params: { q, scope, limit },
    headers: getAuthHeaders(),
    signal,
  });
  return res.data;
}

/**
 * axios v1 에서 요청 취소로 발생한 오류인지 판별. CommandPalette 가 catch 안에서
 * "취소는 조용히 무시, 실제 오류만 로그" 로 분기할 때 쓴다.
 */
export function isSearchCanceled(err) {
  if (!err) return false;
  // axios v1: AxiosError.code === 'ERR_CANCELED'
  if (err.code === 'ERR_CANCELED') return true;
  // DOMException fallback
  if (err.name === 'CanceledError' || err.name === 'AbortError') return true;
  return false;
}
```

- [ ] **Step 2: 빌드 확인** (`C:\Coding\WorkBench\HiTessWorkBench\frontend` 에서)

```
npm run build
```
기대: 오류 없음. (아직 어디서도 import 되지 않아 tree-shake 돼도 정상.)

- [ ] **Step 3: 커밋 준비 완료** — 보고: `src/api/search.js`.

---

### Task 6: 순수 유틸 `utils/searchDebounce.js` + `node --test`

디바운스 로직을 CommandPalette 안에 인라인으로 두면 검증할 수 없다. `debouncePromise(fn, ms)` 를 순수 유틸로 뽑고 `node:test` 로 검증한다.
- **마지막 호출의 인자**로만 실행된다(중간 호출은 무시).
- 각 호출은 Promise 를 돌려주고, 다음 호출로 대체되면 이전 Promise 는 **취소 표시**를 던지지 않고 그대로 pending 으로 둔다(호출부는 `AbortController` 로 별도 취소).
- `.cancel()` 로 예약된 실행을 지운다(언마운트용).

**Files:**
- Create: `HiTessWorkBench/frontend/src/utils/searchDebounce.js`
- Create: `HiTessWorkBench/frontend/src/utils/searchDebounce.test.js`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBench/frontend/src/utils/searchDebounce.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { debouncePromise } from './searchDebounce.js';

/** setTimeout 을 신뢰할 수 있는 짧은 스핀으로 대기. */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test('첫 호출은 wait 뒤에 실행된다', async () => {
  const calls = [];
  const debounced = debouncePromise((x) => { calls.push(x); return x * 2; }, 40);
  const p = debounced(3);
  assert.equal(calls.length, 0);
  const result = await p;
  assert.equal(result, 6);
  assert.deepEqual(calls, [3]);
});

test('연속 호출은 마지막 인자로만 실행된다', async () => {
  const calls = [];
  const debounced = debouncePromise((x) => { calls.push(x); return x; }, 30);
  debounced('a');
  debounced('b');
  const p = debounced('c');
  await p;
  assert.deepEqual(calls, ['c']);
});

test('한 번 실행된 뒤 다시 호출하면 새로 wait 후 실행된다', async () => {
  const calls = [];
  const debounced = debouncePromise((x) => { calls.push(x); return x; }, 20);
  await debounced('first');
  await debounced('second');
  assert.deepEqual(calls, ['first', 'second']);
});

test('cancel() 은 예약된 실행을 지우고 함수는 절대 호출되지 않는다', async () => {
  const calls = [];
  const debounced = debouncePromise((x) => { calls.push(x); return x; }, 30);
  debounced('x');
  debounced.cancel();
  await sleep(80);
  assert.deepEqual(calls, []);
});

test('중간 호출은 이전 Promise 를 남겨 두고 최신 호출만 resolve 한다', async () => {
  const debounced = debouncePromise((x) => x, 20);
  const p1 = debounced('a');
  const p2 = debounced('b');
  // p1 은 대체됐지만 unhandled rejection 을 유발해서는 안 된다.
  const settled = await Promise.race([
    p2.then(v => ({ who: 'p2', v })),
    p1.then(v => ({ who: 'p1', v })),
  ]);
  assert.equal(settled.who, 'p2');
  assert.equal(settled.v, 'b');
});

test('wait=0 도 동작한다(마이크로태스크 스케줄)', async () => {
  const debounced = debouncePromise((x) => x + 1, 0);
  const result = await debounced(41);
  assert.equal(result, 42);
});
```

- [ ] **Step 2: 실패 확인**

```
node --test src/utils/searchDebounce.test.js
```
기대: `Cannot find module … searchDebounce.js` (`fail 1`).

- [ ] **Step 3: 순수 유틸 구현** — `HiTessWorkBench/frontend/src/utils/searchDebounce.js`:

```js
/**
 * 마지막 호출의 인자로만 실행되는 debounce — Promise 반환형.
 * 부수효과 없음(순수 유틸, node --test 로 검증).
 *
 *  const debounced = debouncePromise(fn, 300);
 *  const p = debounced(...args);        // wait 이후 fn(...args) 를 부르고 그 반환을 resolve
 *  debounced(otherArgs);                // 이전 예약을 대체, p 는 pending 그대로 남음
 *  debounced.cancel();                  // 예약된 실행을 지운다(언마운트용)
 *
 * 호출부(CommandPalette)는 별도 AbortController 를 fn 에 내려서 실제 요청을 취소한다.
 * 여기서 취소 오류를 만들지 않는 이유는 useEffect cleanup 이 반복될 때 unhandled rejection
 * 을 유발하지 않도록 하기 위함이다.
 */
export function debouncePromise(fn, wait) {
  let timer = null;
  let pending = null;

  const flush = () => {
    if (!pending) return;
    const { args, resolve, reject } = pending;
    pending = null;
    timer = null;
    try {
      Promise.resolve()
        .then(() => fn(...args))
        .then(resolve, reject);
    } catch (err) {
      reject(err);
    }
  };

  const debounced = (...args) => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    return new Promise((resolve, reject) => {
      pending = { args, resolve, reject };
      timer = setTimeout(flush, wait);
    });
  };

  debounced.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  };

  return debounced;
}
```

- [ ] **Step 4: 통과 확인**

```
node --test src/utils/searchDebounce.test.js
```
기대: `pass 6`, `fail 0`.

- [ ] **Step 5: 커밋 준비 완료** — 보고: `src/utils/searchDebounce.js`, `src/utils/searchDebounce.test.js`.

---

### Task 7: `CommandPalette.jsx` 확장 — "데이터" 섹션

기존 `commands` 배열(recent + system + menu + app)은 `scoreCommand`/`filtered` 로 정렬돼
최대 12건 나온다. "데이터" 섹션은 **별도 렌더 트리**로 아래에 붙는다 — 서버가 이미 매칭·정렬을 마쳤으니
프론트가 다시 정렬하지 않는다(spec §8.3).

동작:
1. `query.trim().length >= 2` 이면 300ms 디바운스 후 `runSearch({q, scope: 'all', limit: 8, signal})`.
2. 응답 `groups` 를 4개 그룹 헤더(`해석 이력`·`프로젝트`·`공지사항`·`사용자 가이드`)로 렌더.
3. 항목 클릭 = `onNavigate(item.menu)` 전에 `sessionStorage` 와 `workbench:open-project-detail` 이벤트로 params 전달.

**Files:**
- Modify: `HiTessWorkBench/frontend/src/components/platform/CommandPalette.jsx`

- [ ] **Step 1: 컴포넌트 확장**

기존 파일 최상단 import 블록·commands·filtered 렌더 사이에 아래 항목을 끼워 넣는다. 정확한 변경 지점:

(a) 3행 import 확장 — lucide 아이콘을 4개 추가하고 axios 유틸을 붙인다:

```jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@headlessui/react';
import {
  Activity,
  ArrowRight,
  BookOpen,
  Clock,
  FolderKanban,
  Loader2,
  Megaphone,
  Search,
  Server,
  Settings,
  Star,
  Users,
  X,
} from 'lucide-react';
import { getAppMenuName, useAppCatalogue } from '../../contexts/DashboardContext';
import { useRecentActivity } from '../../contexts/RecentActivityContext';
import { isAdmin as getIsAdmin } from '../../utils/auth';
import { isSearchCanceled, runSearch } from '../../api/search';
import { debouncePromise } from '../../utils/searchDebounce';
```

(b) 파일 상단(컴포넌트 정의 위) 에 상수를 둔다 — CommandPalette 외부의 세션 규약(Plan A):

```jsx
const OPEN_PROJECT_DETAIL_KEY = 'workbench:open-project-detail';
const OPEN_PROJECT_DETAIL_EVENT = 'workbench:open-project-detail';
const OPEN_PROJECT_TAB_KEY = 'workbench:open-project-tab';

const SEARCH_MIN_LEN = 2;
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT_PER_SCOPE = 8;

const DATA_SCOPE_META = [
  { scope: 'analysis', label: '해석 이력', Icon: FolderKanban },
  { scope: 'project', label: '프로젝트', Icon: Users },
  { scope: 'notice', label: '공지사항', Icon: Megaphone },
  { scope: 'guide', label: '사용자 가이드', Icon: BookOpen },
];
```

(c) `iconMap` 은 그대로 두고 `commands` 배열은 손대지 않는다 — "데이터" 섹션은 별도 상태로 관리한다.

컴포넌트 본문(현재 `useState`/`useMemo` 이후, `execute` 함수 위)에 아래 상태·훅을 추가한다:

```jsx
  const [dataResults, setDataResults] = useState(null); // {query, groups:[]} | null
  const [dataError, setDataError] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);
  const abortRef = useRef(null);

  // debouncePromise 는 컴포넌트 라이프사이클 동안 하나만 유지(재생성 금지).
  const debouncedSearchRef = useRef(null);
  if (debouncedSearchRef.current == null) {
    debouncedSearchRef.current = debouncePromise((q, signal) =>
      runSearch({ q, scope: 'all', limit: SEARCH_LIMIT_PER_SCOPE, signal }),
    SEARCH_DEBOUNCE_MS);
  }

  useEffect(() => {
    // 팔레트가 닫혔거나 질의가 짧으면 결과 비우고 요청도 취소.
    const q = query.trim();
    if (!isOpen || q.length < SEARCH_MIN_LEN) {
      abortRef.current?.abort();
      abortRef.current = null;
      debouncedSearchRef.current.cancel();
      setDataResults(null);
      setDataError(null);
      setDataLoading(false);
      return undefined;
    }

    // 이전 요청 취소 후 새 AbortController.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setDataLoading(true);
    setDataError(null);

    debouncedSearchRef.current(q, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setDataResults(data && typeof data === 'object' ? data : { query: q, groups: [] });
      })
      .catch((err) => {
        if (isSearchCanceled(err) || controller.signal.aborted) return;
        setDataError(err?.response?.data?.detail || '검색 중 오류가 발생했습니다.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setDataLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [isOpen, query]);

  // 언마운트 시 예약 실행 정리.
  useEffect(() => () => {
    debouncedSearchRef.current?.cancel();
    abortRef.current?.abort();
  }, []);
```

(d) `execute` 위에 항목 클릭 헬퍼를 추가한다:

```jsx
  const executeDataItem = useCallback((item) => {
    if (!item || !item.menu) return;
    const params = item.params || {};
    try {
      // 알림 센터(Plan A) 와 완전히 같은 세션 규약 — 이미 MyProjects/Dashboard 가 읽는 키·이벤트다.
      if (item.menu === 'My Projects' && Number.isInteger(params.analysis_id)) {
        sessionStorage.setItem(
          OPEN_PROJECT_DETAIL_KEY,
          JSON.stringify({ analysis_id: params.analysis_id }),
        );
        window.dispatchEvent(new CustomEvent(OPEN_PROJECT_DETAIL_EVENT));
      } else if (item.menu === 'My Projects' && Number.isInteger(params.project_id)) {
        // Plan G 세션 키(프로젝트 탭 자동 활성화).
        sessionStorage.setItem(OPEN_PROJECT_TAB_KEY, JSON.stringify({
          project_id: params.project_id,
          tab: params.tab || 'projects',
        }));
      }
      // Notice/Guide 는 아직 id 오픈 훅이 페이지에 없어(범위 밖) 이동만 한다 — spec §8.1.
    } catch {
      // sessionStorage 접근 실패는 조용히 무시 — 페이지 이동은 계속.
    }
    onNavigate(item.menu);
    onClose();
  }, [onClose, onNavigate]);
```

(e) 렌더 트리 확장 — `<div className="max-h-[58vh] overflow-y-auto p-2">` 안, 기존 `{filtered.length === 0 ? … : filtered.map(…)}` 다음에 데이터 섹션을 붙인다:

```jsx
          <div className="max-h-[58vh] overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm font-medium text-slate-400">일치하는 명령이 없습니다.</div>
            ) : filtered.map((command, index) => {
              const Icon = iconMap[command.type] || Activity;
              const active = index === activeIndex;
              return (
                <button
                  key={command.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => execute(command)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    active ? 'bg-blue-50 text-blue-900' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold">{command.label}</span>
                      <span className="block truncate text-xs text-slate-500">{command.subtitle}</span>
                    </span>
                  </span>
                  <ArrowRight size={15} className={active ? 'text-blue-500' : 'text-slate-300'} />
                </button>
              );
            })}

            <DataSection
              query={query}
              loading={dataLoading}
              error={dataError}
              results={dataResults}
              onOpen={executeDataItem}
            />
          </div>
```

(f) 파일 맨 아래(`export default function CommandPalette` 밖)에 `DataSection` 컴포넌트를 둔다:

```jsx
function DataSection({ query, loading, error, results, onOpen }) {
  const q = query.trim();
  if (q.length < SEARCH_MIN_LEN) return null;

  const groupsByScope = new Map(
    (results?.groups || []).map((g) => [g.scope, g.items || []]),
  );
  const totalCount = Array.from(groupsByScope.values()).reduce((s, arr) => s + arr.length, 0);

  return (
    <section className="mt-2 border-t border-slate-100 pt-2" aria-label="데이터 검색 결과">
      <header className="flex items-center gap-2 px-3 pb-1">
        <Search size={12} className="text-slate-400" />
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">데이터</h3>
        {loading && <Loader2 size={12} className="animate-spin text-slate-400" />}
        <span className="ml-auto text-[10px] font-semibold text-slate-400">
          {loading ? '검색 중…' : totalCount > 0 ? `${totalCount}건` : ''}
        </span>
      </header>

      {error && (
        <p className="px-4 py-3 text-xs font-semibold text-red-600">{error}</p>
      )}
      {!error && !loading && totalCount === 0 && (
        <p className="px-4 py-6 text-center text-xs font-medium text-slate-400">
          "{q}" 에 해당하는 데이터가 없습니다.
        </p>
      )}

      {DATA_SCOPE_META.map(({ scope, label, Icon }) => {
        const items = groupsByScope.get(scope) || [];
        if (items.length === 0) return null;
        return (
          <div key={scope} className="mb-1">
            <p className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              <Icon size={11} />
              {label}
              <span className="text-slate-300">·</span>
              <span className="normal-case tracking-normal text-slate-400">{items.length}건</span>
            </p>
            {items.map((item) => (
              <button
                key={`${scope}:${item.id}`}
                type="button"
                onClick={() => onOpen(item)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-slate-700 transition-colors hover:bg-slate-50"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                  <Icon size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold" title={item.title}>{item.title}</span>
                  <span
                    className="block truncate text-xs text-slate-500"
                    // 서버가 이미 escape 하고 <mark> 만 남긴 안전한 HTML.
                    dangerouslySetInnerHTML={{ __html: item.snippet || '' }}
                  />
                </span>
                <ArrowRight size={14} className="text-slate-300" />
              </button>
            ))}
          </div>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 2: 빌드 확인** (`C:\Coding\WorkBench\HiTessWorkBench\frontend` 에서)

```
npm run build
```
기대: 오류 없음. `lucide-react` 는 이미 install 돼 있고 새 아이콘 4개(BookOpen/FolderKanban/Loader2/Megaphone/Users)는 모두 표준 아이콘.

- [ ] **Step 3: 커밋 준비 완료** — 보고: `src/components/platform/CommandPalette.jsx`.

---

### Task 8: 수동 검증(프론트 러너 없음)

프론트 테스트 러너가 없으므로 UI 통합은 수동으로 절차와 기대 동작을 하나씩 확인한다.
백엔드 `uvicorn app.main:app --host 0.0.0.0 --port 9091 --reload` 를 띄우고, `HiTessWorkBench/` 에서 `npm run dev`.

- [ ] **Step 1: 준비 데이터 세팅**
1. 로그인 상태로 진입. DB 에 아래를 심는다(사번은 실제 로그인 사번, 아래 예시는 `EMP001`):
   - Analysis: 프로젝트명 `3496 유닛 권상 검토`, 프로그램 `Truss Assessment`, 상태 Success. Ctrl+K 로 `3496` 검색 대상.
   - Notice: 제목 `9월 서버 점검 안내`, 본문 `2026-09-25 02:00 ~ 04:00`, `is_private=False`, `publish_status='published'`, 창 안. `점검` 검색 대상.
   - UserGuide: 제목 `Truss 해석 가이드`, 카테고리 `가이드`, 본문 `Truss Assessment 로 BDF 를 업로드…`. `truss` 검색 대상.
   - 두 번째 사용자(`EMP002`)의 Analysis 도 하나 심어 두고 사번을 바꿔가며 접근 격리를 확인한다.

- [ ] **Step 2: 팔레트 진입·짧은 질의**
1. Ctrl+K → 팔레트가 열리고 포커스가 검색 입력창에 있다. 하단에 "데이터" 섹션이 **보이지 않는다**(질의 없음).
2. `1` 한 글자 입력 → DevTools Network 에 `/api/search` 요청이 **가지 않는다**(최소 2자). 데이터 섹션은 숨김.
3. 입력 지우기 → 상태가 초기로 돌아온다.

- [ ] **Step 3: 디바운스·취소**
1. `3496` 을 3자, 4자, 5자 순서로 빠르게 입력 → Network 에 `/api/search?q=…` 요청이 **1건**만 남는다(마지막 인자). 이전 요청은 `canceled` 로 표시된다.
2. 입력 후 300ms 이내에 팔레트를 닫는다 → 요청이 발사되지 않는다(디바운스+cleanup).
3. 요청이 발사된 뒤 팔레트를 닫는다 → Network 의 그 요청이 `canceled`. 콘솔에 오류가 뜨지 않는다.

- [ ] **Step 4: 결과 표시·그룹 순서**
1. `3496` → "데이터" 섹션 헤더 오른쪽에 총 건수(예: `1건`), 그 아래 그룹은 순서대로 **해석 이력 → 프로젝트 → 공지사항 → 사용자 가이드**. 빈 그룹 헤더는 안 보인다.
2. 해석 이력 항목: 제목 `3496 유닛 권상 검토`, 스니펫에 `<mark>3496</mark>` 이 강조돼 보인다(굵은 노란 배경 또는 브라우저 기본).
3. 사용자 가이드 항목의 스니펫에는 매치 부분이 대소문자 상관없이 감싸진다(`truss` → `<mark>Truss</mark>`).
4. `점검` → 공지사항 그룹 하나만 나온다. `<script>` 등의 HTML 이 포함된 공지가 있다면 그대로 escape 되어 텍스트로 보인다.

- [ ] **Step 5: 항목 클릭 → 이동·상세 모달**
1. 해석 이력 항목 클릭 → 팔레트가 닫히고 `My Projects` 로 이동한다. **해당 해석의 상세 모달이 자동으로 열린다**(Dashboard 규약 재사용).
   - 이미 `My Projects` 화면에 있으면 페이지 이동 없이 모달만 열린다(Plan A Task 10 의 이벤트 경로).
   - 다른 사용자의 해석을 관리자가 아닌 사번으로 검색하면 그 항목이 **애초에 나오지 않는다**(권한 필터).
2. 공지사항 항목 클릭 → `Notice & Updates` 페이지로 이동(이번 plan 은 그 페이지의 id 오픈 훅을 만들지 않는다 — 목록으로 이동만).
3. 사용자 가이드 항목 클릭 → `User Guide` 페이지로 이동. 세션 키(`guide_id`, `category`)만 심어 두고 페이지 로직은 손대지 않는다.
4. 프로젝트 그룹은 Plan G 가 배포되기 전까지는 **항상 빈 배열**(그룹 헤더 자체가 안 뜬다).

- [ ] **Step 6: 오류·경계**
1. `q` 를 2자로 유지한 채 백엔드 재시작 등의 이유로 요청이 실패 → 데이터 섹션 자리에 빨간 문구 "검색 중 오류가 발생했습니다.". 다시 타자하면 사라진다.
2. 3자 이상 검색 후 Enter → 첫 결과가 아니라 **일반 명령(filtered)** 의 활성 항목이 실행된다(데이터 섹션에는 방향키 포커스가 없다 — 이번 plan 은 팔레트 키보드 내비게이션에 데이터 항목을 편입하지 않는다).
   - 시각적 힌트: 데이터 항목은 hover 시 `bg-slate-50`, active 는 없다.
3. Esc → 팔레트 닫힘. 재열기 시 이전 결과가 지워져 있어야 한다(입력이 리셋되므로 자동으로 지워진다).

- [ ] **Step 7: 백엔드 로그·응답 실측**
1. `curl -H "Authorization: Bearer <token>" "http://localhost:9091/api/search?q=3496&scope=all&limit=8"` → 200, `{"query":"3496","scope":"all","groups":[…]}` 4개 그룹.
2. `q=%20` → 400, `{"detail":"검색어는 최소 2자 이상이어야 합니다."}`.
3. `q=abcd&scope=weird` → 422.
4. 인증 없이 → 401.

- [ ] **Step 8: 커밋 준비 완료(수동 검증 완료 보고)** — 이 Task 는 코드 변경이 없다. 단지 위 절차를 실측하고 실패 케이스는 사용자에게 보고한다.

---

### Task 9: 최종 점검 + 서버(145) 반영 안내

- [ ] **Step 1: 백엔드 전체 회귀**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd
WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
기대: 실패 0. 신규 파일 4개(`test_search_schema_bootstrap`, `test_search_snippet`, `test_search_service`, `test_search_router`) 합계 **~41건** 통과(3+11+17+10).

- [ ] **Step 2: 프론트 순수 유틸 + 빌드**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend
node --test src/utils/searchDebounce.test.js
npm run build
```
기대: `pass 6`(디바운스), 빌드 성공.

- [ ] **Step 3: 스테이징 점검** — `git status` 에서 `HiTessWorkBench/frontend/src/config.js` 가 변경돼 있으면 **스테이징하지 않는다**(로컬 백엔드 토글). `Darkmode.js/` 미포함 확인.

- [ ] **Step 4: 파일 목록 최종 확인**

이번 plan 이 만든 파일(신규):
- 백엔드
  - `app/utils/search_snippet.py` (+ `app/utils/__init__.py` 신규인 경우)
  - `app/services/search_service.py`
  - `app/routers/search.py`
  - `tests/test_search_schema_bootstrap.py`
  - `tests/test_search_snippet.py`
  - `tests/test_search_service.py`
  - `tests/test_search_router.py`
- 프론트
  - `src/api/search.js`
  - `src/utils/searchDebounce.js`
  - `src/utils/searchDebounce.test.js`

수정(기존):
- 백엔드 — `app/schema_bootstrap.py`, `app/main.py`
- 프론트 — `src/components/platform/CommandPalette.jsx`

- [ ] **Step 5: 사용자 보고(커밋은 사용자가 직접)** — 위 목록을 그대로 전달하고 아래 서버 반영 구분을 붙인다.

**서버(145) 반영:**
- **백엔드 — `git pull` + 백엔드 재시작으로 끝.** 신규 pip 의존성 없음(`requirements.txt` 변경 없음).
  기동 시 `run_schema_bootstrap()` 의 `ensure_search_indexes()` 가 FULLTEXT 인덱스를 시도한다.
  운영 MySQL 의 charset·엔진 조건이 안 맞으면 로그에 `WARNING [SchemaBootstrap] FULLTEXT 인덱스 생성을 건너뜁니다 — …` 한 줄이 남고 서비스는 정상 기동한다(검색 자체는 LIKE 로 동작).
- **프론트 — WorkBench 프론트 재배포 필요**(Electron 포터블 exe 를 `npm run dist` 로 다시 빌드해 배포). Ctrl+K 팔레트에 "데이터" 섹션이 추가되기 때문.
- **InHouse 프로그램 수동 교체 — 없음.**

- [ ] **Step 6: 회귀 안내(선택 의존 정합성)**

이 plan 은 Plan A(알림 센터)·Plan G(프로젝트·공유)와 **선택 의존**이다(마스터 §3).
- Plan A 규약(`workbench:open-project-detail`)은 **재사용만** 한다 — Plan A 없이도 동작하도록 세션 키 write 는 try/except 로 감싸 두었다. Plan A 가 배포되면 검색 결과의 해석 항목이 알림 결과와 같은 경로로 상세 모달을 연다.
- Plan G(`_access_control.can_view`) 는 `services/search_service._load_access_control()` 이 지연 import 하고, 실패 시 소유자/관리자 폴백. Plan G 가 배포되면 그때부터 프로젝트 멤버도 검색 결과에 나온다.
- Plan G 의 `Project`/`ProjectMember` 모델이 있으면 project scope 가 실제 결과를 돌려주고, 없으면 빈 배열. 라우터·프론트는 변화 없이 그대로 동작한다.

---

## 자기 검토

- **spec 커버리지**
  - §3 결정 1(MySQL LIKE 기반 + FULLTEXT 는 시도만) → Task 1 · Task 3(서비스는 LIKE 만 씀)
  - §3 결정 2(최소 2자) → Task 3 `ValueError` · Task 4 라우터 400 · Task 7 프론트 minLen
  - §3 결정 3(300ms 디바운스 + AbortController) → Task 6 · Task 7
  - §3 결정 4(scope 당 상한 8건) → Task 3 `DEFAULT_LIMIT` · Task 4 `MAX_LIMIT`
  - §3 결정 5(scope 어휘) → Task 3 `ALLOWED_SCOPES`
  - §3 결정 6(랭킹 없음, `created_at DESC`) → Task 3 각 리졸버 `order_by(... .desc())`
  - §3 결정 7(스니펫 = 매칭 앞뒤 컨텍스트 + `<mark>`) → Task 2 (radius 는 사용자 지시대로 40 채택, spec §3-7 의 "80자"는 백엔드 순수 유틸의 반경 파라미터로 조정 가능하다는 취지로 해석)
  - §3 결정 9(권한) → Task 3 · Task 4 라우터 통합 테스트
  - §3 결정 10(팔레트 안에서 끝냄, 새 페이지·단축키 없음) → Task 7 만 프론트 수정
  - §3 결정 11(require_auth 필수, GUARDED_ROUTES 미등록) → Task 4
  - §3 결정 12(4 scope 그룹 순서 = analysis · project · notice · guide) → Task 3 `_ALL_SCOPE_ORDER`
  - §3 결정 13(결과 항목 = `{id, title, snippet, menu, params}`) → Task 3 리졸버 · Task 4 라우터 스키마 테스트
  - §4 FULLTEXT 인덱스 시도 → Task 1
  - §5.1 서비스 계약 → Task 3
  - §5.2 순수 유틸 → Task 2
  - §6 발신 훅 없음 → 이 plan 은 알림·이벤트를 만들지 않는다(확인)
  - §7 라우터 → Task 4
  - §8 프론트 팔레트 확장 → Task 7
  - §9 보관 없음 → 검색어 로그·검색 히스토리 생성하지 않음(확인)
  - §10 테스트 전략 → Task 2·3·4 pytest, Task 6 `node --test`, Task 8 수동 절차
  - §11 서버 반영 → Task 9

- **비목표(§12) 준수**
  - 퍼지/오타 교정 없음, 순위 없음, 검색 히스토리 저장 없음, 관리자 통계 없음, 파일 본문 검색 없음, 새 페이지·별도 단축키·URL 라우팅 없음 — 이 plan 어디에도 구현하지 않음.

- **플레이스홀더 없음**: 모든 코드 step 은 실제 코드다. 프론트 UI 통합은 러너가 없어 Task 8 을 수동 절차로 상세히 적었다.

- **타입/이름 일관성**
  - 서비스 반환 `{"query", "scope", "groups": [{"scope", "items": [{"id","title","snippet","menu","params"}]}]}` 는 Task 3 서비스 · Task 4 라우터 테스트 · Task 7 `DataSection.groupsByScope` 세 곳이 같은 키를 쓴다.
  - 세션 키 `workbench:open-project-detail` · 이벤트 이름 `workbench:open-project-detail` 은 Dashboard(`pages/dashboard/Dashboard.jsx:34, 1421`) · MyProjects(`pages/analysis/MyProjects.jsx:677`) · Plan A 의 NotificationCenter · 이 plan 의 CommandPalette 가 동일하게 사용한다(Plan A 가 아직 배포되지 않아도 Dashboard/MyProjects 만으로 상세 모달 자동 오픈이 동작).
  - `menu` 값 `"My Projects"` · `"Notice & Updates"` · `"User Guide"` 는 프론트 `NavigationContext.setCurrentMenu` 어휘와 정확히 일치(사용자 CLAUDE.md 프론트 페이지 표 확인).
  - `_LIKE_ESCAPE = '\\'` 는 `_escape_like()` 와 `ilike(..., escape=_LIKE_ESCAPE)` 두 곳에서 같은 값을 쓴다.
  - `DEFAULT_LIMIT=8`, `MAX_LIMIT=20`, `MIN_QUERY_LEN=2` 는 서비스에서만 정의하고 라우터는 그대로 참조 — 상한을 바꿔도 한 곳에서 관리된다.

- **의존 순서**
  - Task 2(순수 유틸)를 Task 3(서비스)이 import.
  - Task 3(서비스)을 Task 4(라우터)가 import.
  - Task 5(`api/search.js`)와 Task 6(`searchDebounce.js`) 두 순수/얇은 모듈을 Task 7(CommandPalette)이 소비.
  - Task 1(FULLTEXT 시도)은 Task 3 의 판정 경로와 독립 — 순서를 뒤바꿔도 테스트가 통과한다.

- **검증한 실측 지점**
  - `_filter_published_notices(query)` 는 `Query` 를 받아 `is_private == False`, `publish_status == "published"`, `starts_at (None or ≤ now)`, `ends_at (None or ≥ now)` 를 `and` 로 붙여 반환(support.py:91-98). 서비스는 `import` 하지 않고 같은 조건 4줄을 직접 조립한다(§5.1 규약 준수).
  - CommandPalette 삽입 지점: `HiTessWorkBench/frontend/src/components/platform/CommandPalette.jsx` 의 47~103행 `commands` 배열 아래·105~112행 `filtered` 렌더 아래에 `DataSection` 을 추가한다. Layout(`components/layout/Layout.jsx`) 은 187~196행 Ctrl+K 훅과 404~414행 팔레트 렌더 그대로 재사용(prop 추가 없음).
  - `admin_client` 픽스처는 `require_auth` 를 `ADMIN001` 로 override 하며 `is_admin=True` 사용자가 시드된다(`tests/conftest.py:40-62`). Task 3·4 테스트는 이 픽스처를 그대로 쓴다.
  - `make_analysis(employee_id, program_name, created_at, status)` 는 `project_name='test-project'` 로 만든다(`tests/conftest.py:109-122`) — 테스트는 만든 뒤 `.project_name = "..."` 로 덮어써 검색 매치를 유도한다.

- **한 마디로**: 이 plan 은 팔레트 안에 단 하나의 섹션과 백엔드에 단 하나의 GET 엔드포인트를 얹는다. 존재하는 규약(세션 키·이벤트·`can_view`·`_filter_published_notices`)을 **재사용만** 하고 새 UI/URL/스키마 결정은 만들지 않는다.
