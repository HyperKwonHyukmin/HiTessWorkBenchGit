"""Mooring Fitting Assessment 서비스 — CSV 2종 → MooringFitting.exe build-full 실행 + 산출물 수집."""
import logging
import os
import subprocess

from .analysis_runner import (
    get_backend_dir,
    mark_complete,
    mark_running,
    record_analysis,
    update_progress,
)

logger = logging.getLogger(__name__)

PROGRAM_NAME = "MooringFitting"
TIMEOUT_SECONDS = 600


def collect_artifacts(out_dir: str, work_dir: str) -> dict:
    """
    MooringFitting.exe 가 생성한 out/ 폴더 산출물을 분류·수집한다.

    핵심 5개(페이지 기본 노출):
        final_bdf, validation_json, lineage_json, report_mf_csv, report_winch_csv
    보조(Phase 2 뷰어용 펼치기 영역):
        stage_jsons, stage_bdfs, stage_verifications, raw_json, initial_json

        stage_jsons 는 STAGE_NN_<phase>.json 만 수집한다 — STAGE_NN.raw.json,
        STAGE_NN.initial.json, *.validation.json, *.bdf.verification.json 은
        별도 키로 분리되므로 제외한다.

    out/ 폴더 자체가 없으면 {_artifacts_missing: True, out_dir} 만 반환.
    """
    if not os.path.isdir(out_dir):
        return {
            "case_dir": work_dir,
            "out_dir": out_dir,
            "_artifacts_missing": True,
        }

    files = os.listdir(out_dir)
    file_set = set(files)

    def _pick(name: str) -> str | None:
        return os.path.join(out_dir, name) if name in file_set else None

    stage_jsons = sorted(
        os.path.join(out_dir, f) for f in files
        if f.startswith("STAGE_") and f.endswith(".json")
        and ".verification." not in f
        and not f.endswith(".raw.json")
        and not f.endswith(".initial.json")
        and not f.endswith(".validation.json")
    )
    stage_bdfs = sorted(
        os.path.join(out_dir, f) for f in files
        if f.startswith("STAGE_") and f.endswith(".bdf")
    )
    stage_verifications = sorted(
        os.path.join(out_dir, f) for f in files
        if f.endswith(".bdf.verification.json")
    )

    return {
        "case_dir": work_dir,
        "out_dir": out_dir,
        "final_bdf":         _pick("STAGE_07_FinalValidation.bdf"),
        "validation_json":   _pick("STAGE_07_FinalValidation.validation.json"),
        "lineage_json":      _pick("LINEAGE.json"),
        "report_mf_csv":     _pick("Report_LoadCalculation_MF.csv"),
        "report_winch_csv":  _pick("Report_LoadCalculation_Winch.csv"),
        "stage_jsons":          stage_jsons,
        "stage_bdfs":           stage_bdfs,
        "stage_verifications":  stage_verifications,
        "raw_json":             _pick("STAGE_00.raw.json"),
        "initial_json":         _pick("STAGE_00.initial.json"),
    }


def task_execute_mooring_fitting(
    job_id: str,
    structure_path: str,
    load_path: str,
    work_dir: str,
    exe_path: str,
    employee_id: str,
    timestamp: str,
    source: str,
):
    """
    MooringFitting.exe build-full <work_dir> 를 호출한다.

    동작:
      - work_dir 안에 MooringFittingData.csv / MooringFittingDataLoad.csv 가 표준명으로 이미 저장되어 있다고 가정 (라우터 책임).
      - exe 는 cwd=work_dir 로 실행되며 out/ 폴더에 산출물을 생성한다.
      - exit code 0 = Success, 그 외 = Failed (stdout/stderr 통합해 engine_output 에 노출).
      - record_analysis 로 DB 기록 + mark_complete 로 job_status_store 마감.
    """
    mark_running(job_id, "MooringFitting 초기화 중...", progress=10)

    status_msg = "Success"
    engine_output = ""
    result_data = {}

    try:
        if not os.path.exists(exe_path):
            raise FileNotFoundError(f"실행 파일을 찾을 수 없습니다: {exe_path}")

        update_progress(job_id, 30, "BDF 파이프라인 실행 중...")
        logger.info("[MooringFitting] exe=%s, work_dir=%s", exe_path, work_dir)

        result = subprocess.run(
            [exe_path, "build-full", work_dir],
            cwd=work_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=TIMEOUT_SECONDS,
        )
        engine_output = result.stdout.decode("utf-8", errors="replace")
        stderr_text = result.stderr.decode("utf-8", errors="replace")
        if stderr_text.strip():
            engine_output += f"\n[stderr] {stderr_text.strip()}"
        if result.returncode != 0:
            status_msg = "Failed"
            engine_output += f"\n[Exit code: {result.returncode}]"

        update_progress(job_id, 80, "결과 파일 수집 중...")
        out_dir = os.path.join(work_dir, "out")
        result_data = collect_artifacts(out_dir, work_dir)
        if result_data.get("_artifacts_missing"):
            status_msg = "Failed"
            engine_output += "\n[Error] out/ 폴더가 생성되지 않았습니다. exe 실행 로그를 확인하세요."

    except subprocess.TimeoutExpired:
        status_msg = "Failed"
        engine_output = f"MooringFitting 실행 시간이 초과되었습니다 ({TIMEOUT_SECONDS // 60}분)."
    except FileNotFoundError as e:
        status_msg = "Failed"
        engine_output = str(e)
    except Exception as e:
        status_msg = "Failed"
        logger.error("MooringFitting unexpected error: %s", str(e), exc_info=True)
        engine_output = f"예기치 않은 오류가 발생했습니다: {str(e)}"

    update_progress(job_id, 95, "데이터베이스 저장 중...")
    project_data, db_err = record_analysis(
        project_name=f"{PROGRAM_NAME}_{timestamp}",
        program_name=PROGRAM_NAME,
        employee_id=employee_id,
        status=status_msg,
        input_info={"structure_csv": structure_path, "load_csv": load_path},
        result_info=result_data if result_data else None,
        source=source,
    )
    if db_err is not None:
        status_msg = "Failed"
        engine_output += f"\nDB Error: {db_err}"

    mark_complete(
        job_id, status_msg, engine_output, project_data,
        success_message="MooringFitting 해석 완료",
        failure_message="MooringFitting 해석 실패",
    )
