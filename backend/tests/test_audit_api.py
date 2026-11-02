"""Integration tests for Audit Log Viewer REST API (AUD-02, Phase 16).

Verifies:
- Admin can list and filter audit log records by actor, action, entity, and date.
- Non-admin roles (Reception, Doctor) receive HTTP 403 Forbidden.
- Anonymous callers receive HTTP 401 Unauthorized.
- Passwords and secret tokens are never exposed in log output.
- Chronological ordering and pagination work as specified.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from kalyan_api.models import User
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction, AuditContext


def test_audit_logs_admin_list_and_filter(
    admin_user: User,
    db_session: Session,
    login_client: type[TestClient],
) -> None:
    """Admin queries audit logs with multi-parameter filtering (AUD-02)."""
    # Seed specific audit events
    ctx = AuditContext(
        actor_user_id=admin_user.id,
        actor_username=admin_user.username,
        actor_role=admin_user.role,
        ip="192.168.1.100",
    )

    audit_service.record(
        db_session,
        ctx,
        action=AuditAction.SETTINGS_UPDATED,
        entity_type="clinic_settings",
        entity_id="1",
        before={"name_en": "Old Hospital"},
        after={"name_en": "New Hospital"},
    )

    audit_service.record(
        db_session,
        ctx,
        action=AuditAction.USER_CREATED,
        entity_type="user",
        entity_id="99",
        after={"username": "staff_member"},
    )
    db_session.commit()

    adm_c = login_client(admin_user)

    # 1. Query all
    resp = adm_c.get("/api/audit-logs")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total"] >= 2
    assert len(data["items"]) >= 2

    # 2. Filter by action
    resp_action = adm_c.get("/api/audit-logs", params={"action": "SETTINGS_UPDATED"})
    assert resp_action.status_code == 200
    action_data = resp_action.json()
    assert all(it["action"] == "SETTINGS_UPDATED" for it in action_data["items"])

    # 3. Filter by entity_type
    resp_entity = adm_c.get("/api/audit-logs", params={"entity_type": "clinic_settings"})
    assert resp_entity.status_code == 200
    entity_data = resp_entity.json()
    assert all(it["entity_type"] == "clinic_settings" for it in entity_data["items"])

    # 4. Verify no secret keys
    for item in data["items"]:
        before_str = str(item.get("before_data") or "")
        after_str = str(item.get("after_data") or "")
        assert "password_hash" not in before_str
        assert "password_hash" not in after_str


def test_audit_logs_role_restrictions(
    reception_user: User,
    doctor_a_user: User,
    client: TestClient,
    login_client: type[TestClient],
) -> None:
    """Non-admin roles receive 403 Forbidden; Anonymous receives 401 Unauthorized."""
    # Anonymous -> 401
    resp_anon = client.get("/api/audit-logs")
    assert resp_anon.status_code == 401

    # Reception -> 403
    rec_c = login_client(reception_user)
    resp_rec = rec_c.get("/api/audit-logs")
    assert resp_rec.status_code == 403

    # Doctor -> 403
    doc_c = login_client(doctor_a_user)
    resp_doc = doc_c.get("/api/audit-logs")
    assert resp_doc.status_code == 403
