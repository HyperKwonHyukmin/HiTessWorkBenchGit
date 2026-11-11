"""비정상 종료(DRM 이 파이썬을 끊음)여도 결과를 끝까지 썼으면 계속 간다 — 2026-11-11 실제 사례.

20261111_105028_A476854_GroupModuleUnit: 편집 BDF 를 ENDDATA 까지 쓴 1초 뒤 python.exe 가 HIDRMH.DLL 에서 0xC0000005.
"""
import json
import os
import subprocess
import time

import pytest

from app.services import unit_structural_service as svc
from app.services.exit_codes import outputs_complete_after_crash

CRASH = 3221225477  # 0xC0000005


def _bdf(path, ended=True):
    with open(path, "w", encoding="latin-1") as f:
        f.write("$ HiTessModelBuilder\nBEGIN BULK\nGRID           1               0.0     0.0     0.0\n")
        if ended:
            f.write("ENDDATA\n\n")


def test_crash_after_complete_bdf_is_tolerated(tmp_path):
    p = tmp_path / "a_edited.bdf"
    started = time.time()
    _bdf(p)
    assert outputs_complete_after_crash(CRASH, [str(p)], started) is True


def test_half_written_bdf_is_not_tolerated(tmp_path):
    p = tmp_path / "a_edited.bdf"
    started = time.time()
    _bdf(p, ended=False)
    assert outputs_complete_after_crash(CRASH, [str(p)], started) is False


def test_stale_file_from_earlier_run_is_not_tolerated(tmp_path):
    p = tmp_path / "a_edited.bdf"
    _bdf(p)
    old = time.time() - 600
    os.utime(p, (old, old))
    assert outputs_complete_after_crash(CRASH, [str(p)], time.time()) is False


def test_ordinary_failure_and_missing_file_are_not_tolerated(tmp_path):
    p = tmp_path / "a_edited.bdf"
    started = time.time()
    _bdf(p)
    assert outputs_complete_after_crash(1, [str(p)], started) is False
    assert outputs_complete_after_crash(CRASH, [str(tmp_path / "none.bdf")], started) is False


def test_json_must_parse(tmp_path):
    good, bad = tmp_path / "m.json", tmp_path / "n.json"
    started = time.time()
    good.write_text(json.dumps({"ok": True}), encoding="utf-8")
    bad.write_text('{"ok": tr', encoding="utf-8")
    assert outputs_complete_after_crash(CRASH, [str(good)], started) is True
    assert outputs_complete_after_crash(CRASH, [str(good), str(bad)], started) is False


def _fake_bridge(tmp_path, apply_code, apply_ends, prepare_code=0):
    """build_lifting_bdf 의 두 bridge 호출을 흉내낸다 — 파일을 쓰고 지정한 종료 코드로 끝난다."""
    calls = []

    def run(args, cwd=None, **_kw):
        calls.append(args)
        if "lift-run" in args:
            out = args[args.index("-o") + 1]
            meta = args[args.index("--meta") + 1]
            _bdf(os.path.join(cwd, out))
            with open(os.path.join(cwd, meta), "w", encoding="utf-8") as f:
                json.dump({"wires": []}, f)
            return subprocess.CompletedProcess(args, prepare_code, b"", b"")
        out = args[args.index("-o") + 1]
        _bdf(os.path.join(cwd, out), ended=apply_ends)
        return subprocess.CompletedProcess(args, apply_code, b"", b"")
    return run, calls


@pytest.fixture
def model_dir(tmp_path):
    bdf = tmp_path / "m.bdf"
    _bdf(bdf)
    (tmp_path / "m_edited.json").write_text("{}", encoding="utf-8")
    (tmp_path / "m_stability.json").write_text("{}", encoding="utf-8")
    return tmp_path


def _build(d):
    return svc.build_lifting_bdf(
        str(d / "m.bdf"), str(d / "m_stability.json"), 2.0,
        str(d / "m_lifting.bdf"), str(d / "m_lifting_meta.json"), str(d / "m_edited.bdf"),
    )


def test_build_continues_when_apply_crashes_after_writing(model_dir, monkeypatch):
    run, calls = _fake_bridge(model_dir, CRASH, apply_ends=True)
    monkeypatch.setattr(svc.subprocess, "run", run)
    log = _build(model_dir)
    assert len(calls) == 2  # 편집 BDF 다음 Wire BDF 까지 갔다
    assert "계속 진행합니다" in log and "0xC0000005" in log


def test_build_fails_when_apply_crashes_mid_write(model_dir, monkeypatch):
    run, calls = _fake_bridge(model_dir, CRASH, apply_ends=False)
    monkeypatch.setattr(svc.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="실행 환경 문제"):
        _build(model_dir)
    assert len(calls) == 1


def test_build_continues_when_prepare_crashes_after_writing(model_dir, monkeypatch):
    run, _calls = _fake_bridge(model_dir, 0, apply_ends=True, prepare_code=CRASH)
    monkeypatch.setattr(svc.subprocess, "run", run)
    assert "Wire 포함 BDF 생성 프로그램이 종료 순간" in _build(model_dir)
