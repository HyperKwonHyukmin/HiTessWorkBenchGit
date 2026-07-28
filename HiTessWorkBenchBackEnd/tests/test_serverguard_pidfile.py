from pathlib import Path

import pytest

from serverguard import pidfile


def test_write_then_read_roundtrip(tmp_path):
    pidfile.write(tmp_path, 4321)

    assert pidfile.read(tmp_path) == 4321


def test_read_returns_none_when_absent(tmp_path):
    assert pidfile.read(tmp_path) is None


def test_read_returns_none_for_garbage_content(tmp_path):
    (tmp_path / pidfile.PID_FILENAME).write_text("not a pid", encoding="utf-8")

    assert pidfile.read(tmp_path) is None


def test_read_propagates_unexpected_errors(tmp_path, monkeypatch):
    # "파일 없음"·"파싱 불가"는 판정 가능한 상태(None)지만, 권한 오류 등은
    # "L1이 죽었는지 알 수 없음"이다. 이걸 None 으로 뭉개면 L2 가 살아있는
    # L1 위에 중복 기동을 시도할 위험이 생긴다(팀리드 승인) — 전파해야 한다.
    (tmp_path / pidfile.PID_FILENAME).write_text("4321", encoding="utf-8")

    def boom(self, encoding=None):
        raise PermissionError("locked")

    monkeypatch.setattr(Path, "read_text", boom)

    with pytest.raises(PermissionError):
        pidfile.read(tmp_path)


def test_clear_removes_file(tmp_path):
    pidfile.write(tmp_path, 4321)

    pidfile.clear(tmp_path)

    assert pidfile.read(tmp_path) is None


def test_clear_is_safe_when_file_missing(tmp_path):
    pidfile.clear(tmp_path)      # 예외를 던지면 안 된다.


def test_write_creates_missing_directory(tmp_path):
    nested = tmp_path / "logs"

    pidfile.write(nested, 999)

    assert pidfile.read(nested) == 999


def test_write_propagates_failure_instead_of_silently_dropping_it(tmp_path):
    # write 실패를 삼키면 L2 는 PID 파일을 영원히 "없음"으로 보고, 이미
    # 살아있는 L1 위에 5분마다 중복 기동을 시도하게 된다(팀리드 승인) —
    # 반드시 전파해서 호출자(server_manager.py 기동 경로)가 잡아 기록하게 한다.
    blocked = tmp_path / "blocked"
    blocked.write_text("i am a file, not a directory", encoding="utf-8")

    with pytest.raises(FileExistsError):
        pidfile.write(blocked, 4321)
