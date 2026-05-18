"""D-Type Lug 강도 계산 라우터."""
from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..services.d_type_lug_service import run_d_type_lug

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


class MaterialInput(BaseModel):
    yield_base_MPa: float = Field(..., gt=0, description="모재 항복응력 (MPa)")
    yield_weld_MPa: float = Field(..., gt=0, description="용접부 허용 기준 응력 (MPa)")


class DTypeLugRequest(BaseModel):
    load: LoadInput
    geometry: GeometryInput
    material: MaterialInput
    employee_id: str = Field(default="unknown", description="요청 사번")


@router.post("/calculate")
def calculate(body: DTypeLugRequest):
    """D-Type Lug 3개 브라켓 타입의 각도별 Usage Factor를 계산합니다."""
    inputs = body.model_dump(exclude={"employee_id"})
    return run_d_type_lug(inputs, body.employee_id)
