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
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

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

        self._setup_window()
        self._build_ui()
        self._start_server()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

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
    def _start_server(self):
        if self.server_proc and self.server_proc.poll() is None:
            return
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
            self._set_running(True)
            self._log("uvicorn 서버 시작됨 (port 9091)", "success")
            threading.Thread(target=self._stream_output, daemon=True).start()
        except FileNotFoundError:
            self._log(f"Python 실행 파일을 찾을 수 없습니다:\n  {PYTHON}", "error")
            self._log("WorkBenchEnv 가상환경이 생성되어 있는지 확인하세요.", "warning")

    # ── 서버 출력 스트리밍 ───────────────────────────────────────────────
    def _stream_output(self):
        if not self.server_proc:
            return
        for line in self.server_proc.stdout:
            line = line.rstrip()
            if not line:
                continue
            tag = "info"
            if "ERROR" in line or "error" in line.lower():
                tag = "error"
            elif "WARNING" in line or "warning" in line.lower():
                tag = "warning"
            elif "started" in line or "running" in line.lower() or "Application startup" in line:
                tag = "success"
            self.root.after(0, self._log, line, tag)
        # 프로세스 종료됨
        self.root.after(0, self._on_server_exit)

    def _on_server_exit(self):
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
        self._schedule_auto_restart()

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
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = ServerManagerApp(root)
    root.mainloop()
