"""Tests for Patient Registration and Duplicate Detection (PAT-01, PAT-04).

Guarantees:
- POST /api/patients:
  - 401 for anonymous caller.
  - 403 for roles lacking patient:create (e.g., DOCTOR, ADMIN).
  - 201 for RECEPTION role, allocates sequential URN, persists patient, audits PATIENT_REGISTERED.
  - 422 for invalid demographic inputs (gender, age range, mobile format).
- GET /api/patients/check-duplicate:
  - 401 for anonymous caller.
  - Proactive duplicate detection matching normalized name and mobile without blocking.
"""

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.models import AuditLog, User


def test_patient_endpoints_anonymous_rejected(client: TestClient) -> None:
    """Anonymous access to registration endpoints is denied with 401."""
    assert client.post("/api/patients", json={}).status_code == 401
    assert client.get("/api/patients/check-duplicate?name=Ram&mobile=9876543210").status_code == 401


def test_patient_registration_rbac(
    login_client: Any,
    admin_user: User,
    doctor_a_user: User,
    reception_user: User,
) -> None:
    """Only RECEPTION possesses patient:create permission."""
    valid_payload = {
        "full_name": "Suresh Kumar",
        "guardian_name": "Ramesh Kumar",
        "gender": "M",
        "age_years": 35,
        "mobile": "9876543210",
        "address": "Hospital Road, Ara",
        "district": "Bhojpur",
        "state": "Bihar",
    }

    # Admin cannot register patient (403)
    admin_c = login_client(admin_user)
    assert admin_c.post("/api/patients", json=valid_payload).status_code == 403

    # Doctor cannot register patient (403)
    doc_c = login_client(doctor_a_user)
    assert doc_c.post("/api/patients", json=valid_payload).status_code == 403

    # Reception can register patient (201)
    rec_c = login_client(reception_user)
    resp = rec_c.post("/api/patients", json=valid_payload)
    assert resp.status_code == 201


def test_patient_registration_success_and_audit(
    login_client: Any,
    reception_user: User,
    db_session: Session,
) -> None:
    """Reception registers patient; verifies canonical 12 fields, URN format, and audit."""
    rec_c = login_client(reception_user)

    payload = {
        "full_name": "Meena Devi",
        "guardian_name": "Radhe Shyam (W/o)",
        "gender": "F",
        "age_years": 42,
        "mobile": "+91 9876543211",
        "address": "Village Dhoba, Post Koilwar",
        "district": "Bhojpur",
        "state": "Bihar",
        "emergency_contact": "Sonu Kumar (Son) - 9876543212",
        "allergies": "Sulfa drugs",
        "notes": "First visit for knee pain",
    }

    resp = rec_c.post("/api/patients", json=payload)
    assert resp.status_code == 201
    data = resp.json()

    # 1. Verify URN format KH-YYYY-XXXX
    assert data["urn"].startswith("KH-")
    parts = data["urn"].split("-")
    assert len(parts) == 3
    assert len(parts[1]) == 4  # Year
    assert len(parts[2]) == 4  # 4-digit sequence

    # 2. Verify Canonical fields
    assert data["full_name"] == "Meena Devi"
    assert data["guardian_name"] == "Radhe Shyam (W/o)"
    assert data["gender"] == "F"
    assert data["age_years"] == 42
    assert data["mobile"] == "9876543211"
    assert data["address"] == "Village Dhoba, Post Koilwar"
    assert data["district"] == "Bhojpur"
    assert data["state"] == "Bihar"
    assert data["allergies"] == "Sulfa drugs"
    assert data["notes"] == "First visit for knee pain"
    assert data["version_id"] == 1

    # 3. Verify audit log entry
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "PATIENT_REGISTERED",
            AuditLog.entity_id == str(data["id"]),
        )
    )
    assert audit is not None
    assert audit.actor_user_id == reception_user.id
    assert audit.after_data["urn"] == data["urn"]
    assert audit.after_data["full_name"] == "Meena Devi"


def test_patient_validation_constraints(
    login_client: Any,
    reception_user: User,
) -> None:
    """Invalid input values fail with 422 Unprocessable Entity."""
    rec_c = login_client(reception_user)

    base = {
        "full_name": "A",  # too short (min 2)
        "guardian_name": "Father",
        "gender": "M",
        "age_years": 25,
        "mobile": "9876543210",
        "address": "Ara",
    }
    assert rec_c.post("/api/patients", json=base).status_code == 422

    # Invalid gender
    invalid_gender = dict(base, full_name="Valid Name", gender="X")
    assert rec_c.post("/api/patients", json=invalid_gender).status_code == 422

    # Invalid age
    invalid_age = dict(base, full_name="Valid Name", age_years=160)
    assert rec_c.post("/api/patients", json=invalid_age).status_code == 422

    # Invalid mobile
    invalid_mobile = dict(base, full_name="Valid Name", mobile="123")
    assert rec_c.post("/api/patients", json=invalid_mobile).status_code == 422


def test_duplicate_patient_detection(
    login_client: Any,
    reception_user: User,
) -> None:
    """Duplicate check detects existing patient by normalized name and mobile."""
    rec_c = login_client(reception_user)

    # 1. Initially check returns false
    check1 = rec_c.get(
        "/api/patients/check-duplicate",
        params={"name": "Kavita Singh", "mobile": "9934112233"},
    )
    assert check1.status_code == 200
    assert check1.json()["has_duplicate"] is False
    assert check1.json()["matching_patient"] is None

    # 2. Register patient
    reg_resp = rec_c.post(
        "/api/patients",
        json={
            "full_name": "Kavita Singh",
            "guardian_name": "Sunil Singh",
            "gender": "F",
            "age_years": 29,
            "mobile": "9934112233",
            "address": "Babu Bazar, Ara",
        },
    )
    assert reg_resp.status_code == 201

    # 3. Duplicate check with case/whitespace variations returns true
    check2 = rec_c.get(
        "/api/patients/check-duplicate",
        params={"name": "  kavita   singh  ", "mobile": "+91 9934112233"},
    )
    assert check2.status_code == 200
    res = check2.json()
    assert res["has_duplicate"] is True
    assert res["matching_patient"]["full_name"] == "Kavita Singh"
    assert res["matching_patient"]["mobile"] == "9934112233"
