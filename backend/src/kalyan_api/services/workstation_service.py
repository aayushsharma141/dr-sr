"""Workstation heartbeat and LAN status service (Phase 23)."""

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from kalyan_api.clock import utcnow
from kalyan_api.core import net
from kalyan_api.core.principal import Principal
from kalyan_api.models import Workstation
from kalyan_api.schemas.workstations import WorkstationHeartbeatIn, WorkstationOut

ONLINE_THRESHOLD_SECONDS = 60
IDLE_THRESHOLD_SECONDS = 300


def get_client_ip(request: Request) -> str:
    """Extract canonical LAN peer IP without trusting spoofable proxy headers."""
    return net.client_ip(request)[:64]


def record_heartbeat(
    session: Session,
    principal: Principal,
    request: Request,
    payload: WorkstationHeartbeatIn,
) -> WorkstationOut:
    """Record periodic heartbeat from an active hospital terminal via atomic upsert."""
    client_ip = get_client_ip(request)
    now = utcnow()

    update_values: dict[str, object] = {
        "ip_address": client_ip,
        "last_seen_at": now,
        "last_user_id": principal.user_id,
        "last_username": principal.username,
        "updated_at": now,
    }
    if payload.terminal_name:
        update_values["terminal_name"] = payload.terminal_name
    if payload.app_version:
        update_values["app_version"] = payload.app_version

    stmt = (
        pg_insert(Workstation)
        .values(
            hostname=payload.hostname,
            ip_address=client_ip,
            terminal_name=payload.terminal_name,
            app_version=payload.app_version,
            last_seen_at=now,
            last_user_id=principal.user_id,
            last_username=principal.username,
        )
        .on_conflict_do_update(
            index_elements=[Workstation.hostname],
            set_=update_values,
        )
        .returning(Workstation)
    )
    ws = session.scalars(stmt, execution_options={"populate_existing": True}).one()
    session.flush()

    out = WorkstationOut.model_validate(ws)
    out.status = "ONLINE"
    return out


def list_workstations(session: Session) -> list[WorkstationOut]:
    """List all registered hospital LAN workstations with computed online/idle/offline status."""
    workstations = session.scalars(
        select(Workstation).order_by(Workstation.last_seen_at.desc(), Workstation.id.desc())
    ).all()

    now = utcnow()
    results: list[WorkstationOut] = []

    for ws in workstations:
        elapsed = (now - ws.last_seen_at).total_seconds()
        if elapsed <= ONLINE_THRESHOLD_SECONDS:
            st = "ONLINE"
        elif elapsed <= IDLE_THRESHOLD_SECONDS:
            st = "IDLE"
        else:
            st = "OFFLINE"

        out = WorkstationOut.model_validate(ws)
        out.status = st
        results.append(out)

    return results
