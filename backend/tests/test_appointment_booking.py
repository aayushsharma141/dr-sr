"""Functional tests for appointment booking REST API endpoints (APT-01)."""

from datetime import timedelta

from kalyan_api.clock import IST
from kalyan_api.models import Patient


def test_book_appointment_lifecycle(login_client, reception_user, doctor_a_user, db_session, clock):
    """Reception books appointment for patient with doctor, receiving sequential tokens."""
    # 1. Create a patient
    patient = Patient(
        urn="KH-2026-8801",
        full_name="Booking Test Patient",
        guardian_name="Guardian",
        gender="M",
        age_years=30,
        mobile="9876543220",
        address="Station Road, Ara",
    )
    db_session.add(patient)
    db_session.flush()

    doctor_id = doctor_a_user.doctor_id
    assert doctor_id is not None

    # 2. Log in as reception
    client = login_client(reception_user)
    target_date = (clock["t"].astimezone(IST).date() + timedelta(days=3)).isoformat()

    # 3. Book first appointment
    resp1 = client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_id,
            "appointment_date": target_date,
            "booking_mode": "SCHEDULED",
            "visit_type": "NEW_CONSULTATION",
            "notes": "First checkup",
        },
    )
    assert resp1.status_code == 201, resp1.text
    data1 = resp1.json()
    assert data1["token_number"] == 1
    assert data1["status"] == "BOOKED"
    assert data1["patient_urn"] == "KH-2026-8801"
    assert data1["doctor_id"] == doctor_id
    assert data1["booking_mode"] == "SCHEDULED"
    assert data1["visit_type"] == "NEW_CONSULTATION"
    appt1_id = data1["id"]

    # 4. Book second appointment for same doctor & day (creates another patient)
    patient2 = Patient(
        urn="KH-2026-8802",
        full_name="Second Patient",
        guardian_name="Guardian 2",
        gender="F",
        age_years=25,
        mobile="9876543221",
        address="Market Area, Ara",
    )
    db_session.add(patient2)
    db_session.flush()

    resp2 = client.post(
        "/api/appointments",
        json={
            "patient_id": patient2.id,
            "doctor_id": doctor_id,
            "appointment_date": target_date,
            "notes": "Followup",
        },
    )
    assert resp2.status_code == 201, resp2.text
    data2 = resp2.json()
    assert data2["token_number"] == 2

    # 5. List appointments
    list_resp = client.get(f"/api/appointments?appointment_date={target_date}")
    assert list_resp.status_code == 200
    list_data = list_resp.json()
    assert list_data["total"] >= 2

    # 6. Get single appointment
    get_resp = client.get(f"/api/appointments/{appt1_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["token_number"] == 1


def test_book_appointment_validations(login_client, reception_user, db_session, clock):
    """Validation gates: nonexistent patient and inactive doctor."""
    client = login_client(reception_user)
    target_date = (clock["t"].astimezone(IST).date() + timedelta(days=3)).isoformat()

    # Nonexistent patient
    resp = client.post(
        "/api/appointments",
        json={
            "patient_id": 999999,
            "doctor_id": 1,
            "appointment_date": target_date,
        },
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "patient_not_found"

    # Nonexistent doctor
    patient = Patient(
        urn="KH-2026-8803",
        full_name="Valid Patient",
        guardian_name="Guardian",
        gender="M",
        age_years=40,
        mobile="9876543222",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()

    resp2 = client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": 999999,
            "appointment_date": target_date,
        },
    )
    assert resp2.status_code == 404
    assert resp2.json()["code"] == "doctor_not_found"


def test_hybrid_booking_modes_reserve_tokens_and_reject_duplicate_visit(
    login_client, reception_user, doctor_a_user, db_session
):
    """Walk-ins are same-day only; future bookings reserve a future-date token."""
    from datetime import timedelta

    from kalyan_api import clock

    patient = Patient(
        urn="KH-2026-8890",
        full_name="Hybrid Booking Patient",
        guardian_name="Guardian",
        gender="F",
        age_years=34,
        mobile="9876543290",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()

    client = login_client(reception_user)
    doctor_id = doctor_a_user.doctor_id
    assert doctor_id is not None
    today = clock.ist_today()

    walk_in = client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_id,
            "appointment_date": today.isoformat(),
            "booking_mode": "WALK_IN",
            "visit_type": "NEW_CONSULTATION",
        },
    )
    assert walk_in.status_code == 201, walk_in.text
    assert walk_in.json()["booking_mode"] == "WALK_IN"
    assert walk_in.json()["token_number"] == 1

    duplicate = client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_id,
            "appointment_date": today.isoformat(),
            "booking_mode": "WALK_IN",
            "visit_type": "NEW_CONSULTATION",
        },
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "duplicate_appointment"

    future_date = today + timedelta(days=5)
    scheduled = client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_id,
            "appointment_date": future_date.isoformat(),
            "booking_mode": "SCHEDULED",
            "visit_type": "FOLLOW_UP",
            "notes": "Reception follow-up booking",
        },
    )
    assert scheduled.status_code == 201, scheduled.text
    scheduled_data = scheduled.json()
    assert scheduled_data["booking_mode"] == "SCHEDULED"
    assert scheduled_data["visit_type"] == "FOLLOW_UP"
    assert scheduled_data["appointment_date"] == future_date.isoformat()
    assert scheduled_data["token_number"] == 1

    listed = client.get(
        "/api/appointments",
        params={
            "date_from": today.isoformat(),
            "date_to": future_date.isoformat(),
            "booking_mode": "SCHEDULED",
        },
    )
    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    assert listed.json()["appointments"][0]["id"] == scheduled_data["id"]


def test_walk_in_cannot_be_booked_for_future_date(
    login_client, reception_user, doctor_a_user, db_session
):
    from datetime import timedelta

    from kalyan_api import clock

    patient = Patient(
        urn="KH-2026-8891",
        full_name="Future Walk-in Patient",
        guardian_name="Guardian",
        gender="M",
        age_years=31,
        mobile="9876543291",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()

    response = login_client(reception_user).post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_a_user.doctor_id,
            "appointment_date": (clock.ist_today() + timedelta(days=1)).isoformat(),
            "booking_mode": "WALK_IN",
        },
    )
    assert response.status_code == 422
    assert response.json()["code"] == "walk_in_must_be_today"
