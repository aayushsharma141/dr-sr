"""Cross-Site Request Forgery (CSRF) and Origin verification for unsafe methods.

Guarantees:
- verify_origin runs globally on all unsafe HTTP methods (POST, PUT, PATCH, DELETE).
- Safe methods (GET, HEAD, OPTIONS) bypass origin checks entirely.
- Compares Origin (or Referer fallback) netloc against request Host header or extra_allowed_origins.
- Rejects missing, 'null', or mismatched origins with 403 csrf_failed.
- check_csrf_token enforces cryptographic token comparison via hmac.compare_digest.
"""

import hmac
from urllib.parse import urlparse

from fastapi import Request

from kalyan_api.config import Settings, get_settings
from kalyan_api.core.errors import ApiError

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def verify_origin(request: Request) -> None:
    """Enforce same-origin verification on all state-modifying HTTP methods.

    Security Guarantee:
    - Protects plain HTTP LAN deployments from cross-origin requests originating
      from malicious web pages in a staff member's browser.
    """
    if request.method in SAFE_METHODS:
        return

    settings: Settings = getattr(request.app.state, "settings", None) or get_settings()

    origin = request.headers.get("Origin")
    referer = request.headers.get("Referer")
    target_url = origin if origin else referer

    if not target_url or target_url.strip().lower() == "null":
        raise ApiError(
            status_code=403,
            code="csrf_failed",
            message="Missing or invalid Origin header for unsafe request",
        )

    parsed = urlparse(target_url)
    origin_netloc = parsed.netloc.lower()
    full_origin = f"{parsed.scheme}://{parsed.netloc}".lower() if parsed.scheme else ""

    req_host = request.headers.get("Host", "").strip().lower()

    # 1. Direct host:port equality check
    if origin_netloc and req_host and origin_netloc == req_host:
        return

    # 2. Configured extra allowed origins check (e.g. dev frontend proxy)
    allowed = (
        [settings.extra_allowed_origins]
        if isinstance(settings.extra_allowed_origins, str)
        else settings.extra_allowed_origins
    )
    allowed_normalized = {a.strip().lower() for a in allowed if a.strip()}

    if full_origin and full_origin in allowed_normalized:
        return

    if origin_netloc and origin_netloc in allowed_normalized:
        return

    raise ApiError(
        status_code=403,
        code="csrf_failed",
        message="Origin header does not match Host or allowed origins",
    )


def check_csrf_token(request: Request, expected_token: str) -> None:
    """Verify X-CSRF-Token header on unsafe methods for authenticated sessions."""
    if request.method in SAFE_METHODS:
        return

    provided = request.headers.get("X-CSRF-Token")
    if not provided:
        raise ApiError(
            status_code=403,
            code="csrf_failed",
            message="Missing X-CSRF-Token header on state-modifying request",
        )

    if not hmac.compare_digest(provided, expected_token):
        raise ApiError(
            status_code=403,
            code="csrf_failed",
            message="Invalid X-CSRF-Token header",
        )
