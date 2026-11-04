"""User administration endpoints for creating, listing, and updating accounts."""

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
    get_effective_settings,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.schemas.sessions import RevokeSessionRequest, RevokeUserSessionsOut
from kalyan_api.schemas.users import (
    ActionRequest,
    LoginHistoryEntry,
    UserCreate,
    UserCreatedOut,
    UserOut,
    UserUpdate,
)
from kalyan_api.services import auth_service, user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get(
    "",
    response_model=list[UserOut],
    dependencies=[Depends(require(Permission.USER_READ))],
)
def list_all_users(
    session: SessionDep,
    is_active: bool | None = Query(default=None),
    _principal: Principal = Depends(current_principal),
) -> list[UserOut]:
    """List registered users ordered by identifier with optional active filter."""
    users = user_service.list_users(session, is_active=is_active)
    now = clock.utcnow()
    return [UserOut.from_user(u, now=now) for u in users]


@router.get(
    "/{id}",
    response_model=UserOut,
    dependencies=[Depends(require(Permission.USER_READ))],
)
def get_user_detail(
    id: int,
    session: SessionDep,
    _principal: Principal = Depends(current_principal),
) -> UserOut:
    """Retrieve details for a single user record."""
    user = user_service.get_user(session, id)
    if not user:
        raise ApiError(
            status_code=404,
            code="not_found",
            message=f"User #{id} not found",
        )
    return UserOut.from_user(user, now=clock.utcnow())


@router.post(
    "",
    response_model=UserCreatedOut,
    status_code=201,
    dependencies=[Depends(require(Permission.USER_CREATE))],
)
def create_new_user(
    request: Request,
    payload: UserCreate,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
    settings: Settings = Depends(get_effective_settings),
) -> JSONResponse:
    """Create a new user account returning a one-time temporary password."""
    ctx = build_audit_context(request, principal)
    user, temp_pwd = user_service.create_user(session, ctx, payload, settings)
    now = clock.utcnow()
    out = UserCreatedOut.from_user_and_secret(user, temp_pwd, now=now)

    return JSONResponse(
        status_code=201,
        content=out.model_dump(mode="json"),
        headers={"Cache-Control": "no-store"},
    )


@router.patch(
    "/{id}",
    response_model=UserOut,
    dependencies=[Depends(require(Permission.USER_UPDATE))],
)
def update_existing_user(
    id: int,
    request: Request,
    payload: UserUpdate,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> UserOut:
    """Update user account details subject to optimistic concurrency version check."""
    ctx = build_audit_context(request, principal)
    user = user_service.update_user(session, ctx, id, payload)
    return UserOut.from_user(user, now=clock.utcnow())


@router.post(
    "/{id}/deactivate",
    response_model=UserOut,
    dependencies=[Depends(require(Permission.USER_DEACTIVATE))],
)
def deactivate_existing_user(
    id: int,
    request: Request,
    payload: ActionRequest,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> UserOut:
    """Deactivate user account, terminate all sessions, and audit action."""
    ctx = build_audit_context(request, principal)
    user = user_service.deactivate_user(session, ctx, id, payload.version_id, reason=payload.reason)
    return UserOut.from_user(user, now=clock.utcnow())


@router.post(
    "/{id}/reactivate",
    response_model=UserOut,
    dependencies=[Depends(require(Permission.USER_DEACTIVATE))],
)
def reactivate_existing_user(
    id: int,
    request: Request,
    payload: ActionRequest,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> UserOut:
    """Reactivate a previously deactivated user account."""
    ctx = build_audit_context(request, principal)
    user = user_service.reactivate_user(session, ctx, id, payload.version_id, reason=payload.reason)
    return UserOut.from_user(user, now=clock.utcnow())


@router.post(
    "/{id}/reset-password",
    response_model=UserCreatedOut,
    dependencies=[Depends(require(Permission.USER_RESET_PASSWORD))],
)
def reset_user_password(
    id: int,
    request: Request,
    payload: ActionRequest,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
    settings: Settings = Depends(get_effective_settings),
) -> JSONResponse:
    """Generate and return a one-time temporary password, revoking existing sessions."""
    ctx = build_audit_context(request, principal)
    user, temp_pwd = user_service.reset_password(
        session, ctx, id, payload.version_id, settings, reason=payload.reason
    )
    out = UserCreatedOut.from_user_and_secret(user, temp_pwd, now=clock.utcnow())
    return JSONResponse(
        status_code=200,
        content=out.model_dump(mode="json"),
        headers={"Cache-Control": "no-store"},
    )


@router.post(
    "/{id}/unlock",
    response_model=UserOut,
    dependencies=[Depends(require(Permission.USER_UNLOCK))],
)
def unlock_existing_user(
    id: int,
    request: Request,
    payload: ActionRequest,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> UserOut:
    """Clear failed login counters and lockout state for a locked account."""
    ctx = build_audit_context(request, principal)
    user = user_service.unlock_user(session, ctx, id, payload.version_id, reason=payload.reason)
    return UserOut.from_user(user, now=clock.utcnow())


@router.post(
    "/{id}/revoke-sessions",
    response_model=RevokeUserSessionsOut,
    dependencies=[Depends(require(Permission.SESSION_REVOKE))],
)
def revoke_user_sessions(
    id: int,
    request: Request,
    payload: RevokeSessionRequest,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
    settings: Settings = Depends(get_effective_settings),
) -> RevokeUserSessionsOut:
    """Sign out every active session of a user; the caller's own current session is kept."""
    ctx = build_audit_context(request, principal)
    revoked_ids, kept_current = auth_service.admin_revoke_user_sessions(
        session,
        ctx,
        settings,
        id,
        current_session_id=principal.session_id,
        reason=payload.reason,
    )
    return RevokeUserSessionsOut(
        user_id=id, revoked_count=len(revoked_ids), kept_current_session=kept_current
    )


@router.get(
    "/{id}/login-history",
    response_model=list[LoginHistoryEntry],
    dependencies=[Depends(require(Permission.USER_READ, Permission.AUDIT_READ))],
)
def get_user_login_history(
    id: int,
    session: SessionDep,
    _principal: Principal = Depends(current_principal),
) -> list[LoginHistoryEntry]:
    """Latest 50 sign-in, lockout, unlock, password-reset and session-revocation events."""
    if user_service.get_user(session, id) is None:
        raise ApiError(status_code=404, code="not_found", message=f"User #{id} not found")
    return [
        LoginHistoryEntry(
            id=entry.id,
            occurred_at=entry.occurred_at,
            action=entry.action,
            outcome=entry.outcome,
            actor_username=entry.actor_username,
            ip_address=str(entry.ip) if entry.ip else None,
            user_agent=entry.user_agent,
            reason=entry.reason,
            details=user_service.login_history_details(entry),
        )
        for entry in user_service.login_history(session, id)
    ]
