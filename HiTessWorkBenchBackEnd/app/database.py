from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# [수정 완료] 보편적인 계정 'admin' 사용
# 형식: mysql+pymysql://아이디:비밀번호@주소:포트/DB이름
SQLALCHEMY_DATABASE_URL = "mysql+pymysql://admin:admin1234@localhost:3306/hitessworkbench"

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()