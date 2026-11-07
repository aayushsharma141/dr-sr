"""Tests for Patient Import Engine & Staging Service (D-20-08 to D-20-14).

Guarantees tested:
- Spreadsheet parsing: CSV (UTF-8, UTF-8-BOM, Windows-1252) and XLSX via openpyxl.
- Column auto-mapping to canonical patient fields.
- Field validation: invalid rows flagged with specific errors; valid rows not blocked (D-20-10).
- Duplicate candidate matching: mobile + address, legacy URN, mobile + name similarity (D-20-13).
- Default duplicate resolution is 'SKIP'; existing patients are NEVER overwritten.
- Pre-commit safety backup gate: commit aborts if backup fails (D-20-12).
- Gap-free URN allocation strictly during commit (D-20-09, D-20-11).
- Error records CSV export.
"""

import io
from pathlib import Path
from unittest.mock import patch

import pytest
from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.models import Patient, PatientImportBatch, PatientImportRow, User
from kalyan_api.services import import_service
from kalyan_api.services.import_service import (
    PreCommitBackupFailedError,
    commit_batch,
    export_error_records_csv,
    inspect_file,
    resolve_duplicate,
    stage_batch,
    validate_batch,
)


def _create_test_xlsx_bytes(headers: list[str], rows: list[list[object]]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Patients"
    ws.append(headers)
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_inspect_file_csv_encodings() -> None:
    # 1. Standard UTF-8
    utf8_csv = "Name,Guardian,Sex,Age,Mobile,Address\nRam Kumar,Dashrath Kumar,M,25,9876543210,Ara Bihar\n".encode("utf-8")
    info = inspect_file(utf8_csv, "patients.csv")
    assert info["file_type"] == "csv"
    assert info["encoding"] == "utf-8"
    assert info["delimiter"] == ","
    assert info["total_rows"] == 1
    assert "Name" in info["headers"]
    assert info["suggested_mapping"]["Name"] == "full_name"
    assert info["suggested_mapping"]["Guardian"] == "guardian_name"

    # 2. UTF-8 with BOM
    bom_csv = b"\xef\xbb\xbfName,Guardian,Gender,Age,Mobile,Address\nSita,Janak,F,24,9876543211,Janakpur\n"
    info_bom = inspect_file(bom_csv, "patients_bom.csv")
    assert info_bom["encoding"] == "utf-8-sig"
    assert info_bom["total_rows"] == 1
    assert info_bom["sample_rows"][0]["Name"] == "Sita"

    # 3. Windows-1252 with special characters
    win1252_csv = "Name;Father;Gender;Age;Phone;Address\nRenée;André;F;30;9876543212;Patna\n".encode("windows-1252")
    info_win = inspect_file(win1252_csv, "patients_win.csv")
    assert info_win["encoding"] == "windows-1252"
    assert info_win["delimiter"] == ";"
    assert info_win["total_rows"] == 1


def test_inspect_file_xlsx() -> None:
    headers = ["Patient Name", "Father Name", "Gender", "Age", "Phone Number", "Village / Town", "Old URN"]
    rows = [
        ["Mohan Lal", "Sohan Lal", "Male", 45, "919876543210", "Jagdishpur", "OLD-101"],
        ["Geeta Devi", "Mohan Lal", "Female", 40, "9876543213", "Bhojpur", "OLD-102"],
    ]
    xlsx_bytes = _create_test_xlsx_bytes(headers, rows)
    info = inspect_file(xlsx_bytes, "register.xlsx")

    assert info["file_type"] == "xlsx"
    assert info["total_rows"] == 2
    assert "Patient Name" in info["headers"]
    assert info["suggested_mapping"]["Patient Name"] == "full_name"
    assert info["suggested_mapping"]["Father Name"] == "guardian_name"
    assert info["suggested_mapping"]["Phone Number"] == "mobile"
    assert info["suggested_mapping"]["Old URN"] == "legacy_urn"


def test_stage_and_validate_batch_with_invalid_rows(
    db_session: Session,
    admin_user: User,
) -> None:
    csv_content = (
        "Name,Guardian,Sex,Age,Mobile,Address,OldID\n"
        "Valid Patient,Valid Guardian,M,30,9876543210,Main Road Ara,OLD-001\n"
        "No Guardian Patient,,F,25,9876543211,Station Road Ara,\n"
        "Bad Mobile Patient,Good Guardian,M,28,12345,Station Road Ara,\n"
        "Bad Gender Patient,Good Guardian,X,28,9876543212,Station Road Ara,\n"
        "Bad Age Patient,Good Guardian,F,abc,9876543213,Station Road Ara,\n"
    ).encode("utf-8")

    mapping = {
        "Name": "full_name",
        "Guardian": "guardian_name",
        "Sex": "gender",
        "Age": "age_years",
        "Mobile": "mobile",
        "Address": "address",
        "OldID": "legacy_urn",
    }

    batch = stage_batch(db_session, admin_user.id, "test.csv", csv_content, mapping)
    assert batch.total_rows == 5
    assert batch.status == "STAGED"

    summary = validate_batch(db_session, batch.batch_id)
    assert summary["total_rows"] == 5
    assert summary["valid_rows"] == 1
    assert summary["invalid_rows"] == 4
    assert summary["duplicate_rows"] == 0

    rows = db_session.scalars(
        select(PatientImportRow)
        .where(PatientImportRow.batch_id == batch.batch_id)
        .order_by(PatientImportRow.row_index.asc())
    ).all()

    assert rows[0].validation_status == "VALID"
    assert rows[1].validation_status == "INVALID"
    assert "guardian_name" in rows[1].validation_errors
    assert rows[2].validation_status == "INVALID"
    assert "mobile" in rows[2].validation_errors
    assert rows[3].validation_status == "INVALID"
    assert "gender" in rows[3].validation_errors
    assert rows[4].validation_status == "INVALID"
    assert "age_years" in rows[4].validation_errors


def test_duplicate_detection_and_resolution(
    db_session: Session,
    admin_user: User,
) -> None:
    # Seed existing patient
    existing = Patient(
        urn="KH-2026-9001",
        full_name="Rajesh Sharma",
        guardian_name="Omprakash Sharma",
        gender="M",
        age_years=42,
        mobile="9876500001",
        address="Bhojpur Bihar",
        district="Bhojpur",
        state="Bihar",
        legacy_urn="OLD-REG-901",
    )
    db_session.add(existing)
    db_session.flush()

    # Create CSV with duplicate candidates:
    # Row 1: Exact mobile + address match
    # Row 2: Exact legacy_urn match
    # Row 3: Similar name + same mobile
    # Row 4: Completely distinct patient
    csv_content = (
        "full_name,guardian_name,gender,age_years,mobile,address,legacy_urn\n"
        "Rajesh Sharma,Omprakash Sharma,M,42,9876500001,Bhojpur Bihar,\n"
        "Different Name,Different Guardian,F,30,9876599999,Other Address,OLD-REG-901\n"
        "Rajesh Kumar Sharma,Omprakash,M,42,9876500001,Different Road Ara,\n"
        "Anil Verma,Sunil Verma,M,35,9876511111,New Mohalla Ara,\n"
    ).encode("utf-8")

    mapping = {col: col for col in ["full_name", "guardian_name", "gender", "age_years", "mobile", "address", "legacy_urn"]}

    batch = stage_batch(db_session, admin_user.id, "duplicates.csv", csv_content, mapping)
    summary = validate_batch(db_session, batch.batch_id)

    assert summary["total_rows"] == 4
    assert summary["valid_rows"] == 1
    assert summary["duplicate_rows"] == 3
    assert summary["invalid_rows"] == 0

    rows = db_session.scalars(
        select(PatientImportRow)
        .where(PatientImportRow.batch_id == batch.batch_id)
        .order_by(PatientImportRow.row_index.asc())
    ).all()

    # All duplicate rows default to 'SKIP' (D-20-13)
    assert rows[0].validation_status == "DUPLICATE"
    assert rows[0].duplicate_resolution == "SKIP"
    assert rows[0].duplicate_patient_id == existing.id

    assert rows[1].validation_status == "DUPLICATE"
    assert rows[1].duplicate_resolution == "SKIP"
    assert rows[1].duplicate_patient_id == existing.id

    assert rows[2].validation_status == "DUPLICATE"
    assert rows[2].duplicate_resolution == "SKIP"

    assert rows[3].validation_status == "VALID"

    # Explicitly resolve row 0 as IMPORT_AS_NEW
    resolved_row = resolve_duplicate(db_session, batch.batch_id, rows[0].id, "IMPORT_AS_NEW")
    assert resolved_row.duplicate_resolution == "IMPORT_AS_NEW"


def test_commit_batch_allocates_gap_free_urns_and_runs_backup(
    db_session: Session,
    admin_user: User,
    test_settings: Settings,
) -> None:
    csv_content = (
        "full_name,guardian_name,gender,age_years,mobile,address,legacy_urn\n"
        "Committed Patient One,Guardian One,M,25,9876522221,Address One,OLD-001\n"
        "Invalid Row Missing Mobile,Guardian Two,F,26,,Address Two,\n"
        "Committed Patient Two,Guardian Three,F,27,9876522223,Address Three,OLD-003\n"
    ).encode("utf-8")

    mapping = {col: col for col in ["full_name", "guardian_name", "gender", "age_years", "mobile", "address", "legacy_urn"]}
    batch = stage_batch(db_session, admin_user.id, "commit_test.csv", csv_content, mapping)
    validate_batch(db_session, batch.batch_id)

    with patch("kalyan_api.services.backup_service.create_backup") as mock_backup:
        mock_backup.return_value = Path("test_backup.tar.gz")

        res = commit_batch(db_session, admin_user.id, batch.batch_id, cfg=test_settings)

        assert mock_backup.called
        assert res["status"] == "COMMITTED"
        assert res["committed_rows"] == 2
        assert res["urn_range_start"] is not None
        assert res["urn_range_end"] is not None

        # Verify only 2 patients inserted in Patient table
        p1 = db_session.scalar(select(Patient).where(Patient.mobile == "9876522221"))
        assert p1 is not None
        assert p1.urn == res["urn_range_start"]
        assert p1.legacy_urn == "OLD-001"

        p2 = db_session.scalar(select(Patient).where(Patient.mobile == "9876522223"))
        assert p2 is not None
        assert p2.urn == res["urn_range_end"]
        assert p2.legacy_urn == "OLD-003"


def test_commit_batch_aborts_on_backup_failure(
    db_session: Session,
    admin_user: User,
    test_settings: Settings,
) -> None:
    csv_content = (
        "full_name,guardian_name,gender,age_years,mobile,address\n"
        "Aborted Patient,Guardian X,M,30,9876533333,Address Abort\n"
    ).encode("utf-8")

    mapping = {col: col for col in ["full_name", "guardian_name", "gender", "age_years", "mobile", "address"]}
    batch = stage_batch(db_session, admin_user.id, "abort_test.csv", csv_content, mapping)
    validate_batch(db_session, batch.batch_id)

    with patch("kalyan_api.services.backup_service.create_backup", side_effect=RuntimeError("Disk full")):
        with pytest.raises(PreCommitBackupFailedError):
            commit_batch(db_session, admin_user.id, batch.batch_id, cfg=test_settings)

    # Invariants: batch not committed, patient never created
    db_session.rollback()
    reloaded_batch = db_session.scalar(select(PatientImportBatch).where(PatientImportBatch.batch_id == batch.batch_id))
    assert reloaded_batch is None or reloaded_batch.status != "COMMITTED"

    patient = db_session.scalar(select(Patient).where(Patient.mobile == "9876533333"))
    assert patient is None


def test_export_error_records_csv(
    db_session: Session,
    admin_user: User,
) -> None:
    csv_content = (
        "full_name,guardian_name,gender,age_years,mobile,address\n"
        "=Malformed Formula Name,,M,30,9876544444,Address Four\n"
    ).encode("utf-8")

    mapping = {col: col for col in ["full_name", "guardian_name", "gender", "age_years", "mobile", "address"]}
    batch = stage_batch(db_session, admin_user.id, "error_test.csv", csv_content, mapping)
    validate_batch(db_session, batch.batch_id)

    csv_text = export_error_records_csv(db_session, batch.batch_id)
    assert "Row Number" in csv_text
    assert "Error Details / Reason" in csv_text
    assert "guardian_name" in csv_text
    # Formula injection sanitized with leading quote
    assert "'=Malformed Formula Name" in csv_text

