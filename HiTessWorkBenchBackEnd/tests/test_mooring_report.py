"""build_report()/build_report_plan() — MooringFitting.exe report verb 호출 규약."""
import os

import pytest

from app.services import mooring_fitting_service as svc


@pytest.fixture()
def case(tmp_path):
    """case_dir/out 구조 + 가짜 exe."""
    case_dir = tmp_path / "case"
    (case_dir / "out").mkdir(parents=True)
    exe = tmp_path / "MooringFitting.exe"
    exe.write_text("", encoding="utf-8")
    return str(case_dir), str(exe)


def _capture(monkeypatch, *, rc=0, stdout=b"[report] ok (33 pages)", make=None):
    """_run_capture 를 가로채 실제 exe 실행 없이 인자만 관찰한다."""
    seen = {}

    def fake(cmd, cwd, timeout):
        seen["cmd"] = cmd
        seen["cwd"] = cwd
        seen["timeout"] = timeout
        if make:
            make()
        return rc, stdout, b""

    monkeypatch.setattr(svc, "_run_capture", fake)
    return seen


def test_build_report_composes_command(case, monkeypatch):
    """case_dir 를 첫 인자로, 표제 옵션을 --키=값 으로 넘긴다."""
    case_dir, exe = case
    out_xlsx = os.path.join(case_dir, "out", svc.REPORT_FILE_NAME)
    seen = _capture(monkeypatch, make=lambda: open(out_xlsx, "wb").write(b"PK\x03\x04"))

    res = svc.build_report(
        case_dir, exe,
        hull_no="1234", dwg_no="D-001", report_date="2026-09-03",
        title="T", fitting="MF-F08(P)", top=15, yield_strength=355.0,
    )

    cmd = seen["cmd"]
    assert cmd[0] == exe and cmd[1] == "report" and cmd[2] == case_dir
    assert "--top=15" in cmd and "--yield=355.0" in cmd
    assert "--hull=1234" in cmd and "--dwg=D-001" in cmd
    assert "--date=2026-09-03" in cmd and "--title=T" in cmd
    assert "--fitting=MF-F08(P)" in cmd
    assert seen["cwd"] == case_dir
    assert res["xlsx_path"] == out_xlsx
    assert res["pages"] == 33


def test_build_report_omits_blank_options(case, monkeypatch):
    """빈 표제 값은 인자로 넘기지 않는다(엔진 기본값이 살아야 함)."""
    case_dir, exe = case
    out_xlsx = os.path.join(case_dir, "out", svc.REPORT_FILE_NAME)
    seen = _capture(monkeypatch, make=lambda: open(out_xlsx, "wb").write(b"PK"))

    svc.build_report(case_dir, exe, hull_no="", dwg_no="   ", report_date="")

    joined = " ".join(seen["cmd"])
    assert "--hull=" not in joined
    assert "--dwg=" not in joined
    assert "--date=" not in joined


def test_build_report_passes_figures_dir(case, monkeypatch, tmp_path):
    """Studio 캡쳐 폴더가 있으면 --figures 로 넘겨 엔진 렌더보다 우선하게 한다."""
    case_dir, exe = case
    figures = tmp_path / "figs"
    figures.mkdir()
    out_xlsx = os.path.join(case_dir, "out", svc.REPORT_FILE_NAME)
    seen = _capture(monkeypatch, make=lambda: open(out_xlsx, "wb").write(b"PK"))

    svc.build_report(case_dir, exe, figures_dir=str(figures))

    assert f"--figures={figures}" in seen["cmd"]


def test_build_report_raises_when_engine_fails(case, monkeypatch):
    """exit code 가 0 이 아니면 엔진 로그를 담아 예외."""
    case_dir, exe = case
    _capture(monkeypatch, rc=1, stdout=b"[report] boom")

    with pytest.raises(RuntimeError) as ex:
        svc.build_report(case_dir, exe)
    assert "boom" in str(ex.value)


def test_build_report_raises_when_file_missing(case, monkeypatch):
    """exit 0 이어도 xlsx 가 없으면 성공으로 보지 않는다."""
    case_dir, exe = case
    _capture(monkeypatch, rc=0)

    with pytest.raises(RuntimeError) as ex:
        svc.build_report(case_dir, exe)
    assert "생성되지 않" in str(ex.value)


def test_build_report_missing_exe(case):
    case_dir, _ = case
    with pytest.raises(FileNotFoundError):
        svc.build_report(case_dir, os.path.join(case_dir, "nope.exe"))


def test_build_report_plan_composes_command(case, monkeypatch):
    """report-plan 은 REPORT_PLAN.json 을 만들고 그 경로를 돌려준다."""
    case_dir, exe = case
    plan = os.path.join(case_dir, "out", svc.REPORT_PLAN_FILE_NAME)
    seen = _capture(monkeypatch, stdout=b"[report-plan] ok",
                    make=lambda: open(plan, "w").write("{}"))

    res = svc.build_report_plan(case_dir, exe, top=30, yield_strength=315.0)

    assert seen["cmd"][1] == "report-plan"
    assert "--top=30" in seen["cmd"]
    assert res["plan_path"] == plan


def test_build_report_passes_gamma(case, monkeypatch):
    """γM 은 화면 판정 허용응력(σy/γM)을 보고서에도 강제하는 값이라 반드시 전달돼야 한다."""
    case_dir, exe = case
    out_xlsx = os.path.join(case_dir, "out", svc.REPORT_FILE_NAME)
    seen = _capture(monkeypatch, make=lambda: open(out_xlsx, "wb").write(b"PK\x03\x04"))

    svc.build_report(case_dir, exe, yield_strength=355.0, gamma_m=1.15)

    assert "--gamma=1.15" in seen["cmd"]


def test_build_report_defaults_gamma_to_one(case, monkeypatch):
    """γM 을 지정하지 않으면 1.0 — 종전 보고서와 같은 허용응력이어야 한다."""
    case_dir, exe = case
    out_xlsx = os.path.join(case_dir, "out", svc.REPORT_FILE_NAME)
    seen = _capture(monkeypatch, make=lambda: open(out_xlsx, "wb").write(b"PK\x03\x04"))

    svc.build_report(case_dir, exe)

    assert "--gamma=1.0" in seen["cmd"]
