"""Tests for session lifecycle, expiration, touch throttling, passive mode, and RBAC enforcement."""

import hashlib
from collections.abc import Callable
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient
from pytest import MonkeyPatch
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.models import AuditLog, AuthSession, User
from kalyan_api.services import audit_service


def test_session_idle_and_periodic_expiration(
    clock: dict[str, Any],
    login_client: Callable[..., TestClient],
    admin_user: User,
) -> None:
    """Session expires after 30m idle, but remains valid with periodic requests every 20m."""
    client = login_client(admin_user)

    # +20 minutes: active request refreshes last_seen_at
    clock["t"] += timedelta(minutes=20)
    res_20 = client.get("/api/auth/me")
    assert res_20.status_code == 200

    # +40 minutes (20 min after previous): still valid
    clock["t"] += timedelta(minutes=20)
    res_40 = client.get("/api/auth/me")
    assert res_40.status_code == 200

    # +29 minutes after last request: still within 30 min idle window
    clock["t"] += timedelta(minutes=29)
    res_69 = client.get("/api/auth/me")
    assert res_69.status_code == 200

    # +31 minutes without activity: idle expiration triggered
    clock["t"] += timedelta(minutes=31)
    res_expired = client.get("/api/auth/me")
    assert res_expired.status_code == 401
    assert res_expired.json()["code"] == "session_expired"


def test_session_absolute_timeout_after_twelve_hours(
    clock: dict[str, Any],
    login_client: Callable[..., TestClient],
    admin_user: User,
) -> None:
    """Active session expires after 12 hours max lifetime regardless of continuous activity."""
    client = login_client(admin_user)

    # Keep session active with requests every 20 minutes for 11 hours (33 requests)
    for _ in range(33):
        clock["t"] += timedelta(minutes=20)
        res = client.get("/api/auth/me")
        assert res.status_code == 200

    # Advance past 12-hour limit (12 hours = 720 minutes from session creation)
    clock["t"] += timedelta(minutes=70)
    res_abs_expired = client.get("/api/auth/me")
    assert res_abs_expired.status_code == 401
    assert res_abs_expired.json()["code"] == "session_expired"


def test_session_touch_throttling_and_passive_header(
    clock: dict[str, Any],
    login_client: Callable[..., TestClient],
    admin_user: User,
    db_session: Session,
) -> None:
    """last_seen_at is throttled to 60s windows and skipped when X-Kalyan-Passive: 1."""
    t0 = clock["t"]
    client = login_client(admin_user)

    # Retrieve initial session record
    sess_row = db_session.scalar(
        select(AuthSession).where(AuthSession.user_id == admin_user.id)
    )
    assert sess_row is not None
    initial_last_seen = sess_row.last_seen_at

    # Request at +30 seconds: touch throttled (elapsed < 60s)
    clock["t"] += timedelta(seconds=30)
    res_30 = client.get("/api/auth/me")
    assert res_30.status_code == 200
    db_session.refresh(sess_row)
    assert sess_row.last_seen_at == initial_last_seen

    # Request at +61 seconds: touch window elapsed -> last_seen_at updated to t0 + 61s
    clock["t"] = t0 + timedelta(seconds=61)
    res_61 = client.get("/api/auth/me")
    assert res_61.status_code == 200
    db_session.refresh(sess_row)
    assert sess_row.last_seen_at == clock["t"]
    updated_last_seen = sess_row.last_seen_at

    # Request at +150 seconds WITH X-Kalyan-Passive: 1 -> touch suppressed
    clock["t"] = t0 + timedelta(seconds=150)
    res_passive = client.get("/api/auth/me", headers={"X-Kalyan-Passive": "1"})
    assert res_passive.status_code == 200
    db_session.refresh(sess_row)
    assert sess_row.last_seen_at == updated_last_seen


def test_logout_revokes_session_deletes_cookie_and_audits(
    login_client: Callable[..., TestClient],
    admin_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    """POST /api/auth/logout sets revoked_at, records AUTH_LOGOUT, and deletes cookie."""
    client = login_client(admin_user)

    res_logout = client.post("/api/auth/logout")
    assert res_logout.status_code == 204

    # Cookie deleted
    cookie_header = res_logout.headers.get("set-cookie", "")
    assert f"{test_settings.cookie_name}=" in cookie_header
    assert "max-age=0" in cookie_header.lower() or "expires=" in cookie_header.lower()

    # Session record marked revoked
    sess_row = db_session.scalar(
        select(AuthSession).where(AuthSession.user_id == admin_user.id)
    )
    assert sess_row is not None
    assert sess_row.revoked_at is not None

    # Audit log emitted
    audit_row = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.entity_type == "USER",
            AuditLog.entity_id == str(admin_user.id),
            AuditLog.action == "AUTH_LOGOUT",
        )
    )
    assert audit_row is not None
    assert audit_row.actor_username == admin_user.username

    # Subsequent /me returns 401 not_authenticated
    res_me = client.get("/api/auth/me")
    assert res_me.status_code == 401
    assert res_me.json()["code"] == "not_authenticated"


def test_deactivated_user_session_is_rejected(
    login_client: Callable[..., TestClient],
    reception_user: User,
    db_session: Session,
) -> None:
    """Active session of a deactivated user is rejected with 401 not_authenticated."""
    client = login_client(reception_user)

    # Deactivate user
    reception_user.is_active = False
    db_session.flush()

    res_me = client.get("/api/auth/me")
    assert res_me.status_code == 401
    assert res_me.json()["code"] == "not_authenticated"


def test_token_hash_stored_as_sha256_and_raw_token_never_persisted(
    login_client: Callable[..., TestClient],
    admin_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    """Session token stored exclusively as SHA-256 hash in auth_sessions table."""
    client = login_client(admin_user)
    raw_cookie = client.cookies.get(test_settings.cookie_name)
    assert raw_cookie is not None

    expected_hash = hashlib.sha256(raw_cookie.encode("utf-8")).hexdigest()

    sess_row = db_session.scalar(
        select(AuthSession).where(AuthSession.user_id == admin_user.id)
    )
    assert sess_row is not None
    assert sess_row.token_hash == expected_hash
    assert sess_row.token_hash != raw_cookie


def test_require_policy_marker_enforcement(
    app: FastAPI,
    client: TestClient,
    login_client: Callable[..., TestClient],
    admin_user: User,
    reception_user: User,
) -> None:
    """Protected endpoint enforces require(Permission.USER_READ) with 401/403/200 checks."""
    test_router = APIRouter(prefix="/test-policy")

    @test_router.get("/protected", dependencies=[Depends(require(Permission.USER_READ))])
    def protected_route() -> dict[str, str]:
        return {"status": "authorized"}

    app.include_router(test_router)

    # Anonymous request -> 401 not_authenticated
    res_anon = client.get("/test-policy/protected")
    assert res_anon.status_code == 401
    assert res_anon.json()["code"] == "not_authenticated"

    # Reception user (lacks user:read) -> 403 forbidden
    reception_c = login_client(reception_user)
    res_rec = reception_c.get("/test-policy/protected")
    assert res_rec.status_code == 403
    assert res_rec.json()["code"] == "forbidden"
    assert "user:read" in res_rec.json()["message"]

    # Admin user (has user:read) -> 200 OK
    admin_c = login_client(admin_user)
    res_admin = admin_c.get("/test-policy/protected")
    assert res_admin.status_code == 200
    assert res_admin.json() == {"status": "authorized"}


def test_fail_closed_login_rolls_back_session_creation(
    app: FastAPI,
    admin_user: User,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    """If audit log write fails during login, request fails and no session row is persisted."""
    def _exploding_record(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("Audit storage failure injection")

    monkeypatch.setattr(audit_service, "record", _exploding_record)

    from tests.conftest import TEST_PASSWORD

    with TestClient(app, base_url="http://testserver", raise_server_exceptions=False) as client:
        res = client.post(
            "/api/auth/login",
            json={"username": admin_user.username, "password": TEST_PASSWORD},
        )
        assert res.status_code == 500

    # Ensure no AuthSession row was committed for admin_user
    sess_rows = db_session.scalars(
        select(AuthSession).where(AuthSession.user_id == admin_user.id)
    ).all()
    assert len(sess_rows) == 0
