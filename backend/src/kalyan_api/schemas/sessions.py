"""Pydantic schemas for authentication session monitoring and revocation (Admin module 09).

Guarantees:
- Session responses never carry the session token, its hash, or the CSRF token.
- Revocation request bodies accept only an optional free-text reason (extra fields rejected).
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from kalyan_api.schemas.users import OptionalReason


class ActiveSessionOut(BaseModel):
    """A currently valid login session with its owner and expiry horizon."""

    model_config = ConfigDict(extra="forbid")

    id: int
    user_id: int
    username: str
    full_name: str
    role: str
    ip_address: str | None
    user_agent: str | None
    created_at: datetime
    last_seen_at: datetime
    idle_expires_at: datetime
    absolute_expires_at: datetime
    is_current: bool


class RevokeSessionRequest(BaseModel):
    """Payload for revoking a single session or every session of one user."""

    model_config = ConfigDict(extra="forbid")

    reason: OptionalReason = None


class RevokeSessionOut(BaseModel):
    """Result of revoking a single session."""

    model_config = ConfigDict(extra="forbid")

    id: int
    user_id: int
    revoked_at: datetime


class RevokeUserSessionsOut(BaseModel):
    """Result of revoking every active session of a user."""

    model_config = ConfigDict(extra="forbid")

    user_id: int
    revoked_count: int
    kept_current_session: bool
