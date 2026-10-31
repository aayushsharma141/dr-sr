"""Tests for first-run setup wizard backend (SEC-07, SC-6).

Guarantees:
- Setup is available when system setup has never completed.
- Invalid setup codes return 403 setup_code_invalid and emit SETUP_CODE_REJECTED audit records.
- Valid setup code creates 1 ADMIN (must_change_password=False) & SystemSetup row.
- Setup code is atomically consumed after transaction commit.
- Failed commits do not consume the setup code.
- NIST password policy violations return 422 password_policy.
- CSRF Origin verification applies to setup endpoints.
- Setup is permanently closed once completed; stays closed after restart or admin deactivations.
- Setup code never appears in logs, audit records, or HTTP responses.
- Brute-force throttling locks offending IP addresses and rotates code after 10 failures.
"""

import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from conftest import make_user
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.core.setup_code import (
    SETUP_LOCK_MINUTES,
    SETUP_ROTATE_AFTER,
    issue_setup_code,
)
from kalyan_api.db.session import get_session
from kalyan_api.main import create_app
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


def test_setup_closed_after_completion(
    client: TestClient,
    db_session: Session,
    admin_user: User,
    login_client: Any,
    test_settings: Settings,
) -> None:
    """Once system_setup row exists, status and admin reject with 410 for all roles and codes."""
    # Complete setup in the transaction
    db_session.add(
        SystemSetup(id=1, completed_at=datetime.now(UTC), admin_user_id=admin_user.id)
    )
    db_session.flush()

    # Anonymous GET /api/setup/status -> 410
    r_status = client.get("/api/setup/status")
    assert r_status.status_code == 410
    assert r_status.json()["code"] == "setup_closed"

    # Anonymous POST /api/setup/admin with any code -> 410
    r_admin = client.post(
        "/api/setup/admin",
        json={
            "setup_code": "ANYCODE",
            "username": "late_admin",
            "full_name": "Late Admin",
            "password": "ValidPassword123!",
        },
    )
    assert r_admin.status_code == 410
    assert r_admin.json()["code"] == "setup_closed"

    # Authenticated admin client -> 410
    admin_c = login_client(admin_user)
    assert admin_c.get("/api/setup/status").status_code == 410
    assert (
        admin_c.post(
            "/api/setup/admin",
            json={
                "setup_code": "ANYCODE",
                "username": "another_admin",
                "full_name": "Another Admin",
                "password": "ValidPassword123!",
            },
        ).status_code
        == 410
    )

    # Authenticated reception client -> 410
    rec = make_user(db_session, test_settings, "RECEPTION", "setup_rec_tester")
    rec_c = login_client(rec)
    assert rec_c.get("/api/setup/status").status_code == 410
    assert (
        rec_c.post(
            "/api/setup/admin",
            json={
                "setup_code": "ANYCODE",
                "username": "rec_admin",
                "full_name": "Rec Admin",
                "password": "ValidPassword123!",
            },
        ).status_code
        == 410
    )


def test_setup_not_reopened_by_deactivation(
    client: TestClient,
    db_session: Session,
    admin_user: User,
) -> None:
    """Deactivating all administrators does NOT reopen setup; 410 is permanent."""
    db_session.add(
        SystemSetup(id=1, completed_at=datetime.now(UTC), admin_user_id=admin_user.id)
    )
    db_session.execute(text("UPDATE users SET is_active = false WHERE role = 'ADMIN'"))
    db_session.flush()

    # Invariant: Gate is system_setup row presence, not active admin count
    r1 = client.get("/api/setup/status")
    assert r1.status_code == 410
    assert r1.json()["code"] == "setup_closed"

    r2 = client.post(
        "/api/setup/admin",
        json={
            "setup_code": "ANYCODE",
            "username": "takeover_admin",
            "full_name": "Takeover Admin",
            "password": "ValidPassword123!",
        },
    )
    assert r2.status_code == 410
    assert r2.json()["code"] == "setup_closed"


def test_code_never_logged(
    app: FastAPI,
    client: TestClient,
    test_settings: Settings,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture,
) -> None:
    """Setup code is absent from logging, and absent from stdout when not an interactive TTY."""
    caplog.set_level("DEBUG")
    code_path = tmp_path / "nolog_code.txt"

    # 1. Non-TTY startup: prints banner only, code never in caplog or stdout
    code = issue_setup_code(app, test_settings, path=code_path)
    captured = capsys.readouterr()
    assert "First-run setup code written to:" in captured.out
    assert code not in captured.out, "Code must not be printed to stdout when not a TTY"
    assert code not in caplog.text, "Code must not be recorded by logging module"

    # 2. TTY startup: code printed to stdout, still absent from logging
    with patch("sys.stdout.isatty", return_value=True):
        code_tty = issue_setup_code(app, test_settings, path=code_path)
    captured_tty = capsys.readouterr()
    assert f"FIRST-RUN SETUP CODE: {code_tty}" in captured_tty.out
    assert code_tty not in caplog.text, "Code must not be recorded by logging even on TTY"

    # 3. Code submission and verification: never in caplog
    client.post(
        "/api/setup/admin",
        json={
            "setup_code": "WRONG_ATTEMPT",
            "username": "nolog_adm",
            "full_name": "No Log Admin",
            "password": "ValidAdminPassword123!",
        },
    )
    assert code_tty not in caplog.text
    assert "WRONG_ATTEMPT" not in caplog.text

    client.post(
        "/api/setup/admin",
        json={
            "setup_code": code_tty,
            "username": "nolog_adm2",
            "full_name": "No Log Admin 2",
            "password": "ValidAdminPassword123!",
        },
    )
    assert code_tty not in caplog.text


def test_code_never_in_responses(
    client: TestClient,
    setup_code: str,
) -> None:
    """Code is strictly omitted from all response bodies and headers across error and success."""
    responses = [
        # 422 password policy
        client.post(
            "/api/setup/admin",
            json={
                "setup_code": setup_code,
                "username": "adm",
                "full_name": "Admin",
                "password": "short",
            },
        ),
        # 403 invalid code
        client.post(
            "/api/setup/admin",
            json={
                "setup_code": "WRONG_SECRET",
                "username": "adm",
                "full_name": "Admin",
                "password": "ValidAdminPassword123!",
            },
        ),
        # 201 success
        client.post(
            "/api/setup/admin",
            json={
                "setup_code": setup_code,
                "username": "adm_clean",
                "full_name": "Admin Clean",
                "password": "ValidAdminPassword123!",
            },
        ),
        # 410 closed
        client.get("/api/setup/status"),
        client.post(
            "/api/setup/admin",
            json={
                "setup_code": setup_code,
                "username": "adm_again",
                "full_name": "Admin Again",
                "password": "ValidAdminPassword123!",
            },
        ),
    ]

    for resp in responses:
        assert setup_code not in resp.text
        for h_name, h_val in resp.headers.items():
            assert setup_code not in h_val, f"Code found in header {h_name}"


def test_code_never_in_audit(
    client: TestClient,
    db_session: Session,
    setup_code: str,
) -> None:
    """Setup code string NEVER appears in audit_logs columns."""
    client.post(
        "/api/setup/admin",
        json={
            "setup_code": "WRONG_SECRET_AUDIT",
            "username": "audit_probe",
            "full_name": "Audit Probe",
            "password": "ValidAdminPassword123!",
        },
    )
    client.post(
        "/api/setup/admin",
        json={
            "setup_code": setup_code,
            "username": "audit_probe2",
            "full_name": "Audit Probe 2",
            "password": "ValidAdminPassword123!",
        },
    )

    all_audits = db_session.scalars(select(AuditLog)).all()
    assert len(all_audits) >= 2
    for audit in all_audits:
        dump = f"{audit.before_data} {audit.after_data} {audit.reason}".lower()
        assert setup_code.lower() not in dump
        assert "wrong_secret_audit" not in dump


def test_address_locked_after_wrong_codes(
    make_client: Any,
    clock: dict[str, Any],
    setup_code: str,
) -> None:
    """5 failures from IP -> 429 lockout on 6th; other IPs unaffected; unlocks after window."""
    bad_ip = "192.168.1.101"
    good_ip = "192.168.1.102"

    bad_client = make_client(bad_ip)
    good_client = make_client(good_ip)

    # 1. Five wrong submissions from bad_ip -> 403
    for _ in range(5):
        r = bad_client.post(
            "/api/setup/admin",
            json={
                "setup_code": "BADCODE",
                "username": "adm",
                "full_name": "Admin",
                "password": "ValidAdminPassword123!",
            },
        )
        assert r.status_code == 403

    # 2. 6th attempt from bad_ip (even with correct code) -> 429 too_many_attempts
    locked_res = bad_client.post(
        "/api/setup/admin",
        json={
            "setup_code": setup_code,
            "username": "adm",
            "full_name": "Admin",
            "password": "ValidAdminPassword123!",
        },
    )
    assert locked_res.status_code == 429
    assert locked_res.json()["code"] == "too_many_attempts"
    assert "Retry-After" in locked_res.headers
    retry_after = int(locked_res.headers["Retry-After"])
    assert 0 < retry_after <= SETUP_LOCK_MINUTES * 60

    # 3. good_ip is completely unaffected
    ok_res = good_client.post(
        "/api/setup/admin",
        json={
            "setup_code": setup_code,
            "username": "good_ip_admin",
            "full_name": "Good Admin",
            "password": "ValidAdminPassword123!",
        },
    )
    assert ok_res.status_code == 201

    # 4. Fast-forward clock past lockout window
    clock["t"] += timedelta(minutes=SETUP_LOCK_MINUTES, seconds=1)

    # After expiration, bad_ip is no longer locked out (it hits 410 since setup closed)
    unlocked_res = bad_client.post(
        "/api/setup/admin",
        json={
            "setup_code": setup_code,
            "username": "adm",
            "full_name": "Admin",
            "password": "ValidAdminPassword123!",
        },
    )
    assert unlocked_res.status_code == 410


def test_code_rotated_after_total_failures(
    app: FastAPI,
    make_client: Any,
    setup_code: str,
) -> None:
    """After 10 total wrong submissions across IPs, the setup code is rotated."""
    original_code = setup_code
    code_file: Path = app.state.setup_code_path

    # Send 10 failures across multiple IPs (4 from ip1, 4 from ip2, 2 from ip3)
    ips = ["192.168.1.10", "192.168.1.11", "192.168.1.12"]
    for i in range(SETUP_ROTATE_AFTER):
        client = make_client(ips[i % len(ips)])
        r = client.post(
            "/api/setup/admin",
            json={
                "setup_code": "WRONG_GUESS",
                "username": "probe_user",
                "full_name": "Probe",
                "password": "ValidAdminPassword123!",
            },
        )
        assert r.status_code == 403

    # Original code is now rejected
    test_c = make_client("192.168.1.99")
    r_old = test_c.post(
        "/api/setup/admin",
        json={
            "setup_code": original_code,
            "username": "rotate_adm",
            "full_name": "Rotate Admin",
            "password": "ValidAdminPassword123!",
        },
    )
    assert r_old.status_code == 403

    # New code in the file is different and valid
    new_code = code_file.read_text(encoding="utf-8").strip()
    assert new_code != original_code

    r_new = test_c.post(
        "/api/setup/admin",
        json={
            "setup_code": new_code,
            "username": "rotate_adm",
            "full_name": "Rotate Admin",
            "password": "ValidAdminPassword123!",
        },
    )
    assert r_new.status_code == 201


def test_restart_before_setup_rotates_code(
    test_settings: Settings,
    tmp_path: Path,
) -> None:
    """Two consecutive app instances issue different codes; old code rejected by new instance."""
    code_path = tmp_path / "restart_code.txt"
    settings = Settings(
        env="test",
        db_name=test_settings.db_name,
        setup_code_path=code_path,
        argon2_time_cost=1,
        argon2_memory_cost=8,
        argon2_parallelism=1,
    )

    # Instance 1
    app1 = create_app(settings)
    with TestClient(app1, base_url="http://testserver", headers={"Origin": "http://testserver"}):
        code1 = code_path.read_text(encoding="utf-8").strip()
        assert len(code1) == 10

    # Instance 2
    app2 = create_app(settings)
    with TestClient(
        app2, base_url="http://testserver", headers={"Origin": "http://testserver"}
    ) as c2:
        code2 = code_path.read_text(encoding="utf-8").strip()
        assert code2 != code1

        # Code 1 is rejected by instance 2
        r1 = c2.post(
            "/api/setup/admin",
            json={
                "setup_code": code1,
                "username": "adm1",
                "full_name": "Admin 1",
                "password": "ValidAdminPassword123!",
            },
        )
        assert r1.status_code == 403

        # Code 2 succeeds
        r2 = c2.post(
            "/api/setup/admin",
            json={
                "setup_code": code2,
                "username": "adm2",
                "full_name": "Admin 2",
                "password": "ValidAdminPassword123!",
            },
        )
        assert r2.status_code == 201


# =============================================================================
# Concurrency & Permanent Commit Tests (Run LAST in module)
# Note: These commit real SystemSetup rows on PostgreSQL engine kalyan_test.
# =============================================================================


@pytest.mark.concurrency
def test_simultaneous_submissions_single_admin(
    app_engine: Engine,
    owner_engine: Engine,
    test_settings: Settings,
    tmp_path: Path,
) -> None:
    """Two simultaneous requests behind Barrier(2): sorted statuses == [201, 410]."""
    code_file = tmp_path / "concurrent_setup_code.txt"
    settings = Settings(
        env="test",
        db_name=test_settings.db_name,
        setup_code_path=code_file,
        argon2_time_cost=1,
        argon2_memory_cost=8,
        argon2_parallelism=1,
    )

    concurrency_app = create_app(settings)

    def _get_concurrency_session():
        sess = Session(app_engine)
        try:
            yield sess
            sess.commit()
        except Exception:
            sess.rollback()
            raise
        finally:
            sess.close()

    concurrency_app.dependency_overrides[get_session] = _get_concurrency_session

    code = issue_setup_code(concurrency_app, settings, path=code_file)

    client_1 = TestClient(
        concurrency_app,
        base_url="http://testserver",
        headers={"Origin": "http://testserver"},
    )
    client_2 = TestClient(
        concurrency_app,
        base_url="http://testserver",
        headers={"Origin": "http://testserver"},
    )

    barrier = threading.Barrier(2)
    statuses: list[int] = []

    def _submit(c: TestClient, uname: str) -> None:
        barrier.wait()
        res = c.post(
            "/api/setup/admin",
            json={
                "setup_code": code,
                "username": uname,
                "full_name": "Race Admin",
                "password": "ValidAdminPassword123!",
            },
        )
        statuses.append(res.status_code)

    t1 = threading.Thread(target=_submit, args=(client_1, "race_admin_1"))
    t2 = threading.Thread(target=_submit, args=(client_2, "race_admin_2"))

    t1.start()
    t2.start()
    t1.join()
    t2.join()

    # Guaranteed exactly one 201 and one 410
    assert sorted(statuses) == [201, 410]

    # Verify single system_setup row
    with Session(app_engine) as sess:
        setup_count = sess.scalar(select(func.count(SystemSetup.id)))
        assert setup_count == 1


@pytest.mark.concurrency
def test_restart_after_setup_stays_closed(
    test_settings: Settings,
    tmp_path: Path,
) -> None:
    """After setup completion, a fresh app instance starts closed with no code issued."""
    code_path = tmp_path / "post_setup_code.txt"
    settings = Settings(
        env="test",
        db_name=test_settings.db_name,
        setup_code_path=code_path,
        argon2_time_cost=1,
        argon2_memory_cost=8,
        argon2_parallelism=1,
    )

    fresh_app = create_app(settings)
    with TestClient(
        fresh_app, base_url="http://testserver", headers={"Origin": "http://testserver"}
    ) as c:
        assert fresh_app.state.setup_code_hash is None
        assert not code_path.exists()

        status_res = c.get("/api/setup/status")
        assert status_res.status_code == 410
        assert status_res.json()["code"] == "setup_closed"
