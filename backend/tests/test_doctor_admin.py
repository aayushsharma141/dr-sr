"""Tests for Doctor Profiles and Fee Schedules REST API (SET-02, SET-03).

Guarantees:
- Doctors:
  - GET /api/doctors lists active doctors (accessible to all authenticated roles).
  - POST /api/doctors restricted to ADMIN, creates doctor and records DOCTOR_CREATED audit.
  - PATCH /api/doctors/{id} restricted to ADMIN, updates doctor, protects against
    stale version_id (409), and records DOCTOR_UPDATED audit.
- Fees:
  - GET /api/fees lists active fee schedules (accessible to all authenticated roles).
  - POST /api/fees restricted to ADMIN, creates fee schedule and records FEE_CREATED audit.
  - PATCH /api/fees/{id} restricted to ADMIN, updates fee schedule and records FEE_UPDATED audit.
"""

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.models import AuditLog, User


def test_doctor_endpoints_anonymous_rejected(client: TestClient) -> None:
    """Anonymous access to doctor and fee endpoints is rejected with 401."""
    assert client.get("/api/doctors").status_code == 401
    assert client.post("/api/doctors", json={"name_en": "Dr. Test"}).status_code == 401
    assert client.get("/api/fees").status_code == 401
    assert client.post("/api/fees", json={"name": "General", "fee_paise": 20000}).status_code == 401


def test_doctor_creation_and_listing_rbac(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Only ADMIN can create doctors; RECEPTION and DOCTOR can list active doctors."""
    admin_c = login_client(admin_user)
    rec_c = login_client(reception_user)
    doc_c = login_client(doctor_a_user)

    # Reception cannot create doctor (403)
    rec_create_resp = rec_c.post(
        "/api/doctors",
        json={
            "name_en": "Dr. Unauthorized",
            "qualification": "MBBS",
            "registration_number": "MED-9999",
            "default_fee_paise": 30000,
        },
    )
    assert rec_create_resp.status_code == 403

    # Doctor cannot create doctor (403)
    doc_create_resp = doc_c.post(
        "/api/doctors",
        json={
            "name_en": "Dr. Unauthorized 2",
            "qualification": "MD",
            "registration_number": "MED-9998",
            "default_fee_paise": 30000,
        },
    )
    assert doc_create_resp.status_code == 403

    # Admin creates doctor successfully (201)
    admin_create_resp = admin_c.post(
        "/api/doctors",
        json={
            "name_en": "Dr. Ramesh Chandra",
            "name_hi": "डॉ. रमेश चंद्र",
            "qualification": "MBBS, MS (Ortho)",
            "registration_number": "BH-12345",
            "default_fee_paise": 50000,
        },
    )
    assert admin_create_resp.status_code == 201
    created_doc = admin_create_resp.json()
    assert created_doc["name_en"] == "Dr. Ramesh Chandra"
    assert created_doc["name_hi"] == "डॉ. रमेश चंद्र"
    assert created_doc["qualification"] == "MBBS, MS (Ortho)"
    assert created_doc["registration_number"] == "BH-12345"
    assert created_doc["default_fee_paise"] == 50000
    assert created_doc["is_active"] is True
    assert created_doc["version_id"] == 1

    # Verify audit event DOCTOR_CREATED
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "DOCTOR_CREATED",
            AuditLog.entity_id == str(created_doc["id"]),
        )
    )
    assert audit is not None
    assert audit.actor_user_id == admin_user.id
    assert audit.after_data["registration_number"] == "BH-12345"

    # Reception can list active doctors
    rec_list_resp = rec_c.get("/api/doctors")
    assert rec_list_resp.status_code == 200
    names = [d["name_en"] for d in rec_list_resp.json()]
    assert "Dr. Ramesh Chandra" in names


def test_doctor_update_and_optimistic_concurrency(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    db_session: Session,
) -> None:
    """Admin updates doctor profile; verifies version increment and 409 on conflict."""
    admin_c = login_client(admin_user)
    rec_c = login_client(reception_user)

    # 1. Create a doctor
    create_resp = admin_c.post(
        "/api/doctors",
        json={
            "name_en": "Dr. Sushil Sharma",
            "name_hi": "डॉ. सुशील शर्मा",
            "qualification": "MBBS, DNB",
            "registration_number": "BH-54321",
            "default_fee_paise": 40000,
        },
    )
    assert create_resp.status_code == 201
    doc_id = create_resp.json()["id"]

    # 2. Reception cannot update (403)
    rec_patch_resp = rec_c.patch(
        f"/api/doctors/{doc_id}",
        json={
            "name_en": "Dr. Hacked",
            "name_hi": None,
            "qualification": None,
            "registration_number": None,
            "default_fee_paise": 10000,
            "is_active": True,
            "version_id": 1,
        },
    )
    assert rec_patch_resp.status_code == 403

    # 3. Mismatched version_id returns 409 Conflict
    conflict_resp = admin_c.patch(
        f"/api/doctors/{doc_id}",
        json={
            "name_en": "Dr. Sushil Sharma",
            "name_hi": "डॉ. सुशील शर्मा",
            "qualification": "MBBS, DNB (Ortho)",
            "registration_number": "BH-54321",
            "default_fee_paise": 45000,
            "is_active": True,
            "version_id": 999,
        },
    )
    assert conflict_resp.status_code == 409
    body = conflict_resp.json()
    assert body["code"] == "version_conflict"

    # 4. Correct version_id succeeds, increments version_id to 2, and audits
    valid_resp = admin_c.patch(
        f"/api/doctors/{doc_id}",
        json={
            "name_en": "Dr. Sushil Sharma",
            "name_hi": "डॉ. सुशील शर्मा",
            "qualification": "MBBS, DNB (Ortho)",
            "registration_number": "BH-54321-REVISED",
            "default_fee_paise": 45000,
            "is_active": True,
            "version_id": 1,
        },
    )
    assert valid_resp.status_code == 200
    updated_doc = valid_resp.json()
    assert updated_doc["version_id"] == 2
    assert updated_doc["qualification"] == "MBBS, DNB (Ortho)"
    assert updated_doc["default_fee_paise"] == 45000

    # Verify audit event DOCTOR_UPDATED
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "DOCTOR_UPDATED",
            AuditLog.entity_id == str(doc_id),
        )
    )
    assert audit is not None
    assert audit.before_data["version_id"] == 1
    assert audit.after_data["version_id"] == 2


def test_consultation_fees_crud_and_rbac(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Tests consultation fee lifecycle: create (admin), list (all), update (admin)."""
    admin_c = login_client(admin_user)
    rec_c = login_client(reception_user)
    doc_c = login_client(doctor_a_user)

    # Reception cannot create fee schedule (403)
    rec_resp = rec_c.post("/api/fees", json={"name": "Specialist Visit", "fee_paise": 60000})
    assert rec_resp.status_code == 403

    # Admin creates fee schedule (201)
    admin_resp = admin_c.post("/api/fees", json={"name": "General OPD Visit", "fee_paise": 30000})
    assert admin_resp.status_code == 201
    created_fee = admin_resp.json()
    assert created_fee["name"] == "General OPD Visit"
    assert created_fee["fee_paise"] == 30000
    fee_id = created_fee["id"]

    # Verify audit event FEE_CREATED
    audit_created = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "FEE_CREATED",
            AuditLog.entity_id == str(fee_id),
        )
    )
    assert audit_created is not None
    assert audit_created.after_data["name"] == "General OPD Visit"

    # Reception and Doctor can list active fees
    for c in (rec_c, doc_c):
        resp = c.get("/api/fees")
        assert resp.status_code == 200
        names = [f["name"] for f in resp.json()]
        assert "General OPD Visit" in names

    assert created_fee["version_id"] == 1

    # Admin updates fee rate
    update_resp = admin_c.patch(
        f"/api/fees/{fee_id}",
        json={
            "name": "General OPD Visit (Revised)",
            "fee_paise": 35000,
            "is_active": True,
            "version_id": 1,
        },
    )
    assert update_resp.status_code == 200
    updated_fee = update_resp.json()
    assert updated_fee["name"] == "General OPD Visit (Revised)"
    assert updated_fee["fee_paise"] == 35000
    assert updated_fee["version_id"] == 2

    # Verify audit event FEE_UPDATED
    audit_updated = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "FEE_UPDATED",
            AuditLog.entity_id == str(fee_id),
        )
    )
    assert audit_updated is not None
    assert audit_updated.before_data["fee_paise"] == 30000
    assert audit_updated.after_data["fee_paise"] == 35000


def test_fee_update_requires_current_version(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """PATCH /api/fees/{id} enforces version_id (SEC-06): missing -> 422, stale -> 409."""
    admin_c = login_client(admin_user)
    created = admin_c.post("/api/fees", json={"name": "Physio Session", "fee_paise": 50000})
    assert created.status_code == 201
    fee_id = created.json()["id"]

    # version_id is mandatory on update
    missing = admin_c.patch(
        f"/api/fees/{fee_id}",
        json={"name": "Physio Session", "fee_paise": 55000, "is_active": True},
    )
    assert missing.status_code == 422
    assert missing.json()["code"] == "validation_error"

    # First writer wins
    first = admin_c.patch(
        f"/api/fees/{fee_id}",
        json={"name": "Physio Session", "fee_paise": 55000, "is_active": True, "version_id": 1},
    )
    assert first.status_code == 200
    assert first.json()["version_id"] == 2

    # Second writer with the stale version is rejected and nothing changes
    stale = admin_c.patch(
        f"/api/fees/{fee_id}",
        json={"name": "Physio Session", "fee_paise": 1, "is_active": True, "version_id": 1},
    )
    assert stale.status_code == 409
    body = stale.json()
    assert body["code"] == "version_conflict"
    assert body["entity"] == "consultation_fee"

    listed = admin_c.get("/api/fees").json()
    current = next(f for f in listed if f["id"] == fee_id)
    assert current["fee_paise"] == 55000
    assert current["version_id"] == 2

    audits = db_session.scalars(
        select(AuditLog).where(
            AuditLog.action == "FEE_UPDATED",
            AuditLog.entity_id == str(fee_id),
        )
    ).all()
    assert len(audits) == 1


def test_fee_deactivate_list_inactive_and_reactivate(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    db_session: Session,
) -> None:
    """Deactivated fees are hidden by default, listed with include_inactive, and reactivatable."""
    admin_c = login_client(admin_user)
    rec_c = login_client(reception_user)
    created = admin_c.post("/api/fees", json={"name": "Night Visit", "fee_paise": 80000})
    assert created.status_code == 201
    fee_id = created.json()["id"]

    deactivated = admin_c.patch(
        f"/api/fees/{fee_id}",
        json={"name": "Night Visit", "fee_paise": 80000, "is_active": False, "version_id": 1},
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False

    # Default listing (used by reception billing) hides the inactive fee
    default_ids = [f["id"] for f in rec_c.get("/api/fees").json()]
    assert fee_id not in default_ids

    # include_inactive=true surfaces it with its current version for reactivation
    all_fees = admin_c.get("/api/fees", params={"include_inactive": "true"})
    assert all_fees.status_code == 200
    inactive = next(f for f in all_fees.json() if f["id"] == fee_id)
    assert inactive["is_active"] is False
    assert inactive["version_id"] == 2

    reactivated = admin_c.patch(
        f"/api/fees/{fee_id}",
        json={
            "name": "Night Visit",
            "fee_paise": 80000,
            "is_active": True,
            "version_id": inactive["version_id"],
        },
    )
    assert reactivated.status_code == 200
    assert reactivated.json()["is_active"] is True
    assert reactivated.json()["version_id"] == 3
    assert fee_id in [f["id"] for f in rec_c.get("/api/fees").json()]

    # Audit before/after carry every mutable field plus version
    latest = db_session.scalars(
        select(AuditLog)
        .where(AuditLog.action == "FEE_UPDATED", AuditLog.entity_id == str(fee_id))
        .order_by(AuditLog.id.desc())
    ).first()
    assert latest is not None
    assert latest.before_data == {
        "name": "Night Visit",
        "fee_paise": 80000,
        "is_active": False,
        "version_id": 2,
    }
    assert latest.after_data == {
        "name": "Night Visit",
        "fee_paise": 80000,
        "is_active": True,
        "version_id": 3,
    }

    created_audit = db_session.scalar(
        select(AuditLog).where(AuditLog.action == "FEE_CREATED", AuditLog.entity_id == str(fee_id))
    )
    assert created_audit is not None
    assert created_audit.after_data == {
        "name": "Night Visit",
        "fee_paise": 80000,
        "is_active": True,
        "version_id": 1,
    }
