"""Tests for forced first-login password change and NIST-style password policy."""

from collections.abc import Callable

from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient
from pytest import MonkeyPatch
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.core.password_policy import BLOCKLIST
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.main import create_app
from kalyan_api.models import AuditLog
from tests.conftest import TEST_PASSWORD, make_user


def test_blocklist_length_meets_floor() -> None:
    """The embedded password blocklist must contain at least 100 entries."""
    assert len(BLOCKLIST) >= 100


def test_must_change_user_restricted_access_and_change_flow(
    app: FastAPI,
    db_session: Session,
    test_settings: Settings,
    login_client: Callable[..., TestClient],
) -> None:
    """must_change user is blocked from require() routes until password is changed."""
    # Add a require-protected throwaway endpoint
    router = APIRouter()

    @router.get("/test-admin", dependencies=[Depends(require(Permission.USER_READ))])
    def admin_endpoint() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(router)

    # Create user with must_change=True
    user = make_user(
        db_session,
        test_settings,
        "ADMIN",
        "pending_admin",
        must_change=True,
    )

    client1 = login_client(user)
    assert client1.cookies.get(test_settings.cookie_name) is not None

    # Login returns must_change_password=True
    me_res = client1.get("/api/auth/me")
    assert me_res.status_code == 200
    assert me_res.json()["must_change_password"] is True

    # require() route returns 403 password_change_required
    blocked_res = client1.get("/test-admin")
    assert blocked_res.status_code == 403
    assert blocked_res.json()["code"] == "password_change_required"

    # Create a secondary session for the same user to verify revocation
    client2 = login_client(user)
    old_token_2 = client2.cookies.get(test_settings.cookie_name)

    # Change password
    new_pw = "BrandNewValidPassword456!"
    change_res = client1.post(
        "/api/auth/change-password",
        json={"current_password": TEST_PASSWORD, "new_password": new_pw},
    )
    assert change_res.status_code == 200
    data = change_res.json()
    assert data["must_change_password"] is False
    new_csrf = data["csrf_token"]
    assert new_csrf

    # Client1 updates its CSRF token
    client1.headers["X-CSRF-Token"] = new_csrf

    # Now the require() route works!
    allowed_res = client1.get("/test-admin")
    assert allowed_res.status_code == 200
    assert allowed_res.json() == {"status": "ok"}

    # Secondary older session is now revoked (returns 401)
    client2.cookies.set(test_settings.cookie_name, old_token_2)
    stale_res = client2.get("/api/auth/me")
    assert stale_res.status_code == 401
    assert stale_res.json()["code"] == "not_authenticated"


def test_wrong_current_password_increments_counter_and_locks(
    db_session: Session,
    test_settings: Settings,
    login_client: Callable[..., TestClient],
) -> None:
    """Wrong current password returns 403, increments failed_login_count, and triggers lockout."""
    user = make_user(
        db_session,
        test_settings,
        "RECEPTION",
        "wrong_pw_user",
        must_change=True,
    )
    client = login_client(user)

    # 4 wrong attempts
    for _ in range(4):
        res = client.post(
            "/api/auth/change-password",
            json={"current_password": "WrongPassword999!", "new_password": "ValidNewPassword123!"},
        )
        assert res.status_code == 403
        assert res.json()["code"] == "current_password_invalid"

    db_session.refresh(user)
    assert user.failed_login_count == 4
    assert user.locked_until is None

    # 5th wrong attempt triggers lockout
    res_lock = client.post(
        "/api/auth/change-password",
        json={"current_password": "WrongPassword999!", "new_password": "ValidNewPassword123!"},
    )
    assert res_lock.status_code == 403
    assert res_lock.json()["code"] == "current_password_invalid"

    db_session.refresh(user)
    assert user.failed_login_count == 5
    assert user.locked_until is not None

    # Verify audit logs
    fail_audits = db_session.scalars(
        select(AuditLog).where(
            AuditLog.entity_id == str(user.id),
            AuditLog.action == "AUTH_PASSWORD_CHANGE_FAILED",
        )
    ).all()
    assert len(fail_audits) == 5

    lock_audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.entity_id == str(user.id),
            AuditLog.action == "AUTH_ACCOUNT_LOCKED",
        )
    )
    assert lock_audit is not None


def test_password_policy_validation_rules(
    db_session: Session,
    test_settings: Settings,
    login_client: Callable[..., TestClient],
) -> None:
    """NIST policy enforces min/max length, identity rejection, and blocklist."""
    user = make_user(
        db_session,
        test_settings,
        "ADMIN",
        "policy_admin",
        must_change=True,
    )
    client = login_client(user)

    def _try_pw(cand: str) -> tuple[int, str]:
        r = client.post(
            "/api/auth/change-password",
            json={"current_password": TEST_PASSWORD, "new_password": cand},
        )
        return r.status_code, r.json().get("code", "")

    # 1. Too short (9 chars < 10)
    st, cd = _try_pw("Abc123456")
    assert st == 422 and cd == "password_policy"

    # 2. Too long (> 128 chars)
    st, cd = _try_pw("A" * 129)
    assert st == 422 and cd == "password_policy"

    # 3. Same as current password
    st, cd = _try_pw(TEST_PASSWORD)
    assert st == 422 and cd == "password_policy"

    # 4. Same as username
    st, cd = _try_pw("policy_admin")
    assert st == 422 and cd == "password_policy"

    # 5. Same as full name
    st, cd = _try_pw(user.full_name)
    assert st == 422 and cd == "password_policy"

    # 6. Blocklisted password
    st, cd = _try_pw("kalyan123")
    assert st == 422 and cd == "password_policy"

    # 7. 12 plain letters accepted (no artificial character composition required)
    st, cd = _try_pw("correcthorse")
    assert st == 200

    # 8. Unicode password accepted on next change (current_password is now "correcthorse")
    me_data = client.get("/api/auth/me").json()
    client.headers["X-CSRF-Token"] = me_data["csrf_token"]

    r_unicode = client.post(
        "/api/auth/change-password",
        json={"current_password": "correcthorse", "new_password": "कल्याणहॉस्पिटल२०२६"},
    )
    assert r_unicode.status_code == 200


def test_password_min_length_settings_override(
    test_settings: Settings,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    """KALYAN_PASSWORD_MIN_LENGTH override to 12 rejects 11-char passwords."""
    monkeypatch.setenv("KALYAN_PASSWORD_MIN_LENGTH", "12")
    override_settings = Settings(
        env="test",
        db_name=test_settings.db_name,
        password_min_length=12,
    )
    assert override_settings.password_min_length == 12

    app = create_app(override_settings)

    from kalyan_api.db.session import get_session

    def _override_get_session():
        with db_session.begin_nested():
            yield db_session

    app.dependency_overrides[get_session] = _override_get_session

    user = make_user(db_session, override_settings, "ADMIN", "override_user", must_change=True)

    with TestClient(
        app, base_url="http://testserver", headers={"Origin": "http://testserver"}
    ) as c:
        l_res = c.post(
            "/api/auth/login",
            json={"username": user.username, "password": TEST_PASSWORD},
        )
        assert l_res.status_code == 200
        c.headers["X-CSRF-Token"] = l_res.json()["csrf_token"]

        # 11 chars: rejected
        r11 = c.post(
            "/api/auth/change-password",
            json={"current_password": TEST_PASSWORD, "new_password": "ElevenChars"},
        )
        assert r11.status_code == 422
        assert "12 characters" in r11.json()["message"]

        # 12 chars: accepted
        r12 = c.post(
            "/api/auth/change-password",
            json={"current_password": TEST_PASSWORD, "new_password": "TwelveChars!"},
        )
        assert r12.status_code == 200


def test_audit_never_contains_plain_passwords(
    db_session: Session,
    test_settings: Settings,
    login_client: Callable[..., TestClient],
) -> None:
    """Audit logs for password change events never contain candidate or old passwords."""
    secret_old = "OldSecretPassword123!"
    secret_new = "NewSecretPassword456!"

    user = make_user(
        db_session,
        test_settings,
        "ADMIN",
        "audit_redact_user",
        password=secret_old,
        must_change=True,
    )
    client = login_client(user, password=secret_old)

    # 1. Failed change attempt
    client.post(
        "/api/auth/change-password",
        json={"current_password": "WrongPassword999!", "new_password": secret_new},
    )

    # 2. Successful change attempt
    client.post(
        "/api/auth/change-password",
        json={"current_password": secret_old, "new_password": secret_new},
    )

    # Inspect all audit records for this user
    audits = db_session.scalars(select(AuditLog).where(AuditLog.entity_id == str(user.id))).all()

    for a in audits:
        raw_text = f"{a.before_data} {a.after_data} {a.reason}"
        assert secret_old not in raw_text
        assert secret_new not in raw_text
        assert "WrongPassword999!" not in raw_text
