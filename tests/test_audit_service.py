"""
Automated unit tests for AuditService and Phase 6 safety hardening.
Kalyan Hospital Management System.
"""

import sqlite3
import pytest
from app.db.connection import init_db
from app.services.audit_service import AuditService
from app.services.auth_service import AuthService
from app.services.backup_service import BackupService


@pytest.fixture
def test_db(tmp_path):
    """Provides an isolated initialized SQLite database for tests."""
    db_file = tmp_path / "test_phase6.db"
    init_db(str(db_file))
    return str(db_file)


def test_audit_service_log_and_query(test_db):
    """Verifies that AuditService successfully logs and queries audit events."""
    audit = AuditService(test_db)

    # 1. Log events
    log_id_1 = audit.log_event(
        action="PATIENT_REGISTERED",
        entity_type="PATIENT",
        entity_id="KH-2026-0001",
        actor_name="Receptionist",
        details="Registered Ramesh Kumar",
    )
    assert log_id_1 > 0

    log_id_2 = audit.log_event(
        action="PAYMENT_RECEIVED",
        entity_type="PAYMENT",
        entity_id="PAY-101",
        actor_name="Receptionist",
        details="Received Rs 500 via Cash",
    )
    assert log_id_2 > log_id_1

    # 2. Query recent logs
    recent = audit.get_recent_logs(limit=10)
    assert len(recent) >= 2
    assert recent[0]["id"] == log_id_2
    assert recent[0]["action"] == "PAYMENT_RECEIVED"

    # 3. Query filtered by action
    patient_logs = audit.get_recent_logs(action="PATIENT_REGISTERED")
    assert len(patient_logs) == 1
    assert patient_logs[0]["entity_id"] == "KH-2026-0001"

    # 4. Query entity history
    history = audit.get_entity_history("PATIENT", "KH-2026-0001")
    assert len(history) == 1
    assert history[0]["actor_name"] == "Receptionist"


def test_auth_service_first_run_admin_setup(tmp_path):
    """Verifies that AuthService supports first-run administrator configuration."""
    db_file = tmp_path / "fresh_auth.db"
    init_db(str(db_file))

    # Initialize without auto-seeding demo admin
    auth = AuthService(db_path=str(db_file), auto_seed_demo=False)
    assert auth.has_admin_user() is False

    # Password too short fails
    with pytest.raises(ValueError, match="at least 8 characters"):
        auth.setup_initial_admin("superadmin", "short")

    # Initial admin setup succeeds
    admin_info = auth.setup_initial_admin("superadmin", "HospitalMasterPass@2026")
    assert admin_info["username"] == "superadmin"
    assert admin_info["role"] == "ADMIN"
    assert auth.has_admin_user() is True

    # Subsequent setup call is blocked
    with pytest.raises(ValueError, match="already exists"):
        auth.setup_initial_admin("anotheradmin", "AnotherPass@2026")

    # Audit log was created for admin initialization
    audit = AuditService(str(db_file))
    logs = audit.get_recent_logs(action="ADMIN_INITIALIZED")
    assert len(logs) == 1
    assert logs[0]["actor_name"] == "superadmin"


def test_backup_service_rejects_structurally_incomplete_database(tmp_path):
    """Verifies that BackupService rejects a corrupt or incomplete DB missing canonical tables."""
    incomplete_db = tmp_path / "incomplete.db"
    conn = sqlite3.connect(str(incomplete_db))
    # Only create one arbitrary table
    conn.execute("CREATE TABLE foo (id INTEGER PRIMARY KEY);")
    conn.commit()
    conn.close()

    backup_service = BackupService(db_path=str(incomplete_db), backup_dir=str(tmp_path))
    integrity = backup_service.verify_backup_integrity(str(incomplete_db))

    assert integrity["valid"] is False
    assert "Missing required table" in integrity["error"]
