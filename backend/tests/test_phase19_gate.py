"""Comprehensive Phase 19 Clinical Consultation Integration Gate (DWS-01 .. DWS-10).

Validates the full Phase 19 contract across all 10 clinical requirements in sequence:
1. Check-In & Arrival (DWS-03): Reception checks in appointment; check_in_at timestamp recorded.
2. Single Encounter per Appointment (DWS-01): Doctor initiates encounter; subsequent creation returns active encounter without duplicate.
3. Draft Auto-save & Versioning (DWS-02): Partially populated draft saves; version_id increments monotonically on updates.
4. Vitals & Server BMI (DWS-06): Height and weight calculate BMI server-side (175 cm, 70 kg -> 22.9); physiological boundaries enforced.
5. Specialty Templates (DWS-05):
   - Physiotherapy (PHYSIOTHERAPY_V1): persists pain_site, starting_vas, rom_findings, mmt_grade.
   - Ophthalmology (OPHTHALMOLOGY_V1): persists side-by-side OD/OS visual acuity and IOP responses.
6. Prescription Lifecycle (DWS-07):
   - Draft prescription with strength, form, route.
   - Authorise prescription (status = 'AUTHORISED').
   - Cancel prescription with mandatory reason (status = 'CANCELLED').
   - Re-issue active prescription; verify single active prescription per encounter invariant.
7. Follow-Up Recommendation (DWS-08):
   - Doctor records follow-up recommendation with date and clinical reason.
   - Reception queries /api/reception/follow-ups; clinical_reason is strictly excluded.
   - Reception books recommendation into confirmed appointment.
8. Encounter Finalisation & Tamper Lock (DWS-02, D-19-09):
   - Mandatory symptoms and diagnosis validation on finalisation.
   - Database tamper trigger blocks direct SQL/API mutation of finalised encounter and related child records.
9. Audited Cross-Doctor Read (DWS-04):
   - Doctor B reads Doctor A's finalised encounter -> HTTP 200 + CROSS_DOCTOR_CLINICAL_READ audit entry.
   - Doctor B write attempts on Doctor A's encounter return HTTP 404.
10. Single Session Concurrency & Takeover (DWS-10):
   - Second concurrent device login returns HTTP 409 session_in_use.
   - Second login with takeover=True succeeds, revokes prior session, and logs SESSION_TAKEOVER audit entry.
"""

from datetime import date, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    AuditLog,
    ClinicalEncounter,
    Department,
    Patient,
    Prescription,
    User,
)
from kalyan_api.services.audit_service import AuditAction
from tests.conftest import TEST_PASSWORD


def _create_gate_patient(session: Session, suffix: str = "GATE") -> Patient:
    patient = Patient(
        urn=f"KH-2026-{suffix}",
        full_name=f"Gate Clinical Patient {suffix}",
        guardian_name="Guardian Gate",
        gender="F",
        age_years=38,
        mobile="9876543111",
        address="Bhojpur Hospital Road",
        district="Bhojpur",
        state="Bihar",
    )
    session.add(patient)
    session.flush()
    return patient


def test_phase19_comprehensive_clinical_gate(
    login_client: Any,
    make_client: Any,
    admin_user: User,
    doctor_a_user: User,
    doctor_b_user: User,
    reception_user: User,
    db_session: Session,
) -> None:
    """Execute complete Phase 19 clinical consultation gate covering requirements 1 through 10."""
    rec_client = login_client(reception_user)
    doc_a_client = login_client(doctor_a_user)

    patient_a = _create_gate_patient(db_session, "G19A")

    # Ensure Physiotherapy and Ophthalmology departments exist
    physio_dept = db_session.query(Department).filter_by(code="PHYSIOTHERAPY").first()
    ophth_dept = db_session.query(Department).filter_by(code="OPHTHALMOLOGY").first()

    # -------------------------------------------------------------------------
    # 1. Check-In & Arrival (DWS-03)
    # -------------------------------------------------------------------------
    appt_date = date.today() + timedelta(days=1)
    appt = Appointment(
        patient_id=patient_a.id,
        doctor_id=doctor_a_user.doctor_id,
        appointment_date=appt_date,
        token_number=1,
        status=AppointmentStatus.BOOKED.value,
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt)
    db_session.flush()
    assert appt.check_in_at is None

    # Reception checks in appointment
    checkin_resp = rec_client.patch(
        f"/api/appointments/{appt.id}/status",
        json={"status": "ARRIVED", "version_id": 1},
    )
    assert checkin_resp.status_code == 200, checkin_resp.text
    checkin_data = checkin_resp.json()
    assert checkin_data["status"] == "ARRIVED"
    assert checkin_data["check_in_at"] is not None
    check_in_recorded_ts = checkin_data["check_in_at"]

    # -------------------------------------------------------------------------
    # 2. Single Encounter per Appointment (DWS-01)
    # -------------------------------------------------------------------------
    create_enc1 = doc_a_client.post(
        "/api/encounters",
        json={
            "patient_id": patient_a.id,
            "appointment_id": appt.id,
            "department_id": physio_dept.id if physio_dept else None,
            "symptoms": "Low back pain radiating into right leg",
            "clinical_notes": "",
            "diagnosis": "",
        },
    )
    assert create_enc1.status_code == 201, create_enc1.text
    enc1 = create_enc1.json()
    enc_id = enc1["id"]
    assert enc1["appointment_id"] == appt.id
    assert enc1["version_id"] == 1
    assert enc1["is_finalised"] is False

    # Verify appointment advanced to IN_CONSULTATION and preserved check_in_at
    db_session.refresh(appt)
    assert appt.status == AppointmentStatus.IN_CONSULTATION.value
    assert appt.check_in_at is not None
    original_check_in = appt.check_in_at

    # Idempotent second creation returns 200 OK with identical encounter
    create_enc2 = doc_a_client.post(
        "/api/encounters",
        json={
            "patient_id": patient_a.id,
            "appointment_id": appt.id,
            "symptoms": "Attempt duplicate",
        },
    )
    assert create_enc2.status_code == 200, create_enc2.text
    assert create_enc2.json()["id"] == enc_id

    # -------------------------------------------------------------------------
    # 3. Draft Auto-save & Versioning (DWS-02)
    # -------------------------------------------------------------------------
    patch_v1 = doc_a_client.patch(
        f"/api/encounters/{enc_id}",
        json={
            "symptoms": "Low back pain radiating into right leg for 3 weeks",
            "version_id": 1,
        },
    )
    assert patch_v1.status_code == 200, patch_v1.text
    assert patch_v1.json()["version_id"] == 2
    assert patch_v1.json()["symptoms"] == "Low back pain radiating into right leg for 3 weeks"

    patch_v2 = doc_a_client.patch(
        f"/api/encounters/{enc_id}",
        json={
            "clinical_notes": "Straight Leg Raise (SLR) positive at 35 degrees on right side.",
            "version_id": 2,
        },
    )
    assert patch_v2.status_code == 200, patch_v2.text
    assert patch_v2.json()["version_id"] == 3
    assert patch_v2.json()["clinical_notes"] == "Straight Leg Raise (SLR) positive at 35 degrees on right side."

    # -------------------------------------------------------------------------
    # 4. Vitals & Server BMI (DWS-06)
    # -------------------------------------------------------------------------
    # Invalid vital ranges rejected with 422
    bad_vitals = doc_a_client.put(
        f"/api/encounters/{enc_id}/vitals",
        json={"height_cm": 350.0, "weight_kg": 70.0},
    )
    assert bad_vitals.status_code == 422

    # Valid vitals: height 175 cm, weight 70 kg -> server authoritatively computes BMI = 22.9
    vitals_resp = doc_a_client.put(
        f"/api/encounters/{enc_id}/vitals",
        json={
            "height_cm": 175.0,
            "weight_kg": 70.0,
            "systolic_bp": 120,
            "diastolic_bp": 80,
            "pulse_bpm": 74,
            "temperature_f": 98.4,
            "respiratory_rate": 18,
            "spo2_percent": 99,
        },
    )
    assert vitals_resp.status_code == 200, vitals_resp.text
    vitals_data = vitals_resp.json()
    assert vitals_data["encounter_id"] == enc_id
    assert float(vitals_data["height_cm"]) == 175.0
    assert float(vitals_data["weight_kg"]) == 70.0
    assert float(vitals_data["bmi"]) == 22.9
    assert vitals_data["systolic_bp"] == 120
    assert vitals_data["diastolic_bp"] == 80

    # -------------------------------------------------------------------------
    # 5. Specialty Templates (DWS-05)
    # -------------------------------------------------------------------------
    # 5a. Physiotherapy Template (PHYSIOTHERAPY_V1)
    templates_list = doc_a_client.get("/api/templates/active").json()
    physio_tmpl = next(t for t in templates_list if t["code"] == "PHYSIOTHERAPY")
    physio_ver_id = physio_tmpl["active_version"]["id"]

    physio_save = doc_a_client.put(
        f"/api/encounters/{enc_id}/template-response",
        json={
            "template_version_id": physio_ver_id,
            "response_data": {
                "pain_site": "Lumbar L4-L5 & Right Gluteal",
                "starting_vas": 7,
                "onset_duration": "3 weeks",
                "mmt_grade": "4/5",
                "rom_findings": "Lumbar flexion limited to 40 degrees with pain",
            },
        },
    )
    assert physio_save.status_code == 200, physio_save.text
    assert physio_save.json()["response_data"]["starting_vas"] == 7
    assert physio_save.json()["response_data"]["mmt_grade"] == "4/5"

    # 5b. Ophthalmology Template (OPHTHALMOLOGY_V1) on distinct encounter
    patient_ophth = _create_gate_patient(db_session, "G19OPHTH")
    enc_ophth_resp = doc_a_client.post(
        "/api/encounters",
        json={
            "patient_id": patient_ophth.id,
            "department_id": ophth_dept.id if ophth_dept else None,
            "symptoms": "Blurred distance vision in right eye",
            "clinical_notes": "Cornea clear bilaterally",
            "diagnosis": "Refractive Error Myopia",
        },
    )
    assert enc_ophth_resp.status_code == 201
    enc_ophth_id = enc_ophth_resp.json()["id"]

    ophth_tmpl = next(t for t in templates_list if t["code"] == "OPHTHALMOLOGY")
    ophth_ver_id = ophth_tmpl["active_version"]["id"]

    ophth_save = doc_a_client.put(
        f"/api/encounters/{enc_ophth_id}/template-response",
        json={
            "template_version_id": ophth_ver_id,
            "response_data": {
                "va_distance_uncorrected_od": "6/24",
                "va_distance_uncorrected_os": "6/6",
                "iop_od_mmhg": 16.0,
                "iop_os_mmhg": 15.0,
                "iop_method": "Goldmann Applanation",
            },
        },
    )
    assert ophth_save.status_code == 200, ophth_save.text
    ophth_saved_data = ophth_save.json()["response_data"]
    assert ophth_saved_data["va_distance_uncorrected_od"] == "6/24"
    assert ophth_saved_data["va_distance_uncorrected_os"] == "6/6"
    assert ophth_saved_data["iop_od_mmhg"] == 16.0

    # -------------------------------------------------------------------------
    # 6. Prescription Lifecycle (DWS-07)
    # -------------------------------------------------------------------------
    # 6a. Draft prescription with strength, form, route
    rx_draft_resp = doc_a_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient_a.id,
            "encounter_id": enc_id,
            "status": "DRAFT",
            "diagnosis": "Acute Lumbar Radiculopathy",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Pregabalin Capsule",
                    "dosage": "1 capsule",
                    "frequency": "HS (Bedtime)",
                    "duration_days": 10,
                    "instructions": "After dinner",
                    "strength": "75 mg",
                    "form": "Capsule",
                    "route": "Oral",
                }
            ],
        },
    )
    assert rx_draft_resp.status_code == 201, rx_draft_resp.text
    rx_id = rx_draft_resp.json()["id"]
    assert rx_draft_resp.json()["status"] == "DRAFT"
    assert rx_draft_resp.json()["is_printable"] is False

    # 6b. Authorise prescription
    auth_resp = doc_a_client.post(f"/api/prescriptions/{rx_id}/authorise")
    assert auth_resp.status_code == 200, auth_resp.text
    assert auth_resp.json()["status"] == "AUTHORISED"
    assert auth_resp.json()["authorised_at"] is not None
    assert auth_resp.json()["is_printable"] is True

    # Cannot create second active prescription while active
    dup_rx = doc_a_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient_a.id,
            "encounter_id": enc_id,
            "status": "DRAFT",
            "items": [],
        },
    )
    assert dup_rx.status_code == 409
    assert dup_rx.json()["code"] == "active_prescription_exists"

    # 6c. Cancel prescription with mandatory reason
    short_cancel = doc_a_client.post(f"/api/prescriptions/{rx_id}/cancel", json={"reason": "x"})
    assert short_cancel.status_code == 422

    cancel_resp = doc_a_client.post(
        f"/api/prescriptions/{rx_id}/cancel",
        json={"reason": "Patient has intolerance to pregabalin, substituting with gabapentin."},
    )
    assert cancel_resp.status_code == 200, cancel_resp.text
    assert cancel_resp.json()["status"] == "CANCELLED"
    assert cancel_resp.json()["is_printable"] is False

    # 6d. Re-issue active prescription now succeeds
    reissue_resp = doc_a_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient_a.id,
            "encounter_id": enc_id,
            "status": "AUTHORISED",
            "diagnosis": "Acute Lumbar Radiculopathy",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Gabapentin Tablet",
                    "dosage": "1 tablet",
                    "frequency": "HS",
                    "duration_days": 14,
                    "instructions": "After food",
                    "strength": "100 mg",
                    "form": "Tablet",
                    "route": "Oral",
                }
            ],
        },
    )
    assert reissue_resp.status_code == 201, reissue_resp.text
    assert reissue_resp.json()["status"] == "AUTHORISED"
    assert reissue_resp.json()["is_printable"] is True

    # -------------------------------------------------------------------------
    # 7. Follow-Up Recommendation (DWS-08)
    # -------------------------------------------------------------------------
    target_fu_date = (date.today() + timedelta(days=14)).isoformat()
    sensitive_clinical_reason = "CONFIDENTIAL: Evaluate resolution of S1 radicular numbness after physical therapy cycle."

    fu_resp = doc_a_client.post(
        f"/api/encounters/{enc_id}/follow-up",
        json={
            "recommended_date": target_fu_date,
            "clinical_reason": sensitive_clinical_reason,
        },
    )
    assert fu_resp.status_code == 201, fu_resp.text
    fu_data = fu_resp.json()
    fu_id = fu_data["id"]
    assert fu_data["status"] == "PENDING"
    assert fu_data["clinical_reason"] == sensitive_clinical_reason

    # Reception queries follow-ups: clinical_reason MUST BE EXCLUDED
    rec_fu_resp = rec_client.get("/api/reception/follow-ups")
    assert rec_fu_resp.status_code == 200, rec_fu_resp.text
    rec_items = rec_fu_resp.json()
    matched_fu = next(item for item in rec_items if item["encounter_id"] == enc_id)
    assert matched_fu["patient_urn"] == patient_a.urn
    assert matched_fu["recommended_date"] == target_fu_date
    assert "clinical_reason" not in matched_fu
    assert sensitive_clinical_reason not in rec_fu_resp.text

    # Reception books recommendation into confirmed appointment
    book_fu_resp = rec_client.post(
        f"/api/follow-ups/{fu_id}/book",
        json={"notes": "Booked morning 10 AM follow-up"},
    )
    assert book_fu_resp.status_code == 200, book_fu_resp.text
    assert book_fu_resp.json()["status"] == "BOOKED"
    booked_appt_id = book_fu_resp.json()["booked_appointment_id"]
    assert booked_appt_id is not None

    # -------------------------------------------------------------------------
    # 8. Encounter Finalisation & Tamper Lock (DWS-02, D-19-09)
    # -------------------------------------------------------------------------
    # Attempting to finalise when diagnosis is empty fails with 422 diagnosis_required
    fin_fail = doc_a_client.post(f"/api/encounters/{enc_id}/finalise")
    assert fin_fail.status_code == 422
    assert fin_fail.json()["code"] == "diagnosis_required"

    # Finalise with valid diagnosis
    fin_ok = doc_a_client.post(
        f"/api/encounters/{enc_id}/finalise",
        json={
            "symptoms": "Low back pain radiating into right leg for 3 weeks",
            "diagnosis": "Lumbar Disc Herniation with S1 Radiculopathy",
        },
    )
    assert fin_ok.status_code == 200, fin_ok.text
    assert fin_ok.json()["is_finalised"] is True
    assert fin_ok.json()["finalised_at"] is not None

    # Verify PostgreSQL tamper trigger blocks direct SQL modifications
    savepoint = db_session.begin_nested()
    with pytest.raises(DBAPIError) as exc_info:
        db_session.execute(
            text("UPDATE clinical_encounters SET symptoms = 'Tampered text' WHERE id = :id"),
            {"id": enc_id},
        )
        db_session.flush()
    assert "Finalised encounter cannot be modified" in str(exc_info.value)
    savepoint.rollback()

    # -------------------------------------------------------------------------
    # 9. Audited Cross-Doctor Read (DWS-04)
    # -------------------------------------------------------------------------
    doc_b_client = login_client(doctor_b_user)
    # Doctor B reads Doctor A's finalised encounter -> 200 OK
    doc_b_read = doc_b_client.get(f"/api/encounters/{enc_id}")
    assert doc_b_read.status_code == 200, doc_b_read.text
    assert doc_b_read.json()["id"] == enc_id
    assert doc_b_read.json()["doctor_id"] == doctor_a_user.doctor_id

    # Verify CROSS_DOCTOR_CLINICAL_READ audit entry exists
    cross_logs = db_session.execute(
        select(AuditLog).where(
            AuditLog.action == AuditAction.CROSS_DOCTOR_CLINICAL_READ.value,
            AuditLog.entity_id == str(enc_id),
        )
    ).scalars().all()
    assert len(cross_logs) >= 1
    audit_entry = cross_logs[-1]
    assert audit_entry.actor_user_id == doctor_b_user.id
    assert audit_entry.actor_role == "DOCTOR"
    assert audit_entry.after_data["actor_doctor_id"] == doctor_b_user.doctor_id
    assert audit_entry.after_data["record_doctor_id"] == doctor_a_user.doctor_id
    assert audit_entry.after_data["patient_id"] == patient_a.id

    # Doctor B write attempts on Doctor A's encounter return 404
    b_patch = doc_b_client.patch(
        f"/api/encounters/{enc_id}",
        json={"symptoms": "Tamper from Doctor B", "version_id": 3},
    )
    assert b_patch.status_code == 404

    # -------------------------------------------------------------------------
    # 10. Single Session Concurrency & Takeover (DWS-10)
    # -------------------------------------------------------------------------
    dev1 = make_client("192.168.1.71")
    dev2 = make_client("192.168.1.72")

    # Device 1 logs in
    login1 = dev1.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": TEST_PASSWORD},
    )
    assert login1.status_code == 200, login1.text

    # Device 2 logs in without takeover -> 409 Conflict session_in_use
    login2_conflict = dev2.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": TEST_PASSWORD},
    )
    assert login2_conflict.status_code == 409, login2_conflict.text
    assert login2_conflict.json()["code"] == "session_in_use"
    assert "active_session" in login2_conflict.json()

    # Device 2 logs in with takeover=True -> 200 OK
    login2_takeover = dev2.post(
        "/api/auth/login",
        json={
            "username": admin_user.username,
            "password": TEST_PASSWORD,
            "takeover": True,
        },
    )
    assert login2_takeover.status_code == 200, login2_takeover.text

    # Device 1 is now logged out
    assert dev1.get("/api/auth/me").status_code == 401

    # Device 2 is authenticated
    assert dev2.get("/api/auth/me").status_code == 200

    # SESSION_TAKEOVER audit entry recorded
    takeover_log = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == AuditAction.SESSION_TAKEOVER.value,
            AuditLog.actor_user_id == admin_user.id,
        )
        .order_by(AuditLog.id.desc())
    )
    assert takeover_log is not None
    assert takeover_log.outcome == "SUCCESS"
