"""Patient registration, multi-modal search, demographics management,
and photo storage endpoints (PAT-01, PAT-02, PAT-03, PAT-04, PAT-05).
"""

import re
from email.parser import BytesParser
from email.policy import default

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select

from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
    get_current_settings,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.models import Patient
from kalyan_api.schemas.patients import (
    DuplicateCheckResponse,
    PatientCountResponse,
    PatientCreate,
    PatientOut,
    PatientUpdate,
)
from kalyan_api.services import audit_service, photo_service
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.urn_service import allocate_next_urn

router = APIRouter(prefix="/patients", tags=["patients"])


def _clean_mobile(raw: str) -> str:
    """Normalize mobile to 10 digits."""
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("91") and len(digits) == 12:
        return digits[2:]
    return digits[-10:] if len(digits) >= 10 else digits


async def _extract_photo_bytes(request: Request) -> bytes:
    """Extract raw image bytes from multipart/form-data or binary body."""
    content_type = request.headers.get("content-type", "")
    body = await request.body()
    if not body:
        raise ApiError(status_code=422, code="empty_file", message="Uploaded photo is empty.")

    if content_type.startswith("multipart/form-data"):
        header = f"Content-Type: {content_type}\r\n\r\n".encode("latin1")
        msg = BytesParser(policy=default).parsebytes(header + body)
        for part in msg.iter_parts():
            payload = part.get_payload(decode=True)
            if payload:
                return payload
        raise ApiError(
            status_code=422, code="empty_file", message="Uploaded multipart file is empty."
        )

    return body


@router.post(
    "",
    status_code=201,
    dependencies=[Depends(require(Permission.PATIENT_CREATE))],
    response_model=PatientOut,
)
def register_patient(
    request: Request,
    payload: PatientCreate,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PatientOut:
    """Register a new patient with 12 canonical demographic fields and atomic URN."""
    urn = allocate_next_urn(session)
    clean_phone = _clean_mobile(payload.mobile)

    patient = Patient(
        urn=urn,
        full_name=payload.full_name.strip(),
        guardian_name=payload.guardian_name.strip(),
        gender=payload.gender,
        dob=payload.dob,
        age_years=payload.age_years,
        mobile=clean_phone,
        address=payload.address.strip(),
        district=payload.district.strip(),
        state=payload.state.strip(),
        emergency_contact=payload.emergency_contact.strip() if payload.emergency_contact else None,
        allergies=payload.allergies.strip(),
        notes=payload.notes.strip() if payload.notes else None,
    )
    session.add(patient)
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.PATIENT_REGISTERED,
        "PATIENT",
        str(patient.id),
        after={
            "urn": patient.urn,
            "full_name": patient.full_name,
            "mobile": patient.mobile,
            "gender": patient.gender,
            "age_years": patient.age_years,
        },
    )

    return PatientOut.model_validate(patient)


@router.get(
    "/check-duplicate",
    dependencies=[Depends(require(Permission.PATIENT_READ))],
    response_model=DuplicateCheckResponse,
)
def check_duplicate_patient(
    session: SessionDep,
    name: str = Query(..., min_length=2),
    mobile: str = Query(..., min_length=5),
) -> DuplicateCheckResponse:
    """Non-blocking duplicate warning matching normalized name and mobile."""
    norm_name = " ".join(name.strip().lower().split())
    clean_phone = _clean_mobile(mobile)

    stmt = select(Patient).where(
        func.lower(func.trim(Patient.full_name)) == norm_name,
        Patient.mobile.like(f"%{clean_phone}"),
        Patient.is_active.is_(True),
    )
    match = session.scalar(stmt)
    if match:
        return DuplicateCheckResponse(
            has_duplicate=True,
            matching_patient=PatientOut.model_validate(match),
        )

    return DuplicateCheckResponse(has_duplicate=False, matching_patient=None)


def _patient_search_stmt(q: str | None):
    """Build the shared directory filter for URN, mobile, and name searches."""
    stmt = select(Patient)

    if q and q.strip():
        search_term = q.strip()
        digits = re.sub(r"\D", "", search_term)
        conditions = [
            Patient.urn.ilike(f"%{search_term}%"),
            Patient.full_name.ilike(f"%{search_term}%"),
            Patient.guardian_name.ilike(f"%{search_term}%"),
        ]
        if digits and len(digits) >= 3:
            conditions.append(Patient.mobile.like(f"%{digits}%"))

        stmt = stmt.where(or_(*conditions))

    return stmt


@router.get(
    "",
    dependencies=[Depends(require(Permission.PATIENT_READ))],
    response_model=list[PatientOut],
)
def list_or_search_patients(
    session: SessionDep,
    q: str | None = Query(default=None, description="Search query matching URN, mobile, or name."),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[PatientOut]:
    """Search patients across URN, 10-digit mobile, and English/Devanagari full name."""
    stmt = (
        _patient_search_stmt(q)
        .order_by(Patient.created_at.desc(), Patient.id.desc())
        .limit(limit)
        .offset(offset)
    )
    results = session.scalars(stmt).all()
    return [PatientOut.model_validate(p) for p in results]


@router.get(
    "/count",
    dependencies=[Depends(require(Permission.PATIENT_READ))],
    response_model=PatientCountResponse,
)
def count_patients(
    session: SessionDep,
    q: str | None = Query(default=None, description="Search query matching URN, mobile, or name."),
) -> PatientCountResponse:
    """Total patients matching the same search the directory list endpoint uses."""
    stmt = select(func.count()).select_from(_patient_search_stmt(q).subquery())
    return PatientCountResponse(total=session.scalar(stmt) or 0)


@router.get(
    "/{id}",
    dependencies=[Depends(require(Permission.PATIENT_READ))],
    response_model=PatientOut,
)
def get_patient_by_id(
    id: int,
    session: SessionDep,
) -> PatientOut:
    """Retrieve full patient demographic record by identifier."""
    patient = session.get(Patient, id)
    if not patient:
        raise ApiError(status_code=404, code="not_found", message=f"Patient #{id} not found")
    return PatientOut.model_validate(patient)


@router.patch(
    "/{id}",
    dependencies=[Depends(require(Permission.PATIENT_UPDATE))],
    response_model=PatientOut,
)
def update_patient_demographics(
    id: int,
    request: Request,
    payload: PatientUpdate,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PatientOut:
    """Update demographic fields with optimistic concurrency control (409 on version mismatch)."""
    patient = session.scalar(select(Patient).where(Patient.id == id).with_for_update())
    if not patient:
        raise ApiError(status_code=404, code="not_found", message=f"Patient #{id} not found")

    require_version(patient, payload.version_id, "patient")

    before_state = {
        "full_name": patient.full_name,
        "guardian_name": patient.guardian_name,
        "gender": patient.gender,
        "dob": str(patient.dob) if patient.dob else None,
        "age_years": patient.age_years,
        "mobile": patient.mobile,
        "address": patient.address,
        "district": patient.district,
        "state": patient.state,
        "emergency_contact": patient.emergency_contact,
        "allergies": patient.allergies,
        "notes": patient.notes,
        "is_active": patient.is_active,
        "version_id": patient.version_id,
    }

    if payload.full_name is not None:
        patient.full_name = payload.full_name.strip()
    if payload.guardian_name is not None:
        patient.guardian_name = payload.guardian_name.strip()
    if payload.gender is not None:
        patient.gender = payload.gender
    if payload.dob is not None:
        patient.dob = payload.dob
    if payload.age_years is not None:
        patient.age_years = payload.age_years
    if payload.mobile is not None:
        patient.mobile = _clean_mobile(payload.mobile)
    if payload.address is not None:
        patient.address = payload.address.strip()
    if payload.district is not None:
        patient.district = payload.district.strip()
    if payload.state is not None:
        patient.state = payload.state.strip()
    if payload.emergency_contact is not None:
        patient.emergency_contact = (
            payload.emergency_contact.strip() if payload.emergency_contact else None
        )
    if payload.allergies is not None:
        patient.allergies = payload.allergies.strip()
    if payload.notes is not None:
        patient.notes = payload.notes.strip() if payload.notes else None
    if payload.is_active is not None:
        patient.is_active = payload.is_active

    session.flush()

    after_state = {
        "full_name": patient.full_name,
        "guardian_name": patient.guardian_name,
        "gender": patient.gender,
        "dob": str(patient.dob) if patient.dob else None,
        "age_years": patient.age_years,
        "mobile": patient.mobile,
        "address": patient.address,
        "district": patient.district,
        "state": patient.state,
        "emergency_contact": patient.emergency_contact,
        "allergies": patient.allergies,
        "notes": patient.notes,
        "is_active": patient.is_active,
        "version_id": patient.version_id,
    }

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.PATIENT_UPDATED,
        "PATIENT",
        str(patient.id),
        before=before_state,
        after=after_state,
    )

    return PatientOut.model_validate(patient)


@router.post(
    "/{id}/photo",
    dependencies=[Depends(require(Permission.PHOTO_WRITE))],
    response_model=PatientOut,
)
async def upload_patient_photo(
    id: int,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PatientOut:
    """Accept JPEG/PNG photo upload up to 5 MB and link to patient record."""
    patient = session.scalar(select(Patient).where(Patient.id == id).with_for_update())
    if not patient:
        raise ApiError(status_code=404, code="not_found", message=f"Patient #{id} not found")

    file_bytes = await _extract_photo_bytes(request)
    settings = get_current_settings(request)
    photos_dir = settings.photos_dir

    old_photo = patient.photo_path
    new_filename = photo_service.save_photo(file_bytes, photos_dir)
    patient.photo_path = new_filename
    session.flush()

    if old_photo:
        photo_service.delete_photo(old_photo, photos_dir)

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.PHOTO_UPLOADED,
        "PATIENT",
        str(patient.id),
        after={"photo_path": new_filename, "size_bytes": len(file_bytes)},
    )

    return PatientOut.model_validate(patient)


@router.get(
    "/{id}/photo",
    dependencies=[Depends(require(Permission.PHOTO_READ))],
)
def get_patient_photo(
    id: int,
    request: Request,
    session: SessionDep,
) -> FileResponse:
    """Stream patient photo strictly to authenticated authorized sessions."""
    patient = session.get(Patient, id)
    if not patient:
        raise ApiError(status_code=404, code="not_found", message=f"Patient #{id} not found")
    if not patient.photo_path:
        raise ApiError(
            status_code=404, code="no_photo", message=f"Patient #{id} has no photo on file"
        )

    settings = get_current_settings(request)
    photos_dir = settings.photos_dir

    path = photo_service.get_photo_path(patient.photo_path, photos_dir)
    if not path.is_file():
        raise ApiError(
            status_code=404, code="photo_missing", message="Photo file not found on disk"
        )

    media_type = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    return FileResponse(
        path=str(path),
        media_type=media_type,
        headers={"Cache-Control": "private, no-cache"},
    )
