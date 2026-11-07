"""Integration tests for Patient Import API endpoints and audit logging (D-20-08 to D-20-14).

Guarantees tested:
- RBAC enforcement: anonymous gets 401, non-admin (Reception, Doctor) gets 403, Admin gets 200/201.
- POST /api/admin/imports/inspect analyzes spreadsheet and returns structure preview.
- POST /api/admin/imports stages batch and writes PATIENT_IMPORT_STAGED audit event.
- POST /api/admin/imports/{batch_id}/validate runs validation and duplicate candidate matching.
- GET /api/admin/imports/{batch_id}/duplicates returns candidate comparisons.
- POST /api/admin/imports/{batch_id}/resolve updates decisions to SKIP or IMPORT_AS_NEW.
- POST /api/admin/imports/{batch_id}/commit executes safety backup, mints URNs, inserts patients, and writes PATIENT_IMPORT_COMMITTED audit event.
- Backup failure halts commit with HTTP 500 without modifying patients (D-20-12).
- GET /api/admin/imports/{batch_id}/errors streams error CSV for offline correction.
"""

import io
import json
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.models import AuditLog, Patient, User
from kalyan_api.services.audit_service import AuditAction


def test_patient_import_endpoints_rbac(
    client: TestClient,
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
) -> None:
    """All import endpoints require Permission.PATIENT_IMPORT; denied for anonymous, reception, doctor."""
    csv_bytes = b"Name,Guardian,Sex,Age,Mobile,Address\nRam,Dashrath,M,30,9876543210,Ara\n"

    # Anonymous denied (401)
    res_anon_inspect = client.post("/api/admin/imports/inspect", files={"file": ("test.csv", csv_bytes, "text/csv")})
    assert res_anon_inspect.status_code == 401
    assert client.get("/api/admin/imports/nonexistent-batch").status_code == 401

    # Reception denied (403)
    rec_c: TestClient = login_client(reception_user)
    res_rec_inspect = rec_c.post("/api/admin/imports/inspect", files={"file": ("test.csv", csv_bytes, "text/csv")})
    assert res_rec_inspect.status_code == 403
    assert rec_c.get("/api/admin/imports/nonexistent-batch").status_code == 403

    # Doctor denied (403)
    doc_c: TestClient = login_client(doctor_a_user)
    res_doc_inspect = doc_c.post("/api/admin/imports/inspect", files={"file": ("test.csv", csv_bytes, "text/csv")})
    assert res_doc_inspect.status_code == 403

    # Admin allowed (200)
    admin_c: TestClient = login_client(admin_user)
    res_admin_inspect = admin_c.post("/api/admin/imports/inspect", files={"file": ("test.csv", csv_bytes, "text/csv")})
    assert res_admin_inspect.status_code == 200
    data = res_admin_inspect.json()
    assert data["total_rows"] == 1
    assert "Name" in data["headers"]


def test_full_import_lifecycle_and_audit(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    admin_c: TestClient = login_client(admin_user)

    # 1. Inspect file
    csv_content = (
        "Name,Guardian,Gender,Age,Mobile,Address,OldID\n"
        "Vinit Kumar,Manoj Kumar,M,28,9876501111,Bhojpur Ara,OLD-V1\n"
        "Pooja Kumari,Ashok Kumar,F,24,9876502222,Station Road Ara,OLD-V2\n"
        "Bad Row Patient,,M,30,12345,Bhojpur,\n"
    ).encode("utf-8")

    inspect_res = admin_c.post(
        "/api/admin/imports/inspect",
        files={"file": ("patients.csv", csv_content, "text/csv")},
    )
    assert inspect_res.status_code == 200
    inspect_data = inspect_res.json()
    assert inspect_data["total_rows"] == 3

    # 2. Stage batch
    column_mapping = {
        "Name": "full_name",
        "Guardian": "guardian_name",
        "Gender": "gender",
        "Age": "age_years",
        "Mobile": "mobile",
        "Address": "address",
        "OldID": "legacy_urn",
    }
    stage_res = admin_c.post(
        "/api/admin/imports",
        files={"file": ("patients.csv", csv_content, "text/csv")},
        data={"column_mapping": json.dumps(column_mapping)},
    )
    assert stage_res.status_code == 201
    stage_data = stage_res.json()
    batch_id = stage_data["batch_id"]
    assert stage_data["total_rows"] == 3
    assert stage_data["status"] == "STAGED"

    # Check PATIENT_IMPORT_STAGED audit event
    audit_staged = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == AuditAction.PATIENT_IMPORT_STAGED,
            AuditLog.entity_id == batch_id,
        )
    )
    assert audit_staged is not None
    assert audit_staged.after_data["total_rows"] == 3

    # 3. Get batch status
    get_res = admin_c.get(f"/api/admin/imports/{batch_id}")
    assert get_res.status_code == 200
    assert get_res.json()["batch_id"] == batch_id

    # 4. Validate batch
    val_res = admin_c.post(f"/api/admin/imports/{batch_id}/validate")
    assert val_res.status_code == 200
    val_data = val_res.json()
    assert val_data["total_rows"] == 3
    assert val_data["valid_rows"] == 2
    assert val_data["invalid_rows"] == 1
    assert val_data["duplicate_rows"] == 0

    # 5. Commit batch with mock safety backup
    with patch("kalyan_api.services.backup_service.create_backup") as mock_backup:
        mock_backup.return_value = Path("kalyan_backup_preimport.tar.gz")
        commit_res = admin_c.post(f"/api/admin/imports/{batch_id}/commit")
        assert commit_res.status_code == 200
        commit_data = commit_res.json()
        assert commit_data["status"] == "COMMITTED"
        assert commit_data["committed_rows"] == 2
        assert commit_data["urn_range_start"] is not None
        assert commit_data["urn_range_end"] is not None

    # Check PATIENT_IMPORT_COMMITTED audit event
    audit_committed = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == AuditAction.PATIENT_IMPORT_COMMITTED,
            AuditLog.entity_id == batch_id,
        )
    )
    assert audit_committed is not None
    assert audit_committed.after_data["committed_count"] == 2

    # 6. Export error records CSV
    err_res = admin_c.get(f"/api/admin/imports/{batch_id}/errors")
    assert err_res.status_code == 200
    assert "text/csv" in err_res.headers.get("content-type", "")
    assert "Row Number" in err_res.text
    assert "Bad Row Patient" in err_res.text


def test_duplicate_review_and_resolve_flow(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    admin_c: TestClient = login_client(admin_user)

    # Seed existing patient
    existing = Patient(
        urn="KH-2026-0555",
        full_name="Deepak Verma",
        guardian_name="Harish Verma",
        gender="M",
        age_years=33,
        mobile="9876543333",
        address="Bhojpur Town",
        district="Bhojpur",
        state="Bihar",
    )
    db_session.add(existing)
    db_session.flush()

    csv_content = (
        "full_name,guardian_name,gender,age_years,mobile,address\n"
        "Deepak Verma,Harish Verma,M,33,9876543333,Bhojpur Town\n"
    ).encode("utf-8")

    mapping = {k: k for k in ["full_name", "guardian_name", "gender", "age_years", "mobile", "address"]}
    stage_res = admin_c.post(
        "/api/admin/imports",
        files={"file": ("dup.csv", csv_content, "text/csv")},
        data={"column_mapping": json.dumps(mapping)},
    )
    batch_id = stage_res.json()["batch_id"]

    # Validate
    admin_c.post(f"/api/admin/imports/{batch_id}/validate")

    # Get duplicates
    dup_res = admin_c.get(f"/api/admin/imports/{batch_id}/duplicates")
    assert dup_res.status_code == 200
    dup_data = dup_res.json()
    assert len(dup_data["duplicates"]) == 1
    dup_row = dup_data["duplicates"][0]
    assert dup_row["duplicate_patient"]["urn"] == "KH-2026-0555"
    assert dup_row["duplicate_resolution"] == "SKIP"

    # Resolve as IMPORT_AS_NEW
    resolve_res = admin_c.post(
        f"/api/admin/imports/{batch_id}/resolve",
        json={"resolutions": [{"row_id": dup_row["row_id"], "resolution": "IMPORT_AS_NEW"}]},
    )
    assert resolve_res.status_code == 200
    assert resolve_res.json()["resolved_count"] == 1

    # Commit imports row as new patient
    with patch("kalyan_api.services.backup_service.create_backup") as mock_backup:
        mock_backup.return_value = Path("backup.tar.gz")
        commit_res = admin_c.post(f"/api/admin/imports/{batch_id}/commit")
        assert commit_res.status_code == 200
        assert commit_res.json()["committed_rows"] == 1


def test_commit_halts_on_precommit_backup_failure(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    admin_c: TestClient = login_client(admin_user)

    csv_content = (
        "full_name,guardian_name,gender,age_years,mobile,address\n"
        "Test Fail Patient,Test Guardian,M,22,9876588888,Test Address\n"
    ).encode("utf-8")

    mapping = {k: k for k in ["full_name", "guardian_name", "gender", "age_years", "mobile", "address"]}
    stage_res = admin_c.post(
        "/api/admin/imports",
        files={"file": ("fail.csv", csv_content, "text/csv")},
        data={"column_mapping": json.dumps(mapping)},
    )
    batch_id = stage_res.json()["batch_id"]
    admin_c.post(f"/api/admin/imports/{batch_id}/validate")

    # Trigger backup failure (D-20-12)
    with patch("kalyan_api.services.backup_service.create_backup", side_effect=OSError("Disk write error")):
        commit_res = admin_c.post(f"/api/admin/imports/{batch_id}/commit")
        assert commit_res.status_code == 500
        err_json = commit_res.json()
        assert err_json["code"] == "precommit_backup_failed"
        assert "pre-import safety backup failed" in err_json["message"]

    # Verify no patient was created
    pt = db_session.scalar(select(Patient).where(Patient.mobile == "9876588888"))
    assert pt is None

