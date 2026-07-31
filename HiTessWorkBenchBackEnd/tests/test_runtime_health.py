"""liveness/readiness/capability와 Windows disk anchor 회귀 테스트."""
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import database
from app.dependencies import require_admin, require_auth
from app.routers import system


def _system_app():
    app = FastAPI()
    app.include_router(system.router)
    app.state.startup_complete = False
    app.state.schema_ready = False
    app.state.session_factory = database.SessionLocal
    app.dependency_overrides[require_auth] = lambda: "USER001"
    app.dependency_overrides[require_admin] = lambda: "ADMIN001"
    return app


def test_version_contract_is_exact_and_database_free(monkeypatch):
    monkeypatch.setattr(
        system.database,
        "SessionLocal",
        lambda: (_ for _ in ()).throw(AssertionError("DB must not be used")),
    )
    response = TestClient(_system_app()).get("/api/version")

    assert response.status_code == 200
    assert response.json() == {"version": "1.3.42"}


def test_liveness_is_exact_and_database_free():
    response = TestClient(_system_app()).get("/api/health/live")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "HiTessWorkBench",
        "version": "1.3.42",
    }


def test_readiness_returns_200_after_startup_and_select_one():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SessionFactory = sessionmaker(bind=engine)
    app = _system_app()
    app.state.startup_complete = True
    app.state.schema_ready = True
    app.state.session_factory = SessionFactory

    response = TestClient(app).get("/api/health/ready")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["checks"]["database"]["status"] == "ok"
    engine.dispose()


def test_readiness_returns_503_without_database():
    class BrokenSession:
        def execute(self, _statement):
            raise RuntimeError("database down")

        def close(self):
            pass

    app = _system_app()
    app.state.startup_complete = True
    app.state.schema_ready = True
    app.state.session_factory = BrokenSession

    response = TestClient(app).get("/api/health/ready")

    assert response.status_code == 503
    assert response.json()["status"] == "not_ready"
    assert response.json()["checks"]["database"] == {
        "status": "error",
        "latency_ms": 0,
    }


def test_readiness_keeps_503_shape_when_execute_and_close_both_fail(caplog):
    class DoublyBrokenSession:
        def execute(self, _statement):
            raise RuntimeError("execute secret must not leak")

        def close(self):
            raise RuntimeError("close secret must not leak")

    app = _system_app()
    app.state.startup_complete = True
    app.state.schema_ready = True
    app.state.session_factory = DoublyBrokenSession

    response = TestClient(app).get("/api/health/ready")

    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "checks": {
            "startup": "ok",
            "schema": "ok",
            "database": {"status": "error", "latency_ms": 0},
        },
    }
    assert "execute secret must not leak" not in caplog.text
    assert "close secret must not leak" not in caplog.text


def test_capabilities_are_additive_and_do_not_expose_paths_or_secrets(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(system, "_USER_CONN_DIR", str(tmp_path))
    monkeypatch.setenv("DB_PASSWORD", "secret-value-must-not-leak")
    app = _system_app()
    app.state.startup_complete = True
    app.state.schema_ready = True

    response = TestClient(app).get("/api/system/capabilities")

    assert response.status_code == 200
    payload = response.json()
    rendered = str(payload)
    assert payload["schema_version"] == "1.0"
    assert payload["runtime"]["storage"]["available"] is True
    assert str(tmp_path) not in rendered
    assert "secret-value-must-not-leak" not in rendered


def test_system_status_uses_user_connection_drive_anchor(db_session, monkeypatch):
    captured = {}

    def fake_disk_usage(path):
        captured["path"] = path
        return SimpleNamespace(used=10 * 1024**3, total=100 * 1024**3)

    monkeypatch.setattr(system.psutil, "disk_usage", fake_disk_usage)
    monkeypatch.setattr(system.psutil, "cpu_percent", lambda **_kwargs: 10.0)
    monkeypatch.setattr(
        system.psutil,
        "virtual_memory",
        lambda: SimpleNamespace(used=20 * 1024**3, total=40 * 1024**3),
    )

    app = _system_app()

    def override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = override_db
    response = TestClient(app).get("/api/system/status")

    assert response.status_code == 200
    assert captured["path"] == system._DISK_ANCHOR
    assert captured["path"] != ""  # Windows에서는 C:\\, POSIX에서는 /
