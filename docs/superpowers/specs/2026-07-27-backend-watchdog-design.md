# 백엔드 서버(145) 무인 감시·자동 복구 설계

- 작성일: 2026-07-27
- 대상: `HiTessWorkBenchBackEnd` 운영 서버 (10.14.42.145)
- 상태: 설계 승인 완료, 구현 대기

## 1. 배경과 문제 정의

운영 서버(145)의 백엔드가 오류로 멈추면 현재는 **사용자가 전화할 때까지 아무도 모르고, 아무도 살리지 않는다.**

### 1-1. 현재 구조

```
[RDP 세션] ── 사람이 수동 실행 ──> HiTESS_Server.bat
                                       │
                                       ▼
                              server_manager.py (tkinter GUI 상주)
                                       │ subprocess.Popen
                                       ▼
                              uvicorn app.main:app --port 9091
```

`server_manager.py`는 uvicorn을 자식 프로세스로 소유하며, 이미 크래시 자동 재시작을 갖고 있다
(`_schedule_auto_restart`, `server_manager.py:279`).

### 1-2. 이미 갖춰진 것

| 항목 | 위치 |
|---|---|
| 크래시 시 자동 재시작 (60초 내 5회 제한) | `server_manager.py:279` |
| 헬스 엔드포인트 (인증 없음) | `GET /` (`main.py:132`), `GET /api/version` (`system.py:31`) |
| 관리자용 시스템 지표 (CPU/MEM/DISK/DB latency) | `GET /api/system/status` (`system.py:77`) |
| 클라이언트 측 서버 상태 표시 (5초 폴링, 3연속 실패 시 Offline) | `useServerStatus.js:24` |
| 작업 스케줄러 태스크 참조 (`HiTessBackend`) | `update.bat:26` |

### 1-3. 실제 구멍 5가지

1. **알림 수단이 전무하다.** 레포 전체에 SMTP·webhook 코드가 없다. 서버가 죽어도 통보 경로가 사용자 전화뿐이다.
2. **감시자 자신을 감시하는 것이 없다.** `server_manager.py` 프로세스가 죽으면 uvicorn도 함께 고아가 되고, 아무도 복구하지 않는다.
3. **좀비 상태를 못 잡는다.** 감시가 `server_proc.poll()` 기반이라(`server_manager.py:308`) 프로세스는 살아있는데 HTTP 응답이 없는 상태 — DB 커넥션 고갈, ThreadPool 데드락, 디스크 풀 — 를 영원히 정상으로 본다.
4. **크래시 루프 예산 소진 후 영구 정지한다.** 60초 내 5회 실패하면 자동 재시작을 완전히 포기하고, 사람이 Start를 누를 때까지 멈춰 있다(`server_manager.py:285`).
5. **사후 분석 자료가 남지 않는다.** uvicorn stdout이 GUI 텍스트 위젯에만 들어가서(`_stream_output`, `server_manager.py:247`) 앱을 닫으면 크래시 직전 traceback이 통째로 사라진다.

## 2. 목표와 비목표

### 목표

- **완전 무인 자동 복구** — 사람 개입 없이 되살아난다.
- **사후 원인 분석** — 언제·몇 번·왜 죽었는지 추적 가능한 기록을 남긴다.

### 비목표 (이번 스코프 밖)

- 관리자 알림(메일/Teams/SMS) — 사용자가 이번 목표에서 제외.
- 클라이언트 UX 개선(점검 중 안내, 복구 시 자동 재개).
- 진행 중 job 상태 영속화(Redis 도입).
- 백엔드 앱 코드(`app/`) 변경.

### 확정된 제약

| 제약 | 결정 |
|---|---|
| 145 기동 방식 | **RDP 로그인 + GUI 상주 유지.** Windows 서비스·자동로그온 전환 없음. |
| 좀비 감지 시 정책 | **유예 후 강제 재시작.** 긴 임계값으로 오탐을 거르고, 그래도 안 살아나면 job 손실을 감수한다. |

RDP 상주 유지 결정에 따라 **리부트·로그오프 상황은 사람 개입이 남는 잔여 리스크**로 확정된다(§7).

## 3. 아키텍처 — 2계층 감시

### 3-1. 왜 2계층인가

문제의 본질은 "재시작이 없다"가 아니라 **감시 사슬이 한 칸에서 끊긴다**는 것이다.

```
현재:  [OS] ── (없음) ──> [server_manager.py] ──poll()──> [uvicorn]
                              ↑ 죽으면 끝                 ↑ 좀비 못 잡음

설계:  [OS 스케줄러] ──5분──> [watchdog.py] ──PID──> [server_manager.py] ──HTTP──> [uvicorn]
        상주 아님(단발)         죽을 게 없음             L1 (강화)                 L2가 감시
```

핵심은 **최종 감시자를 프로세스가 아니라 OS로 만드는 것**이다. L2를 상주 프로세스로 만들면 "L2가 죽으면?"이 다시 생기지만, 5분마다 실행되고 종료하는 단발 스크립트로 만들면 그 질문 자체가 소멸한다.

### 3-2. 계층별 책임

| 계층 | 실행 주체 | 감시 대상 | 주기 | 복구 행위 |
|---|---|---|---|---|
| **L1** `server_manager.py` (기존 강화) | RDP 세션 상주 GUI | uvicorn 자식 프로세스 | 15초 | 크래시 재시작(기존) + 좀비 재시작(신규) |
| **L2** `watchdog.py` (신규 단발) | 작업 스케줄러 | `server_manager.py` 프로세스 | 5분 | `HiTESS_Server.bat` 재기동 |
| **L3** 이벤트 로그 (신규) | L1·L2 공동 | — | 상태 전이 시 | 없음 (기록 전용) |

### 3-3. 경계 규칙

**L2는 uvicorn을 절대 직접 건드리지 않는다.** L1이 살아 있으면 L2는 아무 행동 없이 즉시 종료한다. 이 규칙이 두 계층이 동시에 재시작을 시도하는 경합을 원천 차단한다.

계층 간 통신은 **파일 두 개로만** 한다. 소켓·IPC 없이 파일만 쓰므로 서로의 내부 구현을 몰라도 된다.

| 파일 | 쓰기 | 읽기 | 용도 |
|---|---|---|---|
| `logs/server_manager.pid` | L1 (시작 시 기록, 정상 종료 시 삭제) | L2 | L1 생존 판정 |
| `logs/server_events.jsonl` | L1, L2 (append) | 사람 | 사후 분석 |

## 4. L1 — `server_manager.py` 강화

### 4-1. 헬스 체크 루프 (신규)

현재는 프로세스 생존만 본다. HTTP 관측을 추가한다.

- 주기 **15초**, 대상 `GET http://127.0.0.1:9091/api/version`, timeout **5초**
- tkinter가 멈추지 않도록 워커 스레드에서 요청하고 `root.after(0, ...)`로 결과만 GUI에 반영한다(기존 `_stream_output`과 동일 패턴).

상태 3단계:

| 상태 | 조건 | 행동 |
|---|---|---|
| `HEALTHY` | 200 응답 | 실패 카운터 리셋 |
| `SUSPECT` | 연속 실패 1~11회 | 로그만, 개입 없음 |
| `ZOMBIE` | **연속 12회 = 3분** | 강제 재시작 발동 (§4-3) |

프로세스가 이미 죽은 경우(`poll() != None`)는 헬스체크를 기다리지 않고 **기존 크래시 경로로 즉시** 처리한다. 3분 유예는 "프로세스는 살아있는데 응답이 없는" 경우에만 적용된다.

기동 직후에도 별도 유예 없이 동일한 카운터를 사용한다. uvicorn 시작부터 첫 응답까지(DB `create_all` 포함) 걸리는 시간은 수 초 수준이라 3분 임계값 안에 충분히 들어오며, 별도 grace period를 두면 "기동 직후 즉시 죽는 고장"의 감지가 오히려 늦어진다.

### 4-2. 임계값 3분의 근거

재시작은 되돌릴 수 없는 파괴적 행위이므로, 화면 표시용인 프론트 임계값(15초, `useServerStatus.js:26`)의 **12배 여유**를 둔다.

오탐 시나리오를 검토하면 — Nastran 5건이 동시에 돌아 CPU가 100%여도 해석은 **별도 프로세스**라 uvicorn 이벤트 루프와 GIL을 공유하지 않는다. `/api/version`은 DB도 디스크도 타지 않는 순수 상수 반환이다(`system.py:31`). 이것이 3분 내내 한 번도 응답하지 못한다면 부하가 아니라 고장이다.

### 4-3. 강제 재시작 절차

순서가 중요하다.

```
a. 진단 스냅샷 수집        ← 죽이기 전에 찍어야 증거가 남는다
b. 자식 프로세스 트리 수집
c. uvicorn terminate → 5초 대기 → kill
d. 고아 해석 프로세스 정리  ← MSC 라이선스 누수 방지
e. 포트 9091 정리 (기존 _kill_port 재사용)
f. 3초 대기 후 재시작
```

**(a) 스냅샷** — `psutil`로 CPU/메모리/디스크 여유, uvicorn 프로세스의 스레드 수·열린 핸들 수·자식 목록을 기록한다. 재시작하면 증거가 사라지므로 **반드시 죽이기 전에** 찍는다. 사후 분석의 실질적 근거가 여기서 나온다.

**(b)·(d) 고아 정리** — uvicorn을 죽여도 그 밑에서 돌던 `nastran.exe`·`MooringFitting.exe`·`Cmb.Cli.exe`는 살아남는다. 이는 이미 겪은 실전 버그로, MooringFitting 손자 프로세스가 좀비로 남아 **MSC 라이선스가 물린** 사례가 있다. 정리하지 않으면 재시작에는 성공해도 다음 해석이 라이선스를 잡지 못한다. (b)에서 `psutil.Process(pid).children(recursive=True)`로 목록을 미리 확보하고, (c) 이후 (d)에서 생존한 것을 정리한다.

재시작 정책이 "유예 후 강제"이므로 job 손실은 이미 감수하기로 한 상태다. 그렇다면 반쯤 죽은 해석 프로세스를 남기는 것보다 깨끗이 정리하는 쪽이 일관된다.

### 4-4. 크래시 루프 예산 → 지수 백오프 전환

**현행 동작의 결함:** 60초 내 5회 실패 시 자동 재시작을 완전히 포기한다(`server_manager.py:285`). 그런데 이 상태에서 L1 프로세스는 **살아 있다.** L2는 L1의 생존만 보므로 개입하지 않는다. 결과적으로 서버는 죽어 있는데 아무도 살리지 않는 상태가 되어 무인 복구가 깨진다.

**변경:** 완전 포기 대신 지수 백오프로 전환한다.

```
5회 연속 실패 → 10분 대기 → 예산 리셋 후 재시도
             → 또 5회 실패 → 20분 → 40분 → 60분(상한)에서 유지
```

무한 재시작 방지라는 원래 목적은 백오프가 대신 담당하되, 일시적 원인(DB 재기동 중, 디스크 일시 부족, 네트워크 드라이브 끊김)이 해소되면 **사람 없이 스스로 복귀**한다. 각 백오프 진입은 `backoff_wait` 이벤트로 기록한다.

사용자가 GUI에서 직접 Start를 누르면 기존대로 예산과 백오프 단계가 모두 초기화된다.

### 4-5. uvicorn 로그 파일 보존

`_stream_output`(`server_manager.py:247`)에서 화면 출력과 함께 `logs/uvicorn/YYYYMMDD.log`로 tee 한다. 현재 GUI 위젯에만 남아 앱 종료 시 소실되는 크래시 직전 traceback을 보존하기 위함이며, 사후 분석 목표에서 가장 실효가 큰 변경이다.

### 4-6. DB 상태 관측 (기록 전용)

1분 주기로 `SELECT 1`을 수행해 DB 도달 가능성만 확인하고 `db_unreachable` / `db_recovered` 이벤트를 기록한다. **복구 행위는 하지 않는다**(근거는 §6-2).

접속 정보는 `app/database.py:7`과 동일하게 `.env`를 `load_dotenv()`로 읽어 pymysql로 직접 연결한다. 백엔드를 경유하지 않으므로 **백엔드 커넥션 풀에 영향이 없고**, 자격증명을 별도로 중복 정의하지도 않는다.

## 5. L2 — `watchdog.py` (신규, 단발 실행)

상주하지 않는다. 스케줄러가 5분마다 실행하면 아래를 수행하고 즉시 종료한다.

```
1. logs/server_manager.pid 읽기
2. 그 PID가 살아있는가?  AND  cmdline 에 server_manager.py 가 포함되는가?
      → 예: 아무 행동 없이 종료              (L1 정상 = L2 개입 금지)
3. 아니오 → GET /api/version 로 1회 확인
      → 200: 종료                            (누군가 uvicorn 만 수동 기동한 경우)
4. 둘 다 실패 → watchdog_revive 기록
              → HiTESS_Server.bat 실행
              → 30초 후 헬스 재확인 → 결과 기록
```

**백오프 대기 중은 정상 상태로 간주한다.** L1이 §4-4의 백오프로 대기하는 동안 서버는 내려가 있지만 L1 프로세스는 살아 있으므로, L2는 2단계에서 멈추고 개입하지 않는다. 이는 의도된 동작이다 — 백오프는 "기동 자체가 반복 실패하는 상황"에 대한 판단이고, 여기에 L2가 끼어들어 재기동하면 백오프의 목적인 폭주 억제가 무력화된다. 대기 중임은 `backoff_wait` 이벤트로 로그에 남는다.

**PID 재사용 방지:** Windows는 PID를 재활용하므로 `psutil`로 `cmdline`까지 검증해 "진짜 server_manager인지" 확인한다. 이 검증을 빠뜨리면 무관한 프로세스를 L1으로 오인해 영원히 복구하지 않는다.

**재기동 폭주 방지:** `logs/watchdog_state.json`에 최근 재기동 시각을 남기고, 30분 내 3회를 초과하면 `watchdog_giveup`을 기록하고 중단한다.

### 5-1. 작업 스케줄러 등록

`scripts/install_watchdog_task.ps1`로 1회 등록한다.

| 항목 | 값 | 이유 |
|---|---|---|
| 트리거 ① | 5분마다 반복(무기한) | 상시 감시 |
| 트리거 ② | **로그온 시** | 리부트 후 RDP 로그인만 하면 자동 기동 |
| 보안 옵션 | 사용자가 로그온한 경우에만 실행 | GUI를 띄워야 하므로 필수 |
| 권한 | 최고 권한으로 실행 | 포트 정리·프로세스 kill |

트리거 ②는 §7의 잔여 리스크를 저비용으로 부분 완화한다. 자동로그온 설정 없이도, 리부트 후 누군가 RDP로 접속하는 순간 서버가 자동으로 올라온다(현재는 수동으로 bat을 실행해야 한다).

## 6. L3 — 이벤트 로그

`logs/server_events.jsonl` — 한 줄 = 한 JSON 객체. L1·L2가 공동으로 append 한다.

```json
{"ts":"2026-07-27T14:03:11+09:00","src":"L1","event":"zombie_detected",
 "detail":{"fail_streak":12,"last_ok":"2026-07-27T14:00:08+09:00",
           "cpu":97.2,"mem_pct":88.1,"disk_free_gb":12.4,
           "uvicorn_pid":13224,"threads":47,
           "children":[{"pid":15880,"name":"nastran.exe","cpu":99.1}]}}
```

### 6-1. 이벤트 종류

| 분류 | 이벤트 |
|---|---|
| 생명주기 | `manager_start` · `server_start` · `manager_stop` |
| 관측 | `health_degraded` · `health_recovered` · `db_unreachable` · `db_recovered` |
| 고장 | `crash_detected` · `zombie_detected` |
| 복구 | `restart_begin` · `orphan_killed` · `restart_done` · `backoff_wait` |
| L2 | `watchdog_revive` · `watchdog_giveup` |

**상태 전이 시에만 기록한다.** 15초마다 `health_ok`를 쓰면 하루 5,760줄이 쌓여 정작 사고 기록이 묻힌다. 정상 운영 시 하루 몇 줄이 정상이다.

보존 기간은 기존 `cleanup_service.py`의 `RETENTION_DAYS` 패턴을 따라 **30일**로 맞춘다. `logs/uvicorn/*.log`도 동일 정책을 적용한다.

### 6-2. DB 장애는 재시작 대상이 아니라 기록 대상이다

`/api/version`은 DB를 타지 않으므로 **MySQL이 죽어도 헬스체크는 통과한다.** 이는 버그가 아니라 의도된 동작으로 유지한다 — DB가 죽었을 때 백엔드를 재시작해도 DB는 살아나지 않고, 진행 중이던 작업만 추가로 파괴한다.

따라서 L1은 DB 상태를 **관측해서 기록만** 하고(§4-6) 복구 행위는 하지 않는다. "그날 서버가 이상했던 원인은 DB였다"를 사후에 판별할 수 있게 하는 것이 목적이다.

## 7. 잔여 리스크

해결되지 않는 것을 명시한다.

| # | 리스크 | 완화 | 완전 해결책 (스코프 밖) |
|---|---|---|---|
| 1 | **리부트/로그오프** 시 서버 정지 | 로그온 트리거(§5-1)로 부분 완화 | 자동로그온 + 로그온 트리거 기동 |
| 2 | **145 PC 자체의 전원·네트워크 장애** | 없음 — 로컬 감시자는 무력 | 외부 PC 원격 감시 (단, 알림 수단이 없어 현재는 실효 제한적) |
| 3 | **진행 중 job 상태 유실** — 재시작 시 `job_status_store`가 비워짐 | L3에 유실 건수 기록 | Redis 등 외부 저장소 도입 |
| 4 | **알림 없음** — 사고를 사후에 로그로만 확인 | 없음 (이번 목표에서 제외) | L3 이벤트에 전송 계층을 얹으면 됨 |
| 5 | **순수 좀비 루프가 3분마다 무한 반복** — 예산 창(60초)보다 좀비 주기(≥180초)가 길어 백오프에 안 걸린다 | 의도적 수용 — 복구 속도 우선 | 경로별 별도 창(그러면 '예산 2배' 문제가 다시 온다) |
| 6 | **고아 uvicorn** — L1 만 죽고 자식 uvicorn 이 살아남으면 서비스는 응답하나 감시(헬스체크·좀비 감지·백오프)가 전부 사라진다 | `watchdog_orphan_uvicorn` 기록만. **재기동으로 승격하지 않는다** — 동작 중인 해석(nastran 수 분~수십 분)을 끊는 손해가 감시 공백보다 크다 | uvicorn 을 L1 과 같은 job object 에 묶어 동반 종료 |
| 7 | **작업 스케줄러 job object** — 되살린 L1 이 태스크 job 에 남으면 5분 만료 시 함께 죽거나 이후 트리거가 스킵될 수 있다 | `CREATE_BREAKAWAY_FROM_JOB` + 폴백(§5). **서버 실측 미완** | — |
| 8 | **`__init__` 배선 무테스트** — L1 중복 차단 로직 자체는 헤드리스로 검증되나, `__init__` 이 `_write_pidfile` 앞에서 그것을 부른다는 배선은 Tk 창이 필요해 자동 테스트가 없다 | 눈으로 확인 | GUI 통합 테스트 |

4번은 설계상 확장이 쉽다. L3에 이벤트가 이미 구조화되어 쌓이므로, 나중에 알림이 필요해지면 `zombie_detected`·`watchdog_giveup` 같은 이벤트를 훅으로 잡아 전송만 붙이면 된다.

### 7-1. 구현 중 추가된 방어 — "L1 이 둘" 이 최악의 실패다

두 개의 Server Manager 가 동시에 뜨면 서로의 uvicorn 을 `_kill_port(9091)` 로 죽이고 상대를 크래시로 오판해 재기동하는 **상호 kill 루프**가 된다. 해석 exe 는 고아로 남아 MSC 라이선스를 문다. 설계 단계에서 놓쳤고 구현 리뷰에서 드러났다.

두 방향으로 막는다. **판정 방향이 서로 반대라는 점이 핵심이다.**

| 계층 | 불확실할 때의 기울기 | 이유 |
|---|---|---|
| **L2** (`is_manager_alive` → `classify_manager`) | **"살아있다"** — `NoSuchProcess` 만 확정 사망으로 보고, `AccessDenied`/`OSError` 는 `watchdog_manager_unreadable` 기록 후 개입하지 않는다. pid 부재·마커 불일치면 `process_iter` 로 마커 프로세스를 한 번 훑는다 | 재기동을 5분 미루는 손해 < L1 이 둘이 되는 손해 |
| **L1** (`_find_running_manager`) | **"띄운다"** — 프로세스 생존과 커맨드라인이 **둘 다** 확인된 경우에만 차단. `AccessDenied`·PID 재사용·pid 판독 불가·pid 부재는 전부 통과 | 잘못 막으면 서버가 아예 안 뜨는데 그건 중복보다 나쁘다. 사람이 런처를 눌렀다면 화면 앞에 있어 메시지를 본다 |

L2 의 오판이 특히 위험한 이유는 **오판 조건과 위험 구간이 독립 사건이 아니라 설계상 겹치기** 때문이다. L1 이 백오프 대기(10~60분)에 들어가면 그 구간엔 uvicorn 이 확실히 다운이라 `health.probe()` 가 반드시 `False` 다 — 즉 `is_manager_alive` 오판만 더해지면 곧바로 중복 기동으로 이어지는 **최대 60분짜리 위험창이 주기적으로 열린다.**

L1 중복은 이례적 상황이 아니다. 설치 스크립트가 로그온 트리거를 걸어두므로 RDP 로그인 시 L2 가 L1 을 띄우는데, 사용자가 습관대로 런처를 더블클릭하면 그대로 두 개가 된다.

## 8. 검증 계획

각 계층을 실제로 고장 내서 확인한다.

| # | 고장 재현 방법 | 기대 결과 |
|---|---|---|
| 1 | uvicorn PID를 `taskkill /F` | 3초 후 자동 재시작, `crash_detected` + `restart_done` 기록 |
| 2 | uvicorn 프로세스를 `psutil.suspend()` | 3분 후 `zombie_detected` → 재시작 |
| 3 | 해석 실행 중 (2) 반복 | `orphan_killed`에 `nastran.exe` 기록, 잔여 프로세스 0 |
| 4 | Server Manager 창을 작업관리자에서 강제 종료 | 5분 내 `watchdog_revive`, GUI 재기동 |
| 5 | 정상 상태에서 워치독 수동 실행 | 아무 행동 없이 종료 (L1 침범 금지 확인) |
| 6 | MySQL 서비스 중지 | `db_unreachable` 기록, **재시작은 발생하지 않음** |
| 7 | 5회 연속 기동 실패 유도 (포트 강제 점유 등) | `backoff_wait` 기록 후 10분 뒤 재시도 — 영구 정지하지 않음 |
| 8 | Server Manager 가 떠 있는 상태에서 런처를 한 번 더 실행 | 경고창 후 즉시 종료, `duplicate_launch_blocked` 기록. **기존 인스턴스의 서버가 죽지 않아야 한다** |
| 9 | **(서버에서만)** 워치독이 L1 을 되살린 직후 태스크 상태 확인 | `Get-ScheduledTaskInfo` 가 `Ready` 로 떨어지고, **5분 뒤에도 L1·uvicorn 이 살아있어야** 한다 (job object 이탈 확인) |

**(2)의 `psutil.suspend()`가 핵심이다.** 프로세스는 살아있고 HTTP만 무응답인 상태를 정확히 재현하는 유일한 방법이므로, 이것으로 검증해야 3분 임계값이 실제로 동작하는지 확인된다.

**(9)는 태스크로 실행해야만 재현된다.** job object 는 작업 스케줄러가 붙이는 것이라 수동 실행으로는 확인되지 않는다. 실패하면 워치독이 1회용이 되거나(트리거 스킵) 되살린 L1 을 5분 뒤 스스로 죽인다.

### 8-1. 실측 결과 (2026-07-28, 개발 PC)

| # | 결과 | 근거 |
|---|---|---|
| 1 크래시 재시작 | **PASS** | uvicorn `taskkill /F` → `crash_detected`(exit_code 1, cpu·디스크 진단 포함) → **3초 후** `server_start` → `restart_done{crash}` |
| 2 좀비 감지 | **PASS** | 워커 `suspend()` → `health_degraded`(streak 1) → **3분 5초 후** `zombie_detected`(streak 12, `last_ok` ISO8601, threads·RSS·자손 목록) → `restart_begin` → `restart_done{zombie}` |
| 3 고아 정리 | **PARTIAL** | 실제 자손 2개(`conhost.exe` + **정지 상태** `python.exe`)를 `attempted=2 / terminated=2 / unconfirmed=0` 으로 정리. 재시작 후 잔여 0. ⚠ **실제 해석 job(`nastran.exe`/`Cmb.Cli.exe`)은 미실행** — 기구(자손 탐색·종료·확인 플래그)는 실증됐으나 MSC 라이선스 해제까지는 확인 못 함 |
| 4 L1 급사 복구 | **PASS** | 수동 실행·스케줄러 양쪽. `watchdog_revive` → 3초 후 `manager_start` → `watchdog_revive_result{recovered:true}`. **복구 확인 6초**(고정 30초 sleep 을 폴링으로 바꾼 효과) |
| 5 워치독 무개입 | **PASS** | L1 생존 시 수동 실행·5분 반복 트리거 **양쪽에서 이벤트 0건**, exit 0, 새 창 없음 |
| 6 DB 관측 | **PARTIAL** | 실제 `.env` 자격증명으로 프로브 **성공**(거짓 `db_unreachable` 을 내지 않음을 확인) + 잘못된 포트에서 `OperationalError` 포맷 확인. ⚠ **MySQL 서비스 실제 중지는 미수행** — 공유 개발 PC 라 다른 작업에 영향을 줄 수 있어 보류 |
| 7 백오프 | **PASS** | `app/main.py` 강제 실패 → 재시작 5회(약 4초 간격) 후 6번째 크래시에서 `backoff_wait{reason:crash, delay_sec:600, level:1}`. **"자동 재시작을 멈춥니다" 없음** = 영구 정지 소멸 확인 |
| 8 중복 실행 차단 | **PASS** | L1 가동 중 런처 재실행 → `duplicate_launch_blocked{running_pid}` 기록 후 즉시 종료. **원본 L1 과 포트 9091 무사**(= `_kill_port` 미호출) |
| 9 job object 이탈 | **PASS** | 태스크 실행 후 상태 `Ready`·`LastTaskResult 0`, 되살린 L1 이 **5분 ExecutionTimeLimit 을 넘겨 생존**(13:00:59 실행 → 13:07:53 생존 확인) |

**검증 중 발견해 고친 결함 1건** — `scripts/install_watchdog_task.ps1` 이 `-RepetitionDuration ([TimeSpan]::MaxValue)` 로 **등록에 실패**하고 있었다. `New-ScheduledTaskTrigger` 는 조용히 통과하지만 `Register-ScheduledTask` 가 XML 스키마 위반(`Duration:P99999999DT23H59M59S`)으로 거부한다. `-RepetitionDuration` 을 생략하는 것이 '무기한' 이다.

이 실패를 잡은 것은 **등록 후 되읽기 검증**이다. `Register-ScheduledTask` 가 예외를 던지지 않으므로, 되읽기가 없었다면 "등록 완료" 를 출력하고 끝났을 것이다 — **서버에 감시기가 없는데 있다고 믿는 상태**가 된다. 무인 복구 시스템에서 가장 위험한 종류의 거짓말이다.

**검증 후 원상 복구 확인**: 작업 스케줄러 태스크 해제됨(시험용 태스크 포함 잔재 0), `app/main.py` 는 `git checkout` 이 아니라 **바이트 단위 백업으로 복원**(다른 작업의 미커밋 변경이 있어 checkout 은 파괴적이었다 — sha256 일치 확인), 잔여 프로세스 0.

## 9. 백엔드 영향 분석

**`app/` 하위 코드는 변경하지 않는다.** API·엔드포인트·해석 파이프라인·DB 스키마 전부 동일하다.

백엔드 입장에서 관측되는 차이:

| 항목 | 영향 |
|---|---|
| `GET /api/version` 15초마다 1건 (127.0.0.1) | 인증·DB·디스크를 타지 않는 상수 반환. 활동 로그에도 남지 않음. 부하 무시 가능. |
| `SELECT 1` 1분마다 | **백엔드를 경유하지 않음.** L1이 `.env`를 읽어 pymysql로 직접 연결하므로 백엔드 커넥션 풀 무관. |
| 재시작 시점 | 기존: 프로세스 사망 시만 / 변경: 사망 시 + 3분 무응답 시 |
| 고아 프로세스 정리 | 재시작 경로에만 존재 — 정상 운영 중에는 실행되지 않음 |

## 10. 변경 파일 및 배포

| 대상 | 구분 | 반영 방법 |
|---|---|---|
| `HiTessWorkBenchBackEnd/server_manager.py` | 수정 | git 추적 → **`git pull`만으로 반영** |
| `HiTessWorkBenchBackEnd/watchdog.py` | 신규 | git 추적 → `git pull` |
| `scripts/install_watchdog_task.ps1` | 신규 | git pull 후 **서버에서 1회 실행** |
| `HiTessWorkBenchBackEnd/logs/` | 신규 디렉토리 | 런타임 자동 생성, `.gitignore` 등록 |
| `InHouseProgram/` | **해당 없음** | 순수 Python이므로 수동 교체 불필요 |

의존성은 `psutil`뿐이며 `system.py:5`에서 이미 사용 중이므로 `requirements.txt` 변경도 없다.

**서버(145) 반영 절차:** `git pull` → `install_watchdog_task.ps1` 1회 실행 → Server Manager 재시작. 수동 파일 교체 없음.
