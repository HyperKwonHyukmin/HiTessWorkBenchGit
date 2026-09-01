"""이중관 구조 연료배관 해석 라우터."""
import json
import os
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import database
from ..dependencies import authenticated_employee_id, require_auth
from ..services.doublepipe_service import generate_inner_pipe_pdf, run_inner_pipe_preview
from ..services.doublepipe_psa_service import (
    cancel_psa_job,
    get_active_status,
    get_psa_job,
    start_modal_job,
    start_modal_job_from_upload,
    start_psa_job,
    start_psa_job_from_upload,
)
from ._access_control import (
    assert_current_user_can_access_owner,
    assert_current_user_can_access_path,
    is_admin_user,
)

router = APIRouter(prefix="/api/doublepipe", tags=["doublepipe"])
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_USER_CONNECTION_DIR = os.path.join(_BACKEND_DIR, "userConnection")
_MAX_CSV_BYTES = 25 * 1024 * 1024


async def _read_csv_upload(upload: UploadFile) -> bytes:
    """CSV 업로드만 허용하고, 메모리 고갈을 막기 위해 읽기 크기를 제한합니다."""
    filename = os.path.basename(upload.filename or "")
    if not filename or filename != (upload.filename or ""):
        raise HTTPException(status_code=400, detail="유효하지 않은 업로드 파일명입니다.")
    if os.path.splitext(filename)[1].lower() != ".csv":
        raise HTTPException(status_code=400, detail="CSV 파일만 업로드할 수 있습니다.")
    content = await upload.read(_MAX_CSV_BYTES + 1)
    if len(content) > _MAX_CSV_BYTES:
        raise HTTPException(status_code=413, detail="CSV 파일 크기가 25MB 제한을 초과했습니다.")
    if not content:
        raise HTTPException(status_code=400, detail="업로드된 CSV 파일이 비어 있습니다.")
    return content


@router.post("/inner-pipe-preview")
async def inner_pipe_preview(
    csv_file: UploadFile = File(...),
    config: str = Form(...),
    employee_id: str = Form("unknown"),
    current_user: str = Depends(require_auth),
):
    """
    업로드한 외관 배관 CSV + Design Inner Support 입력값(config, JSON 문자열)으로
    append_offset.py 변환(내관 자동 생성 + UBOLT 배치)을 실행해 결과 CSV를 테이블 행으로 반환합니다.
    """
    try:
        config_dict = json.loads(config)
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(status_code=400, detail="config 값이 올바른 JSON 형식이 아닙니다.")

    for key in ("inner_pipe", "ubolt", "load_conditions"):
        if key not in config_dict:
            raise HTTPException(status_code=400, detail=f"config 에 '{key}' 항목이 필요합니다.")

    csv_bytes = await _read_csv_upload(csv_file)

    return run_inner_pipe_preview(
        config_dict,
        csv_bytes,
        csv_file.filename or "input.csv",
        authenticated_employee_id(employee_id, current_user),
    )


class InnerPipePdfRequest(BaseModel):
    workDir: str            # userConnection 기준 Tab1 작업 폴더명
    sourceCsv: str          # 그 폴더 안의 입력(외관) CSV 파일명
    employee_id: str = "unknown"


@router.post("/inner-pipe-pdf")
def inner_pipe_pdf(
    req: InnerPipePdfRequest,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """
    Tab1 작업 폴더의 입력 CSV + 설정으로 배치/치수 도면 PDF 를 온디맨드 생성해 반환합니다.
    무거운 matplotlib 렌더는 InnerPipeTransform.exe(pandas/numpy/matplotlib 번들)로 처리하므로
    실행 컴퓨터의 venv 에 matplotlib 설치가 필요 없습니다(exe 미존재 시 in-process 폴백).
    PDF 바이트를 직접 반환하며(디스크 미경유 서빙), 프론트는 blob 으로 받아 저장합니다.
    """
    work_path = os.path.join(_USER_CONNECTION_DIR, os.path.basename(req.workDir or ""))
    assert_current_user_can_access_path(work_path, current_user, db, _USER_CONNECTION_DIR)
    pdf_bytes, pdf_name = generate_inner_pipe_pdf(
        req.workDir,
        req.sourceCsv,
        authenticated_employee_id(req.employee_id, current_user),
    )
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(pdf_name)}"}
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)


class RunPsaRequest(BaseModel):
    workDir: str            # userConnection 기준 Tab1 작업 폴더명
    resultCsv: str          # 그 폴더 안의 내관 포함 결과 CSV 파일명
    employee_id: str = "unknown"
    load_cases: "list[str] | None" = None   # None/빈 값=전체 29개 / ['L18','L20']=선택(+L17 자동)


@router.post("/run-psa")
def run_psa(
    req: RunPsaRequest,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """
    Tab1 결과 CSV 를 'Piping Stress Analysis for all load cases' 파이프라인
    (PSA_AllLoadCases.exe — scipy·pyNastran·numpy·openpyxl 번들된 단일 실행파일)의
    입력으로 넘겨 배관응력 해석을 백그라운드로 시작합니다. load_cases 를 지정하지 않으면
    전체 29개 Load Case, 지정하면 그 Load Case(+L17 SUS 자동)만 해석합니다.
    (⚠️ Abaqus(외부 CAE 솔버)만은 실행 컴퓨터에 별도 설치되어 PATH 에 등록돼 있어야 합니다)
    """
    work_path = os.path.join(_USER_CONNECTION_DIR, os.path.basename(req.workDir or ""))
    assert_current_user_can_access_path(work_path, current_user, db, _USER_CONNECTION_DIR)
    return start_psa_job(
        req.workDir,
        req.resultCsv,
        authenticated_employee_id(req.employee_id, current_user),
        req.load_cases,
    )


@router.post("/run-psa-upload")
async def run_psa_upload(
    csv_file: UploadFile = File(...),
    employee_id: str = Form("unknown"),
    load_cases: str = Form(""),   # 콤마/공백 구분 문자열(예: "L18,L20"). 빈 값=전체.
    current_user: str = Depends(require_auth),
):
    """
    Tab2 에서 직접 업로드한 내관 포함 배관 CSV 를 userConnection 작업 폴더에 저장하고
    배관응력 해석(PSA_AllLoadCases.exe)을 백그라운드로 시작합니다. load_cases 가 비어 있으면
    전체 29개 Load Case, 지정되면 그 Load Case(+L17 자동)만 해석합니다.
    Tab1(Design Inner Support)을 거치지 않고 준비된 CSV 로 곧바로 해석을 돌리는 독립 경로입니다.
    (⚠️ Abaqus(외부 CAE 솔버)만은 실행 컴퓨터에 별도 설치되어 PATH 에 등록돼 있어야 합니다)
    """
    csv_bytes = await _read_csv_upload(csv_file)
    return start_psa_job_from_upload(
        csv_bytes,
        csv_file.filename or "psa_input.csv",
        authenticated_employee_id(employee_id, current_user),
        load_cases,
    )


class RunModalRequest(BaseModel):
    workDir: str            # userConnection 기준 작업 폴더명
    resultCsv: str          # 그 폴더 안의 내관 포함 배관 CSV 파일명
    employee_id: str = "unknown"
    modes: "int | None" = None       # 추출 최대 모드 개수(기본 10)
    min_freq: "float | None" = None  # 추출 최소 고유진동수 Hz(기본 1.0)


@router.post("/run-modal")
def run_modal(
    req: RunModalRequest,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """
    Tab1 결과 CSV 를 'Piping Normal Mode Analysis' 파이프라인(Run_ModalAnalysis.exe)의 입력으로
    넘겨 고유진동(Normal Mode) 해석을 백그라운드로 시작합니다. *FREQUENCY 스텝 inp 를 만들고
    Abaqus 를 1회 실행한 뒤 .dat 에서 고유진동수(Hz)를 추출합니다(마찰 반복 없음).
    ⚠️ PSA 와 같은 Abaqus 라이센스를 쓰므로 동시에 하나만 실행됩니다(점유 중이면 409).
    진행 상태·로그는 PSA 와 동일하게 GET /run-psa/status/{job_id} 로 폴링합니다.
    """
    work_path = os.path.join(_USER_CONNECTION_DIR, os.path.basename(req.workDir or ""))
    assert_current_user_can_access_path(work_path, current_user, db, _USER_CONNECTION_DIR)
    return start_modal_job(
        req.workDir,
        req.resultCsv,
        authenticated_employee_id(req.employee_id, current_user),
        req.modes,
        req.min_freq,
    )


@router.post("/run-modal-upload")
async def run_modal_upload(
    csv_file: UploadFile = File(...),
    employee_id: str = Form("unknown"),
    modes: str = Form(""),      # 빈 값=엔진 기본(10)
    min_freq: str = Form(""),   # 빈 값=엔진 기본(1.0Hz)
    current_user: str = Depends(require_auth),
):
    """
    Tab3 에서 직접 업로드한 배관 CSV 를 userConnection 작업 폴더에 저장하고 고유진동 해석을
    백그라운드로 시작합니다. Tab1(Design Inner Support)을 거치지 않는 독립 경로입니다.
    """
    csv_bytes = await _read_csv_upload(csv_file)
    return start_modal_job_from_upload(
        csv_bytes,
        csv_file.filename or "modal_input.csv",
        authenticated_employee_id(employee_id, current_user),
        modes or None,
        min_freq or None,
    )


@router.get("/run-psa/status/{job_id}")
def run_psa_status(
    job_id: str,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """선택 Load Case 해석 작업의 진행 상태·로그를 반환합니다(1.5초 폴링용)."""
    job = get_psa_job(job_id)
    assert_current_user_can_access_owner(job.get("employeeId"), current_user, db)
    return job


@router.get("/active")
def active_psa(
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """현재 Abaqus 라이센스를 점유(running)한 PSA 해석 상태를 반환합니다.

    페이지 진입 락 판정·재연결·전역 위젯이 공유하는 단일 진실원입니다.
    active=false 면 라이센스가 비어 있습니다. active=true 면 jobId·employeeId(내 작업 분기용)와
    함께 startedAtEpoch/serverNowEpoch/elapsedSec 를 주어 클라이언트가 경과 타이머를 그립니다.
    """
    status = get_active_status()
    if not status.get("active"):
        return status
    owner = status.get("employeeId")
    if owner == current_user or is_admin_user(db, current_user):
        return status
    # Other users need only the global licence-lock state.  Do not disclose the
    # owner, job id, or solver log across accounts.
    return {
        "active": True,
        "startedAtEpoch": status.get("startedAtEpoch"),
        "serverNowEpoch": status.get("serverNowEpoch"),
        "elapsedSec": status.get("elapsedSec"),
        "status": status.get("status"),
    }


class CancelPsaRequest(BaseModel):
    jobId: str
    employee_id: str = "unknown"


@router.post("/run-psa/cancel")
def cancel_psa(
    req: CancelPsaRequest,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """실행 중인 PSA 해석을 소유자가 중단합니다 — 프로세스 트리 종료 후 라이센스를 즉시 해제합니다."""
    job = get_psa_job(req.jobId)
    owner = job.get("employeeId")
    assert_current_user_can_access_owner(owner, current_user, db)
    authenticated_employee_id(req.employee_id, current_user)
    # The service performs a second owner check.  Administrators are authorized
    # above and pass the actual owner to retain that defence-in-depth check.
    return cancel_psa_job(req.jobId, owner or current_user)
