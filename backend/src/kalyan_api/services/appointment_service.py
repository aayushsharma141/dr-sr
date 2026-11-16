"""Appointment state rules (APT-02, RF-11).

Two sets of rules live here:

- ALLOWED_TRANSITIONS / validate_status_transition: the legacy single-status machine. Since
  RF-12 slice 2 it is only the fallback of validate_status_update for a booking that has not
  been checked in and is asked to make a move the new rules do not describe.
- BOOKING_TRANSITIONS / validate_booking_transition and CONSULTATION_TRANSITIONS /
  validate_consultation_transition (RF-11): the owner's decision of 2026-11-13 that the booking
  status and the consultation status are separate. validate_status_update routes
  PATCH /appointments/{id}/status through them.

The legacy appointment status is kept in step with the consultation status (MIRRORED_STATUS), so
the dashboards, queues and counters that still read it keep working until they move over.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Role
from kalyan_api.core.principal import Principal
from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    ClinicalEncounter,
    ConsultationStatus,
    Visit,
    VisitStatus,
)

# Valid status transitions
ALLOWED_TRANSITIONS: dict[AppointmentStatus, set[AppointmentStatus]] = {
    AppointmentStatus.BOOKED: {
        AppointmentStatus.ARRIVED,
        AppointmentStatus.CHECKED_IN,
        AppointmentStatus.CANCELLED,
        AppointmentStatus.NO_SHOW,
    },
    AppointmentStatus.TO_ARRIVE: {
        AppointmentStatus.REGISTERED,
        AppointmentStatus.CHECKED_IN,
        AppointmentStatus.ARRIVED,
        AppointmentStatus.WAITING,
        AppointmentStatus.CANCELLED,
        AppointmentStatus.NO_SHOW,
        AppointmentStatus.RESCHEDULED,
    },
    AppointmentStatus.REGISTERED: {
        AppointmentStatus.CHECKED_IN,
        AppointmentStatus.ARRIVED,
        AppointmentStatus.WAITING,
        AppointmentStatus.CANCELLED,
    },
    AppointmentStatus.CHECKED_IN: {
        AppointmentStatus.WAITING,
        AppointmentStatus.IN_CONSULTATION,
        AppointmentStatus.CANCELLED,
    },
    AppointmentStatus.WAITING: {
        AppointmentStatus.IN_CONSULTATION,
        AppointmentStatus.CANCELLED,
    },
    AppointmentStatus.ARRIVED: {
        AppointmentStatus.IN_CONSULTATION,
        AppointmentStatus.CANCELLED,
        AppointmentStatus.NO_SHOW,
    },
    AppointmentStatus.IN_CONSULTATION: {
        AppointmentStatus.DONE,
        AppointmentStatus.COMPLETED,
        AppointmentStatus.CANCELLED,
    },
    AppointmentStatus.DONE: set(),
    AppointmentStatus.COMPLETED: set(),
    AppointmentStatus.CANCELLED: set(),
    AppointmentStatus.NO_SHOW: set(),
    AppointmentStatus.RESCHEDULED: set(),
}


def validate_status_transition(
    appt: Appointment,
    target_status: AppointmentStatus,
    principal: Principal,
    cancellation_reason: str | None = None,
    session=None,
) -> None:
    """Validate that transition from appt.status to target_status is permitted."""
    current = AppointmentStatus(appt.status)

    if target_status == current:
        return

    allowed = ALLOWED_TRANSITIONS.get(current, set())
    if target_status not in allowed:
        raise ApiError(
            status_code=422,
            code="invalid_status_transition",
            message=(
                f"Cannot transition appointment from '{current.value}' to '{target_status.value}'."
            ),
            details={
                "current_status": current.value,
                "target_status": target_status.value,
                "allowed_transitions": [s.value for s in allowed],
            },
        )

    # Cancellation requires explanation
    if target_status == AppointmentStatus.CANCELLED and not (
        cancellation_reason and cancellation_reason.strip()
    ):
        raise ApiError(
            status_code=422,
            code="cancellation_reason_required",
            message="A cancellation reason must be provided when cancelling an appointment.",
        )

    # Cannot cancel if clinical consultation has already been finalised (BR-013)
    if target_status == AppointmentStatus.CANCELLED and session is not None:
        enc = session.scalar(
            select(ClinicalEncounter).where(ClinicalEncounter.appointment_id == appt.id)
        )
        if enc is not None and enc.is_finalised:
            raise ApiError(
                status_code=422,
                code="cannot_cancel_finalised",
                message=(
                    "Cannot cancel an appointment whose consultation has already been finalised."
                ),
            )

    # Doctor-only transition enforcement: IN_CONSULTATION and DONE must be initiated by DOCTOR
    if target_status in (AppointmentStatus.IN_CONSULTATION, AppointmentStatus.DONE):
        if principal.role != Role.DOCTOR:
            raise ApiError(
                status_code=403,
                code="doctor_status_forbidden",
                message=(f"Transitioning to '{target_status.value}' is restricted to doctors."),
            )
        # Furthermore, doctor can only transition their own appointments
        if principal.doctor_id != appt.doctor_id:
            raise ApiError(
                status_code=403,
                code="scope_forbidden",
                message="Doctors can only transition appointments assigned to them.",
            )


# ------------------------------------------------------------------ RF-11 booking status

BOOKING_TRANSITIONS: dict[AppointmentStatus, frozenset[AppointmentStatus]] = {
    AppointmentStatus.BOOKED: frozenset(
        {
            AppointmentStatus.ARRIVED,
            AppointmentStatus.CHECKED_IN,
            AppointmentStatus.NO_SHOW,
            AppointmentStatus.CANCELLED,
            AppointmentStatus.RESCHEDULED,
        }
    ),
    AppointmentStatus.TO_ARRIVE: frozenset(
        {
            AppointmentStatus.REGISTERED,
            AppointmentStatus.CHECKED_IN,
            AppointmentStatus.ARRIVED,
            AppointmentStatus.NO_SHOW,
            AppointmentStatus.CANCELLED,
            AppointmentStatus.RESCHEDULED,
        }
    ),
    AppointmentStatus.REGISTERED: frozenset(
        {
            AppointmentStatus.CHECKED_IN,
            AppointmentStatus.ARRIVED,
            AppointmentStatus.CANCELLED,
        }
    ),
    AppointmentStatus.CHECKED_IN: frozenset(),
    AppointmentStatus.WAITING: frozenset(),
    AppointmentStatus.COMPLETED: frozenset(),
    # A late arrival checks in the same day; otherwise the booking moves to a new date.
    AppointmentStatus.NO_SHOW: frozenset(
        {AppointmentStatus.ARRIVED, AppointmentStatus.CHECKED_IN, AppointmentStatus.RESCHEDULED}
    ),
    # After check-in the booking is settled; the consultation status carries on from there.
    AppointmentStatus.ARRIVED: frozenset(),
    AppointmentStatus.CANCELLED: frozenset(),
    AppointmentStatus.RESCHEDULED: frozenset(),
}

# Check-in and reschedule belong to reception (owner decision 10: Admin is oversight only).
RECEPTION_ONLY_BOOKING_TARGETS = frozenset(
    {AppointmentStatus.ARRIVED, AppointmentStatus.CHECKED_IN, AppointmentStatus.RESCHEDULED}
)


def _unchanged(current: str) -> ApiError:
    return ApiError(
        status_code=422,
        code="status_unchanged",
        message=f"The status is already {current}.",
    )


def _not_allowed(code: str, current: str, target: str, allowed: frozenset) -> ApiError:
    return ApiError(
        status_code=422,
        code=code,
        message=f"Cannot move from {current} to {target}.",
        details={
            "current_status": current,
            "target_status": target,
            "allowed_transitions": sorted(s.value for s in allowed),
        },
    )


def _require_booking_actor(
    appt: Appointment, target: AppointmentStatus, principal: Principal
) -> None:
    if principal.role == Role.RECEPTION:
        return
    if target in RECEPTION_ONLY_BOOKING_TARGETS or principal.role != Role.DOCTOR:
        raise ApiError(
            status_code=403,
            code="reception_only",
            message="Only reception can make this change.",
        )
    # A doctor may still mark their own booking as not arrived or cancel it, as before RF-11.
    if principal.doctor_id != appt.doctor_id:
        raise ApiError(
            status_code=403,
            code="scope_forbidden",
            message="Doctors can only change appointments assigned to them.",
        )


def validate_booking_transition(
    appt: Appointment,
    target: AppointmentStatus,
    principal: Principal,
    reason: str | None = None,
) -> None:
    """Check a booking-status change against the RF-11 rules; raise ApiError if refused."""
    current = AppointmentStatus(appt.status)
    if target == current:
        raise _unchanged(current.value)
    allowed = BOOKING_TRANSITIONS.get(current, frozenset())
    if target not in allowed:
        raise _not_allowed("invalid_status_transition", current.value, target.value, allowed)

    _require_booking_actor(appt, target, principal)

    today = clock.ist_today()
    if target in (AppointmentStatus.ARRIVED, AppointmentStatus.CHECKED_IN) and appt.appointment_date != today:
        raise ApiError(
            status_code=422,
            code="check_in_wrong_day",
            message="Only today's appointments can be checked in. Reschedule this one instead.",
            details={
                "appointment_date": appt.appointment_date.isoformat(),
                "today": today.isoformat(),
            },
        )
    if target == AppointmentStatus.NO_SHOW and appt.appointment_date > today:
        raise ApiError(
            status_code=422,
            code="no_show_before_date",
            message="A patient can be marked as not arrived only on or after the appointment date.",
            details={
                "appointment_date": appt.appointment_date.isoformat(),
                "today": today.isoformat(),
            },
        )
    if target == AppointmentStatus.CANCELLED and not (reason and reason.strip()):
        raise ApiError(
            status_code=422,
            code="cancellation_reason_required",
            message="A cancellation reason must be provided when cancelling an appointment.",
        )


# ------------------------------------------------------------- RF-11 consultation status

CONSULTATION_TRANSITIONS: dict[ConsultationStatus, frozenset[ConsultationStatus]] = {
    ConsultationStatus.WAITING: frozenset(
        {ConsultationStatus.IN_CONSULTATION, ConsultationStatus.CANCELLED}
    ),
    ConsultationStatus.IN_CONSULTATION: frozenset(
        {ConsultationStatus.COMPLETED, ConsultationStatus.CANCELLED}
    ),
    ConsultationStatus.COMPLETED: frozenset(),
    ConsultationStatus.CANCELLED: frozenset(),
}


def validate_consultation_transition(
    session: Session,
    appt: Appointment,
    target: ConsultationStatus,
    principal: Principal,
    reason: str | None = None,
) -> None:
    """Check a consultation-status change against the RF-11 rules; raise ApiError if refused.

    The doctor starts and completes their own consultations. Reception or the treating doctor
    may cancel one, with a reason, until its encounter is finalised (BR-013). Nothing changes
    once the visit is closed or cancelled.
    """
    # consultation_status is set at check-in (and backfilled for earlier rows); the appointment
    # status alone cannot say, because it moves on to IN_CONSULTATION and DONE.
    if appt.consultation_status is None:
        raise ApiError(
            status_code=422,
            code="not_checked_in",
            message="The patient has not been checked in for this appointment.",
        )
    if appt.visit_id is not None:
        visit = session.get(Visit, appt.visit_id)
        if visit is not None and visit.status != VisitStatus.OPEN.value:
            raise ApiError(
                status_code=422,
                code="visit_not_open",
                message=f"The visit is {visit.status.lower()} and can no longer change.",
            )

    current = ConsultationStatus(appt.consultation_status)
    if target == current:
        raise _unchanged(current.value)
    allowed = CONSULTATION_TRANSITIONS[current]
    if target not in allowed:
        raise _not_allowed("invalid_consultation_transition", current.value, target.value, allowed)

    if target in (ConsultationStatus.IN_CONSULTATION, ConsultationStatus.COMPLETED):
        if principal.role != Role.DOCTOR:
            raise ApiError(
                status_code=403,
                code="doctor_status_forbidden",
                message="Only the treating doctor can start or complete a consultation.",
            )
        if principal.doctor_id != appt.doctor_id:
            raise ApiError(
                status_code=403,
                code="scope_forbidden",
                message="Doctors can only change consultations assigned to them.",
            )
        return

    # target is CANCELLED
    if principal.role == Role.DOCTOR:
        if principal.doctor_id != appt.doctor_id:
            raise ApiError(
                status_code=403,
                code="scope_forbidden",
                message="Doctors can only change consultations assigned to them.",
            )
    elif principal.role != Role.RECEPTION:
        raise ApiError(
            status_code=403,
            code="reception_or_doctor_only",
            message="Only reception or the treating doctor can cancel a consultation.",
        )
    if not (reason and reason.strip()):
        raise ApiError(
            status_code=422,
            code="cancellation_reason_required",
            message="A reason must be given when cancelling a consultation.",
        )
    enc = session.scalar(
        select(ClinicalEncounter).where(ClinicalEncounter.appointment_id == appt.id)
    )
    if enc is not None and enc.is_finalised:
        raise ApiError(
            status_code=422,
            code="cannot_cancel_finalised",
            message="Cannot cancel a consultation whose encounter has already been finalised.",
        )


# ------------------------------------------------------- RF-12 slice 2: applying the rules

# The legacy appointment status that goes with each consultation status.
MIRRORED_STATUS: dict[ConsultationStatus, AppointmentStatus] = {
    ConsultationStatus.WAITING: AppointmentStatus.CHECKED_IN,
    ConsultationStatus.IN_CONSULTATION: AppointmentStatus.IN_CONSULTATION,
    ConsultationStatus.COMPLETED: AppointmentStatus.DONE,
    ConsultationStatus.CANCELLED: AppointmentStatus.CANCELLED,
}

# What PATCH /appointments/{id}/status asks for, as a consultation status, once checked in.
_STATUS_TO_CONSULTATION: dict[AppointmentStatus, ConsultationStatus] = {
    AppointmentStatus.IN_CONSULTATION: ConsultationStatus.IN_CONSULTATION,
    AppointmentStatus.DONE: ConsultationStatus.COMPLETED,
    AppointmentStatus.CANCELLED: ConsultationStatus.CANCELLED,
}


def validate_status_update(
    session: Session,
    appt: Appointment,
    target: AppointmentStatus,
    principal: Principal,
    reason: str | None = None,
) -> ConsultationStatus | None:
    """Check a PATCH /appointments/{id}/status request; return the consultation status it sets.

    Check-in (target ARRIVED or CHECKED_IN) is handled by booking_service.check_in, not here. A checked-in
    patient can only move through the consultation: start, complete or cancel it. A booking that
    is not checked in can be marked not arrived or cancelled. Raises ApiError when refused; the
    error codes of the old status machine are kept (invalid_status_transition).
    """
    current = AppointmentStatus(appt.status)
    if target == current:
        raise _unchanged(current.value)

    if appt.consultation_status is not None:
        consultation_target = _STATUS_TO_CONSULTATION.get(target)
        if consultation_target is None:
            allowed = frozenset(
                MIRRORED_STATUS[c]
                for c in CONSULTATION_TRANSITIONS[ConsultationStatus(appt.consultation_status)]
            )
            raise _not_allowed("invalid_status_transition", current.value, target.value, allowed)
        try:
            validate_consultation_transition(session, appt, consultation_target, principal, reason)
        except ApiError as error:
            if error.code != "invalid_consultation_transition":
                raise
            raise ApiError(
                status_code=error.status_code,
                code="invalid_status_transition",
                message=error.message,
                **error.extras,
            ) from error
        return consultation_target

    if target in (AppointmentStatus.NO_SHOW, AppointmentStatus.CANCELLED):
        validate_booking_transition(appt, target, principal, reason)
        return None

    # Anything else from a booking that has not been checked in (a start or finish, a move to
    # another date) is not a valid status change; the legacy table says so with its usual error.
    validate_status_transition(appt, target, principal, reason, session=session)
    return None


def _set_consultation_status(appt: Appointment, target: ConsultationStatus) -> None:
    appt.consultation_status = target.value
    appt.status = MIRRORED_STATUS[target].value
    appt.status_updated_at = clock.utcnow()
    appt.version_id += 1


def start_consultation(session: Session, appt: Appointment, principal: Principal) -> None:
    """The treating doctor starts the consultation by opening the encounter.

    WAITING -> IN_CONSULTATION. Already in consultation is not an error, so reopening the same
    encounter is harmless.
    """
    if appt.consultation_status == ConsultationStatus.IN_CONSULTATION.value:
        return
    validate_consultation_transition(session, appt, ConsultationStatus.IN_CONSULTATION, principal)
    _set_consultation_status(appt, ConsultationStatus.IN_CONSULTATION)


def complete_consultation(session: Session, appt: Appointment, principal: Principal) -> None:
    """The treating doctor completes the consultation (finalises the encounter)."""
    if appt.consultation_status == ConsultationStatus.COMPLETED.value:
        return
    validate_consultation_transition(session, appt, ConsultationStatus.COMPLETED, principal)
    _set_consultation_status(appt, ConsultationStatus.COMPLETED)
