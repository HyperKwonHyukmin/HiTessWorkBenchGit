"""
Module Unit 해상 운송 구조 해석 라우터.

현재는 2단계(정반 상부 Module Unit 배치 설정) 유한요소 뷰어가 쓰는
**모델 지오메트리 공급**만 담당한다.

  GET /api/analysis/module-ocean-transport/jungban-model
      프로그램 내장 고정 정반 모델(뷰어용 슬림 지오메트리).

  GET /api/analysis/module-ocean-transport/viewer-model?model_json=<경로>
      1단계 검증이 만든 JSON_ModelInfo 를 같은 슬림 포맷으로 변환해 준다.
      원본 모델 JSON 은 37MB 급이라 브라우저가 직접 받으면 안 된다.

두 응답 모두 서버에서 gzip 으로 눌러 보낸다(백엔드에 GZipMiddleware 가 없다).
"""
from __future__ import annotations

import gzip
import json
import logging
import os
import shutil
import urllib.parse
from typing import Any, Literal, Optional

from fastapi import (
    APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile,
)
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, model_validator

from .. import database, models
from ..dependencies import require_auth
from ._access_control import (
    assert_current_user_can_access_owner,
    assert_current_user_can_access_path,
)
from ..services.groupmoduleunit_service import task_execute_groupmoduleunit
from ..services.job_manager import JobMetadata
from ..services.module_ocean_structural_service import (
    PROGRAM_NAME as STRUCTURAL_PROGRAM_NAME,
    reassess_weld,
    task_execute_ocean_structural,
)
from ..services.module_ocean_acceleration import (
    BargeAccelerationError,
    calculate_barge_acceleration,
    normalize_load_cases,
)
from ..services.module_ocean_bdf import DEFAULT_SMALL_BORE_MAX_OD_MM
from ..services.module_ocean_merge import DEFAULT_CLEARANCE_MM
from ..services.module_ocean_figures import render_report_figures
from ..services.module_ocean_report import build_module_ocean_report
from ..services.module_ocean_weld import DEFAULT_WELD_SPEC
from ..services.module_ocean_transport_service import (
    DEFAULT_DECK_TYPE,
    ModelParseError,
    get_jungban_viewer_model,
    get_model_viewer_payload,
    list_jungban_deck_types,
)
from ._intake import make_work_dir, save_upload, submit_analysis_job
# 샘플 실행 쿼터는 analysis.py 의 공용 트래커를 그대로 쓴다 —
# 앱마다 dict 를 따로 두면 한도 정책이 갈라진다(analysis.py 는 이 모듈을 import 하지 않아 순환 없음).
from .analysis import (
    SAMPLE_DAILY_LIMIT,
    SAMPLE_SOURCE_TAG,
    _check_sample_quota,
    _consume_sample_quota,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analysis/module-ocean-transport", tags=["module-ocean-transport"])

_ROUTER_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.abspath(os.path.join(_ROUTER_DIR, "..", ".."))
_USER_CONNECTION_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))


def _is_within_dir(base_dir: str, candidate_path: str) -> bool:
    """candidate_path 가 base_dir 안인지. Windows 대소문자 차이까지 normcase 로 흡수한다."""
    try:
        base = os.path.normcase(os.path.abspath(base_dir))
        candidate = os.path.normcase(os.path.abspath(candidate_path))
        return os.path.commonpath([base, candidate]) == base
    except ValueError:
        return False


def _gzip_json(payload: dict, request: Request) -> Response:
    """
    슬림 지오메트리는 수 MB 라 압축이 필수다(정반 기준 약 3.5MB → 1MB 내외).
    클라이언트가 gzip 을 안 받는다고 하면 원본 JSON 을 그대로 돌려준다.
    """
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    accepts_gzip = "gzip" in (request.headers.get("accept-encoding") or "").lower()
    if not accepts_gzip:
        return Response(content=body, media_type="application/json")
    compressed = gzip.compress(body, compresslevel=6)
    return Response(
        content=compressed,
        media_type="application/json",
        headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"},
    )


@router.get("/jungban-decks")
def jungban_decks(current_user: str = Depends(require_auth)):
    """
    선택 가능한 정반 타입 목록과 제원(치수·상면고·요소 수)을 반환합니다.

    지오메트리는 빼고 제원만 담아 선택 화면이 즉시 뜨게 합니다.
    미리보기 3D 는 프론트가 /jungban-model?deck_type=.. 으로 따로 받습니다.
    """
    return {"decks": list_jungban_deck_types(), "default": DEFAULT_DECK_TYPE}


@router.get("/jungban-model")
def jungban_model(
    request: Request,
    deck_type: str = Query(DEFAULT_DECK_TYPE, description="정반 타입 id (A/B)"),
    current_user: str = Depends(require_auth),
):
    """
    선택된 타입의 고정 정반 모델을 뷰어용 지오메트리로 반환합니다.

    Module Unit BDF 는 입력에 따라 달라지지만 정반은 타입별로 고정이므로,
    최초 1회 파싱 결과를 메모리·디스크에 캐시해 이후 요청은 즉시 응답합니다.
    """
    try:
        payload = get_jungban_viewer_model(deck_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except ModelParseError as exc:
        logger.error("[ModuleOceanTransport] 정반(%s) 모델 준비 실패: %s", deck_type, exc)
        raise HTTPException(status_code=503, detail=str(exc))
    return _gzip_json(payload, request)


@router.get("/viewer-model")
def viewer_model(
    request: Request,
    model_json: str = Query(..., description="userConnection 하위 모델 JSON 경로"),
    name: str = Query("model", description="뷰어에 표시할 파트 이름"),
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """
    1단계 검증이 만든 모델 JSON(JSON_ModelInfo)을 뷰어용 지오메트리로 변환해 반환합니다.

    보안: /api/download 와 동일하게 userConnection/ 안의 경로만 허용하고,
    해당 작업 폴더의 소유자 권한까지 확인합니다.
    """
    decoded = os.path.abspath(urllib.parse.unquote(model_json))
    if not _is_within_dir(_USER_CONNECTION_DIR, decoded):
        raise HTTPException(status_code=403, detail="접근 권한이 없는 경로입니다.")
    assert_current_user_can_access_path(decoded, current_user, db, _USER_CONNECTION_DIR)

    try:
        payload = get_model_viewer_payload(decoded, name=name)
    except ModelParseError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"모델 JSON 을 읽을 수 없습니다: {exc}")
    return _gzip_json(payload, request)


# ==================== 샘플 실행 (1-click 데모) ====================
#
# Group & Module Unit 권상 구조 해석의 샘플 실행과 **동일한 구성**이다.
#   · 사번별 일일 1회(관리자 무제한) — 쿼터 카운터는 analysis.py 의 공용 트래커를 공유하되
#     program_key 를 분리해 GMU 샘플과 횟수를 나눠 쓴다.
#   · source=WorkbenchSample 로 기록 → 사용 기록/통계/사용자 이력에서 모두 제외된다.
#   · use_nastran=False — 샘플은 입력 파싱 검증까지만 즉시 보여 주는 학습용이다.
#
# 이 앱의 1단계 검증은 GMU 검증 엔진(task_execute_groupmoduleunit)을 그대로 재사용하므로
# (프론트 requestModuleOceanTransport 도 /api/analysis/groupmoduleunit/request 를 호출한다)
# 샘플도 같은 태스크·같은 program_name 으로 돌려 결과 스키마를 완전히 일치시킨다.
# 그래야 2단계 뷰어가 쓰는 result_info.JSON_ModelInfo 가 동일하게 나온다.

# userConnection 작업 폴더명이자 DB program_name.
# 1단계 검증 엔진(task_execute_groupmoduleunit)은 GMU 것을 그대로 재사용하되,
# **폴더와 기록은 이 앱 이름으로 남긴다** — 그래야 사용자가 해석 산출물을 찾을 수 있고
# 2·3단계가 만드는 파일이 GMU 작업 폴더에 섞이지 않는다.
# (SidePassage 가 같은 엔진을 쓰면서 자기 이름으로 폴더를 만드는 것과 같은 방식이다.)
PROGRAM_NAME = "ModuleOceanMoving"

_SAMPLE_PROGRAM_KEY = "moduleoceantransport"
_SAMPLE_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "SampleFile", "ModuleOceanMoving"))


@router.get("/sample-status")
def get_module_ocean_sample_status(
    employee_id: str = Depends(require_auth),
    db: Session = Depends(database.get_db),
):
    """샘플 실행 잔여 횟수. SampleRunButton 이 마운트 시 프리페치한다."""
    quota = _check_sample_quota(_SAMPLE_PROGRAM_KEY, employee_id, db)
    return {
        "remaining": quota["remaining"],
        "limit": SAMPLE_DAILY_LIMIT,
        "is_admin": quota["is_admin"],
    }


@router.post("/run-sample")
def run_module_ocean_sample(
    employee_id: str = Depends(require_auth),
    db: Session = Depends(database.get_db),
):
    """사내 표준 샘플 Module Unit BDF 로 1단계 입력 검증을 즉시 실행한다."""
    quota = _check_sample_quota(_SAMPLE_PROGRAM_KEY, employee_id, db)
    if not quota["allowed"]:
        raise HTTPException(status_code=429, detail=quota["reason"])

    if not os.path.isdir(_SAMPLE_DIR):
        raise HTTPException(status_code=404, detail="샘플 폴더(SampleFile/ModuleOceanMoving)가 없습니다.")
    bdf_src = next(
        (os.path.join(_SAMPLE_DIR, f) for f in sorted(os.listdir(_SAMPLE_DIR)) if f.lower().endswith(".bdf")),
        None,
    )
    if not bdf_src:
        raise HTTPException(status_code=404, detail="샘플 BDF 파일을 찾을 수 없습니다.")

    work_dir, timestamp = make_work_dir(employee_id, PROGRAM_NAME)
    bdf_path = os.path.join(work_dir, os.path.basename(bdf_src))
    shutil.copyfile(bdf_src, bdf_path)

    job_id = submit_analysis_job(
        task_execute_groupmoduleunit,
        bdf_path, work_dir, employee_id, timestamp, SAMPLE_SOURCE_TAG,
        False,            # use_nastran — 샘플은 입력 파싱까지만
        PROGRAM_NAME,
        owned_work_dir=work_dir,
    )
    if not quota["is_admin"]:
        _consume_sample_quota(_SAMPLE_PROGRAM_KEY, employee_id)
    return {
        "job_id": job_id,
        "source": SAMPLE_SOURCE_TAG,
        "remaining": SAMPLE_DAILY_LIMIT if quota["is_admin"] else 0,
        "is_admin": quota["is_admin"],
    }


# ── 1단계: Module Unit BDF 입력 검증 ─────────────────────────────────────
# 검증 엔진은 GMU 것을 재사용하지만 **작업 폴더와 DB 기록은 이 앱 이름** 으로 남긴다.
# 예전에는 프론트가 /api/analysis/groupmoduleunit/request 를 직접 불러 폴더가
# `..._GroupModuleUnit` 으로 만들어졌고, 3단계 산출물까지 그 안에 쌓여
# 사용자가 어느 앱의 해석인지 구분할 수 없었다. 앱 가용성 게이트도 GMU 기준으로
# 걸려 이 앱을 점검 중으로 내려도 업로드가 막히지 않았다.


@router.post("/request")
async def request_module_ocean_transport(
    bdf_file: UploadFile = File(...),
    employee_id: str = Form(...),
    use_nastran: bool = Form(False),
    source: str = Form("Workbench"),
    current_user: str = Depends(require_auth),
):
    """Module Unit 해상 운송 구조 해석 — 1단계 BDF 입력 검증."""
    # Form 의 사번은 클라이언트 임의값이라 인증 토큰과 대조해야 한다.
    if employee_id != current_user:
        raise HTTPException(status_code=403, detail="본인 사번으로만 요청할 수 있습니다.")

    work_dir, timestamp = make_work_dir(employee_id, PROGRAM_NAME)
    bdf_path = await save_upload(bdf_file, work_dir, error_prefix="파일 저장 오류")
    job_id = submit_analysis_job(
        task_execute_groupmoduleunit,
        bdf_path, work_dir, employee_id, timestamp, source, use_nastran, PROGRAM_NAME,
        owned_work_dir=work_dir,
    )
    return {"job_id": job_id}


# ── 3단계: 구조 해석 수행 ─────────────────────────────────────────────────
# 과정 1(MU 단독 응력) + 과정 2(Leg 반력)를 한 job 으로 순차 실행한다.
# 버튼 하나가 결과 한 세트를 만드는 구조다.

class AccelInput(BaseModel):
    """중력을 포함한 총 가속도[g]. 정지 상태 = (0, 0, -1)."""

    ax: float = 0.0
    ay: float = 0.0
    az: float = -1.0


class BargeAccelerationInput(BaseModel):
    """Barge 가속도 원본 Excel의 사용자 입력 셀과 선택 LC."""

    significantWaveHeightM: float = 2.0
    criticalDampingPct: Literal[3, 5] = 3
    cargoPosition: Literal["single-center", "multiple-offset"] = "single-center"
    cargoWeightT: float = 207.7
    cargoVcgFromBottomM: float = 1.2
    bargeDepthM: float = 4.5
    supportHeightM: float = 3.4
    # ±Y 를 포함한 8개. LC1~4 는 y 가 항상 + 라 그 자체로는 포락이 아니다.
    loadCase: Literal["LC1", "LC2", "LC3", "LC4",
                      "LC5", "LC6", "LC7", "LC8"] = "LC1"


def _calculate_barge_acceleration(body: BargeAccelerationInput) -> dict:
    try:
        return calculate_barge_acceleration(
            significant_wave_height_m=body.significantWaveHeightM,
            critical_damping_pct=body.criticalDampingPct,
            cargo_position=body.cargoPosition,
            cargo_weight_t=body.cargoWeightT,
            cargo_vcg_from_bottom_m=body.cargoVcgFromBottomM,
            barge_depth_m=body.bargeDepthM,
            support_height_m=body.supportHeightM,
            load_case=body.loadCase,
        )
    except BargeAccelerationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/acceleration-calculate")
def calculate_module_ocean_acceleration(
    body: BargeAccelerationInput,
    _employee_id: str = Depends(require_auth),
):
    """원본 Barge Excel과 같은 보간으로 선택한 LC 한 개를 계산한다."""
    return _calculate_barge_acceleration(body)


class MaterialInput(BaseModel):
    sigmaYMPa: float = Field(275.0, gt=0)      # SS275
    factor: float = Field(0.8, gt=0, le=1.0)   # 허용 = 0.8 × σy = 220 MPa


class WeldSpecInput(BaseModel):
    """네 면 중앙 4분절 용접부 사양.

    상한을 두는 이유는 오타 방어다 — 각장에 800 을 치면 용접 면적이 백 배가 되어
    무엇이든 OK 로 나오는데, 화면에는 그저 통과로만 보인다.
    """

    yieldMPa: float = Field(DEFAULT_WELD_SPEC["yieldMPa"], gt=0, le=2000)
    safetyFactor: float = Field(DEFAULT_WELD_SPEC["safetyFactor"], gt=0, le=20)
    plateHeightMm: float = Field(DEFAULT_WELD_SPEC["plateHeightMm"], gt=0, le=10000)
    plateBreadthMm: float = Field(DEFAULT_WELD_SPEC["plateBreadthMm"], gt=0, le=10000)
    tackCount: int = Field(int(DEFAULT_WELD_SPEC["tackCount"]), ge=4, le=4)
    weldLengthMm: float = Field(DEFAULT_WELD_SPEC["weldLengthMm"], gt=0, le=5000)
    weldLegMm: float = Field(DEFAULT_WELD_SPEC["weldLegMm"], gt=0, le=200)
    # schema v1 호환 입력. 검증 전에 새 직사각형 치수로 확장하고 응답에서는 숨긴다.
    padSizeMm: float | None = Field(None, gt=0, le=10000, exclude=True)

    @model_validator(mode="before")
    @classmethod
    def expand_legacy_square_pad(cls, data):
        if not isinstance(data, dict) or data.get("padSizeMm") is None:
            return data
        expanded = dict(data)
        expanded.setdefault("plateHeightMm", expanded["padSizeMm"])
        expanded.setdefault("plateBreadthMm", expanded["padSizeMm"])
        return expanded

    @model_validator(mode="after")
    def weld_must_fit_plate(self):
        shortest_side = min(self.plateHeightMm, self.plateBreadthMm)
        if self.weldLengthMm > shortest_side:
            raise ValueError(
                "용접 길이는 Plate 높이와 폭보다 클 수 없습니다 "
                f"(용접 {self.weldLengthMm:g} mm, 최소 변 {shortest_side:g} mm)."
            )
        return self


class PlacementInput(BaseModel):
    """2단계에서 확정한 적치 배치. 서버가 Module Unit 절점을 정반 좌표로 옮길 때 쓴다.

    deckCenterMm/deckTopZMm 은 화면이 계산한 값이다. 서버도 정반 BDF 에서 같은 값을
    다시 찾아 **대조**한다 — 어긋나면 사용자가 본 자리와 다른 자리에서 해석이 돈다.
    """

    anchorMm: list[float]                      # 모듈 bbox XY 중심 + 최저 Z
    rotationZDeg: float = 0.0
    offsetXMm: float = 0.0
    offsetYMm: float = 0.0
    deckCenterMm: list[float] | None = None
    deckTopZMm: float | None = None
    # 화면이 계산한 적치 높이(기준 적치면 대비). 서버도 지지점 발밑 적치면에서 다시
    # 계산해 대조한다 — 2단 정반의 층 판정이 어긋나면 여기서 걸린다.
    gapMm: float | None = None

    @model_validator(mode="after")
    def coordinates_must_be_complete(self):
        if len(self.anchorMm) != 3:
            raise ValueError("anchorMm 은 [x, y, z] 3개여야 합니다.")
        if self.deckCenterMm is not None and len(self.deckCenterMm) != 2:
            raise ValueError("deckCenterMm 은 [x, y] 2개여야 합니다.")
        return self


class StructuralRunRequest(BaseModel):
    bdf_path: str
    deck_type: str = DEFAULT_DECK_TYPE
    support_node_ids: list[int]
    placement: PlacementInput
    # 정반 적치면과 지지점 사이 이격. 사용자 결정으로 DEFAULT_CLEARANCE_MM 고정이며,
    # 이 값 덕분에 어떤 부재도 정반 쉘을 통과할 수 없다(하한도 같은 상수라 더 낮출 수 없다).
    clearance_mm: float = Field(DEFAULT_CLEARANCE_MM, ge=DEFAULT_CLEARANCE_MM, le=5000.0)
    # 판정에서 뺄 소구경 배관의 외경 상한(mm). 0 = 제외 안 함.
    # 상한 200mm 는 "소구경"이라 부를 수 있는 범위의 끝이다 — 그보다 크면 사실상
    # 배관 전체를 빼는 것이라 부재 평가라는 취지가 무너진다.
    small_bore_max_od_mm: float = Field(DEFAULT_SMALL_BORE_MAX_OD_MM, ge=0.0, le=200.0)
    deck_contingency_pct: float = Field(0.0, ge=-50.0, le=200.0)
    module_contingency_pct: float = Field(0.0, ge=-50.0, le=200.0)
    total_mass_t: float = Field(..., gt=0)
    total_cog_mm: list[float]
    accel: AccelInput = AccelInput()
    # 있으면 서버가 다시 계산해 accel과 일치하는지 확인하고 해석 이력에도 남긴다.
    accelerationCalculation: BargeAccelerationInput | None = None
    # 포락할 하중조건. 비우면 8개 전부다. accelerationCalculation 이 있어야 의미가
    # 있다 — 부호만 다른 조건들의 가속도는 **서버가 원본 표에서 직접** 만든다.
    load_cases: list[str] | None = None
    material: MaterialInput = MaterialInput()
    weld: WeldSpecInput = WeldSpecInput()
    parent_analysis_id: int | None = None


@router.post("/structural-run")
def run_structural_analysis(
    body: StructuralRunRequest,
    employee_id: str = Depends(require_auth),
    db: Session = Depends(database.get_db),
):
    """2단계 적치 결과로 정반 + Module Unit 합본 모델을 한 번 풀어

    ① Module Unit 부재 응력 ② 정반 Leg 반력·용접 판정 을 함께 낸다."""
    bdf_path = os.path.abspath(body.bdf_path)
    if not _is_within_dir(_USER_CONNECTION_DIR, bdf_path) or not os.path.isfile(bdf_path):
        raise HTTPException(status_code=400, detail="BDF 경로가 올바르지 않습니다.")
    assert_current_user_can_access_path(bdf_path, employee_id, db, _USER_CONNECTION_DIR)

    if not body.support_node_ids:
        raise HTTPException(status_code=400,
                            detail="지지점이 없습니다. 2단계에서 지지점을 먼저 지정하세요.")
    if len(body.total_cog_mm) != 3:
        raise HTTPException(status_code=400, detail="무게중심 좌표는 [x, y, z] 3개여야 합니다.")

    accel = body.accel
    acceleration_calculation = None
    load_cases: list[dict] = []
    if body.accelerationCalculation is not None:
        acceleration_calculation = _calculate_barge_acceleration(body.accelerationCalculation)
        expected = acceleration_calculation["totalAccelerationG"]
        supplied = {"ax": accel.ax, "ay": accel.ay, "az": accel.az}
        if any(abs(float(supplied[key]) - float(expected[key])) > 1e-8 for key in supplied):
            raise HTTPException(
                status_code=400,
                detail="가속도 계산 입력과 구조 해석 가속도가 일치하지 않습니다. 다시 계산해주세요.",
            )
        # 포락에 쓸 LC 가속도는 **서버가 원본 표에서 직접** 만든다. 클라이언트가
        # 8개 벡터를 보내면 그중 하나만 조작해도 알아챌 방법이 없다.
        try:
            chosen = normalize_load_cases(body.load_cases)
        except BargeAccelerationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        load_cases = [
            {"id": case_id,
             "label": acceleration_calculation["loadCases"][case_id]["signs"],
             "accelG": acceleration_calculation["loadCases"][case_id]["totalAccelerationG"]}
            for case_id in chosen
        ]
    elif body.load_cases:
        raise HTTPException(
            status_code=400,
            detail="하중조건을 포락하려면 Barge 가속도 계산 입력이 필요합니다.",
        )
    if (accel.ax ** 2 + accel.ay ** 2 + accel.az ** 2) <= 0.0:
        raise HTTPException(status_code=400,
                            detail="가속도 크기가 0 입니다. 하중이 없어 해석할 수 없습니다.")

    known_decks = {deck["id"] for deck in list_jungban_deck_types()}
    if body.deck_type not in known_decks:
        raise HTTPException(status_code=400,
                            detail=f"알 수 없는 정반 타입입니다: {body.deck_type}")

    payload = {
        "employee_id": employee_id,
        "bdf_path": bdf_path,
        "work_dir": os.path.dirname(bdf_path),
        "deck_type": body.deck_type,
        "support_node_ids": body.support_node_ids,
        "placement": body.placement.model_dump(),
        "clearance_mm": body.clearance_mm,
        "small_bore_max_od_mm": body.small_bore_max_od_mm,
        "deck_contingency_pct": body.deck_contingency_pct,
        "module_contingency_pct": body.module_contingency_pct,
        "total_mass_t": body.total_mass_t,
        "total_cog_mm": body.total_cog_mm,
        "accel": accel.model_dump(),
        "load_cases": load_cases,
        "acceleration_calculation": acceleration_calculation,
        "material": body.material.model_dump(),
        "weld_spec": body.weld.model_dump(),
        "parent_analysis_id": body.parent_analysis_id,
        "source": "web",
    }
    job_id = submit_analysis_job(
        task_execute_ocean_structural, payload,
        queue_message="구조 해석 대기 중...",
        # payload 가 dict 하나뿐이라 소유자 추론이 안 된다 — 명시적으로 넘긴다.
        metadata=JobMetadata(employee_id=employee_id,
                             program_name=STRUCTURAL_PROGRAM_NAME),
    )
    logger.info("[ModuleOceanTransport] 구조 해석 제출 job=%s deck=%s supports=%d lc=%s",
                job_id, body.deck_type, len(body.support_node_ids),
                [case["id"] for case in load_cases] or ["단일"])
    return {"job_id": job_id}


class StructuralReportRequest(BaseModel):
    """보고서는 **해석 레코드 하나만** 있으면 만들어진다.

    예전에는 결과 파일 경로 3개와 화면 캡처 PNG 를 클라이언트가 올려 보냈다. 그러면
    해석 화면이 떠 있어야만 보고서가 나오고 이력에서 다시 뽑을 수 없다 — Unit 권상
    보고서(`/analysis/unit-structural/report`)와 같은 규약으로 맞췄다.
    """

    analysis_id: int
    metadata: dict = Field(default_factory=dict)


def _report_result_path(result_info: dict, *section: str) -> Optional[str]:
    """result_info 안의 결과 파일 경로를 꺼낸다(없으면 None)."""
    node: Any = result_info
    for key in section:
        node = (node or {}).get(key) if isinstance(node, dict) else None
    return node if isinstance(node, str) and node else None


@router.post("/structural-report")
def create_structural_report(
    body: StructuralReportRequest,
    employee_id: str = Depends(require_auth),
    db: Session = Depends(database.get_db),
):
    """저장된 구조해석 결과로 XLSX 보고서를 만든다. 그림은 백엔드가 직접 그린다."""
    record = db.query(models.Analysis).filter(models.Analysis.id == body.analysis_id).first()
    if record is None:
        raise HTTPException(status_code=404,
                            detail=f"구조 해석 결과(id={body.analysis_id})를 찾을 수 없습니다.")
    assert_current_user_can_access_owner(record.employee_id, employee_id, db)
    if record.program_name != STRUCTURAL_PROGRAM_NAME:
        raise HTTPException(status_code=400,
                            detail=f"지원하지 않는 해석 종류입니다: {record.program_name}")
    if record.status != "Success":
        raise HTTPException(status_code=409,
                            detail="성공한 구조 해석 결과에서만 보고서를 생성할 수 있습니다.")

    result_info = dict(record.result_info or {})
    stress_path = _report_result_path(result_info, "stress", "resultJson")
    if not stress_path:
        raise HTTPException(status_code=409, detail="부재 응력 결과 파일이 기록되어 있지 않습니다.")

    paths: list[Optional[str]] = []
    for label, candidate in (
        ("부재 응력", stress_path),
        ("Leg 반력", _report_result_path(result_info, "legReaction", "resultJson")),
        ("Leg 용접", _report_result_path(result_info, "weld", "resultJson")),
    ):
        if not candidate:
            paths.append(None)
            continue
        path = os.path.abspath(candidate)
        if not _is_within_dir(_USER_CONNECTION_DIR, path) or not os.path.isfile(path):
            # 응력은 필수, 나머지는 없으면 그 절만 비운다.
            if label == "부재 응력":
                raise HTTPException(status_code=409,
                                    detail=f"{label} 결과 파일을 찾을 수 없습니다: {candidate}")
            paths.append(None)
            continue
        assert_current_user_can_access_path(path, employee_id, db, _USER_CONNECTION_DIR)
        paths.append(path)

    # ── 그림: 합본 BDF 에서 서버가 직접 그린다 ─────────────────────────────
    figures: dict = {}
    warnings: list[str] = []
    combined_bdf = result_info.get("combined_bdf") or _report_result_path(
        result_info, "stress", "bdf")
    id_offset = ((result_info.get("model") or {}).get("idOffset"))
    if not combined_bdf or not os.path.isfile(combined_bdf):
        warnings.append("합본 BDF 가 없어 3D 그림을 그리지 못했습니다.")
    elif id_offset is None:
        warnings.append("ID offset 기록이 없어 3D 그림을 그리지 못했습니다.")
    else:
        bdf_path = os.path.abspath(combined_bdf)
        if not _is_within_dir(_USER_CONNECTION_DIR, bdf_path):
            raise HTTPException(status_code=400, detail="합본 BDF 경로가 올바르지 않습니다.")
        assert_current_user_can_access_path(bdf_path, employee_id, db, _USER_CONNECTION_DIR)
        try:
            stress_json = json.loads(open(paths[0], encoding="utf-8").read())
            figures, figure_errors = render_report_figures(
                stress=stress_json, bdf_path=bdf_path, id_offset=int(id_offset),
                load_case_ids=[str(case.get("id")) for case
                               in (result_info.get("stress") or {}).get("loadCases") or []],
            )
            warnings += [f"{key}: {reason}" for key, reason in figure_errors.items()]
        except Exception as exc:                                   # noqa: BLE001
            logger.exception("[ModuleOceanTransport] 보고서 그림 렌더 실패 id=%s", body.analysis_id)
            warnings.append(f"3D 그림 렌더 실패: {exc}")

    try:
        filename, data, report_meta = build_module_ocean_report(
            stress_json_path=paths[0], leg_json_path=paths[1], weld_json_path=paths[2],
            figures=figures, metadata=body.metadata, figure_warnings=warnings,
        )
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    encoded = urllib.parse.quote(filename)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded}",
            "X-Report-Filename": encoded,
            "X-Report-Summary": urllib.parse.quote(
                json.dumps(report_meta, ensure_ascii=False)),
        },
    )


# ── 과정 2 이어서: Leg 용접부 재평가 ─────────────────────────────────────
# 용접 사양(각장·용접길이·tack 개수…)은 반력과 무관하다. 사양을 만질 때마다
# 20분짜리 Nastran 을 다시 돌릴 이유가 없으므로, 저장된 반력으로 판정만 다시 한다.


class WeldAssessRequest(BaseModel):
    leg_result_json: str
    weld: WeldSpecInput = WeldSpecInput()


@router.post("/weld-assess")
def assess_leg_weld(
    body: WeldAssessRequest,
    employee_id: str = Depends(require_auth),
    db: Session = Depends(database.get_db),
):
    """저장된 Leg 반력으로 정반 Leg 용접부를 다시 평가한다(재해석 없음)."""
    leg_json = os.path.abspath(body.leg_result_json)
    if not _is_within_dir(_USER_CONNECTION_DIR, leg_json) or not os.path.isfile(leg_json):
        raise HTTPException(status_code=400, detail="Leg 반력 결과 경로가 올바르지 않습니다.")
    assert_current_user_can_access_path(leg_json, employee_id, db, _USER_CONNECTION_DIR)

    try:
        return reassess_weld(leg_json, body.weld.model_dump())
    except ValueError as exc:
        # 사양이 잘못됐다는 뜻이라 화면에 그대로 띄운다(어느 항목인지 문장에 들어 있다).
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400,
                            detail="Leg 반력 결과 파일을 읽을 수 없습니다.") from exc
