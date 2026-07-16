from contextlib import asynccontextmanager

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
    newsletters,
    presence,
    section_property,
    support,
    system,
    users,
    viewers,
)
from .schema_bootstrap import run_schema_bootstrap
from .seed_guides import seed_default_guides
from .services.cleanup_service import start_cleanup_scheduler

# DB 테이블 자동 생성
models.Base.metadata.create_all(bind=database.engine)
run_schema_bootstrap()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """서버 시작 시 기본 가이드 시드와 userConnection 정리 스케줄러를 시작합니다."""
    db = database.SessionLocal()
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

    # userConnection/ 30일 초과 폴더 자동 정리 (서버 시작 즉시 1회 + 매일 자정 반복)
    start_cleanup_scheduler()
    try:
        yield
    finally:
        await external_apps.close_block_weld_client()


app = FastAPI(lifespan=lifespan)

# CORS 설정: 허용 출처를 명시적으로 지정
app.add_middleware(
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
)

# 라우터 등록
app.include_router(auth.router)
app.include_router(auth.member_router)
app.include_router(users.router)
app.include_router(analysis.router)
app.include_router(system.router)
app.include_router(support.router)
app.include_router(davit.router)
app.include_router(doublepipe.router)
app.include_router(column_buckling.router)
app.include_router(hole_calculation.router)
app.include_router(d_type_lug.router)
app.include_router(external_apps.router)
app.include_router(carling.router)
app.include_router(hitessbeam.router)  # [TEMP] HiTessBeam 임시 라우터
app.include_router(section_property.router)
app.include_router(activity.router)
app.include_router(viewers.router)
app.include_router(newsletters.router)
app.include_router(presence.router)
app.include_router(chat.router)

app.mount(
    "/static/inhouse/d-type-lug",
    StaticFiles(directory="InHouseProgram/D_TypeLugCalculation"),
    name="d-type-lug-static",
)

# 플랫폼 홍보/소개 영상 등 정적 미디어. StaticFiles 는 HTTP Range 요청(206 Partial Content)을
# 자동 지원하므로 <video> 탐색(seek)·스트리밍이 정상 동작한다. 영상은 exe 에 번들하지 않고
# 서버에서만 제공하여 배포 exe 용량 부담을 0 으로 유지한다(클릭 시에만 다운로드/재생).
app.mount(
    "/static/videos",
    StaticFiles(directory="Videos"),
    name="videos-static",
)


@app.get("/")
def health_check():
    """헬스 체크."""
    return {"status": "ok", "service": "HiTessWorkBench"}
