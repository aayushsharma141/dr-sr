"""Security policy endpoints (Admin Panel module 09).

Guarantees:
- GET reports the values actually enforced: the environment baseline plus stored overrides.
- PATCH stores tighter values only; a value outside the reported limits is rejected, so the
  installed baseline cannot be weakened from the browser. Loosening needs a server change.
- Updates need version_id (409 version_conflict on stale writes) and a reason, and are audited
  with before/after values in the same transaction. They apply on the next request.
- The password policy endpoint is authenticated_only so users under a forced password change
  can read the bounds before choosing a new password.
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select

from kalyan_api.config import Settings
from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import authenticated_only, require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
    get_current_settings,
    get_effective_settings,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.models import SecuritySettings
from kalyan_api.schemas.security import (
    PasswordPolicyOut,
    PolicyFieldLimits,
    SecurityPolicyOut,
    SecurityPolicyUpdate,
)
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.security_policy_service import (
    POLICY_FIELDS,
    SINGLETON_ID,
    effective_settings,
    field_bounds,
)

router = APIRouter(prefix="/security", tags=["security"])


def _load_row(session: SessionDep) -> SecuritySettings:
    row = session.get(SecuritySettings, SINGLETON_ID)
    if row is None:
        raise ApiError(status_code=404, code="not_found", message="Security settings not found")
    return row


def _policy_out(row: SecuritySettings, base: Settings, effective: Settings) -> SecurityPolicyOut:
    has_override = any(getattr(row, name) is not None for name in POLICY_FIELDS)
    return SecurityPolicyOut(
        session_idle_minutes=effective.session_idle_minutes,
        session_absolute_hours=effective.session_absolute_hours,
        lockout_threshold=effective.lockout_threshold,
        lockout_minutes=effective.lockout_minutes,
        throttle_max_failures=effective.throttle_max_failures,
        throttle_window_minutes=effective.throttle_window_minutes,
        password_min_length=effective.password_min_length,
        password_max_length=effective.password_max_length,
        source="administrator" if has_override else "environment",
        editable=True,
        limits={
            name: PolicyFieldLimits(
                baseline=bounds.baseline, minimum=bounds.minimum, maximum=bounds.maximum
            )
            for name, bounds in field_bounds(base).items()
        },
        version_id=row.version_id,
        updated_at=row.updated_at,
    )


@router.get(
    "/policy",
    response_model=SecurityPolicyOut,
    dependencies=[Depends(require(Permission.SECURITY_READ))],
)
def get_security_policy(
    session: SessionDep,
    settings: Settings = Depends(get_current_settings),
) -> SecurityPolicyOut:
    """Return the enforced session, lockout, throttle and password-length settings."""
    return _policy_out(_load_row(session), settings, effective_settings(session, settings))


@router.patch(
    "/policy",
    response_model=SecurityPolicyOut,
    dependencies=[Depends(require(Permission.SECURITY_WRITE))],
)
def update_security_policy(
    request: Request,
    payload: SecurityPolicyUpdate,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
    settings: Settings = Depends(get_current_settings),
) -> SecurityPolicyOut:
    """Store tighter security values; they take effect on the next request."""
    row = session.scalar(
        select(SecuritySettings)
        .where(SecuritySettings.id == SINGLETON_ID)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise ApiError(status_code=404, code="not_found", message="Security settings not found")
    require_version(row, payload.version_id, "security_settings")

    bounds = field_bounds(settings)
    out_of_range = {
        name: {"minimum": limit.minimum, "maximum": limit.maximum}
        for name, limit in bounds.items()
        if not limit.minimum <= getattr(payload, name) <= limit.maximum
    }
    if out_of_range:
        raise ApiError(
            status_code=422,
            code="security_policy_out_of_range",
            message="A security value is outside the limits set for this server.",
            limits=out_of_range,
        )

    before = effective_settings(session, settings)
    before_state = {name: getattr(before, name) for name in POLICY_FIELDS}
    after_state = {name: getattr(payload, name) for name in POLICY_FIELDS}
    if before_state == after_state:
        return _policy_out(row, settings, before)

    for name, limit in bounds.items():
        value = getattr(payload, name)
        setattr(row, name, None if value == limit.baseline else value)
    session.flush()

    audit_service.record(
        session,
        build_audit_context(request, principal),
        AuditAction.SECURITY_POLICY_UPDATED,
        "SECURITY_SETTINGS",
        str(SINGLETON_ID),
        before=before_state,
        after=after_state,
        reason=payload.reason,
    )
    session.refresh(row)
    return _policy_out(row, settings, effective_settings(session, settings))


@router.get(
    "/password-policy",
    response_model=PasswordPolicyOut,
    dependencies=[Depends(authenticated_only)],
)
def get_password_policy(
    settings: Settings = Depends(get_effective_settings),
) -> PasswordPolicyOut:
    """Return the password length bounds enforced on password changes."""
    return PasswordPolicyOut(
        min_length=settings.password_min_length,
        max_length=settings.password_max_length,
    )
