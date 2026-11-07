"""Comprehensive Phase 20 Integration Gate Test Suite (Plan 20-08).

Guarantees:
1. Permissions Enforcement:
   - Admin access granted to /api/admin/patients/{id}/demographics, /api/admin/assets,
     /api/admin/templates, /api/admin/imports, /api/admin/exports.
   - Reception and Doctor denied (HTTP 403) on all Phase 20 admin endpoints.
   - Admin denied (HTTP 403) on Reception's PATCH /api/patients/{id} (Admin lacks patient:update).
2. Demographic Correction & Snapshot Isolation:
   - Demographic correction records PATIENT_CORRECTED audit event with before/after state diff.
   - Optimistic concurrency (409 version_conflict) enforced.
   - Historical snapshot isolation: payments, prescriptions, and clinical encounters
     preserve their point-in-time patient demographics after correction.
   - Database tamper protection: direct SQL UPDATE on payment snapshot columns is blocked by trigger.
3. Hospital Asset Management:
   - Multipart asset upload with magic byte verification and ASSET_UPLOADED audit log.
   - Unauthenticated GET /api/assets/active-logo streams active crest.
   - Deactivation performs soft delete: DB is_active=False while physical file is preserved.
   - check_asset_storage_integrity verifies no orphan or missing files.
   - create_backup bundle includes assets/ directory and verified assets_manifest.
4. Print Templates:
   - Fetch seeded print templates and patch bilingual header/footer.
   - Optimistic locking enforces version increment and 409 on stale submissions.
   - Synchronous PRINT_TEMPLATE_UPDATED audit event recording.
5. Patient Import Pipeline:
   - 3-row synthetic spreadsheet (1 valid, 1 duplicate mobile+address, 1 invalid missing guardian).
   - Staging, validation, duplicate resolution as SKIP.
   - Pre-commit backup safety gate and gap-free URN allocation.
   - Download error records CSV with reasons.
   - PATIENT_IMPORT_STAGED and PATIENT_IMPORT_COMMITTED audit events.
6. Patient Export Streaming:
   - Streaming CSV export with formula injection neutralization ('=1+2).
   - PATIENT_EXPORTED audit event with reason and row count.
"""

from datetime import UTC, datetime
import io
import json
from pathlib import Path
import tarfile
from typing import Any
import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.models import (
    Appointment,
    AuditLog,
    ClinicalEncounter,
    HospitalAsset,
    Patient,
    PatientImportBatch,
    Payment,
    Prescription,
    PrintDocumentType,
    PrintTemplate,
    User,
)
from kalyan_api.services.asset_service import get_asset_path
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.backup_service import create_backup, verify_backup_bundle
from kalyan_api.services.integrity_service import check_asset_storage_integrity

VALID_PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4"


def _create_gate_patient(
    session: Session,
    suffix: str = "01",
    full_name: str | None = None,
    mobile: str | None = None,
    address: str | None = None,
) -> Patient:
    num_suffix = "".join(c for c in suffix if c.isdigit()) or "1234"
    mobile_digits = mobile or f"98765{num_suffix[-5:].ljust(5, '0')}"
    patient = Patient(
        urn=f"KH-2026-GATE{suffix}",
        full_name=full_name or f"Gate Patient {suffix}",
        guardian_name="Gate Guardian",
        gender="M",
        age_years=40,
        mobile=mobile_digits,
        address=address or f"Gate Street {suffix}, Ara",
        district="Bhojpur",
        state="Bihar",
        allergies="None",
        notes="Standard registration notes",
    )
    session.add(patient)
    session.commit()
    return patient


# =============================================================================
# 1. PERMISSIONS ENFORCEMENT
# =============================================================================
def test_phase20_permissions_enforcement(
    client: TestClient,
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Validate RBAC permissions matrix across all new Phase 20 endpoints and assert Admin lacks patient:update."""
    uid = uuid.uuid4().hex[:4]
    patient = _create_gate_patient(db_session, f"P1{uid}")

    admin_c: TestClient = login_client(admin_user)
    rec_c: TestClient = login_client(reception_user)
    doc_c: TestClient = login_client(doctor_a_user)

    # 1.1 /api/admin/patients/search and demographics correction
    # Admin allowed
    res_admin_search = admin_c.get(f"/api/admin/patients/search?q={patient.urn}")
    assert res_admin_search.status_code == 200, res_admin_search.text

    # Reception & Doctor denied
    assert rec_c.get(f"/api/admin/patients/search?q={patient.urn}").status_code == 403
    assert doc_c.get(f"/api/admin/patients/search?q={patient.urn}").status_code == 403

    corr_payload = {
        "reason": "Administrative correction for RBAC gate check",
        "version_id": patient.version_id,
        "full_name": "Gate Correction Name",
        "guardian_name": "Gate Guardian",
        "gender": "M",
        "age_years": 41,
        "mobile": patient.mobile,
        "address": patient.address,
        "district": "Bhojpur",
        "state": "Bihar",
    }
    assert rec_c.patch(f"/api/admin/patients/{patient.id}/demographics", json=corr_payload).status_code == 403
    assert doc_c.patch(f"/api/admin/patients/{patient.id}/demographics", json=corr_payload).status_code == 403

    # 1.2 /api/admin/assets
    assert admin_c.get("/api/admin/assets").status_code == 200
    assert rec_c.get("/api/admin/assets").status_code == 403
    assert doc_c.get("/api/admin/assets").status_code == 403

    # 1.3 /api/admin/templates
    assert admin_c.get("/api/admin/templates").status_code == 200
    assert rec_c.get("/api/admin/templates").status_code == 403
    assert doc_c.get("/api/admin/templates").status_code == 403

    # 1.4 /api/admin/imports
    dummy_csv = b"full_name,guardian_name,gender,age_years,mobile,address\nTest,G,M,30,9876543210,Ara\n"
    assert admin_c.post("/api/admin/imports/inspect", files={"file": ("test.csv", dummy_csv, "text/csv")}).status_code == 200
    assert rec_c.post("/api/admin/imports/inspect", files={"file": ("test.csv", dummy_csv, "text/csv")}).status_code == 403
    assert doc_c.post("/api/admin/imports/inspect", files={"file": ("test.csv", dummy_csv, "text/csv")}).status_code == 403

    # 1.5 /api/admin/exports
    export_payload = {
        "reason": "Permissions matrix verification export",
        "format": "csv",
        "scope": {},
        "fields": ["full_name"],
    }
    assert admin_c.post("/api/admin/exports", json=export_payload).status_code == 200
    assert rec_c.post("/api/admin/exports", json=export_payload).status_code == 403
    assert doc_c.post("/api/admin/exports", json=export_payload).status_code == 403

    # 1.6 Assert Admin lacks patient:update on Reception's PATCH /api/patients/{id}
    admin_rec_patch = admin_c.patch(
        f"/api/patients/{patient.id}",
        json={"full_name": "Attempted Admin Tamper", "version_id": patient.version_id},
    )
    assert admin_rec_patch.status_code == 403, (
        f"Expected HTTP 403 Forbidden for Admin on /api/patients/{{id}}, got {admin_rec_patch.status_code}"
    )

    # Reception DOES have patient:update on PATCH /api/patients/{id}
    rec_patch = rec_c.patch(
        f"/api/patients/{patient.id}",
        json={"notes": "Reception update note", "version_id": patient.version_id},
    )
    assert rec_patch.status_code == 200, rec_patch.text


# =============================================================================
# 2. DEMOGRAPHIC CORRECTION & HISTORICAL SNAPSHOT ISOLATION
# =============================================================================
def test_phase20_demographic_correction_and_snapshot_isolation(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Verify demographic correction with diff, optimistic locking, snapshot column isolation, and trigger lock."""
    uid = uuid.uuid4().hex[:4]
    num_uid = "".join(c for c in uid if c.isdigit()) or "1234"
    orig_name = f"Rajendra Prasad {uid}"
    orig_mobile = f"98765{num_uid.rjust(5, '0')[:5]}"
    orig_address = f"Ziradei Village {uid}, Siwan"

    patient = _create_gate_patient(
        db_session,
        suffix=f"D{uid}",
        full_name=orig_name,
        mobile=orig_mobile,
        address=orig_address,
    )

    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        appointment_date=datetime.now(UTC).date(),
        token_number=1,
        status="ARRIVED",
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    rec_c: TestClient = login_client(reception_user)
    doc_c: TestClient = login_client(doctor_a_user)
    admin_c: TestClient = login_client(admin_user)

    # 2.1 Issue Payment
    pay_resp = rec_c.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "appointment_id": appt.id,
            "amount_paise": 45000,
            "payment_method": "CASH",
            "notes": "Consultation payment",
        },
    )
    assert pay_resp.status_code == 201, pay_resp.text
    payment_id = pay_resp.json()["id"]

    # 2.2 Create and Finalise Encounter
    enc_resp = doc_c.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "appointment_id": appt.id,
            "symptoms": "Persistent high fever and cough",
            "clinical_notes": "Bilateral chest wheezing",
            "diagnosis": "Acute Bronchitis",
        },
    )
    assert enc_resp.status_code == 201, enc_resp.text
    encounter_id = enc_resp.json()["id"]

    fin_resp = doc_c.post(
        f"/api/encounters/{encounter_id}/finalise",
        json={
            "symptoms": "Persistent high fever and cough",
            "diagnosis": "Acute Bronchitis",
            "clinical_notes": "Bilateral chest wheezing",
            "finalise_notes": "Consultation concluded, prescriptions issued",
        },
    )
    assert fin_resp.status_code == 200, fin_resp.text
    assert fin_resp.json()["is_finalised"] is True

    # 2.3 Issue Prescription
    rx_resp = doc_c.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "encounter_id": encounter_id,
            "diagnosis": "Acute Bronchitis",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Amoxicillin 500mg",
                    "dosage": "500mg",
                    "frequency": "TDS",
                    "duration_days": 5,
                    "instructions": "Post meals",
                }
            ],
        },
    )
    assert rx_resp.status_code == 201, rx_resp.text
    prescription_id = rx_resp.json()["id"]

    # Verify initial snapshots match original patient details
    assert pay_resp.json()["patient_name"] == orig_name
    assert pay_resp.json()["patient_mobile"] == orig_mobile
    assert enc_resp.json()["patient_name"] == orig_name
    assert rx_resp.json()["patient_name"] == orig_name

    # 2.4 Optimistic Locking on Demographic Correction: Stale version yields 409
    stale_payload = {
        "reason": "Court-ordered name correction",
        "version_id": patient.version_id + 999,
        "full_name": "Conflict Name",
        "guardian_name": "Court Guardian",
        "gender": "M",
        "age_years": 42,
        "mobile": "9998887776",
        "address": "Patna High Court Colony",
        "district": "Patna",
        "state": "Bihar",
    }
    stale_resp = admin_c.patch(f"/api/admin/patients/{patient.id}/demographics", json=stale_payload)
    assert stale_resp.status_code == 409, stale_resp.text
    assert stale_resp.json()["code"] == "version_conflict"

    # 2.5 Successful Demographic Correction by Admin
    corr_reason = "Court-ordered name correction"
    corrected_name = f"Rajendra Prasad Corrected {uid}"
    corrected_mobile = "9112233445"
    corrected_address = "Sector 4, New Capital Area, Patna"

    corr_payload = {
        "reason": corr_reason,
        "version_id": patient.version_id,
        "full_name": corrected_name,
        "guardian_name": "Mahadev Prasad Corrected",
        "gender": "M",
        "dob": "1984-01-15",
        "age_years": 42,
        "mobile": corrected_mobile,
        "address": corrected_address,
        "district": "Patna",
        "state": "Bihar",
    }
    corr_resp = admin_c.patch(f"/api/admin/patients/{patient.id}/demographics", json=corr_payload)
    assert corr_resp.status_code == 200, corr_resp.text
    assert corr_resp.json()["full_name"] == corrected_name

    # Verify patient record updated in database
    db_session.expire_all()
    updated_patient = db_session.get(Patient, patient.id)
    assert updated_patient is not None
    assert updated_patient.full_name == corrected_name
    assert updated_patient.mobile == corrected_mobile
    assert updated_patient.address == corrected_address

    # Verify PATIENT_CORRECTED audit log with diff
    audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.entity_id == str(patient.id),
            AuditLog.action == AuditAction.PATIENT_CORRECTED.value,
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit is not None
    assert audit.reason == corr_reason
    assert audit.before_data["full_name"] == orig_name
    assert audit.before_data["mobile"] == orig_mobile
    assert audit.after_data["full_name"] == corrected_name
    assert audit.after_data["mobile"] == corrected_mobile

    # 2.6 Historical Snapshot Isolation: Payment, Prescription, and Encounter retain original snapshot values
    receipt_resp = rec_c.get(f"/api/payments/{payment_id}/receipt")
    assert receipt_resp.status_code == 200
    receipt_data = receipt_resp.json()
    assert receipt_data["patient_name"] == orig_name
    assert receipt_data["patient_mobile"] == orig_mobile
    assert receipt_data["patient_address"] == orig_address

    rx_fetch = doc_c.get(f"/api/prescriptions/{prescription_id}")
    assert rx_fetch.status_code == 200
    rx_data = rx_fetch.json()
    assert rx_data["patient_name"] == orig_name
    assert rx_data["patient_mobile"] == orig_mobile
    assert rx_data["patient_address"] == orig_address

    enc_fetch = doc_c.get(f"/api/encounters/{encounter_id}")
    assert enc_fetch.status_code == 200
    enc_data = enc_fetch.json()
    assert enc_data["patient_name"] == orig_name
    assert enc_data["patient_mobile"] == orig_mobile
    assert enc_data["patient_address"] == orig_address

    # 2.7 Payment tamper prevention trigger blocks direct SQL update on snapshot columns
    with pytest.raises(Exception) as exc_tamper:
        with db_session.begin_nested():
            db_session.execute(
                text("UPDATE payments SET patient_name = 'Hacked Patient Name' WHERE id = :pid"),
                {"pid": payment_id},
            )
    assert "posted payment details cannot be modified" in str(exc_tamper.value).lower()


# =============================================================================
# 3. HOSPITAL ASSET MANAGEMENT
# =============================================================================
def test_phase20_hospital_asset_management(
    client: TestClient,
    login_client: Any,
    admin_user: User,
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Verify asset upload, unauthenticated active-logo retrieval, deactivation, integrity check, and backup bundling."""
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(test_settings, "assets_dir", assets_dir)

    backup_dest = tmp_path / "backups"
    backup_dest.mkdir(parents=True, exist_ok=True)

    admin_c: TestClient = login_client(admin_user)

    # 3.1 Upload PNG logo crest
    upload_resp = admin_c.post(
        "/api/admin/assets",
        data={"asset_type": "LOGO"},
        files={"file": ("gate_crest.png", VALID_PNG, "image/png")},
    )
    assert upload_resp.status_code == 200, upload_resp.text
    asset_data = upload_resp.json()
    asset_id = asset_data["id"]
    filename = asset_data["filename"]
    assert asset_data["asset_type"] == "LOGO"
    assert asset_data["is_active"] is True
    assert (assets_dir / filename).is_file()

    # Verify ASSET_UPLOADED audit log
    audit_asset = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == AuditAction.ASSET_UPLOADED.value,
            AuditLog.entity_id == str(asset_id),
        )
    )
    assert audit_asset is not None
    assert audit_asset.after_data["asset_type"] == "LOGO"
    assert audit_asset.after_data["filename"] == filename

    # 3.2 Unauthenticated GET /api/assets/active-logo returns valid image bytes
    logo_resp = client.get("/api/assets/active-logo")
    assert logo_resp.status_code == 200
    assert "image/png" in logo_resp.headers["content-type"]
    assert logo_resp.content == VALID_PNG

    # 3.3 Deactivate asset: is_active=False, file remains on disk and row remains in DB
    deact_resp = admin_c.post(f"/api/admin/assets/{asset_id}/deactivate")
    assert deact_resp.status_code == 200
    assert deact_resp.json()["is_active"] is False

    # Physical file MUST remain on disk
    assert (assets_dir / filename).is_file()

    # DB record preserved
    db_session.expire_all()
    asset_db = db_session.get(HospitalAsset, asset_id)
    assert asset_db is not None
    assert asset_db.is_active is False

    # 3.4 Storage Integrity Check: clean report
    report = check_asset_storage_integrity(db_session, test_settings)
    assert report.passed is True, f"Integrity check failed: {report.discrepancies}"
    assert len(report.discrepancies) == 0

    # 3.5 Backup Bundle includes assets/ and assets_manifest
    archive_path = create_backup(
        destination_dir=backup_dest,
        label="gate_backup_assets",
        settings=test_settings,
    )
    assert archive_path.is_file()

    is_valid, msg, manifest = verify_backup_bundle(archive_path)
    assert is_valid is True, msg
    assert manifest is not None
    assert manifest.get("assets_count", 0) >= 1
    assert len(manifest.get("assets_manifest", [])) >= 1
    manifest_filenames = [e["filename"] for e in manifest["assets_manifest"]]
    assert filename in manifest_filenames

    # Check tar archive members
    with tarfile.open(archive_path, "r:gz") as tar:
        names = tar.getnames()
        assert any(n.startswith("assets/") for n in names)
        assert f"assets/{filename}" in names


# =============================================================================
# 4. PRINT TEMPLATES
# =============================================================================
def test_phase20_print_templates_and_locking(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """Verify print templates listing, patching with Hindi/English, optimistic locking (409), and audit logging."""
    admin_c: TestClient = login_client(admin_user)

    # 4.1 Fetch print templates
    list_resp = admin_c.get("/api/admin/templates")
    assert list_resp.status_code == 200
    templates = list_resp.json()
    assert len(templates) == 4
    doc_types = [t["document_type"] for t in templates]
    assert PrintDocumentType.PRESCRIPTION.value in doc_types

    # 4.2 Fetch prescription template
    rx_tmpl = admin_c.get("/api/admin/templates/prescription").json()
    curr_version = rx_tmpl["version"]

    # 4.3 Patch template with Hindi and English headers and footers
    header_en = "Kalyan Memorial Hospital - Department of Orthopaedics"
    header_hi = "कल्याण मेमोरियल अस्पताल - अस्थि रोग विभाग"
    footer_en = "Emergency 24x7: 108 / +91 6182 220000 | NABH Accredited"
    footer_hi = "आपातकालीन २४x७: १०८ / +९१ ६१८२ २२०००० | एनएबीएच प्रमाणित"

    patch_payload = {
        "header_en": header_en,
        "header_hi": header_hi,
        "footer_en": footer_en,
        "footer_hi": footer_hi,
        "version": curr_version,
    }
    patch_resp = admin_c.patch("/api/admin/templates/prescription", json=patch_payload)
    assert patch_resp.status_code == 200, patch_resp.text
    patched_data = patch_resp.json()
    assert patched_data["version"] == curr_version + 1
    assert patched_data["header_en"] == header_en
    assert patched_data["header_hi"] == header_hi

    # Verify PRINT_TEMPLATE_UPDATED audit log
    audit_tmpl = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == AuditAction.PRINT_TEMPLATE_UPDATED.value,
            AuditLog.entity_id == "prescription",
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit_tmpl is not None
    assert audit_tmpl.after_data["header_en"] == header_en
    assert audit_tmpl.after_data["header_hi"] == header_hi

    # 4.4 Stale version yields HTTP 409 version_conflict
    conflict_resp = admin_c.patch("/api/admin/templates/prescription", json=patch_payload)
    assert conflict_resp.status_code == 409, conflict_resp.text
    assert conflict_resp.json()["code"] == "version_conflict"


# =============================================================================
# 5. PATIENT IMPORT PIPELINE
# =============================================================================
def test_phase20_patient_import_pipeline(
    login_client: Any,
    admin_user: User,
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Verify 8-stage import pipeline: staging, duplicate resolution as SKIP, backup, gap-free URNs, error CSV, audit."""
    uid = uuid.uuid4().hex[:4]
    admin_c: TestClient = login_client(admin_user)

    # Ensure backup directory is configured
    backup_dest = tmp_path / "import_backups"
    backup_dest.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(test_settings, "backup_dir", backup_dest)

    # Seed an existing patient to trigger duplicate detection on mobile + address
    num_suffix = "".join(c for c in uid if c.isdigit()) or "5432"
    dup_mobile = f"98765{num_suffix.rjust(5, '0')[:5]}"
    dup_address = f"Existing Village {uid} Bhojpur"
    existing_patient = _create_gate_patient(
        db_session,
        suffix=f"IMP{uid}",
        full_name=f"Existing Patient {uid}",
        mobile=dup_mobile,
        address=dup_address,
    )

    # 3-Row Synthetic CSV:
    # Row 1: Valid
    # Row 2: Duplicate candidate (mobile and address match existing_patient)
    # Row 3: Invalid (missing required guardian_name)
    csv_rows = (
        "Name,Guardian,Gender,Age,Mobile,Address,LegacyURN\n"
        f'Valid Imported Patient,Father Name,M,32,9876501199,"New Sector Road Ara",OLD-IMP-V1\n'
        f'Duplicate Candidate Patient,Guardian Name,M,40,{dup_mobile},"{dup_address}",OLD-IMP-DUP\n'
        f'Invalid Patient Missing Guardian,,F,28,9876502299,"Village Bad Row Ara",OLD-IMP-INV\n'
    ).encode("utf-8")

    # 5.1 Inspect
    inspect_resp = admin_c.post(
        "/api/admin/imports/inspect",
        files={"file": ("gate_import.csv", csv_rows, "text/csv")},
    )
    assert inspect_resp.status_code == 200, inspect_resp.text
    inspect_data = inspect_resp.json()
    assert inspect_data["total_rows"] == 3
    assert "Name" in inspect_data["headers"]

    # 5.2 Stage Batch
    mapping = {
        "Name": "full_name",
        "Guardian": "guardian_name",
        "Gender": "gender",
        "Age": "age_years",
        "Mobile": "mobile",
        "Address": "address",
        "LegacyURN": "legacy_urn",
    }
    stage_resp = admin_c.post(
        "/api/admin/imports",
        files={"file": ("gate_import.csv", csv_rows, "text/csv")},
        data={"column_mapping": json.dumps(mapping)},
    )
    assert stage_resp.status_code == 201, stage_resp.text
    batch_data = stage_resp.json()
    batch_id = batch_data["batch_id"]
    assert batch_data["total_rows"] == 3
    assert batch_data["status"] == "STAGED"

    # Verify PATIENT_IMPORT_STAGED audit event
    audit_staged = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == AuditAction.PATIENT_IMPORT_STAGED.value,
            AuditLog.entity_id == batch_id,
        )
    )
    assert audit_staged is not None
    assert audit_staged.after_data["total_rows"] == 3

    # 5.3 Validate Batch
    val_resp = admin_c.post(f"/api/admin/imports/{batch_id}/validate")
    assert val_resp.status_code == 200, val_resp.text
    val_data = val_resp.json()
    assert val_data["total_rows"] == 3
    assert val_data["valid_rows"] == 1
    assert val_data["duplicate_rows"] == 1
    assert val_data["invalid_rows"] == 1

    # 5.4 Verify duplicate candidate and resolve as SKIP
    dups_resp = admin_c.get(f"/api/admin/imports/{batch_id}/duplicates")
    assert dups_resp.status_code == 200
    dups = dups_resp.json()["duplicates"]
    assert len(dups) == 1
    assert dups[0]["duplicate_patient"]["id"] == existing_patient.id
    dup_row_id = dups[0]["row_id"]

    # Explicitly confirm resolution as SKIP
    resolve_resp = admin_c.post(
        f"/api/admin/imports/{batch_id}/resolve",
        json={"resolutions": [{"row_id": dup_row_id, "resolution": "SKIP"}]},
    )
    assert resolve_resp.status_code == 200

    # 5.5 Commit Batch: pre-commit safety backup, gap-free URN allocation, exactly 1 patient committed
    fake_archive = backup_dest / f"kalyan_backup_gate_preimport_{uid}.tar.gz"
    fake_archive.write_bytes(b"dummy_tar_archive")
    with patch("kalyan_api.services.backup_service.create_backup") as mock_backup:
        mock_backup.return_value = fake_archive
        commit_resp = admin_c.post(f"/api/admin/imports/{batch_id}/commit")
        assert commit_resp.status_code == 200, commit_resp.text
        commit_data = commit_resp.json()

    assert commit_data["status"] == "COMMITTED"
    assert commit_data["committed_rows"] == 1
    start_urn = commit_data["urn_range_start"]
    end_urn = commit_data["urn_range_end"]
    assert start_urn is not None
    assert start_urn == end_urn, "No URN gaps: exactly 1 URN assigned when 1 row is committed"
    assert start_urn.startswith("KH-")

    # Verify newly committed patient in database
    committed_patient = db_session.scalar(
        select(Patient).where(Patient.mobile == "9876501199")
    )
    assert committed_patient is not None
    assert committed_patient.urn == start_urn
    assert committed_patient.legacy_urn == "OLD-IMP-V1"
    assert committed_patient.full_name == "Valid Imported Patient"

    # Verify pre-commit safety backup gate was executed
    assert mock_backup.called
    db_batch = db_session.scalar(
        select(PatientImportBatch).where(PatientImportBatch.batch_id == batch_id)
    )
    assert db_batch is not None
    assert db_batch.safety_backup_file == fake_archive.name

    # Verify PATIENT_IMPORT_COMMITTED audit log
    audit_committed = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == AuditAction.PATIENT_IMPORT_COMMITTED.value,
            AuditLog.entity_id == batch_id,
        )
    )
    assert audit_committed is not None
    assert audit_committed.after_data["committed_count"] == 1

    # 5.6 Download error CSV: contains the 2 skipped/invalid rows with failure reasons
    err_resp = admin_c.get(f"/api/admin/imports/{batch_id}/errors")
    assert err_resp.status_code == 200
    assert "text/csv" in err_resp.headers["content-type"]
    err_text = err_resp.text
    assert "Row Number" in err_text
    assert "Error Details / Reason" in err_text
    assert "Duplicate Candidate Patient" in err_text
    assert "Invalid Patient Missing Guardian" in err_text
    assert "guardian_name" in err_text or "Required" in err_text


# =============================================================================
# 6. PATIENT EXPORT STREAMING
# =============================================================================
def test_phase20_patient_export_streaming(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """Verify formula injection neutralization ('=1+2) in streaming patient export and audit logging."""
    uid = uuid.uuid4().hex[:4]
    num_uid = "".join(c for c in uid if c.isdigit()) or "5678"
    formula_address = "=1+2 SpreadSheet Formula Injection Test"

    patient = _create_gate_patient(
        db_session,
        suffix=f"EX{uid}",
        full_name=f"Formula Safe Patient {uid}",
        mobile=f"98765{num_uid.rjust(5, '0')[:5]}",
        address=formula_address,
    )

    admin_c: TestClient = login_client(admin_user)

    export_reason = "Statutory data governance and compliance audit export"
    export_payload = {
        "reason": export_reason,
        "format": "csv",
        "scope": {"search_query": patient.full_name},
        "fields": ["full_name", "mobile", "address", "urn"],
    }

    resp = admin_c.post("/api/admin/exports", json=export_payload)
    assert resp.status_code == 200, resp.text
    assert "text/csv" in resp.headers["content-type"]
    assert 'filename="patients_export_' in resp.headers["content-disposition"]

    csv_body = resp.text
    assert patient.full_name in csv_body
    # STRIDE T-20-16: Formula cell prefixed with single quote
    assert f"'{formula_address}" in csv_body

    # Verify PATIENT_EXPORTED audit event
    audit_export = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == AuditAction.PATIENT_EXPORTED.value,
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit_export is not None
    assert audit_export.reason == export_reason
    assert audit_export.after_data["row_count"] >= 1
    assert "address" in audit_export.after_data["fields"]
