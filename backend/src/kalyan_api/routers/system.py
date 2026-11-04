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
from tempfile import NamedTemporaryFile

from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from fastapi import APIRouter, Depends, Request
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from kalyan_api import __version__ as PACKAGE_FALLBACK_VERSION
from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import get_current_settings
from kalyan_api.db.migrate import alembic_config
from kalyan_api.db.session import SessionDep
from kalyan_api.models import BackupRun, BackupSettings
from kalyan_api.schemas.system import ServiceCheckOut, StorageVolumeOut, SystemStatusOut
from kalyan_api.services import backup_schedule_service

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


def _folder_check(key: str, label: str, path: Path) -> ServiceCheckOut:
    """Prove a folder is usable by writing to it, because existing does not mean writable."""
    if not path.is_dir():
        return ServiceCheckOut(key=key, label=label, status="error", detail="Folder not found.")
    try:
        with NamedTemporaryFile(dir=path, prefix=".health-"):
            pass
    except OSError as exc:
        return ServiceCheckOut(
            key=key,
            label=label,
            status="error",
            detail=f"Server cannot write here ({type(exc).__name__}).",
        )
    return ServiceCheckOut(key=key, label=label, status="ok", detail="Server can write here.")


def _backup_checks(session: Session, settings: Settings) -> list[ServiceCheckOut]:
    last_run = session.scalars(
        select(BackupRun).order_by(BackupRun.started_at.desc(), BackupRun.id.desc()).limit(1)
    ).first()
    if last_run is None:
        result = ServiceCheckOut(
            key="last_backup_run",
            label="Latest backup run",
            status="warning",
            detail="No backup run has been recorded.",
        )
    else:
        failed = last_run.outcome == "FAILURE"
        result = ServiceCheckOut(
            key="last_backup_run",
            label="Latest backup run",
            status="error" if failed else "ok",
            detail=(
                f"{last_run.trigger.title()} run {last_run.outcome.lower()} at "
                f"{last_run.started_at.astimezone(clock.IST):%d %b %Y %H:%M} IST."
            ),
        )

    config = session.get(BackupSettings, backup_schedule_service.SINGLETON_ID)
    if config is None or not config.schedule_enabled:
        schedule = ServiceCheckOut(
            key="backup_schedule",
            label="Backup schedule",
            status="not_configured",
            detail="Scheduled backups are off.",
        )
    elif backup_schedule_service.is_overdue(session, clock.utcnow()):
        schedule = ServiceCheckOut(
            key="backup_schedule",
            label="Backup schedule",
            status="error",
            detail="A scheduled backup did not run. Check the Windows scheduled task.",
        )
    else:
        schedule = ServiceCheckOut(
            key="backup_schedule",
            label="Backup schedule",
            status="ok",
            detail="Scheduled backups are running to plan.",
        )

    checks = [result, schedule]
    if config is not None and config.destination_dir:
        checks.append(
            _folder_check("second_copy", "Second backup copy", Path(config.destination_dir))
        )
    return checks


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
        checks=[
            ServiceCheckOut(
                key="database",
                label="Database",
                status="ok" if db_revision == head_revision else "error",
                detail=(
                    "Connected, and the schema matches this software version."
                    if db_revision == head_revision
                    else "Connected, but the schema does not match this software version."
                ),
            ),
            _folder_check("photos", "Patient photos folder", settings.photos_dir),
            _folder_check("backups", "Backup folder", settings.backup_dir),
            *_backup_checks(session, settings),
        ],
    )
