from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text

from . import database, models
from .routers import (
    activity,
    ai,
    analysis,
    auth,
    carling,
    column_buckling,
    d_type_lug,
    davit,
    dev_runbooks,
    hitessbeam,
    section_property,
    support,
    system,
    users,
    viewers,
)
from .seed_dev_runbooks import seed_default_dev_runbooks
from .seed_guides import seed_default_guides
from .services.cleanup_service import start_cleanup_scheduler

# DB 테이블 자동 생성
models.Base.metadata.create_all(bind=database.engine)


def ensure_notice_columns():
    """기존 notices 테이블에 새 공개 범위/작성자 이름 컬럼을 보강합니다."""
    inspector = inspect(database.engine)
    if not inspector.has_table("notices"):
        return
    columns = {col["name"] for col in inspector.get_columns("notices")}
    statements = []
    if "is_private" not in columns:
        statements.append("ALTER TABLE notices ADD COLUMN is_private BOOL DEFAULT FALSE")
    if "author_name" not in columns:
        statements.append("ALTER TABLE notices ADD COLUMN author_name VARCHAR(50) NULL")
    if not statements:
        return
    with database.engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))


ensure_notice_columns()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """서버 시작 시 기본 가이드 시드와 userConnection 정리 스케줄러를 시작합니다."""
    db = database.SessionLocal()
    try:
        seed_default_guides(db)
        seed_default_dev_runbooks(db)
    finally:
        db.close()

    # userConnection/ 30일 초과 폴더 자동 정리 (서버 시작 즉시 1회 + 매일 자정 반복)
    start_cleanup_scheduler()
    yield


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
app.include_router(ai.router)
app.include_router(davit.router)
app.include_router(column_buckling.router)
app.include_router(d_type_lug.router)
app.include_router(carling.router)
app.include_router(hitessbeam.router)  # [TEMP] HiTessBeam 임시 라우터
app.include_router(section_property.router)
app.include_router(activity.router)
app.include_router(viewers.router)
app.include_router(dev_runbooks.router)

app.mount(
    "/static/inhouse/d-type-lug",
    StaticFiles(directory="InHouseProgram/D_TypeLugCalculation"),
    name="d-type-lug-static",
)


@app.get("/")
def health_check():
    """헬스 체크."""
    return {"status": "ok", "service": "HiTessWorkBench"}
