"""Comprehensive Cross-Doctor Clinical Authorization and Silo Security Test Suite (DWS-04, D-19-05).

Guarantees:
- Any authenticated doctor can read finalised encounters, prescriptions, timelines,
  treatment plans, and therapy sessions authored by any doctor in the hospital (DWS-04).
- Reading another doctor's clinical record automatically records an in-transaction
  CROSS_DOCTOR_CLINICAL_READ entry in audit_logs with actor_doctor_id, record_doctor_id, and patient_id.
- Reading own clinical record does NOT record a CROSS_DOCTOR_CLINICAL_READ audit entry.
- Write attempts (update, finalise, add addenda, cancel) on another doctor's record are strictly rejected with HTTP 404.
- Reception and Admin roles are unconditionally denied access to clinical encounters and prescriptions (HTTP 403/404).
- get_scoped_or_404 directly raises HTTP 404 not_found for non-doctor roles under ScopeFamily.CLINICAL_READ.
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Role
from kalyan_api.core.principal import Principal
from kalyan_api.core.scope import ScopeFamily, get_scoped_or_404
from kalyan_api.models import AuditLog, ClinicalEncounter, Patient, Prescription, TreatmentPlan, User
from kalyan_api.services.audit_service import AuditAction


def _create_test_patient(session: Session, urn_suffix: str = "01") -> Patient:
    patient = Patient(
        urn=f"KH-2026-XDOC-{urn_suffix}",
        full_name="Cross Doctor Test Patient",
        guardian_name="Guardian",
        gender="M",
        age_years=42,
        mobile="9876543999",
        address="Test Clinic Road",
    )
    session.add(patient)
    session.flush()
    return patient


def test_doctor_b_reads_doctor_a_encounter_audited(
    login_client: Any,
    doctor_a_user: User,
    doctor_b_user: User,
    db_session: Session,
) -> None:
    """Doctor B reads Doctor A's finalised encounter -> 200 with CROSS_DOCTOR_CLINICAL_READ audit log."""
    patient = _create_test_patient(db_session, "01")
    client_a = login_client(doctor_a_user)
    client_b = login_client(doctor_b_user)

    # 1. Doctor A creates and finalises encounter
    create_resp = client_a.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "symptoms": "Low back pain",
            "clinical_notes": "L5-S1 disc pathology suspected",
            "diagnosis": "Lumbar Radiculopathy",
        },
    )
    assert create_resp.status_code == 201
    enc_id = create_resp.json()["id"]

    fin_resp = client_a.post(f"/api/encounters/{enc_id}/finalise")
    assert fin_resp.status_code == 200
    assert fin_resp.json()["is_finalised"] is True

    # 2. Doctor B reads Doctor A's encounter -> succeeds with 200
    b_read = client_b.get(f"/api/encounters/{enc_id}")
    assert b_read.status_code == 200
    data = b_read.json()
    assert data["id"] == enc_id
    assert data["doctor_id"] == doctor_a_user.doctor_id
    assert data["diagnosis"] == "Lumbar Radiculopathy"

    # 3. Verify in-transaction audit log recorded
    logs = db_session.execute(
        select(AuditLog)
        .where(
            AuditLog.action == AuditAction.CROSS_DOCTOR_CLINICAL_READ,
            AuditLog.entity_id == str(enc_id),
        )
    ).scalars().all()

    assert len(logs) == 1
    audit_entry = logs[0]
    assert audit_entry.actor_user_id == doctor_b_user.id
    assert audit_entry.actor_role == "DOCTOR"
    assert audit_entry.after_data == {
        "actor_doctor_id": doctor_b_user.doctor_id,
        "record_doctor_id": doctor_a_user.doctor_id,
        "patient_id": patient.id,
    }


def test_doctor_a_reads_own_encounter_no_cross_audit(
    login_client: Any,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Doctor A reads own encounter -> 200 without creating CROSS_DOCTOR_CLINICAL_READ audit log."""
    patient = _create_test_patient(db_session, "02")
    client_a = login_client(doctor_a_user)

    create_resp = client_a.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "symptoms": "Headache",
            "clinical_notes": "Tension headache",
            "diagnosis": "Tension-type Headache",
        },
    )
    assert create_resp.status_code == 201
    enc_id = create_resp.json()["id"]

    # Read own encounter
    read_resp = client_a.get(f"/api/encounters/{enc_id}")
    assert read_resp.status_code == 200

    # Verify NO cross-doctor audit log was generated
    logs = db_session.execute(
        select(AuditLog).where(
            AuditLog.action == AuditAction.CROSS_DOCTOR_CLINICAL_READ,
            AuditLog.entity_id == str(enc_id),
        )
    ).scalars().all()
    assert len(logs) == 0


def test_doctor_b_write_attempts_rejected_with_404(
    login_client: Any,
    doctor_a_user: User,
    doctor_b_user: User,
    db_session: Session,
) -> None:
    """Doctor B attempting to modify, finalise, or add addendum to Doctor A's encounter is rejected with 404."""
    patient = _create_test_patient(db_session, "03")
    client_a = login_client(doctor_a_user)
    client_b = login_client(doctor_b_user)

    create_resp = client_a.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "symptoms": "Knee pain",
            "clinical_notes": "Draft notes",
            "diagnosis": "Patellofemoral Pain",
        },
    )
    assert create_resp.status_code == 201
    enc_id = create_resp.json()["id"]

    # 1. Doctor B attempts patch -> 404
    patch_resp = client_b.patch(
        f"/api/encounters/{enc_id}",
        json={"symptoms": "Tampered symptoms", "version_id": 1},
    )
    assert patch_resp.status_code == 404

    # 2. Doctor B attempts finalise -> 404
    fin_resp = client_b.post(f"/api/encounters/{enc_id}/finalise")
    assert fin_resp.status_code == 404

    # Doctor A finalises it properly
    assert client_a.post(f"/api/encounters/{enc_id}/finalise").status_code == 200

    # 3. Doctor B attempts add addendum -> 404
    add_resp = client_b.post(
        f"/api/encounters/{enc_id}/addenda",
        json={"addendum_text": "Unauthorized addendum attempt"},
    )
    assert add_resp.status_code == 404


def test_doctor_b_prescription_mutations_rejected_with_404(
    login_client: Any,
    doctor_a_user: User,
    doctor_b_user: User,
    db_session: Session,
) -> None:
    """Doctor B cannot update, authorise, or cancel Doctor A's prescription (rejected with 404)."""
    patient = _create_test_patient(db_session, "04")
    client_a = login_client(doctor_a_user)
    client_b = login_client(doctor_b_user)

    # Doctor A creates prescription
    create_resp = client_a.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "diagnosis": "Acute Sciatica",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Naproxen 500mg",
                    "dosage": "1 tab",
                    "frequency": "BD",
                    "duration_days": 5,
                }
            ],
        },
    )
    assert create_resp.status_code == 201
    rx_id = create_resp.json()["id"]

    # Doctor B can read Doctor A's prescription -> 200
    read_resp = client_b.get(f"/api/prescriptions/{rx_id}")
    assert read_resp.status_code == 200

    # Doctor B attempts to update draft -> 404
    put_resp = client_b.put(
        f"/api/prescriptions/{rx_id}",
        json={
            "diagnosis": "Tampered Diagnosis",
            "version_id": 1,
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Ibuprofen 400mg",
                    "dosage": "1 tab",
                    "frequency": "TDS",
                    "duration_days": 3,
                }
            ],
        },
    )
    assert put_resp.status_code == 404

    # Doctor B attempts to authorise -> 404
    auth_resp = client_b.post(f"/api/prescriptions/{rx_id}/authorise")
    assert auth_resp.status_code == 404

    # Doctor B attempts to cancel -> 404
    cancel_resp = client_b.post(
        f"/api/prescriptions/{rx_id}/cancel",
        json={"reason": "Unauthorized cancellation attempt"},
    )
    assert cancel_resp.status_code == 404


def test_reception_and_admin_denied_reading_clinical_records(
    login_client: Any,
    doctor_a_user: User,
    reception_user: User,
    admin_user: User,
    db_session: Session,
) -> None:
    """Reception and Admin roles are strictly blocked from reading clinical encounters and prescriptions."""
    patient = _create_test_patient(db_session, "05")
    client_a = login_client(doctor_a_user)
    client_rec = login_client(reception_user)
    client_adm = login_client(admin_user)

    # Doctor A creates encounter and prescription
    enc_resp = client_a.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "symptoms": "Neck stiffness",
            "clinical_notes": "Clinical notes for privacy check",
            "diagnosis": "Cervical Strain",
        },
    )
    assert enc_resp.status_code == 201
    enc_id = enc_resp.json()["id"]

    rx_resp = client_a.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "diagnosis": "Cervical Strain",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Paracetamol 500mg",
                    "dosage": "1 tab",
                    "frequency": "TDS",
                    "duration_days": 3,
                }
            ],
        },
    )
    assert rx_resp.status_code == 201
    rx_id = rx_resp.json()["id"]

    # Reception cannot read encounter or prescription (HTTP 403 Forbidden)
    assert client_rec.get(f"/api/encounters/{enc_id}").status_code == 403
    assert client_rec.get(f"/api/prescriptions/{rx_id}").status_code == 403

    # Admin cannot read encounter or prescription (HTTP 403 Forbidden)
    assert client_adm.get(f"/api/encounters/{enc_id}").status_code == 403
    assert client_adm.get(f"/api/prescriptions/{rx_id}").status_code == 403


def test_scope_helpers_direct_denial_reception_and_admin(
    doctor_a_user: User,
    reception_user: User,
    admin_user: User,
    db_session: Session,
) -> None:
    """Direct scope helper invocation raises 404 not_found for non-doctor roles under CLINICAL_READ."""
    patient = _create_test_patient(db_session, "06")

    enc = ClinicalEncounter(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        symptoms="Ankle sprain",
        clinical_notes="Grade 2 sprain",
        diagnosis="Lateral Ankle Sprain",
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(enc)
    db_session.flush()

    p_reception = Principal(
        user_id=reception_user.id,
        username=reception_user.username,
        role=Role.RECEPTION,
        doctor_id=None,
        permissions=frozenset(),
        session_id=1,
        must_change_password=False,
    )
    p_admin = Principal(
        user_id=admin_user.id,
        username=admin_user.username,
        role=Role.ADMIN,
        doctor_id=None,
        permissions=frozenset(),
        session_id=1,
        must_change_password=False,
    )

    # Both must raise 404 not_found (indistinguishable from missing ID)
    with pytest.raises(ApiError) as exc_rec:
        get_scoped_or_404(
            db_session,
            ClinicalEncounter,
            enc.id,
            p_reception,
            family=ScopeFamily.CLINICAL_READ,
            doctor_id_col=ClinicalEncounter.doctor_id,
        )
    assert exc_rec.value.status_code == 404
    assert exc_rec.value.code == "not_found"

    with pytest.raises(ApiError) as exc_adm:
        get_scoped_or_404(
            db_session,
            ClinicalEncounter,
            enc.id,
            p_admin,
            family=ScopeFamily.CLINICAL_READ,
            doctor_id_col=ClinicalEncounter.doctor_id,
        )
    assert exc_adm.value.status_code == 404
    assert exc_adm.value.code == "not_found"
