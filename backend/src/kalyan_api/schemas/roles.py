"""Pydantic schemas for the read-only fixed role and permission catalogue (Admin module 02)."""

from pydantic import BaseModel, ConfigDict


class RoleInfo(BaseModel):
    """A fixed system role with its display label."""

    model_config = ConfigDict(extra="forbid")

    role: str
    label: str


class PermissionInfo(BaseModel):
    """A granular permission key with its display group and plain-English label."""

    model_config = ConfigDict(extra="forbid")

    key: str
    group: str
    label: str


class RolePermissionsOut(BaseModel):
    """Role catalogue, permission catalogue, and the role-to-permission grant table."""

    model_config = ConfigDict(extra="forbid")

    roles: list[RoleInfo]
    permissions: list[PermissionInfo]
    grants: dict[str, list[str]]
