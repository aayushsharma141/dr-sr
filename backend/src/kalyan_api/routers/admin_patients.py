"""Admin patient management, demographic correction, and search (D-20-02, D-20-03, D-20-04)."""

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import or_, select

from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.models import Patient
from kalyan_api.schemas.patients import (
    AdminPatientDemographicCorrection,
    PatientOut,
)
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(prefix="/admin/patients", tags=["admin-patients"])

DEMOGRAPHIC_FIELDS = (
    "full_name",
    "guardian_name",
    "gender",
    "dob",
    "age_years",
    "mobile",
    "address",
    "district",
    "state",
    "emergency_contact",
)


@router.get(
    "/search",
    dependencies=[Depends(require(Permission.PATIENT_CORRECT))],
    response_model=list[PatientOut],
)
def search_patients_for_correction(
    session: SessionDep,
    q: str = Query(..., min_length=1, max_length=100, description="Search term for patient lookup"),
    limit: int = Query(50, ge=1, le=100),
) -> list[PatientOut]:
    """Server-side patient search matching URN, legacy URN, full name, or mobile for correction."""
    q_clean = q.strip()
    digits = "".join(c for c in q_clean if c.isdigit())

    conditions = [
        Patient.urn.ilike(f"%{q_clean}%"),
        Patient.full_name.ilike(f"%{q_clean}%"),
        Patient.legacy_urn.ilike(f"%{q_clean}%"),
    ]
    if digits and len(digits) >= 3:
        conditions.append(Patient.mobile.like(f"%{digits}%"))

    stmt = (
        select(Patient)
        .where(or_(*conditions))
        .order_by(Patient.created_at.desc(), Patient.id.desc())
        .limit(limit)
    )
    patients = session.scalars(stmt).all()
    return [PatientOut.model_validate(p) for p in patients]


@router.patch(
    "/{id}/demographics",
    dependencies=[Depends(require(Permission.PATIENT_CORRECT))],
    response_model=PatientOut,
)
def correct_patient_demographics(
    id: int,
    request: Request,
    payload: AdminPatientDemographicCorrection,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PatientOut:
    """Administratively correct patient demographics with optimistic concurrency and permanent audit log."""  # noqa: E501 - published as the OpenAPI description; wrapping changes the text
    patient = session.scalar(select(Patient).where(Patient.id == id).with_for_update())
    if not patient:
        raise ApiError(
            status_code=404, code="patient_not_found", message=f"Patient #{id} not found"
        )

    require_version(patient, payload.version_id, "patient")

    before_state = {
        field: getattr(patient, field).isoformat()
        if hasattr(getattr(patient, field), "isoformat")
        else getattr(patient, field)
        for field in DEMOGRAPHIC_FIELDS
    }

    patient.full_name = payload.full_name.strip()
    patient.guardian_name = payload.guardian_name.strip()
    patient.gender = payload.gender
    patient.dob = payload.dob
    patient.age_years = payload.age_years
    patient.mobile = payload.mobile.strip()
    patient.address = payload.address.strip()
    patient.district = payload.district.strip()
    patient.state = payload.state.strip()
    patient.emergency_contact = (
        payload.emergency_contact.strip() if payload.emergency_contact else None
    )

    session.flush()

    after_state = {
        field: getattr(patient, field).isoformat()
        if hasattr(getattr(patient, field), "isoformat")
        else getattr(patient, field)
        for field in DEMOGRAPHIC_FIELDS
    }

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.PATIENT_CORRECTED,
        "PATIENT",
        str(patient.id),
        before=before_state,
        after=after_state,
        reason=payload.reason,
    )

    return PatientOut.model_validate(patient)
