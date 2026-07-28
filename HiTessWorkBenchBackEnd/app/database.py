import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker

_BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(_BACKEND_DIR / ".env")

DB_USER = os.getenv("DB_USER", "admin")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_NAME = os.getenv("DB_NAME", "hitessworkbench")


class DatabaseConfigurationError(RuntimeError):
    """DB 설정값이 연결 문자열로 사용될 수 없을 때 발생하는 안전한 오류."""


def validate_database_config() -> None:
    """현재 MySQL 환경변수를 검증하되 credential 값은 오류에 포함하지 않습니다."""
    invalid_fields: list[str] = []
    if not str(DB_USER).strip():
        invalid_fields.append("DB_USER")
    if not str(DB_HOST).strip():
        invalid_fields.append("DB_HOST")
    if not str(DB_NAME).strip():
        invalid_fields.append("DB_NAME")
    try:
        port = int(str(DB_PORT))
        if not 1 <= port <= 65535:
            invalid_fields.append("DB_PORT")
    except (TypeError, ValueError):
        invalid_fields.append("DB_PORT")
    if invalid_fields:
        names = ", ".join(dict.fromkeys(invalid_fields))
        raise DatabaseConfigurationError(f"유효하지 않은 데이터베이스 설정: {names}")


validate_database_config()


def build_database_url(
    *,
    user: str = DB_USER,
    password: str = DB_PASSWORD,
    host: str = DB_HOST,
    port: str | int = DB_PORT,
    database: str = DB_NAME,
) -> URL:
    """예약문자가 포함된 credential도 안전하게 보존하는 SQLAlchemy URL을 만듭니다."""
    return URL.create(
        drivername="mysql+pymysql",
        username=user,
        password=password,
        host=host,
        port=int(port),
        database=database,
    )


_DATABASE_URL = build_database_url()
# 기존 public 이름/문자열 계약은 유지하되 credential 예약문자는 percent-encoding합니다.
SQLALCHEMY_DATABASE_URL = _DATABASE_URL.render_as_string(hide_password=False)

engine = create_engine(
    _DATABASE_URL,
    pool_recycle=3600,
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
