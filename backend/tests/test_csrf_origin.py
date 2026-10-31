"""Tests for Origin header verification and per-session CSRF token enforcement (SEC-02, D-01)."""

from collections.abc import Callable

from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import public, require
from kalyan_api.models import User
from tests.conftest import TEST_PASSWORD, make_user


def test_unsafe_methods_require_valid_origin_or_referer(
    app: FastAPI,
    admin_user: User,
) -> None:
    """POST /login without Origin/Referer, with 'null', or with foreign host is 403 csrf_failed."""
    with TestClient(app, base_url="http://testserver") as c:
        # 1. Missing Origin and Referer
        res_missing = c.post(
            "/api/auth/login",
            json={"username": admin_user.username, "password": TEST_PASSWORD},
        )
        assert res_missing.status_code == 403
        assert res_missing.json()["code"] == "csrf_failed"

        # 2. Origin: null (e.g. sandboxed iframe or file:// fetch)
        res_null = c.post(
            "/api/auth/login",
            json={"username": admin_user.username, "password": TEST_PASSWORD},
            headers={"Origin": "null"},
        )
        assert res_null.status_code == 403
        assert res_null.json()["code"] == "csrf_failed"

        # 3. Foreign Origin (evil attacker site)
        res_evil = c.post(
            "/api/auth/login",
            json={"username": admin_user.username, "password": TEST_PASSWORD},
            headers={"Origin": "http://evil.example.com"},
        )
        assert res_evil.status_code == 403
        assert res_evil.json()["code"] == "csrf_failed"

        # 4. Valid Origin matching Host: succeeds
        res_valid = c.post(
            "/api/auth/login",
            json={"username": admin_user.username, "password": TEST_PASSWORD},
            headers={"Origin": "http://testserver"},
        )
        assert res_valid.status_code == 200

        # 5. Missing Origin, but valid Referer matching Host: succeeds
        res_referer = c.post(
            "/api/auth/login",
            json={"username": admin_user.username, "password": TEST_PASSWORD},
            headers={"Referer": "http://testserver/login"},
        )
        assert res_referer.status_code == 200


def test_extra_allowed_origins_permitted(
    app: FastAPI,
    admin_user: User,
) -> None:
    """Origins in KALYAN_EXTRA_ALLOWED_ORIGINS (e.g. dev proxy) are accepted."""
    with TestClient(app, base_url="http://testserver") as c:
        res = c.post(
            "/api/auth/login",
            json={"username": admin_user.username, "password": TEST_PASSWORD},
            headers={"Origin": "http://localhost:5173"},
        )
        assert res.status_code == 200


def test_safe_methods_bypass_origin_checks(
    app: FastAPI,
) -> None:
    """GET and HEAD requests without Origin headers execute without CSRF rejection."""
    router = APIRouter()

    @router.api_route("/test-safe", methods=["GET", "HEAD"], dependencies=[Depends(public)])
    def safe_route() -> dict[str, str]:
        return {"status": "safe"}

    app.include_router(router)

    with TestClient(app, base_url="http://testserver") as c:
        # GET /api/health without Origin header succeeds
        res_health = c.get("/api/health")
        assert res_health.status_code == 200
        assert res_health.json()["status"] == "ok"

        # GET without Origin header succeeds
        res_get = c.get("/test-safe")
        assert res_get.status_code == 200
        assert res_get.json()["status"] == "safe"

        # HEAD without Origin header succeeds
        res_head = c.head("/test-safe")
        assert res_head.status_code == 200


def test_authenticated_unsafe_requests_require_valid_csrf_token(
    app: FastAPI,
    admin_user: User,
    login_client: Callable[..., TestClient],
    db_session: Session,
    test_settings: Settings,
) -> None:
    """Authenticated state-modifying requests require correct per-session X-CSRF-Token."""
    # Add a throwaway state-modifying endpoint
    router = APIRouter()

    @router.post("/test-action", dependencies=[Depends(require(Permission.USER_READ))])
    def post_action() -> dict[str, str]:
        return {"action": "executed"}

    app.include_router(router)

    # User 1 client
    client1 = login_client(admin_user)
    valid_csrf_1 = client1.headers["X-CSRF-Token"]

    # User 2 client (for stolen token test)
    user2 = make_user(db_session, test_settings, "ADMIN", "other_admin")
    client2 = login_client(user2)
    valid_csrf_2 = client2.headers["X-CSRF-Token"]

    # 1. Missing X-CSRF-Token header
    client1.headers.pop("X-CSRF-Token", None)
    res_missing = client1.post("/test-action")
    assert res_missing.status_code == 403
    assert res_missing.json()["code"] == "csrf_failed"

    # 2. Tampered / invalid X-CSRF-Token header
    client1.headers["X-CSRF-Token"] = "invalid_csrf_token_value_xyz"
    res_bad = client1.post("/test-action")
    assert res_bad.status_code == 403
    assert res_bad.json()["code"] == "csrf_failed"

    # 3. Token from ANOTHER user's session (cross-session theft)
    client1.headers["X-CSRF-Token"] = valid_csrf_2
    res_other = client1.post("/test-action")
    assert res_other.status_code == 403
    assert res_other.json()["code"] == "csrf_failed"

    # 4. Valid X-CSRF-Token belonging to this session
    client1.headers["X-CSRF-Token"] = valid_csrf_1
    res_good = client1.post("/test-action")
    assert res_good.status_code == 200
    assert res_good.json() == {"action": "executed"}


def test_unauthenticated_request_with_valid_origin_returns_401_not_403(
    app: FastAPI,
) -> None:
    """Unauthenticated unsafe request with valid Origin to protected route returns 401, not 403."""
    router = APIRouter()

    @router.post("/test-protected", dependencies=[Depends(require(Permission.USER_READ))])
    def protected_post() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(router)

    with TestClient(
        app, base_url="http://testserver", headers={"Origin": "http://testserver"}
    ) as c:
        # Request has valid Origin, but NO session cookie
        res = c.post("/test-protected")
        assert res.status_code == 401
        assert res.json()["code"] == "not_authenticated"
