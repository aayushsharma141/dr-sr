"""Booking, check-in, walk-in and reschedule (RF-12).

The booking checks that used to live inline in POST /appointments are here so that a phone
booking, a walk-in and a reschedule all apply the same rules. Callers write the audit rows.

Owner decisions of 2026-11-13: the token is issued at check-in (so a booking made here with
issue_token=False has none); check-in opens or joins the patient's visit and puts the
consultation in the doctor's waiting list; a reschedule keeps the old booking, marked
RESCHEDULED, and creates a new linked one.
"""

from dataclasses import dataclass
from datetime import date, time

from sqlalchemy import select
from sqlalchemy.orm import Session, lazyload

from kalyan_api import clock
from kalyan_api.core.errors import ApiError
from kalyan_api.core.principal import Principal
from kalyan_api.models import (
    Appointment,
    AppointmentSource,
    AppointmentStatus,
    ConsultationStatus,
    Department,
    Doctor,
    Patient,
    Visit,
)
from kalyan_api.services import token_service, visit_service
from kalyan_api.services.appointment_service import validate_booking_transition

# Statuses that count as an existing booking for the duplicate rule (BR-006).
ACTIVE_BOOKING_STATUSES = (
    AppointmentStatus.BOOKED.value,
    AppointmentStatus.ARRIVED.value,
    AppointmentStatus.IN_CONSULTATION.value,
    AppointmentStatus.DONE.value,
)


def lock_appointment(session: Session, appointment_id: int) -> Appointment | None:
    """Read the appointment under a row lock, so two desks cannot change it at once.

    Appointment loads its patient, doctor, department and creator with outer joins, and
    PostgreSQL refuses FOR UPDATE on those. The lazyload options keep the query to one table;
    the relationships load later, when they are read.
    """
    return session.scalar(
        select(Appointment)
        .where(Appointment.id == appointment_id)
        .options(
            lazyload(Appointment.patient),
            lazyload(Appointment.doctor),
            lazyload(Appointment.department),
            lazyload(Appointment.created_by_user),
        )
        .with_for_update()
    )


def lock_doctor_for_booking(session: Session, doctor_id: int) -> Doctor | None:
    """Lock the doctor row, as assign_doctor_departments does, so membership changes are awaited."""
    return session.scalar(select(Doctor).where(Doctor.id == doctor_id).with_for_update())


def lock_department_for_booking(session: Session, department_id: int) -> Department | None:
    """Read the department under a row lock, so a concurrent deactivation cannot slip past.

    Deactivation locks the same row, so either this read waits for it and sees is_active=False,
    or the deactivation waits for this booking to commit. Without the lock, a booking can read
    the department as active while it is being deactivated and still insert the appointment.
    """
    return session.scalar(
        select(Department).where(Department.id == department_id).with_for_update()
    )


def create_booking(
    session: Session,
    principal: Principal,
    *,
    patient_id: int,
    doctor_id: int,
    department_id: int,
    appointment_date: date,
    notes: str | None = None,
    override_reason: str | None = None,
    source: AppointmentSource | None = None,
    expected_time: time | None = None,
    rescheduled_from_id: int | None = None,
    issue_token: bool = True,
) -> Appointment:
    """Create a BOOKED appointment after the booking checks; raise ApiError if one fails."""
    # Lock the patient row to serialise concurrent bookings (FB-03).
    patient = session.get(Patient, patient_id, with_for_update=True)
    if not patient or not patient.is_active:
        raise ApiError(
            status_code=404,
            code="patient_not_found",
            message="Patient not found or inactive.",
        )

    doctor = lock_doctor_for_booking(session, doctor_id)
    if not doctor or not doctor.is_active:
        raise ApiError(
            status_code=404,
            code="doctor_not_found",
            message="Doctor not found or inactive.",
        )

    department = lock_department_for_booking(session, department_id)
    if department is None:
        raise ApiError(
            status_code=422,
            code="department_not_found",
            message="Selected department does not exist.",
        )
    if not department.is_active:
        raise ApiError(
            status_code=422,
            code="department_inactive",
            message="Selected department is inactive and cannot accept new appointments.",
        )
    if department not in doctor.departments:
        raise ApiError(
            status_code=422,
            code="doctor_department_mismatch",
            message="Selected doctor is not assigned to the selected department.",
        )

    # Duplicate same-day booking prevention (BR-006).
    existing_appt = session.scalar(
        select(Appointment).where(
            Appointment.patient_id == patient_id,
            Appointment.doctor_id == doctor_id,
            Appointment.appointment_date == appointment_date,
            Appointment.status.in_(ACTIVE_BOOKING_STATUSES),
        )
    )
    if existing_appt is not None and len((override_reason or "").strip()) < 5:
        raise ApiError(
            status_code=409,
            code="duplicate_appointment",
            message=(
                "Patient already has an active appointment with this doctor on this date. "
                "An override reason of at least 5 characters is required."
            ),
            details={
                "existing_appointment_id": existing_appt.id,
                "existing_token_number": existing_appt.token_number,
                "existing_status": existing_appt.status,
            },
        )

    token_number = (
        token_service.generate_next_daily_token(session, doctor_id, appointment_date)
        if issue_token
        else None
    )

    override_text = (override_reason or "").strip() or None
    final_notes = notes
    if override_text:
        final_notes = (
            f"{final_notes} | [Override: {override_text}]"
            if final_notes
            else f"[Override: {override_text}]"
        )

    appt = Appointment(
        patient_id=patient_id,
        doctor_id=doctor_id,
        department_id=department_id,
        appointment_date=appointment_date,
        token_number=token_number,
        status=AppointmentStatus.BOOKED.value,
        notes=final_notes,
        source=source.value if source else None,
        expected_time=expected_time,
        rescheduled_from_id=rescheduled_from_id,
        created_by_user_id=principal.user_id,
    )
    session.add(appt)
    session.flush()
    return appt


@dataclass(frozen=True)
class CheckInResult:
    """What a check-in did: the appointment, its visit, and whether the visit was opened now."""

    appointment: Appointment
    visit: Visit
    visit_opened: bool


def check_in(session: Session, appt: Appointment, principal: Principal) -> CheckInResult:
    """Check a booked patient in: ARRIVED, visit opened or joined, token issued, WAITING.

    Reception only, and only on the appointment date. A late arrival marked NO_SHOW checks in
    the same way. No money is taken here; payment is collected at checkout.
    """
    validate_booking_transition(appt, AppointmentStatus.ARRIVED, principal)

    # A NO_SHOW does not count for the duplicate rule (BR-006), so the patient may have been
    # booked again with this doctor today. Checking the missed booking in as well would put two
    # consultations, and two charges, into the same day. Use the other booking instead.
    if appt.status == AppointmentStatus.NO_SHOW.value:
        other = session.scalar(
            select(Appointment).where(
                Appointment.patient_id == appt.patient_id,
                Appointment.doctor_id == appt.doctor_id,
                Appointment.appointment_date == appt.appointment_date,
                Appointment.id != appt.id,
                Appointment.status.in_(ACTIVE_BOOKING_STATUSES),
            )
        )
        if other is not None:
            raise ApiError(
                status_code=409,
                code="duplicate_appointment",
                message=(
                    "This patient was booked again with this doctor today. "
                    "Check in that booking instead of the one marked No-show."
                ),
                details={
                    "existing_appointment_id": other.id,
                    "existing_token_number": other.token_number,
                    "existing_status": other.status,
                },
            )

    visit, visit_opened = visit_service.join_or_open_visit(
        session, appt.patient_id, principal.user_id
    )
    if appt.token_number is None:
        appt.token_number = token_service.generate_next_daily_token(
            session, appt.doctor_id, appt.appointment_date
        )

    now = clock.utcnow()
    appt.status = AppointmentStatus.ARRIVED.value
    appt.status_updated_at = now
    if appt.check_in_at is None:
        appt.check_in_at = now
    appt.consultation_status = ConsultationStatus.WAITING.value
    appt.visit_id = visit.id
    appt.version_id += 1
    session.flush()
    return CheckInResult(appointment=appt, visit=visit, visit_opened=visit_opened)


def walk_in(
    session: Session,
    principal: Principal,
    *,
    patient_id: int,
    doctor_id: int,
    department_id: int,
    notes: str | None = None,
    override_reason: str | None = None,
) -> CheckInResult:
    """Register a walk-in: a booking for today, checked in at once, in one transaction."""
    with session.begin_nested():
        appt = create_booking(
            session,
            principal,
            patient_id=patient_id,
            doctor_id=doctor_id,
            department_id=department_id,
            appointment_date=clock.ist_today(),
            notes=notes,
            override_reason=override_reason,
            source=AppointmentSource.WALK_IN,
            issue_token=False,
        )
        return check_in(session, appt, principal)


def reschedule(
    session: Session,
    appt: Appointment,
    principal: Principal,
    *,
    new_date: date,
    new_time: time | None,
) -> tuple[Appointment, Appointment | None]:
    """Move a booking to another date, or change its expected time on the same date.

    A date change marks the old booking RESCHEDULED and returns (old, new) with the new booking
    linked back to it, so both stay in history. A time-only change on the same date edits the
    booking in place and returns (appointment, None); the audit row records before and after.
    """
    validate_booking_transition(appt, AppointmentStatus.RESCHEDULED, principal)

    today = clock.ist_today()
    if new_date < today:
        raise ApiError(
            status_code=422,
            code="reschedule_date_in_past",
            message="A booking can only be moved to today or a later date.",
            details={"today": today.isoformat(), "requested": new_date.isoformat()},
        )

    if new_date == appt.appointment_date:
        if appt.status != AppointmentStatus.BOOKED.value:
            raise ApiError(
                status_code=422,
                code="reschedule_same_date",
                message="Choose a different date. A patient who has arrived is checked in instead.",
            )
        if new_time is None or new_time == appt.expected_time:
            raise ApiError(
                status_code=422,
                code="reschedule_nothing_changed",
                message="Give a different date or a different expected time.",
            )
        appt.expected_time = new_time
        appt.version_id += 1
        session.flush()
        return appt, None

    if appt.department_id is None:
        raise ApiError(
            status_code=422,
            code="department_missing",
            message="This booking has no department, so it cannot be moved. Book it again.",
        )

    new_appt = create_booking(
        session,
        principal,
        patient_id=appt.patient_id,
        doctor_id=appt.doctor_id,
        department_id=appt.department_id,
        appointment_date=new_date,
        notes=appt.notes,
        source=AppointmentSource(appt.source) if appt.source else None,
        expected_time=new_time,
        rescheduled_from_id=appt.id,
        issue_token=False,
    )
    appt.status = AppointmentStatus.RESCHEDULED.value
    appt.status_updated_at = clock.utcnow()
    appt.version_id += 1
    session.flush()
    return appt, new_appt
