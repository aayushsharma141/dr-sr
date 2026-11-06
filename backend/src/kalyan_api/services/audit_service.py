"""Synchronous, in-transaction audit logger and redaction guards (AUD-01).

Guarantees:
- Runs in the caller's active database transaction (same Session, session.flush()).
- Fails closed: an invalid payload or constraint error rolls back the caller's transaction.
- Redaction guard: raises AuditPayloadError on sensitive keys (passwords, tokens).
- Immutable: underlying database table audit_logs rejects UPDATE, DELETE, TRUNCATE.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from sqlalchemy.orm import Session

from kalyan_api.models import AuditLog


class AuditAction(StrEnum):
    """Catalog of auditable system actions across Kalyan Hospital platform."""

    AUTH_LOGIN_SUCCEEDED = "AUTH_LOGIN_SUCCEEDED"
    AUTH_LOGIN_FAILED = "AUTH_LOGIN_FAILED"
    AUTH_ACCOUNT_LOCKED = "AUTH_ACCOUNT_LOCKED"
    AUTH_LOGIN_THROTTLED = "AUTH_LOGIN_THROTTLED"
    AUTH_LOGOUT = "AUTH_LOGOUT"
    AUTH_PASSWORD_CHANGED = "AUTH_PASSWORD_CHANGED"  # noqa: S105
    AUTH_PASSWORD_CHANGE_FAILED = "AUTH_PASSWORD_CHANGE_FAILED"  # noqa: S105
    USER_CREATED = "USER_CREATED"
    USER_UPDATED = "USER_UPDATED"
    USER_ROLE_CHANGED = "USER_ROLE_CHANGED"
    USER_DEACTIVATED = "USER_DEACTIVATED"
    USER_REACTIVATED = "USER_REACTIVATED"
    USER_PASSWORD_RESET = "USER_PASSWORD_RESET"  # noqa: S105
    USER_UNLOCKED = "USER_UNLOCKED"
    SETUP_CODE_REJECTED = "SETUP_CODE_REJECTED"
    ADMIN_BOOTSTRAPPED = "ADMIN_BOOTSTRAPPED"
    ADMIN_PASSWORD_RESET_CLI = "ADMIN_PASSWORD_RESET_CLI"  # noqa: S105
    # Phase 12 actions
    SETTINGS_UPDATED = "SETTINGS_UPDATED"
    DOCTOR_CREATED = "DOCTOR_CREATED"
    DOCTOR_UPDATED = "DOCTOR_UPDATED"
    FEE_CREATED = "FEE_CREATED"
    FEE_UPDATED = "FEE_UPDATED"
    PATIENT_REGISTERED = "PATIENT_REGISTERED"
    PATIENT_UPDATED = "PATIENT_UPDATED"
    PHOTO_UPLOADED = "PHOTO_UPLOADED"
    # Phase 13 actions
    APPOINTMENT_CREATED = "APPOINTMENT_CREATED"
    APPOINTMENT_STATUS_UPDATED = "APPOINTMENT_STATUS_UPDATED"
    ENCOUNTER_CREATED = "ENCOUNTER_CREATED"
    ENCOUNTER_FINALISED = "ENCOUNTER_FINALISED"
    ENCOUNTER_ADDENDUM_ADDED = "ENCOUNTER_ADDENDUM_ADDED"
    # Phase 14 actions
    PRESCRIPTION_CREATED = "PRESCRIPTION_CREATED"
    TREATMENT_PLAN_CREATED = "TREATMENT_PLAN_CREATED"
    TREATMENT_PLAN_UPDATED = "TREATMENT_PLAN_UPDATED"
    TREATMENT_PLAN_CANCELLED = "TREATMENT_PLAN_CANCELLED"
    TREATMENT_SESSION_LOGGED = "TREATMENT_SESSION_LOGGED"
    TREATMENT_SESSION_ADDENDUM_ADDED = "TREATMENT_SESSION_ADDENDUM_ADDED"
    # Phase 15 actions
    PAYMENT_RECORDED = "PAYMENT_RECORDED"
    PAYMENT_REVERSED = "PAYMENT_REVERSED"
    # Phase 16 actions
    BACKUP_CREATED = "BACKUP_CREATED"
    BACKUP_RESTORED = "BACKUP_RESTORED"
    INTEGRITY_CHECK_RUN = "INTEGRITY_CHECK_RUN"
    # Admin Panel expansion actions
    SESSION_REVOKED = "SESSION_REVOKED"
    USER_SESSIONS_REVOKED = "USER_SESSIONS_REVOKED"
    SESSION_TAKEOVER = "SESSION_TAKEOVER"
    RECEIPT_REPRINTED = "RECEIPT_REPRINTED"
    BACKUP_FAILED = "BACKUP_FAILED"
    BACKUP_RESTORE_FAILED = "BACKUP_RESTORE_FAILED"
    SECURITY_POLICY_UPDATED = "SECURITY_POLICY_UPDATED"
    BACKUP_SETTINGS_UPDATED = "BACKUP_SETTINGS_UPDATED"
    BACKUP_PRUNED = "BACKUP_PRUNED"


class Outcome(StrEnum):
    """Audit action outcome."""

    SUCCESS = "SUCCESS"
    FAILURE = "FAILURE"
    DENIED = "DENIED"


class AuditPayloadError(Exception):
    """Raised when an audit payload fails structural validation or contains sensitive data."""


REDACTED_KEYS = frozenset(
    {
        "password",
        "password_hash",
        "new_password",
        "current_password",
        "token",
        "csrf_token",
    }
)


def _assert_no_redacted_keys(data: Any, path: str = "") -> None:
    """Recursively inspect dictionaries and collections for sensitive key names.

    Raises AuditPayloadError if any forbidden key is detected at any nesting depth.
    Never silently strips secrets: failing fast prevents accidental data leaks.
    """
    if isinstance(data, dict):
        for k, v in data.items():
            key_str = str(k).lower()
            current_path = f"{path}.{k}" if path else str(k)
            if key_str in REDACTED_KEYS:
                raise AuditPayloadError(
                    f"Forbidden sensitive key '{k}' detected at '{current_path}' in audit payload"
                )
            _assert_no_redacted_keys(v, current_path)
    elif isinstance(data, (list, tuple, set)):
        for idx, item in enumerate(data):
            _assert_no_redacted_keys(item, f"{path}[{idx}]")


@dataclass(frozen=True)
class AuditContext:
    """Explicit context parameters for audit event recording."""

    actor_user_id: int | None
    actor_username: str | None
    actor_role: str | None
    ip: str | None = None
    user_agent: str | None = None
    request_id: uuid.UUID | str | None = None

    def __post_init__(self) -> None:
        # Truncate username to max column width (64)
        if self.actor_username is not None and len(self.actor_username) > 64:
            object.__setattr__(self, "actor_username", self.actor_username[:64])

        # Normalize request_id to UUID object or None
        if isinstance(self.request_id, str):
            try:
                parsed_uuid = uuid.UUID(self.request_id)
                object.__setattr__(self, "request_id", parsed_uuid)
            except ValueError:
                object.__setattr__(self, "request_id", None)

    @classmethod
    def system(
        cls,
        label: str,
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> "AuditContext":
        """Factory for system, background task, or CLI actions."""
        return cls(
            actor_user_id=None,
            actor_username=label[:64],
            actor_role="SYSTEM",
            ip=ip,
            user_agent=user_agent,
            request_id=None,
        )


def diff(
    before: dict[str, Any] | None, after: dict[str, Any] | None
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Calculate changed field subset between before and after dictionaries."""
    if before is None or after is None:
        return before, after

    diff_before: dict[str, Any] = {}
    diff_after: dict[str, Any] = {}

    all_keys = set(before.keys()) | set(after.keys())
    for k in all_keys:
        val_before = before.get(k)
        val_after = after.get(k)
        if val_before != val_after:
            if k in before:
                diff_before[k] = val_before
            if k in after:
                diff_after[k] = val_after

    return diff_before, diff_after


def snapshot(obj: Any, fields: Sequence[str]) -> dict[str, Any]:
    """Capture a dictionary snapshot of selected attributes from an entity."""
    result: dict[str, Any] = {}
    for f in fields:
        if hasattr(obj, f):
            val = getattr(obj, f)
            # Format datetime as ISO string for JSON serialization
            if hasattr(val, "isoformat"):
                result[f] = val.isoformat()
            else:
                result[f] = val
    return result


def record(
    session: Session,
    ctx: AuditContext,
    action: AuditAction | str,
    entity_type: str | None,
    entity_id: int | str | None,
    *,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    reason: str | None = None,
    outcome: Outcome | str = Outcome.SUCCESS,
) -> AuditLog:
    """Record an audit entry synchronously within the caller's active database transaction.

    Flushes the entry immediately to participate in the caller's transaction and lock invariants.
    """
    action_str = str(action.value if hasattr(action, "value") else action)
    if len(action_str) > 48:
        raise ValueError(
            f"Audit action name '{action_str}' exceeds maximum column length of 48 characters"
        )

    outcome_str = str(outcome.value if hasattr(outcome, "value") else outcome)

    # Validate payloads against sensitive key leakage
    if before is not None:
        _assert_no_redacted_keys(before)
    if after is not None:
        _assert_no_redacted_keys(after)

    entity_id_str = str(entity_id) if entity_id is not None else None

    # Cast request_id to UUID if needed
    req_uuid: uuid.UUID | None = None
    if isinstance(ctx.request_id, uuid.UUID):
        req_uuid = ctx.request_id
    elif isinstance(ctx.request_id, str):
        try:
            req_uuid = uuid.UUID(ctx.request_id)
        except ValueError:
            req_uuid = None

    entry = AuditLog(
        actor_user_id=ctx.actor_user_id,
        actor_username=ctx.actor_username,
        actor_role=ctx.actor_role,
        action=action_str,
        outcome=outcome_str,
        entity_type=entity_type,
        entity_id=entity_id_str,
        before_data=before,
        after_data=after,
        reason=reason[:500] if reason else None,
        request_id=req_uuid,
        ip=ctx.ip,
        user_agent=ctx.user_agent[:255] if ctx.user_agent else None,
    )

    session.add(entry)
    session.flush()
    return entry
