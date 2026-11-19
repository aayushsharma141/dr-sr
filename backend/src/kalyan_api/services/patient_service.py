"""Patient registration shared by the registration form and new-patient check-in (OD-22-03).

Both paths allocate the permanent URN the same way, so a patient registered at the check-in
desk is indistinguishable from one registered on the full form. Callers write the audit rows.
"""

import re

from sqlalchemy.orm import Session

from kalyan_api.models import Patient
from kalyan_api.schemas.patients import PatientCreate
from kalyan_api.services.urn_service import allocate_next_urn


def clean_mobile(raw: str) -> str:
    """Normalize a mobile number to 10 digits."""
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("91") and len(digits) == 12:
        return digits[2:]
    return digits[-10:] if len(digits) >= 10 else digits


def create_patient(session: Session, payload: PatientCreate) -> Patient:
    """Register a patient with a newly allocated, permanent URN (PAT-01)."""
    patient = Patient(
        urn=allocate_next_urn(session),
        full_name=payload.full_name.strip(),
        guardian_name=payload.guardian_name.strip(),
        gender=payload.gender,
        dob=payload.dob,
        age_years=payload.age_years,
        mobile=clean_mobile(payload.mobile),
        address=payload.address.strip(),
        district=payload.district.strip(),
        state=payload.state.strip(),
        emergency_contact=payload.emergency_contact.strip() if payload.emergency_contact else None,
        alternate_mobile=(
            clean_mobile(payload.alternate_mobile) if payload.alternate_mobile else None
        ),
        email=payload.email.strip() if payload.email else None,
        blood_group=payload.blood_group,
        pin_code=payload.pin_code.strip() if payload.pin_code else None,
        guardian_relationship=(
            payload.guardian_relationship.strip() if payload.guardian_relationship else None
        ),
        medical_history_notes=(
            payload.medical_history_notes.strip() if payload.medical_history_notes else None
        ),
        allergies=payload.allergies.strip(),
        notes=payload.notes.strip() if payload.notes else None,
    )
    session.add(patient)
    session.flush()
    return patient


def registration_audit_after(patient: Patient) -> dict[str, object]:
    """The audit 'after' record of a registration, the same on every registration path."""
    return {
        "urn": patient.urn,
        "full_name": patient.full_name,
        "mobile": patient.mobile,
        "gender": patient.gender,
        "age_years": patient.age_years,
        "alternate_mobile": patient.alternate_mobile,
        "email": patient.email,
        "blood_group": patient.blood_group,
        "pin_code": patient.pin_code,
        "guardian_relationship": patient.guardian_relationship,
        "medical_history_notes": patient.medical_history_notes,
    }
