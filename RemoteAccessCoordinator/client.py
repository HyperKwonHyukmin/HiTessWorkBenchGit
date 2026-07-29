"""Portable desktop client for the RDP Access Coordinator server."""
from __future__ import annotations

import json
import socket
import threading
import tkinter as tk
from tkinter import messagebox, ttk
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SERVER_HOST = "10.14.42.145"
SERVER_PORT = 8765
BASE_URL = f"http://{SERVER_HOST}:{SERVER_PORT}"


def own_ip() -> str:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.connect((SERVER_HOST, SERVER_PORT))
        return sock.getsockname()[0]


def api(path: str, method="GET", payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(BASE_URL + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


class Client(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("RDP 사용 현황 및 대화")
        self.geometry("840x560")
        self.client_ip = own_ip()
        self.last_message_id = 0
        self.sessions: dict[str, dict] = {}
        self._build()
        self.after(300, self.refresh)

    def _build(self):
        frame = ttk.Frame(self, padding=12)
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, text=f"내 IP: {self.client_ip}   |   서버: {SERVER_HOST}").pack(anchor="w")
        self.connection = ttk.Label(frame, text="서버 연결 확인 중…")
        self.connection.pack(anchor="w", pady=(2, 8))
        columns = ("name", "ip", "state", "started", "duration", "message")
        self.tree = ttk.Treeview(frame, columns=columns, show="headings", height=9)
        headings = ["사용자", "IP", "상태", "접속 시각", "경과", "상태 메시지"]
        widths = [95, 115, 70, 135, 80, 300]
        for column, heading, width in zip(columns, headings, widths):
            self.tree.heading(column, text=heading)
            self.tree.column(column, width=width, anchor="w")
        self.tree.pack(fill="x")
        controls = ttk.Frame(frame)
        controls.pack(fill="x", pady=10)
        ttk.Button(controls, text="새로고침", command=self.refresh).pack(side="left")
        ttk.Label(controls, text="내 상태:").pack(side="left", padx=(20, 4))
        self.status_text = ttk.Entry(controls, width=32)
        self.status_text.pack(side="left")
        ttk.Label(controls, text="예상(분):").pack(side="left", padx=(8, 4))
        self.expected = ttk.Entry(controls, width=6)
        self.expected.pack(side="left")
        ttk.Button(controls, text="상태 저장", command=self.save_status).pack(side="left", padx=6)
        ttk.Label(frame, text="대화 — 목록에서 상대를 선택하세요.").pack(anchor="w")
        self.chat = tk.Text(frame, height=12, state="disabled")
        self.chat.pack(fill="both", expand=True)
        send = ttk.Frame(frame)
        send.pack(fill="x", pady=(7, 0))
        self.message = ttk.Entry(send)
        self.message.pack(side="left", fill="x", expand=True)
        self.message.bind("<Return>", lambda _: self.send("chat"))
        ttk.Button(send, text="메시지 보내기", command=lambda: self.send("chat")).pack(side="left", padx=6)
        ttk.Button(send, text="원격 사용 요청", command=lambda: self.send("access_request")).pack(side="left")

    def selected_ip(self):
        selected = self.tree.selection()
        return self.tree.item(selected[0], "values")[1] if selected else None

    def refresh(self):
        threading.Thread(target=self._refresh_worker, daemon=True).start()
        self.after(3000, self.refresh)

    def _refresh_worker(self):
        try:
            status = api("/api/status")
            inbox = api("/api/messages?" + urlencode({"client_ip": self.client_ip, "after_id": self.last_message_id}))
            self.after(0, self.show_data, status["sessions"], inbox["messages"])
        except (HTTPError, URLError, OSError, ValueError) as error:
            self.after(0, lambda: self.connection.config(text=f"서버 연결 실패: {error}", foreground="firebrick"))

    def show_data(self, rows, inbox):
        self.connection.config(text="서버 연결됨", foreground="darkgreen")
        self.sessions = {row.get("ip_address"): row for row in rows if row.get("ip_address")}
        self.tree.delete(*self.tree.get_children())
        for row in rows:
            status = row.get("status") or {}
            text = status.get("message", "")
            if status.get("expected_minutes"):
                text += f" (약 {status['expected_minutes']}분)"
            self.tree.insert("", "end", values=(row["display_name"], row.get("ip_address") or "확인 불가", row["state"], row["logon_time"], row["connected_duration"], text))
        for row in inbox:
            self.last_message_id = max(self.last_message_id, row["id"])
            prefix = "[원격 사용 요청] " if row["kind"] == "access_request" else ""
            other = row["to_ip"] if row["from_ip"] == self.client_ip else row["from_ip"]
            name = self.sessions.get(other, {}).get("display_name", other)
            self.chat.config(state="normal")
            self.chat.insert("end", f"{row['sent_at'][11:16]} {name}: {prefix}{row['text']}\n")
            self.chat.config(state="disabled")
            if row["to_ip"] == self.client_ip:
                self.bell()

    def save_status(self):
        try:
            expected = int(self.expected.get()) if self.expected.get().strip() else None
            api("/api/status", "POST", {"client_ip": self.client_ip, "message": self.status_text.get(), "expected_minutes": expected})
        except (HTTPError, URLError, ValueError) as error:
            messagebox.showerror("상태 저장 실패", str(error))

    def send(self, kind):
        target = self.selected_ip()
        text = self.message.get().strip()
        if not target:
            return messagebox.showwarning("상대 선택", "목록에서 현재 원격 사용자를 선택하세요.")
        if target == self.client_ip:
            return messagebox.showwarning("상대 선택", "자기 자신에게는 보낼 수 없습니다.")
        if not text:
            text = "원격 사용해도 될까요?" if kind == "access_request" else ""
        if not text:
            return
        try:
            api("/api/messages", "POST", {"from_ip": self.client_ip, "to_ip": target, "text": text, "kind": kind})
            self.message.delete(0, "end")
        except (HTTPError, URLError) as error:
            messagebox.showerror("전송 실패", str(error))


if __name__ == "__main__":
    Client().mainloop()
