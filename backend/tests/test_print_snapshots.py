"""Tests for historical print snapshot persistence and isolation (D-20-05, D-20-06, D-20-07).

Requirements:
- Payments, prescriptions, and clinical encounters capture demographic snapshots upon creation.
- Reprints of historical documents render the stored snapshot, NOT the corrected patient
  demographic.
- Payment tamper protection prevents modifying snapshot fields.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from kalyan_api.models import (
    Appointment,
    Patient,
    Payment,
    User,
)


def _setup_patient_and_appointment(
    session: Session,
    reception_user: User,
    doctor_user: User,
    suffix: str = "01",
) -> tuple[Patient, Appointment]:
    num_suffix = "".join(c for c in suffix if c.isdigit()) or "1234"
    mobile_digits = f"98765{num_suffix[-5:].ljust(5, '0')}"
    patient = Patient(
        urn=f"KH-2026-SNAP{suffix}",
        full_name=f"Original Snap Patient {suffix}",
        guardian_name="Snap Guardian",
        gender="M",
        age_years=42,
        mobile=mobile_digits,
        address=f"Village Snap {suffix}, Bhojpur",
        district="Bhojpur",
        state="Bihar",
    )
    session.add(patient)
    session.flush()

    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_user.doctor_id,
        appointment_date=datetime.now(UTC).date(),
        token_number=1,
        status="ARRIVED",
        created_by_user_id=reception_user.id,
    )
    session.add(appt)
    session.flush()

    return patient, appt


def test_issuance_captures_snapshots_and_retains_after_correction(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Documents store snapshot patient details at creation; subsequent patient correction does not
    alter them."""
    uid = uuid.uuid4().hex[:4]
    patient, appt = _setup_patient_and_appointment(db_session, reception_user, doctor_a_user, uid)

    rec_c: TestClient = login_client(reception_user)
    doc_c: TestClient = login_client(doctor_a_user)
    admin_c: TestClient = login_client(admin_user)

    # 1. Issue Payment via Reception
    pay_resp = rec_c.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "appointment_id": appt.id,
            "amount_paise": 30000,
            "payment_method": "CASH",
            "notes": "Consultation payment",
        },
    )
    assert pay_resp.status_code == 201, pay_resp.text
    pay_data = pay_resp.json()
    payment_id = pay_data["id"]

    # Verify initial snapshot
    assert pay_data["patient_name"] == patient.full_name
    assert pay_data["patient_urn"] == patient.urn
    assert pay_data["patient_mobile"] == patient.mobile
    assert pay_data["patient_address"] == patient.address

    # 2. Issue Encounter via Doctor
    enc_resp = doc_c.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "appointment_id": appt.id,
            "symptoms": "Knee joint pain",
            "clinical_notes": "Mild swelling right knee",
            "diagnosis": "Right Knee Osteoarthritis",
        },
    )
    assert enc_resp.status_code == 201, enc_resp.text
    enc_data = enc_resp.json()
    encounter_id = enc_data["id"]

    assert enc_data["patient_name"] == patient.full_name
    assert enc_data["patient_urn"] == patient.urn
    assert enc_data["patient_mobile"] == patient.mobile
    assert enc_data["patient_address"] == patient.address

    # 3. Issue Prescription via Doctor
    rx_resp = doc_c.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "encounter_id": encounter_id,
            "diagnosis": "Right Knee Osteoarthritis",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Paracetamol",
                    "dosage": "650mg",
                    "frequency": "TDS",
                    "duration_days": 5,
                    "instructions": "Post meals",
                }
            ],
        },
    )
    assert rx_resp.status_code == 201, rx_resp.text
    rx_data = rx_resp.json()
    prescription_id = rx_data["id"]

    assert rx_data["patient_name"] == patient.full_name
    assert rx_data["patient_urn"] == patient.urn
    assert rx_data["patient_mobile"] == patient.mobile
    assert rx_data["patient_address"] == patient.address

    # 4. Now Admin performs Demographic Correction on the patient
    orig_name = patient.full_name
    orig_mobile = patient.mobile
    orig_address = patient.address

    corr_resp = admin_c.patch(
        f"/api/admin/patients/{patient.id}/demographics",
        json={
            "reason": "Administrative correction of name and phone per official ID",
            "version_id": patient.version_id,
            "full_name": "Completely Changed Name",
            "guardian_name": "New Guardian Name",
            "gender": "M",
            "dob": "1980-01-01",
            "age_years": 46,
            "mobile": "9999999999",
            "address": "New Village, Different District",
            "district": "Patna",
            "state": "Bihar",
        },
    )
    assert corr_resp.status_code == 200, corr_resp.text

    # Verify Patient in DB has updated details
    db_session.expire_all()
    updated_patient = db_session.get(Patient, patient.id)
    assert updated_patient.full_name == "Completely Changed Name"
    assert updated_patient.mobile == "9999999999"

    # 5. Verify Payment Reprint retains original snapshot
    receipt_resp = rec_c.get(f"/api/payments/{payment_id}/receipt")
    assert receipt_resp.status_code == 200
    receipt_data = receipt_resp.json()
    assert receipt_data["patient_name"] == orig_name
    assert receipt_data["patient_mobile"] == orig_mobile
    assert receipt_data["patient_address"] == orig_address

    # 6. Verify Prescription retains original snapshot
    rx_fetch = doc_c.get(f"/api/prescriptions/{prescription_id}")
    assert rx_fetch.status_code == 200
    rx_fetch_data = rx_fetch.json()
    assert rx_fetch_data["patient_name"] == orig_name
    assert rx_fetch_data["patient_mobile"] == orig_mobile
    assert rx_fetch_data["patient_address"] == orig_address

    # 7. Verify Encounter retains original snapshot
    enc_fetch = doc_c.get(f"/api/encounters/{encounter_id}")
    assert enc_fetch.status_code == 200
    enc_fetch_data = enc_fetch.json()
    assert enc_fetch_data["patient_name"] == orig_name
    assert enc_fetch_data["patient_mobile"] == orig_mobile
    assert enc_fetch_data["patient_address"] == orig_address


def test_payment_snapshot_tamper_protection(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Payment reversal allows updating reversal metadata but strictly protects snapshot columns."""
    uid = uuid.uuid4().hex[:4]
    patient, appt = _setup_patient_and_appointment(db_session, reception_user, doctor_a_user, uid)
    rec_c: TestClient = login_client(reception_user)
    admin_c: TestClient = login_client(admin_user)

    # Record payment
    p_resp = rec_c.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "appointment_id": appt.id,
            "amount_paise": 50000,
            "payment_method": "UPI",
            "notes": "Testing tamper trigger",
        },
    )
    assert p_resp.status_code == 201
    payment_id = p_resp.json()["id"]

    # Admin reverses payment
    rev_resp = admin_c.post(
        f"/api/payments/{payment_id}/reverse",
        json={"reversal_reason": "Patient requested cancellation and refund"},
    )
    assert rev_resp.status_code == 200

    # Verify reversed payment still holds original snapshot
    payment = db_session.get(Payment, payment_id)
    assert payment.is_reversed is True
    assert payment.patient_name == f"Original Snap Patient {uid}"
    assert payment.patient_urn == patient.urn
