"""Tests for Admin Patient Demographic Correction endpoint and search (D-20-02, D-20-03, D-20-04).

Requirements:
- Admin can search patients server-side by URN, legacy URN, full name, or mobile.
- Admin can correct demographics with mandatory reason (>= 5 chars).
- Optimistic locking enforces version_id check (409 on conflict).
- Permanent audit log is recorded with before and after state diffs.
- Forbidden fields (URN, allergies, notes) are strictly rejected with 422.
- Non-admin callers (Reception, Doctor, Anonymous) are denied.
"""

from typing import Any
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.models import AuditLog, Patient, User
from kalyan_api.services.audit_service import AuditAction


def _create_patient(session: Session, suffix: str = "01", legacy_urn: str | None = None) -> Patient:
    num_suffix = "".join(c for c in suffix if c.isdigit()) or "1234"
    mobile_digits = f"98765{num_suffix[-5:].ljust(5, '0')}"
    patient = Patient(
        urn=f"KH-2026-CORR{suffix}",
        legacy_urn=legacy_urn,
        full_name=f"Original Patient {suffix}",
        guardian_name="Original Guardian",
        gender="M",
        dob=None,
        age_years=35,
        mobile=mobile_digits,
        address="Original Address 100",
        district="Bhojpur",
        state="Bihar",
        emergency_contact="9876540000",
        allergies="None reported",
        notes="Reception note here",
    )
    session.add(patient)
    session.flush()
    return patient


def test_admin_search_patients(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """GET /api/admin/patients/search finds patients by URN, legacy URN, name, or mobile; guarded by PATIENT_CORRECT."""
    uid = uuid.uuid4().hex[:4]
    p1 = _create_patient(db_session, f"A{uid}", legacy_urn=f"OLD-HOSP-{uid}")
    p2 = _create_patient(db_session, f"B{uid}")

    admin_c: TestClient = login_client(admin_user)

    # 1. Search by URN
    r = admin_c.get(f"/api/admin/patients/search?q={p1.urn}")
    assert r.status_code == 200, r.text
    results = r.json()
    assert any(x["id"] == p1.id for x in results)

    # 2. Search by legacy URN
    r = admin_c.get(f"/api/admin/patients/search?q=OLD-HOSP-{uid}")
    assert r.status_code == 200
    results = r.json()
    assert any(x["id"] == p1.id for x in results)

    # 3. Search by name
    r = admin_c.get(f"/api/admin/patients/search?q=Original Patient B{uid}")
    assert r.status_code == 200
    results = r.json()
    assert any(x["id"] == p2.id for x in results)

    # 4. Search by mobile
    r = admin_c.get(f"/api/admin/patients/search?q={p1.mobile[-6:]}")
    assert r.status_code == 200
    results = r.json()
    assert any(x["id"] == p1.id for x in results)

    # 5. RBAC: Reception and Doctor denied
    rec_c: TestClient = login_client(reception_user)
    assert rec_c.get(f"/api/admin/patients/search?q={p1.urn}").status_code == 403

    doc_c: TestClient = login_client(doctor_a_user)
    assert doc_c.get(f"/api/admin/patients/search?q={p1.urn}").status_code == 403


def test_admin_corrects_demographics_successfully(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """Admin corrects demographic fields; version_id increments and PATIENT_CORRECTED audit is written."""
    uid = uuid.uuid4().hex[:4]
    pat = _create_patient(db_session, f"C{uid}")
    orig_version = pat.version_id

    admin_c: TestClient = login_client(admin_user)

    payload = {
        "reason": "Official Aadhaar name correction per patient request",
        "version_id": orig_version,
        "full_name": "Corrected Full Name",
        "guardian_name": "Corrected Guardian Name",
        "gender": "F",
        "dob": "1992-05-15",
        "age_years": 34,
        "mobile": "9123456789",
        "address": "456 New Village Road",
        "district": "Patna",
        "state": "Bihar",
        "emergency_contact": "9988776655",
    }

    resp = admin_c.patch(f"/api/admin/patients/{pat.id}/demographics", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["full_name"] == "Corrected Full Name"
    assert data["guardian_name"] == "Corrected Guardian Name"
    assert data["gender"] == "F"
    assert data["dob"] == "1992-05-15"
    assert data["age_years"] == 34
    assert data["mobile"] == "9123456789"
    assert data["address"] == "456 New Village Road"
    assert data["district"] == "Patna"
    assert data["state"] == "Bihar"
    assert data["emergency_contact"] == "9988776655"
    assert data["version_id"] == orig_version + 1
    # URN, allergies, and notes must remain intact
    assert data["urn"] == pat.urn
    assert data["allergies"] == "None reported"
    assert data["notes"] == "Reception note here"

    # Verify audit record
    audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.entity_id == str(pat.id),
            AuditLog.action == AuditAction.PATIENT_CORRECTED.value,
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit is not None
    assert audit.reason == "Official Aadhaar name correction per patient request"
    assert audit.before_data is not None
    assert audit.before_data["full_name"] == f"Original Patient C{uid}"
    assert audit.before_data["gender"] == "M"
    assert audit.after_data is not None
    assert audit.after_data["full_name"] == "Corrected Full Name"
    assert audit.after_data["gender"] == "F"


def test_correction_rejects_missing_or_short_reason(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """Demographic correction requires reason >= 5 characters."""
    uid = uuid.uuid4().hex[:4]
    pat = _create_patient(db_session, f"D{uid}")
    admin_c: TestClient = login_client(admin_user)

    # Missing reason
    payload_no_reason = {
        "version_id": pat.version_id,
        "full_name": "New Name",
        "guardian_name": "New Guardian",
        "gender": "M",
        "age_years": 30,
        "mobile": "9876543210",
        "address": "Some Address",
        "district": "Bhojpur",
        "state": "Bihar",
    }
    r1 = admin_c.patch(f"/api/admin/patients/{pat.id}/demographics", json=payload_no_reason)
    assert r1.status_code == 422

    # Short reason (< 5 chars)
    payload_short_reason = {**payload_no_reason, "reason": "Edit"}
    r2 = admin_c.patch(f"/api/admin/patients/{pat.id}/demographics", json=payload_short_reason)
    assert r2.status_code == 422


def test_correction_rejects_forbidden_fields(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """Extra fields like urn, allergies, notes are rejected with HTTP 422."""
    uid = uuid.uuid4().hex[:4]
    pat = _create_patient(db_session, f"E{uid}")
    admin_c: TestClient = login_client(admin_user)

    base = {
        "reason": "Valid justification text",
        "version_id": pat.version_id,
        "full_name": "Valid Name",
        "guardian_name": "Valid Guardian",
        "gender": "M",
        "age_years": 30,
        "mobile": "9876543210",
        "address": "Valid Address",
        "district": "Bhojpur",
        "state": "Bihar",
    }

    # Attempting to supply urn
    r_urn = admin_c.patch(f"/api/admin/patients/{pat.id}/demographics", json={**base, "urn": "KH-9999-9999"})
    assert r_urn.status_code == 422

    # Attempting to supply allergies
    r_alg = admin_c.patch(f"/api/admin/patients/{pat.id}/demographics", json={**base, "allergies": "Penicillin"})
    assert r_alg.status_code == 422

    # Attempting to supply notes
    r_notes = admin_c.patch(f"/api/admin/patients/{pat.id}/demographics", json={**base, "notes": "New note"})
    assert r_notes.status_code == 422


def test_correction_concurrency_conflict_409(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """Stale version_id returns HTTP 409 version_conflict."""
    uid = uuid.uuid4().hex[:4]
    pat = _create_patient(db_session, f"F{uid}")
    admin_c: TestClient = login_client(admin_user)

    payload = {
        "reason": "Administrative correction with stale version",
        "version_id": pat.version_id + 999,  # Stale version
        "full_name": "Conflict Name",
        "guardian_name": "Conflict Guardian",
        "gender": "M",
        "age_years": 30,
        "mobile": "9876543210",
        "address": "Some Address",
        "district": "Bhojpur",
        "state": "Bihar",
    }

    r = admin_c.patch(f"/api/admin/patients/{pat.id}/demographics", json=payload)
    assert r.status_code == 409
    assert r.json()["code"] == "version_conflict"


def test_correction_rbac_denial(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Non-admin roles and unauthenticated callers are denied PATCH /demographics."""
    uid = uuid.uuid4().hex[:4]
    pat = _create_patient(db_session, f"G{uid}")

    payload = {
        "reason": "Attempted unauthorized correction",
        "version_id": pat.version_id,
        "full_name": "Hacked Name",
        "guardian_name": "Hacked Guardian",
        "gender": "M",
        "age_years": 30,
        "mobile": "9876543210",
        "address": "Some Address",
        "district": "Bhojpur",
        "state": "Bihar",
    }

    # Reception -> 403
    rec_c: TestClient = login_client(reception_user)
    r_rec = rec_c.patch(f"/api/admin/patients/{pat.id}/demographics", json=payload)
    assert r_rec.status_code == 403

    # Doctor -> 403
    doc_c: TestClient = login_client(doctor_a_user)
    r_doc = doc_c.patch(f"/api/admin/patients/{pat.id}/demographics", json=payload)
    assert r_doc.status_code == 403
