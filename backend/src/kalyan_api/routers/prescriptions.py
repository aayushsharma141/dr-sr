"""Structured doctor prescriptions and medication item endpoints (RX-01, DWS-07).

Guarantees:
- Licensed doctor authorship required for prescribing (PRESCRIPTION_WRITE).
- Prescription authoring lifecycle: DRAFT -> AUTHORISED -> CANCELLED.
- Modification blocked once AUTHORISED (HTTP 409).
- Cancelling requires a clinical reason (min 3 chars).
- At most one active (DRAFT or AUTHORISED) prescription per encounter.
- In-transaction audit trail with item counts and clinical diagnosis.
- Sequential medication order validation.
"""

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from kalyan_api import clock
from kalyan_api.core.errors import ApiError
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
    ClinicalEncounter,
    ConsultationStatus,
    Doctor,
    Patient,
    Prescription,
    PrescriptionItem,
    PrescriptionStatus,
)
from kalyan_api.schemas.prescriptions import (
    PrescriptionAmendRequest,
    PrescriptionCancelRequest,
    PrescriptionCreate,
    PrescriptionItemOut,
    PrescriptionOut,
    PrescriptionSummary,
    PrescriptionUpdate,
)
from kalyan_api.services import appointment_service, audit_service
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.code_sequence_service import (
    allocate_encounter_code,
    effective_patient_ids,
)

router = APIRouter(tags=["prescriptions"])


def _to_prescription_out(rx: Prescription) -> PrescriptionOut:
    """Format Prescription model into full output schema."""
    sorted_items = sorted(rx.items, key=lambda it: it.item_order)
    items_out = [
        PrescriptionItemOut(
            id=it.id,
            prescription_id=it.prescription_id,
            item_order=it.item_order,
            medicine_name=it.medicine_name,
            dosage=it.dosage,
            frequency=it.frequency,
            duration_days=it.duration_days,
            instructions=it.instructions,
            strength=it.strength,
            form=it.form,
            route=it.route,
        )
        for it in sorted_items
    ]

    return PrescriptionOut(
        id=rx.id,
        patient_id=rx.patient_id,
        patient_urn=rx.patient_urn or (rx.patient.urn if rx.patient else ""),
        patient_name=rx.patient_name or (rx.patient.full_name if rx.patient else ""),
        patient_mobile=rx.patient_mobile or (rx.patient.mobile if rx.patient else None),
        patient_address=rx.patient_address or (rx.patient.address if rx.patient else None),
        doctor_id=rx.doctor_id,
        doctor_name=rx.doctor.name_en if rx.doctor else "",
        encounter_id=rx.encounter_id,
        status=rx.status,
        revision_number=rx.revision_number,
        supersedes_prescription_id=rx.supersedes_prescription_id,
        amendment_reason=rx.amendment_reason,
        authorised_at=rx.authorised_at,
        cancelled_at=rx.cancelled_at,
        cancellation_reason=rx.cancellation_reason,
        cancelled_by_user_id=rx.cancelled_by_user_id,
        is_printable=(rx.status == PrescriptionStatus.AUTHORISED.value),
        diagnosis=rx.diagnosis,
        dietary_advice=rx.dietary_advice,
        general_advice=rx.general_advice,
        follow_up_date=rx.follow_up_date,
        version_id=rx.version_id,
        created_at=rx.created_at,
        updated_at=rx.updated_at,
        items=items_out,
    )


@router.post(
    "/prescriptions",
    response_model=PrescriptionOut,
    status_code=201,
    dependencies=[Depends(require(Permission.PRESCRIPTION_WRITE))],
)
def create_prescription(
    payload: PrescriptionCreate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PrescriptionOut:
    """Issue a new structured prescription with medication lines (RX-01, DWS-07)."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(
            status_code=403,
            code="doctor_only",
            message="Only authenticated doctors can issue prescriptions.",
        )

    patient = session.get(Patient, payload.patient_id)
    if not patient or not patient.is_active:
        raise ApiError(status_code=404, code="patient_not_found", message="Patient not found.")

    encounter = None
    if payload.encounter_id is not None:
        encounter = get_scoped_or_404(
            session,
            ClinicalEncounter,
            payload.encounter_id,
            principal,
            family=ScopeFamily.CLINICAL_WRITE,
            doctor_id_col=ClinicalEncounter.doctor_id,
        )
        # BR-001: the encounter must belong to the same patient as the prescription.
        if encounter.patient_id != payload.patient_id:
            raise ApiError(
                status_code=404,
                code="encounter_not_found",
                message="Encounter not found for this patient.",
            )
        if (
            payload.appointment_id is not None
            and encounter.appointment_id is not None
            and encounter.appointment_id != payload.appointment_id
        ):
            raise ApiError(
                status_code=422,
                code="appointment_encounter_mismatch",
                message="Provided appointment_id does not match the encounter.",
            )
    elif payload.appointment_id is not None:
        appt = session.get(Appointment, payload.appointment_id)
        if (
            not appt
            or appt.doctor_id != principal.doctor_id
            or appt.patient_id != payload.patient_id
        ):
            raise ApiError(
                status_code=404,
                code="appointment_not_found",
                message="Appointment not found for this patient and doctor.",
            )
        encounter = session.scalar(
            select(ClinicalEncounter).where(
                ClinicalEncounter.appointment_id == payload.appointment_id
            )
        )
        if encounter is None:
            if appt.consultation_status is None:
                raise ApiError(
                    status_code=422,
                    code="not_checked_in",
                    message=(
                        "The patient has not been checked in for this appointment. "
                        "Ask reception to check them in first."
                    ),
                )
            if appt.consultation_status == ConsultationStatus.WAITING.value:
                appointment_service.start_consultation(session, appt, principal)
            dept_id = appt.department_id
            if dept_id is None:
                doc = session.get(Doctor, principal.doctor_id)
                if doc is not None and len(doc.departments) == 1:
                    dept_id = doc.departments[0].id
            encounter = ClinicalEncounter(
                encounter_code=allocate_encounter_code(session, clock.ist_today()),
                visit_id=appt.visit_id,
                appointment_id=appt.id,
                department_id=dept_id,
                patient_id=payload.patient_id,
                patient_name=patient.full_name,
                patient_urn=patient.urn,
                patient_mobile=patient.mobile,
                patient_address=patient.address,
                doctor_id=principal.doctor_id,
                symptoms="",
                clinical_notes="",
                diagnosis=(payload.diagnosis or "").strip(),
                created_by_user_id=principal.user_id,
            )
            session.add(encounter)
            session.flush()

    if encounter is not None:
        # Enforce partial unique index: at most one active prescription per encounter (D-19-15)
        active_rx = session.execute(
            select(Prescription).where(
                Prescription.encounter_id == encounter.id,
                Prescription.status.in_(
                    [
                        PrescriptionStatus.DRAFT.value,
                        PrescriptionStatus.AUTHORISED.value,
                    ]
                ),
            )
        ).scalar_one_or_none()
        if active_rx:
            raise ApiError(
                status_code=409,
                code="active_prescription_exists",
                message=(
                    "An active prescription already exists for this encounter. Cancel it to "
                    "reissue a new prescription."
                ),
            )

    target_status = (
        payload.status.upper() if payload.status else PrescriptionStatus.AUTHORISED.value
    )
    if target_status not in (PrescriptionStatus.DRAFT.value, PrescriptionStatus.AUTHORISED.value):
        raise ApiError(
            status_code=422,
            code="invalid_status",
            message="Initial prescription status must be DRAFT or AUTHORISED.",
        )

    # Inherit diagnosis from encounter if omitted (D-19-17)
    diagnosis = (
        payload.diagnosis.strip() if payload.diagnosis and payload.diagnosis.strip() else None
    )
    if (
        not diagnosis
        and encounter is not None
        and encounter.diagnosis
        and encounter.diagnosis.strip()
    ):
        diagnosis = encounter.diagnosis.strip()

    if not diagnosis or len(diagnosis) < 2:
        raise ApiError(
            status_code=422,
            code="diagnosis_required",
            message="Prescription diagnosis is required (minimum 2 characters).",
        )

    if target_status == PrescriptionStatus.AUTHORISED.value and not payload.items:
        raise ApiError(
            status_code=422,
            code="items_required",
            message="At least one medication item is required to authorise a prescription.",
        )

    # Validate distinct item orders
    orders = [item.item_order for item in payload.items]
    if len(orders) != len(set(orders)):
        raise ApiError(
            status_code=422,
            code="duplicate_item_order",
            message="Each prescription item must have a unique item order.",
        )

    now_utc = datetime.now(UTC)
    # Insert as DRAFT first so prescription_items pass the immutability trigger before authorising.
    rx = Prescription(
        patient_id=payload.patient_id,
        patient_name=patient.full_name,
        patient_urn=patient.urn,
        patient_mobile=patient.mobile,
        patient_address=patient.address,
        doctor_id=principal.doctor_id,
        encounter_id=encounter.id if encounter is not None else None,
        status=PrescriptionStatus.DRAFT.value,
        authorised_at=None,
        diagnosis=diagnosis,
        dietary_advice=payload.dietary_advice,
        general_advice=payload.general_advice,
        follow_up_date=payload.follow_up_date,
    )
    session.add(rx)
    session.flush()

    for item_data in payload.items:
        item = PrescriptionItem(
            prescription_id=rx.id,
            item_order=item_data.item_order,
            medicine_name=item_data.medicine_name,
            dosage=item_data.dosage,
            frequency=item_data.frequency,
            duration_days=item_data.duration_days,
            instructions=item_data.instructions,
            strength=item_data.strength,
            form=item_data.form,
            route=item_data.route,
        )
        session.add(item)

    session.flush()

    if target_status == PrescriptionStatus.AUTHORISED.value:
        rx.status = PrescriptionStatus.AUTHORISED.value
        rx.authorised_at = now_utc
        session.flush()

    # Re-query with eager relationships
    stmt = (
        select(Prescription)
        .where(Prescription.id == rx.id)
        .options(
            selectinload(Prescription.patient),
            selectinload(Prescription.doctor),
            selectinload(Prescription.items),
        )
    )
    refreshed_rx = session.execute(stmt).scalar_one()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.PRESCRIPTION_CREATED,
        entity_type="prescription",
        entity_id=refreshed_rx.id,
        after={
            "patient_id": refreshed_rx.patient_id,
            "patient_urn": patient.urn,
            "doctor_id": refreshed_rx.doctor_id,
            "encounter_id": refreshed_rx.encounter_id,
            "status": refreshed_rx.status,
            "diagnosis": refreshed_rx.diagnosis,
            "items_count": len(refreshed_rx.items),
        },
    )

    return _to_prescription_out(refreshed_rx)


@router.put(
    "/prescriptions/{id}",
    response_model=PrescriptionOut,
    dependencies=[Depends(require(Permission.PRESCRIPTION_WRITE))],
)
def update_prescription_draft(
    id: int,
    payload: PrescriptionUpdate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PrescriptionOut:
    """Modify an in-progress prescription draft. Authorised prescriptions return HTTP 409 (DWS-07)."""  # noqa: E501 - published as the OpenAPI description; wrapping changes the text
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(
            status_code=403,
            code="doctor_only",
            message="Only authenticated doctors can modify prescriptions.",
        )

    rx = get_scoped_or_404(
        session,
        Prescription,
        id,
        principal,
        family=ScopeFamily.CLINICAL_WRITE,
        doctor_id_col=Prescription.doctor_id,
    )

    if rx.status != PrescriptionStatus.DRAFT.value:
        raise ApiError(
            status_code=409,
            code="prescription_locked",
            message=(
                "Authorised prescriptions cannot be modified. Cancel and reissue to make changes."
            ),
        )

    if payload.version_id is not None and rx.version_id != payload.version_id:
        raise ApiError(
            status_code=409,
            code="concurrency_conflict",
            message="Prescription was modified concurrently by another request.",
        )

    if payload.diagnosis is not None:
        diag = payload.diagnosis.strip()
        if len(diag) < 2:
            raise ApiError(
                status_code=422,
                code="diagnosis_required",
                message="Prescription diagnosis must be at least 2 characters.",
            )
        rx.diagnosis = diag

    if payload.dietary_advice is not None:
        rx.dietary_advice = payload.dietary_advice
    if payload.general_advice is not None:
        rx.general_advice = payload.general_advice
    if payload.follow_up_date is not None:
        rx.follow_up_date = payload.follow_up_date

    if payload.items is not None:
        orders = [item.item_order for item in payload.items]
        if len(orders) != len(set(orders)):
            raise ApiError(
                status_code=422,
                code="duplicate_item_order",
                message="Each prescription item must have a unique item order.",
            )
        for old_item in list(rx.items):
            session.delete(old_item)
        rx.items.clear()
        session.flush()

        for item_data in payload.items:
            new_item = PrescriptionItem(
                prescription_id=rx.id,
                item_order=item_data.item_order,
                medicine_name=item_data.medicine_name,
                dosage=item_data.dosage,
                frequency=item_data.frequency,
                duration_days=item_data.duration_days,
                instructions=item_data.instructions,
                strength=item_data.strength,
                form=item_data.form,
                route=item_data.route,
            )
            session.add(new_item)
            rx.items.append(new_item)

    session.flush()
    session.refresh(rx)

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.PRESCRIPTION_UPDATED,
        entity_type="prescription",
        entity_id=rx.id,
        after={
            "diagnosis": rx.diagnosis,
            "items_count": len(rx.items),
            "version_id": rx.version_id,
        },
    )

    return _to_prescription_out(rx)


@router.post(
    "/prescriptions/{id}/authorise",
    response_model=PrescriptionOut,
    dependencies=[Depends(require(Permission.PRESCRIPTION_WRITE))],
)
def authorise_prescription(
    id: int,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PrescriptionOut:
    """Transition a DRAFT prescription to AUTHORISED (DWS-07)."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(
            status_code=403,
            code="doctor_only",
            message="Only authenticated doctors can authorise prescriptions.",
        )

    rx = get_scoped_or_404(
        session,
        Prescription,
        id,
        principal,
        family=ScopeFamily.CLINICAL_WRITE,
        doctor_id_col=Prescription.doctor_id,
    )

    if rx.status != PrescriptionStatus.DRAFT.value:
        raise ApiError(
            status_code=409,
            code="invalid_status_transition",
            message=(
                f"Cannot authorise prescription with status '{rx.status}'. Only DRAFT can be "
                "authorised."
            ),
        )

    if not rx.items:
        raise ApiError(
            status_code=422,
            code="items_required",
            message="Prescription must have at least one medication item to be authorised.",
        )

    if not rx.diagnosis or len(rx.diagnosis.strip()) < 2:
        raise ApiError(
            status_code=422,
            code="diagnosis_required",
            message="Valid clinical diagnosis is required to authorise prescription.",
        )

    now_utc = datetime.now(UTC)
    rx.status = PrescriptionStatus.AUTHORISED.value
    rx.authorised_at = now_utc
    session.flush()
    session.refresh(rx)

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.PRESCRIPTION_AUTHORISED,
        entity_type="prescription",
        entity_id=rx.id,
        after={
            "status": rx.status,
            "authorised_at": rx.authorised_at.isoformat() if rx.authorised_at else None,
            "items_count": len(rx.items),
        },
    )

    return _to_prescription_out(rx)


@router.post(
    "/prescriptions/{id}/cancel",
    response_model=PrescriptionOut,
    dependencies=[Depends(require(Permission.PRESCRIPTION_WRITE))],
)
def cancel_prescription(
    id: int,
    payload: PrescriptionCancelRequest,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PrescriptionOut:
    """Cancel an active prescription with recorded reason and attribution (D-19-15)."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(
            status_code=403,
            code="doctor_only",
            message="Only authenticated doctors can cancel prescriptions.",
        )

    rx = get_scoped_or_404(
        session,
        Prescription,
        id,
        principal,
        family=ScopeFamily.CLINICAL_WRITE,
        doctor_id_col=Prescription.doctor_id,
    )

    if rx.status == PrescriptionStatus.CANCELLED.value:
        raise ApiError(
            status_code=409,
            code="already_cancelled",
            message="Prescription is already cancelled.",
        )

    if rx.status == PrescriptionStatus.SUPERSEDED.value:
        raise ApiError(
            status_code=409,
            code="already_superseded",
            message="Superseded prescriptions cannot be cancelled.",
        )

    reason = payload.reason.strip()
    if len(reason) < 3:
        raise ApiError(
            status_code=422,
            code="invalid_reason",
            message="Cancellation reason must be at least 3 characters.",
        )

    now_utc = datetime.now(UTC)
    rx.status = PrescriptionStatus.CANCELLED.value
    rx.cancelled_at = now_utc
    rx.cancelled_by_user_id = principal.user_id
    rx.cancellation_reason = reason
    session.flush()
    session.refresh(rx)

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.PRESCRIPTION_CANCELLED,
        entity_type="prescription",
        entity_id=rx.id,
        after={
            "status": rx.status,
            "cancellation_reason": rx.cancellation_reason,
            "cancelled_at": rx.cancelled_at.isoformat() if rx.cancelled_at else None,
            "cancelled_by_user_id": rx.cancelled_by_user_id,
        },
    )

    return _to_prescription_out(rx)


@router.post(
    "/prescriptions/{id}/amend",
    response_model=PrescriptionOut,
    status_code=201,
    dependencies=[Depends(require(Permission.PRESCRIPTION_WRITE))],
)
def amend_prescription(
    id: int,
    payload: PrescriptionAmendRequest,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PrescriptionOut:
    """Create a new versioned revision superseding an AUTHORISED prescription."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(
            status_code=403,
            code="doctor_only",
            message="Only authenticated doctors can amend prescriptions.",
        )

    old_rx = session.execute(
        select(Prescription)
        .where(
            Prescription.id == id,
            row_scope(principal, ScopeFamily.CLINICAL_WRITE, Prescription.doctor_id),
        )
        .with_for_update(of=Prescription)
    ).scalar_one_or_none()
    if old_rx is None:
        raise ApiError(
            status_code=404,
            code="not_found",
            message="Resource not found",
        )

    if old_rx.status != PrescriptionStatus.AUTHORISED.value:
        raise ApiError(
            status_code=422,
            code="invalid_prescription_state",
            message=(
                f"Cannot amend prescription with status '{old_rx.status}'. "
                "Only AUTHORISED prescriptions can be amended."
            ),
        )

    amendment_reason = payload.amendment_reason.strip()
    if len(amendment_reason) < 5:
        raise ApiError(
            status_code=422,
            code="invalid_amendment_reason",
            message="Amendment reason must be at least 5 characters.",
        )

    if payload.diagnosis is not None:
        diagnosis = payload.diagnosis.strip()
        if len(diagnosis) < 2:
            raise ApiError(
                status_code=422,
                code="diagnosis_required",
                message="Prescription diagnosis is required (minimum 2 characters).",
            )
    else:
        diagnosis = old_rx.diagnosis

    orders = [item.item_order for item in payload.items]
    if len(orders) != len(set(orders)):
        raise ApiError(
            status_code=422,
            code="duplicate_item_order",
            message="Each prescription item must have a unique item order.",
        )

    dietary_advice = (
        payload.dietary_advice
        if "dietary_advice" in payload.model_fields_set
        else old_rx.dietary_advice
    )
    general_advice = (
        payload.general_advice
        if "general_advice" in payload.model_fields_set
        else old_rx.general_advice
    )
    follow_up_date = (
        payload.follow_up_date
        if "follow_up_date" in payload.model_fields_set
        else old_rx.follow_up_date
    )

    old_revision_number = old_rx.revision_number
    # Transition original to SUPERSEDED first (touching only status/updated_at/version_id)
    # so the tamper trigger passes and uq_prescriptions_active_per_encounter is released.
    old_rx.status = PrescriptionStatus.SUPERSEDED.value
    session.flush()

    now_utc = datetime.now(UTC)
    new_rx = Prescription(
        patient_id=old_rx.patient_id,
        patient_name=old_rx.patient_name or (old_rx.patient.full_name if old_rx.patient else None),
        patient_urn=old_rx.patient_urn or (old_rx.patient.urn if old_rx.patient else None),
        patient_mobile=old_rx.patient_mobile or (old_rx.patient.mobile if old_rx.patient else None),
        patient_address=(
            old_rx.patient_address or (old_rx.patient.address if old_rx.patient else None)
        ),
        doctor_id=old_rx.doctor_id,
        encounter_id=old_rx.encounter_id,
        status=PrescriptionStatus.DRAFT.value,
        revision_number=old_revision_number + 1,
        supersedes_prescription_id=old_rx.id,
        amendment_reason=amendment_reason,
        authorised_at=None,
        diagnosis=diagnosis,
        dietary_advice=dietary_advice,
        general_advice=general_advice,
        follow_up_date=follow_up_date,
    )
    session.add(new_rx)
    session.flush()

    for item_data in payload.items:
        session.add(
            PrescriptionItem(
                prescription_id=new_rx.id,
                item_order=item_data.item_order,
                medicine_name=item_data.medicine_name,
                dosage=item_data.dosage,
                frequency=item_data.frequency,
                duration_days=item_data.duration_days,
                instructions=item_data.instructions,
                strength=item_data.strength,
                form=item_data.form,
                route=item_data.route,
            )
        )
    session.flush()

    if payload.authorise_immediately:
        new_rx.status = PrescriptionStatus.AUTHORISED.value
        new_rx.authorised_at = now_utc
        session.flush()

    stmt = (
        select(Prescription)
        .where(Prescription.id == new_rx.id)
        .options(
            selectinload(Prescription.patient),
            selectinload(Prescription.doctor),
            selectinload(Prescription.items),
        )
    )
    refreshed_rx = session.execute(stmt).scalar_one()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.PRESCRIPTION_AMENDED,
        entity_type="prescription",
        entity_id=refreshed_rx.id,
        before={
            "prescription_id": old_rx.id,
            "revision_number": old_revision_number,
            "status": PrescriptionStatus.AUTHORISED.value,
        },
        after={
            "old_prescription_id": old_rx.id,
            "old_revision_number": old_revision_number,
            "new_prescription_id": refreshed_rx.id,
            "new_revision_number": refreshed_rx.revision_number,
            "patient_id": refreshed_rx.patient_id,
            "doctor_id": refreshed_rx.doctor_id,
            "encounter_id": refreshed_rx.encounter_id,
            "status": refreshed_rx.status,
            "diagnosis": refreshed_rx.diagnosis,
            "items_count": len(refreshed_rx.items),
            "amendment_reason": refreshed_rx.amendment_reason,
        },
        reason=amendment_reason,
    )

    return _to_prescription_out(refreshed_rx)


@router.get(
    "/prescriptions/follow-ups",
    response_model=list[PrescriptionSummary],
    dependencies=[Depends(require(Permission.PRESCRIPTION_READ))],
)
def list_prescription_follow_ups(
    session: SessionDep,
    date_from: date | None = Query(None, description="Include follow-ups on or after this date"),
    date_to: date | None = Query(None, description="Include follow-ups on or before this date"),
    principal: Principal = Depends(current_principal),
) -> list[PrescriptionSummary]:
    """
    List dated prescription follow-ups for the authenticated doctor.

    Prescription follow-up dates are clinical information. This endpoint deliberately
    remains doctor-only and applies the existing doctor silo; it is not a receptionist
    appointment queue.
    """
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(
            status_code=403,
            code="doctor_only",
            message="Only authenticated doctors can inspect prescription follow-ups.",
        )

    if date_from is not None and date_to is not None and date_from > date_to:
        raise ApiError(
            status_code=422,
            code="invalid_date_range",
            message="The follow-up start date must be on or before the end date.",
        )

    stmt = (
        select(Prescription)
        .join(Patient, Prescription.patient_id == Patient.id)
        .where(
            Prescription.doctor_id == principal.doctor_id,
            Prescription.status == PrescriptionStatus.AUTHORISED.value,
            Prescription.follow_up_date.is_not(None),
            Patient.is_active.is_(True),
        )
        .options(
            selectinload(Prescription.patient),
            selectinload(Prescription.doctor),
            selectinload(Prescription.items),
        )
        .order_by(Prescription.follow_up_date.asc(), Prescription.created_at.desc())
    )
    if date_from is not None:
        stmt = stmt.where(Prescription.follow_up_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(Prescription.follow_up_date <= date_to)

    results = session.execute(stmt).scalars().all()
    return [
        PrescriptionSummary(
            id=rx.id,
            patient_id=rx.patient_id,
            patient_urn=rx.patient.urn if rx.patient else "",
            patient_name=rx.patient.full_name if rx.patient else "",
            doctor_id=rx.doctor_id,
            doctor_name=rx.doctor.name_en if rx.doctor else "",
            encounter_id=rx.encounter_id,
            status=rx.status,
            revision_number=rx.revision_number,
            supersedes_prescription_id=rx.supersedes_prescription_id,
            amendment_reason=rx.amendment_reason,
            diagnosis=rx.diagnosis,
            items_count=len(rx.items),
            follow_up_date=rx.follow_up_date,
            created_at=rx.created_at,
        )
        for rx in results
    ]


@router.get(
    "/prescriptions/{id}",
    response_model=PrescriptionOut,
    dependencies=[Depends(require(Permission.PRESCRIPTION_READ))],
)
def get_prescription(
    id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PrescriptionOut:
    """Retrieve full prescription details including all medication lines (RX-01, DWS-04)."""
    rx = get_scoped_or_404(
        session,
        Prescription,
        id,
        principal,
        family=ScopeFamily.CLINICAL_READ,
        doctor_id_col=Prescription.doctor_id,
    )
    return _to_prescription_out(rx)


@router.get(
    "/encounters/{encounter_id}/prescription",
    response_model=PrescriptionOut | None,
    dependencies=[Depends(require(Permission.PRESCRIPTION_READ))],
)
def get_encounter_prescription(
    encounter_id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PrescriptionOut | None:
    """Retrieve the active (AUTHORISED or DRAFT) prescription for an encounter, if any."""
    get_scoped_or_404(
        session,
        ClinicalEncounter,
        encounter_id,
        principal,
        family=ScopeFamily.CLINICAL_READ,
        doctor_id_col=ClinicalEncounter.doctor_id,
    )
    rx = session.execute(
        select(Prescription)
        .where(
            Prescription.encounter_id == encounter_id,
            Prescription.status.in_(
                [PrescriptionStatus.AUTHORISED.value, PrescriptionStatus.DRAFT.value]
            ),
        )
        .options(
            selectinload(Prescription.patient),
            selectinload(Prescription.doctor),
            selectinload(Prescription.items),
        )
        .order_by(Prescription.created_at.desc(), Prescription.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    return _to_prescription_out(rx) if rx else None


@router.get(
    "/patients/{patient_id}/prescriptions",
    response_model=list[PrescriptionSummary],
    dependencies=[Depends(require(Permission.PRESCRIPTION_READ))],
)
def list_patient_prescriptions(
    patient_id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> list[PrescriptionSummary]:
    """List historical prescriptions for a patient (including merged aliases) via CLINICAL_READ."""
    patient_ids = effective_patient_ids(session, patient_id)
    stmt = (
        select(Prescription)
        .where(
            Prescription.patient_id.in_(patient_ids),
            row_scope(principal, ScopeFamily.CLINICAL_READ, Prescription.doctor_id),
        )
        .options(
            selectinload(Prescription.patient),
            selectinload(Prescription.doctor),
            selectinload(Prescription.items),
        )
        .order_by(Prescription.created_at.desc(), Prescription.id.desc())
    )

    results = session.execute(stmt).scalars().all()
    audit_cross_doctor_list_read(
        session, principal, patient_id, "patient_prescriptions_list", results
    )

    return [
        PrescriptionSummary(
            id=p.id,
            patient_id=p.patient_id,
            patient_urn=p.patient.urn if p.patient else "",
            patient_name=p.patient.full_name if p.patient else "",
            doctor_id=p.doctor_id,
            doctor_name=p.doctor.name_en if p.doctor else "",
            encounter_id=p.encounter_id,
            status=p.status,
            revision_number=p.revision_number,
            supersedes_prescription_id=p.supersedes_prescription_id,
            amendment_reason=p.amendment_reason,
            diagnosis=p.diagnosis,
            items_count=len(p.items),
            follow_up_date=p.follow_up_date,
            created_at=p.created_at,
        )
        for p in results
    ]
