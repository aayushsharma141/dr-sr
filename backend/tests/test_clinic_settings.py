"""Tests for Clinic Settings REST API (SET-01).

Guarantees:
- GET /api/settings is readable by all authenticated users (ADMIN, RECEPTION, DOCTOR).
- GET /api/settings is refused with 401 for anonymous callers.
- PATCH /api/settings is restricted exclusively to ADMIN (403 for RECEPTION, DOCTOR).
- PATCH /api/settings requires correct version_id; returns 409 Conflict on version mismatch.
- Successful PATCH increments version_id and records SETTINGS_UPDATED audit entry with before/after.
"""

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.models import AuditLog, User


def test_get_settings_anonymous_rejected(client: TestClient) -> None:
    """Anonymous access to /api/settings is denied with 401."""
    resp = client.get("/api/settings")
    assert resp.status_code == 401


def test_get_settings_authenticated_roles(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
) -> None:
    """All authenticated roles (ADMIN, RECEPTION, DOCTOR) can read clinic settings."""
    for u in (admin_user, reception_user, doctor_a_user):
        c = login_client(u)
        resp = c.get("/api/settings")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == 1
        assert "name_en" in data
        assert "name_hi" in data
        assert "phone" in data
        assert "receipt_sequence_cycle" in data
        assert "version_id" in data


def test_patch_settings_rbac_forbidden_for_reception_and_doctor(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
) -> None:
    """Non-admin roles cannot mutate clinic settings (403 Forbidden)."""
    payload = {
        "name_en": "Malicious Update",
        "name_hi": "हानिकारक बदलाव",
        "address_1": "Station Road",
        "phone": "+91 9999999999",
        "receipt_sequence_cycle": "FINANCIAL_YEAR",
        "consultation_validity_days": 10,
        "version_id": 1,
    }
    for u in (reception_user, doctor_a_user):
        c = login_client(u)
        resp = c.patch("/api/settings", json=payload)
        assert resp.status_code == 403


def test_patch_settings_admin_success_and_audit(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """Admin successfully updates clinic settings, increments version_id, and audits."""
    c = login_client(admin_user)

    # 1. Fetch current settings to read version_id
    get_resp = c.get("/api/settings")
    assert get_resp.status_code == 200
    current = get_resp.json()
    curr_version = current["version_id"]

    update_payload = {
        "name_en": "Kalyan Multispeciality Hospital",
        "name_hi": "कल्याण मल्टीस्पेशलिटी हॉस्पिटल",
        "address_1": "Main Hospital Road, Near Clock Tower",
        "address_2": "Ara, Bhojpur, Bihar - 802301",
        "phone": "+91 6182 234567",
        "email": "info@kalyanhospital.org",
        "receipt_sequence_cycle": "CALENDAR_YEAR",
        "print_header_en": "Kalyan Hospital - Serving with Care",
        "print_header_hi": "कल्याण हॉस्पिटल - सेवा और समर्पण",
        "print_footer_en": "Get well soon!",
        "print_footer_hi": "शीघ्र स्वास्थ्य लाभ की कामना!",
        "consultation_validity_days": 14,
        "version_id": curr_version,
    }

    resp = c.patch("/api/settings", json=update_payload)
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["name_en"] == "Kalyan Multispeciality Hospital"
    assert updated["name_hi"] == "कल्याण मल्टीस्पेशलिटी हॉस्पिटल"
    assert updated["receipt_sequence_cycle"] == "CALENDAR_YEAR"
    assert updated["consultation_validity_days"] == 14
    assert updated["version_id"] == curr_version + 1

    # 2. Verify audit entry was written
    audit_entries = db_session.scalars(
        select(AuditLog)
        .where(
            AuditLog.action == "SETTINGS_UPDATED",
            AuditLog.entity_type == "CLINIC_SETTINGS",
        )
        .order_by(AuditLog.id.desc())
    ).all()
    assert len(audit_entries) >= 1
    latest_audit = audit_entries[0]
    assert latest_audit.actor_user_id == admin_user.id
    assert latest_audit.after_data["name_en"] == "Kalyan Multispeciality Hospital"
    assert latest_audit.after_data["receipt_sequence_cycle"] == "CALENDAR_YEAR"


def test_patch_settings_optimistic_concurrency_conflict(
    login_client: Any,
    admin_user: User,
) -> None:
    """Stale version_id returns 409 Conflict with version_conflict code."""
    c = login_client(admin_user)

    # Use a deliberately mismatched version_id
    payload = {
        "name_en": "Kalyan Hospital Stale",
        "name_hi": "कल्याण हॉस्पिटल",
        "address_1": "Station Road",
        "phone": "+91 9999999999",
        "receipt_sequence_cycle": "FINANCIAL_YEAR",
        "consultation_validity_days": 7,
        "version_id": 999,  # Mismatched version
    }

    resp = c.patch("/api/settings", json=payload)
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"] == "version_conflict"
    assert "Record was modified by another user" in body["message"]
