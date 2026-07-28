"""기둥 좌굴 허용 사용하중 계산 라우터."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from ..services.column_buckling_service import run_column_buckling
from ..dependencies import authenticated_employee_id, require_auth

router = APIRouter(prefix="/api/column-buckling", tags=["column-buckling"])


class ColumnBucklingRequest(BaseModel):
    member_name: str = Field(..., description="단면 부재명 (예: '300A PIPE')")
    length_mm: float = Field(..., gt=0, description="기둥 길이 (mm)")
    employee_id: str = Field(default="unknown", description="요청 사번")


@router.post("/calculate")
def calculate(
    body: ColumnBucklingRequest,
    current_user: str = Depends(require_auth),
):
    """AISC 기준 기둥 좌굴 허용 사용하중 계산. 편심량 20mm 고정."""
    return run_column_buckling(
        body.member_name,
        body.length_mm,
        authenticated_employee_id(body.employee_id, current_user),
    )
