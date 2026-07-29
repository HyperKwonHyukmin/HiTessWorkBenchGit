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
def switchable_client(db_session):
    """요청 도중 관리자↔일반 사용자를 전환할 수 있는 TestClient.

    ``admin_client`` 는 require_admin 까지 덮어쓰기 때문에 '비관리자가 403 을 받는가' 를
    검증할 수 없고, 두 클라이언트 픽스처를 한 테스트에서 함께 쓰면 전역
    ``app.dependency_overrides`` 를 서로 덮어써 조용히 신원이 뒤바뀐다.

    그래서 여기서는 **require_auth 만** 덮어쓰고 require_admin 은 실제 DB is_admin
    검사를 그대로 타게 둔다. ``as_admin()`` / ``as_user()`` 로 신원을 바꾼다.
    """
    identity = {"employee_id": "ADMIN001"}

    def _override_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[database.get_db] = _override_db
    app.dependency_overrides[require_auth] = lambda: identity["employee_id"]

    db_session.add_all([
        models.User(
            employee_id="ADMIN001", name="관리자", company="HHI",
            is_active=True, is_admin=True, is_developer=False,
        ),
        models.User(
            employee_id="EMP001", name="일반사용자", company="HHI",
            is_active=True, is_admin=False, is_developer=False,
        ),
    ])
    db_session.commit()

    client = TestClient(app)
    client.as_admin = lambda: identity.update(employee_id="ADMIN001")
    client.as_user = lambda: identity.update(employee_id="EMP001")

    yield client

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
