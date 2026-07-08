"""Windows Remote Desktop session discovery helpers."""
import json
import platform
import re
import subprocess
from datetime import datetime, timedelta


REMOTE_SESSION_PREFIXES = ("rdp-tcp",)


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


def _query_recent_rdp_ips(days=3):
    start_time = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")
    script = (
        "$events = Get-WinEvent -FilterHashtable "
        f"@{{LogName='Security'; Id=4624; StartTime=[datetime]'{start_time}'}} "
        "-MaxEvents 300 -ErrorAction Stop; "
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


def get_remote_session_status(include_ip=True):
    """Return current Windows RDP session status for the WorkBench host."""
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
            "ip_lookup_status": "not_attempted",
            "error": f"Remote session lookup failed: {exc}",
            "checked_at": datetime.now().isoformat(timespec="seconds"),
        }

    ip_lookup_status = "not_requested"

    if include_ip:
        try:
            ips_by_username = _query_recent_rdp_ips()
            for session in sessions:
                event = ips_by_username.get(session["username"].lower())
                if event:
                    session.update(event)
            ip_lookup_status = "ok"
        except Exception as exc:
            ip_lookup_status = f"unavailable: {exc}"

    remote_sessions = [session for session in sessions if session["is_remote"]]
    active_remote_sessions = [session for session in remote_sessions if session["is_active"]]
    return {
        "supported": True,
        "has_remote_user": len(remote_sessions) > 0,
        "has_active_remote_user": len(active_remote_sessions) > 0,
        "remote_sessions": remote_sessions,
        "all_sessions": sessions,
        "ip_lookup_status": ip_lookup_status,
        "checked_at": datetime.now().isoformat(timespec="seconds"),
    }
