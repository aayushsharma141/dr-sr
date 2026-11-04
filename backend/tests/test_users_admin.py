"""Admin user provisioning, forced password change lifecycle, and mass-assignment tests."""

from datetime import timedelta
from typing import Any
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.core.errors import ApiError
from kalyan_api.models import AuditLog, AuthSession, Doctor, User
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction, AuditContext
from kalyan_api.services.user_service import deactivate_user
from tests.conftest import TEST_PASSWORD, make_user
from tests.test_route_policies import walk_routes


def test_admin_create_user_and_forced_change_flow(
    app: FastAPI,
    db_session: Session,
    test_settings: Settings,
    login_client: Any,
    admin_user: User,
) -> None:
    """Admin creates a user; user logs in with temporary password and must change it."""
    admin_c = login_client(admin_user)

    # 1. Admin creates a RECEPTION user
    create_payload = {
        "username": "new_receptionist",
        "full_name": "Rani Verma",
        "role": "RECEPTION",
    }
    resp = admin_c.post("/api/users", json=create_payload)
    assert resp.status_code == 201
    assert resp.headers.get("Cache-Control") == "no-store"

    data = resp.json()
    assert data["username"] == "new_receptionist"
    assert data["full_name"] == "Rani Verma"
    assert data["role"] == "RECEPTION"
    assert data["must_change_password"] is True
    assert data["version_id"] == 1
    assert data["doctor_id"] is None

    temp_password = data["temporary_password"]
    assert len(temp_password) == test_settings.temp_password_length
    # Verify no ambiguous characters (0, O, 1, l, I)
    for ch in ("0", "O", "1", "l", "I"):
        assert ch not in temp_password

    # 2. GET detail verifies version_id present and secrets omitted
    get_res = admin_c.get(f"/api/users/{data['id']}")
    assert get_res.status_code == 200
    detail = get_res.json()
    assert detail["version_id"] == 1
    assert "password_hash" not in detail
    assert "temporary_password" not in detail

    # 3. GET list includes the new user and omits secrets
    list_res = admin_c.get("/api/users")
    assert list_res.status_code == 200
    users_list = list_res.json()
    created_item = next(u for u in users_list if u["id"] == data["id"])
    assert created_item["version_id"] == 1
    assert "password_hash" not in created_item
    assert "temporary_password" not in created_item

    # 4. New user signs in with the temporary password
    user_c = TestClient(app, base_url="http://testserver", headers={"Origin": "http://testserver"})
    login_res = user_c.post(
        "/api/auth/login",
        json={"username": "new_receptionist", "password": temp_password},
    )
    assert login_res.status_code == 200
    login_data = login_res.json()
    assert login_data["must_change_password"] is True
    user_c.headers["X-CSRF-Token"] = login_data["csrf_token"]

    # 5. Accessing protected endpoint returns 403 password_change_required
    ov_res = user_c.get("/api/reception/overview")
    assert ov_res.status_code == 403
    assert ov_res.json()["code"] == "password_change_required"

    # 6. User completes forced password change
    new_password = "ValidNewSecretPassword123!"
    change_res = user_c.post(
        "/api/auth/change-password",
        json={"current_password": temp_password, "new_password": new_password},
    )
    assert change_res.status_code == 200
    changed_data = change_res.json()
    assert changed_data["must_change_password"] is False
    user_c.headers["X-CSRF-Token"] = changed_data["csrf_token"]

    # 7. User now successfully reaches reception dashboard
    ov_after = user_c.get("/api/reception/overview")
    assert ov_after.status_code == 200
    assert ov_after.json()["area"] == "reception"


def test_create_doctor_requires_doctor_name_en_and_creates_stub(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """Creating a DOCTOR user requires doctor_name_en and creates linked doctor stub."""
    admin_c = login_client(admin_user)

    # 1. DOCTOR without doctor_name_en -> 422
    fail_res = admin_c.post(
        "/api/users",
        json={"username": "dr_missing", "full_name": "Dr. Missing", "role": "DOCTOR"},
    )
    assert fail_res.status_code == 422

    # 2. ADMIN with doctor_name_en -> 422
    admin_fail = admin_c.post(
        "/api/users",
        json={
            "username": "admin_invalid",
            "full_name": "Admin Invalid",
            "role": "ADMIN",
            "doctor_name_en": "Not Allowed",
        },
    )
    assert admin_fail.status_code == 422

    # 3. DOCTOR with valid doctor_name_en -> 201 and doctor row created
    succ_res = admin_c.post(
        "/api/users",
        json={
            "username": "dr_arun",
            "full_name": "Arun Kumar",
            "role": "DOCTOR",
            "doctor_name_en": "Dr. Arun Kumar",
        },
    )
    assert succ_res.status_code == 201
    doc_user_data = succ_res.json()
    assert doc_user_data["doctor_id"] is not None

    # Verify doctor row in database
    doctor_row = db_session.get(Doctor, doc_user_data["doctor_id"])
    assert doctor_row is not None
    assert doctor_row.name_en == "Dr. Arun Kumar"


def test_duplicate_username_case_insensitive_returns_409(
    login_client: Any,
    admin_user: User,
) -> None:
    """Duplicate username returns 409 username_taken case-insensitively."""
    admin_c = login_client(admin_user)

    # First creation
    r1 = admin_c.post(
        "/api/users",
        json={"username": "test_clash", "full_name": "First User", "role": "RECEPTION"},
    )
    assert r1.status_code == 201

    # Second creation with uppercase characters
    r2 = admin_c.post(
        "/api/users",
        json={"username": "TEST_CLASH", "full_name": "Second User", "role": "RECEPTION"},
    )
    assert r2.status_code == 409
    assert r2.json()["code"] == "username_taken"


def test_mass_assignment_extra_fields_rejected_with_422(
    login_client: Any,
    admin_user: User,
) -> None:
    """Extra unpermitted or privileged fields trigger 422 validation error."""
    admin_c = login_client(admin_user)

    payloads = [
        {"username": "ex1", "full_name": "H", "role": "RECEPTION", "password_hash": "evil"},
        {"username": "ex2", "full_name": "H", "role": "RECEPTION", "is_active": True},
        {"username": "ex3", "full_name": "H", "role": "RECEPTION", "version_id": 99},
        {"username": "ex4", "full_name": "H", "role": "RECEPTION", "locked_until": "2030-01-01"},
        {"username": "ex5", "full_name": "H", "role": "RECEPTION", "failed_login_count": 0},
    ]

    for p in payloads:
        res = admin_c.post("/api/users", json=p)
        assert res.status_code == 422, f"Expected 422 for payload {p}, got {res.status_code}"


def test_user_created_audit_event_logged_safely(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """USER_CREATED audit row logs role, full_name, doctor_id and NEVER passwords."""
    admin_c = login_client(admin_user)

    res = admin_c.post(
        "/api/users",
        json={"username": "audit_user", "full_name": "Audit Sample", "role": "RECEPTION"},
    )
    assert res.status_code == 201
    created_id = res.json()["id"]

    audit_row = db_session.scalar(
        select(AuditLog)
        .where(AuditLog.action == "USER_CREATED", AuditLog.entity_id == str(created_id))
        .order_by(AuditLog.id.desc())
    )
    assert audit_row is not None
    assert audit_row.actor_user_id == admin_user.id
    assert audit_row.after_data == {
        "role": "RECEPTION",
        "full_name": "Audit Sample",
        "doctor_id": None,
    }
    # Guarantee password text never appears anywhere in audit row
    for field in (audit_row.before_data, audit_row.after_data, audit_row.reason):
        text_dump = str(field)
        assert "password" not in text_dump.lower()


def test_fail_closed_creation_rolls_back_user_and_doctor(
    app: FastAPI,
    admin_user: User,
    db_session: Session,
) -> None:
    """If audit.record fails, user and doctor rows are not committed (fail-closed)."""
    admin_c = TestClient(
        app,
        base_url="http://testserver",
        headers={"Origin": "http://testserver"},
        raise_server_exceptions=False,
    )
    login_res = admin_c.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": "ValidTestPassword123!"},
    )
    assert login_res.status_code == 200
    admin_c.headers["X-CSRF-Token"] = login_res.json()["csrf_token"]

    err = RuntimeError("Audit write crashed")
    with patch("kalyan_api.services.audit_service.record", side_effect=err):
        res = admin_c.post(
            "/api/users",
            json={
                "username": "fail_closed_doc",
                "full_name": "Fail Closed",
                "role": "DOCTOR",
                "doctor_name_en": "Dr. Fail Closed",
            },
        )
        assert res.status_code == 500

    # Verify no doctor or user row exists
    user_exists = db_session.scalar(
        select(func.count(User.id)).where(User.username == "fail_closed_doc")
    )
    assert user_exists == 0

    doctor_exists = db_session.scalar(
        select(func.count(Doctor.id)).where(Doctor.name_en == "Dr. Fail Closed")
    )
    assert doctor_exists == 0


def test_deactivate_and_reactivate_lifecycle(
    app: FastAPI,
    db_session: Session,
    login_client: Any,
    admin_user: User,
    test_settings: Settings,
) -> None:
    """Admin deactivates user; sessions die, row stays; reactivate restores login."""
    admin_c = login_client(admin_user)
    target = make_user(db_session, test_settings, "RECEPTION", "deact_target")

    # Target logs in and verifies session works
    target_c = login_client(target)
    ov = target_c.get("/api/reception/overview")
    assert ov.status_code == 200

    total_before = db_session.scalar(select(func.count(User.id)))
    initial_version = target.version_id

    # Admin deactivates target
    deact_res = admin_c.post(
        f"/api/users/{target.id}/deactivate",
        json={"version_id": initial_version},
    )
    assert deact_res.status_code == 200
    deact_data = deact_res.json()
    assert deact_data["is_active"] is False
    assert deact_data["version_id"] == initial_version + 1

    # Old session is now rejected (401)
    ov_after = target_c.get("/api/reception/overview")
    assert ov_after.status_code == 401

    # New login attempt returns generic 401
    anon_c = TestClient(app, base_url="http://testserver", headers={"Origin": "http://testserver"})
    login_attempt = anon_c.post(
        "/api/auth/login",
        json={"username": target.username, "password": TEST_PASSWORD},
    )
    assert login_attempt.status_code == 401
    assert login_attempt.json()["code"] == "invalid_credentials"

    # Row is preserved (never deleted)
    total_after = db_session.scalar(select(func.count(User.id)))
    assert total_after == total_before

    # Verify USER_DEACTIVATED audit log
    audit_deact = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "USER_DEACTIVATED",
            AuditLog.entity_id == str(target.id),
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit_deact is not None
    assert audit_deact.actor_user_id == admin_user.id
    assert audit_deact.before_data == {"is_active": True}
    assert audit_deact.after_data == {"is_active": False}

    # Admin reactivates target
    react_res = admin_c.post(
        f"/api/users/{target.id}/reactivate",
        json={"version_id": deact_data["version_id"]},
    )
    assert react_res.status_code == 200
    react_data = react_res.json()
    assert react_data["is_active"] is True
    assert react_data["version_id"] == deact_data["version_id"] + 1

    # User can log in again
    relogin = anon_c.post(
        "/api/auth/login",
        json={"username": target.username, "password": TEST_PASSWORD},
    )
    assert relogin.status_code == 200

    # Verify USER_REACTIVATED audit log
    audit_react = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "USER_REACTIVATED",
            AuditLog.entity_id == str(target.id),
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit_react is not None
    assert audit_react.actor_user_id == admin_user.id
    assert audit_react.before_data == {"is_active": False}
    assert audit_react.after_data == {"is_active": True}


def test_deactivate_guards(
    db_session: Session,
    login_client: Any,
    test_settings: Settings,
    without_active_admins: None,
) -> None:
    """Guard enforcement: self-deactivation, last admin, stale version, unchanged state."""
    # Since without_active_admins ran, we recreate active admins
    adm1 = make_user(db_session, test_settings, "ADMIN", "guard_admin_1")
    adm1_c = login_client(adm1)

    target = make_user(db_session, test_settings, "RECEPTION", "guard_target")

    # 1. Self-deactivation forbidden
    self_res = adm1_c.post(
        f"/api/users/{adm1.id}/deactivate",
        json={"version_id": adm1.version_id},
    )
    assert self_res.status_code == 409
    assert self_res.json()["code"] == "self_action_forbidden"

    # 2. Last admin deactivation forbidden
    # Direct service call simulating CLI or separate context
    with pytest.raises(ApiError) as exc_info:
        deactivate_user(
            db_session,
            AuditContext.system("cli:test"),
            adm1.id,
            adm1.version_id,
        )
    assert exc_info.value.status_code == 409
    assert exc_info.value.code == "last_admin"

    # Add a second admin
    adm2 = make_user(db_session, test_settings, "ADMIN", "guard_admin_2")
    # Now deactivating adm1 succeeds because adm2 is still active
    deact_adm1 = deactivate_user(
        db_session,
        AuditContext.system("cli:test"),
        adm1.id,
        adm1.version_id,
    )
    assert deact_adm1.is_active is False

    # Now deactivating adm2 fails because adm2 is now the last active admin
    with pytest.raises(ApiError) as exc_info2:
        deactivate_user(
            db_session,
            AuditContext.system("cli:test"),
            adm2.id,
            adm2.version_id,
        )
    assert exc_info2.value.status_code == 409
    assert exc_info2.value.code == "last_admin"

    # Use active adm2 client for subsequent HTTP calls
    adm2_c = login_client(adm2)

    # 3. Stale version returns 409 version_conflict
    stale_res = adm2_c.post(
        f"/api/users/{target.id}/deactivate",
        json={"version_id": target.version_id + 99},
    )
    assert stale_res.status_code == 409
    assert stale_res.json()["code"] == "version_conflict"

    # 4. Deactivate already deactivated returns 409 state_unchanged
    # First deactivation:
    ok_res = adm2_c.post(
        f"/api/users/{target.id}/deactivate",
        json={"version_id": target.version_id},
    )
    assert ok_res.status_code == 200
    new_version = ok_res.json()["version_id"]

    dup_res = adm2_c.post(
        f"/api/users/{target.id}/deactivate",
        json={"version_id": new_version},
    )
    assert dup_res.status_code == 409
    assert dup_res.json()["code"] == "state_unchanged"

    # 5. Reactivate already active returns 409 state_unchanged
    active_user = make_user(db_session, test_settings, "RECEPTION", "already_active_user")
    react_active_res = adm2_c.post(
        f"/api/users/{active_user.id}/reactivate",
        json={"version_id": active_user.version_id},
    )
    assert react_active_res.status_code == 409
    assert react_active_res.json()["code"] == "state_unchanged"


def test_users_never_deleted_database_permission_denied(
    app: FastAPI,
    app_engine: Engine,
) -> None:
    """Users cannot be deleted: raw DB DELETE fails with permission denied; no DELETE route."""
    # 1. kalyan_app role executing DELETE FROM users raises permission denied
    with app_engine.connect() as conn:
        with pytest.raises(Exception) as exc_info:
            conn.execute(text("DELETE FROM users"))
        err_msg = str(exc_info.value).lower()
        assert "permission denied" in err_msg

    # 2. walk_routes finds no DELETE route under /api/users
    delete_routes = [
        (method, path)
        for method, path, _ in walk_routes(app)
        if method == "DELETE" and path.startswith("/api/users")
    ]
    assert delete_routes == [], f"Found forbidden DELETE route(s) on users: {delete_routes}"


def test_admin_reset_password_lifecycle(
    app: FastAPI,
    db_session: Session,
    login_client: Any,
    admin_user: User,
    test_settings: Settings,
    clock: dict[str, Any],
) -> None:
    """Admin resets password: one-time temporary password, forced change.

    Verifies sessions revoked and audit logged without exposing secrets.
    """
    admin_c = login_client(admin_user)
    target = make_user(db_session, test_settings, "RECEPTION", "reset_target")

    # Target logs in and has an active session
    target_c = login_client(target)
    assert target_c.get("/api/reception/overview").status_code == 200

    # Admin resets target's password
    initial_version = target.version_id
    reset_res = admin_c.post(
        f"/api/users/{target.id}/reset-password",
        json={"version_id": initial_version},
    )
    assert reset_res.status_code == 200
    assert reset_res.headers.get("Cache-Control") == "no-store"
    data = reset_res.json()
    assert "temporary_password" in data
    temp_pwd = data["temporary_password"]
    assert len(temp_pwd) == test_settings.temp_password_length
    assert data["must_change_password"] is True
    assert data["version_id"] == initial_version + 1

    # Old session is now revoked (401)
    assert target_c.get("/api/reception/overview").status_code == 401

    # Old password fails (401)
    anon_c = TestClient(app, base_url="http://testserver", headers={"Origin": "http://testserver"})
    old_pw_res = anon_c.post(
        "/api/auth/login",
        json={"username": target.username, "password": TEST_PASSWORD},
    )
    assert old_pw_res.status_code == 401

    # New temporary password signs in
    new_login_res = anon_c.post(
        "/api/auth/login",
        json={"username": target.username, "password": temp_pwd},
    )
    assert new_login_res.status_code == 200
    login_info = new_login_res.json()
    assert login_info["must_change_password"] is True
    anon_c.headers["X-CSRF-Token"] = login_info["csrf_token"]

    # Calling protected endpoint returns 403 password_change_required
    assert anon_c.get("/api/reception/overview").status_code == 403

    # Forced password change works
    brand_new_pw = "NewTargetPassword123!"
    change_res = anon_c.post(
        "/api/auth/change-password",
        json={"current_password": temp_pwd, "new_password": brand_new_pw},
    )
    assert change_res.status_code == 200
    anon_c.headers["X-CSRF-Token"] = change_res.json()["csrf_token"]
    assert anon_c.get("/api/reception/overview").status_code == 200

    # Audit check: USER_PASSWORD_RESET payload exactly {"must_change_password": True}
    audit_row = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "USER_PASSWORD_RESET",
            AuditLog.entity_id == str(target.id),
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit_row is not None
    assert audit_row.actor_user_id == admin_user.id
    assert audit_row.after_data == {"must_change_password": True}
    # Temporary password or password_hash NEVER appears in audit row
    for field in (audit_row.before_data, audit_row.after_data, audit_row.reason):
        dump = str(field).lower()
        assert temp_pwd.lower() not in dump
        assert "password_hash" not in dump

    # Guard: Self-reset is forbidden
    self_reset = admin_c.post(
        f"/api/users/{admin_user.id}/reset-password",
        json={"version_id": admin_user.version_id},
    )
    assert self_reset.status_code == 409
    assert self_reset.json()["code"] == "self_action_forbidden"

    # Reset does NOT clear lockout state
    t0 = clock["t"]
    locked_user = make_user(db_session, test_settings, "RECEPTION", "locked_for_reset")
    locked_user.failed_login_count = 5
    locked_user.locked_until = t0 + timedelta(minutes=15)
    db_session.flush()

    reset_locked_res = admin_c.post(
        f"/api/users/{locked_user.id}/reset-password",
        json={"version_id": locked_user.version_id},
    )
    assert reset_locked_res.status_code == 200
    db_session.refresh(locked_user)
    assert locked_user.failed_login_count == 5
    assert locked_user.locked_until == t0 + timedelta(minutes=15)


def test_admin_unlock_lifecycle(
    app: FastAPI,
    db_session: Session,
    login_client: Any,
    admin_user: User,
    test_settings: Settings,
    clock: dict[str, Any],
) -> None:
    """Admin unlocks locked account (D-07 override).

    Verifies counters zeroed and sign-in restored before cooldown expires.
    """
    admin_c = login_client(admin_user)
    t0 = clock["t"]
    user = make_user(db_session, test_settings, "RECEPTION", "unlock_target")

    # Lock user
    user.failed_login_count = 5
    user.locked_until = t0 + timedelta(minutes=15)
    db_session.flush()

    anon_c = TestClient(app, base_url="http://testserver", headers={"Origin": "http://testserver"})
    # Attempting to sign in with correct password fails while locked
    locked_attempt = anon_c.post(
        "/api/auth/login",
        json={"username": user.username, "password": TEST_PASSWORD},
    )
    assert locked_attempt.status_code == 401

    # Stale version returns 409 version_conflict
    stale_unlock = admin_c.post(
        f"/api/users/{user.id}/unlock",
        json={"version_id": user.version_id + 99},
    )
    assert stale_unlock.status_code == 409
    assert stale_unlock.json()["code"] == "version_conflict"

    # Admin unlocks user
    curr_version = user.version_id
    unlock_res = admin_c.post(
        f"/api/users/{user.id}/unlock",
        json={"version_id": curr_version},
    )
    assert unlock_res.status_code == 200
    unlock_data = unlock_res.json()
    assert unlock_data["version_id"] == curr_version + 1

    # Database state refreshed
    db_session.refresh(user)
    assert user.failed_login_count == 0
    assert user.locked_until is None

    # User can immediately sign in with correct password before cooldown expires!
    succ_login = anon_c.post(
        "/api/auth/login",
        json={"username": user.username, "password": TEST_PASSWORD},
    )
    assert succ_login.status_code == 200

    # Verify USER_UNLOCKED audit event
    audit_unlock = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "USER_UNLOCKED",
            AuditLog.entity_id == str(user.id),
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit_unlock is not None
    assert audit_unlock.actor_user_id == admin_user.id
    assert audit_unlock.before_data["failed_login_count"] == 5
    assert audit_unlock.before_data["locked_until"] == (t0 + timedelta(minutes=15)).isoformat()
    assert audit_unlock.after_data == {"failed_login_count": 0, "locked_until": None}

    # Unlocking clean account returns 409 state_unchanged
    clean_unlock = admin_c.post(
        f"/api/users/{user.id}/unlock",
        json={"version_id": unlock_data["version_id"]},
    )
    assert clean_unlock.status_code == 409
    assert clean_unlock.json()["code"] == "state_unchanged"


def test_user_out_exposes_lock_and_credential_change_times(
    login_client: Any,
    admin_user: User,
    db_session: Session,
    test_settings: Settings,
    clock: dict[str, Any],
) -> None:
    """UserOut carries locked_until (only while locked) and password_changed_at."""
    admin_c = login_client(admin_user)
    target = make_user(db_session, test_settings, "RECEPTION", "out_fields_target")

    fresh = admin_c.get(f"/api/users/{target.id}").json()
    assert fresh["locked_until"] is None
    assert fresh["password_changed_at"] is None
    assert "password_hash" not in fresh

    lock_until = clock["t"] + timedelta(minutes=15)
    target.failed_login_count = 5
    target.locked_until = lock_until
    db_session.flush()
    locked = admin_c.get(f"/api/users/{target.id}").json()
    assert locked["is_locked"] is True
    assert locked["locked_until"] is not None
    assert locked["locked_until"].startswith(lock_until.strftime("%Y-%m-%dT%H:%M"))

    # An expired lock is reported as not locked with no locked_until
    clock["t"] += timedelta(minutes=16)
    expired = admin_c.get(f"/api/users/{target.id}").json()
    assert expired["is_locked"] is False
    assert expired["locked_until"] is None

    # password_changed_at is set after the user changes their password
    target.failed_login_count = 0
    target.locked_until = None
    db_session.flush()
    user_c = login_client(target)
    change = user_c.post(
        "/api/auth/change-password",
        json={"current_password": TEST_PASSWORD, "new_password": "BrandNewSecret#2026"},
    )
    assert change.status_code == 200
    changed = login_client(admin_user).get(f"/api/users/{target.id}").json()
    assert changed["password_changed_at"] is not None

    listed = login_client(admin_user).get("/api/users").json()
    assert all("password_changed_at" in u and "locked_until" in u for u in listed)


def test_lifecycle_actions_store_optional_reason_in_audit(
    login_client: Any,
    admin_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    """deactivate, reactivate, reset-password and unlock accept an optional audited reason."""
    admin_c = login_client(admin_user)
    target = make_user(db_session, test_settings, "RECEPTION", "reason_target")

    def _latest(action: str) -> AuditLog:
        row = db_session.scalar(
            select(AuditLog)
            .where(AuditLog.action == action, AuditLog.entity_id == str(target.id))
            .order_by(AuditLog.id.desc())
        )
        assert row is not None
        return row

    too_long = admin_c.post(
        f"/api/users/{target.id}/deactivate",
        json={"version_id": target.version_id, "reason": "x" * 501},
    )
    assert too_long.status_code == 422

    res = admin_c.post(
        f"/api/users/{target.id}/deactivate",
        json={"version_id": target.version_id, "reason": "Resigned"},
    )
    assert res.status_code == 200
    assert _latest("USER_DEACTIVATED").reason == "Resigned"

    res = admin_c.post(
        f"/api/users/{target.id}/reactivate",
        json={"version_id": res.json()["version_id"], "reason": "Rejoined"},
    )
    assert res.status_code == 200
    assert _latest("USER_REACTIVATED").reason == "Rejoined"

    res = admin_c.post(
        f"/api/users/{target.id}/reset-password",
        json={"version_id": res.json()["version_id"], "reason": "Forgot password"},
    )
    assert res.status_code == 200
    reset_row = _latest("USER_PASSWORD_RESET")
    assert reset_row.reason == "Forgot password"
    assert reset_row.before_data == {"must_change_password": False}
    assert reset_row.after_data == {"must_change_password": True}

    db_session.refresh(target)
    target.failed_login_count = 5
    db_session.flush()
    db_session.refresh(target)
    res = admin_c.post(
        f"/api/users/{target.id}/unlock",
        json={"version_id": target.version_id, "reason": "  Verified by phone  "},
    )
    assert res.status_code == 200
    assert _latest("USER_UNLOCKED").reason == "Verified by phone"

    # Reason remains optional (backward compatible)
    res = admin_c.post(
        f"/api/users/{target.id}/deactivate", json={"version_id": res.json()["version_id"]}
    )
    assert res.status_code == 200
    assert _latest("USER_DEACTIVATED").reason is None


def test_login_history_lists_security_events_for_user(
    app: FastAPI,
    login_client: Any,
    admin_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    """History holds the user's auth, unlock, reset and revocation events only, newest first."""
    admin_c = login_client(admin_user)
    target = make_user(db_session, test_settings, "RECEPTION", "history_target")
    other = make_user(db_session, test_settings, "RECEPTION", "history_other")
    anon_c = TestClient(app, base_url="http://testserver", headers={"Origin": "http://testserver"})

    # Successful login, then admin revokes that session
    login_client(target)
    login_client(other)
    target_sid = db_session.scalar(
        select(AuthSession.id).where(
            AuthSession.user_id == target.id, AuthSession.revoked_at.is_(None)
        )
    )
    revoke = admin_c.post(f"/api/sessions/{target_sid}/revoke", json={"reason": "Stale terminal"})
    assert revoke.status_code == 200

    # Wrong passwords up to the threshold lock the account
    for _ in range(test_settings.lockout_threshold):
        anon_c.post(
            "/api/auth/login", json={"username": target.username, "password": "WrongPass!999x"}
        )
    version = admin_c.get(f"/api/users/{target.id}").json()["version_id"]
    unlock = admin_c.post(
        f"/api/users/{target.id}/unlock", json={"version_id": version, "reason": "Called desk"}
    )
    assert unlock.status_code == 200
    bulk = admin_c.post(f"/api/users/{target.id}/revoke-sessions", json={"reason": "Precaution"})
    assert bulk.status_code == 200
    reset = admin_c.post(
        f"/api/users/{target.id}/reset-password",
        json={"version_id": unlock.json()["version_id"]},
    )
    assert reset.status_code == 200
    temp_password = reset.json()["temporary_password"]
    # A non-security update must not appear in login history
    rename = admin_c.patch(
        f"/api/users/{target.id}",
        json={"version_id": reset.json()["version_id"], "full_name": "History Renamed"},
    )
    assert rename.status_code == 200

    res = admin_c.get(f"/api/users/{target.id}/login-history")
    assert res.status_code == 200
    entries = res.json()
    assert temp_password not in res.text
    actions = [e["action"] for e in entries]
    assert actions == [
        "USER_PASSWORD_RESET",
        "USER_SESSIONS_REVOKED",
        "USER_UNLOCKED",
        "AUTH_ACCOUNT_LOCKED",
        *["AUTH_LOGIN_FAILED"] * test_settings.lockout_threshold,
        "SESSION_REVOKED",
        "AUTH_LOGIN_SUCCEEDED",
    ]
    assert "USER_UPDATED" not in actions
    for entry in entries:
        assert set(entry.keys()) == {
            "id",
            "occurred_at",
            "action",
            "outcome",
            "actor_username",
            "ip_address",
            "user_agent",
            "reason",
            "details",
        }
        for key in entry["details"]:
            assert "password" not in key or key == "must_change_password"
            assert "token" not in key

    by_action = {e["action"]: e for e in entries}
    assert by_action["SESSION_REVOKED"]["reason"] == "Stale terminal"
    assert by_action["SESSION_REVOKED"]["actor_username"] == admin_user.username
    assert by_action["USER_UNLOCKED"]["reason"] == "Called desk"
    assert by_action["USER_SESSIONS_REVOKED"]["reason"] == "Precaution"
    assert by_action["USER_SESSIONS_REVOKED"]["details"]["revoked_count"] == 0
    assert by_action["AUTH_ACCOUNT_LOCKED"]["details"]["failed_login_count"] == (
        test_settings.lockout_threshold
    )
    assert by_action["AUTH_ACCOUNT_LOCKED"]["outcome"] == "FAILURE"
    assert by_action["USER_PASSWORD_RESET"]["details"]["must_change_password"] is True
    assert by_action["AUTH_LOGIN_SUCCEEDED"]["details"]["session_id"] == str(target_sid)

    # Another user's history does not include the target's events
    other_hist = admin_c.get(f"/api/users/{other.id}/login-history").json()
    assert [e["action"] for e in other_hist] == ["AUTH_LOGIN_SUCCEEDED"]


def test_login_history_limit_authorization_and_404(
    client: TestClient,
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Latest 50 rows only; RECEPTION/DOCTOR 403; anonymous 401; unknown user 404."""
    ctx = AuditContext.system("test:history")
    for i in range(55):
        audit_service.record(
            db_session,
            ctx,
            AuditAction.AUTH_LOGIN_FAILED,
            "USER",
            reception_user.id,
            after={"failed_login_count": i},
            outcome="FAILURE",
        )
    admin_c = login_client(admin_user)
    res = admin_c.get(f"/api/users/{reception_user.id}/login-history")
    assert res.status_code == 200
    entries = res.json()
    assert len(entries) == 50
    assert entries[0]["details"]["failed_login_count"] == 54

    assert admin_c.get("/api/users/99999999/login-history").status_code == 404
    path = f"/api/users/{reception_user.id}/login-history"
    assert client.get(path).status_code == 401
    assert login_client(reception_user).get(path).status_code == 403
    assert login_client(doctor_a_user).get(path).status_code == 403
