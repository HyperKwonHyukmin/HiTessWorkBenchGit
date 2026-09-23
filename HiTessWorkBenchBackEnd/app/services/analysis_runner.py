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
import sys
from datetime import datetime
from typing import Optional

from .. import database, models
# CANCELLED_MESSAGE / JobCancelledError 는 여기서 재노출한다 — 각 해석 서비스가 취소 사전 체크를
# 걸 때 analysis_runner 한 곳에서만 import 하면 되도록 하기 위한 의도적 re-export 다.
from .job_manager import (  # noqa: F401  (re-export)
    CANCELLED_MESSAGE,
    JobCancelledError,
    current_job_id,
    job_status_store,
)

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = 600


# ── 작업 취소 훅 ─────────────────────────────────────────────────────────
# 아래 3개는 공용 취소 API(job_status_store.cancel)가 실행 중인 Popen 을 찾아 종료할 수
# 있도록 참조를 매달고 떼는 얇은 래퍼다. 훅의 실패가 해석 성공률에 영향을 주면 안 되므로
# 모든 예외를 삼키고 로그만 남긴다(기존 실행 경로·반환 계약은 무변경).

def _resolve_cancel_job_id(job_id: Optional[str]) -> Optional[str]:
    """등록·사전 체크에 쓸 job_id. 명시값이 없으면 worker 컨텍스트에서 찾는다."""
    if job_id:
        return job_id
    try:
        return current_job_id()
    except Exception:  # noqa: BLE001
        return None


def _register_job_process(job_id: Optional[str], popen) -> None:
    """job 에 Popen 참조를 매단다. job_id 가 없으면(레거시 호출) 아무것도 하지 않는다."""
    if not job_id:
        return
    try:
        job_status_store.register_process(job_id, popen)
    except Exception:  # noqa: BLE001
        logger.debug("job_status_store 프로세스 등록 실패 job=%s", job_id, exc_info=True)


def _unregister_job_process(job_id: Optional[str], popen) -> None:
    """끝난 Popen 참조를 해제한다(죽은 객체 재종료 방지 + 참조 누수 방지)."""
    if not job_id:
        return
    try:
        job_status_store.unregister_process(job_id, popen)
    except Exception:  # noqa: BLE001
        logger.debug("job_status_store 프로세스 해제 실패 job=%s", job_id, exc_info=True)


def is_cancel_requested(job_id: Optional[str] = None) -> bool:
    """이 작업에 취소가 요청됐는지.

    `subprocess.run()` 기반(블로킹이라 중도 중단 불가) 서비스가 해석기를 띄우기 **직전**에
    부르는 사전 체크다. 실행 중 프로세스를 회수하는 Popen 경로(run_subprocess_killtree 등)와
    달리, 여기서는 "아직 안 띄운 단계를 시작하지 않는다" 만 보장한다.

    안전 규약:
      - job_id 가 없고 worker 컨텍스트도 없으면 **항상 False** — 레거시·내부 단계 호출이
        취소로 오인돼 차단되는 일이 없어야 한다.
      - 스토어 조회가 실패해도 False — 훅 때문에 해석 성공률이 떨어지면 안 된다.
    """
    effective_job_id = _resolve_cancel_job_id(job_id)
    if not effective_job_id:
        return False
    try:
        return bool(job_status_store.is_cancel_requested(effective_job_id))
    except Exception:  # noqa: BLE001
        logger.debug("취소 요청 조회 실패 job=%s", effective_job_id, exc_info=True)
        return False


def get_backend_dir() -> str:
    """app/services/*.py 위치 기준으로 HiTessWorkBenchBackEnd 루트를 반환합니다."""
    base_dir = os.path.dirname(os.path.abspath(__file__))  # app/services
    app_dir = os.path.dirname(base_dir)                    # app
    return os.path.dirname(app_dir)                        # HiTessWorkBenchBackEnd


def get_nastran_bridge_script_path() -> str:
    """vendored nastran_bridge.py 경로를 반환합니다."""
    return os.path.join(get_backend_dir(), "InHouseProgram", "NastranBridge", "nastran_bridge.py")


def build_nastran_bridge_command(*args) -> list[str]:
    """현재 백엔드 Python으로 nastran_bridge.py를 실행하는 subprocess 명령을 만듭니다."""
    return [sys.executable, get_nastran_bridge_script_path(), *(str(arg) for arg in args)]


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
    work_dir: Optional[str] = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
    engine_label: str = "Analysis engine",
    *,
    capture_failure_output: bool = False,
) -> tuple[str, str]:
    """
    해석 실행 파일을 호출하고 (status, output) 튜플을 반환합니다.

    - status: "Success" | "Failed"
    - output: 성공 시 stdout, 실패 시 사용자에게 노출되는 한국어 에러 메시지

    work_dir이 None이면 subprocess는 현재 작업 디렉토리에서 실행됩니다
    (기존 truss_service.py와 동일한 동작).

    capture_failure_output=True 이면 엔진이 0 이 아닌 코드로 종료했을 때
    일반 안내 문구 대신 **엔진의 stdout+stderr 원문**을 돌려줍니다.
    엔진은 대개 실패 원인을 stdout 에 찍는데(예: TrussAssessment 의
    "No SPC Force data found." + KeyNotFoundException) 이를 버리면 화면에
    "해석 실패"만 남아 사용자가 원인을 알 수 없습니다. 호출부는 받은 원문을
    사용자에게 보여주기 전에 반드시 서버 경로를 가리고(redact) 해석해야 합니다.
    기본값 False 라 기존 호출부의 동작은 그대로입니다.
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
        if capture_failure_output:
            raw = "\n".join(part for part in (e.stdout, e.stderr) if part and part.strip())
            return "Failed", raw
        return "Failed", "해석 엔진 실행 중 오류가 발생했습니다. 관리자에게 문의하세요."
    except Exception as e:
        logger.error("%s unexpected error: %s", engine_label, str(e), exc_info=True)
        return "Failed", "예기치 않은 오류가 발생했습니다. 관리자에게 문의하세요."


def run_subprocess_killtree(
    cmd_args: list,
    *,
    cwd: Optional[str] = None,
    timeout: Optional[float] = None,
    job_id: Optional[str] = None,
) -> subprocess.CompletedProcess:
    """subprocess.run(stdout=PIPE, stderr=PIPE) 의 부분 대체 + 자식 트리 정리 + 작업 취소 훅.

    Nastran launcher(nastran.exe) 는 실제 solver 를 손자 프로세스로 띄우므로, timeout 시
    subprocess.run 은 직계 자식만 죽이고 손자 solver 는 좀비로 남을 수 있다. 이 헬퍼는 timeout
    초과 시 psutil 로 자식 프로세스 트리 전체(손자 포함)를 종료한 뒤 subprocess.TimeoutExpired
    를 재-raise 한다 → 기존 호출부의 except subprocess.TimeoutExpired 처리를 그대로 재사용한다.

    반환/예외 계약(무변경): CompletedProcess(returncode, stdout, stderr:bytes) 를 반환하고,
    초과 시 TimeoutExpired 를 던진다.

    취소 훅(추가):
      - Popen 생성 직전에 `job_status_store.is_cancel_requested(job_id)` 를 검사한다. True 면
        프로세스를 만들지 않고 TimeoutExpired 로 잘라 호출부의 기존 실패 경로를 재사용한다.
      - Popen 생성 직후 register_process, 정상/타임아웃/예외 어느 경로에서도 unregister_process.
      - job_id 를 명시하지 않으면 `job_manager.current_job_id()` 로 폴백하고, 그마저 없으면
        (레거시·내부 단계 호출) 훅을 전혀 건드리지 않는다.
    """
    effective_job_id = _resolve_cancel_job_id(job_id)
    if is_cancel_requested(effective_job_id):
        raise subprocess.TimeoutExpired(cmd_args, timeout, output=b"", stderr=b"")

    try:
        import psutil  # optional dependency
    except Exception:
        psutil = None

    if psutil is None:
        # psutil 이 없으면 손자 트리 정리는 못 하지만(기존과 동일한 한계) 취소 훅은 유효하다.
        # subprocess.run 과 동일하게 timeout 시 직계 자식을 죽이고 파이프를 비운 뒤 재-raise 한다.
        proc = subprocess.Popen(
            cmd_args, cwd=cwd,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        _register_job_process(effective_job_id, proc)
        try:
            out, err = proc.communicate(timeout=timeout)
            return subprocess.CompletedProcess(cmd_args, proc.returncode, out, err)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
            except Exception:
                pass
            try:
                out, err = proc.communicate(timeout=5)
            except Exception:
                out, err = b"", b""
            raise subprocess.TimeoutExpired(cmd_args, timeout, output=out, stderr=err)
        finally:
            _unregister_job_process(effective_job_id, proc)

    proc = subprocess.Popen(
        cmd_args, cwd=cwd,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    _register_job_process(effective_job_id, proc)
    try:
        out, err = proc.communicate(timeout=timeout)
        return subprocess.CompletedProcess(cmd_args, proc.returncode, out, err)
    except subprocess.TimeoutExpired:
        # 자식 트리 전체 종료 — 손자 solver 좀비 방지.
        try:
            parent = psutil.Process(proc.pid)
            victims = parent.children(recursive=True)
            victims.append(parent)
            for p in victims:
                try:
                    p.kill()
                except Exception:
                    pass
            psutil.wait_procs(victims, timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        try:
            out, err = proc.communicate(timeout=5)
        except Exception:
            out, err = b"", b""
        raise subprocess.TimeoutExpired(cmd_args, timeout, output=out, stderr=err)
    finally:
        _unregister_job_process(effective_job_id, proc)


def record_analysis(
    *,
    job_id: Optional[str] = None,
    project_name: str,
    program_name: str,
    employee_id: str,
    status: str,
    input_info: dict,
    result_info: Optional[dict],
    source: str,
    include_io_in_project: bool = True,
) -> tuple[Optional[dict], Optional[str]]:
    """
    Analysis 레코드를 생성·커밋하고 (project_data, raw_db_error_message)를 반환합니다.

    - 성공: (project_data dict, None)
    - 실패: (None, "<예외 메시지>") — 호출부에서 자유롭게 prefix("DB Error:", "DB 기록 오류:" 등)를 결정해
      engine_log에 합쳐 사용자에게 노출합니다.

    result_info는 호출부가 전달한 값 그대로 저장됩니다. 서비스별로
    "status가 Success일 때만 저장" 또는 "result_data가 있으면 status 무관 저장" 등의
    정책을 가질 수 있으므로 status 분기는 호출부에서 명시적으로 결정합니다.
    """
    db = database.SessionLocal()
    try:
        new_analysis = db.query(models.Analysis).filter(models.Analysis.job_id == job_id).first() if job_id else None
        now = datetime.now()
        normalized_status = (status or "").strip().lower()
        is_success = normalized_status == "success"
        is_failure = normalized_status in {"failed", "failure", "interrupted"}
        is_terminal = is_success or is_failure
        progress = 100 if is_terminal else 0
        if is_success:
            job_message = "해석 완료"
        elif is_failure:
            job_message = "해석 실패"
        elif normalized_status == "running":
            job_message = "해석 실행 중"
        elif normalized_status == "pending":
            job_message = "실행 대기 중"
        else:
            job_message = status or "상태 확인 중"
        if new_analysis:
            new_analysis.project_name = project_name
            new_analysis.program_name = program_name
            new_analysis.employee_id = employee_id
            new_analysis.status = status
            new_analysis.job_status = status
            new_analysis.progress = progress
            new_analysis.job_message = job_message
            new_analysis.input_info = input_info
            new_analysis.result_info = result_info
            new_analysis.source = source
            new_analysis.updated_at = now
            if not new_analysis.started_at:
                new_analysis.started_at = now
        else:
            new_analysis = models.Analysis(
                job_id=job_id,
                project_name=project_name,
                program_name=program_name,
                employee_id=employee_id,
                status=status,
                job_status=status,
                progress=progress,
                job_message=job_message,
                input_info=input_info,
                result_info=result_info,
                source=source,
                started_at=now,
                updated_at=now,
            )
            db.add(new_analysis)
        db.commit()
        db.refresh(new_analysis)

        # Running/Pending 스냅샷은 My Projects의 즉시 복원용이며 완료/실패 활동으로 집계하지 않는다.
        # 동일 job_id가 terminal 상태로 갱신될 때에만 활동 로그를 한 번 남긴다.
        if is_terminal:
            try:
                db.add(models.ActivityLog(
                    employee_id=employee_id,
                    action_type="ANALYSIS_COMPLETE" if is_success else "ANALYSIS_FAILED",
                    action_detail={
                        "analysis_id": new_analysis.id,
                        "program_name": program_name,
                        "project_name": project_name,
                        "source": source,
                    },
                    status="success" if is_success else "failure",
                ))
                db.commit()
            except Exception:
                db.rollback()

        project_data = {
            "id": new_analysis.id,
            "job_id": new_analysis.job_id,
            "project_name": new_analysis.project_name,
            "program_name": new_analysis.program_name,
            "employee_id": new_analysis.employee_id,
            "status": new_analysis.status,
            "created_at": new_analysis.created_at.isoformat()
                          if new_analysis.created_at else datetime.now().isoformat(),
        }
        # modelflow 등 일부 서비스는 project 응답에서 input_info/result_info 를
        # 제외하는 기존 동작을 유지해야 한다. include_io_in_project=False 로 호출.
        if include_io_in_project:
            project_data["input_info"] = new_analysis.input_info
            project_data["result_info"] = new_analysis.result_info
        return project_data, None
    except Exception as db_e:
        return None, str(db_e)
    finally:
        db.close()


def mark_complete(
    job_id: str,
    status: str,
    engine_log: str,
    project_data: Optional[dict],
    extra: Optional[dict] = None,
    success_message: str = "Analysis Completed Successfully",
    failure_message: str = "Analysis Failed",
) -> None:
    """
    작업을 최종 상태로 마감합니다.

    - status: "Success" | "Failed"
    - engine_log: 사용자에게 노출될 엔진 출력 또는 에러 메시지
    - project_data: record_analysis가 반환한 dict (또는 None)
    - extra: 페이로드에 추가로 합칠 키-값 (예: result_path, bdf_path)
    - success_message/failure_message: 서비스별 한글 메시지 커스터마이즈 ("파싱 완료" 등)
    """
    payload = {
        "status": status,
        "progress": 100,
        "message": success_message if status == "Success" else failure_message,
        "engine_log": engine_log,
        "project": project_data,
    }
    if extra:
        payload.update(extra)
    job_status_store.update_job(job_id, payload)
