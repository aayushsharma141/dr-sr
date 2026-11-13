"""Test configuration, database fixtures, and isolated test clients."""

import os
from collections.abc import Generator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.core.security import build_hasher, hash_password
from kalyan_api.core.setup_code import issue_setup_code
from kalyan_api.db.guards import require_test_database
from kalyan_api.db.migrate import upgrade_head
from kalyan_api.db.session import build_engine, get_session
from kalyan_api.main import create_app
from kalyan_api.models import Department, Doctor, User


@pytest.fixture(scope="session")
def test_settings(tmp_path_factory: pytest.TempPathFactory) -> Settings:
    """Provide Settings configured specifically for the test suite."""
    test_db = os.environ.get("KALYAN_TEST_DB_NAME", "kalyan_test")
    if not test_db.endswith("_test"):
        pytest.exit(
            f"SAFETY ABORT: Refusing to run tests on non-test database '{test_db}'. "
            "Database name must end with '_test'.",
            returncode=2,
        )

    # Several tests unlink every file in photos_dir/assets_dir. Point all file
    # storage at a throwaway directory so the suite can never touch the live
    # server's backend/var (uploaded logos, patient photos, backups).
    storage_root = tmp_path_factory.mktemp("kalyan_storage")
    os.environ["KALYAN_PHOTOS_DIR"] = str(storage_root / "photos")
    os.environ["KALYAN_ASSETS_DIR"] = str(storage_root / "assets")
    os.environ["KALYAN_BACKUP_DIR"] = str(storage_root / "backups")
    os.environ["KALYAN_SETUP_CODE_PATH"] = str(storage_root / "setup-code.txt")

    # Base settings with lightweight Argon2 parameters for test execution speed
    settings = Settings(
        env="test",
        db_name=test_db,
        extra_allowed_origins=os.environ.get(
            "KALYAN_EXTRA_ALLOWED_ORIGINS", "http://localhost:5173"
        ),
        argon2_time_cost=1,
        argon2_memory_cost=8,
        argon2_parallelism=1,
    )
    return settings


@pytest.fixture(scope="session", autouse=True)
def configure_test_environment(test_settings: Settings) -> None:
    """Ensure environment points to the test database and clear cached settings."""
    os.environ["KALYAN_DB_NAME"] = test_settings.db_name
    os.environ["KALYAN_ENV"] = "test"
    os.environ.setdefault("KALYAN_EXTRA_ALLOWED_ORIGINS", "http://localhost:5173")
    from kalyan_api.config import get_settings

    get_settings.cache_clear()


@pytest.fixture(scope="session")
def migrated_db(test_settings: Settings) -> dict[str, int]:
    """Wipe public schema, run alembic migrations from head, and assert zero seed rows."""
    # Refuses to wipe anything that is not clearly a test database.
    require_test_database(test_settings, "wipe the test schema")
    owner_engine = create_engine(test_settings.owner_url, isolation_level="AUTOCOMMIT")
    with owner_engine.connect() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))

    upgrade_head(test_settings.owner_url)

    # Ensure runtime role kalyan_app has TEMPORARY table privileges on test database
    with owner_engine.connect() as conn:
        grant_sql = (
            f'GRANT TEMPORARY ON DATABASE "{test_settings.db_name}" '
            f'TO "{test_settings.db_app_user}"'
        )
        conn.execute(text(grant_sql))

    # SEC-05: Assert zero seed rows exist immediately after upgrade head
    with owner_engine.connect() as conn:
        users_count = conn.scalar(text("SELECT count(*) FROM users")) or 0
        doctors_count = conn.scalar(text("SELECT count(*) FROM doctors")) or 0
        setup_count = conn.scalar(text("SELECT count(*) FROM system_setup")) or 0

    owner_engine.dispose()

    assert users_count == 0, f"Expected 0 users after migration, found {users_count}"
    assert doctors_count == 0, f"Expected 0 doctors after migration, found {doctors_count}"
    assert setup_count == 0, f"Expected 0 system_setup rows after migration, found {setup_count}"

    return {
        "users": users_count,
        "doctors": doctors_count,
        "system_setup": setup_count,
    }


@pytest.fixture(scope="session")
def app_engine(
    test_settings: Settings, migrated_db: dict[str, int]
) -> Generator[Engine, None, None]:
    """Session-scoped application runtime engine for kalyan_app."""
    engine = build_engine(test_settings, owner=False)
    yield engine
    engine.dispose()


@pytest.fixture(scope="session")
def owner_engine(
    test_settings: Settings, migrated_db: dict[str, int]
) -> Generator[Engine, None, None]:
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
        with db_session.begin_nested():
            yield db_session

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


@pytest.fixture
def make_client(app: FastAPI):
    """Factory fixture creating a TestClient with an explicit client peer IP address."""

    def _builder(client_ip: str | None = None) -> TestClient:
        client_tuple = (client_ip, 50000) if client_ip else None
        return TestClient(
            app,
            base_url="http://testserver",
            headers={"Origin": "http://testserver"},
            client=client_tuple,
        )

    return _builder


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> dict[str, datetime]:
    """Time seam freezing utcnow for deterministic testing."""
    now = {"t": datetime(2026, 11, 2, 4, 30, tzinfo=UTC)}
    monkeypatch.setattr("kalyan_api.clock.utcnow", lambda: now["t"])
    return now


@pytest.fixture
def without_active_admins(db_session: Session) -> None:
    """Deactivate all admin users within the test's rolled-back transaction."""
    db_session.execute(text("UPDATE users SET is_active = false WHERE role = 'ADMIN'"))
    db_session.flush()


@pytest.fixture
def setup_code(app: FastAPI, test_settings: Settings, tmp_path: Path) -> str:
    """Issue a first-run setup code into the test app and return the plaintext code."""
    code_path = tmp_path / "setup-code.txt"
    return issue_setup_code(app, test_settings, path=code_path)


@pytest.fixture
def patch_cli_session(monkeypatch: pytest.MonkeyPatch, db_session: Session) -> None:
    """Patch kalyan_api.cli.session_scope to yield db_session within the test's savepoint."""
    from contextlib import contextmanager

    @contextmanager
    def _mock_session_scope(settings=None):
        yield db_session

    monkeypatch.setattr("kalyan_api.cli.session_scope", _mock_session_scope)


TEST_PASSWORD = "ValidTestPassword123!"


def make_user(
    session: Session,
    settings: Settings,
    role: str,
    username: str,
    password: str = TEST_PASSWORD,
    must_change: bool = False,
    is_active: bool = True,
    doctor_name: str | None = None,
    is_super_admin: bool = False,
) -> User:
    """Helper creating user record (and linked Doctor stub if role is DOCTOR)."""
    hasher = build_hasher(settings)
    pw_hash = hash_password(hasher, password)
    doc_id: int | None = None

    if role == "DOCTOR":
        d_name = doctor_name or f"Dr. {username.capitalize()}"
        doc = Doctor(name_en=d_name, is_active=True)
        dept = session.query(Department).filter_by(name_en="Physiotherapy / General OPD").first()
        if not dept:
            dept = Department(name_en="Physiotherapy / General OPD", is_active=True)
            session.add(dept)
            session.flush()
        doc.departments.append(dept)
        session.add(doc)
        session.flush()
        doc_id = doc.id

    user = User(
        username=username.lower(),
        full_name=username.replace("_", " ").title(),
        role=role,
        doctor_id=doc_id,
        password_hash=pw_hash,
        must_change_password=must_change,
        is_active=is_active,
        is_super_admin=is_super_admin,
    )
    session.add(user)
    session.flush()
    return user


@pytest.fixture
def admin_user(db_session: Session, test_settings: Settings) -> User:
    """Default active Admin user."""
    return make_user(db_session, test_settings, "ADMIN", "fixture_admin")


@pytest.fixture
def reception_user(db_session: Session, test_settings: Settings) -> User:
    """Default active Reception user."""
    return make_user(db_session, test_settings, "RECEPTION", "fixture_reception")


@pytest.fixture
def doctor_a_user(db_session: Session, test_settings: Settings) -> User:
    """Default active Doctor user (Doctor A)."""
    return make_user(
        db_session, test_settings, "DOCTOR", "fixture_doctor_a", doctor_name="Dr. Anil"
    )


@pytest.fixture
def doctor_b_user(db_session: Session, test_settings: Settings) -> User:
    """Default active Doctor user (Doctor B)."""
    return make_user(
        db_session, test_settings, "DOCTOR", "fixture_doctor_b", doctor_name="Dr. Bharati"
    )


@pytest.fixture
def login_client(app: FastAPI):
    """Factory fixture returning an authenticated TestClient for a given user."""

    def _create(user: User, password: str = TEST_PASSWORD, takeover: bool = True) -> TestClient:
        c = TestClient(app, base_url="http://testserver", headers={"Origin": "http://testserver"})
        res = c.post(
            "/api/auth/login",
            json={"username": user.username, "password": password, "takeover": takeover},
        )
        assert res.status_code == 200, f"login_client failed: {res.text}"
        data = res.json()
        c.headers["X-CSRF-Token"] = data["csrf_token"]
        return c

    return _create
