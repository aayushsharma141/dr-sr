"""Safety checks for scripts that wipe or replace database contents.

A destructive script must never run against the authoritative hospital database. This module
accepts only database names that clearly identify a test or disposable database (for example
``kalyan_test`` or ``test_kalyan``) and refuses everything else, including ``kalyan_dev``.

The check is deliberately name-based and in addition to credentials: it cannot tell whether a
name points at production, so it refuses any name it does not positively recognise as a test
database.
"""

import re

from kalyan_api.config import Settings

# ``kalyan_test``, ``test_kalyan``, ``kalyan_test_db``, ``test``.
TEST_DATABASE_PATTERN = re.compile(
    r"^(?:test|tests)(?:[_][a-z0-9_]+)?$"
    r"|^[a-z0-9_]+[_]tests?(?:[_]db)?$"
)

# Names that must be refused even if a future pattern were loosened.
PROTECTED_DATABASE_NAMES = frozenset(
    {
        "kalyan",
        "kalyan_dev",
        "kalyan_development",
        "kalyan_prod",
        "kalyan_production",
        "postgres",
        "template0",
        "template1",
    }
)


class UnsafeDatabaseError(RuntimeError):
    """Raised when a destructive operation targets a database that is not clearly a test one."""


def is_test_database_name(name: str) -> bool:
    """True only for names that positively identify a test database."""
    normalized = (name or "").strip().lower()
    if not normalized or normalized in PROTECTED_DATABASE_NAMES:
        return False
    return TEST_DATABASE_PATTERN.fullmatch(normalized) is not None


def require_test_database(settings: Settings, operation: str) -> str:
    """Return the database name, or refuse to continue when it is not a test database.

    Raises:
        UnsafeDatabaseError: when ``settings.db_name`` is not clearly a test database.
    """
    name = settings.db_name
    if not is_test_database_name(name):
        raise UnsafeDatabaseError(
            f"Refusing to {operation} on database '{name}'. Destructive database scripts run "
            "only against a database whose name clearly marks it as a test database "
            "(for example 'kalyan_test'). Set KALYAN_DB_NAME explicitly."
        )
    return name
