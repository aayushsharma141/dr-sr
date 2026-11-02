"""Structured doctor prescriptions and medication item endpoints (RX-01).

Guarantees:
- Licensed doctor authorship required for prescribing (PRESCRIPTION_WRITE).
- In-transaction audit trail with item counts and clinical diagnosis.
- Sequential medication order validation.
"""

from datetime import date

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission, Role
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.models import (
    ClinicalEncounter,
    Patient,
    Prescription,
    PrescriptionItem,
)
from kalyan_api.schemas.prescriptions import (
    PrescriptionCreate,
    PrescriptionItemOut,
    PrescriptionOut,
    PrescriptionSummary,
)
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction

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
        )
        for it in sorted_items
    ]

    return PrescriptionOut(
        id=rx.id,
        patient_id=rx.patient_id,
        patient_urn=rx.patient.urn if rx.patient else "",
        patient_name=rx.patient.full_name if rx.patient else "",
        doctor_id=rx.doctor_id,
        doctor_name=rx.doctor.name_en if rx.doctor else "",
        encounter_id=rx.encounter_id,
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
    """Issue a new structured prescription with medication lines (RX-01)."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(
            status_code=403,
            code="doctor_only",
            message="Only authenticated doctors can issue prescriptions.",
        )

    patient = session.get(Patient, payload.patient_id)
    if not patient or not patient.is_active:
        raise ApiError(status_code=404, code="patient_not_found", message="Patient not found.")

    if payload.encounter_id is not None:
        encounter = session.get(ClinicalEncounter, payload.encounter_id)
        if not encounter or encounter.doctor_id != principal.doctor_id:
            raise ApiError(
                status_code=404,
                code="encounter_not_found",
                message="Clinical encounter not found or not assigned to this doctor.",
            )

    # Validate distinct item orders
    orders = [item.item_order for item in payload.items]
    if len(orders) != len(set(orders)):
        raise ApiError(
            status_code=422,
            code="duplicate_item_order",
            message="Each prescription item must have a unique item order.",
        )

    rx = Prescription(
        patient_id=payload.patient_id,
        doctor_id=principal.doctor_id,
        encounter_id=payload.encounter_id,
        diagnosis=payload.diagnosis,
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
        )
        session.add(item)

    session.flush()

    # Re-query with eager relationships
    stmt = (
        select(Prescription)
        .where(Prescription.id == rx.id)
        .options(selectinload(Prescription.items))
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
            "diagnosis": refreshed_rx.diagnosis,
            "items_count": len(refreshed_rx.items),
        },
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
    """Retrieve full prescription details including all medication lines (RX-01)."""
    stmt = (
        select(Prescription).where(Prescription.id == id).options(selectinload(Prescription.items))
    )
    rx = session.execute(stmt).scalar_one_or_none()
    if not rx:
        raise ApiError(
            status_code=404,
            code="prescription_not_found",
            message="Prescription not found.",
        )

    # Doctor silo: doctor can only read prescriptions they issued
    if principal.role == Role.DOCTOR and rx.doctor_id != principal.doctor_id:
        raise ApiError(
            status_code=404,
            code="prescription_not_found",
            message="Prescription not found.",
        )

    return _to_prescription_out(rx)


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
    """List historical prescriptions for a given patient."""
    stmt = (
        select(Prescription)
        .where(Prescription.patient_id == patient_id)
        .options(selectinload(Prescription.items))
        .order_by(Prescription.created_at.desc())
    )

    if principal.role == Role.DOCTOR:
        stmt = stmt.where(Prescription.doctor_id == principal.doctor_id)

    results = session.execute(stmt).scalars().all()

    return [
        PrescriptionSummary(
            id=p.id,
            patient_id=p.patient_id,
            patient_urn=p.patient.urn if p.patient else "",
            patient_name=p.patient.full_name if p.patient else "",
            doctor_id=p.doctor_id,
            doctor_name=p.doctor.name_en if p.doctor else "",
            encounter_id=p.encounter_id,
            diagnosis=p.diagnosis,
            items_count=len(p.items),
            follow_up_date=p.follow_up_date,
            created_at=p.created_at,
        )
        for p in results
    ]
