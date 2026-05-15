"""HP-SCR 배관응력 해석 서비스 — PSA / POR 모드 지원.

워크플로:
  1) FemScanner.exe 를 scan-only 모드로 호출하여 3D 뷰어용 모델 JSON 생성
     (검증 step1.json 등 부산물은 무시하고 모델 JSON 만 사용)
  2) analysis_mode 에 따라
       - PSA → InHouseProgram/HPSCR/PSA_Assessment_CLI.exe <bdf_path>
       - POR → InHouseProgram/HPSCR/POR_Assessment_CLI.exe <bdf_path>
  3) BDF 와 동일 폴더에서 HP-SCR-PSA-REPORT.xlsx 결과 파일 수집

산출 파일 (work_dir 안):
  - <bdfStem>.json              : FemScanner 가 생성한 3D 뷰어용 모델 JSON
  - HP-SCR-PSA-REPORT.xlsx      : PSA/POR 공통 출력 (사용자 다운로드 대상)
"""
from __future__ import annotations

import logging
import os
import subprocess
from datetime import datetime

from .. import database, models
from ..services.job_manager import job_status_store

logger = logging.getLogger(__name__)


_REPORT_FILENAME = "HP-SCR-PSA-REPORT.xlsx"


def _resolve_paths() -> tuple[str, str, str]:
    """FemScanner.exe / PSA_Assessment_CLI.exe / POR_Assessment_CLI.exe 절대경로."""
    base_dir = os.path.dirname(os.path.abspath(__file__))     # app/services
    app_dir = os.path.dirname(base_dir)                        # app
    backend_dir = os.path.dirname(app_dir)                     # HiTessWorkBenchBackEnd
    fem_scanner = os.path.join(backend_dir, "InHouseProgram", "BdfScanner", "FemScanner.exe")
    psa_exe = os.path.join(backend_dir, "InHouseProgram", "HPSCR", "PSA_Assessment_CLI.exe")
    por_exe = os.path.join(backend_dir, "InHouseProgram", "HPSCR", "POR_Assessment_CLI.exe")
    return fem_scanner, psa_exe, por_exe


def task_execute_hpscr(
    job_id: str,
    bdf_path: str,
    work_dir: str,
    employee_id: str,
    timestamp: str,
    source: str,
    analysis_mode: str,
):
    """HP-SCR 배관응력 해석 백그라운드 작업.

    analysis_mode: "PSA" | "POR"
    """
    mode = (analysis_mode or "").upper()
    if mode not in ("PSA", "POR"):
        job_status_store.update_job(job_id, {
            "status": "Failed",
            "progress": 100,
            "message": f"지원하지 않는 해석 모드: {analysis_mode}",
            "engine_log": f"analysis_mode must be 'PSA' or 'POR' (got: {analysis_mode!r})",
            "project": None,
        })
        return

    program_name = f"HP-SCR {mode}"

    job_status_store.update_job(job_id, {
        "status": "Running",
        "progress": 5,
        "message": f"HP-SCR {mode} 초기화 중...",
    })

    db = database.SessionLocal()
    status_msg = "Success"
    engine_output = ""
    result_data: dict = {}
    project_data = None

    fem_scanner, psa_exe, por_exe = _resolve_paths()
    target_exe = psa_exe if mode == "PSA" else por_exe

    bdf_dir = os.path.dirname(os.path.abspath(bdf_path))
    bdf_filename = os.path.basename(bdf_path)
    bdf_stem = os.path.splitext(bdf_filename)[0]

    try:
        if not os.path.exists(target_exe):
            raise FileNotFoundError(f"실행 파일을 찾을 수 없습니다: {target_exe}")

        # ── Step 1: FemScanner 로 3D 뷰어용 모델 JSON 생성 ──
        if os.path.exists(fem_scanner):
            job_status_store.update_job(job_id, {
                "progress": 20,
                "message": "BDF 모델 파싱 중 (3D 뷰어용)...",
            })
            try:
                fs_result = subprocess.run(
                    [fem_scanner, bdf_filename],
                    cwd=bdf_dir,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=180,
                )
                fs_stdout = fs_result.stdout.decode("utf-8", errors="replace")
                fs_stderr = fs_result.stderr.decode("utf-8", errors="replace")
                if fs_result.returncode != 0:
                    logger.warning("[HP-SCR] FemScanner exit=%d stderr=%s",
                                   fs_result.returncode, fs_stderr[:300])
                # 모델 JSON 경로만 수집 (검증 결과 파일은 무시)
                model_json = os.path.join(bdf_dir, f"{bdf_stem}.json")
                if os.path.exists(model_json):
                    result_data["JSON_ModelInfo"] = model_json
                else:
                    engine_output += "[Warning] 모델 JSON 파일이 생성되지 않았습니다.\n"
                if fs_stdout.strip():
                    engine_output += f"[FemScanner] {fs_stdout.strip()}\n"
            except subprocess.TimeoutExpired:
                engine_output += "[Warning] FemScanner 모델 파싱 시간 초과 (3분). 뷰어를 사용할 수 없습니다.\n"
            except Exception as fs_e:
                logger.warning("[HP-SCR] FemScanner 호출 실패: %s", fs_e)
                engine_output += f"[Warning] FemScanner 호출 실패: {fs_e}\n"
        else:
            engine_output += f"[Warning] FemScanner.exe 미존재({fem_scanner}). 3D 뷰어를 사용할 수 없습니다.\n"

        # ── Step 2: PSA / POR 해석 실행 ──
        job_status_store.update_job(job_id, {
            "progress": 50,
            "message": f"HP-SCR {mode} 해석 실행 중...",
        })

        logger.info("[HP-SCR] exe=%s bdf=%s", target_exe, bdf_path)
        # POR_Assessment_CLI.exe 는 상대 파일명을 cwd 가 아닌 EXE 디렉터리 기준으로 해석한다.
        # PSA/POR 모두 일관되게 절대경로로 전달해야 BDF 를 정확히 찾을 수 있다.
        result = subprocess.run(
            [target_exe, bdf_path],
            cwd=bdf_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=600,
        )
        stdout_text = result.stdout.decode("utf-8", errors="replace")
        stderr_text = result.stderr.decode("utf-8", errors="replace")

        logger.info("[HP-SCR] exit=%d", result.returncode)
        if stdout_text.strip():
            engine_output += f"[Solver] {stdout_text.strip()}\n"
        if stderr_text.strip():
            engine_output += f"[stderr] {stderr_text.strip()}\n"
        if result.returncode != 0:
            engine_output += f"[Exit code: {result.returncode}]\n"

        # ── Step 3: 결과 XLSX 수집 ──
        job_status_store.update_job(job_id, {
            "progress": 85,
            "message": "결과 파일 수집 중...",
        })

        # BDF 와 동일 폴더에서 HP-SCR-PSA-REPORT.xlsx 탐색 (대소문자 무시)
        report_path = None
        try:
            for f in os.listdir(bdf_dir):
                if f.lower() == _REPORT_FILENAME.lower():
                    report_path = os.path.join(bdf_dir, f)
                    break
        except Exception:
            pass

        if report_path and os.path.exists(report_path):
            result_data["XLSX_Report"] = report_path
        else:
            status_msg = "Failed"
            engine_output += f"[Error] 결과 파일({_REPORT_FILENAME})이 생성되지 않았습니다.\n"

        result_data["bdf"] = bdf_path
        result_data["analysis_mode"] = mode

    except subprocess.TimeoutExpired:
        status_msg = "Failed"
        engine_output += f"HP-SCR {mode} 해석 시간이 초과되었습니다 (10분).\n"
    except Exception as e:
        status_msg = "Failed"
        logger.error("HP-SCR 예기치 않은 오류: %s", str(e), exc_info=True)
        engine_output += f"예기치 않은 오류가 발생했습니다: {str(e)}\n"

    job_status_store.update_job(job_id, {"progress": 95, "message": "데이터베이스 저장 중..."})

    try:
        new_analysis = models.Analysis(
            project_name=f"HpScr{mode}_{timestamp}",
            program_name=program_name,
            employee_id=employee_id,
            status=status_msg,
            input_info={"bdf_model": bdf_path, "analysis_mode": mode},
            result_info=result_data if result_data else None,
            source=source,
        )
        db.add(new_analysis)
        db.commit()
        db.refresh(new_analysis)

        project_data = {
            "id": new_analysis.id,
            "project_name": new_analysis.project_name,
            "program_name": new_analysis.program_name,
            "employee_id": new_analysis.employee_id,
            "status": new_analysis.status,
            "input_info": new_analysis.input_info,
            "result_info": new_analysis.result_info,
            "created_at": new_analysis.created_at.isoformat() if new_analysis.created_at else datetime.now().isoformat(),
        }
    except Exception as db_e:
        status_msg = "Failed"
        engine_output += f"\nDB Error: {str(db_e)}"
    finally:
        db.close()

    job_status_store.update_job(job_id, {
        "status": status_msg,
        "progress": 100,
        "message": f"HP-SCR {mode} 해석 완료" if status_msg == "Success" else f"HP-SCR {mode} 해석 실패",
        "engine_log": engine_output,
        "project": project_data,
    })
