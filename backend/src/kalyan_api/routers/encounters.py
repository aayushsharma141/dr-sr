"""Clinical encounter recording, note finalisation, and addenda endpoints (CLN-01, CLN-02).

Guarantees:
- D-03: Doctor silo; encounters strictly scoped to owning doctor.
- D-04: Reception default-deny (HTTP 403 Forbidden).
- Defense-in-depth immutability: finalised notes cannot be edited or deleted (HTTP 400).
- Modifications to finalised encounters must be appended as dated addenda.
"""

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import object_session

from kalyan_api import clock
from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.permissions import Permission, Role
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
)
from kalyan_api.core.scope import (
    ScopeFamily,
    audit_cross_doctor_list_read,
    get_scoped_or_404,
    row_scope,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    ClinicalAddendum,
    ClinicalEncounter,
    ClinicalTemplate,
    ClinicalTemplateResponse,
    ClinicalTemplateVersion,
    Doctor,
    Patient,
)
from kalyan_api.schemas.encounters import (
    AddendumCreate,
    AddendumRead,
    EncounterCreate,
    EncounterFinaliseRequest,
    EncounterRead,
    EncounterSummary,
    EncounterUpdate,
    UnfinishedEncounterItem,
)
from kalyan_api.schemas.templates import TemplateResponseInput, TemplateResponseRead
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(tags=["encounters"])


def _department_from_saved_form(enc: ClinicalEncounter) -> int | None:
    """Department of the specialty form saved with a consultation that has none recorded.

    Consultations finalised before departments were tracked are tamper-protected, so their
    department is never written back; it is only reported, from the template they used.
    """
    session = object_session(enc)
    if session is None:
        return None
    return session.scalar(
        select(ClinicalTemplate.department_id)
        .join(ClinicalTemplateVersion, ClinicalTemplateVersion.template_id == ClinicalTemplate.id)
        .join(
            ClinicalTemplateResponse,
            ClinicalTemplateResponse.template_version_id == ClinicalTemplateVersion.id,
        )
        .where(ClinicalTemplateResponse.encounter_id == enc.id)
    )


def _to_read_schema(enc: ClinicalEncounter) -> EncounterRead:
    """Format ClinicalEncounter to read schema including addenda."""
    sorted_addenda = sorted(enc.addenda, key=lambda a: (a.created_at, a.id))
    addenda_list = [
        AddendumRead(
            id=a.id,
            encounter_id=a.encounter_id,
            doctor_id=a.doctor_id,
            doctor_name=a.doctor.name_en if a.doctor else "",
            addendum_text=a.addendum_text,
            created_at=a.created_at,
        )
        for a in sorted_addenda
    ]

    return EncounterRead(
        id=enc.id,
        patient_id=enc.patient_id,
        patient_urn=enc.patient_urn or (enc.patient.urn if enc.patient else ""),
        patient_name=enc.patient_name or (enc.patient.full_name if enc.patient else ""),
        patient_mobile=enc.patient_mobile or (enc.patient.mobile if enc.patient else None),
        patient_address=enc.patient_address or (enc.patient.address if enc.patient else None),
        doctor_id=enc.doctor_id,
        doctor_name=enc.doctor.name_en if enc.doctor else "",
        appointment_id=enc.appointment_id,
        department_id=enc.department_id or _department_from_saved_form(enc),
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
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def create_encounter(
    payload: EncounterCreate,
    request: Request,
    response: Response,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> EncounterRead:
    """Record a new clinical encounter note or return existing for appointment (CLN-01, DWS-01)."""
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
        # BR-001: the appointment must belong to the same patient as the note.
        if appt.patient_id != payload.patient_id:
            raise ApiError(
                status_code=404,
                code="appointment_not_found",
                message="Appointment not found for this patient.",
            )

        # DWS-01: Idempotency / reopening existing encounter
        existing_enc = session.scalar(
            select(ClinicalEncounter).where(
                ClinicalEncounter.appointment_id == payload.appointment_id
            )
        )
        if existing_enc is not None:
            response.status_code = 200
            return _to_read_schema(existing_enc)

        # Advance appointment status to IN_CONSULTATION if not already there
        if appt.status in (AppointmentStatus.BOOKED.value, AppointmentStatus.ARRIVED.value):
            appt.status = AppointmentStatus.IN_CONSULTATION.value
            appt.status_updated_at = clock.utcnow()
            appt.version_id += 1

    # D-19-03: the department (specialty) comes from the appointment. Without an appointment,
    # fall back to the doctor's department when they belong to exactly one.
    department_id = payload.department_id
    if department_id is None and appt is not None:
        department_id = appt.department_id
    if department_id is None:
        doctor = session.get(Doctor, principal.doctor_id)
        if doctor is not None and len(doctor.departments) == 1:
            department_id = doctor.departments[0].id

    response.status_code = 201
    enc = ClinicalEncounter(
        appointment_id=payload.appointment_id,
        department_id=department_id,
        patient_id=payload.patient_id,
        patient_name=patient.full_name,
        patient_urn=patient.urn,
        patient_mobile=patient.mobile,
        patient_address=patient.address,
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
    "/encounters/unfinished",
    response_model=list[UnfinishedEncounterItem],
    dependencies=[Depends(require(Permission.ENCOUNTER_READ))],
)
def list_unfinished_encounters(
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> list[UnfinishedEncounterItem]:
    """Retrieve unfinished consultation drafts for authenticated doctor (D-19-24, DWS-02)."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(status_code=403, code="doctor_only", message="Doctor access required.")

    stmt = (
        select(ClinicalEncounter)
        .where(
            ClinicalEncounter.doctor_id == principal.doctor_id,
            ClinicalEncounter.is_finalised.is_(False),
        )
        .order_by(ClinicalEncounter.created_at.desc())
    )
    encounters = session.scalars(stmt).all()
    return [
        UnfinishedEncounterItem(
            id=e.id,
            patient_id=e.patient_id,
            patient_urn=e.patient.urn if e.patient else "",
            patient_name=e.patient.full_name if e.patient else "",
            department_id=e.department_id,
            department_name=e.department.name_en
            if e.department
            else (
                "Physiotherapy"
                if e.department_id == 1
                else "Ophthalmology"
                if e.department_id == 2
                else "General"
            ),
            started_at=e.created_at,
            is_finalised=e.is_finalised,
        )
        for e in encounters
    ]


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
    """Retrieve encounter details including addenda (CLN-01, DWS-04)."""
    enc = get_scoped_or_404(
        session,
        ClinicalEncounter,
        id,
        principal,
        family=ScopeFamily.CLINICAL_READ,
        doctor_id_col=ClinicalEncounter.doctor_id,
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
    """List historical encounters for a patient scoped via CLINICAL_READ (DWS-04)."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(status_code=403, code="doctor_only", message="Doctor access required.")

    stmt = (
        select(ClinicalEncounter)
        .where(
            ClinicalEncounter.patient_id == patient_id,
            row_scope(principal, ScopeFamily.CLINICAL_READ, ClinicalEncounter.doctor_id),
        )
        .order_by(ClinicalEncounter.encounter_date.desc())
    )
    results = session.execute(stmt).scalars().all()
    audit_cross_doctor_list_read(session, principal, patient_id, "patient_encounters_list", results)

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
    enc = get_scoped_or_404(
        session,
        ClinicalEncounter,
        id,
        principal,
        family=ScopeFamily.CLINICAL_WRITE,
        doctor_id_col=ClinicalEncounter.doctor_id,
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
        "department_id": enc.department_id,
        "version_id": enc.version_id,
    }

    if payload.symptoms is not None:
        enc.symptoms = payload.symptoms
    if payload.clinical_notes is not None:
        enc.clinical_notes = payload.clinical_notes
    if payload.diagnosis is not None:
        enc.diagnosis = payload.diagnosis
    if payload.department_id is not None:
        enc.department_id = payload.department_id

    enc.version_id += 1
    session.flush()

    after_snap = {
        "symptoms": enc.symptoms,
        "clinical_notes": enc.clinical_notes,
        "diagnosis": enc.diagnosis,
        "department_id": enc.department_id,
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
    payload: EncounterFinaliseRequest | None = None,
    principal: Principal = Depends(current_principal),
) -> EncounterRead:
    """Finalise encounter notes, locking them against future updates (CLN-02, D-19-09)."""
    enc = get_scoped_or_404(
        session,
        ClinicalEncounter,
        id,
        principal,
        family=ScopeFamily.CLINICAL_WRITE,
        doctor_id_col=ClinicalEncounter.doctor_id,
    )

    if not enc.is_finalised:
        # Require matching version if provided in finalise payload (FB-01)
        if payload is not None and payload.version_id is not None:
            require_version(enc, payload.version_id, label="encounter")

        # If payload is provided, update encounter fields before finalising
        if payload is not None:
            if payload.symptoms is not None:
                enc.symptoms = payload.symptoms
            if payload.clinical_notes is not None:
                enc.clinical_notes = payload.clinical_notes
            if payload.diagnosis is not None:
                enc.diagnosis = payload.diagnosis

        # Strictly validate that chief complaint (symptoms) and diagnosis are non-empty and at least
        # 2 chars
        symptoms_val = (enc.symptoms or "").strip()
        diagnosis_val = (enc.diagnosis or "").strip()

        if len(symptoms_val) < 2:
            raise ApiError(
                status_code=422,
                code="symptoms_required",
                message=(
                    "Chief complaint is required to finalise the consultation (minimum 2 "
                    "characters)."
                ),
            )

        if len(diagnosis_val) < 2:
            raise ApiError(
                status_code=422,
                code="diagnosis_required",
                message=(
                    "Diagnosis is required to finalise the consultation (minimum 2 characters)."
                ),
            )

        # Validate specialty template response required fields if response exists (D-19-09, DWS-05)
        tmpl_resp = session.scalar(
            select(ClinicalTemplateResponse).where(ClinicalTemplateResponse.encounter_id == enc.id)
        )
        if tmpl_resp:
            resp_data = tmpl_resp.response_data or {}
            tmpl_version = session.get(ClinicalTemplateVersion, tmpl_resp.template_version_id)
            if tmpl_version and tmpl_version.schema_json:
                required_fields = tmpl_version.schema_json.get("required", [])
                missing_fields = []
                for field in required_fields:
                    val = resp_data
                    for part in field.split("."):
                        if isinstance(val, dict):
                            val = val.get(part)
                        else:
                            val = None
                            break
                    if val is None or (isinstance(val, str) and not str(val).strip()):
                        missing_fields.append(field)
                if missing_fields:
                    raise ApiError(
                        status_code=422,
                        code="template_required_fields_missing",
                        message=(
                            "Required specialty template fields missing: "
                            f"{', '.join(missing_fields)}"
                        ),
                    )

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
    enc = get_scoped_or_404(
        session,
        ClinicalEncounter,
        id,
        principal,
        family=ScopeFamily.CLINICAL_WRITE,
        doctor_id_col=ClinicalEncounter.doctor_id,
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


@router.get(
    "/encounters/{id}/template-response",
    response_model=TemplateResponseRead,
    dependencies=[Depends(require(Permission.ENCOUNTER_READ))],
)
def get_encounter_template_response(
    id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> TemplateResponseRead:
    """Retrieve saved specialty template responses for encounter."""
    get_scoped_or_404(
        session,
        ClinicalEncounter,
        id,
        principal,
        family=ScopeFamily.CLINICAL_READ,
        doctor_id_col=ClinicalEncounter.doctor_id,
    )
    resp = session.scalar(
        select(ClinicalTemplateResponse).where(ClinicalTemplateResponse.encounter_id == id)
    )
    if not resp:
        raise ApiError(
            status_code=404,
            code="template_response_not_found",
            message="No specialty template response for encounter.",
        )
    return TemplateResponseRead.model_validate(resp)


@router.put(
    "/encounters/{id}/template-response",
    response_model=TemplateResponseRead,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def save_encounter_template_response(
    id: int,
    payload: TemplateResponseInput,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> TemplateResponseRead:
    """Save or update specialty template response for a draft encounter (D-19-09, DWS-05)."""
    enc = get_scoped_or_404(
        session,
        ClinicalEncounter,
        id,
        principal,
        family=ScopeFamily.CLINICAL_WRITE,
        doctor_id_col=ClinicalEncounter.doctor_id,
    )

    if enc.is_finalised:
        raise ApiError(
            status_code=400,
            code="encounter_finalised",
            message="Cannot modify specialty template response for a finalised clinical encounter.",
        )

    version = session.get(ClinicalTemplateVersion, payload.template_version_id)
    if not version:
        raise ApiError(
            status_code=404,
            code="template_version_not_found",
            message="Clinical template version not found.",
        )

    existing = session.scalar(
        select(ClinicalTemplateResponse).where(ClinicalTemplateResponse.encounter_id == id)
    )
    if existing:
        existing.template_version_id = payload.template_version_id
        existing.response_data = payload.response_data
        existing.updated_at = clock.utcnow()
        session.flush()
        session.refresh(existing)
        return TemplateResponseRead.model_validate(existing)
    else:
        new_resp = ClinicalTemplateResponse(
            encounter_id=id,
            template_version_id=payload.template_version_id,
            response_data=payload.response_data,
        )
        session.add(new_resp)
        session.flush()
        session.refresh(new_resp)
        return TemplateResponseRead.model_validate(new_resp)
