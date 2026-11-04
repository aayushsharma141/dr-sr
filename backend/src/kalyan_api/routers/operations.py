"""Operations router for backup, restore, and integrity checks (BAK-01, BAK-02, BAK-03)."""

from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status

from kalyan_api.config import get_settings
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.schemas.operations import (
    BackupArchiveInfo,
    BackupArchiveListResponse,
    BackupCreateRequest,
    IntegrityCheckItemOut,
    IntegrityReportOut,
    RestoreRequest,
    RestoreResultOut,
)
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.backup_service import (
    BackupCorruptedError,
    create_backup,
    restore_backup,
    verify_backup_bundle,
)
from kalyan_api.services.integrity_service import run_integrity_audit

router = APIRouter(prefix="/operations", tags=["operations"])


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
    target_dir = Path(payload.destination_dir) if payload.destination_dir else settings.backup_dir

    try:
        archive_path = create_backup(
            destination_dir=target_dir,
            label=payload.label,
            settings=settings,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Backup creation failed: {e}",
        ) from e

    # Verify and inspect generated archive
    is_valid, _, manifest = verify_backup_bundle(archive_path)
    stat = archive_path.stat()

    # Record audit log
    ctx = build_audit_context(request, principal)
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
    for file_path in backup_dir.glob("kalyan_backup_*.tar.gz"):
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
    """Verify archive and execute safe restore with automatic pre-snapshot."""
    settings = get_settings()
    archive_path = settings.backup_dir / payload.archive_filename

    if not archive_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Backup archive not found: {payload.archive_filename}",
        )

    try:
        result = restore_backup(
            archive_path=archive_path,
            settings=settings,
            create_prerestore_snapshot=payload.create_prerestore_snapshot,
        )
    except BackupCorruptedError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Restoration failed: {e}",
        ) from e

    # Record audit log on new/restored database session
    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.BACKUP_RESTORED,
        entity_type="backup",
        entity_id=payload.archive_filename,
        after={
            "restored_archive": payload.archive_filename,
            "prerestore_snapshot": result.get("prerestore_snapshot"),
        },
        reason=payload.justification,
    )

    return RestoreResultOut(
        status=result["status"],
        archive_restored=result["archive_restored"],
        prerestore_snapshot=result.get("prerestore_snapshot"),
        database_restored=result["database_restored"],
        photos_restored_count=result["photos_restored_count"],
        manifest=result.get("manifest"),
    )


@router.get(
    "/integrity",
    response_model=IntegrityReportOut,
    summary="Run live clinical and financial integrity inspection (BAK-03)",
    dependencies=[Depends(require(Permission.INTEGRITY_RUN))],
)
def get_integrity_report(
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> IntegrityReportOut:
    """Run full diagnostic audit on database constraints, ledger balances, and files."""
    settings = get_settings()
    report = run_integrity_audit(session=session, settings=settings)

    # Record audit event
    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.INTEGRITY_CHECK_RUN,
        entity_type="system",
        entity_id="integrity_audit",
        after={
            "is_healthy": report.is_healthy,
            "total_checks": report.total_checks,
            "failed_checks": report.failed_checks,
        },
    )

    return IntegrityReportOut(
        generated_at=report.generated_at,
        is_healthy=report.is_healthy,
        total_checks=report.total_checks,
        passed_checks=report.passed_checks,
        failed_checks=report.failed_checks,
        checks=[
            IntegrityCheckItemOut(
                name=c.name,
                passed=c.passed,
                details=c.details,
                discrepancies=c.discrepancies,
            )
            for c in report.checks
        ],
    )
