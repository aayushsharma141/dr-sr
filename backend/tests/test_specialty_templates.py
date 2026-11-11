"""Automated tests for specialty clinical templates registry, response persistence, and validation
(DWS-05, D-19-09..13, T-19-04)."""

from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    ClinicalEncounter,
    Department,
    Patient,
)


def _create_test_patient_and_encounter(db_session, doctor_user, department_code=None):
    """Helper to create patient, appointment, and unfinalised encounter."""
    patient = Patient(
        urn="KH-2026-9001",
        full_name="Specialty Test Patient",
        guardian_name="Guardian",
        gender="F",
        age_years=35,
        mobile="9876543399",
        address="Bhojpur",
    )
    db_session.add(patient)
    db_session.flush()

    dept_id = None
    if department_code:
        dept = db_session.query(Department).filter_by(code=department_code).first()
        if dept:
            dept_id = dept.id

    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_user.doctor_id,
        appointment_date=date(2026, 11, 10),
        token_number=1,
        status=AppointmentStatus.IN_CONSULTATION.value,
        created_by_user_id=doctor_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    enc = ClinicalEncounter(
        patient_id=patient.id,
        doctor_id=doctor_user.doctor_id,
        appointment_id=appt.id,
        department_id=dept_id,
        symptoms="Initial knee pain",
        clinical_notes="Notes",
        diagnosis="Osteoarthritis",
        is_finalised=False,
        created_by_user_id=doctor_user.id,
    )
    db_session.add(enc)
    db_session.commit()
    db_session.refresh(enc)
    return patient, enc


def test_templates_registry_and_versions(login_client, doctor_a_user, db_session):
    """Active templates for Physiotherapy and Ophthalmology are discoverable with schema
    versions."""
    client = login_client(doctor_a_user)

    # 1. List active templates
    resp = client.get("/api/templates/active")
    assert resp.status_code == 200, resp.text
    templates = resp.json()
    codes = {t["code"] for t in templates}
    assert "PHYSIOTHERAPY" in codes
    assert "OPHTHALMOLOGY" in codes

    physio = next(t for t in templates if t["code"] == "PHYSIOTHERAPY")
    assert physio["active_version"] is not None
    assert physio["active_version"]["version_number"] == 1
    assert "required" in physio["active_version"]["schema_json"]

    # 2. Get by department
    dept_resp = client.get(f"/api/templates/by-department/{physio['department_id']}")
    assert dept_resp.status_code == 200
    assert dept_resp.json()["code"] == "PHYSIOTHERAPY"

    # Non-existent department returns 404
    not_found_resp = client.get("/api/templates/by-department/999999")
    assert not_found_resp.status_code == 404

    # 3. Retrieve specific version
    version_id = physio["active_version"]["id"]
    ver_resp = client.get(f"/api/templates/versions/{version_id}")
    assert ver_resp.status_code == 200
    assert ver_resp.json()["id"] == version_id
    assert ver_resp.json()["version_number"] == 1


def test_template_response_persistence_and_update(login_client, doctor_a_user, db_session):
    """Doctor can save and update specialty template responses against an encounter draft."""
    _, enc = _create_test_patient_and_encounter(db_session, doctor_a_user, "PHYSIOTHERAPY")
    client = login_client(doctor_a_user)

    # Fetch active physio template version
    tmpl_resp = client.get("/api/templates/active")
    physio = next(t for t in tmpl_resp.json() if t["code"] == "PHYSIOTHERAPY")
    version_id = physio["active_version"]["id"]

    # Save initial template response
    payload = {
        "template_version_id": version_id,
        "response_data": {
            "pain_site": "Left Knee",
            "starting_vas": 6,
            "onset_duration": "2 months",
        },
    }
    put_resp = client.put(f"/api/encounters/{enc.id}/template-response", json=payload)
    assert put_resp.status_code == 200, put_resp.text
    saved = put_resp.json()
    assert saved["encounter_id"] == enc.id
    assert saved["response_data"]["pain_site"] == "Left Knee"
    assert saved["response_data"]["starting_vas"] == 6

    # Fetch template response
    get_resp = client.get(f"/api/encounters/{enc.id}/template-response")
    assert get_resp.status_code == 200
    assert get_resp.json()["response_data"]["pain_site"] == "Left Knee"

    # Update template response
    payload["response_data"]["starting_vas"] = 8
    payload["response_data"]["mmt_grade"] = "4/5"
    put_resp2 = client.put(f"/api/encounters/{enc.id}/template-response", json=payload)
    assert put_resp2.status_code == 200
    assert put_resp2.json()["response_data"]["starting_vas"] == 8
    assert put_resp2.json()["response_data"]["mmt_grade"] == "4/5"


def test_encounter_finalisation_enforces_required_template_fields(
    login_client, doctor_a_user, db_session
):
    """Encounter finalisation strictly enforces required fields from specialty template
    (D-19-09)."""
    _, enc = _create_test_patient_and_encounter(db_session, doctor_a_user, "PHYSIOTHERAPY")
    client = login_client(doctor_a_user)

    tmpl_resp = client.get("/api/templates/active")
    physio = next(t for t in tmpl_resp.json() if t["code"] == "PHYSIOTHERAPY")
    version_id = physio["active_version"]["id"]

    # Save incomplete response: required 'pain_site' is missing
    client.put(
        f"/api/encounters/{enc.id}/template-response",
        json={
            "template_version_id": version_id,
            "response_data": {
                "starting_vas": 7,
                # pain_site is missing!
            },
        },
    )

    # Attempt to finalise consultation - should be rejected with 422
    fin_resp = client.post(
        f"/api/encounters/{enc.id}/finalise",
        json={
            "symptoms": "Severe knee pain",
            "diagnosis": "Patellar tendinitis",
        },
    )
    assert fin_resp.status_code == 422, fin_resp.text
    assert fin_resp.json()["code"] == "template_required_fields_missing"
    assert "pain_site" in fin_resp.json()["message"]

    # Now provide required fields
    client.put(
        f"/api/encounters/{enc.id}/template-response",
        json={
            "template_version_id": version_id,
            "response_data": {
                "pain_site": "Right Patella",
                "starting_vas": 7,
            },
        },
    )

    # Finalise again - should succeed
    fin_resp2 = client.post(
        f"/api/encounters/{enc.id}/finalise",
        json={
            "symptoms": "Severe knee pain",
            "diagnosis": "Patellar tendinitis",
        },
    )
    assert fin_resp2.status_code == 200, fin_resp2.text
    assert fin_resp2.json()["is_finalised"] is True


def test_finalised_encounter_tamper_trigger_blocks_response_modification(
    login_client, doctor_a_user, db_session
):
    """Once encounter is finalised, template responses cannot be modified via API or database
    trigger (T-19-04, CLN-02)."""
    _, enc = _create_test_patient_and_encounter(db_session, doctor_a_user, "PHYSIOTHERAPY")
    client = login_client(doctor_a_user)

    tmpl_resp = client.get("/api/templates/active")
    physio = next(t for t in tmpl_resp.json() if t["code"] == "PHYSIOTHERAPY")
    version_id = physio["active_version"]["id"]

    # Provide valid responses and finalise
    client.put(
        f"/api/encounters/{enc.id}/template-response",
        json={
            "template_version_id": version_id,
            "response_data": {
                "pain_site": "Lumbar L4-L5",
                "starting_vas": 5,
            },
        },
    )
    client.post(
        f"/api/encounters/{enc.id}/finalise",
        json={"symptoms": "Lumbar pain", "diagnosis": "Lumbar strain"},
    )

    # 1. API modification attempt must be rejected with 400
    edit_resp = client.put(
        f"/api/encounters/{enc.id}/template-response",
        json={
            "template_version_id": version_id,
            "response_data": {
                "pain_site": "Tampered site",
                "starting_vas": 1,
            },
        },
    )
    assert edit_resp.status_code == 400
    assert edit_resp.json()["code"] == "encounter_finalised"

    # 2. Direct SQL modification must trip fn_prevent_finalised_encounter_tampering
    with pytest.raises(DBAPIError) as exc_info:
        db_session.execute(
            text(
                "UPDATE clinical_template_responses SET response_data = '{\"tampered\": true}' "
                "WHERE encounter_id = :id"
            ),
            {"id": enc.id},
        )
        db_session.commit()

    assert "Cannot modify clinical_template_responses for a finalised clinical encounter" in str(
        exc_info.value
    )
    db_session.rollback()


def test_unfinalised_encounter_without_template_can_finalise(
    login_client, doctor_a_user, db_session
):
    """Encounter without specialty template response finalises normally (optionality D-19-09)."""
    _, enc = _create_test_patient_and_encounter(db_session, doctor_a_user)
    client = login_client(doctor_a_user)

    fin_resp = client.post(
        f"/api/encounters/{enc.id}/finalise",
        json={"symptoms": "General malaise", "diagnosis": "Viral fever"},
    )
    assert fin_resp.status_code == 200, fin_resp.text
    assert fin_resp.json()["is_finalised"] is True
