"""Health check endpoint demonstrating database connectivity and public policy marker."""

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import text

from kalyan_api.core.policy import public
from kalyan_api.db.session import SessionDep
from kalyan_api.db.startup import setup_completed

router = APIRouter(prefix="/health", tags=["health"])


@router.get("", dependencies=[Depends(public)])
def health_check(session: SessionDep) -> dict[str, Any]:
    """Return health status, database ping, and authoritative setup_required flag (SEC-07)."""
    session.execute(text("SELECT 1"))
    is_setup_done = setup_completed(session)
    return {
        "status": "ok",
        "db": "ok",
        "setup_required": not is_setup_done,
    }
