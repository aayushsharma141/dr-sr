"""Integration tests for Audit Log Viewer REST API (AUD-02, Phase 16).

Verifies:
- Admin can list and filter audit log records by actor, action, entity, and date.
- Non-admin roles (Reception, Doctor) receive HTTP 403 Forbidden.
- Anonymous callers receive HTTP 401 Unauthorized.
- Passwords and secret tokens are never exposed in log output.
- Chronological ordering and pagination work as specified.
"""

from datetime import timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from kalyan_api.models import User
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction, AuditContext, Outcome

FILTER_ENTITY = "aud_filter_t"


def _db_now(session: Session) -> Any:
    """Transaction timestamp used by audit_logs.occurred_at server default."""
    return session.scalar(select(func.now()))


def test_audit_actions_catalogue(
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    client: TestClient,
    login_client: Any,
) -> None:
    """GET /api/audit-logs/actions returns the sorted AuditAction catalogue to admins only."""
    assert client.get("/api/audit-logs/actions").status_code == 401
    assert login_client(reception_user).get("/api/audit-logs/actions").status_code == 403
    assert login_client(doctor_a_user).get("/api/audit-logs/actions").status_code == 403

    resp = login_client(admin_user).get("/api/audit-logs/actions")
    assert resp.status_code == 200
    actions = resp.json()
    assert actions == sorted(a.value for a in AuditAction)
    assert len(actions) == len(set(actions))
    for expected in ("BACKUP_FAILED", "BACKUP_RESTORE_FAILED", "AUTH_LOGIN_FAILED"):
        assert expected in actions


def test_audit_logs_filters_date_entity_outcome_actor_and_paging(
    admin_user: User,
    reception_user: User,
    db_session: Session,
    login_client: Any,
) -> None:
    """Each documented filter narrows results correctly, including outcome=DENIED."""
    admin_ctx = AuditContext(admin_user.id, admin_user.username, "ADMIN")
    rec_ctx = AuditContext(reception_user.id, reception_user.username, "RECEPTION")
    audit_service.record(db_session, admin_ctx, AuditAction.SETTINGS_UPDATED, FILTER_ENTITY, "1")
    audit_service.record(
        db_session,
        admin_ctx,
        AuditAction.USER_UPDATED,
        FILTER_ENTITY,
        "2",
        outcome=Outcome.FAILURE,
    )
    audit_service.record(
        db_session,
        rec_ctx,
        AuditAction.AUTH_LOGIN_THROTTLED,
        FILTER_ENTITY,
        "3",
        outcome=Outcome.DENIED,
    )
    db_session.flush()
    now = _db_now(db_session)

    adm_c = login_client(admin_user)

    def query(**params: Any) -> dict[str, Any]:
        resp = adm_c.get("/api/audit-logs", params={"entity_type": FILTER_ENTITY, **params})
        assert resp.status_code == 200, resp.text
        return resp.json()

    assert query()["total"] == 3

    # entity_id exact match
    by_id = query(entity_id="2")
    assert [it["entity_id"] for it in by_id["items"]] == ["2"]

    # outcome, including DENIED and case-insensitive input
    denied = query(outcome="DENIED")
    assert [it["entity_id"] for it in denied["items"]] == ["3"]
    assert denied["items"][0]["outcome"] == "DENIED"
    assert [it["entity_id"] for it in query(outcome="failure")["items"]] == ["2"]
    assert query(outcome="SUCCESS")["total"] == 1

    # actor username partial, case-insensitive
    assert query(actor_username=reception_user.username[:8].upper())["total"] >= 1
    assert all(
        it["actor_username"] == reception_user.username
        for it in query(actor_username=reception_user.username)["items"]
    )

    # date range (inclusive bounds, timezone-aware ISO values)
    inside = query(
        date_from=(now - timedelta(hours=1)).isoformat(),
        date_to=(now + timedelta(hours=1)).isoformat(),
    )
    assert inside["total"] == 3
    assert query(date_from=now.isoformat(), date_to=now.isoformat())["total"] == 3
    assert query(date_to=(now - timedelta(seconds=1)).isoformat())["total"] == 0
    assert query(date_from=(now + timedelta(seconds=1)).isoformat())["total"] == 0

    # pagination + descending order (same timestamp -> id desc)
    page1 = query(page=1, page_size=2)
    page2 = query(page=2, page_size=2)
    assert page1["pages"] == 2
    assert [it["entity_id"] for it in page1["items"]] == ["3", "2"]
    assert [it["entity_id"] for it in page2["items"]] == ["1"]

    # invalid paging is rejected
    assert adm_c.get("/api/audit-logs", params={"page": 0}).status_code == 422
    assert adm_c.get("/api/audit-logs", params={"page_size": 201}).status_code == 422


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
