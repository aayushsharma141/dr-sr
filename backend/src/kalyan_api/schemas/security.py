"""Pydantic schemas for read-only security policy visibility (Admin module 09).

The values are locked/default decisions (D-07 session and lockout timings, EG-19 password
length bounds) sourced from environment configuration. Runtime editing is a pending client
decision, so these schemas describe read-only responses only.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict


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
    source: Literal["environment"]
    editable: Literal[False]


class PasswordPolicyOut(BaseModel):
    """Password length bounds a user must satisfy when choosing a new password."""

    model_config = ConfigDict(extra="forbid")

    min_length: int
    max_length: int
