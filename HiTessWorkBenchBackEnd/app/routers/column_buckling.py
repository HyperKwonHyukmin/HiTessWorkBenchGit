"""기둥 좌굴 허용 사용하중 계산 라우터."""
from fastapi import APIRouter
from pydantic import BaseModel, Field
from ..services.column_buckling_service import run_column_buckling

router = APIRouter(prefix="/api/column-buckling", tags=["column-buckling"])


class ColumnBucklingRequest(BaseModel):
    member_name: str = Field(..., description="단면 부재명 (예: '300A PIPE')")
    length_mm: float = Field(..., gt=0, description="기둥 길이 (mm)")
    employee_id: str = Field(default="unknown", description="요청 사번")


@router.post("/calculate")
def calculate(body: ColumnBucklingRequest):
    """AISC 기준 기둥 좌굴 허용 사용하중 계산. 편심량 20mm 고정."""
    return run_column_buckling(
        body.member_name,
        body.length_mm,
        body.employee_id,
    )
