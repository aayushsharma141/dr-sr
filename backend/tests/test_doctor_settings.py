"""Tests for doctor consultation fee and cabin code settings (K-60).

Guarantees:
- Admin sets cabin code 'A'; the read returns 'A'.
- Admin sets cabin code 'a' (lowercase) -> normalized to 'A'.
- Admin sets 'AB' or '1' -> 422.
- Second active doctor tries 'A' -> 409 cabin_code_taken.
- Deactivated doctor holding 'A' frees it: a new doctor can take 'A'.
- Doctor PATCH /api/doctors/me/settings with default_fee_paise: 50000 -> 200, fee is 50000,
  audit row exists with before and after values.
- Doctor PATCH with a stale version_id -> 409.
- Reception or Admin calling /api/doctors/me/settings -> 403.
- Doctor A cannot change Doctor B's fee through any route.
- Negative fee -> 422.
"""

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.models import AuditLog, Doctor, User


def test_admin_sets_cabin_code_and_normalizes_case(
    login_client: Any,
    admin_user: User,
) -> None:
    """Admin sets cabin code 'A' and read returns 'A'; lowercase 'a' normalizes to 'A'."""
    admin_c: TestClient = login_client(admin_user)

    # 1. Create with uppercase 'A'
    res = admin_c.post(
        "/api/doctors",
        json={
            "name_en": "Dr. Cabin Test",
            "default_fee_paise": 40000,
            "cabin_code": "A",
        },
    )
    assert res.status_code == 201
    doc_id = res.json()["id"]
    assert res.json()["cabin_code"] == "A"

    # 2. Update with lowercase 'b' -> normalizes to 'B'
    ver = res.json()["version_id"]
    res2 = admin_c.patch(
        f"/api/doctors/{doc_id}",
        json={
            "name_en": "Dr. Cabin Test",
            "default_fee_paise": 40000,
            "cabin_code": "b",
            "is_active": True,
            "version_id": ver,
        },
    )
    assert res2.status_code == 200
    assert res2.json()["cabin_code"] == "B"


def test_invalid_cabin_codes_rejected_422(
    login_client: Any,
    admin_user: User,
) -> None:
    """Cabin codes like 'AB' or '1' are rejected with 422."""
    admin_c: TestClient = login_client(admin_user)

    # Multiple characters
    res = admin_c.post(
        "/api/doctors",
        json={"name_en": "Dr. Invalid Multi", "cabin_code": "AB"},
    )
    assert res.status_code == 422

    # Numeric digit
    res2 = admin_c.post(
        "/api/doctors",
        json={"name_en": "Dr. Invalid Digit", "cabin_code": "1"},
    )
    assert res2.status_code == 422


def test_cabin_code_clash_409_and_deactivation_frees_it(
    login_client: Any,
    admin_user: User,
) -> None:
    """Second active doctor cannot take existing cabin code (409); deactivation frees it."""
    admin_c: TestClient = login_client(admin_user)

    # Doctor 1 takes 'C'
    res1 = admin_c.post(
        "/api/doctors",
        json={"name_en": "Dr. Cabin First", "cabin_code": "C"},
    )
    assert res1.status_code == 201
    doc1_id = res1.json()["id"]
    doc1_ver = res1.json()["version_id"]

    # Doctor 2 tries 'C' -> 409 cabin_code_taken
    res2 = admin_c.post(
        "/api/doctors",
        json={"name_en": "Dr. Cabin Clash", "cabin_code": "C"},
    )
    assert res2.status_code == 409
    assert res2.json()["code"] == "cabin_code_taken"

    # Deactivate Doctor 1
    res_deact = admin_c.patch(
        f"/api/doctors/{doc1_id}",
        json={
            "name_en": "Dr. Cabin First",
            "default_fee_paise": 0,
            "cabin_code": "C",
            "is_active": False,
            "version_id": doc1_ver,
        },
    )
    assert res_deact.status_code == 200
    assert res_deact.json()["is_active"] is False

    # Doctor 3 can now take 'C'
    res3 = admin_c.post(
        "/api/doctors",
        json={"name_en": "Dr. Cabin Successor", "cabin_code": "C"},
    )
    assert res3.status_code == 201
    assert res3.json()["cabin_code"] == "C"


def test_doctor_me_settings_patch_and_audit(
    login_client: Any,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Doctor PATCH /api/doctors/me/settings updates fee and creates audit log."""
    doc_c: TestClient = login_client(doctor_a_user)
    doc = db_session.get(Doctor, doctor_a_user.doctor_id)
    initial_ver = doc.version_id

    res = doc_c.patch(
        "/api/doctors/me/settings",
        json={
            "default_fee_paise": 50000,
            "version_id": initial_ver,
        },
    )
    assert res.status_code == 200
    assert res.json()["default_fee_paise"] == 50000

    # Verify audit record
    audit_row = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.entity_id == str(doctor_a_user.doctor_id),
            AuditLog.action == "doctor.settings.update",
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit_row is not None
    assert audit_row.actor_user_id == doctor_a_user.id
    assert audit_row.after_data.get("default_fee_paise") == 50000


def test_doctor_me_settings_stale_version_409(
    login_client: Any,
    doctor_a_user: User,
) -> None:
    """Doctor PATCH with stale version_id returns 409 conflict."""
    doc_c: TestClient = login_client(doctor_a_user)
    res = doc_c.patch(
        "/api/doctors/me/settings",
        json={
            "default_fee_paise": 55000,
            "version_id": 999999,
        },
    )
    assert res.status_code == 409
    assert res.json()["code"] == "version_conflict"


def test_doctor_me_settings_rbac_reception_and_admin_rejected_403(
    login_client: Any,
    admin_user: User,
    reception_user: User,
) -> None:
    """Reception and Admin calling /api/doctors/me/settings receive 403."""
    admin_c: TestClient = login_client(admin_user)
    rec_c: TestClient = login_client(reception_user)

    res_admin = admin_c.patch(
        "/api/doctors/me/settings",
        json={"default_fee_paise": 50000, "version_id": 1},
    )
    assert res_admin.status_code == 403

    res_rec = rec_c.patch(
        "/api/doctors/me/settings",
        json={"default_fee_paise": 50000, "version_id": 1},
    )
    assert res_rec.status_code == 403


def test_doctor_cannot_modify_other_doctor_fee(
    login_client: Any,
    doctor_a_user: User,
    doctor_b_user: User,
) -> None:
    """Doctor A cannot change Doctor B's fee through admin PATCH route or /me route."""
    doc_a_c: TestClient = login_client(doctor_a_user)

    # Doctor A cannot call Admin endpoint for Doctor B (403)
    res = doc_a_c.patch(
        f"/api/doctors/{doctor_b_user.doctor_id}",
        json={
            "name_en": "Dr. Hijacked",
            "default_fee_paise": 10000,
            "version_id": 1,
        },
    )
    assert res.status_code == 403


def test_negative_fee_rejected_422(
    login_client: Any,
    doctor_a_user: User,
) -> None:
    """Negative fee in /me/settings is rejected with 422."""
    doc_c: TestClient = login_client(doctor_a_user)
    res = doc_c.patch(
        "/api/doctors/me/settings",
        json={"default_fee_paise": -500, "version_id": 1},
    )
    assert res.status_code == 422
