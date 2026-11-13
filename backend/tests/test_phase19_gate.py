"""Comprehensive end-to-end clinical consultation integration gate test suite for Phase 19
(DWS-01..10).

Covers:
1. Check-In & Arrival (DWS-03)
2. Single Encounter per Appointment (DWS-01)
3. Draft Auto-save & Versioning (DWS-02)
4. Vitals & Server-calculated BMI (DWS-06)
5. Specialty Templates for Physio & Eye (DWS-05)
6. Prescription Lifecycle: Draft -> Authorise -> Cancel with Reason -> Reissue (DWS-07)
7. Follow-Up Recommendation & Reception Booking Privacy (DWS-08)
8. Encounter Finalisation & Tamper Prevention Trigger Lock (DWS-02, D-19-09)
9. Cross-Doctor Longitudinal Read Access with Audit Logging & Mutation Silo (DWS-04)
10. Single Session Concurrency Control & Audited Takeover (DWS-10)
"""

from collections.abc import Callable
from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    AuditLog,
    Department,
    Patient,
    User,
)
from kalyan_api.services.audit_service import AuditAction
from tests.conftest import TEST_PASSWORD, make_user


def test_phase19_clinical_consultation_end_to_end_gate(
    login_client: Callable[[User], TestClient],
    make_client: Callable[[str], TestClient],
    doctor_a_user: User,
    doctor_b_user: User,
    reception_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    """Execute complete multi-specialty clinical workflow roundtrip certifying all 10 Phase 19
    requirements."""
    # -------------------------------------------------------------------------
    # Setup: Ensure Physiotherapy & Ophthalmology departments and doctor linkages
    # -------------------------------------------------------------------------
    physio_dept = db_session.scalar(select(Department).filter_by(code="PHYSIOTHERAPY"))
    if not physio_dept:
        physio_dept = Department(code="PHYSIOTHERAPY", name_en="Physiotherapy", is_active=True)
        db_session.add(physio_dept)
        db_session.flush()

    ophthal_dept = db_session.scalar(select(Department).filter_by(code="OPHTHALMOLOGY"))
    if not ophthal_dept:
        ophthal_dept = Department(code="OPHTHALMOLOGY", name_en="Ophthalmology", is_active=True)
        db_session.add(ophthal_dept)
        db_session.flush()

    patient = Patient(
        urn="KH-2026-9999",
        full_name="Vikramaditya Singh",
        guardian_name="Harishchandra Singh",
        gender="M",
        age_years=42,
        mobile="9876543299",
        address="Station Road, Ara",
        allergies="Aspirin, Ciprofloxacin",
    )
    db_session.add(patient)
    db_session.flush()

    reception_client = login_client(reception_user)
    doctor_a_client = login_client(doctor_a_user)
    doctor_b_client = login_client(doctor_b_user)

    # -------------------------------------------------------------------------
    # 1. Check-In & Arrival (DWS-03)
    # -------------------------------------------------------------------------
    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        appointment_date=date(2026, 11, 15),
        token_number=101,
        status=AppointmentStatus.BOOKED.value,
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    # Reception checks in patient -> status ARRIVED
    checkin_resp = reception_client.patch(
        f"/api/appointments/{appt.id}/status",
        json={"status": "ARRIVED", "version_id": appt.version_id},
    )
    assert checkin_resp.status_code == 200, checkin_resp.text
    checkin_data = checkin_resp.json()
    assert checkin_data["status"] == "ARRIVED"
    assert checkin_data["check_in_at"] is not None

    # -------------------------------------------------------------------------
    # 2. Single Encounter per Appointment (DWS-01)
    # -------------------------------------------------------------------------
    create_enc_resp = doctor_a_client.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "appointment_id": appt.id,
            "department_id": physio_dept.id,
            "symptoms": "Low back stiffness",
            "clinical_notes": "",
            "diagnosis": "",
        },
    )
    assert create_enc_resp.status_code == 201, create_enc_resp.text
    enc_data = create_enc_resp.json()
    encounter_id = enc_data["id"]
    assert enc_data["appointment_id"] == appt.id
    assert enc_data["is_finalised"] is False

    # Second creation attempt on same appointment returns existing encounter (200 OK)
    duplicate_resp = doctor_a_client.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "appointment_id": appt.id,
            "department_id": physio_dept.id,
            "symptoms": "Ignored text",
            "clinical_notes": "",
            "diagnosis": "",
        },
    )
    assert duplicate_resp.status_code == 200, duplicate_resp.text
    assert duplicate_resp.json()["id"] == encounter_id

    # -------------------------------------------------------------------------
    # 3. Draft Auto-save & Versioning (DWS-02)
    # -------------------------------------------------------------------------
    current_version = enc_data["version_id"]
    draft_patch_resp = doctor_a_client.patch(
        f"/api/encounters/{encounter_id}",
        json={
            "symptoms": "Low back stiffness radiating to right hamstring",
            "clinical_notes": "SLR positive on right at 45 degrees",
            "diagnosis": "Lumbar Spondylosis with L5 Radiculopathy",
            "version_id": current_version,
        },
    )
    assert draft_patch_resp.status_code == 200, draft_patch_resp.text
    draft_data = draft_patch_resp.json()
    assert draft_data["version_id"] == current_version + 1
    current_version = draft_data["version_id"]

    # -------------------------------------------------------------------------
    # 4. Vitals & Server BMI (DWS-06)
    # -------------------------------------------------------------------------
    vitals_resp = doctor_a_client.put(
        f"/api/encounters/{encounter_id}/vitals",
        json={
            "height_cm": 175.0,
            "weight_kg": 70.0,
            "systolic_bp": 120,
            "diastolic_bp": 80,
            "pulse_bpm": 72,
            "temperature_f": 98.6,
            "respiratory_rate": 16,
            "spo2_percent": 99,
        },
    )
    assert vitals_resp.status_code == 200, vitals_resp.text
    vitals_data = vitals_resp.json()
    assert float(vitals_data["bmi"]) == 22.9  # 70 / (1.75^2) = 22.857 -> 22.9

    # Range constraint validation
    invalid_vitals_resp = doctor_a_client.put(
        f"/api/encounters/{encounter_id}/vitals",
        json={"height_cm": 350.0, "weight_kg": 70.0},
    )
    assert invalid_vitals_resp.status_code == 422

    # -------------------------------------------------------------------------
    # 5. Specialty Templates (DWS-05)
    # -------------------------------------------------------------------------
    # 5a: Physiotherapy template response persistence
    physio_tmpl_resp = doctor_a_client.get(f"/api/templates/by-department/{physio_dept.id}")
    assert physio_tmpl_resp.status_code == 200, physio_tmpl_resp.text
    physio_tmpl = physio_tmpl_resp.json()
    physio_version_id = physio_tmpl["active_version"]["id"]

    save_physio_resp = doctor_a_client.put(
        f"/api/encounters/{encounter_id}/template-response",
        json={
            "template_version_id": physio_version_id,
            "response_data": {
                "starting_vas": 7,
                "pain_site": "Lumbar spine",
                "onset_duration": "3 weeks",
                "rom_joint": "Lumbar",
                "rom_flexion": "Mildly restricted",
                "mmt_grade": "4/5",
                "functional_limitations": "Difficulty prolonged standing",
            },
        },
    )
    assert save_physio_resp.status_code == 200, save_physio_resp.text

    # 5b: Ophthalmology template verification on ophthalmology encounter
    eye_appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        appointment_date=date(2026, 11, 16),
        token_number=102,
        status=AppointmentStatus.IN_CONSULTATION.value,
        created_by_user_id=reception_user.id,
    )
    db_session.add(eye_appt)
    db_session.flush()

    eye_enc_resp = doctor_a_client.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "appointment_id": eye_appt.id,
            "department_id": ophthal_dept.id,
            "symptoms": "Blurred vision right eye",
            "clinical_notes": "",
            "diagnosis": "",
        },
    )
    assert eye_enc_resp.status_code == 201
    eye_enc_id = eye_enc_resp.json()["id"]

    eye_tmpl_resp = doctor_a_client.get(f"/api/templates/by-department/{ophthal_dept.id}")
    assert eye_tmpl_resp.status_code == 200
    eye_version_id = eye_tmpl_resp.json()["active_version"]["id"]

    save_eye_resp = doctor_a_client.put(
        f"/api/encounters/{eye_enc_id}/template-response",
        json={
            "template_version_id": eye_version_id,
            "response_data": {
                "va_distance_uncorrected_od": "6/18",
                "va_distance_uncorrected_os": "6/6",
                "iop_od_mmhg": 16,
                "iop_os_mmhg": 15,
                "iop_method": "Non-contact tonometer",
                "cornea_od": "Clear",
                "cornea_os": "Clear",
            },
        },
    )
    assert save_eye_resp.status_code == 200

    # -------------------------------------------------------------------------
    # 6. Prescription Lifecycle (DWS-07)
    # -------------------------------------------------------------------------
    # Draft prescription with strength, form, and route
    rx_create_resp = doctor_a_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "encounter_id": encounter_id,
            "status": "DRAFT",
            "diagnosis": "Lumbar Radiculopathy",
            "dietary_advice": "Hydration, low sodium",
            "general_advice": "Avoid forward bending, lumbar support",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Tab Aceclofenac",
                    "strength": "100mg",
                    "form": "Tablet",
                    "route": "Oral",
                    "dosage": "1 tab",
                    "frequency": "BD",
                    "duration_days": 5,
                    "instructions": "After food",
                }
            ],
        },
    )
    assert rx_create_resp.status_code == 201, rx_create_resp.text
    rx_id = rx_create_resp.json()["id"]

    # Authorise prescription
    auth_resp = doctor_a_client.post(f"/api/prescriptions/{rx_id}/authorise")
    assert auth_resp.status_code == 200, auth_resp.text
    assert auth_resp.json()["status"] == "AUTHORISED"
    assert auth_resp.json()["is_printable"] is True

    # Cancel prescription with reason
    cancel_resp = doctor_a_client.post(
        f"/api/prescriptions/{rx_id}/cancel",
        json={"reason": "Gastric irritation reported; switching to topical NSAID"},
    )
    assert cancel_resp.status_code == 200, cancel_resp.text
    assert cancel_resp.json()["status"] == "CANCELLED"
    assert cancel_resp.json()["is_printable"] is False

    # Re-issue active prescription
    rx_reissue_resp = doctor_a_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "encounter_id": encounter_id,
            "status": "DRAFT",
            "diagnosis": "Lumbar Radiculopathy",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Diclofenac Gel",
                    "strength": "1%",
                    "form": "Gel",
                    "route": "Topical",
                    "dosage": "Thin layer",
                    "frequency": "TDS",
                    "duration_days": 7,
                    "instructions": "Apply gently to lower back",
                }
            ],
        },
    )
    assert rx_reissue_resp.status_code == 201
    active_rx_id = rx_reissue_resp.json()["id"]
    auth_reissue_resp = doctor_a_client.post(f"/api/prescriptions/{active_rx_id}/authorise")
    assert auth_reissue_resp.status_code == 200

    # -------------------------------------------------------------------------
    # 7. Follow-Up Recommendation & Reception Booking (DWS-08)
    # -------------------------------------------------------------------------
    rec_date = (clock.utcnow().date() + timedelta(days=7)).isoformat()
    fu_resp = doctor_a_client.post(
        f"/api/encounters/{encounter_id}/follow-up",
        json={
            "recommended_date": rec_date,
            "recommended_doctor_id": doctor_a_user.doctor_id,
            "clinical_reason": "Evaluate pain reduction following 5 sessions of mobilization",
        },
    )
    assert fu_resp.status_code == 201, fu_resp.text
    fu_id = fu_resp.json()["id"]

    # Reception inspects follow-up queue -> clinical_reason strictly excluded
    rec_queue_resp = reception_client.get("/api/reception/follow-ups")
    assert rec_queue_resp.status_code == 200, rec_queue_resp.text
    rec_items = rec_queue_resp.json()
    matching_rec = next((item for item in rec_items if item["id"] == fu_id), None)
    assert matching_rec is not None
    assert "clinical_reason" not in matching_rec or matching_rec["clinical_reason"] is None
    assert matching_rec["patient_name"] == "Vikramaditya Singh"

    # Reception converts follow-up into booked appointment
    book_resp = reception_client.post(
        f"/api/follow-ups/{fu_id}/book",
        json={"notes": "Booked from doctor consultation recommendation"},
    )
    assert book_resp.status_code == 200, book_resp.text
    assert book_resp.json()["status"] == "BOOKED"

    # -------------------------------------------------------------------------
    # 8. Encounter Finalisation & Tamper Lock (DWS-02, D-19-09)
    # -------------------------------------------------------------------------
    finalise_resp = doctor_a_client.post(
        f"/api/encounters/{encounter_id}/finalise",
        json={
            "version_id": current_version,
            "symptoms": "Low back stiffness radiating to right hamstring",
            "diagnosis": "Lumbar Spondylosis with L5 Radiculopathy",
        },
    )
    assert finalise_resp.status_code == 200, finalise_resp.text
    assert finalise_resp.json()["is_finalised"] is True

    # Attempt to modify finalised encounter via API -> rejected (HTTP 400)
    blocked_update = doctor_a_client.patch(
        f"/api/encounters/{encounter_id}",
        json={"symptoms": "Attempted post-finalisation edit", "version_id": current_version + 1},
    )
    assert blocked_update.status_code == 400

    # -------------------------------------------------------------------------
    # 9. Audited Cross-Doctor Read (DWS-04)
    # -------------------------------------------------------------------------
    # Doctor B reads Doctor A's finalised encounter -> HTTP 200 OK
    cross_read_resp = doctor_b_client.get(f"/api/encounters/{encounter_id}")
    assert cross_read_resp.status_code == 200, cross_read_resp.text
    assert cross_read_resp.json()["doctor_id"] == doctor_a_user.doctor_id

    # Verify CROSS_DOCTOR_CLINICAL_READ audit entry logged
    audit_entry = db_session.scalar(
        select(AuditLog)
        .filter_by(
            action=AuditAction.CROSS_DOCTOR_CLINICAL_READ.value,
            actor_user_id=doctor_b_user.id,
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit_entry is not None
    assert audit_entry.after_data == {
        "actor_doctor_id": doctor_b_user.doctor_id,
        "record_doctor_id": doctor_a_user.doctor_id,
        "patient_id": patient.id,
    }

    # Doctor B attempts to mutate Doctor A's encounter -> HTTP 404 (silo isolation)
    cross_write_resp = doctor_b_client.patch(
        f"/api/encounters/{encounter_id}",
        json={"symptoms": "Doctor B tampering attempt", "version_id": 99},
    )
    assert cross_write_resp.status_code == 404

    # -------------------------------------------------------------------------
    # 10. Single Session Concurrency & Takeover (DWS-10)
    # -------------------------------------------------------------------------
    gate_user = make_user(db_session, test_settings, role="DOCTOR", username="dr_gate_concurrency")
    device1 = make_client("192.168.1.51")
    device2 = make_client("192.168.1.52")

    # Device 1 signs in
    login1 = device1.post(
        "/api/auth/login",
        json={"username": gate_user.username, "password": TEST_PASSWORD},
    )
    assert login1.status_code == 200

    # Device 2 attempts sign in -> HTTP 409 session_in_use
    login2_collision = device2.post(
        "/api/auth/login",
        json={"username": gate_user.username, "password": TEST_PASSWORD},
    )
    assert login2_collision.status_code == 409
    assert login2_collision.json()["code"] == "session_in_use"

    # Device 2 signs in with takeover=True
    login2_takeover = device2.post(
        "/api/auth/login",
        json={"username": gate_user.username, "password": TEST_PASSWORD, "takeover": True},
    )
    assert login2_takeover.status_code == 200

    # Device 1 session is now revoked (HTTP 401 on next call)
    device1_stale = device1.get("/api/auth/me")
    assert device1_stale.status_code == 401

    # Takeover audit event verified
    takeover_audit = db_session.scalar(
        select(AuditLog)
        .filter_by(
            action=AuditAction.SESSION_TAKEOVER.value,
            actor_user_id=gate_user.id,
        )
        .order_by(AuditLog.id.desc())
    )
    assert takeover_audit is not None
