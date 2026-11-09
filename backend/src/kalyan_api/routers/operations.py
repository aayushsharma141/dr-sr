"""Operations router for backup, restore, and integrity checks (BAK-01, BAK-02, BAK-03).

Hardening guarantees:
- archive filenames are bare names confined to the configured backup directory (422
  ``invalid_archive_filename`` otherwise), closing a path traversal on restore/verify.
- manual backup destinations must be local directories inside backup_dir or an operator-approved
  backup_destinations entry; UNC shares are refused (422 ``invalid_destination_dir``).
- restore always takes a pre-restore safety snapshot and requires the confirmation phrase
  ``RESTORE`` plus a reason (stored on the audit row).
- when a backup or restore fails, the request transaction rolls back, so BACKUP_FAILED /
  BACKUP_RESTORE_FAILED (outcome FAILURE) is written in a separate short transaction before
  the original error is re-raised as the HTTP error response.
"""

import logging
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.config import Settings, get_settings
from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
)
from kalyan_api.db.session import SessionDep, SessionLocal
from kalyan_api.models import BackupRun, BackupSettings, IntegrityRun, User
from kalyan_api.schemas.operations import (
    BackupArchiveInfo,
    BackupArchiveListResponse,
    BackupCreateRequest,
    BackupRunOut,
    BackupSettingsOut,
    BackupSettingsUpdate,
    BackupVerifyResponse,
    IntegrityCheckItemOut,
    IntegrityHistoryOut,
    IntegrityReportOut,
    IntegrityRunSummaryOut,
    RestoreRequest,
    RestoreResultOut,
)
from kalyan_api.services import audit_service, backup_schedule_service
from kalyan_api.services.audit_service import AuditAction, AuditContext, Outcome
from kalyan_api.services.backup_service import (
    ARCHIVE_GLOB,
    BackupCorruptedError,
    InvalidArchiveFilenameError,
    InvalidBackupLabelError,
    InvalidDestinationDirError,
    create_backup,
    resolve_archive_in_dir,
    restore_backup,
    validate_destination_dir,
    verify_backup_bundle,
)
from kalyan_api.services.integrity_service import run_integrity_audit

logger = logging.getLogger("kalyan_api.operations")

_BACKUP_SETTINGS_AUDIT_FIELDS: tuple[str, ...] = (
    "schedule_enabled",
    "frequency",
    "run_at",
    "weekly_day",
    "destination_dir",
    "retention_count",
)

router = APIRouter(prefix="/operations", tags=["operations"])


@contextmanager
def _isolated_audit_session() -> Generator[Session, None, None]:
    """Short, independent transaction used to persist failure audits.

    The request-scoped session rolls back when the endpoint raises, so failure evidence must be
    committed through a separate session from the application session factory.
    """
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _release_request_transaction(session: Session) -> None:
    """End the request transaction so its read locks cannot block psql's DROP SCHEMA."""
    session.commit()


def _safe_error_summary(exc: BaseException) -> str:
    """Exception type only: psql stderr can quote patient rows, so details stay in the log."""
    return type(exc).__name__


def _record_failure_isolated(
    ctx: AuditContext,
    action: AuditAction,
    entity_id: str | None,
    after: dict[str, Any],
    reason: str | None = None,
    failed_run: BackupRun | None = None,
) -> None:
    """Persist a FAILURE audit row, and any failed run record, in its own transaction.

    If persisting the audit itself fails, that secondary error is logged with traceback and the
    caller still re-raises the ORIGINAL operational error (the primary failure must surface).
    """
    try:
        with _isolated_audit_session() as audit_session:
            if failed_run is not None:
                audit_session.add(failed_run)
            audit_service.record(
                audit_session,
                ctx,
                action=action,
                entity_type="backup",
                entity_id=entity_id,
                after=after,
                reason=reason,
                outcome=Outcome.FAILURE,
            )
    except Exception:
        logger.exception("Failed to persist %s audit row in isolated transaction", action.value)


def _resolve_archive_or_422(settings: Settings, filename: str) -> Path:
    try:
        return resolve_archive_in_dir(settings.backup_dir, filename)
    except InvalidArchiveFilenameError as exc:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code="invalid_archive_filename",
            message=str(exc),
        ) from exc


@router.post(
    "/backups",
    response_model=BackupArchiveInfo,
    status_code=status.HTTP_201_CREATED,
    summary="Create system backup bundle (BAK-01)",
    dependencies=[Depends(require(Permission.BACKUP_RUN))],
)
def trigger_backup(
    payload: BackupCreateRequest,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> BackupArchiveInfo:
    """Create a checksummed .tar.gz backup bundle containing database dump and photos."""
    settings = get_settings()
    ctx = build_audit_context(request, principal)

    target_dir = settings.backup_dir
    if payload.destination_dir is not None and payload.destination_dir.strip():
        try:
            target_dir = validate_destination_dir(
                payload.destination_dir,
                [settings.backup_dir, *settings.backup_destinations],
            )
        except InvalidDestinationDirError as exc:
            raise ApiError(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code="invalid_destination_dir",
                message=str(exc),
            ) from exc

    started_at = clock.utcnow()
    try:
        archive_path = create_backup(
            destination_dir=target_dir,
            label=payload.label,
            settings=settings,
        )
    except InvalidBackupLabelError as exc:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code="invalid_backup_label",
            message=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("Backup creation failed")
        summary = _safe_error_summary(exc)
        _record_failure_isolated(
            ctx,
            AuditAction.BACKUP_FAILED,
            entity_id=None,
            after={
                "label": payload.label,
                "destination_dir": str(target_dir),
                "error": summary,
            },
            failed_run=BackupRun(
                trigger="MANUAL",
                outcome="FAILURE",
                started_at=started_at,
                finished_at=clock.utcnow(),
                error_type=summary,
            ),
        )
        raise ApiError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="backup_failed",
            message="Backup creation failed. See the server log for details.",
        ) from exc

    # Verify and inspect generated archive
    is_valid, _, manifest = verify_backup_bundle(archive_path)
    stat = archive_path.stat()

    session.add(
        BackupRun(
            trigger="MANUAL",
            outcome="SUCCESS" if is_valid else "FAILURE",
            started_at=started_at,
            finished_at=clock.utcnow(),
            filename=archive_path.name,
            size_bytes=stat.st_size,
            error_type=None if is_valid else "BackupCorruptedError",
        )
    )
    audit_service.record(
        session,
        ctx,
        action=AuditAction.BACKUP_CREATED,
        entity_type="backup",
        entity_id=archive_path.name,
        after={
            "filename": archive_path.name,
            "size_bytes": stat.st_size,
            "label": payload.label,
            "destination_dir": str(target_dir),
            "is_valid": is_valid,
        },
    )

    return BackupArchiveInfo(
        filename=archive_path.name,
        filepath=str(archive_path.resolve()),
        size_bytes=stat.st_size,
        created_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
        label=payload.label,
        is_valid=is_valid,
        manifest=manifest,
    )


def _load_backup_settings(session: Session) -> BackupSettings:
    config = session.get(BackupSettings, backup_schedule_service.SINGLETON_ID)
    if config is None:
        raise ApiError(status_code=404, code="not_found", message="Backup settings not found")
    return config


def _backup_settings_out(
    session: Session, config: BackupSettings, settings: Settings
) -> BackupSettingsOut:
    now = clock.utcnow()
    return BackupSettingsOut(
        schedule_enabled=config.schedule_enabled,
        frequency=config.frequency,
        run_at=config.run_at,
        weekly_day=config.weekly_day,
        destination_dir=config.destination_dir,
        retention_count=config.retention_count,
        version_id=config.version_id,
        updated_at=config.updated_at,
        next_run_at=(
            backup_schedule_service.next_slot(config, now) if config.schedule_enabled else None
        ),
        overdue=backup_schedule_service.is_overdue(session, now),
        approved_destinations=[str(path) for path in settings.backup_destinations],
    )


@router.get(
    "/backup-settings",
    response_model=BackupSettingsOut,
    summary="Read the backup schedule, retention and second-copy destination (BAK-01)",
    dependencies=[Depends(require(Permission.BACKUP_RUN))],
)
def get_backup_settings(session: SessionDep) -> BackupSettingsOut:
    """Return the persisted backup schedule used by the scheduled task."""
    return _backup_settings_out(session, _load_backup_settings(session), get_settings())


@router.patch(
    "/backup-settings",
    response_model=BackupSettingsOut,
    summary="Change the backup schedule, retention and second-copy destination (BAK-01)",
    dependencies=[Depends(require(Permission.BACKUP_CONFIGURE))],
)
def update_backup_settings(
    payload: BackupSettingsUpdate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> BackupSettingsOut:
    """Validate and store the backup schedule; the scheduled task reads it on its next tick."""
    settings = get_settings()
    config = session.scalar(
        select(BackupSettings)
        .where(BackupSettings.id == backup_schedule_service.SINGLETON_ID)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if config is None:
        raise ApiError(status_code=404, code="not_found", message="Backup settings not found")
    require_version(config, payload.version_id, "backup_settings")

    destination: str | None = None
    if payload.destination_dir is not None and payload.destination_dir.strip():
        try:
            destination = str(
                validate_destination_dir(payload.destination_dir, settings.backup_destinations)
            )
        except InvalidDestinationDirError as exc:
            raise ApiError(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code="invalid_destination_dir",
                message=str(exc),
            ) from exc

    before = audit_service.snapshot(config, _BACKUP_SETTINGS_AUDIT_FIELDS)
    config.schedule_enabled = payload.schedule_enabled
    config.frequency = payload.frequency
    config.run_at = payload.run_at
    config.weekly_day = payload.weekly_day if payload.frequency == "WEEKLY" else None
    config.destination_dir = destination
    config.retention_count = payload.retention_count
    session.flush()

    audit_service.record(
        session,
        build_audit_context(request, principal),
        AuditAction.BACKUP_SETTINGS_UPDATED,
        "BACKUP_SETTINGS",
        str(config.id),
        before=before,
        after=audit_service.snapshot(config, _BACKUP_SETTINGS_AUDIT_FIELDS),
        reason=payload.reason,
    )
    session.refresh(config)
    return _backup_settings_out(session, config, settings)


@router.get(
    "/backup-runs",
    response_model=list[BackupRunOut],
    summary="Recent backup attempts, newest first (BAK-01)",
    dependencies=[Depends(require(Permission.BACKUP_RUN))],
)
def list_backup_runs(
    session: SessionDep,
    limit: int = Query(default=20, ge=1, le=100),
) -> list[BackupRun]:
    """Return recent manual and scheduled backup attempts, including failures."""
    return list(
        session.scalars(
            select(BackupRun)
            .order_by(BackupRun.started_at.desc(), BackupRun.id.desc())
            .limit(limit)
        )
    )


@router.get(
    "/backups",
    response_model=BackupArchiveListResponse,
    summary="List available backup archive bundles (BAK-01)",
    dependencies=[Depends(require(Permission.BACKUP_RUN))],
)
def list_backups() -> BackupArchiveListResponse:
    """List all backup archives found in configured backup directory."""
    settings = get_settings()
    backup_dir = settings.backup_dir
    backup_dir.mkdir(parents=True, exist_ok=True)

    archives: list[BackupArchiveInfo] = []
    for file_path in backup_dir.glob(ARCHIVE_GLOB):
        if file_path.is_file():
            stat = file_path.stat()
            # Fast inspection of manifest
            is_valid, _, manifest = verify_backup_bundle(file_path)
            label = manifest.get("label") if manifest else None

            archives.append(
                BackupArchiveInfo(
                    filename=file_path.name,
                    filepath=str(file_path.resolve()),
                    size_bytes=stat.st_size,
                    created_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
                    label=label,
                    is_valid=is_valid,
                    manifest=manifest,
                )
            )

    # Sort newest first
    archives.sort(key=lambda b: b.created_at, reverse=True)

    return BackupArchiveListResponse(
        backups=archives,
        total_count=len(archives),
        backup_dir=str(backup_dir.resolve()),
    )


@router.post(
    "/backups/{filename}/verify",
    response_model=BackupVerifyResponse,
    summary="Re-hash one backup archive against its manifest (BAK-01)",
    dependencies=[Depends(require(Permission.BACKUP_RUN))],
)
def verify_backup(filename: str) -> BackupVerifyResponse:
    """Cryptographically re-verify a single archive in the backup directory (read-only)."""
    settings = get_settings()
    archive_path = _resolve_archive_or_422(settings, filename)
    is_valid, details, _ = verify_backup_bundle(archive_path)
    return BackupVerifyResponse(filename=archive_path.name, valid=is_valid, details=details)


@router.post(
    "/restore",
    response_model=RestoreResultOut,
    summary="Restore system from backup archive (BAK-02)",
    dependencies=[Depends(require(Permission.BACKUP_RESTORE))],
)
def trigger_restore(
    payload: RestoreRequest,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> RestoreResultOut:
    """Verify archive and execute safe restore with a mandatory pre-restore snapshot."""
    settings = get_settings()
    ctx = build_audit_context(request, principal)
    archive_path = _resolve_archive_or_422(settings, payload.archive_filename)

    _release_request_transaction(session)

    try:
        result = restore_backup(
            archive_path=archive_path,
            settings=settings,
            create_prerestore_snapshot=True,
        )
    except BackupCorruptedError as exc:
        summary = _safe_error_summary(exc)
        _record_failure_isolated(
            ctx,
            AuditAction.BACKUP_RESTORE_FAILED,
            entity_id=archive_path.name,
            after={"archive_filename": archive_path.name, "stage": "verify", "error": summary},
            reason=payload.reason,
        )
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="backup_corrupted",
            message=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("Restore failed for %s", archive_path.name)
        summary = _safe_error_summary(exc)
        _record_failure_isolated(
            ctx,
            AuditAction.BACKUP_RESTORE_FAILED,
            entity_id=archive_path.name,
            after={"archive_filename": archive_path.name, "stage": "restore", "error": summary},
            reason=payload.reason,
        )
        raise ApiError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="restore_failed",
            message="Restoration failed. See the server log for details.",
        ) from exc

    # An older backup may predate the acting admin; the FK would then reject the audit row and
    # report a completed restore as failed. The username is kept as text either way.
    manifest = result.get("manifest") or {}
    with _isolated_audit_session() as audit_session:
        actor_survived = (
            audit_session.scalar(select(User.id).where(User.id == ctx.actor_user_id)) is not None
        )
        audit_service.record(
            audit_session,
            ctx if actor_survived else replace(ctx, actor_user_id=None),
            action=AuditAction.BACKUP_RESTORED,
            entity_type="backup",
            entity_id=archive_path.name,
            after={
                "restored_archive": archive_path.name,
                "archive_created_at": manifest.get("created_at"),
                "archive_label": manifest.get("label"),
                "prerestore_snapshot": result.get("prerestore_snapshot"),
                "database_restored": result["database_restored"],
                "photos_restored_count": result["photos_restored_count"],
            },
            reason=payload.reason,
        )

    return RestoreResultOut(
        status=result["status"],
        archive_restored=result["archive_restored"],
        prerestore_snapshot=result.get("prerestore_snapshot"),
        database_restored=result["database_restored"],
        photos_restored_count=result["photos_restored_count"],
        manifest=result.get("manifest"),
    )


def _report_from_run(run: IntegrityRun) -> IntegrityReportOut:
    return IntegrityReportOut(
        id=run.id,
        generated_at=run.generated_at.isoformat(),
        run_by_username=run.run_by_username,
        duration_ms=run.duration_ms,
        is_healthy=run.is_healthy,
        total_checks=run.total_checks,
        passed_checks=run.passed_checks,
        failed_checks=run.failed_checks,
        warning_checks=run.warning_checks,
        cleanup_checks=run.cleanup_checks,
        checks=[IntegrityCheckItemOut.model_validate(item) for item in run.checks],
    )


@router.get(
    "/integrity",
    response_model=IntegrityReportOut | None,
    summary="Latest stored integrity check result, or null if none has run (BAK-03)",
    dependencies=[Depends(require(Permission.INTEGRITY_RUN))],
)
def get_latest_integrity_report(session: SessionDep) -> IntegrityReportOut | None:
    """Read the latest stored run. Reading does not run the checks or write an audit entry."""
    run = session.scalars(
        select(IntegrityRun).order_by(IntegrityRun.generated_at.desc(), IntegrityRun.id.desc())
    ).first()
    return _report_from_run(run) if run is not None else None


@router.get(
    "/integrity/history",
    response_model=IntegrityHistoryOut,
    summary="Recent integrity check runs, newest first (BAK-03)",
    dependencies=[Depends(require(Permission.INTEGRITY_RUN))],
)
def get_integrity_history(
    session: SessionDep,
    limit: int = Query(default=20, ge=1, le=100),
) -> IntegrityHistoryOut:
    runs = session.scalars(
        select(IntegrityRun)
        .order_by(IntegrityRun.generated_at.desc(), IntegrityRun.id.desc())
        .limit(limit)
    ).all()
    return IntegrityHistoryOut(
        runs=[
            IntegrityRunSummaryOut(
                id=run.id,
                generated_at=run.generated_at.isoformat(),
                run_by_username=run.run_by_username,
                is_healthy=run.is_healthy,
                total_checks=run.total_checks,
                passed_checks=run.passed_checks,
                failed_checks=run.failed_checks,
                warning_checks=run.warning_checks,
                cleanup_checks=run.cleanup_checks,
            )
            for run in runs
        ]
    )


@router.post(
    "/integrity/run",
    response_model=IntegrityReportOut,
    status_code=status.HTTP_201_CREATED,
    summary="Run every clinical, financial and file integrity check and store the result (BAK-03)",
    dependencies=[Depends(require(Permission.INTEGRITY_RUN))],
)
def run_integrity_report(
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> IntegrityReportOut:
    """Run the read-only checks, store the run and record one audit entry."""
    settings = get_settings()
    report = run_integrity_audit(session=session, settings=settings)
    payload = report.to_dict()

    run = IntegrityRun(
        generated_at=datetime.fromisoformat(report.generated_at),
        run_by_user_id=principal.user_id,
        run_by_username=principal.username,
        duration_ms=report.duration_ms,
        is_healthy=report.is_healthy,
        total_checks=report.total_checks,
        passed_checks=report.passed_checks,
        failed_checks=report.failed_checks,
        warning_checks=report.warning_checks,
        cleanup_checks=report.cleanup_checks,
        checks=payload["checks"],
    )
    session.add(run)
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.INTEGRITY_CHECK_RUN,
        entity_type="system",
        entity_id=f"integrity_run:{run.id}",
        after={
            "is_healthy": report.is_healthy,
            "total_checks": report.total_checks,
            "failed_checks": report.failed_checks,
            "warning_checks": report.warning_checks,
            "cleanup_checks": report.cleanup_checks,
        },
    )

    return _report_from_run(run)
