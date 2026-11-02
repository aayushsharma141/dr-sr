"""Functional tests for hybrid appointment and daily token workflows."""

from datetime import date

from kalyan_api.models import DailyTokenSequence, Patient


def _patient(db_session, urn: str, name: str, mobile: str) -> Patient:
    patient = Patient(
        urn=urn,
        full_name=name,
        guardian_name="Guardian",
        gender="M",
        age_years=30,
        mobile=mobile,
        address="Station Road, Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def test_future_scheduled_visits_do_not_allocate_tokens(
    login_client, reception_user, doctor_a_user, db_session, monkeypatch
):
    """Future bookings reserve a date but do not consume the per-day token sequence."""
    monkeypatch.setattr("kalyan_api.clock.ist_today", lambda: date(2026, 11, 2))
    patient = _patient(db_session, "KH-2026-8801", "Booking Test Patient", "9876543220")
    patient2 = _patient(db_session, "KH-2026-8802", "Second Patient", "9876543221")
    doctor_id = doctor_a_user.doctor_id
    assert doctor_id is not None
    client = login_client(reception_user)

    responses = [
        client.post(
            "/api/appointments",
            json={
                "patient_id": person.id,
                "doctor_id": doctor_id,
                "appointment_date": "2026-11-05",
                "booking_mode": "SCHEDULED",
                "visit_type": "FOLLOW_UP",
                "notes": "Reception callback requested",
            },
        )
        for person in (patient, patient2)
    ]
    assert all(response.status_code == 201 for response in responses)
    first, second = (response.json() for response in responses)

    assert first["booking_mode"] == "SCHEDULED"
    assert first["visit_type"] == "FOLLOW_UP"
    assert first["token_number"] is None
    assert second["token_number"] is None
    assert first["status"] == second["status"] == "BOOKED"
    assert db_session.get(
        DailyTokenSequence, (doctor_id, date(2026, 11, 5))
    ) is None

    listed = client.get(
        "/api/appointments",
        params={
            "date_from": "2026-11-05",
            "date_to": "2026-11-05",
            "booking_mode": "SCHEDULED",
            "has_token": "false",
        },
    )
    assert listed.status_code == 200
    assert listed.json()["total"] == 2

    fetched = client.get(f"/api/appointments/{first['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["token_number"] is None
    assert fetched.json()["visit_type"] == "FOLLOW_UP"


def test_walk_in_bookings_allocate_sequential_tokens_for_ist_today(
    login_client, reception_user, doctor_a_user, db_session, monkeypatch
):
    """Walk-in bookings remain in the current IST queue and allocate tokens immediately."""
    clinic_day = date(2026, 11, 2)
    monkeypatch.setattr("kalyan_api.clock.ist_today", lambda: clinic_day)
    doctor_id = doctor_a_user.doctor_id
    assert doctor_id is not None
    client = login_client(reception_user)

    first_patient = _patient(db_session, "KH-2026-8811", "Walk-in One", "9876543231")
    second_patient = _patient(db_session, "KH-2026-8812", "Walk-in Two", "9876543232")

    responses = [
        client.post(
            "/api/appointments",
            json={
                "patient_id": person.id,
                "doctor_id": doctor_id,
                "appointment_date": clinic_day.isoformat(),
                "booking_mode": "WALK_IN",
                "visit_type": "NEW_CONSULTATION",
            },
        )
        for person in (first_patient, second_patient)
    ]

    assert [response.status_code for response in responses] == [201, 201]
    assert [response.json()["token_number"] for response in responses] == [1, 2]
    assert all(response.json()["booking_mode"] == "WALK_IN" for response in responses)


def test_duplicate_active_booking_is_rejected_without_consuming_a_token(
    login_client, reception_user, doctor_a_user, db_session, monkeypatch
):
    """A duplicate same-patient/doctor/date booking is rejected and leaves no token gap."""
    clinic_day = date(2026, 11, 2)
    monkeypatch.setattr("kalyan_api.clock.ist_today", lambda: clinic_day)
    doctor_id = doctor_a_user.doctor_id
    assert doctor_id is not None
    client = login_client(reception_user)
    patient = _patient(db_session, "KH-2026-8821", "Duplicate Patient", "9876543241")
    next_patient = _patient(db_session, "KH-2026-8822", "Next Patient", "9876543242")

    payload = {
        "patient_id": patient.id,
        "doctor_id": doctor_id,
        "appointment_date": clinic_day.isoformat(),
        "booking_mode": "WALK_IN",
        "visit_type": "NEW_CONSULTATION",
    }
    first = client.post("/api/appointments", json=payload)
    duplicate = client.post("/api/appointments", json=payload)
    next_booking = client.post(
        "/api/appointments",
        json={**payload, "patient_id": next_patient.id},
    )

    assert first.status_code == 201
    assert first.json()["token_number"] == 1
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "appointment_already_exists"
    assert next_booking.status_code == 201
    assert next_booking.json()["token_number"] == 2


def test_scheduled_visit_gets_token_only_when_checked_in_on_ist_date(
    login_client, reception_user, doctor_a_user, db_session, monkeypatch
):
    """Scheduled visit cannot check in early; on its date token allocation and arrival are atomic."""
    clinic_today = date(2026, 11, 2)
    appointment_day = date(2026, 11, 3)
    monkeypatch.setattr("kalyan_api.clock.ist_today", lambda: clinic_today)
    doctor_id = doctor_a_user.doctor_id
    assert doctor_id is not None
    client = login_client(reception_user)
    patient = _patient(db_session, "KH-2026-8831", "Scheduled Check-in", "9876543251")

    created = client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_id,
            "appointment_date": appointment_day.isoformat(),
            "booking_mode": "SCHEDULED",
            "visit_type": "PHYSIOTHERAPY_SESSION",
        },
    )
    assert created.status_code == 201, created.text
    appointment = created.json()
    assert appointment["token_number"] is None

    early = client.patch(
        f"/api/appointments/{appointment['id']}/status",
        json={"status": "ARRIVED", "version_id": 1},
    )
    assert early.status_code == 409
    assert early.json()["code"] == "scheduled_visit_not_due"

    monkeypatch.setattr("kalyan_api.clock.ist_today", lambda: appointment_day)
    arrived = client.patch(
        f"/api/appointments/{appointment['id']}/status",
        json={"status": "ARRIVED", "version_id": 1},
    )
    assert arrived.status_code == 200, arrived.text
    assert arrived.json()["status"] == "ARRIVED"
    assert arrived.json()["token_number"] == 1
    assert arrived.json()["version_id"] == 2


def test_walk_in_and_date_validation(login_client, reception_user, doctor_a_user, db_session, monkeypatch):
    """Walk-ins cannot be booked for future dates and all bookings reject back-dated visits."""
    clinic_today = date(2026, 11, 2)
    monkeypatch.setattr("kalyan_api.clock.ist_today", lambda: clinic_today)
    patient = _patient(db_session, "KH-2026-8841", "Date Validation", "9876543261")
    doctor_id = doctor_a_user.doctor_id
    assert doctor_id is not None
    client = login_client(reception_user)

    future_walk_in = client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_id,
            "appointment_date": "2026-11-05",
            "booking_mode": "WALK_IN",
        },
    )
    assert future_walk_in.status_code == 422
    assert future_walk_in.json()["code"] == "walk_in_must_be_today"

    past_scheduled = client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_id,
            "appointment_date": "2026-11-01",
            "booking_mode": "SCHEDULED",
        },
    )
    assert past_scheduled.status_code == 422
    assert past_scheduled.json()["code"] == "appointment_date_in_past"


def test_book_appointment_validations(login_client, reception_user, db_session):
    """Validation gates: nonexistent patient and inactive doctor."""
    client = login_client(reception_user)

    resp = client.post(
        "/api/appointments",
        json={
            "patient_id": 999999,
            "doctor_id": 1,
            "appointment_date": "2026-11-05",
            "booking_mode": "SCHEDULED",
        },
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "patient_not_found"

    patient = _patient(db_session, "KH-2026-8803", "Valid Patient", "9876543222")
    resp2 = client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": 999999,
            "appointment_date": "2026-11-05",
            "booking_mode": "SCHEDULED",
        },
    )
    assert resp2.status_code == 404
    assert resp2.json()["code"] == "doctor_not_found"


def test_same_day_scheduled_visit_enters_doctor_queue_only_after_check_in(
    login_client, reception_user, doctor_a_user, db_session, monkeypatch
):
    """A same-day scheduled visit stays outside the queue until check-in assigns a token."""
    clinic_day = date(2026, 11, 2)
    monkeypatch.setattr("kalyan_api.clock.ist_today", lambda: clinic_day)
    doctor_id = doctor_a_user.doctor_id
    assert doctor_id is not None
    patient = _patient(db_session, "KH-2026-8851", "Queue Check-in Patient", "9876543271")
    reception = login_client(reception_user)
    doctor = login_client(doctor_a_user)

    created = reception.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_id,
            "appointment_date": clinic_day.isoformat(),
            "booking_mode": "SCHEDULED",
            "visit_type": "FOLLOW_UP",
        },
    )
    assert created.status_code == 201, created.text
    appointment = created.json()
    assert appointment["token_number"] is None

    before_check_in = doctor.get("/api/doctor/queue")
    assert before_check_in.status_code == 200, before_check_in.text
    assert before_check_in.json()["total_active"] == 0

    arrived = reception.patch(
        f"/api/appointments/{appointment['id']}/status",
        json={"status": "ARRIVED", "version_id": 1},
    )
    assert arrived.status_code == 200, arrived.text
    assert arrived.json()["token_number"] == 1

    after_check_in = doctor.get("/api/doctor/queue")
    assert after_check_in.status_code == 200, after_check_in.text
    queue = after_check_in.json()
    assert queue["total_active"] == 1
    assert len(queue["waiting"]) == 1
    assert queue["waiting"][0]["token_number"] == 1
