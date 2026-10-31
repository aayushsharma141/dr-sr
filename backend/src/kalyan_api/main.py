"""FastAPI application factory, lifecycle management, and security middleware."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from kalyan_api.config import Settings, get_settings
from kalyan_api.core.csrf import verify_origin
from kalyan_api.core.errors import RequestIdMiddleware, install_error_handlers
from kalyan_api.db.session import SessionLocal, build_engine
from kalyan_api.db.startup import run_startup_checks
from kalyan_api.routers.areas import router as areas_router
from kalyan_api.routers.auth import router as auth_router
from kalyan_api.routers.health import router as health_router

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
    """Enforces security response headers and no-store caching on all API endpoints."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            response.headers[k] = v
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
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

    # Middleware execution: Outer RequestID -> SecurityHeaders -> Router
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestIdMiddleware)

    # Uniform error handling
    install_error_handlers(app)

    # Route registrations
    app.include_router(health_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    app.include_router(areas_router, prefix="/api")

    return app

