"""단면 특성값 계산 라우터."""
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from ..services.section_property_service import run_section_property

router = APIRouter(prefix="/api/section-property", tags=["section-property"])

SUPPORTED_SHAPES = {
    "rod":       {"label": "원형봉 (Rod)",        "params": ["d"]},
    "tube":      {"label": "원형관 (Tube)",        "params": ["d", "t"]},
    "rectangle": {"label": "직사각형 (Rectangle)", "params": ["b", "h"]},
    "rectTube":  {"label": "각형관 (Rect. Tube)",  "params": ["b", "h", "t"]},
    "ishape":    {"label": "I형강 (I-shape)",       "params": ["h", "bf", "tf", "tw"]},
    "channel":   {"label": "채널/C형강 (Channel)",  "params": ["h", "b", "tf", "tw"]},
    "angle":     {"label": "앵글/L형강 (Angle)",    "params": ["b", "h", "t"]},
    "tee":       {"label": "T형강 (Tee)",           "params": ["h", "bf", "tf", "tw"]},
    "polygon":   {"label": "임의 형상 (Polygon)",   "params": []},
}


class SectionPropertyRequest(BaseModel):
    shape: str = Field(..., description="단면 종류")
    params: dict = Field(default={}, description="단면별 치수 파라미터 (mm 단위)")
    vertices: Optional[list[dict]] = Field(default=None, description="polygon 꼭짓점 [{x,y}...] (polygon 형상 전용)")
    units: str = Field(default="mm", description="단위 (mm 또는 in)")
    employee_id: str = Field(default="unknown", description="요청 사번")


@router.post("/calculate")
def calculate(body: SectionPropertyRequest):
    """단면 형상과 치수를 입력하여 단면 특성값을 계산합니다."""
    if body.shape == "polygon":
        if not body.vertices or len(body.vertices) < 3:
            raise HTTPException(status_code=400, detail="polygon 형상은 vertices 3개 이상 필요합니다.")
    elif body.shape not in SUPPORTED_SHAPES:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 단면 종류입니다: {body.shape}. 지원 종류: {list(SUPPORTED_SHAPES.keys())}",
        )
    return run_section_property(body.shape, body.params, body.units, body.employee_id, body.vertices)


@router.get("/shapes")
def list_shapes():
    """지원하는 단면 종류 목록을 반환합니다."""
    return SUPPORTED_SHAPES
