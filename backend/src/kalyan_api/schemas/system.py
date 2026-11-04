"""Pydantic schemas for the System Health admin module (Admin Panel module 12).

The status payload deliberately carries no secrets: no database passwords, no connection URLs,
no usernames of database roles.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class StorageVolumeOut(BaseModel):
    """Capacity of the volume holding one configured data directory."""

    model_config = ConfigDict(extra="forbid")

    label: str
    path_label: str
    total_bytes: int | None
    free_bytes: int | None


class SystemStatusOut(BaseModel):
    """Runtime, schema, database and storage status of the LAN server."""

    model_config = ConfigDict(extra="forbid")

    app_version: str
    environment: str
    db_revision: str | None
    code_head_revision: str | None
    revision_matches: bool
    postgres_version: str
    db_size_bytes: int
    db_connections: int
    server_time_utc: datetime
    server_time_ist: datetime
    process_started_at: datetime
    uptime_seconds: int
    storage: list[StorageVolumeOut]
    frontend_served: bool
