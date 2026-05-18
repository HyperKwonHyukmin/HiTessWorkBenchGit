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
import os
import uuid
from datetime import datetime

from fastapi import HTTPException, UploadFile

from ..services.job_manager import analysis_executor, job_status_store

# routers/ 디렉토리 기준 백엔드 루트 → userConnection 경로
# 기존 analysis.py의 _USER_CONNECTION_DIR 정의와 동일한 경로를 가리킵니다.
_ROUTER_DIR = os.path.dirname(os.path.abspath(__file__))           # app/routers
_BACKEND_DIR = os.path.dirname(os.path.dirname(_ROUTER_DIR))       # HiTessWorkBenchBackEnd
USER_CONNECTION_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))


def make_work_dir(employee_id: str, program_name: str) -> tuple[str, str]:
    """
    `userConnection/{timestamp}_{employee_id}_{program_name}` 작업 디렉토리를 생성합니다.

    반환값: (work_dir_absolute_path, timestamp_string)
    timestamp는 후속 task_execute_*에 전달되어 결과 파일명/DB 레코드명에 사용됩니다.
    """
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    unique_folder = f"{timestamp}_{employee_id}_{program_name}"
    work_dir = os.path.abspath(os.path.join(USER_CONNECTION_DIR, unique_folder))
    os.makedirs(work_dir, exist_ok=True)
    return work_dir, timestamp


async def save_upload(upload: UploadFile, work_dir: str) -> str:
    """
    단일 UploadFile을 work_dir에 저장하고 절대 경로를 반환합니다.

    실패 시 기존 라우터와 완전히 동일한 메시지로 HTTP 500을 발생시킵니다
    (detail: "File save error: {원인}").
    """
    dest_path = os.path.join(work_dir, os.path.basename(upload.filename))
    try:
        with open(dest_path, "wb") as buffer:
            buffer.write(await upload.read())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"File save error: {str(e)}")
    return dest_path


def submit_analysis_job(task_fn, *task_args) -> str:
    """
    job_id를 발급하고 Pending 상태로 등록한 뒤 analysis_executor에 작업을 제출합니다.

    사용 예:
        job_id = submit_analysis_job(
            task_execute_assessment,
            bdf_path, work_dir, employee_id, timestamp, source,
        )

    내부 동작 (기존 라우터의 직접 구현과 정확히 동일):
        - job_id = uuid.uuid4()
        - job_status_store.set(job_id, {"status":"Pending","progress":0,"message":"Waiting in Queue..."})
        - analysis_executor.submit(task_fn, job_id, *task_args)
    """
    job_id = str(uuid.uuid4())
    job_status_store.set(job_id, {
        "status": "Pending",
        "progress": 0,
        "message": "Waiting in Queue...",
    })
    analysis_executor.submit(task_fn, job_id, *task_args)
    return job_id
