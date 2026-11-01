"""Tests for account lockout (SEC-04, D-07) and DB-backed per-IP failure throttling."""

import concurrent.futures
from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pytest import MonkeyPatch
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.core import security
from kalyan_api.models import AuditLog, User
from kalyan_api.routers.auth import GENERIC_INVALID_CREDENTIALS_MSG
from kalyan_api.services import auth_service
from tests.conftest import TEST_PASSWORD, make_user


def test_five_failed_logins_lock_account_and_persist_state(
    client: TestClient,
    reception_user: User,
    db_session: Session,
    clock: dict[str, Any],
) -> None:
    """Five consecutive wrong passwords lock account for 15m; state and audit rows persist."""
    t0 = clock["t"]

    for _attempt in range(1, 6):
        res = client.post(
            "/api/auth/login",
            json={"username": reception_user.username, "password": "WrongPassword999!"},
        )
        assert res.status_code == 401
        assert res.json()["code"] == "invalid_credentials"

    # Refresh user from database to inspect persistent state
    db_session.refresh(reception_user)
    assert reception_user.failed_login_count == 5
    assert reception_user.locked_until == t0 + timedelta(minutes=15)

    # 5 AUTH_LOGIN_FAILED rows persisted for this user
    failed_audits = db_session.scalars(
        select(AuditLog).where(
            AuditLog.entity_type == "USER",
            AuditLog.entity_id == str(reception_user.id),
            AuditLog.action == "AUTH_LOGIN_FAILED",
        )
    ).all()
    assert len(failed_audits) == 5

    # 1 AUTH_ACCOUNT_LOCKED row emitted on trip
    lock_audits = db_session.scalars(
        select(AuditLog).where(
            AuditLog.entity_type == "USER",
            AuditLog.entity_id == str(reception_user.id),
            AuditLog.action == "AUTH_ACCOUNT_LOCKED",
        )
    ).all()
    assert len(lock_audits) == 1
    assert lock_audits[0].after_data.get("failed_login_count") == 5


def test_locked_account_rejects_correct_password_without_counter_extension(
    client: TestClient,
    reception_user: User,
    db_session: Session,
    clock: dict[str, Any],
) -> None:
    """While locked, even correct password returns generic 401 without extending lockout."""
    # First, trigger lockout with 5 failures
    for _ in range(5):
        client.post(
            "/api/auth/login",
            json={"username": reception_user.username, "password": "WrongPassword999!"},
        )

    db_session.refresh(reception_user)
    initial_lock = reception_user.locked_until
    assert reception_user.failed_login_count == 5

    # Attempt with CORRECT password while locked
    res_correct_pw = client.post(
        "/api/auth/login",
        json={"username": reception_user.username, "password": TEST_PASSWORD},
    )
    assert res_correct_pw.status_code == 401
    assert res_correct_pw.json()["code"] == "invalid_credentials"

    # Counter and lock must NOT change
    db_session.refresh(reception_user)
    assert reception_user.failed_login_count == 5
    assert reception_user.locked_until == initial_lock

    # Audit log recorded with reason 'locked'
    recent_audit = db_session.scalars(
        select(AuditLog)
        .where(
            AuditLog.entity_type == "USER",
            AuditLog.entity_id == str(reception_user.id),
            AuditLog.action == "AUTH_LOGIN_FAILED",
        )
        .order_by(AuditLog.id.desc())
    ).first()
    assert recent_audit is not None
    assert recent_audit.after_data.get("reason") == "locked"


def test_lockout_expires_and_allows_login(
    client: TestClient,
    reception_user: User,
    db_session: Session,
    clock: dict[str, Any],
) -> None:
    """After 15 minutes cooldown, the correct password logs in and resets counters."""
    # Trigger 5-attempt lockout
    for _ in range(5):
        client.post(
            "/api/auth/login",
            json={"username": reception_user.username, "password": "WrongPassword999!"},
        )

    # Advance clock past 15 minutes
    clock["t"] += timedelta(minutes=15, seconds=1)

    # Correct password succeeds
    res_success = client.post(
        "/api/auth/login",
        json={"username": reception_user.username, "password": TEST_PASSWORD},
    )
    assert res_success.status_code == 200

    # Counters reset in DB
    db_session.refresh(reception_user)
    assert reception_user.failed_login_count == 0
    assert reception_user.locked_until is None


def test_successful_login_resets_failed_counter_prior_to_lockout(
    client: TestClient,
    reception_user: User,
    db_session: Session,
) -> None:
    """3 failed logins followed by success resets failed_login_count to 0."""
    for _ in range(3):
        client.post(
            "/api/auth/login",
            json={"username": reception_user.username, "password": "WrongPassword999!"},
        )

    db_session.refresh(reception_user)
    assert reception_user.failed_login_count == 3

    res = client.post(
        "/api/auth/login",
        json={"username": reception_user.username, "password": TEST_PASSWORD},
    )
    assert res.status_code == 200

    db_session.refresh(reception_user)
    assert reception_user.failed_login_count == 0
    assert reception_user.locked_until is None


def test_users_version_id_never_bumped_by_failed_logins(
    client: TestClient,
    reception_user: User,
    db_session: Session,
) -> None:
    """Atomic Core UPDATEs on failed logins preserve users.version_id."""
    initial_version = reception_user.version_id

    for _ in range(5):
        client.post(
            "/api/auth/login",
            json={"username": reception_user.username, "password": "WrongPassword999!"},
        )

    db_session.refresh(reception_user)
    assert reception_user.version_id == initial_version


def test_byte_identical_bodies_and_constant_verification_counts(
    client: TestClient,
    admin_user: User,
    db_session: Session,
    test_settings: Settings,
    monkeypatch: MonkeyPatch,
) -> None:
    """Unknown, bad-password, and locked attempts return byte-identical 401s with 1 verify each."""
    # Lock admin_user
    for _ in range(5):
        client.post(
            "/api/auth/login",
            json={"username": admin_user.username, "password": "WrongPassword999!"},
        )

    # Create fresh user for wrong-password test
    target_user = make_user(db_session, test_settings, "RECEPTION", "verify_spy_user")

    verify_calls = 0
    dummy_calls = 0

    orig_verify = security.verify_password
    orig_dummy = security.dummy_verify

    def _spy_verify(*args: Any, **kwargs: Any) -> bool:
        nonlocal verify_calls
        verify_calls += 1
        return orig_verify(*args, **kwargs)

    def _spy_dummy(*args: Any, **kwargs: Any) -> None:
        nonlocal dummy_calls
        dummy_calls += 1
        orig_dummy(*args, **kwargs)

    monkeypatch.setattr(security, "verify_password", _spy_verify)
    monkeypatch.setattr(security, "dummy_verify", _spy_dummy)

    # 1. Unknown user: exactly 1 dummy_verify
    verify_calls, dummy_calls = 0, 0
    res_unknown = client.post(
        "/api/auth/login",
        json={"username": "totally_nonexistent_user", "password": "AnyPassword123!"},
    )
    assert verify_calls == 0
    assert dummy_calls == 1

    # 2. Known user with wrong password: exactly 1 verify_password
    verify_calls, dummy_calls = 0, 0
    res_wrong_pw = client.post(
        "/api/auth/login",
        json={"username": target_user.username, "password": "WrongPassword123!"},
    )
    assert verify_calls == 1
    assert dummy_calls == 0

    # 3. Locked user: exactly 1 dummy_verify
    verify_calls, dummy_calls = 0, 0
    res_locked = client.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": "AnyPassword123!"},
    )
    assert verify_calls == 0
    assert dummy_calls == 1

    # Invariant: Byte-identical responses
    assert res_unknown.content == res_wrong_pw.content
    assert res_unknown.content == res_locked.content
    assert res_unknown.json()["code"] == "invalid_credentials"
    assert res_unknown.json()["message"] == GENERIC_INVALID_CREDENTIALS_MSG


def test_per_ip_throttle_blocks_burst_after_twenty_failures(
    make_client: Callable[..., TestClient],
    admin_user: User,
    db_session: Session,
    clock: dict[str, Any],
    monkeypatch: MonkeyPatch,
) -> None:
    """20 failures from one IP trigger 429 with Retry-After; 21st skips Argon2 verification."""
    ip_client = make_client("192.168.1.101")

    # 20 failures (mix of bad passwords and unknown users)
    for i in range(20):
        uname = admin_user.username if i % 2 == 0 else f"unknown_user_{i}"
        res = ip_client.post(
            "/api/auth/login",
            json={"username": uname, "password": "WrongPassword123!"},
        )
        assert res.status_code == 401

    # Spy on hasher verification
    verify_attempted = False
    orig_verify = security.verify_password
    orig_dummy = security.dummy_verify

    def _forbidden_verify(*args: Any, **kwargs: Any) -> bool:
        nonlocal verify_attempted
        verify_attempted = True
        return False

    monkeypatch.setattr(security, "verify_password", _forbidden_verify)
    monkeypatch.setattr(security, "dummy_verify", _forbidden_verify)

    # 21st attempt: 429 too_many_attempts without any password verification
    res_21 = ip_client.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": "AnyPassword123!"},
    )
    assert res_21.status_code == 429
    assert not verify_attempted, "Argon2 verification must not execute when throttled"

    data_21 = res_21.json()
    assert data_21["code"] == "too_many_attempts"

    retry_after = res_21.headers.get("retry-after")
    assert retry_after is not None
    retry_int = int(retry_after)
    assert 1 <= retry_int <= 900

    # AUTH_LOGIN_THROTTLED audit log written exactly once
    throttled_audits = db_session.scalars(
        select(AuditLog).where(
            AuditLog.action == "AUTH_LOGIN_THROTTLED",
            AuditLog.entity_id == "192.168.1.101",
        )
    ).all()
    assert len(throttled_audits) == 1
    assert throttled_audits[0].after_data.get("attempt_count") == 20

    # Window expiry after 15 minutes allows processing again
    clock["t"] += timedelta(minutes=15, seconds=1)
    # Restore verify methods without blowing away the clock fixture's monkeypatch
    monkeypatch.setattr(security, "verify_password", orig_verify)
    monkeypatch.setattr(security, "dummy_verify", orig_dummy)

    res_after_window = ip_client.post(
        "/api/auth/login",
        json={"username": "unknown_after_window", "password": "WrongPassword123!"},
    )
    assert res_after_window.status_code == 401  # Not 429


def test_successful_login_does_not_reset_throttle_counter(
    make_client: Callable[..., TestClient],
    admin_user: User,
) -> None:
    """Successful logins do not reset the IP-level failure count (defends against spraying)."""
    ip_client = make_client("192.168.1.102")

    # 10 failures
    for _ in range(10):
        ip_client.post(
            "/api/auth/login",
            json={"username": "unknown_spray", "password": "BadPassword123!"},
        )

    # 1 successful login
    res_success = ip_client.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": TEST_PASSWORD},
    )
    assert res_success.status_code == 200

    # 10 more failures (total 20 failures on this IP)
    for _ in range(10):
        ip_client.post(
            "/api/auth/login",
            json={"username": "unknown_spray", "password": "BadPassword123!"},
        )

    # 21st attempt hits 429
    res_blocked = ip_client.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": TEST_PASSWORD},
    )
    assert res_blocked.status_code == 429


def test_different_ip_addresses_are_throttled_independently(
    make_client: Callable[..., TestClient],
    admin_user: User,
) -> None:
    """Failures from IP A do not throttle requests from IP B."""
    client_a = make_client("192.168.1.103")
    client_b = make_client("192.168.1.104")

    # 20 failures from IP A
    for _ in range(20):
        client_a.post(
            "/api/auth/login",
            json={"username": "bad_guess", "password": "BadPassword123!"},
        )

    # IP A is throttled
    res_a = client_a.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": TEST_PASSWORD},
    )
    assert res_a.status_code == 429

    # IP B is NOT throttled
    res_b = client_b.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": TEST_PASSWORD},
    )
    assert res_b.status_code == 200


@pytest.mark.concurrency
def test_concurrent_failed_logins_atomic_increment(
    app_engine: Any,
    owner_engine: Any,
    test_settings: Settings,
    clock: dict[str, Any],
) -> None:
    """6 parallel threads calling record_failed_login result in exact count 6 and lockout."""
    now = clock["t"]

    # Commit a dedicated user directly on app_engine so all worker connections can see it
    with Session(app_engine) as init_sess:
        user = make_user(init_sess, test_settings, "RECEPTION", "concurrency_tester")
        init_sess.commit()
        target_user_id = user.id

    try:

        def _worker() -> tuple[int, Any]:
            with Session(app_engine) as sess:
                with sess.begin():
                    return auth_service.record_failed_login(
                        sess,
                        target_user_id,
                        now,
                        lockout_threshold=test_settings.lockout_threshold,
                        lockout_minutes=test_settings.lockout_minutes,
                    )

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
            futures = [executor.submit(_worker) for _ in range(6)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        # Exactly 6 atomic updates, ending in count 6
        final_counts = [r[0] for r in results]
        assert max(final_counts) == 6

        # Verify locked_until is set on the final row
        with Session(app_engine) as check_sess:
            row = check_sess.scalar(select(User).where(User.id == target_user_id))
            assert row is not None
            assert row.failed_login_count == 6
            assert row.locked_until is not None
    finally:
        with Session(owner_engine) as clean_sess:
            clean_sess.execute(User.__table__.delete().where(User.id == target_user_id))
            clean_sess.commit()
