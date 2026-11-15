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
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, lazyload

from kalyan_api import clock
from kalyan_api.core.errors import ApiError
from kalyan_api.core.principal import Principal
from kalyan_api.models import (
    REFERRAL_SOURCES_NEEDING_NAME,
    Appointment,
    AppointmentSource,
    AppointmentStatus,
    BillItem,
    BillItemCategory,
    BillItemSource,
    ConsultationPriorityEvent,
    ConsultationStatus,
    Department,
    Doctor,
    Patient,
    PriorityEventType,
    PriorityLevel,
    Visit,
    VisitStatus,
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


@dataclass(frozen=True)
class CheckInDetails:
    """What reception confirms at the check-in desk (phase 22).

    visit_kind is recorded on the consultation and never sets the fee (OD-22-05). The
    classification never changes the token (OD-22-06/07). The referral belongs to the visit: it
    is recorded by the check-in that opens the visit and left as it is when a second
    consultation joins the same visit (OD-22-16).
    """

    referral_source: str
    referrer_name: str | None = None
    visit_kind: str | None = None
    priority_level: str = PriorityLevel.NORMAL.value
    priority_reason: str | None = None


def _clean_text(value: str | None) -> str | None:
    text_value = (value or "").strip()
    return text_value or None


def _record_priority_event(
    session: Session,
    appt: Appointment,
    principal: Principal,
    *,
    event: PriorityEventType,
    from_level: str | None,
    to_level: str,
    reason: str | None,
) -> None:
    session.add(
        ConsultationPriorityEvent(
            appointment_id=appt.id,
            visit_id=appt.visit_id,
            patient_id=appt.patient_id,
            doctor_id=appt.doctor_id,
            event=event.value,
            from_level=from_level,
            to_level=to_level,
            reason=reason,
            actor_user_id=principal.user_id,
        )
    )


def _set_classification(
    appt: Appointment, principal: Principal, level: str, reason: str | None
) -> None:
    """Write the classification fields. EMERGENCY raises a fresh alert for the doctor."""
    now = clock.utcnow()
    was_emergency = appt.priority_level == PriorityLevel.EMERGENCY.value
    appt.priority_level = level
    appt.priority_reason = reason if level != PriorityLevel.NORMAL.value else None
    appt.priority_updated_at = now
    appt.priority_updated_by_user_id = principal.user_id
    if level == PriorityLevel.EMERGENCY.value:
        if not was_emergency:
            appt.emergency_alerted_at = now
            appt.alert_acknowledged_at = None
            appt.alert_acknowledged_by_user_id = None
    else:
        # The alert ends with the emergency; its acknowledgement stays in the history table.
        appt.emergency_alerted_at = None
        appt.alert_acknowledged_at = None
        appt.alert_acknowledged_by_user_id = None


def _require_classification_reason(level: str, reason: str | None) -> None:
    if level != PriorityLevel.NORMAL.value and len(reason or "") < 3:
        raise ApiError(
            status_code=422,
            code="priority_reason_required",
            message="Enter a reason for marking the patient Priority or Emergency.",
        )


def _validated_referrer(details: CheckInDetails) -> str | None:
    """The referrer's name, refused when the referral source needs one and it is missing."""
    name = _clean_text(details.referrer_name)
    if details.referral_source in REFERRAL_SOURCES_NEEDING_NAME and (name is None or len(name) < 2):
        raise ApiError(
            status_code=422,
            code="referrer_name_required",
            message="Enter the name of the referring doctor, person or organisation.",
        )
    return name


def _apply_check_in_details(
    appt: Appointment,
    visit: Visit,
    principal: Principal,
    details: CheckInDetails,
    referrer_name: str | None,
) -> None:
    """Set the desk's confirmations on the consultation (and a pre-phase-22 visit) before saving."""
    # A visit opened before phase 22 has no referral yet; this check-in records it. A visit
    # opened by this check-in already holds it, and any other visit keeps its own.
    if visit.referral_source is None:
        visit.referral_source = details.referral_source
        visit.referrer_name = referrer_name
        visit.referral_recorded_by_user_id = principal.user_id
        visit.referral_recorded_at = clock.utcnow()

    appt.visit_kind = details.visit_kind
    if details.priority_level != PriorityLevel.NORMAL.value:
        _set_classification(
            appt, principal, details.priority_level, _clean_text(details.priority_reason)
        )


def classify(
    session: Session, appt: Appointment, principal: Principal, level: str, reason: str | None
) -> bool:
    """Change a checked-in patient's classification; returns False when nothing changed.

    Allowed while the patient waits or is with the doctor. The token and the consultation are
    untouched; every change is appended to the classification history (OD-22-06).
    """
    if appt.consultation_status not in (
        ConsultationStatus.WAITING.value,
        ConsultationStatus.IN_CONSULTATION.value,
    ):
        raise ApiError(
            status_code=422,
            code="classification_closed",
            message="Only a patient who is waiting or with the doctor can be reclassified.",
        )
    reason = _clean_text(reason)
    _require_classification_reason(level, reason)
    kept_reason = reason if level != PriorityLevel.NORMAL.value else None
    if level == appt.priority_level and kept_reason == appt.priority_reason:
        return False

    from_level = appt.priority_level
    _set_classification(appt, principal, level, reason)
    appt.version_id += 1
    session.flush()
    _record_priority_event(
        session,
        appt,
        principal,
        event=PriorityEventType.CLASSIFIED,
        from_level=from_level,
        to_level=level,
        reason=reason,
    )
    session.flush()
    return True


def ensure_consultation_line(session: Session, appt: Appointment, principal: Principal) -> BillItem:
    """Save the doctor's current fee as this consultation's bill line (OD-22-10, K-63, FEE-07).

    Written once per consultation, at check-in or reassignment. Later changes to the doctor's
    default fee never touch it. Requires appt.visit_id to be set.
    """
    if appt.visit_id is None:
        raise ApiError(
            status_code=500,
            code="bill_line_without_visit",
            message="A consultation must belong to a visit before it is billed.",
        )
    existing = session.scalar(
        select(BillItem).where(
            BillItem.appointment_id == appt.id,
            BillItem.category == BillItemCategory.CONSULTATION.value,
        )
    )
    if existing is not None:
        return existing
    doctor = session.get(Doctor, appt.doctor_id)
    if doctor is None:
        raise ApiError(status_code=404, code="doctor_not_found", message="Doctor not found.")
    fee = doctor.default_fee_paise
    line = BillItem(
        visit_id=appt.visit_id,
        patient_id=appt.patient_id,
        appointment_id=appt.id,
        category=BillItemCategory.CONSULTATION.value,
        source=BillItemSource.SYSTEM.value,
        description="Consultation fee",
        quantity=Decimal("1"),
        rate_paise=fee,
        amount_paise=fee,
        created_by_user_id=principal.user_id,
    )
    session.add(line)
    session.flush()
    return line


def acknowledge_alert(session: Session, appt: Appointment, principal: Principal) -> None:
    """The doctor acknowledges an emergency alert on their own consultation (OD-22-09).

    The time and the acknowledging user are kept on the consultation, and an ACKNOWLEDGED row is
    appended to the classification history. The alert itself stays until this is called.
    """
    if appt.priority_level != PriorityLevel.EMERGENCY.value or appt.emergency_alerted_at is None:
        raise ApiError(
            status_code=409,
            code="no_emergency_alert",
            message="There is no emergency alert on this consultation.",
        )
    if appt.alert_acknowledged_at is not None:
        raise ApiError(
            status_code=409,
            code="alert_already_acknowledged",
            message="This emergency alert has already been acknowledged.",
        )
    appt.alert_acknowledged_at = clock.utcnow()
    appt.alert_acknowledged_by_user_id = principal.user_id
    appt.version_id += 1
    session.flush()
    _record_priority_event(
        session,
        appt,
        principal,
        event=PriorityEventType.ACKNOWLEDGED,
        from_level=PriorityLevel.EMERGENCY.value,
        to_level=PriorityLevel.EMERGENCY.value,
        reason=None,
    )
    session.flush()


def _reassign_department(
    session: Session,
    appt: Appointment,
    new_doctor: Doctor,
    new_department_id: int | None,
) -> int:
    """Department for the reassigned consultation (owner decision Q19, 2026-11-15).

    Any consulting doctor may receive the patient. The current department is kept when the new
    doctor belongs to it; otherwise reception must choose one of the new doctor's departments.
    The chosen department passes the same checks as a booking.
    """
    if new_department_id is None:
        if appt.department_id is not None and appt.department_id in {
            d.id for d in new_doctor.departments
        }:
            return appt.department_id
        raise ApiError(
            status_code=422,
            code="department_required",
            message=(
                "The new doctor does not see this department. "
                "Choose one of the new doctor's departments."
            ),
        )
    department = lock_department_for_booking(session, new_department_id)
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
    if department not in new_doctor.departments:
        raise ApiError(
            status_code=422,
            code="doctor_department_mismatch",
            message="Selected doctor is not assigned to the selected department.",
        )
    return department.id


def reassign_waiting(
    session: Session,
    appt: Appointment,
    principal: Principal,
    *,
    new_doctor_id: int,
    reason: str,
    new_department_id: int | None = None,
) -> Appointment:
    """Move a waiting patient to any consulting doctor on the same visit (QUE-10, design §5).

    The old consultation is cancelled with the reason and kept as history. The new doctor gets a
    WAITING consultation on the same visit with a token from their own sequence. Classification
    carries over (an emergency raises a fresh alert for the new doctor). The referral belongs to
    the visit and does not change. The department follows _reassign_department. Returns the new
    consultation.
    """
    if (
        appt.status != AppointmentStatus.ARRIVED.value
        or appt.consultation_status != ConsultationStatus.WAITING.value
    ):
        raise ApiError(
            status_code=422,
            code="reassign_not_waiting",
            message="Only a patient who is waiting can be moved to another doctor.",
        )
    if new_doctor_id == appt.doctor_id:
        raise ApiError(
            status_code=422,
            code="reassign_same_doctor",
            message="The patient is already with this doctor.",
        )
    reason_text = _clean_text(reason)
    if reason_text is None or len(reason_text) < 3:
        raise ApiError(
            status_code=422,
            code="reassign_reason_required",
            message="Enter a reason for moving the patient to another doctor.",
        )
    visit = session.get(Visit, appt.visit_id) if appt.visit_id is not None else None
    if visit is None or visit.status != VisitStatus.OPEN.value:
        raise ApiError(
            status_code=422,
            code="visit_not_open",
            message="The visit is no longer open.",
        )
    new_doctor = lock_doctor_for_booking(session, new_doctor_id)
    if new_doctor is None or not new_doctor.is_active:
        raise ApiError(
            status_code=404,
            code="doctor_not_found",
            message="Doctor not found or inactive.",
        )
    department_id = _reassign_department(session, appt, new_doctor, new_department_id)
    duplicate = session.scalar(
        select(Appointment).where(
            Appointment.patient_id == appt.patient_id,
            Appointment.doctor_id == new_doctor_id,
            Appointment.appointment_date == appt.appointment_date,
            Appointment.status.in_(ACTIVE_BOOKING_STATUSES),
        )
    )
    if duplicate is not None:
        raise ApiError(
            status_code=409,
            code="duplicate_appointment",
            message="This patient already has a booking with that doctor today.",
            details={"existing_appointment_id": duplicate.id},
        )

    token = token_service.generate_next_daily_token(
        session, new_doctor_id, appt.appointment_date
    )
    now = clock.utcnow()
    successor = Appointment(
        patient_id=appt.patient_id,
        doctor_id=new_doctor_id,
        department_id=department_id,
        appointment_date=appt.appointment_date,
        token_number=token,
        status=AppointmentStatus.ARRIVED.value,
        status_updated_at=now,
        check_in_at=appt.check_in_at or now,
        visit_id=appt.visit_id,
        source=appt.source,
        expected_time=appt.expected_time,
        consultation_status=ConsultationStatus.WAITING.value,
        visit_kind=appt.visit_kind,
        created_by_user_id=principal.user_id,
    )
    session.add(successor)
    session.flush()
    ensure_consultation_line(session, successor, principal)
    if appt.priority_level != PriorityLevel.NORMAL.value:
        _set_classification(successor, principal, appt.priority_level, appt.priority_reason)
        session.flush()
        _record_priority_event(
            session,
            successor,
            principal,
            event=PriorityEventType.CLASSIFIED,
            from_level=None,
            to_level=appt.priority_level,
            reason=appt.priority_reason,
        )
        session.flush()

    appt.status = AppointmentStatus.CANCELLED.value
    appt.status_updated_at = now
    appt.consultation_status = ConsultationStatus.CANCELLED.value
    appt.cancellation_reason = reason_text
    appt.version_id += 1
    session.flush()
    return successor


def check_in(
    session: Session,
    appt: Appointment,
    principal: Principal,
    details: CheckInDetails | None = None,
) -> CheckInResult:
    """Check a booked patient in: ARRIVED, visit opened or joined, token issued, WAITING.

    Reception only, and only on the appointment date. A late arrival marked NO_SHOW checks in
    the same way. No money is taken here; payment is collected at checkout. details carries
    the visit type, classification and referral from the check-in desk (phase 22); the older
    status-change path sends none.
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

    referrer_name = None
    if details is not None:
        referrer_name = _validated_referrer(details)
        _require_classification_reason(details.priority_level, _clean_text(details.priority_reason))

    visit, visit_opened = visit_service.join_or_open_visit(
        session,
        appt.patient_id,
        principal.user_id,
        referral_source=details.referral_source if details is not None else None,
        referrer_name=referrer_name,
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
    if details is not None:
        _apply_check_in_details(appt, visit, principal, details, referrer_name)
    appt.version_id += 1
    session.flush()
    ensure_consultation_line(session, appt, principal)
    if details is not None and details.priority_level != PriorityLevel.NORMAL.value:
        _record_priority_event(
            session,
            appt,
            principal,
            event=PriorityEventType.CLASSIFIED,
            from_level=None,
            to_level=details.priority_level,
            reason=appt.priority_reason,
        )
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
    details: CheckInDetails | None = None,
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
        return check_in(session, appt, principal, details)


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
