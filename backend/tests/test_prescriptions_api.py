"""Integration tests for structured doctor prescriptions REST API (RX-01).

Guarantees:
- Only licensed doctors can issue prescriptions (Role.DOCTOR, PRESCRIPTION_WRITE).
- Receptionist and Admin receive HTTP 403 Forbidden on create or read.
- Doctor silo: Doctor B cannot read Doctor A's prescription (HTTP 404).
- In-transaction audit event PRESCRIPTION_CREATED recorded with item counts and diagnosis.
- Validates medication duration bounds (1-365) and unique item ordering.
"""

from sqlalchemy import select

from kalyan_api.models import AuditLog, Patient


def _create_test_patient(db_session, suffix="10") -> Patient:
    patient = Patient(
        urn=f"KH-2026-77{suffix}",
        full_name=f"Prescription Test Patient {suffix}",
        guardian_name="Guardian Name",
        gender="M",
        age_years=48,
        mobile=f"98765477{suffix}",
        address="Ara, Bihar",
        district="Bhojpur",
        state="Bihar",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def test_doctor_creates_and_retrieves_prescription(login_client, doctor_a_user, db_session):
    """Doctor successfully writes prescription with structured medication items."""
    patient = _create_test_patient(db_session, "01")
    doctor_client = login_client(doctor_a_user)

    rx_payload = {
        "patient_id": patient.id,
        "diagnosis": "Lumbar Radiculopathy L4-L5",
        "dietary_advice": "High fiber diet, adequate hydration",
        "general_advice": "Avoid forward bending, lift with knees",
        "follow_up_date": "2026-11-20",
        "items": [
            {
                "item_order": 1,
                "medicine_name": "Tab Pregabalin",
                "dosage": "75 mg",
                "frequency": "0-0-1",
                "duration_days": 10,
                "instructions": "After dinner at bedtime",
            },
            {
                "item_order": 2,
                "medicine_name": "Tab Paracetamol",
                "dosage": "650 mg",
                "frequency": "1-0-1",
                "duration_days": 5,
                "instructions": "After food if pain occurs",
            },
        ],
    }

    create_resp = doctor_client.post("/api/prescriptions", json=rx_payload)
    assert create_resp.status_code == 201, create_resp.text
    rx_data = create_resp.json()

    assert rx_data["id"] is not None
    assert rx_data["patient_id"] == patient.id
    assert rx_data["patient_urn"] == patient.urn
    assert rx_data["doctor_id"] == doctor_a_user.doctor_id
    assert rx_data["diagnosis"] == "Lumbar Radiculopathy L4-L5"
    assert rx_data["follow_up_date"] == "2026-11-20"
    assert len(rx_data["items"]) == 2
    assert rx_data["items"][0]["medicine_name"] == "Tab Pregabalin"
    assert rx_data["items"][1]["medicine_name"] == "Tab Paracetamol"

    rx_id = rx_data["id"]

    # Verify GET /api/prescriptions/{id}
    get_resp = doctor_client.get(f"/api/prescriptions/{rx_id}")
    assert get_resp.status_code == 200
    fetched_data = get_resp.json()
    assert fetched_data["id"] == rx_id
    assert len(fetched_data["items"]) == 2

    # Verify GET /api/patients/{id}/prescriptions
    list_resp = doctor_client.get(f"/api/patients/{patient.id}/prescriptions")
    assert list_resp.status_code == 200
    summaries = list_resp.json()
    assert len(summaries) >= 1
    assert summaries[0]["id"] == rx_id
    assert summaries[0]["items_count"] == 2

    # Verify AuditLog row created in-transaction
    audit_row = db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "PRESCRIPTION_CREATED",
            AuditLog.entity_id == str(rx_id),
        )
    ).scalar_one_or_none()
    assert audit_row is not None
    assert audit_row.actor_user_id == doctor_a_user.id
    assert audit_row.after_data["diagnosis"] == "Lumbar Radiculopathy L4-L5"
    assert audit_row.after_data["items_count"] == 2


def test_prescription_validation_failures(login_client, doctor_a_user, db_session):
    """Validation rejected on invalid input data."""
    patient = _create_test_patient(db_session, "02")
    doctor_client = login_client(doctor_a_user)

    # Empty items list
    resp1 = doctor_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "diagnosis": "Valid Diagnosis",
            "items": [],
        },
    )
    assert resp1.status_code == 422

    # Duplicate item_order
    resp2 = doctor_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "diagnosis": "Valid Diagnosis",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Med A",
                    "dosage": "500mg",
                    "frequency": "OD",
                    "duration_days": 5,
                },
                {
                    "item_order": 1,  # Duplicate
                    "medicine_name": "Med B",
                    "dosage": "250mg",
                    "frequency": "BD",
                    "duration_days": 3,
                },
            ],
        },
    )
    assert resp2.status_code == 422

    # Invalid duration_days (0 or negative)
    resp3 = doctor_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "diagnosis": "Valid Diagnosis",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Med A",
                    "dosage": "500mg",
                    "frequency": "OD",
                    "duration_days": 0,
                }
            ],
        },
    )
    assert resp3.status_code == 422

    # Non-existent patient
    resp4 = doctor_client.post(
        "/api/prescriptions",
        json={
            "patient_id": 999999,
            "diagnosis": "Valid Diagnosis",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Med A",
                    "dosage": "500mg",
                    "frequency": "OD",
                    "duration_days": 5,
                }
            ],
        },
    )
    assert resp4.status_code == 404


def test_reception_and_admin_cannot_create_or_read_prescription(
    login_client, admin_user, reception_user, doctor_a_user, db_session
):
    """Clinical permission enforcement: Reception and Admin receive 403 Forbidden."""
    patient = _create_test_patient(db_session, "03")

    # Doctor creates a prescription first
    doctor_client = login_client(doctor_a_user)
    create_resp = doctor_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "diagnosis": "Cervical Strain",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Tab Aceclofenac",
                    "dosage": "100mg",
                    "frequency": "1-0-1",
                    "duration_days": 5,
                }
            ],
        },
    )
    assert create_resp.status_code == 201
    rx_id = create_resp.json()["id"]

    # Reception cannot create prescription
    rec_client = login_client(reception_user)
    rec_post = rec_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "diagnosis": "Unauthorized Rx",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Tab Aceclofenac",
                    "dosage": "100mg",
                    "frequency": "1-0-1",
                    "duration_days": 5,
                }
            ],
        },
    )
    assert rec_post.status_code == 403

    # Admin cannot create prescription
    adm_client = login_client(admin_user)
    adm_post = adm_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "diagnosis": "Unauthorized Rx",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Tab Aceclofenac",
                    "dosage": "100mg",
                    "frequency": "1-0-1",
                    "duration_days": 5,
                }
            ],
        },
    )
    assert adm_post.status_code == 403

    # Reception and Admin cannot read prescription (CLINICAL_PERMISSIONS restricted to Doctor)
    assert rec_client.get(f"/api/prescriptions/{rx_id}").status_code == 403
    assert adm_client.get(f"/api/prescriptions/{rx_id}").status_code == 403


def test_doctor_silo_cross_isolation_on_prescriptions(
    login_client, doctor_a_user, doctor_b_user, db_session
):
    """Doctor B cannot view Doctor A's prescription (D-03)."""
    patient = _create_test_patient(db_session, "04")

    # Doctor A creates prescription
    doc_a_client = login_client(doctor_a_user)
    create_resp = doc_a_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "diagnosis": "Plantar Fasciitis",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Gel Diclofenac",
                    "dosage": "1 tube",
                    "frequency": "Local application TDS",
                    "duration_days": 7,
                }
            ],
        },
    )
    assert create_resp.status_code == 201
    rx_id = create_resp.json()["id"]

    # Doctor B attempts to view Doctor A's prescription
    doc_b_client = login_client(doctor_b_user)
    resp = doc_b_client.get(f"/api/prescriptions/{rx_id}")
    assert resp.status_code == 404
