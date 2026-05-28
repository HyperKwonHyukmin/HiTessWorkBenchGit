"""DrawingToAnalysis 서비스 — 설계 PDF를 Nastran BDF로 변환."""
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


def task_execute_drawing_to_analysis(
    job_id: str,
    pdf_path: str,
    work_dir: str,
    exe_path: str,
    employee_id: str,
    timestamp: str,
    source: str,
    mesh_size: float = 10.0,
):
    """DrawingToAnalysis.exe를 호출하여 업로드 PDF와 같은 폴더에 BDF를 생성한다."""
    mark_running(job_id, "DrawingToAnalysis 초기화 중...", progress=10)

    status_msg = "Success"
    engine_output = ""
    result_data = {}

    try:
        exe_path = exe_path or os.path.join(
            get_backend_dir(), "InHouseProgram", "DrawingToAnalysis", "DrawingToAnalysis.exe"
        )
        if not os.path.isfile(exe_path):
            raise FileNotFoundError(f"실행 파일을 찾을 수 없습니다: {exe_path}")
        if not os.path.isfile(pdf_path):
            raise FileNotFoundError(f"PDF 파일을 찾을 수 없습니다: {pdf_path}")

        engine_pdf_path = os.path.join(work_dir, "input_pdf_for_engine.bin")
        with open(pdf_path, "rb") as src, open(engine_pdf_path, "wb") as dst:
            dst.write(src.read())

        update_progress(job_id, 35, "PDF 벡터 추출 및 LUG 파라미터 추정 중...")

        cmd_args = [
            exe_path,
            "all",
            "--pdf",
            engine_pdf_path,
            "--out-dir",
            work_dir,
            "--mesh-size",
            str(mesh_size),
        ]

        logger.info("[DrawingToAnalysis] exe: %s", exe_path)
        logger.info("[DrawingToAnalysis] pdf: %s", pdf_path)
        logger.info("[DrawingToAnalysis] engine_pdf: %s", engine_pdf_path)
        logger.info("[DrawingToAnalysis] cmd: %s", " ".join(cmd_args))

        result = subprocess.run(
            cmd_args,
            cwd=work_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=600,
        )
        stdout_text = result.stdout.decode("utf-8", errors="replace")
        stderr_text = result.stderr.decode("utf-8", errors="replace")
        engine_output = stdout_text
        if stderr_text.strip():
            engine_output += f"\n[stderr] {stderr_text.strip()}"
        if result.returncode != 0:
            status_msg = "Failed"
            engine_output += f"\n[Exit code: {result.returncode}]"

        update_progress(job_id, 85, "변환 결과 파일 수집 중...")

        expected_files = {
            "lug_model.bdf": "bdf",
            "mesh_preview.png": "preview_png",
            "lug_params.json": "params_json",
            "mesh.json": "mesh_json",
            "vectors.json": "vectors_json",
        }
        for filename, key in expected_files.items():
            path = os.path.join(work_dir, filename)
            if os.path.isfile(path):
                result_data[key] = path

        if "bdf" not in result_data:
            bdf_candidates = [
                os.path.join(work_dir, name)
                for name in os.listdir(work_dir)
                if name.lower().endswith((".bdf", ".dat"))
            ]
            if bdf_candidates:
                result_data["bdf"] = bdf_candidates[0]
            else:
                status_msg = "Failed"
                engine_output += "\n[Error] BDF 결과 파일이 생성되지 않았습니다."

    except subprocess.TimeoutExpired:
        status_msg = "Failed"
        engine_output = "DrawingToAnalysis 실행 시간이 초과되었습니다 (10분). PDF 또는 메시 크기를 확인하세요."
    except Exception as e:
        status_msg = "Failed"
        logger.error("DrawingToAnalysis 예기치 않은 오류: %s", str(e), exc_info=True)
        engine_output = f"예기치 않은 오류가 발생했습니다: {str(e)}"

    update_progress(job_id, 95, "데이터베이스 저장 중...")

    project_data, db_err = record_analysis(
        project_name=f"DrawingToAnalysis_{timestamp}",
        program_name="DrawingToAnalysis",
        employee_id=employee_id,
        status=status_msg,
        input_info={"pdf": pdf_path, "mesh_size": mesh_size},
        result_info=result_data if result_data else None,
        source=source,
    )
    if db_err is not None:
        status_msg = "Failed"
        engine_output += f"\nDB Error: {db_err}"

    mark_complete(
        job_id,
        status_msg,
        engine_output,
        project_data,
        success_message="PDF → BDF 변환 완료",
        failure_message="PDF → BDF 변환 실패",
    )
