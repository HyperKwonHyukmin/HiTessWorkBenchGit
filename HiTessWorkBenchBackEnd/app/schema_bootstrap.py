"""서버 시작 시 기존 운영 DB 스키마를 보강하는 부트스트랩 Module.

운영 중인 사내 DB 호출/저장 방식은 유지하면서, 기존 테이블에 필요한 컬럼만
보수적으로 추가한다. 장기적으로는 Alembic 같은 명시적 마이그레이션 도입이
바람직하지만, 현재 배포 방식에서는 이 Module이 시작 시 호환성 보강을 담당한다.
"""
from sqlalchemy import inspect, text

from . import database


def _add_missing_columns(table_name: str, statements_by_column: dict[str, str]) -> None:
    inspector = inspect(database.engine)
    if not inspector.has_table(table_name):
        return

    columns = {col["name"] for col in inspector.get_columns(table_name)}
    statements = [
        statement
        for column_name, statement in statements_by_column.items()
        if column_name not in columns
    ]
    if not statements:
        return

    with database.engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))


def ensure_notice_columns() -> None:
    """기존 notices 테이블에 공개 범위/작성자 이름 컬럼을 보강합니다."""
    _add_missing_columns("notices", {
        "is_private": "ALTER TABLE notices ADD COLUMN is_private BOOL DEFAULT FALSE",
        "author_name": "ALTER TABLE notices ADD COLUMN author_name VARCHAR(50) NULL",
    })


def ensure_user_columns() -> None:
    """기존 users 테이블에 개발자 권한 컬럼을 보강합니다."""
    _add_missing_columns("users", {
        "is_developer": "ALTER TABLE users ADD COLUMN is_developer BOOL DEFAULT FALSE",
    })


def ensure_analysis_job_columns() -> None:
    """기존 analysis 테이블에 DB 기반 job 상태 컬럼을 보강합니다."""
    _add_missing_columns("analysis", {
        "job_id": "ALTER TABLE analysis ADD COLUMN job_id VARCHAR(50) NULL",
        "job_status": "ALTER TABLE analysis ADD COLUMN job_status VARCHAR(20) DEFAULT 'completed'",
        "progress": "ALTER TABLE analysis ADD COLUMN progress INT DEFAULT 100",
        "job_message": "ALTER TABLE analysis ADD COLUMN job_message TEXT NULL",
        "started_at": "ALTER TABLE analysis ADD COLUMN started_at DATETIME NULL",
        "updated_at": "ALTER TABLE analysis ADD COLUMN updated_at DATETIME NULL",
    })


def run_schema_bootstrap() -> None:
    """앱 시작 시 필요한 운영 DB 스키마 보강을 한 번에 수행합니다."""
    ensure_notice_columns()
    ensure_user_columns()
    ensure_analysis_job_columns()
