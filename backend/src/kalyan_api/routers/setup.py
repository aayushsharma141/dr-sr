"""First-run setup wizard endpoints for system initialization (SEC-07).

Guarantees:
- Setup is available ONLY while setup has never completed (no row in system_setup).
- Requires a high-entropy one-time setup code (SEC-07, SC-6).
- Advisory lock (pg_advisory_xact_lock) ensures 1 admin created under concurrency.
- Atomic consumption: code is consumed only after transaction commit.
- Closure: once completed, all setup endpoints permanently return 410 setup_closed.
"""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from starlette.background import BackgroundTask
from starlette.responses import JSONResponse

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.core.net import client_ip
from kalyan_api.core.password_policy import PasswordPolicyError, validate_password_policy
from kalyan_api.core.permissions import Role
from kalyan_api.core.policy import public
from kalyan_api.core.principal import get_current_settings
from kalyan_api.core.setup_code import (
    consume_setup_code,
    is_address_locked,
    register_setup_failure,
    rotate_setup_code,
    verify_setup_code,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.db.startup import setup_completed
from kalyan_api.models import SystemSetup
from kalyan_api.schemas.users import UserCreate, UserOut
from kalyan_api.services import audit_service, throttle_service, user_service
from kalyan_api.services.audit_service import AuditAction, AuditContext, Outcome

SETUP_LOCK_KEY = 42_424_242

router = APIRouter(prefix="/setup", tags=["setup"])


class SetupAdminRequest(BaseModel):
    """Payload for creating the initial administrator account."""

    model_config = ConfigDict(extra="forbid")

    setup_code: str = Field(min_length=1, max_length=32)
    username: str = Field(
        min_length=3,
        max_length=64,
        pattern=r"^[a-zA-Z0-9_.-]+$",
    )
    full_name: str = Field(min_length=2, max_length=128)
    password: str = Field(min_length=1, max_length=1024)


@router.get(
    "/status",
    dependencies=[Depends(public)],
)
def get_setup_status(session: SessionDep) -> JSONResponse:
    """Check whether first-run setup is required or permanently closed."""
    if setup_completed(session):
        return JSONResponse(
            status_code=410,
            content={
                "code": "setup_closed",
                "message": "System setup has already been completed",
            },
        )
    return JSONResponse(status_code=200, content={"setup_required": True})


@router.post(
    "/admin",
    response_model=UserOut,
    status_code=201,
    dependencies=[Depends(public)],
)
def setup_first_admin(
    request: Request,
    payload: SetupAdminRequest,
    session: SessionDep,
    settings: Settings = Depends(get_current_settings),
) -> JSONResponse:
    """Initialize the platform with the first administrator account and seal setup."""
    # 1. Acquire PostgreSQL advisory transaction-level lock
    session.execute(
        text("SELECT pg_advisory_xact_lock(:key)"),
        {"key": SETUP_LOCK_KEY},
    )

    # 2. Authoritative check: if setup completed, fail closed immediately
    if setup_completed(session):
        return JSONResponse(
            status_code=410,
            content={
                "code": "setup_closed",
                "message": "System setup has already been completed",
            },
        )

    peer_ip = client_ip(request)
    now = clock.utcnow()

    # 3. Check temporary IP address lockout (brute-force defense)
    is_locked, retry_after = is_address_locked(request.app, peer_ip, now)
    if is_locked:
        return JSONResponse(
            status_code=429,
            content={
                "code": "too_many_attempts",
                "message": f"Too many failed setup attempts. Retry in {retry_after} seconds.",
            },
            headers={"Retry-After": str(retry_after)},
        )

    # 4. Check setup code issuance availability
    if not getattr(request.app.state, "setup_code_hash", None):
        return JSONResponse(
            status_code=503,
            content={
                "code": "setup_code_unavailable",
                "message": "First-run setup code has not been issued or is unavailable",
            },
        )

    # 5. Verify the submitted setup code in constant time
    if not verify_setup_code(request.app, payload.setup_code):
        throttle_service.register_failure(session, peer_ip, now)
        _, _, should_rotate = register_setup_failure(request.app, peer_ip, now)

        ctx = AuditContext.system(
            "setup:wizard",
            ip=peer_ip,
            user_agent=request.headers.get("User-Agent"),
        )
        audit_service.record(
            session,
            ctx,
            AuditAction.SETUP_CODE_REJECTED,
            "SETUP",
            "1",
            outcome=Outcome.FAILURE,
            reason="Invalid setup code submitted",
        )
        session.flush()

        if should_rotate:
            rotate_setup_code(
                request.app,
                settings,
                getattr(request.app.state, "setup_code_path", None),
            )

        return JSONResponse(
            status_code=403,
            content={
                "code": "setup_code_invalid",
                "message": "Invalid setup code",
            },
        )

    # 6. Validate proposed admin password against NIST complexity policy
    try:
        validate_password_policy(
            payload.password, payload.username, payload.full_name, settings
        )
    except PasswordPolicyError as err:
        return JSONResponse(
            status_code=422,
            content={
                "code": "password_policy",
                "message": err.message,
            },
        )

    # 7. Atomically create administrator and insert singleton system_setup row
    try:
        with session.begin_nested():
            ctx = AuditContext.system(
                "setup:wizard",
                ip=peer_ip,
                user_agent=request.headers.get("User-Agent"),
            )
            create_payload = UserCreate(
                username=payload.username,
                full_name=payload.full_name,
                role=Role.ADMIN,
            )
            user, _ = user_service.create_user(
                session,
                ctx,
                create_payload,
                settings,
                explicit_password=payload.password,
                must_change_password=False,
                audit_action=None,
            )

            setup_entry = SystemSetup(
                id=1,
                completed_at=now,
                admin_user_id=user.id,
            )
            session.add(setup_entry)
            session.flush()

            audit_service.record(
                session,
                ctx,
                AuditAction.ADMIN_BOOTSTRAPPED,
                "USER",
                user.id,
                after={
                    "username": user.username,
                    "role": user.role,
                    "admin_user_id": user.id,
                },
            )
    except IntegrityError:
        session.rollback()
        return JSONResponse(
            status_code=410,
            content={
                "code": "setup_closed",
                "message": "System setup has already been completed",
            },
        )

    # 8. Consumption background task runs ONLY after transaction commits
    bg_task = BackgroundTask(
        consume_setup_code,
        request.app,
        getattr(request.app.state, "setup_code_path", None),
    )
    user_out = UserOut.from_user(user, now=now)
    return JSONResponse(
        status_code=201,
        content=user_out.model_dump(mode="json"),
        background=bg_task,
    )
