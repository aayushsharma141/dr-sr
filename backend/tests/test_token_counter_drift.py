"""A token is never issued twice, even when the daily counter is behind the appointments.

Found in a browser check of the Token Desk (RF-21): a dev seed wrote appointments with tokens
straight into the table, so the first check-in was given a number already in use and failed with
a server error. The counter is the source of truth, but the generator now also looks at the
highest token in use.
"""

from datetime import date

from kalyan_api.models import Appointment, DailyTokenSequence, Patient
from kalyan_api.services.token_service import generate_next_daily_token

DAY = date(2026, 12, 1)


def _booking(db_session, doctor_user, reception_user, suffix: str, token: int | None):
    patient = Patient(
        urn=f"KH-2026-K1{suffix}",
        full_name=f"Counter Drift {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=50,
        mobile="9876543601",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()
    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_user.doctor_id,
        appointment_date=DAY,
        token_number=token,
        status="BOOKED",
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt)
    db_session.flush()
    return appt


def test_the_next_token_skips_a_number_already_held_by_an_appointment(
    db_session, doctor_a_user, reception_user
):
    # Two appointments hold tokens 1 and 2, but the counter has never been used for this day.
    _booking(db_session, doctor_a_user, reception_user, "A", 1)
    _booking(db_session, doctor_a_user, reception_user, "B", 2)

    assert generate_next_daily_token(db_session, doctor_a_user.doctor_id, DAY) == 3
    assert generate_next_daily_token(db_session, doctor_a_user.doctor_id, DAY) == 4


def test_a_counter_that_is_ahead_still_wins(db_session, doctor_a_user, reception_user):
    _booking(db_session, doctor_a_user, reception_user, "C", 3)
    db_session.add(
        DailyTokenSequence(doctor_id=doctor_a_user.doctor_id, appointment_date=DAY, last_token=7)
    )
    db_session.flush()

    # A gap is fine; a duplicate is not. Tokens already given out are never reissued.
    assert generate_next_daily_token(db_session, doctor_a_user.doctor_id, DAY) == 8


def test_tokenless_bookings_do_not_affect_the_next_token(db_session, doctor_a_user, reception_user):
    _booking(db_session, doctor_a_user, reception_user, "D", None)

    assert generate_next_daily_token(db_session, doctor_a_user.doctor_id, DAY) == 1


def test_another_doctors_tokens_are_not_counted(
    db_session, doctor_a_user, doctor_b_user, reception_user
):
    _booking(db_session, doctor_b_user, reception_user, "E", 9)

    assert generate_next_daily_token(db_session, doctor_a_user.doctor_id, DAY) == 1
