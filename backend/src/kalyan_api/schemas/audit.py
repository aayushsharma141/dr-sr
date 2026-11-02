"""Audit Log schemas for querying and exporting system activity records (AUD-02, Phase 16)."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class AuditLogOut(BaseModel):
    """Output representation of an immutable audit log record."""

    id: int
    occurred_at: datetime
    actor_user_id: int | None = None
    actor_username: str | None = None
    actor_role: str | None = None
    action: str
    outcome: str
    entity_type: str | None = None
    entity_id: str | None = None
    before_data: dict[str, Any] | None = None
    after_data: dict[str, Any] | None = None
    reason: str | None = None
    request_id: str | None = None
    ip: str | None = None
    user_agent: str | None = None


class AuditLogListResponse(BaseModel):
    """Paginated list of audit records."""

    items: list[AuditLogOut]
    total: int
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=200)
    pages: int
