# 배치 실행 + 큐 우선순위 — 설계 (Plan H)

- 작성일: 2026-09-18
- 상위 규약: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1(공통 규칙) · §2.1(알림 지연 import) · **§2.5(Plan D — 이 plan 이 하드 의존)** · §2.8(이 plan 이 소유) · §3(실행 순서 9번, Plan D 완료 후).
- **하드 의존**: 이 plan 은 Plan D 가 만든 `job_status_store.cancel(job_id)`·`register_process`·`attach_future`·`current_job_id()`·`TERMINAL_STATUSES`·`JobCancelledError` 계약을 그대로 쓴다. Plan D 가 병합·배포되기 전에는 H 를 시작하지 않는다(§3 표의 유일한 "hard" 의존). Plan D §10 의 접점 항목이 이 문서의 §4·§5 이다.
- 대상: `HiTessWorkBenchBackEnd/`(FastAPI) + `HiTessWorkBench/frontend/`(React). InHouse 프로그램은 건드리지 않는다.
- 구현 plan: `docs/superpowers/plans/2026-09-18-batch-runs-and-queue-priority.md`

## 1. 배경 / 문제

`job_manager.py:13` 의 `MAX_CONCURRENT_JOBS = 5`, `:235` 의 `analysis_executor = ManagedAnalysisExecutor(5)` 는
**한 개의 ThreadPoolExecutor** 다. 유일한 호출자 `_intake.py:171` 이 `analysis_executor.submit(task_fn, job_id, *task_args)` 로
모든 종류의 해석을 같은 풀에 던진다. 이 구조가 두 가지를 만든다.

- **계산기 굶주림.** Nastran/Cmb.Cli 계열 무거운 작업 5개가 풀을 점유하면 Column Buckling·Mast Post 같은
  1~10초 계산기까지 대기열에서 몇 분씩 잔다. `input_keys` 만으로 정의되는 파라메트릭 앱은 사용자 관점에서
  "즉시 결과"인 앱인데, 큐 정책은 그 성질을 모른다.
- **매트릭스 조회의 수공업.** Mast Post 40 후보·Jib Rest 파이프 조합처럼 **입력만 다른 반복 실행**을
  현재는 사용자가 화면에서 40번 눌러 40개의 개별 해석을 만든다. `program_registry` 가 이미 `input_keys` 로
  단일 실행의 입력 스키마를 확정해 뒀는데, 이걸 재사용하는 배치 진입점이 없다.

이 plan 은 (1) 풀을 **`heavy`(3) / `light`(4)** 2개로 분리해 계산기가 굶지 않게 하고, (2) 파라메트릭·Interactive
앱에 공용 **`BatchRunPanel`** 과 `POST /api/analysis/batch` 를 붙여 케이스 표 → 다건 실행 → 진행률 → 취소를
한 카드로 다룬다.

## 2. 확정 결정

| # | 결정 | 이유 |
|---|---|---|
| 1 | **풀은 두 개, 총 워커 7개(현재 5).** `heavy_executor(3)` / `light_executor(4)`. `job_manager.MAX_CONCURRENT_JOBS` 는 하위 호환 상수로 `HEAVY_MAX_WORKERS + LIGHT_MAX_WORKERS` 를 돌려주도록 유지 | 마스터 §2.8. 서버(145) 는 8코어급이라 7개 워커는 안전. nastran/Cmb.Cli 는 solver 내부에서 이미 다중 코어를 쓰므로 heavy=3 이 상한, light 는 IO·계산기라 4개 |
| 2 | **`ProgramSpec.queue_class: Literal["heavy","light"] = "light"`** 신규 필드. Plan H 가 각 spec 에 명시적으로 값을 붙인다 | 마스터 §2.8. 기본이 light 라서 미분류 프로그램·미래 스펙이 계산기 풀로 흘러도 안전(nastran 이 light 로 새면 눈에 띈다) |
| 3 | **적용 범위 = 파라메트릭·Interactive 앱**(`capabilities` 에 `"calculator"` 포함 + `input_keys` 비어 있지 않음). 실측 대상 8개(§3.2 표) | 마스터 §2.8. 파일 기반 앱(csv/bdf 업로드) 의 케이스 매트릭스는 업로드 UX·용량·중복 저장이 별건이라 이번 범위 밖 |
| 4 | **배치는 케이스마다 별도 `Analysis` 레코드.** 상위 `batch_runs` 로 묶고 `Analysis.batch_id` non-FK Integer NULL | MyProjects·결과 조회·재실행이 기존 흐름 그대로 도는 게 이득이 크다. 케이스 취소·재실행이 원자 단위로 존재 |
| 5 | **취소는 배치·개별 두 층.** 배치 취소 = 아직 실행 안 한 케이스는 즉시 Cancelled, 실행 중은 Plan D `cancel(job_id)` 로 트리 종료. 개별 케이스 취소는 기존 `POST /api/analysis/{job_id}/cancel` 그대로 | Plan D 는 이미 대기 중(`future.cancel`)·실행 중(`terminate_process_tree`)을 다 다룬다. 배치 라우터는 사용자를 대신해 순회만 |
| 6 | **재시도는 수동, 자동 재시도 없음.** 실패 케이스는 MyProjects 배치 상세에서 "이 케이스만 다시 실행"(기존 `rerun_adapter`) | 자동 재시도는 실패 원인을 감춘다. `run_nastran` 이 라이센스 대기로 실패하는 시나리오가 실사용에 흔한데, 두 번 돌려도 같은 결과 |
| 7 | **`batch.completed` 알림 1건만.** 케이스별 `job.completed`/`job.failed` 알림은 배치 소속이면 억제 | 40 케이스 배치가 40개 알림을 쏘면 알림 센터가 무의미해진다. `notify_job_terminal`(Plan A §4.2) 이 `record.batch_id is not None` 이면 조기 반환 |
| 8 | **진행률은 서버가 집계.** `batch_runs.total/done/failed` 를 `job_manager._write_through` 에서 케이스가 terminal 로 갈 때 원자적으로 갱신 | 프론트가 케이스 40개를 개별 폴링하지 않아도 되게 한다. 최종 상태 판정도 서버에서 결정(§4.3) |
| 9 | **부분 성공 = Completed.** 배치 상태는 `모두 성공 → Completed / 하나라도 성공 → Completed(failed>0) / 전부 실패 → Failed / 사용자 취소 → Cancelled` | Mast Post 40 후보 중 3개가 재료 미등록으로 실패해도 나머지 37개는 결과다. "일부만 실패" 를 성공 계열로 통과시켜야 후속 비교·리포트가 살아난다 |
| 10 | **케이스 상한 50건.** 라우터에서 반환 422 | 40 후보 매트릭스 실사용 + 여유 25%. 상한 없이 열면 서버 메모리·DB 로 폭주 |
| 11 | **관리자 우선순위 승격만.** 특정 배치의 `queue_class` 를 heavy→light 로 옮기는 관리자 액션은 만들지만, 사용자별 쿼터·프리엠션·복수 우선순위는 만들지 않는다 | 마스터 §2.8·§1-7 YAGNI. 현행 5명 워커풀에서 사용자 쿼터는 과설계 |
| 12 | **`GUARDED_ROUTES` 미등록.** 배치 라우터는 플랫폼 공통 | 마스터 §1-8. 대상 App 의 App Settings 이 이미 개별 `/api/analysis/{type}/request` 를 지키고, 배치는 그것을 내부 호출한다 |
| 13 | **파일 입력 케이스는 없다.** `program_registry` 에서 `input_keys` 가 파일 경로 계열(csv/bdf/pdf) 인 프로그램은 배치 대상 미포함 | 마스터 §2.8 "파일 입력은 1회 업로드 후 공유" 는 이번 범위 밖. 이번엔 `input_json` 만 있는 8개 프로그램으로 한정 |
| 14 | **보관 90일**, 배치의 만료는 소속 케이스 중 **가장 늦게 만료되는 것**을 따른다 | Plan B 의 `retain_until` 이 케이스별로 붙는데, 배치 요약 행이 케이스보다 먼저 사라지면 MyProjects 화면이 부서진다 |

## 3. 데이터 모델

### 3.1 `batch_runs` (신규, `app/models.py`)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | Integer PK | |
| `employee_id` | String(50) NOT NULL, **index** | 소유자 |
| `program_id` | String(50) NOT NULL, **index** | `ProgramSpec.program_id` |
| `name` | String(200) NOT NULL default '' | 사용자 라벨(예: "H600 후보 스캔") |
| `status` | String(20) NOT NULL default `'Running'` | `Running`·`Completed`·`Failed`·`Cancelled` (마스터 어휘 재사용, `Interrupted` 는 배치엔 없다) |
| `total` | Integer NOT NULL | 제출 시 확정, 이후 불변 |
| `done` | Integer NOT NULL default 0 | Success 로 마감된 케이스 수 |
| `failed` | Integer NOT NULL default 0 | Failed·Cancelled 로 마감된 케이스 수 |
| `created_at` | DateTime default now, **index** | naive `datetime.now()` |
| `updated_at` | DateTime NULL | 마지막 케이스 마감 시각 |

- 인덱스는 목록 정렬용 `(employee_id, created_at desc)` 하나 추가.
- FK 는 걸지 않는다(Plan G 의 `project_id` 와 같은 이유 — `analysis` 테이블이 대량이고 백필 실패 시 스키마 부트스트랩이 서버 기동을 막는다).

### 3.2 `Analysis.batch_id` (기존 테이블, 컬럼 추가)

`Analysis.batch_id: Integer NULL, index`. `schema_bootstrap.ensure_analysis_columns()` 에 멱등 ADD.
케이스 배치가 아닌 개별 실행은 계속 NULL.

### 3.3 `ProgramSpec.queue_class`

`services/program_registry.py:29-56` `ProgramSpec` 에 `queue_class: str = "light"` 필드 추가.
`__post_init__` 에서 `{"heavy","light"}` 검증. 각 spec 에 명시:

| program_id | queue_class | 근거 |
|---|---|---|
| `truss-model-builder`, `truss-assessment`, `bdf-scanner`, `hp-scr-psa`, `hp-scr-por`, `f06-parser`, `mooring-fitting`, `mooring-fitting-solve`, `hitess-modelflow`, `hitess-model-builder`, `model-builder-analysis`, `group-module-unit`, `side-passage`, `hull-acceleration`, `drawing-to-analysis`, `plate-structure`, `double-pipe-fuel-line`, `module-stability`, `module-hoist-optimize`, `unit-structural-analysis` | `heavy` | nastran/Cmb.Cli/PSA/도면 엔진 — Plan D §1.4 에서 60초 초과로 분류된 것들 |
| `simple-beam` | `heavy` | JSON 입력이지만 내부에서 nastran 을 돌린다(`analysis_runner.run_engine`) |
| `carling-free`, `carling-optimization`, `column-buckling`, `mast-post`, `jib-rest`, `d-type-lug`, `hole-fatigue`, `section-property` | `light` | 순수 계산·30초 이내(Plan D §1.4 C 그룹) — **배치 대상 8개와 정확히 일치** |
| `independent-tank`, `block-weld`, `heavy-block-lifting` | `light` | 외부 앱 프록시(`external-app`), job_manager 를 거의 안 씀 |

이 8개(`calculator` + `input_keys` 있음, `input_json` 하나) 가 §2-3 의 배치 대상이다.

## 4. 서비스

### 4.1 `job_manager` — 풀 분리(`app/services/job_manager.py`)

```python
HEAVY_MAX_WORKERS = 3
LIGHT_MAX_WORKERS = 4
MAX_CONCURRENT_JOBS = HEAVY_MAX_WORKERS + LIGHT_MAX_WORKERS   # 하위 호환

class ManagedAnalysisExecutor:
    def __init__(self, *, heavy: int, light: int): ...
    def submit(self, fn, /, *args, queue_class: str = "light", **kwargs): ...
```

- 내부 `_pools: dict[str, ThreadPoolExecutor] = {"heavy": ..., "light": ...}`. 나머지(inflight 카운트·shutdown·start 재진입) 는 현행 `:169-230` 를 클래스별이 아니라 **풀별**로 복제. `_inflight` 는 풀별 dict.
- `submit(fn, *args, queue_class=..., **kwargs)` 는 알려지지 않은 값이면 `ValueError`. Plan D §3.2 의 **첫 위치 인자 = job_id** 계약을 유지(`_bind_job_context`·`attach_future` 그대로).
- **기본값 `"light"`.** `_intake.submit_analysis_job` 은 `program_registry.resolve_program(program_name).queue_class` 를 읽어 `submit(..., queue_class=…)` 로 전달. 미등록 프로그램은 light.
- `get_queue_stats` 는 풀별 running/queued 를 합산해 기존 스키마(`runningJobs`, `queuedJobs`)를 그대로 돌려주되, 새 키 `pools: {"heavy": {...}, "light": {...}}` 를 추가.
- `analysis_executor = ManagedAnalysisExecutor(heavy=HEAVY_MAX_WORKERS, light=LIGHT_MAX_WORKERS)` 싱글턴. 모듈 수준 API(`shutdown_job_manager`·`start_job_manager`) 는 인자 없이 그대로.

### 4.2 `batch_run_service` (신규, `app/services/batch_run_service.py`)

```python
@dataclass(frozen=True)
class BatchCase:
    label: str
    input_info: dict

def create_batch(db, *, owner: str, program_id: str, name: str,
                 cases: list[BatchCase]) -> models.BatchRun
def mark_case_terminal(db, *, batch_id: int, case_status: str) -> models.BatchRun | None
def get_progress(db, batch_id: int) -> dict
def cancel_batch(db, *, batch_id: int, requester: str) -> dict
```

- `create_batch`:
  1. `ProgramSpec` 조회, `queue_class`·`input_keys` 검증. `capabilities` 에 `"calculator"` 없거나 `input_keys` 가 파일 계열이면 400.
  2. `BatchRun(status="Running", total=len(cases), done=0, failed=0)` 를 먼저 커밋해 `batch_id` 확보.
  3. 케이스마다 `_intake.submit_analysis_job` 을 **직접 함수 호출**로 재사용(HTTP 를 다시 밟지 않는다). `program_name` = spec.display_name, `input_info` = case.input_info, `project_name` = f"{batch.name} · {case.label}", `batch_id` = batch.id. `submit_analysis_job` 은 이미 `Analysis` 를 만들고 job_id 를 돌려주므로, 배치 서비스는 그 job_id 로 `Analysis.batch_id` 를 UPDATE.
  4. `submit_analysis_job` 이 개별 케이스마다 예외를 던지면 그 케이스만 즉시 `failed += 1`, DB 에 `status="Failed"` 로 기록하고 다음 케이스로 진행(배치 자체는 실패시키지 않음).
- `mark_case_terminal(status)`: 케이스가 Success/Failed/Cancelled 로 갈 때 §5.1 훅이 호출. `done/failed` 를 원자 UPDATE 로 증가시키고, `done + failed == total` 이면 §2-9 규칙으로 배치 status 를 최종 결정, `updated_at` 을 찍고, 소유자에게 `notify(kind="batch.completed")`. `Cancelled` 카운트는 `failed` 에 합산(사용자 관점에서 "결과 없음").
- `cancel_batch`: 배치의 케이스별 `job_status_store.cancel(case.job_id)` 를 순회(**Plan D API 직접 호출**, HTTP 재진입 안 함). 반환은 성공/실패 카운트. 모든 케이스가 Cancelled 로 마감되면 배치 status 는 `Cancelled`.
- `get_progress`: `{total, done, failed, remaining, status, cases:[{analysis_id, job_id, label, status, progress}]}`.

### 4.3 최종 상태 판정

```python
def resolve_batch_status(*, total: int, success: int, failed: int, cancelled: int) -> str:
    if success + failed + cancelled < total: return "Running"
    if cancelled == total: return "Cancelled"
    if success == 0: return "Failed"
    return "Completed"   # success >= 1, failed 또는 cancelled 가 섞여도 Completed
```

- `success` 는 `done - (Cancelled 카운트)` 가 아니라 실제 Success 케이스 수. 컬럼은 `done/failed` 두 개지만 `mark_case_terminal` 내부에서 status 별 카운터를 세워 판정한다(스키마를 늘리지 않는다).
- 순수 함수라 `tests/test_batch_run_service.py` 에서 테이블로 검증.

## 5. 발신 훅

### 5.1 케이스 → 배치 집계 (`job_manager._write_through`)

Plan D 가 이미 손댄 지점(현재 파일 `:110`). Plan D 배포 후 상태 전이 규칙 위에 **한 블록 추가**:

```python
if status in ("Success", "Failed", "Cancelled") and record.batch_id:
    try:
        from app.services.batch_run_service import mark_case_terminal
        mark_case_terminal(db, batch_id=record.batch_id, case_status=status)
    except Exception:
        db.rollback()   # 배치 갱신 실패가 케이스 상태 저장을 되돌리지 않도록 분리
        logger.warning(...)
```

Plan A 의 `notify_job_terminal` 은 `record.batch_id is not None` 이면 조기 반환(§2-7). Plan D 의 `Cancelled` 지속성 규칙과 겹치지 않도록 배치 훅은 `record.status` 를 갱신한 **뒤** 발화.

### 5.2 배치 완료 알림

`mark_case_terminal` 이 배치를 terminal 로 만들면:

```python
notify(db, employee_id=batch.employee_id, kind="batch.completed",
       title=f"{display_name} 배치 완료" if status == "Completed"
             else f"{display_name} 배치 실패" if status == "Failed"
             else f"{display_name} 배치 중단",
       body=f"{success}/{total} 성공" + (f", {failed_count} 실패" if failed_count else ""),
       link={"menu": "My Projects", "params": {"batch_id": batch.id}},
       dedupe_key=f"batch:{batch.id}", dedupe_unread_only=False)
```

`notify` 가 없으면(현재/Plan A 미배포) 조용히 건너뛴다(마스터 §2.1). `notify_job_terminal` 억제 규칙과 합쳐, **40 케이스 배치 = 알림 1건**.

## 6. API (`app/routers/batch_runs.py`, prefix `/api/analysis`, 전부 `require_auth`)

| 메서드·경로 | 요청 | 응답 | 비고 |
|---|---|---|---|
| `POST /api/analysis/batch` | `{"program_id": str, "name": str, "cases": [{"label": str, "input_info": dict}]}` | 202 `{"batch_id": int, "total": n, "cases": [{"case_label","analysis_id","job_id","queue_position"}]}` | 케이스 수 1~50, 초과 422 |
| `GET /api/analysis/batch/{id}` | — | `{"batch": {...}, "cases": [...]}` §4.2 `get_progress` 그대로 | 소유자 or 관리자(`can_view` — Plan G 이후엔 프로젝트 멤버 포함) |
| `POST /api/analysis/batch/{id}/cancel` | — | `{"batch_id","status","cancelled_cases": int, "already_terminal": int}` | Plan D 의 `job_status_store.cancel(job_id)` 를 케이스별 순회 |
| `POST /api/admin/analysis/batch/{id}/promote` | `{"queue_class": "heavy"\|"light"}` | `{"promoted": int}` | 관리자 전용(§2-11). 아직 실행 안 한 케이스의 대기 큐 이동 — Future 를 새 풀에 재제출(가능한 경우), 이미 running 은 무시 |

- `main.py` 의 `include_router` 목록(현재 `reports.router` 가 마지막)에 추가. `GUARDED_ROUTES` **미등록**(§2-12).
- 케이스 검증: `program_registry.resolve_program(program_id)` 필수, `queue_class == "light"` 필수(이번 범위), `input_keys` 가 모든 case.input_info 에 포함돼야 400. `input_info` 는 프로그램별 어댑터가 재검증(기존 rerun 어댑터 재사용).
- `POST /batch/{id}/cancel` 은 라우터 레벨에서 소유권 확인(`can_edit`) 후 `batch_run_service.cancel_batch(batch_id=..., requester=...)` 호출.

## 7. 프론트

### 7.1 배치 입력 패널

- `HiTessWorkBench/frontend/src/components/analysis/BatchRunPanel.jsx`(신규, 재사용). props: `programId`, `inputKeys`, `defaultCases: []`, `onSubmitted(batchId)`.
- 표 편집기: 행 = 케이스, 열 = `inputKeys[]` + "라벨" + 행 액션(복제·삭제). 상단에 "행 추가"·"CSV 붙여넣기"(엑셀에서 복붙 지원). 하단에 "실행"(케이스 0/50 카운터·초과 시 disabled).
- 각 파라메트릭 페이지(`MastPostAssessment.jsx`·`JibRestAssessment.jsx`·`DTypeLugAssessment.jsx`·`ColumnBucklingCalculator.jsx`·`SectionPropertyCalculator.jsx`·`HoleFatigueAssessment.jsx`·`CarlingCalculator.jsx`) 는 **기존 단건 실행 폼 옆에 "배치 실행" 아코디언**을 추가하고 이 컴포넌트를 심는다. 각 페이지의 단건 폼 로직·검증은 그대로 유지.
- API: `src/api/analysis.js` 에 `submitBatch(programId, name, cases)` · `getBatch(id)` · `cancelBatch(id)` 추가. 페이지에서 직접 axios 를 부르지 않는다(마스터 §1-10).

### 7.2 진행률·취소

- 제출 성공 시 페이지에 `BatchProgressCard`(BatchRunPanel 하위) 노출: 진행률 `done/total` 막대, 실패 카운트, 케이스 리스트(가상 스크롤). 폴링은 `usePolling(2s, () => getBatch(id))` 사용, terminal(`Completed/Failed/Cancelled`) 이 오면 자동 중단.
- "중단" 버튼 → `ConfirmDialog`("케이스 N개를 취소합니다") → `cancelBatch(id)`. Plan D 의 `ConfirmDialog` 를 그대로 재사용.
- Job Center(`UtilityDock`): **배치 = 카드 1개**. `patchGlobalJob` 을 `batch_id` 도 저장하게 확장, 종료 시 배치 요약("Completed 37/40, Failed 3") 을 표시. 케이스별 카드는 만들지 않는다(§2-7 근거의 UI 등가물).

### 7.3 MyProjects

- 필터에 "배치만" 토글. 행 렌더링 = `batch_id` 가 같은 케이스를 **부모 행 하나로 접기**(`components/analysis/BatchRowGroup.jsx`, `MyProjects.jsx:642` 필터 로직 옆). 클릭하면 자식 케이스 행이 펼쳐진다.
- 배치 상세 모달: 케이스 표(기존 상세 모달 재사용) + 배치 요약(총 소요·failed 수·발신 알림 링크).
- 실패 케이스만 재실행: 각 케이스 행의 "다시 실행"(기존 rerun 버튼) 그대로. 재실행 결과는 **원래 배치에 소속되지 않는 별도 개별 실행**(재시도는 새 batch 를 만들지 않음, §2-6).

## 8. 보관

- `batch_runs` 90일(`BATCH_RETENTION_DAYS = 90`). `cleanup_service.run_all_cleanup()` 에 `run_batch_run_cleanup(dry_run)` 추가, 결과 dict 에 `"batch_runs"` 키.
- 만료 판정: `batch.updated_at` 이 아니라 **소속 케이스 중 가장 늦은 `retain_until` 또는 `updated_at`** 을 본다(§2-14). Plan B 의 `retain_until` 이 케이스에만 붙어 있으므로 join query 한 번. 케이스가 하나도 없거나 전부 사라진 배치는 즉시 정리 대상.
- `Analysis.batch_id` 를 가진 케이스가 정리 대상으로 잡히면, 케이스 삭제 후 배치 요약의 카운터를 감소시키지 않는다(과거 사실 그대로 남긴다). 배치 자체 만료는 위 규칙에 맡긴다.

## 9. 테스트

백엔드(pytest, `tests/conftest.py` fixture 재사용):

| 파일 | 검증 |
|---|---|
| `tests/test_batch_run_models.py` | `create_all` 로 `batch_runs` 생성, `Analysis.batch_id` 컬럼이 `ensure_analysis_columns` 로 채워짐(멱등) |
| `tests/test_batch_run_service.py` | `resolve_batch_status` 표(9행 — 5,5,0,0 / 5,4,1,0 / 5,0,5,0 / 5,0,0,5 / 5,3,1,1 / 5,3,0,0(Running) …), `create_batch` 가 케이스마다 Analysis 를 만들고 `batch_id` 를 채움, `mark_case_terminal` 이 원자 갱신 및 최종 상태 판정, `cancel_batch` 가 Plan D `cancel()` 을 monkeypatch 로 호출 |
| `tests/test_batch_run_router.py` | 201 정상, 51 케이스 422, 파일 계열 프로그램 400, 권한 403(타인), `GET /batch/{id}` 진행률, `POST /batch/{id}/cancel` 200(2개 케이스 종료·1개 이미 terminal) |
| `tests/test_job_manager_pools.py` | `submit(fn, "job1", queue_class="heavy")` 이 heavy 풀에 들어가고 light 풀은 비어 있음, heavy 풀 3개 점유 시 4번째 heavy 는 대기하지만 light 는 즉시 실행(굶주림 방지), `get_queue_stats` 의 `pools` 키, Plan D 계약(`current_job_id`, `attach_future`) 이 풀 분리 후에도 동작 |
| `tests/test_batch_run_notify.py` | 케이스별 `notify_job_terminal` 억제(`record.batch_id is not None`), 배치 마감 시 `batch.completed` 1건, 부분 실패 body 문구 |
| `tests/test_batch_run_cleanup.py` | 케이스 만료 정책(§8) + `run_all_cleanup` 반환 키 |

프론트(러너 없음 → plan 의 수동 검증 절차): `npm run dev` → Mast Post → "배치 실행" 아코디언 열기 → 5 케이스 편집 → 실행 → 진행률 카드 → 3번째 케이스 진행 중에 "중단" → 남은 케이스가 즉시 Cancelled, 실행 중이던 것은 취소 응답 이후 종료 → MyProjects 에 배치 부모 행 1개(자식 5개), 알림 센터에 `batch.completed`(Plan A 있을 때) 1건.

## 10. 서버(145) 반영 구분

- 백엔드: **`git pull` + 백엔드 재시작 필요.** `MAX_CONCURRENT_JOBS` 는 상수 재계산이라 무리는 없지만 풀이 5→3+4=7 로 바뀌므로 **재시작이 필수**(현행 5-worker 풀은 프로세스 전역). 스키마: `batch_runs` 는 `create_all`, `Analysis.batch_id` 는 `schema_bootstrap.ensure_analysis_columns()`. 신규 pip 의존성 없음.
- 프론트: **재배포 필요**(WorkBench 포터블 exe — `BatchRunPanel` · MyProjects 배치 행 · Job Center 카드).
- InHouse 프로그램: **없음.** 대상 8개 계산기는 모두 파이썬 In-Process 로직이라 exe 교체 없음.

## 11. 비목표

- **파일 매트릭스 배치**(csv/bdf 업로드를 케이스별로) — 업로드 UX·중복 저장·work_dir 공유가 별건. 마스터 §2.8 그대로 이번엔 파라메트릭만.
- **크로스-프로그램 배치**(한 배치에 Mast Post + Column Buckling 을 섞기) — 케이스별 `program_id` 를 도입하면 스키마·필터·리포트가 전부 배가 된다.
- **케이스 간 의존성**(A 결과를 B 입력으로) — DAG 러너는 별도 plan.
- **관리자 사용자별 쿼터**(사번당 동시 heavy 상한) — 마스터 §2.8 명시 제외.
- **2개 풀 이상의 우선순위 클래스**(critical/normal/low) — 두 풀 이상은 굶주림 문제를 다시 만든다.
- **자동 재시도** — §2-6. 실패 원인이 라이센스·모델 불량이면 재시도가 해결하지 않는다.
- **배치 템플릿 저장**(케이스 표를 이름 붙여 저장) — Plan C(입력 프리셋) 의 확장으로 별건. 이번엔 CSV 붙여넣기까지만.
- **WebSocket 실시간 케이스 표** — 마스터 §2.1 폴링 원칙 유지.
