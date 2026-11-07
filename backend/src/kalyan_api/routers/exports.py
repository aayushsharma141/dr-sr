"""Patient dataset export streaming endpoint (D-20-15 to D-20-20)."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from kalyan_api import clock
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.schemas.exports import PatientExportRequest
from kalyan_api.services import audit_service, export_service
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(prefix="/admin/exports", tags=["admin-exports"])


@router.post(
    "",
    dependencies=[Depends(require(Permission.PATIENT_EXPORT))],
)
def export_patients(
    payload: PatientExportRequest,
    session: SessionDep,
    request: Request,
    principal: Principal = Depends(current_principal),
) -> StreamingResponse:
    """Stream field-selective, formula-sanitized patient records in CSV or XLSX format."""
    rows, count = export_service.query_export_rows(session, payload.scope, payload.fields)

    # In-transaction permanent audit logging per D-20-17
    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.PATIENT_EXPORTED,
        entity_type="PATIENT_EXPORT",
        entity_id=None,
        after={
            "scope": payload.scope.model_dump(mode="json"),
            "fields": payload.fields,
            "row_count": count,
        },
        reason=payload.reason,
    )
    session.commit()

    timestamp = clock.utcnow().strftime("%Y%m%d_%H%M%S")

    if payload.format == "xlsx":
        filename = f"patients_export_{timestamp}.xlsx"
        generator = export_service.generate_xlsx_stream(rows, payload.fields)
        return StreamingResponse(
            generator,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )
    else:
        filename = f"patients_export_{timestamp}.csv"
        generator = export_service.generate_csv_stream(rows, payload.fields)
        return StreamingResponse(
            generator,
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )

