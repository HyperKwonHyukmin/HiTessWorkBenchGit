# Plan D — 작업 취소의 일반화 설계

- 작성일: 2026-09-18
- 상위 규약: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1(공통 규칙), §2.1(알림 지연 import), **§2.5(이 문서의 담당)**, §3(실행 순서 — Plan H 가 이 문서의 `cancel`/`register_process` 에 의존).
- 범위: 백엔드 `job_manager` 취소 코어 + 공용 실행 래퍼 + 취소 API + 이중관 PSA 취소의 위임 + Job Center "중단" 버튼. InHouse 프로그램은 건드리지 않는다.
- 구현 plan: `docs/superpowers/plans/2026-09-18-job-cancel.md`

## 1. 배경 — 지금은 무엇이 없는가

### 1.1 취소는 이중관 PSA 한 곳에만 있다

`POST /api/doublepipe/run-psa/cancel`(`app/routers/doublepipe.py:305-318`) → `doublepipe_psa_service.cancel_psa_job`(`:1558`) 이 유일한 취소 경로다. 이 서비스는 **자체 인메모리 스토어 `_jobs`** 와 단일 라이센스 슬롯 `_active_job_id` 를 갖고, Popen 을 다음 방식으로 추적한다.

- `_run_pipeline`(`:760`)이 `subprocess.Popen(...)` 직후 `_jobs[job_id]["_process"] = proc`, `["pid"] = proc.pid` 를 **락 안에서 publish** 하고 `_processReady` Event 를 set 한다(`:813-821`).
- 취소는 `job["_cancelRequested"] = True` 를 먼저 기록해 `_finish` 가 done/timeout 으로 덮어쓰지 못하게 한 뒤(`:1574`), `_cancel_running_process`(`:1483`)가 `_processReady.wait()` → `_terminate_process_tree`(`:696`) 순으로 진행한다.
- 트리 종료는 `_kill_process_tree`(`:1251`): psutil 로 `children(recursive=True)` 스냅샷 → Windows `taskkill /F /T /PID` → 스냅샷 생존자 `terminate()`/`kill()` → 소멸 검증.

이 패턴(취소 의사 선기록 → Popen publish 핸드셰이크 → 트리 종료 → 상태 전이)이 일반화의 원형이다. 단, PSA 의 상태 어휘(`running/failed`, `diagnostic="cancelled"`, `returncode=-3`)와 라이센스 슬롯 로직은 PSA 고유라 그대로 둔다.

### 1.2 `job_manager` 는 future 도 Popen 도 모른다

`app/services/job_manager.py`:

- `JobStatusStore`(`:27`)는 `{job_id: {status, progress, message, employee_id, _metadata, _created_at, _seq}}` 만 갖는다. `set`(`:44`)·`update_job`(`:51`)·`get`(`:58`)·`get_queue_stats`(`:77`)·`_write_through`(`:110`, `PERSISTED_STATUS_FIELDS={"status","progress","message"}` 만 DB 반영)·`_cleanup_loop`(`:140`, `Success/Failed` 만 24h 후 삭제).
- `ManagedAnalysisExecutor.submit`(`:184`)은 `executor.submit(fn, *args)` 의 Future 를 **반환만** 하고 보관하지 않는다. 유일한 호출자 `app/routers/_intake.py:171` 은 `future = analysis_executor.submit(task_fn, job_id, *task_args)` 뒤 `_handle_future_result` done 콜백만 붙인다(`:186-187`). 즉 대기 중 작업을 `future.cancel()` 할 방법이 없다.
- 실행 중 작업이 띄운 Popen 은 각 서비스의 지역 변수다. 취소 API 가 닿을 방법이 없다.

### 1.3 상태 어휘

| 값 | 백엔드 사용처 | 의미 |
|---|---|---|
| `Pending` / `Running` | `_intake.submit_analysis_job`(`:154`), `analysis_runner.mark_running`(`:48`) | 대기 / 실행 |
| `Success` / `Failed` | `analysis_runner.mark_complete`(`:295`), `_write_through`(`:127`) | 종료 |
| `Interrupted` | **`app/main.py:111` 한 곳** — 서버 기동 시 DB 의 `Pending/Running` 을 일괄 `Interrupted`(+`status=Failed`) 로 바꾸는 sweep | 서버 재시작으로 유실 |

프론트는 `Success/Failed/Interrupted` 를 terminal 로 본다: `utils/globalJobs.js:19`, `components/platform/UtilityDock.jsx:21`, `hooks/usePolling.js:74`, `hooks/useAnalysisJob.js:57,139,186`, `components/platform/AnalysisResultPanel.jsx:10,28`, `components/ui/StatusBadge.jsx:19`, `contexts/DashboardContext.jsx:612`. `Interrupted` 는 "우리가 중단했다"가 아니라 "서버가 죽어 잃었다"이므로 사용자 취소를 여기에 섞으면 안 된다 → 새 상태 **`Cancelled`**.

### 1.4 subprocess 직접 호출 전수 조사(실측, 2026-09-18)

마스터 §2.5 의 목록은 추정이었다. `grep -rn "subprocess\.\(Popen\|run\)" app/services app/routers` 결과를 **작업(job) 안에서 도는 장시간 프로세스** 기준으로 분류했다.

**A. 이미 공용 래퍼(`analysis_runner.run_subprocess_killtree`)를 쓰는 곳 — 래퍼에 등록만 붙이면 끝**

| 파일:줄 | 명령 | timeout |
|---|---|---|
| `unit_structural_service.py:204` | nastran.exe (SOL 101) | 1800 |
| `module_ocean_structural_service.py:126` (`_run_nastran`) / `:138` (bridge) | nastran.exe / nastran_bridge | `NASTRAN_TIMEOUT_SEC` / `BRIDGE_TIMEOUT_SEC` |
| `groupmoduleunit_service.py:633` (`_run_nastran_validate`) | nastran.exe (validate-run) | 600 |

**B. `subprocess.run` 직접 호출 — 래퍼로 교체해야 하는 곳(Tier 1: 해석기·엔진, 60초 초과)**

| 파일:줄 | 함수 | 명령 | timeout | 비고 |
|---|---|---|---|---|
| `plate_structure_service.py:371` | `task_execute_plate_structure` | nastran.exe | 1800 | bytes 모드, `_decode_completed` |
| `plate_structure_service.py:391` | 〃 | nastran_bridge(f06 파싱) | 300 | 같은 task 안 — 함께 교체 |
| `modelbuilder_solve_service.py:218` | `task_execute_modelbuilder_solve`(내부 `step`) | `nastran solved_model.bdf` | 900 | `FileNotFoundError`/`TimeoutExpired` 분기 유지 |
| `hitess_modelflow_service.py:153` | `task_execute_modelflow` | `Cmb.Cli.exe build-full` | 1200 | text/utf-8 |
| `hitess_modelflow_service.py:458` | `_run_nastran_on_bdf` | nastran.exe | 1800 | text/utf-8 |
| `hitess_modelflow_service.py:490` | `_run_f06parser` | F06Parser.Console.exe | 300 | cp949 디코드 |
| `hitess_modelflow_service.py:552` | `task_execute_apply_edit` | `Cmb.Cli.exe apply-edit-intent` | 600 | text/utf-8 |
| `mooring_fitting_service.py:60` (`_run_capture`) | 호출자 `:247`(build-full) `:448`(solve-bdf) `:561`(report verb) | MooringFitting.exe(내부에서 nastran 손자) | `TIMEOUT_SECONDS`/`SOLVE_TIMEOUT_SECONDS`/`REPORT_TIMEOUT_SECONDS` | 자체 Popen+taskkill 래퍼 → 공용 래퍼로 흡수 |
| `module_stability_service.py:61` / `:172` | `task_execute_module_stability` / `task_optimize_module_hoist_positions` | GroupModuleAnalysis CLI | 180 / 300 | |
| `bdfscanner_service.py:67` | `task_execute_bdfscanner` | BdfScanner.exe(내부 Nastran 300s) | 360 | |
| `hpscr_service.py:124` | `task_execute_hpscr` | PSA/POR CLI | 600 | `:90` 의 fs 도구(180s)는 그대로 |
| `drawing_to_analysis_service.py:383` `:675` `:729` | `task_execute_drawing_to_analysis` / `task_execute_drawing_rebuild`×2 | 도면 엔진 | 600 | `TimeoutExpired` 분기 유지 |
| `drawing_to_analysis_service.py:2428` | `task_execute_drawing_solve` | `nastran solved_model.bdf` | 900 | |

**C. 그대로 두는 곳(범위 밖)**

- 작업이 아닌 프로세스: `doublepipe_modeshape_service.py:286`(뷰어 상주), `remote_session_service.py:233`(RDP 조회), `routers/analysis.py:5021`(`compute_cog` 동기 요청), `routers/hitessbeam.py`(레거시 동기).
- 30~180초 계산기·파서(동기 라우트이거나 즉시 끝남): `carling`·`column_buckling`·`davit`·`d_type_lug`·`hole_calculation`·`section_property`·`f06parser_service:60`·`model_summary_service:568`·`module_ocean_transport_service:247`(tempdir 파싱)·`groupmoduleunit_service:590`(prepare-only)·`:704`(BDF 파싱 180s)·`unit_structural_service:149/177/230`(bridge, ≤300s)·`doublepipe_service:282`·`drawing_to_analysis_service` 의 나머지 bridge 호출(`:473,785,1347,2288`).
  - 단 **같은 파일에 Tier 1 교체가 들어가는 경우**(unit_structural, groupmoduleunit, plate, drawing)는 그 파일의 bridge 호출도 함께 래퍼로 바꾼다 — 취소가 "nastran 이 끝난 직후 f06 파싱 중"에 도착해도 즉시 멈추게 하고, 파일 단위 정적 가드 테스트("이 파일엔 `subprocess.run(` 이 없다")를 걸 수 있게 하기 위해서다. drawing 은 파일이 2,400줄이라 task 안의 4곳만 바꾸고 가드에서 제외한다.
- `run_engine`(`analysis_runner.py:69`) 호출자 `truss_service`·`assessment_service`·`beam_service`·`hull_acceleration_service` — 래퍼 내부만 바꾸므로 서비스 파일은 무수정.
- 이중관 PSA(`doublepipe_psa_service.py:785`) — 자체 스토어. §6 의 위임으로 처리, 서비스 무수정.

## 2. 확정 결정

1. **상태 `Cancelled` 신설.** `Interrupted`(서버 재시작 유실)와 구분한다. terminal 집합은 `Success | Failed | Interrupted | Cancelled` 이고 백엔드 `job_manager.TERMINAL_STATUSES` 한 곳에 상수로 둔다. DB 는 `Analysis.job_status = "Cancelled"`, `Analysis.status = "Cancelled"` 로 남긴다(`_write_through` 와 `record_analysis` 모두).
2. **대기 중 = `future.cancel()`.** `ManagedAnalysisExecutor.submit` 이 Future 를 `JobStatusStore.attach_future(job_id, future)` 로 넘긴다. `cancel()` 은 `Pending` 이고 `future.cancel()` 이 True 면 프로세스 없이 즉시 `Cancelled`.
3. **실행 중 = 등록된 Popen 을 `terminate()` → 5초 → `kill()`.** 트리 종료는 `job_manager.terminate_process_tree(popen, grace_seconds=5.0) -> bool` 한 함수:
   - psutil 로 `children(recursive=True)` 를 **부모가 살아 있을 때** 스냅샷한다(부모가 먼저 죽으면 손자는 고아가 되어 찾을 수 없다 — `run_subprocess_killtree` 와 PSA 가 같은 이유로 스냅샷을 먼저 뜬다).
   - 자식 전부 + 부모 `terminate()` → `psutil.wait_procs(timeout=grace)` + `popen.wait(grace)` → 생존자 `kill()` → 최종 `popen.wait(grace)` 로 회수. Windows 의 `terminate()` 는 `TerminateProcess` 라 사실상 즉시 종료이고, 5초 유예는 POSIX SIGTERM 과 손자 소멸 대기용이다.
   - **`taskkill /F /T /PID` 는 psutil 스냅샷을 못 만들었을 때(psutil 없음·`NoSuchProcess`·`AccessDenied`)만 쓰는 폴백**이며, 그때도 부모가 아직 살아 있을 때만 호출한다(부모가 죽은 뒤엔 `/T` 가 손자에 닿지 않는다). PSA 의 `_kill_process_tree` 가 "taskkill 성공만이 스냅샷 실패 시 독립 증거"라고 결론낸 것과 같은 판단이다.
   - 반환값 False(유예 안에 회수 실패)여도 상태는 `Cancelled` 로 전이한다. 사용자 관점에서 작업은 끝났고, 잔여 프로세스는 로그(`[취소경고]`)로 남긴다. PSA 처럼 라이센스 슬롯을 보류할 필요가 없기 때문이다(여기의 nastran 은 라이센스 큐잉이 solver 쪽에서 된다).
4. **Popen 등록은 공용 래퍼가 한다.** `analysis_runner.tracked_popen(cmd, *, job_id=None, **popen_kwargs)` 컨텍스트 매니저가 Popen 생성 직후 `register_process`, 종료 시 `unregister_process` 를 호출한다. `run_subprocess_killtree` 와 `run_engine` 은 이 컨텍스트로 재구성하고 `job_id: str | None = None` 인자를 받는다.
5. **`job_id` 는 명시 인자 > 실행 컨텍스트 순으로 결정한다.** `ManagedAnalysisExecutor.submit(fn, job_id, *args)` 가 첫 위치 인자(문서화된 계약, `_intake.py:144`)를 `contextvars.ContextVar` 에 묶어 worker 스레드에서 `job_manager.current_job_id()` 로 읽을 수 있게 한다. 그래서 `module_ocean_structural._run_nastran(bdf_path)` 처럼 job_id 가 시그니처에 없는 헬퍼도 시그니처를 안 바꾸고 등록된다. `_intake.py` 의 submit 호출과 그 계약 테스트(`tests/test_job_submission_lifecycle.py:76`)는 그대로다.
6. **취소 후 서비스가 쓰는 `Failed` 는 `Cancelled` 를 덮지 못한다.** 프로세스를 죽이면 서비스는 exit code ≠ 0 을 보고 `mark_complete("Failed")`·`record_analysis(status="Failed")` 를 부른다. `update_job` 은 스토어 상태가 이미 `Cancelled` 면 `status/progress/message` 갱신을 버리고(engine_log·project 등은 받는다), `record_analysis` 는 `is_cancel_requested(job_id)` 면 DB `status` 를 `Cancelled` 로 쓴다. 단 `Success` 는 덮지 않는다 — terminate 직전에 정상 종료해 결과가 실재하면 그것이 사실이다.
7. **취소가 프로세스 사이(파이썬 구간)에 도착해도 다음 Popen 에서 멈춘다.** `tracked_popen` 은 Popen 생성 전에 `is_cancel_requested(job_id)` 를 보고 `JobCancelledError` 를 던진다. `register_process` 는 등록 시점에 이미 취소가 요청돼 있으면 즉시 `terminate_process_tree` 를 건다(PSA 의 "publish 직후 취소" 경로와 같은 경합 대비).
8. **API 는 `POST /api/analysis/{job_id}/cancel` 하나.** 소유자 또는 관리자(`_access_control.assert_current_user_can_access_owner`). 이중관 PSA 의 `/api/doublepipe/run-psa/cancel` 은 응답 형태를 유지한 채 같은 서비스 함수로 위임한다. Plan H 는 HTTP 가 아니라 `job_status_store.cancel(job_id)` 를 직접 부른다.
9. **알림은 지연 import.** 취소 성공 시 `notify(kind="job.cancelled")`. `notification_service` 가 없으면(현재 없다) 조용히 건너뛴다.
10. **프론트 Job Center 카드에 "중단" 버튼 + `ConfirmDialog`.** 성공 응답을 즉시 카드에 반영하고(`patchGlobalJob`), 폴러는 `Cancelled` 를 terminal 로 인식해 멈춘다. 각 해석 페이지는 `Cancelled` 를 `Failed` 와 같은 "실패 계열" 로 처리한다(메시지에 "사용자 요청으로 중단" 이 실림). 페이지별 전용 UI 는 만들지 않는다(YAGNI).

## 3. 백엔드 인터페이스(계약 — Plan H 가 이 시그니처에 의존)

### 3.1 `app/services/job_manager.py`

```python
TERMINAL_STATUSES: frozenset[str] = frozenset({"Success", "Failed", "Interrupted", "Cancelled"})
CANCELLED_MESSAGE = "사용자 요청으로 해석을 중단했습니다."
CANCELLED_QUEUE_MESSAGE = "사용자 요청으로 대기열에서 제거했습니다."
DEFAULT_CANCEL_GRACE_SECONDS = 5.0


class JobCancelledError(RuntimeError):
    """취소가 요청된 작업이 새 프로세스를 띄우려 할 때 tracked_popen 이 던진다."""


def current_job_id() -> str | None:
    """executor worker 스레드 안에서 지금 실행 중인 job_id. 밖에서는 None."""


def terminate_process_tree(popen, grace_seconds: float = DEFAULT_CANCEL_GRACE_SECONDS) -> bool:
    """popen 과 그 자손을 terminate → grace → kill. 유예 안에 popen 을 회수하면 True."""


class JobStatusStore:
    cancel_requested: set[str]          # 락 밖에서 읽지 말 것 — is_cancel_requested() 사용

    def attach_future(self, job_id: str, future) -> None: ...
    def register_process(self, job_id: str, popen) -> None: ...
    def unregister_process(self, job_id: str, popen) -> None: ...
    def is_cancel_requested(self, job_id: str) -> bool: ...
    def cancel(self, job_id: str, *, grace_seconds: float = DEFAULT_CANCEL_GRACE_SECONDS) -> bool: ...
```

`cancel(job_id)` 의 반환 규약:

| 상황 | 동작 | 반환 |
|---|---|---|
| 스토어에 없음 | 아무것도 안 함 | `False` |
| 이미 terminal | 아무것도 안 함 | `False` |
| `Pending` + `future.cancel()` 성공 | `Cancelled`/100/`CANCELLED_QUEUE_MESSAGE` | `True` |
| `Pending` 인데 future 가 이미 실행 시작(`cancel()` False) 또는 `Running` | `cancel_requested` 에 추가 → 등록된 Popen 전부 `terminate_process_tree` → `Cancelled`/100/`CANCELLED_MESSAGE` | `True` |

- `cancel_requested` 는 `cancel()` 이 `Pending→future.cancel()` 성공 경로를 제외한 모든 경로에서 추가하며, 작업이 스토어에서 삭제될 때(`_cleanup_loop`) 함께 비운다.
- `update_job` 동결 규칙: 현재 상태가 `Cancelled` 면 들어온 `updates` 에서 `status`·`progress`·`message` 를 제거하고 나머지만 반영한다. `_write_through` 도 그 잘린 dict 로 부른다(→ `PERSISTED_STATUS_FIELDS` 교집합이 비어 DB 를 건드리지 않는다).
- `_write_through`: `status == "Cancelled"` 면 `record.job_status = record.status = "Cancelled"`.
- `_cleanup_loop`: 만료 대상 판정을 `TERMINAL_STATUSES` 로 바꾸고 삭제 시 `cancel_requested.discard`, `_futures.pop`, `_processes.pop`.
- `attach_future` 는 future 의 done 콜백으로 자기 참조를 지운다(메모리 누수 방지). `register_process`/`unregister_process` 는 job 당 리스트(한 작업이 nastran → bridge 를 순차로 띄우므로 동시엔 보통 1개).

### 3.2 `ManagedAnalysisExecutor.submit`

```python
def submit(self, fn, /, *args, **kwargs):
    # 문서화된 호출 계약(_intake.py): submit(task_fn, job_id, *task_args). 첫 위치 인자가 str 이면 job_id.
    job_id = args[0] if args and isinstance(args[0], str) else None
    ...
    future = executor.submit(_bind_job_context(fn, job_id), *args, **kwargs)
    ...
    if job_id is not None:
        job_status_store.attach_future(job_id, future)
    return future
```

`_bind_job_context` 는 `functools.wraps` 로 감싸 worker 스레드에서 `_CURRENT_JOB_ID.set(job_id)` / `reset` 을 한다. `_intake._handle_future_result` 는 `future.cancelled()` 면 즉시 return(취소된 Future 의 `.result()` 는 `CancelledError` 를 던져 "task 외부 예외" 로 오인·`Failed` 마킹을 시도한다 — 동결 규칙에 막히지만 에러 로그가 남는다).

### 3.3 `app/services/analysis_runner.py`

```python
@contextlib.contextmanager
def tracked_popen(cmd_args: list, *, job_id: str | None = None, **popen_kwargs):
    """subprocess.Popen 을 만들고 job 에 등록한다. job_id 가 None 이면 current_job_id() 를 쓴다.
    취소가 이미 요청된 job 이면 Popen 을 만들지 않고 JobCancelledError 를 던진다."""

def run_subprocess_killtree(cmd_args, *, cwd=None, timeout=None, job_id=None) -> subprocess.CompletedProcess: ...
def run_engine(cmd_args, work_dir=None, timeout=DEFAULT_TIMEOUT_SECONDS, engine_label="Analysis engine",
               *, capture_failure_output=False, job_id=None) -> tuple[str, str]: ...
```

- `run_subprocess_killtree` 의 반환/예외 계약(bytes `CompletedProcess`, `TimeoutExpired` 재-raise, psutil 미가용 폴백)은 그대로. `JobCancelledError` 는 호출자의 `except Exception` 으로 흘러 `Failed` → 동결 규칙으로 `Cancelled` 유지.
- `run_engine` 은 `subprocess.run(check=True)` 를 `tracked_popen` + `communicate(timeout)` 으로 바꾸되, `CalledProcessError`/`TimeoutExpired`/그 외 예외의 3분기 메시지는 글자 단위로 동일하게 둔다(`tests/test_assessment_service_failure.py` 가 `run_engine` 을 monkeypatch 하므로 시그니처 호환 필수).
- `record_analysis`: `job_id` 가 있고 `job_status_store.is_cancel_requested(job_id)` 이며 상태가 실패 계열이면 `status = "Cancelled"`, `job_message = "해석 중단"`, ActivityLog `action_type = "ANALYSIS_CANCELLED"`(`status="failure"`).
- `mark_complete`: `status == "Cancelled"` 면 `message = CANCELLED_MESSAGE`.

### 3.4 서비스별 적용 표(실행 순서 = plan Task 5·6)

| 파일 | 변경 | 교체 방식 |
|---|---|---|
| `unit_structural_service.py` | `:149`,`:177`,`:204`,`:230` | 4곳 모두 `run_subprocess_killtree(..., job_id=job_id)`; `import subprocess` 는 `TimeoutExpired` 참조가 남으면 유지 |
| `module_ocean_structural_service.py` | 없음 | 이미 래퍼 사용 — 컨텍스트로 자동 등록(회귀 테스트만 추가) |
| `groupmoduleunit_service.py` | `:590`,`:633`,`:704` | `run_subprocess_killtree(...)` (job_id 는 컨텍스트) |
| `plate_structure_service.py` | `:371`,`:391` | `run_subprocess_killtree(..., job_id=job_id)` |
| `modelbuilder_solve_service.py` | `:218` | `run_subprocess_killtree(cmd_args, cwd=solve_dir, timeout=900, job_id=job_id)` — `FileNotFoundError`/`TimeoutExpired` 분기 그대로 동작(Popen 이 같은 예외를 던진다) |
| `hitess_modelflow_service.py` | `:153`,`:458`,`:490`,`:552` | `run_subprocess_killtree` + `.decode("utf-8"/"cp949", errors="replace")` |
| `mooring_fitting_service.py` | `_run_capture`(`:49`) 본문 | `tracked_popen` 으로 교체, `_kill_process_tree` → `terminate_process_tree` 위임. 호출부 3곳 무수정 |
| `module_stability_service.py` | `:61`,`:172` | `run_subprocess_killtree(cmd_args, timeout=…, job_id=job_id)` |
| `bdfscanner_service.py` | `:67` | 〃 |
| `hpscr_service.py` | `:124` | 〃 (`:90` 은 그대로) |
| `drawing_to_analysis_service.py` | `:383`,`:675`,`:729`,`:2428` | 〃 (`TimeoutExpired` 분기 유지) |

정적 가드 테스트(`tests/test_job_cancel_services_guard.py`)는 위 표에서 drawing 을 뺀 파일들의 소스에 `subprocess.run(` 이 남아 있지 않음을 확인한다(`subprocess.TimeoutExpired` 참조는 허용).

## 4. 취소 시퀀스

```
클라이언트                라우터 /api/analysis/{id}/cancel        job_cancel_service            JobStatusStore                  worker 스레드(서비스)
   │ POST ─────────────────▶ locate_job(job_id, db)                                                                            
   │                            ├─ store 에 있음 → kind="queue", owner=employee_id(없으면 DB)                                     
   │                            ├─ PSA _jobs 에 있음 → kind="psa"                                                             
   │                            └─ DB 만 있음 → kind="record" → 409                                                          
   │                        assert_current_user_can_access_owner(owner)  (403)                                                
   │                        cancel_located(...) ──────────▶ status ∈ TERMINAL → 409                                            
   │                                                        store.cancel(job_id) ──▶ Pending & future.cancel() ✓ → Cancelled   (task 는 시작하지 않음)
   │                                                                              ├─ 그 외: cancel_requested.add            
   │                                                                              │   for popen in _processes[job]:            
   │                                                                              │     terminate_process_tree(popen)  ······▶ communicate() 가 rc≠0 으로 풀림
   │                                                                              └─ update_job(Cancelled, 100, 메시지)        │ mark_complete("Failed") → 동결 규칙으로 무시
   │                                                        notify(job.cancelled)  (지연 import, 없으면 skip)                    │ record_analysis("Failed") → is_cancel_requested → DB "Cancelled"
   │ ◀── 200 {"cancelled":true,"status":"Cancelled"}                                                                            │ 다음 tracked_popen → JobCancelledError → except → Failed(무시)
```

경합 3가지:
- **Popen 생성 직전에 취소**: `tracked_popen` 의 선검사(`is_cancel_requested`)로 프로세스를 만들지 않는다.
- **Popen 생성 직후·등록 직전에 취소**: `register_process` 가 `cancel_requested` 를 보고 즉시 종료한다.
- **프로세스 정상 종료 직후에 취소**: `terminate_process_tree` 는 `popen.poll() is not None` 이면 True 를 바로 돌려주고, 상태는 `Cancelled` 로 전이된다. 서비스가 이어서 `Success` 를 쓰면 동결 규칙은 `status` 를 버린다 — 즉 `Cancelled` 가 남는다. 사용자가 "중단" 을 눌렀고 200 을 받았으므로 그 결과가 화면과 일치한다. (결정 6 의 "Success 는 덮지 않는다" 는 **취소 요청 이전에 이미 Success 인 경우**를 말한다 — 그때는 `cancel()` 이 terminal 검사에서 False 를 돌려준다.)

## 5. API

### `POST /api/analysis/{job_id}/cancel`

- 인증 `require_auth`. 권한: `assert_current_user_can_access_owner(owner, current_user, db)`(소유자 본인 or `is_admin`).
- 응답 200:
  ```json
  {"job_id": "…", "kind": "queue", "cancelled": true, "status": "Cancelled", "message": "사용자 요청으로 해석을 중단했습니다."}
  ```
  `cancelled: false` 는 취소 도중 작업이 먼저 끝난 경우이며 `status` 에 실제 최종 상태가 실린다.
- 오류: 404(어디에도 없음) · 403(권한) · 409(이미 종료 — 스토어 terminal 또는 DB 전용 레코드, `detail` 에 현재 상태).
- `GUARDED_ROUTES` 에 등록하지 않는다(플랫폼 공통, 마스터 §1-8).

### `POST /api/doublepipe/run-psa/cancel` (호환 유지)

요청 `{"jobId", "employee_id"}` 와 응답 `{"cancelled": bool, "status"?, "message"?}` 를 유지한다. 내부는 `locate_job` → 소유자 검사 → `cancel_located` 로 바뀌고, 응답에 `job_id`·`kind:"psa"` 가 추가된다(상위 호환). `DoublePipePsaTray` 는 무수정.

### `app/services/job_cancel_service.py`(신규)

```python
@dataclass(frozen=True)
class JobLocation:
    kind: str                # "queue" | "psa" | "record"
    owner_id: str | None
    status: str | None

def locate_job(job_id: str, db: Session) -> JobLocation | None
def cancel_located(job_id: str, location: JobLocation, *, requester: str, db: Session) -> dict
```

접근 제어는 라우터가 한다(`_access_control` 이 `routers/` 아래 있고 서비스가 라우터를 import 하지 않게). `cancel_located` 는 `kind="psa"` 면 `doublepipe_psa_service.cancel_psa_job(job_id, location.owner_id or requester)` 로 위임하고, `kind="queue"` 면 §3.1 의 `cancel()` 을 부른 뒤 알림을 낸다.

## 6. 알림 훅

```python
try:
    from app.services.notification_service import notify
except ImportError:
    notify = None
```

취소 성공(`cancelled=True`) 시 `notify(db, employee_id=owner, kind="job.cancelled", title=f"{program_name} 해석을 중단했습니다", body=job_id, link={"menu": "My Projects", "params": {"jobId": job_id}}, dedupe_key=f"job.cancelled:{job_id}")`. `program_name` 은 DB `Analysis.program_name`(없으면 `"해석"`). `notify` 가 None 이거나 예외를 던져도 취소 응답은 영향받지 않는다(try/except + 로그).

## 7. 프론트

| 파일 | 변경 |
|---|---|
| `src/api/analysis.js` | `cancelAnalysisJob(jobId)` 추가 (`POST /api/analysis/{jobId}/cancel`) |
| `src/utils/globalJobs.js` | `TERMINAL_JOB_STATUSES` 에 `'Cancelled'`; `isCancellableJobStatus(status)`(= `Pending`/`Running`) 추가; `globalJobs.test.js` 에 케이스 2개 |
| `src/contexts/DashboardContext.jsx` | `:612` `isFailure` 에 `Cancelled`; `globalJobValue` 에 `patchGlobalJob` 노출 |
| `src/hooks/usePolling.js:74` | `Cancelled` 도 `onError(data)` |
| `src/hooks/useAnalysisJob.js:57,139,186` | `Cancelled` 를 terminal/실패 계열에 포함 |
| `src/components/platform/AnalysisResultPanel.jsx:10,28` | 〃 |
| `src/components/ui/StatusBadge.jsx` | `Cancelled: { variant: 'warning', label: '사용자 중단', icon: Ban }` |
| `src/components/platform/UtilityDock.jsx` | `STATUS_CONFIG.Cancelled`(경고색 `Ban` 아이콘, 라벨 "사용자 중단"), `TERMINAL_STATUSES` 에 추가, `JobRow` 에 "중단" 버튼(Pending/Running 에만), 도크 레벨 `ConfirmDialog`(variant `warning`, "중단" 확인), 요청 중 버튼 비활성·스피너, 실패 시 토스트 |
| `src/pages/analysis/MyProjects.jsx:642` | `STATUS_FILTERS` 에 `'Cancelled'` |

카드의 "중단" 버튼은 휴지통(목록에서 닫기) 왼쪽에 둔다. 두 버튼의 의미가 다르다 — 휴지통은 **화면에서만** 지우고 서버 작업은 계속 돈다(현행). 확인 다이얼로그 문구: "『{앱 이름}』 해석을 중단할까요? 실행 중인 해석기 프로세스를 종료하며 되돌릴 수 없습니다." 확인 라벨 "중단".

## 8. 테스트

백엔드(pytest, `WorkBenchEnv/Scripts/python.exe -m pytest tests/<file> -q`):

| 파일 | 검증 |
|---|---|
| `tests/test_job_cancel_store.py` | `FakePopen`(terminate 에 죽는 것/무시하는 것)으로 §3.1 표 4행 + 동결 규칙 + `register_process` 지연 취소 + `terminate_process_tree` 의 terminate→kill 승격(유예 0.05s). **`_load_psutil`→None, `_taskkill_tree`→no-op 을 autouse 로 패치**해 가짜 PID(4242)가 실제 프로세스에 닿지 않게 한다. |
| `tests/test_job_cancel_executor.py` | `submit(fn, job_id, …)` 이 worker 안에서 `current_job_id()==job_id` 이고 밖에서는 None, `attach_future` 가 호출되며 done 후 참조가 사라짐. `_handle_future_result` 가 취소된 Future 를 조용히 넘김. |
| `tests/test_job_cancel_runner.py` | `analysis_runner.subprocess.Popen` 을 FakePopen 팩토리로 바꿔 `tracked_popen`/`run_subprocess_killtree`/`run_engine` 이 register/unregister 를 부르고, 취소 선요청 시 `JobCancelledError`, `record_analysis` 의 `Cancelled` 강제, `mark_complete("Cancelled")` 메시지. `run_engine` 3분기 메시지 불변. |
| `tests/test_job_cancel_route.py` | `switchable_client` 로 200(소유자)·200(관리자)·403(타인)·404·409(terminal, DB-only) + PSA 위임(`cancel_psa_job` monkeypatch) + `/run-psa/cancel` 호환 + `notify` 지연 import(모듈 부재 시 무오류, 존재 시 kind 확인). |
| `tests/test_job_cancel_services_guard.py` | Tier 1 파일(§3.4, drawing 제외)에 `subprocess.run(` 이 없고 `run_subprocess_killtree`/`tracked_popen` 을 import 한다. `mooring_fitting_service._run_capture` 와 `hitess_modelflow_service._run_nastran_on_bdf` 가 FakePopen 을 등록한다. |

프론트(러너 없음 → plan 의 수동 검증 절차): `npm run dev` → 임의 해석 실행 → Job Center 카드 "중단" → 확인 → 카드가 즉시 "사용자 중단" 배지·100% 로 바뀌고 폴링이 멈춤 → 해석 페이지가 실패 계열 메시지("사용자 요청으로 해석을 중단했습니다.") 표시 → My Projects 에 `Cancelled` 행 → 서버 로그에 `[취소]` 줄, 작업 관리자에 nastran/solver 프로세스 없음. 대기 중(풀 5개 채운 뒤 6번째) 카드 취소 시 "대기열에서 제거" 메시지, 백엔드 로그에 task 시작 흔적 없음.

## 9. 서버(145) 반영

- **`git pull` + 백엔드 재시작으로 끝난다.** 신규 의존성 없음(`psutil==7.2.2` 는 이미 `requirements.txt:25`). 스키마 변경 없음(`Cancelled` 는 기존 `String` 컬럼 값).
- 프론트 변경이 있으므로 **WorkBench 클라이언트 재배포 필요**(구 클라이언트는 `Cancelled` 를 모르는 상태로 폴링을 계속하다 3분 타임아웃에 `Failed` 로 표시 — 기능 저하일 뿐 오류는 아님).
- **InHouse 수동 교체 없음.**

## 10. 범위 밖 / 후속

- 관리자 화면(`System Settings` 의 `/api/system/jobs/active`)에서의 타인 작업 취소 버튼 — API 는 관리자를 허용하므로 UI 만 붙이면 되지만 이번엔 만들지 않는다.
- 취소된 작업의 work_dir 정리 — 기존 `cleanup_service` 30일 정책에 맡긴다.
- PSA 상태 어휘(`failed/-3/cancelled`) 를 `Cancelled` 로 통일하는 것 — PSA 는 자체 트레이/스토어라 별도 작업.
- Plan H 접점: `job_status_store.cancel(job_id)`, `register_process`, `cancel_requested`, `attach_future`, `terminate_process_tree`, `current_job_id()`, `TERMINAL_STATUSES` 를 그대로 쓴다. `submit(fn, *, queue_class=...)` 를 추가할 때 §3.2 의 job_id 추론(첫 위치 인자)을 유지할 것.
