"""F06 Parser 서비스 — Nastran F06 파일에서 구조 해석 결과 추출."""
import os
import subprocess
import logging

from .analysis_runner import (
    get_backend_dir,
    mark_complete,
    mark_running,
    record_analysis,
    update_progress,
)

logger = logging.getLogger(__name__)


def task_execute_f06parser(
    job_id: str,
    f06_path: str,
    work_dir: str,
    employee_id: str,
    timestamp: str,
    source: str,
):
    """
    F06Parser.Console.exe를 호출하여 F06 파일에서 구조 해석 결과를 추출합니다.
    출력 파일:
      - {stem}_results.json                   : 전체 결과 (모든 Subcase 포함)
      - {stem}_SC{n}_displacement.csv         : Subcase별 변위
      - {stem}_SC{n}_spc_force.csv            : Subcase별 SPC 반력
      - {stem}_SC{n}_cbar_force.csv           : Subcase별 CBAR 내력
      - {stem}_SC{n}_cbar_stress.csv          : Subcase별 CBAR 응력
      - {stem}_SC{n}_cbeam_force.csv          : Subcase별 CBEAM 내력
      - {stem}_SC{n}_cbeam_stress.csv         : Subcase별 CBEAM 응력
      - {stem}_SC{n}_crod_force.csv           : Subcase별 CROD 내력
      - {stem}_SC{n}_crod_stress.csv          : Subcase별 CROD 응력
    """
    mark_running(job_id, "F06 Parser 초기화 중...", progress=10)

    status_msg = "Success"
    engine_output = ""
    result_data = {}

    exe_dir = os.path.join(get_backend_dir(), "InHouseProgram", "F06Parser")
    exe_path = os.path.join(exe_dir, "F06Parser.Console.exe")

    try:
        if not os.path.exists(exe_path):
            raise FileNotFoundError(f"실행 파일을 찾을 수 없습니다: {exe_path}")

        cmd_args = [exe_path, f06_path, "--output-dir", work_dir]

        update_progress(job_id, 30, "F06 파일 파싱 중...")

        logger.info("[F06Parser] exe   : %s (exists=%s)", exe_path, os.path.exists(exe_path))
        logger.info("[F06Parser] f06   : %s (exists=%s)", f06_path, os.path.exists(f06_path))
        logger.info("[F06Parser] cwd   : %s", work_dir)
        logger.info("[F06Parser] cmd   : %s", " ".join(cmd_args))

        result = subprocess.run(
            cmd_args,
            cwd=work_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=120,
        )
        engine_output = result.stdout.decode("cp949", errors="replace")
        stderr_text = result.stderr.decode("cp949", errors="replace")

        logger.info("[F06Parser] exit  : %d", result.returncode)
        logger.info("[F06Parser] stdout: %s", engine_output[:500] if engine_output.strip() else "(empty)")
        if stderr_text.strip():
            logger.warning("[F06Parser] stderr: %s", stderr_text[:500])

        if stderr_text.strip():
            engine_output += f"\n[stderr] {stderr_text.strip()}"
        if result.returncode != 0:
            status_msg = "Failed"
            engine_output += f"\n[Exit code: {result.returncode}]"

        update_progress(job_id, 70, "결과 파일 수집 중...")

        # 출력 파일 수집
        f06_stem = os.path.splitext(os.path.basename(f06_path))[0]

        # 전체 결과 JSON
        json_filename = f"{f06_stem}_results.json"
        try:
            dir_files = os.listdir(work_dir)
        except Exception:
            dir_files = []

        for f in dir_files:
            if f.lower() == json_filename.lower():
                result_data["json_results"] = os.path.join(work_dir, f)
                break

        if "json_results" not in result_data:
            status_msg = "Failed"
            engine_output += "\n[Error] _results.json이 생성되지 않았습니다."

        # per-subcase CSV 수집 (패턴: {stem}_SC{n}_{type}.csv)
        CSV_SUFFIXES = [
            "displacement", "spc_force",
            "cbar_force", "cbar_stress",
            "cbeam_force", "cbeam_stress",
            "crod_force", "crod_stress",
        ]
        stem_lower = f06_stem.lower()
        for f in dir_files:
            lower_f = f.lower()
            if not lower_f.startswith(stem_lower + "_sc"):
                continue
            remainder = lower_f[len(stem_lower) + 1:]  # "sc{n}_{suffix}.csv"
            parts = remainder.split("_", 1)
            if len(parts) < 2:
                continue
            sc_part = parts[0].upper()  # "SC1"
            suffix_csv = parts[1]       # "{suffix}.csv"
            for suffix in CSV_SUFFIXES:
                if suffix_csv == f"{suffix}.csv":
                    key = f"csv_{sc_part}_{suffix}"
                    result_data[key] = os.path.join(work_dir, f)
                    break

        result_data["f06"] = f06_path

        logger.info("[F06Parser] 수집된 결과 파일: %s", list(result_data.keys()))

    except subprocess.TimeoutExpired:
        status_msg = "Failed"
        engine_output = "F06 파싱 시간이 초과되었습니다 (2분). 파일 크기를 확인하세요."
    except Exception as e:
        status_msg = "Failed"
        logger.error("F06Parser 예기치 않은 오류: %s", str(e), exc_info=True)
        engine_output = f"예기치 않은 오류가 발생했습니다: {str(e)}"

    update_progress(job_id, 90, "데이터베이스 저장 중...")

    project_data, db_err = record_analysis(
        project_name=f"F06Parser_{timestamp}",
        program_name="F06 Parser",
        employee_id=employee_id,
        status=status_msg,
        input_info={"f06_file": f06_path},
        result_info=result_data,
        source=source,
    )
    if db_err is not None:
        status_msg = "Failed"
        engine_output += f"\nDB Error: {db_err}"

    mark_complete(
        job_id, status_msg, engine_output, project_data,
        success_message="파싱 완료",
        failure_message="파싱 실패",
    )
