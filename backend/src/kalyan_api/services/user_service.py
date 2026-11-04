"""User management business logic, password provisioning, and optimistic concurrency."""

import secrets

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.password_policy import PasswordPolicyError, validate_password_policy
from kalyan_api.core.permissions import Role
from kalyan_api.core.security import build_hasher, hash_password
from kalyan_api.models import AuditLog, AuthSession, Doctor, User
from kalyan_api.schemas.users import UserCreate, UserUpdate
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction, AuditContext

# Unambiguous alphabet excluding easily confused characters (0, O, 1, l, I)
UNAMBIGUOUS_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*"


def generate_temp_password(
    settings: Settings,
    username: str = "tempuser",
    full_name: str | None = None,
) -> str:
    """Generate unambiguous temporary password conforming to password policy."""
    length = settings.temp_password_length
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
