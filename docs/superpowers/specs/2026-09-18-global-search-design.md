# Plan J — 전역 검색(Global Search) 설계

- 작성일: 2026-09-18
- 상위 규약: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1(공통 규칙) · §2.7(`can_view` 선택 의존, Plan G 소유) · **§2.10(이 문서의 담당)** · §3(실행 순서 8번, G 선택 의존).
  충돌 시 상위 규약이 우선한다.
- 대상: `HiTessWorkBenchBackEnd/`(FastAPI) + `HiTessWorkBench/frontend/`(React). InHouse 프로그램은 건드리지 않는다.
- 산출 plan: `docs/superpowers/plans/2026-09-18-global-search.md`

## 1. 배경 / 문제

WorkBench 사용자는 "3496"(hull number)·공지 키워드·가이드 문구를 여러 화면을 돌며 각각 찾는다.

- 해석 이력은 `MyProjects.jsx` 의 표 상단 검색(1016~1073행)에서 `project_name/program_name/employee_id` LIKE 만.
- 공지는 `NoticeBoard` 안의 목록 필터, 사용자 가이드는 `UserGuide` 안의 카테고리 탭. **한 곳에서** 훑을 창구가 없다.
- 헤더 Ctrl+K 팔레트(`components/platform/CommandPalette.jsx`)는 **앱·메뉴·최근 활동**만 넣고 "데이터"는 검색하지 않는다.

이 plan 은 그 팔레트를 **데이터 검색**까지 확장하고, 백엔드에 얇은 `/api/search` 하나를 붙인다.
새 페이지도, 새 UI 진입점도 만들지 않는다.

## 2. 현재 코드 실측 (2026-09-21)

### 2.1 프론트 — Ctrl+K 팔레트

- `components/layout/Layout.jsx:187-196` 이 `Ctrl+K` 를 잡아 `setIsCommandPaletteOpen(true)`. 렌더는 404~414행의 `<CommandPalette … menuItems={menuItems} onNavigate={handleNavigate} onOpenDiagnostics={…} onOpenServerSettings={…} />`.
- `components/platform/CommandPalette.jsx:47-103` 이 `commands` 배열을 `recent → system → menu → app` 순으로 조립하고, 105~112행 `filtered` 는 `scoreCommand` 로 정렬해 최대 12건. 항목 렌더는 161~186행.
- Ctrl+K 는 이 팔레트 하나뿐이다(`CommandPalette` 인스턴스가 다른 곳에 없다). 여기에 "데이터" 섹션을 붙이는 것이 상위 §2.10 그대로다.
- `Dashboard.jsx:34` 와 `MyProjects.jsx:677-679` 가 이미 `sessionStorage['workbench:open-project-detail']` 규약을 쓰고 있어 검색 결과 클릭 시 그대로 재사용한다.

### 2.2 백엔드 — 검색 대상 컬럼

| 모델 | 위치 | 검색 후보 컬럼 |
|---|---|---|
| `Analysis` | `app/models.py:78-94` | `id`(PK), `job_id`, `project_name(200)`, `program_name(100)`, `employee_id` |
| `Notice` | `app/models.py:109-125` | `title(200)`, `content(2000)`. 공개 판정 = `support.py:91-98 _filter_published_notices`(is_private/publish_status/starts_at/ends_at) |
| `UserGuide` | `app/models.py:153-160` | `title(200)`, `category(100)`, `content(Text)` |
| `Project`/`ProjectMember` | Plan G §4.1 (spec, 미실행) | `Project.name(200)`, `Project.description(Text)` — 없으면 빈 배열 |

- `analysis.py:1655-1665 GET /api/analysis/{id}` 는 여전히 **인라인 소유자/관리자 검사**(1661~1664행). Plan G 가 들어오면 `assert_can_view` 로 대체되지만, Plan J 는 그 이전에도 동작해야 하므로 서비스가 `try: from app.routers._access_control import can_view except ImportError` 로 지연 import.
- `analysis.py:371-395 _apply_analysis_filters` 가 이미 같은 컬럼 3개에 `ilike` 필터를 걸고 있어(383~385행) 동일 패턴을 재사용한다.

### 2.3 스키마 부트스트랩

- `app/schema_bootstrap.py` 는 `_add_missing_columns`(8행) / `_add_missing_indexes`(33행) 두 헬퍼로 멱등 ADD 만 한다. FULLTEXT 는 아직 어디에도 없다 — 이 plan 이 첫 도입.
- `run_schema_bootstrap()`(152~160행) 이 7개 `ensure_*` 를 순차 호출. 여기 마지막에 `ensure_search_indexes()` 를 추가한다.
- `_add_missing_indexes` 는 `inspector.get_indexes()` 로 이미 있는 인덱스를 건너뛰지만 **FULLTEXT 인덱스 이름은 일반 인덱스로 조회된다** — SQLAlchemy 는 인덱스 종류를 구분하지 않아 재실행 시 두 번째 CREATE 는 안 나간다(안전).

## 3. 확정 결정 (10개 항목, 상위 §2.10)

| # | 결정 | 이유 |
|---|---|---|
| 1 | **MySQL `LIKE` 기반.** `schema_bootstrap` 에서 `notices(title,content)`·`user_guides(title,content)`·`analysis(project_name)` 에 FULLTEXT 인덱스를 시도만 하고 실패는 로그 후 무시. 서비스는 항상 `LIKE '%q%'` 만 쓴다 | MySQL InnoDB 는 FULLTEXT 를 지원하지만 SQLite(테스트) 는 지원하지 않는다. FULLTEXT 는 향후 `MATCH() AGAINST()` 로 갈아탈 여지만 두고 이번 판정 경로에는 넣지 않는다 — 코드 경로가 하나뿐이라 dev/prod 결과가 갈리지 않는다 |
| 2 | 최소 질의 **2자**. 빈 질의/1자는 400 | `LIKE '%a%'` 로 백엔드가 전체 스캔되는 것을 막는 최소치. UI 는 그 아래에서 API 자체를 부르지 않는다 |
| 3 | 프론트 디바운스 **300ms** + `AbortController` 로 이전 요청 취소 | 타자 중 서버 왕복 억제. Plan A·G 의 폴링 30초와 다르게 여기는 대화형이라 지연을 짧게 |
| 4 | scope 당 상한 **8건**, 총 4 scope | 팔레트 드롭다운(높이 `58vh`) 안에 앱·메뉴·최근 항목과 함께 들어가는 실용 상한. 페이지네이션·"더 보기"는 만들지 않는다 |
| 5 | scope 어휘 = `analysis` · `notice` · `guide` · `project` · `all`(기본) | 상위 §2.10 그대로. 다른 도메인(feature_request 등)은 이번 범위 밖 |
| 6 | **랭킹 없음** — 각 scope 안에서 `created_at DESC` | 팔레트는 시간순 회상이 자연스럽다(가장 최근 해석부터). BM25/relevance 는 FULLTEXT 도입 시 별건 |
| 7 | 스니펫 = 매칭 위치 앞뒤 **80자**, HTML escape + `<mark>` 로 매치 감싸기 | 팔레트 한 줄에 들어가는 최소한의 컨텍스트. 백엔드 순수 유틸 `utils/search_snippet.py` — 프론트가 별도로 하이라이팅하지 않는다(양쪽 로직 어긋남 방지) |
| 8 | **퍼지/오타 교정·검색어 저장·관리자 통계 없음** | YAGNI. 사내 데이터 규모(전체 analysis ~수천 건)에서 실측 문제 없다 |
| 9 | 권한 = `analysis` **`can_view`**(Plan G 이후) / Plan G 이전엔 소유자 or 관리자. `notice` 는 `_filter_published_notices` 와 동일(`is_private=False && publish_status='published' && starts_at ≤ now ≤ ends_at`). `guide` 는 로그인 사용자 전부. `project` 는 `owner_id==me OR project_members` 멤버 | 상위 §2.10, §2.7 |
| 10 | Ctrl+K 팔레트 안에 **"데이터" 섹션**을 추가. 새 검색 페이지·별도 단축키·URL 라우팅 없음 | 상위 §2.10 |
| 11 | `require_auth` 필수. `GUARDED_ROUTES` 등록하지 않는다 | 플랫폼 공통 기능(상위 §1.8). 관리자용이 아니다 |
| 12 | scope=`all` 이면 4개 scope 를 병렬 SQL 로 각각 최대 8건씩. 응답은 `groups` 배열 순서 = `analysis, project, notice, guide`(사용 빈도) | 정렬 규칙을 스니펫과 함께 프론트에 넘겨 UI 가 그대로 그린다 |
| 13 | 결과 항목 = `{id, title, snippet, menu, params}` — `menu` 는 `NavigationContext` 메뉴명(`"My Projects"`·`"Notice & Updates"`·`"User Guide"`), `params` 는 `sessionStorage` 페이로드 힌트 | 알림 링크(Plan A)와 같은 계약. 항목 클릭 시 프론트가 그대로 재사용한다 |

## 4. 데이터 모델

**신규 테이블 없음.** `Analysis`(78~94행)·`Notice`(109~125행)·`UserGuide`(153~160행) 를 그대로 조회한다.
Plan G 가 앞서 실행되면 `Project`/`ProjectMember` 도 그대로 쓴다.

### 4.1 FULLTEXT 인덱스 시도 (`schema_bootstrap.ensure_search_indexes`)

`ensure_notice_columns`·`ensure_app_community_columns` 자리(58·90행 패턴) 옆에 함수를 하나 두고
`run_schema_bootstrap()` 의 마지막 호출로 추가한다.

```python
def ensure_search_indexes(*, engine=None) -> None:
    target_engine = engine or database.engine
    if target_engine.url.get_backend_name() != "mysql":
        return                                        # SQLite/tests: LIKE 로도 충분
    from sqlalchemy.exc import OperationalError
    stmts = {
        "ft_notices_title_content":    "CREATE FULLTEXT INDEX ft_notices_title_content ON notices (title, content)",
        "ft_user_guides_title_content":"CREATE FULLTEXT INDEX ft_user_guides_title_content ON user_guides (title, content)",
        "ft_analysis_project_name":    "CREATE FULLTEXT INDEX ft_analysis_project_name ON analysis (project_name)",
    }
    # 인덱스 이름 조회는 _add_missing_indexes 재활용 — 실패는 로깅 후 무시(엔진·charset 조건 불충족 가능)
    try:
        _add_missing_indexes("notices",     {k:v for k,v in stmts.items() if "notices" in v},     engine=target_engine)
        _add_missing_indexes("user_guides", {k:v for k,v in stmts.items() if "user_guides" in v}, engine=target_engine)
        _add_missing_indexes("analysis",    {k:v for k,v in stmts.items() if "analysis" in v},    engine=target_engine)
    except OperationalError as exc:
        logger.warning("FULLTEXT index skipped: %s", exc)
```

- 서비스는 이 인덱스를 **읽지 않는다**(§2-1). 존재하면 향후 `MATCH()` 도입 시 그대로 재활용.
- 열 charset 이 `utf8mb4_general_ci` 라 한글 CJK 는 `ngram` 파서가 필요한데, 배포 서버 `my.cnf` 설정은 확정되지 않았다 — 그래서 인덱스 생성 실패를 `WARNING` 한 줄로만 남긴다.

## 5. 서비스 계약

### 5.1 `app/services/search_service.py`

```python
SearchScope = Literal["all", "analysis", "notice", "guide", "project"]

def run_search(db: Session, user: "str | models.User", q: str, scope: SearchScope = "all",
               limit: int = 8) -> dict
# 반환:
# {"query": "...", "scope": "...", "groups": [
#   {"scope": "analysis", "items": [{"id","title","snippet","menu","params"}]},
#   {"scope": "project",  "items": [...]},
#   {"scope": "notice",   "items": [...]},
#   {"scope": "guide",    "items": [...]},
# ]}
```

- **가드**: `q = q.strip()`, `len(q) < 2` → `ValueError`(라우터가 400 으로).
- 내부 리졸버 4개, 각 최대 `limit` 건, `created_at DESC`:
  - `_search_analyses(db, user, q, limit)` — `project_name` OR `program_name` OR `str(id) == q` OR `job_id ILIKE`. 결과에 `can_view` 필터(Plan G 있으면). Plan G 없으면 `employee_id == user OR is_admin` 폴백. 스니펫은 `project_name` 우선, 없으면 `f"#{id} {program_name}"`. `menu="My Projects"`, `params={"analysis_id": id}` — Plan A 의 `workbench:open-project-detail` 을 프론트가 그대로 재사용한다.
  - `_search_notices(db, q, limit)` — `title` OR `content` ILIKE. `is_private=False && publish_status='published' && starts_at ≤ now ≤ ends_at`(support.py `_filter_published_notices` 재사용 — import 대신 같은 조건을 이 서비스가 다시 조립: import cycle 회피). `menu="Notice & Updates"`, `params={"notice_id": id}`.
  - `_search_guides(db, q, limit)` — `title` OR `content` OR `category` ILIKE. `menu="User Guide"`, `params={"guide_id": id, "category": category}`.
  - `_search_projects(db, user, q, limit)` — Plan G 이전에는 **빈 배열 반환**(`try/except ImportError`). Plan G 이후에는 `owner_id==user OR project_members.employee_id==user`, `name` OR `description` ILIKE. `menu="My Projects"`, `params={"tab":"projects","project_id": id}` — Plan G §4.5 세션 키와 같은 페이로드.
- `scope != "all"` 이면 해당 리졸버 하나만 호출한다. `all` 은 4개 모두 병렬로 부를 필요 없이 순차 호출(합쳐 4~5 쿼리, 실측 수십 ms).
- 사번 정규화는 `_norm_eid` 를 재사용하지 않고 `str(user).strip()` 만(다른 plan 과 일관, 상위 §2.1 원칙과 동일).
- LIKE 이스케이프: `q` 에 포함된 `%`·`_`·`\` 를 백엔드에서 escape(`SQLAlchemy` `ilike(..., escape='\\')`) — 폴더명·타임스탬프에 `_` 가 흔해 오탐 방지.

### 5.2 `app/utils/search_snippet.py` (순수 함수, 재사용 가능)

```python
def make_snippet(text: str | None, q: str, radius: int = 80) -> str
# text 가 None/빈 문자열이면 "" 반환. 대소문자 무시로 첫 매치 위치를 찾아
# max(0, idx-radius) ~ idx+len(q)+radius 를 자르고, 앞뒤 잘림에 …를 붙인다.
# 매치 부분을 <mark>…</mark> 로 감싼다. text/q 는 HTML escape 후 매치를 찾는다.
# 매치가 없으면 앞 2·radius 자를 잘라 반환(스니펫은 있어야 UI 가 자리 잡는다).
```

전용 pytest `tests/test_search_snippet.py`: 빈 텍스트, 매치 없음, 앞/뒤 잘림, 중앙 매치, HTML injection(`<script>`→escape), 대소문자·한글 매치.

## 6. 발신 훅

**없음.** 이 plan 은 알림·이벤트를 발생시키지 않는다.

## 7. API (`app/routers/search.py`, prefix 없음, 전부 `require_auth`)

| 메서드·경로 | 요청(query) | 응답 | 오류 |
|---|---|---|---|
| `GET /api/search` | `q: str`(필수, ≥2자), `scope: "all"\|"analysis"\|"notice"\|"guide"\|"project"`(기본 `all`), `limit: 1..20`(기본 8) | `{"query","scope","groups":[…]}` (§4.1 스키마) | `q` 부재/짧음 → 400 `"검색어는 최소 2자 이상이어야 합니다."` · scope 어휘 밖 → 422 · 미인증 → 401 |

- 라우터는 얇은 껍데기 — 파라미터 검증(pydantic `Query`) + `run_search()` 호출 + `dict` 반환.
- `main.py:188~212 include_router` 목록에 추가.
- **`GUARDED_ROUTES` 등록 X**(상위 §1.8).
- `total_count`·`elapsed_ms` 같은 메타는 이번엔 넣지 않는다(YAGNI). 프론트는 `groups[].items.length` 만으로 UI 를 그린다.

## 8. 프론트 — `CommandPalette.jsx` 안에서 끝낸다

### 8.1 배치

- 팔레트 열림 상태에서 `query.trim().length >= 2` 이면 300ms 디바운스 후 `GET /api/search?q=…&scope=all&limit=8` 을 호출한다.
- 결과는 기존 `commands` 배열(recent·system·menu·app) **아래**에 "데이터" 섹션을 하나 더 붙인다.
  - 섹션 헤더: 회색 소제목 4개(`해석 이력`·`프로젝트`·`공지사항`·`사용자 가이드`). 빈 그룹은 헤더도 감춘다.
  - 각 항목: 아이콘(scope별 lucide — `FolderKanban`·`Users`·`Megaphone`·`BookOpen`), 제목(`title` 그대로), 서브(`snippet` — `<mark>` 는 `dangerouslySetInnerHTML` 로 그린다 — 백엔드가 이미 escape 한 안전 HTML).
- 항목 클릭 = `handleNavigate(menu)` + `sessionStorage.setItem` 로 params 전달 후 팔레트 닫기.
  - `menu === "My Projects" && params.analysis_id` → `sessionStorage['workbench:open-project-detail'] = JSON.stringify({analysis_id: N})` 후 `window.dispatchEvent(new CustomEvent('workbench:open-project-detail'))` (Plan A §7.2 와 같은 규약).
  - `menu === "My Projects" && params.project_id` → `sessionStorage['workbench:open-project-tab'] = JSON.stringify({project_id: N, tab: "projects"})` (Plan G §4.5).
  - `menu === "Notice & Updates"`·`"User Guide"` → 지금은 화면 상단 이동만(그 페이지 내부에 id 오픈 훅이 없으면 세션 키만 심어 두고 이동 — Plan J 는 그 페이지 로직을 건드리지 않는다).

### 8.2 API 모듈 (`src/api/search.js`, 신규)

```js
export async function runSearch({ q, scope = 'all', limit = 8, signal }) {
  const { data } = await api.get('/api/search', { params: { q, scope, limit }, signal });
  return data;
}
```

`CommandPalette` 는 `AbortController` 를 훅 안(`useRef`)에 두고, `query` 가 바뀌면 이전 요청을 `abort()` 하고 새로 만든다.
`signal.aborted` 예외는 조용히 무시(사용자가 계속 타자 중).

### 8.3 상위 규약 위반 방지

- 페이지에서 axios 직접 호출 금지(§1.10) — 반드시 `api/search.js` 를 거친다.
- `config.js` 는 건드리지 않는다.
- `commands` 배열과 "데이터" 섹션은 **별도 렌더 트리** — 기존 `filtered/scoreCommand` 로직을 데이터 항목에 걸지 않는다(서버가 이미 매칭·정렬을 마쳤다).

## 9. 보관

**없음.** 검색 결과는 요청/응답 1회성, 검색어 로그도 남기지 않는다(§3-8).

## 10. 테스트 전략

백엔드(pytest, `tests/conftest.py` fixture 재사용):

| 파일 | 검증 |
|---|---|
| `tests/test_search_snippet.py` | 빈 텍스트, 매치 없음, 앞/뒤 잘림, 중앙 매치, HTML escape, 한글, `<mark>` 감싸기 |
| `tests/test_search_service.py` | scope 별 리졸버 각각, 상한 8건, `created_at DESC`, `analysis` 권한(소유자·관리자·비소유자 → 제외, Plan G monkeypatch 로 멤버 통과), `notice` 필터(비공개/미게시/기간 밖 제외), `project` 는 Plan G 미실행 시 빈 배열, 검색어에 `%`·`_` 포함 시 escape |
| `tests/test_search_router.py` | 미인증 401, `q` 부재/1자 400, `scope=all` 응답 4그룹, `scope=analysis` 응답 1그룹, `limit=20` 상한, `limit=21` 422 |

프론트 러너 없음 — plan 에 `npm run dev` 기준 수동 검증(Ctrl+K → 2자 미만 무호출, 2자 이상 300ms 뒤 요청, 빠른 타자 중 이전 요청 취소, 항목 클릭 시 세션 키 + 이동).

## 11. 서버(145) 반영 구분

- 백엔드: **`git pull` + 백엔드 재시작으로 끝.** 신규 pip 의존성 없음. `ensure_search_indexes()` 가 기동 시 FULLTEXT 인덱스를 시도(charset·엔진 조건이 안 맞으면 로그만 남고 통과).
- 프론트: **WorkBench 프론트 재배포 필요**(Electron 빌드) — 팔레트 확장 때문에.
- InHouse 프로그램 수동 교체: **없음.**

## 12. 비목표

- 퍼지/오타 교정(`Levenshtein`·`trigram`)·형태소 분석·유의어.
- 순위(BM25·relevance) — `created_at DESC` 만.
- 검색 기록 저장, 최근 검색어, 즐겨찾기 검색.
- 검색어 전체본문 하이라이팅(스니펫만 감싸고 상세 페이지는 손대지 않는다).
- 관리자 검색 통계(횟수·인기 검색어).
- 조직 간·프로젝트 간 교차 검색(사번·멤버십 경계 유지).
- 파일 본문 검색(bdf/f06/xlsx 내부 텍스트) — 파일은 결과가 아니라 첨부다.
- 새 검색 페이지·검색 URL·별도 단축키 — Ctrl+K 팔레트 안에서만.
