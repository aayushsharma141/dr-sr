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
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from kalyan_api.models import AuditLog, User
from kalyan_api.services.receipt_service import current_cycle_key

MUTABLE_FIELDS: tuple[str, ...] = (
    "name_en",
    "name_hi",
    "trust_name_en",
    "trust_name_hi",
    "location_line",
    "address_1",
    "address_2",
    "phone",
    "email",
    "receipt_sequence_cycle",
    "print_header_en",
    "print_header_hi",
    "print_footer_en",
    "print_footer_hi",
    "consultation_validity_days",
)


def _payload_from(current: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    """Build a full PATCH payload from the current settings with selected overrides."""
    body: dict[str, Any] = {k: current[k] for k in MUTABLE_FIELDS}
    body["version_id"] = current["version_id"]
    body.update(overrides)
    return body


def _other_cycle(cycle: str) -> str:
    return "CALENDAR_YEAR" if cycle == "FINANCIAL_YEAR" else "FINANCIAL_YEAR"


def _mark_receipt_issued(db_session: Session, cycle: str) -> None:
    """Simulate one receipt already issued in today's IST cycle for the given setting."""
    db_session.execute(
        text(
            "INSERT INTO receipt_sequences (cycle_key, last_number) VALUES (:k, 1) "
            "ON CONFLICT (cycle_key) DO UPDATE SET last_number = "
            "GREATEST(receipt_sequences.last_number, 1)"
        ),
        {"k": current_cycle_key(cycle)},
    )
    db_session.flush()


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

    # 3. Audit before/after are complete: every mutable field plus version_id
    expected_after = {k: v for k, v in update_payload.items() if k != "version_id"}
    expected_after["version_id"] = curr_version + 1
    for identity_field in ("trust_name_en", "trust_name_hi", "location_line"):
        expected_after[identity_field] = current[identity_field]
    assert latest_audit.after_data == expected_after
    assert set(latest_audit.before_data) == set(MUTABLE_FIELDS) | {"version_id"}
    for field in MUTABLE_FIELDS:
        assert latest_audit.before_data[field] == current[field], field
    assert latest_audit.before_data["version_id"] == curr_version


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


def test_patch_settings_rejects_invalid_email(login_client: Any, admin_user: User) -> None:
    """A malformed email is rejected with the standard 422 validation envelope."""
    c = login_client(admin_user)
    current = c.get("/api/settings").json()
    for bad in ("not-an-email", "a@b", "two words@example.org", "x@@example.org"):
        resp = c.patch("/api/settings", json=_payload_from(current, email=bad))
        assert resp.status_code == 422, bad
        body = resp.json()
        assert body["code"] == "validation_error"
        assert any(f["loc"][-1] == "email" for f in body["fields"]), body

    # Null email remains allowed
    ok = c.patch("/api/settings", json=_payload_from(current, email=None))
    assert ok.status_code == 200
    assert ok.json()["email"] is None


def test_patch_settings_rejects_invalid_phone(login_client: Any, admin_user: User) -> None:
    """Phone accepts digits, spaces and + - / , ( ) only, and must contain digits."""
    c = login_client(admin_user)
    current = c.get("/api/settings").json()
    for bad in ("98765abcde", "+91 98765 43210; DROP", "-----", "9876543210#"):
        resp = c.patch("/api/settings", json=_payload_from(current, phone=bad))
        assert resp.status_code == 422, bad
        body = resp.json()
        assert body["code"] == "validation_error"
        assert any(f["loc"][-1] == "phone" for f in body["fields"]), body

    good = "+91 (6182) 234-567, 6182/234568"
    resp = c.patch("/api/settings", json=_payload_from(current, phone=good))
    assert resp.status_code == 200
    assert resp.json()["phone"] == good


def test_receipt_cycle_change_without_receipts_needs_no_confirmation(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """Switching the receipt cycle before any receipt exists in the current cycle succeeds."""
    c = login_client(admin_user)
    current = c.get("/api/settings").json()
    cycle = current["receipt_sequence_cycle"]
    db_session.execute(
        text("UPDATE receipt_sequences SET last_number = 0 WHERE cycle_key = :k"),
        {"k": current_cycle_key(cycle)},
    )
    db_session.flush()

    resp = c.patch(
        "/api/settings",
        json=_payload_from(current, receipt_sequence_cycle=_other_cycle(cycle)),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["receipt_sequence_cycle"] == _other_cycle(cycle)


def test_receipt_cycle_change_after_receipts_requires_confirmation_and_reason(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """Once a receipt exists in the current cycle, a cycle change needs confirmation + reason."""
    c = login_client(admin_user)
    current = c.get("/api/settings").json()
    cycle = current["receipt_sequence_cycle"]
    target = _other_cycle(cycle)
    _mark_receipt_issued(db_session, cycle)

    # 1. Unconfirmed change -> 409 with a dedicated code; nothing persisted
    resp = c.patch("/api/settings", json=_payload_from(current, receipt_sequence_cycle=target))
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"] == "receipt_cycle_change_requires_confirmation"
    assert body["current_cycle"] == cycle
    assert body["requested_cycle"] == target
    assert body["receipts_issued"] >= 1
    assert c.get("/api/settings").json()["receipt_sequence_cycle"] == cycle

    # 2. Confirmation without a (non-blank) reason -> 422 validation envelope
    for reason in (None, "", "   "):
        resp = c.patch(
            "/api/settings",
            json=_payload_from(
                current,
                receipt_sequence_cycle=target,
                confirm_receipt_cycle_change=True,
                change_reason=reason,
            ),
        )
        assert resp.status_code == 422, reason
        assert resp.json()["code"] == "validation_error"

    # 3. Non-cycle edits are unaffected by existing receipts
    resp = c.patch("/api/settings", json=_payload_from(current, name_en="Kalyan Hospital Ara"))
    assert resp.status_code == 200
    current = resp.json()

    # 4. Confirmed change with reason -> 200, reason recorded on the audit row
    resp = c.patch(
        "/api/settings",
        json=_payload_from(
            current,
            receipt_sequence_cycle=target,
            confirm_receipt_cycle_change=True,
            change_reason="  Accountant asked to align receipts with the financial year  ",
        ),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["receipt_sequence_cycle"] == target

    audit = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "SETTINGS_UPDATED").order_by(AuditLog.id.desc())
    ).first()
    assert audit is not None
    assert audit.reason == "Accountant asked to align receipts with the financial year"
    assert audit.before_data["receipt_sequence_cycle"] == cycle
    assert audit.after_data["receipt_sequence_cycle"] == target
    assert "confirm_receipt_cycle_change" not in audit.after_data
