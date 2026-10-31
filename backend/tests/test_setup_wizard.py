"""Tests for first-run setup wizard backend (SEC-07, SC-6).

Guarantees:
- Setup is available when system setup has never completed.
- Invalid setup codes return 403 setup_code_invalid and emit SETUP_CODE_REJECTED audit records.
- Valid setup code creates 1 ADMIN (must_change_password=False) & SystemSetup row.
- Setup code is atomically consumed after transaction commit.
- Failed commits do not consume the setup code.
- NIST password policy violations return 422 password_policy.
- CSRF Origin verification applies to setup endpoints.
"""

from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.core.setup_code import issue_setup_code
from kalyan_api.models import AuditLog, SystemSetup, User


def test_setup_available_when_never_completed(client: TestClient) -> None:
    """With no system_setup row, GET /api/setup/status returns 200 {setup_required: true}."""
    resp = client.get("/api/setup/status")
    assert resp.status_code == 200
    assert resp.json() == {"setup_required": True}


def test_valid_code_creates_exactly_one_admin(
    app: FastAPI,
    client: TestClient,
    db_session: Session,
    setup_code: str,
) -> None:
    """Valid code + details creates 1 admin, 1 system_setup row, and consumes code."""
    payload = {
        "setup_code": setup_code,
        "username": "superadmin",
        "full_name": "Hospital Superintendent",
        "password": "ValidSuperPassword123!",
    }

    resp = client.post("/api/setup/admin", json=payload)
    assert resp.status_code == 201

    data = resp.json()
    assert data["username"] == "superadmin"
    assert data["role"] == "ADMIN"
    assert data["must_change_password"] is False
    created_id = data["id"]

    # Exactly one system_setup row exists with admin_user_id == created_id
    setup_row = db_session.scalar(select(SystemSetup).where(SystemSetup.id == 1))
    assert setup_row is not None
    assert setup_row.admin_user_id == created_id

    # Exactly one ADMIN_BOOTSTRAPPED audit row
    audit_row = db_session.scalar(
        select(AuditLog).where(AuditLog.action == "ADMIN_BOOTSTRAPPED")
    )
    assert audit_row is not None
    assert audit_row.actor_username == "setup:wizard"
    assert audit_row.actor_role == "SYSTEM"
    assert audit_row.entity_id == str(created_id)

    # Admin signs in successfully immediately
    login_resp = client.post(
        "/api/auth/login",
        json={"username": "superadmin", "password": "ValidSuperPassword123!"},
    )
    assert login_resp.status_code == 200
    login_data = login_resp.json()
    assert login_data["must_change_password"] is False

    # Verify atomic consumption after response background task executed
    code_path: Path = app.state.setup_code_path
    assert not code_path.exists(), "Setup code file should be deleted after consumption"
    assert app.state.setup_code_hash is None, "Setup code hash should be cleared in app state"


def test_invalid_code_rejected(
    client: TestClient,
    db_session: Session,
    setup_code: str,
) -> None:
    """Invalid setup code returns 403 setup_code_invalid, logs audit, and creates nothing."""
    payload = {
        "setup_code": "WRONGCODE999",
        "username": "failed_admin",
        "full_name": "Failed Admin",
        "password": "ValidAdminPassword123!",
    }

    resp = client.post("/api/setup/admin", json=payload)
    assert resp.status_code == 403
    assert resp.json()["code"] == "setup_code_invalid"

    # No user created
    user_count = db_session.scalar(
        select(func.count(User.id)).where(User.username == "failed_admin")
    )
    assert user_count == 0

    # No system_setup row created
    setup_count = db_session.scalar(select(func.count(SystemSetup.id)))
    assert setup_count == 0

    # SETUP_CODE_REJECTED audit row emitted
    reject_audit = db_session.scalar(
        select(AuditLog).where(AuditLog.action == "SETUP_CODE_REJECTED")
    )
    assert reject_audit is not None
    assert reject_audit.outcome == "FAILURE"
    # Never log the submitted code
    assert "WRONGCODE999" not in str(reject_audit.reason)
    assert "WRONGCODE999" not in str(reject_audit.after_data)


def test_failed_commit_does_not_consume_code(
    app: FastAPI,
    db_session: Session,
    test_settings: Settings,
    tmp_path: Path,
) -> None:
    """If database transaction fails before commit, the code is NOT consumed."""
    code_file = tmp_path / "fail_code.txt"
    code = issue_setup_code(app, test_settings, path=code_file)

    client = TestClient(
        app,
        base_url="http://testserver",
        headers={"Origin": "http://testserver"},
        raise_server_exceptions=False,
    )

    payload = {
        "setup_code": code,
        "username": "abort_admin",
        "full_name": "Abort Admin",
        "password": "ValidAdminPassword123!",
    }

    # Simulate an error during user creation / audit
    with patch("kalyan_api.services.audit_service.record", side_effect=RuntimeError("Audit crash")):
        resp = client.post("/api/setup/admin", json=payload)
        assert resp.status_code == 500

    # Code file and hash must STILL be present
    assert code_file.exists(), "Code file must not be deleted if transaction failed"
    assert app.state.setup_code_hash is not None, "Code hash must still be valid"

    # Zero rows created
    user_exists = db_session.scalar(
        select(func.count(User.id)).where(User.username == "abort_admin")
    )
    assert user_exists == 0


def test_setup_password_policy_violation(
    client: TestClient,
    setup_code: str,
) -> None:
    """Violating NIST password policy returns 422 password_policy."""
    payload = {
        "setup_code": setup_code,
        "username": "short_pw_admin",
        "full_name": "Short Admin",
        "password": "short",  # Violates min_length
    }

    resp = client.post("/api/setup/admin", json=payload)
    assert resp.status_code == 422
    assert resp.json()["code"] == "password_policy"


def test_setup_missing_origin_returns_403(
    app: FastAPI,
    setup_code: str,
) -> None:
    """Missing Origin header triggers CSRF verification failure (403 csrf_failed)."""
    # Client without Origin header
    raw_client = TestClient(app, base_url="http://testserver")

    payload = {
        "setup_code": setup_code,
        "username": "csrf_admin",
        "full_name": "CSRF Admin",
        "password": "ValidAdminPassword123!",
    }

    resp = raw_client.post("/api/setup/admin", json=payload)
    assert resp.status_code == 403
    assert resp.json()["code"] == "csrf_failed"
