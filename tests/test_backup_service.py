"""
Automated unit tests for BackupService and Verified Restore Pipeline.
Kalyan Hospital Management System.
"""

import sqlite3
import pytest
from app.db.connection import init_db, get_db_connection
from app.services.patient_service import PatientService
from app.services.treatment_service import TreatmentService
from app.services.billing_service import BillingService
from app.services.backup_service import BackupService


@pytest.fixture
def populated_env(tmp_path):
    """Initializes a live DB and populates sample clinical and financial records."""
    db_file = tmp_path / "live_kalyan.db"
    backup_folder = tmp_path / "backups"
    init_db(str(db_file))

    p_service = PatientService(str(db_file))
    p1 = p_service.register_patient({
        "patient_name": "Ramesh Kumar Sharma",
        "age": 45,
        "sex": "Male",
        "mobile_no": "9876543210",
        "patient_condition": "Lumbar Spondylosis",
    })
    p2 = p_service.register_patient({
        "patient_name": "Sunita Devi",
        "age": 40,
        "sex": "Female",
        "mobile_no": "9123456789",
        "patient_condition": "Cervical Spondylosis",
    })

    t_service = TreatmentService(str(db_file))
    case = t_service.open_treatment_case(
        patient_id=p1["id"],
        title="Spine Traction Therapy",
        no_of_sessions=10,
        total_amount_rupees=3500.0,
    )
    t_service.log_session(
        case_id=case["id"],
        treatment_notes="Day 1 traction",
        pain_score=7,
    )

    b_service = BillingService(str(db_file))
    b_service.record_installment(
        case_id=case["id"],
        amount_rupees=1500.0,
        payment_mode="CASH",
        reference_note="Advance",
    )

    return {
        "db_path": str(db_file),
        "backup_dir": str(backup_folder),
        "patient1": p1,
        "patient2": p2,
        "case": case,
    }


def test_create_hot_backup_creates_valid_file(populated_env):
    """Verifies that create_backup creates a valid SQLite file with integrity 'ok'."""
    service = BackupService(db_path=populated_env["db_path"], backup_dir=populated_env["backup_dir"])
    backup_file = service.create_backup()

    assert backup_file.exists()
    assert backup_file.stat().st_size > 0

    info = service.verify_backup_integrity(str(backup_file))
    assert info["valid"] is True
    assert info["patients_count"] == 2
    assert info["cases_count"] == 1
    assert info["sessions_count"] == 1
    assert info["payments_count"] == 1


def test_backup_record_counts_match_live(populated_env):
    """Verifies that record counts in the backup exactly match the live database."""
    service = BackupService(db_path=populated_env["db_path"], backup_dir=populated_env["backup_dir"])
    backup_file = service.create_backup()

    info = service.verify_backup_integrity(str(backup_file))

    with get_db_connection(populated_env["db_path"]) as conn:
        live_p_count = conn.execute("SELECT COUNT(*) FROM patients").fetchone()[0]
        live_c_count = conn.execute("SELECT COUNT(*) FROM treatment_cases").fetchone()[0]
        live_s_count = conn.execute("SELECT COUNT(*) FROM treatment_sessions").fetchone()[0]
        live_pay_count = conn.execute("SELECT COUNT(*) FROM payments").fetchone()[0]

    assert info["patients_count"] == live_p_count
    assert info["cases_count"] == live_c_count
    assert info["sessions_count"] == live_s_count
    assert info["payments_count"] == live_pay_count


def test_corrupt_backup_rejected_by_verifier(populated_env, tmp_path):
    """Verifies that corrupted SQLite files are flagged as invalid."""
    corrupt_file = tmp_path / "corrupt.db"
    corrupt_file.write_bytes(b"THIS IS NOT A VALID SQLITE DATABASE FILE GARBAGE DATA 12345")

    service = BackupService(db_path=populated_env["db_path"], backup_dir=populated_env["backup_dir"])
    info = service.verify_backup_integrity(str(corrupt_file))

    assert info["valid"] is False
    assert "error" in info


def test_restore_from_backup_restores_data(populated_env):
    """Verifies that restoring from backup recovers deleted records."""
    service = BackupService(db_path=populated_env["db_path"], backup_dir=populated_env["backup_dir"])
    backup_file = service.create_backup()

    # Simulate catastrophic live data deletion (e.g. operator error)
    with get_db_connection(populated_env["db_path"]) as conn:
        conn.execute("DELETE FROM payments")
        conn.execute("DELETE FROM treatment_sessions")
        conn.execute("DELETE FROM treatment_cases")
        conn.execute("DELETE FROM patients")
        conn.commit()

        # Confirm data was deleted
        assert conn.execute("SELECT COUNT(*) FROM patients").fetchone()[0] == 0

    # Execute verified restore
    result = service.restore_from_backup(str(backup_file))
    assert result["success"] is True
    assert result["record_counts"]["patients"] == 2
    assert result["record_counts"]["cases"] == 1

    # Verify live database now contains restored patients
    with get_db_connection(populated_env["db_path"]) as conn:
        restored_count = conn.execute("SELECT COUNT(*) FROM patients").fetchone()[0]
        assert restored_count == 2


def test_restore_corrupt_file_does_not_destroy_live_db(populated_env, tmp_path):
    """Verifies that attempting restore from corrupt file halts and leaves live data intact."""
    service = BackupService(db_path=populated_env["db_path"], backup_dir=populated_env["backup_dir"])

    corrupt_file = tmp_path / "bad_snapshot.db"
    corrupt_file.write_bytes(b"INVALID DATA")

    # Attempt restore should raise ValueError
    with pytest.raises(ValueError, match="Cannot restore from corrupt backup"):
        service.restore_from_backup(str(corrupt_file))

    # Live database should be 100% intact
    with get_db_connection(populated_env["db_path"]) as conn:
        assert conn.execute("SELECT COUNT(*) FROM patients").fetchone()[0] == 2
