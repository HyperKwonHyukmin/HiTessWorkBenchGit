"""서버 시작 시 기존 운영 DB 스키마를 보수적으로 보강합니다."""

from sqlalchemy import inspect, text

from . import database


def _add_missing_columns(
    table_name: str,
    statements_by_column: dict[str, str],
    *,
    engine=None,
) -> None:
    target_engine = engine or database.engine
    inspector = inspect(target_engine)
    if not inspector.has_table(table_name):
        return

    columns = {column["name"] for column in inspector.get_columns(table_name)}
    statements = [
        statement
        for column_name, statement in statements_by_column.items()
        if column_name not in columns
    ]
    if not statements:
        return

    with target_engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def _add_missing_indexes(
    table_name: str,
    statements_by_index: dict[str, str],
    *,
    engine=None,
) -> None:
    target_engine = engine or database.engine
    inspector = inspect(target_engine)
    if not inspector.has_table(table_name):
        return

    indexes = {index["name"] for index in inspector.get_indexes(table_name)}
    statements = [
        statement
        for index_name, statement in statements_by_index.items()
        if index_name not in indexes
    ]
    if not statements:
        return

    with target_engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def ensure_notice_columns(*, engine=None) -> None:
    _add_missing_columns("notices", {
        "is_private": "ALTER TABLE notices ADD COLUMN is_private BOOL DEFAULT FALSE",
        "author_name": "ALTER TABLE notices ADD COLUMN author_name VARCHAR(50) NULL",
    }, engine=engine)


def ensure_user_columns(*, engine=None) -> None:
    _add_missing_columns("users", {
        "is_developer": "ALTER TABLE users ADD COLUMN is_developer BOOL DEFAULT FALSE",
    }, engine=engine)


def ensure_user_presence_columns(*, engine=None) -> None:
    _add_missing_columns("user_presence", {
        "session_started": "ALTER TABLE user_presence ADD COLUMN session_started DATETIME NULL",
        "last_active_at": "ALTER TABLE user_presence ADD COLUMN last_active_at DATETIME NULL",
        "app_version": "ALTER TABLE user_presence ADD COLUMN app_version VARCHAR(30) NULL",
    }, engine=engine)


def ensure_analysis_job_columns(*, engine=None) -> None:
    _add_missing_columns("analysis", {
        "job_id": "ALTER TABLE analysis ADD COLUMN job_id VARCHAR(50) NULL",
        "job_status": "ALTER TABLE analysis ADD COLUMN job_status VARCHAR(20) DEFAULT 'completed'",
        "progress": "ALTER TABLE analysis ADD COLUMN progress INT DEFAULT 100",
        "job_message": "ALTER TABLE analysis ADD COLUMN job_message TEXT NULL",
        "started_at": "ALTER TABLE analysis ADD COLUMN started_at DATETIME NULL",
        "updated_at": "ALTER TABLE analysis ADD COLUMN updated_at DATETIME NULL",
    }, engine=engine)


def ensure_analysis_retention_columns(*, engine=None) -> None:
    """analysis 테이블에 결과 보관 정책 컬럼(retain_until, pinned)을 멱등하게 보강한다.

    운영 DB(MySQL)에는 두 컬럼이 없다. 서버 기동 시 ALTER TABLE 로 채워 넣어야 하며,
    없으면 이력 조회 응답 직렬화 단계에서 500 이 난다(마스터 규약 §1.3).

    pinned 는 NOT NULL DEFAULT FALSE 로 만들어 기존 행이 즉시 False 를 얻게 하고,
    retain_until 은 NULL 허용(연장 안 된 기록).
    """
    _add_missing_columns("analysis", {
        "retain_until": "ALTER TABLE analysis ADD COLUMN retain_until DATETIME NULL",
        "pinned": "ALTER TABLE analysis ADD COLUMN pinned BOOL NOT NULL DEFAULT FALSE",
    }, engine=engine)


def ensure_app_community_columns(*, engine=None) -> None:
    """기존 공지·요청 테이블을 App별 커뮤니티 구조로 확장합니다."""

    _add_missing_columns("notices", {
        "app_key": "ALTER TABLE notices ADD COLUMN app_key VARCHAR(100) NULL",
        "show_on_entry": "ALTER TABLE notices ADD COLUMN show_on_entry BOOL DEFAULT FALSE",
        "publish_status": (
            "ALTER TABLE notices ADD COLUMN publish_status VARCHAR(20) DEFAULT 'published'"
        ),
        "starts_at": "ALTER TABLE notices ADD COLUMN starts_at DATETIME NULL",
        "ends_at": "ALTER TABLE notices ADD COLUMN ends_at DATETIME NULL",
        "revision": "ALTER TABLE notices ADD COLUMN revision INT NOT NULL DEFAULT 1",
    }, engine=engine)
    _add_missing_columns("feature_requests", {
        "app_key": "ALTER TABLE feature_requests ADD COLUMN app_key VARCHAR(100) NULL",
    }, engine=engine)
    _add_missing_indexes("notices", {
        "ix_notices_app_key": "CREATE INDEX ix_notices_app_key ON notices (app_key)",
    }, engine=engine)
    _add_missing_indexes("feature_requests", {
        "ix_feature_requests_app_key": (
            "CREATE INDEX ix_feature_requests_app_key ON feature_requests (app_key)"
        ),
    }, engine=engine)


def ensure_chat_message_columns(*, engine=None) -> None:
    """기존 chat_messages 테이블에 '내게서만 삭제' 숨김 플래그를 보강합니다."""
    _add_missing_columns("chat_messages", {
        "hidden_by_sender": "ALTER TABLE chat_messages ADD COLUMN hidden_by_sender BOOL NOT NULL DEFAULT FALSE",
        "hidden_by_recipient": "ALTER TABLE chat_messages ADD COLUMN hidden_by_recipient BOOL NOT NULL DEFAULT FALSE",
    }, engine=engine)


def ensure_notification_columns(*, engine=None) -> None:
    """알림 센터 notifications 테이블의 컬럼을 멱등하게 보강합니다.

    테이블 자체는 create_all 로 생기지만, 이후 컬럼이 늘어날 때 운영 DB 에서 500 이
    나지 않도록 전 컬럼을 여기에 둔다(마스터 규약 §1.3).
    """
    _add_missing_columns("notifications", {
        "body": "ALTER TABLE notifications ADD COLUMN body VARCHAR(1000) NOT NULL DEFAULT ''",
        "link": "ALTER TABLE notifications ADD COLUMN link JSON NULL",
        "dedupe_key": "ALTER TABLE notifications ADD COLUMN dedupe_key VARCHAR(200) NULL",
        "read_at": "ALTER TABLE notifications ADD COLUMN read_at DATETIME NULL",
    }, engine=engine)
    _add_missing_indexes("notifications", {
        "ix_notifications_employee_id": (
            "CREATE INDEX ix_notifications_employee_id ON notifications (employee_id)"
        ),
        "ix_notifications_dedupe_key": (
            "CREATE INDEX ix_notifications_dedupe_key ON notifications (dedupe_key)"
        ),
        "ix_notifications_created_at": (
            "CREATE INDEX ix_notifications_created_at ON notifications (created_at)"
        ),
    }, engine=engine)


def ensure_app_spaces(*, engine=None) -> None:
    """요청된 App만 커뮤니티 기능을 활성화합니다."""

    target_engine = engine or database.engine
    inspector = inspect(target_engine)
    if not inspector.has_table("app_spaces"):
        return

    app_key = "hitess-model-builder"
    with target_engine.begin() as connection:
        exists = connection.execute(
            text("SELECT app_key FROM app_spaces WHERE app_key = :app_key"),
            {"app_key": app_key},
        ).first()
        if not exists:
            connection.execute(
                text(
                    """
                    INSERT INTO app_spaces
                        (app_key, display_name, notice_enabled, board_enabled, is_active, created_at)
                    VALUES
                        (:app_key, :display_name, TRUE, TRUE, TRUE, CURRENT_TIMESTAMP)
                    """
                ),
                {"app_key": app_key, "display_name": "HiTESS Model Builder"},
            )


def ensure_user_preferences_columns(*, engine=None) -> None:
    """사용자 환경설정 user_preferences 테이블의 컬럼을 멱등하게 보강합니다.

    테이블 자체는 create_all 로 생기지만, 이후 컬럼이 늘어날 때 운영 DB 에서 500 이
    나지 않도록 전 컬럼을 여기에 둔다(마스터 규약 §1.3). 지금은 updated_at 하나뿐이라
    Plan A 가 만든 옛 행이 있다면 그것을 대상으로 삼는다. 테이블 자체가 없으면(초기
    기동 전) 조용히 지나간다 — _add_missing_columns 는 테이블 부재를 감지해 skip 한다.
    """
    _add_missing_columns("user_preferences", {
        "updated_at": "ALTER TABLE user_preferences ADD COLUMN updated_at DATETIME NULL",
    }, engine=engine)


def run_schema_bootstrap(*, engine=None) -> None:
    """기존 호출은 production engine을, 테스트는 주입된 engine을 사용합니다."""
    ensure_notice_columns(engine=engine)
    ensure_user_columns(engine=engine)
    ensure_user_presence_columns(engine=engine)
    ensure_analysis_job_columns(engine=engine)
    ensure_analysis_retention_columns(engine=engine)
    ensure_app_community_columns(engine=engine)
    ensure_chat_message_columns(engine=engine)
    ensure_notification_columns(engine=engine)
    ensure_app_spaces(engine=engine)
    ensure_user_preferences_columns(engine=engine)
