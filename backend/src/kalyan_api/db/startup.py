"""Startup invariants, database availability wait, durability checks, and setup detection.

Guarantees:
- D-02: synchronous_commit, fsync, and full_page_writes are verified.
- SEC-07: setup_completed() authoritatively checks the system_setup table row.
- Revision gate: prevents the application from starting against a stale database schema.
"""

import logging
import time
import zoneinfo

from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, Engine, text
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.db.migrate import alembic_config

logger = logging.getLogger("kalyan_api.startup")


class SchemaMismatchError(Exception):
    """Raised when the database revision does not match the Alembic migration head."""


class DurabilityError(Exception):
    """Raised in production when PostgreSQL durability settings violate D-02."""


class DatabaseTimeoutError(Exception):
    """Raised when PostgreSQL does not become available within the timeout window."""


def check_timezone_data() -> None:
    """Ensure Asia/Kolkata timezone data resolves correctly via tzdata."""
    try:
        zoneinfo.ZoneInfo("Asia/Kolkata")
    except Exception as exc:
        raise RuntimeError("Failed to resolve 'Asia/Kolkata' timezone data") from exc


def wait_for_db(engine: Engine, timeout_s: float = 60.0) -> None:
    """Wait for PostgreSQL database server to accept connections with exponential backoff.

    Guards against cold power-cut boot conditions where the server PC starts before
    PostgreSQL crash recovery finishes (D-02 / Pitfall 4).
    """
    start_time = time.monotonic()
    delay = 0.2
    last_error: Exception | None = None

    while (time.monotonic() - start_time) < timeout_s:
        try:
            with engine.connect() as conn:
                conn.scalar(text("SELECT 1"))
                logger.info("Database connection established successfully")
                return
        except Exception as exc:
            last_error = exc
            time.sleep(delay)
            delay = min(delay * 1.5, 2.0)

    raise DatabaseTimeoutError(
        f"Database connection timed out after {timeout_s}s. Last error: {last_error}"
    )


def assert_schema_current(engine: Engine) -> None:
    """Verify the database schema matches the head Alembic migration revision.

    Refuses startup if the database is unmigrated or stale.
    """
    cfg = alembic_config("postgresql+psycopg://dummy:dummy@127.0.0.1/dummy")
    script = ScriptDirectory.from_config(cfg)
    expected_head = script.get_current_head()

    with engine.connect() as conn:
        context = MigrationContext.configure(conn)
        current_rev = context.get_current_revision()

    if current_rev != expected_head:
        raise SchemaMismatchError(
            f"Database revision '{current_rev}' does not match Alembic head '{expected_head}'. "
            "Please run 'python -m kalyan_api.cli migrate' to apply pending migrations."
        )


def check_durability(engine: Engine, strict: bool = False) -> dict[str, str]:
    """Check effective PostgreSQL durability parameters against D-02.

    Under D-02, a line-interactive UPS protects the server, and PostgreSQL must run with:
    - synchronous_commit = on (or remote_apply)
    - fsync = on
    - full_page_writes = on
    """
    with engine.connect() as conn:
        sync_commit = str(conn.scalar(text("SHOW synchronous_commit")) or "").strip().lower()
        fsync = str(conn.scalar(text("SHOW fsync")) or "").strip().lower()
        full_page = str(conn.scalar(text("SHOW full_page_writes")) or "").strip().lower()

    durability = {
        "synchronous_commit": sync_commit,
        "fsync": fsync,
        "full_page_writes": full_page,
    }

    is_compliant = sync_commit in ("on", "remote_apply") and fsync == "on" and full_page == "on"

    if not is_compliant:
        msg = (
            f"PostgreSQL durability settings violate D-02 invariant: {durability}. "
            "Expected synchronous_commit in ('on', 'remote_apply'), fsync/full_page_writes='on'."
        )
        if strict:
            raise DurabilityError(msg)
        logger.warning(msg)

    return durability


def setup_completed(session_or_conn: Session | Connection) -> bool:
    """Authoritatively check whether system setup has completed (SEC-07).

    Setup completion is determined STRICTLY by the presence of a row in the
    append-only system_setup table. Deactivating admins or restarts never reopens setup.
    """
    stmt = text("SELECT EXISTS(SELECT 1 FROM system_setup WHERE id = 1)")
    result = session_or_conn.scalar(stmt)
    return bool(result)


def run_startup_checks(engine: Engine, settings: Settings) -> None:
    """Execute all pre-flight startup gates.

    Called during application lifespan before accepting HTTP traffic.
    """
    logger.info("Executing Kalyan API startup checks...")
    check_timezone_data()
    wait_for_db(engine, timeout_s=60.0)
    assert_schema_current(engine)
    is_prod = settings.env.lower() == "production"
    check_durability(engine, strict=is_prod)
    logger.info("Startup checks passed successfully")
