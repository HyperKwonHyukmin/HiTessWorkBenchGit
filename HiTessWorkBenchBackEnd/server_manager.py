"""HiTESS WorkBench 서버 관리 GUI."""
import subprocess
import threading
import sys
import os
import tkinter as tk
from tkinter import scrolledtext
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PYTHON = str(BASE_DIR / "WorkBenchEnv" / "Scripts" / "python.exe")
PIP    = str(BASE_DIR / "WorkBenchEnv" / "Scripts" / "pip.exe")
SERVER_CMD = [PYTHON, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

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
            self.port_label.configure(text="  port 8000")
            self.toggle_btn.configure(text="Stop", bg=RED, activebackground="#d45f5f")
        else:
            self.status_dot.configure(fg=RED)
            self.status_label.configure(text="Stopped", fg=RED)
            self.port_label.configure(text="")
            self.toggle_btn.configure(text="Start", bg=GREEN, activebackground="#2db87a")

    # ── 서버 시작 ────────────────────────────────────────────────────────
    def _start_server(self):
        if self.server_proc and self.server_proc.poll() is None:
            return
        self._log("서버를 시작하는 중...", "info")
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
            self._log("uvicorn 서버 시작됨 (port 8000)", "success")
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
        if not self.is_updating:
            self._set_running(False)
            self._log("서버 프로세스가 종료되었습니다.", "warning")

    # ── 서버 중지 ────────────────────────────────────────────────────────
    def _stop_server(self):
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
        self.root.after(0, self._log, "[1/3] 서버 중지 중...", "info")
        self.root.after(0, self._stop_server)

        # 2. git pull
        self.root.after(0, self._log, "[2/3] git pull origin main", "info")
        ok = self._run_cmd(["git", "pull", "origin", "main"], cwd=str(BASE_DIR.parent))
        if not ok:
            self.root.after(0, self._log, "git pull 실패. 업데이트를 중단합니다.", "error")
            self._finish_update()
            return

        # 3. pip install
        self.root.after(0, self._log, "[3/3] pip install -r requirements.txt", "info")
        self._run_cmd([PIP, "install", "-r", "requirements.txt"], cwd=str(BASE_DIR))

        # 4. 서버 재시작
        self.root.after(0, self._log, "서버를 재시작합니다.", "success")
        self.root.after(0, self._start_server)
        self.root.after(0, self._log, "업데이트가 완료되었습니다.", "success")
        self.root.after(0, self._log, "=" * 50, "dim")
        self._finish_update()

    def _run_cmd(self, cmd: list, cwd: str) -> bool:
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
                    self.root.after(0, self._log, f"  {line}", "dim")
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
