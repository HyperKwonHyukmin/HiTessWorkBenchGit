"""HiTESS WorkBench 서버 관리 GUI."""
import json
import subprocess
import threading
import time
import sys
import os
import urllib.request
import urllib.error
import tkinter as tk
from tkinter import scrolledtext
from datetime import datetime, timezone
from pathlib import Path

from serverguard import diagnostics, events, health, pidfile, proctree
from serverguard.backoff import RestartPolicy

BASE_DIR = Path(__file__).resolve().parent
LOG_DIR = BASE_DIR / "logs"

# ── 헬스 체크(좀비 감지) 파라미터 ──
# poll() 은 '프로세스가 살아있는가' 만 본다. 프로세스는 살아있는데 HTTP 응답만
# 없는 상태(DB 커넥션 고갈, ThreadPool 데드락, 디스크 풀)를 잡으려면 별도 관측이
# 필요하다. 재시작은 되돌릴 수 없으므로 임계값을 3분으로 넉넉히 잡는다 —
# 해석 exe 는 별도 프로세스라 CPU 가 포화돼도 uvicorn 이벤트 루프는 막히지 않는다.
HEALTH_INTERVAL_MS = health.CHECK_INTERVAL_SEC * 1000

# WorkBenchEnv가 HiTessWorkBenchBackEnd 안에 있으면 BASE_DIR/WorkBenchEnv,
# 상위 폴더(HiTessWorkBenchGit)에 있으면 BASE_DIR.parent/WorkBenchEnv 를 사용
_venv_inner = BASE_DIR / "WorkBenchEnv" / "Scripts" / "python.exe"
_venv_outer = BASE_DIR.parent / "WorkBenchEnv" / "Scripts" / "python.exe"
if _venv_inner.exists():
    PYTHON = str(_venv_inner)
    PIP    = str(_venv_inner.parent / "pip.exe")
elif _venv_outer.exists():
    PYTHON = str(_venv_outer)
    PIP    = str(_venv_outer.parent / "pip.exe")
else:
    PYTHON = sys.executable
    PIP    = str(Path(sys.executable).parent / "pip.exe")

LATEST_CLIENT_DIR = Path(os.environ.get("LATEST_CLIENT_DIR", str(BASE_DIR / "LastestVersionProgram")))

SERVER_CMD = [PYTHON, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9091"]

# ── 자동 재시작(크래시 루프 방어) 파라미터 ──
# 사용자가 Stop 을 누르지 않았는데 서버가 죽으면(=크래시) 자동으로 다시 띄운다.
# 단, 시작하자마자 계속 죽는 경우 무한 재시작을 막기 위해 창(window) 안의 횟수를 제한한다.
RESTART_DELAY_MS       = 3000  # 종료 감지 후 재시작까지 대기(포트 정리·안정화 시간)
RESTART_WINDOW_SEC     = 60    # 이 시간(초) 창 안에서 자동 재시작 횟수를 센다
MAX_RESTARTS_IN_WINDOW = 5     # 창 안에서 이 횟수를 넘기면 자동 재시작 중단(무한 루프 방지)

# ── 색상 팔레트 ──
BG        = "#1e2130"
PANEL     = "#252a3a"
ACCENT    = "#4f8ef7"
GREEN     = "#3ecf8e"
RED       = "#f76f6f"
YELLOW    = "#f7c94f"
FG        = "#e8eaf0"
FG_DIM    = "#8890a8"
LOG_BG    = "#161925"
LOG_FG    = "#c8d0e0"


class ServerManagerApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.server_proc: subprocess.Popen | None = None
        self.is_updating = False
        # 자동 재시작 상태.
        #  intentional_stop: 사용자가 Stop/앱 종료로 '의도적으로' 내렸는지 표시(그 경우 재시작 안 함).
        #  restart_history : 최근 자동 재시작 시각 목록(크래시 루프 차단 판단용).
        self.intentional_stop = False
        self.restart_history: list[float] = []
        # uvicorn stdout 을 날짜별 파일로 보존한다(앱을 닫아도 traceback 이 남는다).
        self.uvicorn_log = events.DailyLogWriter(LOG_DIR)
        self.health_tracker = health.HealthTracker()
        # 재시작 예산·백오프 판단. 기존 restart_history 는 Task 9 에서 제거한다.
        self.restart_policy = RestartPolicy()

        self._setup_window()
        self._build_ui()
        self._write_pidfile()
        events.append_event(LOG_DIR, "L1", "manager_start", {"pid": os.getpid()})
        events.prune_events(LOG_DIR)
        events.prune_uvicorn_logs(LOG_DIR)

        self._start_server()
        self.root.after(HEALTH_INTERVAL_MS, self._health_tick)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    # ── PID 파일 기록 ────────────────────────────────────────────────────
    def _write_pidfile(self):
        """L2 워치독이 읽을 PID 파일을 남긴다.

        실패해도 기동을 막지 않는다 — 다만 조용히 넘어가서는 안 된다.
        이 파일이 없으면 L2 는 L1 이 죽었다고 오판해 5분마다 중복 기동을
        시도하므로, 실패 사실 자체가 반드시 기록으로 남아야 한다.
        """
        try:
            pidfile.write(LOG_DIR, os.getpid())
        except Exception as exc:
            self._log(f"PID 파일을 쓰지 못했습니다: {exc}", "error")
            self._log("  워치독이 이 프로세스를 인식하지 못할 수 있습니다.", "warning")
            events.append_event(LOG_DIR, "L1", "pidfile_write_failed",
                                {"error": f"{type(exc).__name__}: {exc}"[:300]})

    # ── 창 설정 ──────────────────────────────────────────────────────────
    def _setup_window(self):
        self.root.title("HiTESS WorkBench — Server Manager")
        self.root.configure(bg=BG)
        self.root.geometry("760x560")
        self.root.minsize(600, 440)
        self.root.resizable(True, True)

    # ── UI 빌드 ──────────────────────────────────────────────────────────
    def _build_ui(self):
        # 헤더
        header = tk.Frame(self.root, bg=PANEL, pady=14)
        header.pack(fill="x")

        tk.Label(header, text="HiTESS WorkBench", font=("Segoe UI", 16, "bold"),
                 bg=PANEL, fg=FG).pack(side="left", padx=20)
        tk.Label(header, text="Server Manager", font=("Segoe UI", 11),
                 bg=PANEL, fg=FG_DIM).pack(side="left")

        # 상태 영역
        status_frame = tk.Frame(self.root, bg=BG, pady=12, padx=20)
        status_frame.pack(fill="x")

        # 상태 표시등 + 텍스트
        indicator_frame = tk.Frame(status_frame, bg=BG)
        indicator_frame.pack(side="left")

        self.status_dot = tk.Label(indicator_frame, text="●", font=("Segoe UI", 18),
                                   bg=BG, fg=RED)
        self.status_dot.pack(side="left")

        self.status_label = tk.Label(indicator_frame, text="Stopped",
                                     font=("Segoe UI", 12, "bold"), bg=BG, fg=RED)
        self.status_label.pack(side="left", padx=(6, 0))

        self.port_label = tk.Label(indicator_frame, text="",
                                   font=("Segoe UI", 10), bg=BG, fg=FG_DIM)
        self.port_label.pack(side="left", padx=(10, 0))

        # 버튼 영역
        btn_frame = tk.Frame(status_frame, bg=BG)
        btn_frame.pack(side="right")

        self.toggle_btn = tk.Button(
            btn_frame, text="Start", width=8,
            font=("Segoe UI", 10, "bold"),
            bg=GREEN, fg="#111", activebackground="#2db87a",
            relief="flat", cursor="hand2", pady=6,
            command=self._toggle_server
        )
        self.toggle_btn.pack(side="left", padx=(0, 8))

        self.update_btn = tk.Button(
            btn_frame, text="⟳  Update", width=12,
            font=("Segoe UI", 10, "bold"),
            bg=ACCENT, fg="white", activebackground="#3a7ae0",
            relief="flat", cursor="hand2", pady=6,
            command=self._run_update
        )
        self.update_btn.pack(side="left")

        # 구분선
        tk.Frame(self.root, bg=PANEL, height=1).pack(fill="x")

        # 로그 레이블
        log_header = tk.Frame(self.root, bg=BG, pady=6, padx=20)
        log_header.pack(fill="x")
        tk.Label(log_header, text="Server Log", font=("Segoe UI", 9, "bold"),
                 bg=BG, fg=FG_DIM).pack(side="left")

        self.clear_btn = tk.Button(
            log_header, text="Clear", font=("Segoe UI", 8),
            bg=PANEL, fg=FG_DIM, activebackground=BG,
            relief="flat", cursor="hand2", pady=2, padx=8,
            command=self._clear_log
        )
        self.clear_btn.pack(side="right")

        # 로그 창
        self.log_text = scrolledtext.ScrolledText(
            self.root, font=("Consolas", 9),
            bg=LOG_BG, fg=LOG_FG,
            insertbackground=LOG_FG,
            relief="flat", bd=0,
            wrap="word", state="disabled",
            padx=12, pady=8
        )
        self.log_text.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        # 로그 색상 태그
        self.log_text.tag_config("info",    foreground=LOG_FG)
        self.log_text.tag_config("success", foreground=GREEN)
        self.log_text.tag_config("warning", foreground=YELLOW)
        self.log_text.tag_config("error",   foreground=RED)
        self.log_text.tag_config("dim",     foreground=FG_DIM)

    # ── 로그 출력 ────────────────────────────────────────────────────────
    def _log(self, message: str, tag: str = "info"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_text.configure(state="normal")
        self.log_text.insert("end", f"[{timestamp}] ", "dim")
        self.log_text.insert("end", message + "\n", tag)
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _clear_log(self):
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.configure(state="disabled")

    # ── 상태 UI 업데이트 ─────────────────────────────────────────────────
    def _set_running(self, running: bool):
        if running:
            self.status_dot.configure(fg=GREEN)
            self.status_label.configure(text="Running", fg=GREEN)
            self.port_label.configure(text="  port 9091")
            self.toggle_btn.configure(text="Stop", bg=RED, activebackground="#d45f5f")
        else:
            self.status_dot.configure(fg=RED)
            self.status_label.configure(text="Stopped", fg=RED)
            self.port_label.configure(text="")
            self.toggle_btn.configure(text="Start", bg=GREEN, activebackground="#2db87a")

    # ── 포트 점유 프로세스 강제 종료 ─────────────────────────────────────
    def _kill_port(self, port: int):
        try:
            result = subprocess.run(
                ["netstat", "-ano"],
                capture_output=True, text=True,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            pids = set()
            for line in result.stdout.splitlines():
                if f":{port}" in line and ("LISTENING" in line or "0.0.0.0:0" in line):
                    parts = line.split()
                    if parts:
                        pids.add(parts[-1])
            for pid in pids:
                if pid.isdigit() and pid != "0":
                    subprocess.run(
                        ["taskkill", "/PID", pid, "/F"],
                        capture_output=True,
                        creationflags=subprocess.CREATE_NO_WINDOW
                    )
                    self._log(f"  기존 프로세스 종료: PID {pid}", "warning")
        except Exception as e:
            self._log(f"  포트 정리 중 오류: {e}", "error")

    # ── 서버 시작 ────────────────────────────────────────────────────────
    def _start_server(self) -> bool:
        """서버를 띄운다. 호출이 끝난 시점에 서버가 떠 있으면 True.

        반환값이 필요한 이유는 재시작 경로가 'restart_done' 같은 사실을 단언하기
        때문이다. 시작이 실패했는데 완료를 기록하면 사후 분석 로그가 거짓을
        말한다 — 침묵하는 로그보다 나쁘다.
        """
        if self.server_proc and self.server_proc.poll() is None:
            return True
        # 새로 띄우는 순간 '의도적 종료' 표식을 해제한다(이후 죽으면 크래시로 간주).
        self.intentional_stop = False
        self._log("서버를 시작하는 중...", "info")
        self._kill_port(9091)
        self._kill_port(8000)
        try:
            self.server_proc = subprocess.Popen(
                SERVER_CMD,
                cwd=str(BASE_DIR),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            # 새 프로세스의 판정은 처음부터 다시 시작한다. RESTART_DELAY_MS(3초)는
            # HEALTH_INTERVAL_MS(15초)보다 짧아 사망·재기동이 두 tick 사이에
            # 통째로 들어가는 것이 통례다 — 이월된 fail_streak 을 지우지 않으면
            # 다음 한 번의 실패로 임계(12)를 넘어, 아직 부팅 중(FastAPI import·
            # MySQL 테이블 생성)인 정상 서버를 좀비로 오판해 사살한다.
            # 모든 재시작(크래시·좀비·수동·업데이트)이 이 길목을 지난다.
            self.health_tracker.reset()
            self._set_running(True)
            self._log("uvicorn 서버 시작됨 (port 9091)", "success")
            events.append_event(LOG_DIR, "L1", "server_start", {"pid": self.server_proc.pid})
            # 스트리밍 스레드에 담당 프로세스를 인자로 넘긴다 — 스레드 안에서
            # self.server_proc 를 읽으면 시작과 첫 읽기 사이에 좀비 강제 재시작이
            # 끼어들 창이 남는다.
            threading.Thread(target=self._stream_output,
                             args=(self.server_proc,), daemon=True).start()
            return True
        except OSError as exc:
            # FileNotFoundError 뿐 아니라 OSError 전체를 잡는다. PermissionError
            # (백신 격리 등)는 여기서 안 잡으면 root.after 콜백 밖으로 나가
            # tkinter 핸들러로 가고, 콘솔 없는 GUI 앱에선 아무 데도 남지 않은 채
            # 재시작 체인이 기록 없이 끊긴다.
            if isinstance(exc, FileNotFoundError):
                self._log(f"Python 실행 파일을 찾을 수 없습니다:\n  {PYTHON}", "error")
                self._log("WorkBenchEnv 가상환경이 생성되어 있는지 확인하세요.", "warning")
            else:
                self._log(f"서버를 시작하지 못했습니다: {type(exc).__name__}: {exc}", "error")
            events.append_event(LOG_DIR, "L1", "server_start_failed",
                                {"error": f"{type(exc).__name__}: {exc}"[:300]})
            return False

    # ── 서버 출력 스트리밍 ───────────────────────────────────────────────
    def _stream_output(self, proc):
        # 담당 프로세스는 호출부가 인자로 넘긴다 — self.server_proc 는 이 스레드가
        # 도는 동안 좀비 강제 재시작 등으로 다른 프로세스로 바뀔 수 있다.
        for line in proc.stdout:
            line = line.rstrip()
            if not line:
                continue
            self.uvicorn_log.write(line)
            tag = "info"
            if "ERROR" in line or "error" in line.lower():
                tag = "error"
            elif "WARNING" in line or "warning" in line.lower():
                tag = "warning"
            elif "started" in line or "running" in line.lower() or "Application startup" in line:
                tag = "success"
            self.root.after(0, self._log, line, tag)
        # 프로세스 종료됨 — 어느 프로세스의 종료인지 함께 알린다(스테일 콜백 가드용).
        self.root.after(0, self._on_server_exit, proc)

    def _on_server_exit(self, proc):
        # 디스크 지연(로그 flush 등)으로 이 스레드의 EOF 감지가 늦어지면, 좀비
        # 강제 재시작이 이미 새 프로세스를 띄운 뒤에 '지난' 프로세스의 종료
        # 통지가 도착할 수 있다. proc identity 로 그 스테일 통지를 걸러낸다 —
        # 걸러내지 않으면 방금 띄운 정상 프로세스를 크래시로 오판해 허위
        # crash_detected 기록을 남기고 재시작 예산을 잘못 소진한다.
        # proc 에 기본값을 두지 않는다 — 기본값은 이 가드를 조용히 끄고,
        # 인자를 빠뜨린 호출자는 '조용하지만 틀린 크래시 진단' 이 아니라
        # TypeError 로 시끄럽게 터져야 한다.
        if proc is not self.server_proc:
            return
        self._set_running(False)
        # 업데이트 중 재시작은 _update_worker 가 직접 처리하므로 감시하지 않는다.
        if self.is_updating:
            return
        # 사용자가 Stop 을 눌렀거나 앱 종료로 '의도적으로' 내린 경우 → 재시작하지 않는다.
        if self.intentional_stop:
            self.intentional_stop = False
            return
        # 여기까지 왔으면 의도치 않은 종료(크래시) → 자동 재시작을 시도한다.
        self._log("서버 프로세스가 예기치 않게 종료되었습니다.", "error")
        detail = diagnostics.collect()          # 호스트 지표만 — 죽은 PID 는 조회하지 않는다
        if self.server_proc is not None:
            # 죽은 PID 를 '사실'로만 남긴다. 이 PID 를 psutil 로 조회하면
            # 그사이 재사용된 무관한 프로세스의 지표를 uvicorn 것처럼 기록할 수 있다.
            detail["crashed_pid"] = self.server_proc.pid
            detail["exit_code"] = self.server_proc.poll()
        events.append_event(LOG_DIR, "L1", "crash_detected", detail)
        self._schedule_auto_restart()

    # ── 헬스 체크(좀비 감지) ─────────────────────────────────────────────
    def _health_tick(self):
        """15초마다 HTTP 응답을 관측한다. 프로브는 GUI 를 막지 않도록 스레드에서."""
        self.root.after(HEALTH_INTERVAL_MS, self._health_tick)

        # 프로세스가 이미 죽었거나 업데이트 중이면 크래시 경로가 담당한다.
        proc = self.server_proc
        if self.is_updating or not (proc and proc.poll() is None):
            self.health_tracker.reset()
            return

        # 관측 대상을 캡처해 프로브와 콜백까지 끌고 간다 — 프로브가 도는 동안
        # (타임아웃 5초) 대상이 바뀔 수 있고, 그때 결과를 그대로 반영하면
        # 지난 프로세스의 실패가 새 프로세스의 streak 으로 쌓인다.
        threading.Thread(target=self._probe_health, args=(proc,), daemon=True).start()

    def _probe_health(self, proc):
        ok = health.probe()
        self.root.after(0, self._on_health_result, ok, proc)

    def _on_health_result(self, ok, proc):
        """관측 결과를 상태로 환산하고, 전이가 일어난 순간에만 행동한다.

        이 메서드는 root.after(0, ...) 를 거쳐 항상 메인 스레드에서 실행된다 —
        HealthTracker 는 락이 없으므로 이 속성이 반드시 지켜져야 한다.
        """
        # 프로브가 도는 사이 대상이 바뀌었다면(급사 후 재기동 등) 이 결과는
        # '지난' 프로세스의 것이다. 흔한 레이스지 이상 징후가 아니므로 조용히
        # 버린다 — 반영하면 유령 좀비 재시작(이미 죽은 PID 를 대상으로 한
        # kill_survivors/_kill_port)까지 이어진다.
        if proc is not self.server_proc:
            return

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

    def _force_restart_zombie(self):
        """프로세스는 살아있으나 3분간 HTTP 무응답 — 강제로 내리고 다시 띄운다.

        순서가 중요하다. 진단 스냅샷과 자손 목록을 '죽이기 전에' 확보해야 하며,
        고아 해석 exe 를 정리하지 않으면 MSC 라이선스가 물린 채 남는다.
        """
        # 되돌릴 수 없는 부작용(kill_survivors, _kill_port)을 실행하기 직전이므로
        # 대상 검증이 첫 줄에 있어야 한다. 죽은 PID 로 진행하면 Windows 의 PID
        # 재사용 때문에 무관한 프로세스의 자식을 열거해 죽일 수 있다 —
        # 크래시 경로가 아래에서 의도적으로 거부한 바로 그 위험이다.
        if self.server_proc is None or self.server_proc.poll() is not None:
            self.health_tracker.reset()
            self._log("강제 재시작 대상이 이미 종료되었습니다 — 크래시 경로가 처리합니다.", "warning")
            events.append_event(LOG_DIR, "L1", "zombie_abort",
                                {"reason": "process_already_dead"})
            return

        pid = self.server_proc.pid
        self._log("3분간 응답이 없습니다 — 강제 재시작합니다.", "error")

        snapshot = diagnostics.collect(uvicorn_pid=pid)
        # children 의 create_time 은 epoch float 그대로 남긴다. 이 dict 들은 기록
        # 후 kill_survivors 로 그대로 넘어가 PID 재사용 방어 대조에 쓰이므로,
        # 읽기 좋으라고 ISO8601 문자열로 바꾸면 그 방어가 깨진다.
        children = proctree.snapshot_tree(pid)
        snapshot["fail_streak"] = self.health_tracker.fail_streak
        # last_ok_at 은 epoch float(HealthTracker 의 계약) — events.py 의 다른
        # 필드(ts)와 마찬가지로 ISO8601 로 남겨야 사후 분석 시 바로 읽을 수 있다.
        # None 검사여야 한다: `if last_ok` 로 쓰면 epoch 0.0 이 falsy 라 "한 번도
        # 응답하지 않았다"로 뒤집혀 사실의 정반대를 기록한다.
        # UTC 를 거쳐 변환하는 이유는 naive datetime 의 astimezone() 이 Windows
        # 에서 epoch 직후 하루 구간에 OSError(EINVAL) 를 던지기 때문이다
        # (실측/KST: t < 86400 은 전부 실패, t == 86400 부터 성공). tz 를 주면
        # 그 경로를 타지 않는다. 진단 한 줄 때문에 강제 재시작이 중단되면 안 된다.
        last_ok = self.health_tracker.last_ok_at
        snapshot["last_ok"] = (
            datetime.fromtimestamp(last_ok, tz=timezone.utc)
            .astimezone().isoformat(timespec="seconds")
            if last_ok is not None else None
        )
        snapshot["children"] = children
        events.append_event(LOG_DIR, "L1", "zombie_detected", snapshot)

        events.append_event(LOG_DIR, "L1", "restart_begin", {"reason": "zombie"})

        # 여기서 intentional_stop 을 세우지 않는다. 이 종료의 크래시 오판은
        # 아래에서 server_proc 을 None 으로 만들기 때문에 _on_server_exit 의
        # identity 가드가 이미 막는다. 그 플래그를 빌려 쓰면 '사용자가 멈췄다'는
        # 의미가 오염되고, 좀비 재시작 후 True 로 잔류한다 — 재시작 게이팅이
        # 그 플래그를 읽는 순간(Task 9 의 백오프 재시도) 영구 정지가 된다.
        # 플래그를 지우는 곳이 _start_server 뿐인데 거부당하는 대상이 바로
        # 그 _start_server 이기 때문이다.
        # poll() 은 OS 를 다시 조회한다 — 위 진단 수집(cpu_percent 100ms 블로킹)과
        # 자손 열거·이벤트 기록 사이에 대상이 스스로 죽었을 수 있으므로 살아있는
        # 검사다.
        if self.server_proc and self.server_proc.poll() is None:
            # 종료 실패를 밖으로 흘리면 아래 reset()·재시작 예약이 실행되지 않아
            # state 가 ZOMBIE 로 굳는다. HealthTracker 는 전이 시에만 알리므로
            # 이후 어떤 실패도 재감지로 이어지지 않는다 — 무인 복구 영구 정지다.
            # 종료에 실패했어도 고아 정리·포트 해제·리셋·재시작은 전부 진행해야
            # 한다(finally 가 아니라 catch-and-continue 인 이유).
            try:
                self.server_proc.terminate()
                try:
                    self.server_proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.server_proc.kill()
            except Exception as exc:
                self._log(f"  서버 프로세스 종료 실패: {exc}", "error")
                self._log("  포트 정리로 이어서 진행합니다.", "warning")
                events.append_event(LOG_DIR, "L1", "terminate_failed",
                                    {"pid": pid,
                                     "error": f"{type(exc).__name__}: {exc}"[:300]})
        self.server_proc = None
        self._set_running(False)

        self._cleanup_orphans(children)

        self._kill_port(9091)
        # 이 reset 은 실제로 중복이다 — _health_tick 은 server_proc 이 None 인 것을
        # 보고 스스로 reset 하고, _start_server 도 새 프로세스마다 reset 한다.
        # 그래도 남긴다: 재시작을 촉발한 streak 이 그 결정보다 오래 살지 않게 해
        # 이 함수를 자기완결로 만든다(스냅샷은 위에서 이미 기록했으므로 증거
        # 손실도 없다). 위 종료 실패 경로에서도 반드시 도달해야 하는 위치다 —
        # 건너뛰면 state 가 ZOMBIE 로 굳어 좀비 재감지가 영구히 멈춘다.
        self.health_tracker.reset()
        self.root.after(RESTART_DELAY_MS, self._zombie_restart_fire)

    def _cleanup_orphans(self, children):
        """uvicorn 이 남긴 해석 exe 를 정리한다.

        정리에 실패하더라도 재시작 자체를 막아서는 안 된다 — 서버가 안 뜨는 것이
        라이선스가 물린 것보다 나쁘다. 다만 실패 사실은 반드시 기록으로 남긴다.
        """
        if not children:
            return
        try:
            attempted = proctree.kill_survivors(children)
            # unconfirmed 계산도 try 안에 둔다. kill_survivors 는 항목에 필수 키가
            # 없으면 KeyError 를 의도적으로 전파하는데, entry.get("terminated") 로
            # 받으면 그 계약 위반이 '종료 확인 실패' 로 위장돼 조용히 묻힌다.
            # 반대로 try 밖에 두면 KeyError 가 이 래퍼를 뚫고 나가 재시작을
            # 중단시킨다 — 시끄럽게 기록하되 재시작은 계속되어야 한다.
            unconfirmed = [entry for entry in attempted if not entry["terminated"]]
        except Exception as exc:
            self._log(f"  고아 프로세스 정리 실패: {exc}", "error")
            events.append_event(LOG_DIR, "L1", "orphan_cleanup_failed",
                                {"error": f"{type(exc).__name__}: {exc}"[:300]})
            return

        if not attempted:
            return
        self._log(f"  고아 해석 프로세스 {len(attempted)}개 정리 시도 "
                  f"(종료 확인 {len(attempted) - len(unconfirmed)}개)", "warning")
        if unconfirmed:
            self._log(f"  {len(unconfirmed)}개는 종료를 확인하지 못했습니다 "
                      "— 라이선스가 물려 있을 수 있습니다.", "error")
        events.append_event(LOG_DIR, "L1", "orphan_killed", {
            "attempted": len(attempted),
            "terminated": len(attempted) - len(unconfirmed),
            "unconfirmed": unconfirmed,
            "entries": attempted,
        })

    def _zombie_restart_fire(self):
        # restart_begin 의 짝을 반드시 남긴다. 침묵하면 사후 분석자가 "업데이트
        # 중이라 건너뜀" 과 "매니저 자신이 재시작 도중 죽음" 을 구분할 수 없다 —
        # 결론이 완전히 다른 두 상황이다.
        if self.is_updating:
            events.append_event(LOG_DIR, "L1", "restart_skipped", {"reason": "updating"})
            return
        if self.server_proc and self.server_proc.poll() is None:
            events.append_event(LOG_DIR, "L1", "restart_skipped", {"reason": "already_running"})
            return
        # 시작에 성공했을 때만 완료를 단언한다. 실패는 _start_server 가
        # server_start_failed 로 남기므로 restart_begin 의 짝은 그쪽이 맡는다.
        if self._start_server():
            events.append_event(LOG_DIR, "L1", "restart_done", {"reason": "zombie"})

    # ── 자동 재시작(의도치 않은 종료 시) ─────────────────────────────────
    def _schedule_auto_restart(self):
        """크래시 감지 시 재시작을 예약한다. 짧은 시간에 반복 실패하면 중단한다."""
        now = time.time()
        # 창(window) 밖의 오래된 재시작 기록은 버린다.
        self.restart_history = [t for t in self.restart_history if now - t < RESTART_WINDOW_SEC]

        if len(self.restart_history) >= MAX_RESTARTS_IN_WINDOW:
            self._log(
                f"{RESTART_WINDOW_SEC}초 내 {MAX_RESTARTS_IN_WINDOW}회 연속 재시작에 실패했습니다. "
                "자동 재시작을 멈춥니다 — 원인을 확인한 뒤 Start 를 눌러 수동으로 재개하세요.",
                "error",
            )
            # 기록은 비우지 않는다 — 이후 크래시도 계속 이 상한에 걸려 재시작이 차단된다.
            # (예산 초기화는 사용자가 직접 Start 를 누를 때만 이뤄진다.)
            return

        self.restart_history.append(now)
        attempt = len(self.restart_history)
        self._log(
            f"{RESTART_DELAY_MS // 1000}초 후 자동으로 재시작합니다 "
            f"(최근 {RESTART_WINDOW_SEC}초 내 {attempt}/{MAX_RESTARTS_IN_WINDOW}회).",
            "warning",
        )
        self.root.after(RESTART_DELAY_MS, self._auto_restart_fire)

    def _auto_restart_fire(self):
        # 대기 사이에 사용자가 Update/Stop 했거나 이미 살아났으면 재시작하지 않는다.
        if self.is_updating:
            return
        if self.server_proc and self.server_proc.poll() is None:
            return
        self._log("자동 재시작을 실행합니다.", "info")
        self._start_server()

    # ── 서버 중지 ────────────────────────────────────────────────────────
    def _stop_server(self):
        # 이 종료는 코드가 '의도적으로' 내리는 것(Stop/Update/앱 종료) → 자동 재시작 대상이 아니다.
        self.intentional_stop = True
        if self.server_proc and self.server_proc.poll() is None:
            self._log("서버를 중지하는 중...", "warning")
            self.server_proc.terminate()
            try:
                self.server_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.server_proc.kill()
            self.server_proc = None
        self._set_running(False)

    # ── Start / Stop 토글 ────────────────────────────────────────────────
    def _toggle_server(self):
        if self.server_proc and self.server_proc.poll() is None:
            self._stop_server()
            self._log("서버가 중지되었습니다.", "warning")
        else:
            # 사용자가 직접 Start → 자동 재시작 카운터를 초기화(수동 재개는 깨끗한 예산으로).
            self.restart_history = []
            self._start_server()

    # ── Update ───────────────────────────────────────────────────────────
    def _run_update(self):
        if self.is_updating:
            return
        self.is_updating = True
        self.update_btn.configure(state="disabled", text="Updating...")
        threading.Thread(target=self._update_worker, daemon=True).start()

    def _update_worker(self):
        self.root.after(0, self._log, "=" * 50, "dim")
        self.root.after(0, self._log, "업데이트를 시작합니다.", "info")

        # 1. 서버 중지
        self.root.after(0, self._log, "[1/4] 서버 중지 중...", "info")
        self.root.after(0, self._stop_server)

        # 2. git pull (Before/After 해시 기록)
        self.root.after(0, self._log, "[2/4] git pull origin main", "info")
        before_hash = self._get_git_hash()
        if before_hash:
            self.root.after(0, self._log, f"  Before: {before_hash}", "dim")

        ok, pull_lines = self._run_cmd_capture(["git", "pull", "origin", "main"], cwd=str(BASE_DIR.parent))
        if not ok:
            self.root.after(0, self._log, "git pull 실패. Update aborted.", "error")
            for line in pull_lines[-5:]:
                self.root.after(0, self._log, f"  {line}", "error")
            self._finish_update()
            return

        after_hash = self._get_git_hash()
        if after_hash:
            self.root.after(0, self._log, f"  After:  {after_hash}", "dim")

        # 3. requirements.txt 변경 시만 pip install
        self.root.after(0, self._log, "[3/4] 의존성 변경 확인...", "info")
        if self._requirements_changed():
            self.root.after(0, self._log, "  requirements.txt 변경 감지 → pip install 실행", "warning")
            self._run_cmd([PIP, "install", "-r", "requirements.txt"], cwd=str(BASE_DIR), tag="info")
        else:
            self.root.after(0, self._log, "  의존성 변경 없음 — pip install 건너뜀", "dim")

        # 4. 서버 재시작 + 헬스 체크
        self.root.after(0, self._log, "[4/4] 서버를 재시작합니다.", "success")
        self.root.after(0, self._start_server)

        time.sleep(5)
        self._health_check_after_update()
        self._show_latest_exe()

        self.root.after(0, self._log, "업데이트가 완료되었습니다.", "success")
        self.root.after(0, self._log, "=" * 50, "dim")
        self._finish_update()

    def _get_git_hash(self) -> str:
        """현재 git HEAD short hash 반환. 실패 시 빈 문자열."""
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=str(BASE_DIR.parent),
                capture_output=True, text=True,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            return result.stdout.strip() if result.returncode == 0 else ""
        except Exception:
            return ""

    def _run_cmd_capture(self, cmd: list, cwd: str) -> tuple:
        """명령 실행. 출력 로그 표시 + (성공여부, 출력줄 목록) 반환."""
        lines = []
        try:
            proc = subprocess.Popen(
                cmd, cwd=cwd,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    lines.append(line)
                    self.root.after(0, self._log, f"  {line}", "dim")
            proc.wait()
            return proc.returncode == 0, lines
        except Exception as e:
            msg = f"오류: {e}"
            self.root.after(0, self._log, f"  {msg}", "error")
            return False, [msg]

    def _requirements_changed(self) -> bool:
        """git pull 전후로 requirements.txt 변경 여부 확인. 확인 불가 시 True."""
        try:
            result = subprocess.run(
                ["git", "diff", "HEAD@{1}", "HEAD", "--", "HiTessWorkBenchBackEnd/requirements.txt"],
                cwd=str(BASE_DIR.parent),
                capture_output=True, text=True,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            if result.returncode != 0:
                return True
            return bool(result.stdout.strip())
        except Exception:
            return True

    def _health_check_after_update(self):
        """서버 재시작 후 /api/version 응답 확인."""
        try:
            req  = urllib.request.urlopen("http://127.0.0.1:9091/api/version", timeout=5)
            data = json.loads(req.read().decode())
            ver  = data.get("version", "?")
            self.root.after(0, self._log, f"  Server: v{ver}", "success")
        except Exception as e:
            self.root.after(0, self._log, f"  헬스 체크 실패: {e}", "warning")

    def _show_latest_exe(self):
        """LastestVersionProgram 의 최신 exe 파일명·수정 시간 표시."""
        try:
            exes = sorted(
                LATEST_CLIENT_DIR.glob("*.exe"),
                key=lambda p: p.stat().st_mtime,
                reverse=True
            )
            if exes:
                latest = exes[0]
                mtime  = datetime.fromtimestamp(latest.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
                self.root.after(0, self._log, f"  배포 exe: {latest.name}  ({mtime})", "dim")
            else:
                self.root.after(0, self._log, f"  배포 exe 없음: {LATEST_CLIENT_DIR}", "warning")
        except Exception as e:
            self.root.after(0, self._log, f"  exe 확인 실패: {e}", "warning")

    def _run_cmd(self, cmd: list, cwd: str, tag: str = "dim") -> bool:
        """명령 실행 후 출력을 로그에 표시. 성공 여부 반환."""
        try:
            proc = subprocess.Popen(
                cmd, cwd=cwd,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    self.root.after(0, self._log, f"  {line}", tag)
            proc.wait()
            return proc.returncode == 0
        except Exception as e:
            self.root.after(0, self._log, f"  오류: {e}", "error")
            return False

    def _finish_update(self):
        self.is_updating = False
        self.root.after(0, self.update_btn.configure, {"state": "normal", "text": "⟳  Update"})

    # ── 종료 ─────────────────────────────────────────────────────────────
    def _on_close(self):
        self._stop_server()
        events.append_event(LOG_DIR, "L1", "manager_stop")
        # PID 파일을 지워야 L2 가 '정상 종료' 와 '급사' 를 구분할 수 있다.
        pidfile.clear(LOG_DIR)
        self.uvicorn_log.close()
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = ServerManagerApp(root)
    root.mainloop()
