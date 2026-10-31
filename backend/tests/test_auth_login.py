"""Tests for individual user authentication, cookie semantics, and login audit events (SEC-01)."""

import json

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.db.session import get_session
from kalyan_api.main import create_app
from kalyan_api.models import AuditLog, User
from kalyan_api.routers.auth import GENERIC_INVALID_CREDENTIALS_MSG
from tests.conftest import TEST_PASSWORD, make_user


def test_login_happy_path_sets_cookie_and_returns_me_response(
    client: TestClient, admin_user: User
) -> None:
    """POST /api/auth/login returns 200 with MeResponse and session cookie."""
    response = client.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": TEST_PASSWORD},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == admin_user.id
    assert data["username"] == admin_user.username
    assert data["role"] == "ADMIN"
    assert "user:read" in data["permissions"]
    assert len(data["csrf_token"]) > 20
    assert data["version_id"] == admin_user.version_id


def test_session_cookie_attributes_for_plain_http_lan(
    client: TestClient, admin_user: User
) -> None:
    """Set-Cookie has HttpOnly, SameSite=Strict, Path=/, and lacks Secure, Max-Age, Expires."""
    response = client.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": TEST_PASSWORD},
    )
    assert response.status_code == 200
    cookie_header = response.headers.get("set-cookie", "")
    assert cookie_header, "set-cookie header missing"

    cookie_lower = cookie_header.lower()
    assert "httponly" in cookie_lower
    assert "samesite=strict" in cookie_lower
    assert "path=/" in cookie_lower
    assert "secure" not in cookie_lower
    assert "max-age" not in cookie_lower
    assert "expires" not in cookie_lower


def test_me_endpoint_round_trip_and_unauthenticated_guard(
    client: TestClient, reception_user: User
) -> None:
    """GET /api/auth/me returns caller profile with valid cookie; 401 when unauthenticated."""
    # 1. Unauthenticated request without cookie returns 401
    unauth_res = client.get("/api/auth/me")
    assert unauth_res.status_code == 401
    assert unauth_res.json()["code"] == "not_authenticated"

    # 2. Login populates cookie jar in client
    login_res = client.post(
        "/api/auth/login",
        json={"username": reception_user.username, "password": TEST_PASSWORD},
    )
    assert login_res.status_code == 200

    # 3. Subsequent /me succeeds with session cookie
    me_res = client.get("/api/auth/me")
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["username"] == reception_user.username
    assert me_data["role"] == "RECEPTION"
    assert "patient:create" in me_data["permissions"]


def test_byte_identical_failure_responses_prevent_enumeration(
    client: TestClient, admin_user: User, db_session: Session, test_settings: Settings
) -> None:
    """Unknown user, wrong password, and deactivated account return byte-identical 401 bodies."""
    # Create an inactive user
    inactive_user = make_user(
        db_session, test_settings, "RECEPTION", "inactive_tester", is_active=False
    )

    # 1. Unknown username
    res_unknown = client.post(
        "/api/auth/login",
        json={"username": "totally_nonexistent_user", "password": "WrongPassword123!"},
    )
    # 2. Known user with incorrect password
    res_bad_pw = client.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": "WrongPassword123!"},
    )
    # 3. Deactivated user with correct password
    res_inactive = client.post(
        "/api/auth/login",
        json={"username": inactive_user.username, "password": TEST_PASSWORD},
    )

    assert res_unknown.status_code == 401
    assert res_bad_pw.status_code == 401
    assert res_inactive.status_code == 401

    # Invariant: Byte-identical responses prevent timing and response body user enumeration
    assert res_unknown.content == res_bad_pw.content
    assert res_unknown.content == res_inactive.content

    data = res_unknown.json()
    assert data["code"] == "invalid_credentials"
    assert data["message"] == GENERIC_INVALID_CREDENTIALS_MSG


def test_login_rejects_extra_fields_with_422(client: TestClient) -> None:
    """LoginRequest model enforces extra='forbid' to prevent parameter injection."""
    response = client.post(
        "/api/auth/login",
        json={
            "username": "admin",
            "password": TEST_PASSWORD,
            "extra_field": "disallowed",
        },
    )
    assert response.status_code == 422
    data = response.json()
    assert data["code"] == "validation_error"


def test_cookie_secure_trap_regression_guard(
    test_settings: Settings, admin_user: User, db_session: Session
) -> None:
    """Demonstrates that a Secure cookie is dropped by clients over plain HTTP (D-01 trap)."""
    # Create app configured with cookie_secure=True
    secure_settings = Settings(
        env="test",
        db_name=test_settings.db_name,
        cookie_secure=True,
    )
    app = create_app(secure_settings)

    def _override_get_session():
        with db_session.begin_nested():
            yield db_session

    app.dependency_overrides[get_session] = _override_get_session

    with TestClient(
        app, base_url="http://testserver", headers={"Origin": "http://testserver"}
    ) as client:
        # Login succeeds over plain HTTP and emits Set-Cookie with Secure
        res_login = client.post(
            "/api/auth/login",
            json={"username": admin_user.username, "password": TEST_PASSWORD},
        )
        assert res_login.status_code == 200
        assert "secure" in res_login.headers.get("set-cookie", "").lower()

        # Plain HTTP client refuses to send back Secure cookie -> subsequent call is 401
        res_me = client.get("/api/auth/me")
        assert res_me.status_code == 401
        assert res_me.json()["code"] == "not_authenticated"


def test_login_auditing_and_token_omission(
    client: TestClient, admin_user: User, db_session: Session
) -> None:
    """Login emits AUTH_LOGIN_SUCCEEDED without leaking session token or password to audit."""
    login_res = client.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": TEST_PASSWORD},
    )
    assert login_res.status_code == 200
    cookie_token = client.cookies.get("kalyan_session")
    assert cookie_token is not None

    # Inspect audit_logs
    audit_row = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.actor_user_id == admin_user.id,
            AuditLog.action == "AUTH_LOGIN_SUCCEEDED",
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit_row is not None
    assert audit_row.outcome == "SUCCESS"
    assert audit_row.actor_username == admin_user.username

    # Verify neither raw token nor plaintext password appears in audit row fields
    serialized_audit = json.dumps({
        "before": audit_row.before_data,
        "after": audit_row.after_data,
        "reason": audit_row.reason,
    })
    assert cookie_token not in serialized_audit
    assert TEST_PASSWORD not in serialized_audit
