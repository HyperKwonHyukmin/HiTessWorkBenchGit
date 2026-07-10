import threading
import time

import app.services.remote_session_service as rss
from app.services.remote_session_service import (
    parse_ip_owner_list,
    parse_query_user_output,
    parse_rdp_client_ip_rows,
    parse_rdp_logon_events,
    parse_terminal_services_events,
)


def test_parse_query_user_output_with_remote_and_console_sessions():
    output = """ USERNAME              SESSIONNAME        ID  STATE   IDLE TIME  LOGON TIME
>kim                  rdp-tcp#3           2  Active          .  2026-07-08 09:12
 lee                  console             1  Active       none  2026-07-08 08:50
 park                                     4  Disc            3  2026-07-07 17:11
"""

    sessions = parse_query_user_output(output)

    assert len(sessions) == 3
    assert sessions[0]["username"] == "kim"
    assert sessions[0]["is_remote"] is True
    assert sessions[0]["is_active"] is True
    assert sessions[0]["session_id"] == 2
    assert sessions[1]["is_remote"] is False
    assert sessions[2]["session_name"] == ""


def test_parse_rdp_logon_events_uses_latest_event_per_user():
    output = """
[
  {"Username":"kim","IpAddress":"10.0.0.15","TimeCreated":"2026-07-08T09:12:00"},
  {"Username":"lee","IpAddress":"-","TimeCreated":"2026-07-08T08:50:00"}
]
"""

    events = parse_rdp_logon_events(output)

    assert events == {
        "kim": {
            "ip_address": "10.0.0.15",
            "ip_logon_time": "2026-07-08T09:12:00",
        }
    }


def test_parse_terminal_services_events_maps_user_to_ip():
    output = '{"Username":"kim","IpAddress":"10.0.0.16","TimeCreated":"2026-07-08T09:13:00"}'

    events = parse_terminal_services_events(output)

    assert events["kim"]["ip_address"] == "10.0.0.16"


def test_parse_rdp_client_ip_rows_deduplicates_active_connections():
    output = """
[
  {"RemoteAddress":"10.0.0.17"},
  {"RemoteAddress":"10.0.0.17"},
  {"RemoteAddress":"127.0.0.1"}
]
"""

    assert parse_rdp_client_ip_rows(output) == ["10.0.0.17"]


def test_parse_ip_owner_list_supports_colon_format():
    text = """
10.133.122.70 : 권혁민 책임
10.133.122.71 : 김윤환 책임
"""

    assert parse_ip_owner_list(text) == {
        "10.133.122.70": "권혁민 책임",
        "10.133.122.71": "김윤환 책임",
    }


def test_run_command_serializes_process_spawn(monkeypatch):
    """동시 CreateProcess access violation 방어 회귀 테스트.

    여러 스레드가 _run_command 를 동시에 호출해도 subprocess.Popen '생성 구간'에는
    한 번에 하나만 진입해야 한다. (Windows 에서 동시 CreateProcess 는 native access
    violation 을 일으켜 uvicorn 이 무-로그로 급사한다 — 2026-07-10 실측 크래시.)
    _SPAWN_LOCK 이 제거되면 이 테스트가 실패한다.
    """
    state = {"cur": 0, "max": 0}
    lock = threading.Lock()

    class _FakePopen:
        def __init__(self, args, **kwargs):
            with lock:
                state["cur"] += 1
                state["max"] = max(state["max"], state["cur"])
            time.sleep(0.01)  # CreateProcess 구간 모사(겹치면 max>1 로 잡힘)
            with lock:
                state["cur"] -= 1
            self.returncode = 0

        def communicate(self, timeout=None):
            time.sleep(0.02)  # 실제 실행은 락 밖 → 병렬로 진행돼야 한다
            return ("out", "")

        def poll(self):
            return 0

        def kill(self):
            pass

    monkeypatch.setattr(rss.subprocess, "Popen", _FakePopen)

    def worker():
        rss._run_command(["dummy"], timeout=5)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert state["max"] == 1, (
        f"동시 spawn 발생(max={state['max']}) — _SPAWN_LOCK 직렬화가 깨졌다"
    )
