from contextlib import asynccontextmanager
import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# ⚠️ 최우선 실행: 비정상 종료(무-로그 급사) 진단·방어 계측 설치.
# - faulthandler: 네이티브 크래시 스택을 logs/backend_crash.log 에 덤프
# - 파일 로깅: uvicorn 로그를 logs/backend.log 에 보존(종료 직전 마지막 줄 확보)
# - 콘솔 가드: 자식 solver(Abaqus/Nastran)의 CTRL_C/CTRL_BREAK 로부터 서버 보호
# - 메모리 워치독: OOM 추세 기록
# routers import(numpy 등 네이티브 로드)보다 먼저 호출해 import 단계 크래시까지 잡는다.
from .diagnostics import install_crash_diagnostics

install_crash_diagnostics()

from . import database, models
from .routers import (
    activity,
    analysis,
    app_settings,
    auth,
    carling,
    chat,
    column_buckling,
    d_type_lug,
    davit,
    doublepipe,
    external_apps,
    hitessbeam,
    hole_calculation,
    model_registry,
    newsletters,
    presence,
    reports,
    section_property,
    support,
    system,
    users,
    viewers,
)
from .schema_bootstrap import run_schema_bootstrap
from .seed_guides import seed_default_guides
from .services.cleanup_service import (
    shutdown_cleanup_scheduler,
    start_cleanup_scheduler,
)
from .services.app_settings_gate import install_app_availability_guard
from .services.job_manager import shutdown_job_manager, start_job_manager

logger = logging.getLogger(__name__)


def initialize_database(*, engine=None) -> None:
    """명시적으로 운영 스키마를 생성·보강합니다.

    모듈 import는 DB에 연결하지 않으며 production startup에서는 lifespan이 이 함수를
    호출해 기존 create_all/bootstrap fail-fast 동작을 그대로 유지합니다.
    """
    target_engine = engine or database.engine
    database.validate_database_config()
    models.Base.metadata.create_all(bind=target_engine)
    run_schema_bootstrap(engine=target_engine)


def _runtime_services_disabled() -> bool:
    value = os.environ.get("WORKBENCH_DISABLE_RUNTIME_SERVICES", "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def build_lifespan(
    *,
    engine=None,
    session_factory=None,
    initialize_on_start: bool | None = None,
    start_background_services: bool | None = None,
):
    """운영 기본값과 SQLite lifecycle 테스트가 공유하는 lifespan factory."""
    target_engine = engine or database.engine
    target_session_factory = session_factory or database.SessionLocal

    @asynccontextmanager
    async def app_lifespan(app: FastAPI):
        disabled = _runtime_services_disabled()
        should_initialize = (not disabled) if initialize_on_start is None else initialize_on_start
        should_start_background = (
            not disabled
            if start_background_services is None
            else start_background_services
        )
        job_manager_started = False
        cleanup_started = False
        app.state.startup_complete = False
        app.state.schema_ready = False
        app.state.session_factory = target_session_factory

        try:
            if should_initialize:
                initialize_database(engine=target_engine)
                app.state.schema_ready = True

                db = target_session_factory()
                try:
                    db.query(models.Analysis).filter(
                        models.Analysis.job_status.in_(["Pending", "Running"])
                    ).update({
                        "job_status": "Interrupted",
                        "status": "Failed",
                        "progress": 100,
                        "job_message": "서버 재시작으로 작업 상태가 중단되었습니다.",
                    }, synchronize_session=False)
                    db.commit()
                    seed_default_guides(db)
                except Exception:
                    db.rollback()
                    raise
                finally:
                    db.close()

            if should_start_background:
                start_job_manager()
                job_manager_started = True
                # userConnection/ 30일 초과 폴더 자동 정리
                cleanup_started = start_cleanup_scheduler()

            app.state.startup_complete = should_initialize
            yield
        finally:
            try:
                await external_apps.close_block_weld_client()
            finally:
                try:
                    await external_apps.close_independent_tank_client()
                finally:
                    if cleanup_started:
                        if not shutdown_cleanup_scheduler():
                            logger.warning(
                                "Cleanup scheduler did not stop within the shutdown timeout"
                            )
                    if job_manager_started:
                        shutdown_job_manager()
                    app.state.startup_complete = False

    return app_lifespan


lifespan = build_lifespan()


def health_check():
    """기존 root 헬스 체크 계약."""
    return {"status": "ok", "service": "HiTessWorkBench"}


def create_app(*, lifespan_handler=lifespan) -> FastAPI:
    """기존 middleware/router/static 구성을 보존하는 application factory."""
    application = FastAPI(lifespan=lifespan_handler)
    application.state.startup_complete = False
    application.state.schema_ready = False
    application.state.session_factory = database.SessionLocal

    # ⚠ 순서 주의: Starlette 은 나중에 추가한 미들웨어가 바깥쪽이다.
    # 게이트를 먼저 추가해야 CORSMiddleware 가 이를 감싸고, 게이트가 돌려주는
    # 403 응답에도 CORS 헤더가 붙어 앱이 본문(차단 사유)을 읽을 수 있다.
    install_app_availability_guard(application)

    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://localhost:5174",
            "app://.",
            "file://",
        ],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        # ⚠️ 이걸 빼면 브라우저가 JS 에게 Content-Disposition 을 숨긴다(CORS 안전 목록에 없음).
        #    그러면 프론트가 파일명을 못 읽고 App 이름 없는 폴백 이름으로 저장한다 —
        #    계산서·사용량 리포트 다운로드가 모두 같은 증상을 겪었다.
        expose_headers=["Content-Disposition"],
    )

    application.include_router(auth.router)
    application.include_router(auth.member_router)
    application.include_router(users.router)
    application.include_router(analysis.router)
    application.include_router(system.router)
    application.include_router(support.router)
    application.include_router(davit.router)
    application.include_router(doublepipe.router)
    application.include_router(column_buckling.router)
    application.include_router(hole_calculation.router)
    application.include_router(d_type_lug.router)
    application.include_router(external_apps.router)
    application.include_router(carling.router)
    application.include_router(hitessbeam.router)  # [TEMP] HiTessBeam 임시 라우터
    application.include_router(section_property.router)
    application.include_router(activity.router)
    application.include_router(viewers.router)
    application.include_router(newsletters.router)
    application.include_router(presence.router)
    application.include_router(chat.router)
    application.include_router(app_settings.router)
    application.include_router(model_registry.router)
    application.include_router(reports.router)

    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    application.mount(
        "/static/inhouse/d-type-lug",
        StaticFiles(directory=os.path.join(backend_dir, "InHouseProgram", "D_TypeLugCalculation")),
        name="d-type-lug-static",
    )
    application.mount(
        "/static/videos",
        StaticFiles(directory=os.path.join(backend_dir, "Videos")),
        name="videos-static",
    )
    application.add_api_route("/", health_check, methods=["GET"])
    return application


app = create_app()
