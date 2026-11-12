"""Scheduled backups driven by the persisted backup_settings row (BAK-01, Admin module 11).

A Windows Scheduled Task runs `kalyan_api.cli backup-run-scheduled` every few minutes; this
module decides whether a backup is due. The task does nothing while the schedule is disabled.

Guarantees:
- One run per scheduled slot. The claim happens under a row lock, so overlapping task ticks
  cannot both start. A failed run waits for the next slot rather than retrying every tick.
- A slot that passed before the settings were last saved never fires, so enabling the schedule
  does not start a backup immediately.
- Retention only removes archives this scheduler created (label "scheduled"), and only after a
  verified success. Manual and pre-restore archives are never deleted.
- The second copy is checksum-compared before it counts, and failures record the exception
  type only, because tool output can quote patient rows.
"""

import logging
import shutil
from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.db.session import session_scope
from kalyan_api.models import BackupRun, BackupSettings
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction, AuditContext, Outcome
from kalyan_api.services.backup_service import (
    BackupCorruptedError,
    compute_sha256,
    create_backup,
    validate_destination_dir,
    verify_backup_bundle,
)

logger = logging.getLogger("kalyan_api.backup_schedule")

SCHEDULED_LABEL = "scheduled"
SCHEDULED_GLOB = f"kalyan_backup_*_{SCHEDULED_LABEL}.tar.gz"
SINGLETON_ID = 1
# A RUNNING row older than this belongs to a process that died (e.g. a power cut).
STALE_RUN_AFTER = timedelta(hours=6)
# A slot counts as missed once this long has passed with no run recorded.
OVERDUE_GRACE = timedelta(hours=1)

ScopeFactory = Callable[[Settings], AbstractContextManager[Session]]


def latest_slot(config: BackupSettings, now: datetime) -> datetime:
    """Most recent scheduled instant at or before now, in IST."""
    now_ist = now.astimezone(clock.IST)
    slot = now_ist.replace(
        hour=config.run_at.hour,
        minute=config.run_at.minute,
        second=config.run_at.second,
        microsecond=0,
    )
    if config.frequency == "WEEKLY":
        slot -= timedelta(days=(slot.weekday() - (config.weekly_day or 0)) % 7)
        return slot - timedelta(days=7) if slot > now_ist else slot
    return slot - timedelta(days=1) if slot > now_ist else slot


def next_slot(config: BackupSettings, now: datetime) -> datetime:
    """Next scheduled instant after now, in IST."""
    return latest_slot(config, now) + timedelta(days=7 if config.frequency == "WEEKLY" else 1)


def is_due(config: BackupSettings, last_started: datetime | None, now: datetime) -> bool:
    """True when the schedule is on and the latest slot has not been attempted."""
    if not config.schedule_enabled:
        return False
    slot = latest_slot(config, now)
    if slot <= config.updated_at:
        return False
    return last_started is None or last_started < slot


def _last_scheduled_start(session: Session) -> datetime | None:
    return session.scalar(
        select(BackupRun.started_at)
        .where(BackupRun.trigger == "SCHEDULED")
        .order_by(BackupRun.started_at.desc())
        .limit(1)
    )


def schedule_is_enabled(session: Session) -> bool:
    """True when a saved schedule is switched on; false with no row or schedule disabled."""
    config = session.get(BackupSettings, SINGLETON_ID)
    return bool(config.schedule_enabled) if config is not None else False


def is_overdue(session: Session, now: datetime) -> bool:
    """True when an enabled schedule missed a slot, e.g. the Windows task is not registered."""
    config = session.get(BackupSettings, SINGLETON_ID)
    if config is None or not config.schedule_enabled:
        return False
    if now < latest_slot(config, now) + OVERDUE_GRACE:
        return False
    return is_due(config, _last_scheduled_start(session), now)


def prune_scheduled(directory: Path, retention_count: int) -> list[str]:
    """Delete the oldest scheduled archives beyond retention_count; returns removed names."""
    archives = sorted(directory.glob(SCHEDULED_GLOB), key=lambda p: p.name, reverse=True)
    removed: list[str] = []
    for archive in archives[retention_count:]:
        archive.unlink()
        removed.append(archive.name)
    return removed


def copy_verified(archive: Path, destination: Path) -> Path:
    """Copy an archive to destination and prove the copy matches before it replaces the name."""
    partial = destination / f"{archive.name}.part"
    final = destination / archive.name
    shutil.copy2(archive, partial)
    if compute_sha256(partial) != compute_sha256(archive):
        partial.unlink()
        raise BackupCorruptedError("Second copy does not match the backup archive")
    partial.replace(final)
    return final


def _claim_run(session: Session, now: datetime) -> tuple[int, str | None, int | None] | None:
    """Create a RUNNING row when a backup is due; returns its id, destination and retention."""
    config = session.scalar(
        select(BackupSettings)
        .where(BackupSettings.id == SINGLETON_ID)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if config is None:
        return None

    running = session.scalars(select(BackupRun).where(BackupRun.outcome == "RUNNING")).all()
    for run in running:
        if run.started_at >= now - STALE_RUN_AFTER:
            return None
        run.outcome = "FAILURE"
        run.finished_at = now
        run.error_type = "Interrupted"

    if not is_due(config, _last_scheduled_start(session), now):
        return None

    run = BackupRun(trigger="SCHEDULED", outcome="RUNNING", started_at=now)
    session.add(run)
    session.flush()
    return run.id, config.destination_dir, config.retention_count


def _create_and_store(
    settings: Settings, destination_dir: str | None, retention_count: int | None
) -> tuple[Path, str | None, list[str]]:
    """Create the archive, make the second copy, then apply retention."""
    destination = (
        validate_destination_dir(destination_dir, settings.backup_destinations)
        if destination_dir
        else None
    )
    archive = create_backup(label=SCHEDULED_LABEL, settings=settings)
    is_valid, message, _ = verify_backup_bundle(archive)
    if not is_valid:
        raise BackupCorruptedError(message)

    copied_to = str(copy_verified(archive, destination).parent) if destination else None

    pruned: list[str] = []
    if retention_count is not None:
        pruned += prune_scheduled(settings.backup_dir, retention_count)
        if destination:
            pruned += prune_scheduled(destination, retention_count)
    return archive, copied_to, pruned


def run_scheduled_backup(settings: Settings, scope: ScopeFactory = session_scope) -> str:
    """Run one scheduled backup if due. Returns 'skipped', 'success' or 'failure'."""
    ctx = AuditContext.system("backup-scheduler")
    with scope(settings) as session:
        claim = _claim_run(session, clock.utcnow())
    if claim is None:
        return "skipped"
    run_id, destination_dir, retention_count = claim

    try:
        archive, copied_to, pruned = _create_and_store(settings, destination_dir, retention_count)
    except Exception as exc:
        logger.exception("Scheduled backup failed")
        error_type = type(exc).__name__
        with scope(settings) as session:
            run = session.get(BackupRun, run_id)
            if run is not None:
                run.outcome = "FAILURE"
                run.finished_at = clock.utcnow()
                run.error_type = error_type
            audit_service.record(
                session,
                ctx,
                AuditAction.BACKUP_FAILED,
                "backup",
                None,
                after={"trigger": "SCHEDULED", "error": error_type},
                outcome=Outcome.FAILURE,
            )
        return "failure"

    size_bytes = archive.stat().st_size
    with scope(settings) as session:
        run = session.get(BackupRun, run_id)
        if run is not None:
            run.outcome = "SUCCESS"
            run.finished_at = clock.utcnow()
            run.filename = archive.name
            run.size_bytes = size_bytes
            run.copied_to = copied_to
            run.pruned_count = len(pruned)
        audit_service.record(
            session,
            ctx,
            AuditAction.BACKUP_CREATED,
            "backup",
            archive.name,
            after={
                "trigger": "SCHEDULED",
                "filename": archive.name,
                "size_bytes": size_bytes,
                "copied_to": copied_to,
            },
        )
        if pruned:
            audit_service.record(
                session,
                ctx,
                AuditAction.BACKUP_PRUNED,
                "backup",
                archive.name,
                after={"retention_count": retention_count, "removed": pruned},
            )
    return "success"
