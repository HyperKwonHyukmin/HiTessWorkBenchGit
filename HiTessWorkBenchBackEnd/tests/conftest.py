"""공통 pytest fixture — 인메모리 SQLite + dependency override."""
import os

# app.main import 전에 운영 DB DDL·background daemon·crash log side effect를 차단한다.
# lifecycle 자체는 test_database_lifecycle.py에서 주입된 SQLite engine으로 별도 검증한다.
os.environ.setdefault("WORKBENCH_ENV", "test")
os.environ.setdefault("WORKBENCH_DISABLE_CRASH_DIAGNOSTICS", "1")
os.environ.setdefault("WORKBENCH_DISABLE_RUNTIME_SERVICES", "1")

import pytest
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app import database, models
from app.main import app
from app.dependencies import require_auth, require_admin


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    models.Base.metadata.create_all(bind=engine)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()
        models.Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def admin_client(db_session):
    """is_admin=True 사용자로 요청을 보내는 TestClient."""
    def _override_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[database.get_db] = _override_db
    app.dependency_overrides[require_auth] = lambda: "ADMIN001"
    app.dependency_overrides[require_admin] = lambda: "ADMIN001"

    # 시드: admin 사용자
    admin = models.User(
        employee_id="ADMIN001", name="관리자", company="HHI",
        is_active=True, is_admin=True, is_developer=False,
    )
    db_session.add(admin)
    db_session.commit()

    yield TestClient(app)

    app.dependency_overrides.clear()


@pytest.fixture()
def make_analysis(db_session):
    """Analysis 행 생성 헬퍼."""
    def _make(employee_id, program_name, created_at, status="success"):
        a = models.Analysis(
            employee_id=employee_id,
            program_name=program_name,
            project_name="test-project",
            status=status,
            created_at=created_at,
        )
        db_session.add(a)
        db_session.commit()
        return a
    return _make


@pytest.fixture()
def make_user(db_session):
    """User 행 생성 헬퍼."""
    def _make(employee_id, name="홍길동", department="구조해석팀", is_developer=False):
        u = models.User(
            employee_id=employee_id, name=name, company="HHI",
            department=department, is_active=True, is_developer=is_developer,
        )
        db_session.add(u)
        db_session.commit()
        return u
    return _make
