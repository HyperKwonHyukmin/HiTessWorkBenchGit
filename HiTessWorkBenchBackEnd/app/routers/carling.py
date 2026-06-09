"""Carling 계산 라우터."""
from typing import Any, Literal, Optional

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..services.carling_service import run_carling
from ..services.carling_report_service import generate_report

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
    # Manual: 사용자가 plate_corrosion_mm 을 직접 지정(예: Free Calculator 결과 이관)
    corrosion_type: Literal["NON-CSR", "CSR-TANK", "Manual"] = "NON-CSR"
    plate_corrosion_mm: float = Field(..., ge=0)


class CarlingInput(BaseModel):
    material: Literal["Mild", "HT32", "HT36"] = "Mild"
    height_mm: RangeInput
    thickness_gross_mm: RangeInput


class CarlingFreeRequest(BaseModel):
    load: LoadInput
    hull: FreeHullInput
    safety_factor: float = Field(default=1.0, gt=0)
    employee_id: str = Field(default="unknown", description="요청 사번")


class CarlingOptimizationRequest(BaseModel):
    load: LoadInput
    hull: OptimizationHullInput
    carling: CarlingInput
    effective_breadth_mm: float = Field(default=600.0, gt=0)
    safety_factor: float = Field(default=1.0, gt=0)
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


class CarlingReportRequest(BaseModel):
    result: dict[str, Any] = Field(..., description="계산 결과 전체(solver 출력)")
    employee_id: str = Field(default="unknown", description="요청 사번")


def _report_response(result: dict, employee_id: str) -> Response:
    """결과를 DRM 템플릿에 채워 .xlsm 리포트(bytes)로 반환한다.

    Excel COM 자동화로 생성하므로 서버에 Excel + DRM 에이전트가 필요합니다.
    """
    filename, data = generate_report(result, employee_id)
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(
        content=data,
        media_type="application/vnd.ms-excel.sheet.macroEnabled.12",
        headers=headers,
    )


@router.post("/free/report")
def download_free_report(body: CarlingReportRequest):
    """Carling Free 결과를 .xlsm 리포트로 반환합니다."""
    return _report_response(body.result, body.employee_id)


@router.post("/optimization/report")
def download_optimization_report(body: CarlingReportRequest):
    """Carling Design Optimization 결과(최적안)를 .xlsm 리포트로 반환합니다."""
    return _report_response(body.result, body.employee_id)
