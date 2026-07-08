"""Windows Remote Desktop session discovery helpers."""
import concurrent.futures
import json
import os
import platform
import re
import subprocess
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path


REMOTE_SESSION_PREFIXES = ("rdp-tcp",)
_BACKEND_DIR = Path(__file__).resolve().parents[2]
DEFAULT_IP_OWNER_LIST_PATH = _BACKEND_DIR / "config" / "remote_ip_owners.txt"
IP_OWNER_LIST_PATH = Path(os.environ.get("REMOTE_IP_OWNER_LIST", str(DEFAULT_IP_OWNER_LIST_PATH)))

# 원격 세션 조회는 powershell 서브프로세스를 여러 번 띄워 비싸므로 짧게 캐싱한다.
_RESULT_CACHE_TTL = 20.0
_result_cache_lock = threading.Lock()
_result_cache = {}  # include_ip(bool) -> (monotonic_ts, result)


def parse_query_user_output(output: str):
    """Parse `query user` / `quser` output into session dictionaries."""
    sessions = []
    for raw_line in output.splitlines()[1:]:
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith(">"):
            line = line[1:].strip()

        parts = re.split(r"\s+", line)
        if len(parts) < 5:
            continue

        username = parts[0]
        if len(parts) >= 6 and parts[2].isdigit():
            session_name = parts[1]
            session_id = parts[2]
            state = parts[3]
            idle_time = parts[4]
            logon_time = " ".join(parts[5:])
        elif parts[1].isdigit():
            session_name = ""
            session_id = parts[1]
            state = parts[2]
            idle_time = parts[3]
            logon_time = " ".join(parts[4:])
        else:
            continue

        state_normalized = state.lower()
        is_remote = session_name.lower().startswith(REMOTE_SESSION_PREFIXES)
        is_active = state_normalized in {"active", "활성"}
        sessions.append({
            "username": username,
            "session_name": session_name,
            "session_id": int(session_id),
            "state": state,
            "is_active": is_active,
            "idle_time": idle_time,
            "logon_time": logon_time,
            "is_remote": is_remote,
            "ip_address": None,
            "ip_logon_time": None,
        })
    return sessions


def parse_rdp_logon_events(output: str):
    """Parse JSON emitted from the PowerShell Security 4624 lookup."""
    if not output.strip():
        return {}
    try:
        payload = json.loads(output)
    except json.JSONDecodeError:
        return {}

    rows = payload if isinstance(payload, list) else [payload]
    by_username = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        username = (row.get("Username") or "").strip()
        ip_address = (row.get("IpAddress") or "").strip()
        if not username or not ip_address or ip_address in {"-", "::1", "127.0.0.1"}:
            continue
        by_username.setdefault(username.lower(), {
            "ip_address": ip_address,
            "ip_logon_time": row.get("TimeCreated"),
        })
    return by_username


def parse_rdp_client_ip_rows(output: str):
    """Parse JSON rows that contain RemoteAddress/IpAddress fields."""
    if not output.strip():
        return []
    try:
        payload = json.loads(output)
    except json.JSONDecodeError:
        return []

    rows = payload if isinstance(payload, list) else [payload]
    addresses = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        ip_address = (row.get("RemoteAddress") or row.get("IpAddress") or "").strip()
        if not ip_address or ip_address in {"-", "::1", "127.0.0.1", "0.0.0.0", "::"}:
            continue
        if ip_address not in addresses:
            addresses.append(ip_address)
    return addresses


def parse_terminal_services_events(output: str):
    """Parse JSON emitted from the TerminalServices 1149 lookup."""
    if not output.strip():
        return {}
    try:
        payload = json.loads(output)
    except json.JSONDecodeError:
        return {}

    rows = payload if isinstance(payload, list) else [payload]
    by_username = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        username = (row.get("Username") or "").strip()
        ip_address = (row.get("IpAddress") or "").strip()
        if not username or not ip_address or ip_address in {"-", "::1", "127.0.0.1"}:
            continue
        by_username.setdefault(username.lower(), {
            "ip_address": ip_address,
            "ip_logon_time": row.get("TimeCreated"),
        })
    return by_username


def parse_ip_owner_list(text: str):
    """Parse `IP : owner` lines into an IP-to-owner dictionary."""
    owners = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" in line:
            ip_address, owner = line.split(":", 1)
        else:
            parts = re.split(r"\s+", line, maxsplit=1)
            if len(parts) != 2:
                continue
            ip_address, owner = parts
        ip_address = ip_address.strip()
        owner = owner.strip()
        if ip_address and owner:
            owners[ip_address] = owner
    return owners


def load_ip_owner_map(path=IP_OWNER_LIST_PATH):
    try:
        return parse_ip_owner_list(Path(path).read_text(encoding="utf-8-sig"))
    except UnicodeDecodeError:
        return parse_ip_owner_list(Path(path).read_text(encoding="cp949", errors="replace"))
    except FileNotFoundError:
        return {}


def _run_command(command, timeout=5):
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=timeout,
        shell=True,
        errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "command failed").strip())
    return result.stdout


def _query_windows_sessions():
    try:
        output = _run_command("query user", timeout=5)
    except Exception:
        output = _run_command("quser", timeout=5)
    return parse_query_user_output(output)


def _query_recent_rdp_ips(days=1):
    # 서버 보안 로그(4624)는 매우 커서 스캔·XML 파싱이 비싸다.
    # 범위를 1일·100건으로 제한해 지배적 병목을 줄인다(활성 세션 IP는 TCP 3389로 보완).
    start_time = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")
    script = (
        "$events = Get-WinEvent -FilterHashtable "
        f"@{{LogName='Security'; Id=4624; StartTime=[datetime]'{start_time}'}} "
        "-MaxEvents 100 -ErrorAction Stop; "
        "$rows = foreach ($event in $events) { "
        "$xml = [xml]$event.ToXml(); $data = @{}; "
        "foreach ($d in $xml.Event.EventData.Data) { $data[$d.Name] = $d.'#text' }; "
        "if ($data.LogonType -eq '10' -and $data.TargetUserName -and "
        "$data.IpAddress -and $data.IpAddress -ne '-') { "
        "[PSCustomObject]@{Username=$data.TargetUserName; IpAddress=$data.IpAddress; "
        "TimeCreated=$event.TimeCreated.ToString('s')} } }; "
        "$rows | ConvertTo-Json -Compress"
    )
    output = _run_command(
        f'powershell -NoProfile -ExecutionPolicy Bypass -Command "{script}"',
        timeout=8,
    )
    return parse_rdp_logon_events(output)


def _query_terminal_services_rdp_ips(days=3):
    start_time = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")
    script = (
        "$events = Get-WinEvent -FilterHashtable "
        "@{LogName='Microsoft-Windows-TerminalServices-RemoteConnectionManager/Operational'; "
        f"Id=1149; StartTime=[datetime]'{start_time}'}} "
        "-MaxEvents 300 -ErrorAction SilentlyContinue; "
        "$rows = foreach ($event in $events) { "
        "$xml = [xml]$event.ToXml(); "
        "$node = $xml.Event.UserData.EventXML; "
        "$user = $node.Param1; $ip = $node.Param3; "
        "if (-not $user -or -not $ip) { "
        "$data = @($xml.Event.EventData.Data | ForEach-Object { $_.'#text' }); "
        "$user = $data[0]; $ip = $data[2] }; "
        "if ($user -and $ip -and $ip -ne '-') { "
        "[PSCustomObject]@{Username=$user; IpAddress=$ip; "
        "TimeCreated=$event.TimeCreated.ToString('s')} } }; "
        "$rows | ConvertTo-Json -Compress"
    )
    output = _run_command(
        f'powershell -NoProfile -ExecutionPolicy Bypass -Command "{script}"',
        timeout=8,
    )
    return parse_terminal_services_events(output)


def _query_active_rdp_client_ips():
    script = (
        "$rows = Get-NetTCPConnection -LocalPort 3389 -State Established "
        "-ErrorAction SilentlyContinue | Where-Object { $_.RemoteAddress -and "
        "$_.RemoteAddress -notin @('127.0.0.1','::1','0.0.0.0','::') } | "
        "Select-Object RemoteAddress; "
        "$rows | ConvertTo-Json -Compress"
    )
    output = _run_command(
        f'powershell -NoProfile -ExecutionPolicy Bypass -Command "{script}"',
        timeout=5,
    )
    return parse_rdp_client_ip_rows(output)


def get_remote_session_status(include_ip=True):
    """Return current Windows RDP session status for the WorkBench host."""
    now = time.monotonic()
    with _result_cache_lock:
        cached = _result_cache.get(include_ip)
        if cached and (now - cached[0]) < _RESULT_CACHE_TTL:
            return cached[1]

    if platform.system().lower() != "windows":
        return {
            "supported": False,
            "has_remote_user": False,
            "remote_sessions": [],
            "all_sessions": [],
            "ip_lookup_status": "unsupported_os",
            "error": "Remote session lookup is only supported on Windows hosts.",
        }

    try:
        sessions = _query_windows_sessions()
    except Exception as exc:
        return {
            "supported": True,
            "has_remote_user": False,
            "has_active_remote_user": False,
            "remote_sessions": [],
            "all_sessions": [],
            "active_rdp_client_ips": [],
            "ip_lookup_status": "not_attempted",
            "error": f"Remote session lookup failed: {exc}",
            "checked_at": datetime.now().isoformat(timespec="seconds"),
        }

    ip_lookup_status = "not_requested"
    active_rdp_client_ips = []
    ip_owner_map = load_ip_owner_map()

    if include_ip:
        lookup_errors = []

        def _safe_lookup(key, fn):
            try:
                return key, fn(), None
            except Exception as exc:
                return key, None, f"{key}: {exc}"

        # IP 조회 3종(4624/1149/3389)은 서로 독립적이라 병렬로 실행한다.
        # 순차 합산(≈10s+) → 최댓값(≈수초)으로 단축해 프론트 타임아웃을 피한다.
        results = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            futures = [
                executor.submit(_safe_lookup, "security_4624", _query_recent_rdp_ips),
                executor.submit(_safe_lookup, "terminalservices_1149", _query_terminal_services_rdp_ips),
                executor.submit(_safe_lookup, "tcp_3389", _query_active_rdp_client_ips),
            ]
            for future in concurrent.futures.as_completed(futures):
                key, value, err = future.result()
                if err:
                    lookup_errors.append(err)
                else:
                    results[key] = value

        # 4624(우선) → 1149(보완) 순서로 IP를 채운다(기존 우선순위 유지).
        ips_by_username = results.get("security_4624") or {}
        for session in sessions:
            event = ips_by_username.get(session["username"].lower())
            if event:
                session.update(event)

        terminal_ips_by_username = results.get("terminalservices_1149") or {}
        for session in sessions:
            if session.get("ip_address"):
                continue
            event = terminal_ips_by_username.get(session["username"].lower())
            if event:
                session.update(event)

        active_rdp_client_ips = results.get("tcp_3389") or []

        remote_session_candidates = [session for session in sessions if session["is_remote"]]
        sessions_missing_ip = [
            session for session in remote_session_candidates if not session.get("ip_address")
        ]
        if len(sessions_missing_ip) == 1 and len(active_rdp_client_ips) == 1:
            sessions_missing_ip[0]["ip_address"] = active_rdp_client_ips[0]
            sessions_missing_ip[0]["ip_logon_time"] = "current_tcp_connection"

        ip_lookup_status = "ok" if not lookup_errors else f"partial: {'; '.join(lookup_errors)}"

    remote_sessions = [session for session in sessions if session["is_remote"]]
    for session in remote_sessions:
        ip_address = session.get("ip_address")
        ip_owner = ip_owner_map.get(ip_address) if ip_address else None
        session["ip_owner"] = ip_owner
        session["display_name"] = ip_owner or session.get("username") or "원격 사용자"

    active_remote_sessions = [session for session in remote_sessions if session["is_active"]]
    active_rdp_clients = [
        {"ip_address": ip_address, "ip_owner": ip_owner_map.get(ip_address)}
        for ip_address in active_rdp_client_ips
    ]
    result = {
        "supported": True,
        "has_remote_user": len(remote_sessions) > 0,
        "has_active_remote_user": len(active_remote_sessions) > 0,
        "remote_sessions": remote_sessions,
        "all_sessions": sessions,
        "active_rdp_client_ips": active_rdp_client_ips,
        "active_rdp_clients": active_rdp_clients,
        "ip_lookup_status": ip_lookup_status,
        "checked_at": datetime.now().isoformat(timespec="seconds"),
    }
    with _result_cache_lock:
        _result_cache[include_ip] = (time.monotonic(), result)
    return result
