"""Automated regression tests for single-encounter-per-appointment invariant (DWS-01, T-19-01)."""

from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from kalyan_api.models import Appointment, AppointmentStatus, ClinicalEncounter, Patient


def test_encounter_creation_idempotent_reopens_existing(
    login_client, doctor_a_user, db_session
):
    """Starting an encounter for an appointment with an existing encounter returns 200 and the existing encounter."""
    patient = Patient(
        urn="KH-2026-7001",
        full_name="Single Encounter Patient",
        guardian_name="Guardian Name",
        gender="F",
        age_years=35,
        mobile="9876543210",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()

    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        appointment_date=date(2026, 11, 10),
        token_number=1,
        status=AppointmentStatus.BOOKED.value,
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    doc_client = login_client(doctor_a_user)

    # 1. First consultation call creates new encounter -> 201 Created
    create_resp1 = doc_client.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "appointment_id": appt.id,
            "symptoms": "Initial symptoms draft",
            "clinical_notes": "Initial notes",
            "diagnosis": "Initial diagnosis",
        },
    )
    assert create_resp1.status_code == 201, create_resp1.text
    enc1 = create_resp1.json()
    assert enc1["appointment_id"] == appt.id
    assert enc1["symptoms"] == "Initial symptoms draft"

    # Verify appointment advanced to IN_CONSULTATION
    db_session.refresh(appt)
    assert appt.status == AppointmentStatus.IN_CONSULTATION.value

    # 2. Second consultation call for the SAME appointment returns existing -> 200 OK
    create_resp2 = doc_client.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "appointment_id": appt.id,
            "symptoms": "Different symptoms that should not override without patch",
            "clinical_notes": "Different notes",
            "diagnosis": "Different diagnosis",
        },
    )
    assert create_resp2.status_code == 200, create_resp2.text
    enc2 = create_resp2.json()
    assert enc2["id"] == enc1["id"]
    assert enc2["symptoms"] == "Initial symptoms draft"


def test_database_enforces_unique_appointment_encounter_index(db_session, doctor_a_user):
    """Database level partial unique index blocks duplicate encounters for the same appointment (T-19-01)."""
    patient = Patient(
        urn="KH-2026-7002",
        full_name="DB Constraint Patient",
        guardian_name="Guardian Name",
        gender="M",
        age_years=40,
        mobile="9876543211",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()

    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        appointment_date=date(2026, 11, 10),
        token_number=2,
        status=AppointmentStatus.BOOKED.value,
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    enc1 = ClinicalEncounter(
        appointment_id=appt.id,
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        symptoms="Draft symptoms 1",
        clinical_notes="",
        diagnosis="",
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(enc1)
    db_session.flush()

    # Second encounter directly inserted in SQL bypassing API router
    enc2 = ClinicalEncounter(
        appointment_id=appt.id,
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        symptoms="Draft symptoms 2",
        clinical_notes="",
        diagnosis="",
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(enc2)
    with pytest.raises(IntegrityError) as exc_info:
        db_session.flush()
    assert "uq_clinical_encounters_appointment_id" in str(exc_info.value)
    db_session.rollback()


def test_encounters_without_appointment_allowed_multiple(db_session, doctor_a_user):
    """Encounters without appointment (walk-in without token) can be created multiple times for the same patient."""
    patient = Patient(
        urn="KH-2026-7003",
        full_name="No Appointment Patient",
        guardian_name="Guardian Name",
        gender="M",
        age_years=45,
        mobile="9876543212",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()

    enc1 = ClinicalEncounter(
        appointment_id=None,
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        symptoms="Walkin 1",
        clinical_notes="",
        diagnosis="",
        created_by_user_id=doctor_a_user.id,
    )
    enc2 = ClinicalEncounter(
        appointment_id=None,
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        symptoms="Walkin 2",
        clinical_notes="",
        diagnosis="",
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(enc1)
    db_session.add(enc2)
    db_session.flush()
    assert enc1.id is not None
    assert enc2.id is not None
