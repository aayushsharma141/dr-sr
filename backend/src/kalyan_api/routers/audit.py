"""Audit Log viewer and filter endpoint (AUD-02, Phase 16).

Guarantees:
- Admin-only access (AUDIT_READ).
- Filter by actor username, action, entity type, entity ID, date range, and outcome.
- Chronological descending order by default.
- Redacted sensitive attributes (passwords, tokens) are strictly prevented from appearing.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.db.session import SessionDep
from kalyan_api.models import AuditLog
from kalyan_api.schemas.audit import AuditLogListResponse, AuditLogOut

router = APIRouter(tags=["audit"])


@router.get(
    "/audit-logs/actions",
    response_model=list[str],
    dependencies=[Depends(require(Permission.AUDIT_READ))],
)
def list_audit_actions(session: SessionDep) -> list[str]:
    """Return sorted distinct list of audit action names recorded in the system."""
    stmt = select(AuditLog.action).distinct().order_by(AuditLog.action.asc())
    return list(session.scalars(stmt).all())


@router.get(
    "/audit-logs",
    response_model=AuditLogListResponse,
    dependencies=[Depends(require(Permission.AUDIT_READ))],
)
def list_audit_logs(
    session: SessionDep,
    actor_username: Annotated[str | None, Query(description="Filter by username")] = None,
    action: Annotated[str | None, Query(description="Filter by action name")] = None,
    entity_type: Annotated[str | None, Query(description="Filter by entity type")] = None,
    entity_id: Annotated[str | None, Query(description="Filter by entity ID")] = None,
    outcome: Annotated[str | None, Query(description="Filter by outcome")] = None,
    date_from: Annotated[
        datetime | None, Query(description="Filter start date (inclusive)")
    ] = None,
    date_to: Annotated[datetime | None, Query(description="Filter end date (inclusive)")] = None,
    page: Annotated[int, Query(ge=1, description="Page number")] = 1,
    page_size: Annotated[int, Query(ge=1, le=200, description="Page size")] = 50,
) -> AuditLogListResponse:
    """List system audit log records with multi-dimensional filtering (AUD-02)."""
    stmt = select(AuditLog)

    if actor_username:
        stmt = stmt.where(AuditLog.actor_username.ilike(f"%{actor_username.strip()}%"))
    if action:
        stmt = stmt.where(AuditLog.action == action.strip())
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type.strip())
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id.strip())
    if outcome:
        stmt = stmt.where(AuditLog.outcome == outcome.strip().upper())
    if date_from:
        stmt = stmt.where(AuditLog.occurred_at >= date_from)
    if date_to:
        stmt = stmt.where(AuditLog.occurred_at <= date_to)

    # Count total matching rows
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total: int = session.scalar(count_stmt) or 0

    # Paginate and order descending
    offset = (page - 1) * page_size
    stmt = (
        stmt.order_by(AuditLog.occurred_at.desc(), AuditLog.id.desc())
        .offset(offset)
        .limit(page_size)
    )
    records = session.execute(stmt).scalars().all()

    items = [
        AuditLogOut(
            id=r.id,
            occurred_at=r.occurred_at,
            actor_user_id=r.actor_user_id,
            actor_username=r.actor_username,
            actor_role=r.actor_role,
            action=r.action,
            outcome=r.outcome,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            before_data=r.before_data,
            after_data=r.after_data,
            reason=r.reason,
            request_id=str(r.request_id) if r.request_id else None,
            ip=str(r.ip) if r.ip else None,
            user_agent=r.user_agent,
        )
        for r in records
    ]

    pages = (total + page_size - 1) // page_size if total > 0 else 1

    return AuditLogListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        pages=pages,
    )
