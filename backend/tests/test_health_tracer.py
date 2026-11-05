"""Tests for health check tracer, uniform error envelope, security headers, and startup gates."""

from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from kalyan_api.cli import main as cli_main
from kalyan_api.config import Settings
from kalyan_api.db.startup import (
    DurabilityError,
    SchemaMismatchError,
    check_durability,
)
from kalyan_api.main import create_app


def test_health_check_returns_ok_and_pings_db(client: TestClient) -> None:
    """GET /api/health returns 200 with status ok, db ok, and setup_required flag."""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["db"] == "ok"
    assert "setup_required" in data


def test_health_check_setup_required_authoritative_lifecycle(
    client: TestClient, db_session: Session
) -> None:
    """setup_required is true iff system_setup is missing; deactivating admins does not reopen."""
    # 1. Fresh state: system_setup has no row -> setup_required is True
    res1 = client.get("/api/health")
    assert res1.json()["setup_required"] is True

    # 2. Add an active admin user (but NOT system_setup row) -> setup_required remains True
    admin_id = db_session.scalar(
        text("""
            INSERT INTO users (username, full_name, role, password_hash)
            VALUES ('admin_lifecycle_test', 'Admin Test', 'ADMIN', 'fakehash')
            RETURNING id
        """)
    )
    db_session.flush()

    res2 = client.get("/api/health")
    assert res2.json()["setup_required"] is True

    # 3. Add authoritative system_setup row -> setup_required flips to False
    db_session.execute(
        text("""
            INSERT INTO system_setup (id, completed_at, admin_user_id)
            VALUES (1, :completed_at, :admin_id)
        """),
        {"completed_at": datetime.now(UTC), "admin_id": admin_id},
    )
    db_session.flush()

    res3 = client.get("/api/health")
    assert res3.json()["setup_required"] is False

    # 4. Deactivate all admins -> setup_required STILL False (closed means closed)
    db_session.execute(text("UPDATE users SET is_active = false WHERE role = 'ADMIN'"))
    db_session.flush()

    res4 = client.get("/api/health")
    assert res4.json()["setup_required"] is False


def test_lifespan_refuses_startup_on_schema_mismatch(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Application lifespan halts with SchemaMismatchError when DB revision != head."""
    app = create_app(settings=test_settings)

    def _mock_assert_schema_current(*_args, **_kwargs) -> None:
        raise SchemaMismatchError("Database revision stale. Run 'python -m kalyan_api.cli migrate'")

    monkeypatch.setattr("kalyan_api.main.run_startup_checks", _mock_assert_schema_current)

    with pytest.raises(SchemaMismatchError, match="Database revision stale"):
        with TestClient(app, base_url="http://testserver"):
            pass


def test_check_durability_invariant_enforcement(
    app_engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """check_durability enforces D-02 invariants; raises DurabilityError in strict mode."""
    # Live inspection against test PostgreSQL
    durability = check_durability(app_engine, strict=False)
    assert durability["synchronous_commit"] in ("on", "remote_apply")
    assert durability["fsync"] == "on"
    assert durability["full_page_writes"] == "on"

    # Mock non-compliant setting: synchronous_commit = off
    mock_conn = MagicMock()
    mock_conn.scalar.side_effect = lambda stmt: "off" if "synchronous_commit" in str(stmt) else "on"
    mock_engine = MagicMock()
    mock_engine.connect.return_value.__enter__.return_value = mock_conn

    # In strict mode, must raise DurabilityError
    with pytest.raises(DurabilityError, match="synchronous_commit.*off"):
        check_durability(mock_engine, strict=True)

    # In non-strict mode, logs warning but does not raise
    res = check_durability(mock_engine, strict=False)
    assert res["synchronous_commit"] == "off"

    # remote_apply is accepted as compliant under D-02
    mock_conn.scalar.side_effect = lambda stmt: (
        "remote_apply" if "synchronous_commit" in str(stmt) else "on"
    )
    res_remote = check_durability(mock_engine, strict=True)
    assert res_remote["synchronous_commit"] == "remote_apply"


def test_cli_commands_migrate_and_check_db(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    """CLI subcommands check-db and migrate execute cleanly and report revisions."""
    from kalyan_api.config import get_settings

    monkeypatch.setenv("KALYAN_DB_NAME", test_settings.db_name)
    get_settings.cache_clear()

    try:
        # check-db returns 0 on healthy test database
        exit_code_check = cli_main(["check-db"])
        assert exit_code_check == 0
        captured_check = capsys.readouterr()
        assert (
            "synchronous_commit: on" in captured_check.out or "remote_apply" in captured_check.out
        )
        from alembic.script import ScriptDirectory

        from kalyan_api.db.migrate import alembic_config

        expected_head = ScriptDirectory.from_config(
            alembic_config(test_settings.owner_url)
        ).get_current_head()
        assert expected_head in captured_check.out
        assert "Database health check: OK" in captured_check.out

        # migrate runs idempotently
        exit_code_migrate1 = cli_main(["migrate"])
        assert exit_code_migrate1 == 0
        exit_code_migrate2 = cli_main(["migrate"])
        assert exit_code_migrate2 == 0
    finally:
        get_settings.cache_clear()


def test_api_not_found_returns_error_envelope(client: TestClient) -> None:
    """GET /api/does-not-exist returns 404 with standard error envelope."""
    response = client.get("/api/does-not-exist", headers={"Accept": "application/json"})
    assert response.status_code == 404
    data = response.json()
    assert data["code"] == "not_found"
    assert "message" in data


def test_method_not_allowed_returns_error_envelope(client: TestClient) -> None:
    """DELETE /api/health returns 405 with standard error envelope."""
    response = client.delete("/api/health")
    assert response.status_code == 405
    data = response.json()
    assert data["code"] == "method_not_allowed"
    assert "message" in data


def test_unhandled_exception_returns_500_without_traceback(test_settings: Settings) -> None:
    """Unhandled exception returns 500 internal_error with no stack trace or internals."""
    app = create_app(settings=test_settings)
    router = APIRouter()

    @router.get("/api/test-crash")
    def crash_route() -> None:
        raise RuntimeError("Secret internal failure detail")

    app.include_router(router)

    client = TestClient(app, base_url="http://testserver", raise_server_exceptions=False)
    response = client.get("/api/test-crash")
    assert response.status_code == 500
    data = response.json()
    assert data["code"] == "internal_error"
    assert "Secret internal failure detail" not in response.text
    assert "Traceback" not in response.text


def test_validation_error_envelope_does_not_echo_submitted_secrets(
    test_settings: Settings,
) -> None:
    """RequestValidationError returns 422 with loc/message and never echoes passwords."""
    app = create_app(settings=test_settings)
    router = APIRouter()

    class SecretPayload(BaseModel):
        username: str
        password: str = Field(min_length=10, max_length=128)

    @router.post("/api/test-validation")
    def secret_route(_payload: SecretPayload) -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(router)

    client = TestClient(app, base_url="http://testserver", headers={"Origin": "http://testserver"})
    secret_value = "super_secret_cleartext_password_123"
    response = client.post(
        "/api/test-validation",
        json={"username": "user", "password": secret_value * 10},  # Fails max_length
    )
    assert response.status_code == 422
    data = response.json()
    assert data["code"] == "validation_error"
    assert "fields" in data
    # Invariant: submitted secret must never be echoed back in response body
    assert secret_value not in response.text


def test_response_security_headers_and_request_id(client: TestClient) -> None:
    """Every response carries required OWASP security headers and X-Request-ID."""
    response = client.get("/api/health")
    assert response.status_code == 200
    assert "x-request-id" in response.headers
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "default-src 'self'" in response.headers["content-security-policy"]
    assert response.headers["cache-control"] == "no-store"


def test_documentation_endpoints_disabled_offline(client: TestClient) -> None:
    """Interactive OpenAPI documentation endpoints (/docs, /redoc, /openapi.json) return 404."""
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/openapi.json").status_code == 404
