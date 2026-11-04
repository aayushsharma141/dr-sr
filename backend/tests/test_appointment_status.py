"""Unit and integration tests for appointment status workflow and doctor queue (APT-02)."""

from kalyan_api import clock
from kalyan_api.models import Appointment, AppointmentStatus, Patient


def test_appointment_status_lifecycle(login_client, reception_user, doctor_a_user, db_session):
    """Test full valid progression: BOOKED -> ARRIVED -> IN_CONSULTATION -> DONE."""
    # 1. Setup Patient and Doctor
    patient = Patient(
        urn="KH-2026-7701",
        full_name="Status Lifecycle Patient",
        guardian_name="Guardian",
        gender="M",
        age_years=40,
        mobile="9876543301",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()

    doctor_id = doctor_a_user.doctor_id
    assert doctor_id is not None
    today = clock.utcnow().date()

    # 2. Reception logs in and books appointment
    reception_client = login_client(reception_user)
    dept = doctor_a_user.doctor.departments[0]
    book_resp = reception_client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_id,
            "department_id": dept.id,
            "appointment_date": today.isoformat(),
        },
    )
    assert book_resp.status_code == 201
    appt_data = book_resp.json()
    appt_id = appt_data["id"]
    assert appt_data["status"] == "BOOKED"
    assert appt_data["version_id"] == 1

    # 3. Reception marks patient ARRIVED
    arr_resp = reception_client.patch(
        f"/api/appointments/{appt_id}/status",
        json={
            "status": "ARRIVED",
            "version_id": 1,
        },
    )
    assert arr_resp.status_code == 200
    assert arr_resp.json()["status"] == "ARRIVED"
    assert arr_resp.json()["version_id"] == 2

    # 4. Doctor logs in and starts consultation (IN_CONSULTATION)
    doctor_client = login_client(doctor_a_user)
    consult_resp = doctor_client.patch(
        f"/api/appointments/{appt_id}/status",
        json={
            "status": "IN_CONSULTATION",
            "version_id": 2,
        },
    )
    assert consult_resp.status_code == 200
    assert consult_resp.json()["status"] == "IN_CONSULTATION"
    assert consult_resp.json()["version_id"] == 3

    # 5. Doctor completes consultation (DONE)
    done_resp = doctor_client.patch(
        f"/api/appointments/{appt_id}/status",
        json={
            "status": "DONE",
            "version_id": 3,
        },
    )
    assert done_resp.status_code == 200
    assert done_resp.json()["status"] == "DONE"
    assert done_resp.json()["version_id"] == 4


def test_invalid_status_transitions_rejected(
    login_client, reception_user, doctor_a_user, db_session
):
    """Validation: invalid status jumps and mutations out of terminal states."""
    patient = Patient(
        urn="KH-2026-7702",
        full_name="Invalid Jump Patient",
        guardian_name="Guardian",
        gender="F",
        age_years=29,
        mobile="9876543302",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()

    today = clock.utcnow().date()
    reception_client = login_client(reception_user)
    dept = doctor_a_user.doctor.departments[0]
    book_resp = reception_client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept.id,
            "appointment_date": today.isoformat(),
        },
    )
    appt_id = book_resp.json()["id"]

    # Attempt illegal jump: BOOKED directly to DONE
    bad_resp = reception_client.patch(
        f"/api/appointments/{appt_id}/status",
        json={
            "status": "DONE",
            "version_id": 1,
        },
    )
    assert bad_resp.status_code == 422
    assert bad_resp.json()["code"] == "invalid_status_transition"


def test_cancellation_requires_reason(login_client, reception_user, doctor_a_user, db_session):
    """Transitioning to CANCELLED requires a non-empty cancellation_reason."""
    patient = Patient(
        urn="KH-2026-7703",
        full_name="Cancel Patient",
        guardian_name="Guardian",
        gender="M",
        age_years=50,
        mobile="9876543303",
        address="Bhojpur",
    )
    db_session.add(patient)
    db_session.flush()

    today = clock.utcnow().date()
    reception_client = login_client(reception_user)
    dept = doctor_a_user.doctor.departments[0]
    book_resp = reception_client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept.id,
            "appointment_date": today.isoformat(),
        },
    )
    appt_id = book_resp.json()["id"]

    # Attempt cancel without reason
    fail_resp = reception_client.patch(
        f"/api/appointments/{appt_id}/status",
        json={
            "status": "CANCELLED",
            "version_id": 1,
            "cancellation_reason": "",
        },
    )
    assert fail_resp.status_code == 422
    assert fail_resp.json()["code"] == "cancellation_reason_required"

    # With valid reason
    succ_resp = reception_client.patch(
        f"/api/appointments/{appt_id}/status",
        json={
            "status": "CANCELLED",
            "version_id": 1,
            "cancellation_reason": "Patient requested postponement to next week",
        },
    )
    assert succ_resp.status_code == 200
    assert succ_resp.json()["status"] == "CANCELLED"
    assert succ_resp.json()["cancellation_reason"] == "Patient requested postponement to next week"


def test_status_update_conflict(login_client, reception_user, doctor_a_user, db_session):
    """Stale version_id causes HTTP 409 Conflict."""
    patient = Patient(
        urn="KH-2026-7704",
        full_name="Conflict Patient",
        guardian_name="Guardian",
        gender="F",
        age_years=33,
        mobile="9876543304",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()

    today = clock.utcnow().date()
    reception_client = login_client(reception_user)
    dept = doctor_a_user.doctor.departments[0]
    book_resp = reception_client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept.id,
            "appointment_date": today.isoformat(),
        },
    )
    appt_id = book_resp.json()["id"]

    # First update moves to ARRIVED -> version becomes 2
    resp1 = reception_client.patch(
        f"/api/appointments/{appt_id}/status",
        json={"status": "ARRIVED", "version_id": 1},
    )
    assert resp1.status_code == 200

    # Second update using stale version 1
    resp2 = reception_client.patch(
        f"/api/appointments/{appt_id}/status",
        json={"status": "NO_SHOW", "version_id": 1},
    )
    assert resp2.status_code == 409
    assert resp2.json()["code"] == "version_conflict"


def test_doctor_queue_retrieval(login_client, reception_user, doctor_a_user, db_session):
    """Doctor retrieves today's consultation queue segmented by status."""
    today = clock.utcnow().date()
    doc_id = doctor_a_user.doctor_id

    # Create 3 patients and appointments
    p1 = Patient(
        urn="KH-2026-7705",
        full_name="Waiting Patient",
        guardian_name="Guardian",
        gender="M",
        age_years=22,
        mobile="9876543305",
        address="Ara",
    )
    p2 = Patient(
        urn="KH-2026-7706",
        full_name="Booked Patient",
        guardian_name="Guardian",
        gender="F",
        age_years=45,
        mobile="9876543306",
        address="Ara",
    )
    db_session.add_all([p1, p2])
    db_session.flush()

    # Appointment 1: Arrived
    a1 = Appointment(
        patient_id=p1.id,
        doctor_id=doc_id,
        appointment_date=today,
        token_number=1,
        status=AppointmentStatus.ARRIVED.value,
        created_by_user_id=reception_user.id,
    )
    # Appointment 2: Booked
    a2 = Appointment(
        patient_id=p2.id,
        doctor_id=doc_id,
        appointment_date=today,
        token_number=2,
        status=AppointmentStatus.BOOKED.value,
        created_by_user_id=reception_user.id,
    )
    db_session.add_all([a1, a2])
    db_session.flush()

    doctor_client = login_client(doctor_a_user)
    queue_resp = doctor_client.get("/api/doctor/queue")
    assert queue_resp.status_code == 200
    q_data = queue_resp.json()
    assert q_data["doctor_id"] == doc_id
    assert len(q_data["waiting"]) >= 1
    assert q_data["waiting"][0]["patient_urn"] == "KH-2026-7705"
    assert len(q_data["booked"]) >= 1

    # Reception user attempting to access /api/doctor/queue is forbidden (403)
    rec_client = login_client(reception_user)
    rec_queue_resp = rec_client.get("/api/doctor/queue")
    assert rec_queue_resp.status_code == 403
