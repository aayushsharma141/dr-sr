"""Workstation heartbeat and LAN status service (Phase 23)."""

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.clock import utcnow
from kalyan_api.core.principal import Principal
from kalyan_api.models import Workstation
from kalyan_api.schemas.workstations import WorkstationHeartbeatIn, WorkstationOut

ONLINE_THRESHOLD_SECONDS = 60
IDLE_THRESHOLD_SECONDS = 300


def get_client_ip(request: Request) -> str | None:
    """Extract client LAN IP address from request."""
    if request.headers.get("x-forwarded-for"):
        return request.headers["x-forwarded-for"].split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def record_heartbeat(
    session: Session,
    principal: Principal,
    request: Request,
    payload: WorkstationHeartbeatIn,
) -> WorkstationOut:
    """Record periodic heartbeat from an active hospital terminal."""
    client_ip = get_client_ip(request)
    now = utcnow()

    ws = session.scalar(
        select(Workstation).where(Workstation.hostname == payload.hostname).with_for_update()
    )

    if not ws:
        ws = Workstation(
            hostname=payload.hostname,
            ip_address=client_ip,
            terminal_name=payload.terminal_name,
            app_version=payload.app_version,
            last_seen_at=now,
            last_user_id=principal.user_id,
            last_username=principal.username,
        )
        session.add(ws)
    else:
        ws.ip_address = client_ip
        if payload.terminal_name:
            ws.terminal_name = payload.terminal_name
        if payload.app_version:
            ws.app_version = payload.app_version
        ws.last_seen_at = now
        ws.last_user_id = principal.user_id
        ws.last_username = principal.username

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
