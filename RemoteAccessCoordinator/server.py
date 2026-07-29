"""Portable intranet server for coordinating access to a Windows RDP host."""
from __future__ import annotations

import ctypes
import ipaddress
import json
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Literal

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

PORT = 8765
APP_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
OWNER_FILE = APP_DIR / "config" / "remote_ip_owners.txt"
# electron-updater 피드 파일(latest.yml + 설치본)을 두는 폴더. 기본은 서버 EXE 옆 updates/.
UPDATES_DIR = Path(os.environ.get("RDP_UPDATES_DIR") or (APP_DIR / "updates"))
_UPDATE_NAME_RE = re.compile(r"^(latest\.yml|RDP-Access-Desk-Setup-[0-9.]+\.exe)$")
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_RDP_EVENT_CACHE = {"at": 0.0, "data": {}}


def load_owners() -> dict[str, str]:
    try:
        text = OWNER_FILE.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        text = OWNER_FILE.read_text(encoding="cp949")
    except FileNotFoundError:
        return {}
    owners: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        address, name = (item.strip() for item in line.split(":", 1))
        if address and name:
            owners[address] = name
    return owners


def parse_query_user(output: str) -> list[dict]:
    sessions = []
    for raw in output.splitlines()[1:]:
        parts = re.split(r"\s+", raw.strip().lstrip(">").strip())
        if len(parts) < 5:
            continue
        if len(parts) >= 6 and parts[2].isdigit():
            username, session_name, session_id, state, idle, *logged_on = parts
        elif parts[1].isdigit():
            username, session_id, state, idle, *logged_on = parts
            session_name = ""
        else:
            continue
        sessions.append({
            "username": username,
            "session_id": int(session_id),
            "session_name": session_name,
            "state": state,
            "idle_time": idle,
            "logon_time": " ".join(logged_on),
        })
    return sessions


def parse_qwinsta_output(output: str) -> list[dict]:
    """Parse `qwinsta` as a fallback when `query user` is unavailable to the process."""
    sessions = []
    for raw in output.splitlines()[1:]:
        line = raw.strip().lstrip(">").strip()
        if not line:
            continue
        parts = re.split(r"\s+", line)
        if len(parts) < 4 or not parts[0].lower().startswith("rdp-tcp#"):
            continue
        # qwinsta columns: SESSIONNAME USERNAME ID STATE TYPE DEVICE.
        session_name, username, session_id, state, *_ = parts
        if not session_id.isdigit():
            continue
        sessions.append({
            "username": username or "원격 사용자",
            "session_id": int(session_id),
            "session_name": session_name,
            "state": state,
            "idle_time": "-",
            "logon_time": "",
        })
    return sessions


class WTS_CLIENT_ADDRESS(ctypes.Structure):
    _fields_ = [("AddressFamily", ctypes.c_ulong), ("Address", ctypes.c_byte * 20)]


def session_client_ip(session_id: int) -> str | None:
    """Read the RDP client address directly from Windows Terminal Services."""
    if os.name != "nt":
        return None
    wtsapi = ctypes.WinDLL("wtsapi32", use_last_error=True)
    buffer = ctypes.c_void_p()
    bytes_returned = ctypes.c_ulong()
    # WTSClientAddress = 14. WTS_CURRENT_SERVER_HANDLE = 0.
    ok = wtsapi.WTSQuerySessionInformationW(
        None, session_id, 14, ctypes.byref(buffer), ctypes.byref(bytes_returned)
    )
    if not ok or not buffer:
        return None
    try:
        address = ctypes.cast(buffer, ctypes.POINTER(WTS_CLIENT_ADDRESS)).contents
        if address.AddressFamily != 2:  # AF_INET
            return None
        raw = bytes((address.Address[index] & 0xFF) for index in range(2, 6))
        candidate = str(ipaddress.IPv4Address(raw))
        return None if candidate == "0.0.0.0" else candidate
    finally:
        wtsapi.WTSFreeMemory(buffer)


def read_rdp_sessions() -> list[dict]:
    if os.name != "nt":
        return []
    def run_session_command(command: list[str]) -> str:
        try:
            return subprocess.run(
                command, capture_output=True, text=True, errors="replace",
                check=True, timeout=5, creationflags=CREATE_NO_WINDOW,
            ).stdout
        except (OSError, subprocess.SubprocessError) as error:
            print(f"[RDP discovery] {' '.join(command)} failed: {error}")
            return ""

    qwinsta_rows = parse_qwinsta_output(run_session_command(["qwinsta"]))
    # qwinsta succeeds for the server process in environments where query user is
    # restricted. Only use query user as a secondary source when qwinsta finds none.
    query_rows = [] if qwinsta_rows else parse_query_user(run_session_command(["query", "user"]))
    # qwinsta reports the Terminal Services session directly. Prefer it as the source of
    # remote-session identity; query user enriches it with idle/logon-time information.
    by_id = {row["session_id"]: row for row in query_rows}
    discovered = qwinsta_rows or query_rows
    print(f"[RDP discovery] query={len(query_rows)}, qwinsta={len(qwinsta_rows)}")
    owners = load_owners()
    rows = []
    for discovered_session in discovered:
        session = {**discovered_session, **by_id.get(discovered_session["session_id"], {})}
        if not session["session_name"].lower().startswith("rdp-tcp"):
            continue
        try:
            address = session_client_ip(session["session_id"])
        except OSError:
            address = None
        session["ip_address"] = address
        session["display_name"] = owners.get(address, session["username"])
        session["is_active"] = session["state"].lower() in {"active", "활성"}
        rows.append(session)
    # WTSClientAddress is disabled on some Windows Server policies. When there is a
    # single RDP session, its established TCP/3389 peer is an unambiguous fallback.
    tcp_ips = active_rdp_tcp_ips()
    missing_ip = [row for row in rows if not row["ip_address"]]
    if len(missing_ip) == 1 and len(tcp_ips) == 1:
        missing_ip[0]["ip_address"] = tcp_ips[0]
        missing_ip[0]["display_name"] = owners.get(tcp_ips[0], missing_ip[0]["username"])
    logon_times = recent_rdp_logon_times()
    for row in rows:
        if not row["logon_time"]:
            row["logon_time"] = logon_times.get(row["username"].lower(), "")
    print(f"[RDP discovery] tcp_ips={tcp_ips}")
    return rows


def active_rdp_tcp_ips() -> list[str]:
    script = (
        "Get-NetTCPConnection -LocalPort 3389 -State Established -ErrorAction SilentlyContinue | "
        "ForEach-Object { $_.RemoteAddress }"
    )
    try:
        output = subprocess.run(
            ["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True,
            errors="replace", check=True, timeout=5, creationflags=CREATE_NO_WINDOW,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return [line.strip() for line in output.splitlines() if re.fullmatch(r"\d{1,3}(?:\.\d{1,3}){3}", line.strip())]


def recent_rdp_logon_times() -> dict[str, str]:
    """Read the latest Terminal Services logon time per user, cached for 30 seconds."""
    if time.monotonic() - _RDP_EVENT_CACHE["at"] < 30:
        return _RDP_EVENT_CACHE["data"]
    script = (
        "$events = Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-TerminalServices-RemoteConnectionManager/Operational'; Id=1149} "
        "-MaxEvents 100 -ErrorAction SilentlyContinue; "
        "$rows = foreach ($event in $events) { $xml=[xml]$event.ToXml(); $user=$xml.Event.UserData.EventXML.Param1; "
        "if ($user) { [PSCustomObject]@{Username=$user; Time=$event.TimeCreated.ToString('s')} } }; $rows | ConvertTo-Json -Compress"
    )
    try:
        output = subprocess.run(
            ["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True,
            errors="replace", check=True, timeout=8, creationflags=CREATE_NO_WINDOW,
        ).stdout
        records = json.loads(output) if output.strip() else []
        if isinstance(records, dict):
            records = [records]
        found = latest_logon_times(records)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        found = {}
    _RDP_EVENT_CACHE.update({"at": time.monotonic(), "data": found})
    return found


def latest_logon_times(records: list[dict]) -> dict[str, str]:
    """Get-WinEvent returns newest first; keep the first RDP connection per user."""
    found = {}
    for row in records:
        username = (row.get("Username") or "").lower()
        logged_on = row.get("Time")
        if username and logged_on:
            found.setdefault(username, logged_on)
    return found


def format_duration(logon_time: str) -> str:
    logged_on = re.sub(r"\s+", " ", logon_time).strip()
    korean = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2}) (오전|오후) (\d{1,2}):(\d{2})", logged_on)
    if korean:
        year, month, day, meridiem, hour, minute = korean.groups()
        hour = int(hour) % 12 + (12 if meridiem == "오후" else 0)
        started = datetime(int(year), int(month), int(day), hour, int(minute))
        seconds = max(0, (datetime.now() - started).total_seconds())
        hours, remainder = divmod(int(seconds), 3600)
        return f"{hours}시간 {remainder // 60}분" if hours else f"{remainder // 60}분"
    try:
        started = datetime.fromisoformat(logged_on)
        seconds = max(0, (datetime.now() - started).total_seconds())
        hours, remainder = divmod(int(seconds), 3600)
        return f"{hours}시간 {remainder // 60}분" if hours else f"{remainder // 60}분"
    except ValueError:
        pass
    for pattern in ("%Y-%m-%d %H:%M", "%Y-%m-%d %p %I:%M", "%m/%d/%Y %I:%M %p"):
        try:
            seconds = max(0, (datetime.now() - datetime.strptime(logged_on, pattern)).total_seconds())
            hours, remainder = divmod(int(seconds), 3600)
            minutes = remainder // 60
            return f"{hours}시간 {minutes}분" if hours else f"{minutes}분"
        except ValueError:
            pass
    return "계산 중"


class MessageIn(BaseModel):
    from_ip: str
    to_ip: str
    text: str = Field(min_length=1, max_length=1000)
    kind: Literal["chat", "access_request"] = "chat"


class StatusIn(BaseModel):
    client_ip: str
    message: str = Field(max_length=200)
    expected_minutes: int | None = Field(default=None, ge=1, le=1440)


app = FastAPI(title="RDP Access Coordinator")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
messages: list[dict] = []
statuses: dict[str, dict] = {}
lock = threading.Lock()
next_message_id = 1


def current_sessions() -> list[dict]:
    sessions = read_rdp_sessions()
    active_ips = {row["ip_address"] for row in sessions if row["ip_address"]}
    with lock:
        for address in list(statuses):
            if address not in active_ips:
                statuses.pop(address, None)
        for row in sessions:
            row["connected_duration"] = format_duration(row["logon_time"])
            row["status"] = statuses.get(row["ip_address"], None)
    return sessions


@app.get("/api/status")
def get_status():
    return {"server_time": datetime.now().isoformat(timespec="seconds"), "sessions": current_sessions()}


@app.post("/api/status")
def set_status(request: StatusIn):
    sessions = current_sessions()
    if request.client_ip not in {row["ip_address"] for row in sessions}:
        raise HTTPException(403, "현재 RDP 접속자로 확인되지 않은 IP입니다.")
    with lock:
        statuses[request.client_ip] = {
            "message": request.message.strip(),
            "expected_minutes": request.expected_minutes,
            "updated_at": datetime.now().isoformat(timespec="seconds"),
        }
    return {"ok": True}


@app.get("/api/messages")
def get_messages(client_ip: str, after_id: int = 0):
    with lock:
        result = [row for row in messages if row["id"] > after_id and (row["from_ip"] == client_ip or row["to_ip"] == client_ip)]
    return {"messages": result}


@app.post("/api/messages")
def send_message(request: MessageIn):
    global next_message_id
    sessions = current_sessions()
    active_ips = {row["ip_address"] for row in sessions if row["ip_address"]}
    owners = load_owners()
    if request.from_ip not in owners or request.to_ip not in owners:
        raise HTTPException(403, "대화 상대 PC IP가 remote_ip_owners.txt에 등록되어 있지 않습니다.")
    with lock:
        # 최초 요청은 현재 RDP 작업자에게만 보낸다. 이후에는 작업자가
        # 요청자(아직 RDP에 접속하지 않은 사람)에게 답장할 수 있어야 한다.
        existing_conversation = any(
            {row["from_ip"], row["to_ip"]} == {request.from_ip, request.to_ip}
            for row in messages
        )
        is_active_user_reply = (
            request.kind == "chat"
            and request.from_ip in active_ips
            and existing_conversation
        )
        if request.to_ip not in active_ips and not is_active_user_reply:
            raise HTTPException(404, "받는 사용자가 현재 RDP에 접속해 있지 않습니다.")
        row = {"id": next_message_id, **request.model_dump(), "sent_at": datetime.now().isoformat(timespec="seconds")}
        next_message_id += 1
        messages.append(row)
        del messages[:-500]
    return {"ok": True, "message": row}


@app.get("/updates/{filename}")
def serve_update(filename: str):
    """electron-updater 자동 업데이트 피드 — latest.yml 과 NSIS 설치본을 서빙한다."""
    if not _UPDATE_NAME_RE.match(filename):  # 화이트리스트로 경로 탈출·임의 파일 노출 차단
        raise HTTPException(404, "not found")
    path = UPDATES_DIR / filename
    if not path.is_file():
        raise HTTPException(404, "update file not found")
    # 회사 DRM이 C: 파일을 at-rest 로 암호화하므로 stat 크기(FileResponse) 대신 read() 로
    # 복호화한 실제 바이트 기준으로 서빙해야 길이/내용이 어긋나지 않는다(viewers.py 와 동일 원칙).
    data = path.read_bytes()
    media = "text/yaml" if filename.endswith(".yml") else "application/octet-stream"
    return Response(content=data, media_type=media)


if __name__ == "__main__":
    print(f"RDP Access Coordinator server started: http://0.0.0.0:{PORT}")
    print(f"IP owner file: {OWNER_FILE}")
    print(f"Update feed dir: {UPDATES_DIR}")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
