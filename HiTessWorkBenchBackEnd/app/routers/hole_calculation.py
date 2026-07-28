"""Hole fatigue assessment 계산 라우터 — DNVGL-RP-C203 기준."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..services.hole_calculation_service import run_hole_calculation
from ..dependencies import authenticated_employee_id, require_auth

router = APIRouter(prefix="/api/hole-calculation", tags=["hole-calculation"])


class HoleCalculationRequest(BaseModel):
    # Ship information
    ship_type: Literal["CNTR", "GAS", "TANKER", "BULK", "ETC"] = Field(
        default="CNTR", description="선종"
    )
    ship_length_m: float = Field(..., gt=0, description="선박 길이, m")
    section_modulus_m3: float = Field(..., gt=0, description="단면계수, m³")
    operating_area: Literal["North Atlantic", "World Wide"] = Field(
        default="North Atlantic", description="운항 해역"
    )
    reduction_factor_on_operating_area: Optional[float] = Field(
        default=None, description="운항해역 감소계수 (생략 시 자동)"
    )
    fraction_time_factor: Optional[float] = Field(
        default=None, description="시간점유율 (생략 시 자동 — 선종별 기존 GUI 규칙 적용)"
    )

    # Parameters for SCF of holes with sleeve
    plate_thickness_mm: float = Field(..., gt=0, description="플레이트 두께, mm")
    sleeve_outer_diameter_mm: float = Field(..., gt=0, description="슬리브 외경, mm")
    sleeve_thickness_mm: float = Field(..., gt=0, description="슬리브 두께, mm")
    welding_type: Literal["Full penetration", "Partial or Fillet"] = Field(
        default="Full penetration", description="용접 형식"
    )
    welding_throat_thickness_mm: float = Field(
        ..., gt=0, description="용접 throat 두께, mm"
    )
    welding_toe_grinding: Literal["Grinding", "No Grinding"] = Field(
        default="Grinding", description="용접 토우 그라인딩 여부"
    )

    # Parameters for allowable stress range
    probability_level_of_exceedance: float = Field(
        ..., gt=0, description="초과확률 수준 (예: 1e-8)"
    )
    weibull_shape_parameter: Optional[float] = Field(
        default=None, description="Weibull 형상모수 h (생략 시 자동)"
    )
    design_life_cycle: float = Field(..., gt=0, description="설계 수명 사이클")

    # Vertical wave bending moment range
    max_vertical_wave_bending_moment_knm: float = Field(
        ..., gt=0, description="최대 수직 파랑 굽힘 모멘트, kNm"
    )

    employee_id: str = Field(default="unknown", description="요청 사번")


@router.post("/calculate")
def calculate(
    body: HoleCalculationRequest,
    current_user: str = Depends(require_auth),
):
    """Hole fatigue assessment (DNVGL-RP-C203) 계산 실행."""
    payload = body.model_dump(exclude_none=True, exclude={"employee_id"})
    return run_hole_calculation(
        payload,
        authenticated_employee_id(body.employee_id, current_user),
    )
