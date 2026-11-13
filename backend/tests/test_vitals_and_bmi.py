"""Automated tests for vitals observation recording, server-side BMI engine, and physiological
limits (DWS-06, T-19-05)."""

from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    ClinicalEncounter,
    Patient,
)


def _create_test_patient_and_encounter(db_session, doctor_user):
    """Helper to create patient, appointment, and unfinalised encounter."""
    patient = Patient(
        urn="KH-2026-9101",
        full_name="Vitals Test Patient",
        guardian_name="Guardian",
        gender="M",
        age_years=42,
        mobile="9876543444",
        address="Buxar",
    )
    db_session.add(patient)
    db_session.flush()

    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_user.doctor_id,
        appointment_date=date(2026, 11, 10),
        token_number=2,
        status=AppointmentStatus.IN_CONSULTATION.value,
        created_by_user_id=doctor_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    enc = ClinicalEncounter(
        patient_id=patient.id,
        doctor_id=doctor_user.doctor_id,
        appointment_id=appt.id,
        symptoms="Routine checkup",
        clinical_notes="Notes",
        diagnosis="Hypertension",
        is_finalised=False,
        created_by_user_id=doctor_user.id,
    )
    db_session.add(enc)
    db_session.commit()
    db_session.refresh(enc)
    return patient, enc


def test_vitals_recording_and_server_bmi_calculation(login_client, doctor_a_user, db_session):
    """Server authoritatively computes BMI from height and weight rounded to 1 decimal place."""
    _, enc = _create_test_patient_and_encounter(db_session, doctor_a_user)
    client = login_client(doctor_a_user)

    # Height = 175 cm, Weight = 70 kg -> BMI = 70 / (1.75^2) = 22.857... -> 22.9
    vitals_payload = {
        "height_cm": 175.0,
        "weight_kg": 70.0,
        "systolic_bp": 120,
        "diastolic_bp": 80,
        "pulse_bpm": 72,
        "temperature_f": 98.6,
        "respiratory_rate": 16,
        "spo2_percent": 98,
    }

    put_resp = client.put(f"/api/encounters/{enc.id}/vitals", json=vitals_payload)
    assert put_resp.status_code == 200, put_resp.text
    data = put_resp.json()
    assert data["encounter_id"] == enc.id
    assert float(data["height_cm"]) == 175.0
    assert float(data["weight_kg"]) == 70.0
    assert float(data["bmi"]) == 22.9
    assert data["systolic_bp"] == 120
    assert data["diastolic_bp"] == 80
    assert data["pulse_bpm"] == 72
    assert float(data["temperature_f"]) == 98.6
    assert data["respiratory_rate"] == 16
    assert data["spo2_percent"] == 98

    # GET verification
    get_resp = client.get(f"/api/encounters/{enc.id}/vitals")
    assert get_resp.status_code == 200
    get_data = get_resp.json()
    assert float(get_data["bmi"]) == 22.9


def test_bmi_none_when_height_or_weight_missing(login_client, doctor_a_user, db_session):
    """BMI is None when either height or weight is not recorded (optionality D-19-09)."""
    _, enc = _create_test_patient_and_encounter(db_session, doctor_a_user)
    client = login_client(doctor_a_user)

    # 1. Record only blood pressure and pulse
    put_resp = client.put(
        f"/api/encounters/{enc.id}/vitals",
        json={"systolic_bp": 130, "diastolic_bp": 85, "pulse_bpm": 80},
    )
    assert put_resp.status_code == 200
    assert put_resp.json()["bmi"] is None
    assert put_resp.json()["height_cm"] is None
    assert put_resp.json()["weight_kg"] is None

    # 2. Update with only height recorded
    put_resp2 = client.put(
        f"/api/encounters/{enc.id}/vitals",
        json={"height_cm": 160.0, "systolic_bp": 130, "diastolic_bp": 85},
    )
    assert put_resp2.status_code == 200
    assert put_resp2.json()["bmi"] is None
    assert float(put_resp2.json()["height_cm"]) == 160.0
    assert put_resp2.json()["weight_kg"] is None


@pytest.mark.parametrize(
    "invalid_field,invalid_value",
    [
        ("height_cm", 15.0),  # Under minimum 20cm
        ("height_cm", 290.0),  # Over maximum 280cm
        ("weight_kg", 0.5),  # Under minimum 1kg
        ("weight_kg", 450.0),  # Over maximum 400kg
        ("systolic_bp", 30),  # Under 40 mmHg
        ("systolic_bp", 350),  # Over 300 mmHg
        ("diastolic_bp", 15),  # Under 20 mmHg
        ("diastolic_bp", 220),  # Over 200 mmHg
        ("pulse_bpm", 20),  # Under 30 bpm
        ("pulse_bpm", 280),  # Over 260 bpm
        ("temperature_f", 80.0),  # Under 85 F
        ("temperature_f", 115.0),  # Over 110 F
        ("respiratory_rate", 3),  # Under 5
        ("respiratory_rate", 95),  # Over 80
        ("spo2_percent", 35),  # Under 40%
        ("spo2_percent", 105),  # Over 100%
    ],
)
def test_vitals_physiological_boundary_rejection(
    login_client, doctor_a_user, db_session, invalid_field, invalid_value
):
    """API strictly rejects physiological outliers violating safety bounds (T-19-05)."""
    _, enc = _create_test_patient_and_encounter(db_session, doctor_a_user)
    client = login_client(doctor_a_user)

    resp = client.put(
        f"/api/encounters/{enc.id}/vitals",
        json={invalid_field: invalid_value},
    )
    assert resp.status_code == 422


def test_vitals_locked_on_encounter_finalisation(login_client, doctor_a_user, db_session):
    """Vitals cannot be modified via API or SQL once encounter is finalised (CLN-02)."""
    _, enc = _create_test_patient_and_encounter(db_session, doctor_a_user)
    client = login_client(doctor_a_user)

    # Record vitals
    client.put(
        f"/api/encounters/{enc.id}/vitals",
        json={"height_cm": 170.0, "weight_kg": 65.0, "pulse_bpm": 76},
    )

    # Finalise encounter
    client.post(
        f"/api/encounters/{enc.id}/finalise",
        json={"symptoms": "Headache", "diagnosis": "Tension headache"},
    )

    # API write rejection
    edit_resp = client.put(
        f"/api/encounters/{enc.id}/vitals",
        json={"pulse_bpm": 120},
    )
    assert edit_resp.status_code == 400
    assert edit_resp.json()["code"] == "encounter_finalised"

    # Database trigger rejection
    with pytest.raises(DBAPIError) as exc_info:
        db_session.execute(
            text("UPDATE vital_observations SET pulse_bpm = 100 WHERE encounter_id = :id"),
            {"id": enc.id},
        )
        db_session.commit()

    assert "Cannot modify vital_observations for a finalised clinical encounter" in str(
        exc_info.value
    )
    db_session.rollback()


def test_finalise_encounter_without_vitals_succeeds(login_client, doctor_a_user, db_session):
    """Encounter without vitals finalises successfully (optionality D-19-09)."""
    _, enc = _create_test_patient_and_encounter(db_session, doctor_a_user)
    client = login_client(doctor_a_user)

    fin_resp = client.post(
        f"/api/encounters/{enc.id}/finalise",
        json={"symptoms": "Followup review", "diagnosis": "Controlled"},
    )
    assert fin_resp.status_code == 200, fin_resp.text
    assert fin_resp.json()["is_finalised"] is True

    # GET vitals returns 404
    get_resp = client.get(f"/api/encounters/{enc.id}/vitals")
    assert get_resp.status_code == 404
    assert get_resp.json()["code"] == "vitals_not_found"
