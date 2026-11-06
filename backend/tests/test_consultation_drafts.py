"""Automated tests for consultation drafts, autosave, finalisation validation, and tamper trigger (DWS-02, D-19-09, D-19-22, T-19-02)."""

from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from kalyan_api.models import Appointment, AppointmentStatus, ClinicalEncounter, Patient


def test_draft_consultation_save_and_update(login_client, doctor_a_user, db_session):
    """Draft consultation can be created with empty/partial fields and updated repeatedly with version_id increments."""
    patient = Patient(
        urn="KH-2026-7101",
        full_name="Draft Patient",
        guardian_name="Guardian Name",
        gender="M",
        age_years=28,
        mobile="9876543301",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()

    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        appointment_date=date(2026, 11, 10),
        token_number=10,
        status=AppointmentStatus.BOOKED.value,
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    doc_client = login_client(doctor_a_user)

    # 1. Create initial draft with empty symptoms, notes, diagnosis
    create_resp = doc_client.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "appointment_id": appt.id,
            "symptoms": "",
            "clinical_notes": "",
            "diagnosis": "",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    enc = create_resp.json()
    assert enc["is_finalised"] is False
    assert enc["version_id"] == 1
    assert enc["symptoms"] == ""

    enc_id = enc["id"]

    # 2. Autosave partial update 1: symptoms added
    patch1 = doc_client.patch(
        f"/api/encounters/{enc_id}",
        json={
            "symptoms": "Low back pain radiating to left leg",
            "version_id": 1,
        },
    )
    assert patch1.status_code == 200, patch1.text
    data1 = patch1.json()
    assert data1["symptoms"] == "Low back pain radiating to left leg"
    assert data1["version_id"] == 2

    # 3. Autosave partial update 2: clinical notes added
    patch2 = doc_client.patch(
        f"/api/encounters/{enc_id}",
        json={
            "clinical_notes": "SLR positive on left side at 45 degrees",
            "version_id": 2,
        },
    )
    assert patch2.status_code == 200, patch2.text
    data2 = patch2.json()
    assert data2["clinical_notes"] == "SLR positive on left side at 45 degrees"
    assert data2["version_id"] == 3


def test_finalisation_validates_mandatory_symptoms_and_diagnosis(login_client, doctor_a_user, db_session):
    """Finalisation strictly requires symptoms and diagnosis to be non-empty (>= 2 chars) (D-19-09)."""
    patient = Patient(
        urn="KH-2026-7102",
        full_name="Finalisation Validation Patient",
        guardian_name="Guardian Name",
        gender="F",
        age_years=45,
        mobile="9876543302",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()

    doc_client = login_client(doctor_a_user)

    # Create empty draft
    create_resp = doc_client.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "symptoms": "",
            "clinical_notes": "",
            "diagnosis": "",
        },
    )
    assert create_resp.status_code == 201
    enc_id = create_resp.json()["id"]

    # 1. Attempt to finalise when symptoms is empty -> 422 symptoms_required
    fin_fail_symptoms = doc_client.post(f"/api/encounters/{enc_id}/finalise")
    assert fin_fail_symptoms.status_code == 422, fin_fail_symptoms.text
    assert fin_fail_symptoms.json()["code"] == "symptoms_required"

    # Add symptoms but leave diagnosis empty
    doc_client.patch(
        f"/api/encounters/{enc_id}",
        json={"symptoms": "Neck stiffness", "version_id": 1},
    )

    # 2. Attempt to finalise when diagnosis is empty -> 422 diagnosis_required
    fin_fail_diag = doc_client.post(f"/api/encounters/{enc_id}/finalise")
    assert fin_fail_diag.status_code == 422, fin_fail_diag.text
    assert fin_fail_diag.json()["code"] == "diagnosis_required"

    # 3. Finalise with payload providing valid diagnosis -> 200 OK
    fin_ok = doc_client.post(
        f"/api/encounters/{enc_id}/finalise",
        json={"symptoms": "Neck stiffness", "diagnosis": "Cervical Spondylosis"},
    )
    assert fin_ok.status_code == 200, fin_ok.text
    final_data = fin_ok.json()
    assert final_data["is_finalised"] is True
    assert final_data["diagnosis"] == "Cervical Spondylosis"


def test_appointment_check_in_sets_check_in_at(login_client, reception_user, doctor_a_user, db_session):
    """Marking appointment ARRIVED records check_in_at timestamp (D-19-04, DWS-03)."""
    patient = Patient(
        urn="KH-2026-7103",
        full_name="CheckIn Patient",
        guardian_name="Guardian Name",
        gender="M",
        age_years=50,
        mobile="9876543303",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()

    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        appointment_date=date(2026, 11, 10),
        token_number=15,
        status=AppointmentStatus.BOOKED.value,
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    assert appt.check_in_at is None

    rec_client = login_client(reception_user)

    # Reception checks in patient
    checkin_resp = rec_client.patch(
        f"/api/appointments/{appt.id}/status",
        json={
            "status": "ARRIVED",
            "version_id": 1,
        },
    )
    assert checkin_resp.status_code == 200, checkin_resp.text
    data = checkin_resp.json()
    assert data["status"] == "ARRIVED"
    assert data["check_in_at"] is not None

    db_session.refresh(appt)
    assert appt.check_in_at is not None
    original_check_in = appt.check_in_at

    # Subsequent transition does not overwrite check_in_at
    # Move to DONE via doctor consultation
    appt.status = AppointmentStatus.DONE.value
    appt.version_id += 1
    db_session.flush()
    db_session.refresh(appt)
    assert appt.check_in_at == original_check_in


def test_trigger_allows_draft_updates_blocks_finalised_tampering(db_session, doctor_a_user):
    """PostgreSQL tamper trigger allows updates while is_finalised=False, but strictly blocks when is_finalised=True (T-19-02)."""
    patient = Patient(
        urn="KH-2026-7104",
        full_name="Trigger Test Patient",
        guardian_name="Guardian Name",
        gender="F",
        age_years=33,
        mobile="9876543304",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()

    enc = ClinicalEncounter(
        appointment_id=None,
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        symptoms="Draft symptoms",
        clinical_notes="Draft notes",
        diagnosis="Draft diagnosis",
        is_finalised=False,
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(enc)
    db_session.flush()

    # Direct SQL update while unfinalised succeeds
    db_session.execute(
        text("UPDATE clinical_encounters SET symptoms = 'Updated draft' WHERE id = :id"),
        {"id": enc.id},
    )
    db_session.commit()

    # Finalise encounter directly
    db_session.execute(
        text("UPDATE clinical_encounters SET is_finalised = TRUE WHERE id = :id"),
        {"id": enc.id},
    )
    db_session.commit()

    # Direct SQL update on symptoms while finalised fails with exception
    with pytest.raises(DBAPIError) as exc_info:
        db_session.execute(
            text("UPDATE clinical_encounters SET symptoms = 'Tampered' WHERE id = :id"),
            {"id": enc.id},
        )
    assert "Finalised encounter cannot be modified" in str(exc_info.value)
    db_session.rollback()
