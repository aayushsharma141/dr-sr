"""Administrator security policy: persistence, tighten-only limits, audit, and real enforcement."""

from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.core.password_policy import PasswordPolicyError, validate_password_policy
from kalyan_api.models import AuditLog, SecuritySettings, User
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.security_policy_service import effective_settings
from kalyan_api.services.user_service import generate_temp_password
from tests.conftest import TEST_PASSWORD

POLICY = "/api/security/policy"
REASON = "Tightened after the security review"


def _body(client: TestClient, **changes: Any) -> dict[str, Any]:
    """Build a full PATCH body from the current policy with selected values changed."""
    current = client.get(POLICY).json()
    body = {
        "version_id": current["version_id"],
        "session_idle_minutes": current["session_idle_minutes"],
        "session_absolute_hours": current["session_absolute_hours"],
        "lockout_threshold": current["lockout_threshold"],
        "lockout_minutes": current["lockout_minutes"],
        "password_min_length": current["password_min_length"],
        "reason": REASON,
    }
    body.update(changes)
    return body


def test_migration_leaves_behaviour_unchanged(db_session: Session, test_settings: Settings) -> None:
    """With no saved override the enforced values are exactly the environment baseline."""
    row = db_session.get(SecuritySettings, 1)
    assert row is not None
    assert row.session_idle_minutes is None
    assert effective_settings(db_session, test_settings) is test_settings


def test_tighter_value_persists_and_is_audited(
    login_client: Callable[..., TestClient], admin_user: User, db_session: Session
) -> None:
    client = login_client(admin_user)
    res = client.patch(POLICY, json=_body(client, session_idle_minutes=15))
    assert res.status_code == 200, res.text
    assert res.json()["session_idle_minutes"] == 15
    assert res.json()["source"] == "administrator"
    assert client.get(POLICY).json()["session_idle_minutes"] == 15

    row = db_session.scalars(
        select(AuditLog).where(AuditLog.action == AuditAction.SECURITY_POLICY_UPDATED.value)
    ).one()
    assert row.actor_user_id == admin_user.id
    assert row.reason == REASON
    assert row.before_data["session_idle_minutes"] == 30
    assert row.after_data["session_idle_minutes"] == 15


@pytest.mark.parametrize(
    "change",
    [
        {"session_idle_minutes": 31},
        {"session_idle_minutes": 4},
        {"session_absolute_hours": 13},
        {"lockout_threshold": 6},
        {"lockout_threshold": 2},
        {"lockout_minutes": 14},
        {"password_min_length": 9},
    ],
)
def test_weakening_or_unusable_values_are_refused(
    login_client: Callable[..., TestClient],
    admin_user: User,
    db_session: Session,
    change: dict[str, int],
) -> None:
    client = login_client(admin_user)
    res = client.patch(POLICY, json=_body(client, **change))
    assert res.status_code == 422
    assert res.json()["code"] == "security_policy_out_of_range"
    assert client.get(POLICY).json()["source"] == "environment"
    assert (
        db_session.scalars(
            select(AuditLog).where(AuditLog.action == AuditAction.SECURITY_POLICY_UPDATED.value)
        ).first()
        is None
    )


def test_reason_is_mandatory(
    login_client: Callable[..., TestClient], admin_user: User
) -> None:
    client = login_client(admin_user)
    for reason in ("", "short", "          "):
        res = client.patch(POLICY, json=_body(client, lockout_threshold=4, reason=reason))
        assert res.status_code == 422


def test_stale_version_is_rejected(
    login_client: Callable[..., TestClient], admin_user: User
) -> None:
    client = login_client(admin_user)
    stale = _body(client, lockout_threshold=4)
    assert client.patch(POLICY, json=stale).status_code == 200
    res = client.patch(POLICY, json={**stale, "lockout_threshold": 3})
    assert res.status_code == 409
    assert res.json()["code"] == "version_conflict"


def test_saving_identical_values_changes_nothing(
    login_client: Callable[..., TestClient], admin_user: User, db_session: Session
) -> None:
    client = login_client(admin_user)
    before = client.get(POLICY).json()["version_id"]
    assert client.patch(POLICY, json=_body(client)).status_code == 200
    assert client.get(POLICY).json()["version_id"] == before
    assert (
        db_session.scalars(
            select(AuditLog).where(AuditLog.action == AuditAction.SECURITY_POLICY_UPDATED.value)
        ).first()
        is None
    )


def test_non_admin_cannot_write(
    login_client: Callable[..., TestClient], reception_user: User, doctor_a_user: User
) -> None:
    body = {
        "version_id": 1,
        "session_idle_minutes": 10,
        "session_absolute_hours": 8,
        "lockout_threshold": 3,
        "lockout_minutes": 30,
        "password_min_length": 12,
        "reason": REASON,
    }
    assert login_client(reception_user).patch(POLICY, json=body).status_code == 403
    assert login_client(doctor_a_user).patch(POLICY, json=body).status_code == 403


def test_lower_idle_limit_expires_an_existing_session(
    login_client: Callable[..., TestClient],
    admin_user: User,
    reception_user: User,
    clock: dict[str, Any],
) -> None:
    """Consumer: core/principal.py. The change reaches sessions that are already open."""
    admin = login_client(admin_user)
    staff = login_client(reception_user)
    assert admin.patch(POLICY, json=_body(admin, session_idle_minutes=10)).status_code == 200

    clock["t"] += timedelta(minutes=11)
    res = staff.get("/api/auth/me")
    assert res.status_code == 401
    assert res.json()["code"] == "session_expired"


def test_lower_threshold_locks_an_account_sooner(
    login_client: Callable[..., TestClient],
    client: TestClient,
    admin_user: User,
    reception_user: User,
    db_session: Session,
    clock: dict[str, Any],
) -> None:
    """Consumer: routers/auth.py and auth_service.authenticate."""
    admin = login_client(admin_user)
    update = _body(admin, lockout_threshold=3, lockout_minutes=60)
    assert admin.patch(POLICY, json=update).status_code == 200

    for _ in range(3):
        res = client.post(
            "/api/auth/login",
            json={"username": reception_user.username, "password": "WrongPassword999!"},
        )
        assert res.status_code == 401

    db_session.refresh(reception_user)
    assert reception_user.failed_login_count == 3
    assert reception_user.locked_until == clock["t"] + timedelta(minutes=60)


def test_higher_password_minimum_applies_to_changes_and_temp_passwords(
    login_client: Callable[..., TestClient],
    admin_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    """Consumers: password policy on change-password, and temporary password generation."""
    client = login_client(admin_user)
    assert client.patch(POLICY, json=_body(client, password_min_length=20)).status_code == 200
    assert client.get("/api/security/password-policy").json()["min_length"] == 20

    effective = effective_settings(db_session, test_settings)
    with pytest.raises(PasswordPolicyError):
        validate_password_policy("Thirteen-chars", "someone", None, effective)
    assert len(generate_temp_password(effective)) >= 20

    res = client.post(
        "/api/auth/change-password",
        json={"current_password": TEST_PASSWORD, "new_password": "Thirteen-chars"},
    )
    assert res.status_code == 422


def test_environment_tightened_later_wins_over_saved_value(
    db_session: Session, test_settings: Settings
) -> None:
    """A stored value looser than the current baseline is clamped on read."""
    row = db_session.get(SecuritySettings, 1)
    assert row is not None
    row.session_idle_minutes = 25
    db_session.flush()

    stricter = test_settings.model_copy(update={"session_idle_minutes": 20})
    assert effective_settings(db_session, stricter).session_idle_minutes == 20
