"""Clinical "today" is the IST business date, never the UTC date.

At 01:00 IST on 6 Nov 2026 the UTC date is still 5 Nov, so a queue or session date taken
from UTC lands on the previous day until 05:30 IST.
"""

from datetime import UTC, datetime

import pytest

from kalyan_api.models import Department, Doctor, Patient, TreatmentPlan
from kalyan_api.routers.timeline import _doctor_title

AFTER_IST_MIDNIGHT = datetime(2026, 11, 5, 19, 30, tzinfo=UTC)  # 01:00 IST, 6 Nov 2026


@pytest.fixture
def after_ist_midnight(monkeypatch: pytest.MonkeyPatch) -> None:
    """Freeze the clock seam. Use it before login so session timeouts see the same instant."""
    monkeypatch.setattr("kalyan_api.clock.utcnow", lambda: AFTER_IST_MIDNIGHT)


def _patient(db_session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-IST{suffix}",
        full_name=f"IST Boundary Patient {suffix}",
        guardian_name="Guardian",
        gender="F",
        age_years=50,
        mobile=f"987650{suffix}",
        address="Ara",
        district="Bhojpur",
        state="Bihar",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def test_doctor_queue_shows_todays_ist_appointments(
    after_ist_midnight, login_client, reception_user, doctor_a_user, db_session
):
    """An appointment booked for the IST date appears in the doctor's queue after midnight."""
    patient = _patient(db_session, "0011")
    # Bookings name a department, and the doctor must belong to it.
    department = Department(name_en="IST Test Department")
    db_session.add(department)
    db_session.flush()
    doctor = db_session.get(Doctor, doctor_a_user.doctor_id)
    doctor.departments = [department]
    db_session.flush()
    reception_client = login_client(reception_user)
    booked = reception_client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": department.id,
            "appointment_date": "2026-11-06",
        },
    )
    assert booked.status_code == 201, booked.text

    queue = login_client(doctor_a_user).get("/api/doctor/queue")

    assert queue.status_code == 200, queue.text
    assert queue.json()["queue_date"] == "2026-11-06"
    assert [item["patient_id"] for item in queue.json()["booked"]] == [patient.id]


def test_session_date_defaults_to_ist_date(
    after_ist_midnight, login_client, doctor_a_user, db_session
):
    """A session logged without a date is recorded on the IST business date."""
    patient = _patient(db_session, "0012")
    plan = TreatmentPlan(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        plan_name="IST Boundary Package",
        condition_diagnosis="Lumbar Canal Stenosis",
        total_sessions=2,
        agreed_price_paise=100000,
    )
    db_session.add(plan)
    db_session.flush()

    logged = login_client(doctor_a_user).post(
        f"/api/treatment-plans/{plan.id}/sessions",
        json={"vas_score": 5, "modalities": ["IFT"], "clinical_notes": "Logged after midnight."},
    )

    assert logged.status_code == 201, logged.text
    assert logged.json()["session_date"] == "2026-11-06"


@pytest.mark.parametrize(
    ("stored", "shown"),
    [
        ("Anil Kumar", "Dr. Anil Kumar"),
        ("Dr. Anil Kumar", "Dr. Anil Kumar"),
        ("Dr Anil Kumar", "Dr Anil Kumar"),
        ("DR. ANIL KUMAR", "DR. ANIL KUMAR"),
        ("Drishti Sharma", "Dr. Drishti Sharma"),
    ],
)
def test_timeline_doctor_title_appears_once(stored: str, shown: str) -> None:
    """A title typed into the stored name is not doubled; a name starting with Dr is kept."""
    assert _doctor_title(stored) == shown
