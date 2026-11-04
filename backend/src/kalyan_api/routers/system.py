"""System health, version and storage endpoints (Admin Panel module 12).

GET /api/system/status (SYSTEM_READ) reports application version, schema revision drift,
PostgreSQL version/size/connections, server clocks, process uptime and storage capacity.
No secrets are exposed: database credentials and connection URLs never appear in the payload.
"""

import shutil
from datetime import UTC, datetime
from functools import lru_cache
from importlib import metadata
from pathlib import Path

from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from fastapi import APIRouter, Depends, Request
from sqlalchemy import text

from kalyan_api import __version__ as PACKAGE_FALLBACK_VERSION
from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import get_current_settings
from kalyan_api.db.migrate import alembic_config
from kalyan_api.db.session import SessionDep
from kalyan_api.schemas.system import StorageVolumeOut, SystemStatusOut

router = APIRouter(prefix="/system", tags=["system"])

# Captured when the API module is imported, i.e. at server process start-up.
PROCESS_STARTED_AT: datetime = datetime.now(UTC)

DISTRIBUTION_NAMES: tuple[str, ...] = ("kalyan-api", "kalyan_api")


def resolve_app_version() -> str:
    """Installed distribution version, falling back to the package constant."""
    for dist_name in DISTRIBUTION_NAMES:
        try:
            return metadata.version(dist_name)
        except metadata.PackageNotFoundError:
            continue
    return PACKAGE_FALLBACK_VERSION


@lru_cache(maxsize=1)
def code_head_revision() -> str | None:
    """Alembic head revision shipped with this code (migration scripts are static per build)."""
    cfg = alembic_config("postgresql+psycopg://dummy:dummy@127.0.0.1/dummy")
    return ScriptDirectory.from_config(cfg).get_current_head()


def measure_volume(label: str, path: Path) -> StorageVolumeOut:
    """Measure the volume holding path (or its nearest existing ancestor)."""
    probe = Path(path)
    while not probe.exists():
        parent = probe.parent
        if parent == probe:
            return StorageVolumeOut(
                label=label, path_label=str(path), total_bytes=None, free_bytes=None
            )
        probe = parent
    try:
        usage = shutil.disk_usage(probe)
    except OSError:
        return StorageVolumeOut(
            label=label, path_label=str(path), total_bytes=None, free_bytes=None
        )
    return StorageVolumeOut(
        label=label,
        path_label=str(path),
        total_bytes=int(usage.total),
        free_bytes=int(usage.free),
    )


def _frontend_served(settings: Settings) -> bool:
    dist_dir = settings.frontend_dist
    return bool(dist_dir and (dist_dir / "index.html").is_file())


@router.get(
    "/status",
    response_model=SystemStatusOut,
    dependencies=[Depends(require(Permission.SYSTEM_READ))],
)
def get_system_status(request: Request, session: SessionDep) -> SystemStatusOut:
    """Return server runtime, schema, database and storage status (read-only)."""
    settings = get_current_settings(request)

    db_revision = MigrationContext.configure(session.connection()).get_current_revision()
    head_revision = code_head_revision()

    postgres_version = str(session.scalar(text("SHOW server_version")) or "")
    db_size_bytes = int(session.scalar(text("SELECT pg_database_size(current_database())")) or 0)
    db_connections = int(
        session.scalar(
            text("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()")
        )
        or 0
    )

    now_utc = clock.utcnow()
    uptime_seconds = max(0, int((now_utc - PROCESS_STARTED_AT).total_seconds()))

    return SystemStatusOut(
        app_version=resolve_app_version(),
        environment=settings.env,
        db_revision=db_revision,
        code_head_revision=head_revision,
        revision_matches=db_revision is not None and db_revision == head_revision,
        postgres_version=postgres_version,
        db_size_bytes=db_size_bytes,
        db_connections=db_connections,
        server_time_utc=now_utc,
        server_time_ist=now_utc.astimezone(clock.IST),
        process_started_at=PROCESS_STARTED_AT,
        uptime_seconds=uptime_seconds,
        storage=[
            measure_volume("photos", settings.photos_dir),
            measure_volume("backups", settings.backup_dir),
        ],
        frontend_served=_frontend_served(settings),
    )
