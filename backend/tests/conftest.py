"""Test configuration, database fixtures, and isolated test clients."""

import os
from collections.abc import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.db.session import build_engine, get_session
from kalyan_api.main import create_app


@pytest.fixture(scope="session")
def test_settings() -> Settings:
    """Provide Settings configured specifically for the test suite."""
    test_db = os.environ.get("KALYAN_TEST_DB_NAME", "kalyan_test")
    if not test_db.endswith("_test"):
        pytest.exit(
            f"SAFETY ABORT: Refusing to run tests on non-test database '{test_db}'. "
            "Database name must end with '_test'.",
            returncode=2,
        )

    # Base settings with lightweight Argon2 parameters for test execution speed
    settings = Settings(
        env="test",
        db_name=test_db,
        argon2_time_cost=1,
        argon2_memory_cost=8,
        argon2_parallelism=1,
    )
    return settings


@pytest.fixture(scope="session")
def app_engine(test_settings: Settings) -> Generator[Engine, None, None]:
    """Session-scoped application runtime engine for kalyan_app."""
    engine = build_engine(test_settings, owner=False)
    yield engine
    engine.dispose()


@pytest.fixture(scope="session")
def owner_engine(test_settings: Settings) -> Generator[Engine, None, None]:
    """Session-scoped migration owner engine for kalyan_owner."""
    engine = build_engine(test_settings, owner=True)
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(app_engine: Engine) -> Generator[Session, None, None]:
    """Per-test isolated session running inside a SAVEPOINT, rolled back at teardown."""
    connection = app_engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")

    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def app(test_settings: Settings, db_session: Session) -> FastAPI:
    """FastAPI test app configured with isolated database session override."""
    app_instance = create_app(settings=test_settings)

    def _override_get_session() -> Generator[Session, None, None]:
        try:
            yield db_session
            db_session.commit()
        except Exception:
            db_session.rollback()
            raise

    app_instance.dependency_overrides[get_session] = _override_get_session
    return app_instance


@pytest.fixture
def client(app: FastAPI) -> Generator[TestClient, None, None]:
    """HTTP TestClient with default Origin set for same-origin CSRF compliance."""
    with TestClient(
        app,
        base_url="http://testserver",
        headers={"Origin": "http://testserver"},
    ) as c:
        yield c

