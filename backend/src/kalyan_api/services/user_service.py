"""User management business logic, password provisioning, and optimistic concurrency."""

import secrets

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.password_policy import PasswordPolicyError, validate_password_policy
from kalyan_api.core.permissions import Role
from kalyan_api.core.security import build_hasher, hash_password
from kalyan_api.models import Doctor, User
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
) -> tuple[User, str]:
    """Create a new user account with one-time temporary password and audit record."""
    # Pre-check case-insensitive username collision
    normalized_username = payload.username.lower()
    existing = session.scalar(
        select(User).where(func.lower(User.username) == normalized_username)
    )
    if existing is not None:
        raise ApiError(
            status_code=409,
            code="username_taken",
            message=f"Username '{normalized_username}' is already taken",
        )

    temp_password = generate_temp_password(
        settings, username=payload.username, full_name=payload.full_name
    )
    hasher = build_hasher(settings)
    pw_hash = hash_password(hasher, temp_password)

    doctor_id: int | None = None
    if payload.role == Role.DOCTOR:
        doctor_stub = Doctor(
            name_en=payload.doctor_name_en or "",
            is_active=True,
        )
        session.add(doctor_stub)
        session.flush()
        doctor_id = doctor_stub.id

    role_val = (
        payload.role.value if hasattr(payload.role, "value") else str(payload.role)
    )
    user = User(
        username=normalized_username,
        full_name=payload.full_name,
        role=role_val,
        doctor_id=doctor_id,
        password_hash=pw_hash,
        must_change_password=True,
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

    audit_service.record(
        session,
        ctx,
        AuditAction.USER_CREATED,
        "USER",
        user.id,
        after={
            "role": user.role,
            "full_name": user.full_name,
            "doctor_id": user.doctor_id,
        },
    )

    return user, temp_password


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
