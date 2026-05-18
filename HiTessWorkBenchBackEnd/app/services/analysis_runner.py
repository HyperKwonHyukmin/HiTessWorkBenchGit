"""
해석 백그라운드 작업의 공통 실행 패턴을 모은 헬퍼 모듈.

이 모듈의 목표는 task_execute_* 함수들에 공통으로 등장하는
- 작업 상태 스토어 갱신
- 서브프로세스 실행 + 표준 예외 처리
- Analysis DB 레코드 기록
- 완료 처리
를 단일 지점으로 모아 중복을 줄이는 것입니다.

원칙:
- 기존 task_execute_* 함수의 외부 시그니처/동작은 절대 변경하지 않습니다.
- 이 모듈은 신규 파일이며, 본 파일을 import하지 않는 한 기존 코드에는 영향이 없습니다.
- 예외 메시지/로그 포맷은 기존 서비스 파일과 동일하게 유지합니다.
"""
import logging
import os
import subprocess
from datetime import datetime
from typing import Optional

from .. import database, models
from .job_manager import job_status_store

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = 600


def get_backend_dir() -> str:
    """app/services/*.py 위치 기준으로 HiTessWorkBenchBackEnd 루트를 반환합니다."""
    base_dir = os.path.dirname(os.path.abspath(__file__))  # app/services
    app_dir = os.path.dirname(base_dir)                    # app
    return os.path.dirname(app_dir)                        # HiTessWorkBenchBackEnd


def mark_running(
    job_id: str,
    message: str = "Initiating Solver...",
    progress: int = 10,
) -> None:
    """작업을 Running 상태로 진입시키고 초기 메시지를 기록합니다."""
    job_status_store.update_job(job_id, {
        "status": "Running",
        "progress": progress,
        "message": message,
    })


def update_progress(job_id: str, progress: int, message: str, **extra) -> None:
    """진행률·메시지를 갱신합니다. 추가 필드가 필요하면 키워드 인자로 전달하세요."""
    payload = {"progress": progress, "message": message}
    if extra:
        payload.update(extra)
    job_status_store.update_job(job_id, payload)


def run_engine(
    cmd_args: list,
    work_dir: str,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
    engine_label: str = "Analysis engine",
) -> tuple[str, str]:
    """
    해석 실행 파일을 호출하고 (status, output) 튜플을 반환합니다.

    - status: "Success" | "Failed"
    - output: 성공 시 stdout, 실패 시 사용자에게 노출되는 한국어 에러 메시지

    예외별 처리/메시지는 기존 task_execute_* 함수들과 동일합니다.
    """
    try:
        result = subprocess.run(
            cmd_args,
            cwd=work_dir,
            capture_output=True,
            text=True,
            check=True,
            timeout=timeout,
        )
        return "Success", result.stdout or ""
    except subprocess.TimeoutExpired:
        logger.error("%s subprocess timed out after %ds", engine_label, timeout)
        return "Failed", f"해석 엔진이 제한 시간({timeout}초)을 초과했습니다. 관리자에게 문의하세요."
    except subprocess.CalledProcessError as e:
        logger.error("%s subprocess failed: %s", engine_label, e.stderr or e.stdout)
        return "Failed", "해석 엔진 실행 중 오류가 발생했습니다. 관리자에게 문의하세요."
    except Exception as e:
        logger.error("%s unexpected error: %s", engine_label, str(e), exc_info=True)
        return "Failed", "예기치 않은 오류가 발생했습니다. 관리자에게 문의하세요."


def record_analysis(
    *,
    project_name: str,
    program_name: str,
    employee_id: str,
    status: str,
    input_info: dict,
    result_info: Optional[dict],
    source: str,
) -> tuple[Optional[dict], Optional[str]]:
    """
    Analysis 레코드를 생성·커밋하고 (project_data, db_error_message)를 반환합니다.

    - 성공: (project_data dict, None)
    - 실패: (None, "DB Error: ...") — 호출부는 engine_log 등에 합쳐 사용자에게 노출합니다.

    status가 "Success"가 아닐 경우 result_info는 None으로 기록됩니다(기존 서비스 동작과 동일).
    """
    db = database.SessionLocal()
    try:
        new_analysis = models.Analysis(
            project_name=project_name,
            program_name=program_name,
            employee_id=employee_id,
            status=status,
            input_info=input_info,
            result_info=result_info if status == "Success" else None,
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
            "created_at": new_analysis.created_at.isoformat()
                          if new_analysis.created_at else datetime.now().isoformat(),
        }
        return project_data, None
    except Exception as db_e:
        return None, f"DB Error: {str(db_e)}"
    finally:
        db.close()


def mark_complete(
    job_id: str,
    status: str,
    engine_log: str,
    project_data: Optional[dict],
    extra: Optional[dict] = None,
) -> None:
    """
    작업을 최종 상태로 마감합니다.

    - status: "Success" | "Failed"
    - engine_log: 사용자에게 노출될 엔진 출력 또는 에러 메시지
    - project_data: record_analysis가 반환한 dict (또는 None)
    - extra: 페이로드에 추가로 합칠 키-값 (예: result_path)
    """
    payload = {
        "status": status,
        "progress": 100,
        "message": "Analysis Completed Successfully" if status == "Success" else "Analysis Failed",
        "engine_log": engine_log,
        "project": project_data,
    }
    if extra:
        payload.update(extra)
    job_status_store.update_job(job_id, payload)
