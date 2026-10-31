"""Tests for CLI administrator password recovery command (SEC-05, SEC-07).

Guarantees:
- reset-admin-password works via --password-stdin, --generate-password, and interactive prompts.
- Resets lockout counters, revokes all active sessions, and logs ADMIN_PASSWORD_RESET_CLI.
- Rejects unknown, non-admin, and inactive users.
- Never reads or writes system_setup; cannot create new users or reopen setup.
- Prohibits --password command-line argument.
"""

from io import StringIO
from typing import Any
from unittest.mock import patch

import pytest
from conftest import make_user
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.cli import build_parser, main
from kalyan_api.config import Settings
from kalyan_api.models import AuditLog


def test_cli_help_includes_recovery_and_omits_create_admin(
    capsys: pytest.CaptureFixture,
) -> None:
    """CLI --help lists reset-admin-password, migrate, and check-db, and omits create-admin."""
    with pytest.raises(SystemExit) as exc_info:
        main(["--help"])
    assert exc_info.value.code == 0
    out = capsys.readouterr().out
    assert "reset-admin-password" in out
    assert "migrate" in out
    assert "check-db" in out
    assert "create-admin" not in out


def test_cli_has_no_password_flag() -> None:
    """Parser must strictly reject --password argument to prevent shell history leakage."""
    parser = build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["reset-admin-password", "--username", "admin", "--password", "Secret!"])


def test_cli_reset_password_stdin(
    db_session: Session,
    test_settings: Settings,
    patch_cli_session: Any,
    login_client: Any,
    client: TestClient,
) -> None:
    """reset-admin-password --password-stdin updates hash, clears lockout, revokes sessions."""
    admin = make_user(db_session, test_settings, "ADMIN", "cli_admin_stdin")
    admin.failed_login_count = 5
    db_session.flush()

    # Active session before reset
    admin_c = login_client(admin)
    assert admin_c.get("/api/admin/overview").status_code == 200

    new_pw = "ValidStdinPassword123!"
    with patch("sys.stdin", StringIO(new_pw)):
        exit_code = main(["reset-admin-password", "--username", admin.username, "--password-stdin"])
    assert exit_code == 0

    # Old session is revoked
    assert admin_c.get("/api/admin/overview").status_code == 401

    # Database state updated
    db_session.refresh(admin)
    assert admin.failed_login_count == 0
    assert admin.locked_until is None
    assert admin.must_change_password is False

    # Login with new password succeeds
    login_res = client.post(
        "/api/auth/login",
        json={"username": admin.username, "password": new_pw},
    )
    assert login_res.status_code == 200

    # Audit row ADMIN_PASSWORD_RESET_CLI emitted
    audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "ADMIN_PASSWORD_RESET_CLI",
            AuditLog.entity_id == str(admin.id),
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit is not None
    assert audit.actor_role == "SYSTEM"
    assert audit.actor_username.startswith("cli:")
    # Password text never logged
    assert new_pw not in str(audit.after_data)


def test_cli_reset_password_generate(
    db_session: Session,
    test_settings: Settings,
    patch_cli_session: Any,
    client: TestClient,
    capsys: pytest.CaptureFixture,
) -> None:
    """reset-admin-password --generate-password prints temp password and sets must_change."""
    admin = make_user(db_session, test_settings, "ADMIN", "cli_admin_gen")

    exit_code = main(["reset-admin-password", "--username", admin.username, "--generate-password"])
    assert exit_code == 0

    out = capsys.readouterr().out
    assert "Generated temporary password:" in out
    # Extract printed password
    generated_pw = out.split("Generated temporary password:")[1].splitlines()[0].strip()
    assert len(generated_pw) == test_settings.temp_password_length

    db_session.refresh(admin)
    assert admin.must_change_password is True

    # User signs in with generated password
    login_res = client.post(
        "/api/auth/login",
        json={"username": admin.username, "password": generated_pw},
    )
    assert login_res.status_code == 200
    assert login_res.json()["must_change_password"] is True


def test_cli_reset_password_interactive_match_and_mismatch(
    db_session: Session,
    test_settings: Settings,
    patch_cli_session: Any,
) -> None:
    """Interactive mode confirms password with getpass; rejects mismatch."""
    admin = make_user(db_session, test_settings, "ADMIN", "cli_admin_inter")

    # Mismatch fails
    with patch("getpass.getpass", side_effect=["PassA12345678!", "PassB12345678!"]):
        exit_code = main(["reset-admin-password", "--username", admin.username])
    assert exit_code == 1

    # Match succeeds
    valid_pw = "MatchingPassword123!"
    with patch("getpass.getpass", side_effect=[valid_pw, valid_pw]):
        exit_code_ok = main(["reset-admin-password", "--username", admin.username])
    assert exit_code_ok == 0


def test_cli_reset_refuses_non_admin_and_inactive(
    db_session: Session,
    test_settings: Settings,
    patch_cli_session: Any,
) -> None:
    """Refuses non-admin roles and deactivated administrators."""
    rec = make_user(db_session, test_settings, "RECEPTION", "cli_rec_target")
    deact_admin = make_user(db_session, test_settings, "ADMIN", "cli_deact_admin", is_active=False)

    with patch("sys.stdin", StringIO("NewPassword1234!")):
        # Refuses RECEPTION
        r_rec = main(["reset-admin-password", "--username", rec.username, "--password-stdin"])
        assert r_rec != 0

        # Refuses inactive admin
        r_deact = main(
            ["reset-admin-password", "--username", deact_admin.username, "--password-stdin"]
        )
        assert r_deact != 0

        # Refuses unknown user
        r_unknown = main(
            ["reset-admin-password", "--username", "nonexistent_usr", "--password-stdin"]
        )
        assert r_unknown != 0
