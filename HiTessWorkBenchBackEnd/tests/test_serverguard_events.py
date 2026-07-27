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
