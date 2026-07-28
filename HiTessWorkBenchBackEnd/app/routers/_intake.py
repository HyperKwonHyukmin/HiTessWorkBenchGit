"""
해석 요청 라우터들의 공통 접수(intake) 패턴 헬퍼.

모든 POST /api/analysis/*/request 엔드포인트는 다음 절차를 반복합니다.
    1) work_dir 생성 (`userConnection/{timestamp}_{employee_id}_{ProgramName}`)
    2) UploadFile 저장
    3) job_id 생성 → job_status_store에 Pending 등록 → analysis_executor.submit

본 모듈은 위 3단계를 작은 헬퍼로 분리하여 라우터 코드의 중복을 줄이는 것이 목적입니다.

원칙:
- 기존 라우터의 외부 응답/에러 코드/경로 명명 규칙은 절대 변경하지 않습니다.
- 이 모듈을 import 하지 않는 한 기존 라우터에는 어떤 영향도 없습니다.
- HTTP 예외 메시지/상태 코드는 기존 라우터와 동일하게 유지합니다.
"""
import logging
import os
import re
import shutil
import uuid
from datetime import datetime

from fastapi import HTTPException, UploadFile

from .. import database, models
from ..services.job_manager import JobMetadata, analysis_executor, job_status_store
from ..services.workspace import create_analysis_workspace

logger = logging.getLogger(__name__)

# routers/ 디렉토리 기준 백엔드 루트 → userConnection 경로
# 기존 analysis.py의 _USER_CONNECTION_DIR 정의와 동일한 경로를 가리킵니다.
_ROUTER_DIR = os.path.dirname(os.path.abspath(__file__))           # app/routers
_BACKEND_DIR = os.path.dirname(os.path.dirname(_ROUTER_DIR))       # HiTessWorkBenchBackEnd
USER_CONNECTION_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))
_TIMESTAMP_RE = re.compile(r"^\d{8}_\d{6}$")
_UPLOAD_CHUNK_SIZE = 1024 * 1024


class _OwnedWorkDir(str):
    """현재 요청이 생성한 작업 폴더임을 나타내는 일회성 정리 capability.

    전역 경로 registry를 사용하면 같은 폴더를 후속 rebuild/solve 요청이 참조하는 동안
    다른 strict 접수 실패가 그 폴더를 오인해 삭제할 수 있다. 대신 ``make_work_dir``가
    반환한 이 값 자체를 해당 요청이 ``owned_work_dir``로 명시 전달할 때만 정리한다.
    """

    def __new__(cls, value: str, *, root: str, employee_id: str):
        instance = super().__new__(cls, value)
        instance.root = os.path.realpath(root)
        instance.employee_id = employee_id
        return instance


def make_work_dir(employee_id: str, program_name: str) -> tuple[str, str]:
    """
    `userConnection/{timestamp}_{employee_id}_{program_name}` 작업 디렉토리를 생성합니다.

    반환값: (work_dir_absolute_path, timestamp_string)
    timestamp는 후속 task_execute_*에 전달되어 결과 파일명/DB 레코드명에 사용됩니다.
    """
    work_dir, timestamp = create_analysis_workspace(
        USER_CONNECTION_DIR, employee_id, program_name,
    )
    return _OwnedWorkDir(
        work_dir,
        root=USER_CONNECTION_DIR,
        employee_id=employee_id,
    ), timestamp


async def save_upload(
    upload: UploadFile,
    work_dir: str,
    error_prefix: str = "File save error",
    dest_name: str | None = None,
    allowed_extensions: set[str] | None = None,
    max_bytes: int | None = None,
) -> str:
    """
    단일 UploadFile을 work_dir에 저장하고 절대 경로를 반환합니다.

    dest_name 이 주어지면 사용자 업로드 파일명을 무시하고 그 이름으로 저장합니다.
    None(기본) 이면 기존 동작 — 업로드 파일명을 그대로 사용.

    allowed_extensions/max_bytes 는 신규 호출부에서만 쓰는 선택 정책입니다.
    기본값은 None 이므로 기존 저장/호출 방식은 바뀌지 않습니다.

    실패 시 기존 라우터와 동일한 메시지로 HTTP 500을 발생시킵니다.
    error_prefix를 통해 라우터별 한글 메시지("파일 저장 오류" 등)도 유지할 수 있습니다.
    """
    fname = os.path.basename(dest_name) if dest_name is not None else os.path.basename(upload.filename)
    if allowed_extensions is not None:
        ext = os.path.splitext(fname)[1].lower()
        normalized = {item.lower() if item.startswith(".") else f".{item.lower()}" for item in allowed_extensions}
        if ext not in normalized:
            raise HTTPException(status_code=400, detail=f"허용되지 않은 파일 형식입니다: {ext or '(none)'}")
    dest_path = os.path.join(work_dir, fname)
    try:
        written = 0
        with open(dest_path, "wb") as buffer:
            while True:
                chunk = await upload.read(_UPLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                written += len(chunk)
                if max_bytes is not None and written > max_bytes:
                    buffer.close()
                    try:
                        os.remove(dest_path)
                    except OSError:
                        pass
                    raise HTTPException(status_code=413, detail=f"파일 크기가 제한({max_bytes} bytes)을 초과했습니다.")
                buffer.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{error_prefix}: {str(e)}")
    return dest_path


def submit_analysis_job(
    task_fn,
    *task_args,
    queue_message: str = "Waiting in Queue...",
    metadata: JobMetadata | None = None,
    owned_work_dir: str | None = None,
) -> str:
    """
    job_id를 발급하고 Pending 상태로 등록한 뒤 analysis_executor에 작업을 제출합니다.

    사용 예:
        job_id = submit_analysis_job(
            task_execute_assessment,
            bdf_path, work_dir, employee_id, timestamp, source,
        )

    queue_message: 라우터별 한글/영문 대기 메시지를 보존하기 위한 옵션
                   (예: plate-structure 는 "대기 중...").

    내부 동작 (기존 라우터의 직접 구현과 정확히 동일):
        - job_id = uuid.uuid4()
        - job_status_store.set(job_id, {"status":"Pending","progress":0,"message":queue_message})
        - analysis_executor.submit(task_fn, job_id, *task_args)
    """
    job_id = str(uuid.uuid4())
    if metadata is None:
        employee_id, program_name = _infer_job_metadata(task_fn, task_args)
        metadata = JobMetadata(employee_id=employee_id, program_name=program_name)
    else:
        employee_id = metadata.employee_id
        program_name = metadata.program_name

    pending_persisted = _record_pending_analysis(job_id, employee_id, program_name, queue_message)
    if _require_pending_persistence() and not pending_persisted:
        _cleanup_owned_workspace(owned_work_dir, employee_id)
        raise HTTPException(
            status_code=503,
            detail="작업 접수 상태를 데이터베이스에 저장하지 못했습니다. 잠시 후 다시 시도하세요.",
        )
    job_status_store.set(job_id, {
        "status": "Pending",
        "progress": 0,
        "message": queue_message,
        # DB Pending 레코드 생성이 일시적으로 실패해도 status endpoint가
        # 메모리 상태의 소유자를 검증할 수 있도록 반드시 함께 보존한다.
        "employee_id": employee_id,
        "_metadata": metadata,
    })
    try:
        future = analysis_executor.submit(task_fn, job_id, *task_args)
    except Exception as exc:
        logger.exception("작업 %s executor 제출 실패", job_id)
        job_status_store.update_job(job_id, {
            "status": "Failed",
            "progress": 100,
            "message": "작업 실행 대기열에 제출하지 못했습니다.",
        })
        _cleanup_owned_workspace(owned_work_dir, employee_id)
        raise HTTPException(
            status_code=503,
            detail="작업 실행 대기열에 제출하지 못했습니다. 잠시 후 다시 시도하세요.",
        ) from exc
    # task_fn 내부 try 밖(예: mark_running)에서 예외가 나면 Future 에만 갇혀 삼켜지고
    # job 이 Running 으로 고착된다. done 콜백으로 그런 예외를 회수해 로깅 + Failed 마킹한다.
    # (테스트가 submit 을 stub 으로 대체해 None 을 돌려줄 수 있으므로 Future 일 때만 부착.)
    if future is not None and hasattr(future, "add_done_callback"):
        future.add_done_callback(lambda f, jid=job_id: _handle_future_result(jid, f))
    return job_id


def _handle_future_result(job_id: str, future) -> None:
    """제출된 task Future 의 완료를 회수한다.

    task_execute_* 함수들은 보통 내부에서 예외를 처리하고 정상 반환하므로 여기서는 아무 일도
    하지 않는다. 그러나 task 내부 try 로 감싸지지 않은 지점(초기화 등)에서 예외가 escape 하면
    ThreadPoolExecutor 는 그것을 Future 에 저장하고 조용히 삼킨다 → job 이 영원히 Running.
    그 케이스를 잡아 로깅하고 job 을 Failed 로 마킹(메모리+DB write-through)한다.
    """
    try:
        future.result()
    except BaseException as exc:  # noqa: BLE001 — task 밖에서 새어 나온 모든 예외를 회수
        logger.error("작업 %s 이(가) task 외부 예외로 중단되었습니다: %s", job_id, exc, exc_info=True)
        try:
            job_status_store.update_job(job_id, {
                "status": "Failed",
                "progress": 100,
                "message": f"작업 실행 중 오류로 중단되었습니다: {exc}",
            })
        except Exception:
            logger.exception("작업 %s Failed 마킹 실패", job_id)


def _infer_job_metadata(task_fn, task_args: tuple) -> tuple[str | None, str]:
    employee_id = None
    for idx, arg in enumerate(task_args[:-1]):
        if isinstance(arg, str) and isinstance(task_args[idx + 1], str) and _TIMESTAMP_RE.match(task_args[idx + 1]):
            employee_id = arg
            break

    program_name = getattr(task_fn, "__name__", "Analysis").removeprefix("task_execute_")
    for arg in task_args:
        if isinstance(arg, str) and _is_userconnection_path(arg):
            owner, program = _infer_work_folder_metadata(arg)
            if owner:
                employee_id = employee_id or owner
                program_name = program or program_name
                break
    return employee_id, program_name


def _cleanup_owned_workspace(owned_work_dir: str | None, employee_id: str | None) -> None:
    """strict 접수 실패 시 호출부가 명시한 *현재 요청 소유* 폴더만 제거한다."""
    if not isinstance(owned_work_dir, _OwnedWorkDir):
        return
    workspace = os.path.realpath(str(owned_work_dir))
    owner, _program = _infer_work_folder_metadata(workspace)
    root = os.path.realpath(USER_CONNECTION_DIR)
    try:
        is_direct_child = os.path.dirname(workspace) == root
        is_under_root = os.path.commonpath([root, workspace]) == root
    except ValueError:
        is_direct_child = is_under_root = False
    # capability가 발급된 루트/소유자와 현재 요청 메타데이터가 모두 일치해야 한다.
    if (
        owned_work_dir.root != root
        or owned_work_dir.employee_id != employee_id
        or not is_under_root
        or not is_direct_child
        or not owner
        or owner != employee_id
    ):
        logger.error("strict 접수 실패 작업 폴더 안전 정리 거부: %s", workspace)
        return
    try:
        shutil.rmtree(workspace)
    except OSError:
        logger.exception("strict 접수 실패 작업 폴더 정리 실패: %s", workspace)


def _is_userconnection_path(path: str) -> bool:
    try:
        return os.path.commonpath([USER_CONNECTION_DIR, os.path.abspath(path)]) == USER_CONNECTION_DIR
    except ValueError:
        return False


def _infer_work_folder_metadata(path: str) -> tuple[str | None, str | None]:
    """userConnection 하위 어느 깊이의 경로든 최상위 작업 폴더에서 사번/프로그램명을 추론합니다."""
    try:
        rel = os.path.relpath(os.path.abspath(path), USER_CONNECTION_DIR)
    except ValueError:
        return None, None
    if rel.startswith(".."):
        return None, None
    folder = rel.split(os.sep, 1)[0]
    parts = folder.split("_", 3)
    if len(parts) == 4 and _TIMESTAMP_RE.match("_".join(parts[:2])):
        return parts[2], parts[3]
    return None, None


def _require_pending_persistence() -> bool:
    return os.environ.get("WORKBENCH_REQUIRE_PENDING_PERSISTENCE", "").strip().lower() in {
        "1", "true", "yes", "on",
    }


def _record_pending_analysis(
    job_id: str,
    employee_id: str | None,
    program_name: str,
    queue_message: str,
) -> bool:
    """Pending 레코드 저장 성공 여부를 반환한다.

    기본 모드에서는 기존처럼 DB 일시 장애가 있어도 인메모리 큐 실행을 계속한다.
    운영자가 fail-closed 환경변수를 켠 경우 호출부가 이 결과로 503을 반환한다.
    """
    db = None
    try:
        db = database.SessionLocal()
        now = datetime.now()
        db.add(models.Analysis(
            job_id=job_id,
            project_name=f"{program_name}_{now.strftime('%Y%m%d_%H%M%S')}",
            program_name=program_name,
            employee_id=employee_id,
            status="Pending",
            job_status="Pending",
            progress=0,
            job_message=queue_message,
            input_info={},
            result_info={},
            source="Workbench",
            updated_at=now,
        ))
        db.commit()
        return True
    except Exception:
        if db is not None:
            db.rollback()
        logger.exception("작업 %s Pending DB 저장 실패", job_id)
        return False
    finally:
        if db is not None:
            db.close()
