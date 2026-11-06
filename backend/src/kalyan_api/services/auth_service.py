"""Authentication service managing credential validation, session issuance, and revocation.

Guarantees:
- Password verification runs in constant time (dummy_verify on unknown usernames).
- Tokens stored exclusively as SHA-256 hashes; raw token returned once at creation.
- Session revocation updates revoked_at timestamp via Core UPDATE.
- Session purge opportunistically deletes records older than absolute limit + buffer.
- record_failed_login uses single atomic Core UPDATE ... RETURNING (no ORM version bump).
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, case, delete, select, update
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.core import security
from kalyan_api.core.errors import ApiError
from kalyan_api.models import AuthSession, User
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction, AuditContext

logger = logging.getLogger("kalyan_api.auth_service")


@dataclass
class AuthResult:
    """Outcome of credential authentication and lockout verification."""

    user: User | None = None
    status: str = "ok"  # "ok" | "unknown" | "locked" | "wrong_password"
    failed_count: int = 0
    locked_until: datetime | None = None
    matched_user: User | None = None
    rehashed: bool = False


def record_failed_login(
    session: Session,
    user_id: int,
    now: datetime,
    lockout_threshold: int = 5,
    lockout_minutes: int = 15,
) -> tuple[int, datetime | None]:
    """Atomically increment failed_login_count and set locked_until via single Core UPDATE.

    Guarantees:
    - Never uses ORM assignment or flush, preserving users.version_id.
    - Atomically computes locked_until at lockout_threshold using CASE.
    - Uses RETURNING to return (failed_login_count, locked_until) safely under concurrency.
    """
    lockout_until_time = now + timedelta(minutes=lockout_minutes)
    stmt = (
        update(User)
        .where(User.id == user_id)
        .values(
            failed_login_count=User.failed_login_count + 1,
            locked_until=case(
                (User.failed_login_count + 1 >= lockout_threshold, lockout_until_time),
                else_=User.locked_until,
            ),
        )
        .returning(User.failed_login_count, User.locked_until)
    )
    result = session.execute(stmt).first()
    if not result:
        return 0, None
    return result[0], result[1]


def authenticate(
    session: Session,
    settings: Settings,
    username: str,
    password: str,
    now: datetime | None = None,
) -> AuthResult:
    """Authenticate credentials against user records with timing-attack and lockout defenses.

    Returns AuthResult detailing authentication status, updated counters, and locked timestamps.
    """
    if now is None:
        now = clock.utcnow()

    hasher = security.build_hasher(settings)
    clean_username = username.strip().lower()

    user = session.scalar(select(User).where(User.username == clean_username))

    if user is None or not user.is_active:
        security.dummy_verify(hasher, password)
        return AuthResult(status="unknown")

    # Step 2: Check if currently locked
    if user.locked_until is not None and user.locked_until > now:
        security.dummy_verify(hasher, password)
        return AuthResult(
            status="locked",
            matched_user=user,
            failed_count=user.failed_login_count,
            locked_until=user.locked_until,
        )

    # Step 3: Check expired lock
    if user.locked_until is not None and user.locked_until <= now:
        session.execute(
            update(User).where(User.id == user.id).values(failed_login_count=0, locked_until=None)
        )
        user.failed_login_count = 0
        user.locked_until = None

    # Step 4: Verify password
    if not security.verify_password(hasher, password, user.password_hash):
        failed_count, locked_until = record_failed_login(
            session,
            user.id,
            now,
            lockout_threshold=settings.lockout_threshold,
            lockout_minutes=settings.lockout_minutes,
        )
        return AuthResult(
            status="wrong_password",
            matched_user=user,
            failed_count=failed_count,
            locked_until=locked_until,
        )

    rehashed = False
    if security.needs_rehash(hasher, user.password_hash):
        user.password_hash = security.hash_password(hasher, password)
        rehashed = True
        logger.info("Upgraded password hash parameters for user '%s'", user.username)

    return AuthResult(
        user=user,
        matched_user=user,
        status="ok",
        rehashed=rehashed,
    )


def create_session(
    session: Session,
    user: User,
    client_ip: str | None = None,
    user_agent: str | None = None,
) -> tuple[AuthSession, str]:
    """Create a new server-side session and return the record along with the unhashed raw token."""
    raw_token = security.new_session_token()
    token_h = security.hash_token(raw_token)
    csrf = security.new_csrf_token()
    now = clock.utcnow()

    auth_sess = AuthSession(
        token_hash=token_h,
        user_id=user.id,
        csrf_token=csrf,
        ip=client_ip,
        user_agent=user_agent[:255] if user_agent else None,
        created_at=now,
        last_seen_at=now,
    )

    session.add(auth_sess)
    session.flush()
    return auth_sess, raw_token


def resolve_session(session: Session, raw_token: str) -> AuthSession | None:
    """Retrieve session record matching raw token hash."""
    token_h = security.hash_token(raw_token)
    return session.scalar(select(AuthSession).where(AuthSession.token_hash == token_h))


def revoke_session(session: Session, session_id: int) -> None:
    """Revoke active session by setting revoked_at timestamp."""
    now = clock.utcnow()
    session.execute(
        update(AuthSession)
        .where(AuthSession.id == session_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )


def revoke_all_user_sessions(session: Session, user_id: int, reason: str | None = None) -> None:
    """Revoke all active sessions belonging to the specified user."""
    now = clock.utcnow()
    session.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )


def find_active_user_session(
    session: Session,
    settings: Settings,
    now: datetime,
    user_id: int,
) -> AuthSession | None:
    """Find the single most recently active unexpired session for a user, or None."""
    active = list_active_sessions(session, settings, now, user_id=user_id)
    if not active:
        return None
    return active[0][0]


def idle_expires_at(auth_session: AuthSession, settings: Settings) -> datetime:
    """Return the instant after which the session expires for inactivity (D-07)."""
    return auth_session.last_seen_at + timedelta(minutes=settings.session_idle_minutes)


def absolute_expires_at(auth_session: AuthSession, settings: Settings) -> datetime:
    """Return the instant after which the session exceeds its maximum lifetime."""
    return auth_session.created_at + timedelta(hours=settings.session_absolute_hours)


def active_session_criteria(settings: Settings, now: datetime) -> list[ColumnElement[bool]]:
    """SQL criteria selecting sessions that would still authenticate at ``now``.

    Mirrors the request-time checks in core.principal: not revoked, owner account active,
    ``now`` not past ``last_seen_at + idle`` and not past ``created_at + absolute``.
    Callers must join ``User`` on ``AuthSession.user_id``.
    """
    idle_cutoff = now - timedelta(minutes=settings.session_idle_minutes)
    absolute_cutoff = now - timedelta(hours=settings.session_absolute_hours)
    return [
        AuthSession.revoked_at.is_(None),
        User.is_active.is_(True),
        AuthSession.last_seen_at >= idle_cutoff,
        AuthSession.created_at >= absolute_cutoff,
    ]


def list_active_sessions(
    session: Session,
    settings: Settings,
    now: datetime,
    user_id: int | None = None,
) -> list[tuple[AuthSession, User]]:
    """List currently valid sessions with their owners, most recently active first."""
    stmt = (
        select(AuthSession, User)
        .join(User, AuthSession.user_id == User.id)
        .where(*active_session_criteria(settings, now))
        .order_by(AuthSession.last_seen_at.desc(), AuthSession.id.desc())
    )
    if user_id is not None:
        stmt = stmt.where(AuthSession.user_id == user_id)
    return [(row[0], row[1]) for row in session.execute(stmt).all()]


def get_active_session(
    session: Session,
    settings: Settings,
    now: datetime,
    session_id: int,
) -> tuple[AuthSession, User] | None:
    """Fetch one currently valid session and its owner, locking the session row."""
    stmt = (
        select(AuthSession, User)
        .join(User, AuthSession.user_id == User.id)
        .where(AuthSession.id == session_id, *active_session_criteria(settings, now))
        .with_for_update(of=AuthSession)
    )
    row = session.execute(stmt).first()
    if row is None:
        return None
    return row[0], row[1]


def revoke_session_if_active(session: Session, session_id: int, now: datetime) -> bool:
    """Revoke a session not yet revoked; return True only if this call revoked it."""
    result = session.execute(
        update(AuthSession)
        .where(AuthSession.id == session_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
        .returning(AuthSession.id)
    ).first()
    return result is not None


def revoke_active_user_sessions(
    session: Session,
    settings: Settings,
    user_id: int,
    now: datetime,
    keep_session_id: int | None = None,
) -> list[int]:
    """Revoke every currently valid session of a user, optionally sparing one session.

    Returns the identifiers of the sessions revoked by this call, in ascending order.
    """
    active_ids = select(AuthSession.id).join(User, AuthSession.user_id == User.id)
    active_ids = active_ids.where(
        AuthSession.user_id == user_id, *active_session_criteria(settings, now)
    )
    if keep_session_id is not None:
        active_ids = active_ids.where(AuthSession.id != keep_session_id)

    result = session.execute(
        update(AuthSession)
        .where(AuthSession.id.in_(active_ids), AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
        .returning(AuthSession.id)
    )
    return sorted(int(r[0]) for r in result.all())


def admin_revoke_session(
    session: Session,
    ctx: AuditContext,
    settings: Settings,
    session_id: int,
    current_session_id: int,
    reason: str | None = None,
) -> tuple[AuthSession, datetime]:
    """Revoke one active session on an administrator's request and audit SESSION_REVOKED.

    Returns:
        (the revoked session, the revocation instant).

    Raises:
        ApiError 404 session_not_found when the session is unknown, revoked or expired.
        ApiError 409 cannot_revoke_current_session when it is the caller's own session.
    """
    now = clock.utcnow()
    found = get_active_session(session, settings, now, session_id)
    if found is None:
        raise ApiError(
            status_code=404,
            code="session_not_found",
            message=f"Active session #{session_id} not found",
        )
    auth_sess, owner = found

    if auth_sess.id == current_session_id:
        raise ApiError(
            status_code=409,
            code="cannot_revoke_current_session",
            message="You cannot revoke your own current session; log out instead",
        )

    if not revoke_session_if_active(session, auth_sess.id, now):
        raise ApiError(
            status_code=404,
            code="session_not_found",
            message=f"Active session #{session_id} not found",
        )

    audit_service.record(
        session,
        ctx,
        AuditAction.SESSION_REVOKED,
        "SESSION",
        auth_sess.id,
        before={"user_id": owner.id, "username": owner.username, "revoked_at": None},
        after={"user_id": owner.id, "username": owner.username, "revoked_at": now.isoformat()},
        reason=reason,
    )
    return auth_sess, now


def admin_revoke_user_sessions(
    session: Session,
    ctx: AuditContext,
    settings: Settings,
    user_id: int,
    current_session_id: int,
    reason: str | None = None,
) -> tuple[list[int], bool]:
    """Revoke all active sessions of a user and audit USER_SESSIONS_REVOKED.

    When the target is the caller, the caller's current session is kept.

    Returns:
        (revoked session ids, whether the caller's current session was kept).

    Raises:
        ApiError 404 not_found when the user does not exist.
    """
    target = session.scalar(select(User).where(User.id == user_id))
    if target is None:
        raise ApiError(status_code=404, code="not_found", message=f"User #{user_id} not found")

    now = clock.utcnow()
    is_self = target.id == ctx.actor_user_id
    keep_id = current_session_id if is_self else None
    active_before = [s.id for s, _ in list_active_sessions(session, settings, now, user_id)]
    revoked_ids = revoke_active_user_sessions(
        session, settings, target.id, now, keep_session_id=keep_id
    )
    kept_current = keep_id is not None and keep_id in active_before

    audit_service.record(
        session,
        ctx,
        AuditAction.USER_SESSIONS_REVOKED,
        "USER",
        target.id,
        before={"active_session_count": len(active_before)},
        after={
            "active_session_count": len(active_before) - len(revoked_ids),
            "revoked_count": len(revoked_ids),
            "revoked_session_ids": revoked_ids,
            "kept_current_session": kept_current,
        },
        reason=reason,
    )
    return revoked_ids, kept_current


def purge_expired_sessions(session: Session, max_age_hours: int = 36) -> int:
    """Delete ancient sessions from database to maintain table size (granted to kalyan_app)."""
    cutoff = clock.utcnow() - timedelta(hours=max_age_hours)
    result = session.execute(delete(AuthSession).where(AuthSession.created_at < cutoff))
    return result.rowcount or 0
