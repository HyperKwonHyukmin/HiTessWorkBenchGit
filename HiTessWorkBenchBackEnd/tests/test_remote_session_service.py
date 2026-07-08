from app.services.remote_session_service import parse_query_user_output, parse_rdp_logon_events


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
