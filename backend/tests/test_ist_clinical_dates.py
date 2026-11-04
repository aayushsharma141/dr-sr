"""Clinical dates follow the Indian calendar day, including 00:00-05:30 IST (still 'yesterday' in UTC)."""

from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy.orm import Session

from kalyan_api.models import Appointment, Patient, TreatmentPlan, User

# 19:30 UTC on 4 November is 01:00 IST on 5 November.
AFTER_MIDNIGHT_IST = datetime(2026, 11, 4, 19, 30, tzinfo=UTC)
IST_DAY = date(2026, 11, 5)
UTC_DAY = date(2026, 11, 4)


def _patient(session: Session) -> Patient:
    patient = Patient(
        urn="KH-2026-ISTDATE",
        full_name="Date Patient",
        guardian_name="Guardian",
        gender="M",
        age_years=50,
        mobile="9876543344",
        address="Bhojpur",
        district="Bhojpur",
        state="Bihar",
    )
    session.add(patient)
    session.flush()
    return patient


def test_session_logged_after_midnight_gets_the_indian_date(
    login_client: Any, doctor_a_user: User, db_session: Session, clock: dict[str, Any]
) -> None:
    """The date is written once onto an immutable record, so it has to be right first time."""
    clock["t"] = AFTER_MIDNIGHT_IST
    client = login_client(doctor_a_user)
    plan = TreatmentPlan(
        patient_id=_patient(db_session).id,
        doctor_id=doctor_a_user.doctor_id,
        plan_name="Rehab",
        condition_diagnosis="Lumbar Canal Stenosis",
        total_sessions=2,
        agreed_price_paise=100000,
    )
    db_session.add(plan)
    db_session.flush()

    clock["t"] = AFTER_MIDNIGHT_IST
    res = client.post(
        f"/api/treatment-plans/{plan.id}/sessions",
        json={"vas_score": 5, "modalities": ["IFT"], "clinical_notes": "After-hours session."},
    )
    assert res.status_code == 201, res.text
    assert res.json()["session_date"] == IST_DAY.isoformat()


def test_doctor_queue_after_midnight_shows_the_indian_day(
    login_client: Any, doctor_a_user: User, db_session: Session, clock: dict[str, Any]
) -> None:
    clock["t"] = AFTER_MIDNIGHT_IST
    client = login_client(doctor_a_user)
    patient = _patient(db_session)
    for day, token in ((UTC_DAY, 7), (IST_DAY, 1)):
        db_session.add(
            Appointment(
                patient_id=patient.id,
                doctor_id=doctor_a_user.doctor_id,
                appointment_date=day,
                token_number=token,
                status="BOOKED",
                created_by_user_id=doctor_a_user.id,
            )
        )
    db_session.flush()

    clock["t"] = AFTER_MIDNIGHT_IST
    res = client.get("/api/doctor/queue")
    assert res.status_code == 200, res.text
    assert res.json()["queue_date"] == IST_DAY.isoformat()
    assert [row["token_number"] for row in res.json()["booked"]] == [1]
