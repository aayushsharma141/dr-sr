"""Authentication endpoints for login, session resolution, and logout."""

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.core import net, security
from kalyan_api.core.password_policy import PasswordPolicyError, validate_password_policy
from kalyan_api.core.permissions import ROLE_PERMISSIONS, Role
from kalyan_api.core.policy import authenticated_only, public
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal_allow_pending,
    get_current_settings,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.models import AuthSession, User
from kalyan_api.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    MeResponse,
    SessionConflictResponse,
)
from kalyan_api.services import audit_service, auth_service, throttle_service
from kalyan_api.services.audit_service import AuditAction, Outcome

router = APIRouter(prefix="/auth", tags=["auth"])

GENERIC_INVALID_CREDENTIALS_MSG = (
    "Invalid username or password, or the account is temporarily locked. "
    "Wait 15 minutes or ask an administrator."
)


@router.post("/login", dependencies=[Depends(public)])
def login(
    request: Request,
    body: LoginRequest,
    session: SessionDep,
    settings: Settings = Depends(get_current_settings),
) -> Response:
    """Authenticate credentials, create server-side session, set cookie, and return MeResponse.

    Returns:
        - 200 with MeResponse and cookie on success.
        - 429 too_many_attempts with Retry-After when IP failure burst is reached.
        - 401 invalid_credentials with a generic message for invalid passwords,
          missing users, or locked/deactivated accounts (no user enumeration).
    """
    ctx = build_audit_context(request)
    peer_ip = net.client_ip(request)
    now = clock.utcnow()

    # Rate limiting burst check prior to Argon2 execution
    is_throttled, retry_after = throttle_service.limit_exceeded(
        session,
        peer_ip,
        now,
        max_failures=settings.throttle_max_failures,
        window_minutes=settings.throttle_window_minutes,
    )
    if is_throttled:
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(retry_after)},
            content={
                "code": "too_many_attempts",
                "message": (
                    f"Too many failed login attempts. "
                    f"Please wait {retry_after} seconds before trying again."
                ),
            },
        )

    # If presenting an existing session token, revoke it first (session rotation on login)
    existing_token = request.cookies.get(settings.cookie_name)
    if existing_token:
        existing_sess = auth_service.resolve_session(session, existing_token)
        if existing_sess and existing_sess.revoked_at is None:
            auth_service.revoke_session(session, existing_sess.id)

    # Opportunistically purge stale sessions
    auth_service.purge_expired_sessions(session, max_age_hours=settings.session_absolute_hours + 24)

    auth_result = auth_service.authenticate(
        session, settings, body.username, body.password, now=now
    )

    if auth_result.status != "ok":
        # Register failure against peer IP
        throttle_count = throttle_service.register_failure(
            session, peer_ip, now, window_minutes=settings.throttle_window_minutes
        )
        if throttle_count == settings.throttle_max_failures:
            audit_service.record(
                session,
                ctx,
                AuditAction.AUTH_LOGIN_THROTTLED,
                "IP",
                peer_ip,
                outcome=Outcome.DENIED,
                after={"attempt_count": throttle_count},
            )

        if auth_result.status == "locked":
            matched = auth_result.matched_user
            audit_service.record(
                session,
                ctx,
                AuditAction.AUTH_LOGIN_FAILED,
                "USER",
                str(matched.id) if matched else None,
                after={"reason": "locked"},
                outcome=Outcome.FAILURE,
            )
        elif auth_result.status == "wrong_password":
            matched = auth_result.matched_user
            audit_service.record(
                session,
                ctx,
                AuditAction.AUTH_LOGIN_FAILED,
                "USER",
                str(matched.id) if matched else None,
                after={"failed_login_count": auth_result.failed_count},
                outcome=Outcome.FAILURE,
            )
            if auth_result.failed_count == settings.lockout_threshold:
                audit_service.record(
                    session,
                    ctx,
                    AuditAction.AUTH_ACCOUNT_LOCKED,
                    "USER",
                    str(matched.id) if matched else None,
                    after={
                        "locked_until": (
                            auth_result.locked_until.isoformat()
                            if auth_result.locked_until
                            else None
                        ),
                        "failed_login_count": auth_result.failed_count,
                    },
                    outcome=Outcome.FAILURE,
                )
        else:  # "unknown"
            audit_service.record(
                session,
                ctx,
                AuditAction.AUTH_LOGIN_FAILED,
                "USER",
                None,
                after={"attempted_username": body.username.strip().lower()[:64]},
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
    user = auth_result.user
    if user is None:
        return JSONResponse(
            status_code=401,
            content={
                "code": "invalid_credentials",
                "message": GENERIC_INVALID_CREDENTIALS_MSG,
            },
        )

    # DWS-10 / Single Active Session Enforcement
    active_sess = auth_service.find_active_user_session(session, settings, now, user.id)
    if active_sess is not None:
        if not body.takeover:
            return JSONResponse(
                status_code=409,
                content={
                    "code": "session_in_use",
                    "message": "An active session already exists for this account on another device.",
                    "active_session": {
                        "ip": str(active_sess.ip) if active_sess.ip else None,
                        "user_agent": active_sess.user_agent,
                        "last_seen_at": active_sess.last_seen_at.isoformat(),
                    },
                },
            )
        else:
            # Explicit takeover requested: revoke all previous sessions and audit SESSION_TAKEOVER
            auth_service.revoke_all_user_sessions(session, user.id, reason="session_takeover")
            user_takeover_ctx = build_audit_context(
                request,
                Principal(
                    user_id=user.id,
                    username=user.username,
                    role=Role(user.role),
                    doctor_id=user.doctor_id,
                    permissions=frozenset(),
                    session_id=active_sess.id,
                    must_change_password=user.must_change_password,
                ),
            )
            audit_service.record(
                session,
                user_takeover_ctx,
                AuditAction.SESSION_TAKEOVER,
                "USER",
                user.id,
                before={"prior_session_id": active_sess.id},
                after={"revoked_prior_sessions": True},
                outcome=Outcome.SUCCESS,
            )

    user_agent = request.headers.get("User-Agent")
    auth_sess, raw_token = auth_service.create_session(
        session, user, client_ip=peer_ip, user_agent=user_agent
    )

    # Atomic core update for login counters (avoids bumping users.version_id)
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
    principal: Principal = Depends(current_principal_allow_pending),
) -> MeResponse:
    """Return profile, active permissions, and CSRF token for the authenticated caller."""
    user = session.scalar(select(User).where(User.id == principal.user_id))
    auth_sess = session.scalar(select(AuthSession).where(AuthSession.id == principal.session_id))
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
    principal: Principal = Depends(current_principal_allow_pending),
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


@router.post("/change-password", dependencies=[Depends(authenticated_only)])
def change_password(
    request: Request,
    body: ChangePasswordRequest,
    session: SessionDep,
    principal: Principal = Depends(current_principal_allow_pending),
    settings: Settings = Depends(get_current_settings),
) -> Response:
    """Change user password, enforce NIST policy, revoke all sessions, and issue fresh session."""
    ctx = build_audit_context(request, principal)
    peer_ip = net.client_ip(request)
    now = clock.utcnow()

    user = session.scalar(select(User).where(User.id == principal.user_id))
    if not user or not user.is_active:
        return JSONResponse(
            status_code=401,
            content={"code": "not_authenticated", "message": "User not found or deactivated"},
        )

    hasher = security.build_hasher(settings)

    # Check if account is locked
    if user.locked_until is not None and user.locked_until > now:
        security.dummy_verify(hasher, body.current_password)
        audit_service.record(
            session,
            ctx,
            AuditAction.AUTH_PASSWORD_CHANGE_FAILED,
            "USER",
            str(user.id),
            after={"reason": "locked"},
            outcome=Outcome.FAILURE,
        )
        return JSONResponse(
            status_code=403,
            content={
                "code": "current_password_invalid",
                "message": "Current password is incorrect",
            },
        )

    # Verify current password
    if not security.verify_password(hasher, body.current_password, user.password_hash):
        failed_count, locked_until = auth_service.record_failed_login(
            session,
            user.id,
            now,
            lockout_threshold=settings.lockout_threshold,
            lockout_minutes=settings.lockout_minutes,
        )
        audit_service.record(
            session,
            ctx,
            AuditAction.AUTH_PASSWORD_CHANGE_FAILED,
            "USER",
            str(user.id),
            after={"failed_login_count": failed_count},
            outcome=Outcome.FAILURE,
        )
        if failed_count == settings.lockout_threshold:
            audit_service.record(
                session,
                ctx,
                AuditAction.AUTH_ACCOUNT_LOCKED,
                "USER",
                str(user.id),
                after={
                    "locked_until": (locked_until.isoformat() if locked_until else None),
                    "failed_login_count": failed_count,
                },
                outcome=Outcome.FAILURE,
            )
        return JSONResponse(
            status_code=403,
            content={
                "code": "current_password_invalid",
                "message": "Current password is incorrect",
            },
        )

    # Check if new password is identical to current password
    if body.new_password == body.current_password:
        return JSONResponse(
            status_code=422,
            content={
                "code": "password_policy",
                "message": "New password cannot be the same as current password",
            },
        )

    # Validate new password against policy
    try:
        validate_password_policy(body.new_password, user.username, user.full_name, settings)
    except PasswordPolicyError as err:
        return JSONResponse(
            status_code=422,
            content={"code": "password_policy", "message": err.message},
        )

    # Apply new password
    new_hash = security.hash_password(hasher, body.new_password)
    old_must_change = user.must_change_password

    session.execute(
        update(User)
        .where(User.id == user.id)
        .values(
            password_hash=new_hash,
            must_change_password=False,
            password_changed_at=now,
            failed_login_count=0,
            locked_until=None,
        )
    )

    # Revoke all existing sessions for this user
    auth_service.revoke_all_user_sessions(session, user.id)

    # Issue fresh session
    user_agent = request.headers.get("User-Agent")
    new_sess, raw_token = auth_service.create_session(
        session, user, client_ip=peer_ip, user_agent=user_agent
    )

    # Audit password changed (storing only state transition, NEVER any password text)
    audit_service.record(
        session,
        ctx,
        AuditAction.AUTH_PASSWORD_CHANGED,
        "USER",
        str(user.id),
        before={"must_change_password": old_must_change},
        after={"must_change_password": False},
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
        must_change_password=False,
        csrf_token=new_sess.csrf_token,
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
