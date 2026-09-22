"""Analysis 테이블에 retain_until / pinned 컬럼을 멱등하게 보강하는지 검증한다.

운영 DB(MySQL)에는 두 컬럼이 없다. create_all 로 만드는 신규 테스트 DB에는 처음부터
있고, 운영 DB는 서버 기동 시 ensure_analysis_retention_columns() 가 채운다.
"""
from datetime import datetime

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app import models
from app.schema_bootstrap import ensure_analysis_retention_columns, run_schema_bootstrap


def _sqlite_engine():
    return create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def test_create_all_makes_retention_columns():
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("analysis")}
    assert "retain_until" in cols
    assert "pinned" in cols


def test_pinned_default_is_false(db_session):
    a = models.Analysis(employee_id="EMP001", program_name="Truss Assessment",
                        project_name="p", status="Success",
                        created_at=datetime(2026, 9, 18, 9, 0, 0))
    db_session.add(a)
    db_session.commit()
    db_session.refresh(a)
    assert a.pinned is False
    assert a.retain_until is None


def test_bootstrap_adds_missing_retention_columns():
    """운영 DB 처럼 analysis 테이블에 두 컬럼이 없어도 bootstrap 이 채운다(멱등)."""
    engine = _sqlite_engine()
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE analysis ("
            " id INTEGER PRIMARY KEY, job_id VARCHAR(50),"
            " project_name VARCHAR(200), program_name VARCHAR(100),"
            " employee_id VARCHAR(50), status VARCHAR(50),"
            " job_status VARCHAR(20), progress INTEGER, job_message TEXT,"
            " input_info JSON, result_info JSON, source VARCHAR(50),"
            " created_at DATETIME, started_at DATETIME, updated_at DATETIME)"
        ))

    ensure_analysis_retention_columns(engine=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("analysis")}
    assert {"retain_until", "pinned"} <= cols

    # 두 번 돌려도 예외 없이 같은 결과
    ensure_analysis_retention_columns(engine=engine)
    assert {c["name"] for c in inspect(engine).get_columns("analysis")} == cols


def test_run_schema_bootstrap_calls_retention_bootstrap(monkeypatch):
    called = []
    import app.schema_bootstrap as sb
    monkeypatch.setattr(sb, "ensure_analysis_retention_columns",
                        lambda *, engine=None: called.append("r"))
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    run_schema_bootstrap(engine=engine)
    assert called == ["r"]
