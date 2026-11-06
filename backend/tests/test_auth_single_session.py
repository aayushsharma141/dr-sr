"""Automated tests for single active session enforcement, 409 rejection, and audited takeover (DWS-10, T-19-03)."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.models import AuditLog, AuthSession, User
from kalyan_api.services.audit_service import AuditAction
from tests.conftest import TEST_PASSWORD, make_user


def test_second_login_returns_409_session_in_use(
    make_client, admin_user: User, db_session: Session
) -> None:
    """When an active session exists for a user, a new login attempt without takeover returns HTTP 409 session_in_use."""
    client1 = make_client("192.168.1.101")
    client2 = make_client("192.168.1.102")

    # 1. Device 1 logs in successfully -> 200 OK
    resp1 = client1.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": TEST_PASSWORD},
    )
    assert resp1.status_code == 200, resp1.text

    # 2. Device 2 attempts login with valid credentials -> 409 Conflict
    resp2 = client2.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": TEST_PASSWORD},
    )
    assert resp2.status_code == 409, resp2.text
    data2 = resp2.json()
    assert data2["code"] == "session_in_use"
    assert "active_session" in data2
    assert "last_seen_at" in data2["active_session"]

    # Device 1 session remains active and usable
    me_resp = client1.get("/api/auth/me")
    assert me_resp.status_code == 200


def test_session_takeover_revokes_prior_and_logs_audit(
    make_client, admin_user: User, db_session: Session
) -> None:
    """When login is called with takeover=True, previous session is revoked, SESSION_TAKEOVER is audited, and new login succeeds."""
    client1 = make_client("192.168.1.101")
    client2 = make_client("192.168.1.102")

    # 1. Device 1 logs in
    resp1 = client1.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": TEST_PASSWORD},
    )
    assert resp1.status_code == 200

    # 2. Device 2 initiates login with takeover=True
    resp2 = client2.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": TEST_PASSWORD, "takeover": True},
    )
    assert resp2.status_code == 200, resp2.text
    assert "set-cookie" in resp2.headers

    # 3. Device 1 session is now revoked -> subsequent requests return 401
    me_resp1 = client1.get("/api/auth/me")
    assert me_resp1.status_code == 401

    # 4. Device 2 session is active
    me_resp2 = client2.get("/api/auth/me")
    assert me_resp2.status_code == 200

    # 5. Verify SESSION_TAKEOVER audit entry
    audit_entry = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == AuditAction.SESSION_TAKEOVER.value,
            AuditLog.actor_user_id == admin_user.id,
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit_entry is not None
    assert audit_entry.outcome == "SUCCESS"


def test_expired_or_idle_session_does_not_block_login(
    make_client, db_session: Session, test_settings: Settings
) -> None:
    """An idle or expired session does not trigger 409 session_in_use conflict."""
    user = make_user(db_session, test_settings, role="RECEPTION", username="idleuser")

    client1 = make_client("192.168.1.101")
    client2 = make_client("192.168.1.102")

    # Device 1 logs in
    resp1 = client1.post(
        "/api/auth/login",
        json={"username": "idleuser", "password": TEST_PASSWORD},
    )
    assert resp1.status_code == 200

    # Manually age the session beyond idle timeout (last_seen_at back in time)
    now = clock.utcnow()
    idle_time = now - timedelta(minutes=test_settings.session_idle_minutes + 10)
    db_session.query(AuthSession).filter(AuthSession.user_id == user.id).update(
        {AuthSession.last_seen_at: idle_time}
    )
    db_session.commit()

    # Device 2 logs in -> should succeed with 200 without needing takeover=True
    resp2 = client2.post(
        "/api/auth/login",
        json={"username": "idleuser", "password": TEST_PASSWORD},
    )
    assert resp2.status_code == 200, resp2.text


def test_same_client_login_rotates_own_session_without_409(
    client: TestClient, admin_user: User
) -> None:
    """When the same client (with existing cookie) logs in again, it rotates without 409 conflict."""
    resp1 = client.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": TEST_PASSWORD},
    )
    assert resp1.status_code == 200

    # Same client (cookie preserved) logs in again
    resp2 = client.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": TEST_PASSWORD},
    )
    assert resp2.status_code == 200
