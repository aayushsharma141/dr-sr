"""Pydantic schemas for the security policy (Admin module 09).

The environment holds the baseline (D-07 session and lockout timings, EG-19 password length).
Administrators may store tighter values within the limits reported here. Throttle settings and
the maximum password length stay environment-only.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PolicyFieldLimits(BaseModel):
    """Inclusive range a field may take and the environment value it starts from."""

    model_config = ConfigDict(extra="forbid")

    baseline: int
    minimum: int
    maximum: int


class SecurityPolicyOut(BaseModel):
    """Currently effective authentication and session security settings."""

    model_config = ConfigDict(extra="forbid")

    session_idle_minutes: int
    session_absolute_hours: int
    lockout_threshold: int
    lockout_minutes: int
    throttle_max_failures: int
    throttle_window_minutes: int
    password_min_length: int
    password_max_length: int
    source: Literal["environment", "administrator"]
    editable: Literal[True]
    limits: dict[str, PolicyFieldLimits]
    version_id: int
    updated_at: datetime


class SecurityPolicyUpdate(BaseModel):
    """Full replacement of the administrator-editable fields, with a mandatory reason."""

    model_config = ConfigDict(extra="forbid")

    version_id: int = Field(ge=1)
    session_idle_minutes: int
    session_absolute_hours: int
    lockout_threshold: int
    lockout_minutes: int
    password_min_length: int
    reason: str = Field(min_length=10, max_length=500)

    @field_validator("reason")
    @classmethod
    def reason_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if len(stripped) < 10:
            raise ValueError("reason must be at least 10 characters")
        return stripped


class PasswordPolicyOut(BaseModel):
    """Password length bounds a user must satisfy when choosing a new password."""

    model_config = ConfigDict(extra="forbid")

    min_length: int
    max_length: int
