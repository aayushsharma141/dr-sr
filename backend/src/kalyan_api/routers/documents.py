"""Patient documents API — secure upload, role-scoped listing, streaming download, and soft-archive.

Routes (mounted under /api in main.py):
- POST /api/patients/{patient_id}/documents   (DOCUMENT_WRITE: RECEPTION, DOCTOR)
- GET  /api/patients/{patient_id}/documents   (DOCUMENT_READ: ADMIN, RECEPTION, DOCTOR)
- GET  /api/documents/{document_id}/download  (DOCUMENT_READ: ADMIN, RECEPTION, DOCTOR)
- POST /api/documents/{document_id}/archive   (DOCUMENT_WRITE: RECEPTION, DOCTOR)

Guarantees:
- D-04: Reception cannot upload clinical categories, set is_clinical=True, or link encounter_id;
  Admin and Reception never see or download is_clinical=True documents (403 on download/archive).
- DWS-04: Cross-doctor clinical list reads and downloads record CROSS_DOCTOR_CLINICAL_READ.
- D-03: Doctor clinical archival is own-author-only (404 on mismatch to prevent existence leaks).
- Archived documents remain on disk immutably (soft-archive only).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import false, select

from kalyan_api import clock
from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission, Role
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
    get_current_settings,
)
from kalyan_api.core.scope import (
    ScopeFamily,
    audit_cross_doctor_list_read,
    get_scoped_or_404,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.models import (
    ClinicalEncounter,
    Patient,
    PatientDocument,
    User,
    Visit,
)
from kalyan_api.schemas.documents import PatientDocumentOut
from kalyan_api.services import audit_service, document_service
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.code_sequence_service import (
    effective_patient_ids,
    require_active_unmerged_patient,
)
from kalyan_api.services.document_service import (
    CLINICAL_DOCUMENT_CATEGORIES,
    VALID_DOCUMENT_CATEGORIES,
)

router = APIRouter(tags=["documents"])


def _require_doctor_id(principal: Principal) -> int:
    """Ensure a DOCTOR principal has a linked doctor profile."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(status_code=403, code="doctor_only", message="Doctor access required.")
    return principal.doctor_id


def _document_to_out(
    doc: PatientDocument,
    *,
    uploaded_by_username: str | None = None,
    visit_code: str | None = None,
    encounter_code: str | None = None,
) -> PatientDocumentOut:
    """Serialize a PatientDocument row with resolved display fields."""
    return PatientDocumentOut(
        id=doc.id,
        patient_id=doc.patient_id,
        visit_id=doc.visit_id,
        visit_code=visit_code,
        encounter_id=doc.encounter_id,
        encounter_code=encounter_code,
        title=doc.title,
        category=doc.category,
        is_clinical=doc.is_clinical,
        original_filename=doc.original_filename,
        mime_type=doc.mime_type,
        file_size_bytes=doc.file_size_bytes,
        sha256_hex=doc.sha256_hex,
        notes=doc.notes,
        uploaded_by_user_id=doc.uploaded_by_user_id,
        uploaded_by_username=uploaded_by_username,
        doctor_id=doc.doctor_id,
        is_archived=doc.is_archived,
        archived_at=doc.archived_at,
        archived_by_user_id=doc.archived_by_user_id,
        created_at=doc.created_at,
    )


@router.post(
    "/patients/{patient_id}/documents",
    status_code=201,
    response_model=PatientDocumentOut,
    dependencies=[Depends(require(Permission.DOCUMENT_WRITE))],
)
async def upload_patient_document(
    patient_id: int,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
    file: UploadFile = File(...),
    title: str = Form(...),
    category: str = Form(...),
    is_clinical: bool = Form(False),
    visit_id: int | None = Form(None),
    encounter_id: int | None = Form(None),
    notes: str | None = Form(None),
) -> PatientDocumentOut:
    """Upload and validate a patient document (PDF/JPEG/PNG up to 10 MB)."""
    require_active_unmerged_patient(session, patient_id)

    clean_title = title.strip()
    if not clean_title or len(clean_title) > 160:
        raise ApiError(
            status_code=422,
            code="invalid_title",
            message="Document title must be between 1 and 160 characters.",
        )

    clean_category = category.strip()
    if clean_category not in VALID_DOCUMENT_CATEGORIES:
        raise ApiError(
            status_code=422,
            code="invalid_category",
            message=(
                f"Invalid document category '{clean_category}'. "
                f"Allowed: {', '.join(sorted(VALID_DOCUMENT_CATEGORIES))}."
            ),
        )

    clean_notes = notes.strip() if isinstance(notes, str) and notes.strip() else None

    # D-04 clinical classification & role boundary enforcement
    if principal.role == Role.RECEPTION:
        if (
            clean_category in CLINICAL_DOCUMENT_CATEGORIES
            or is_clinical is True
            or encounter_id is not None
        ):
            raise ApiError(
                status_code=403,
                code="forbidden",
                message="Reception cannot upload clinical documents or link clinical encounters.",
            )
        effective_is_clinical = False
        doctor_id: int | None = None
    elif principal.role == Role.DOCTOR:
        doctor_id = _require_doctor_id(principal)
        effective_is_clinical = (
            True if clean_category in CLINICAL_DOCUMENT_CATEGORIES else bool(is_clinical)
        )
    else:
        raise ApiError(status_code=403, code="forbidden", message="Access denied.")

    # Validate optional visit link belongs to this patient
    visit_code: str | None = None
    if visit_id is not None:
        visit = session.get(Visit, visit_id)
        if visit is None or visit.patient_id != patient_id:
            raise ApiError(
                status_code=404,
                code="visit_not_found",
                message="Visit not found for this patient.",
            )
        visit_code = visit.visit_code

    # Validate optional encounter link (DOCTOR only; own-author CLINICAL_WRITE + patient match)
    encounter_code: str | None = None
    if encounter_id is not None:
        enc = get_scoped_or_404(
            session,
            ClinicalEncounter,
            encounter_id,
            principal,
            family=ScopeFamily.CLINICAL_WRITE,
            doctor_id_col=ClinicalEncounter.doctor_id,
        )
        if enc.patient_id != patient_id:
            raise ApiError(
                status_code=404,
                code="not_found",
                message="Resource not found",
            )
        if visit_id is not None and enc.visit_id is not None and enc.visit_id != visit_id:
            raise ApiError(
                status_code=422,
                code="visit_encounter_mismatch",
                message="Encounter does not belong to the specified visit.",
            )
        encounter_code = enc.encounter_code

    settings = get_current_settings(request)
    stored = await document_service.save_uploaded_document(file, settings.documents_dir)

    safe_original = document_service.sanitize_download_filename(
        file.filename, fallback=stored.stored_filename
    )[:255]

    doc = PatientDocument(
        patient_id=patient_id,
        visit_id=visit_id,
        encounter_id=encounter_id,
        title=clean_title,
        category=clean_category,
        is_clinical=effective_is_clinical,
        original_filename=safe_original,
        stored_filename=stored.stored_filename,
        mime_type=stored.mime_type,
        file_size_bytes=stored.file_size_bytes,
        sha256_hex=stored.sha256_hex,
        notes=clean_notes,
        uploaded_by_user_id=principal.user_id,
        doctor_id=doctor_id,
        is_archived=False,
    )
    try:
        session.add(doc)
        session.flush()

        ctx = build_audit_context(request, principal)
        audit_service.record(
            session,
            ctx,
            AuditAction.DOCUMENT_UPLOADED,
            "PATIENT_DOCUMENT",
            str(doc.id),
            after={
                "patient_id": doc.patient_id,
                "visit_id": doc.visit_id,
                "encounter_id": doc.encounter_id,
                "title": doc.title,
                "category": doc.category,
                "is_clinical": doc.is_clinical,
                "original_filename": doc.original_filename,
                "mime_type": doc.mime_type,
                "file_size_bytes": doc.file_size_bytes,
                "sha256_hex": doc.sha256_hex,
                "doctor_id": doc.doctor_id,
            },
        )
    except Exception:
        document_service.delete_document_file(stored.stored_filename, settings.documents_dir)
        raise

    return _document_to_out(
        doc,
        uploaded_by_username=principal.username,
        visit_code=visit_code,
        encounter_code=encounter_code,
    )


@router.get(
    "/patients/{patient_id}/documents",
    response_model=list[PatientDocumentOut],
    dependencies=[Depends(require(Permission.DOCUMENT_READ))],
)
def list_patient_documents(
    patient_id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
    include_archived: bool = Query(False),
) -> list[PatientDocumentOut]:
    """List documents for a patient (archived/merged readable, role-filtered per D-04/DWS-04)."""
    patient = session.get(Patient, patient_id)
    if patient is None:
        raise ApiError(
            status_code=404,
            code="patient_not_found",
            message=f"Patient #{patient_id} not found",
        )

    patient_ids = effective_patient_ids(session, patient_id)

    stmt = (
        select(
            PatientDocument,
            User.username,
            Visit.visit_code,
            ClinicalEncounter.encounter_code,
        )
        .outerjoin(User, User.id == PatientDocument.uploaded_by_user_id)
        .outerjoin(Visit, Visit.id == PatientDocument.visit_id)
        .outerjoin(ClinicalEncounter, ClinicalEncounter.id == PatientDocument.encounter_id)
        .where(PatientDocument.patient_id.in_(patient_ids))
    )

    if not include_archived:
        stmt = stmt.where(PatientDocument.is_archived.is_(False))

    if principal.role in (Role.ADMIN, Role.RECEPTION):
        stmt = stmt.where(PatientDocument.is_clinical.is_(False))
    elif principal.role == Role.DOCTOR:
        _require_doctor_id(principal)
    else:
        stmt = stmt.where(false())

    stmt = stmt.order_by(PatientDocument.created_at.desc(), PatientDocument.id.desc())
    rows = session.execute(stmt).all()

    if principal.role == Role.DOCTOR:
        clinical_docs = [doc for doc, _, _, _ in rows if doc.is_clinical]
        audit_cross_doctor_list_read(
            session, principal, patient_id, "patient_documents_list", clinical_docs
        )

    return [
        _document_to_out(
            doc,
            uploaded_by_username=username,
            visit_code=visit_code,
            encounter_code=encounter_code,
        )
        for doc, username, visit_code, encounter_code in rows
    ]


@router.get(
    "/documents/{document_id}/download",
    dependencies=[Depends(require(Permission.DOCUMENT_READ))],
)
def download_patient_document(
    document_id: int,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> FileResponse:
    """Stream a stored document with D-04/DWS-04 enforcement, safe path resolution, and audit."""
    doc = session.get(PatientDocument, document_id)
    if doc is None:
        raise ApiError(
            status_code=404,
            code="document_not_found",
            message="Document not found.",
        )

    if principal.role in (Role.ADMIN, Role.RECEPTION):
        if doc.is_clinical:
            raise ApiError(
                status_code=403,
                code="forbidden",
                message="Clinical documents are restricted to doctors.",
            )
    elif principal.role == Role.DOCTOR:
        _require_doctor_id(principal)
    else:
        raise ApiError(status_code=403, code="forbidden", message="Access denied.")

    settings = get_current_settings(request)
    path = document_service.resolve_document_path(doc.stored_filename, settings.documents_dir)
    if not path.is_file():
        raise ApiError(
            status_code=404,
            code="document_file_missing",
            message="Document file not found on disk.",
        )

    ctx = build_audit_context(request, principal)

    if (
        doc.is_clinical
        and principal.role == Role.DOCTOR
        and principal.doctor_id is not None
        and doc.doctor_id is not None
        and doc.doctor_id != principal.doctor_id
    ):
        audit_service.record(
            session,
            ctx,
            AuditAction.CROSS_DOCTOR_CLINICAL_READ,
            "PATIENT_DOCUMENT",
            str(doc.id),
            after={
                "source": "document_download",
                "actor_doctor_id": principal.doctor_id,
                "record_doctor_id": doc.doctor_id,
                "patient_id": doc.patient_id,
            },
        )

    audit_service.record(
        session,
        ctx,
        AuditAction.DOCUMENT_DOWNLOADED,
        "PATIENT_DOCUMENT",
        str(doc.id),
        after={
            "patient_id": doc.patient_id,
            "title": doc.title,
            "category": doc.category,
            "is_clinical": doc.is_clinical,
            "original_filename": doc.original_filename,
        },
    )

    safe_name = document_service.sanitize_download_filename(
        doc.original_filename, fallback=doc.stored_filename
    )
    return FileResponse(
        path=str(path),
        media_type=doc.mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post(
    "/documents/{document_id}/archive",
    response_model=PatientDocumentOut,
    dependencies=[Depends(require(Permission.DOCUMENT_WRITE))],
)
def archive_patient_document(
    document_id: int,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PatientDocumentOut:
    """Soft-archive a document without removing bytes from disk."""
    doc = session.execute(
        select(PatientDocument).where(PatientDocument.id == document_id).with_for_update()
    ).scalar_one_or_none()
    if doc is None:
        raise ApiError(
            status_code=404,
            code="document_not_found",
            message="Document not found.",
        )

    if principal.role == Role.RECEPTION:
        if doc.is_clinical:
            raise ApiError(
                status_code=403,
                code="forbidden",
                message="Reception cannot archive clinical documents.",
            )
    elif principal.role == Role.DOCTOR:
        doctor_id = _require_doctor_id(principal)
        if doc.is_clinical:
            is_owner = (
                doc.doctor_id == doctor_id or doc.uploaded_by_user_id == principal.user_id
            )
            if not is_owner:
                raise ApiError(
                    status_code=404,
                    code="not_found",
                    message="Resource not found",
                )
    else:
        raise ApiError(status_code=403, code="forbidden", message="Access denied.")

    before = {
        "is_archived": doc.is_archived,
        "archived_at": doc.archived_at.isoformat() if doc.archived_at else None,
        "archived_by_user_id": doc.archived_by_user_id,
    }
    doc.is_archived = True
    doc.archived_at = clock.utcnow()
    doc.archived_by_user_id = principal.user_id
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.DOCUMENT_ARCHIVED,
        "PATIENT_DOCUMENT",
        str(doc.id),
        before=before,
        after={
            "patient_id": doc.patient_id,
            "is_archived": doc.is_archived,
            "archived_at": doc.archived_at.isoformat() if doc.archived_at else None,
            "archived_by_user_id": doc.archived_by_user_id,
        },
    )

    row = session.execute(
        select(User.username, Visit.visit_code, ClinicalEncounter.encounter_code)
        .select_from(PatientDocument)
        .outerjoin(User, User.id == PatientDocument.uploaded_by_user_id)
        .outerjoin(Visit, Visit.id == PatientDocument.visit_id)
        .outerjoin(ClinicalEncounter, ClinicalEncounter.id == PatientDocument.encounter_id)
        .where(PatientDocument.id == doc.id)
    ).one()
    username, visit_code, encounter_code = row

    return _document_to_out(
        doc,
        uploaded_by_username=username,
        visit_code=visit_code,
        encounter_code=encounter_code,
    )
