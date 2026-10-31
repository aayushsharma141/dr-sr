"""Principal entity, session authentication dependency, and audit context builder.

Guarantees:
- D-07: Sliding idle timeout (30 min) and absolute timeout (12h).
- Touch throttling: updates last_seen_at at most once per touch_throttle_seconds.
- X-Kalyan-Passive: 1 skips session touch for non-human polling / background tabs.
- SEC-04: Session tokens verified via SHA-256 hash lookup; revoked sessions reject.
"""

import uuid
from dataclasses import dataclass
from datetime import timedelta

from fastapi import Depends, Request
from sqlalchemy import select, update

from kalyan_api import clock
from kalyan_api.config import Settings, get_settings
from kalyan_api.core import net
from kalyan_api.core.csrf import check_csrf_token
from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import ROLE_PERMISSIONS, Permission, Role
from kalyan_api.core.security import hash_token
from kalyan_api.db.session import SessionDep
from kalyan_api.models import AuthSession, User
from kalyan_api.services.audit_service import AuditContext


@dataclass(frozen=True)
class Principal:
    """Authenticated user context resolved per request."""

    user_id: int
    username: str
    role: Role
    doctor_id: int | None
    permissions: frozenset[Permission]
    session_id: int
    must_change_password: bool


def get_current_settings(request: Request) -> Settings:
    """Extract settings from application state or cached settings."""
    app_settings = getattr(request.app.state, "settings", None)
    return app_settings if app_settings is not None else get_settings()


def _resolve_principal_from_request(
    request: Request,
    session: SessionDep,
    settings: Settings,
    allow_pending: bool,
) -> Principal:
    """Validate session cookie, evaluate expirations, touch session, and build Principal."""
    token = request.cookies.get(settings.cookie_name)
    if not token:
        raise ApiError(
            status_code=401,
            code="not_authenticated",
            message="Authentication session cookie missing or empty",
        )

    token_h = hash_token(token)

    # Load session and user record
    stmt = (
        select(AuthSession, User)
        .join(User, AuthSession.user_id == User.id)
        .where(AuthSession.token_hash == token_h)
    )
    result = session.execute(stmt).first()
    if not result:
        raise ApiError(
            status_code=401,
            code="not_authenticated",
            message="Invalid or unrecognized session token",
        )

    auth_session, user = result

    # Check revocation and user active state
    if auth_session.revoked_at is not None or not user.is_active:
        raise ApiError(
            status_code=401,
            code="not_authenticated",
            message="Session has been revoked or user account is deactivated",
        )

    # Cryptographic CSRF token check on all state-modifying HTTP methods
    check_csrf_token(request, auth_session.csrf_token)

    now = clock.utcnow()

    # 1. Idle timeout check (D-07: 30 minutes)
    idle_limit = auth_session.last_seen_at + timedelta(minutes=settings.session_idle_minutes)
    if now > idle_limit:
        raise ApiError(
            status_code=401,
            code="session_expired",
            message=f"Session expired after {settings.session_idle_minutes} minutes of inactivity",
        )

    # 2. Absolute timeout check (12 hours)
    abs_limit = auth_session.created_at + timedelta(hours=settings.session_absolute_hours)
    if now > abs_limit:
        raise ApiError(
            status_code=401,
            code="session_expired",
            message=f"Session exceeded max lifetime of {settings.session_absolute_hours} hours",
        )

    # 3. Forced password change barrier
    if not allow_pending and user.must_change_password:
        raise ApiError(
            status_code=403,
            code="password_change_required",
            message="Temporary password must be changed before accessing application resources",
        )

    # 4. Touch last_seen_at if throttle window has elapsed and request is not marked passive
    is_passive = request.headers.get("X-Kalyan-Passive") == "1"
    if not is_passive:
        elapsed = (now - auth_session.last_seen_at).total_seconds()
        if elapsed >= settings.touch_throttle_seconds:
            throttle_cutoff = now - timedelta(seconds=settings.touch_throttle_seconds)
            session.execute(
                update(AuthSession)
                .where(
                    AuthSession.id == auth_session.id,
                    AuthSession.last_seen_at <= throttle_cutoff,
                )
                .values(last_seen_at=now)
            )
            auth_session.last_seen_at = now

    role_enum = Role(user.role)
    perms = ROLE_PERMISSIONS.get(role_enum, frozenset())

    return Principal(
        user_id=user.id,
        username=user.username,
        role=role_enum,
        doctor_id=user.doctor_id,
        permissions=perms,
        session_id=auth_session.id,
        must_change_password=user.must_change_password,
    )


def current_principal(
    request: Request,
    session: SessionDep,
    settings: Settings = Depends(get_current_settings),
) -> Principal:
    """Dependency returning authenticated principal; rejects users with must_change_password."""
    return _resolve_principal_from_request(request, session, settings, allow_pending=False)


def current_principal_allow_pending(
    request: Request,
    session: SessionDep,
    settings: Settings = Depends(get_current_settings),
) -> Principal:
    """Dependency returning authenticated principal; allows users with must_change_password."""
    return _resolve_principal_from_request(request, session, settings, allow_pending=True)


def build_audit_context(request: Request, principal: Principal | None = None) -> AuditContext:
    """Construct AuditContext from request tracing headers and active Principal."""
    req_id_raw = getattr(request.state, "request_id", None)
    req_uuid: uuid.UUID | None = None
    if isinstance(req_id_raw, uuid.UUID):
        req_uuid = req_id_raw
    elif isinstance(req_id_raw, str):
        try:
            req_uuid = uuid.UUID(req_id_raw)
        except ValueError:
            req_uuid = None

    client_ip = net.client_ip(request)
    user_agent = request.headers.get("User-Agent")

    if principal:
        role_val = (
            principal.role.value
            if hasattr(principal.role, "value")
            else str(principal.role)
        )
        return AuditContext(
            actor_user_id=principal.user_id,
            actor_username=principal.username,
            actor_role=role_val,
            ip=client_ip,
            user_agent=user_agent,
            request_id=req_uuid,
        )

    return AuditContext(
        actor_user_id=None,
        actor_username=None,
        actor_role=None,
        ip=client_ip,
        user_agent=user_agent,
        request_id=req_uuid,
    )
