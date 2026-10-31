"""Tests for the synchronous, in-transaction audit writer and redaction guards (AUD-01)."""

import uuid
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.models import AuditLog
from kalyan_api.services.audit_service import (
    AuditAction,
    AuditContext,
    AuditPayloadError,
    diff,
    record,
    snapshot,
)


def test_no_seed_rows(migrated_db: dict[str, int]) -> None:
    """Fresh baseline migration creates zero users, doctors, and setup rows (SEC-05)."""
    assert migrated_db["users"] == 0
    assert migrated_db["doctors"] == 0
    assert migrated_db["system_setup"] == 0

    # Statically scan 0001_baseline.py to ensure no hardcoded seed data
    migration_file = (
        Path(__file__).resolve().parent.parent
        / "src"
        / "kalyan_api"
        / "migrations"
        / "versions"
        / "0001_baseline.py"
    )
    content = migration_file.read_text(encoding="utf-8")
    assert "INSERT INTO users" not in content.upper()
    assert "INSERT INTO doctors" not in content.upper()


def test_audit_record_writes_inside_caller_transaction(db_session: Session) -> None:
    """audit.record writes an audit row inside the active transaction; flushes immediately."""
    ctx = AuditContext(
        actor_user_id=None,
        actor_username="test_actor",
        actor_role="ADMIN",
        ip="127.0.0.1",
        user_agent="pytest-client",
        request_id=uuid.uuid4(),
    )

    entry = record(
        db_session,
        ctx,
        AuditAction.AUTH_LOGIN_SUCCEEDED,
        "USER",
        1,
        after={"session_id": "test_sess_1"},
    )
    assert entry.id is not None
    assert entry.occurred_at is not None

    # Query back using the same session
    fetched = db_session.scalar(
        select(AuditLog).where(AuditLog.id == entry.id)
    )
    assert fetched is not None
    assert fetched.actor_username == "test_actor"
    assert fetched.action == "AUTH_LOGIN_SUCCEEDED"
    assert fetched.outcome == "SUCCESS"
    assert fetched.after_data == {"session_id": "test_sess_1"}


def test_audit_row_disappears_on_rollback(app_engine) -> None:
    """An audit row created inside a rolled-back transaction does not persist."""
    conn = app_engine.connect()
    tx = conn.begin()
    session = Session(bind=conn)

    ctx = AuditContext.system("rollback_test")
    entry = record(
        session,
        ctx,
        AuditAction.USER_CREATED,
        "USER",
        999,
        after={"username": "doomed_user"},
    )
    entry_id = entry.id
    assert entry_id is not None

    # Roll back outer transaction
    tx.rollback()
    conn.close()

    # Query from a fresh connection: the row must not exist
    with app_engine.connect() as check_conn:
        with Session(bind=check_conn) as check_session:
            found = check_session.scalar(
                select(AuditLog).where(AuditLog.id == entry_id)
            )
            assert found is None


@pytest.mark.parametrize(
    "forbidden_key",
    ["password", "password_hash", "new_password", "current_password", "token", "csrf_token"],
)
def test_redaction_guard_raises_on_sensitive_keys(
    db_session: Session, forbidden_key: str
) -> None:
    """Payload with sensitive credentials raises AuditPayloadError and writes nothing."""
    ctx = AuditContext.system("security_guard")

    # Top-level in before
    with pytest.raises(AuditPayloadError, match=forbidden_key):
        record(
            db_session,
            ctx,
            AuditAction.AUTH_PASSWORD_CHANGED,
            "USER",
            1,
            before={forbidden_key: "plain_secret"},
        )

    # Nested in after
    with pytest.raises(AuditPayloadError, match=forbidden_key):
        record(
            db_session,
            ctx,
            AuditAction.USER_UPDATED,
            "USER",
            1,
            after={"meta": {"details": {forbidden_key: "nested_secret"}}},
        )

    # In a list of dicts
    with pytest.raises(AuditPayloadError, match=forbidden_key):
        record(
            db_session,
            ctx,
            AuditAction.USER_UPDATED,
            "USER",
            1,
            after={"items": [{"safe": 1}, {forbidden_key: "deep_secret"}]},
        )


def test_actor_username_truncated_to_64() -> None:
    """AuditContext truncates actor_username exceeding 64 characters."""
    long_name = "admin_" + "a" * 80
    ctx = AuditContext(
        actor_user_id=1,
        actor_username=long_name,
        actor_role="ADMIN",
    )
    assert len(ctx.actor_username) == 64
    assert ctx.actor_username == long_name[:64]


def test_action_longer_than_48_chars_raises(db_session: Session) -> None:
    """Action strings longer than 48 characters raise ValueError."""
    ctx = AuditContext.system("cli:test")
    long_action = "A" * 49
    with pytest.raises(ValueError, match="exceeds maximum column length of 48"):
        record(
            db_session,
            ctx,
            long_action,
            "USER",
            1,
        )


def test_diff_utility() -> None:
    """diff captures only modified, added, or removed keys between dictionaries."""
    before = {"role": "DOCTOR", "full_name": "Dr. Old", "is_active": True}
    after = {"role": "DOCTOR", "full_name": "Dr. New", "is_active": False}

    diff_before, diff_after = diff(before, after)
    assert diff_before == {"full_name": "Dr. Old", "is_active": True}
    assert diff_after == {"full_name": "Dr. New", "is_active": False}
    assert "role" not in diff_before
    assert "role" not in diff_after

    # None handling
    assert diff(None, after) == (None, after)
    assert diff(before, None) == (before, None)


def test_snapshot_utility() -> None:
    """snapshot captures only requested attributes from an object."""
    class DummyUser:
        id = 10
        username = "dr_anil"
        full_name = "Dr. Anil Sharma"
        secret = "hidden"

    snap = snapshot(DummyUser(), ["id", "username", "full_name"])
    assert snap == {
        "id": 10,
        "username": "dr_anil",
        "full_name": "Dr. Anil Sharma",
    }
    assert "secret" not in snap
