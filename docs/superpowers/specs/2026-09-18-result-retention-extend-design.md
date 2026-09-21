# 결과 파일 보관 연장·핀 + 만료 D-7 경고 — 설계 (Plan B)

- 작성일: 2026-09-18
- 마스터 규약: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1(공통 규칙) · §2.3(이 plan 의 계약) · §2.1(알림 지연 import) · §3(실행 순서: A 알림 → E → **B**). 충돌 시 마스터가 우선한다.
- 구현 plan: `docs/superpowers/plans/2026-09-18-result-retention-extend.md`
- 범위: 백엔드(모델·부트스트랩·`cleanup_service`·`analysis` 라우터) + 프론트(`MyProjects`·`api/analysis.js`·`StatusBadge`). InHouse 프로그램은 건드리지 않는다.

## 1. 배경 — 지금은 "30일이면 무조건 삭제, 통지는 사후"

`app/services/cleanup_service.py` 가 서버 기동 직후 1회 + 매일 자정에 `run_all_cleanup()` 을 돌리고, 그 안의 `run_cleanup()` 이 `userConnection/` 하위 폴더를 **폴더 나이 하나로만** 판정해 삭제한다.

```python
# cleanup_service.py:27
RETENTION_DAYS  = 30

# cleanup_service.py:154-166 (run_cleanup 본문)
age_days = _get_folder_age_days(folder_path)
if age_days < RETENTION_DAYS:
    result["skipped"] += 1
    continue
...
_force_rmtree(folder_path)
```

사용자가 겪는 문제:

1. **연장 수단이 없다.** 장기 검토 중인 해석(예: 설계 변경 대기)도 30일이면 결과 BDF/F06/xlsx 가 사라진다. 다시 돌리려면 `rerun` 뿐이고, Nastran 계열은 수십 분이 든다.
2. **사후 통지뿐이다.** 삭제 후 `MyProjects` 에서 `files_available === false` 로 "파일 만료" 배지가 붙는 것이 통지의 전부다(`analysis.py:280-291 _files_available` → 첫 파일 경로 `os.path.exists`). 만료 *전에* 알 방법이 없다.
3. **DB 와 폴더가 연결돼 있지 않다.** `Analysis` 행에는 작업 폴더 컬럼이 없다. 폴더 ↔ 기록의 연결은 `input_info`/`result_info` JSON 값에 들어 있는 절대 경로(`...\userConnection\20260918_085221_A476854_SidePassage\struData_ori_fixed.bdf`) 뿐이다.

### 코드에서 확인한 사실 (설계의 제약)

- **폴더명 규약**: `app/services/workspace.py:34-35` → `f"{now:%Y%m%d_%H%M%S}_{employee_id}_{program_name}"`. 소유자 파서 `app/routers/_access_control.py:15 WORK_FOLDER_RE = r"^\d{8}_\d{6}_(?P<employee_id>[^_]+)_.+$"`.
- ⚠️ **`_get_folder_age_days` 는 이 규약을 실제로 파싱하지 못한다.** `cleanup_service.py:44` 의 `prefix = folder_name.split("_")[0]` 가 `20260918`(8자리)을 얻고 `len(prefix) == 14` 검사에 걸려 **항상 stat(mtime/ctime) 폴백**으로 떨어진다. docstring 의 "YYYYMMDD_HHMMSS 형식"은 구현되지 않았다. 폴더 나이가 폴더명이 아니라 OS 시각에 좌우되므로(복사·백업 복원 시 어긋남) 이번에 폴더명 우선 파싱을 고친다.
- **한 폴더 ↔ 여러 기록**: 하위 단계 기록(`ModuleStability`·`ModuleHoistOptimize`·`UnitStructuralAnalysis` = `program_registry.internal_substep_programs()`)은 부모(`GroupModuleUnit`/`SidePassage`) 폴더의 경로를 그대로 가리킨다(운영 DB id 2814·2815 실측). 따라서 폴더 보호 판정은 "그 폴더를 가리키는 **기록 중 하나라도**" 기준이어야 하고, 알림은 폴더당 **대표 기록 1건**에만 보내야 한다.
- `Analysis.created_at` 는 `DateTime(timezone=True)` 이지만 MySQL DATETIME 은 naive 로 저장되고, 라우터도 `replace(tzinfo=None)` 로 벗겨 쓴다(`analysis.py:414`). 새 컬럼도 naive `datetime.now()` 기준으로 비교한다.
- 접근 제어 = `_access_control.assert_current_user_can_access_owner(owner_id, current_user, db)` (소유자 casefold 일치 or `is_admin`). 기존 `GET /analysis/{id}`(`analysis.py:1655-1665`)는 같은 규칙을 인라인으로 갖고 있다.
- 테스트 fixture(`tests/conftest.py`): `db_session`(SQLite 메모리) · `admin_client` · `switchable_client`(`as_admin()`/`as_user()` = `ADMIN001`/`EMP001`) · `make_analysis`. cleanup 은 `tests/test_runtime_services_lifecycle.py` 가 스케줄러 멱등성만 검증하고 **삭제 판정 테스트는 없다** → 이번에 신설.
- 알림 서비스(`app/services/notification_service.py`)는 **아직 없다**(Plan A 미실행). 마스터 §2.1 대로 지연 import 하고 없으면 건너뛴다.

## 2. 확정 결정

| # | 결정 | 근거 |
|---|---|---|
| D1 | **판정 우선순위 = `pinned` > `retain_until` > 폴더 나이.** 핀이면 영구 보관, 핀이 아니고 `retain_until` 이 있으면 그 시각 이후 삭제, 둘 다 없으면 기존처럼 폴더 생성 + 30일. | 마스터 §2.3 |
| D2 | **연장 누적 상한 180일.** `retain_until − 기본 만료일(폴더 생성+30일)` 이 180일을 넘는 요청은 400. 한 번에 1~180일, UI 는 30/90일 두 선택지. | 마스터 §2.3 "누적 180일" |
| D3 | **핀·연장 권한 = 소유자 또는 관리자.** `assert_current_user_can_access_owner` 재사용. 핀 해제도 같은 권한. | 마스터 §2.3 |
| D4 | **이미 만료(파일 삭제)된 기록은 연장·핀 불가 → 409.** 보호할 파일이 없다. | 되돌릴 수 없는 상태를 UI 가 "연장됨"으로 오인하지 않게 |
| D5 | **폴더 보호는 "그 폴더를 가리키는 기록 중 하나라도 pinned / retain_until" 기준.** 삭제 판정에 쓰는 `retain_until` 은 그 폴더 기록들의 **최댓값**. | §1 한 폴더↔여러 기록 |
| D6 | **보호 목록(DB)을 못 읽으면 그 회차는 아무 폴더도 지우지 않는다.** `errors` 에 `retention_index_unavailable` 을 남기고 반환. | 핀 데이터 삭제는 비가역, 하루 건너뛰는 것은 무해 |
| D7 | **만료 D-7 경고**는 자정 루프에서 `days_left ≤ 7` 인 폴더의 **대표 기록**(하위 단계가 아닌 기록 중 id 최소)에 `notify(kind="retention.expiring", dedupe_key=f"retention:{analysis_id}")`. dry-run 에서는 보내지 않는다. | 마스터 §2.3·§2.1 |
| D8 | **폴더 나이는 폴더명 타임스탬프 우선**(`YYYYMMDD_HHMMSS`), 실패 시 기존 14자리 → stat 폴백. | §1 의 파서 결함 |
| D9 | 프론트는 **새 페이지 없음.** `MyProjects` 행 액션 버튼 1개("보관 연장/핀") → `RetentionExtendDialog`(연장 30/90 + 핀 토글), 파일 상태 카드 3장(보관 중 / **7일 내 만료** / 만료), 상세 모달에 보관 상태 줄. | 마스터 §2.3, YAGNI |
| D10 | `GUARDED_ROUTES` 에 등록하지 않는다(플랫폼 공통 기능). | 마스터 §1-8 |

## 3. 데이터 모델

`app/models.py` `Analysis`(78~94행) 에 두 컬럼 추가:

```python
retain_until = Column(DateTime(timezone=True), nullable=True)   # 연장된 만료 시각(없으면 폴더 나이 규칙)
pinned = Column(Boolean, default=False, nullable=False)          # True 면 자동 삭제 제외
```

`app/schema_bootstrap.py` 에 `ensure_analysis_retention_columns()` 추가(기존 `ensure_analysis_job_columns` 패턴, `_add_missing_columns("analysis", {...})`) 후 `run_schema_bootstrap()` 에서 호출:

```sql
ALTER TABLE analysis ADD COLUMN retain_until DATETIME NULL
ALTER TABLE analysis ADD COLUMN pinned BOOL NOT NULL DEFAULT FALSE
```

인덱스는 두지 않는다 — cleanup 이 하루 1회 `pinned OR retain_until IS NOT NULL OR created_at BETWEEN …` 을 한 번 읽을 뿐이다.

## 4. 순수 로직 모듈 — `app/services/retention_service.py` (신규)

라우터와 `cleanup_service` 가 **같은 판정 코드**를 쓰도록 한 곳에 둔다. FastAPI·파일 삭제·알림에 의존하지 않으므로 어느 쪽에서 import 해도 순환이 없다(`program_registry` 만 import).

| 이름 | 역할 |
|---|---|
| `RETENTION_DAYS = 30` | `cleanup_service.RETENTION_DAYS` 는 여기서 re-export (기존 이름 유지) |
| `EXTENSION_MAX_DAYS = 180`, `EXPIRING_SOON_DAYS = 7`, `EXTEND_CHOICES = (30, 90)` | 상수 |
| `folder_created_at(folder_name) -> datetime \| None` | `^\d{8}_\d{6}_` 파싱 |
| `work_folder_of(record, user_connection_dir) -> str \| None` | `input_info`→`result_info` 순으로 첫 userConnection 경로의 **최상위 폴더명** |
| `base_expiry(record, folder_name)` | 폴더 생성(없으면 `created_at`) + 30일 |
| `effective_expiry(record, folder_name)` | `pinned`→`None`, `retain_until`→그 값, 아니면 `base_expiry` |
| `extension_used_days(record, folder_name) -> int` | `ceil((retain_until − base) / 1d)`, 없으면 0 |
| `days_left(expiry, now) -> int \| None` | `ceil((expiry − now) / 1d)` |
| `classify(record, folder_name, *, files_available, now) -> "expired" \| "pinned" \| "expiring" \| "available"` | 파일 없음 → expired, 핀 → pinned, `days_left ≤ 7` → expiring |
| `retention_state(record, folder_name, *, files_available, now) -> dict` | 직렬화용 (아래 §5) |
| `apply_retention_change(record, folder_name, *, extend_days, pinned, now)` | 연장 = `max(현재 만료, now) + extend_days`, 누적 > 180 이면 `RetentionLimitError`; `pinned` 는 `None` 이면 유지 |
| `primary_record(records)` | 하위 단계(`internal_substep_programs()`)가 아닌 기록 우선, 그중 id 최소 |
| `decide_folder(folder_name, records, *, folder_age_days, now) -> FolderDecision(action, expires_at, days_left, record)` | `action ∈ {keep_pinned, keep_extended, keep, delete}` — D1·D5 구현 |
| `load_retention_index(db, user_connection_dir, *, now) -> dict[folder_name, list[Analysis]]` | 보호·경고 대상 기록만 한 번 조회해 폴더명으로 묶는다 |

`load_retention_index` 의 조회 조건(한 번의 `or_`):

- `pinned IS TRUE`
- `retain_until IS NOT NULL`
- `created_at BETWEEN now−31일 AND now−22일` (기본 규칙으로 D-7 창에 드는 기록; 폴더 타임스탬프와 `created_at` 은 같은 요청에서 만들어져 초 단위로만 다르다 — `_intake._record_pending_analysis` 와 `make_work_dir` 모두 `datetime.now()`)

## 5. API

### 5.1 신규 `POST /api/analysis/{analysis_id}/retention`

- 위치: `app/routers/analysis.py`, `get_analysis_passport`(1668~1679행) 바로 뒤. `require_auth` 필수.
- Body (pydantic `RetentionUpdateRequest`):

  ```json
  { "extend_days": 30, "pinned": true }
  ```
  - `extend_days: int | null` — 1~180. `null` 이면 연장 없음.
  - `pinned: bool | null` — `null` 이면 변경 없음. (마스터 §2.3 의 `bool` 을 포함하는 상위 집합)
  - 둘 다 `null` 이면 400.
- 검증 순서: 404(없음) → 403(`assert_current_user_can_access_owner`) → 400(빈 요청/범위) → 409(파일 이미 만료, D4) → 400 `RetentionLimitError`(누적 180 초과, D2).
- 성공: `updated_at = now`, commit 후 **`_serialize_analysis(record)`** 를 그대로 반환(프론트가 행을 교체). `log_activity(db, "RETENTION_UPDATE", employee_id=current_user, action_detail={...})` 기록.

### 5.2 직렬화 확장 — 모든 `Analysis` 응답에 `retention` 블록

`_serialize_analysis`(`analysis.py:364-368`)가 `retention_state()` 를 붙인다. 컬럼 `retain_until`·`pinned` 는 `__table__.columns` 순회로 이미 포함된다.

```json
"files_available": true,
"retention": {
  "status": "expiring",            // expired | pinned | expiring | available
  "pinned": false,
  "retain_until": null,
  "base_expires_at": "2026-09-25T08:52:21",
  "expires_at": "2026-09-25T08:52:21",   // pinned 면 null
  "days_left": 7,                        // pinned 면 null, 만료 후엔 0 이하
  "extension_used_days": 0,
  "extension_remaining_days": 180
}
```

`files_available` 는 `status != "expired"` 로 같은 값을 유지한다(기존 클라이언트 호환).

### 5.3 이력 조회 `GET /api/analysis/history/{employee_id}` 의 `file_status`

기존 `available | expired` 에 **`expiring`**, **`pinned`** 을 더한다(`analysis.py:682-687` 의 인라인 비교를 `_matches_file_status(state, file_status)` 로 교체). `available` 은 종전대로 "파일이 존재"(= pinned·expiring 포함)를 뜻한다.

`include_summary=true` 의 `summary`(`_analysis_summary`, 398~433행)에 `expiringSoon`, `pinnedFiles` 추가. 기존 `expiredFiles`/`availableFiles` 는 유지.

## 6. cleanup 변경 — `app/services/cleanup_service.py`

`run_cleanup(dry_run=False, *, now=None, db=None)` 로 시그니처를 넓힌다(기존 호출 `run_cleanup()`·`run_cleanup(dry_run=True)` 는 그대로 동작; `now`/`db` 는 테스트 주입용).

```
1. entries = listdir(userConnection)
2. index = load_retention_index(db, …, now)      ← 실패 시 D6: errors 기록 후 즉시 반환(삭제 0)
3. for entry in entries:
     age = _get_folder_age_days(path, now)       ← D8: 폴더명 우선
     decision = decide_folder(entry, index.get(entry, []), folder_age_days=age, now=now)
     keep_pinned   → result["pinned"] += 1
     keep_extended → result["extended"] += 1 (+ D-7 판단)
     keep          → result["skipped"] += 1 (+ D-7 판단)
     delete        → dry_run 이면 목록만, 아니면 _force_rmtree (기존 코드)
     D-7 판단: decision.record 가 있고 0 < days_left ≤ 7 이면 result["expiring"] 에
              {folder, analysis_id, employee_id, project_name, program_name, expires_at, days_left}
4. result["notified"] = _notify_expiring(db, result["expiring"], dry_run)
```

반환 dict(기존 키 유지 + 추가):

```python
{"deleted": [...], "errors": [...], "skipped": int,
 "pinned": int, "extended": int, "expiring": [...], "notified": int}
```

`_notify_expiring` — 마스터 §2.1 그대로:

```python
try:
    from .notification_service import notify
except ImportError:
    return 0
notify(db, employee_id=item["employee_id"], kind="retention.expiring",
       title=f"결과 파일이 {days_left}일 후 만료됩니다",
       body="…My Projects 에서 보관을 연장하거나 고정할 수 있습니다.",
       link={"menu": "My Projects", "params": {"analysis_id": analysis_id}},
       dedupe_key=f"retention:{analysis_id}")
```

`link.params.analysis_id` 는 프론트의 기존 `sessionStorage('workbench:open-project-detail')` 패턴(Dashboard→MyProjects 상세 자동 열기, `MyProjects.jsx:675-686`)으로 Plan A 가 이어 붙인다 — 이 plan 은 값만 넘긴다.

스케줄러(`_cleanup_loop`·`start_cleanup_scheduler`·`shutdown_cleanup_scheduler`)는 **변경 없음**. `run_all_cleanup` 도 그대로(`run_cleanup(dry_run=dry_run)` 호출).

## 7. 프론트 UI

| 파일 | 변경 |
|---|---|
| `src/api/analysis.js` | `updateAnalysisRetention(analysisId, { extendDays, pinned })` → `POST /api/analysis/{id}/retention` |
| `src/components/ui/StatusBadge.jsx` | `STATUS_META` 에 `pinned`(success, "보관 고정", `Pin`) · `expiring`(warning, "만료 임박", `CalendarClock`) |
| `src/components/analysis/RetentionExtendDialog.jsx` (신규) | `Modal(size="sm")`: 현재 만료일·남은 연장 한도 표시, 30/90일 라디오(한도 초과 선택지는 비활성), "연장" 버튼, "핀 고정/해제" 버튼. 성공 시 `onUpdated(updatedProject)` + 토스트 |
| `src/pages/analysis/MyProjects.jsx` | `fileStatusOf` 가 `project.retention.status` 우선 · 필터 옵션 `expiring`/`pinned` · 파일 상태 카드 3장(보관 중/7일 내 만료/만료) · 행 Actions 에 `CalendarPlus` 버튼(파일 만료면 비활성) · 상세 모달 메타 줄에 만료일 + "보관 연장/핀" 버튼 · 정책 배너 문구에 연장 안내 · 갱신 후 행 교체 + `fetchHistory()` 재조회 |

행 액션을 하나만 늘리는 이유: 현재 Actions 열은 `w-24` 에 재실행·상세 2개가 들어 있다. 핀 토글까지 행에 넣으면 3열 폭을 넘는다. 핀은 다이얼로그 안에서 토글한다.

## 8. 테스트 (pytest, `tests/conftest.py` fixture 재사용)

| 파일 | 검증 |
|---|---|
| `tests/test_schema_bootstrap_retention.py` | 레거시 `analysis` 테이블(컬럼 없음)에 두 컬럼이 생기고 두 번 호출해도 멱등 |
| `tests/test_retention_service.py` | 폴더명 파싱 · `work_folder_of` · 만료 우선순위(D1) · 누적 상한(D2) · `classify` 4상태 · `decide_folder`/`primary_record`(D5·D7) |
| `tests/test_cleanup_retention.py` | `tmp_path` 를 `_USER_CONN_DIR` 로 주입: 핀 폴더 보존·연장 폴더 보존/만료 삭제·일반 40일 폴더 실제 삭제·D-7 목록과 `notify` 호출(가짜 모듈 `sys.modules` 주입, dedupe_key 검증)·하위 단계 기록 알림 중복 없음·DB 실패 시 삭제 0(D6) |
| `tests/test_analysis_retention_api.py` | `switchable_client`: 소유자 200 / 타인 403 / 관리자 200 / 404 / 빈 body 400 / 누적 초과 400 / 만료 409 · `GET /analysis/{id}` 의 `retention.status` · `file_status=expiring` 필터와 `summary.expiringSoon` |

프론트는 러너가 없으므로 plan 에 수동 검증 절차를 쓴다.

## 9. 서버(145) 반영 구분

- **`git pull` + 백엔드 재시작으로 끝** — 백엔드 변경은 전부 git 추적 파일(`models.py`, `schema_bootstrap.py`, `retention_service.py`, `cleanup_service.py`, `analysis.py`). 재시작 시 `run_schema_bootstrap()` 이 두 컬럼을 자동 추가한다.
- **프론트 재배포 필요** — `MyProjects`·`StatusBadge`·`api/analysis.js`·`RetentionExtendDialog` 는 Electron 빌드(`npm run dist`)에 포함돼야 한다. 구 클라이언트는 `retention` 블록을 무시하고 `files_available` 만 읽으므로 백엔드 선반영은 안전하다.
- **InHouse 수동 교체 없음.**
- Plan A(알림 센터)가 아직 없으면 D-7 경고는 `notified: 0` 으로 조용히 건너뛴다. Plan A 가 들어오면 코드 수정 없이 알림이 켜진다.

## 10. 범위 밖 (하지 않는다)

- 관리자 화면(`AnalysisManagement`)의 핀/연장 UI — API 는 관리자를 허용하지만 UI 는 `MyProjects` 만.
- Truss Assessment 전용 상세 모달(`AssessmentProjectModal`)의 보관 섹션 — 행 액션 버튼이 모든 프로그램을 덮는다.
- `retain_until` 인덱스, 알림 테이블(Plan A), 사용자 환경설정(Plan E).
