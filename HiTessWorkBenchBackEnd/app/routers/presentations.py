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


def _presentation_path() -> Path:
    """운영 override 또는 저장소 기준본의 고정 경로를 반환한다.

    파일명이나 경로를 요청에서 받지 않는다. 환경변수가 설정된 운영 환경에서는
    해당 디렉터리만 사용하며, 파일 누락을 개발 기준본으로 조용히 숨기지 않는다.
    """
    configured_dir = os.environ.get("INTRO_PRESENTATION_DIR", "").strip()
    presentation_dir = Path(configured_dir) if configured_dir else _FALLBACK_PRESENTATION_DIR
    return presentation_dir / _PRESENTATION_FILENAME


@router.get("/hitess-launch-deck", response_class=HTMLResponse)
def get_hitess_launch_deck() -> HTMLResponse:
    """현재 HiTESS 런칭 덱을 UTF-8 HTML로 반환한다."""
    presentation_path = _presentation_path()
    try:
        html = presentation_path.read_text(encoding="utf-8")
    except (FileNotFoundError, IsADirectoryError):
        raise HTTPException(status_code=404, detail="HiTESS 소개자료를 찾을 수 없습니다.")
    except UnicodeDecodeError:
        logger.error("소개자료가 올바른 UTF-8이 아닙니다: %s", presentation_path)
        raise HTTPException(status_code=500, detail="HiTESS 소개자료 형식이 올바르지 않습니다.")
    except OSError:
        logger.exception("소개자료를 읽지 못했습니다: %s", presentation_path)
        raise HTTPException(status_code=500, detail="HiTESS 소개자료를 읽을 수 없습니다.")

    return HTMLResponse(
        content=html,
        status_code=200,
        headers={"Cache-Control": "no-store"},
    )
