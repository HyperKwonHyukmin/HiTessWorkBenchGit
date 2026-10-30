"""D-Type Lug 강도 계산 라우터."""
from fastapi import APIRouter, Depends
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from ..services.d_type_lug_service import run_d_type_lug
from ..dependencies import authenticated_employee_id, require_auth

router = APIRouter(prefix="/api/d-type-lug", tags=["d-type-lug"])


class LoadInput(BaseModel):
    force_N: float = Field(..., gt=0, description="설계 하중 (N)")


class GeometryInput(BaseModel):
    l1: float = Field(..., ge=0)
    l2: float = Field(..., ge=0)
    h1: float = Field(..., ge=0)
    h2: float = Field(..., ge=0)
    h3: float = Field(..., ge=0)
    h4: float = Field(..., ge=0)
    h5: float = Field(..., ge=0)
    t1: float = Field(..., ge=0)
    t2: float = Field(..., ge=0)
    t3: float = Field(..., ge=0)
    r1: float = Field(..., ge=0)
    r2: float = Field(..., ge=0)
    pin_radius: float = Field(..., ge=0)
    d1: float = Field(..., ge=0)
    d2: float = Field(..., ge=0)
    d3: float = Field(..., ge=0)
    w1: float = Field(..., ge=0)
    w2: float = Field(..., ge=0)
    w1_prime: float = Field(..., ge=0)
    w2_prime: float = Field(..., ge=0)

    @model_validator(mode="after")
    def _weld_not_all_zero(self):
        # 용접 목두께 (W + W')/√2 가 모두 0 이면 엔진이 E 단면 면적 0 으로 나눈다(traceback 이 화면에 뜸).
        if self.w1 + self.w1_prime + self.w2 + self.w2_prime <= 0:
            raise ValueError("용접 치수 W1·W2(W1'·W2' 포함) 중 하나는 0보다 커야 합니다.")
        return self


class MaterialInput(BaseModel):
    yield_base_MPa: float = Field(..., gt=0, description="모재 항복응력 (MPa)")
    yield_weld_MPa: float = Field(..., gt=0, description="용접부 허용 기준 응력 (MPa)")


class DTypeLugRequest(BaseModel):
    load: LoadInput
    geometry: GeometryInput
    material: MaterialInput
    employee_id: str = Field(default="unknown", description="요청 사번")
    # 화면에서 검토 대상으로 고른 형식. 엔진은 세 형식을 모두 계산하므로 계산에는 쓰지 않고
    # 작업 기록(input_info)에만 남긴다 — 옛 클라이언트는 보내지 않는다.
    bracket_type: Optional[Literal["bracket_4EA", "bracket_2EA_double", "bracket_2EA_single"]] = None


@router.post("/calculate")
def calculate(
    body: DTypeLugRequest,
    current_user: str = Depends(require_auth),
):
    """D-Type Lug 3개 브라켓 타입의 각도별 Usage Factor를 계산합니다."""
    inputs = body.model_dump(exclude={"employee_id", "bracket_type"})
    return run_d_type_lug(
        inputs,
        authenticated_employee_id(body.employee_id, current_user),
        bracket_type=body.bracket_type,
    )
