"""task_execute_assessment 의 실패 경로가 Execution Console 에 원인을 남기는지 검증.

이전 동작: 어떤 실패든 engine_log 가 "해석 엔진 실행 중 오류가 발생했습니다.
관리자에게 문의하세요." 한 줄이라 사용자가 원인을 알 수 없었다.
"""
import pytest

from app.services import assessment_service


PUNCH_ONLY_BDF = """\
SOL 101
CEND
  DISPLACEMENT(PUNCH) = ALL
  ELFORCE(PRINT,PUNCH) = ALL
  SPCFORCES(PUNCH) = ALL
SUBCASE       1
  SPC =        1
BEGIN BULK
GRID           1         44103.0 12920.0   770.0
ENDDATA
"""

HEALTHY_BDF = PUNCH_ONLY_BDF.replace("SPCFORCES(PUNCH)", "SPCFORCES(PRINT,PUNCH)")

REAL_ENGINE_CRASH = """\
[2026-07-30 14:35:47.757] [INFO ] BDF 파싱 완료 - GRID: 11472, CBAR: 15298
No SPC Force data found.
[2026-07-30 14:35:48.253] [INFO ] 하중분산판 검토 수행 중...
Unhandled exception. System.Collections.Generic.KeyNotFoundException: The given key 'SPCForce' was not present in the dictionary.
   at TrussAssessment.Control.LoadDistributionChecker.Run()
"""


@pytest.fixture()
def captured(monkeypatch, tmp_path):
    """엔진/DB/작업스토어를 막고 mark_complete 로 넘어온 값을 잡아둔다."""
    sink: dict = {}

    monkeypatch.setattr(assessment_service, "mark_running", lambda *a, **k: None)
    monkeypatch.setattr(assessment_service, "update_progress", lambda *a, **k: None)
    monkeypatch.setattr(
        assessment_service, "record_analysis",
        lambda **kwargs: (
            sink.update(result_info=kwargs["result_info"]),
            ({"id": 1, "status": kwargs["status"]}, None),
        )[1],
    )
    monkeypatch.setattr(
        assessment_service, "mark_complete",
        lambda job_id, status, engine_log, project_data, *a, **k:
            sink.update(status=status, log=engine_log),
    )
    # exe 존재 검사 통과
    monkeypatch.setattr(assessment_service.os.path, "exists", lambda p: True)
    return sink


def _run(work_dir, bdf_text) -> None:
    bdf = work_dir / "model.bdf"
    bdf.write_text(bdf_text, encoding="utf-8")
    assessment_service.task_execute_assessment(
        "job-1", str(bdf), str(work_dir), "12345", "20260730_143500", "Workbench",
    )


class TestPreflightBlocking:
    def test_punch_only_bdf_fails_before_running_engine(self, captured, tmp_path, monkeypatch):
        called = []
        monkeypatch.setattr(
            assessment_service, "run_engine",
            lambda *a, **k: called.append(a) or ("Success", ""),
        )
        _run(tmp_path, PUNCH_ONLY_BDF)

        assert captured["status"] == "Failed"
        assert called == [], "사전 검증에서 걸렸으면 Nastran 을 돌리지 않아야 한다"

    def test_console_text_names_the_offending_command_and_fix(self, captured, tmp_path, monkeypatch):
        monkeypatch.setattr(assessment_service, "run_engine", lambda *a, **k: ("Success", ""))
        _run(tmp_path, PUNCH_ONLY_BDF)

        log = captured["log"]
        assert "SPCFORCES(PUNCH) = ALL" in log      # 현재 상태
        assert "SPCFORCES(PRINT,PUNCH) = ALL" in log  # 고쳐야 할 형태
        assert "해석을 시작하지 않았습니다" in log

    def test_healthy_bdf_proceeds_to_engine(self, captured, tmp_path, monkeypatch):
        called = []
        monkeypatch.setattr(
            assessment_service, "run_engine",
            lambda *a, **k: (called.append(a), ("Success", "ok"))[1],
        )
        _run(tmp_path, HEALTHY_BDF)
        assert called, "Case Control 이 정상이면 엔진을 실행해야 한다"


class TestEngineCrashSurfacing:
    def test_engine_stdout_reaches_console_with_diagnosis(self, captured, tmp_path, monkeypatch):
        monkeypatch.setattr(
            assessment_service, "run_engine",
            lambda *a, **k: ("Failed", REAL_ENGINE_CRASH),
        )
        _run(tmp_path, HEALTHY_BDF)

        log = captured["log"]
        assert captured["status"] == "Failed"
        assert "[원인]" in log
        assert "SPC 반력" in log
        assert "SPCFORCES(PRINT,PUNCH)" in log
        # 원문도 함께 보여 개발자가 추적할 수 있어야 한다
        assert "KeyNotFoundException" in log

    def test_generic_message_no_longer_hides_cause(self, captured, tmp_path, monkeypatch):
        monkeypatch.setattr(
            assessment_service, "run_engine",
            lambda *a, **k: ("Failed", REAL_ENGINE_CRASH),
        )
        _run(tmp_path, HEALTHY_BDF)
        assert "관리자에게 문의하세요." != captured["log"].strip()

    def test_server_work_dir_is_redacted(self, captured, tmp_path, monkeypatch):
        work_dir = str(tmp_path)
        monkeypatch.setattr(
            assessment_service, "run_engine",
            lambda *a, **k: ("Failed", f"열기 실패: {work_dir}\\model.f06"),
        )
        _run(tmp_path, HEALTHY_BDF)
        assert work_dir not in captured["log"]


class TestSilentSuccessIsNowFailure:
    def test_zero_json_output_is_reported_as_failure(self, captured, tmp_path, monkeypatch):
        """엔진이 exit 0 이어도 결과 JSON 이 없으면 '해석 완료'로 넘기면 안 된다."""
        monkeypatch.setattr(
            assessment_service, "run_engine",
            lambda *a, **k: ("Success", "[ERROR] .f06 파일을 찾을 수 없습니다. Nastran 실행이 실패했을 수 있습니다."),
        )
        _run(tmp_path, HEALTHY_BDF)

        assert captured["status"] == "Failed"
        assert "Nastran" in captured["log"]
        assert "[조치]" in captured["log"]

    def test_f06_stays_downloadable_after_failure(self, captured, tmp_path, monkeypatch):
        """Failed 로 바뀌어도 원인 추적에 필요한 F06 은 이력에 남아야 한다."""
        (tmp_path / "model.f06").write_text("*** USER FATAL MESSAGE 5423", encoding="utf-8")
        monkeypatch.setattr(
            assessment_service, "run_engine",
            lambda *a, **k: ("Success", "[FATAL] F06 FATAL 발견 (Line 1): *** USER FATAL MESSAGE 5423"),
        )
        _run(tmp_path, HEALTHY_BDF)

        assert captured["status"] == "Failed"
        assert "F06_model" in captured["result_info"]

    def test_preflight_failure_stores_no_result_info(self, captured, tmp_path, monkeypatch):
        monkeypatch.setattr(assessment_service, "run_engine", lambda *a, **k: ("Success", ""))
        _run(tmp_path, PUNCH_ONLY_BDF)
        assert captured["result_info"] is None
