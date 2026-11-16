"""Schemas for LAN workstation heartbeat and monitoring (Phase 23)."""

from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class WorkstationHeartbeatIn(BaseModel):
    """Heartbeat payload sent periodically by active hospital LAN clients."""

    model_config = ConfigDict(extra="forbid")

    hostname: str = Field(..., min_length=1, max_length=120)
    terminal_name: str | None = Field(default=None, max_length=120)
    app_version: str | None = Field(default=None, max_length=32)


class WorkstationOut(BaseModel):
    """Workstation details with computed online/idle/offline status."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    hostname: str
    ip_address: str | None = None
    terminal_name: str | None = None
    app_version: str | None = None
    last_seen_at: datetime
    last_user_id: int | None = None
    last_username: str | None = None
    status: str = "ONLINE"  # "ONLINE" (<=60s), "IDLE" (<=300s), "OFFLINE" (>300s)
    created_at: datetime
    updated_at: datetime
