"""Unit tests for Phase 13 appointment and clinical encounter models and constraints."""

from datetime import date

import pytest
from sqlalchemy.exc import DBAPIError, IntegrityError

from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    ClinicalAddendum,
    ClinicalEncounter,
    DailyTokenSequence,
    Patient,
)


def test_appointment_and_encounter_models(db_session, doctor_a_user, admin_user):
    """Verify Appointment, DailyTokenSequence, ClinicalEncounter and Addendum persistence."""
    doctor_id = doctor_a_user.doctor_id
    assert doctor_id is not None

    # 1. Create Patient
    patient = Patient(
        urn="KH-2026-9901",
        full_name="Model Test Patient",
        guardian_name="Guardian Name",
        gender="M",
        age_years=35,
        mobile="9876543210",
        address="123 Hospital Road",
        district="Bhojpur",
        state="Bihar",
    )
    db_session.add(patient)
    db_session.flush()

    # 2. Create DailyTokenSequence
    today = date(2026, 11, 1)
    seq = DailyTokenSequence(
        doctor_id=doctor_id,
        appointment_date=today,
        last_token=1,
    )
    db_session.add(seq)
    db_session.flush()

    # 3. Create Appointment
    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_id,
        appointment_date=today,
        token_number=1,
        status=AppointmentStatus.BOOKED.value,
        created_by_user_id=admin_user.id,
    )
    db_session.add(appt)
    db_session.flush()
    assert appt.id is not None
    assert appt.status == "BOOKED"
    assert appt.booking_mode == "WALK_IN"
    assert appt.visit_type == "UNSPECIFIED"
    assert appt.token_number == 1

    # 4. Create Clinical Encounter
    enc = ClinicalEncounter(
        appointment_id=appt.id,
        patient_id=patient.id,
        doctor_id=doctor_id,
        symptoms="Persistent low back pain",
        clinical_notes="Tenderness at L4-L5 region",
        diagnosis="Lumbar spondylosis",
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(enc)
    db_session.flush()
    assert enc.id is not None
    assert enc.is_finalised is False

    # 5. Create Clinical Addendum
    addendum = ClinicalAddendum(
        encounter_id=enc.id,
        doctor_id=doctor_id,
        addendum_text="Patient advised to avoid forward bending and start core strengthening.",
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(addendum)
    db_session.flush()
    assert addendum.id is not None
    assert addendum.encounter_id == enc.id


def test_unique_token_per_doctor_per_day(db_session, doctor_a_user, admin_user):
    """Verify unique constraint on (doctor_id, appointment_date, token_number)."""
    doctor_id = doctor_a_user.doctor_id
    patient = Patient(
        urn="KH-2026-9902",
        full_name="Duplicate Token Patient",
        guardian_name="Guardian Name",
        gender="F",
        age_years=28,
        mobile="9876543211",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()

    today = date(2026, 11, 1)
    appt1 = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_id,
        appointment_date=today,
        token_number=5,
        status=AppointmentStatus.BOOKED.value,
        created_by_user_id=admin_user.id,
    )
    db_session.add(appt1)
    db_session.flush()

    # Second appointment for same doctor and same day with same token number must fail
    with pytest.raises(IntegrityError):
        with db_session.begin_nested():
            appt2 = Appointment(
                patient_id=patient.id,
                doctor_id=doctor_id,
                appointment_date=today,
                token_number=5,
                status=AppointmentStatus.BOOKED.value,
                created_by_user_id=admin_user.id,
            )
            db_session.add(appt2)
            db_session.flush()


def test_finalised_encounter_immutability_trigger(db_session, doctor_a_user):
    """Verify PostgreSQL trigger blocks updates or deletes to finalised encounters."""
    doctor_id = doctor_a_user.doctor_id
    patient = Patient(
        urn="KH-2026-9903",
        full_name="Immutable Encounter Patient",
        guardian_name="Guardian Name",
        gender="M",
        age_years=45,
        mobile="9876543212",
        address="Bhojpur",
    )
    db_session.add(patient)
    db_session.flush()

    enc = ClinicalEncounter(
        patient_id=patient.id,
        doctor_id=doctor_id,
        symptoms="Knee pain",
        clinical_notes="Crepitus noted in right knee joint",
        diagnosis="Osteoarthritis right knee",
        is_finalised=True,
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(enc)
    db_session.flush()

    # Modifying clinical notes after finalisation must trigger DB exception
    with pytest.raises(DBAPIError) as exc_info:
        with db_session.begin_nested():
            enc.clinical_notes = "Tampered notes after finalisation"
            db_session.flush()
    assert "Finalised encounter" in str(exc_info.value)

    # Deletion of finalised encounter must also trigger DB exception
    with pytest.raises(DBAPIError) as exc_info_del:
        with db_session.begin_nested():
            db_session.delete(enc)
            db_session.flush()
    assert "Finalised clinical encounter cannot be deleted" in str(exc_info_del.value)
