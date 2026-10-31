"""Authentication endpoints for login, session resolution, and logout."""

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.core.permissions import ROLE_PERMISSIONS, Role
from kalyan_api.core.policy import authenticated_only, public
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    get_current_settings,
)
from kalyan_api.core.security import clean_ip
from kalyan_api.db.session import SessionDep
from kalyan_api.models import AuthSession, User
from kalyan_api.services import audit_service, auth_service
from kalyan_api.services.audit_service import AuditAction, Outcome

router = APIRouter(prefix="/auth", tags=["auth"])

GENERIC_INVALID_CREDENTIALS_MSG = (
    "Invalid username or password, or the account is temporarily locked. "
    "Wait 15 minutes or ask an administrator."
)


class LoginRequest(BaseModel):
    """Payload for user login authentication."""

    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=1024)

    model_config = ConfigDict(extra="forbid")


class MeResponse(BaseModel):
    """Authenticated user profile, active permissions, and CSRF token."""

    id: int
    username: str
    full_name: str
    role: str
    doctor_id: int | None
    permissions: list[str]
    must_change_password: bool
    csrf_token: str
    version_id: int


@router.post("/login", dependencies=[Depends(public)])
def login(
    request: Request,
    body: LoginRequest,
    session: SessionDep,
    settings: Settings = Depends(get_current_settings),
) -> Response:
    """Authenticate credentials, create server-side session, set cookie, and return MeResponse.

    Returns 401 invalid_credentials with a generic message for invalid passwords,
    missing users, or deactivated accounts (no user enumeration).
    """
    ctx = build_audit_context(request)

    # If presenting an existing session token, revoke it first (session rotation on login)
    existing_token = request.cookies.get(settings.cookie_name)
    if existing_token:
        existing_sess = auth_service.resolve_session(session, existing_token)
        if existing_sess and existing_sess.revoked_at is None:
            auth_service.revoke_session(session, existing_sess.id)

    # Opportunistically purge stale sessions
    auth_service.purge_expired_sessions(session, max_age_hours=settings.session_absolute_hours + 24)

    user, _rehashed = auth_service.authenticate(
        session, settings, body.username, body.password
    )

    if user is None:
        audit_service.record(
            session,
            ctx,
            AuditAction.AUTH_LOGIN_FAILED,
            "USER",
            None,
            after={"attempted_username": body.username.strip().lower()},
            outcome=Outcome.FAILURE,
        )
        return JSONResponse(
            status_code=401,
            content={
                "code": "invalid_credentials",
                "message": GENERIC_INVALID_CREDENTIALS_MSG,
            },
        )

    # Success path
    client_ip = clean_ip(request.client.host if request.client else None)
    user_agent = request.headers.get("User-Agent")
    auth_sess, raw_token = auth_service.create_session(
        session, user, client_ip=client_ip, user_agent=user_agent
    )

    # Atomic core update for login counters (avoids bumping users.version_id)
    now = clock.utcnow()
    session.execute(
        update(User)
        .where(User.id == user.id)
        .values(failed_login_count=0, locked_until=None, last_login_at=now)
    )

    # Audit login success with session_id only (never the raw token)
    user_ctx = build_audit_context(
        request,
        Principal(
            user_id=user.id,
            username=user.username,
            role=Role(user.role),
            doctor_id=user.doctor_id,
            permissions=frozenset(),
            session_id=auth_sess.id,
            must_change_password=user.must_change_password,
        ),
    )
    audit_service.record(
        session,
        user_ctx,
        AuditAction.AUTH_LOGIN_SUCCEEDED,
        "USER",
        user.id,
        after={"session_id": str(auth_sess.id)},
        outcome=Outcome.SUCCESS,
    )

    perms = sorted(p.value for p in ROLE_PERMISSIONS.get(Role(user.role), frozenset()))

    me_data = MeResponse(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        role=user.role,
        doctor_id=user.doctor_id,
        permissions=perms,
        must_change_password=user.must_change_password,
        csrf_token=auth_sess.csrf_token,
        version_id=user.version_id,
    )

    response = JSONResponse(content=me_data.model_dump())
    response.set_cookie(
        key=settings.cookie_name,
        value=raw_token,
        httponly=True,
        samesite="strict",
        secure=settings.cookie_secure,
        path="/",
    )
    return response


@router.get("/me", dependencies=[Depends(authenticated_only)])
def get_me(
    session: SessionDep,
    principal: Principal = Depends(authenticated_only),
) -> MeResponse:
    """Return profile, active permissions, and CSRF token for the authenticated caller."""
    user = session.scalar(select(User).where(User.id == principal.user_id))
    auth_sess = session.scalar(
        select(AuthSession).where(AuthSession.id == principal.session_id)
    )
    csrf_token = auth_sess.csrf_token if auth_sess else ""
    full_name = user.full_name if user else principal.username
    version_id = user.version_id if user else 1

    return MeResponse(
        id=principal.user_id,
        username=principal.username,
        full_name=full_name,
        role=principal.role.value,
        doctor_id=principal.doctor_id,
        permissions=sorted(p.value for p in principal.permissions),
        must_change_password=principal.must_change_password,
        csrf_token=csrf_token,
        version_id=version_id,
    )


@router.post("/logout", dependencies=[Depends(authenticated_only)], status_code=204)
def logout(
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(authenticated_only),
    settings: Settings = Depends(get_current_settings),
) -> Response:
    """Revoke active session and delete session cookie."""
    auth_service.revoke_session(session, principal.session_id)

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.AUTH_LOGOUT,
        "USER",
        principal.user_id,
        outcome=Outcome.SUCCESS,
    )

    response = Response(status_code=204)
    response.delete_cookie(
        key=settings.cookie_name,
        path="/",
        httponly=True,
        samesite="strict",
        secure=settings.cookie_secure,
    )
    return response
