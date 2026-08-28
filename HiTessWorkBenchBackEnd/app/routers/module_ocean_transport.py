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

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from .. import database
from ..dependencies import require_auth
from ._access_control import assert_current_user_can_access_path
from ..services.groupmoduleunit_service import task_execute_groupmoduleunit
from ..services.module_ocean_transport_service import (
    DEFAULT_DECK_TYPE,
    ModelParseError,
    get_jungban_viewer_model,
    get_model_viewer_payload,
    list_jungban_deck_types,
)
from ._intake import make_work_dir, submit_analysis_job
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

    work_dir, timestamp = make_work_dir(employee_id, "GroupModuleUnit")
    bdf_path = os.path.join(work_dir, os.path.basename(bdf_src))
    shutil.copyfile(bdf_src, bdf_path)

    job_id = submit_analysis_job(
        task_execute_groupmoduleunit,
        bdf_path, work_dir, employee_id, timestamp, SAMPLE_SOURCE_TAG, False,  # use_nastran=False
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
