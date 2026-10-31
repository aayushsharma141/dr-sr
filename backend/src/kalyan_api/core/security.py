"""Cryptographic primitives, Argon2id hashing, dummy verification, and token generation."""

import hashlib
import ipaddress
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from kalyan_api.config import Settings

# Precomputed dummy hash matching default test/dev profile to protect against timing enumeration
_DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgqlfreSAeYQ"


def build_hasher(settings: Settings) -> PasswordHasher:
    """Build PasswordHasher instance configured with active application settings."""
    return PasswordHasher(
        time_cost=settings.argon2_time_cost,
        memory_cost=settings.argon2_memory_cost,
        parallelism=settings.argon2_parallelism,
    )


def hash_password(hasher: PasswordHasher, plain: str) -> str:
    """Hash a cleartext password with Argon2id."""
    return hasher.hash(plain)


def verify_password(hasher: PasswordHasher, plain: str, password_hash: str) -> bool:
    """Verify cleartext password against Argon2id hash; returns False on mismatch."""
    try:
        return hasher.verify(password_hash, plain)
    except (VerifyMismatchError, InvalidHashError):
        return False


def needs_rehash(hasher: PasswordHasher, password_hash: str) -> bool:
    """Check if hash parameters differ from the hasher's current configuration."""
    try:
        return hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def dummy_verify(hasher: PasswordHasher, plain: str) -> None:
    """Execute constant-time dummy verification for non-existent users (prevents timing oracle)."""
    try:
        hasher.verify(_DUMMY_HASH, plain)
    except (VerifyMismatchError, InvalidHashError):
        pass


def new_session_token() -> str:
    """Generate 256-bit cryptographically secure session token."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Compute SHA-256 hex digest of session token for safe storage."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_csrf_token() -> str:
    """Generate per-session CSRF token."""
    return secrets.token_urlsafe(24)


def clean_ip(host: str | None) -> str | None:
    """Normalize client host to valid IP address for PostgreSQL INET columns."""
    if not host:
        return None
    try:
        ipaddress.ip_address(host)
        return host
    except ValueError:
        return "127.0.0.1" if host == "testclient" else None
