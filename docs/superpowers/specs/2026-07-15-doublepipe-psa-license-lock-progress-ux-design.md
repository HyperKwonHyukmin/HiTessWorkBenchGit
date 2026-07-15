# 이중관 PSA 해석 — 진행 UX + Abaqus 라이센스 락 설계

작성일: 2026-07-15
대상: `이중관 구조 연료배관 해석` (DoublePipeFuelLine) Tab2 "Piping Stress Analysis"

## 배경 / 문제

Tab2의 전체 Load Case 배관응력 해석은 내부에서 Abaqus 솔버를 호출하며 **최대 1시간**까지 걸린다.
현재는:
- 실행 중 표시가 콘솔 헤더의 작은 "해석 진행 중" 점 하나뿐 — 사용자가 얼마나 걸릴지, 얼마나 지났는지 알 수 없다.
- 페이지를 벗어나면 진행 상태를 추적할 수단이 없다.
- Abaqus는 서버(145) 1대 = **라이센스 1개**인데, 동시 실행을 막는 장치가 없어 2번째 사용자가 실행하면 라이센스 충돌로 실패한다.

## 요구사항 (확정)

1. **실행 중 화면 비활성화 + 경과시간 + 안내**: 해석 실행 시 페이지를 블로킹 오버레이로 덮고, 경과 타이머(HH:MM:SS)와 "최대 1시간 소요될 수 있음"을 안내. 소유자에게 **[해석 중단]** 버튼 제공(중단 = 라이센스 즉시 해제).
2. **전역 위젯(대시보드 이탈 시)**: 해석 중 페이지를 벗어나도 우측 하단에 경과시간 카드가 뜨고, 클릭하면 해석 화면으로 복귀.
3. **라이센스 락**: 1명이 해석 중이면 다른 사용자는 페이지 진입 시 **전체 페이지가 잠기고** `All licenses are currently occupied. Please try again later` 메시지 표시. 막힌 사용자에게는 **경과 시간만** 노출(실행자 신원 비공개).

## 아키텍처 결정

**백엔드 `/active`를 락·재연결의 단일 진실원으로 두고, 페이지와 루트 트레이가 각자 독립 폴링.**
- 기존 GlobalJob 시스템(표준 `/api/analysis/status`, Success/Failed/progress%) 재사용은 상태 체계가 다르고 ~15개 앱 공유라 회귀 위험 → **채택 안 함**.
- 백엔드가 진실원이라 새로고침·멀티창에도 자동 복구되고 프론트 상태 동기화 문제가 없음.

## 백엔드 (git 추적 — 145는 `git pull` + 백엔드 재시작)

### `app/services/doublepipe_psa_service.py`
- job 필드 추가: `employeeId`, `startedAtEpoch`, `pid`(kill 핸들).
- 모듈 전역 `_active_job_id` (lock 하 관리). Abaqus 1라이센스 = running 작업 ≤ 1.
- `_ensure_license_available()`: running 작업 있으면 **HTTP 409** `{code:'license_busy', startedAtEpoch, elapsedSec, message}`. 두 진입점(`start_psa_job`, `start_psa_job_from_upload`) 최상단에서 fail-fast(업로드 경로 orphan 폴더 방지).
- `_launch_job(csv_path, employee_id)`: `_jobs_lock` 하에서 원자적 재확인 후 등록 + `_active_job_id` 설정(레이스 최종 관문).
- `_run_pipeline`: Popen 성공 후 `job["pid"]=proc.pid` 저장.
- `_finish`: 진입 시 `status != 'running'`이면 조기 반환(중복 종료/취소 상태 보존). 종료 시 `_active_job_id == job_id`면 해제.
- `get_active_status()`: `{active, jobId, employeeId, startedAtEpoch, serverNowEpoch, elapsedSec, status, lastLog}`. employeeId는 프론트 "내 작업" 분기용(화면엔 경과시간만).
- `cancel_psa_job(jobId, employee_id)`: 소유자 확인(employeeId 일치) → `taskkill /F /T /PID`(exe→abaqus 트리) → failed+`diagnostic='cancelled'` 전이 → 락 해제.
- `get_psa_job`: 반환 시 `pid` 제외.

### `app/routers/doublepipe.py`
- `GET /api/doublepipe/active` → `get_active_status()`.
- `POST /api/doublepipe/run-psa/cancel` `{jobId, employee_id}` → `cancel_psa_job()`.
- 기존 run-psa/run-psa-upload는 409(license_busy) 전파.

## 프론트엔드 (git 추적 — 145 프론트 재배포)

### `pages/analysis/DoublePipeFuelLineAssessment.jsx`
- **마운트 분기**: `GET /active` → (a)남의 작업 running=락 오버레이+`/active` 해제폴링, (b)내 작업 running=재연결(status 폴링+오버레이), (c)없음이면 localStorage 힌트의 jobId로 status 조회해 "이탈 중 완료" 복원.
- **실행 오버레이(요구1)**: `absolute inset-0`(페이지 root가 `relative`라 앱 사이드바는 살아있음) 스피너+경과타이머+"최대 1시간"+최근 로그+[해석 중단].
- **락 오버레이(요구3)**: 전체 페이지 위 `All licenses are currently occupied...`+경과시간만.
- 경과시간 앵커: 서버 `elapsedSec`로 클라 시계에 앵커(`anchor = now - elapsedSec`) → 시계 오차 무시, 1초 로컬 틱.
- 실행 시작 시 localStorage 힌트 기록, 종료/중단 시 해제. 폴러는 `startPsaPolling(jobId)`로 추출(fresh/재연결 공용).
- 409 수신 시 락 상태로 전환(레이스 방어).

### `components/analysis/DoublePipePsaTray.jsx` (신규)
- `DashboardProvider`에서 `GlobalJobTray` 옆에 렌더(독립, 기존 시스템 무관).
- localStorage 힌트가 있을 때만 `/active` 폴링(watch 없으면 네트워크 idle). 힌트 helpers export → 페이지가 import.
- 내 running 작업이고 현재 메뉴가 이 페이지가 아닐 때만 우측 하단 카드(경과타이머+"해석 중·최대 1시간"), 클릭 시 페이지 복귀.

## 엣지 케이스
- **서버 재시작**: 인메모리 락 소실 → 분리된 Abaqus 자식 생존 가능. 최종 백스톱은 Abaqus 라이센스 매니저(2번째 solve는 체크아웃 실패, 기존 진단 노출). 앱 락은 best-effort UX.
- **hung 작업**: 2h 타임아웃/[해석 중단]으로 해제. 남의 hung에 막힌 사용자 강제해제(관리자 override)는 향후 과제.
- **취소 트리종료**: Windows `taskkill /T`로 exe+abaqus 자식 종료.

## 배포
전부 git 추적(백엔드 `app/`, 프론트 `src/`). **145: `git pull` + 백엔드 재시작 + 프론트 재배포**. InHouseProgram(exe/py) 변경 없음 → 수동 복사 불필요.
