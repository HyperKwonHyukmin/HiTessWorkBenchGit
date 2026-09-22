"""알림 센터 테이블 2종(notifications, user_preferences)의 생성·부트스트랩 회귀 테스트."""
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app import models
from app.schema_bootstrap import ensure_notification_columns, run_schema_bootstrap


def _sqlite_engine():
    return create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def test_create_all_makes_both_tables():
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    tables = set(inspect(engine).get_table_names())
    assert "notifications" in tables
    assert "user_preferences" in tables

    cols = {c["name"] for c in inspect(engine).get_columns("notifications")}
    assert cols == {
        "id", "employee_id", "kind", "title", "body", "link",
        "dedupe_key", "read_at", "created_at",
    }
    pref_cols = {c["name"] for c in inspect(engine).get_columns("user_preferences")}
    assert pref_cols == {"employee_id", "prefs", "updated_at"}


def test_notification_model_defaults(db_session):
    row = models.Notification(employee_id="EMP001", kind="job.completed", title="t")
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    assert row.body == ""
    assert row.read_at is None
    assert row.created_at is not None
    assert row.link is None


def test_bootstrap_adds_missing_notification_columns():
    """운영 DB 에 컬럼이 빠진 채 테이블만 있어도 bootstrap 이 채운다(멱등)."""
    engine = _sqlite_engine()
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE notifications ("
            " id INTEGER PRIMARY KEY, employee_id VARCHAR(50) NOT NULL,"
            " kind VARCHAR(50) NOT NULL, title VARCHAR(200) NOT NULL,"
            " created_at DATETIME)"
        ))

    ensure_notification_columns(engine=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("notifications")}
    assert {"body", "link", "dedupe_key", "read_at"} <= cols

    # 두 번 돌려도 예외 없이 같은 결과
    ensure_notification_columns(engine=engine)
    assert {c["name"] for c in inspect(engine).get_columns("notifications")} == cols


def test_run_schema_bootstrap_calls_notification_bootstrap(monkeypatch):
    called = []
    import app.schema_bootstrap as sb
    monkeypatch.setattr(sb, "ensure_notification_columns", lambda *, engine=None: called.append("n"))
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)
    run_schema_bootstrap(engine=engine)
    assert called == ["n"]
