"""Tests for print template REST API and audit event recording (SET-01, BIL-04, D-20-04).

Guarantees:
- Admin can list all 4 print templates (prescription, receipt, registration_card, consultation_summary).
- Admin can fetch a single print template by document type.
- Admin can update bilingual header and footer text per document type.
- Stale version submissions return HTTP 409 version_conflict.
- Updates synchronously commit a PRINT_TEMPLATE_UPDATED audit record with before/after state.
- Non-admin users (Reception, Doctor) or unauthenticated requests are denied.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.models import AuditLog, PrintDocumentType, PrintTemplate, User
from kalyan_api.services.audit_service import AuditAction


def test_list_print_templates_seeded(
    admin_user: User,
    login_client,
) -> None:
    """GET /api/admin/templates returns all 4 templates seeded with initial configuration."""
    client: TestClient = login_client(admin_user)
    resp = client.get("/api/admin/templates")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 4

    doc_types = [t["document_type"] for t in data]
    assert doc_types == [
        PrintDocumentType.PRESCRIPTION.value,
        PrintDocumentType.RECEIPT.value,
        PrintDocumentType.REGISTRATION_CARD.value,
        PrintDocumentType.CONSULTATION_SUMMARY.value,
    ]

    for item in data:
        assert item["id"] > 0
        assert item["version"] >= 1
        assert "updated_at" in item


def test_get_single_print_template(
    admin_user: User,
    login_client,
) -> None:
    """GET /api/admin/templates/{doc_type} returns template or 404 if missing."""
    client: TestClient = login_client(admin_user)

    # Valid doc type
    resp = client.get("/api/admin/templates/receipt")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["document_type"] == "receipt"
    assert data["version"] >= 1

    # Invalid doc type
    resp_404 = client.get("/api/admin/templates/unknown_template")
    assert resp_404.status_code == 404
    assert resp_404.json()["code"] == "template_not_found"


def test_patch_print_template_and_audit(
    admin_user: User,
    login_client,
    db_session: Session,
) -> None:
    """PATCH /api/admin/templates/{doc_type} increments version and records audit event."""
    client: TestClient = login_client(admin_user)

    # 1. Fetch current template
    resp_init = client.get("/api/admin/templates/prescription")
    assert resp_init.status_code == 200
    init_data = resp_init.json()
    init_version = init_data["version"]

    # 2. Update template
    update_payload = {
        "header_en": "Kalyan Hospital Physiotherapy Department",
        "header_hi": "कल्याण हॉस्पिटल फिजियोथेरेपी विभाग",
        "footer_en": "Emergency 24x7: +91 6182 000000",
        "footer_hi": "आपातकालीन 24x7: +91 6182 000000",
        "version": init_version,
    }
    resp_patch = client.patch(
        "/api/admin/templates/prescription",
        json=update_payload,
    )
    assert resp_patch.status_code == 200, resp_patch.text
    patched_data = resp_patch.json()

    assert patched_data["document_type"] == "prescription"
    assert patched_data["header_en"] == "Kalyan Hospital Physiotherapy Department"
    assert patched_data["header_hi"] == "कल्याण हॉस्पिटल फिजियोथेरेपी विभाग"
    assert patched_data["footer_en"] == "Emergency 24x7: +91 6182 000000"
    assert patched_data["footer_hi"] == "आपातकालीन 24x7: +91 6182 000000"
    assert patched_data["version"] == init_version + 1

    # 3. Verify audit record in database
    audit_entry = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == AuditAction.PRINT_TEMPLATE_UPDATED,
            AuditLog.entity_type == "PRINT_TEMPLATE",
            AuditLog.entity_id == "prescription",
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit_entry is not None
    assert audit_entry.actor_user_id == admin_user.id
    assert audit_entry.after_data["header_en"] == "Kalyan Hospital Physiotherapy Department"
    assert audit_entry.after_data["header_hi"] == "कल्याण हॉस्पिटल फिजियोथेरेपी विभाग"
    assert audit_entry.after_data["version"] == init_version + 1
    assert audit_entry.before_data["version"] == init_version


def test_patch_version_conflict_409(
    admin_user: User,
    login_client,
) -> None:
    """Submitting stale version returns HTTP 409 version_conflict."""
    client: TestClient = login_client(admin_user)

    resp_init = client.get("/api/admin/templates/receipt")
    assert resp_init.status_code == 200
    current_version = resp_init.json()["version"]

    stale_payload = {
        "header_en": "Conflicting Update",
        "header_hi": "विवादित अपडेट",
        "footer_en": None,
        "footer_hi": None,
        "version": current_version + 99,  # Stale / mismatched version
    }
    resp_conflict = client.patch(
        "/api/admin/templates/receipt",
        json=stale_payload,
    )
    assert resp_conflict.status_code == 409
    assert resp_conflict.json()["code"] == "version_conflict"


def test_rbac_print_templates_restricted_to_admin(
    reception_user: User,
    doctor_a_user: User,
    login_client,
    client: TestClient,
) -> None:
    """Non-admin users and unauthenticated requests are forbidden."""
    # 1. Unauthenticated request -> 401
    r_unauth = client.get("/api/admin/templates")
    assert r_unauth.status_code == 401

    # 2. Reception user -> 403
    reception_c = login_client(reception_user)
    r_rec_get = reception_c.get("/api/admin/templates")
    assert r_rec_get.status_code == 403

    r_rec_patch = reception_c.patch(
        "/api/admin/templates/prescription",
        json={"header_en": "Blocked", "version": 1},
    )
    assert r_rec_patch.status_code == 403

    # 3. Doctor user -> 403
    doctor_c = login_client(doctor_a_user)
    r_doc_get = doctor_c.get("/api/admin/templates")
    assert r_doc_get.status_code == 403

    r_doc_patch = doctor_c.patch(
        "/api/admin/templates/prescription",
        json={"header_en": "Blocked", "version": 1},
    )
    assert r_doc_patch.status_code == 403
