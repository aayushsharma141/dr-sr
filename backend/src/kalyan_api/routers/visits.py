"""Reception visits: list, detail, close at checkout and cancel (RF-12).

Reception and Admin read visits; only Reception closes or cancels them. A visit is opened by
check-in (see appointments.py), never here.
"""

from datetime import date

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, build_audit_context, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import Patient, Visit, VisitStatus
from kalyan_api.schemas.visits import (
    VisitCancelRequest,
    VisitCloseRequest,
    VisitConsultation,
    VisitDetail,
    VisitListResponse,
    VisitRead,
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


def _to_detail(session, visit: Visit, patient: Patient) -> VisitDetail:
    consultations = [
        VisitConsultation(
            appointment_id=a.id,
            doctor_id=a.doctor_id,
            doctor_name_en=a.doctor.name_en,
            token_number=a.token_number,
            appointment_status=a.status,
            consultation_status=a.consultation_status,
            appointment_date=a.appointment_date,
        )
        for a in visit_service.visit_consultations(session, visit.id)
    ]
    return VisitDetail(
        **_to_read(visit, patient).model_dump(),
        consultations=consultations,
        outstanding_paise=billing_service.visit_outstanding_paise(session, visit.id),
    )


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
    limit: int = Query(100, ge=1, le=500),
) -> VisitListResponse:
    """List visits, newest first."""
    filters = []
    if patient_id is not None:
        filters.append(Visit.patient_id == patient_id)
    if status is not None:
        filters.append(Visit.status == status.value)
    if visit_date is not None:
        filters.append(Visit.visit_date == visit_date)

    total = session.scalar(select(func.count()).select_from(Visit).where(*filters)) or 0
    rows = session.execute(
        select(Visit, Patient)
        .join(Patient, Patient.id == Visit.patient_id)
        .where(*filters)
        .order_by(Visit.visit_date.desc(), Visit.id.desc())
        .limit(limit)
    ).all()
    return VisitListResponse(total=total, visits=[_to_read(v, p) for v, p in rows])


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
