"""lift-result 결과 읽기 — 브리지가 결과 JSON 을 다 쓴 뒤 출력에서 죽어도 실패 원인을 보여 준다.

실례(2026-11-10, 145, 3469 M02): F06 FATAL 9050 인 권상 해석에서 브리지가 결과 JSON(hasFatal)을 쓴 뒤
안내 문구의 '—'(U+2014)를 cp949 콘솔에 쓰다 UnicodeEncodeError 로 종료 코드 1 을 냈다.
백엔드가 종료 코드만 보고 'lift-result exit code 1' 로 끝내 FATAL 원인·위치 후보 절점 안내가 빠졌다.
"""
import json
import os
import subprocess
import time

import pytest

from app.services.unit_structural_service import load_lift_result


def _proc(code, err=""):
    return subprocess.CompletedProcess(args=["lift-result"], returncode=code, stdout=b"", stderr=err.encode("utf-8"))


def _write(path, payload):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f)


FATAL = {"meta": {"hasFatal": True}, "fatalMessages": [{"code": "9050", "message": "*** USER FATAL MESSAGE 9050"}]}


def test_exit_1_after_writing_this_runs_json_is_used(tmp_path):
    started = time.time()
    out = tmp_path / "r_nastranResult.json"
    _write(out, FATAL)
    payload, note = load_lift_result(_proc(1, "UnicodeEncodeError: 'cp949' codec"), str(out), "log", started)
    assert payload["meta"]["hasFatal"] is True
    assert "exit code 1" in note


def test_exit_1_with_stale_json_still_fails(tmp_path):
    out = tmp_path / "r_nastranResult.json"
    _write(out, FATAL)
    old = time.time() - 3600
    os.utime(out, (old, old))
    with pytest.raises(RuntimeError, match="lift-result exit code 1"):
        load_lift_result(_proc(1), str(out), "log", time.time())


def test_exit_1_without_json_fails(tmp_path):
    with pytest.raises(RuntimeError, match="lift-result exit code 1"):
        load_lift_result(_proc(1), str(tmp_path / "none.json"), "log", time.time())


def test_exit_1_with_broken_json_fails(tmp_path):
    started = time.time()
    out = tmp_path / "r_nastranResult.json"
    out.write_text('{"meta": {"hasFat', encoding="utf-8")
    with pytest.raises(RuntimeError, match="lift-result exit code 1"):
        load_lift_result(_proc(1), str(out), "log", started)


def test_exit_0_reads_json(tmp_path):
    started = time.time()
    out = tmp_path / "r_nastranResult.json"
    _write(out, {"meta": {}, "summary": {"memberElementCount": 3}})
    payload, note = load_lift_result(_proc(0), str(out), "log", started)
    assert payload["summary"]["memberElementCount"] == 3
    assert note == ""


def test_exit_0_without_json_fails(tmp_path):
    with pytest.raises(RuntimeError, match="생성되지 않았습니다"):
        load_lift_result(_proc(0), str(tmp_path / "none.json"), "log", time.time())


def test_bridge_child_runs_with_utf8_output():
    """브리지 자식 프로세스는 UTF-8 출력으로 띄운다 — cp949 에 없는 글자를 써도 죽지 않게."""
    from app.services.unit_structural_service import bridge_env
    env = bridge_env()
    assert env["PYTHONIOENCODING"].lower().startswith("utf-8")
    assert env.get("PATH") == os.environ.get("PATH")
