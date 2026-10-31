"""Authentication service managing credential validation, session issuance, and revocation.

Guarantees:
- Password verification runs in constant time (dummy_verify on unknown usernames).
- Tokens stored exclusively as SHA-256 hashes; raw token returned once at creation.
- Session revocation updates revoked_at timestamp via Core UPDATE.
- Session purge opportunistically deletes records older than absolute limit + buffer.
"""

import logging
from datetime import timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.core.security import (
    build_hasher,
    dummy_verify,
    hash_password,
    hash_token,
    needs_rehash,
    new_csrf_token,
    new_session_token,
    verify_password,
)
from kalyan_api.models import AuthSession, User

logger = logging.getLogger("kalyan_api.auth_service")


def authenticate(
    session: Session,
    settings: Settings,
    username: str,
    password: str,
) -> tuple[User | None, bool]:
    """Authenticate credentials against user records with timing-attack mitigation.

    Returns tuple of (user, was_rehashed). If user does not exist or is inactive,
    runs dummy_verify to produce constant-time behavior and returns (None, False).
    """
    hasher = build_hasher(settings)
    clean_username = username.strip().lower()

    user = session.scalar(
        select(User).where(User.username == clean_username)
    )

    if user is None or not user.is_active:
        dummy_verify(hasher, password)
        return None, False

    if not verify_password(hasher, password, user.password_hash):
        return None, False

    rehashed = False
    if needs_rehash(hasher, user.password_hash):
        user.password_hash = hash_password(hasher, password)
        rehashed = True
        logger.info("Upgraded password hash parameters for user '%s'", user.username)

    return user, rehashed


def create_session(
    session: Session,
    user: User,
    client_ip: str | None = None,
    user_agent: str | None = None,
) -> tuple[AuthSession, str]:
    """Create a new server-side session and return the record along with the unhashed raw token."""
    raw_token = new_session_token()
    token_h = hash_token(raw_token)
    csrf = new_csrf_token()
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
    token_h = hash_token(raw_token)
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
