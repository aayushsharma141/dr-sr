"""Pydantic request and response schemas for user management."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from kalyan_api import clock
from kalyan_api.core.permissions import Role
from kalyan_api.models import User


class UserCreate(BaseModel):
    """Payload for creating a new user account."""

    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9._-]+$")
    full_name: str = Field(min_length=1, max_length=120)
    role: Role
    doctor_name_en: str | None = Field(default=None, min_length=1, max_length=120)

    @model_validator(mode="after")
    def validate_doctor_details(self) -> "UserCreate":
        """Validate doctor_name_en constraint based on assigned role."""
        self.username = self.username.lower()
        if self.role == Role.DOCTOR:
            if not self.doctor_name_en or not self.doctor_name_en.strip():
                raise ValueError("doctor_name_en is required when creating a DOCTOR user")
        else:
            if self.doctor_name_en is not None:
                raise ValueError("doctor_name_en must NOT be provided for non-DOCTOR users")
        return self


class ActionRequest(BaseModel):
    """Payload for lifecycle actions requiring optimistic concurrency validation."""

    model_config = ConfigDict(extra="forbid")

    version_id: int = Field(ge=1)


class UserUpdate(BaseModel):
    """Payload for modifying an existing user account with optimistic concurrency."""

    model_config = ConfigDict(extra="forbid")

    version_id: int = Field(ge=1)
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    role: Role | None = None

    @model_validator(mode="after")
    def validate_has_updates(self) -> "UserUpdate":
        """Ensure at least one mutable attribute is specified."""
        if self.full_name is None and self.role is None:
            raise ValueError("At least one field (full_name or role) must be provided for update")
        return self


class UserOut(BaseModel):
    """Public user record response schema."""

    model_config = ConfigDict(extra="forbid")

    id: int
    username: str
    full_name: str
    role: str
    doctor_id: int | None
    is_active: bool
    must_change_password: bool
    is_locked: bool
    last_login_at: datetime | None
    created_at: datetime
    version_id: int

    @classmethod
    def from_user(cls, user: User, now: datetime | None = None) -> "UserOut":
        """Construct UserOut with dynamically computed lockout state."""
        current_time = now or clock.utcnow()
        is_locked = bool(user.locked_until and user.locked_until > current_time)
        return cls(
            id=user.id,
            username=user.username,
            full_name=user.full_name,
            role=user.role,
            doctor_id=user.doctor_id,
            is_active=user.is_active,
            must_change_password=user.must_change_password,
            is_locked=is_locked,
            last_login_at=user.last_login_at,
            created_at=user.created_at,
            version_id=user.version_id,
        )


class UserCreatedOut(UserOut):
    """One-time creation response carrying the generated temporary password."""

    temporary_password: str

    @classmethod
    def from_user_and_secret(
        cls, user: User, temp_password: str, now: datetime | None = None
    ) -> "UserCreatedOut":
        """Construct UserCreatedOut carrying temporary password."""
        base = UserOut.from_user(user, now=now)
        return cls(
            **base.model_dump(),
            temporary_password=temp_password,
        )
