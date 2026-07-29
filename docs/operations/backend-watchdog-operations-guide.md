# HiTESS WorkBench 백엔드 Watchdog 운영 가이드

> 대상: HiTESS WorkBench 운영 서버(현재 `10.14.42.145`)
> 목적: FastAPI/uvicorn 백엔드가 종료되거나 응답하지 않을 때 자동으로 복구되는 구조를 이해하고, Windows 작업 스케줄러 등록 및 실제 작동 상태를 확인한다.
> 작성일: 2026-07-28

## 1. 전체 구조

Watchdog은 하나의 프로세스가 아니라 다음과 같은 2계층 구조다.

```text
Windows 작업 스케줄러
  ├─ 5분마다 실행
  └─ 사용자 로그온 시 실행
          │
          ▼
L2: server_watchdog.py
  ├─ Server Manager 생존 확인
  ├─ 9091 HTTP 응답 확인
  └─ 둘 다 죽었으면 HiTESS_Server.bat 실행
          │
          ▼
L1: server_manager.py
  ├─ uvicorn 실행
  ├─ 프로세스 종료 감지
  ├─ HTTP 무응답 감지
  └─ uvicorn 재시작
          │
          ▼
FastAPI/uvicorn
  └─ http://127.0.0.1:9091
```

각 계층의 책임은 다음과 같다.

| 계층 | 구성 요소 | 역할 |
|---|---|---|
| OS | Windows 작업 스케줄러 | L2 Watchdog을 5분마다 실행하고, 서버 로그인 시에도 실행 |
| L2 | `server_watchdog.py` | Server Manager가 죽었을 때 Manager를 복구 |
| L1 | `server_manager.py` | uvicorn 프로세스의 종료 및 HTTP 무응답을 감시하고 재시작 |
| 서버 | uvicorn/FastAPI | WorkBench API를 9091 포트로 제공 |

L2는 상주 프로세스가 아니다. 작업 스케줄러가 실행할 때마다 한 번 상태를 판정하고 필요한 동작을 한 뒤 종료한다. 따라서 최종 감시자는 Windows 작업 스케줄러다.

## 2. 장애 상황별 작동 방식

| 상황 | 감지 주체 | 판정 및 동작 | 예상 복구 시간 |
|---|---|---|---|
| uvicorn 프로세스가 갑자기 종료됨 | L1 | 프로세스 종료를 크래시로 기록하고 다시 실행 | 약 3초 |
| uvicorn은 살아 있지만 HTTP 응답이 없음 | L1 | 15초마다 `/api/version` 확인, 12회 연속 실패하면 좀비로 판정하여 강제 종료 후 재실행 | 약 3분 이상 |
| Server Manager 자체가 종료됨 | L2 | 다음 작업 스케줄러 실행에서 Manager와 HTTP 상태를 확인한 후 복구 | 최대 약 5분 |
| 서버 PC 재부팅 | 작업 스케줄러 | 등록 계정이 Windows에 로그온하면 L2 실행 | 사용자 로그온 이후 |
| 서버가 시작 직후 계속 종료됨 | L1 | 짧은 재시도 후 10→20→40→60분 백오프로 간격을 늘려 계속 시도 | 장애 지속 시간에 따라 다름 |
| L2 복구가 반복 실패함 | L2 | 30분 안에 3회까지만 Manager 복구를 시도하고 추가 시도는 일시 중단 | 오래된 이력이 30분 창을 벗어나면 다시 시도 가능 |

### 2.1 uvicorn 프로세스가 종료된 경우

`server_manager.py`는 자신이 실행한 uvicorn의 표준 출력을 계속 읽는다. uvicorn 프로세스가 종료되어 출력 스트림이 끝나면 종료 콜백이 실행된다.

사용자가 `Stop`을 누르거나 업데이트 과정에서 종료한 것이 아니라면 크래시로 판단한다.

1. `crash_detected` 이벤트 기록
2. 기본 3초 대기
3. uvicorn 재실행
4. 성공하면 `restart_done` 기록
5. 실행 파일 누락이나 권한 문제로 시작에 실패하면 다시 예약

최근 60초 안에 5회의 재시작 시도가 누적되면 10분간 기다린다. 장애가 반복될수록 대기 시간은 20분, 40분, 최대 60분으로 증가한다. 서버 HTTP 응답이 회복되면 이 백오프 상태는 초기화된다.

### 2.2 프로세스는 있지만 응답하지 않는 경우

프로세스 생존 여부만으로는 데드락이나 커넥션 고갈처럼 “프로세스는 있지만 요청에 응답하지 않는 상태”를 검출할 수 없다. 이를 위해 L1은 다음 주소를 확인한다.

```text
http://127.0.0.1:9091/api/version
```

헬스 체크 조건은 다음과 같다.

- 확인 주기: 15초
- 요청 타임아웃: 5초
- 정상 조건: HTTP 200
- 좀비 판정: 12회 연속 실패, 약 3분

좀비로 판정되면 다음 순서로 처리한다.

1. CPU, 메모리, 디스크, uvicorn PID와 자식 프로세스 정보 수집
2. `zombie_detected` 이벤트 기록
3. uvicorn과 관련 자식 해석 프로세스 종료 시도
4. 9091 포트 정리
5. uvicorn 재실행 예약

좀비 강제 재시작은 진행 중인 해석 작업을 중단시킬 수 있으므로 12회의 연속 실패를 확인한 뒤 실행하도록 되어 있다.

### 2.3 Server Manager가 종료된 경우

L2는 `logs/server_manager.pid`에 기록된 PID와 실제 프로세스의 명령줄을 비교한다. Windows가 종료된 프로세스의 PID를 다른 프로세스에 재사용할 수 있으므로 PID가 존재한다는 사실만으로 Manager 생존을 판정하지 않는다.

판정 결과에 따른 동작은 다음과 같다.

| Manager 상태 | 9091 HTTP 상태 | L2 동작 |
|---|---|---|
| 살아 있음 | 확인하지 않음 | 아무 작업 없이 종료 |
| 죽음 | 정상 | uvicorn을 건드리지 않고 `watchdog_orphan_uvicorn`만 기록 |
| 죽음 | 실패 | `HiTESS_Server.bat`을 실행해 Manager 복구 |
| 판독 불가 | 무관 | 중복 Manager 실행을 피하기 위해 복구하지 않고 이벤트만 기록 |

Manager 없이 uvicorn만 정상인 경우 서버를 강제로 재시작하지 않는다. 실행 중인 해석 작업을 보호하고 두 개의 Manager가 동시에 실행되는 상황을 방지하기 위한 동작이다.

L2가 Manager를 실행한 후에는 5초마다 최대 90초 동안 `/api/version`을 확인한다. 정상 응답이 확인되면 `watchdog_revive_result`에 `recovered: true`가 기록된다.

## 3. 수동 Stop 및 창 종료 시 차이

Server Manager의 `Stop` 버튼과 Manager 창 닫기는 결과가 다르다.

### Stop 버튼

- uvicorn만 의도적으로 종료한다.
- Server Manager는 계속 살아 있다.
- L1은 의도적 종료로 판단하여 uvicorn을 자동 재시작하지 않는다.
- L2도 Manager가 살아 있는 것을 확인하므로 개입하지 않는다.
- 따라서 서버는 사용자가 다시 `Start`를 누를 때까지 정지 상태를 유지한다.

### Server Manager 창 닫기

- Manager가 uvicorn을 종료하고 자신의 PID 파일을 정리한 뒤 종료한다.
- 작업 스케줄러의 L2가 활성화되어 있다면 다음 5분 점검에서 Manager와 HTTP가 모두 죽은 것으로 판단한다.
- L2가 Manager를 다시 실행하므로 결과적으로 uvicorn도 다시 시작된다.

Watchdog 자동 복구까지 완전히 중단하려면 `Stop` 버튼을 사용해 Manager를 남겨두거나, 유지보수 절차에 따라 `HiTessWatchdog` 예약 작업을 비활성화해야 한다.

## 4. Windows 작업 스케줄러 등록 확인

다음 명령은 반드시 145 운영 서버에서 실행한다. RDP로 서버에 접속한 뒤 PowerShell을 실행한다.

### 4.1 빠른 등록 여부 확인

```powershell
Get-ScheduledTask -TaskName 'HiTessWatchdog' -ErrorAction SilentlyContinue
```

정상 등록되어 있다면 `HiTessWatchdog` 항목이 출력된다. 아무것도 출력되지 않으면 등록되어 있지 않은 것이다.

접근 거부 오류가 발생하면 PowerShell을 관리자 권한으로 실행한다.

### 4.2 상세 상태 확인

```powershell
$task = Get-ScheduledTask -TaskName 'HiTessWatchdog' -ErrorAction SilentlyContinue

if ($task) {
    $task | Format-List TaskName, State, TaskPath

    $task | Get-ScheduledTaskInfo |
        Format-List LastRunTime, LastTaskResult, NextRunTime, NumberOfMissedRuns

    $task.Actions |
        Format-List Execute, Arguments, WorkingDirectory

    $task.Triggers |
        Format-List *
} else {
    Write-Host 'HiTessWatchdog가 등록되어 있지 않습니다.'
}
```

정상 등록 시 예상되는 값은 다음과 같다.

| 항목 | 예상값 |
|---|---|
| `TaskName` | `HiTessWatchdog` |
| `State` | 일반적으로 `Ready`, 실행 중이면 `Running` |
| `Execute` | 백엔드 가상환경의 `WorkBenchEnv\Scripts\pythonw.exe` |
| `Arguments` | `server_watchdog.py`의 전체 경로 |
| `WorkingDirectory` | `HiTessWorkBenchBackEnd` 디렉터리 |
| 트리거 | 5분마다 반복 + 등록 사용자 로그온 시 |
| `LastTaskResult` | `0`이면 직전 실행 성공 |
| `NextRunTime` | 다음 실행 예정 시각 |

`LastTaskResult`가 `1`이면 Watchdog이 실행은 되었지만 복구 실패, 판독 불가, 재시도 한도 도달 등의 이유로 실패 종료했을 수 있다. 이 경우 이벤트 로그를 함께 확인한다.

### 4.3 작업 스케줄러 GUI로 확인

1. 145 서버에서 `Win + R`을 누른다.
2. `taskschd.msc`를 입력한다.
3. 왼쪽에서 **작업 스케줄러 라이브러리**를 선택한다.
4. 가운데 목록에서 `HiTessWatchdog`를 찾는다.
5. 다음 항목을 확인한다.
   - **일반**: 실행 계정, 가장 높은 수준의 권한으로 실행
   - **트리거**: 5분 반복, 사용자 로그온
   - **동작**: `pythonw.exe`로 `server_watchdog.py` 실행
   - **조건/설정**: 새 인스턴스를 병렬 실행하지 않도록 설정
   - **기록**: 최근 실행 성공 및 실패 내역

## 5. 현재 서버 작동 상태 확인

예약 작업 등록만으로 실제 백엔드가 정상이라는 의미는 아니다. 예약 작업, Manager 프로세스, uvicorn 프로세스, HTTP 응답과 로그를 함께 확인한다.

### 5.1 Manager와 uvicorn 프로세스 확인

```powershell
Get-CimInstance Win32_Process |
    Where-Object {
        $_.CommandLine -match 'server_manager\.py|uvicorn.*app\.main:app|server_watchdog\.py'
    } |
    Select-Object ProcessId, ParentProcessId, Name, CommandLine |
    Format-List
```

정상 운영 상태에서는 일반적으로 다음 프로세스가 확인된다.

- `server_manager.py`
- `uvicorn app.main:app --host 0.0.0.0 --port 9091`

`server_watchdog.py`는 5분마다 단발 실행되므로 확인 시점에는 보이지 않는 것이 정상이다.

### 5.2 HTTP 헬스 체크

145 서버 내부에서 다음 명령을 실행한다.

```powershell
Invoke-WebRequest `
    -UseBasicParsing `
    -Uri 'http://127.0.0.1:9091/api/version' `
    -TimeoutSec 5 |
    Select-Object StatusCode, Content
```

정상 상태:

- `StatusCode`: `200`
- `Content`: 현재 백엔드 버전을 포함한 JSON

다른 PC에서 네트워크를 통해 확인할 때는 다음 주소를 사용한다.

```powershell
Invoke-WebRequest `
    -UseBasicParsing `
    -Uri 'http://10.14.42.145:9091/api/version' `
    -TimeoutSec 5 |
    Select-Object StatusCode, Content
```

내부 `127.0.0.1` 확인은 성공하지만 외부 `10.14.42.145` 확인이 실패한다면 uvicorn 자체보다는 방화벽, 네트워크 또는 포트 접근 정책을 확인한다.

### 5.3 PID 파일 확인

예약 작업에 등록된 백엔드 경로를 사용하면 설치 위치를 하드코딩하지 않고 확인할 수 있다.

```powershell
$task = Get-ScheduledTask -TaskName 'HiTessWatchdog'
$backendDir = $task.Actions[0].WorkingDirectory
$pidFile = Join-Path $backendDir 'logs\server_manager.pid'

Get-Content $pidFile
```

출력된 PID가 실제 `server_manager.py` 프로세스 PID와 일치해야 한다.

```powershell
$managerPid = [int](Get-Content $pidFile)
Get-CimInstance Win32_Process -Filter "ProcessId = $managerPid" |
    Select-Object ProcessId, Name, CommandLine
```

PID 파일이 없거나 PID가 실제 Manager와 다르면 이벤트 로그에서 `pidfile_write_failed`, `watchdog_manager_found_by_scan` 등의 기록을 확인한다.

## 6. Watchdog 이벤트 로그 확인

L1과 L2의 주요 판단은 다음 JSONL 파일에 기록된다.

```text
HiTessWorkBenchBackEnd\logs\server_events.jsonl
```

예약 작업의 Working Directory를 이용한 확인 명령:

```powershell
$task = Get-ScheduledTask -TaskName 'HiTessWatchdog'
$backendDir = $task.Actions[0].WorkingDirectory
$eventLog = Join-Path $backendDir 'logs\server_events.jsonl'

Get-Content $eventLog -Tail 50
```

Watchdog 관련 이벤트만 확인:

```powershell
Get-Content $eventLog -Tail 300 |
    Select-String '"event": "(watchdog_|manager_|server_|crash_|health_|zombie_|restart_|backoff_)'
```

주요 이벤트의 의미는 다음과 같다.

| 이벤트 | 의미 |
|---|---|
| `manager_start` | Server Manager 시작 |
| `manager_stop` | Manager 정상 종료 |
| `server_start` | uvicorn 실행 |
| `server_start_failed` | uvicorn 프로세스 생성 실패 |
| `crash_detected` | uvicorn 예기치 않은 종료 감지 |
| `health_degraded` | HTTP 첫 실패, 관찰 상태 진입 |
| `health_recovered` | HTTP 응답 회복 |
| `zombie_detected` | 12회 연속 HTTP 실패로 좀비 판정 |
| `restart_begin` | 좀비 강제 재시작 시작 |
| `restart_done` | 크래시 또는 좀비 재시작 완료 |
| `backoff_wait` | 반복 실패로 10~60분 대기 |
| `watchdog_revive` | L2가 Manager 재실행 시작 |
| `watchdog_revive_result` | L2 복구 후 HTTP 회복 결과 |
| `watchdog_orphan_uvicorn` | Manager는 없지만 uvicorn HTTP는 정상 |
| `watchdog_manager_unreadable` | Manager PID의 프로세스 정보를 권한 문제 등으로 판독하지 못함 |
| `watchdog_giveup` | 최근 30분 내 L2 복구 시도 한도 도달 |
| `watchdog_launcher_missing` | `HiTESS_Server.bat` 누락 |
| `watchdog_revive_failed` | L2가 런처 실행에 실패 |

uvicorn의 날짜별 출력 로그는 다음 위치에 저장된다.

```text
HiTessWorkBenchBackEnd\logs\uvicorn\YYYYMMDD.log
```

오늘 로그 확인:

```powershell
$uvicornLog = Join-Path $backendDir ("logs\uvicorn\{0}.log" -f (Get-Date -Format 'yyyyMMdd'))
Get-Content $uvicornLog -Tail 100
```

## 7. 비파괴 작동 확인

서버나 진행 중인 해석 작업을 종료하지 않고 다음 순서로 상태를 확인한다.

1. 예약 작업이 `Ready` 또는 `Running`인지 확인한다.
2. `LastRunTime`이 최근 5분 이내인지 확인한다.
3. `LastTaskResult`가 `0`인지 확인한다.
4. `NextRunTime`이 약 5분 뒤로 설정되어 있는지 확인한다.
5. `server_manager.py`와 uvicorn 프로세스가 존재하는지 확인한다.
6. `/api/version`이 HTTP 200을 반환하는지 확인한다.
7. `server_events.jsonl`에 반복되는 실패 이벤트가 없는지 확인한다.

필요하면 예약 작업을 즉시 한 번 실행할 수 있다.

```powershell
Start-ScheduledTask -TaskName 'HiTessWatchdog'
Start-Sleep -Seconds 10

Get-ScheduledTask -TaskName 'HiTessWatchdog' |
    Get-ScheduledTaskInfo |
    Select-Object LastRunTime, LastTaskResult, NextRunTime
```

Manager가 정상 실행 중이라면 L2는 아무것도 변경하지 않고 종료하며 `LastTaskResult`는 일반적으로 `0`이 된다. 이 확인은 서버 프로세스를 강제 종료하지 않는다.

## 8. 실제 자동 복구 시험

실제 프로세스를 종료하는 시험은 진행 중인 해석 작업을 중단시킬 수 있다. 반드시 사용자가 없는 유지보수 시간에 실시한다.

### 8.1 L1 크래시 복구 시험

목적은 uvicorn이 예기치 않게 종료됐을 때 Server Manager가 약 3초 후 다시 실행하는지 확인하는 것이다.

확인 기준:

1. 시험 전 `/api/version`이 HTTP 200인지 확인
2. Manager가 실행 중인지 확인
3. uvicorn 프로세스를 의도치 않은 종료와 동일한 방식으로 종료
4. 이벤트 로그에서 `crash_detected` 확인
5. 약 3초 후 `server_start`와 `restart_done` 확인
6. `/api/version`이 다시 HTTP 200인지 확인

Server Manager의 `Stop` 버튼은 의도적 종료로 처리되므로 L1 자동 복구 시험이 되지 않는다.

### 8.2 L2 Manager 복구 시험

목적은 Manager와 uvicorn이 모두 없는 상태에서 작업 스케줄러가 Manager를 다시 실행하는지 확인하는 것이다.

확인 기준:

1. 진행 중인 해석 작업이 없는지 확인
2. Server Manager 창을 정상적으로 닫아 Manager와 uvicorn을 함께 종료
3. 다음 5분 주기를 기다리거나 `Start-ScheduledTask -TaskName 'HiTessWatchdog'` 실행
4. 새 Server Manager 창이 나타나는지 확인
5. 로그에서 `watchdog_revive` 확인
6. 이어서 `manager_start`, `server_start` 확인
7. `watchdog_revive_result`의 `recovered`가 `true`인지 확인
8. `/api/version`이 HTTP 200인지 확인

시험 완료 후 Manager와 uvicorn이 각각 하나씩만 실행 중인지 확인한다.

## 9. 등록 스크립트

작업 스케줄러 등록은 자동으로 수행되지 않는다. 운영 서버에서 관리자가 다음 스크립트를 직접 한 번 실행해야 한다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install_watchdog_task.ps1
```

스크립트가 등록하는 기본 내용:

- 작업 이름: `HiTessWatchdog`
- 실행 계정: 스크립트를 실행한 현재 도메인 사용자
- 실행 권한: 가장 높은 수준
- 실행 파일: 백엔드 가상환경의 `pythonw.exe`
- 대상 스크립트: `server_watchdog.py`
- 트리거: 5분 반복, 사용자 로그온
- 중복 실행: 기존 실행이 있으면 새 실행 무시
- 최대 실행 시간: 5분

이 작업은 tkinter 기반 Server Manager GUI를 띄워야 하므로 “사용자가 로그온한 경우에만 실행”하도록 등록된다. 서버 PC가 재부팅되어도 사용자가 Windows에 로그인하지 않은 상태라면 GUI 기반 Manager가 바로 뜨지 않을 수 있다.

개발 PC에는 이 작업을 등록하지 않는다. 잘못 등록했다면 다음 명령으로 제거할 수 있다.

```powershell
Unregister-ScheduledTask -TaskName 'HiTessWatchdog' -Confirm:$false
```

## 10. 관련 파일

| 파일 | 역할 |
|---|---|
| `HiTessWorkBenchBackEnd/server_manager.py` | L1 Manager, uvicorn 실행·감시·재시작 |
| `HiTessWorkBenchBackEnd/server_watchdog.py` | L2 단발 Watchdog |
| `HiTessWorkBenchBackEnd/serverguard/health.py` | HTTP 헬스 체크와 좀비 상태 판정 |
| `HiTessWorkBenchBackEnd/serverguard/backoff.py` | L1 재시작 예산과 백오프 |
| `HiTessWorkBenchBackEnd/serverguard/pidfile.py` | Manager PID 파일 읽기·쓰기 |
| `HiTessWorkBenchBackEnd/serverguard/proctree.py` | 좀비 재시작 시 자식 프로세스 정리 |
| `HiTessWorkBenchBackEnd/serverguard/events.py` | 이벤트 및 uvicorn 날짜별 로그 기록 |
| `HiTessWorkBenchBackEnd/HiTESS_Server.bat` | Manager 실행 런처 |
| `scripts/install_watchdog_task.ps1` | Windows 작업 스케줄러 등록 스크립트 |

## 11. 운영 확인 체크리스트

```text
[ ] 145 서버에 HiTessWatchdog 예약 작업이 등록되어 있다.
[ ] 예약 작업 상태가 Ready 또는 Running이다.
[ ] LastRunTime이 최근 5분 이내다.
[ ] LastTaskResult가 0이다.
[ ] NextRunTime이 정상적으로 갱신된다.
[ ] server_manager.py가 하나만 실행 중이다.
[ ] uvicorn 서버가 하나만 9091 포트를 사용한다.
[ ] http://127.0.0.1:9091/api/version이 HTTP 200을 반환한다.
[ ] server_manager.pid가 실제 Manager PID와 일치한다.
[ ] server_events.jsonl에 watchdog_giveup 또는 반복 실패가 없다.
[ ] 최근 uvicorn 로그에 반복 크래시나 기동 실패가 없다.
```
