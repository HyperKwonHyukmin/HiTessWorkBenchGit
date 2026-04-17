from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from . import models, database
from .routers import auth, users, analysis, system, support, ai, davit, column_buckling, hitessbeam, section_property
from .seed_guides import seed_default_guides
from .services.cleanup_service import start_cleanup_scheduler

# DB 테이블 자동 생성
models.Base.metadata.create_all(bind=database.engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """서버 시작 시 기본 가이드·공지 시드 및 userConnection 정리 스케줄러를 시작합니다."""
    db = database.SessionLocal()
    try:
        seed_default_guides(db)
        seed_default_notices(db)
    finally:
        db.close()

    # userConnection/ 30일 초과 폴더 자동 정리 (서버 시작 즉시 1회 + 매일 자정 반복)
    start_cleanup_scheduler()
    yield


app = FastAPI(lifespan=lifespan)

# CORS 설정 — 허용 출처를 명시적으로 지정
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
app.include_router(hitessbeam.router)  # [TEMP] HiTessBeam 임시 라우터
app.include_router(section_property.router)


def seed_default_notices(db):
    """해당 공지가 없을 때만 기본 공지를 삽입합니다."""
    NOTICE_TITLE = "[운영] HiTESS WorkBench 프로토타입 테스트 진행 중"
    if db.query(models.Notice).filter(models.Notice.title == NOTICE_TITLE).first():
        return
    default_notice = models.Notice(
        type="Notice",
        title=NOTICE_TITLE,
        content=(
            "안녕하세요, HiTESS WorkBench 운영팀입니다.\n"
            "\n"
            "현재 HiTESS WorkBench는 프로토타입 테스트 단계로 운영 중입니다.\n"
            "\n"
            "테스트 기간 중 일부 기능이 변경되거나 일시적으로 제한될 수 있으며,\n"
            "사용 중 불편한 점이나 개선 사항은 '기능 요청(Feature Requests)' 게시판을 통해 의견을 남겨 주시기 바랍니다.\n"
            "\n"
            "여러분의 소중한 피드백이 시스템 완성도를 높이는 데 큰 도움이 됩니다.\n"
            "감사합니다."
        ),
        is_pinned=True,
        author_id="admin",
    )
    db.add(default_notice)
    db.commit()


# 헬스 체크
@app.get("/")
def health_check():
  return {"status": "ok", "service": "HiTessWorkBench"}
