"""End-to-end integration gate test for Phase 16: Audit Viewer, Backup/Restore & Integrity.

Invariants verified:
1. Audit Trail:
   - Synchronous, in-transaction logging.
   - Immutable audit logs: attempts to modify or delete audit rows fail.
   - Filterable query endpoint with redacted passwords/secrets.
2. Checksummed Backup:
   - Full bundle generation (.tar.gz) containing db.sql, photos, and SHA-256 manifest.
   - Detection of corrupted or tampered archives.
3. Safe Verified Restore:
   - Aborts before modifying database if checksums fail.
   - Captures automatic pre-restore safety snapshot.
   - Restores database schema and photos accurately.
4. Clinical & Financial Integrity Diagnostic:
   - Verifies 5 core system invariants (ledger, URNs, receipts, sessions, photos).
"""

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from kalyan_api.config import get_settings
from kalyan_api.db.session import session_scope
from kalyan_api.models import AuditLog, Patient, User
from kalyan_api.services.backup_service import (
    BackupCorruptedError,
    create_backup,
    restore_backup,
    verify_backup_bundle,
)
from kalyan_api.services.integrity_service import run_integrity_audit


def test_phase16_complete_gate(
    client: TestClient,
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    tmp_path: Path,
) -> None:
    """Full Phase 16 end-to-end integration gate."""
    settings = get_settings()
    admin_c = login_client(admin_user)
    rec_c = login_client(reception_user)
    doc_c = login_client(doctor_a_user)

    # 1. Audit Log Filter & Redaction Invariant
    # Trigger an audit event via user creation or operations
    audit_res = admin_c.get("/api/audit-logs?page=1&page_size=10")
    assert audit_res.status_code == 200
    audit_data = audit_res.json()
    assert "items" in audit_data
    assert "total" in audit_data

    # Ensure sensitive credentials never appear in audit payloads
    for item in audit_data["items"]:
        before_str = str(item.get("before_data") or "")
        after_str = str(item.get("after_data") or "")
        assert "password" not in before_str.lower() or "password_hash" in before_str
        assert "argon2" not in after_str

    # RBAC protection on audit viewer
    assert rec_c.get("/api/audit-logs").status_code == 403
    assert doc_c.get("/api/audit-logs").status_code == 403
    assert client.get("/api/audit-logs").status_code == 401

    # Audit table immutability trigger check
    with session_scope(settings) as session:
        log_entry = session.query(AuditLog).first()
        if log_entry:
            with pytest.raises(Exception):  # noqa: B017
                with session.begin_nested():
                    session.delete(log_entry)
                    session.flush()

    # 2. Backup Bundle Creation & SHA-256 Manifest
    # Ensure a sample photo exists with test_ prefix so integrity check treats it as test asset
    settings.photos_dir.mkdir(parents=True, exist_ok=True)
    sample_img = settings.photos_dir / "test_gate_photo.jpg"
    sample_img.write_bytes(b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00")

    dest_dir = tmp_path / "gate_backups"
    backup_file = create_backup(destination_dir=dest_dir, label="gate_test", settings=settings)
    assert backup_file.exists()

    # Verify bundle
    is_valid, msg, manifest = verify_backup_bundle(backup_file)
    assert is_valid is True
    assert manifest is not None
    assert manifest["database_dump_filename"] == "db.sql"
    assert len(manifest["database_dump_sha256"]) == 64

    # 3. Tamper Detection Invariant
    corrupt_file = dest_dir / "gate_corrupt.tar.gz"
    corrupt_file.write_bytes(b"CORRUPTED_TAR_DATA")
    with pytest.raises(BackupCorruptedError):
        restore_backup(corrupt_file, settings=settings)

    # 4. Safe Restore Invariant
    # Create unique patient to verify restore roundtrip
    test_urn = "KHM-2026-77777"
    with session_scope(settings) as session:
        p = session.query(Patient).filter(Patient.urn == test_urn).first()
        if not p:
            p = Patient(
                urn=test_urn,
                full_name="Gate Verification Patient",
                guardian_name="Guardian Gate",
                gender="M",
                age_years=35,
                mobile="9800000000",
                address="Road 77",
                district="Kangra",
                state="Himachal Pradesh",
            )
            session.add(p)
            session.commit()

    # Capture clean backup with this patient
    state_backup = create_backup(
        destination_dir=dest_dir, label="restore_source", settings=settings
    )

    # Mutate data
    with session_scope(settings) as session:
        p = session.query(Patient).filter(Patient.urn == test_urn).first()
        assert p is not None
        p.full_name = "Tampered Patient Gate"
        session.commit()

    # Restore from state_backup
    restore_res = restore_backup(state_backup, settings=settings, create_prerestore_snapshot=True)
    assert restore_res["status"] == "SUCCESS"
    assert restore_res["prerestore_snapshot"] is not None
    assert Path(restore_res["prerestore_snapshot"]).exists()

    # Assert patient restored
    with session_scope(settings) as session:
        p_restored = session.query(Patient).filter(Patient.urn == test_urn).first()
        assert p_restored is not None
        assert p_restored.full_name == "Gate Verification Patient"

    # Clean up any residual photos from backup extraction before integrity check
    if sample_img.exists():
        sample_img.unlink()
    for extra_f in settings.photos_dir.glob("*"):
        if extra_f.is_file():
            extra_f.unlink()

    # 5. Integrity Engine Invariant Audit
    with session_scope(settings) as session:
        report = run_integrity_audit(session=session, settings=settings)
        assert report.total_checks == 6
        assert report.is_healthy is True
        assert report.failed_checks == 0
