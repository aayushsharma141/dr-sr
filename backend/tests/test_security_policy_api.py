"""Read-only security policy and password policy endpoint tests (Admin module 09)."""

from collections.abc import Callable, Generator

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.db.session import get_session
from kalyan_api.main import create_app
from kalyan_api.models import User
from tests.conftest import TEST_PASSWORD, make_user

POLICY = "/api/security/policy"
PASSWORD_POLICY = "/api/security/password-policy"


def _app_with_settings(db_session: Session, settings: Settings) -> FastAPI:
    """Build an app bound to the test transaction with custom settings."""
    app = create_app(settings=settings)

    def _override_get_session() -> Generator[Session, None, None]:
        with db_session.begin_nested():
            yield db_session

    app.dependency_overrides[get_session] = _override_get_session
    return app


def _login(app: FastAPI, user: User) -> TestClient:
    c = TestClient(app, base_url="http://testserver", headers={"Origin": "http://testserver"})
    res = c.post("/api/auth/login", json={"username": user.username, "password": TEST_PASSWORD})
    assert res.status_code == 200, res.text
    c.headers["X-CSRF-Token"] = res.json()["csrf_token"]
    return c


def test_admin_reads_effective_policy(
    login_client: Callable[..., TestClient], admin_user: User, test_settings: Settings
) -> None:
    """Policy values equal the effective Settings and are flagged read-only."""
    res = login_client(admin_user).get(POLICY)
    assert res.status_code == 200
    body = res.json()
    assert body["session_idle_minutes"] == test_settings.session_idle_minutes
    assert body["session_absolute_hours"] == test_settings.session_absolute_hours
    assert body["lockout_threshold"] == test_settings.lockout_threshold
    assert body["lockout_minutes"] == test_settings.lockout_minutes
    assert body["throttle_max_failures"] == test_settings.throttle_max_failures
    assert body["throttle_window_minutes"] == test_settings.throttle_window_minutes
    assert body["password_min_length"] == test_settings.password_min_length
    assert body["password_max_length"] == test_settings.password_max_length
    assert body["source"] == "environment"
    assert body["editable"] is True
    assert body["limits"]["session_idle_minutes"]["maximum"] == test_settings.session_idle_minutes


def test_policy_reflects_configured_overrides(db_session: Session, test_settings: Settings) -> None:
    """Non-default environment values are reported, not hardcoded defaults."""
    custom = test_settings.model_copy(
        update={
            "session_idle_minutes": 45,
            "session_absolute_hours": 8,
            "lockout_threshold": 7,
            "lockout_minutes": 20,
            "throttle_max_failures": 30,
            "throttle_window_minutes": 10,
            "password_min_length": 12,
            "password_max_length": 200,
        }
    )
    app = _app_with_settings(db_session, custom)
    admin = make_user(db_session, custom, "ADMIN", "policy_override_admin")
    body = _login(app, admin).get(POLICY).json()
    assert body["session_idle_minutes"] == 45
    assert body["session_absolute_hours"] == 8
    assert body["lockout_threshold"] == 7
    assert body["lockout_minutes"] == 20
    assert body["throttle_max_failures"] == 30
    assert body["throttle_window_minutes"] == 10
    assert body["password_min_length"] == 12
    assert body["password_max_length"] == 200

    pw = _login(app, admin).get(PASSWORD_POLICY).json()
    assert pw == {"min_length": 12, "max_length": 200}


def test_policy_forbidden_for_non_admin_and_anonymous(
    client: TestClient,
    login_client: Callable[..., TestClient],
    reception_user: User,
    doctor_a_user: User,
) -> None:
    """RECEPTION and DOCTOR get 403; anonymous gets 401."""
    assert client.get(POLICY).status_code == 401
    assert login_client(reception_user).get(POLICY).status_code == 403
    assert login_client(doctor_a_user).get(POLICY).status_code == 403


def test_only_policy_patch_is_writable(
    login_client: Callable[..., TestClient], admin_user: User
) -> None:
    """PATCH /policy is the single write path; see test_security_policy_update.py."""
    admin_c = login_client(admin_user)
    for method in ("POST", "PUT", "DELETE"):
        assert admin_c.request(method, POLICY, json={}).status_code == 405, method
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        assert admin_c.request(method, PASSWORD_POLICY, json={}).status_code == 405, method


def test_password_policy_readable_by_every_authenticated_role(
    client: TestClient,
    login_client: Callable[..., TestClient],
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    test_settings: Settings,
) -> None:
    """All roles read password bounds; anonymous callers get 401."""
    expected = {
        "min_length": test_settings.password_min_length,
        "max_length": test_settings.password_max_length,
    }
    for user in (admin_user, reception_user, doctor_a_user):
        res = login_client(user).get(PASSWORD_POLICY)
        assert res.status_code == 200
        assert res.json() == expected
    assert client.get(PASSWORD_POLICY).status_code == 401


def test_password_policy_readable_during_forced_password_change(
    login_client: Callable[..., TestClient], db_session: Session, test_settings: Settings
) -> None:
    """A user with must_change_password can read bounds but not admin-only resources."""
    pending = make_user(db_session, test_settings, "ADMIN", "pending_pw_admin", must_change=True)
    c = login_client(pending)
    assert c.get(PASSWORD_POLICY).status_code == 200
    blocked = c.get(POLICY)
    assert blocked.status_code == 403
    assert blocked.json()["code"] == "password_change_required"
