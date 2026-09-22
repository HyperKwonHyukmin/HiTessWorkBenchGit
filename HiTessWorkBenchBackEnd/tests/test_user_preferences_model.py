"""사용자 환경설정 테이블(user_preferences)의 생성·부트스트랩 회귀 테스트.

마스터 §2.2 정의를 그대로 유지한다:
    employee_id String(50) PK, prefs JSON not null default={}, updated_at DateTime nullable.

Plan A(알림 센터)가 먼저 실행됐다면 이미 `models.UserPreference` 가 있고 이 테스트는
계약(컬럼·PK)만 확인해 그대로 통과한다.
"""
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app import models
from app.schema_bootstrap import ensure_user_preferences_columns, run_schema_bootstrap


def _sqlite_engine():
    return create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def test_user_preferences_table_columns():
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    assert "user_preferences" in set(inspector.get_table_names())
    cols = {c["name"]: c for c in inspector.get_columns("user_preferences")}
    assert set(cols) == {"employee_id", "prefs", "updated_at"}

    pk = inspector.get_pk_constraint("user_preferences")
    assert pk["constrained_columns"] == ["employee_id"]

    # employee_id 는 사번(문자열)이라 String, prefs 는 JSON. SQLite 는 JSON 을 TEXT 로
    # 저장하므로 원본 타입 대신 SQLAlchemy 매핑을 확인한다.
    mapped = {c.name: c.type.__class__.__name__ for c in models.UserPreference.__table__.columns}
    assert mapped["employee_id"] == "String"
    assert mapped["prefs"] == "JSON"


def test_user_preferences_default_prefs_is_empty_dict(db_session):
    row = models.UserPreference(employee_id="EMP001")
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    # ORM 기본값 = 빈 dict. updated_at 은 nullable 이라 None.
    assert row.prefs == {}
    assert row.updated_at is None


def test_bootstrap_adds_missing_updated_at_column():
    """운영 DB 에 employee_id/prefs 만 있는 옛 스키마(만에 하나)라도 bootstrap 이 채운다."""
    engine = _sqlite_engine()
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE user_preferences ("
            " employee_id VARCHAR(50) PRIMARY KEY,"
            " prefs JSON NOT NULL)"
        ))

    ensure_user_preferences_columns(engine=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("user_preferences")}
    assert "updated_at" in cols

    # 두 번 돌려도 예외 없이 같은 결과(멱등)
    ensure_user_preferences_columns(engine=engine)
    assert {c["name"] for c in inspect(engine).get_columns("user_preferences")} == cols


def test_bootstrap_is_no_op_when_table_missing():
    """테이블 자체가 없으면(예: 초기 기동 이전) 예외 없이 지나가야 한다."""
    engine = _sqlite_engine()
    # create_all 을 부르지 않음 — 테이블 없음.
    ensure_user_preferences_columns(engine=engine)
    tables = set(inspect(engine).get_table_names())
    assert "user_preferences" not in tables


def test_run_schema_bootstrap_calls_user_preferences_bootstrap(monkeypatch):
    called = []
    import app.schema_bootstrap as sb
    monkeypatch.setattr(sb, "ensure_user_preferences_columns",
                        lambda *, engine=None: called.append("p"))
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    run_schema_bootstrap(engine=engine)
    assert "p" in called
