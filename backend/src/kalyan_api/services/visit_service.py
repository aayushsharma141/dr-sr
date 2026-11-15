"""Reception visits (RF-11): opened or joined at check-in, closed at checkout, or cancelled.

Owner decisions of 2026-11-13:
- A visit is created only at check-in. A patient has at most one OPEN visit; a second doctor
  on the same day joins it.
- Reception closes the visit ("Patient Out") once at least one consultation is COMPLETED and
  none is still WAITING or IN_CONSULTATION. A visit may close with money still due only when a
  reason is recorded; the balance then shows in Pending Dues.
- If every consultation was cancelled (the patient left), the visit is CANCELLED with a reason
  and can never be closed. Open visits are never closed automatically.
- A closed or cancelled visit does not change again.

Not wired to an endpoint until RF-12. Callers write the audit rows, as the routers do today.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.models import Appointment, ConsultationStatus, Patient, Visit, VisitStatus

ACTIVE_CONSULTATION_STATUSES = (
    ConsultationStatus.WAITING.value,
    ConsultationStatus.IN_CONSULTATION.value,
)


def lock_open_visit(session: Session, patient_id: int) -> Visit | None:
    """Return the patient's OPEN visit under a row lock, or None."""
    return session.scalar(
        select(Visit)
        .where(Visit.patient_id == patient_id, Visit.status == VisitStatus.OPEN.value)
        .with_for_update()
    )


def open_or_join_visit(session: Session, patient_id: int, opened_by_user_id: int) -> Visit:
    """Return today's OPEN visit for the patient, opening one if there is none."""
    return join_or_open_visit(session, patient_id, opened_by_user_id)[0]


def join_or_open_visit(
    session: Session,
    patient_id: int,
    opened_by_user_id: int,
    *,
    referral_source: str | None = None,
    referrer_name: str | None = None,
) -> tuple[Visit, bool]:
    """Return (visit, opened): today's OPEN visit for the patient, and whether this call opened it.

    The patient row is locked first, so two desks checking in the same patient at once cannot
    both open a visit. An OPEN visit left over from an earlier day is not joined: reception must
    close or cancel it first, because visits are never closed automatically. A visit opened here
    records the referral given (OD-22-16) in the same insert; a joined visit keeps its own.
    """
    patient = session.get(Patient, patient_id, with_for_update=True)
    if patient is None or not patient.is_active:
        raise ApiError(
            status_code=404,
            code="patient_not_found",
            message="Patient not found or inactive.",
        )

    today = clock.ist_today()
    visit = lock_open_visit(session, patient_id)
    if visit is not None:
        if visit.visit_date != today:
            raise ApiError(
                status_code=409,
                code="open_visit_from_earlier_day",
                message=(
                    f"This patient still has an open visit from {visit.visit_date:%d %b %Y}. "
                    "Close or cancel it before checking the patient in again."
                ),
                details={"visit_id": visit.id, "visit_date": visit.visit_date.isoformat()},
            )
        return visit, False

    visit = Visit(
        patient_id=patient_id,
        visit_date=today,
        status=VisitStatus.OPEN.value,
        opened_by_user_id=opened_by_user_id,
    )
    if referral_source is not None:
        visit.referral_source = referral_source
        visit.referrer_name = referrer_name
        visit.referral_recorded_by_user_id = opened_by_user_id
        visit.referral_recorded_at = clock.utcnow()
    session.add(visit)
    session.flush()
    return visit, True


def visit_consultations(session: Session, visit_id: int) -> list[Appointment]:
    """Appointments checked into the visit, one per doctor seen, in check-in order."""
    return list(
        session.scalars(
            select(Appointment).where(Appointment.visit_id == visit_id).order_by(Appointment.id)
        )
    )


def _require_open(visit: Visit) -> None:
    if visit.status != VisitStatus.OPEN.value:
        raise ApiError(
            status_code=422,
            code="visit_not_open",
            message=f"The visit is {visit.status.lower()} and can no longer change.",
        )


def _active_consultation_ids(consultations: list[Appointment]) -> list[int]:
    return [c.id for c in consultations if c.consultation_status in ACTIVE_CONSULTATION_STATUSES]


def close_visit(
    session: Session,
    visit: Visit,
    *,
    closed_by_user_id: int,
    version_id: int,
    outstanding_paise: int,
    reason: str | None = None,
) -> Visit:
    """Close the visit at checkout ("Patient Out").

    outstanding_paise is the balance still due on the visit, computed by the caller from the
    billing records. A balance above zero needs a reason.
    """
    if outstanding_paise < 0:
        raise ValueError("outstanding_paise cannot be negative")
    require_version(visit, version_id, label="visit")
    _require_open(visit)

    consultations = visit_consultations(session, visit.id)
    active = _active_consultation_ids(consultations)
    if active:
        raise ApiError(
            status_code=422,
            code="consultation_in_progress",
            message="A consultation in this visit is still waiting or in progress.",
            details={"appointment_ids": active},
        )
    if not any(c.consultation_status == ConsultationStatus.COMPLETED.value for c in consultations):
        raise ApiError(
            status_code=422,
            code="no_completed_consultation",
            message="No doctor completed a consultation in this visit. Cancel the visit instead.",
        )

    note = (reason or "").strip()
    if outstanding_paise > 0 and not note:
        raise ApiError(
            status_code=422,
            code="close_reason_required",
            message=(
                f"₹{outstanding_paise / 100:,.2f} is still due. Record why the visit is closed "
                "with a balance; the balance moves to Pending Dues."
            ),
            details={"outstanding_paise": outstanding_paise},
        )

    visit.status = VisitStatus.CLOSED.value
    visit.closed_at = clock.utcnow()
    visit.closed_by_user_id = closed_by_user_id
    visit.close_reason = note or None
    session.flush()
    return visit


def cancel_visit(
    session: Session,
    visit: Visit,
    *,
    cancelled_by_user_id: int,
    version_id: int,
    reason: str,
) -> Visit:
    """Cancel a visit in which nobody was seen: every consultation must already be cancelled."""
    require_version(visit, version_id, label="visit")
    _require_open(visit)

    note = (reason or "").strip()
    if not note:
        raise ApiError(
            status_code=422,
            code="cancel_reason_required",
            message="A reason must be given when cancelling a visit.",
        )

    consultations = visit_consultations(session, visit.id)
    if any(c.consultation_status == ConsultationStatus.COMPLETED.value for c in consultations):
        raise ApiError(
            status_code=422,
            code="visit_has_completed_consultation",
            message=(
                "A doctor completed a consultation in this visit. Close it at checkout instead."
            ),
        )
    active = _active_consultation_ids(consultations)
    if active:
        raise ApiError(
            status_code=422,
            code="consultation_in_progress",
            message="Cancel the waiting or ongoing consultations before cancelling the visit.",
            details={"appointment_ids": active},
        )

    visit.status = VisitStatus.CANCELLED.value
    visit.cancelled_at = clock.utcnow()
    visit.cancelled_by_user_id = cancelled_by_user_id
    visit.cancel_reason = note
    session.flush()
    return visit
