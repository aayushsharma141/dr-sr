"""FastAPI application factory, lifecycle management, and security middleware."""

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from kalyan_api.config import Settings, get_settings
from kalyan_api.core.csrf import verify_origin
from kalyan_api.core.errors import RequestIdMiddleware, install_error_handlers
from kalyan_api.core.setup_code import (
    get_default_setup_code_path,
    issue_setup_code,
)
from kalyan_api.db.session import SessionLocal, build_engine
from kalyan_api.db.startup import run_startup_checks, setup_completed
from kalyan_api.routers.areas import router as areas_router
from kalyan_api.routers.auth import router as auth_router
from kalyan_api.routers.doctors import router as doctors_router
from kalyan_api.routers.health import router as health_router
from kalyan_api.routers.patients import router as patients_router
from kalyan_api.routers.settings import router as settings_router
from kalyan_api.routers.setup import router as setup_router
from kalyan_api.routers.users import router as users_router

logger = logging.getLogger("kalyan_api.main")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'none'; "
        "form-action 'self'"
    ),
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Enforces security response headers and endpoint-specific caching."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            response.headers[k] = v

        path = request.url.path
        if path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        elif path.startswith("/assets/"):
            if response.status_code < 400:
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            content_type = response.headers.get("content-type", "")
            if "text/html" in content_type:
                response.headers["Cache-Control"] = "no-cache"

        return response


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Manage application startup and shutdown lifecycle."""
    settings: Settings = app.state.settings
    engine = build_engine(settings, owner=False)
    SessionLocal.configure(bind=engine)
    app.state.engine = engine

    # Run pre-flight startup gates (wait for DB, schema revision, and D-02 durability)
    run_startup_checks(engine, settings)

    # SEC-07: First-run setup code issuance
    with engine.connect() as conn:
        is_setup_done = setup_completed(conn)

    code_path = getattr(settings, "setup_code_path", None)
    if not is_setup_done:
        issue_setup_code(app, settings, path=code_path)
    else:
        target_path = code_path or get_default_setup_code_path()
        if target_path and target_path.exists():
            try:
                target_path.unlink()
            except OSError:
                pass
        app.state.setup_code_hash = None

    try:
        yield
    finally:
        engine.dispose()


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build and configure the FastAPI application instance."""
    resolved_settings = settings or get_settings()

    # verify_origin is the ONLY application-level global dependency.
    # Authentication and permission checks must NEVER be global (public and SPA routes exist).
    app = FastAPI(
        title="Kalyan Hospital API",
        version="0.1.0",
        docs_url=None,  # Offline compliance: disable remote Swagger docs
        redoc_url=None,  # Offline compliance: disable remote ReDoc
        openapi_url=None,  # Offline compliance: disable runtime OpenAPI schema endpoint
        lifespan=lifespan,
        dependencies=[Depends(verify_origin)],
    )

    app.state.settings = resolved_settings
    app.state.setup_code_hash = None
    app.state.setup_code_path = None
    app.state.setup_failures_by_ip = {}
    app.state.setup_total_failures = 0

    # Middleware execution: Outer RequestID -> SecurityHeaders -> Router
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestIdMiddleware)

    # Uniform error handling
    install_error_handlers(app)

    # Route registrations
    app.include_router(health_router, prefix="/api")
    app.include_router(setup_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    app.include_router(areas_router, prefix="/api")
    app.include_router(users_router, prefix="/api")
    app.include_router(settings_router, prefix="/api")
    app.include_router(doctors_router, prefix="/api")
    app.include_router(patients_router, prefix="/api")

    # SPA frontend distribution serving (app.frontend)
    dist_dir = resolved_settings.frontend_dist
    if dist_dir and (dist_dir / "index.html").is_file():
        app.frontend(
            "/",
            directory=str(dist_dir),
            fallback="index.html",
            check_dir=False,
        )
    else:
        logger.warning(
            "Frontend dist not found or missing index.html; starting in API-only mode: %s",
            dist_dir,
        )

    return app

