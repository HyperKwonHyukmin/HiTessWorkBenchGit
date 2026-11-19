"""서버 권위형 HiTESS 소개자료 제공 라우터."""

import logging
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/presentations", tags=["presentations"])

_PRESENTATION_FILENAME = "hitess-launch-deck.html"
_FALLBACK_PRESENTATION_DIR = Path(__file__).resolve().parent.parent / "static" / "presentations"

# 구조 통찰 도면집(선박 구조 모션 페이지). 저장소 사본만 쓴다 → 145 반영은 git pull + 재시작.
_INSIGHT_FILENAME = "hitess-insight.html"


def _presentation_path() -> Path:
    """운영 override 또는 저장소 기준본의 고정 경로를 반환한다.

    파일명이나 경로를 요청에서 받지 않는다. 환경변수가 설정된 운영 환경에서는
    해당 디렉터리만 사용하며, 파일 누락을 개발 기준본으로 조용히 숨기지 않는다.
    """
    configured_dir = os.environ.get("INTRO_PRESENTATION_DIR", "").strip()
    presentation_dir = Path(configured_dir) if configured_dir else _FALLBACK_PRESENTATION_DIR
    return presentation_dir / _PRESENTATION_FILENAME


def _insight_path() -> Path:
    """구조 통찰 도면집의 고정 경로. 운영 override 없이 저장소 사본만 본다."""
    return _FALLBACK_PRESENTATION_DIR / _INSIGHT_FILENAME


def _serve_html(path: Path, label: str) -> HTMLResponse:
    """고정 경로의 UTF-8 HTML 을 캐시 없이 돌려준다. 경로는 응답에 싣지 않는다."""
    try:
        html = path.read_text(encoding="utf-8")
    except (FileNotFoundError, IsADirectoryError):
        raise HTTPException(status_code=404, detail=f"{label}를 찾을 수 없습니다.")
    except UnicodeDecodeError:
        logger.error("%s가 올바른 UTF-8이 아닙니다: %s", label, path)
        raise HTTPException(status_code=500, detail=f"{label} 형식이 올바르지 않습니다.")
    except OSError:
        logger.exception("%s를 읽지 못했습니다: %s", label, path)
        raise HTTPException(status_code=500, detail=f"{label}를 읽을 수 없습니다.")

    return HTMLResponse(
        content=html,
        status_code=200,
        headers={"Cache-Control": "no-store"},
    )


@router.get("/hitess-launch-deck", response_class=HTMLResponse)
def get_hitess_launch_deck() -> HTMLResponse:
    """현재 HiTESS 런칭 덱을 UTF-8 HTML로 반환한다."""
    return _serve_html(_presentation_path(), "HiTESS 소개자료")


@router.get("/hitess-insight", response_class=HTMLResponse)
def get_hitess_insight() -> HTMLResponse:
    """HiTESS 구조 통찰 도면집(일곱 장 모션 페이지)을 UTF-8 HTML로 반환한다."""
    return _serve_html(_insight_path(), "HiTESS 구조 통찰 자료")
