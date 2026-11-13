"""Authentication request and response schemas."""

from pydantic import BaseModel, ConfigDict, Field


class LoginRequest(BaseModel):
    """Payload for user login authentication with optional single-session takeover."""

    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=1024)
    takeover: bool = Field(
        default=False, description="Whether to revoke existing active session and take over"
    )

    model_config = ConfigDict(extra="forbid")


class SessionConflictResponse(BaseModel):
    """Returned with HTTP 409 Conflict when a user account already has an active session (DWS-10)."""  # noqa: E501 - published as the OpenAPI description; wrapping changes the text

    code: str = "session_in_use"
    message: str
    active_session: dict


class ChangePasswordRequest(BaseModel):
    """Payload for user password change."""

    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(min_length=1, max_length=1024)

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
