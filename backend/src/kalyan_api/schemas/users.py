"""Pydantic request and response schemas for user management."""

from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from kalyan_api import clock
from kalyan_api.core.permissions import Role
from kalyan_api.models import User

REASON_MAX_LENGTH = 500


def _blank_reason_to_none(value: str | None) -> str | None:
    """Trim an optional free-text reason, treating blank input as no reason."""
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


OptionalReason = Annotated[
    str | None,
    Field(max_length=REASON_MAX_LENGTH),
    AfterValidator(_blank_reason_to_none),
]
"""Optional administrator-supplied justification stored in the audit row's reason column."""


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
    reason: OptionalReason = None


class DeleteUserRequest(BaseModel):
    """Payload for deleting an unused account; authorised by the super admin's password."""

    model_config = ConfigDict(extra="forbid")

    version_id: int = Field(ge=1)
    reason: OptionalReason = None
    super_admin_password: str = Field(min_length=1, max_length=256, repr=False)


class DeleteUserOut(BaseModel):
    """Confirmation that an unused account was permanently deleted."""

    model_config = ConfigDict(extra="forbid")

    id: int
    username: str
    deleted: bool


class BulkDeleteItemIn(BaseModel):
    """One account in a bulk delete, with the version the administrator last saw."""

    model_config = ConfigDict(extra="forbid")

    id: int = Field(ge=1)
    version_id: int = Field(ge=1)


class BulkDeleteUsersRequest(BaseModel):
    """Payload for deleting several accounts under one super admin password check."""

    model_config = ConfigDict(extra="forbid")

    items: list[BulkDeleteItemIn] = Field(min_length=1, max_length=100)
    reason: OptionalReason = None
    super_admin_password: str = Field(min_length=1, max_length=256, repr=False)

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "BulkDeleteUsersRequest":
        """Reject a request that lists the same account twice."""
        ids = [item.id for item in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("Each account may be listed only once")
        return self


class BulkDeleteEntryOut(BaseModel):
    """Outcome for one account of a bulk delete."""

    model_config = ConfigDict(extra="forbid")

    id: int
    username: str | None
    deleted: bool
    code: str | None
    message: str | None


class BulkDeleteUsersOut(BaseModel):
    """Per-account results of a bulk delete."""

    model_config = ConfigDict(extra="forbid")

    deleted_count: int
    skipped_count: int
    results: list[BulkDeleteEntryOut]


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
    is_super_admin: bool
    must_change_password: bool
    is_locked: bool
    locked_until: datetime | None
    last_login_at: datetime | None
    password_changed_at: datetime | None
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
            is_super_admin=user.is_super_admin,
            must_change_password=user.must_change_password,
            is_locked=is_locked,
            locked_until=user.locked_until if is_locked else None,
            last_login_at=user.last_login_at,
            password_changed_at=user.password_changed_at,
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


class LoginHistoryEntry(BaseModel):
    """One authentication or account-security event concerning a user (secrets never included)."""

    model_config = ConfigDict(extra="forbid")

    id: int
    occurred_at: datetime
    action: str
    outcome: str
    actor_username: str | None
    ip_address: str | None
    user_agent: str | None
    reason: str | None
    details: dict[str, str | int | bool | None]
