# 프로젝트·공유 (Plan G) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WorkBench 의 해석 이력을 **프로젝트(실체)** 로 묶고, 프로젝트 멤버십 하나로만 동료와 공유한다. 서버는 `Project`·`ProjectMember` 두 테이블과 `Analysis.project_id` 를 추가하고, `_access_control.py` 에 `can_view(analysis, user, db)` / `can_edit(analysis, user, db)` 두 함수를 붙여 다른 plan(F 결과 비교, J 전역 검색) 이 부를 단일 계약을 제공한다. 프론트는 `MyProjects` 안에 **"내 해석 | 프로젝트별"** 탭 두 개를 두고, 상세 모달의 "프로젝트에 넣기" 로 해석을 프로젝트에 배정한다. 새 페이지는 만들지 않는다.

**Architecture:** 백엔드 — `models.Project`·`models.ProjectMember` + `Analysis.project_id` + `schema_bootstrap.ensure_analysis_project_columns` + `services/project_service.py`(CRUD + 멤버) + `routers/projects.py`(9 엔드포인트) + `routers/users.py` 에 `GET /users/search` + `_access_control.py` 확장(`project_role`, `can_view`, `can_edit`, `assert_can_view`, `assert_can_edit`, `find_analysis_for_path`, `allow_shared` 키워드) + 기존 8개 파일의 호출부를 `assert_can_view` / `allow_shared=True` 로 전환 + 멤버 추가 시 `notify(kind="share.received")` 지연 import. 프론트 — `api/projects.js`·`api/userSearch.js` 두 모듈 + `pages/Project/ProjectsTab.jsx`(프로젝트 카드 목록 + 프로젝트별 해석 표) + `components/analysis/ProjectFormModal.jsx`·`ProjectMembersModal.jsx`·`AssignProjectModal.jsx` + `MyProjects.jsx` 상단 `FilterTabs`("내 해석 | 프로젝트별") + 상세 모달 footer "프로젝트에 넣기" 버튼 + `sessionStorage('workbench:open-project-tab')` 오픈 훅.

**Tech Stack:** Python 3.14 / FastAPI / SQLAlchemy(MySQL 운영, SQLite 테스트) / pytest — React 18 + Vite + Tailwind + lucide-react 0.284 + axios. 신규 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-18-projects-and-sharing-design.md` (마스터: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1·§2.7)

**규칙(마스터 §1):** 커밋은 사용자가 직접 한다 — 각 Task 마지막 단계는 **"커밋 준비 완료 — 변경 파일 목록을 사용자에게 보고"** 다. `HiTessWorkBench/frontend/src/config.js` 는 절대 스테이징하지 않는다. `Darkmode.js/` 는 건드리지 않는다. 백엔드는 TDD(실패 테스트 → 최소 구현 → 통과). 프론트는 러너가 없으므로 수동 검증 절차를 따른다. 문서·주석·UI 문구는 한국어, 식별자는 영어. 새 라우터는 `app/main.py` 의 `include_router` 목록에 등록하되 **`GUARDED_ROUTES` 에는 등록하지 않는다** — 프로젝트/사용자 검색은 앱별 게이트 대상이 아니라 플랫폼 공통 기능이다.

**테스트 실행 위치:** 모든 pytest 명령은 `C:\Coding\WorkBench\HiTessWorkBenchBackEnd` 에서 `WorkBenchEnv/Scripts/python.exe -m pytest …` 로 실행한다. 프론트는 러너 없음 — `npm run build` + 수동 검증.

**의존:** 상위 규약 §3 실행 순서 6번(**Plan A 선택 의존**). 알림 서비스는 `try: from … import notify except ImportError: notify = None` 로 지연 import 한다(§2.1) — Plan A 이전에도 단독으로 동작해야 한다.

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `HiTessWorkBenchBackEnd/app/models.py` | 수정 | `Project`, `ProjectMember` 모델 추가 + `Analysis.project_id` 컬럼 |
| `HiTessWorkBenchBackEnd/app/schema_bootstrap.py` | 수정 | `ensure_analysis_project_columns()` + `run_schema_bootstrap()` 호출 |
| `HiTessWorkBenchBackEnd/app/routers/_access_control.py` | 수정 | `project_role`·`can_view`·`can_edit`·`assert_can_view`·`assert_can_edit`·`find_analysis_for_path` 추가 + `assert_current_user_can_access_path` 에 `allow_shared` 키워드 |
| `HiTessWorkBenchBackEnd/app/services/project_service.py` | 생성 | 프로젝트 CRUD·멤버 upsert·역할 판정·해석 배정 서비스 |
| `HiTessWorkBenchBackEnd/app/routers/projects.py` | 생성 | `/api/projects` CRUD + 멤버 관리 + `/api/projects/{id}/analyses` + `PUT /api/analysis/{id}/project` + `share.received` 지연 알림 |
| `HiTessWorkBenchBackEnd/app/routers/users.py` | 수정 | `GET /api/users/search` 신규(`require_auth`, 필드 화이트리스트) |
| `HiTessWorkBenchBackEnd/app/routers/analysis.py` | 수정 | `/analysis/{id}`·passport `assert_can_view` 로 교체, `/download`·`/export-xlsx` `allow_shared=True` |
| `HiTessWorkBenchBackEnd/app/routers/reports.py` | 수정 | `/reports/generate` `assert_can_view` 로 교체 |
| `HiTessWorkBenchBackEnd/app/main.py` | 수정 | `include_router(projects.router)` |
| `HiTessWorkBenchBackEnd/tests/test_projects_schema.py` | 생성 | 테이블 생성·부트스트랩 멱등·`Analysis.project_id` 확인 |
| `HiTessWorkBenchBackEnd/tests/test_access_control_projects.py` | 생성 | `project_role`·`can_view/edit` 매트릭스·`find_analysis_for_path`·`allow_shared` |
| `HiTessWorkBenchBackEnd/tests/test_project_service.py` | 생성 | CRUD·멤버 upsert·해석 배정 서비스 계약 |
| `HiTessWorkBenchBackEnd/tests/test_projects_router.py` | 생성 | 라우터 CRUD·권한·삭제 시 해석 분리·멤버·`PUT /analysis/{id}/project`·`share.received` 알림 |
| `HiTessWorkBenchBackEnd/tests/test_users_search.py` | 생성 | `GET /users/search` 최소 2자·본인 제외·비활성 제외·필드 화이트리스트 |
| `HiTessWorkBenchBackEnd/tests/test_analysis_shared_access.py` | 생성 | viewer 가 `GET /analysis/{id}`·passport·`/download`·`/export-xlsx`·`/reports/generate` 로 통과·rerun 은 403 |
| `HiTessWorkBench/frontend/src/api/projects.js` | 생성 | axios 함수 9종 + `PUT /analysis/{id}/project` |
| `HiTessWorkBench/frontend/src/api/userSearch.js` | 생성 | `GET /users/search` |
| `HiTessWorkBench/frontend/src/pages/Project/ProjectsTab.jsx` | 생성 | 프로젝트 카드 가로 스크롤 + 프로젝트별 해석 표 + 모달 3개 오케스트레이션 |
| `HiTessWorkBench/frontend/src/components/analysis/ProjectFormModal.jsx` | 생성 | 프로젝트 생성/수정 폼 |
| `HiTessWorkBench/frontend/src/components/analysis/ProjectMembersModal.jsx` | 생성 | 멤버 표 + 사용자 검색 + 역할 select |
| `HiTessWorkBench/frontend/src/components/analysis/AssignProjectModal.jsx` | 생성 | 해석을 프로젝트에 넣기/빼기 라디오 목록 |
| `HiTessWorkBench/frontend/src/pages/analysis/MyProjects.jsx` | 수정 | 상단 탭 도입, 프로젝트별 탭 렌더, 행 액션에 "프로젝트에 넣기", Project Name 아래 프로젝트 태그, 상세 모달 footer 버튼 |

---

### Task 1: 모델 2종 + `Analysis.project_id` + 스키마 부트스트랩

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/models.py` (`Analysis` 클래스 끝에 `project_id` 컬럼; 파일 끝에 `Project`·`ProjectMember` 두 클래스)
- Modify: `HiTessWorkBenchBackEnd/app/schema_bootstrap.py` (`ensure_analysis_project_columns()` + `run_schema_bootstrap()` 호출)
- Create: `HiTessWorkBenchBackEnd/tests/test_projects_schema.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_projects_schema.py`:

```python
"""프로젝트·공유 스키마 회귀 — projects/project_members 테이블, Analysis.project_id, bootstrap 멱등."""
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app import models
from app.schema_bootstrap import ensure_analysis_project_columns, run_schema_bootstrap


def _sqlite_engine():
    return create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def test_create_all_makes_both_project_tables():
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    tables = set(inspect(engine).get_table_names())
    assert "projects" in tables
    assert "project_members" in tables

    cols = {c["name"] for c in inspect(engine).get_columns("projects")}
    assert cols == {"id", "name", "owner_id", "department", "description", "created_at", "updated_at"}

    member_cols = {c["name"] for c in inspect(engine).get_columns("project_members")}
    assert member_cols == {"project_id", "employee_id", "role", "added_by", "added_at"}

    pks = inspect(engine).get_pk_constraint("project_members")["constrained_columns"]
    assert set(pks) == {"project_id", "employee_id"}


def test_analysis_has_project_id_column():
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("analysis")}
    assert "project_id" in cols
    # 자유 라벨은 유지된다(비목표: 마이그레이션하지 않는다).
    assert "project_name" in cols


def test_project_model_defaults(db_session):
    p = models.Project(name="3496 유닛 권상", owner_id="A476854")
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    assert p.id is not None
    assert p.created_at is not None
    assert p.department is None
    assert p.description is None
    assert p.updated_at is None


def test_project_member_defaults(db_session):
    p = models.Project(name="x", owner_id="A476854")
    db_session.add(p)
    db_session.commit()
    m = models.ProjectMember(project_id=p.id, employee_id="B123", added_by="A476854")
    db_session.add(m)
    db_session.commit()
    db_session.refresh(m)
    assert m.role == "viewer"
    assert m.added_at is not None


def test_bootstrap_adds_missing_analysis_project_column():
    """운영 DB 에 컬럼이 빠진 채 테이블만 있어도 bootstrap 이 채운다(멱등)."""
    engine = _sqlite_engine()
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE analysis ("
            " id INTEGER PRIMARY KEY, employee_id VARCHAR(50),"
            " project_name VARCHAR(200), program_name VARCHAR(100),"
            " status VARCHAR(50), created_at DATETIME)"
        ))

    ensure_analysis_project_columns(engine=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("analysis")}
    assert "project_id" in cols

    indexes = {idx["name"] for idx in inspect(engine).get_indexes("analysis")}
    assert "ix_analysis_project_id" in indexes

    # 두 번 돌려도 예외 없이 같은 결과
    ensure_analysis_project_columns(engine=engine)
    assert {c["name"] for c in inspect(engine).get_columns("analysis")} == cols


def test_run_schema_bootstrap_calls_analysis_project_bootstrap(monkeypatch):
    called = []
    import app.schema_bootstrap as sb
    monkeypatch.setattr(sb, "ensure_analysis_project_columns",
                        lambda *, engine=None: called.append("p"))
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    run_schema_bootstrap(engine=engine)
    assert called == ["p"]


def test_analysis_project_id_can_be_written_and_queried(db_session, make_analysis):
    from datetime import datetime
    p = models.Project(name="공유", owner_id="A476854")
    db_session.add(p)
    db_session.commit()

    a = make_analysis("A476854", "Truss Assessment", datetime(2026, 9, 18, 9, 0, 0))
    a.project_id = p.id
    db_session.commit()

    q = db_session.query(models.Analysis).filter(models.Analysis.project_id == p.id).all()
    assert [row.id for row in q] == [a.id]
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_projects_schema.py -q
```
기대: `ImportError: cannot import name 'ensure_analysis_project_columns'` 로 수집 실패(`1 error`).

- [ ] **Step 3: `Analysis.project_id` 추가** — `app/models.py:78-94 Analysis` 클래스 본문 마지막 `updated_at` 다음 줄에(모든 클래스가 2칸 들여쓰기):

```python
  updated_at = Column(DateTime(timezone=True), nullable=True)
  # 프로젝트 배정(공유 근거). project_name 은 자유 라벨로 그대로 두고, 실체 참조는 여기다.
  # non-FK: 프로젝트가 지워져도 해석은 남는다(project_service.delete_project 가 NULL 로 분리).
  project_id = Column(Integer, nullable=True, index=True)
```

`Analysis` 클래스는 여기서 끝나야 한다 — 아래 `AppSpace` 클래스 사이에 다른 문장이 끼면 안 된다.

- [ ] **Step 4: `Project`·`ProjectMember` 모델 추가** — `app/models.py` **파일 끝**(현재 342행 `RegisteredModelArtifact.created_at` 뒤)에 추가. 다른 클래스와 동일한 **2칸 들여쓰기**를 지킨다.

```python


class Project(Base):
  """해석 공유의 실체. 자유 라벨(Analysis.project_name)이 아니라 이 행이 곧 공유 단위다.

  - owner_id       : 사번(대소문자 무시 비교, 저장 원문 유지)
  - department     : 생성 시점 User.department 스냅샷(표시용, 이후 사용자 부서 변경과 무관)
  - description    : 자유 텍스트 설명(공백 허용, 200자 이내 이름과 달리 상한 없음)

  소유자는 project_members 에 넣지 않는다 — 역할 판정 함수가 owner_id 를 먼저 본다.
  프로젝트 삭제 시 해석은 project_id=NULL 로 분리(delete_project). 멤버 행은 함께 삭제.
  """

  __tablename__ = "projects"
  id = Column(Integer, primary_key=True, index=True)
  name = Column(String(200), nullable=False)
  owner_id = Column(String(50), nullable=False, index=True)
  department = Column(String(100), nullable=True)
  description = Column(Text, nullable=True)
  created_at = Column(DateTime(timezone=True), server_default=func.now())
  updated_at = Column(
      DateTime(timezone=True),
      default=None,
      onupdate=datetime.now,
      nullable=True,
  )


class ProjectMember(Base):
  """프로젝트 멤버십. (project_id, employee_id) 로 유일.

  role 은 'viewer'(조회) | 'editor'(조회 + '프로젝트에 넣기/빼기' 같은 메타 수정).
  editor 도 해석 재실행/삭제 권한은 없다 — 그 두 동작은 해석 소유자 or 관리자 전용
  (기존 assert_current_user_can_access_owner 그대로 사용).

  ForeignKey 를 걸지 않는다 — 삭제는 project_service.delete_project 가 명시적으로 정리한다.
  """

  __tablename__ = "project_members"
  project_id = Column(Integer, primary_key=True, index=True)
  employee_id = Column(String(50), primary_key=True)
  role = Column(String(20), nullable=False, default="viewer")
  added_by = Column(String(50), nullable=True)
  added_at = Column(DateTime(timezone=True), server_default=func.now())
```

- [ ] **Step 5: `ensure_analysis_project_columns()` 추가** — `app/schema_bootstrap.py` 의 `ensure_chat_message_columns`(116~121행) 바로 아래에:

```python


def ensure_analysis_project_columns(*, engine=None) -> None:
    """Plan G — 해석 프로젝트 배정용 컬럼·인덱스를 멱등하게 보강합니다.

    projects/project_members 테이블 자체는 create_all 로 생기지만, 기존 analysis 테이블에
    project_id 를 추가하는 것은 여기서만 한다(마스터 규약 §1-3). 신규 컬럼이 없으면
    소유자/멤버 판정이 즉시 500 이라 서버(145) 반영 시 반드시 필요하다.
    """
    _add_missing_columns("analysis", {
        "project_id": "ALTER TABLE analysis ADD COLUMN project_id INT NULL",
    }, engine=engine)
    _add_missing_indexes("analysis", {
        "ix_analysis_project_id": (
            "CREATE INDEX ix_analysis_project_id ON analysis (project_id)"
        ),
    }, engine=engine)
```

그리고 `run_schema_bootstrap()`(현재 152~160행)의 `ensure_chat_message_columns(engine=engine)` 다음 줄에 호출을 추가:

```python
    ensure_chat_message_columns(engine=engine)
    ensure_analysis_project_columns(engine=engine)
    ensure_app_spaces(engine=engine)
```

- [ ] **Step 6: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_projects_schema.py -q
```
기대: `7 passed`.

전체 회귀(모델·bootstrap 변경이라 한 번 돈다):
```
WorkBenchEnv/Scripts/python.exe -m pytest tests -q -x
```
기대: 실패 0.

- [ ] **Step 7: 커밋 준비 완료** — 보고: `app/models.py`, `app/schema_bootstrap.py`, `tests/test_projects_schema.py`.

---

### Task 2: `_access_control.py` 확장 — `project_role`·`can_view`·`can_edit`·`assert_can_*` + `allow_shared`

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/routers/_access_control.py`
- Create: `HiTessWorkBenchBackEnd/tests/test_access_control_projects.py`

이 Task 는 **다른 plan(F·J)이 호출할 계약**을 확정한다. 기존 함수(`assert_current_user_can_access_owner/path/job`, `owner_from_userconnection_path`, `is_admin_user`)는 그대로 두고 확장만 한다.

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_access_control_projects.py`:

```python
"""_access_control 확장 계약 — project_role/can_view/can_edit/find_analysis_for_path/allow_shared.

기존 assert_current_user_can_access_owner/path/job 는 변경하지 않는다(하위호환). 이 파일이
새 계약을 고정하고, tests/test_analysis_access_control.py 의 기존 8건은 변경 없이 통과해야 한다.
"""
import os
from datetime import datetime

import pytest
from fastapi import HTTPException

from app import models
from app.routers._access_control import (
    PROJECT_ROLES,
    PROJECT_ROLE_EDITOR,
    PROJECT_ROLE_VIEWER,
    assert_can_edit,
    assert_can_view,
    assert_current_user_can_access_path,
    can_edit,
    can_edit_analysis,
    can_view,
    can_view_analysis,
    find_analysis_for_path,
    project_role,
)


def _seed_project(db, owner_id="A476854", name="공유", members=None):
    p = models.Project(name=name, owner_id=owner_id)
    db.add(p)
    db.commit()
    for eid, role in (members or []):
        db.add(models.ProjectMember(project_id=p.id, employee_id=eid, role=role, added_by=owner_id))
    if members:
        db.commit()
    return p


def _seed_analysis(db, make_analysis, owner_id="A476854", project_id=None, program="Truss Assessment"):
    a = make_analysis(owner_id, program, datetime(2026, 9, 18, 9, 0, 0), status="Success")
    a.project_id = project_id
    db.commit()
    return a


def test_project_role_vocabulary_is_frozen():
    assert PROJECT_ROLE_VIEWER == "viewer"
    assert PROJECT_ROLE_EDITOR == "editor"
    assert set(PROJECT_ROLES) == {"viewer", "editor"}


def test_project_role_returns_owner_first(db_session, make_user):
    make_user("A476854")
    p = _seed_project(db_session)
    assert project_role(db_session, p.id, "A476854") == "owner"


def test_project_role_case_insensitive(db_session):
    p = _seed_project(db_session, owner_id="A476854",
                      members=[("EMP001", "viewer"), ("EMP002", "editor")])
    assert project_role(db_session, p.id, "a476854") == "owner"
    assert project_role(db_session, p.id, "emp001") == "viewer"
    assert project_role(db_session, p.id, "emp002") == "editor"
    assert project_role(db_session, p.id, "NOBODY") is None


def test_project_role_missing_project_is_none(db_session):
    assert project_role(db_session, 999, "A476854") is None
    assert project_role(db_session, None, "A476854") is None


def test_project_role_accepts_user_object(db_session, make_user):
    user = make_user("EMP001")
    p = _seed_project(db_session, members=[("EMP001", "editor")])
    assert project_role(db_session, p.id, user) == "editor"


def test_can_view_matrix(db_session, make_analysis, make_user):
    admin = make_user("ADMIN001", is_admin=True)
    make_user("A476854")
    make_user("EMP001")
    make_user("EMP002")
    make_user("STRANGER")
    p = _seed_project(db_session, owner_id="A476854",
                      members=[("EMP001", "viewer"), ("EMP002", "editor")])
    a_shared = _seed_analysis(db_session, make_analysis, owner_id="A476854", project_id=p.id)
    a_solo = _seed_analysis(db_session, make_analysis, owner_id="A476854")

    assert can_view(a_shared, "A476854", db_session) is True
    assert can_view(a_shared, "ADMIN001", db_session) is True
    assert can_view(a_shared, "EMP001", db_session) is True
    assert can_view(a_shared, "EMP002", db_session) is True
    assert can_view(a_shared, "STRANGER", db_session) is False
    # user 객체 형태
    assert can_view(a_shared, admin, db_session) is True

    # 프로젝트가 없는 해석은 소유자/관리자만
    assert can_view(a_solo, "EMP001", db_session) is False
    assert can_view(a_solo, "A476854", db_session) is True


def test_can_edit_matrix(db_session, make_analysis, make_user):
    make_user("ADMIN001", is_admin=True)
    make_user("A476854")
    make_user("EMP001")
    make_user("EMP002")
    p = _seed_project(db_session, owner_id="A476854",
                      members=[("EMP001", "viewer"), ("EMP002", "editor")])
    a = _seed_analysis(db_session, make_analysis, owner_id="A476854", project_id=p.id)

    assert can_edit(a, "A476854", db_session) is True
    assert can_edit(a, "ADMIN001", db_session) is True
    assert can_edit(a, "EMP002", db_session) is True     # editor
    assert can_edit(a, "EMP001", db_session) is False    # viewer 는 못 옮긴다
    assert can_edit(a, "STRANGER", db_session) is False


def test_assert_can_view_raises_403(db_session, make_analysis, make_user):
    make_user("STRANGER")
    a = _seed_analysis(db_session, make_analysis, owner_id="A476854")
    with pytest.raises(HTTPException) as exc:
        assert_can_view(a, "STRANGER", db_session)
    assert exc.value.status_code == 403
    assert "해석" in exc.value.detail


def test_assert_can_edit_raises_403(db_session, make_analysis, make_user):
    make_user("EMP001")
    p = _seed_project(db_session, members=[("EMP001", "viewer")])
    a = _seed_analysis(db_session, make_analysis, project_id=p.id)
    # viewer 는 조회는 되지만 편집(프로젝트 옮기기)은 안 된다.
    assert_can_view(a, "EMP001", db_session)
    with pytest.raises(HTTPException) as exc:
        assert_can_edit(a, "EMP001", db_session)
    assert exc.value.status_code == 403


def test_backward_compatible_aliases_exist():
    assert can_view_analysis is can_view
    assert can_edit_analysis is can_edit


def test_find_analysis_for_path_matches_shared_record(db_session, make_analysis):
    a = make_analysis("A476854", "Truss Assessment", datetime(2026, 9, 18, 9, 0, 0))
    p = _seed_project(db_session, owner_id="A476854", members=[("EMP001", "viewer")])
    a.project_id = p.id
    a.input_info = {"csv": r"C:\WB\userConnection\20260918_090000_A476854_Truss\input.csv"}
    a.result_info = {"bdf": r"C:\WB\userConnection\20260918_090000_A476854_Truss\out.bdf"}
    db_session.commit()

    base = r"C:\WB\userConnection"
    hit = find_analysis_for_path(
        db_session,
        r"C:\WB\userConnection\20260918_090000_A476854_Truss\out.bdf",
        base,
    )
    assert hit is not None and hit.id == a.id

    # 다른 폴더는 매치 안 됨
    miss = find_analysis_for_path(
        db_session,
        r"C:\WB\userConnection\20260101_000000_A476854_Other\x.bdf",
        base,
    )
    assert miss is None


def test_find_analysis_for_path_ignores_solo_analyses(db_session, make_analysis):
    """project_id 가 없는 해석은 공유 후보가 아니라 아예 반환하지 않는다."""
    a = make_analysis("A476854", "Truss Assessment", datetime(2026, 9, 18, 9, 0, 0))
    a.result_info = {"bdf": r"C:\WB\userConnection\20260918_090000_A476854_Truss\out.bdf"}
    db_session.commit()
    hit = find_analysis_for_path(
        db_session,
        r"C:\WB\userConnection\20260918_090000_A476854_Truss\out.bdf",
        r"C:\WB\userConnection",
    )
    assert hit is None


def test_allow_shared_lets_viewer_download(db_session, make_analysis, make_user):
    make_user("EMP001")
    a = make_analysis("A476854", "Truss Assessment", datetime(2026, 9, 18, 9, 0, 0))
    p = _seed_project(db_session, members=[("EMP001", "viewer")])
    a.project_id = p.id
    a.result_info = {"bdf": r"C:\WB\userConnection\20260918_090000_A476854_Truss\out.bdf"}
    db_session.commit()

    # allow_shared=False (기본) — viewer 는 여전히 403
    with pytest.raises(HTTPException):
        assert_current_user_can_access_path(
            r"C:\WB\userConnection\20260918_090000_A476854_Truss\out.bdf",
            "EMP001", db_session, r"C:\WB\userConnection",
        )

    # allow_shared=True — 프로젝트 멤버(viewer)라 통과
    assert_current_user_can_access_path(
        r"C:\WB\userConnection\20260918_090000_A476854_Truss\out.bdf",
        "EMP001", db_session, r"C:\WB\userConnection",
        allow_shared=True,
    )


def test_allow_shared_still_rejects_non_member(db_session, make_analysis, make_user):
    make_user("STRANGER")
    a = make_analysis("A476854", "Truss Assessment", datetime(2026, 9, 18, 9, 0, 0))
    p = _seed_project(db_session)  # 멤버 없음
    a.project_id = p.id
    a.result_info = {"bdf": r"C:\WB\userConnection\20260918_090000_A476854_Truss\out.bdf"}
    db_session.commit()

    with pytest.raises(HTTPException):
        assert_current_user_can_access_path(
            r"C:\WB\userConnection\20260918_090000_A476854_Truss\out.bdf",
            "STRANGER", db_session, r"C:\WB\userConnection",
            allow_shared=True,
        )
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_access_control_projects.py -q
```
기대: `ImportError: cannot import name 'project_role'` 로 수집 실패(`1 error`).

- [ ] **Step 3: 확장 구현** — `app/routers/_access_control.py` 를 아래로 교체(기존 함수는 시그니처·동작 그대로 두고 새 함수만 추가):

```python
"""분석 작업 파일/상태 접근 제어 helper.

사내 사번 기반 인증 수준을 유지하면서, userConnection 작업 폴더는
본인 또는 관리자만 접근하도록 제한한다.

Plan G(프로젝트·공유) 확장 — 소유자/관리자 규칙 위에 프로젝트 멤버십 한 층을 더한다.
공용 함수 계약:

    can_view(analysis, user, db)  -> bool   # 조회
    can_edit(analysis, user, db)  -> bool   # 프로젝트에 넣기/빼기 같은 메타 수정
    assert_can_view(analysis, user, db)     # 위 규칙 위반 시 HTTPException(403)
    assert_can_edit(...)
    project_role(db, project_id, user) -> 'owner'|'editor'|'viewer'|None

`user` 는 사번 문자열이 기본이고 models.User 객체도 받는다(다른 plan 이 이미 User 를
들고 있으면 재조회를 피한다). 기존 함수(assert_current_user_can_access_owner/path/job)
는 시그니처·동작 그대로 남는다 — 재실행·삭제는 계속 소유자/관리자 전용이라 그 창구가
'현역' 이다.
"""
import json
import os
import re
from typing import Union

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models

WORK_FOLDER_RE = re.compile(r"^\d{8}_\d{6}_(?P<employee_id>[^_]+)_.+$")

PROJECT_ROLE_VIEWER = "viewer"
PROJECT_ROLE_EDITOR = "editor"
PROJECT_ROLES = (PROJECT_ROLE_VIEWER, PROJECT_ROLE_EDITOR)

UserRef = Union[str, "models.User", None]


def _norm_eid(value) -> str:
    return (value or "").strip().casefold()


def _user_eid(user: UserRef) -> str:
    """user 인자를 사번 문자열로 정규화한다. None/빈값이면 '' 반환."""
    if user is None:
        return ""
    if isinstance(user, models.User):
        return _norm_eid(user.employee_id)
    return _norm_eid(user)


def owner_from_userconnection_path(path: str, user_connection_base: str) -> str | None:
    """userConnection/{timestamp}_{employee_id}_{Program}/... 경로에서 소유자 사번을 추출합니다."""
    try:
        rel = os.path.relpath(os.path.abspath(path), os.path.abspath(user_connection_base))
    except ValueError:
        return None
    if rel.startswith(".."):
        return None
    first_segment = rel.split(os.sep, 1)[0]
    match = WORK_FOLDER_RE.match(first_segment)
    return match.group("employee_id") if match else None


def _work_folder_from_path(path: str, user_connection_base: str) -> str | None:
    """경로에서 작업 폴더명(첫 세그먼트) 만 뽑는다. 소유자 매칭 후 LIKE 대상이 된다."""
    try:
        rel = os.path.relpath(os.path.abspath(path), os.path.abspath(user_connection_base))
    except ValueError:
        return None
    if rel.startswith(".."):
        return None
    first_segment = rel.split(os.sep, 1)[0]
    return first_segment if WORK_FOLDER_RE.match(first_segment) else None


def is_admin_user(db: Session, employee_id: str) -> bool:
    user = db.query(models.User).filter(models.User.employee_id == employee_id).first()
    return bool(user and user.is_admin)


def assert_current_user_can_access_owner(
    owner_id: str | None,
    current_user: str,
    db: Session,
    *,
    allow_unowned: bool = False,
) -> None:
    """소유자 또는 관리자만 허용하며, 소유자 미식별 상태는 기본 거부합니다.

    ``allow_unowned=True``는 관리자가 배포한 catalogue/sample 같은 명시적 공유
    자산에만 사용하는 예외입니다. 사용자가 전달한 userConnection 경로에는 이
    예외를 사용하지 않아, 비표준/손상된 폴더명이 권한 우회가 되지 않게 합니다.
    관리자는 레거시 작업 복구를 위해 소유자 미식별 경로에도 접근할 수 있습니다.
    """
    if (
        owner_id
        and owner_id.strip().casefold() == (current_user or "").strip().casefold()
    ):
        return
    if is_admin_user(db, current_user):
        return
    if not owner_id and allow_unowned:
        return
    raise HTTPException(status_code=403, detail="접근 권한이 없는 작업입니다.")


def project_role(
    db: Session,
    project_id: int | None,
    user: UserRef,
) -> str | None:
    """프로젝트에서 user 가 갖는 역할.

    반환: 'owner' | 'editor' | 'viewer' | None. 소유자는 project_members 에 넣지 않기 때문에
    owner_id 를 먼저 본다. 사번 비교는 casefold — DB 에 대소문자 혼재.
    """
    uid = _user_eid(user)
    if not uid or not project_id:
        return None
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if project is None:
        return None
    if _norm_eid(project.owner_id) == uid:
        return "owner"
    member = (
        db.query(models.ProjectMember)
        .filter(models.ProjectMember.project_id == project_id)
        .all()
    )
    for m in member:
        if _norm_eid(m.employee_id) == uid and m.role in PROJECT_ROLES:
            return m.role
    return None


def can_view(analysis: "models.Analysis", user: UserRef, db: Session) -> bool:
    """소유자 or 관리자 or 프로젝트 멤버(owner/editor/viewer) 라면 True."""
    uid = _user_eid(user)
    if not uid:
        return False
    if _norm_eid(getattr(analysis, "employee_id", None)) == uid:
        return True
    if is_admin_user(db, uid):
        return True
    role = project_role(db, getattr(analysis, "project_id", None), uid)
    return role in ("owner", "editor", "viewer")


def can_edit(analysis: "models.Analysis", user: UserRef, db: Session) -> bool:
    """'프로젝트에서 빼기/옮기기' 같은 메타 수정 권한.

    해석 재실행·삭제는 이 함수를 쓰지 않는다(그건 기존 assert_current_user_can_access_owner
    로 소유자/관리자만). editor 는 프로젝트 소속 배정만 바꿀 수 있다.
    """
    uid = _user_eid(user)
    if not uid:
        return False
    if _norm_eid(getattr(analysis, "employee_id", None)) == uid:
        return True
    if is_admin_user(db, uid):
        return True
    role = project_role(db, getattr(analysis, "project_id", None), uid)
    return role in ("owner", "editor")


# 별칭 — 다른 plan(F 결과 비교, J 전역 검색) 이 어떤 이름으로 부르더라도 동작하도록.
can_view_analysis = can_view
can_edit_analysis = can_edit


def assert_can_view(analysis: "models.Analysis", user: UserRef, db: Session) -> None:
    if not can_view(analysis, user, db):
        raise HTTPException(status_code=403, detail="접근 권한이 없는 해석 기록입니다.")


def assert_can_edit(analysis: "models.Analysis", user: UserRef, db: Session) -> None:
    if not can_edit(analysis, user, db):
        raise HTTPException(status_code=403, detail="이 해석을 수정할 권한이 없습니다.")


def find_analysis_for_path(
    db: Session,
    path: str,
    user_connection_base: str,
) -> "models.Analysis | None":
    """경로에서 작업 폴더명을 뽑아, 그 소유자의 공유(project_id NOT NULL) 해석 중 매치하는 행을 찾는다.

    Analysis 에 work_dir 컬럼이 없어서 input_info/result_info JSON 문자열에 든 절대경로로
    매칭한다(_files_available 과 같은 전제). 후보를 좁히기 위해:
      1) employee_id == 폴더 소유자 (인덱스)
      2) project_id IS NOT NULL   (인덱스)
      3) input_info / result_info 문자열에 폴더명이 LIKE 로 포함
    타임스탬프가 폴더명에 들어 있어 후보는 실전에서 1~2건이라 안전하다. `_` 는 LIKE 와일드카드라
    이스케이프한다. 못 찾으면 None.
    """
    folder = _work_folder_from_path(path, user_connection_base)
    if not folder:
        return None
    owner_id = owner_from_userconnection_path(path, user_connection_base)
    if not owner_id:
        return None

    # SQLite/MySQL 공통 — 폴더명의 _ 를 이스케이프한다.
    like_needle = "%" + folder.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"

    q = (
        db.query(models.Analysis)
        .filter(models.Analysis.project_id.isnot(None))
        .filter(models.Analysis.employee_id == owner_id)
        .filter(or_(
            models.Analysis.input_info.cast(models.Analysis.input_info.type).like(like_needle),
            models.Analysis.result_info.cast(models.Analysis.result_info.type).like(like_needle),
        ))
        .limit(4)
        .all()
    )
    for row in q:
        for info in (row.input_info, row.result_info):
            if isinstance(info, dict):
                blob = json.dumps(info)
                if folder in blob:
                    return row
    return None


def assert_current_user_can_access_path(
    path: str,
    current_user: str,
    db: Session,
    user_connection_base: str,
    *,
    allow_unowned: bool = False,
    allow_shared: bool = False,
) -> None:
    """경로 소유자 검사에 프로젝트 공유 예외를 얹는다.

    ``allow_shared=True`` 는 소유자/관리자 검사에서 떨어진 경우에만 마지막에 프로젝트 멤버십을
    확인한다. 이 플래그는 GET /api/download, GET /api/analysis/export-xlsx 두 라우트만 켠다 —
    나머지 30여 곳은 기본값(False) 이라 동작이 바뀌지 않는다.
    """
    owner_id = owner_from_userconnection_path(path, user_connection_base)
    # 우선순위 1: 기존 소유자/관리자 규칙
    if (
        owner_id
        and owner_id.strip().casefold() == (current_user or "").strip().casefold()
    ):
        return
    if is_admin_user(db, current_user):
        return
    # 우선순위 2: 공유 허용 옵션 — 프로젝트 멤버라면 통과
    if allow_shared:
        record = find_analysis_for_path(db, path, user_connection_base)
        if record is not None and can_view(record, current_user, db):
            return
    # 우선순위 3: 소유자 미식별 예외(관리자 배포 자산 전용)
    if not owner_id and allow_unowned:
        return
    raise HTTPException(status_code=403, detail="접근 권한이 없는 작업입니다.")


def assert_current_user_can_access_job(job_id: str, current_user: str, db: Session, status: dict | None = None) -> None:
    record = db.query(models.Analysis).filter(models.Analysis.job_id == job_id).first()
    if record:
        assert_current_user_can_access_owner(record.employee_id, current_user, db)
        return
    if isinstance(status, dict):
        assert_current_user_can_access_owner(status.get("employee_id"), current_user, db)
        return
    # DB와 메모리 어디에서도 소유자를 입증하지 못하면 존재 여부 자체를 노출하지 않는다.
    raise HTTPException(status_code=403, detail="접근 권한이 없는 작업입니다.")
```

- [ ] **Step 4: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_access_control_projects.py tests/test_analysis_access_control.py -q
```
기대: `test_access_control_projects.py` 신규 15건 + `test_analysis_access_control.py` 기존 8건 전부 통과. 기존 테스트가 하나라도 깨지면 확장이 시그니처를 침범한 것이니 되돌린다.

- [ ] **Step 5: 커밋 준비 완료** — 보고: `app/routers/_access_control.py`, `tests/test_access_control_projects.py`.

---

### Task 3: `services/project_service.py` — 프로젝트 CRUD + 멤버·해석 배정 서비스

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/project_service.py`
- Create: `HiTessWorkBenchBackEnd/tests/test_project_service.py`

라우터가 얇게 유지되도록 트랜잭션·정규화·정합성 규칙을 서비스에 모은다. 사번 정규화는 저장 원문 유지 + 비교는 casefold(마스터 §2.7 결정).

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_project_service.py`:

```python
"""project_service 계약 — CRUD/멤버 upsert/해석 배정/삭제 시 분리."""
from datetime import datetime

import pytest

from app import models
from app.services import project_service


def _mk_user(db, eid, name="홍길동", department="구조해석팀", is_active=True, is_admin=False):
    u = models.User(
        employee_id=eid, name=name, company="HHI", department=department,
        is_active=is_active, is_admin=is_admin, is_developer=False,
    )
    db.add(u)
    db.commit()
    return u


def test_create_project_snapshots_department(db_session):
    _mk_user(db_session, "A476854", name="권혁민", department="구조시스템연구실")
    p = project_service.create_project(db_session, owner_id="A476854", name="3496 유닛")
    assert p.id is not None
    assert p.name == "3496 유닛"
    assert p.owner_id == "A476854"
    assert p.department == "구조시스템연구실"
    assert p.created_at is not None


def test_create_project_rejects_blank_or_long_name(db_session):
    _mk_user(db_session, "A476854")
    with pytest.raises(ValueError):
        project_service.create_project(db_session, owner_id="A476854", name="   ")
    with pytest.raises(ValueError):
        project_service.create_project(db_session, owner_id="A476854", name="x" * 201)


def test_update_project_touches_updated_at(db_session):
    _mk_user(db_session, "A476854")
    p = project_service.create_project(db_session, owner_id="A476854", name="a")
    updated = project_service.update_project(db_session, p.id, name="b", description="설명")
    assert updated.name == "b"
    assert updated.description == "설명"
    assert updated.updated_at is not None


def test_list_projects_for_user_returns_owned_and_member(db_session):
    _mk_user(db_session, "A476854")
    _mk_user(db_session, "EMP001")
    _mk_user(db_session, "STRANGER")
    p1 = project_service.create_project(db_session, owner_id="A476854", name="내가 소유")
    p2 = project_service.create_project(db_session, owner_id="STRANGER", name="다른 사람 소유")
    project_service.add_member(db_session, p2.id, employee_id="A476854", role="viewer", added_by="STRANGER")
    p3 = project_service.create_project(db_session, owner_id="STRANGER", name="관련 없음")

    items = project_service.list_projects_for(db_session, "A476854")
    assert {p.id for p in items} == {p1.id, p2.id}
    assert p3.id not in {p.id for p in items}


def test_add_member_rejects_owner(db_session):
    _mk_user(db_session, "A476854")
    p = project_service.create_project(db_session, owner_id="A476854", name="p")
    with pytest.raises(ValueError):
        project_service.add_member(db_session, p.id, employee_id="A476854", role="viewer", added_by="A476854")


def test_add_member_rejects_unknown_or_inactive(db_session):
    _mk_user(db_session, "A476854")
    _mk_user(db_session, "INACTIVE", is_active=False)
    p = project_service.create_project(db_session, owner_id="A476854", name="p")
    with pytest.raises(LookupError):
        project_service.add_member(db_session, p.id, employee_id="NOBODY", role="viewer", added_by="A476854")
    with pytest.raises(LookupError):
        project_service.add_member(db_session, p.id, employee_id="INACTIVE", role="viewer", added_by="A476854")


def test_add_member_rejects_invalid_role(db_session):
    _mk_user(db_session, "A476854")
    _mk_user(db_session, "EMP001")
    p = project_service.create_project(db_session, owner_id="A476854", name="p")
    with pytest.raises(ValueError):
        project_service.add_member(db_session, p.id, employee_id="EMP001", role="admin", added_by="A476854")


def test_add_member_is_upsert_returns_created_flag(db_session):
    _mk_user(db_session, "A476854")
    _mk_user(db_session, "EMP001")
    p = project_service.create_project(db_session, owner_id="A476854", name="p")

    m, created = project_service.add_member(
        db_session, p.id, employee_id="EMP001", role="viewer", added_by="A476854",
    )
    assert created is True and m.role == "viewer"

    m2, created2 = project_service.add_member(
        db_session, p.id, employee_id="EMP001", role="editor", added_by="A476854",
    )
    assert created2 is False and m2.role == "editor"


def test_remove_member_deletes(db_session):
    _mk_user(db_session, "A476854")
    _mk_user(db_session, "EMP001")
    p = project_service.create_project(db_session, owner_id="A476854", name="p")
    project_service.add_member(db_session, p.id, employee_id="EMP001", role="viewer", added_by="A476854")
    project_service.remove_member(db_session, p.id, employee_id="EMP001")
    assert project_service.list_members(db_session, p.id) == []


def test_delete_project_detaches_analyses_and_removes_members(db_session, make_analysis):
    _mk_user(db_session, "A476854")
    _mk_user(db_session, "EMP001")
    p = project_service.create_project(db_session, owner_id="A476854", name="p")
    project_service.add_member(db_session, p.id, employee_id="EMP001", role="viewer", added_by="A476854")
    a = make_analysis("A476854", "Truss Assessment", datetime(2026, 9, 18, 9, 0, 0))
    a.project_id = p.id
    db_session.commit()

    detached = project_service.delete_project(db_session, p.id)
    assert detached == 1
    assert db_session.get(models.Project, p.id) is None
    assert project_service.list_members(db_session, p.id) == []
    db_session.refresh(a)
    assert a.id is not None       # 해석은 남는다
    assert a.project_id is None   # 분리만 된다


def test_assign_analysis_sets_and_clears_project_id(db_session, make_analysis):
    _mk_user(db_session, "A476854")
    p = project_service.create_project(db_session, owner_id="A476854", name="p")
    a = make_analysis("A476854", "Truss Assessment", datetime(2026, 9, 18, 9, 0, 0))
    db_session.commit()

    project_service.assign_analysis_to_project(db_session, a.id, project_id=p.id)
    db_session.refresh(a)
    assert a.project_id == p.id

    project_service.assign_analysis_to_project(db_session, a.id, project_id=None)
    db_session.refresh(a)
    assert a.project_id is None


def test_list_members_returns_employee_metadata(db_session):
    _mk_user(db_session, "A476854")
    _mk_user(db_session, "EMP001", name="김공유", department="선체설계")
    p = project_service.create_project(db_session, owner_id="A476854", name="p")
    project_service.add_member(db_session, p.id, employee_id="EMP001", role="editor", added_by="A476854")

    rows = project_service.list_members(db_session, p.id)
    assert len(rows) == 1
    row = rows[0]
    assert row["employee_id"] == "EMP001"
    assert row["name"] == "김공유"
    assert row["department"] == "선체설계"
    assert row["role"] == "editor"
    assert row["added_by"] == "A476854"
    assert row["added_at"] is not None


def test_serialize_project_summary_shape(db_session):
    _mk_user(db_session, "A476854", name="권혁민", department="구조시스템연구실")
    _mk_user(db_session, "EMP001", name="김공유")
    p = project_service.create_project(db_session, owner_id="A476854", name="공유")
    project_service.add_member(db_session, p.id, employee_id="EMP001", role="viewer", added_by="A476854")

    summary = project_service.serialize_project(db_session, p, viewer_id="EMP001")
    assert summary["id"] == p.id
    assert summary["name"] == "공유"
    assert summary["owner_id"] == "A476854"
    assert summary["owner_name"] == "권혁민"
    assert summary["my_role"] == "viewer"
    assert summary["member_count"] == 1
    assert summary["analysis_count"] == 0


def test_serialize_project_owner_role(db_session):
    _mk_user(db_session, "A476854")
    p = project_service.create_project(db_session, owner_id="A476854", name="공유")
    summary = project_service.serialize_project(db_session, p, viewer_id="A476854")
    assert summary["my_role"] == "owner"
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_project_service.py -q
```
기대: `ModuleNotFoundError: No module named 'app.services.project_service'` (`1 error`).

- [ ] **Step 3: 서비스 구현** — `HiTessWorkBenchBackEnd/app/services/project_service.py`:

```python
"""프로젝트·공유(Plan G) — CRUD 서비스.

라우터가 얇게 유지되도록 정규화(사번 대소문자, 빈 문자열, 이름 길이) 와 정합성 규칙
(소유자를 멤버로 추가 금지, 비활성 사용자 초대 금지, upsert 규칙) 을 여기 모은다.
notify(share.received) 는 라우터에서 부른다 — 서비스는 알림 모듈에 의존하지 않는다.
"""
from __future__ import annotations

from datetime import datetime
from typing import Iterable

from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..routers._access_control import (
    PROJECT_ROLES,
    PROJECT_ROLE_VIEWER,
    project_role,
)

_NAME_MAX = 200


def _norm_eid(value) -> str:
    return (value or "").strip()


def _casefold_eid(value) -> str:
    return _norm_eid(value).casefold()


def _clean_name(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("이름은 문자열이어야 합니다.")
    name = value.strip()
    if not name:
        raise ValueError("프로젝트 이름을 입력하세요.")
    if len(name) > _NAME_MAX:
        raise ValueError(f"프로젝트 이름은 {_NAME_MAX}자 이내여야 합니다.")
    return name


def _clean_description(value: str | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("설명은 문자열이어야 합니다.")
    stripped = value.strip()
    return stripped or None


def _get_user(db: Session, employee_id: str) -> models.User | None:
    """사번 대소문자 무시 조회 — DB 에 원문이 대소문자 혼재라 casefold 매치."""
    eid = _casefold_eid(employee_id)
    if not eid:
        return None
    for u in db.query(models.User).all():
        if _casefold_eid(u.employee_id) == eid:
            return u
    return None


def create_project(db: Session, *, owner_id: str, name: str, description: str | None = None) -> models.Project:
    owner = _get_user(db, owner_id)
    project = models.Project(
        name=_clean_name(name),
        owner_id=_norm_eid(owner_id),
        description=_clean_description(description),
        department=owner.department if owner else None,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def get_project(db: Session, project_id: int) -> models.Project | None:
    return db.query(models.Project).filter(models.Project.id == project_id).first()


def update_project(
    db: Session,
    project_id: int,
    *,
    name: str | None = None,
    description: str | None = ...,
) -> models.Project:
    """이름·설명만 부분 갱신. description=... 는 sentinel — 넘어오지 않으면 그대로 둔다.

    None 을 넘기면 설명을 지우겠다는 뜻이라 sentinel 로 구분한다.
    """
    project = get_project(db, project_id)
    if project is None:
        raise LookupError("프로젝트를 찾을 수 없습니다.")
    if name is not None:
        project.name = _clean_name(name)
    if description is not ...:
        project.description = _clean_description(description)
    project.updated_at = datetime.now()
    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, project_id: int) -> int:
    """프로젝트 삭제. 멤버 행은 함께 지우고, 해석은 project_id=NULL 로 분리한다(남긴다).

    반환: 분리된 해석 건수 — 라우터가 응답 body 에 detached_analyses 로 실어 사용자가
    '해석은 사라지지 않는다' 를 확인하게 한다.
    """
    project = get_project(db, project_id)
    if project is None:
        raise LookupError("프로젝트를 찾을 수 없습니다.")
    detached = (
        db.query(models.Analysis)
        .filter(models.Analysis.project_id == project_id)
        .update({models.Analysis.project_id: None}, synchronize_session=False)
    )
    db.query(models.ProjectMember).filter(
        models.ProjectMember.project_id == project_id
    ).delete(synchronize_session=False)
    db.delete(project)
    db.commit()
    return int(detached)


def list_projects_for(db: Session, employee_id: str) -> list[models.Project]:
    """본인이 소유자거나 멤버인 프로젝트만. id 내림차순.

    관리자라도 이 함수로는 '남의 프로젝트' 를 열람하지 않는다 — Admin 콘솔의 전체 목록은
    별도(이번 Plan 범위 밖). 대신 관리자는 상세 조회·수정은 통과한다.
    """
    eid = _casefold_eid(employee_id)
    if not eid:
        return []
    owned = db.query(models.Project).filter(func.lower(models.Project.owner_id) == eid).all()
    member_pids = (
        db.query(models.ProjectMember.project_id)
        .filter(func.lower(models.ProjectMember.employee_id) == eid)
        .all()
    )
    member_projects = []
    if member_pids:
        ids = [row.project_id for row in member_pids]
        member_projects = (
            db.query(models.Project).filter(models.Project.id.in_(ids)).all()
        )
    combined = {p.id: p for p in owned}
    for p in member_projects:
        combined.setdefault(p.id, p)
    return sorted(combined.values(), key=lambda p: p.id, reverse=True)


def add_member(
    db: Session,
    project_id: int,
    *,
    employee_id: str,
    role: str,
    added_by: str | None,
) -> tuple[models.ProjectMember, bool]:
    """멤버 upsert. 이미 있으면 역할만 갱신한다.

    반환: (row, created). created=True 면 신규 추가(라우터가 이 값으로 201/200 을 정한다).
    """
    if role not in PROJECT_ROLES:
        raise ValueError(f"역할은 {PROJECT_ROLES} 중 하나여야 합니다.")
    project = get_project(db, project_id)
    if project is None:
        raise LookupError("프로젝트를 찾을 수 없습니다.")
    if _casefold_eid(project.owner_id) == _casefold_eid(employee_id):
        raise ValueError("소유자는 이미 접근 권한이 있어 멤버로 추가할 수 없습니다.")

    user = _get_user(db, employee_id)
    if user is None or not user.is_active:
        raise LookupError("사용자를 찾을 수 없습니다.")

    existing = (
        db.query(models.ProjectMember)
        .filter(
            models.ProjectMember.project_id == project_id,
            func.lower(models.ProjectMember.employee_id) == _casefold_eid(user.employee_id),
        )
        .first()
    )
    if existing is not None:
        existing.role = role
        db.commit()
        db.refresh(existing)
        return existing, False

    row = models.ProjectMember(
        project_id=project_id,
        employee_id=_norm_eid(user.employee_id),
        role=role,
        added_by=_norm_eid(added_by) or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, True


def update_member_role(db: Session, project_id: int, employee_id: str, *, role: str) -> models.ProjectMember:
    if role not in PROJECT_ROLES:
        raise ValueError(f"역할은 {PROJECT_ROLES} 중 하나여야 합니다.")
    row = (
        db.query(models.ProjectMember)
        .filter(
            models.ProjectMember.project_id == project_id,
            func.lower(models.ProjectMember.employee_id) == _casefold_eid(employee_id),
        )
        .first()
    )
    if row is None:
        raise LookupError("해당 멤버를 찾을 수 없습니다.")
    row.role = role
    db.commit()
    db.refresh(row)
    return row


def remove_member(db: Session, project_id: int, employee_id: str) -> None:
    (
        db.query(models.ProjectMember)
        .filter(
            models.ProjectMember.project_id == project_id,
            func.lower(models.ProjectMember.employee_id) == _casefold_eid(employee_id),
        )
        .delete(synchronize_session=False)
    )
    db.commit()


def list_members(db: Session, project_id: int) -> list[dict]:
    """멤버 목록 + User 메타(이름·부서). 역할 순(editor 먼저) → 이름 순."""
    rows = (
        db.query(models.ProjectMember)
        .filter(models.ProjectMember.project_id == project_id)
        .all()
    )
    if not rows:
        return []
    eids_lower = {_casefold_eid(m.employee_id) for m in rows}
    users = {
        _casefold_eid(u.employee_id): u
        for u in db.query(models.User).all()
        if _casefold_eid(u.employee_id) in eids_lower
    }

    def _key(m: models.ProjectMember):
        u = users.get(_casefold_eid(m.employee_id))
        role_order = 0 if m.role == "editor" else 1
        return (role_order, (u.name if u else m.employee_id) or "")

    result = []
    for m in sorted(rows, key=_key):
        u = users.get(_casefold_eid(m.employee_id))
        result.append({
            "employee_id": m.employee_id,
            "name": u.name if u else None,
            "department": u.department if u else None,
            "role": m.role,
            "added_by": m.added_by,
            "added_at": m.added_at.isoformat() if m.added_at else None,
        })
    return result


def count_analyses(db: Session, project_id: int) -> int:
    return int(
        db.query(func.count(models.Analysis.id))
        .filter(models.Analysis.project_id == project_id)
        .scalar()
        or 0
    )


def count_members(db: Session, project_id: int) -> int:
    return int(
        db.query(func.count(models.ProjectMember.employee_id))
        .filter(models.ProjectMember.project_id == project_id)
        .scalar()
        or 0
    )


def _owner_name(db: Session, employee_id: str) -> str | None:
    u = _get_user(db, employee_id)
    return u.name if u else None


def serialize_project(
    db: Session,
    project: models.Project,
    *,
    viewer_id: str,
) -> dict:
    """카드/목록에 쓰는 요약 dict — 라우터가 그대로 응답한다."""
    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "department": project.department,
        "owner_id": project.owner_id,
        "owner_name": _owner_name(db, project.owner_id),
        "my_role": project_role(db, project.id, viewer_id) or None,
        "member_count": count_members(db, project.id),
        "analysis_count": count_analyses(db, project.id),
        "created_at": project.created_at.isoformat() if project.created_at else None,
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
    }


def serialize_project_detail(
    db: Session,
    project: models.Project,
    *,
    viewer_id: str,
) -> dict:
    return {**serialize_project(db, project, viewer_id=viewer_id),
            "members": list_members(db, project.id)}


def assign_analysis_to_project(
    db: Session,
    analysis_id: int,
    *,
    project_id: int | None,
) -> models.Analysis:
    """해석의 project_id 를 갱신. None 이면 프로젝트에서 뺀다.

    권한 판정(can_edit + 대상 프로젝트 owner/editor)은 라우터가 한다 — 서비스는
    존재만 확인한다.
    """
    record = db.query(models.Analysis).filter(models.Analysis.id == analysis_id).first()
    if record is None:
        raise LookupError("해석 기록을 찾을 수 없습니다.")
    if project_id is not None and get_project(db, project_id) is None:
        raise LookupError("프로젝트를 찾을 수 없습니다.")
    record.project_id = project_id
    db.commit()
    db.refresh(record)
    return record


def list_analyses_for_project(db: Session, project_id: int) -> list[models.Analysis]:
    """프로젝트 소속 해석 — 이력 목록과 같은 필터 원칙(내부 하위단계 제외)."""
    from .program_registry import internal_substep_programs
    internal = set(internal_substep_programs())
    q = (
        db.query(models.Analysis)
        .filter(models.Analysis.project_id == project_id)
        .order_by(models.Analysis.created_at.desc())
        .all()
    )
    return [r for r in q if r.program_name not in internal]
```

- [ ] **Step 4: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_project_service.py -q
```
기대: `14 passed`.

- [ ] **Step 5: 커밋 준비 완료** — 보고: `app/services/project_service.py`, `tests/test_project_service.py`.

---

### Task 4: 라우터 `/api/projects` + `PUT /api/analysis/{id}/project` + `main.py` 등록

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/routers/projects.py`
- Modify: `HiTessWorkBenchBackEnd/app/main.py:20-45`(import), `:212`(include)
- Create: `HiTessWorkBenchBackEnd/tests/test_projects_router.py`

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_projects_router.py`:

```python
"""프로젝트 라우터 — CRUD/권한/멤버/PUT analysis/{id}/project/share.received 알림."""
from datetime import datetime

import pytest

from app import models
from app.dependencies import require_auth
from app.main import app
from app.services import project_service


def _act_as(employee_id: str):
    app.dependency_overrides[require_auth] = lambda: employee_id


def _mk_user(db, eid, name="사용자", department="구조해석팀", is_active=True, is_admin=False):
    u = models.User(
        employee_id=eid, name=name, company="HHI", department=department,
        is_active=is_active, is_admin=is_admin, is_developer=False,
    )
    db.add(u)
    db.commit()
    return u


def test_create_project_201_and_summary_shape(switchable_client, db_session):
    _mk_user(db_session, "ADMIN001", is_admin=True)  # 이미 conftest 가 시드하지만 명시적으로 department 세팅
    r = switchable_client.post("/api/projects", json={"name": "3496 유닛", "description": "권상"})
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "3496 유닛"
    assert data["owner_id"] == "ADMIN001"
    assert data["my_role"] == "owner"
    assert data["members"] == []


def test_create_project_validation_400(switchable_client):
    assert switchable_client.post("/api/projects", json={"name": "  "}).status_code == 400
    assert switchable_client.post("/api/projects", json={"name": "x" * 201}).status_code == 400


def test_list_projects_returns_owned_and_member_only(switchable_client, db_session):
    p_mine = project_service.create_project(db_session, owner_id="ADMIN001", name="mine")
    p_shared = project_service.create_project(db_session, owner_id="EMP001", name="shared")
    project_service.add_member(db_session, p_shared.id, employee_id="ADMIN001", role="viewer", added_by="EMP001")
    project_service.create_project(db_session, owner_id="EMP001", name="untouched")

    ids = {item["id"] for item in switchable_client.get("/api/projects").json()["items"]}
    assert ids == {p_mine.id, p_shared.id}


def test_get_project_forbidden_to_non_member(switchable_client, db_session):
    p = project_service.create_project(db_session, owner_id="EMP001", name="p")
    assert switchable_client.get(f"/api/projects/{p.id}").status_code == 403


def test_get_project_ok_for_admin_even_if_not_member(switchable_client, db_session):
    """관리자는 상세 조회는 통과(감사 목적). 목록에는 안 나온다."""
    p = project_service.create_project(db_session, owner_id="EMP001", name="p")
    r = switchable_client.get(f"/api/projects/{p.id}")
    assert r.status_code == 200 and r.json()["id"] == p.id


def test_update_project_owner_only(switchable_client, db_session):
    p = project_service.create_project(db_session, owner_id="EMP001", name="p")
    r = switchable_client.put(f"/api/projects/{p.id}", json={"name": "x"})
    # ADMIN001 은 관리자라 통과
    assert r.status_code == 200
    switchable_client.as_user()
    project_service.add_member(db_session, p.id, employee_id="EMP001", role="editor", added_by="EMP001")
    r2 = switchable_client.put(f"/api/projects/{p.id}", json={"name": "y"})
    assert r2.status_code == 200          # EMP001 은 owner
    _act_as("STRANGER")
    _mk_user(db_session, "STRANGER")
    r3 = switchable_client.put(f"/api/projects/{p.id}", json={"name": "z"})
    assert r3.status_code == 403


def test_delete_project_detaches_analyses(switchable_client, db_session, make_analysis):
    p = project_service.create_project(db_session, owner_id="ADMIN001", name="p")
    a = make_analysis("ADMIN001", "Truss Assessment", datetime(2026, 9, 18, 9, 0, 0))
    a.project_id = p.id
    db_session.commit()

    r = switchable_client.delete(f"/api/projects/{p.id}")
    assert r.status_code == 200 and r.json()["detached_analyses"] == 1
    db_session.expire_all()
    assert db_session.get(models.Project, p.id) is None
    assert db_session.get(models.Analysis, a.id).project_id is None


def test_add_member_creates_and_notifies(switchable_client, db_session, monkeypatch):
    _mk_user(db_session, "EMP001", name="김공유")
    p = project_service.create_project(db_session, owner_id="ADMIN001", name="공유")
    seen = []

    def _fake_notify(db, **kwargs):
        seen.append(kwargs)

    import app.routers.projects as projects_router
    monkeypatch.setattr(projects_router, "_notify", _fake_notify)

    r = switchable_client.post(
        f"/api/projects/{p.id}/members",
        json={"employee_id": "EMP001", "role": "viewer"},
    )
    assert r.status_code == 201
    assert r.json()["employee_id"] == "EMP001"
    assert r.json()["role"] == "viewer"
    assert seen and seen[0]["employee_id"] == "EMP001"
    assert seen[0]["kind"] == "share.received"
    assert seen[0]["link"]["params"]["project_id"] == p.id
    assert seen[0]["dedupe_key"].startswith(f"share:{p.id}:")


def test_add_member_upsert_returns_200_and_does_not_re_notify(
    switchable_client, db_session, monkeypatch,
):
    _mk_user(db_session, "EMP001")
    p = project_service.create_project(db_session, owner_id="ADMIN001", name="공유")
    seen = []
    import app.routers.projects as projects_router
    monkeypatch.setattr(projects_router, "_notify", lambda db, **k: seen.append(k))

    r1 = switchable_client.post(
        f"/api/projects/{p.id}/members", json={"employee_id": "EMP001", "role": "viewer"},
    )
    assert r1.status_code == 201
    r2 = switchable_client.post(
        f"/api/projects/{p.id}/members", json={"employee_id": "EMP001", "role": "editor"},
    )
    assert r2.status_code == 200
    assert r2.json()["role"] == "editor"
    # 역할 변경만이라 새 알림은 없다(dedupe 정책이 아니라 라우터에서 판단).
    assert len(seen) == 1


def test_add_member_rejects_owner_400(switchable_client, db_session):
    p = project_service.create_project(db_session, owner_id="ADMIN001", name="p")
    r = switchable_client.post(
        f"/api/projects/{p.id}/members",
        json={"employee_id": "ADMIN001", "role": "viewer"},
    )
    assert r.status_code == 400


def test_add_member_unknown_user_404(switchable_client, db_session):
    p = project_service.create_project(db_session, owner_id="ADMIN001", name="p")
    r = switchable_client.post(
        f"/api/projects/{p.id}/members",
        json={"employee_id": "NOBODY", "role": "viewer"},
    )
    assert r.status_code == 404


def test_add_member_bad_role_422(switchable_client, db_session):
    _mk_user(db_session, "EMP001")
    p = project_service.create_project(db_session, owner_id="ADMIN001", name="p")
    r = switchable_client.post(
        f"/api/projects/{p.id}/members",
        json={"employee_id": "EMP001", "role": "admin"},
    )
    assert r.status_code == 422


def test_update_member_role(switchable_client, db_session):
    _mk_user(db_session, "EMP001")
    p = project_service.create_project(db_session, owner_id="ADMIN001", name="p")
    project_service.add_member(db_session, p.id, employee_id="EMP001", role="viewer", added_by="ADMIN001")
    r = switchable_client.put(
        f"/api/projects/{p.id}/members/EMP001", json={"role": "editor"},
    )
    assert r.status_code == 200 and r.json()["role"] == "editor"


def test_member_self_can_leave(switchable_client, db_session):
    _mk_user(db_session, "EMP001")
    p = project_service.create_project(db_session, owner_id="ADMIN001", name="p")
    project_service.add_member(db_session, p.id, employee_id="EMP001", role="viewer", added_by="ADMIN001")
    switchable_client.as_user()
    r = switchable_client.delete(f"/api/projects/{p.id}/members/EMP001")
    assert r.status_code == 200


def test_member_cannot_remove_other_member(switchable_client, db_session):
    _mk_user(db_session, "EMP001")
    _mk_user(db_session, "EMP002")
    p = project_service.create_project(db_session, owner_id="ADMIN001", name="p")
    project_service.add_member(db_session, p.id, employee_id="EMP001", role="viewer", added_by="ADMIN001")
    project_service.add_member(db_session, p.id, employee_id="EMP002", role="viewer", added_by="ADMIN001")
    switchable_client.as_user()   # EMP001
    r = switchable_client.delete(f"/api/projects/{p.id}/members/EMP002")
    assert r.status_code == 403


def test_get_project_analyses_filters_and_owner_name(switchable_client, db_session, make_analysis):
    _mk_user(db_session, "EMP001", name="김공유")
    p = project_service.create_project(db_session, owner_id="ADMIN001", name="p")
    a = make_analysis("EMP001", "Truss Assessment", datetime(2026, 9, 18, 9, 0, 0))
    a.project_id = p.id
    project_service.add_member(db_session, p.id, employee_id="EMP001", role="viewer", added_by="ADMIN001")
    db_session.commit()

    r = switchable_client.get(f"/api/projects/{p.id}/analyses")
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == a.id
    assert items[0]["owner_name"] == "김공유"
    assert items[0]["employee_id"] == "EMP001"


def test_put_analysis_project_owner_can_move(switchable_client, db_session, make_analysis):
    p = project_service.create_project(db_session, owner_id="ADMIN001", name="p")
    a = make_analysis("ADMIN001", "Truss Assessment", datetime(2026, 9, 18, 9, 0, 0))
    db_session.commit()
    r = switchable_client.put(f"/api/analysis/{a.id}/project", json={"project_id": p.id})
    assert r.status_code == 200
    db_session.expire_all()
    assert db_session.get(models.Analysis, a.id).project_id == p.id
    # None 으로 되돌리기
    r2 = switchable_client.put(f"/api/analysis/{a.id}/project", json={"project_id": None})
    assert r2.status_code == 200
    db_session.expire_all()
    assert db_session.get(models.Analysis, a.id).project_id is None


def test_put_analysis_project_editor_can_move_if_target_editor(switchable_client, db_session, make_analysis):
    _mk_user(db_session, "EMP001")
    # ADMIN001 소유 해석, EMP001 을 editor 로 초대
    p_src = project_service.create_project(db_session, owner_id="ADMIN001", name="src")
    p_dst = project_service.create_project(db_session, owner_id="ADMIN001", name="dst")
    project_service.add_member(db_session, p_src.id, employee_id="EMP001", role="editor", added_by="ADMIN001")
    project_service.add_member(db_session, p_dst.id, employee_id="EMP001", role="editor", added_by="ADMIN001")

    a = make_analysis("ADMIN001", "Truss Assessment", datetime(2026, 9, 18, 9, 0, 0))
    a.project_id = p_src.id
    db_session.commit()

    switchable_client.as_user()
    r = switchable_client.put(f"/api/analysis/{a.id}/project", json={"project_id": p_dst.id})
    assert r.status_code == 200


def test_put_analysis_project_viewer_forbidden(switchable_client, db_session, make_analysis):
    _mk_user(db_session, "EMP001")
    p = project_service.create_project(db_session, owner_id="ADMIN001", name="p")
    project_service.add_member(db_session, p.id, employee_id="EMP001", role="viewer", added_by="ADMIN001")
    a = make_analysis("ADMIN001", "Truss Assessment", datetime(2026, 9, 18, 9, 0, 0))
    a.project_id = p.id
    db_session.commit()

    switchable_client.as_user()
    r = switchable_client.put(f"/api/analysis/{a.id}/project", json={"project_id": None})
    assert r.status_code == 403


def test_notify_import_error_is_swallowed(switchable_client, db_session, monkeypatch):
    """Plan A(알림) 이 없어도 멤버 추가는 성공해야 한다."""
    _mk_user(db_session, "EMP001")
    p = project_service.create_project(db_session, owner_id="ADMIN001", name="p")

    import app.routers.projects as projects_router

    def _boom(db, **kwargs):
        raise ImportError("notification module missing")
    monkeypatch.setattr(projects_router, "_notify", _boom)

    r = switchable_client.post(
        f"/api/projects/{p.id}/members",
        json={"employee_id": "EMP001", "role": "viewer"},
    )
    assert r.status_code == 201


def test_requires_auth(switchable_client):
    saved = app.dependency_overrides.pop(require_auth)
    try:
        assert switchable_client.get("/api/projects").status_code == 401
        assert switchable_client.post("/api/projects", json={"name": "x"}).status_code == 401
    finally:
        app.dependency_overrides[require_auth] = saved
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_projects_router.py -q
```
기대: 전부 404(라우터 미등록) 또는 수집 실패. 실패 20+건.

- [ ] **Step 3: 라우터 구현** — `HiTessWorkBenchBackEnd/app/routers/projects.py`:

```python
"""프로젝트·공유 API (Plan G).

CRUD + 멤버 관리 + 해석 배정(PUT /api/analysis/{id}/project). 알림 서비스(Plan A) 는
지연 import — 없으면 조용히 넘어간다. GUARDED_ROUTES 에는 등록하지 않는다(플랫폼 공통).
"""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import database, models
from ..dependencies import require_auth
from ..routers._access_control import (
    PROJECT_ROLES,
    assert_can_edit,
    is_admin_user,
    project_role,
)
from ..services import project_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["projects"])

_ROLE_LABEL = {"viewer": "뷰어", "editor": "편집자"}


def _norm(value: str | None) -> str:
    return (value or "").strip()


def _casefold(value: str | None) -> str:
    return _norm(value).casefold()


class ProjectCreateBody(BaseModel):
    name: str = Field(..., description="프로젝트 이름 (1~200자)")
    description: str | None = None


class ProjectUpdateBody(BaseModel):
    name: str | None = None
    description: str | None = None


class MemberBody(BaseModel):
    employee_id: str = Field(..., min_length=1)
    role: Literal["viewer", "editor"] = "viewer"


class MemberRoleBody(BaseModel):
    role: Literal["viewer", "editor"]


class AssignProjectBody(BaseModel):
    project_id: int | None = None


def _require_project_member(db: Session, project_id: int, employee_id: str) -> models.Project:
    project = project_service.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    role = project_role(db, project.id, employee_id)
    if role is None and not is_admin_user(db, employee_id):
        raise HTTPException(status_code=403, detail="프로젝트 접근 권한이 없습니다.")
    return project


def _require_project_owner_or_admin(db: Session, project_id: int, employee_id: str) -> models.Project:
    project = project_service.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    if _casefold(project.owner_id) != _casefold(employee_id) and not is_admin_user(db, employee_id):
        raise HTTPException(status_code=403, detail="프로젝트 소유자만 수행할 수 있습니다.")
    return project


def _notify(db: Session, **kwargs) -> None:
    """지연 import 로 알림 서비스에 붙는다.

    Plan A(notification_service)가 없어도 각 plan 이 단독으로 동작해야 하므로(마스터 §2.1),
    이 함수는 ImportError 나 임의 예외를 흡수한다 — 알림 실패가 멤버 추가를 되돌리지 않게.
    테스트는 monkeypatch 로 이 심볼(_notify) 자체를 교체한다.
    """
    try:
        from ..services.notification_service import notify as _dispatch
    except ImportError:
        return
    try:
        _dispatch(db, **kwargs)
    except Exception:
        logger.warning("share.received 알림 발송 실패 (employee_id=%s)",
                       kwargs.get("employee_id"), exc_info=True)


def _owner_name(db: Session, employee_id: str) -> str | None:
    from ..services.project_service import _get_user  # noqa: WPS437
    u = _get_user(db, employee_id)
    return u.name if u else None


# ==================== CRUD ====================

@router.get("/projects")
def list_projects(
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """본인이 소유자거나 멤버인 프로젝트만 (관리자도 여기서는 본인 것만 본다)."""
    items = [
        project_service.serialize_project(db, p, viewer_id=me)
        for p in project_service.list_projects_for(db, me)
    ]
    return {"items": items}


@router.post("/projects", status_code=201)
def create_project(
    body: ProjectCreateBody,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    try:
        project = project_service.create_project(
            db, owner_id=me, name=body.name, description=body.description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return project_service.serialize_project_detail(db, project, viewer_id=me)


@router.get("/projects/{project_id}")
def get_project_detail(
    project_id: int,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    project = _require_project_member(db, project_id, me)
    return project_service.serialize_project_detail(db, project, viewer_id=me)


@router.put("/projects/{project_id}")
def update_project_detail(
    project_id: int,
    body: ProjectUpdateBody,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    project = _require_project_owner_or_admin(db, project_id, me)
    try:
        project = project_service.update_project(
            db,
            project_id,
            name=body.name if body.name is not None else None,
            description=body.description if body.description is not None else ...,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return project_service.serialize_project_detail(db, project, viewer_id=me)


@router.delete("/projects/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    _require_project_owner_or_admin(db, project_id, me)
    detached = project_service.delete_project(db, project_id)
    return {"message": "Project deleted", "detached_analyses": detached}


# ==================== 멤버 ====================

@router.post("/projects/{project_id}/members")
def add_member(
    project_id: int,
    body: MemberBody,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    project = _require_project_owner_or_admin(db, project_id, me)
    try:
        member, created = project_service.add_member(
            db, project_id,
            employee_id=body.employee_id, role=body.role, added_by=me,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    payload = {
        "employee_id": member.employee_id,
        "name": _owner_name(db, member.employee_id),
        "department": None,
        "role": member.role,
        "added_by": member.added_by,
        "added_at": member.added_at.isoformat() if member.added_at else None,
    }
    # 정보 보강(부서)
    from ..services.project_service import _get_user  # noqa: WPS437
    u = _get_user(db, member.employee_id)
    if u is not None:
        payload["department"] = u.department

    status_code = 201 if created else 200

    if created:
        adder_name = _owner_name(db, me) or me
        _notify(
            db,
            employee_id=member.employee_id,
            kind="share.received",
            title=f"'{project.name}' 프로젝트에 {_ROLE_LABEL.get(body.role, body.role)}(으)로 초대되었습니다",
            body=f"{adder_name}님이 회원님을 프로젝트 멤버로 추가했습니다.",
            link={"menu": "My Projects", "params": {"tab": "projects", "project_id": project.id}},
            dedupe_key=f"share:{project.id}:{member.employee_id}",
        )

    from fastapi.responses import JSONResponse
    return JSONResponse(payload, status_code=status_code)


@router.put("/projects/{project_id}/members/{employee_id}")
def change_member_role(
    project_id: int,
    employee_id: str,
    body: MemberRoleBody,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    _require_project_owner_or_admin(db, project_id, me)
    try:
        row = project_service.update_member_role(db, project_id, employee_id, role=body.role)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    from ..services.project_service import _get_user  # noqa: WPS437
    u = _get_user(db, row.employee_id)
    return {
        "employee_id": row.employee_id,
        "name": u.name if u else None,
        "department": u.department if u else None,
        "role": row.role,
        "added_by": row.added_by,
        "added_at": row.added_at.isoformat() if row.added_at else None,
    }


@router.delete("/projects/{project_id}/members/{employee_id}")
def remove_member(
    project_id: int,
    employee_id: str,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    project = project_service.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    is_self = _casefold(employee_id) == _casefold(me)
    is_owner_or_admin = (
        _casefold(project.owner_id) == _casefold(me) or is_admin_user(db, me)
    )
    if not (is_self or is_owner_or_admin):
        raise HTTPException(status_code=403, detail="다른 멤버를 제거할 권한이 없습니다.")

    project_service.remove_member(db, project_id, employee_id)
    return {"message": "Member removed"}


# ==================== 프로젝트별 해석 목록 ====================

@router.get("/projects/{project_id}/analyses")
def list_project_analyses(
    project_id: int,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    _require_project_member(db, project_id, me)
    from .analysis import _serialize_analysis   # 지연 import: 순환 방지
    items = []
    rows = project_service.list_analyses_for_project(db, project_id)
    owner_cache: dict[str, str | None] = {}
    for record in rows:
        payload = _serialize_analysis(record)
        owner_id = record.employee_id or ""
        if owner_id not in owner_cache:
            owner_cache[owner_id] = _owner_name(db, owner_id)
        payload["owner_name"] = owner_cache[owner_id]
        items.append(payload)
    return {"items": items}


# ==================== 해석 → 프로젝트 배정 ====================

@router.put("/analysis/{analysis_id}/project")
def set_analysis_project(
    analysis_id: int,
    body: AssignProjectBody,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """해석을 프로젝트에 넣거나 뺀다.

    권한:
      - 해석에 대해 can_edit (소유자·관리자·현재 프로젝트의 owner/editor)
      - 넣을 프로젝트에 대해 owner/editor(관리자 통과)
      - 빼기(project_id=None)는 대상 프로젝트 권한 필요 없음
    """
    record = db.query(models.Analysis).filter(models.Analysis.id == analysis_id).first()
    if record is None:
        raise HTTPException(status_code=404, detail="해석 기록을 찾을 수 없습니다.")

    assert_can_edit(record, me, db)

    if body.project_id is not None:
        project = project_service.get_project(db, body.project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
        role = project_role(db, project.id, me)
        if role not in ("owner", "editor") and not is_admin_user(db, me):
            raise HTTPException(
                status_code=403,
                detail="해당 프로젝트의 편집자 이상만 해석을 넣을 수 있습니다.",
            )

    try:
        record = project_service.assign_analysis_to_project(
            db, analysis_id, project_id=body.project_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    from .analysis import _serialize_analysis   # 지연 import
    return _serialize_analysis(record)
```

- [ ] **Step 4: `main.py` 등록**

(a) 20~45행 import 목록에서 `presence,` 아래 줄에 `projects,` 를 추가(알파벳 순):

```python
    presence,
    projects,
    reports,
```

(b) 212행 `application.include_router(reports.router)` 다음 줄에:

```python
    application.include_router(projects.router)
```

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_projects_router.py -q
```
기대: `21 passed`.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/routers/projects.py`, `app/main.py`, `tests/test_projects_router.py`.

---

### Task 5: 8개 파일의 `_access_control` 호출부를 `can_view` / `allow_shared` 로 전환

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/routers/analysis.py:78-82`(import), `:789`, `:844`, `:1655-1665`(get_analysis_by_id), `:1668-1679`(passport)
- Modify: `HiTessWorkBenchBackEnd/app/routers/reports.py:21`(import), `:79`
- Create: `HiTessWorkBenchBackEnd/tests/test_analysis_shared_access.py`

⚠ **잠깐 — 왜 8개 파일 중 2개만 편집인가?** spec §2.1 표에 따르면:
- `analysis.py` — 2 곳 `assert_can_view` 로 교체(1665·1679) + 2 곳 `allow_shared=True`(789·844). **재실행(1995)·Studio 편집·해석 실행 등 나머지 27 곳은 유지** — 이번 범위 밖.
- `reports.py` — 1 곳 `assert_can_view` 로 교체(79).
- `doublepipe.py`·`hitessbeam.py`·`module_ocean_transport.py`·`model_registry.py`·`services/analysis_passport.py`·`services/model_registry_service.py` — **전부 유지**. 쓰기 동작·Studio 세션·관리자 전용이라 소유자 규칙을 열지 않는다(§2.1 표 세로 열 "Plan G 후" = "유지").

이 Task 는 그래서 2개 파일만 만진다. 나머지 6개는 import 만 남고 호출부는 변경 없음 — Task 2 가 `assert_current_user_can_access_path/owner/job` 의 시그니처를 유지했기 때문.

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_analysis_shared_access.py`:

```python
"""프로젝트 멤버(viewer)가 공유 해석에 대해 조회·다운로드가 되는지 검증한다.

기존 tests/test_analysis_access_control.py 는 기존 규칙(소유자/관리자)의 회귀이고,
이 파일은 새로 열린 경로만 본다. 재실행·Studio 편집·PSA 실행 라우트는 여전히 소유자
전용임을 함께 확인한다.
"""
import os
from datetime import datetime

import pytest

from app import models
from app.dependencies import require_auth
from app.main import app
from app.services import project_service


def _act_as(employee_id: str):
    app.dependency_overrides[require_auth] = lambda: employee_id


def _mk_user(db, eid, name="사용자", is_active=True, is_admin=False):
    u = models.User(
        employee_id=eid, name=name, company="HHI", department="구조해석팀",
        is_active=is_active, is_admin=is_admin, is_developer=False,
    )
    db.add(u)
    db.commit()
    return u


def _seed_shared(db, make_analysis, tmp_dir) -> tuple[models.Project, models.Analysis, str]:
    _mk_user(db, "EMP001")
    p = project_service.create_project(db, owner_id="ADMIN001", name="공유")
    project_service.add_member(db, p.id, employee_id="EMP001", role="viewer", added_by="ADMIN001")
    folder = "20260918_090000_ADMIN001_Truss"
    workdir = os.path.join(tmp_dir, folder)
    os.makedirs(workdir, exist_ok=True)
    path = os.path.join(workdir, "input.csv")
    with open(path, "w", encoding="utf-8") as fp:
        fp.write("dummy")
    a = make_analysis("ADMIN001", "Truss Assessment", datetime(2026, 9, 18, 9, 0, 0),
                      status="Success")
    a.project_id = p.id
    a.input_info = {"csv": path}
    a.result_info = {"bdf": path}
    db.commit()
    return p, a, path


def test_viewer_can_get_analysis_by_id(switchable_client, db_session, make_analysis, tmp_path):
    _, a, _ = _seed_shared(db_session, make_analysis, str(tmp_path))
    switchable_client.as_user()
    r = switchable_client.get(f"/api/analysis/{a.id}")
    assert r.status_code == 200 and r.json()["id"] == a.id


def test_non_member_gets_403(switchable_client, db_session, make_analysis, tmp_path):
    _, a, _ = _seed_shared(db_session, make_analysis, str(tmp_path))
    _mk_user(db_session, "STRANGER")
    _act_as("STRANGER")
    r = switchable_client.get(f"/api/analysis/{a.id}")
    assert r.status_code == 403


def test_viewer_can_get_passport(switchable_client, db_session, make_analysis, tmp_path):
    _, a, _ = _seed_shared(db_session, make_analysis, str(tmp_path))
    switchable_client.as_user()
    r = switchable_client.get(f"/api/analysis/{a.id}/passport")
    # passport 는 파일 존재 검사가 있어 200 이 못 될 수도 있지만 최소한 403 이면 안 된다.
    assert r.status_code in (200, 400, 404, 500)


def test_viewer_can_download_shared_file(switchable_client, db_session, make_analysis, tmp_path, monkeypatch):
    """/download 는 path 파라미터. allow_shared=True 로 프로젝트 멤버 통과."""
    import app.routers.analysis as ar
    monkeypatch.setattr(ar, "_ALLOWED_DOWNLOAD_BASE", str(tmp_path))
    _, _, path = _seed_shared(db_session, make_analysis, str(tmp_path))

    switchable_client.as_user()
    r = switchable_client.get(f"/api/download?filepath={path}")
    assert r.status_code == 200
    assert r.content == b"dummy"


def test_viewer_rerun_forbidden(switchable_client, db_session, make_analysis, tmp_path):
    """재실행은 여전히 소유자/관리자 전용(spec §4.2 매트릭스)."""
    _, a, _ = _seed_shared(db_session, make_analysis, str(tmp_path))
    switchable_client.as_user()
    r = switchable_client.post(f"/api/analysis/{a.id}/rerun")
    assert r.status_code == 403


def test_viewer_can_generate_report(switchable_client, db_session, make_analysis, tmp_path, monkeypatch):
    """계산서 생성은 읽기 산출물이라 viewer 통과 (spec §2.1 표 '/reports/generate = assert_can_view')."""
    _, a, _ = _seed_shared(db_session, make_analysis, str(tmp_path))
    # build_report_xlsx 는 프로그램별 어댑터라 프로젝트 스코프 밖 — mock 으로 대체.
    import app.routers.reports as rr
    monkeypatch.setattr(rr, "build_report_xlsx", lambda record, user_connection_base: ("report.xlsx", b"XLSX"))
    switchable_client.as_user()
    r = switchable_client.post("/api/reports/generate", json={"analysis_id": a.id})
    assert r.status_code == 200
    assert r.content == b"XLSX"
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_analysis_shared_access.py -q
```
기대: 대부분 403 으로 실패(공유 규칙 미적용). 전환 후 통과할 것.

- [ ] **Step 3: `analysis.py` 편집**

(a) import 를 확장한다. 78~82행:

```python
from ._access_control import (
    assert_can_view,
    assert_current_user_can_access_job,
    assert_current_user_can_access_owner,
    assert_current_user_can_access_path,
)
```

(b) 789행 `/api/download` 라우트의 `assert_current_user_can_access_path(decoded_path, employee_id, db, _ALLOWED_DOWNLOAD_BASE)` 를:

```python
    assert_current_user_can_access_path(
        decoded_path, employee_id, db, _ALLOWED_DOWNLOAD_BASE, allow_shared=True,
    )
```

(c) 844행 `/api/analysis/export-xlsx` 라우트의 `assert_current_user_can_access_path(decoded_path, employee_id, db, _ALLOWED_DOWNLOAD_BASE)` 를:

```python
    assert_current_user_can_access_path(
        decoded_path, employee_id, db, _ALLOWED_DOWNLOAD_BASE, allow_shared=True,
    )
```

(d) 1655~1665행 `get_analysis_by_id` 의 인라인 소유자 검사를 `assert_can_view` 로 교체:

```python
@router.get("/analysis/{analysis_id}")
def get_analysis_by_id(analysis_id: int, db: Session = Depends(database.get_db), current_user: str = Depends(require_auth)):
    """DB에 저장된 특정 해석 기록을 ID로 조회합니다.

    소유자/관리자 + 프로젝트 멤버(viewer 포함)까지 허용한다(Plan G).
    """
    record = db.query(models.Analysis).filter(models.Analysis.id == analysis_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Analysis record not found")
    assert_can_view(record, current_user, db)
    return _serialize_analysis(record)
```

(e) 1678행 `passport` 라우트의 `assert_current_user_can_access_owner(record.employee_id, current_user, db)` 를:

```python
    assert_can_view(record, current_user, db)
```

- [ ] **Step 4: `reports.py` 편집**

(a) 21행 `from ._access_control import assert_current_user_can_access_owner` 를:

```python
from ._access_control import assert_can_view
```

(b) 79행 `assert_current_user_can_access_owner(record.employee_id, employee_id, db)` 를:

```python
    assert_can_view(record, employee_id, db)
```

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_analysis_shared_access.py tests/test_analysis_access_control.py -q
```
기대: 신규 6건 + 기존 8건 전부 통과.

전체 회귀:
```
WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
기대: 실패 0.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/routers/analysis.py`, `app/routers/reports.py`, `tests/test_analysis_shared_access.py`.

---

### Task 6: `share.received` 알림 — 이미 Task 4 에 심었으므로 검증만

이 Task 는 새 파일을 만들지 않는다. Task 4 의 `_notify()` 래퍼가 이미 §2.1 지연 import 규칙과 `dedupe_key` 를 지키고 있고, `test_projects_router.py` 의 3건이 그 계약을 고정한다:

- `test_add_member_creates_and_notifies` — kind, link.params.project_id, dedupe_key 형태 확인
- `test_add_member_upsert_returns_200_and_does_not_re_notify` — 역할 변경만은 알림 금지
- `test_notify_import_error_is_swallowed` — Plan A 없이도 멤버 추가 성공

- [ ] **Step 1: 회귀 재실행**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_projects_router.py::test_add_member_creates_and_notifies tests/test_projects_router.py::test_add_member_upsert_returns_200_and_does_not_re_notify tests/test_projects_router.py::test_notify_import_error_is_swallowed -q
```
기대: 3 passed.

- [ ] **Step 2: 실행 순서 별개 회귀** — Plan A 뒤에 이 Plan 이 반영되는 경우를 대비해 실제 알림 서비스가 존재하는 시나리오도 흉내내 본다:

```python
# Plan A 가 이미 반영된 로컬 브랜치에서는 아래도 통과해야 한다:
#   pytest tests/test_projects_router.py tests/test_notifications_router.py -q
# Plan A 이전에는 test_notifications_router.py 가 없어서 자연스레 건너뛰어진다.
```

- [ ] **Step 3: 커밋 준비 완료** — 새 파일 없음. Task 4 에서 이미 커밋 대기 목록에 잡혀 있다.

---

### Task 7: `GET /api/users/search` — 멤버 추가용 사용자 검색

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/routers/users.py`(파일 하단에 라우트 추가)
- Create: `HiTessWorkBenchBackEnd/tests/test_users_search.py`

`GET /api/users`(users.py:16)는 `require_admin` 이라 일반 사용자가 멤버 추가 시 상대를 찾을 수 없다. `chat.py get_contacts`(:88)와 같은 필드 화이트리스트 철학으로 별도 창구를 만든다.

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_users_search.py`:

```python
"""GET /api/users/search — 프로젝트 멤버 추가용 검색.

require_admin 이 아니라 require_auth. 최소 2자, 본인 제외, 비활성 사용자 제외.
응답 필드는 화이트리스트(employee_id/name/department/position) — 로그인 통계·이메일 등
관리자 전용 필드 노출 금지.
"""
from app import models
from app.dependencies import require_auth
from app.main import app


def _mk_user(db, eid, name, department="구조해석팀", position="책임연구원",
             is_active=True, is_admin=False):
    u = models.User(
        employee_id=eid, name=name, company="HHI", department=department,
        position=position, is_active=is_active, is_admin=is_admin, is_developer=False,
    )
    db.add(u)
    db.commit()
    return u


def test_search_by_name(switchable_client, db_session):
    _mk_user(db_session, "EMP001", name="김공유")
    _mk_user(db_session, "EMP002", name="이무관")
    r = switchable_client.get("/api/users/search", params={"q": "공유"})
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert set(items[0].keys()) == {"employee_id", "name", "department", "position"}
    assert items[0]["employee_id"] == "EMP001"


def test_search_by_employee_id(switchable_client, db_session):
    _mk_user(db_session, "A123456", name="박찾기")
    r = switchable_client.get("/api/users/search", params={"q": "A123"})
    assert [x["employee_id"] for x in r.json()] == ["A123456"]


def test_search_case_insensitive(switchable_client, db_session):
    _mk_user(db_session, "a477273", name="김소문자")
    r = switchable_client.get("/api/users/search", params={"q": "A477"})
    assert [x["employee_id"] for x in r.json()] == ["a477273"]


def test_search_min_length_422(switchable_client):
    assert switchable_client.get("/api/users/search", params={"q": "김"}).status_code == 422
    assert switchable_client.get("/api/users/search", params={"q": ""}).status_code == 422


def test_search_excludes_self(switchable_client, db_session):
    _mk_user(db_session, "EMP001", name="관리자후보")
    r = switchable_client.get("/api/users/search", params={"q": "관리자"})
    # ADMIN001 은 이미 conftest 시드(이름 '관리자') — 본인이라 결과에서 빠져야 한다.
    eids = {x["employee_id"] for x in r.json()}
    assert "ADMIN001" not in eids


def test_search_excludes_inactive(switchable_client, db_session):
    _mk_user(db_session, "INACTIVE001", name="퇴사김", is_active=False)
    r = switchable_client.get("/api/users/search", params={"q": "퇴사"})
    assert r.json() == []


def test_search_limit_capped(switchable_client, db_session):
    for i in range(30):
        _mk_user(db_session, f"EMP{i:03d}", name=f"김공유{i}")
    r = switchable_client.get("/api/users/search", params={"q": "김공유"})
    assert len(r.json()) == 20    # 상한 20


def test_search_requires_auth(switchable_client):
    saved = app.dependency_overrides.pop(require_auth)
    try:
        assert switchable_client.get("/api/users/search", params={"q": "김"}).status_code == 401
    finally:
        app.dependency_overrides[require_auth] = saved
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_users_search.py -q
```
기대: 전부 404(라우트 미존재).

- [ ] **Step 3: 라우트 추가** — `app/routers/users.py` 파일 끝에 추가(현재 파일 상단의 `from ..dependencies import require_admin` 옆에 `require_auth` 도 import 해야 함):

```python
from ..dependencies import require_admin, require_auth
```

파일 끝(관리자 라우트들 뒤)에:

```python
@router.get("/users/search")
def search_users(
    q: str,
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """멤버 추가용 최소 정보 사용자 검색.

    관리자 전용 GET /api/users 와 분리된 창구다 — 응답 필드는 화이트리스트로 최소화하고
    로그인 횟수·해석 통계·이메일 같은 관리자 전용 정보는 노출하지 않는다. 사번/이름 부분
    일치(대소문자 무시), 본인 제외, 비활성 사용자 제외, 최대 20건.

    q 는 2자 이상. Pydantic 이 아니라 명시적으로 여기서 422 를 낸다(요청 모델을 만들지 않음).
    """
    from fastapi import HTTPException

    needle = (q or "").strip()
    if len(needle) < 2:
        raise HTTPException(status_code=422, detail="검색어는 2자 이상이어야 합니다.")

    lowered = needle.casefold()
    me_lower = (me or "").strip().casefold()

    # SQLite/MySQL 공통 함수만 쓴다 — func.lower + like 로 대소문자 무시.
    from sqlalchemy import func, or_
    rows = (
        db.query(models.User)
        .filter(models.User.is_active.is_(True))
        .filter(or_(
            func.lower(models.User.employee_id).like(f"%{lowered}%"),
            func.lower(models.User.name).like(f"%{lowered}%"),
        ))
        .limit(50)   # 클라이언트 상한 20 보다 넉넉히 뽑아 본인 제외 뒤에도 20이 채워지도록.
        .all()
    )
    items = []
    for u in rows:
        if (u.employee_id or "").casefold() == me_lower:
            continue
        items.append({
            "employee_id": u.employee_id,
            "name": u.name,
            "department": u.department,
            "position": u.position,
        })
        if len(items) >= 20:
            break
    return items
```

- [ ] **Step 4: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_users_search.py -q
```
기대: `8 passed`.

- [ ] **Step 5: 커밋 준비 완료** — 보고: `app/routers/users.py`, `tests/test_users_search.py`.

---

### Task 8: 프론트 API 모듈 `api/projects.js` + `api/userSearch.js`

**Files:**
- Create: `HiTessWorkBench/frontend/src/api/projects.js`
- Create: `HiTessWorkBench/frontend/src/api/userSearch.js`

프론트 페이지에서 axios 를 직접 부르지 않게(§1-10) 도메인별 axios 함수 모듈로 노출한다.

- [ ] **Step 1: `api/projects.js`**

```js
/**
 * 프로젝트·공유(Plan G) 백엔드 창구.
 *
 * 해석 이력 관련 함수는 api/analysis.js 에 있고, 여기는 프로젝트 실체에 관한 것만 둔다.
 * PUT /api/analysis/{id}/project 만 예외적으로 여기 — '프로젝트에 넣기' 액션의 짝이라
 * 사용자 개념적으로 프로젝트 영역이다.
 */
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/** 본인이 소유자 또는 멤버인 프로젝트 목록. */
export const listProjects = () =>
  axios.get(`${API_BASE_URL}/api/projects`, { headers: getAuthHeaders() });

/** 프로젝트 상세(members 포함). */
export const getProject = (projectId) =>
  axios.get(`${API_BASE_URL}/api/projects/${projectId}`, { headers: getAuthHeaders() });

/**
 * 프로젝트 생성.
 * @param {{name: string, description?: string}} body
 */
export const createProject = (body) =>
  axios.post(`${API_BASE_URL}/api/projects`, body, { headers: getAuthHeaders() });

/**
 * 프로젝트 수정(부분 갱신).
 * name/description 미포함 필드는 서버가 그대로 둔다.
 */
export const updateProject = (projectId, body) =>
  axios.put(`${API_BASE_URL}/api/projects/${projectId}`, body, { headers: getAuthHeaders() });

/** 프로젝트 삭제 — 멤버 삭제 + 해석 project_id=NULL 로 분리. */
export const deleteProject = (projectId) =>
  axios.delete(`${API_BASE_URL}/api/projects/${projectId}`, { headers: getAuthHeaders() });

/**
 * 멤버 추가(upsert).
 * @param {number} projectId
 * @param {{employee_id: string, role: 'viewer'|'editor'}} body
 */
export const addProjectMember = (projectId, body) =>
  axios.post(`${API_BASE_URL}/api/projects/${projectId}/members`, body, { headers: getAuthHeaders() });

export const updateProjectMemberRole = (projectId, employeeId, role) =>
  axios.put(
    `${API_BASE_URL}/api/projects/${projectId}/members/${encodeURIComponent(employeeId)}`,
    { role },
    { headers: getAuthHeaders() },
  );

export const removeProjectMember = (projectId, employeeId) =>
  axios.delete(
    `${API_BASE_URL}/api/projects/${projectId}/members/${encodeURIComponent(employeeId)}`,
    { headers: getAuthHeaders() },
  );

/** 프로젝트별 해석 목록(공유 대상). 응답 items 는 _serialize_analysis 형태 + owner_name. */
export const listProjectAnalyses = (projectId) =>
  axios.get(
    `${API_BASE_URL}/api/projects/${projectId}/analyses`,
    { headers: getAuthHeaders() },
  );

/**
 * 해석을 프로젝트에 넣거나 뺀다.
 * @param {number} analysisId
 * @param {number|null} projectId  null 이면 프로젝트에서 뺀다.
 */
export const setAnalysisProject = (analysisId, projectId) =>
  axios.put(
    `${API_BASE_URL}/api/analysis/${analysisId}/project`,
    { project_id: projectId },
    { headers: getAuthHeaders() },
  );
```

- [ ] **Step 2: `api/userSearch.js`**

```js
/**
 * 프로젝트 멤버 추가용 사용자 검색 창구.
 *
 * 관리자 전용 GET /api/users 와 분리된다 — 응답 필드는 백엔드에서 화이트리스트로 최소화.
 * 페이지에서 300ms 디바운스로 호출하고, 2자 미만은 서버가 422 로 거부하므로 호출 자체를 막는다.
 */
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

export const searchUsers = (query) =>
  axios.get(`${API_BASE_URL}/api/users/search`, {
    params: { q: query },
    headers: getAuthHeaders(),
  });
```

- [ ] **Step 3: 빌드 확인** (`C:\Coding\WorkBench\HiTessWorkBench\frontend` 에서)

```
npm run build
```
기대: 오류 없음(모듈이 아직 import 되지 않으므로 tree-shake 되어도 정상).

- [ ] **Step 4: 커밋 준비 완료** — 보고: `frontend/src/api/projects.js`, `frontend/src/api/userSearch.js`. (`config.js` 는 스테이징 금지.)

---

### Task 9: 모달 3개 — `ProjectFormModal` · `ProjectMembersModal` · `AssignProjectModal`

**Files:**
- Create: `HiTessWorkBench/frontend/src/components/analysis/ProjectFormModal.jsx`
- Create: `HiTessWorkBench/frontend/src/components/analysis/ProjectMembersModal.jsx`
- Create: `HiTessWorkBench/frontend/src/components/analysis/AssignProjectModal.jsx`

기존 UI 킷(`Modal`, `Button`, `ConfirmDialog`) 을 그대로 쓴다. 순수 표시/입력만 담당하고 API 호출은 부모(ProjectsTab, MyProjects) 가 넘긴 콜백을 통해 한다 — 재사용성과 테스트 용이성을 위해.

- [ ] **Step 1: `ProjectFormModal`**

`src/components/analysis/ProjectFormModal.jsx`:

```jsx
/**
 * 프로젝트 생성/수정 폼 — 이름(필수, 200자 이내) + 설명(선택).
 *
 * mode: 'create' 는 빈 폼, 'edit' 는 initial 로 프리필. onSubmit(payload) 는 부모가 API 호출.
 * 서버 400/422 는 부모에서 잡아 showToast — 이 컴포넌트는 로컬 유효성(빈 이름·길이)만.
 */
import React, { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

const NAME_MAX = 200;

export default function ProjectFormModal({
  isOpen,
  mode = 'create',      // 'create' | 'edit'
  initial = null,       // { name, description } (edit 모드에서)
  onClose,
  onSubmit,             // async ({name, description}) => void
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setName(initial?.name || '');
    setDescription(initial?.description || '');
    setError('');
  }, [isOpen, initial]);

  const validate = () => {
    const trimmed = name.trim();
    if (!trimmed) return '프로젝트 이름을 입력하세요.';
    if (trimmed.length > NAME_MAX) return `이름은 ${NAME_MAX}자 이내여야 합니다.`;
    return '';
  };

  const handleSubmit = async () => {
    const message = validate();
    if (message) { setError(message); return; }
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), description: description.trim() || null });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'edit' ? '프로젝트 수정' : '새 프로젝트'}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>취소</Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={submitting}>
            {mode === 'edit' ? '저장' : '만들기'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-6">
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1.5">
            프로젝트 이름 <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            maxLength={NAME_MAX}
            placeholder="예: 3496 유닛 권상 구조검토"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-[10px] text-slate-400 text-right">{name.length}/{NAME_MAX}</p>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1.5">설명 (선택)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="이 프로젝트에 어떤 해석이 들어가는지 팀원에게 알려 주세요."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
        </div>
        {error && (
          <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-2">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: `ProjectMembersModal`**

`src/components/analysis/ProjectMembersModal.jsx`:

```jsx
/**
 * 프로젝트 멤버 관리 모달 — 표(이름·사번·부서·역할·제거) + 하단 검색 입력으로 추가.
 *
 * 소유자는 표 최상단에 '소유자' 배지로 고정 표시(제거 불가). 자기 자신이 소유자가 아닌 경우
 * '나가기' 버튼이 자기 행에 뜬다(§4.4 매트릭스).
 *
 * 검색: GET /api/users/search 를 300ms 디바운스로 호출. 2자 미만은 호출하지 않는다.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { UserPlus, X, Users } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { searchUsers } from '../../api/userSearch';

const DEBOUNCE_MS = 300;
const ROLE_LABEL = { viewer: '뷰어', editor: '편집자' };

export default function ProjectMembersModal({
  isOpen,
  project,        // { id, name, owner_id, owner_name, members: [...] }
  currentUserId,  // 로그인 사용자 사번 (자기 자신 표시용)
  isOwner,        // 관리자 or 소유자
  onClose,
  onAdd,          // async ({employee_id, role}) => Member
  onRoleChange,   // async (employee_id, role) => Member
  onRemove,       // async (employee_id) => void
}) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedRole, setSelectedRole] = useState('viewer');
  const [busyEid, setBusyEid] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!isOpen) { setQuery(''); setCandidates([]); setSelectedRole('viewer'); }
  }, [isOpen]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) { setCandidates([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchUsers(trimmed);
        setCandidates(Array.isArray(res.data) ? res.data : []);
      } catch { /* 조용히 무시, 다음 입력에 다시 시도 */ }
      finally { setSearching(false); }
    }, DEBOUNCE_MS);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [query]);

  const existingIds = new Set(
    (project?.members || []).map(m => (m.employee_id || '').toUpperCase())
  );
  if (project) existingIds.add((project.owner_id || '').toUpperCase());

  const filteredCandidates = candidates.filter(
    c => !existingIds.has((c.employee_id || '').toUpperCase())
  );

  const handleAdd = useCallback(async (candidate) => {
    setBusyEid(candidate.employee_id);
    try {
      await onAdd({ employee_id: candidate.employee_id, role: selectedRole });
      setQuery('');
      setCandidates([]);
    } finally { setBusyEid(null); }
  }, [onAdd, selectedRole]);

  if (!project) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`멤버 관리 — ${project.name}`}
      size="lg"
      footer={<Button variant="secondary" onClick={onClose}>닫기</Button>}
    >
      <div className="p-6 space-y-6">
        {/* 멤버 표 */}
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Users size={16} className="text-brand-blue" />
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">현재 멤버</h3>
            <span className="ml-auto text-[10px] font-bold text-slate-400">
              {(project.members || []).length + 1}명 (소유자 포함)
            </span>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">이름</th>
                  <th className="px-4 py-2 text-left font-semibold">사번</th>
                  <th className="px-4 py-2 text-left font-semibold">부서</th>
                  <th className="px-4 py-2 text-left font-semibold">역할</th>
                  <th className="px-4 py-2 text-right font-semibold w-24"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {/* 소유자 행 */}
                <tr className="bg-blue-50/40">
                  <td className="px-4 py-2 font-bold text-slate-800">{project.owner_name || '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-600">{project.owner_id}</td>
                  <td className="px-4 py-2 text-slate-600">{project.department || '—'}</td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">소유자</span>
                  </td>
                  <td className="px-4 py-2"></td>
                </tr>
                {(project.members || []).map(m => {
                  const isMe = (m.employee_id || '').toUpperCase() === (currentUserId || '').toUpperCase();
                  return (
                    <tr key={m.employee_id}>
                      <td className="px-4 py-2 font-semibold text-slate-700">{m.name || '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-600">{m.employee_id}</td>
                      <td className="px-4 py-2 text-slate-600">{m.department || '—'}</td>
                      <td className="px-4 py-2">
                        {isOwner ? (
                          <select
                            value={m.role}
                            onChange={(e) => onRoleChange(m.employee_id, e.target.value)}
                            disabled={busyEid === m.employee_id}
                            className="rounded border border-slate-200 px-2 py-1 text-xs"
                          >
                            <option value="viewer">뷰어</option>
                            <option value="editor">편집자</option>
                          </select>
                        ) : (
                          <span className="text-xs text-slate-600">{ROLE_LABEL[m.role] || m.role}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {(isOwner || isMe) && (
                          <button
                            type="button"
                            onClick={() => onRemove(m.employee_id)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            title={isMe ? '프로젝트에서 나가기' : '멤버 제거'}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* 멤버 추가 — 소유자/관리자만 */}
        {isOwner && (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <UserPlus size={16} className="text-emerald-600" />
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">멤버 추가</h3>
            </div>
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="사번 또는 이름 (2자 이상)"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm cursor-pointer"
              >
                <option value="viewer">뷰어(조회)</option>
                <option value="editor">편집자(옮기기)</option>
              </select>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200">
              {query.trim().length < 2 ? (
                <p className="p-4 text-xs text-slate-400 text-center">2자 이상 입력하면 검색합니다.</p>
              ) : searching ? (
                <p className="p-4 text-xs text-slate-400 text-center">검색 중…</p>
              ) : filteredCandidates.length === 0 ? (
                <p className="p-4 text-xs text-slate-400 text-center">일치하는 사용자가 없습니다.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {filteredCandidates.map(c => (
                    <li key={c.employee_id} className="flex items-center gap-3 px-4 py-2 hover:bg-emerald-50">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{c.name || '—'}</p>
                        <p className="text-[10px] font-mono text-slate-500 truncate">
                          {c.employee_id} · {c.department || '—'} · {c.position || '—'}
                        </p>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleAdd(c)}
                        isLoading={busyEid === c.employee_id}
                      >
                        {ROLE_LABEL[selectedRole]}로 추가
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: `AssignProjectModal`**

`src/components/analysis/AssignProjectModal.jsx`:

```jsx
/**
 * '이 해석을 프로젝트에 넣기' 모달 — 라디오 목록 + '프로젝트에서 빼기'.
 *
 * projects 는 내가 owner/editor 인 프로젝트만 (뷰어인 프로젝트로는 옮길 수 없음, spec §4.4).
 * 현재 배정된 프로젝트가 있으면 그것도 '현재' 배지로 표시.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { FolderKanban, FolderMinus } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

export default function AssignProjectModal({
  isOpen,
  analysis,       // { id, project_name, project_id }
  projects,       // [{ id, name, my_role, ... }]  나의 소속 프로젝트 전체
  onClose,
  onAssign,       // async (projectId: number | null) => void
}) {
  const editable = useMemo(
    () => (projects || []).filter(p => p.my_role === 'owner' || p.my_role === 'editor'),
    [projects],
  );
  const [selected, setSelected] = useState(analysis?.project_id ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) setSelected(analysis?.project_id ?? null);
  }, [isOpen, analysis?.project_id]);

  const handleSubmit = async () => {
    setBusy(true);
    try {
      await onAssign(selected);
    } finally { setBusy(false); }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="프로젝트에 넣기"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>취소</Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={busy}
                  disabled={selected === (analysis?.project_id ?? null)}>
            적용
          </Button>
        </div>
      }
    >
      <div className="p-6 space-y-3">
        <p className="text-xs text-slate-500">
          해석을 프로젝트에 넣으면 그 프로젝트의 뷰어/편집자가 결과를 조회하고 파일을 받을 수 있습니다.
          (재실행·삭제 권한은 여전히 해석 소유자에게만 있습니다.)
        </p>
        <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200">
          <label className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 hover:bg-slate-50 cursor-pointer">
            <input type="radio" checked={selected === null} onChange={() => setSelected(null)} />
            <FolderMinus size={16} className="text-slate-500" />
            <span className="text-sm font-bold text-slate-700">프로젝트에서 빼기</span>
          </label>
          {editable.length === 0 ? (
            <p className="p-6 text-xs text-slate-400 text-center">
              편집 권한이 있는 프로젝트가 없습니다.
              먼저 '프로젝트별' 탭에서 새 프로젝트를 만들어 주세요.
            </p>
          ) : (
            editable.map(p => (
              <label
                key={p.id}
                className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-blue-50/60 cursor-pointer"
              >
                <input
                  type="radio"
                  checked={selected === p.id}
                  onChange={() => setSelected(p.id)}
                />
                <FolderKanban size={16} className="text-blue-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800 truncate">{p.name}</p>
                  <p className="text-[10px] text-slate-500">
                    소유자 {p.owner_name || p.owner_id} · 내 역할 {p.my_role}
                  </p>
                </div>
                {analysis?.project_id === p.id && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                    현재
                  </span>
                )}
              </label>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: 빌드 확인**

```
npm run build
```
기대: 오류 없음.

- [ ] **Step 5: 커밋 준비 완료** — 보고: `frontend/src/components/analysis/ProjectFormModal.jsx`, `frontend/src/components/analysis/ProjectMembersModal.jsx`, `frontend/src/components/analysis/AssignProjectModal.jsx`.

---

### Task 10: `pages/Project/ProjectsTab.jsx` — 프로젝트별 탭 내부 컴포넌트

**Files:**
- Create: `HiTessWorkBench/frontend/src/pages/Project/ProjectsTab.jsx`

이 컴포넌트는 MyProjects 안에서 "프로젝트별" 탭이 활성일 때만 렌더된다. 프로젝트 카드 가로 스크롤 목록 + 선택된 프로젝트의 해석 표를 그린다. 표는 MyProjects 의 표 구조·`PAGE_SIZE=10` 을 그대로 따르되(카피 최소화 위해 여기서는 단순화된 형태로 그리고 Task 11 에서 필요한 자리만 재활용), 행 액션 "프로젝트에 넣기" 는 MyProjects 가 관리하는 `AssignProjectModal` 을 열어야 하므로 props 로 콜백을 받는다.

- [ ] **Step 1: 구현** — `src/pages/Project/ProjectsTab.jsx`:

```jsx
/**
 * MyProjects 안 "프로젝트별" 탭. 프로젝트 카드 목록 + 카드 선택 시 해석 표.
 *
 * - GET /api/projects 로 카드 목록.
 * - 카드 선택 시 GET /api/projects/{id}/analyses 로 해석 목록.
 * - 소유자 카드에는 톱니바퀴(수정)·사람+(멤버)·휴지통 아이콘.
 * - 표 행: 소유자가 내가 아니면 Project Name 아래 'by 홍길동(A123456)' 작은 줄.
 *          재실행 버튼은 내 해석이 아니면 비활성(title 문구).
 *          '프로젝트에 넣기' 버튼은 항상 노출(내 해석이 아니면 서버가 403 을 낸다).
 *
 * 상단 MyProjects 페이지가 관리하는 것:
 *   - AssignProjectModal / ProjectFormModal / ProjectMembersModal / ConfirmDialog
 *   - '내 해석' ↔ '프로젝트별' 탭 상태 (sessionStorage)
 *   - Refresh / 토스트 이벤트
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRight, FolderKanban, FolderPlus, Play, RefreshCw, Settings2,
  Trash2, UserPlus2, Users, Box, PlusCircle,
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { findAppByProgramName, getDisplayProgramName, useGlobalJobs } from '../../contexts/DashboardContext';
import { rerunAnalysisProject } from '../../api/analysis';
import StatusBadge from '../../components/ui/StatusBadge';
import FeedbackState from '../../components/ui/FeedbackState';
import {
  createProject, deleteProject, updateProject,
  addProjectMember, updateProjectMemberRole, removeProjectMember,
  getProject, listProjectAnalyses, listProjects,
} from '../../api/projects';
import ProjectFormModal from '../../components/analysis/ProjectFormModal';
import ProjectMembersModal from '../../components/analysis/ProjectMembersModal';

const supportsProjectRerun = (project) => (
  findAppByProgramName(project?.program_name)?.supportsRerun === true
);

const ROLE_BADGE = {
  owner: { label: '소유자', tone: 'bg-blue-600 text-white' },
  editor: { label: '편집자', tone: 'bg-emerald-600 text-white' },
  viewer: { label: '뷰어', tone: 'bg-slate-500 text-white' },
};

/**
 * @param {{ initialProjectId?: number|null, onOpenAssign: (project)=>void,
 *           onOpenDetail: (project)=>void, refreshCounter?: number }} props
 * initialProjectId — 알림/이벤트로 넘어온 프로젝트를 자동 선택.
 * refreshCounter — MyProjects 헤더의 새로고침 버튼 카운터. 바뀌면 목록을 다시 받는다.
 */
export default function ProjectsTab({ initialProjectId = null, onOpenAssign, onOpenDetail,
                                     refreshCounter = 0 }) {
  const { showToast } = useToast();
  const { employeeId } = useAuth();
  const { startGlobalJob } = useGlobalJobs();

  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(initialProjectId);
  const [detail, setDetail] = useState(null);            // 상세(members 포함)
  const [analyses, setAnalyses] = useState([]);
  const [analysesLoading, setAnalysesLoading] = useState(false);
  const [rerunningIds, setRerunningIds] = useState(() => new Set());

  // 모달
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState('create');
  const [membersOpen, setMembersOpen] = useState(false);

  // ── 프로젝트 목록 로드 ──
  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const res = await listProjects();
      const items = res.data?.items ?? [];
      setProjects(items);
      // 초기 선택
      if (selectedId == null && items.length > 0) setSelectedId(items[0].id);
    } catch (err) {
      showToast('프로젝트 목록을 불러오지 못했습니다.', 'error');
    } finally {
      setProjectsLoading(false);
    }
  }, [selectedId, showToast]);

  useEffect(() => { loadProjects(); }, [refreshCounter]);   // eslint-disable-line

  // ── 상세 + 해석 로드 ──
  const loadSelected = useCallback(async (projectId) => {
    if (!projectId) { setDetail(null); setAnalyses([]); return; }
    setAnalysesLoading(true);
    try {
      const [d, a] = await Promise.all([getProject(projectId), listProjectAnalyses(projectId)]);
      setDetail(d.data || null);
      setAnalyses(a.data?.items ?? []);
    } catch (err) {
      const code = err?.response?.status;
      if (code === 403) showToast('이 프로젝트에 접근할 권한이 없습니다.', 'error');
      else if (code === 404) showToast('프로젝트가 삭제되었거나 존재하지 않습니다.', 'warning');
      else showToast('프로젝트 정보를 불러오지 못했습니다.', 'error');
      setDetail(null); setAnalyses([]);
    } finally {
      setAnalysesLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadSelected(selectedId); }, [selectedId, loadSelected]);

  // ── 액션 ──
  const handleCreate = () => { setFormMode('create'); setFormOpen(true); };
  const handleEdit = () => { setFormMode('edit'); setFormOpen(true); };
  const handleDelete = async () => {
    if (!detail) return;
    if (!window.confirm(
      `'${detail.name}' 프로젝트를 삭제하시겠습니까?\n해석 ${detail.analysis_count}건은 삭제되지 않고 프로젝트에서만 분리됩니다.`,
    )) return;
    try {
      const r = await deleteProject(detail.id);
      showToast(
        `프로젝트를 삭제했습니다. (해석 ${r.data.detached_analyses}건 분리)`,
        'success',
      );
      setSelectedId(null); setDetail(null); setAnalyses([]);
      loadProjects();
    } catch (err) {
      showToast(err?.response?.data?.detail || '프로젝트 삭제에 실패했습니다.', 'error');
    }
  };

  const handleSubmitForm = async (payload) => {
    try {
      if (formMode === 'edit') {
        await updateProject(detail.id, payload);
        showToast('프로젝트를 수정했습니다.', 'success');
      } else {
        const r = await createProject(payload);
        showToast('프로젝트를 만들었습니다.', 'success');
        setSelectedId(r.data.id);
      }
      setFormOpen(false);
      await loadProjects();
      if (formMode === 'edit') await loadSelected(detail.id);
    } catch (err) {
      showToast(err?.response?.data?.detail || '요청에 실패했습니다.', 'error');
    }
  };

  const handleAddMember = async (body) => {
    try {
      await addProjectMember(detail.id, body);
      showToast(`${body.employee_id} 사용자를 추가했습니다.`, 'success');
      await loadSelected(detail.id);
    } catch (err) {
      const code = err?.response?.status;
      const detailMsg = err?.response?.data?.detail;
      if (code === 404) showToast('사용자를 찾을 수 없습니다.', 'error');
      else if (code === 400) showToast(detailMsg || '멤버 추가에 실패했습니다.', 'error');
      else showToast('멤버 추가에 실패했습니다.', 'error');
    }
  };

  const handleRoleChange = async (eid, role) => {
    try {
      await updateProjectMemberRole(detail.id, eid, role);
      await loadSelected(detail.id);
    } catch { showToast('역할 변경에 실패했습니다.', 'error'); }
  };

  const handleRemoveMember = async (eid) => {
    try {
      await removeProjectMember(detail.id, eid);
      await loadSelected(detail.id);
      await loadProjects();
    } catch { showToast('멤버 제거에 실패했습니다.', 'error'); }
  };

  const handleRerun = useCallback(async (project) => {
    if (!project?.id || rerunningIds.has(project.id)) return;
    setRerunningIds(cur => new Set(cur).add(project.id));
    try {
      const response = await rerunAnalysisProject(project.id);
      const jobId = response.data?.job_id;
      if (!jobId) throw new Error('job_id missing');
      const app = findAppByProgramName(project.program_name);
      startGlobalJob(jobId, app?.title || getDisplayProgramName(project.program_name));
      showToast('동일 입력으로 새 해석 작업을 제출했습니다.', 'success');
      window.dispatchEvent(new CustomEvent('workbench:open-job-center'));
    } catch (err) {
      showToast(err?.response?.data?.detail || '재실행 요청에 실패했습니다.', 'error');
    } finally {
      setRerunningIds(cur => {
        const next = new Set(cur); next.delete(project.id); return next;
      });
    }
  }, [rerunningIds, showToast, startGlobalJob]);

  // ── 렌더 ──
  const isOwner = detail && (
    (detail.my_role === 'owner') ||   // 소유자 or 관리자(권한 매트릭스)
    (detail.owner_id || '').toUpperCase() === (employeeId || '').toUpperCase()
  );

  return (
    <div>
      {/* 프로젝트 카드 목록 */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <FolderKanban size={16} className="text-brand-blue" />
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">내가 참여 중인 프로젝트</h3>
          <button
            type="button"
            onClick={handleCreate}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-bold text-white hover:opacity-90"
          >
            <PlusCircle size={14} /> 새 프로젝트
          </button>
        </div>

        {projectsLoading ? (
          <div className="p-6 text-center text-xs text-slate-400">불러오는 중…</div>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <FolderKanban size={28} className="mx-auto text-slate-400" />
            <p className="mt-3 text-sm font-bold text-slate-700">아직 참여 중인 프로젝트가 없습니다.</p>
            <p className="mt-1 text-xs text-slate-500">
              새 프로젝트를 만들거나 동료가 회원님을 프로젝트 멤버로 추가하면 여기에 표시됩니다.
            </p>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {projects.map(p => {
              const active = p.id === selectedId;
              const badge = ROLE_BADGE[p.my_role] || ROLE_BADGE.viewer;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`min-w-[240px] max-w-[280px] shrink-0 rounded-xl border-2 p-3 text-left transition-colors ${
                    active
                      ? 'border-blue-500 bg-blue-50/60 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/30'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <FolderKanban size={14} className="text-blue-500" />
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.tone}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="font-bold text-slate-800 truncate" title={p.name}>{p.name}</p>
                  <p className="mt-0.5 text-[10px] text-slate-500 truncate">
                    소유자 {p.owner_name || p.owner_id}
                  </p>
                  <div className="mt-2 flex items-center gap-3 text-[10px] font-bold text-slate-500">
                    <span className="inline-flex items-center gap-1"><Users size={10} /> {p.member_count + 1}</span>
                    <span className="inline-flex items-center gap-1"><Box size={10} /> {p.analysis_count}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 프로젝트 툴바 + 해석 표 */}
      {detail && (
        <div className="mb-4 flex items-center gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-800">{detail.name}</h2>
            {detail.description && (
              <p className="text-xs text-slate-500 truncate max-w-2xl" title={detail.description}>
                {detail.description}
              </p>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMembersOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
              title="멤버 관리"
            >
              <UserPlus2 size={13} /> 멤버 {detail.members?.length ?? 0}
            </button>
            {isOwner && (
              <>
                <button
                  type="button"
                  onClick={handleEdit}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                  title="프로젝트 수정"
                >
                  <Settings2 size={16} />
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                  title="프로젝트 삭제"
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wider">
                <th className="py-4 px-4 font-semibold w-16 text-center">No.</th>
                <th className="py-4 px-6 font-semibold">Project Name</th>
                <th className="py-4 px-6 font-semibold">App</th>
                <th className="py-4 px-6 font-semibold">Status</th>
                <th className="py-4 px-6 font-semibold text-right">Date</th>
                <th className="py-4 px-4 font-semibold text-center w-32">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {analysesLoading ? (
                <tr><td colSpan="6">
                  <FeedbackState variant="loading" title="Loading Data…"
                                 message="이 프로젝트의 해석을 불러오는 중입니다." />
                </td></tr>
              ) : analyses.length === 0 ? (
                <tr><td colSpan="6">
                  <FeedbackState
                    title={detail ? '이 프로젝트에 담긴 해석이 없습니다.' : '프로젝트를 선택하세요.'}
                    message={detail
                      ? '「내 해석」 탭에서 개별 해석의 상세 모달을 열고 "프로젝트에 넣기" 를 누르세요.'
                      : '카드를 클릭하면 프로젝트의 해석 목록이 표시됩니다.'}
                  />
                </td></tr>
              ) : (
                analyses.map((project, index) => {
                  const isMine = (project.employee_id || '').toUpperCase() === (employeeId || '').toUpperCase();
                  return (
                    <tr key={project.id}
                        onClick={() => onOpenDetail(project)}
                        className="hover:bg-blue-50/50 transition-colors cursor-pointer group">
                      <td className="py-4 px-4 font-mono text-xs text-slate-500 font-bold text-center">{index + 1}</td>
                      <td className="py-4 px-6">
                        <div className="flex items-center">
                          <div className="p-2 bg-slate-100 rounded text-slate-400 mr-3 group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
                            <Box size={18} />
                          </div>
                          <div>
                            <p className="font-bold text-slate-700 text-sm group-hover:text-blue-700 transition-colors">
                              {project.project_name || 'Unnamed Project'}
                            </p>
                            {!isMine && (
                              <p className="text-[10px] text-slate-500">
                                by {project.owner_name || project.employee_id}
                                {project.owner_name ? `(${project.employee_id})` : ''}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-xs font-medium text-slate-600">
                        <span className="inline-block bg-slate-100 px-2 py-1 rounded border border-slate-200 whitespace-nowrap max-w-[220px] truncate align-middle"
                              title={project.program_name}>
                          {getDisplayProgramName(project.program_name)}
                        </span>
                      </td>
                      <td className="py-4 px-6"><StatusBadge status={project.status} /></td>
                      <td className="py-4 px-6 text-xs text-slate-400 text-right font-mono">
                        {new Date(project.created_at).toLocaleString()}
                      </td>
                      <td className="py-4 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleRerun(project); }}
                            disabled={
                              !isMine
                              || rerunningIds.has(project.id)
                              || project.files_available === false
                              || !supportsProjectRerun(project)
                            }
                            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-35"
                            title={
                              !isMine ? '재실행은 해석 소유자만 가능합니다.'
                              : project.files_available === false ? '입력 파일 보관 기간이 만료되었습니다.'
                              : supportsProjectRerun(project) ? '동일 입력으로 다시 실행'
                              : '이 앱은 저장 파일 기반 재실행을 지원하지 않습니다.'
                            }
                          >
                            {rerunningIds.has(project.id)
                              ? <RefreshCw size={16} className="animate-spin" />
                              : <Play size={16} />}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onOpenAssign(project); }}
                            disabled={!isMine}
                            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-35"
                            title={isMine ? '이 해석을 다른 프로젝트로 이동/제거' : '해석 소유자만 이동할 수 있습니다.'}
                          >
                            <FolderPlus size={16} />
                          </button>
                          <button
                            type="button"
                            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-blue-600"
                            title="프로젝트 상세"
                          >
                            <ChevronRight size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 모달 */}
      <ProjectFormModal
        isOpen={formOpen}
        mode={formMode}
        initial={formMode === 'edit' ? { name: detail?.name, description: detail?.description } : null}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmitForm}
      />
      <ProjectMembersModal
        isOpen={membersOpen}
        project={detail}
        currentUserId={employeeId}
        isOwner={isOwner}
        onClose={() => setMembersOpen(false)}
        onAdd={handleAddMember}
        onRoleChange={handleRoleChange}
        onRemove={handleRemoveMember}
      />
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

```
npm run build
```
기대: 오류 없음.

- [ ] **Step 3: 커밋 준비 완료** — 보고: `frontend/src/pages/Project/ProjectsTab.jsx`.

---

### Task 11: `MyProjects.jsx` — 상단 탭 + 상세 모달 footer 버튼 + 프로젝트 태그 + `AssignProjectModal`

**Files:**
- Modify: `HiTessWorkBench/frontend/src/pages/analysis/MyProjects.jsx`

MyProjects 를 **최소 침습**으로 고친다. 통계 카드/검색/필터/표 자체는 그대로 두고, 상단에 탭을 얹어 활성 탭이 "프로젝트별" 이면 기존 화면을 감추고 `ProjectsTab` 을 렌더한다. 추가로 상세 모달 footer 에 "프로젝트에 넣기" 버튼을 넣고, 표 행의 Project Name 아래 프로젝트 배지를 붙인다.

- [ ] **Step 1: import 확장** — 파일 최상단(1~26행)에서 다음을 추가/교체:

(a) `lucide-react` 아이콘 import 에 `FolderKanban, FolderPlus, LayoutList` 추가:

```js
import {
  Search, Filter, Download, RefreshCw,
  ChevronRight, ChevronLeft, Box,
  CheckCircle2,
  FileCode, Database, FileOutput, Eye, FileX,
  TrendingUp, CalendarClock, Award, BarChart3, Minus,
  GitCompare, Play, Square, CheckSquare, Fingerprint,
  Clock3, ListChecks, Pipette, Terminal,
  FolderKanban, FolderPlus, LayoutList,
} from 'lucide-react';
```

(b) 로컬 import 블록에 다음 4줄을 이미 있는 import 들 뒤에 추가:

```js
import AssignProjectModal from '../../components/analysis/AssignProjectModal';
import ProjectsTab from '../Project/ProjectsTab';
import { listProjects, setAnalysisProject } from '../../api/projects';
```

- [ ] **Step 2: 상세 모달 footer 확장** — `ProjectDetailModal`(264~527행)의 `Modal` prop `footer`(370~374행)를 다음으로 교체(`onOpenAssign` prop 추가):

```jsx
const ProjectDetailModal = ({ project, onClose, onOpen3D, onOpenAssign }) => {
  // ... 기존 로컬 상태 그대로 ...
```

그리고 Modal 의 `footer` 를:

```jsx
      footer={
        <div className="flex justify-end gap-2">
          {onOpenAssign && (
            <Button variant="secondary" size="md" onClick={() => onOpenAssign(project)}>
              <FolderPlus size={14} className="mr-1.5" />
              프로젝트에 넣기
            </Button>
          )}
          <Button variant="secondary" size="md" onClick={onClose}>닫기</Button>
        </div>
      }
```

- [ ] **Step 3: 메인 컴포넌트에 탭 상태 추가** — `export default function MyProjects()` 안(660~672행 근처의 useState 그룹 끝)에:

```jsx
  // Plan G — 상단 탭 상태. sessionStorage 로 알림 센터·대시보드 진입점과 통신.
  //   'analyses'  = 내 해석(기존 화면, 기본)
  //   'projects'  = 프로젝트별 화면(ProjectsTab)
  const [activeTab, setActiveTab] = useState('analyses');
  const [pendingProjectId, setPendingProjectId] = useState(null);
  const [projectMap, setProjectMap] = useState(new Map());
  const [assignTarget, setAssignTarget] = useState(null);
  const [assignProjectsCache, setAssignProjectsCache] = useState([]);
  const [refreshCounter, setRefreshCounter] = useState(0);
```

- [ ] **Step 4: sessionStorage/이벤트 훅** — 673~686행 `useEffect` 뒤에 두 개 더 추가:

```jsx
  // Plan G — 알림 센터가 send 한 프로젝트 자동 오픈.
  //   sessionStorage('workbench:open-project-tab') = { project_id: N }
  useEffect(() => {
    const consume = () => {
      try {
        const raw = sessionStorage.getItem('workbench:open-project-tab');
        if (!raw) return;
        sessionStorage.removeItem('workbench:open-project-tab');
        const data = JSON.parse(raw);
        const pid = Number(data?.project_id);
        if (Number.isInteger(pid) && pid > 0) {
          setActiveTab('projects');
          setPendingProjectId(pid);
        }
      } catch { /* ignore */ }
    };
    consume();
    window.addEventListener('workbench:open-project-tab', consume);
    return () => window.removeEventListener('workbench:open-project-tab', consume);
  }, []);

  // '내 해석' 표에 프로젝트 배지를 붙이기 위해 프로젝트 목록을 1회 받아 Map 으로 캐시.
  //   재요청은 refreshCounter 로 트리거.
  useEffect(() => {
    let alive = true;
    listProjects().then(res => {
      if (!alive) return;
      const items = res.data?.items ?? [];
      setAssignProjectsCache(items);
      setProjectMap(new Map(items.map(p => [p.id, p])));
    }).catch(() => { /* 비로그인/네트워크 오류는 조용히 */ });
    return () => { alive = false; };
  }, [refreshCounter]);
```

- [ ] **Step 5: 탭 UI 삽입** — 반환하는 JSX 의 `PageHeader`(823~828행) 바로 다음에 탭 바를 붙이고, 활성 탭이 'analyses' 인 부분을 `{activeTab === 'analyses' && (...)}` 로 감싼다:

```jsx
      <PageHeader
        title="My Projects"
        icon={Database}
        subtitle="구조 해석 수행 이력 및 결과 파일을 관리합니다."
        accentColor="blue"
      />

      {/* Plan G — 상단 탭 */}
      <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {[
          { key: 'analyses', label: '내 해석', icon: LayoutList },
          { key: 'projects', label: '프로젝트별', icon: FolderKanban },
        ].map(({ key, label, icon: Icon }) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
                active ? 'bg-brand-blue text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          );
        })}
      </div>

      {activeTab === 'projects' ? (
        <ProjectsTab
          initialProjectId={pendingProjectId}
          refreshCounter={refreshCounter}
          onOpenAssign={(p) => setAssignTarget(p)}
          onOpenDetail={(p) => setSelectedProject(p)}
        />
      ) : (
        <>
```

그리고 페이지네이션 끝(현재 1251행 `)}` 다음)에 fragment 를 닫는다:

```jsx
        </>
      )}

      {/* 상세/뷰어/비교 모달 — 두 탭에서 공유 */}
```

- [ ] **Step 6: 상세 모달 호출부에 `onOpenAssign` 넘기기** — 1253~1266행의 `ProjectDetailModal` 렌더링에 prop 추가:

```jsx
      {selectedProject?.program_name === 'Truss Assessment' ? (
        <AssessmentProjectModal
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onViewResultModel={() => setIsResultViewerOpen(true)}
        />
      ) : (
        <ProjectDetailModal
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onOpen3D={() => setIs3DViewerOpen(true)}
          onOpenAssign={(p) => {
            setSelectedProject(null);
            setAssignTarget(p);
          }}
        />
      )}
```

- [ ] **Step 7: `AssignProjectModal` 마운트** — `ProjectCompareModal` 아래에 한 개 더:

```jsx
      <ProjectCompareModal
        projects={isCompareOpen ? compareProjects : []}
        onClose={() => setIsCompareOpen(false)}
      />

      <AssignProjectModal
        isOpen={!!assignTarget}
        analysis={assignTarget}
        projects={assignProjectsCache}
        onClose={() => setAssignTarget(null)}
        onAssign={async (projectId) => {
          try {
            await setAnalysisProject(assignTarget.id, projectId);
            showToast(
              projectId == null ? '프로젝트에서 뺐습니다.' : '프로젝트에 배정했습니다.',
              'success',
            );
            setAssignTarget(null);
            setRefreshCounter(c => c + 1);
            fetchHistory();
          } catch (err) {
            showToast(err?.response?.data?.detail || '프로젝트 배정에 실패했습니다.', 'error');
          }
        }}
      />
```

- [ ] **Step 8: 표 행에 프로젝트 배지 + "프로젝트에 넣기" 액션** — 1123~1136행의 `<td>` (Project Name / Actions) 를 수정:

Project Name 셀:

```jsx
                    <td className="py-4 px-6">
                      <div className="flex items-center">
                        <div className="p-2 bg-slate-100 rounded text-slate-400 mr-3 group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors"><Box size={18} /></div>
                        <div>
                          <p className="font-bold text-slate-700 text-sm group-hover:text-blue-700 transition-colors">
                            {project.project_name || 'Unnamed Project'}
                          </p>
                          {project.project_id && projectMap.get(project.project_id) && (
                            <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold text-blue-700">
                              <FolderKanban size={10} />
                              <span className="truncate max-w-[220px]" title={projectMap.get(project.project_id).name}>
                                {projectMap.get(project.project_id).name}
                              </span>
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
```

Actions 셀(1136~1172행) 의 `<div className="flex items-center justify-center gap-1">` 안에서 재실행 버튼과 상세 버튼 사이에 "프로젝트에 넣기" 버튼을 추가:

```jsx
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setAssignTarget(project);
                          }}
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-700"
                          title="프로젝트에 넣기"
                          aria-label={`${project.project_name} 프로젝트에 넣기`}
                        >
                          <FolderPlus size={16} />
                        </button>
```

- [ ] **Step 9: Refresh 버튼에 프로젝트 캐시 재요청 훅** — 1048~1050행의 "Refresh" 버튼 `onClick={() => fetchHistory()}` 를:

```jsx
        <button onClick={() => { fetchHistory(); setRefreshCounter(c => c + 1); }} ...>
```

- [ ] **Step 10: 빌드**

```
npm run build
```
기대: 오류 없음.

- [ ] **Step 11: 수동 검증 1(내 해석 탭)** — 백엔드(`uvicorn app.main:app --host 0.0.0.0 --port 9091 --reload`) + `npm run dev`:

1. 로그인 → My Projects 진입. 상단에 **"내 해석 | 프로젝트별"** 탭 2 개, 기본 "내 해석"(파란 배경).
2. 통계/검색/표가 이전과 동일하게 표시된다.
3. 어떤 행에도 `project_id` 가 없으면 배지 없음 — 정상.
4. 표 행 Actions 열에 재실행·**폴더+**(프로젝트에 넣기)·상세 3 개 아이콘.
5. 폴더+ 클릭 → `AssignProjectModal` 오픈. 프로젝트가 하나도 없으면 "편집 권한이 있는 프로젝트가 없습니다." 안내.

- [ ] **Step 12: 수동 검증 2(프로젝트 만들기 + 배정)** —
1. 탭을 **"프로젝트별"** 로 전환 → 빈 상태 카드 + "새 프로젝트" 버튼. 클릭 → `ProjectFormModal`.
2. 이름 "3496 유닛 권상" + 설명 입력 → 만들기. 카드가 뜨고 자동 선택.
3. 자기 이름의 해석이 없으므로 표는 비어 있음. "내 해석" 탭으로 돌아가 성공한 해석 하나의 폴더+ 클릭 → 방금 만든 프로젝트 선택 → 적용.
4. 초록 토스트 "프로젝트에 배정했습니다." + 그 행의 Project Name 아래 **파란 폴더 배지**.
5. "프로젝트별" 탭 → 카드 카운트 1, 표에 해당 해석 노출.

- [ ] **Step 13: 수동 검증 3(멤버 초대·공유)** — 두 번째 계정으로 재로그인 흐름.
1. 프로젝트 툴바의 **멤버 N** 버튼 → `ProjectMembersModal` → 검색창에 다른 사번 2자 이상 입력 → 후보 클릭 → "뷰어로 추가".
2. Windows 계정 전환 또는 다른 브라우저에서 그 사번으로 로그인 → My Projects "프로젝트별" 탭 → 상대 프로젝트 카드가 보인다. 표에서 해석 행 → 상세 모달 → 파일 다운로드 성공.
3. 그 뷰어가 표에서 재실행 버튼을 누르면 비활성(hover title "재실행은 해석 소유자만 가능합니다.").
4. 뷰어가 폴더+ 도 비활성 — 소유자만 배정 변경 가능.
5. 원래 소유자로 돌아와 프로젝트 툴바의 **휴지통** → 확인 → 해석은 남고 `project_id` 만 NULL 이 된 것을 "내 해석" 탭에서 확인(배지 사라짐).

- [ ] **Step 14: 커밋 준비 완료** — 보고: `frontend/src/pages/analysis/MyProjects.jsx`. (`config.js` 는 스테이징 금지.)

---

### Task 12: 최종 점검 + 서버(145) 반영 안내

- [ ] **Step 1: 백엔드 전체 회귀**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
기대: 실패 0. 신규 파일 6개(`test_projects_schema`, `test_access_control_projects`, `test_project_service`, `test_projects_router`, `test_users_search`, `test_analysis_shared_access`) 합계 대략 **72건** 통과(7 + 15 + 14 + 21 + 8 + 6, 실제 카운트는 실행 결과에 맞춘다).

- [ ] **Step 2: 프론트 빌드**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && npm run build
```
기대: 오류 없음.

- [ ] **Step 3: 스테이징 점검** — `git status` 에서 `HiTessWorkBench/frontend/src/config.js` 가 변경돼 있으면 **스테이징하지 않는다**(로컬 백엔드 토글). `Darkmode.js/` 미포함 확인.

- [ ] **Step 4: 사용자 보고(커밋은 사용자가 직접)** — 변경 파일 전체 목록(파일 구조 표) + 아래 서버 반영 구분을 그대로 전달.

**서버(145) 반영:**
- **백엔드 — `git pull` + 백엔드 재시작으로 끝.** `projects`·`project_members` 테이블은 기동 시 `create_all`, `analysis.project_id` 컬럼/인덱스는 `run_schema_bootstrap`(`ensure_analysis_project_columns`)이 자동 보강한다. 신규 pip 의존성 없음(`requirements.txt` 변경 없음).
- **프론트 — 재배포 필요.** WorkBench 포터블 exe 를 `npm run dist` 로 다시 빌드해 배포(탭 UI·프로젝트 모달·API 모듈).
- **InHouse 프로그램 — 없음.** `InHouseProgram/` 수동 교체 대상 없음. Studio zip 도 변경 없음.

---

## 자기 검토

- **spec 커버리지**: §2.1 접근 제어 현황·확장(Task 2·5) · §2.2 모델(Task 1) · §2.3 프론트 진입점(Task 11) · §3 목표(공유·`can_view`/`can_edit`·MyProjects 안에서 끝) · §3 비목표(개별 링크 공유·부서 자동 공유·중첩·프로젝트 단위 재실행·Studio 세션 라우트 개방·`project_name` 마이그레이션 은 만들지 않는다) · §4.1 데이터 모델·bootstrap(Task 1) · §4.2 권한 매트릭스(Task 2 함수·Task 4 라우터 매트릭스 검증) · §4.3 `_access_control` 확장 계약(Task 2 시그니처 그대로) · §4.4 API 9종+`GET /users/search`(Task 4·7) · §4.5 알림(Task 4 `_notify`·§2.1 지연 import) · §4.6 사용자 검색 창구 분리(Task 7) · §4.7 프론트 MyProjects 안 완결(Task 8~11) · §5 데이터 흐름(Task 5 다운로드 경로·Task 11 배정 흐름) · §6 테스트 5파일 전부(Task 1·2·3·4·7·5) · §7 서버 반영(Task 12) · §8 리스크 4건(LIKE 좁히기·삭제 문구·계약·casefold).
- **플레이스홀더 없음**: 모든 코드 step 이 실제 코드다. 프론트는 러너가 없어 수동 절차를 단계·기대 동작으로 적었다.
- **타입/이름 일관성**: `can_view(analysis, user, db)` / `can_edit(analysis, user, db)` 는 마스터 §2.7 시그니처(그리고 `can_view_analysis`·`can_edit_analysis` alias). `project_role(db, project_id, user) -> 'owner'|'editor'|'viewer'|None`. `PROJECT_ROLES = ('viewer','editor')` — 소유자는 members 에 없으므로 여기 없다. 라우터 응답 `Member` 키(`employee_id,name,department,role,added_by,added_at`) = 서비스 `list_members` 결과 = 프론트 `ProjectMembersModal` 표 열. `ProjectSummary` 필드 = 서비스 `serialize_project` 딕셔너리 = `ProjectsTab` 카드가 읽는 이름(`id,name,description,department,owner_id,owner_name,my_role,member_count,analysis_count,created_at,updated_at`). `link.params.project_id` + `sessionStorage('workbench:open-project-tab')` = 알림 센터가 사용할 링크 규약(§4.5). `POST /projects/{id}/members` 는 신규 201·역할 변경 200 + `share.received` 는 신규 때만.
- **의존 순서**: Task 2(`can_view/edit`) 를 Task 3·4·5 가 쓴다. Task 3(`project_service`) 를 Task 4(라우터) 가 쓴다. Task 7(사용자 검색) 은 프론트 Task 9(멤버 모달) 가 쓴다. Task 8(API 모듈) 은 Task 10·11(페이지) 가 쓴다. Task 6(알림) 은 Task 4 에 이미 심어 두었고 별개 검증만.
- **하위호환**: `_access_control.py` 의 기존 5개 함수 시그니처는 그대로. 8개 파일의 relative import 는 재실행·Studio 편집 등 27+ 곳에서 아직 그대로 쓰이므로 이번 Plan 은 2개(analysis·reports) 만 편집한다. 기존 테스트 `tests/test_analysis_access_control.py` 8건은 변경 없이 통과해야 한다(Task 2 Step 4·Task 5 Step 5 에서 회귀).
- **Plan A 독립성**: `_notify` 는 지연 import + ImportError/Exception 흡수. Plan A 없이도 Task 4 회귀가 통과함을 `test_notify_import_error_is_swallowed` 가 고정한다.

