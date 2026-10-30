"""Tests for health check tracer, uniform error envelope, and security headers."""

from fastapi import APIRouter
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from kalyan_api.config import Settings
from kalyan_api.main import create_app


def test_health_check_returns_ok_and_pings_db(client: TestClient) -> None:
    """GET /api/health returns 200 with status ok and db ok after real PostgreSQL query."""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["db"] == "ok"


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
        password: str = Field(max_length=20)

    @router.post("/api/test-validation")
    def validate_route(_payload: SecretPayload) -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(router)

    client = TestClient(app, base_url="http://testserver", raise_server_exceptions=False)
    secret_value = "SensitiveSecretPassword123" * 5
    response = client.post("/api/test-validation", json={"password": secret_value})
    assert response.status_code == 422
    data = response.json()
    assert data["code"] == "validation_error"
    assert "fields" in data
    assert len(data["fields"]) > 0
    assert "loc" in data["fields"][0]
    assert "message" in data["fields"][0]
    # Ensure sensitive submitted payload is never echoed in response body
    assert secret_value not in response.text


def test_response_security_headers_and_request_id(client: TestClient) -> None:
    """API responses carry standard security headers, no-store caching, and X-Request-ID."""
    response = client.get("/api/health")
    assert response.status_code == 200

    headers = response.headers
    assert "X-Request-ID" in headers
    assert len(headers["X-Request-ID"]) > 0

    assert headers.get("Cache-Control") == "no-store"
    assert headers.get("X-Content-Type-Options") == "nosniff"
    assert headers.get("X-Frame-Options") == "DENY"
    assert headers.get("Referrer-Policy") == "no-referrer"
    assert headers.get("Content-Security-Policy", "").startswith("default-src 'self'")


def test_documentation_endpoints_disabled_offline(client: TestClient) -> None:
    """Interactive docs (/docs, /redoc, /openapi.json) return 404 for offline compliance."""
    for path in ("/docs", "/redoc", "/openapi.json"):
        response = client.get(path)
        assert response.status_code == 404

