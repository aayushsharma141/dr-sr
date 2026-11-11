"""Admin session monitoring and revocation tests (Admin module 09).

Covers GET /api/sessions, POST /api/sessions/{session_id}/revoke and
POST /api/users/{id}/revoke-sessions: authorization, validity rules shared with request
authentication, own-session refusal, audit rows, and absence of credential material.
"""

from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.models import AuditLog, AuthSession, User
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.auth_service import create_session

SECRET_KEYS = {"token", "token_hash", "csrf_token", "password", "password_hash"}


def _add_direct_session(
    app: Any,
    db_session: Session,
    user: User,
    test_settings: Settings,
    client_ip: str = "192.168.1.50",
    user_agent: str = "pytest-direct-session",
) -> TestClient:
    """Helper to create an active AuthSession directly in DB and return authenticated TestClient
    without login endpoint."""
    auth_sess, raw_token = create_session(
        db_session, user, client_ip=client_ip, user_agent=user_agent
    )
    c = TestClient(app, base_url="http://testserver", headers={"Origin": "http://testserver"})
    c.cookies.set(test_settings.cookie_name, raw_token)
    c.headers["X-CSRF-Token"] = auth_sess.csrf_token
    return c


def _assert_no_secret_keys(payload: Any) -> None:
    if isinstance(payload, dict):
        for key, value in payload.items():
            assert key not in SECRET_KEYS, f"secret key {key!r} leaked"
            _assert_no_secret_keys(value)
    elif isinstance(payload, list):
        for item in payload:
            _assert_no_secret_keys(item)


def _session_ids_for(db_session: Session, user: User) -> list[int]:
    return list(
        db_session.scalars(
            select(AuthSession.id)
            .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
            .order_by(AuthSession.id)
        ).all()
    )


def test_list_sessions_shows_active_sessions_without_secrets(
    login_client: Callable[..., TestClient],
    admin_user: User,
    reception_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    """Active sessions carry owner, network and expiry fields but never the token."""
    admin_c = login_client(admin_user)
    rec_c = login_client(reception_user)

    res = admin_c.get("/api/sessions")
    assert res.status_code == 200
    items = res.json()
    _assert_no_secret_keys(items)

    raw_tokens = [c.cookies.get(test_settings.cookie_name) for c in (admin_c, rec_c)]
    csrf_tokens = list(db_session.scalars(select(AuthSession.csrf_token)).all())
    token_hashes = list(db_session.scalars(select(AuthSession.token_hash)).all())
    for secret in [*raw_tokens, *csrf_tokens, *token_hashes]:
        assert secret
        assert secret not in res.text

    by_user = {item["user_id"]: item for item in items}
    assert {admin_user.id, reception_user.id} <= set(by_user)
    rec_item = by_user[reception_user.id]
    assert set(rec_item.keys()) == {
        "id",
        "user_id",
        "username",
        "full_name",
        "role",
        "ip_address",
        "user_agent",
        "created_at",
        "last_seen_at",
        "idle_expires_at",
        "absolute_expires_at",
        "is_current",
    }
    assert rec_item["username"] == reception_user.username
    assert rec_item["full_name"] == reception_user.full_name
    assert rec_item["role"] == "RECEPTION"
    assert rec_item["is_current"] is False
    assert by_user[admin_user.id]["is_current"] is True

    sess = db_session.get(AuthSession, rec_item["id"])
    assert sess is not None
    db_session.refresh(sess)
    idle = datetime.fromisoformat(rec_item["idle_expires_at"])
    absolute = datetime.fromisoformat(rec_item["absolute_expires_at"])
    assert idle == sess.last_seen_at + timedelta(minutes=test_settings.session_idle_minutes)
    assert absolute == sess.created_at + timedelta(hours=test_settings.session_absolute_hours)


def test_list_sessions_user_filter(
    app: Any,
    login_client: Callable[..., TestClient],
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    """?user_id narrows the list to one user's sessions."""
    admin_c = login_client(admin_user)
    _add_direct_session(app, db_session, reception_user, test_settings, client_ip="192.168.1.101")
    _add_direct_session(app, db_session, reception_user, test_settings, client_ip="192.168.1.102")
    _add_direct_session(app, db_session, doctor_a_user, test_settings, client_ip="192.168.1.103")

    res = admin_c.get("/api/sessions", params={"user_id": reception_user.id})
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 2
    assert {i["user_id"] for i in items} == {reception_user.id}

    none_res = admin_c.get("/api/sessions", params={"user_id": 99999999})
    assert none_res.status_code == 200
    assert none_res.json() == []


def test_list_excludes_revoked_idle_and_absolute_expired_sessions(
    clock: dict[str, Any],
    login_client: Callable[..., TestClient],
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    """Validity mirrors request authentication: revoked, idle and absolute-expired excluded."""
    idle_c = login_client(reception_user)
    idle_ids = _session_ids_for(db_session, reception_user)

    clock["t"] += timedelta(minutes=test_settings.session_idle_minutes + 1)
    admin_c = login_client(admin_user)
    login_client(doctor_a_user)
    doctor_ids = _session_ids_for(db_session, doctor_a_user)

    # Doctor session is fresh but forced past its absolute lifetime
    db_session.execute(
        update(AuthSession)
        .where(AuthSession.id.in_(doctor_ids))
        .values(created_at=clock["t"] - timedelta(hours=test_settings.session_absolute_hours + 1))
    )
    db_session.flush()

    listed = {i["id"] for i in admin_c.get("/api/sessions").json()}
    assert not set(idle_ids) & listed
    assert not set(doctor_ids) & listed
    # Sanity: these sessions really do fail authentication
    assert idle_c.get("/api/auth/me").status_code == 401

    # Revoking an expired session reports 404 (not active)
    res = admin_c.post(f"/api/sessions/{idle_ids[0]}/revoke", json={})
    assert res.status_code == 404
    assert res.json()["code"] == "session_not_found"


def test_revoke_session_stops_authentication_and_audits(
    login_client: Callable[..., TestClient],
    admin_user: User,
    reception_user: User,
    db_session: Session,
) -> None:
    """Revoked session immediately stops authenticating; SESSION_REVOKED audit recorded."""
    admin_c = login_client(admin_user)
    rec_c = login_client(reception_user)
    assert rec_c.get("/api/auth/me").status_code == 200
    (rec_sid,) = _session_ids_for(db_session, reception_user)

    res = admin_c.post(f"/api/sessions/{rec_sid}/revoke", json={"reason": "  Left terminal  "})
    assert res.status_code == 200
    body = res.json()
    assert body["id"] == rec_sid
    assert body["user_id"] == reception_user.id
    assert body["revoked_at"]
    _assert_no_secret_keys(body)

    after = rec_c.get("/api/auth/me")
    assert after.status_code == 401
    assert after.json()["code"] == "not_authenticated"

    row = db_session.scalar(
        select(AuditLog)
        .where(AuditLog.action == AuditAction.SESSION_REVOKED.value)
        .order_by(AuditLog.id.desc())
    )
    assert row is not None
    assert row.entity_type == "SESSION"
    assert row.entity_id == str(rec_sid)
    assert row.actor_user_id == admin_user.id
    assert row.reason == "Left terminal"
    assert row.before_data is not None and row.after_data is not None
    assert row.before_data["user_id"] == reception_user.id
    assert row.before_data["revoked_at"] is None
    assert row.after_data["user_id"] == reception_user.id
    assert row.after_data["revoked_at"] is not None

    # Already revoked -> 404
    again = admin_c.post(f"/api/sessions/{rec_sid}/revoke", json={})
    assert again.status_code == 404
    assert again.json()["code"] == "session_not_found"


def test_revoke_unknown_session_404_and_body_validation(
    login_client: Callable[..., TestClient],
    admin_user: User,
    reception_user: User,
    db_session: Session,
) -> None:
    """Unknown ids are 404; reason over 500 chars and extra fields are 422."""
    admin_c = login_client(admin_user)
    assert admin_c.post("/api/sessions/99999999/revoke", json={}).status_code == 404

    login_client(reception_user)
    (rec_sid,) = _session_ids_for(db_session, reception_user)
    too_long = admin_c.post(f"/api/sessions/{rec_sid}/revoke", json={"reason": "x" * 501})
    assert too_long.status_code == 422
    extra = admin_c.post(f"/api/sessions/{rec_sid}/revoke", json={"user_id": 1})
    assert extra.status_code == 422
    # Still active after rejected requests
    assert _session_ids_for(db_session, reception_user) == [rec_sid]

    blank = admin_c.post(f"/api/sessions/{rec_sid}/revoke", json={"reason": "   "})
    assert blank.status_code == 200
    row = db_session.scalar(
        select(AuditLog)
        .where(AuditLog.action == AuditAction.SESSION_REVOKED.value)
        .order_by(AuditLog.id.desc())
    )
    assert row is not None and row.reason is None


def test_cannot_revoke_own_current_session_but_can_revoke_own_other_session(
    login_client: Callable[..., TestClient], admin_user: User, db_session: Session
) -> None:
    """Own current session refused with 409; a second own session may be revoked."""
    admin_c = login_client(admin_user)
    current = next(i for i in admin_c.get("/api/sessions").json() if i["is_current"])

    res = admin_c.post(f"/api/sessions/{current['id']}/revoke", json={})
    assert res.status_code == 409
    assert res.json()["code"] == "cannot_revoke_current_session"
    assert admin_c.get("/api/auth/me").status_code == 200
    refused_audits = db_session.scalars(
        select(AuditLog).where(
            AuditLog.action == AuditAction.SESSION_REVOKED.value,
            AuditLog.entity_id == str(current["id"]),
        )
    ).all()
    assert refused_audits == []

    other_c = _add_direct_session(
        admin_c.app,
        db_session,
        admin_user,
        admin_c.app.state.settings
        if hasattr(admin_c.app.state, "settings")
        else Settings(env="test"),
    )
    other_id = next(i["id"] for i in other_c.get("/api/sessions").json() if i["is_current"])
    ok = admin_c.post(f"/api/sessions/{other_id}/revoke", json={})
    assert ok.status_code == 200
    assert other_c.get("/api/auth/me").status_code == 401
    assert admin_c.get("/api/auth/me").status_code == 200


def test_session_endpoints_authorization(
    client: TestClient,
    login_client: Callable[..., TestClient],
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """ADMIN 200; RECEPTION and DOCTOR 403; anonymous 401 on every session endpoint."""
    admin_c = login_client(admin_user)
    rec_c = login_client(reception_user)
    doc_c = login_client(doctor_a_user)
    (rec_sid,) = _session_ids_for(db_session, reception_user)

    assert client.get("/api/sessions").status_code == 401
    assert client.post(f"/api/sessions/{rec_sid}/revoke", json={}).status_code == 401
    assert client.post(f"/api/users/{reception_user.id}/revoke-sessions", json={}).status_code == (
        401
    )

    for c in (rec_c, doc_c):
        assert c.get("/api/sessions").status_code == 403
        assert c.post(f"/api/sessions/{rec_sid}/revoke", json={}).status_code == 403
        assert c.post(f"/api/users/{admin_user.id}/revoke-sessions", json={}).status_code == 403

    # Rejected attempts did not revoke anything
    assert _session_ids_for(db_session, reception_user) == [rec_sid]
    assert admin_c.get("/api/sessions").status_code == 200


def test_revoke_all_user_sessions(
    app: Any,
    login_client: Callable[..., TestClient],
    admin_user: User,
    reception_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    """Every active session of the target is revoked and USER_SESSIONS_REVOKED audited."""
    admin_c = login_client(admin_user)
    rec_a = _add_direct_session(
        app, db_session, reception_user, test_settings, client_ip="192.168.1.101"
    )
    rec_b = _add_direct_session(
        app, db_session, reception_user, test_settings, client_ip="192.168.1.102"
    )
    before_ids = _session_ids_for(db_session, reception_user)
    assert len(before_ids) == 2

    res = admin_c.post(
        f"/api/users/{reception_user.id}/revoke-sessions", json={"reason": "Shift ended"}
    )
    assert res.status_code == 200
    assert res.json() == {
        "user_id": reception_user.id,
        "revoked_count": 2,
        "kept_current_session": False,
    }
    assert rec_a.get("/api/auth/me").status_code == 401
    assert rec_b.get("/api/auth/me").status_code == 401
    assert admin_c.get("/api/auth/me").status_code == 200

    row = db_session.scalar(
        select(AuditLog)
        .where(AuditLog.action == AuditAction.USER_SESSIONS_REVOKED.value)
        .order_by(AuditLog.id.desc())
    )
    assert row is not None
    assert row.entity_type == "USER"
    assert row.entity_id == str(reception_user.id)
    assert row.reason == "Shift ended"
    assert row.before_data == {"active_session_count": 2}
    assert row.after_data is not None
    assert row.after_data["revoked_count"] == 2
    assert row.after_data["active_session_count"] == 0
    assert row.after_data["revoked_session_ids"] == sorted(before_ids)

    # Nothing left: count 0, still audited
    empty = admin_c.post(f"/api/users/{reception_user.id}/revoke-sessions", json={})
    assert empty.status_code == 200
    assert empty.json()["revoked_count"] == 0


def test_revoke_own_sessions_keeps_current(
    app: Any,
    login_client: Callable[..., TestClient],
    admin_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    """Targeting oneself revokes other sessions while keeping the caller's current one."""
    admin_a = login_client(admin_user)
    admin_b = _add_direct_session(
        app, db_session, admin_user, test_settings, client_ip="192.168.1.104"
    )

    res = admin_a.post(f"/api/users/{admin_user.id}/revoke-sessions", json={})
    assert res.status_code == 200
    assert res.json()["revoked_count"] == 1
    assert res.json()["kept_current_session"] is True
    assert admin_a.get("/api/auth/me").status_code == 200
    assert admin_b.get("/api/auth/me").status_code == 401
    assert len(_session_ids_for(db_session, admin_user)) == 1


def test_revoke_sessions_unknown_user_404(
    login_client: Callable[..., TestClient], admin_user: User, db_session: Session
) -> None:
    """Unknown user id yields 404 and no audit row."""
    admin_c = login_client(admin_user)
    res = admin_c.post("/api/users/99999999/revoke-sessions", json={})
    assert res.status_code == 404
    assert res.json()["code"] == "not_found"
    rows = db_session.scalars(
        select(AuditLog).where(
            AuditLog.action == AuditAction.USER_SESSIONS_REVOKED.value,
            AuditLog.entity_id == "99999999",
        )
    ).all()
    assert rows == []
