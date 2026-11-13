"""User management business logic, password provisioning, and optimistic concurrency."""

import secrets
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.core.errors import ApiError, VersionConflict, require_version
from kalyan_api.core.password_policy import PasswordPolicyError, validate_password_policy
from kalyan_api.core.permissions import Role
from kalyan_api.core.security import build_hasher, hash_password, verify_password
from kalyan_api.models import AuditLog, AuthSession, Doctor, User
from kalyan_api.schemas.users import UserCreate, UserUpdate
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction, AuditContext, Outcome

# Unambiguous alphabet excluding easily confused characters (0, O, 1, l, I)
UNAMBIGUOUS_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*"


def generate_temp_password(
    settings: Settings,
    username: str = "tempuser",
    full_name: str | None = None,
) -> str:
    """Generate unambiguous temporary password conforming to password policy."""
    length = max(settings.temp_password_length, settings.password_min_length)
    for _ in range(100):
        candidate = "".join(secrets.choice(UNAMBIGUOUS_CHARS) for _ in range(length))
        try:
            validate_password_policy(candidate, username, full_name, settings)
            return candidate
        except PasswordPolicyError:
            continue
    raise RuntimeError("Failed to generate conforming temporary password after 100 attempts")


def get_user(session: Session, user_id: int) -> User | None:
    """Fetch single user by identifier."""
    return session.scalar(select(User).where(User.id == user_id))


def list_users(session: Session, is_active: bool | None = None) -> list[User]:
    """List all user records ordered by ID with optional active state filter."""
    stmt = select(User).order_by(User.id.asc())
    if is_active is not None:
        stmt = stmt.where(User.is_active == is_active)
    return list(session.scalars(stmt).all())


def create_user(
    session: Session,
    ctx: AuditContext,
    payload: UserCreate,
    settings: Settings,
    explicit_password: str | None = None,
    must_change_password: bool | None = None,
    audit_action: AuditAction | None = AuditAction.USER_CREATED,
) -> tuple[User, str]:
    """Create a new user account with temporary or explicit password and audit record."""
    # Pre-check case-insensitive username collision
    normalized_username = payload.username.lower()
    existing = session.scalar(select(User).where(func.lower(User.username) == normalized_username))
    if existing is not None:
        raise ApiError(
            status_code=409,
            code="username_taken",
            message=f"Username '{normalized_username}' is already taken",
        )

    if explicit_password is not None:
        password_to_use = explicit_password
        must_change = must_change_password if must_change_password is not None else False
    else:
        password_to_use = generate_temp_password(
            settings, username=payload.username, full_name=payload.full_name
        )
        must_change = must_change_password if must_change_password is not None else True

    hasher = build_hasher(settings)
    pw_hash = hash_password(hasher, password_to_use)

    doctor_id: int | None = None
    if payload.role == Role.DOCTOR:
        doctor_stub = Doctor(
            name_en=payload.doctor_name_en or "",
            is_active=True,
        )
        session.add(doctor_stub)
        session.flush()
        doctor_id = doctor_stub.id

    role_val = payload.role.value if hasattr(payload.role, "value") else str(payload.role)
    user = User(
        username=normalized_username,
        full_name=payload.full_name,
        role=role_val,
        doctor_id=doctor_id,
        password_hash=pw_hash,
        must_change_password=must_change,
        is_active=True,
        created_by=ctx.actor_user_id,
    )
    session.add(user)

    try:
        session.flush()
    except IntegrityError as err:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="username_taken",
            message=f"Username '{normalized_username}' is already taken",
        ) from err

    if audit_action is not None:
        audit_service.record(
            session,
            ctx,
            audit_action,
            "USER",
            user.id,
            after={
                "role": user.role,
                "full_name": user.full_name,
                "doctor_id": user.doctor_id,
            },
        )

    return user, password_to_use


def update_user(
    session: Session,
    ctx: AuditContext,
    user_id: int,
    payload: UserUpdate,
) -> User:
    """Modify user account attributes with optimistic concurrency validation."""
    user = get_user(session, user_id)
    if not user:
        raise ApiError(
            status_code=404,
            code="not_found",
            message=f"User #{user_id} not found",
        )

    # SEC-06: Explicit client version check
    require_version(user, payload.version_id, "user")

    target_role = (
        payload.role.value
        if (payload.role is not None and hasattr(payload.role, "value"))
        else (str(payload.role) if payload.role is not None else None)
    )

    # Guard 1: Prevent administrators from modifying their own role
    if target_role is not None and target_role != user.role:
        if user.id == ctx.actor_user_id:
            raise ApiError(
                status_code=409,
                code="self_action_forbidden",
                message="Administrators cannot modify their own role",
            )

        # Guard 2 (EG-15): Role changes to or from DOCTOR are prohibited in Phase 11
        if user.role == Role.DOCTOR.value or target_role == Role.DOCTOR.value:
            raise ApiError(
                status_code=409,
                code="role_change_not_allowed",
                message="Role changes involving DOCTOR are not permitted",
            )

        # Guard 3a: A super admin must stay an administrator (DB CHECK would also refuse it)
        if user.is_super_admin and target_role != Role.ADMIN.value:
            raise ApiError(
                status_code=409,
                code="super_admin_protected",
                message="The super admin account must remain an administrator",
            )

        # Guard 3: Prevent demoting the last active administrator
        if user.role == Role.ADMIN.value and target_role != Role.ADMIN.value:
            if user.is_active:
                active_admin_count = session.scalar(
                    select(func.count(User.id)).where(
                        User.role == Role.ADMIN.value, User.is_active.is_(True)
                    )
                )
                if active_admin_count is not None and active_admin_count <= 1:
                    raise ApiError(
                        status_code=409,
                        code="last_admin",
                        message="Cannot change role of the last active administrator",
                    )

        old_role = user.role
        user.role = target_role
        audit_service.record(
            session,
            ctx,
            AuditAction.USER_ROLE_CHANGED,
            "USER",
            user.id,
            before={"role": old_role},
            after={"role": user.role},
        )

    if payload.full_name is not None and payload.full_name != user.full_name:
        old_name = user.full_name
        user.full_name = payload.full_name
        audit_service.record(
            session,
            ctx,
            AuditAction.USER_UPDATED,
            "USER",
            user.id,
            before={"full_name": old_name},
            after={"full_name": user.full_name},
        )

    session.flush()
    return user


def deactivate_user(
    session: Session,
    ctx: AuditContext,
    user_id: int,
    version_id: int,
    reason: str | None = None,
) -> User:
    """Deactivate user, revoke active sessions, and record audit event."""
    user = get_user(session, user_id)
    if not user:
        raise ApiError(status_code=404, code="not_found", message=f"User #{user_id} not found")

    require_version(user, version_id, "user")

    if not user.is_active:
        raise ApiError(
            status_code=409,
            code="state_unchanged",
            message="User is already deactivated",
        )

    if user.id == ctx.actor_user_id:
        raise ApiError(
            status_code=409,
            code="self_action_forbidden",
            message="Administrators cannot deactivate their own account",
        )

    if user.role == Role.ADMIN.value:
        active_count = session.scalar(
            select(func.count(User.id)).where(
                User.role == Role.ADMIN.value, User.is_active.is_(True)
            )
        )
        if active_count is not None and active_count <= 1:
            raise ApiError(
                status_code=409,
                code="last_admin",
                message="Cannot deactivate the last active administrator",
            )

    if user.is_super_admin:
        other_super_admins = session.scalar(
            select(func.count(User.id)).where(
                User.is_super_admin.is_(True), User.is_active.is_(True), User.id != user.id
            )
        )
        if not other_super_admins:
            raise ApiError(
                status_code=409,
                code="last_super_admin",
                message="Cannot deactivate the only active super admin account",
            )

    user.is_active = False

    # Revoke all active sessions for this user
    now = clock.utcnow()
    session.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )

    session.flush()

    audit_service.record(
        session,
        ctx,
        AuditAction.USER_DEACTIVATED,
        "USER",
        user.id,
        before={"is_active": True},
        after={"is_active": False},
        reason=reason,
    )

    return user


DELETE_FAILURE_LIMIT = 5
DELETE_FAILURE_WINDOW_MINUTES = 15


@dataclass(frozen=True)
class DeleteResult:
    """Outcome of a delete attempt: "deleted", "bad_password" or "throttled"."""

    status: str
    user: User | None = None


@dataclass(frozen=True)
class BulkDeleteItem:
    """One account in a bulk delete request, with the version the caller last saw."""

    user_id: int
    version_id: int


@dataclass(frozen=True)
class BulkDeleteEntry:
    """Per-account outcome of a bulk delete: deleted, or skipped with the reason."""

    user_id: int
    username: str | None
    deleted: bool
    code: str | None = None
    message: str | None = None


@dataclass(frozen=True)
class BulkDeleteResult:
    """Outcome of a bulk delete: "done", "bad_password" or "throttled"."""

    status: str
    entries: list[BulkDeleteEntry]


def _check_deletable(ctx: AuditContext, user: User, version_id: int) -> None:
    """Raise ApiError unless this account may be put forward for deletion."""
    require_version(user, version_id, "user")

    if user.id == ctx.actor_user_id:
        raise ApiError(
            status_code=409,
            code="self_action_forbidden",
            message="Administrators cannot delete their own account",
        )
    if user.is_super_admin:
        raise ApiError(
            status_code=409,
            code="super_admin_protected",
            message="Super admin accounts cannot be deleted",
        )
    if user.is_active:
        raise ApiError(
            status_code=409,
            code="user_still_active",
            message="Deactivate the account before deleting it",
        )


def _authorise_super_admin(
    session: Session,
    ctx: AuditContext,
    settings: Settings,
    super_admin_password: str,
    entity_id: int | None,
) -> str | None:
    """Return None when the super admin password is accepted, else "throttled"/"bad_password".

    A wrong password is audited here and returned (not raised) so the audit row is committed.
    Raises ApiError(no_super_admin) when no active super admin exists to authorise anything.
    """
    now = clock.utcnow()
    recent_denials = session.scalar(
        select(func.count(AuditLog.id)).where(
            AuditLog.action == AuditAction.USER_DELETE_DENIED.value,
            AuditLog.actor_user_id == ctx.actor_user_id,
            AuditLog.occurred_at >= now - timedelta(minutes=DELETE_FAILURE_WINDOW_MINUTES),
        )
    )
    if (recent_denials or 0) >= DELETE_FAILURE_LIMIT:
        return "throttled"

    super_admins = session.scalars(
        select(User).where(User.is_super_admin.is_(True), User.is_active.is_(True))
    ).all()
    if not super_admins:
        raise ApiError(
            status_code=409,
            code="no_super_admin",
            message="No active super admin account exists to authorise this deletion",
        )

    hasher = build_hasher(settings)
    confirmed = False
    for super_admin in super_admins:
        if verify_password(hasher, super_admin_password, super_admin.password_hash):
            confirmed = True

    if not confirmed:
        audit_service.record(
            session,
            ctx,
            AuditAction.USER_DELETE_DENIED,
            "USER",
            entity_id,
            reason="Super admin password was not accepted",
            outcome=Outcome.DENIED,
        )
        return "bad_password"
    return None


def _perform_delete(session: Session, ctx: AuditContext, user: User, reason: str | None) -> None:
    """Delete one account through the guarded database function and audit it.

    The database function fails for any account referenced by audit, financial or clinical
    records; that becomes ApiError(user_has_history). The savepoint keeps a refusal from
    aborting the surrounding transaction, so a bulk run can carry on with the next account.
    """
    user_id = user.id
    snapshot = {"username": user.username, "role": user.role, "is_active": user.is_active}
    try:
        with session.begin_nested():
            deleted = session.scalar(select(func.delete_unreferenced_user(user_id)))
    except IntegrityError as exc:
        raise ApiError(
            status_code=409,
            code="user_has_history",
            message=(
                "This account has recorded activity and cannot be deleted. "
                "Keep it deactivated instead."
            ),
        ) from exc
    if not deleted:
        raise ApiError(status_code=404, code="not_found", message=f"User #{user_id} not found")

    session.expunge(user)
    audit_service.record(
        session,
        ctx,
        AuditAction.USER_DELETED,
        "USER",
        user_id,
        before=snapshot,
        reason=reason,
    )


def delete_user(
    session: Session,
    ctx: AuditContext,
    settings: Settings,
    user_id: int,
    version_id: int,
    super_admin_password: str,
    reason: str | None = None,
) -> DeleteResult:
    """Delete an unused, deactivated account once the super admin's password is confirmed."""
    user = get_user(session, user_id)
    if not user:
        raise ApiError(status_code=404, code="not_found", message=f"User #{user_id} not found")

    _check_deletable(ctx, user, version_id)

    failure = _authorise_super_admin(session, ctx, settings, super_admin_password, user.id)
    if failure is not None:
        return DeleteResult(status=failure)

    _perform_delete(session, ctx, user, reason)
    return DeleteResult(status="deleted", user=user)


def bulk_delete_users(
    session: Session,
    ctx: AuditContext,
    settings: Settings,
    items: list[BulkDeleteItem],
    super_admin_password: str,
    reason: str | None = None,
) -> BulkDeleteResult:
    """Delete several accounts under ONE super admin password check.

    The password is verified once, before any account is touched. Each account is then checked
    and deleted on its own: one that is still active, protected, changed since it was listed, or
    has recorded history is skipped with its reason and never blocks the others. Every deletion
    writes its own USER_DELETED audit entry.
    """
    failure = _authorise_super_admin(session, ctx, settings, super_admin_password, None)
    if failure is not None:
        return BulkDeleteResult(status=failure, entries=[])

    entries: list[BulkDeleteEntry] = []
    for item in items:
        user = get_user(session, item.user_id)
        if user is None:
            entries.append(
                BulkDeleteEntry(
                    user_id=item.user_id,
                    username=None,
                    deleted=False,
                    code="not_found",
                    message=f"User #{item.user_id} not found",
                )
            )
            continue
        username = user.username
        try:
            _check_deletable(ctx, user, item.version_id)
            _perform_delete(session, ctx, user, reason)
        except VersionConflict:
            entries.append(
                BulkDeleteEntry(
                    user_id=item.user_id,
                    username=username,
                    deleted=False,
                    code="version_conflict",
                    message="This account changed since the list was loaded. Reload and try again.",
                )
            )
            continue
        except ApiError as err:
            entries.append(
                BulkDeleteEntry(
                    user_id=item.user_id,
                    username=username,
                    deleted=False,
                    code=err.code,
                    message=err.message,
                )
            )
            continue
        entries.append(BulkDeleteEntry(user_id=item.user_id, username=username, deleted=True))
    return BulkDeleteResult(status="done", entries=entries)


def reactivate_user(
    session: Session,
    ctx: AuditContext,
    user_id: int,
    version_id: int,
    reason: str | None = None,
) -> User:
    """Reactivate a previously deactivated user account."""
    user = get_user(session, user_id)
    if not user:
        raise ApiError(status_code=404, code="not_found", message=f"User #{user_id} not found")

    require_version(user, version_id, "user")

    if user.is_active:
        raise ApiError(status_code=409, code="state_unchanged", message="User is already active")

    user.is_active = True
    session.flush()

    audit_service.record(
        session,
        ctx,
        AuditAction.USER_REACTIVATED,
        "USER",
        user.id,
        before={"is_active": False},
        after={"is_active": True},
        reason=reason,
    )

    return user


def reset_password(
    session: Session,
    ctx: AuditContext,
    user_id: int,
    version_id: int,
    settings: Settings,
    reason: str | None = None,
) -> tuple[User, str]:
    """Admin resets user password, issues a temporary password, and revokes sessions."""
    user = get_user(session, user_id)
    if not user:
        raise ApiError(status_code=404, code="not_found", message=f"User #{user_id} not found")

    require_version(user, version_id, "user")

    if user.id == ctx.actor_user_id:
        raise ApiError(
            status_code=409,
            code="self_action_forbidden",
            message="Administrators cannot reset their own password via admin API",
        )

    old_must_change = user.must_change_password
    temp_pwd = generate_temp_password(settings, username=user.username, full_name=user.full_name)
    hasher = build_hasher(settings)
    user.password_hash = hash_password(hasher, temp_pwd)
    user.must_change_password = True

    # Revoke all active sessions for this user
    now = clock.utcnow()
    session.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )

    session.flush()

    # Never log temporary passwords
    audit_service.record(
        session,
        ctx,
        AuditAction.USER_PASSWORD_RESET,
        "USER",
        user.id,
        before={"must_change_password": old_must_change},
        after={"must_change_password": True},
        reason=reason,
    )

    return user, temp_pwd


def unlock_user(
    session: Session,
    ctx: AuditContext,
    user_id: int,
    version_id: int,
    reason: str | None = None,
) -> User:
    """Reset lockout counters and release account cooldown (D-07)."""
    user = get_user(session, user_id)
    if not user:
        raise ApiError(status_code=404, code="not_found", message=f"User #{user_id} not found")

    require_version(user, version_id, "user")

    now = clock.utcnow()
    is_locked = bool(user.locked_until and user.locked_until > now)
    if user.failed_login_count == 0 and not is_locked:
        raise ApiError(
            status_code=409,
            code="state_unchanged",
            message="User account is not locked",
        )

    old_count = user.failed_login_count
    old_locked = user.locked_until.isoformat() if user.locked_until else None

    user.failed_login_count = 0
    user.locked_until = None

    session.flush()

    audit_service.record(
        session,
        ctx,
        AuditAction.USER_UNLOCKED,
        "USER",
        user.id,
        before={"failed_login_count": old_count, "locked_until": old_locked},
        after={"failed_login_count": 0, "locked_until": None},
        reason=reason,
    )

    return user


LOGIN_HISTORY_LIMIT = 50

# Actions recorded against entity USER/<user_id> that describe sign-in and account security.
LOGIN_HISTORY_USER_ACTIONS: tuple[AuditAction, ...] = (
    AuditAction.AUTH_LOGIN_SUCCEEDED,
    AuditAction.AUTH_LOGIN_FAILED,
    AuditAction.AUTH_ACCOUNT_LOCKED,
    AuditAction.AUTH_LOGIN_THROTTLED,
    AuditAction.AUTH_LOGOUT,
    AuditAction.AUTH_PASSWORD_CHANGED,
    AuditAction.AUTH_PASSWORD_CHANGE_FAILED,
    AuditAction.USER_UNLOCKED,
    AuditAction.USER_PASSWORD_RESET,
    AuditAction.USER_SESSIONS_REVOKED,
)

# Only these scalar after/before keys are surfaced as login-history details (never secrets).
LOGIN_HISTORY_DETAIL_KEYS: tuple[str, ...] = (
    "reason",
    "failed_login_count",
    "locked_until",
    "session_id",
    "must_change_password",
    "revoked_count",
    "kept_current_session",
    "attempt_count",
)


def login_history(
    session: Session, user_id: int, limit: int = LOGIN_HISTORY_LIMIT
) -> list[AuditLog]:
    """Return the latest sign-in and account-security audit rows concerning one user.

    Includes AUTH_* events, unlocks, password resets and session revocations recorded against
    entity USER/<user_id>, plus SESSION_REVOKED rows whose target user is ``user_id``.
    """
    user_entity = and_(
        AuditLog.entity_type == "USER",
        AuditLog.entity_id == str(user_id),
        AuditLog.action.in_([a.value for a in LOGIN_HISTORY_USER_ACTIONS]),
    )
    revoked_session = and_(
        AuditLog.action == AuditAction.SESSION_REVOKED.value,
        AuditLog.entity_type == "SESSION",
        AuditLog.after_data["user_id"].astext == str(user_id),
    )
    stmt = (
        select(AuditLog)
        .where(or_(user_entity, revoked_session))
        .order_by(AuditLog.occurred_at.desc(), AuditLog.id.desc())
        .limit(limit)
    )
    return list(session.scalars(stmt).all())


def login_history_details(entry: AuditLog) -> dict[str, str | int | bool | None]:
    """Extract allow-listed scalar details from an audit row's after (else before) payload."""
    details: dict[str, str | int | bool | None] = {}
    for payload in (entry.before_data, entry.after_data):
        if not isinstance(payload, dict):
            continue
        for key in LOGIN_HISTORY_DETAIL_KEYS:
            value = payload.get(key)
            if key in payload and (value is None or isinstance(value, (str, int, bool))):
                details[key] = value
    return details
