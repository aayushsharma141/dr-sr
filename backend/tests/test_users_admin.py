"""Admin user provisioning, forced password change lifecycle, and mass-assignment tests."""

from typing import Any
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.models import AuditLog, Doctor, User


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
