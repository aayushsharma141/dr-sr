"""Health check endpoint demonstrating database connectivity and public policy marker."""

from fastapi import APIRouter, Depends
from sqlalchemy import text

from kalyan_api.core.policy import public
from kalyan_api.db.session import SessionDep

router = APIRouter(prefix="/health", tags=["health"])


@router.get("", dependencies=[Depends(public)])
def health_check(session: SessionDep) -> dict[str, str]:
    """Return health status and execute real database ping."""
    session.execute(text("SELECT 1"))
    return {"status": "ok", "db": "ok"}

