"""Patient registration and duplicate detection endpoints (PAT-01, PAT-04)."""

import re

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select

from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, build_audit_context, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import Patient
from kalyan_api.schemas.patients import (
    DuplicateCheckResponse,
    PatientCreate,
    PatientOut,
)
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.urn_service import allocate_next_urn

router = APIRouter(prefix="/patients", tags=["patients"])


def _clean_mobile(raw: str) -> str:
    """Normalize mobile to 10 digits."""
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("91") and len(digits) == 12:
        return digits[2:]
    return digits[-10:] if len(digits) >= 10 else digits


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
    name: str = Query(default=""),
    mobile: str = Query(default=""),
) -> DuplicateCheckResponse:
    """Non-blocking duplicate warning matching normalized name and mobile."""
    if not name or not mobile:
        return DuplicateCheckResponse(has_duplicate=False, matching_patient=None)

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
