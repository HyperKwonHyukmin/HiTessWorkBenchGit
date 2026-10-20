"""호선 번호 — Model Builder 가 BDF 주석으로 남기고 권상(GMU)이 다시 읽는 규칙(2026-10-20)."""
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.services import hitess_modelflow_service as service
from app.services import hull_no


@pytest.mark.parametrize("raw, expected", [
    (" 3454 ", "3454"), ("5ppp", "5PPP"), ("H-3454_A", "H-3454_A"),
    ("", None), (None, None), ("34$54", None), ("3454\nSOL 200", None), ("호선", None), ("x" * 21, None),
])
def test_normalize_hull_no(raw, expected):
    assert hull_no.normalize_hull_no(raw) == expected


@pytest.mark.parametrize("name, expected", [
    ("3454-35020-struData-A505080_20251021.csv", "3454"),
    (r"C:\work\3496-35210-A508372_20260108_edit.bdf", "3496"),
    ("3370_M04.bdf", "3370"),
    ("5PPP_-struData-A507260_20260917.csv", None),   # 4자리 숫자가 아니면 제안하지 않는다
    ("8262-MAA-PIPE.csv", "8262"),
    ("34540-x.csv", None),
    ("A-struData.csv", None),
    (None, None),
])
def test_suggest_hull_no_from_filename(name, expected):
    assert hull_no.suggest_hull_no_from_filename(name) == expected


def test_resolve_prefers_comment_over_filename(tmp_path):
    bdf = tmp_path / "3370_M04.bdf"
    bdf.write_text("$ HiTessModelBuilder: HullNo=3454\nSOL 101\nCEND\nBEGIN BULK\nENDDATA\n", encoding="utf-8")
    assert hull_no.resolve_bdf_hull_no(str(bdf)) == ("3454", "comment")


def test_resolve_falls_back_to_filename_then_none(tmp_path):
    with_name = tmp_path / "3370_M04.bdf"
    with_name.write_text("SOL 101\nCEND\nBEGIN BULK\nENDDATA\n", encoding="utf-8")
    assert hull_no.resolve_bdf_hull_no(str(with_name)) == ("3370", "filename")
    plain = tmp_path / "model.bdf"
    plain.write_text("SOL 101\n", encoding="utf-8")
    assert hull_no.resolve_bdf_hull_no(str(plain)) == (None, None)
    assert hull_no.resolve_bdf_hull_no(str(tmp_path / "missing.bdf")) == (None, None)


def test_engine_support_is_checked_once_per_exe(tmp_path):
    exe = tmp_path / "Cmb.Cli.exe"
    exe.write_bytes(b"x")
    hull_no._HULL_FLAG_CACHE.clear()
    helped = SimpleNamespace(stdout="  --hull-no  호선 번호".encode("utf-8"), stderr=b"")
    with patch.object(hull_no.subprocess, "run", return_value=helped) as run:
        assert hull_no.engine_supports_hull_no(str(exe)) is True
        assert hull_no.engine_supports_hull_no(str(exe)) is True
    assert run.call_count == 1
    assert hull_no.engine_supports_hull_no(str(tmp_path / "none.exe")) is False


def _run_modelflow(tmp_path, stru_name, hull=None, supported=True):
    output = tmp_path / "20261020_101242"
    output.mkdir()
    result = SimpleNamespace(returncode=0, stdout=f"출력 폴더: {output}\n".encode("utf-8"), stderr=b"")
    exe = tmp_path / "engine.exe"
    exe.touch()
    with patch.object(service, "mark_running"), patch.object(service, "update_progress"), \
            patch.object(service, "is_cancel_requested", return_value=False), \
            patch.object(service, "engine_supports_hull_no", return_value=supported), \
            patch.object(service.subprocess, "run", return_value=result) as run, \
            patch.object(service, "record_analysis", return_value=(None, None)) as record, \
            patch.object(service, "mark_complete") as complete:
        service.task_execute_modelflow("job", str(tmp_path / stru_name), None, None, str(tmp_path),
                                       str(exe), "tester", "ts", "test",
                                       500.0, False, False, None, None, None, None, hull)
    return run.call_args.args[0], record.call_args.kwargs["input_info"], complete


def test_modelflow_passes_hull_from_filename(tmp_path):
    cmd, info, _ = _run_modelflow(tmp_path, "3454-35020-struData-A505080_20251021.csv")
    assert cmd[cmd.index("--hull-no") + 1] == "3454"
    assert (info["hull_no"], info["hull_no_source"]) == ("3454", "filename")


def test_modelflow_user_hull_overrides_filename(tmp_path):
    cmd, info, complete = _run_modelflow(tmp_path, "3454-35020-struData-A505080_20251021.csv", hull=" 5ppp ")
    assert cmd[cmd.index("--hull-no") + 1] == "5PPP"
    assert (info["hull_no"], info["hull_no_source"]) == ("5PPP", "user")
    assert complete.call_args.kwargs["extra"]["hull_no"] == "5PPP"


def test_modelflow_without_hull_sends_no_flag(tmp_path):
    cmd, info, _ = _run_modelflow(tmp_path, "5PPP_-struData-A507260_20260917.csv")
    assert "--hull-no" not in cmd
    assert info["hull_no"] is None


def test_modelflow_old_engine_skips_flag_and_warns(tmp_path):
    cmd, info, complete = _run_modelflow(tmp_path, "3454-x.csv", supported=False)
    assert "--hull-no" not in cmd
    assert info["hull_no_written"] is False
    assert "호선 기록을 지원하지 않아" in complete.call_args.args[2]
