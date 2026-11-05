"""Functional tests for appointment booking REST API endpoints (APT-01)."""

from kalyan_api.models import Department, Patient


def test_book_appointment_lifecycle(login_client, reception_user, doctor_a_user, db_session):
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
    assert len(doctor_a_user.doctor.departments) > 0
    dept = doctor_a_user.doctor.departments[0]

    # 2. Log in as reception
    client = login_client(reception_user)

    # 3. Book first appointment
    resp1 = client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_id,
            "department_id": dept.id,
            "appointment_date": "2026-11-05",
            "notes": "First checkup",
        },
    )
    assert resp1.status_code == 201, resp1.text
    data1 = resp1.json()
    assert data1["token_number"] == 1
    assert data1["status"] == "BOOKED"
    assert data1["patient_urn"] == "KH-2026-8801"
    assert data1["doctor_id"] == doctor_id
    assert data1["department_id"] == dept.id
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
            "department_id": dept.id,
            "appointment_date": "2026-11-05",
            "notes": "Followup",
        },
    )
    assert resp2.status_code == 201, resp2.text
    data2 = resp2.json()
    assert data2["token_number"] == 2
    assert data2["department_id"] == dept.id

    # 5. List appointments
    list_resp = client.get("/api/appointments?appointment_date=2026-11-05")
    assert list_resp.status_code == 200
    list_data = list_resp.json()
    assert list_data["total"] >= 2

    # 6. Get single appointment
    get_resp = client.get(f"/api/appointments/{appt1_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["token_number"] == 1


def test_book_appointment_validations(login_client, reception_user, db_session):
    """Validation gates: nonexistent patient and inactive doctor."""
    client = login_client(reception_user)

    dept = db_session.query(Department).filter_by(name_en="Physiotherapy / General OPD").first()
    if not dept:
        dept = Department(name_en="Physiotherapy / General OPD", is_active=True)
        db_session.add(dept)
        db_session.flush()

    # Nonexistent patient
    resp = client.post(
        "/api/appointments",
        json={
            "patient_id": 999999,
            "doctor_id": 1,
            "department_id": dept.id,
            "appointment_date": "2026-11-05",
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
            "department_id": dept.id,
            "appointment_date": "2026-11-05",
        },
    )
    assert resp2.status_code == 404
    assert resp2.json()["code"] == "doctor_not_found"
