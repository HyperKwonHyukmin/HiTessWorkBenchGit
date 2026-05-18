"""Carling 계산 라우터."""
from typing import Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..services.carling_service import run_carling

router = APIRouter(prefix="/api/carling", tags=["carling"])


class LoadInput(BaseModel):
    type: Literal["concentrated", "distributed"] = "concentrated"
    value: float = Field(..., gt=0)
    position_mm: Optional[float] = Field(default=None, ge=0)


class FreeHullInput(BaseModel):
    plate_thickness_gross_mm: float = Field(..., gt=0)
    stiffener_span_mm: float = Field(..., gt=0)
    material: Literal["Mild", "HT32", "HT36"] = "Mild"
    corrosion_mm: float = Field(..., ge=0)


class RangeInput(BaseModel):
    min: float = Field(..., ge=0)
    max: float = Field(..., ge=0)
    step: float = Field(..., gt=0)


class OptimizationHullInput(BaseModel):
    plate_thickness_gross_mm: float = Field(..., gt=0)
    stiffener_span_mm: float = Field(..., gt=0)
    corrosion_type: Literal["NON-CSR", "CSR-TANK"] = "NON-CSR"
    plate_corrosion_mm: float = Field(..., ge=0)


class CarlingInput(BaseModel):
    material: Literal["Mild", "HT32", "HT36"] = "Mild"
    height_mm: RangeInput
    thickness_gross_mm: RangeInput


class CarlingFreeRequest(BaseModel):
    load: LoadInput
    hull: FreeHullInput
    safety_factor: float = Field(default=1.2, gt=0)
    employee_id: str = Field(default="unknown", description="요청 사번")


class CarlingOptimizationRequest(BaseModel):
    load: LoadInput
    hull: OptimizationHullInput
    carling: CarlingInput
    effective_breadth_mm: float = Field(default=600.0, gt=0)
    safety_factor: float = Field(default=1.2, gt=0)
    employee_id: str = Field(default="unknown", description="요청 사번")


@router.post("/free")
def calculate_free(body: CarlingFreeRequest):
    """01_Carling Free Calculator 계산을 수행합니다."""
    inputs = body.model_dump(exclude={"employee_id"})
    return run_carling(inputs, body.employee_id, "free")


@router.post("/optimization")
def calculate_optimization(body: CarlingOptimizationRequest):
    """02_Carling Design Optimization 계산을 수행합니다."""
    inputs = body.model_dump(exclude={"employee_id"})
    return run_carling(inputs, body.employee_id, "optimization")
