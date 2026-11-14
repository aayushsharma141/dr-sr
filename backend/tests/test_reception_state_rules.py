"""RF-11 state rules: booking status, consultation status and the visit service.

Owner decisions of 2026-11-13: booking, consultation and visit statuses are separate; reception
checks patients in (late arrivals the same day) and closes the visit at checkout; the treating
doctor starts and completes the consultation; a no-show or cancelled booking never produces a
visit; a closed visit does not change again.

The clock fixture freezes utcnow at 2026-11-02 04:30 UTC, which is 10:00 IST on 2 Nov 2026.
"""

from datetime import UTC, date, datetime
from types import SimpleNamespace

import pytest
from sqlalchemy.orm import Session

from kalyan_api.core.errors import ApiError, VersionConflict
from kalyan_api.core.permissions import ROLE_PERMISSIONS, Role
from kalyan_api.core.principal import Principal
from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    ConsultationStatus,
    Patient,
    User,
    Visit,
    VisitStatus,
)
from kalyan_api.services import visit_service
from kalyan_api.services.appointment_service import (
    validate_booking_transition,
    validate_consultation_transition,
)

TODAY = date(2026, 11, 2)
YESTERDAY = date(2026, 11, 1)
TOMORROW = date(2026, 11, 3)
FROZEN_NOW = datetime(2026, 11, 2, 4, 30, tzinfo=UTC)
DOCTOR_ID = 7
OTHER_DOCTOR_ID = 8

BOOKED = AppointmentStatus.BOOKED
ARRIVED = AppointmentStatus.ARRIVED
NO_SHOW = AppointmentStatus.NO_SHOW
CANCELLED = AppointmentStatus.CANCELLED
RESCHEDULED = AppointmentStatus.RESCHEDULED
WAITING = ConsultationStatus.WAITING
IN_CONSULTATION = ConsultationStatus.IN_CONSULTATION
COMPLETED = ConsultationStatus.COMPLETED
CONSULT_CANCELLED = ConsultationStatus.CANCELLED


def _principal(role: Role, doctor_id: int | None = None) -> Principal:
    return Principal(
        user_id=1,
        username=role.value.lower(),
        role=role,
        doctor_id=doctor_id,
        permissions=ROLE_PERMISSIONS[role],
        session_id=1,
        must_change_password=False,
    )


RECEPTION = _principal(Role.RECEPTION)
ADMIN = _principal(Role.ADMIN)
DOCTOR = _principal(Role.DOCTOR, DOCTOR_ID)
OTHER_DOCTOR = _principal(Role.DOCTOR, OTHER_DOCTOR_ID)


def _appt(
    status: AppointmentStatus = BOOKED,
    appointment_date: date = TODAY,
    consultation: ConsultationStatus | None = None,
    visit_id: int | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=1,
        status=status.value,
        appointment_date=appointment_date,
        doctor_id=DOCTOR_ID,
        consultation_status=consultation.value if consultation else None,
        visit_id=visit_id,
    )


def _arrived(consultation: ConsultationStatus = WAITING, visit_id: int | None = None):
    return _appt(ARRIVED, consultation=consultation, visit_id=visit_id)


class _FakeSession:
    """Answers the encounter and visit lookups of the consultation rules, without a database."""

    def __init__(self, encounter: object = None, visit: object = None) -> None:
        self.encounter = encounter
        self.visit = visit

    def scalar(self, _statement: object) -> object:
        return self.encounter

    def get(self, _model: object, _ident: object) -> object:
        return self.visit


def _refused(func, *args, **kwargs) -> ApiError:
    with pytest.raises(ApiError) as exc_info:
        func(*args, **kwargs)
    return exc_info.value


# ---------------------------------------------------------------- booking status


def test_reception_checks_in_todays_booking(clock):
    validate_booking_transition(_appt(), ARRIVED, RECEPTION)


@pytest.mark.parametrize("day", [YESTERDAY, TOMORROW])
def test_check_in_is_refused_on_any_other_day(clock, day):
    error = _refused(validate_booking_transition, _appt(appointment_date=day), ARRIVED, RECEPTION)
    assert error.code == "check_in_wrong_day"


def test_late_arrival_after_no_show_checks_in_the_same_day(clock):
    validate_booking_transition(_appt(NO_SHOW), ARRIVED, RECEPTION)


def test_no_show_from_an_earlier_day_cannot_check_in(clock):
    appt = _appt(NO_SHOW, appointment_date=YESTERDAY)
    assert _refused(validate_booking_transition, appt, ARRIVED, RECEPTION).code == (
        "check_in_wrong_day"
    )


def test_not_arrived_cannot_be_marked_before_the_appointment_date(clock):
    appt = _appt(appointment_date=TOMORROW)
    assert _refused(validate_booking_transition, appt, NO_SHOW, RECEPTION).code == (
        "no_show_before_date"
    )
    validate_booking_transition(_appt(appointment_date=YESTERDAY), NO_SHOW, RECEPTION)


@pytest.mark.parametrize("reason", [None, "", "   "])
def test_cancelling_a_booking_needs_a_reason(clock, reason):
    error = _refused(validate_booking_transition, _appt(), CANCELLED, RECEPTION, reason)
    assert error.code == "cancellation_reason_required"


def test_cancelling_a_booking_with_a_reason_is_allowed(clock):
    validate_booking_transition(_appt(), CANCELLED, RECEPTION, "Patient phoned to cancel")


@pytest.mark.parametrize("current", [BOOKED, NO_SHOW])
def test_reschedule_is_allowed_before_check_in(clock, current):
    validate_booking_transition(_appt(current, appointment_date=YESTERDAY), RESCHEDULED, RECEPTION)


@pytest.mark.parametrize(
    ("current", "target"),
    [
        (ARRIVED, CANCELLED),
        (ARRIVED, RESCHEDULED),
        (ARRIVED, NO_SHOW),
        (CANCELLED, ARRIVED),
        (RESCHEDULED, ARRIVED),
        (NO_SHOW, CANCELLED),
    ],
)
def test_settled_bookings_do_not_move(clock, current, target):
    error = _refused(validate_booking_transition, _appt(current), target, RECEPTION, "reason")
    assert error.code == "invalid_status_transition"


def test_same_booking_status_is_refused(clock):
    assert _refused(validate_booking_transition, _appt(), BOOKED, RECEPTION).code == (
        "status_unchanged"
    )


@pytest.mark.parametrize("principal", [ADMIN, DOCTOR])
@pytest.mark.parametrize("target", [ARRIVED, RESCHEDULED])
def test_only_reception_checks_in_and_reschedules(clock, principal, target):
    error = _refused(validate_booking_transition, _appt(), target, principal)
    assert (error.status_code, error.code) == (403, "reception_only")


def test_doctor_may_mark_only_their_own_booking_not_arrived(clock):
    validate_booking_transition(_appt(), NO_SHOW, DOCTOR)
    error = _refused(validate_booking_transition, _appt(), NO_SHOW, OTHER_DOCTOR)
    assert (error.status_code, error.code) == (403, "scope_forbidden")


def test_admin_cannot_cancel_a_booking(clock):
    error = _refused(validate_booking_transition, _appt(), CANCELLED, ADMIN, "reason")
    assert (error.status_code, error.code) == (403, "reception_only")


# ----------------------------------------------------------- consultation status


def test_treating_doctor_starts_and_completes_the_consultation():
    validate_consultation_transition(_FakeSession(), _arrived(), IN_CONSULTATION, DOCTOR)
    validate_consultation_transition(_FakeSession(), _arrived(IN_CONSULTATION), COMPLETED, DOCTOR)


@pytest.mark.parametrize(
    ("principal", "code"),
    [
        (RECEPTION, "doctor_status_forbidden"),
        (ADMIN, "doctor_status_forbidden"),
        (OTHER_DOCTOR, "scope_forbidden"),
    ],
)
def test_only_the_treating_doctor_starts_a_consultation(principal, code):
    error = _refused(
        validate_consultation_transition, _FakeSession(), _arrived(), IN_CONSULTATION, principal
    )
    assert (error.status_code, error.code) == (403, code)


def test_a_waiting_consultation_cannot_jump_to_completed():
    error = _refused(
        validate_consultation_transition, _FakeSession(), _arrived(), COMPLETED, DOCTOR
    )
    assert error.code == "invalid_consultation_transition"


def test_reception_cancels_a_waiting_consultation_only_with_a_reason():
    error = _refused(
        validate_consultation_transition, _FakeSession(), _arrived(), CONSULT_CANCELLED, RECEPTION
    )
    assert error.code == "cancellation_reason_required"
    validate_consultation_transition(
        _FakeSession(), _arrived(), CONSULT_CANCELLED, RECEPTION, "Patient left before being seen"
    )


@pytest.mark.parametrize(
    ("principal", "code"),
    [(OTHER_DOCTOR, "scope_forbidden"), (ADMIN, "reception_or_doctor_only")],
)
def test_only_reception_or_the_treating_doctor_cancels_a_consultation(principal, code):
    error = _refused(
        validate_consultation_transition,
        _FakeSession(),
        _arrived(),
        CONSULT_CANCELLED,
        principal,
        "reason",
    )
    assert (error.status_code, error.code) == (403, code)


def test_finalised_encounter_blocks_cancelling_the_consultation():
    session = _FakeSession(encounter=SimpleNamespace(is_finalised=True))
    error = _refused(
        validate_consultation_transition,
        session,
        _arrived(IN_CONSULTATION),
        CONSULT_CANCELLED,
        DOCTOR,
        "reason",
    )
    assert error.code == "cannot_cancel_finalised"


def test_consultation_rules_need_a_checked_in_patient():
    error = _refused(validate_consultation_transition, _FakeSession(), _appt(), WAITING, DOCTOR)
    assert error.code == "not_checked_in"


@pytest.mark.parametrize("visit_status", [VisitStatus.CLOSED, VisitStatus.CANCELLED])
def test_nothing_changes_once_the_visit_is_settled(visit_status):
    session = _FakeSession(visit=SimpleNamespace(status=visit_status.value))
    error = _refused(
        validate_consultation_transition, session, _arrived(visit_id=5), IN_CONSULTATION, DOCTOR
    )
    assert error.code == "visit_not_open"


# ------------------------------------------------------------------ visit service


def _patient(session: Session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-R2{suffix}",
        full_name=f"Flow Patient {suffix}",
        guardian_name="Guardian",
        gender="F",
        age_years=29,
        mobile="9000000003",
        address="Ara, Bihar",
        district="Bhojpur",
        state="Bihar",
        is_active=True,
    )
    session.add(patient)
    session.flush()
    return patient


def _checked_in(
    session: Session,
    patient: Patient,
    visit: Visit,
    doctor_id: int,
    user: User,
    consultation: ConsultationStatus,
) -> Appointment:
    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_id,
        appointment_date=TODAY,
        token_number=1,
        status=ARRIVED.value,
        consultation_status=consultation.value,
        visit_id=visit.id,
        created_by_user_id=user.id,
    )
    session.add(appt)
    session.flush()
    return appt


def _open_visit(session: Session, suffix: str, user: User) -> tuple[Patient, Visit]:
    patient = _patient(session, suffix)
    return patient, visit_service.open_or_join_visit(session, patient.id, user.id)


def test_check_in_opens_one_visit_and_a_second_doctor_joins_it(clock, reception_user, db_session):
    patient, first = _open_visit(db_session, "S1", reception_user)
    second = visit_service.open_or_join_visit(db_session, patient.id, reception_user.id)

    assert second.id == first.id
    assert first.status == VisitStatus.OPEN.value
    assert first.visit_date == TODAY


def test_an_open_visit_from_an_earlier_day_must_be_settled_first(clock, reception_user, db_session):
    patient = _patient(db_session, "S2")
    stale = Visit(
        patient_id=patient.id,
        visit_date=YESTERDAY,
        status=VisitStatus.OPEN.value,
        opened_by_user_id=reception_user.id,
    )
    db_session.add(stale)
    db_session.flush()

    error = _refused(visit_service.open_or_join_visit, db_session, patient.id, reception_user.id)
    assert (error.status_code, error.code) == (409, "open_visit_from_earlier_day")
    assert error.extras["details"]["visit_id"] == stale.id


def test_check_in_refuses_an_unknown_patient(clock, reception_user, db_session):
    error = _refused(visit_service.open_or_join_visit, db_session, -1, reception_user.id)
    assert (error.status_code, error.code) == (404, "patient_not_found")


def test_visit_cannot_close_while_a_consultation_is_waiting(
    clock, doctor_a_user, doctor_b_user, reception_user, db_session
):
    patient, visit = _open_visit(db_session, "S3", reception_user)
    _checked_in(db_session, patient, visit, doctor_a_user.doctor_id, reception_user, COMPLETED)
    waiting = _checked_in(
        db_session, patient, visit, doctor_b_user.doctor_id, reception_user, WAITING
    )

    error = _refused(
        visit_service.close_visit,
        db_session,
        visit,
        closed_by_user_id=reception_user.id,
        version_id=visit.version_id,
        outstanding_paise=0,
    )
    assert error.code == "consultation_in_progress"
    assert error.extras["details"]["appointment_ids"] == [waiting.id]


def test_visit_without_a_completed_consultation_cannot_close(
    clock, doctor_a_user, reception_user, db_session
):
    patient, visit = _open_visit(db_session, "S4", reception_user)
    _checked_in(
        db_session, patient, visit, doctor_a_user.doctor_id, reception_user, CONSULT_CANCELLED
    )

    error = _refused(
        visit_service.close_visit,
        db_session,
        visit,
        closed_by_user_id=reception_user.id,
        version_id=visit.version_id,
        outstanding_paise=0,
    )
    assert error.code == "no_completed_consultation"


def test_closing_with_money_due_needs_a_reason(clock, doctor_a_user, reception_user, db_session):
    patient, visit = _open_visit(db_session, "S5", reception_user)
    _checked_in(db_session, patient, visit, doctor_a_user.doctor_id, reception_user, COMPLETED)

    error = _refused(
        visit_service.close_visit,
        db_session,
        visit,
        closed_by_user_id=reception_user.id,
        version_id=visit.version_id,
        outstanding_paise=30000,
        reason="  ",
    )
    assert error.code == "close_reason_required"
    assert error.extras["details"]["outstanding_paise"] == 30000

    visit_service.close_visit(
        db_session,
        visit,
        closed_by_user_id=reception_user.id,
        version_id=visit.version_id,
        outstanding_paise=30000,
        reason="  Pays the balance with the next instalment ",
    )
    assert visit.status == VisitStatus.CLOSED.value
    assert visit.close_reason == "Pays the balance with the next instalment"
    assert visit.closed_by_user_id == reception_user.id
    assert visit.closed_at == FROZEN_NOW


def test_closing_a_fully_paid_visit_needs_no_reason(
    clock, doctor_a_user, reception_user, db_session
):
    patient, visit = _open_visit(db_session, "S6", reception_user)
    _checked_in(db_session, patient, visit, doctor_a_user.doctor_id, reception_user, COMPLETED)

    visit_service.close_visit(
        db_session,
        visit,
        closed_by_user_id=reception_user.id,
        version_id=visit.version_id,
        outstanding_paise=0,
    )
    assert visit.status == VisitStatus.CLOSED.value
    assert visit.close_reason is None


def test_a_closed_visit_does_not_change_again(clock, doctor_a_user, reception_user, db_session):
    patient, visit = _open_visit(db_session, "S7", reception_user)
    _checked_in(db_session, patient, visit, doctor_a_user.doctor_id, reception_user, COMPLETED)
    visit_service.close_visit(
        db_session,
        visit,
        closed_by_user_id=reception_user.id,
        version_id=visit.version_id,
        outstanding_paise=0,
    )

    again = _refused(
        visit_service.close_visit,
        db_session,
        visit,
        closed_by_user_id=reception_user.id,
        version_id=visit.version_id,
        outstanding_paise=0,
    )
    cancel = _refused(
        visit_service.cancel_visit,
        db_session,
        visit,
        cancelled_by_user_id=reception_user.id,
        version_id=visit.version_id,
        reason="reason",
    )
    assert again.code == cancel.code == "visit_not_open"


def test_visit_is_cancelled_only_once_nobody_is_waiting(
    clock, doctor_a_user, reception_user, db_session
):
    patient, visit = _open_visit(db_session, "S8", reception_user)
    consult = _checked_in(
        db_session, patient, visit, doctor_a_user.doctor_id, reception_user, WAITING
    )

    def cancel(reason: str) -> Visit:
        return visit_service.cancel_visit(
            db_session,
            visit,
            cancelled_by_user_id=reception_user.id,
            version_id=visit.version_id,
            reason=reason,
        )

    assert _refused(cancel, "Patient left").code == "consultation_in_progress"

    consult.consultation_status = CONSULT_CANCELLED.value
    db_session.flush()
    assert _refused(cancel, "   ").code == "cancel_reason_required"

    cancel("Patient left before being seen")
    assert visit.status == VisitStatus.CANCELLED.value
    assert visit.cancel_reason == "Patient left before being seen"
    assert visit.cancelled_at == FROZEN_NOW


def test_visit_with_a_completed_consultation_cannot_be_cancelled(
    clock, doctor_a_user, reception_user, db_session
):
    patient, visit = _open_visit(db_session, "S9", reception_user)
    _checked_in(db_session, patient, visit, doctor_a_user.doctor_id, reception_user, COMPLETED)

    error = _refused(
        visit_service.cancel_visit,
        db_session,
        visit,
        cancelled_by_user_id=reception_user.id,
        version_id=visit.version_id,
        reason="reason",
    )
    assert error.code == "visit_has_completed_consultation"


def test_a_stale_visit_version_is_refused(clock, doctor_a_user, reception_user, db_session):
    patient, visit = _open_visit(db_session, "SA", reception_user)
    _checked_in(db_session, patient, visit, doctor_a_user.doctor_id, reception_user, COMPLETED)

    with pytest.raises(VersionConflict):
        visit_service.close_visit(
            db_session,
            visit,
            closed_by_user_id=reception_user.id,
            version_id=visit.version_id + 1,
            outstanding_paise=0,
        )
    assert visit.status == VisitStatus.OPEN.value
