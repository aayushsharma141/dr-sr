"""Clock abstraction providing deterministic timestamps for sessions, lockout, and audit."""

from datetime import UTC, datetime


def utcnow() -> datetime:
    """Return current timezone-aware UTC datetime."""
    return datetime.now(UTC)

