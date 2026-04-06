from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from . import models, database
from .routers import auth, users, analysis, system, support, ai, davit
from .seed_guides import seed_default_guides

# DB 테이블 자동 생성
models.Base.metadata.create_all(bind=database.engine)

app = FastAPI()

# CORS 설정
app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=False,
  allow_methods=["*"],
  allow_headers=["*"],
)

# 라우터 등록
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(analysis.router)
app.include_router(system.router)
app.include_router(support.router)
app.include_router(ai.router)
app.include_router(davit.router)


@app.on_event("startup")
def on_startup():
    """서버 시작 시 기본 가이드 및 공지 데이터를 시드합니다."""
    db = database.SessionLocal()
    try:
        seed_default_guides(db)
        seed_default_notices(db)
    finally:
        db.close()


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
