"""사용자 환경설정 API — GET/PUT /api/preferences (스펙 §4.3).

- GET: 저장값 위에 기본값을 채운 4키 dict 를 돌려준다. 행이 없어도 사이드 이펙트 없음.
- PUT: 부분 병합. 화이트리스트(4키) 밖은 조용히 무시하고 `ignored_keys` 로 응답.
  값 형식/어휘 오류는 422(HTTPException).
- 인증은 `require_auth` 만. 관리자 구분 없음(본인 행만 접근).
- 플랫폼 공통 기능이라 `app_settings.GUARDED_ROUTES` 에 등록하지 않는다.
"""
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import database
from ..dependencies import require_auth
from ..services.user_preferences_service import get_prefs, upsert_prefs

router = APIRouter(prefix="/api/preferences", tags=["preferences"])


@router.get("")
def read_preferences(
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """내 환경설정을 돌려준다(4키를 모두 포함하는 실효값)."""
    prefs, updated_at = get_prefs(db, me)
    return {
        "prefs": prefs,
        "updated_at": updated_at.isoformat() if updated_at else None,
    }


@router.put("")
def update_preferences(
    payload: Any = Body(default=None),
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """부분 병합 저장.

    본문은 반드시 객체여야 한다(리스트/문자열 등은 422). 값 형식·어휘 오류도 422.
    화이트리스트 밖 키는 저장하지 않고 `ignored_keys` 로 응답한다(spec D5).
    """
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="본문은 객체여야 합니다.")
    try:
        merged, ignored = upsert_prefs(db, me, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    _, updated_at = get_prefs(db, me)  # 갓 저장한 updated_at 을 다시 읽어 응답에 반영
    return {
        "prefs": merged,
        "updated_at": updated_at.isoformat() if updated_at else None,
        "ignored_keys": ignored,
    }
