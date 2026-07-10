"""이중관 구조 연료배관 해석 라우터."""
import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from ..services.doublepipe_service import run_inner_pipe_preview
from ..services.doublepipe_psa_service import get_psa_job, start_psa_job

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


@router.get("/run-psa/status/{job_id}")
def run_psa_status(job_id: str):
    """선택 Load Case 해석 작업의 진행 상태·로그를 반환합니다(1.5초 폴링용)."""
    return get_psa_job(job_id)
