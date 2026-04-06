"""다빗(Davit) 구조 설계 계산 라우터."""
from fastapi import APIRouter
from pydantic import BaseModel, Field
from ..services.davit_service import run_mast_post, run_jib_rest_1dan, run_jib_rest_2dan

router = APIRouter(prefix="/api/davit", tags=["davit"])


class MastPostRequest(BaseModel):
    height_mm: float = Field(..., gt=0, description="Post 전체 높이 (mm)")
    weight_kg: float = Field(..., gt=0, description="플랫폼 하중 (kg)")
    employee_id: str = Field(default="unknown", description="요청 사번")


class JibRest1DanRequest(BaseModel):
    jh: float = Field(..., gt=0, description="Jib 높이 (mm)")
    jb: float = Field(..., gt=0, description="Jib 폭 (mm)")
    wj: float = Field(..., gt=0, description="Jib 자중 (kg)")
    ww: float = Field(..., gt=0, description="윈치+받침대 자중 (kg)")
    wc: float = Field(..., gt=0, description="실린더 자중 (kg)")
    lj: float = Field(..., gt=0, description="Jib 모멘트 팔 (mm)")
    lw: float = Field(..., gt=0, description="윈치 모멘트 팔 (mm)")
    lc: float = Field(..., gt=0, description="실린더 모멘트 팔 (mm)")
    lr: float = Field(..., gt=0, description="Jib Rest 모멘트 팔 (mm)")
    h1: float = Field(..., gt=0, description="Jib Rest 전체 높이 (mm)")
    h4: float = Field(..., gt=0, description="플랫폼 높이 (mm)")
    pw: float = Field(..., gt=0, description="플랫폼 자중 (kg)")
    employee_id: str = Field(default="unknown")


class JibRest2DanRequest(JibRest1DanRequest):
    h2: float = Field(..., gt=0, description="상단 파이프 구간 높이 (mm)")
    h3: float = Field(..., gt=0, description="Reducer 높이 (mm)")
    d1: float = Field(..., gt=0, description="하단 파이프 외경 (mm)")
    t1: float = Field(..., gt=0, description="하단 파이프 두께 (mm)")


@router.post("/jib-rest-1dan")
def jib_rest_1dan(body: JibRest1DanRequest):
    """Jib Rest 1단 구조 설계 계산."""
    inputs = body.model_dump(exclude={"employee_id"})
    return run_jib_rest_1dan(inputs, body.employee_id)


@router.post("/jib-rest-2dan")
def jib_rest_2dan(body: JibRest2DanRequest):
    """Jib Rest 2단 구조 설계 계산."""
    inputs = body.model_dump(exclude={"employee_id"})
    return run_jib_rest_2dan(inputs, body.employee_id)


@router.post("/mast-post")
def mast_post(body: MastPostRequest):
    """
    Mast/Post 구조 설계 계산.
    기준을 만족하는 파이프 후보(1~5순위)를 반환합니다.
    결과는 userConnection/{timestamp}_{employee_id}_PostDavitCalculation/result.json 에 저장됩니다.
    """
    return run_mast_post(body.height_mm, body.weight_kg, body.employee_id)
