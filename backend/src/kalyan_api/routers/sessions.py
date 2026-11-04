"""Authentication session monitoring and revocation endpoints (Admin Panel module 09).

Guarantees:
- "Active" uses the same validity rules as request authentication (not revoked, owner active,
  within idle and absolute limits) via auth_service.active_session_criteria.
- Responses never include the session token, its hash, or the CSRF token.
- Revocation is audited (SESSION_REVOKED) in the same transaction; the caller cannot revoke
  their own current session through this endpoint (they log out instead).
"""

from fastapi import APIRouter, Depends, Query, Request

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
    get_effective_settings,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.models import AuthSession, User
from kalyan_api.schemas.sessions import ActiveSessionOut, RevokeSessionOut, RevokeSessionRequest
from kalyan_api.services import auth_service

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _session_out(
    auth_sess: AuthSession, owner: User, settings: Settings, current_session_id: int
) -> ActiveSessionOut:
    """Serialise an active session without any credential material."""
    return ActiveSessionOut(
        id=auth_sess.id,
        user_id=owner.id,
        username=owner.username,
        full_name=owner.full_name,
        role=owner.role,
        ip_address=str(auth_sess.ip) if auth_sess.ip else None,
        user_agent=auth_sess.user_agent,
        created_at=auth_sess.created_at,
        last_seen_at=auth_sess.last_seen_at,
        idle_expires_at=auth_service.idle_expires_at(auth_sess, settings),
        absolute_expires_at=auth_service.absolute_expires_at(auth_sess, settings),
        is_current=auth_sess.id == current_session_id,
    )


@router.get(
    "",
    response_model=list[ActiveSessionOut],
    dependencies=[Depends(require(Permission.SESSION_READ))],
)
def list_sessions(
    session: SessionDep,
    user_id: int | None = Query(default=None, ge=1),
    principal: Principal = Depends(current_principal),
    settings: Settings = Depends(get_effective_settings),
) -> list[ActiveSessionOut]:
    """List currently active login sessions, most recently active first."""
    rows = auth_service.list_active_sessions(session, settings, clock.utcnow(), user_id=user_id)
    return [_session_out(s, u, settings, principal.session_id) for s, u in rows]


@router.post(
    "/{session_id}/revoke",
    response_model=RevokeSessionOut,
    dependencies=[Depends(require(Permission.SESSION_REVOKE))],
)
def revoke_session(
    session_id: int,
    request: Request,
    payload: RevokeSessionRequest,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
    settings: Settings = Depends(get_effective_settings),
) -> RevokeSessionOut:
    """Sign out one active session of any user other than the caller's current session."""
    ctx = build_audit_context(request, principal)
    revoked, revoked_at = auth_service.admin_revoke_session(
        session,
        ctx,
        settings,
        session_id,
        current_session_id=principal.session_id,
        reason=payload.reason,
    )
    return RevokeSessionOut(id=revoked.id, user_id=revoked.user_id, revoked_at=revoked_at)
