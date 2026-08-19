"""DB schema lifecycle과 application factory 회귀 테스트."""
import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import database, models
from app.main import build_lifespan, create_app, initialize_database


def _sqlite_runtime():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    return engine, sessionmaker(bind=engine, autocommit=False, autoflush=False)


def test_initialize_database_is_idempotent_with_injected_sqlite():
    engine, SessionFactory = _sqlite_runtime()

    initialize_database(engine=engine)
    initialize_database(engine=engine)

    db = SessionFactory()
    try:
        assert db.query(models.AppSpace).filter_by(app_key="hitess-model-builder").count() == 1
    finally:
        db.close()
        engine.dispose()


def test_lifespan_initializes_schema_and_marks_interrupted_jobs():
    engine, SessionFactory = _sqlite_runtime()
    initialize_database(engine=engine)
    db = SessionFactory()
    db.add(models.Analysis(
        job_id="pending-before-restart",
        employee_id="USER001",
        program_name="BDF Scanner",
        status="Pending",
        job_status="Pending",
        progress=0,
        input_info={},
        result_info={},
    ))
    db.commit()
    db.close()

    app = FastAPI(lifespan=build_lifespan(
        engine=engine,
        session_factory=SessionFactory,
        initialize_on_start=True,
        start_background_services=False,
    ))

    @app.get("/state")
    def state():
        return {
            "startup": app.state.startup_complete,
            "schema": app.state.schema_ready,
        }

    with TestClient(app) as client:
        assert client.get("/state").json() == {"startup": True, "schema": True}
        db = SessionFactory()
        try:
            row = db.query(models.Analysis).filter_by(job_id="pending-before-restart").one()
            assert row.job_status == "Interrupted"
            assert row.status == "Failed"
            assert row.progress == 100
        finally:
            db.close()

    assert app.state.startup_complete is False
    engine.dispose()


def test_importing_main_does_not_connect_to_database():
    backend_dir = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    env.update({
        "DB_HOST": "203.0.113.1",
        "DB_PORT": "3306",
        "WORKBENCH_DISABLE_CRASH_DIAGNOSTICS": "1",
        "WORKBENCH_DISABLE_RUNTIME_SERVICES": "1",
    })

    completed = subprocess.run(
        [sys.executable, "-c", "import app.main; print('import-ok')"],
        cwd=backend_dir,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )

    assert completed.returncode == 0, completed.stderr
    assert "import-ok" in completed.stdout


def test_database_validation_reports_field_name_without_credentials(monkeypatch):
    monkeypatch.setattr(database, "DB_PORT", "invalid")
    monkeypatch.setattr(database, "DB_PASSWORD", "do-not-leak-this")

    with pytest.raises(database.DatabaseConfigurationError) as exc_info:
        database.validate_database_config()

    message = str(exc_info.value)
    assert "DB_PORT" in message
    assert "do-not-leak-this" not in message


def test_database_url_round_trips_reserved_credential_characters():
    user = "engineer+ops@example.com"
    password = "p@ss:/?#[]% value"
    url = database.build_database_url(
        user=user,
        password=password,
        host="localhost",
        port="3306",
        database="hitessworkbench",
    )
    rendered = url.render_as_string(hide_password=False)
    parsed = make_url(rendered)

    assert url.drivername == "mysql+pymysql"
    assert parsed.drivername == "mysql+pymysql"
    assert parsed.username == user
    assert parsed.password == password
    assert parsed.host == "localhost"
    assert parsed.port == 3306
    assert parsed.database == "hitessworkbench"
    assert password not in str(url)  # URL.__str__은 기본적으로 password를 숨깁니다.


def test_create_app_preserves_critical_route_and_mount_contracts():
    application = create_app()
    paths = {route.path for route in application.routes}

    assert {
        "/",
        "/api/version",
        "/api/analysis/history/{employee_id}",
        "/api/analysis/status/{job_id}",
        "/api/system/status",
        "/api/health/live",
        "/api/health/ready",
        "/api/system/capabilities",
        "/api/presentations/hitess-launch-deck",
        "/static/inhouse/d-type-lug",
        "/static/videos",
    }.issubset(paths)
