# WorkBench 플랫폼 기능 확장 프로그램 — 마스터 설계(공통 규약)

- 작성일: 2026-09-18
- 범위: 기능 탐색(2026-09-18)에서 선정한 **11개 기능**의 공통 규약·공유 인터페이스·실행 순서.
  각 기능은 별도 spec + plan 을 갖는다(아래 표). 이 문서는 그 11개가 서로 어긋나지 않게 하는
  "계약서"다. 개별 spec 과 충돌하면 **이 문서가 우선**한다.
- 제외(사용자 결정): 다크모드, 3군(AI 재도입·API 키/웹훅·감사 로그 강화·BdfScanner 2D/3D·
  DrawingToAnalysis 완성·유사 모델 추천).

## 0. 현재 지형(요약)

- FastAPI 단일 프로세스 + MySQL(SQLAlchemy `create_all` + `app/schema_bootstrap.py` 수제 컬럼 추가). Alembic 없음.
- 작업 큐 = `app/services/job_manager.py` 의 `ManagedAnalysisExecutor(ThreadPoolExecutor 5)` + 인메모리
  `JobStatusStore`(+`_write_through` 로 `Analysis.job_status/progress/job_message` DB 반영). 완료 24h 후 메모리 삭제.
- 취소는 `routers/doublepipe.py` `POST /run-psa/cancel` → `doublepipe_psa_service.cancel_psa_job` 한 곳뿐.
  `doublepipe_psa_service` 는 이미 `taskkill /F /T /PID` + psutil 로 자식 프로세스 트리까지 죽이는 **완성된 취소 패턴**을 갖고 있어 Plan D 는 이 로직을 일반화한다.
- 접근 제어 = `app/routers/_access_control.py` "소유자 본인 or is_admin" (`analysis.py:78` 등에서 relative import).
- 프로그램 메타 단일 진실 원천 = `app/services/program_registry.py` `ProgramSpec`(capabilities, rerun_adapter, input_keys, report_adapter, report_scope, verdict_kind).
- 결과 보관 = `app/services/cleanup_service.py` `RETENTION_DAYS=30`, 폴더명 타임스탬프 기준, 매일 자정 + 기동 시.
- 리포트 = `app/services/report/`(`service.py`, `adapters/{generic,truss_assessment}`, `renderers/generic_xlsx.py`, `verdict_vocab.py`) + `routers/reports.py` `POST /api/reports/generate`.
- 프론트: React 18 + Vite + Tailwind, 라우팅은 `contexts/NavigationContext.jsx`(`setCurrentMenu`), 앱 카탈로그는
  `contexts/DashboardContext.jsx` `ANALYSIS_DATA` + `useAppCatalogue()`, 토스트 `ToastContext`, 우하단 `UtilityDock`
  (Job Center / ChatDock), 명령 팔레트(Ctrl+K), 최근 앱 `RecentActivityContext`(localStorage 8개), 즐겨찾기
  localStorage + Electron `preferences:get/set`. **프론트 테스트 러너 없음**(package.json scripts = dev/build/preview).
- 백엔드 테스트: `HiTessWorkBenchBackEnd/tests/` pytest(98 파일, `conftest.py` 존재). 실행은
  `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/<file> -q`.

## 1. 전 계획 공통 규칙

1. **커밋은 사용자가 직접 한다.** plan 의 각 Task 마지막 단계는 `git commit` 이 아니라
   **"커밋 준비 완료 — 변경 파일 목록을 사용자에게 보고"** 로 쓴다.
2. `HiTessWorkBench/frontend/src/config.js` 는 절대 스테이징하지 않는다. `Darkmode.js/` 는 건드리지 않는다.
3. **스키마 변경은 두 곳에 함께**: `app/models.py` 에 모델 추가/컬럼 추가 + `app/schema_bootstrap.py` 에
   `ensure_<table>_columns()` 함수를 추가하고 `run_schema_bootstrap()` 에서 호출. 신규 테이블은 `create_all` 로
   생기지만 **기존 테이블의 신규 컬럼은 bootstrap 이 없으면 서버(145)에서 500** 이 난다.
4. **서버 반영 구분을 plan 말미에 명시**: "git pull + 백엔드 재시작으로 끝" / "프론트 재배포 필요" /
   "InHouse 수동 교체 필요". 이번 11개는 전부 InHouse 프로그램을 건드리지 않는다.
5. 백엔드는 **TDD**(pytest, 기존 `tests/conftest.py` 의 fixture 재사용). 프론트는 러너가 없으므로
   plan 에 **수동 검증 절차**(npm run dev → 화면 경로 → 기대 동작)를 구체적으로 쓴다. 순수 유틸(`src/utils/*.js`)
   로직은 가능한 한 백엔드에 두거나, 프론트에 두더라도 부수효과 없는 함수로 분리한다.
6. 문서·주석·커밋 메시지·UI 문구는 한국어. 식별자는 영어.
7. **YAGNI**: 각 plan 은 이 문서에 적힌 인터페이스까지만 만든다. 다른 plan 의 영역은 "호출만" 하고 구현하지 않는다.
8. 새 라우터는 `app/main.py` 의 `include_router` 목록에 추가하고, **쓰기 엔드포인트가 App 별 기능이면**
   `services/app_settings.py` `GUARDED_ROUTES` 등록을 검토한다(플랫폼 공통 기능은 등록하지 않는다).
9. 관리자 전용 엔드포인트는 `app/dependencies.py` 의 기존 `require_admin` 을, 로그인 필수는 `require_auth` 를 쓴다(이름은 실제 파일에서 확인).
10. 프론트 API 호출은 `src/api/<domain>.js` 모듈에 함수로 추가하고 페이지에서 직접 axios 를 쓰지 않는다.

## 2. 공유 인터페이스(계약)

### 2.1 알림 서비스 — 소유: Plan A

```python
# app/services/notification_service.py
def notify(db, *, employee_id: str, kind: str, title: str, body: str = "",
           link: dict | None = None, dedupe_key: str | None = None) -> "Notification | None"
```
- `kind` 어휘(고정): `job.completed` `job.failed` `job.cancelled` `retention.expiring` `retention.expired`
  `batch.completed` `share.received` `feature_request.status_changed` `notice.published`.
- `link` = `{"menu": "<NavigationContext 메뉴명>", "params": {...}}` — 프론트가 `setCurrentMenu(menu)` 후 `sessionStorage` 로 params 전달(기존 Dashboard→MyProjects 상세 모달 패턴 재사용).
- `dedupe_key` 가 같으면 미읽음 알림을 중복 생성하지 않는다(만료 경고를 매일 돌려도 1건).
- **다른 plan 은 이 함수를 `try: from app.services.notification_service import notify except ImportError: notify = None`
  로 지연 import 하고, `notify` 가 None 이면 조용히 건너뛴다.** 그래야 Plan A 없이도 각 plan 이 단독으로 동작한다.
- 테이블 `notifications`: `id, employee_id(idx), kind, title, body, link(JSON), dedupe_key(idx), read_at, created_at(idx)`.
  보관 90일(cleanup_service 에 훅 추가는 Plan A 가 한다).
- 프론트 전달은 **폴링**(기존 presence/chat 과 동일 철학, WebSocket 도입 금지): `GET /api/notifications?since=<id>` 30초.
  Electron 네이티브 토스트는 `new Notification()`(렌더러) 사용, 새 IPC 채널 추가 최소화.

### 2.2 사용자 환경설정 — 소유: Plan E (Plan A 가 읽기만 한다)

```python
class UserPreference(Base):
    __tablename__ = "user_preferences"
    employee_id = Column(String(50), primary_key=True)
    prefs = Column(JSON, nullable=False, default=dict)   # {"favorites":[...], "recent_apps":[...], "notifications":{...}, "landing_menu": "..."}
    updated_at = Column(DateTime)
```
- 엔드포인트 `GET /api/preferences`, `PUT /api/preferences`(부분 병합, 키 화이트리스트: favorites, recent_apps, notifications, landing_menu).
- Plan A 는 `prefs["notifications"]` 를 `{"muted_kinds": [...], "desktop_toast": true}` 로 읽는다. 없으면 기본값.
- **Plan A 와 E 중 먼저 실행되는 쪽이 이 모델을 위 정의 그대로 만든다.** 나중 쪽은 존재 확인 후 건너뛴다(plan 에 그 분기를 명시).

### 2.3 보관 연장 — 소유: Plan B

- `Analysis.retain_until: DateTime | None`, `Analysis.pinned: Boolean default False`. `cleanup_service` 는
  `pinned` 이면 건너뛰고, `retain_until` 이 있으면 폴더 나이 대신 그 날짜로 판정한다.
- 엔드포인트 `POST /api/analysis/{id}/retention` body `{"extend_days": 30 | null, "pinned": bool}`. 연장 상한은 누적 180일, 핀은 관리자 또는 소유자.
- 만료 D-7 스캔은 cleanup 의 자정 루프에서 `notify(kind="retention.expiring", dedupe_key=f"retention:{analysis_id}")`.
- 프론트 `MyProjects` 행 액션에 "보관 연장/핀" 추가, 파일 상태 카드에 "7일 내 만료 N건".

### 2.4 입력 프리셋 — 소유: Plan C

- 테이블 `input_presets`: `id, employee_id(idx), program_id(idx), name, input_info(JSON), source_analysis_id(nullable, non-FK), created_at, updated_at`. (employee_id, program_id, name) 유니크.
- `ProgramSpec.input_keys` 가 비어 있지 않은 프로그램만 프리셋 가능. `rerun` 은 현행 유지하고 **새 엔드포인트**
  `POST /api/analysis/{id}/rerun-with` body `{"input_info": {...}}` 로 "이전 입력 수정 후 재실행"을 만든다(기존 `rerun_adapter` 재사용, 파일 입력은 원본 work_dir 에서 복사).
- 프론트: 각 File 앱 페이지가 아니라 **MyProjects 상세 모달**에 "입력 불러와 수정" 버튼 → 공용 `InputPresetDrawer`. 앱별 폼 재구성은 하지 않는다(YAGNI). 파라메트릭 앱은 `CalcInputField` 기반이므로 `presetFor(program_id)` 훅으로 값 주입.

### 2.5 작업 취소 — 소유: Plan D (Plan H 가 의존)

- `job_manager.JobStatusStore` 에 `cancel_requested: set[str]` 와 `register_process(job_id, popen)` / `cancel(job_id) -> bool` 추가.
  취소 = ① 대기 중이면 future.cancel() ② 실행 중이면 등록된 Popen 트리에 `taskkill /F /T /PID`(Windows) → 5초 후 `psutil` 폴백 ③ 상태 `Cancelled`(`Interrupted` 와 구분).
  `ManagedAnalysisExecutor.submit` 에 `_submitted_futures: dict[job_id, Future]` 을 붙여 대기 중 future 를 찾을 수 있게 한다(현재 없음).
- **실제 `subprocess.Popen` 을 직접 부르는 서비스는 5개뿐**(`app/services/mooring_fitting_service.py:60`, `doublepipe_modeshape_service.py:286`, `doublepipe_psa_service.py:785`, `analysis_runner.py:147`, `remote_session_service.py:233`).
  이 5개에는 `job_manager.register_process(job_id, popen)` 훅을 걸고, 취소 시 위 taskkill 트리 로직을 재사용한다(`doublepipe_psa_service.cancel_psa_job` 이 이미 갖고 있는 코드를 `job_manager._kill_process_tree(popen)` 로 추출해 공용화).
- **그 외 서비스는 대부분 `subprocess.run()` 블로킹 호출**이라 프로세스 핸들이 없다. Plan D 는 이들을 **Popen 전환하지 않고**, 각 서비스가 자체 루프/전후 지점에서 `job_manager.is_cancel_requested(job_id)` 를 사전 체크해 조기 종료하도록 한다(장시간 nastran 은 이미 5개 안에 포함되어 있어 실사용에서는 즉시성 손해가 없다).
- 이중관 PSA 의 기존 `cancel_psa_job` 은 새 `job_manager.cancel()` 로 얇게 위임하고 `POST /run-psa/cancel` 라우트는 호환 유지(플랫폼 표준 엔드포인트로 마이그레이션은 별건).
- `JobStatusStore._cleanup_loop`(현행 140-151, "Completed/Failed" 24h 후 삭제)는 `Cancelled` 도 같은 정책으로 포함.
- 엔드포인트 `POST /api/analysis/{job_id}/cancel`(소유자 or 관리자). `notify(kind="job.cancelled")`.
- 프론트 Job Center 카드에 "중단" 버튼 + 확인 다이얼로그(`ConfirmDialog`). `MyProjects.jsx:1140` row actions flex div 에도 같은 버튼 슬롯.

### 2.6 결과 비교 — 소유: Plan F

- `GET /api/analysis/compare?ids=1,2,3`(최대 6, 소유자/공유 확인) → `{"programs": [...], "rows": [{"key","label","unit","values":[...],"delta":...}]}`.
  비교 가능한 키는 `program_registry` 에 신규 필드 `compare_keys: tuple[str, ...]` 로 선언(`result_info` JSON 경로, 예 `"summary.maxUtilization"`). 미선언 프로그램은 공통 메타(상태·소요·판정)만.
- 모델 레지스트리의 `model_role before/after` 는 **UI 프리셋**("이 모델의 before/after 한 쌍 비교")으로만 연결하고 새 API 는 만들지 않는다.
- 프론트 `MyProjects` Run Compare 를 N건(≤6) 체크 + `CompareModal` 표/막대. 기존 2건 모달은 이 모달로 대체.

### 2.7 프로젝트·공유 — 소유: Plan G

- 테이블 `projects`: `id, name, owner_id(idx), department, description, created_at, updated_at`; `project_members`: `(project_id, employee_id) PK, role in {'viewer','editor'}, added_by, added_at`.
- `Analysis.project_id: Integer | None`(non-FK, 기존 `project_name` 은 유지·표시용). 공유 = 프로젝트 멤버십 **한 가지 경로만**(개별 해석 링크 공유·부서 전체 자동 공유는 이번에 안 만든다).
- `app/routers/_access_control.py`(위치: routers 하위, `analysis.py:78`·`doublepipe.py:26`·`hitessbeam.py:27`·`model_registry.py:37`·`module_ocean_transport.py:34`·`reports.py:21`·`services/analysis_passport.py:12`·`services/model_registry_service.py:32` 에서 참조) 의 소유자 판정을 `can_view(analysis, user)` / `can_edit(...)` 로 확장: 소유자 or 관리자 or 프로젝트 멤버(viewer 는 view 만). **다른 plan 은 이 두 함수를 호출**하고, Plan G 이전에는 기존 함수명이 그대로 동작하도록 Plan G 가 하위호환 alias 를 남긴다.
- 엔드포인트 `/api/projects` CRUD + `/api/projects/{id}/members` + `PUT /api/analysis/{id}/project`. 공유 수신자에게 `notify(kind="share.received")`.
- 프론트: `MyProjects` 상단 탭 "내 해석 | 프로젝트별", 프로젝트 생성/멤버 모달, 상세 모달에 "프로젝트에 넣기". 새 페이지를 만들지 않는다.

### 2.8 배치·우선순위 — 소유: Plan H (Plan D 이후)

- `job_manager` 에 **2개 풀**: `heavy`(nastran/abaqus/Cmb.Cli 계열, 워커 3) / `light`(계산기·파서, 워커 4). `ProgramSpec` 에 `queue_class: "heavy"|"light"` 추가(기본 light). `submit(fn, *, queue_class=...)`.
- 배치 = 테이블 `batch_runs`: `id, employee_id, program_id, name, status, total, done, failed, created_at`; `Analysis.batch_id: Integer | None`. 엔드포인트 `POST /api/analysis/batch` body `{"program_id", "name", "cases": [{"label", "input_info"}]}` → 케이스마다 기존 `request` 경로를 내부 호출(파일 입력은 1회 업로드 후 공유). `GET /api/analysis/batch/{id}` 진행률. 완료 시 `notify(kind="batch.completed")`.
- 대상은 **파라메트릭·Interactive 앱(`input_keys` 선언, 파일 없음)부터**. 파일 기반 앱의 케이스 매트릭스는 범위 밖.
- 프론트: 파라메트릭 앱 공용 `BatchRunPanel`(케이스 표 편집 → 제출) + `MyProjects` 배치 그룹 행. Job Center 는 배치 1건을 1카드로.

### 2.9 계산서 어댑터 확대 — 소유: Plan I

- 대상 = `program_registry` 에서 `report_scope == "planned"` 인 프로그램 전부(plan 작성 시 실제 목록을 파일에서 확인해 적는다). 각 프로그램에 `adapters/<program_id>.py` 하나(`generic` 패턴 상속) + `verdict_vocab` 등록.
- Unit 권상/Mooring/해상운송의 기존 전용 보고서는 건드리지 않는다(이미 자체 파이프라인). `xlsx_to_pdf.py` 로 PDF 옵션을 `POST /api/reports/generate` 에도 붙인다(`format: "pdf"|"xlsx"`, 기본 xlsx).
- 프론트 `ResultArtifactsCard` 의 "계산서" 버튼이 `GET /api/reports/capabilities` 기준으로 자동 노출되는 기존 구조를 유지하고, 형식 선택만 추가.

### 2.10 전역 검색 — 소유: Plan J

- `GET /api/search?q=&scope=all|analysis|notice|guide|project` → `{"groups":[{"scope","items":[{"id","title","snippet","menu","params"}]}]}`. MySQL `LIKE` 기반(FULLTEXT 인덱스는 `schema_bootstrap` 에서 `notices.title/content`, `user_guides.title/content`, `analysis.project_name` 에 시도하되 실패 시 LIKE 폴백).
- 권한: analysis 는 `can_view`(Plan G 이전엔 소유자/관리자), notice 는 공개분, guide 전부, project 는 멤버.
- 프론트: 기존 Ctrl+K 팔레트에 "데이터" 섹션을 추가(입력 300ms 디바운스, 최소 2자). 새 검색 페이지는 만들지 않는다.

### 2.11 기능 요청 메타 승격·게시판 통합 — 소유: Plan K

- `feature_requests` 에 `module: String(100)`, `priority: String(20)`, `app_key` 유지. 기존 본문의 `[관련 모듈: …]\n[희망 중요도: …]` 를 파싱해 컬럼으로 옮기는 **1회 마이그레이션 함수**를 `schema_bootstrap` 에 둔다(멱등, 본문에서 메타 줄 제거).
- `status` 어휘를 `Under Review | Planned | In Progress | Resolved` 4개로 고정하고 과거 표기(`Completed/Done/해결 완료`)는 마이그레이션에서 `Resolved` 로 정규화.
- 게시판 UI = `components/analysis/AppCommunityHub.jsx` 의 목록/작성/상세를 `components/community/FeatureRequestBoard.jsx` 로 추출해 **전역 `UserRequests.jsx` 와 앱별 Hub 가 같은 컴포넌트를 쓴다**(`appKey` prop 유무로 분기). 관리자 상태 변경 시 작성자에게 `notify(kind="feature_request.status_changed")`.
- 관리자용 집계 `GET /api/admin/feature-requests/summary`(module × status 카운트) + `UserRequests` 상단 필터(모듈·상태·중요도).

## 3. 실행 순서와 의존

| 순서 | Plan | 의존 | 비고 |
|---|---|---|---|
| 1 | **A 알림 센터** | — | 다른 plan 이 호출하는 기반 |
| 2 | **E 최근 앱·즐겨찾기 동기화·환경설정** | (A 와 독립) | `user_preferences` 공유 |
| 3 | **B 보관 연장·만료 경고** | A(선택) | |
| 4 | **D 작업 취소** | A(선택) | |
| 5 | **C 입력 프리셋·수정 재실행** | — | |
| 6 | **G 프로젝트·공유** | A(선택) | `can_view/can_edit` 제공 |
| 7 | **F 결과 비교** | G(선택) | |
| 8 | **J 전역 검색** | G(선택) | |
| 9 | **H 배치·우선순위** | D | |
| 10 | **I 계산서 어댑터** | — | 독립, 언제든 |
| 11 | **K 기능 요청 승격·통합** | A(선택) | 독립 |

"(선택)" 의존은 §2.1 의 지연 import 규칙으로 흡수되므로 **어느 순서로 실행해도 깨지지 않아야 한다.** 단 H 는 D 의 `cancel`/`register_process` 를 전제한다.

## 4. 문서 위치

| Plan | spec | plan |
|---|---|---|
| A | `specs/2026-09-18-notification-center-design.md` | `plans/2026-09-18-notification-center.md` |
| B | `specs/2026-09-18-result-retention-extend-design.md` | `plans/2026-09-18-result-retention-extend.md` |
| C | `specs/2026-09-18-input-presets-rerun-design.md` | `plans/2026-09-18-input-presets-rerun.md` |
| D | `specs/2026-09-18-job-cancel-design.md` | `plans/2026-09-18-job-cancel.md` |
| E | `specs/2026-09-18-user-preferences-sync-design.md` | `plans/2026-09-18-user-preferences-sync.md` |
| F | `specs/2026-09-18-result-compare-design.md` | `plans/2026-09-18-result-compare.md` |
| G | `specs/2026-09-18-projects-and-sharing-design.md` | `plans/2026-09-18-projects-and-sharing.md` |
| H | `specs/2026-09-18-batch-runs-and-queue-priority-design.md` | `plans/2026-09-18-batch-runs-and-queue-priority.md` |
| I | `specs/2026-09-18-report-adapter-coverage-design.md` | `plans/2026-09-18-report-adapter-coverage.md` |
| J | `specs/2026-09-18-global-search-design.md` | `plans/2026-09-18-global-search.md` |
| K | `specs/2026-09-18-feature-request-metadata-design.md` | `plans/2026-09-18-feature-request-metadata.md` |

모든 경로는 `C:\Coding\WorkBench\docs\superpowers\` 기준.
