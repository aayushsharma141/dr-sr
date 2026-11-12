"""Reset and migrate a disposable test database.

This is the only supported way to wipe a schema for testing. It refuses to run unless
``KALYAN_DB_NAME`` names a test database (see ``kalyan_api.db.guards``), so a forgotten
environment variable can no longer point it at the authoritative database.

Usage (from backend/):
    KALYAN_DB_NAME=kalyan_test ./.venv/Scripts/python.exe scripts/reset_test_db.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sqlalchemy import create_engine, text  # noqa: E402

from kalyan_api.config import get_settings  # noqa: E402
from kalyan_api.db.guards import UnsafeDatabaseError, require_test_database  # noqa: E402
from kalyan_api.db.migrate import upgrade_head  # noqa: E402


def main() -> int:
    settings = get_settings()
    try:
        name = require_test_database(settings, "reset the schema")
    except UnsafeDatabaseError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2

    print(f"Resetting schema 'public' in test database '{name}'...")
    owner_engine = create_engine(settings.owner_url, isolation_level="AUTOCOMMIT")
    with owner_engine.connect() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    owner_engine.dispose()

    upgrade_head(settings.owner_url)
    print(f"Test database '{name}' reset and migrated to head.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
