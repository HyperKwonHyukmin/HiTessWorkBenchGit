# Plan G — 프로젝트 개념 + 멤버십 기반 공유 설계

- 작성일: 2026-09-18
- 상위 규약: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1(공통 규칙) · §2.1(알림 지연 import) · **§2.7(이 문서의 담당)** · §3(실행 순서 6번, A 선택 의존). 충돌 시 상위 규약이 우선한다.
- 대상: `HiTessWorkBenchBackEnd/`(FastAPI) + `HiTessWorkBench/frontend/`(React). InHouse 프로그램은 건드리지 않는다.
- 산출 plan: `docs/superpowers/plans/2026-09-18-projects-and-sharing.md`

## 1. 배경 / 문제

WorkBench 의 해석 이력(`analysis` 테이블)은 **사번 단위로 완전히 격리**돼 있다. 접근 제어는
`app/routers/_access_control.py` 의 "소유자 본인 or `is_admin`" 한 가지 규칙뿐이라, 같은 과제를
맡은 동료가 결과를 보려면 관리자 계정을 빌리거나 파일을 메신저로 옮겨야 한다.

`Analysis.project_name` 은 이미 있지만 **자유 문자열 라벨**이라 그룹핑·공유의 근거가 될 수 없다
(같은 이름을 서로 다른 사용자가 자유롭게 쓴다).

이 plan 은 **프로젝트(실체)** 를 만들고, 해석을 프로젝트에 넣고, 프로젝트 **멤버십 하나로만** 공유를
연다. 다른 plan(F 결과 비교, J 전역 검색)이 "누가 이 해석을 볼 수 있나"를 묻는 단일 함수
`can_view` / `can_edit` 를 여기서 제공한다.

## 2. 현재 코드 실측 (2026-09-18)

### 2.1 접근 제어 헬퍼 — `app/routers/_access_control.py` (86행)

| 행 | 이름 | 시그니처 | 규칙 |
|---|---|---|---|
| 14 | `WORK_FOLDER_RE` | `^\d{8}_\d{6}_(?P<employee_id>[^_]+)_.+$` | 작업 폴더명에서 사번 추출 |
| 17 | `owner_from_userconnection_path(path, user_connection_base) -> str \| None` | 경로 첫 세그먼트의 소유자 |
| 30 | `is_admin_user(db, employee_id) -> bool` | `User.is_admin` |
| 35 | `assert_current_user_can_access_owner(owner_id, current_user, db, *, allow_unowned=False)` | 소유자(casefold 비교) or 관리자, 아니면 403 |
| 61 | `assert_current_user_can_access_path(path, current_user, db, user_connection_base, *, allow_unowned=False)` | 경로 소유자에 위 규칙 적용 |
| 77 | `assert_current_user_can_access_job(job_id, current_user, db, status=None)` | `Analysis.job_id` 소유자 → 메모리 status 순 |

**호출처 전수(grep `_access_control`)** — 어떤 라우트가 소유자 검사를 쓰는지:

| 파일 | 라우트 | 사용 함수 | Plan G 후 |
|---|---|---|---|
| `routers/analysis.py:782` | `GET /api/download` | `..._path` (789행) | **`allow_shared=True` 추가** — 멤버 다운로드 허용 |
| `routers/analysis.py:831` | `GET /api/analysis/export-xlsx` | `..._path` (844행) | **`allow_shared=True` 추가** |
| `routers/analysis.py:1655` | `GET /api/analysis/{id}` | 헬퍼 미사용, **인라인** `record.employee_id != current_user` + `is_admin` (1659~1662행) | **`assert_can_view` 로 교체** |
| `routers/analysis.py:1668` | `GET /api/analysis/{id}/passport` | `..._owner` (1678행) | **`assert_can_view` 로 교체** |
| `routers/analysis.py:1981` | `POST /api/analysis/{id}/rerun` | `..._owner` (1995행) | 유지 — 재실행은 소유자/관리자만 |
| `routers/analysis.py:2157` | `GET /api/analysis/status/{job_id}` | `..._job` (2164행) | 유지 |
| `routers/analysis.py` 1295·1416·1423·1588·1597·2556·2573·2626·2665·2859·2901·2910·2963·2974·3029·3048·3600·3757·3867·3967·4229·4314·4798·4851·4935·4961·5009 | Studio 편집/해석/zip 등 경로 기반 라우트 | `..._path` / `..._owner` | 유지(소유자 전용). 쓰기 동작이거나 Studio 세션에 묶여 있다 |
| `routers/reports.py:68` | `POST /api/reports/generate` | `..._owner` (79행) | **`assert_can_view` 로 교체** — 계산서는 읽기 산출물 |
| `routers/doublepipe.py` 102·133·187·233·256·268·287·314 | 이중관 PSA 실행/상태/취소 | `..._path`/`..._owner`/`is_admin_user` | 유지 |
| `routers/hitessbeam.py` 286·444 | 레거시 다운로드 | `..._path` | 유지 |
| `routers/module_ocean_transport.py` 158·438·549·579·596·649 | 해상운송 | `..._path`/`..._owner` | 유지 |
| `routers/model_registry.py:520`, `services/model_registry_service.py:315·321` | 모델 레지스트리 | `is_admin_user` | 유지 |
| `services/analysis_passport.py:247` | 패스포트 경로 소유자 | `owner_from_userconnection_path` | 유지 |
| `tests/test_analysis_access_control.py` | 기존 8건 | 위 함수 전부 | **변경 없이 통과해야 함** |

`GET /api/analysis/history/{employee_id}`(654행)는 `_verify_employee_self` 로 **본인 사번만** 허용하고
`Analysis.employee_id == employee_id` 로 필터한다 — 공유 해석은 여기 섞이지 않는다(§4.4 결정).

### 2.2 모델 · 스키마

- `app/models.py:78-94 Analysis` — `project_name String(200) nullable`(82행) 은 자유 라벨. `project_id` 없음.
- `app/models.py:20-35 User` — `employee_id`, `name`, `department`(26행), `position`, `is_active`, `is_admin`.
- `app/schema_bootstrap.py` — `_add_missing_columns`(8행)/`_add_missing_indexes`(33행) 헬퍼, `run_schema_bootstrap()`(152행)에서 `ensure_*` 7개 호출. 신규 테이블은 `create_all`, 기존 테이블의 신규 컬럼은 반드시 여기(상위 규약 §1-3).
- `app/main.py:188-212` `include_router` 25개. `app/dependencies.py` `require_auth`(7행) / `require_admin`(34행).
- `app/routers/users.py:16 GET /api/users` 는 **`require_admin`** — 일반 사용자가 멤버 추가 시 사번/이름을 찾을 창구가 없다(§4.6).
- 알림 서비스 `app/services/notification_service.py` 는 **아직 없다**(Plan A 미실행) → 지연 import 필수.
- `tests/conftest.py` fixture: `db_session`(SQLite 메모리), `admin_client`(ADMIN001), `switchable_client`(ADMIN001 ↔ EMP001, `as_admin()/as_user()`), `make_analysis`, `make_user`.

### 2.3 프론트

- `pages/analysis/MyProjects.jsx`(1,296행) — 상태 650~671행, 대시보드→상세 모달 `sessionStorage('workbench:open-project-detail')` 675~686행, `fetchHistory` 688~716행(`getAnalysisHistory` 호출), 통계 카드 842행~, 검색/필터 1016~1073행, 표 1075~1175행(열: Compare·No.·Project Name·App·Status·Files·Date·Actions), `ProjectDetailModal` 264~527행(footer 365~374행 "닫기" 만), 모달 배치 1253~1296행.
- `src/api/analysis.js` — `getAnalysisHistory`(18행), `downloadFileBlob`(246행, `GET /api/download?filepath=`).
- `contexts/AuthContext.jsx` — `useAuth()` → `{ user, employeeId, isAdmin, ... }`.
- UI 킷: `Modal({isOpen,onClose,title,size,footer,headerActions})`, `FilterTabs({categories,active,onChange,rightSlot,counts})`, `Input({label,error,leftIcon,size,...rest})`, `Button({variant,size,isLoading,disabled})`, `ConfirmDialog({isOpen,onCancel,onConfirm,title,message,confirmLabel,variant})`.

## 3. 목표 / 비목표

**목표**
1. 사용자가 프로젝트를 만들고 동료를 viewer/editor 로 넣으면, 그 프로젝트에 속한 해석을 동료가 **조회·다운로드**할 수 있다.
2. `can_view(analysis, user, db)` / `can_edit(analysis, user, db)` 를 제공하고, 기존 함수명은 그대로 동작한다.
3. `MyProjects` 안에서 끝난다 — 새 페이지 없음.

**비목표(YAGNI, 상위 규약 §2.7)**
- 개별 해석 링크 공유, 부서 전체 자동 공유, 공개 프로젝트, 프로젝트 중첩, 프로젝트별 권한 세분화(파일 단위).
- 프로젝트 단위 일괄 삭제·재실행. 삭제·재실행은 계속 **해석 소유자/관리자만**.
- Studio 세션 라우트(viewer-zip·apply-edit·solve 등)의 공유 개방 — 편집·해석 실행이 얽혀 있어 이번 범위 밖.
- `Analysis.project_name` 마이그레이션 — 표시용 라벨로 그대로 둔다.

## 4. 확정 결정

### 4.1 데이터 모델

```python
class Project(Base):
    __tablename__ = "projects"
    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String(200), nullable=False)
    owner_id    = Column(String(50), index=True, nullable=False)   # 사번
    department  = Column(String(100), nullable=True)               # 생성 시 User.department 스냅샷(표시용)
    description = Column(Text, nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), nullable=True)

class ProjectMember(Base):
    __tablename__ = "project_members"
    project_id  = Column(Integer, primary_key=True)                # non-FK (삭제는 서비스가 명시적으로)
    employee_id = Column(String(50), primary_key=True)
    role        = Column(String(20), nullable=False, default="viewer")   # 'viewer' | 'editor'
    added_by    = Column(String(50), nullable=True)
    added_at    = Column(DateTime(timezone=True), server_default=func.now())

# Analysis 에 추가
    project_id  = Column(Integer, nullable=True, index=True)       # non-FK. project_name 은 유지(표시용)
```

- **소유자는 `project_members` 에 넣지 않는다.** 역할 판정 함수가 `owner_id` 를 먼저 본다. (소유자 행을 넣으면 "소유자를 멤버에서 제거" 같은 모순 상태가 생긴다.)
- 사번 비교는 전부 **대소문자 무시**(`_norm_eid` 와 같은 upper/casefold). DB 에 `a477273` 과 `A477273` 이 섞여 있다(users.py:24 주석).
- 스키마 bootstrap: `ensure_analysis_project_columns()` → `ALTER TABLE analysis ADD COLUMN project_id INT NULL` + `CREATE INDEX ix_analysis_project_id`. `projects`/`project_members` 는 `create_all` 로 생긴다.

### 4.2 권한 매트릭스

| 행위 | 해석 소유자 | 관리자 | 프로젝트 소유자 | editor | viewer | 비멤버 |
|---|---|---|---|---|---|---|
| 해석 조회(`GET /analysis/{id}`, passport, 계산서 생성) | O | O | O | O | O | X |
| 결과 파일 다운로드(`/download`, `/export-xlsx`) | O | O | O | O | O | X |
| 해석을 프로젝트에 넣기/빼기(`PUT /analysis/{id}/project`) | O(넣을 프로젝트의 owner/editor 여야 함) | O | O | O | X | X |
| 해석 재실행 / (향후) 삭제 | O | O | X | X | X | X |
| 프로젝트 이름·설명 수정, 삭제 | — | O | O | X | X | X |
| 멤버 추가·역할 변경·제거 | — | O | O | X | X | X |
| 멤버 본인 나가기(`DELETE .../members/{me}`) | — | — | — | O | O | — |
| 프로젝트 목록에 보임(`GET /projects`) | — | 본인 소유/멤버분만(관리자도 전체 목록은 안 본다) | O | O | O | X |

함수로 환원하면:

```python
role = project_role(db, analysis.project_id, user)   # 'owner' | 'editor' | 'viewer' | None
can_view(analysis, user, db) = is_owner(analysis, user) or is_admin(user) or role is not None
can_edit(analysis, user, db) = is_owner(analysis, user) or is_admin(user) or role in ('owner', 'editor')
```

`can_edit` 는 "프로젝트에서 빼기/옮기기" 같은 **메타 수정** 권한이다. 재실행·삭제는 이 함수를 쓰지 않고 기존
`assert_current_user_can_access_owner` 를 그대로 쓴다(그래서 기존 함수가 alias 가 아니라 **현역**으로 남는다).

### 4.3 `_access_control.py` 확장 — 다른 plan 이 호출하는 계약

```python
# app/routers/_access_control.py  (경로 주의: services/ 가 아니라 routers/)
PROJECT_ROLE_VIEWER = "viewer"; PROJECT_ROLE_EDITOR = "editor"; PROJECT_ROLES = (…)

def project_role(db, project_id: int | None, user: "str | models.User") -> str | None
def can_view(analysis: models.Analysis, user: "str | models.User", db: Session) -> bool
def can_edit(analysis: models.Analysis, user: "str | models.User", db: Session) -> bool
def assert_can_view(analysis, user, db) -> None    # 403 "접근 권한이 없는 해석 기록입니다."
def assert_can_edit(analysis, user, db) -> None    # 403 "이 해석을 수정할 권한이 없습니다."
def find_analysis_for_path(db, path: str, user_connection_base: str) -> models.Analysis | None
def assert_current_user_can_access_path(path, current_user, db, user_connection_base, *,
                                        allow_unowned=False, allow_shared=False) -> None   # 키워드 추가만
# 하위호환 — 기존 이름·시그니처 전부 무변경:
#   owner_from_userconnection_path, is_admin_user, assert_current_user_can_access_owner,
#   assert_current_user_can_access_path(기본 인자 동작 동일), assert_current_user_can_access_job
# 별칭: can_view_analysis = can_view, can_edit_analysis = can_edit
```

- `user` 는 사번 문자열이 기본이고 `models.User` 객체도 받는다(다른 plan 이 이미 User 를 들고 있을 때 재조회를 피하기 위함).
- **경로 기반 공유(`allow_shared`)** 는 `/download` 와 `/export-xlsx` 두 라우트만 켠다. 경로에서 작업 폴더명
  (`{ts}_{eid}_{Program}`)을 뽑아, **그 폴더 소유자의** `Analysis` 중 `project_id IS NOT NULL` 이고
  `input_info`/`result_info` JSON 문자열에 폴더명이 들어 있는 레코드를 찾은 뒤 `can_view` 로 판정한다.
  (`Analysis` 는 work_dir 컬럼이 없고 두 JSON 에 절대경로가 들어 있다 — `_files_available` 280행과 같은 전제.)
  레코드를 못 찾거나 멤버가 아니면 기존 소유자 규칙으로 떨어져 403.
- 기본값 `allow_shared=False` 이므로 나머지 30여 곳의 경로 라우트는 **동작이 바뀌지 않는다.**

### 4.4 API

모두 `require_auth`. 응답은 JSON. 프로젝트 기능은 플랫폼 공통이라 `GUARDED_ROUTES` 에 등록하지 않는다(상위 규약 §1-8).

| 메서드·경로 | 권한 | 요청 | 응답 |
|---|---|---|---|
| `GET /api/projects` | 로그인 | — | `{"items":[ProjectSummary]}` 본인이 소유자/멤버인 것만, id 내림차순 |
| `POST /api/projects` | 로그인 | `{"name","description"?}` | 201 `ProjectDetail` |
| `GET /api/projects/{id}` | 소유자·멤버·관리자 | — | `ProjectDetail`(members 포함) |
| `PUT /api/projects/{id}` | 소유자·관리자 | `{"name"?,"description"?}` | `ProjectDetail` |
| `DELETE /api/projects/{id}` | 소유자·관리자 | — | `{"message":"Project deleted","detached_analyses":N}` — 멤버 삭제 + 해석 `project_id=NULL`(해석은 남는다) |
| `POST /api/projects/{id}/members` | 소유자·관리자 | `{"employee_id","role":"viewer"\|"editor"}` | 201 `Member`. 이미 있으면 역할만 갱신(200). `notify(kind="share.received")` |
| `PUT /api/projects/{id}/members/{employee_id}` | 소유자·관리자 | `{"role"}` | `Member` |
| `DELETE /api/projects/{id}/members/{employee_id}` | 소유자·관리자·**본인** | — | `{"message":"Member removed"}` |
| `GET /api/projects/{id}/analyses` | 소유자·멤버·관리자 | — | `{"items":[Analysis + owner_name]}` 샘플·내부 하위단계 제외, created_at 내림차순 |
| `PUT /api/analysis/{id}/project` | `can_edit(analysis)` **그리고** 대상 프로젝트 owner/editor/관리자 | `{"project_id": int \| null}` | 갱신된 Analysis(`_serialize_analysis`) |
| `GET /api/users/search?q=&limit=` | 로그인 | q ≥ 2자 | `[{"employee_id","name","department","position"}]` 활성 사용자, 본인 제외, 최대 20 |

```jsonc
// ProjectSummary
{"id":7,"name":"3496 Module 권상","description":"…","department":"구조시스템연구실",
 "owner_id":"A476854","owner_name":"권혁민","my_role":"owner|editor|viewer",
 "member_count":2,"analysis_count":5,"created_at":"…","updated_at":"…"}
// ProjectDetail = ProjectSummary + "members":[Member]
// Member
{"employee_id":"A123456","name":"홍길동","department":"…","role":"viewer","added_by":"A476854","added_at":"…"}
```

오류: 이름 공백/200자 초과 → 400 · 존재하지 않는 사번 또는 비활성 사용자 → 404 "사용자를 찾을 수 없습니다." ·
소유자를 멤버로 추가 → 400 · 역할 어휘 외 → 422(pydantic) · 권한 없음 → 403 · 프로젝트 없음 → 404.

**결정: `history` 응답에 공유 해석을 섞지 않는다.** "내 해석" 탭은 그대로 두고 공유분은 "프로젝트별" 탭의
`GET /api/projects/{id}/analyses` 로만 본다. 이유 — ① history 의 통계 카드(`_analysis_summary`)·파일 만료
카운트가 "내가 돌린 것" 기준이라 섞이면 의미가 깨진다 ② 남의 해석에 재실행 버튼이 보이는 혼동을 피한다
③ Plan B(보관 연장)·Plan H(배치) 가 history 를 확장할 때 필터 조건이 단순하게 유지된다.
단 `_serialize_analysis` 는 컬럼 전체를 내보내므로 **`project_id` 는 history 항목에 자동으로 실린다** — 프론트가
프로젝트 이름 태그를 붙이는 데 쓴다.

### 4.5 알림 (Plan A 계약, §2.1)

```python
try:
    from app.services.notification_service import notify
except ImportError:
    notify = None
…
if notify is not None:
    notify(db, employee_id=member.employee_id, kind="share.received",
           title=f"'{project.name}' 프로젝트에 {ROLE_LABEL[role]}(으)로 초대되었습니다",
           body=f"{adder_name}님이 회원님을 프로젝트 멤버로 추가했습니다.",
           link={"menu": "My Projects", "params": {"tab": "projects", "project_id": project.id}},
           dedupe_key=f"share:{project.id}:{member.employee_id}")
```

프론트는 `sessionStorage('workbench:open-project-tab')` 에 `{"project_id": N}` 이 있으면 "프로젝트별" 탭을
그 프로젝트로 연다(기존 `workbench:open-project-detail` 패턴과 동일). Plan A 의 링크 핸들러가 `menu=="My Projects"`
이고 `params.tab=="projects"` 면 이 키를 쓰도록 한다 — Plan A 이전에는 알림 자체가 없으므로 영향 없음.
`notify` 호출은 `try/except Exception` 으로 감싸 알림 실패가 멤버 추가를 되돌리지 않게 한다.

### 4.6 사용자 검색 엔드포인트를 새로 만드는 이유

`GET /api/users`(users.py:16) 는 `require_admin` 이고 로그인 횟수·해석 통계까지 돌려준다. 일반 사용자가
멤버를 추가하려면 사번/이름으로 상대를 찾아야 하므로 **최소 필드 화이트리스트**(`chat.py:88 get_contacts` 와
같은 철학)의 `GET /api/users/search` 를 `require_auth` 로 추가한다. 관리자 전용 라우트는 건드리지 않는다.

### 4.7 프론트 — `MyProjects` 안에서 끝낸다

- 상단 `FilterTabs` 2개: **"내 해석" | "프로젝트별"**. 기본 "내 해석"(기존 화면 그대로). `sessionStorage`
  키(§4.5)가 있으면 "프로젝트별"로 시작.
- **프로젝트별** 탭: 통계 카드·검색/필터 영역을 숨기고, 표 위에 `ProjectListPanel`(프로젝트 카드 가로 스크롤 목록 +
  "새 프로젝트" 버튼; 카드에 역할 배지·멤버/해석 수, 소유자면 ✎ 멤버·수정·삭제 아이콘)을 둔다. 카드를 고르면
  `GET /api/projects/{id}/analyses` 결과를 **같은 표**(1075행 `<table>`)로 그린다. 클라이언트 페이지네이션
  (`PAGE_SIZE` 10 동일).
  - 표 행: 소유자가 내가 아니면 Project Name 아래 "소유자 홍길동(A123456)" 작은 줄. 재실행 버튼은 내 해석이 아니면 비활성(`title` "재실행은 해석 소유자만 가능합니다").
  - 행 액션에 **"프로젝트에 넣기"**(FolderPlus) 추가 — 내 해석(또는 관리자)에만 보인다. 두 탭 모두.
- **내 해석** 탭 표 행: `project_id` 가 있으면 Project Name 아래 `FolderKanban` 아이콘 + 프로젝트 이름 태그
  (프로젝트 목록은 페이지 진입 시 한 번 받아 `Map` 으로 매핑).
- 모달 3개(`components/analysis/`):
  - `ProjectFormModal` — 생성/수정(이름 필수 ≤200자, 설명 선택).
  - `ProjectMembersModal` — 멤버 표(이름·사번·부서·역할 select·제거) + 하단 검색 입력(`GET /users/search`, 300ms 디바운스, 2자 이상) → 결과 클릭 + 역할 선택 → 추가.
  - `AssignProjectModal` — 내가 owner/editor 인 프로젝트 라디오 목록 + "프로젝트에서 빼기" 옵션 → `PUT /analysis/{id}/project`.
- `ProjectDetailModal` footer(365~374행)에 "프로젝트에 넣기" 버튼(소유자/관리자에게만). `AssessmentProjectModal`(Truss Assessment 전용 모달)은 건드리지 않는다 — 행 액션이 모든 앱을 덮는다.
- 삭제는 `ConfirmDialog`. 성공/실패는 `useToast`.
- API 모듈 `src/api/projects.js` 신규(페이지에서 axios 직접 호출 금지, §1-10).

## 5. 데이터 흐름

```
[MyProjects '프로젝트별' 탭]
  GET /api/projects ──────────────▶ list_projects_for(me)  (owner_id==me OR member)
  카드 선택 ─ GET /api/projects/{id}/analyses ─▶ require_project_role(any) → Analysis.project_id==id
  행 '프로젝트에 넣기' ─ PUT /api/analysis/{aid}/project {project_id}
        └▶ assert_can_edit(analysis) AND require_project_role(target, owner|editor)
  멤버 추가 ─ POST /api/projects/{id}/members ─▶ owner/admin → upsert → notify(share.received)

[동료 B 가 A 의 결과를 내려받을 때]
  GET /api/download?filepath=…\20260907_145643_A476854_GroupModuleUnit\x.bdf
    └▶ assert_current_user_can_access_path(allow_shared=True)
         owner=A476854 ≠ B → find_analysis_for_path(폴더명 LIKE, project_id NOT NULL, owner=A476854)
         → can_view(record, B) : project_role(record.project_id, B)=='viewer' → 통과
```

## 6. 테스트 전략 (pytest, SQLite 메모리)

| 파일 | 검증 |
|---|---|
| `tests/test_projects_schema.py` | `Project`/`ProjectMember` 테이블 생성, `Analysis.project_id` 존재, `ensure_analysis_project_columns` 가 구 스키마에 컬럼·인덱스를 추가하고 두 번 호출해도 안전 |
| `tests/test_access_control_projects.py` | `project_role` 소유자/editor/viewer/None · 대소문자 무시 · `can_view`/`can_edit` 매트릭스 · `find_analysis_for_path` · `allow_shared` 기본 False 면 기존 동작 · True 면 멤버 통과 · 기존 8건 무변경 통과 |
| `tests/test_projects_router.py` | CRUD 권한, 삭제 시 해석 분리, 멤버 추가/역할/제거/본인 나가기, 소유자 추가 400, 비활성 사번 404, `notify` 호출 인자(monkeypatch), `GET /analyses` 필터·`owner_name`, `PUT /analysis/{id}/project` 권한 4경우 |
| `tests/test_users_search.py` | 2자 미만 422, 본인 제외, 비활성 제외, 필드 화이트리스트 |
| `tests/test_analysis_shared_access.py` | viewer 가 `GET /analysis/{id}`·passport·`/download`·`/export-xlsx` 200, 비멤버 403, viewer 의 rerun 403, `POST /reports/generate` viewer 200 |

프론트는 러너가 없으므로 plan 에 `npm run dev` 기준 수동 검증 절차를 쓴다.

## 7. 서버(145) 반영

- 백엔드: **`git pull` + 백엔드 재시작으로 끝.** 기동 시 `create_all` 이 `projects`/`project_members` 를 만들고
  `run_schema_bootstrap` 이 `analysis.project_id` 를 추가한다.
- 프론트: **WorkBench 프론트 재배포 필요**(Electron 빌드).
- InHouse 프로그램 수동 교체: **없음.**

## 8. 리스크 / 대응

| 리스크 | 대응 |
|---|---|
| `find_analysis_for_path` 의 JSON LIKE 가 MySQL 에서 느릴 수 있음 | `employee_id`(인덱스) + `project_id IS NOT NULL`(인덱스) 로 먼저 좁힌 뒤 LIKE. 폴더명에 타임스탬프가 있어 후보가 1~2건. `_`를 escape 해 오탐 방지 |
| 프로젝트 삭제 시 해석이 함께 사라진다고 오해 | 확인 대화상자 문구 "해석 N건은 삭제되지 않고 프로젝트에서만 분리됩니다" + 응답 `detached_analyses` |
| 다른 plan(F·J) 이 `can_view` 를 먼저 호출 | 이 spec 의 시그니처 `can_view(analysis, user, db)` 를 상위 규약 §2.7 대로 고정. 존재 확인은 `hasattr(_access_control, "can_view")` 로 |
| 사번 대소문자 혼재 | 모든 비교 upper. 멤버 저장 시 `User.employee_id` 원문을 그대로 저장(조회 키 일관) |
| `switchable_client` 가 2명만 지원 | 테스트 파일 안에서 `app.dependency_overrides[require_auth]` 를 직접 바꾸는 `_as(client, eid)` 헬퍼 사용(fixture 가 종료 시 clear) |
