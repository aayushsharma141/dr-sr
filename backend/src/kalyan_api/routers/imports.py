"""Patient import staging and execution endpoints (D-20-08 to D-20-14)."""

import json
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from sqlalchemy import select

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.models import Patient, PatientImportBatch, PatientImportRow
from kalyan_api.schemas.imports import (
    BatchSummaryResponse,
    CommitBatchResponse,
    DuplicateCandidatePatient,
    DuplicateListResponse,
    DuplicateRowItem,
    InspectFileResponse,
    ResolveDuplicatesRequest,
    ValidationSummaryResponse,
)
from kalyan_api.services import audit_service, import_service
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.import_service import (
    BatchNotFoundError,
    BatchStateError,
    ImportServiceError,
    PreCommitBackupFailedError,
)

router = APIRouter(prefix="/admin/imports", tags=["admin-imports"])


@router.post(
    "/inspect",
    dependencies=[Depends(require(Permission.PATIENT_IMPORT))],
    response_model=InspectFileResponse,
)
async def inspect_import_file(
    file: UploadFile = File(...),
) -> InspectFileResponse:
    """Analyze uploaded spreadsheet file structure, detect encoding, and preview headers."""
    file_bytes = await file.read()
    try:
        result = import_service.inspect_file(file_bytes, file.filename or "unknown.csv")
    except ImportServiceError as exc:
        raise ApiError(status_code=400, code="unparseable_file", message=str(exc)) from exc
    return InspectFileResponse(**result)


@router.post(
    "",
    dependencies=[Depends(require(Permission.PATIENT_IMPORT))],
    response_model=BatchSummaryResponse,
    status_code=201,
)
async def stage_import_batch(
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
    file: UploadFile = File(...),
    column_mapping: str = Form(...),
) -> BatchSummaryResponse:
    """Stage raw spreadsheet rows into staging table and record PATIENT_IMPORT_STAGED."""
    try:
        mapping_dict = json.loads(column_mapping)
        if not isinstance(mapping_dict, dict):
            raise ValueError("column_mapping must be a JSON object")
    except Exception as exc:
        raise ApiError(status_code=422, code="invalid_mapping", message=f"Invalid column mapping JSON: {exc}") from exc

    file_bytes = await file.read()
    try:
        batch = import_service.stage_batch(
            session=session,
            user_id=principal.user_id,
            filename=file.filename or "import.csv",
            file_bytes=file_bytes,
            column_mapping=mapping_dict,
        )
    except ImportServiceError as exc:
        raise ApiError(status_code=400, code="staging_failed", message=str(exc)) from exc

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.PATIENT_IMPORT_STAGED,
        entity_type="IMPORT_BATCH",
        entity_id=batch.batch_id,
        after={
            "filename": batch.filename,
            "total_rows": batch.total_rows,
        },
    )

    return BatchSummaryResponse.model_validate(batch)


@router.get(
    "/{batch_id}",
    dependencies=[Depends(require(Permission.PATIENT_IMPORT))],
    response_model=BatchSummaryResponse,
)
def get_import_batch(
    session: SessionDep,
    batch_id: str,
) -> BatchSummaryResponse:
    """Get metadata, row metrics, and staging status for an import batch."""
    batch = session.scalar(
        select(PatientImportBatch).where(PatientImportBatch.batch_id == batch_id)
    )
    if not batch:
        raise ApiError(status_code=404, code="batch_not_found", message=f"Import batch {batch_id} not found")
    return BatchSummaryResponse.model_validate(batch)


@router.post(
    "/{batch_id}/validate",
    dependencies=[Depends(require(Permission.PATIENT_IMPORT))],
    response_model=ValidationSummaryResponse,
)
def validate_import_batch(
    session: SessionDep,
    batch_id: str,
) -> ValidationSummaryResponse:
    """Execute row validation, enforce required fields, and flag duplicate candidates."""
    try:
        summary = import_service.validate_batch(session, batch_id)
    except BatchNotFoundError as exc:
        raise ApiError(status_code=404, code="batch_not_found", message=str(exc)) from exc
    except BatchStateError as exc:
        raise ApiError(status_code=409, code="batch_already_committed", message=str(exc)) from exc
    except ImportServiceError as exc:
        raise ApiError(status_code=400, code="validation_failed", message=str(exc)) from exc

    return ValidationSummaryResponse(**summary)


@router.get(
    "/{batch_id}/duplicates",
    dependencies=[Depends(require(Permission.PATIENT_IMPORT))],
    response_model=DuplicateListResponse,
)
def get_duplicate_candidates(
    session: SessionDep,
    batch_id: str,
) -> DuplicateListResponse:
    """Retrieve duplicate candidate rows alongside existing patient records for side-by-side review."""
    batch = session.scalar(select(PatientImportBatch).where(PatientImportBatch.batch_id == batch_id))
    if not batch:
        raise ApiError(status_code=404, code="batch_not_found", message=f"Import batch {batch_id} not found")

    rows = session.scalars(
        select(PatientImportRow)
        .where(
            PatientImportRow.batch_id == batch_id,
            PatientImportRow.validation_status == "DUPLICATE",
        )
        .order_by(PatientImportRow.row_index.asc())
    ).all()

    items: list[DuplicateRowItem] = []
    for r in rows:
        dup_patient_item: DuplicateCandidatePatient | None = None
        if r.duplicate_patient_id:
            cand = session.scalar(select(Patient).where(Patient.id == r.duplicate_patient_id))
            if cand:
                dup_patient_item = DuplicateCandidatePatient.model_validate(cand)

        items.append(
            DuplicateRowItem(
                row_id=r.id,
                row_index=r.row_index,
                mapped_data=r.mapped_data or {},
                duplicate_patient_id=r.duplicate_patient_id,
                duplicate_patient=dup_patient_item,
                duplicate_resolution=r.duplicate_resolution,
                validation_errors=r.validation_errors,
            )
        )

    return DuplicateListResponse(batch_id=batch_id, duplicates=items)


@router.post(
    "/{batch_id}/resolve",
    dependencies=[Depends(require(Permission.PATIENT_IMPORT))],
)
def resolve_duplicates(
    session: SessionDep,
    batch_id: str,
    payload: ResolveDuplicatesRequest,
) -> dict[str, Any]:
    """Record explicit duplicate resolution decisions ('SKIP' or 'IMPORT_AS_NEW')."""
    batch = session.scalar(select(PatientImportBatch).where(PatientImportBatch.batch_id == batch_id))
    if not batch:
        raise ApiError(status_code=404, code="batch_not_found", message=f"Import batch {batch_id} not found")

    for item in payload.resolutions:
        try:
            import_service.resolve_duplicate(session, batch_id, item.row_id, item.resolution)
        except ImportServiceError as exc:
            raise ApiError(status_code=400, code="resolution_failed", message=str(exc)) from exc

    return {"status": "SUCCESS", "resolved_count": len(payload.resolutions)}


@router.post(
    "/{batch_id}/commit",
    dependencies=[Depends(require(Permission.PATIENT_IMPORT))],
    response_model=CommitBatchResponse,
)
def commit_import_batch(
    request: Request,
    session: SessionDep,
    batch_id: str,
    principal: Principal = Depends(current_principal),
) -> CommitBatchResponse:
    """Run pre-commit safety backup, mint gap-free URNs, insert patients, and record audit event."""
    try:
        result = import_service.commit_batch(session, principal.user_id, batch_id)
    except BatchNotFoundError as exc:
        raise ApiError(status_code=404, code="batch_not_found", message=str(exc)) from exc
    except BatchStateError as exc:
        raise ApiError(status_code=409, code="batch_already_committed", message=str(exc)) from exc
    except PreCommitBackupFailedError as exc:
        # Pre-commit safety backup gate aborted commit (D-20-12)
        raise ApiError(
            status_code=500,
            code="precommit_backup_failed",
            message=f"Import commit aborted because pre-import safety backup failed: {exc}",
        ) from exc
    except Exception as exc:
        raise ApiError(status_code=500, code="commit_failed", message=f"Commit failed: {exc}") from exc

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.PATIENT_IMPORT_COMMITTED,
        entity_type="IMPORT_BATCH",
        entity_id=batch_id,
        after={
            "committed_count": result["committed_rows"],
            "safety_backup": result["safety_backup_file"],
            "urn_range_start": result["urn_range_start"],
            "urn_range_end": result["urn_range_end"],
        },
    )

    return CommitBatchResponse(**result)


@router.get(
    "/{batch_id}/errors",
    dependencies=[Depends(require(Permission.PATIENT_IMPORT))],
)
def export_error_records(
    session: SessionDep,
    batch_id: str,
) -> Response:
    """Export CSV of invalid or skipped rows for offline administrative review."""
    try:
        csv_data = import_service.export_error_records_csv(session, batch_id)
    except BatchNotFoundError as exc:
        raise ApiError(status_code=404, code="batch_not_found", message=str(exc)) from exc

    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="import_errors_{batch_id[:8]}.csv"',
        },
    )

