# 백엔드(145) 무인 감시·자동 복구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영 서버(145)의 백엔드가 죽거나 응답 불능이 되면 사람 개입 없이 스스로 복구하고, 무슨 일이 있었는지 추적 가능한 기록을 남긴다.

**Architecture:** 2계층 감시. L1(`server_manager.py`)이 15초 HTTP 헬스체크로 uvicorn을 감시하고, L2(`server_watchdog.py`)가 L1을 감시한다. L2는 상주하지 않고 작업 스케줄러가 5분마다 단발 실행하므로 최종 감시자가 OS가 된다. 판정·정책 로직은 전부 `serverguard/` 패키지의 순수 모듈로 분리해 단위 테스트하고, GUI 통합은 수동 고장 재현으로 검증한다.

**Tech Stack:** Python 3.14, psutil 7.2.2 (기존 의존성), pymysql (기존), tkinter (기존), pytest, Windows 작업 스케줄러

**설계서:** `docs/superpowers/specs/2026-07-27-backend-watchdog-design.md`

---

## File Structure

### 신규: `HiTessWorkBenchBackEnd/serverguard/` — 순수 판정·정책 모듈

`app/`(FastAPI 앱)과 분리한다. 감시자는 uvicorn *바깥*에서 돌아야 하므로 `app/`을 import 하면 안 된다(FastAPI·SQLAlchemy 초기화가 딸려온다).

| 파일 | 단일 책임 |
|---|---|
| `serverguard/__init__.py` | 패키지 선언 (빈 파일) |
| `serverguard/events.py` | L3 이벤트 로그 append/조회/보존 + uvicorn 일자별 로그 writer |
| `serverguard/health.py` | HTTP 프로브 + 헬스 상태 머신 (healthy/suspect/zombie) |
| `serverguard/backoff.py` | 재시작 예산 + 지수 백오프 정책 |
| `serverguard/proctree.py` | 자손 프로세스 수집·정리 (고아 해석 exe 처리) |
| `serverguard/diagnostics.py` | 재시작 직전 진단 스냅샷 |
| `serverguard/pidfile.py` | L1 PID 파일 쓰기/읽기/삭제 (L1↔L2 통신) |

### 신규: 실행 진입점

| 파일 | 책임 |
|---|---|
| `HiTessWorkBenchBackEnd/server_watchdog.py` | L2 단발 워치독 |
| `scripts/install_watchdog_task.ps1` | 작업 스케줄러 태스크 1회 등록 |

⚠ **`watchdog.py`가 아니라 `server_watchdog.py`인 이유:** PyPI에 `watchdog` 패키지가 존재한다. 백엔드 루트에 `watchdog.py`를 두면 `cwd=HiTessWorkBenchBackEnd`로 실행되는 uvicorn(`server_manager.py:229`)의 `import watchdog`을 섀도잉해 무관한 라이브러리를 깨뜨릴 수 있다.

### 수정

| 파일 | 변경 내용 |
|---|---|
| `HiTessWorkBenchBackEnd/server_manager.py` | 관측 배선(Task 7) → 헬스체크·좀비 재시작(Task 8) → 백오프 전환(Task 9) → DB 관측(Task 10) |

### 테스트

| 파일 | 대상 |
|---|---|
| `tests/test_serverguard_events.py` | events.py |
| `tests/test_serverguard_health.py` | health.py |
| `tests/test_serverguard_backoff.py` | backoff.py |
| `tests/test_serverguard_proctree.py` | proctree.py |
| `tests/test_serverguard_pidfile.py` | pidfile.py |
| `tests/test_serverguard_diagnostics.py` | diagnostics.py |
| `tests/test_server_watchdog.py` | server_watchdog.py |

### 런타임 생성 (git 미추적)

`HiTessWorkBenchBackEnd/logs/` — `.gitignore:62`에 이미 등록되어 있다. 추가 작업 불필요.

```
logs/
  server_events.jsonl        L1·L2 공동 append
  server_manager.pid         L1이 쓰고 L2가 읽음
  watchdog_state.json        L2 재기동 이력
  uvicorn/YYYYMMDD.log       uvicorn stdout 보존
```

### 테스트 전략에 대한 정직한 고지

Task 1~6과 11은 **순수 로직이라 pytest로 완전히 커버**된다. Task 7~10은 tkinter GUI 콜백 배선이라 단위 테스트하지 않는다 — 대신 그 안에서 호출하는 로직이 이미 Task 1~6에서 검증되었고, 배선 자체는 **Task 13의 수동 고장 재현 매트릭스**로 검증한다. GUI 테스트 하네스를 만드는 비용이 얻는 신뢰보다 크다는 판단이며, 이를 숨기지 않고 계획에 명시한다.

### 실행 환경 주의

모든 `pytest` 명령은 **`HiTessWorkBenchBackEnd/` 디렉토리에서** 프로젝트 venv로 실행한다.

```bash
cd HiTessWorkBenchBackEnd
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_serverguard_events.py -v
```

---

## Task 1: `serverguard` 패키지 + 이벤트 로그

**Files:**
- Create: `HiTessWorkBenchBackEnd/serverguard/__init__.py`
- Create: `HiTessWorkBenchBackEnd/serverguard/events.py`
- Test: `HiTessWorkBenchBackEnd/tests/test_serverguard_events.py`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`HiTessWorkBenchBackEnd/tests/test_serverguard_events.py`:

```python
import json
from datetime import datetime, timedelta

from serverguard import events


def test_append_event_writes_one_jsonl_line(tmp_path):
    events.append_event(tmp_path, "L1", "server_start", {"pid": 1234})

    lines = (tmp_path / events.EVENTS_FILENAME).read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    record = json.loads(lines[0])
    assert record["src"] == "L1"
    assert record["event"] == "server_start"
    assert record["detail"] == {"pid": 1234}
    assert record["ts"].startswith("20")


def test_append_event_appends_without_truncating(tmp_path):
    events.append_event(tmp_path, "L1", "server_start")
    events.append_event(tmp_path, "L2", "watchdog_revive")

    lines = (tmp_path / events.EVENTS_FILENAME).read_text(encoding="utf-8").splitlines()
    assert [json.loads(line)["event"] for line in lines] == ["server_start", "watchdog_revive"]


def test_append_event_never_raises_when_dir_is_unwritable(tmp_path):
    # 존재하는 '파일'을 로그 디렉토리로 넘기면 mkdir 이 실패한다.
    blocker = tmp_path / "not_a_dir"
    blocker.write_text("x", encoding="utf-8")

    # 로그 기록 실패가 감시·복구를 막아서는 안 된다.
    events.append_event(blocker, "L1", "server_start")


def test_read_events_returns_records_newest_last(tmp_path):
    events.append_event(tmp_path, "L1", "first")
    events.append_event(tmp_path, "L1", "second")

    records = events.read_events(tmp_path)

    assert [r["event"] for r in records] == ["first", "second"]


def test_read_events_skips_corrupt_lines(tmp_path):
    events.append_event(tmp_path, "L1", "good")
    with open(tmp_path / events.EVENTS_FILENAME, "a", encoding="utf-8") as fh:
        fh.write("{ this is not json\n")

    records = events.read_events(tmp_path)

    assert [r["event"] for r in records] == ["good"]


def test_prune_events_drops_records_older_than_retention(tmp_path):
    now = datetime.now().astimezone()
    events.append_event(tmp_path, "L1", "ancient", now=now - timedelta(days=40))
    events.append_event(tmp_path, "L1", "recent", now=now - timedelta(days=2))

    removed = events.prune_events(tmp_path, retention_days=30, now=now)

    assert removed == 1
    assert [r["event"] for r in events.read_events(tmp_path)] == ["recent"]


def test_daily_log_writer_creates_file_named_by_date(tmp_path):
    writer = events.DailyLogWriter(tmp_path)
    stamp = datetime(2026, 7, 27, 14, 3, 11)

    writer.write("INFO uvicorn started", now=stamp)
    writer.close()

    written = (tmp_path / "uvicorn" / "20260727.log").read_text(encoding="utf-8")
    assert "14:03:11 INFO uvicorn started" in written


def test_daily_log_writer_rolls_over_at_midnight(tmp_path):
    writer = events.DailyLogWriter(tmp_path)

    writer.write("before", now=datetime(2026, 7, 27, 23, 59, 59))
    writer.write("after", now=datetime(2026, 7, 28, 0, 0, 1))
    writer.close()

    assert "before" in (tmp_path / "uvicorn" / "20260727.log").read_text(encoding="utf-8")
    assert "after" in (tmp_path / "uvicorn" / "20260728.log").read_text(encoding="utf-8")


def test_prune_uvicorn_logs_deletes_files_older_than_retention(tmp_path):
    writer = events.DailyLogWriter(tmp_path)
    now = datetime(2026, 7, 27, 12, 0, 0)
    writer.write("old", now=now - timedelta(days=40))
    writer.write("fresh", now=now - timedelta(days=1))
    writer.close()

    removed = events.prune_uvicorn_logs(tmp_path, retention_days=30, now=now)

    assert removed == 1
    remaining = sorted(p.name for p in (tmp_path / "uvicorn").glob("*.log"))
    assert remaining == ["20260726.log"]
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_serverguard_events.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'serverguard'`

- [ ] **Step 3: 패키지 선언 파일을 만든다**

`HiTessWorkBenchBackEnd/serverguard/__init__.py`:

```python
"""서버 감시·자동 복구 공용 모듈.

app/(FastAPI 앱) 과 분리한다. 감시자는 uvicorn 바깥에서 돌아야 하므로
app/ 을 import 하면 FastAPI·SQLAlchemy 초기화가 딸려와 감시 자체가 무거워진다.
"""
```

- [ ] **Step 4: 이벤트 로그 모듈을 구현한다**

`HiTessWorkBenchBackEnd/serverguard/events.py`:

```python
"""감시 계층 공용 이벤트 로그 (L3).

L1(server_manager.py) 과 L2(server_watchdog.py) 가 같은 JSONL 파일에 append 한다.
상태가 '바뀐 순간'만 기록하므로 정상 운영 시 하루 수 줄 수준으로 유지된다.

동시 쓰기: 두 계층이 같은 파일에 append 하지만, 한 줄이 4KB 미만이면 O_APPEND
쓰기는 사실상 원자적이라 줄 단위 섞임이 발생하지 않는다. 손상된 줄이 생기더라도
read_events 가 건너뛰므로 조회가 깨지지 않는다.
"""
import json
from datetime import datetime, timedelta
from pathlib import Path

EVENTS_FILENAME = "server_events.jsonl"
UVICORN_SUBDIR = "uvicorn"
RETENTION_DAYS = 30


def append_event(log_dir, src, event, detail=None, *, now=None):
    """이벤트 한 줄을 JSONL 로 append 하고 기록된 dict 를 반환한다.

    로그 기록 실패가 감시·복구를 막아서는 안 되므로 어떤 예외도 밖으로 내보내지 않는다.
    """
    now = now or datetime.now().astimezone()
    record = {
        "ts": now.astimezone().isoformat(timespec="seconds"),
        "src": src,
        "event": event,
        "detail": detail or {},
    }
    try:
        path = Path(log_dir)
        path.mkdir(parents=True, exist_ok=True)
        with open(path / EVENTS_FILENAME, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass
    return record


def read_events(log_dir):
    """이벤트를 기록 순서(오래된 것 → 최신)로 반환한다. 손상된 줄은 건너뛴다."""
    path = Path(log_dir) / EVENTS_FILENAME
    if not path.exists():
        return []
    records = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except (ValueError, TypeError):
                continue
    return records


def prune_events(log_dir, retention_days=RETENTION_DAYS, *, now=None):
    """보존 기간이 지난 이벤트를 제거하고 삭제된 줄 수를 반환한다.

    L1 기동 시 1회만 호출하므로 전체 재작성 비용이 문제되지 않는다.
    """
    path = Path(log_dir) / EVENTS_FILENAME
    if not path.exists():
        return 0

    now = (now or datetime.now()).astimezone()
    cutoff = now - timedelta(days=retention_days)

    kept, removed = [], 0
    for record in read_events(log_dir):
        try:
            ts = datetime.fromisoformat(record["ts"])
        except (KeyError, ValueError, TypeError):
            kept.append(record)          # 판독 불가한 기록은 보존한다(증거 우선).
            continue
        if ts < cutoff:
            removed += 1
        else:
            kept.append(record)

    if removed:
        with open(path, "w", encoding="utf-8") as fh:
            for record in kept:
                fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    return removed


def prune_uvicorn_logs(log_dir, retention_days=RETENTION_DAYS, *, now=None):
    """보존 기간이 지난 uvicorn 일자별 로그 파일을 삭제하고 삭제 개수를 반환한다."""
    directory = Path(log_dir) / UVICORN_SUBDIR
    if not directory.exists():
        return 0

    now = now or datetime.now()
    cutoff = (now - timedelta(days=retention_days)).strftime("%Y%m%d")

    removed = 0
    for entry in directory.glob("*.log"):
        if entry.stem < cutoff:          # YYYYMMDD 는 문자열 비교가 곧 시간 순서다.
            try:
                entry.unlink()
                removed += 1
            except OSError:
                continue
    return removed


class DailyLogWriter:
    """uvicorn stdout 을 날짜별 파일에 보존한다.

    현재 uvicorn 출력은 GUI 텍스트 위젯에만 남아 앱을 닫으면 크래시 직전
    traceback 이 통째로 사라진다. 줄마다 flush 하는 이유가 이것이다 —
    프로세스가 급사해도 마지막 줄이 디스크에 남아야 사후 분석이 가능하다.
    """

    def __init__(self, log_dir, subdir=UVICORN_SUBDIR):
        self.dir = Path(log_dir) / subdir
        self._stamp = None
        self._fh = None

    def write(self, line, *, now=None):
        now = now or datetime.now()
        stamp = now.strftime("%Y%m%d")
        try:
            if stamp != self._stamp:
                self.close()
                self.dir.mkdir(parents=True, exist_ok=True)
                self._fh = open(self.dir / f"{stamp}.log", "a", encoding="utf-8")
                self._stamp = stamp
            self._fh.write(f"{now.strftime('%H:%M:%S')} {line}\n")
            self._fh.flush()
        except Exception:
            pass

    def close(self):
        if self._fh is not None:
            try:
                self._fh.close()
            except Exception:
                pass
        self._fh = None
        self._stamp = None
```

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_serverguard_events.py -v`
Expected: PASS — 9 passed

- [ ] **Step 6: 커밋한다**

```bash
git add HiTessWorkBenchBackEnd/serverguard/__init__.py HiTessWorkBenchBackEnd/serverguard/events.py HiTessWorkBenchBackEnd/tests/test_serverguard_events.py
git commit -m "✨ feat: 서버 감시 이벤트 로그(L3) 모듈 추가

JSONL append, 30일 보존, uvicorn stdout 일자별 파일 보존.
현재 uvicorn 출력은 GUI 위젯에만 남아 앱 종료 시 크래시 traceback 이
소실되는데, DailyLogWriter 가 줄마다 flush 해 이를 보존한다."
```

---

## Task 2: 헬스 프로브 + 상태 머신

**Files:**
- Create: `HiTessWorkBenchBackEnd/serverguard/health.py`
- Test: `HiTessWorkBenchBackEnd/tests/test_serverguard_health.py`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`HiTessWorkBenchBackEnd/tests/test_serverguard_health.py`:

```python
import socket

from serverguard import health


def test_classify_zero_failures_is_healthy():
    assert health.classify(0) == health.HEALTHY


def test_classify_partial_failures_is_suspect():
    assert health.classify(1) == health.SUSPECT
    assert health.classify(11) == health.SUSPECT


def test_classify_at_threshold_is_zombie():
    assert health.classify(12) == health.ZOMBIE
    assert health.classify(99) == health.ZOMBIE


def test_default_threshold_is_three_minutes():
    # 15초 주기 × 12회 = 180초. 재시작은 되돌릴 수 없으므로 넉넉한 유예를 둔다.
    assert health.CHECK_INTERVAL_SEC * health.ZOMBIE_THRESHOLD == 180


def test_tracker_reports_transition_only_once():
    tracker = health.HealthTracker(zombie_threshold=3)

    assert tracker.record(False) == (health.SUSPECT, True)
    assert tracker.record(False) == (health.SUSPECT, False)
    assert tracker.record(False) == (health.ZOMBIE, True)
    # 이미 zombie 인 상태의 추가 실패는 전이가 아니다 — 재시작이 반복 발동하면 안 된다.
    assert tracker.record(False) == (health.ZOMBIE, False)


def test_tracker_success_resets_streak_and_reports_recovery():
    tracker = health.HealthTracker(zombie_threshold=3)
    tracker.record(False)

    state, changed = tracker.record(True, now=1234.5)

    assert (state, changed) == (health.HEALTHY, True)
    assert tracker.fail_streak == 0
    assert tracker.last_ok_at == 1234.5


def test_tracker_reset_returns_to_healthy():
    tracker = health.HealthTracker(zombie_threshold=3)
    tracker.record(False)
    tracker.record(False)
    tracker.record(False)
    assert tracker.state == health.ZOMBIE

    tracker.reset()

    assert tracker.state == health.HEALTHY
    assert tracker.fail_streak == 0


def test_probe_returns_false_for_closed_port():
    # 열려 있지 않은 포트를 골라 실제 연결 실패 경로를 검증한다.
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        free_port = sock.getsockname()[1]

    assert health.probe(f"http://127.0.0.1:{free_port}/api/version", timeout=1) is False


def test_probe_returns_false_on_malformed_url():
    assert health.probe("not-a-url", timeout=1) is False
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_serverguard_health.py -v`
Expected: FAIL — `ImportError: cannot import name 'health' from 'serverguard'`

- [ ] **Step 3: 구현한다**

`HiTessWorkBenchBackEnd/serverguard/health.py`:

```python
"""uvicorn HTTP 헬스 판정 — 프로브와 상태 머신.

프로세스 생존(poll) 과 별개로 'HTTP 가 응답하는가' 만 본다. 프로세스는 살아
있는데 응답만 없는 좀비 상태(DB 커넥션 고갈, ThreadPool 데드락, 디스크 풀)를
잡아내는 것이 목적이다.
"""
import urllib.error
import urllib.request

HEALTHY = "healthy"
SUSPECT = "suspect"
ZOMBIE = "zombie"

CHECK_INTERVAL_SEC = 15
ZOMBIE_THRESHOLD = 12          # 15초 × 12 = 3분
PROBE_TIMEOUT_SEC = 5

HEALTH_URL = "http://127.0.0.1:9091/api/version"


def probe(url=HEALTH_URL, timeout=PROBE_TIMEOUT_SEC):
    """헬스 엔드포인트가 200 을 반환하면 True.

    /api/version 은 인증도 DB 도 디스크도 타지 않는 상수 반환이라
    (app/routers/system.py 의 check_version) 부하가 사실상 0 이다.
    """
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return response.status == 200
    except Exception:
        return False


def classify(fail_streak, *, zombie_threshold=ZOMBIE_THRESHOLD):
    """연속 실패 횟수를 상태로 환산한다."""
    if fail_streak <= 0:
        return HEALTHY
    if fail_streak >= zombie_threshold:
        return ZOMBIE
    return SUSPECT


class HealthTracker:
    """연속 실패를 세고 '상태가 바뀐 순간'만 알려준다.

    전이 시에만 알리는 이유는 두 가지다. 로그가 15초마다 쌓여 사고 기록을
    묻어버리지 않게 하고, ZOMBIE 상태가 지속되는 동안 강제 재시작이 반복
    발동하지 않게 한다.
    """

    def __init__(self, zombie_threshold=ZOMBIE_THRESHOLD):
        self.zombie_threshold = zombie_threshold
        self.fail_streak = 0
        self.state = HEALTHY
        self.last_ok_at = None

    def record(self, ok, *, now=None):
        """관측 1회를 기록하고 (상태, 전이여부) 를 반환한다."""
        if ok:
            self.fail_streak = 0
            self.last_ok_at = now
        else:
            self.fail_streak += 1

        new_state = classify(self.fail_streak, zombie_threshold=self.zombie_threshold)
        changed = new_state != self.state
        self.state = new_state
        return new_state, changed

    def reset(self):
        """재시작 직후처럼 판정을 처음부터 다시 시작해야 할 때 호출한다."""
        self.fail_streak = 0
        self.state = HEALTHY
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_serverguard_health.py -v`
Expected: PASS — 9 passed

- [ ] **Step 5: 커밋한다**

```bash
git add HiTessWorkBenchBackEnd/serverguard/health.py HiTessWorkBenchBackEnd/tests/test_serverguard_health.py
git commit -m "✨ feat: uvicorn 헬스 프로브·좀비 판정 상태 머신 추가

프로세스는 살아있고 HTTP 만 무응답인 좀비 상태를 15초 주기로 관측해
3분(12회) 연속 실패 시 zombie 로 판정한다. 상태 전이 시에만 알려
재시작이 반복 발동하지 않는다."
```

---

## Task 3: 재시작 예산 + 지수 백오프

**Files:**
- Create: `HiTessWorkBenchBackEnd/serverguard/backoff.py`
- Test: `HiTessWorkBenchBackEnd/tests/test_serverguard_backoff.py`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`HiTessWorkBenchBackEnd/tests/test_serverguard_backoff.py`:

```python
from serverguard.backoff import RestartPolicy


def test_first_restart_is_allowed_immediately():
    policy = RestartPolicy()

    assert policy.decide(now=1000.0) == ("go", 0)


def test_budget_allows_up_to_max_attempts_in_window():
    policy = RestartPolicy(window_sec=60, max_in_window=3)

    for index in range(3):
        assert policy.decide(now=1000.0 + index) == ("go", 0)
        policy.record_attempt(now=1000.0 + index)

    action, delay = policy.decide(now=1003.0)
    assert action == "wait"
    assert delay == 600


def test_attempts_outside_window_do_not_count():
    policy = RestartPolicy(window_sec=60, max_in_window=3)
    for index in range(3):
        policy.record_attempt(now=1000.0 + index)

    # 창(60초) 을 벗어난 시각 — 예산이 회복되어야 한다.
    assert policy.decide(now=1100.0) == ("go", 0)


def test_backoff_delay_grows_then_caps():
    policy = RestartPolicy(window_sec=60, max_in_window=1, backoff_steps=(600, 1200, 2400, 3600))
    observed = []
    now = 0.0

    for _ in range(5):
        policy.record_attempt(now=now)
        action, delay = policy.decide(now=now)
        assert action == "wait"
        observed.append(delay)
        now += delay          # 대기가 끝난 시점으로 시계를 옮긴다.

    assert observed == [600, 1200, 2400, 3600, 3600]


def test_waiting_period_blocks_further_restarts():
    policy = RestartPolicy(window_sec=60, max_in_window=1)
    policy.record_attempt(now=1000.0)
    policy.decide(now=1000.0)                       # 백오프 진입 (600초)

    action, delay = policy.decide(now=1100.0)       # 아직 대기 중

    assert action == "wait"
    assert delay == 500


def test_restart_is_allowed_again_after_wait_expires():
    policy = RestartPolicy(window_sec=60, max_in_window=1)
    policy.record_attempt(now=1000.0)
    policy.decide(now=1000.0)

    # 이것이 이 설계의 핵심이다 — 기존 동작은 여기서 영구 정지했다.
    assert policy.decide(now=1601.0) == ("go", 0)


def test_record_success_clears_backoff_level():
    policy = RestartPolicy(window_sec=60, max_in_window=1)
    policy.record_attempt(now=1000.0)
    policy.decide(now=1000.0)

    policy.record_success()

    assert policy.backoff_level == 0
    assert policy.decide(now=1000.0) == ("go", 0)


def test_reset_restores_initial_state():
    policy = RestartPolicy(window_sec=60, max_in_window=1)
    policy.record_attempt(now=1000.0)
    policy.decide(now=1000.0)

    policy.reset()

    assert policy.decide(now=1000.0) == ("go", 0)
    assert policy.history == []
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_serverguard_backoff.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'serverguard.backoff'`

- [ ] **Step 3: 구현한다**

`HiTessWorkBenchBackEnd/serverguard/backoff.py`:

```python
"""재시작 예산과 지수 백오프.

기존 동작(60초 내 5회 실패 후 자동 재시작 영구 포기, server_manager.py 의
_schedule_auto_restart)을 대체한다. 영구 정지는 무인 복구를 깨뜨린다 —
그 상태에서도 L1 프로세스는 살아 있어서 L2 가 개입하지 않기 때문에,
서버가 죽은 채로 아무도 살리지 않는 상태가 된다.

예산을 소진하면 멈추는 대신 점점 긴 간격으로 재시도한다. 무한 재시작 방지라는
원래 목적은 백오프가 대신 담당하고, 일시적 원인(DB 재기동, 디스크 일시 부족,
네트워크 드라이브 끊김)이 해소되면 사람 없이 스스로 복귀한다.
"""

RESTART_WINDOW_SEC = 60
MAX_RESTARTS_IN_WINDOW = 5
BACKOFF_STEPS_SEC = (600, 1200, 2400, 3600)      # 10 / 20 / 40 / 60분


class RestartPolicy:
    """지금 재시작해도 되는지 판단한다. 시계는 호출자가 주입한다(테스트 가능)."""

    def __init__(self, window_sec=RESTART_WINDOW_SEC,
                 max_in_window=MAX_RESTARTS_IN_WINDOW,
                 backoff_steps=BACKOFF_STEPS_SEC):
        self.window_sec = window_sec
        self.max_in_window = max_in_window
        self.backoff_steps = tuple(backoff_steps)
        self.history = []
        self.backoff_level = 0
        self.wait_until = 0.0

    def decide(self, now):
        """("go", 0) 또는 ("wait", 남은초) 를 반환한다.

        예산 소진을 판정하는 순간 백오프 단계를 올리고 대기 종료 시각을 확정한다.
        """
        if now < self.wait_until:
            return ("wait", self.wait_until - now)

        self.history = [t for t in self.history if now - t < self.window_sec]

        if len(self.history) >= self.max_in_window:
            step = min(self.backoff_level, len(self.backoff_steps) - 1)
            delay = self.backoff_steps[step]
            self.backoff_level += 1
            self.wait_until = now + delay
            self.history = []            # 대기 후에는 깨끗한 예산으로 재개한다.
            return ("wait", delay)

        return ("go", 0)

    def record_attempt(self, now):
        """재시작을 실제로 시도했음을 기록한다."""
        self.history.append(now)

    def record_success(self):
        """서버가 정상 응답을 회복했을 때 호출한다 — 백오프 단계를 초기화한다."""
        self.backoff_level = 0
        self.wait_until = 0.0
        self.history = []

    def reset(self):
        """사용자가 GUI 에서 직접 Start 를 눌렀을 때처럼 완전 초기화한다."""
        self.history = []
        self.backoff_level = 0
        self.wait_until = 0.0
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_serverguard_backoff.py -v`
Expected: PASS — 8 passed

- [ ] **Step 5: 커밋한다**

```bash
git add HiTessWorkBenchBackEnd/serverguard/backoff.py HiTessWorkBenchBackEnd/tests/test_serverguard_backoff.py
git commit -m "✨ feat: 재시작 지수 백오프 정책 추가 (영구 정지 대체)

기존 '60초 내 5회 실패 후 자동 재시작 영구 포기' 는 무인 복구를 깨뜨린다.
그 상태에서도 L1 은 살아있어 L2 가 개입하지 않으므로 서버가 죽은 채
방치된다. 10/20/40/60분 백오프로 바꿔 원인이 해소되면 스스로 복귀한다."
```

---

## Task 4: 자손 프로세스 수집·정리

**Files:**
- Create: `HiTessWorkBenchBackEnd/serverguard/proctree.py`
- Test: `HiTessWorkBenchBackEnd/tests/test_serverguard_proctree.py`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`HiTessWorkBenchBackEnd/tests/test_serverguard_proctree.py`:

```python
import os

import psutil
import pytest

from serverguard import proctree


class FakeProcess:
    """psutil.Process 의 최소 대역 — kill 호출 여부를 기록한다."""

    def __init__(self, pid, create_time, *, raises=None):
        self.pid = pid
        self._create_time = create_time
        self._raises = raises
        self.killed = False

    def create_time(self):
        if self._raises:
            raise self._raises
        return self._create_time

    def kill(self):
        self.killed = True


def test_snapshot_tree_returns_empty_for_missing_pid():
    # 존재할 수 없는 PID — psutil.NoSuchProcess 를 삼키고 빈 목록을 반환해야 한다.
    assert proctree.snapshot_tree(-1) == []


def test_snapshot_tree_records_current_process_children():
    entries = proctree.snapshot_tree(os.getpid())

    assert isinstance(entries, list)
    for entry in entries:
        assert set(entry) == {"pid", "name", "create_time"}


def test_kill_survivors_kills_matching_processes():
    fake = FakeProcess(pid=15880, create_time=111.0)
    snapshot = [{"pid": 15880, "name": "nastran.exe", "create_time": 111.0}]

    killed = proctree.kill_survivors(snapshot, proc_factory=lambda pid: fake)

    assert fake.killed is True
    assert killed == [{"pid": 15880, "name": "nastran.exe", "create_time": 111.0}]


def test_kill_survivors_skips_reused_pid():
    # 같은 PID 지만 create_time 이 다르면 무관한 새 프로세스다 — 죽이면 사고다.
    fake = FakeProcess(pid=15880, create_time=999.0)
    snapshot = [{"pid": 15880, "name": "nastran.exe", "create_time": 111.0}]

    killed = proctree.kill_survivors(snapshot, proc_factory=lambda pid: fake)

    assert fake.killed is False
    assert killed == []


def test_kill_survivors_skips_already_exited_process():
    def factory(pid):
        raise psutil.NoSuchProcess(pid)

    snapshot = [{"pid": 15880, "name": "nastran.exe", "create_time": 111.0}]

    assert proctree.kill_survivors(snapshot, proc_factory=factory) == []


def test_kill_survivors_continues_after_access_denied():
    denied = FakeProcess(pid=1, create_time=1.0, raises=psutil.AccessDenied(1))
    allowed = FakeProcess(pid=2, create_time=2.0)
    snapshot = [
        {"pid": 1, "name": "protected.exe", "create_time": 1.0},
        {"pid": 2, "name": "nastran.exe", "create_time": 2.0},
    ]
    lookup = {1: denied, 2: allowed}

    killed = proctree.kill_survivors(snapshot, proc_factory=lambda pid: lookup[pid])

    # 하나가 실패해도 나머지 정리는 계속되어야 한다.
    assert allowed.killed is True
    assert [entry["pid"] for entry in killed] == [2]
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_serverguard_proctree.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'serverguard.proctree'`

- [ ] **Step 3: 구현한다**

`HiTessWorkBenchBackEnd/serverguard/proctree.py`:

```python
"""uvicorn 자손 프로세스 수집과 정리.

uvicorn 을 죽여도 그 아래에서 돌던 해석 exe(nastran.exe, Cmb.Cli.exe,
MooringFitting.exe 등)는 살아남는다. 실제로 MooringFitting 손자 프로세스가
좀비로 남아 MSC 라이선스를 물고 있던 사례가 있었다. 정리하지 않으면 재시작에는
성공해도 다음 해석이 라이선스를 잡지 못한다.

수집은 죽이기 전에, 정리는 죽인 후에 해야 한다 — 부모가 사라진 뒤에는
자손 관계를 더 이상 조회할 수 없기 때문이다.
"""
import psutil


def snapshot_tree(pid):
    """pid 의 모든 자손 프로세스 정보를 수집한다. uvicorn 을 죽이기 전에 호출한다.

    create_time 을 함께 담는 이유는 나중에 PID 재사용을 판별하기 위함이다.
    """
    try:
        parent = psutil.Process(pid)
        children = parent.children(recursive=True)
    except Exception:
        return []

    entries = []
    for child in children:
        try:
            entries.append({
                "pid": child.pid,
                "name": child.name(),
                "create_time": child.create_time(),
            })
        except Exception:
            continue
    return entries


def kill_survivors(snapshot, *, proc_factory=psutil.Process):
    """snapshot 중 아직 살아있는 프로세스를 정리하고 실제로 죽인 목록을 반환한다.

    create_time 이 일치할 때만 죽인다. Windows 는 PID 를 재활용하므로, 이 확인이
    없으면 그사이 같은 PID 를 받은 무관한 프로세스를 죽이는 사고가 난다.
    """
    killed = []
    for entry in snapshot:
        try:
            proc = proc_factory(entry["pid"])
            if proc.create_time() != entry["create_time"]:
                continue
            proc.kill()
            killed.append(entry)
        except Exception:
            continue          # 이미 종료됨·권한 없음 — 나머지 정리를 계속한다.
    return killed
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_serverguard_proctree.py -v`
Expected: PASS — 6 passed

- [ ] **Step 5: 커밋한다**

```bash
git add HiTessWorkBenchBackEnd/serverguard/proctree.py HiTessWorkBenchBackEnd/tests/test_serverguard_proctree.py
git commit -m "✨ feat: 고아 해석 프로세스 수집·정리 모듈 추가

uvicorn 강제 종료 시 살아남는 nastran.exe 등 손자 프로세스를 정리한다.
과거 MooringFitting 좀비가 MSC 라이선스를 물어 후속 해석이 실패한 사례
방지. create_time 대조로 PID 재사용 오살상을 막는다."
```

---

## Task 5: PID 파일 (L1↔L2 통신)

**Files:**
- Create: `HiTessWorkBenchBackEnd/serverguard/pidfile.py`
- Test: `HiTessWorkBenchBackEnd/tests/test_serverguard_pidfile.py`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`HiTessWorkBenchBackEnd/tests/test_serverguard_pidfile.py`:

```python
from serverguard import pidfile


def test_write_then_read_roundtrip(tmp_path):
    pidfile.write(tmp_path, 4321)

    assert pidfile.read(tmp_path) == 4321


def test_read_returns_none_when_absent(tmp_path):
    assert pidfile.read(tmp_path) is None


def test_read_returns_none_for_garbage_content(tmp_path):
    (tmp_path / pidfile.PID_FILENAME).write_text("not a pid", encoding="utf-8")

    assert pidfile.read(tmp_path) is None


def test_clear_removes_file(tmp_path):
    pidfile.write(tmp_path, 4321)

    pidfile.clear(tmp_path)

    assert pidfile.read(tmp_path) is None


def test_clear_is_safe_when_file_missing(tmp_path):
    pidfile.clear(tmp_path)      # 예외를 던지면 안 된다.


def test_write_creates_missing_directory(tmp_path):
    nested = tmp_path / "logs"

    pidfile.write(nested, 999)

    assert pidfile.read(nested) == 999
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_serverguard_pidfile.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'serverguard.pidfile'`

- [ ] **Step 3: 구현한다**

`HiTessWorkBenchBackEnd/serverguard/pidfile.py`:

```python
"""L1 PID 파일 — L1(server_manager.py) 과 L2(server_watchdog.py) 의 유일한 통신 수단.

L1 이 기동 시 자기 PID 를 쓰고 정상 종료 시 지운다. L2 는 이 파일만 읽어
L1 의 생존을 판정한다. 소켓·IPC 없이 파일만 쓰므로 두 계층이 서로의 내부
구현을 몰라도 된다.
"""
from pathlib import Path

PID_FILENAME = "server_manager.pid"


def write(log_dir, pid):
    """PID 를 기록한다. 실패해도 예외를 밖으로 내보내지 않는다."""
    try:
        path = Path(log_dir)
        path.mkdir(parents=True, exist_ok=True)
        (path / PID_FILENAME).write_text(str(pid), encoding="utf-8")
    except Exception:
        pass


def read(log_dir):
    """기록된 PID 를 int 로 반환한다. 없거나 판독 불가하면 None."""
    try:
        raw = (Path(log_dir) / PID_FILENAME).read_text(encoding="utf-8").strip()
        return int(raw)
    except Exception:
        return None


def clear(log_dir):
    """PID 파일을 삭제한다. 없어도 조용히 넘어간다."""
    try:
        (Path(log_dir) / PID_FILENAME).unlink()
    except Exception:
        pass
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_serverguard_pidfile.py -v`
Expected: PASS — 6 passed

- [ ] **Step 5: 커밋한다**

```bash
git add HiTessWorkBenchBackEnd/serverguard/pidfile.py HiTessWorkBenchBackEnd/tests/test_serverguard_pidfile.py
git commit -m "✨ feat: L1 PID 파일 모듈 추가 (L1↔L2 통신)

L1 이 기동 시 PID 를 쓰고 정상 종료 시 지운다. L2 는 이 파일만 읽어
L1 생존을 판정한다 — 소켓·IPC 없이 파일만으로 계층을 분리한다."
```

---

## Task 6: 진단 스냅샷

**Files:**
- Create: `HiTessWorkBenchBackEnd/serverguard/diagnostics.py`
- Test: `HiTessWorkBenchBackEnd/tests/test_serverguard_diagnostics.py`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`HiTessWorkBenchBackEnd/tests/test_serverguard_diagnostics.py`:

```python
import os

from serverguard import diagnostics


def test_collect_returns_host_metrics():
    snapshot = diagnostics.collect()

    assert "cpu" in snapshot
    assert "mem_pct" in snapshot
    assert "disk_free_gb" in snapshot


def test_collect_includes_process_metrics_for_valid_pid():
    snapshot = diagnostics.collect(uvicorn_pid=os.getpid())

    assert snapshot["uvicorn_pid"] == os.getpid()
    assert snapshot["threads"] >= 1
    assert snapshot["proc_mem_mb"] > 0


def test_collect_survives_dead_pid():
    # 스냅샷 수집이 실패해도 재시작을 막아서는 안 된다.
    snapshot = diagnostics.collect(uvicorn_pid=-1)

    assert snapshot["uvicorn_pid"] == -1
    assert "threads" not in snapshot
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_serverguard_diagnostics.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'serverguard.diagnostics'`

- [ ] **Step 3: 구현한다**

`HiTessWorkBenchBackEnd/serverguard/diagnostics.py`:

```python
"""재시작 직전 진단 스냅샷 — 죽이면 사라지는 증거를 먼저 남긴다.

강제 재시작은 원인을 지운다. 그래서 프로세스를 죽이기 '전에' 호출해야 하며,
수집 자체가 실패하더라도 재시작을 막아서는 안 된다(모든 예외를 삼킨다).
"""
import psutil


def collect(uvicorn_pid=None):
    """호스트·프로세스 지표를 dict 로 반환한다. 실패한 항목은 키가 없다."""
    snapshot = {}

    try:
        snapshot["cpu"] = psutil.cpu_percent(interval=0.1)
        snapshot["mem_pct"] = psutil.virtual_memory().percent
        snapshot["disk_free_gb"] = round(psutil.disk_usage("/").free / (1024 ** 3), 1)
    except Exception:
        pass

    if uvicorn_pid is None:
        return snapshot

    snapshot["uvicorn_pid"] = uvicorn_pid
    try:
        proc = psutil.Process(uvicorn_pid)
        snapshot["threads"] = proc.num_threads()
        snapshot["proc_mem_mb"] = round(proc.memory_info().rss / (1024 ** 2), 1)
    except Exception:
        pass

    return snapshot
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_serverguard_diagnostics.py -v`
Expected: PASS — 3 passed

- [ ] **Step 5: `serverguard` 전체 테스트를 돌린다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_serverguard_*.py -v`
Expected: PASS — 41 passed

- [ ] **Step 6: 커밋한다**

```bash
git add HiTessWorkBenchBackEnd/serverguard/diagnostics.py HiTessWorkBenchBackEnd/tests/test_serverguard_diagnostics.py
git commit -m "✨ feat: 재시작 직전 진단 스냅샷 모듈 추가

CPU·메모리·디스크 여유와 uvicorn 프로세스 스레드/RSS 를 죽이기 전에
기록한다. 재시작은 원인을 지우므로 순서가 중요하다."
```

---

## Task 7: `server_manager.py` — 관측 배선

이 태스크부터는 tkinter GUI 배선이라 단위 테스트하지 않는다. 호출되는 로직은 Task 1~6에서 이미 검증되었고, 배선은 Task 13의 수동 매트릭스로 확인한다.

**Files:**
- Modify: `HiTessWorkBenchBackEnd/server_manager.py`

- [ ] **Step 1: import 와 상수를 추가한다**

`server_manager.py:15` 의 `BASE_DIR = Path(__file__).resolve().parent` **바로 아래**에 추가:

```python
LOG_DIR = BASE_DIR / "logs"
```

`server_manager.py:13` 의 `from pathlib import Path` **아래**에 추가:

```python
from serverguard import diagnostics, events, health, pidfile, proctree
from serverguard.backoff import RestartPolicy
```

- [ ] **Step 2: `__init__` 에 PID 파일 기록과 기동 이벤트를 배선한다**

`server_manager.py:63-64` 의 아래 두 줄을

```python
        self.intentional_stop = False
        self.restart_history: list[float] = []
```

다음으로 교체한다 (`restart_history` 는 Task 9 에서 `RestartPolicy` 로 대체되므로 여기서는 유지한다):

```python
        self.intentional_stop = False
        self.restart_history: list[float] = []
        # uvicorn stdout 을 날짜별 파일로 보존한다(앱을 닫아도 traceback 이 남는다).
        self.uvicorn_log = events.DailyLogWriter(LOG_DIR)
```

`server_manager.py:66-69` 의 아래 블록을

```python
        self._setup_window()
        self._build_ui()
        self._start_server()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
```

다음으로 교체한다:

```python
        self._setup_window()
        self._build_ui()

        # L2(server_watchdog.py) 가 이 파일만 읽어 L1 생존을 판정한다.
        pidfile.write(LOG_DIR, os.getpid())
        events.append_event(LOG_DIR, "L1", "manager_start", {"pid": os.getpid()})
        events.prune_events(LOG_DIR)
        events.prune_uvicorn_logs(LOG_DIR)

        self._start_server()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
```

- [ ] **Step 3: `_start_server` 에 기동 이벤트를 배선한다**

`server_manager.py:239-241` 의 아래 세 줄을

```python
            self._set_running(True)
            self._log("uvicorn 서버 시작됨 (port 9091)", "success")
            threading.Thread(target=self._stream_output, daemon=True).start()
```

다음으로 교체한다:

```python
            self._set_running(True)
            self._log("uvicorn 서버 시작됨 (port 9091)", "success")
            events.append_event(LOG_DIR, "L1", "server_start", {"pid": self.server_proc.pid})
            threading.Thread(target=self._stream_output, daemon=True).start()
```

- [ ] **Step 4: `_stream_output` 에서 uvicorn 로그를 파일로 tee 한다**

`server_manager.py:250-253` 의 아래 블록을

```python
        for line in self.server_proc.stdout:
            line = line.rstrip()
            if not line:
                continue
```

다음으로 교체한다:

```python
        for line in self.server_proc.stdout:
            line = line.rstrip()
            if not line:
                continue
            self.uvicorn_log.write(line)
```

- [ ] **Step 5: `_on_server_exit` 에 크래시 이벤트를 배선한다**

`server_manager.py:275-276` 의 아래 두 줄을

```python
        self._log("서버 프로세스가 예기치 않게 종료되었습니다.", "error")
        self._schedule_auto_restart()
```

다음으로 교체한다:

```python
        self._log("서버 프로세스가 예기치 않게 종료되었습니다.", "error")
        events.append_event(LOG_DIR, "L1", "crash_detected",
                            diagnostics.collect())
        self._schedule_auto_restart()
```

- [ ] **Step 6: `_on_close` 에 정리 로직을 배선한다**

`server_manager.py:492-494` 의 아래 블록을

```python
    def _on_close(self):
        self._stop_server()
        self.root.destroy()
```

다음으로 교체한다:

```python
    def _on_close(self):
        self._stop_server()
        events.append_event(LOG_DIR, "L1", "manager_stop")
        # PID 파일을 지워야 L2 가 '정상 종료' 와 '급사' 를 구분할 수 있다.
        pidfile.clear(LOG_DIR)
        self.uvicorn_log.close()
        self.root.destroy()
```

- [ ] **Step 7: 서버를 띄워 로그가 실제로 생기는지 확인한다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe server_manager.py`

GUI 가 뜨고 서버가 Running 이 된 뒤 창을 닫는다. 그 다음:

Run: `cd HiTessWorkBenchBackEnd && ls logs/ logs/uvicorn/ && cat logs/server_events.jsonl`

Expected:
- `logs/server_events.jsonl` 에 `manager_start` → `server_start` → `manager_stop` 3줄
- `logs/uvicorn/<오늘날짜>.log` 에 uvicorn 기동 로그
- `logs/server_manager.pid` 는 **삭제되어 있음**(정상 종료했으므로)

- [ ] **Step 8: 커밋한다**

```bash
git add HiTessWorkBenchBackEnd/server_manager.py
git commit -m "✨ feat: Server Manager 에 관측 배선 추가 (PID 파일·이벤트·로그 보존)

기동/종료/크래시를 server_events.jsonl 에 기록하고, uvicorn stdout 을
logs/uvicorn/YYYYMMDD.log 로 보존한다. 지금까지 GUI 위젯에만 남아
앱을 닫으면 크래시 traceback 이 통째로 사라졌다.
PID 파일은 L2 가 L1 생존을 판정하는 유일한 근거다."
```

---

## Task 8: `server_manager.py` — 헬스체크 + 좀비 강제 재시작

**Files:**
- Modify: `HiTessWorkBenchBackEnd/server_manager.py`

- [ ] **Step 1: 헬스체크 상수를 추가한다**

Task 7 에서 추가한 `LOG_DIR = BASE_DIR / "logs"` **아래**에 추가:

```python
# ── 헬스 체크(좀비 감지) 파라미터 ──
# poll() 은 '프로세스가 살아있는가' 만 본다. 프로세스는 살아있는데 HTTP 응답만
# 없는 상태(DB 커넥션 고갈, ThreadPool 데드락, 디스크 풀)를 잡으려면 별도 관측이
# 필요하다. 재시작은 되돌릴 수 없으므로 임계값을 3분으로 넉넉히 잡는다 —
# 해석 exe 는 별도 프로세스라 CPU 가 포화돼도 uvicorn 이벤트 루프는 막히지 않는다.
HEALTH_INTERVAL_MS = health.CHECK_INTERVAL_SEC * 1000
```

- [ ] **Step 2: `__init__` 에 헬스 트래커를 추가하고 루프를 시작한다**

Task 7 에서 만든 `self.uvicorn_log = events.DailyLogWriter(LOG_DIR)` **아래**에 추가:

```python
        self.health_tracker = health.HealthTracker()
        # 재시작 예산·백오프 판단. 기존 restart_history 는 Task 9 에서 제거한다.
        self.restart_policy = RestartPolicy()
```

그리고 `self.root.protocol("WM_DELETE_WINDOW", self._on_close)` **바로 위**에 추가:

```python
        self.root.after(HEALTH_INTERVAL_MS, self._health_tick)
```

- [ ] **Step 3: 헬스체크 메서드를 추가한다**

`_schedule_auto_restart` 메서드(`server_manager.py:279`) **바로 위**에 다음 세 메서드를 추가한다:

```python
    # ── 헬스 체크(좀비 감지) ─────────────────────────────────────────────
    def _health_tick(self):
        """15초마다 HTTP 응답을 관측한다. 프로브는 GUI 를 막지 않도록 스레드에서."""
        self.root.after(HEALTH_INTERVAL_MS, self._health_tick)

        # 프로세스가 이미 죽었거나 업데이트 중이면 크래시 경로가 담당한다.
        if self.is_updating or not (self.server_proc and self.server_proc.poll() is None):
            self.health_tracker.reset()
            return

        threading.Thread(target=self._probe_health, daemon=True).start()

    def _probe_health(self):
        ok = health.probe()
        self.root.after(0, self._on_health_result, ok)

    def _on_health_result(self, ok):
        """관측 결과를 상태로 환산하고, 전이가 일어난 순간에만 행동한다."""
        state, changed = self.health_tracker.record(ok, now=time.time())
        if not changed:
            return

        if state == health.HEALTHY:
            self._log("서버 응답이 회복되었습니다.", "success")
            events.append_event(LOG_DIR, "L1", "health_recovered")
            self.restart_policy.record_success()
        elif state == health.SUSPECT:
            self._log("서버 응답이 없습니다 — 관찰 중.", "warning")
            events.append_event(LOG_DIR, "L1", "health_degraded",
                                {"fail_streak": self.health_tracker.fail_streak})
        elif state == health.ZOMBIE:
            self._force_restart_zombie()
```

`self.restart_policy` 는 Step 2 에서 이미 생성했다. Task 8 만 적용한 상태에서도 정상 동작한다 — 이 시점의 `_schedule_auto_restart` 는 아직 기존 `restart_history` 를 쓰고, `restart_policy` 는 `record_success()` 로만 쓰인다. Task 9 에서 둘을 합친다.

- [ ] **Step 4: 좀비 강제 재시작 메서드를 추가한다**

Step 3 에서 추가한 `_on_health_result` **바로 아래**에 추가:

```python
    def _force_restart_zombie(self):
        """프로세스는 살아있으나 3분간 HTTP 무응답 — 강제로 내리고 다시 띄운다.

        순서가 중요하다. 진단 스냅샷과 자손 목록을 '죽이기 전에' 확보해야 하며,
        고아 해석 exe 를 정리하지 않으면 MSC 라이선스가 물린 채 남는다.
        """
        pid = self.server_proc.pid if self.server_proc else None
        self._log("3분간 응답이 없습니다 — 강제 재시작합니다.", "error")

        snapshot = diagnostics.collect(uvicorn_pid=pid)
        children = proctree.snapshot_tree(pid) if pid else []
        snapshot["fail_streak"] = self.health_tracker.fail_streak
        snapshot["last_ok"] = self.health_tracker.last_ok_at
        snapshot["children"] = children
        events.append_event(LOG_DIR, "L1", "zombie_detected", snapshot)

        events.append_event(LOG_DIR, "L1", "restart_begin", {"reason": "zombie"})

        # 이 종료는 코드가 의도한 것이므로 크래시 자동 재시작 경로를 타면 안 된다.
        self.intentional_stop = True
        if self.server_proc and self.server_proc.poll() is None:
            self.server_proc.terminate()
            try:
                self.server_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.server_proc.kill()
        self.server_proc = None
        self._set_running(False)

        killed = proctree.kill_survivors(children)
        if killed:
            self._log(f"  고아 해석 프로세스 {len(killed)}개 정리", "warning")
            events.append_event(LOG_DIR, "L1", "orphan_killed", {"killed": killed})

        self._kill_port(9091)
        self.health_tracker.reset()
        self.root.after(RESTART_DELAY_MS, self._zombie_restart_fire)

    def _zombie_restart_fire(self):
        if self.is_updating:
            return
        if self.server_proc and self.server_proc.poll() is None:
            return
        self._start_server()
        events.append_event(LOG_DIR, "L1", "restart_done", {"reason": "zombie"})
```

- [ ] **Step 5: 커밋한다** (Task 9 완료 후 함께 검증하므로 여기서는 커밋만)

```bash
git add HiTessWorkBenchBackEnd/server_manager.py
git commit -m "✨ feat: 좀비 상태(프로세스 생존·HTTP 무응답) 감지 및 강제 재시작

15초 주기 /api/version 프로브로 3분 연속 무응답 시 강제 재시작한다.
죽이기 전에 진단 스냅샷과 자손 목록을 확보하고, 재시작 후 살아남은
해석 exe 를 정리해 MSC 라이선스 누수를 막는다."
```

---

## Task 9: `server_manager.py` — 백오프 전환

**Files:**
- Modify: `HiTessWorkBenchBackEnd/server_manager.py`

- [ ] **Step 1: 기존 크래시 루프 상수를 백오프 상수로 교체한다**

`server_manager.py:38-40` 의 아래 세 줄을

```python
RESTART_DELAY_MS       = 3000  # 종료 감지 후 재시작까지 대기(포트 정리·안정화 시간)
RESTART_WINDOW_SEC     = 60    # 이 시간(초) 창 안에서 자동 재시작 횟수를 센다
MAX_RESTARTS_IN_WINDOW = 5     # 창 안에서 이 횟수를 넘기면 자동 재시작 중단(무한 루프 방지)
```

다음으로 교체한다:

```python
RESTART_DELAY_MS = 3000  # 종료 감지 후 재시작까지 대기(포트 정리·안정화 시간)
# 창 안의 재시작 예산과 소진 시 백오프 간격은 serverguard.backoff 가 관리한다.
# 과거에는 예산을 소진하면 자동 재시작을 영구 포기했는데, 그 상태에서도 이 GUI
# 프로세스는 살아 있어서 L2 워치독이 개입하지 않는다 — 서버가 죽은 채 아무도
# 살리지 않는 상태가 됐다. 이제는 10/20/40/60분 백오프로 계속 재시도한다.
```

- [ ] **Step 2: 쓰이지 않게 된 `restart_history` 를 제거한다**

Task 7 에서 남겨둔 아래 줄을 **삭제한다** (`RestartPolicy` 는 Task 8 Step 2 에서 이미 생성했다):

```python
        self.restart_history: list[float] = []
```

그리고 `__init__` 의 주석 블록(`server_manager.py:60-62`) 중 `restart_history` 를 설명하는 줄을 다음으로 교체한다:

```python
        #  restart_policy  : 재시작 예산과 백오프 판단(serverguard.backoff).
```

- [ ] **Step 3: `_schedule_auto_restart` 를 백오프 기반으로 교체한다**

`server_manager.py:279-302` 의 `_schedule_auto_restart` 메서드 **전체**를 다음으로 교체한다:

```python
    def _schedule_auto_restart(self):
        """크래시 감지 시 재시작을 예약한다. 반복 실패하면 간격을 늘려가며 계속 시도한다."""
        now = time.time()
        action, delay = self.restart_policy.decide(now)

        if action == "wait":
            minutes = round(delay / 60, 1)
            self._log(
                f"연속 기동 실패가 이어집니다. {minutes}분 후 다시 시도합니다.",
                "error",
            )
            events.append_event(LOG_DIR, "L1", "backoff_wait",
                                {"delay_sec": round(delay),
                                 "level": self.restart_policy.backoff_level})
            self.root.after(int(delay * 1000), self._auto_restart_fire)
            return

        self.restart_policy.record_attempt(now)
        self._log(f"{RESTART_DELAY_MS // 1000}초 후 자동으로 재시작합니다.", "warning")
        self.root.after(RESTART_DELAY_MS, self._auto_restart_fire)
```

- [ ] **Step 4: `_auto_restart_fire` 에 완료 이벤트를 추가한다**

`server_manager.py:304-311` 의 `_auto_restart_fire` 메서드 **전체**를 다음으로 교체한다:

```python
    def _auto_restart_fire(self):
        # 대기 사이에 사용자가 Update/Stop 했거나 이미 살아났으면 재시작하지 않는다.
        if self.is_updating:
            return
        if self.server_proc and self.server_proc.poll() is None:
            return
        self._log("자동 재시작을 실행합니다.", "info")
        self._start_server()
        events.append_event(LOG_DIR, "L1", "restart_done", {"reason": "crash"})
```

- [ ] **Step 5: `_toggle_server` 의 수동 Start 초기화를 교체한다**

`server_manager.py:333-335` 의 아래 블록을

```python
            # 사용자가 직접 Start → 자동 재시작 카운터를 초기화(수동 재개는 깨끗한 예산으로).
            self.restart_history = []
            self._start_server()
```

다음으로 교체한다:

```python
            # 사용자가 직접 Start → 예산과 백오프 단계를 모두 초기화한다.
            self.restart_policy.reset()
            self.health_tracker.reset()
            self._start_server()
```

- [ ] **Step 6: 서버를 띄워 정상 동작과 헬스 로그를 확인한다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe server_manager.py`

GUI 에서 Running 을 확인하고 **1분 이상** 둔 뒤 창을 닫는다.

Run: `cd HiTessWorkBenchBackEnd && cat logs/server_events.jsonl`

Expected: `manager_start` → `server_start` → `manager_stop`.
**`health_degraded` 가 없어야 한다** — 정상 상태에서는 상태 전이가 없으므로 헬스 로그가 쌓이면 안 된다. 쌓였다면 프로브 URL 이나 포트를 확인한다.

- [ ] **Step 7: 커밋한다**

```bash
git add HiTessWorkBenchBackEnd/server_manager.py
git commit -m "✨ feat: 크래시 루프 영구 정지를 지수 백오프로 대체

기존에는 60초 내 5회 실패 시 자동 재시작을 영구 포기해, 사람이 Start 를
누를 때까지 서버가 죽은 채 방치됐다. 이제 10/20/40/60분 간격으로 계속
재시도하므로 일시적 원인이 해소되면 스스로 복귀한다."
```

---

## Task 10: `server_manager.py` — DB 관측 (기록 전용)

**Files:**
- Modify: `HiTessWorkBenchBackEnd/server_manager.py`

- [ ] **Step 1: DB 관측 상수를 추가한다**

Task 8 에서 추가한 `HEALTH_INTERVAL_MS = ...` **아래**에 추가:

```python
# ── DB 관측(기록 전용) ──
# /api/version 은 DB 를 타지 않으므로 MySQL 이 죽어도 헬스체크는 통과한다.
# 이것은 의도된 동작이다 — DB 가 죽었을 때 백엔드를 재시작해도 DB 는 살아나지
# 않고 진행 중 작업만 추가로 파괴한다. 그래서 관측해서 기록만 하고 복구는 하지 않는다.
DB_CHECK_INTERVAL_MS = 60_000
```

- [ ] **Step 2: DB 관측 상태를 `__init__` 에 추가한다**

Task 8 에서 추가한 `self.health_tracker = health.HealthTracker()` **아래**에 추가:

```python
        self.db_reachable = True     # 전이 시에만 기록하기 위한 직전 상태
```

그리고 Task 8 에서 추가한 `self.root.after(HEALTH_INTERVAL_MS, self._health_tick)` **아래**에 추가:

```python
        self.root.after(DB_CHECK_INTERVAL_MS, self._db_tick)
```

- [ ] **Step 3: DB 관측 메서드를 추가한다**

Task 8 에서 추가한 `_zombie_restart_fire` **바로 아래**에 추가:

```python
    # ── DB 관측(기록 전용, 복구 없음) ────────────────────────────────────
    def _db_tick(self):
        self.root.after(DB_CHECK_INTERVAL_MS, self._db_tick)
        threading.Thread(target=self._probe_db, daemon=True).start()

    def _probe_db(self):
        """app/database.py 와 같은 .env 를 읽어 직접 접속한다.

        백엔드를 경유하지 않으므로 백엔드 커넥션 풀에 영향이 없고,
        자격증명을 별도로 중복 정의하지도 않는다.
        """
        ok, detail = True, {}
        try:
            import pymysql
            from dotenv import load_dotenv

            load_dotenv(BASE_DIR / ".env")
            conn = pymysql.connect(
                host=os.getenv("DB_HOST", "localhost"),
                port=int(os.getenv("DB_PORT", "3306")),
                user=os.getenv("DB_USER", "admin"),
                password=os.getenv("DB_PASSWORD", ""),
                database=os.getenv("DB_NAME", "hitessworkbench"),
                connect_timeout=5,
            )
            try:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT 1")
                    cursor.fetchone()
            finally:
                conn.close()
        except Exception as exc:
            ok = False
            detail = {"error": f"{type(exc).__name__}: {exc}"[:300]}

        self.root.after(0, self._on_db_result, ok, detail)

    def _on_db_result(self, ok, detail):
        if ok == self.db_reachable:
            return                       # 전이가 없으면 기록하지 않는다.
        self.db_reachable = ok
        if ok:
            self._log("DB 연결이 회복되었습니다.", "success")
            events.append_event(LOG_DIR, "L1", "db_recovered")
        else:
            self._log("DB 에 연결할 수 없습니다 (기록만 — 재시작하지 않음).", "warning")
            events.append_event(LOG_DIR, "L1", "db_unreachable", detail)
```

- [ ] **Step 4: MySQL 을 내려 관측이 동작하는지 확인한다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe server_manager.py`

GUI 가 Running 이 된 뒤 MySQL 서비스를 중지한다(관리자 PowerShell):

Run: `Stop-Service MySQL80` (서비스명이 다르면 `Get-Service *mysql*` 로 확인)

1분 대기 후 GUI 로그에 "DB 에 연결할 수 없습니다" 가 뜨는지 확인하고, **서버가 재시작되지 않았는지** 확인한다(상태 표시등이 계속 Running 이어야 한다). 이후 MySQL 을 다시 올린다:

Run: `Start-Service MySQL80`

1분 대기 후 "DB 연결이 회복되었습니다" 를 확인하고 창을 닫는다.

Run: `cd HiTessWorkBenchBackEnd && cat logs/server_events.jsonl`
Expected: `db_unreachable` 과 `db_recovered` 가 각 1회씩. **`zombie_detected`·`restart_done` 은 없어야 한다.**

- [ ] **Step 5: 커밋한다**

```bash
git add HiTessWorkBenchBackEnd/server_manager.py
git commit -m "✨ feat: DB 도달성 관측 추가 (기록 전용, 재시작 없음)

/api/version 은 DB 를 타지 않아 MySQL 이 죽어도 헬스체크는 통과한다.
DB 장애에 재시작으로 대응하면 DB 는 살아나지 않고 진행 중 작업만 파괴되므로,
1분 주기로 관측해 db_unreachable/db_recovered 를 기록만 한다."
```

---

## Task 11: `server_watchdog.py` — L2 단발 워치독

**Files:**
- Create: `HiTessWorkBenchBackEnd/server_watchdog.py`
- Test: `HiTessWorkBenchBackEnd/tests/test_server_watchdog.py`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`HiTessWorkBenchBackEnd/tests/test_server_watchdog.py`:

```python
import json

import psutil

import server_watchdog as sw


class FakeProcess:
    def __init__(self, cmdline, running=True):
        self._cmdline = cmdline
        self._running = running

    def is_running(self):
        return self._running

    def cmdline(self):
        return self._cmdline


def test_decide_noop_when_manager_alive():
    action = sw.decide_action(manager_alive=True, http_ok=False,
                              revive_history=[], now=1000.0)

    # L1 이 살아있으면 L2 는 절대 개입하지 않는다 — 재시작 경합 방지.
    assert action == "noop"


def test_decide_noop_when_manager_dead_but_http_answers():
    # 누군가 uvicorn 만 수동으로 띄운 경우 — 서비스는 정상이다.
    action = sw.decide_action(manager_alive=False, http_ok=True,
                              revive_history=[], now=1000.0)

    assert action == "noop"


def test_decide_revive_when_both_dead():
    action = sw.decide_action(manager_alive=False, http_ok=False,
                              revive_history=[], now=1000.0)

    assert action == "revive"


def test_decide_giveup_after_too_many_revives_in_window():
    history = [1000.0, 1300.0, 1600.0]

    action = sw.decide_action(manager_alive=False, http_ok=False,
                              revive_history=history, now=1700.0,
                              window_sec=1800, max_revives=3)

    assert action == "giveup"


def test_decide_revive_again_after_window_passes():
    history = [1000.0, 1300.0, 1600.0]

    action = sw.decide_action(manager_alive=False, http_ok=False,
                              revive_history=history, now=5000.0,
                              window_sec=1800, max_revives=3)

    assert action == "revive"


def test_is_manager_alive_accepts_matching_cmdline():
    fake = FakeProcess(["python.exe", "server_manager.py"])

    assert sw.is_manager_alive(1234, proc_factory=lambda pid: fake) is True


def test_is_manager_alive_rejects_reused_pid():
    # PID 재사용 — 무관한 프로세스를 L1 으로 오인하면 영원히 복구하지 않는다.
    fake = FakeProcess(["notepad.exe"])

    assert sw.is_manager_alive(1234, proc_factory=lambda pid: fake) is False


def test_is_manager_alive_rejects_none_pid():
    assert sw.is_manager_alive(None) is False


def test_is_manager_alive_rejects_missing_process():
    def factory(pid):
        raise psutil.NoSuchProcess(pid)

    assert sw.is_manager_alive(1234, proc_factory=factory) is False


def test_revive_history_roundtrip(tmp_path):
    sw.record_revive(tmp_path, now=1000.0)
    sw.record_revive(tmp_path, now=2000.0)

    assert sw.read_revive_history(tmp_path) == [1000.0, 2000.0]


def test_read_revive_history_returns_empty_when_absent(tmp_path):
    assert sw.read_revive_history(tmp_path) == []


def test_read_revive_history_survives_corrupt_state_file(tmp_path):
    (tmp_path / sw.STATE_FILENAME).write_text("{ broken", encoding="utf-8")

    assert sw.read_revive_history(tmp_path) == []


def test_record_revive_keeps_only_recent_entries(tmp_path):
    sw.record_revive(tmp_path, now=1000.0)

    sw.record_revive(tmp_path, now=1000.0 + sw.REVIVE_WINDOW_SEC + 1)

    history = sw.read_revive_history(tmp_path)
    assert history == [1000.0 + sw.REVIVE_WINDOW_SEC + 1]


def test_state_file_is_valid_json(tmp_path):
    sw.record_revive(tmp_path, now=1000.0)

    payload = json.loads((tmp_path / sw.STATE_FILENAME).read_text(encoding="utf-8"))

    assert payload["revives"] == [1000.0]
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_server_watchdog.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server_watchdog'`

- [ ] **Step 3: 구현한다**

`HiTessWorkBenchBackEnd/server_watchdog.py`:

```python
"""L2 워치독 — 상주하지 않는 단발 점검 스크립트.

작업 스케줄러가 5분마다 실행한다. 상주 프로세스가 아니므로 '워치독이 죽으면?'
이라는 질문 자체가 없다 — 최종 감시자가 OS 가 된다.

경계 규칙: uvicorn 은 절대 직접 건드리지 않는다. L1(server_manager.py) 이
살아 있으면 아무 것도 하지 않고 즉시 종료한다. 두 계층이 동시에 재시작을
시도하는 경합을 원천 차단하기 위함이다.

파일명이 watchdog.py 가 아닌 이유: PyPI 에 watchdog 패키지가 있어, 백엔드 루트에
watchdog.py 를 두면 cwd=이 폴더로 실행되는 uvicorn 의 import 를 섀도잉한다.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
# 스케줄러가 다른 작업 디렉토리로 실행할 수 있으므로 import 경로를 명시적으로 보장한다.
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

import psutil                                          # noqa: E402

from serverguard import events, health, pidfile        # noqa: E402

LOG_DIR = BASE_DIR / "logs"
STATE_FILENAME = "watchdog_state.json"
LAUNCHER = BASE_DIR / "HiTESS_Server.bat"

MANAGER_MARKER = "server_manager.py"
REVIVE_WINDOW_SEC = 1800          # 30분
MAX_REVIVES_IN_WINDOW = 3
STARTUP_GRACE_SEC = 30            # 재기동 후 헬스 확인까지 기다리는 시간


def is_manager_alive(pid, *, proc_factory=psutil.Process, marker=MANAGER_MARKER):
    """PID 가 살아있고 그것이 진짜 L1 인지 확인한다.

    Windows 는 PID 를 재활용한다. cmdline 검증을 빠뜨리면 무관한 프로세스를
    L1 으로 오인해 영원히 복구하지 않는다.
    """
    if not pid:
        return False
    try:
        proc = proc_factory(pid)
        if not proc.is_running():
            return False
        return marker in " ".join(proc.cmdline())
    except Exception:
        return False


def read_revive_history(log_dir):
    """최근 재기동 시각 목록을 반환한다. 없거나 손상되었으면 빈 목록."""
    try:
        raw = (Path(log_dir) / STATE_FILENAME).read_text(encoding="utf-8")
        payload = json.loads(raw)
        return [float(t) for t in payload.get("revives", [])]
    except Exception:
        return []


def record_revive(log_dir, *, now=None, window_sec=REVIVE_WINDOW_SEC):
    """재기동을 기록한다. 창을 벗어난 오래된 기록은 버린다."""
    now = now if now is not None else time.time()
    history = [t for t in read_revive_history(log_dir) if now - t < window_sec]
    history.append(now)
    try:
        path = Path(log_dir)
        path.mkdir(parents=True, exist_ok=True)
        (path / STATE_FILENAME).write_text(
            json.dumps({"revives": history}), encoding="utf-8"
        )
    except Exception:
        pass
    return history


def decide_action(*, manager_alive, http_ok, revive_history, now,
                  window_sec=REVIVE_WINDOW_SEC, max_revives=MAX_REVIVES_IN_WINDOW):
    """워치독이 취할 행동을 결정한다: "noop" | "revive" | "giveup".

    L1 이 백오프로 대기하는 동안에도 L1 프로세스는 살아 있으므로 "noop" 이 된다.
    이는 의도된 동작이다 — 여기서 L2 가 끼어들면 백오프의 폭주 억제가 무력화된다.
    """
    if manager_alive:
        return "noop"
    if http_ok:
        return "noop"

    recent = [t for t in revive_history if now - t < window_sec]
    if len(recent) >= max_revives:
        return "giveup"
    return "revive"


def revive():
    """HiTESS_Server.bat 을 분리 실행한다.

    워치독은 30초 뒤 종료되므로 자식이 딸려 죽으면 안 된다. DETACHED_PROCESS 로
    cmd 를 워치독에서 떼어내고, start 가 bat 에 새 콘솔을 붙여 GUI 가 뜨게 한다.
    (워치독 자신은 pythonw.exe 로 실행되어 콘솔이 없다.)
    """
    subprocess.Popen(
        ["cmd", "/c", "start", "", str(LAUNCHER)],
        cwd=str(BASE_DIR),
        creationflags=subprocess.DETACHED_PROCESS,
        close_fds=True,
    )


def main():
    now = time.time()
    manager_alive = is_manager_alive(pidfile.read(LOG_DIR))
    http_ok = health.probe() if not manager_alive else False

    action = decide_action(
        manager_alive=manager_alive,
        http_ok=http_ok,
        revive_history=read_revive_history(LOG_DIR),
        now=now,
    )

    if action == "noop":
        return 0

    if action == "giveup":
        events.append_event(LOG_DIR, "L2", "watchdog_giveup",
                            {"window_sec": REVIVE_WINDOW_SEC,
                             "max_revives": MAX_REVIVES_IN_WINDOW})
        return 1

    events.append_event(LOG_DIR, "L2", "watchdog_revive", {"launcher": str(LAUNCHER)})
    record_revive(LOG_DIR, now=now)
    revive()

    time.sleep(STARTUP_GRACE_SEC)
    recovered = health.probe()
    events.append_event(LOG_DIR, "L2", "watchdog_revive_result",
                        {"recovered": recovered})
    return 0 if recovered else 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_server_watchdog.py -v`
Expected: PASS — 13 passed

- [ ] **Step 5: L1 이 살아있을 때 워치독이 개입하지 않는지 확인한다**

먼저 Server Manager 를 띄운다:

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe server_manager.py`

GUI 가 Running 이 된 상태에서 **다른 터미널**로:

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe server_watchdog.py; echo "exit=$?"`
Expected: 즉시 종료, `exit=0`. 새 GUI 창이 뜨지 않고, `logs/server_events.jsonl` 에 `watchdog_*` 이벤트가 **추가되지 않아야** 한다.

- [ ] **Step 6: 전체 테스트를 돌린다**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest -q`
Expected: 기존 테스트 포함 전부 통과 (신규 54개 포함)

- [ ] **Step 7: 커밋한다**

```bash
git add HiTessWorkBenchBackEnd/server_watchdog.py HiTessWorkBenchBackEnd/tests/test_server_watchdog.py
git commit -m "✨ feat: L2 단발 워치독 추가 — Server Manager 자체를 감시

작업 스케줄러가 5분마다 실행하는 비상주 스크립트. L1 이 살아있으면 즉시
종료하고, 죽었을 때만 HiTESS_Server.bat 을 재기동한다. uvicorn 은 절대
직접 건드리지 않아 두 계층의 재시작 경합을 차단한다.
PyPI watchdog 패키지 섀도잉을 피하려 파일명을 server_watchdog.py 로 둔다."
```

---

## Task 12: 작업 스케줄러 등록 스크립트

**Files:**
- Create: `scripts/install_watchdog_task.ps1`

- [ ] **Step 1: 스크립트를 작성한다**

`scripts/install_watchdog_task.ps1`:

```powershell
<#
.SYNOPSIS
  HiTESS WorkBench L2 워치독을 Windows 작업 스케줄러에 등록한다.

.DESCRIPTION
  서버(145)에서 1회만 실행하면 된다. 이후 git pull 만으로 워치독 코드가 갱신된다.

  트리거 2개를 등록한다:
   - 5분마다 반복: 상시 감시
   - 로그온 시  : 리부트 후 RDP 로그인만 하면 백엔드가 자동으로 올라온다

  '사용자가 로그온한 경우에만 실행' 이어야 한다. GUI(tkinter) 를 띄워야 하므로
  세션 0 에서 돌면 안 된다.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install_watchdog_task.ps1
#>
[CmdletBinding()]
param(
    [string]$TaskName = 'HiTessWatchdog'
)

$ErrorActionPreference = 'Stop'

$repoRoot   = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot 'HiTessWorkBenchBackEnd'
$python     = Join-Path $backendDir 'WorkBenchEnv\Scripts\pythonw.exe'
$script     = Join-Path $backendDir 'server_watchdog.py'

if (-not (Test-Path -LiteralPath $python)) {
    throw "Python 을 찾을 수 없습니다: $python"
}
if (-not (Test-Path -LiteralPath $script)) {
    throw "워치독 스크립트를 찾을 수 없습니다: $script"
}

# pythonw.exe 를 쓰는 이유: 5분마다 콘솔 창이 깜빡이면 서버 운영자가 견딜 수 없다.
$action = New-ScheduledTaskAction -Execute $python -Argument "`"$script`"" -WorkingDirectory $backendDir

$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration ([TimeSpan]::MaxValue)

# 도메인 계정이면 USERNAME 만으로는 해석되지 않는다 — 정규화된 이름을 쓴다.
$account = "$env:USERDOMAIN\$env:USERNAME"

$logon = New-ScheduledTaskTrigger -AtLogOn -User $account

# InteractiveToken: 로그온한 사용자 세션에서 실행 → GUI 를 띄울 수 있다.
$principal = New-ScheduledTaskPrincipal -UserId $account `
    -LogonType Interactive -RunLevel Highest

# 워치독은 30초 grace 후 종료되므로 5분이면 충분하다. 겹쳐 도는 것을 막는다.
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "기존 '$TaskName' 태스크를 제거합니다."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName `
    -Action $action `
    -Trigger @($repeat, $logon) `
    -Principal $principal `
    -Settings $settings `
    -Description 'HiTESS WorkBench 백엔드 L2 워치독 — Server Manager 생존 감시 및 재기동' | Out-Null

Write-Host ""
Write-Host "'$TaskName' 등록 완료." -ForegroundColor Green
Write-Host "  실행: $python"
Write-Host "  대상: $script"
Write-Host ""
Write-Host "즉시 1회 실행해 확인하려면:" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
Write-Host "등록 상태 확인:" -ForegroundColor Cyan
Write-Host "  Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
```

- [ ] **Step 2: 개발 PC 에서 등록·확인·해제까지 돌려본다**

Server Manager 를 띄운 상태에서 (워치독이 개입하지 않아야 정상):

Run: `powershell -ExecutionPolicy Bypass -File scripts\install_watchdog_task.ps1`
Expected: `'HiTessWatchdog' 등록 완료.` 초록색 출력

Run: `Start-ScheduledTask -TaskName HiTessWatchdog; Start-Sleep -Seconds 5; Get-ScheduledTask -TaskName HiTessWatchdog | Get-ScheduledTaskInfo | Select-Object LastRunTime, LastTaskResult`
Expected: `LastTaskResult` 가 `0`. 새 GUI 창이 뜨지 않고 `logs/server_events.jsonl` 에 `watchdog_*` 이벤트가 없어야 한다.

개발 PC 를 원상 복구한다 (이 태스크는 **서버에만** 있어야 한다):

Run: `Unregister-ScheduledTask -TaskName HiTessWatchdog -Confirm:$false`

- [ ] **Step 3: 커밋한다**

```bash
git add scripts/install_watchdog_task.ps1
git commit -m "✨ feat: L2 워치독 작업 스케줄러 등록 스크립트 추가

5분 반복 + 로그온 시 트리거 2개를 등록한다. 로그온 트리거는 리부트 후
RDP 로그인만 하면 백엔드가 자동으로 올라오게 해 잔여 리스크를 부분 완화한다.
GUI 를 띄워야 하므로 InteractiveToken 으로 실행한다."
```

---

## Task 13: 고장 재현 검증 (설계서 §8)

단위 테스트가 못 잡는 통합 동작을 실제로 고장 내서 확인한다. **개발 PC 에서 수행**하고, 결과를 아래 표에 기록한 뒤 서버에 반영한다.

**Files:** 없음 (검증만)

- [ ] **Step 1: 크래시 자동 재시작을 확인한다**

Server Manager 를 띄운 뒤, uvicorn PID 를 찾아 강제 종료한다:

Run: `Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like '*uvicorn*' } | Select-Object ProcessId, CommandLine`
Run: `taskkill /PID <위에서 찾은 PID> /F`

Expected: 3초 후 GUI 가 자동 재시작. `logs/server_events.jsonl` 에 `crash_detected` → `restart_done`(reason=crash).

- [ ] **Step 2: 좀비 감지를 확인한다 — 이 검증이 핵심이다**

프로세스는 살아있고 HTTP 만 무응답인 상태를 정확히 재현하는 유일한 방법이다.

Run (별도 터미널, 3분 이상 유지):

```bash
cd HiTessWorkBenchBackEnd
WorkBenchEnv/Scripts/python.exe -c "
import os, psutil, time
# cmdline 을 '리스트 원소' 로 대조한다. 문자열 join 으로 찾으면 이 스크립트 자신의
# 명령줄에도 'uvicorn' 이 들어 있어 스스로를 정지시킨다.
target = next(p for p in psutil.process_iter(['name','cmdline'])
              if p.pid != os.getpid() and p.info['cmdline']
              and 'uvicorn' in p.info['cmdline'])
print('suspending', target.pid)
target.suspend()
time.sleep(240)
print('done')
"
```

Expected: 정지 3분 후 GUI 에 "3분간 응답이 없습니다 — 강제 재시작합니다." 가 뜨고 서버가 재시작된다. `logs/server_events.jsonl` 에 `health_degraded` → `zombie_detected`(children 포함) → `restart_begin` → `restart_done`(reason=zombie).

- [ ] **Step 3: 고아 해석 프로세스 정리를 확인한다**

해석 작업을 하나 제출해 `nastran.exe` 또는 `Cmb.Cli.exe` 가 도는 상태를 만든 뒤 Step 2 를 반복한다.

Expected: `orphan_killed` 이벤트에 해당 exe 가 기록되고, 재시작 후:

Run: `Get-Process nastran, Cmb.Cli -ErrorAction SilentlyContinue`
Expected: 아무것도 출력되지 않음 (잔여 프로세스 0)

- [ ] **Step 4: L1 급사 시 워치독 복구를 확인한다**

작업 스케줄러 태스크를 다시 등록한다:

Run: `powershell -ExecutionPolicy Bypass -File scripts\install_watchdog_task.ps1`

Server Manager 창을 작업관리자에서 **강제 종료**(창 닫기 X — `_on_close` 가 PID 파일을 지우면 안 되므로 반드시 강제 종료)한다.

Expected: 5분 내 새 Server Manager 창이 자동으로 뜬다. `logs/server_events.jsonl` 에 `watchdog_revive` → `watchdog_revive_result`(recovered=true) → `manager_start`.

확인 후 개발 PC 를 원상 복구한다:

Run: `Unregister-ScheduledTask -TaskName HiTessWatchdog -Confirm:$false`

- [ ] **Step 5: 백오프가 영구 정지를 대체했는지 확인한다**

⚠ 포트를 다른 프로세스로 점유하는 방법은 쓸 수 없다. `_kill_port`(`server_manager.py:195`)가 9091 을 물고 있는 프로세스를 찾아 죽여버려서 기동이 성공해 버린다.

대신 uvicorn 이 앱을 import 하는 순간 실패하게 만든다:

Run: `cd HiTessWorkBenchBackEnd && echo 'raise RuntimeError("forced startup failure - backoff test")' >> app/main.py`

Server Manager 를 띄우고 실패가 반복되게 둔다.

Expected: 5회 실패 후 **"자동 재시작을 멈춥니다" 가 뜨지 않고**, 대신 "연속 기동 실패가 이어집니다. 10.0분 후 다시 시도합니다." 가 뜬다. `logs/server_events.jsonl` 에 `backoff_wait`(delay_sec=600, level=1).

확인 후 반드시 원복한다 (`app/main.py` 는 git 추적 파일이다):

Run: `cd HiTessWorkBenchBackEnd && git checkout app/main.py && git diff --stat app/main.py`
Expected: 출력 없음 (변경 0)

- [ ] **Step 6: 검증 결과를 기록하고 커밋한다**

설계서 `docs/superpowers/specs/2026-07-27-backend-watchdog-design.md` 의 §8 표 아래에 실측 결과를 추가한다:

```markdown
### 8-1. 실측 결과 (2026-07-XX, 개발 PC)

| # | 결과 | 비고 |
|---|---|---|
| 1 크래시 재시작 | PASS | 3초 후 복구 |
| 2 좀비 감지 | PASS | suspend 후 3분 시점 재시작 |
| 3 고아 정리 | PASS | 잔여 프로세스 0 |
| 4 L1 급사 복구 | PASS | 5분 내 재기동 |
| 5 워치독 무개입 | PASS | L1 정상 시 이벤트 없음 |
| 6 DB 무대응 | PASS | 기록만, 재시작 없음 (Task 10 에서 확인) |
| 7 백오프 | PASS | 영구 정지 없이 10분 후 재시도 |
```

(각 항목은 실제 결과로 채운다. FAIL 이 있으면 커밋하지 말고 해당 Task 로 돌아간다.)

```bash
git add docs/superpowers/specs/2026-07-27-backend-watchdog-design.md
git commit -m "📝 docs: 워치독 고장 재현 검증 실측 결과 기록"
```

---

## 서버(145) 반영 절차

모든 Task 완료 후 서버에서 수행한다.

1. **`git pull`** — `server_manager.py`, `serverguard/`, `server_watchdog.py`, `scripts/` 전부 git 추적이라 pull 만으로 반영된다.
2. **`powershell -ExecutionPolicy Bypass -File scripts\install_watchdog_task.ps1`** — 1회만 실행.
3. **Server Manager 재시작** — 기존 창을 닫고 `HiTESS_Server.bat` 을 다시 실행한다.
4. **확인** — `logs/server_events.jsonl` 에 `manager_start` 가 기록되었는지, `logs/server_manager.pid` 가 생성되었는지 본다.

**InHouseProgram 수동 교체는 필요 없다.** 순수 Python 변경이며 `requirements.txt` 도 바뀌지 않는다(`psutil` 은 `app/routers/system.py:5` 에서 이미 사용 중).
