"""End-to-end integration gate test for Phase 12 (Clinic Settings & Patient Registration).

Validates the full chain:
1. Admin updates clinic settings (SET-01).
2. Admin creates doctor profile and fee schedule (SET-02, SET-03).
3. Reception checks for duplicates and registers patient with atomic URN (PAT-01, PAT-04).
4. Reception uploads patient photo and verifies authenticated streaming (PAT-05).
5. Reception performs multi-modal patient search across URN, mobile, and name (PAT-02).
6. Reception modifies patient demographics with optimistic concurrency (PAT-03).
7. Verifies audit log records for each critical lifecycle operation.
"""

import io
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.models import AuditLog, User


def test_phase12_full_lifecycle_gate(
    login_client: Any,
    client: TestClient,
    admin_user: User,
    reception_user: User,
    db_session: Session,
) -> None:
    admin_c = login_client(admin_user)
    rec_c = login_client(reception_user)

    # 1. SET-01: Admin reads and updates clinic settings
    settings_res = admin_c.get("/api/settings")
    assert settings_res.status_code == 200, settings_res.text
    initial_settings = settings_res.json()
    v_id = initial_settings["version_id"]

    patch_settings_res = admin_c.patch(
        "/api/settings",
        json={
            "name_en": "Kalyan Hospital Phase 12",
            "name_hi": "कल्याण अस्पताल चरण 12",
            "address_1": "Station Road Gate Test",
            "address_2": "Near Main Junction",
            "phone": "06182-998877",
            "email": "gate@kalyanhospital.org",
            "receipt_sequence_cycle": "FINANCIAL_YEAR",
            "print_header_en": "Phase 12 Hospital Trust",
            "print_header_hi": "चरण 12 अस्पताल ट्रस्ट",
            "print_footer_en": "Speedy recovery",
            "print_footer_hi": "शीघ्र स्वास्थ्य लाभ",
            "consultation_validity_days": 20,
            "version_id": v_id,
        },
    )
    assert patch_settings_res.status_code == 200, patch_settings_res.text
    assert patch_settings_res.json()["name_en"] == "Kalyan Hospital Phase 12"

    # 2. SET-02 & SET-03: Admin registers doctor and fee schedule
    doc_res = admin_c.post(
        "/api/doctors",
        json={
            "name_en": "Dr. Gate Doctor",
            "name_hi": "डॉ. गेट डॉक्टर",
            "qualification": "MBBS, MD",
            "registration_number": "REG-GATE-12",
            "default_fee_paise": 40000,
        },
    )
    assert doc_res.status_code == 201, doc_res.text

    fee_res = admin_c.post(
        "/api/fees",
        json={
            "name": "Phase 12 Consultation Fee",
            "fee_paise": 35000,
        },
    )
    assert fee_res.status_code == 201, fee_res.text

    # 3. PAT-04: Duplicate check before registration
    dup_check_res = rec_c.get("/api/patients/check-duplicate?name=Aman%20Verma&mobile=9876543219")
    assert dup_check_res.status_code == 200, dup_check_res.text
    assert dup_check_res.json()["has_duplicate"] is False

    # 4. PAT-01: Reception registers patient with 12 canonical fields
    pat_res = rec_c.post(
        "/api/patients",
        json={
            "full_name": "Aman Verma",
            "guardian_name": "R. K. Verma",
            "gender": "M",
            "dob": "1992-04-10",
            "age_years": 34,
            "mobile": "9876543219",
            "address": "Mohalla Nawada, Ara",
            "district": "Bhojpur",
            "state": "Bihar",
            "emergency_contact": "9876500001",
            "allergies": "Sulfa drugs",
            "notes": "Gate test patient notes",
        },
    )
    assert pat_res.status_code == 201, pat_res.text
    patient = pat_res.json()
    patient_id = patient["id"]
    urn = patient["urn"]
    assert urn.startswith("KH-")

    # Duplicate check should now detect this patient
    dup_detected = rec_c.get("/api/patients/check-duplicate?name=aman%20verma&mobile=9876543219")
    assert dup_detected.status_code == 200
    assert dup_detected.json()["has_duplicate"] is True
    assert dup_detected.json()["matching_patient"]["urn"] == urn

    # 5. PAT-05: Upload photo & stream
    fake_png_data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    photo_upload_res = rec_c.post(
        f"/api/patients/{patient_id}/photo",
        files={"file": ("avatar.png", io.BytesIO(fake_png_data), "image/png")},
    )
    assert photo_upload_res.status_code == 200, photo_upload_res.text
    assert photo_upload_res.json()["photo_path"] is not None

    photo_stream_res = rec_c.get(f"/api/patients/{patient_id}/photo")
    assert photo_stream_res.status_code == 200
    assert photo_stream_res.headers.get("content-type") == "image/png"

    # Anonymous access to photo returns 401
    anon_photo_res = client.get(f"/api/patients/{patient_id}/photo")
    assert anon_photo_res.status_code == 401

    # 6. PAT-02: Multi-modal search
    search_by_urn = rec_c.get(f"/api/patients?q={urn}")
    assert search_by_urn.status_code == 200
    assert len(search_by_urn.json()) >= 1
    assert any(p["urn"] == urn for p in search_by_urn.json())

    search_by_mobile = rec_c.get("/api/patients?q=9876543219")
    assert search_by_mobile.status_code == 200
    assert any(p["urn"] == urn for p in search_by_mobile.json())

    search_by_name = rec_c.get("/api/patients?q=Aman")
    assert search_by_name.status_code == 200
    assert any(p["urn"] == urn for p in search_by_name.json())

    # 7. PAT-03: Modify demographic fields with optimistic concurrency
    current_pat = rec_c.get(f"/api/patients/{patient_id}").json()
    patch_pat_res = rec_c.patch(
        f"/api/patients/{patient_id}",
        json={
            "version_id": current_pat["version_id"],
            "address": "Updated Address Lane 2, Ara",
            "allergies": "Sulfa drugs, Aspirin",
        },
    )
    assert patch_pat_res.status_code == 200, patch_pat_res.text
    updated_pat = patch_pat_res.json()
    assert updated_pat["address"] == "Updated Address Lane 2, Ara"
    assert updated_pat["version_id"] == current_pat["version_id"] + 1

    # Stale version returns 409 conflict
    conflict_res = rec_c.patch(
        f"/api/patients/{patient_id}",
        json={
            "version_id": current_pat["version_id"],  # now stale
            "address": "Should fail",
        },
    )
    assert conflict_res.status_code == 409
    assert conflict_res.json()["code"] == "version_conflict"

    # 8. Audit logs verification
    logs = db_session.execute(
        select(AuditLog)
        .where(AuditLog.entity_id.in_([str(patient_id), "1"]))
        .order_by(AuditLog.id.asc())
    ).scalars().all()

    action_names = {log.action for log in logs}
    assert "SETTINGS_UPDATED" in action_names
    assert "PATIENT_REGISTERED" in action_names
    assert "PATIENT_UPDATED" in action_names
    assert "PHOTO_UPLOADED" in action_names
