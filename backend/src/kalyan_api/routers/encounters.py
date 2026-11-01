"""Clinical encounter recording, note finalisation, and addenda endpoints (CLN-01, CLN-02).

Guarantees:
- D-03: Doctor silo; encounters strictly scoped to owning doctor.
- D-04: Reception default-deny (HTTP 403 Forbidden).
- Defense-in-depth immutability: finalised notes cannot be edited or deleted (HTTP 400).
- Modifications to finalised encounters must be appended as dated addenda.
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select

from kalyan_api import clock
from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.permissions import Permission, Role
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    ClinicalAddendum,
    ClinicalEncounter,
    Patient,
)
from kalyan_api.schemas.encounters import (
    AddendumCreate,
    AddendumRead,
    EncounterCreate,
    EncounterRead,
    EncounterSummary,
    EncounterUpdate,
)
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(tags=["encounters"])


def _to_read_schema(enc: ClinicalEncounter) -> EncounterRead:
    """Format ClinicalEncounter to read schema including addenda."""
    addenda_list = [
        AddendumRead(
            id=a.id,
            encounter_id=a.encounter_id,
            doctor_id=a.doctor_id,
            doctor_name=a.doctor.name_en if a.doctor else "",
            addendum_text=a.addendum_text,
            created_at=a.created_at,
        )
        for a in enc.addenda
    ]

    return EncounterRead(
        id=enc.id,
        patient_id=enc.patient_id,
        patient_urn=enc.patient.urn,
        patient_name=enc.patient.full_name,
        doctor_id=enc.doctor_id,
        doctor_name=enc.doctor.name_en if enc.doctor else "",
        appointment_id=enc.appointment_id,
        encounter_date=enc.encounter_date,
        symptoms=enc.symptoms,
        clinical_notes=enc.clinical_notes,
        diagnosis=enc.diagnosis,
        is_finalised=enc.is_finalised,
        finalised_at=enc.finalised_at,
        version_id=enc.version_id,
        created_at=enc.created_at,
        updated_at=enc.updated_at,
        addenda=addenda_list,
    )


@router.post(
    "/encounters",
    response_model=EncounterRead,
    status_code=201,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def create_encounter(
    payload: EncounterCreate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> EncounterRead:
    """Record a new clinical encounter note for a patient (CLN-01)."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(
            status_code=403,
            code="doctor_only",
            message="Only authenticated doctors can record clinical encounters.",
        )

    patient = session.get(Patient, payload.patient_id)
    if not patient or not patient.is_active:
        raise ApiError(status_code=404, code="patient_not_found", message="Patient not found.")

    # Validate and link appointment if provided
    appt: Appointment | None = None
    if payload.appointment_id is not None:
        appt = session.get(Appointment, payload.appointment_id)
        if not appt or appt.doctor_id != principal.doctor_id:
            raise ApiError(
                status_code=404,
                code="appointment_not_found",
                message="Appointment not found or not assigned to this doctor.",
            )
        # Advance appointment status to IN_CONSULTATION if not already there
        if appt.status in (AppointmentStatus.BOOKED.value, AppointmentStatus.ARRIVED.value):
            appt.status = AppointmentStatus.IN_CONSULTATION.value
            appt.status_updated_at = clock.utcnow()
            appt.version_id += 1

    enc = ClinicalEncounter(
        appointment_id=payload.appointment_id,
        patient_id=payload.patient_id,
        doctor_id=principal.doctor_id,
        symptoms=payload.symptoms,
        clinical_notes=payload.clinical_notes,
        diagnosis=payload.diagnosis,
        created_by_user_id=principal.user_id,
    )
    session.add(enc)
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.ENCOUNTER_CREATED,
        entity_type="clinical_encounter",
        entity_id=enc.id,
        after={
            "patient_id": enc.patient_id,
            "patient_urn": patient.urn,
            "doctor_id": enc.doctor_id,
            "appointment_id": enc.appointment_id,
            "diagnosis": enc.diagnosis,
            "is_finalised": enc.is_finalised,
        },
    )

    return _to_read_schema(enc)


@router.get(
    "/encounters/{id}",
    response_model=EncounterRead,
    dependencies=[Depends(require(Permission.ENCOUNTER_READ))],
)
def get_encounter(
    id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> EncounterRead:
    """Retrieve encounter details including addenda (CLN-01). Scoped to doctor silo (D-03)."""
    enc = session.get(ClinicalEncounter, id)
    if not enc or enc.doctor_id != principal.doctor_id:
        raise ApiError(
            status_code=404,
            code="encounter_not_found",
            message="Clinical encounter not found.",
        )

    return _to_read_schema(enc)


@router.get(
    "/patients/{patient_id}/encounters",
    response_model=list[EncounterSummary],
    dependencies=[Depends(require(Permission.ENCOUNTER_READ))],
)
def list_patient_encounters(
    patient_id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> list[EncounterSummary]:
    """List historical encounters for a patient scoped to the authenticated doctor (D-03)."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(status_code=403, code="doctor_only", message="Doctor access required.")

    stmt = (
        select(ClinicalEncounter)
        .where(
            ClinicalEncounter.patient_id == patient_id,
            ClinicalEncounter.doctor_id == principal.doctor_id,
        )
        .order_by(ClinicalEncounter.encounter_date.desc())
    )
    results = session.execute(stmt).scalars().all()

    return [
        EncounterSummary(
            id=e.id,
            patient_id=e.patient_id,
            doctor_id=e.doctor_id,
            doctor_name=e.doctor.name_en if e.doctor else "",
            encounter_date=e.encounter_date,
            diagnosis=e.diagnosis,
            is_finalised=e.is_finalised,
            finalised_at=e.finalised_at,
            addenda_count=len(e.addenda),
        )
        for e in results
    ]


@router.patch(
    "/encounters/{id}",
    response_model=EncounterRead,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def update_encounter(
    id: int,
    payload: EncounterUpdate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> EncounterRead:
    """Update draft encounter notes. Locked if already finalised (CLN-02)."""
    enc = session.get(ClinicalEncounter, id)
    if not enc or enc.doctor_id != principal.doctor_id:
        raise ApiError(
            status_code=404,
            code="encounter_not_found",
            message="Clinical encounter not found.",
        )

    if enc.is_finalised:
        raise ApiError(
            status_code=400,
            code="encounter_finalised_immutable",
            message="Finalised clinical encounters are immutable and cannot be modified.",
        )

    require_version(enc, payload.version_id, label="encounter")

    before_snap = {
        "symptoms": enc.symptoms,
        "clinical_notes": enc.clinical_notes,
        "diagnosis": enc.diagnosis,
        "version_id": enc.version_id,
    }

    if payload.symptoms is not None:
        enc.symptoms = payload.symptoms
    if payload.clinical_notes is not None:
        enc.clinical_notes = payload.clinical_notes
    if payload.diagnosis is not None:
        enc.diagnosis = payload.diagnosis

    enc.version_id += 1
    session.flush()

    after_snap = {
        "symptoms": enc.symptoms,
        "clinical_notes": enc.clinical_notes,
        "diagnosis": enc.diagnosis,
        "version_id": enc.version_id,
    }

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.ENCOUNTER_CREATED,
        entity_type="clinical_encounter",
        entity_id=enc.id,
        before=before_snap,
        after=after_snap,
    )

    return _to_read_schema(enc)


@router.post(
    "/encounters/{id}/finalise",
    response_model=EncounterRead,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def finalise_encounter(
    id: int,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> EncounterRead:
    """Finalise encounter notes, locking them against future updates (CLN-02)."""
    enc = session.get(ClinicalEncounter, id)
    if not enc or enc.doctor_id != principal.doctor_id:
        raise ApiError(
            status_code=404,
            code="encounter_not_found",
            message="Clinical encounter not found.",
        )

    if not enc.is_finalised:
        enc.is_finalised = True
        enc.finalised_at = clock.utcnow()
        enc.version_id += 1

        # Advance linked appointment to DONE if currently IN_CONSULTATION
        if enc.appointment_id is not None:
            appt = session.get(Appointment, enc.appointment_id)
            if appt and appt.status == AppointmentStatus.IN_CONSULTATION.value:
                appt.status = AppointmentStatus.DONE.value
                appt.status_updated_at = clock.utcnow()
                appt.version_id += 1

        session.flush()

        ctx = build_audit_context(request, principal)
        audit_service.record(
            session,
            ctx,
            action=AuditAction.ENCOUNTER_FINALISED,
            entity_type="clinical_encounter",
            entity_id=enc.id,
            after={
                "is_finalised": True,
                "finalised_at": enc.finalised_at.isoformat(),
                "version_id": enc.version_id,
            },
        )

    return _to_read_schema(enc)


@router.post(
    "/encounters/{id}/addenda",
    response_model=AddendumRead,
    status_code=201,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def add_encounter_addendum(
    id: int,
    payload: AddendumCreate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> AddendumRead:
    """Append a dated addendum to a finalised clinical encounter (CLN-02)."""
    enc = session.get(ClinicalEncounter, id)
    if not enc or enc.doctor_id != principal.doctor_id:
        raise ApiError(
            status_code=404,
            code="encounter_not_found",
            message="Clinical encounter not found.",
        )

    if not enc.is_finalised:
        raise ApiError(
            status_code=400,
            code="encounter_not_finalised",
            message="Addenda can only be appended to finalised clinical encounters.",
        )

    addendum = ClinicalAddendum(
        encounter_id=enc.id,
        doctor_id=principal.doctor_id,
        addendum_text=payload.addendum_text,
        created_by_user_id=principal.user_id,
    )
    session.add(addendum)
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.ENCOUNTER_ADDENDUM_ADDED,
        entity_type="clinical_addendum",
        entity_id=addendum.id,
        after={
            "encounter_id": addendum.encounter_id,
            "doctor_id": addendum.doctor_id,
            "addendum_text": addendum.addendum_text,
        },
    )

    return AddendumRead(
        id=addendum.id,
        encounter_id=addendum.encounter_id,
        doctor_id=addendum.doctor_id,
        doctor_name=addendum.doctor.name_en if addendum.doctor else "",
        addendum_text=addendum.addendum_text,
        created_at=addendum.created_at,
    )
