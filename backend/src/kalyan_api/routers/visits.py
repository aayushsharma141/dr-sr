"""Reception visits: list, detail, close at checkout and cancel (RF-12).

Reception and Admin read visits; only Reception closes or cancels them. A visit is opened by
check-in (see appointments.py), never here.
"""

from datetime import date, datetime

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import exists, func, select

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, build_audit_context, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import Appointment, ConsultationStatus, Patient, Visit, VisitStatus
from kalyan_api.schemas.visits import (
    VisitCancelRequest,
    VisitCloseRequest,
    VisitConsultation,
    VisitDetail,
    VisitListResponse,
    VisitPayment,
    VisitRead,
    VisitSummary,
)
from kalyan_api.services import audit_service, billing_service, visit_service
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(prefix="/visits", tags=["visits"])


def _to_read(visit: Visit, patient: Patient) -> VisitRead:
    return VisitRead(
        id=visit.id,
        patient_id=visit.patient_id,
        patient_urn=patient.urn,
        patient_name=patient.full_name,
        visit_date=visit.visit_date,
        status=visit.status,
        opened_by_user_id=visit.opened_by_user_id,
        opened_at=visit.opened_at,
        closed_by_user_id=visit.closed_by_user_id,
        closed_at=visit.closed_at,
        close_reason=visit.close_reason,
        cancelled_by_user_id=visit.cancelled_by_user_id,
        cancelled_at=visit.cancelled_at,
        cancel_reason=visit.cancel_reason,
        version_id=visit.version_id,
    )


ACTIVE_CONSULTATIONS = (
    ConsultationStatus.WAITING.value,
    ConsultationStatus.IN_CONSULTATION.value,
)


def _to_detail(session, visit: Visit, patient: Patient) -> VisitDetail:
    totals = billing_service.visit_totals(session, [visit.id])[visit.id]
    lines = billing_service.visit_charge_lines(session, [visit.id])[visit.id]
    line_for = {line.appointment_id: line for line in lines}
    consultations = []
    for a in visit_service.visit_consultations(session, visit.id):
        line = line_for.get(a.id)
        consultations.append(
            VisitConsultation(
                appointment_id=a.id,
                doctor_id=a.doctor_id,
                doctor_name_en=a.doctor.name_en,
                token_number=a.token_number,
                appointment_status=a.status,
                consultation_status=a.consultation_status,
                appointment_date=a.appointment_date,
                fee_paise=line.fee_paise if line else 0,
                paid_paise=line.paid_paise if line else 0,
                balance_paise=line.balance_paise if line else 0,
                collectable=line.collectable if line else False,
            )
        )
    payments = billing_service.visit_payments(session, visit.id)
    return VisitDetail(
        **_to_read(visit, patient).model_dump(),
        consultations=consultations,
        payments=[
            VisitPayment(
                id=p.id,
                appointment_id=p.appointment_id,
                receipt_number=p.receipt_number,
                amount_paise=p.amount_paise,
                payment_method=p.payment_method,
                is_reversed=p.is_reversed,
                created_at=p.created_at,
                created_by_username=p.created_by_user.username if p.created_by_user else "",
            )
            for p in payments
            if p.appointment_id is not None
        ],
        total_paid_paise=totals.paid_paise,
        outstanding_paise=totals.due_paise,
    )


def _to_summaries(session, rows) -> list[VisitSummary]:
    """List rows with who was seen, what is still active and what is due, in few queries."""
    visit_ids = [v.id for v, _ in rows]
    lines_by_visit = billing_service.visit_charge_lines(session, visit_ids)
    totals_by_visit = billing_service.visit_totals(session, visit_ids)

    appts = session.execute(
        select(
            Appointment.visit_id,
            Appointment.token_number,
            Appointment.consultation_status,
            Appointment.status_updated_at,
        )
        .where(Appointment.visit_id.in_(visit_ids))
        .order_by(Appointment.id.asc())
    ).all()

    tokens_by_visit: dict[int, list[int]] = {v_id: [] for v_id in visit_ids}
    last_completed_by_visit: dict[int, datetime | None] = {v_id: None for v_id in visit_ids}

    for v_id, token_num, c_status, status_updated_at in appts:
        if c_status != ConsultationStatus.CANCELLED.value and token_num is not None:
            tokens_by_visit[v_id].append(token_num)
        if c_status == ConsultationStatus.COMPLETED.value and status_updated_at is not None:
            prev = last_completed_by_visit[v_id]
            if prev is None or status_updated_at > prev:
                last_completed_by_visit[v_id] = status_updated_at

    summaries = []
    for visit, patient in rows:
        lines = lines_by_visit[visit.id]
        totals = totals_by_visit[visit.id]
        summaries.append(
            VisitSummary(
                **_to_read(visit, patient).model_dump(),
                doctors=list(dict.fromkeys(line.doctor_name_en for line in lines)),
                completed_consultations=sum(
                    1
                    for line in lines
                    if line.consultation_status == ConsultationStatus.COMPLETED.value
                ),
                active_consultations=sum(
                    1 for line in lines if line.consultation_status in ACTIVE_CONSULTATIONS
                ),
                outstanding_paise=totals.due_paise,
                token_numbers=tokens_by_visit.get(visit.id, []),
                last_completed_at=last_completed_by_visit.get(visit.id),
            )
        )
    return summaries


def _locked_visit(session, visit_id: int) -> tuple[Visit, Patient]:
    row = session.execute(
        select(Visit, Patient)
        .join(Patient, Patient.id == Visit.patient_id)
        .where(Visit.id == visit_id)
        .with_for_update(of=Visit)
    ).first()
    if row is None:
        raise ApiError(status_code=404, code="visit_not_found", message="Visit not found.")
    return row[0], row[1]


@router.get(
    "",
    response_model=VisitListResponse,
    dependencies=[Depends(require(Permission.VISIT_READ))],
)
def list_visits(
    session: SessionDep,
    patient_id: int | None = Query(None, description="Filter by patient ID"),
    status: VisitStatus | None = Query(None, description="Filter by status"),
    visit_date: date | None = Query(None, description="Filter by visit date"),
    ready_for_checkout: bool = Query(
        False,
        description=(
            "Only open visits where a doctor completed a consultation and none is still "
            "waiting or in progress"
        ),
    ),
    limit: int = Query(100, ge=1, le=500),
) -> VisitListResponse:
    """List visits, newest first."""
    filters = []
    if patient_id is not None:
        merged_ids = session.scalars(
            select(Patient.id).where(Patient.merged_into_id == patient_id)
        ).all()
        effective_ids = [patient_id, *merged_ids]
        filters.append(Visit.patient_id.in_(effective_ids))
    if status is not None:
        filters.append(Visit.status == status.value)
    if visit_date is not None:
        filters.append(Visit.visit_date == visit_date)
    if ready_for_checkout:
        completed = exists().where(
            Appointment.visit_id == Visit.id,
            Appointment.consultation_status == ConsultationStatus.COMPLETED.value,
        )
        active = exists().where(
            Appointment.visit_id == Visit.id,
            Appointment.consultation_status.in_(ACTIVE_CONSULTATIONS),
        )
        filters.extend([Visit.status == VisitStatus.OPEN.value, completed, ~active])

    total = session.scalar(select(func.count()).select_from(Visit).where(*filters)) or 0
    rows = session.execute(
        select(Visit, Patient)
        .join(Patient, Patient.id == Visit.patient_id)
        .where(*filters)
        .order_by(Visit.visit_date.desc(), Visit.id.desc())
        .limit(limit)
    ).all()
    return VisitListResponse(total=total, visits=_to_summaries(session, rows))


@router.get(
    "/{id}",
    response_model=VisitDetail,
    dependencies=[Depends(require(Permission.VISIT_READ))],
)
def get_visit(id: int, session: SessionDep) -> VisitDetail:
    """Fetch a visit with its consultations and the balance still due on it."""
    row = session.execute(
        select(Visit, Patient).join(Patient, Patient.id == Visit.patient_id).where(Visit.id == id)
    ).first()
    if row is None:
        raise ApiError(status_code=404, code="visit_not_found", message="Visit not found.")
    return _to_detail(session, row[0], row[1])


@router.post(
    "/{id}/close",
    response_model=VisitDetail,
    dependencies=[Depends(require(Permission.VISIT_WRITE))],
)
def close_visit(
    id: int,
    payload: VisitCloseRequest,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> VisitDetail:
    """Close the visit at checkout ("Patient Out"); a reason is needed while money is due."""
    visit, patient = _locked_visit(session, id)
    before = {"status": visit.status, "version_id": visit.version_id}
    outstanding = billing_service.visit_outstanding_paise(session, visit.id)

    visit_service.close_visit(
        session,
        visit,
        closed_by_user_id=principal.user_id,
        version_id=payload.version_id,
        outstanding_paise=outstanding,
        reason=payload.reason,
    )
    audit_service.record(
        session,
        build_audit_context(request, principal),
        action=AuditAction.VISIT_CLOSED,
        entity_type="visit",
        entity_id=visit.id,
        before=before,
        after={
            "status": visit.status,
            "closed_at": visit.closed_at.isoformat() if visit.closed_at else None,
            "outstanding_paise": outstanding,
        },
        reason=visit.close_reason,
    )
    return _to_detail(session, visit, patient)


@router.post(
    "/{id}/cancel",
    response_model=VisitDetail,
    dependencies=[Depends(require(Permission.VISIT_WRITE))],
)
def cancel_visit(
    id: int,
    payload: VisitCancelRequest,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> VisitDetail:
    """Cancel a visit in which nobody was seen; every consultation must already be cancelled."""
    visit, patient = _locked_visit(session, id)
    before = {"status": visit.status, "version_id": visit.version_id}

    visit_service.cancel_visit(
        session,
        visit,
        cancelled_by_user_id=principal.user_id,
        version_id=payload.version_id,
        reason=payload.reason,
    )
    audit_service.record(
        session,
        build_audit_context(request, principal),
        action=AuditAction.VISIT_CANCELLED,
        entity_type="visit",
        entity_id=visit.id,
        before=before,
        after={
            "status": visit.status,
            "cancelled_at": visit.cancelled_at.isoformat() if visit.cancelled_at else None,
        },
        reason=visit.cancel_reason,
    )
    return _to_detail(session, visit, patient)
