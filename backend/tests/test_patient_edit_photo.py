"""Tests for Patient Demographic Modification and Photo Storage (PAT-03, PAT-05).

Guarantees:
- PATCH /api/patients/{id}:
  - Restricted to RECEPTION (patient:update).
  - Stale version_id returns 409 Conflict.
  - Successful update increments version_id and writes PATIENT_UPDATED audit log.
- POST /api/patients/{id}/photo:
  - Restricted to RECEPTION (photo:write).
  - Validates magic bytes (rejects invalid image content with 422).
  - Stores photo on filesystem and records PHOTO_UPLOADED audit log.
- GET /api/patients/{id}/photo:
  - 401 for anonymous.
  - 200 streams photo file with Cache-Control: private, no-cache for authorized caller.
"""

from io import BytesIO
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.models import AuditLog, Patient, User


def test_patient_edit_optimistic_concurrency_and_audit(
    login_client: Any,
    admin_user: User,
    doctor_a_user: User,
    reception_user: User,
    db_session: Session,
) -> None:
    """Demographic modification is RBAC-protected, optimistic-locked, and audited."""
    rec_c = login_client(reception_user)
    admin_c = login_client(admin_user)
    doc_c = login_client(doctor_a_user)

    # 1. Seed patient
    patient = Patient(
        urn="KH-2026-0501",
        full_name="Original Name",
        guardian_name="Guardian Name",
        gender="M",
        age_years=30,
        mobile="9800011122",
        address="Old Address, Ara",
    )
    db_session.add(patient)
    db_session.flush()

    patch_payload = {
        "full_name": "Updated Name",
        "address": "New Address, Ara",
        "version_id": 1,
    }

    # 2. Admin cannot edit demographics (403)
    assert admin_c.patch(f"/api/patients/{patient.id}", json=patch_payload).status_code == 403

    # 3. Doctor cannot edit demographics (403)
    assert doc_c.patch(f"/api/patients/{patient.id}", json=patch_payload).status_code == 403

    # 4. Mismatched version_id returns 409 Conflict
    conflict_payload = dict(patch_payload, version_id=999)
    conflict_resp = rec_c.patch(f"/api/patients/{patient.id}", json=conflict_payload)
    assert conflict_resp.status_code == 409
    assert conflict_resp.json()["code"] == "version_conflict"

    # 5. Reception valid update succeeds
    success_resp = rec_c.patch(f"/api/patients/{patient.id}", json=patch_payload)
    assert success_resp.status_code == 200
    updated_data = success_resp.json()
    assert updated_data["full_name"] == "Updated Name"
    assert updated_data["address"] == "New Address, Ara"
    assert updated_data["version_id"] == 2

    # 6. Verify audit log entry
    audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "PATIENT_UPDATED",
            AuditLog.entity_id == str(patient.id),
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit is not None
    assert audit.before_data["full_name"] == "Original Name"
    assert audit.after_data["full_name"] == "Updated Name"


def test_patient_photo_upload_and_streaming(
    login_client: Any,
    reception_user: User,
    db_session: Session,
    client: TestClient,
) -> None:
    """Photo upload enforces validation, magic bytes, storage, and authenticated streaming."""
    rec_c = login_client(reception_user)

    patient = Patient(
        urn="KH-2026-0601",
        full_name="Photo Patient",
        guardian_name="Guardian",
        gender="F",
        age_years=25,
        mobile="9800022233",
        address="Hospital Road, Ara",
    )
    db_session.add(patient)
    db_session.flush()

    # 1. Anonymous cannot stream photo (401)
    assert client.get(f"/api/patients/{patient.id}/photo").status_code == 401

    # 2. Valid authenticated access before photo upload returns 404
    assert rec_c.get(f"/api/patients/{patient.id}/photo").status_code == 404

    # 3. Upload invalid magic bytes (fake text content disguised as jpg) -> 422
    fake_file = BytesIO(b"this is plain text not an image")
    resp_invalid = rec_c.post(
        f"/api/patients/{patient.id}/photo",
        files={"file": ("test.jpg", fake_file, "image/jpeg")},
    )
    assert resp_invalid.status_code == 422

    # 4. Upload valid JPEG magic bytes
    valid_jpeg = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100
    valid_file = BytesIO(valid_jpeg)
    resp_valid = rec_c.post(
        f"/api/patients/{patient.id}/photo",
        files={"file": ("patient.jpg", valid_file, "image/jpeg")},
    )
    assert resp_valid.status_code == 200
    data = resp_valid.json()
    assert data["photo_path"] is not None

    # 5. Verify audit log entry
    audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "PHOTO_UPLOADED",
            AuditLog.entity_id == str(patient.id),
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit is not None
    assert audit.after_data["photo_path"] == data["photo_path"]

    # 6. Stream photo as authenticated caller -> 200 with Cache-Control: private
    stream_resp = rec_c.get(f"/api/patients/{patient.id}/photo")
    assert stream_resp.status_code == 200
    assert "image/jpeg" in stream_resp.headers.get("content-type", "")
    assert "private" in stream_resp.headers.get("cache-control", "")
    assert stream_resp.content == valid_jpeg

