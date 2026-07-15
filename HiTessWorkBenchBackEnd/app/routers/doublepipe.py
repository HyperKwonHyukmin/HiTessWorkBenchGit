"""이중관 구조 연료배관 해석 라우터."""
import json
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel

from ..services.doublepipe_service import generate_inner_pipe_pdf, run_inner_pipe_preview
from ..services.doublepipe_psa_service import (
    cancel_psa_job,
    get_active_status,
    get_psa_job,
    start_psa_job,
    start_psa_job_from_upload,
)

router = APIRouter(prefix="/api/doublepipe", tags=["doublepipe"])


@router.post("/inner-pipe-preview")
async def inner_pipe_preview(
    csv_file: UploadFile = File(...),
    config: str = Form(...),
    employee_id: str = Form("unknown"),
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

    csv_bytes = await csv_file.read()
    if not csv_bytes:
        raise HTTPException(status_code=400, detail="업로드된 CSV 파일이 비어 있습니다.")

    return run_inner_pipe_preview(config_dict, csv_bytes, csv_file.filename or "input.csv", employee_id)


class InnerPipePdfRequest(BaseModel):
    workDir: str            # userConnection 기준 Tab1 작업 폴더명
    sourceCsv: str          # 그 폴더 안의 입력(외관) CSV 파일명
    employee_id: str = "unknown"


@router.post("/inner-pipe-pdf")
def inner_pipe_pdf(req: InnerPipePdfRequest):
    """
    Tab1 작업 폴더의 입력 CSV + 설정으로 배치/치수 도면 PDF 를 온디맨드 생성해 반환합니다.
    무거운 matplotlib 렌더는 InnerPipeTransform.exe(pandas/numpy/matplotlib 번들)로 처리하므로
    실행 컴퓨터의 venv 에 matplotlib 설치가 필요 없습니다(exe 미존재 시 in-process 폴백).
    PDF 바이트를 직접 반환하며(디스크 미경유 서빙), 프론트는 blob 으로 받아 저장합니다.
    """
    pdf_bytes, pdf_name = generate_inner_pipe_pdf(req.workDir, req.sourceCsv, req.employee_id)
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(pdf_name)}"}
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)


class RunPsaRequest(BaseModel):
    workDir: str            # userConnection 기준 Tab1 작업 폴더명
    resultCsv: str          # 그 폴더 안의 내관 포함 결과 CSV 파일명
    employee_id: str = "unknown"


@router.post("/run-psa")
def run_psa(req: RunPsaRequest):
    """
    Tab1 결과 CSV 를 'Piping Stress Analysis for all load cases' 파이프라인
    (PSA_AllLoadCases.exe — scipy·pyNastran·numpy·openpyxl 번들된 단일 실행파일)의
    입력으로 넘겨 전체 29개 Load Case 배관응력 해석을 백그라운드로 시작합니다.
    (⚠️ Abaqus(외부 CAE 솔버)만은 실행 컴퓨터에 별도 설치되어 PATH 에 등록돼 있어야 합니다)
    """
    return start_psa_job(req.workDir, req.resultCsv, req.employee_id)


@router.post("/run-psa-upload")
async def run_psa_upload(
    csv_file: UploadFile = File(...),
    employee_id: str = Form("unknown"),
):
    """
    Tab2 에서 직접 업로드한 내관 포함 배관 CSV 를 userConnection 작업 폴더에 저장하고
    전체 29개 Load Case 배관응력 해석(PSA_AllLoadCases.exe)을 백그라운드로 시작합니다.
    Tab1(Design Inner Support)을 거치지 않고 준비된 CSV 로 곧바로 해석을 돌리는 독립 경로입니다.
    (⚠️ Abaqus(외부 CAE 솔버)만은 실행 컴퓨터에 별도 설치되어 PATH 에 등록돼 있어야 합니다)
    """
    csv_bytes = await csv_file.read()
    return start_psa_job_from_upload(csv_bytes, csv_file.filename or "psa_input.csv", employee_id)


@router.get("/run-psa/status/{job_id}")
def run_psa_status(job_id: str):
    """선택 Load Case 해석 작업의 진행 상태·로그를 반환합니다(1.5초 폴링용)."""
    return get_psa_job(job_id)


@router.get("/active")
def active_psa():
    """현재 Abaqus 라이센스를 점유(running)한 PSA 해석 상태를 반환합니다.

    페이지 진입 락 판정·재연결·전역 위젯이 공유하는 단일 진실원입니다.
    active=false 면 라이센스가 비어 있습니다. active=true 면 jobId·employeeId(내 작업 분기용)와
    함께 startedAtEpoch/serverNowEpoch/elapsedSec 를 주어 클라이언트가 경과 타이머를 그립니다.
    """
    return get_active_status()


class CancelPsaRequest(BaseModel):
    jobId: str
    employee_id: str = "unknown"


@router.post("/run-psa/cancel")
def cancel_psa(req: CancelPsaRequest):
    """실행 중인 PSA 해석을 소유자가 중단합니다 — 프로세스 트리 종료 후 라이센스를 즉시 해제합니다."""
    return cancel_psa_job(req.jobId, req.employee_id)
