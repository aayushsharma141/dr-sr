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

from sqlalchemy import case, delete, select, update
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.core import security
from kalyan_api.models import AuthSession, User

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

    user = session.scalar(
        select(User).where(User.username == clean_username)
    )

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
            update(User)
            .where(User.id == user.id)
            .values(failed_login_count=0, locked_until=None)
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
    return session.scalar(
        select(AuthSession).where(AuthSession.token_hash == token_h)
    )


def revoke_session(session: Session, session_id: int) -> None:
    """Revoke active session by setting revoked_at timestamp."""
    now = clock.utcnow()
    session.execute(
        update(AuthSession)
        .where(AuthSession.id == session_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )


def revoke_all_user_sessions(session: Session, user_id: int) -> None:
    """Revoke all active sessions belonging to the specified user."""
    now = clock.utcnow()
    session.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )


def purge_expired_sessions(session: Session, max_age_hours: int = 36) -> int:
    """Delete ancient sessions from database to maintain table size (granted to kalyan_app)."""
    cutoff = clock.utcnow() - timedelta(hours=max_age_hours)
    result = session.execute(
        delete(AuthSession).where(AuthSession.created_at < cutoff)
    )
    return result.rowcount or 0
