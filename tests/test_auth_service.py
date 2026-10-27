"""
Automated security and authentication tests for AuthService.
Kalyan Hospital Management System.
"""

import socket
import pytest
from app.db.connection import init_db
from app.services.auth_service import AuthService
from app.services.patient_service import PatientService
from app.services.treatment_service import TreatmentService
from app.services.billing_service import BillingService


@pytest.fixture
def test_db(tmp_path):
    """Provides an isolated initialized SQLite database for auth tests."""
    db_file = tmp_path / "test_auth.db"
    init_db(str(db_file))
    return str(db_file)


def test_pbkdf2_hashing_and_verification():
    """Verifies that PBKDF2-HMAC-SHA256 correctly hashes and verifies passwords."""
    pwd = "SecureClinicPassword@2026"
    h1, s1 = AuthService.hash_password(pwd)

    assert len(h1) == 64  # SHA-256 produces 32 bytes (64 hex characters)
    assert len(s1) == 32  # 16 bytes salt (32 hex characters)

    # Verification passes with correct password
    assert AuthService.verify_password(pwd, h1, s1) is True

    # Verification fails with wrong password
    assert AuthService.verify_password("WrongPassword", h1, s1) is False
    assert AuthService.verify_password("", h1, s1) is False


def test_per_user_salt_uniqueness():
    """Verifies that hashing the identical password twice produces unique cryptographic salts and hashes."""
    pwd = "IdenticalPassword"
    h1, s1 = AuthService.hash_password(pwd)
    h2, s2 = AuthService.hash_password(pwd)

    assert s1 != s2
    assert h1 != h2


def test_default_admin_seeding(test_db):
    """Verifies that default administrator account is seeded in empty database."""
    auth_service = AuthService(db_path=test_db)

    # Authenticate with default admin credentials
    admin = auth_service.authenticate("admin", "kalyan@admin")
    assert admin is not None
    assert admin["username"] == "admin"
    assert admin["role"] == "ADMIN"

    # Wrong password fails
    assert auth_service.authenticate("admin", "wrong_admin_pass") is None


def test_verify_admin_credentials(test_db):
    """Verifies verify_admin_credentials helper for administrative operation authorization."""
    auth_service = AuthService(db_path=test_db)

    assert auth_service.verify_admin_credentials("kalyan@admin") is True
    assert auth_service.verify_admin_credentials("wrong_password") is False
    assert auth_service.verify_admin_credentials("") is False


def test_change_password(test_db):
    """Verifies password change workflow."""
    auth_service = AuthService(db_path=test_db)
    admin = auth_service.authenticate("admin", "kalyan@admin")
    admin_id = admin["id"]

    # Change password
    success = auth_service.change_password(admin_id, "kalyan@admin", "NewAdminSecret@456")
    assert success is True

    # Old password no longer works
    assert auth_service.authenticate("admin", "kalyan@admin") is None

    # New password works
    assert auth_service.authenticate("admin", "NewAdminSecret@456") is not None
    assert auth_service.verify_admin_credentials("NewAdminSecret@456") is True


def test_offline_zero_network_operation(test_db, monkeypatch):
    """
    Verifies that the entire application operates strictly offline.
    Monkeypatches socket.socket.connect to raise an error if any network call is attempted.
    """
    def _forbidden_connect(*args, **kwargs):
        raise ConnectionRefusedError("Offline Violation: Remote network connection attempted!")

    monkeypatch.setattr(socket.socket, "connect", _forbidden_connect)

    # Execute full clinic flow: Auth -> Patient -> Treatment -> Billing
    auth_service = AuthService(db_path=test_db)
    assert auth_service.verify_admin_credentials("kalyan@admin") is True

    patient_service = PatientService(test_db)
    patient = patient_service.register_patient({
        "patient_name": "Offline Patient",
        "age": 42,
        "sex": "Female",
        "mobile_no": "9876543210",
        "patient_condition": "Offline Verification Case",
    })
    assert patient["id"] is not None

    treatment_service = TreatmentService(test_db)
    case = treatment_service.open_treatment_case(
        patient_id=patient["id"],
        title="Offline Case",
        no_of_sessions=5,
        total_amount_rupees=2000,
    )
    treatment_service.log_session(case_id=case["id"], treatment_notes="Offline session note", pain_score=5)

    billing_service = BillingService(test_db)
    receipt = billing_service.record_installment(case_id=case["id"], amount_rupees=1000)
    assert receipt["balance_paise"] == 100000
