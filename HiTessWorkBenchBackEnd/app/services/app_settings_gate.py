"""'개발 중 / 점검 중' App 의 API 접근을 서버에서 차단하는 미들웨어.

프론트엔드만 막으면 API 를 직접 호출해 우회할 수 있으므로, 관리자가 App Settings
에서 내린 판정을 요청 경로 기준으로 백엔드에서도 강제한다.

설계상 **fail-open** 이다 — 경로가 매핑에 없거나, 인증 정보가 없거나, DB 조회가
실패하면 통과시킨다. 게이트는 부가 통제이지 인증이 아니고(각 엔드포인트의
require_auth 가 그대로 살아 있다), 여기서 fail-close 하면 DB 가 잠깐 흔들릴 때
모든 해석 요청이 멈춘다.
"""
from __future__ import annotations

import logging

from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from .. import database
from ..sessions import session_store
from . import app_settings as app_settings_service

logger = logging.getLogger(__name__)


def _employee_id_from_request(request) -> str | None:
    authorization = request.headers.get("authorization")
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        return None
    try:
        return session_store.get_employee_id(token)
    except Exception:  # pragma: no cover - 세션 저장소 장애 시 게이트만 건너뛴다.
        logger.warning("App 게이트: 세션 조회 실패", exc_info=True)
        return None


def _blocked_reason(session_factory, app_key: str, employee_id: str) -> tuple[str, str] | None:
    """차단이면 (reason, message), 통과면 None. 예외는 통과로 처리한다."""
    db = session_factory()
    try:
        settings = app_settings_service.load_settings(db)
        reason = app_settings_service.block_reason(settings.get(app_key))
        if reason is None:
            return None
        # 관리자는 개발·점검 중인 앱을 직접 확인해야 하므로 항상 통과.
        if app_settings_service.is_admin_user(db, employee_id):
            return None
        return reason
    except Exception:
        logger.warning("App 게이트: 설정 조회 실패 — 통과 처리", exc_info=True)
        return None
    finally:
        db.close()


def install_app_availability_guard(application) -> None:
    """create_app 에서 호출 — HTTP 미들웨어로 게이트를 설치한다."""

    @application.middleware("http")
    async def app_availability_guard(request, call_next):
        if request.method not in app_settings_service.GUARDED_METHODS:
            return await call_next(request)

        app_key = app_settings_service.resolve_app_key(request.url.path)
        if app_key is None:
            return await call_next(request)

        employee_id = _employee_id_from_request(request)
        if not employee_id:
            # 미인증 요청 — 엔드포인트의 require_auth 가 401 로 거른다.
            return await call_next(request)

        # lifespan 과 동일하게 app.state 의 세션 팩토리를 쓴다(테스트가 주입 가능).
        session_factory = getattr(
            request.app.state, "session_factory", None
        ) or database.SessionLocal
        reason = await run_in_threadpool(
            _blocked_reason, session_factory, app_key, employee_id
        )
        if reason is None:
            return await call_next(request)

        reason_code, message = reason
        logger.info(
            "App 게이트 차단: app=%s user=%s reason=%s path=%s",
            app_key, employee_id, reason_code, request.url.path,
        )
        return JSONResponse(
            status_code=403,
            content={
                "detail": message,
                "app_key": app_key,
                "reason": reason_code,
            },
        )
