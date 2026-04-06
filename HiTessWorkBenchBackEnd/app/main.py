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
    """서버 시작 시 기본 가이드 데이터를 시드합니다."""
    db = database.SessionLocal()
    try:
        seed_default_guides(db)
    finally:
        db.close()


# 헬스 체크
@app.get("/")
def health_check():
  return {"status": "ok", "service": "HiTessWorkBench"}
