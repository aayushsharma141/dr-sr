"""Read-only security policy endpoints (Admin Panel module 09).

Guarantees:
- Values reported are the currently effective Settings (environment / backend/.env).
- Session and lockout timings (D-07) and password length bounds (EG-19) are locked/default
  decisions; runtime editing is a pending client decision, so no write endpoint exists here.
- The password policy endpoint is authenticated_only so users under a forced password change
  can read the bounds before choosing a new password.
"""

from fastapi import APIRouter, Depends

from kalyan_api.config import Settings
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import authenticated_only, require
from kalyan_api.core.principal import get_current_settings
from kalyan_api.schemas.security import PasswordPolicyOut, SecurityPolicyOut

router = APIRouter(prefix="/security", tags=["security"])


@router.get(
    "/policy",
    response_model=SecurityPolicyOut,
    dependencies=[Depends(require(Permission.SECURITY_READ))],
)
def get_security_policy(
    settings: Settings = Depends(get_current_settings),
) -> SecurityPolicyOut:
    """Return the effective session, lockout, throttle and password-length settings."""
    return SecurityPolicyOut(
        session_idle_minutes=settings.session_idle_minutes,
        session_absolute_hours=settings.session_absolute_hours,
        lockout_threshold=settings.lockout_threshold,
        lockout_minutes=settings.lockout_minutes,
        throttle_max_failures=settings.throttle_max_failures,
        throttle_window_minutes=settings.throttle_window_minutes,
        password_min_length=settings.password_min_length,
        password_max_length=settings.password_max_length,
        source="environment",
        editable=False,
    )


@router.get(
    "/password-policy",
    response_model=PasswordPolicyOut,
    dependencies=[Depends(authenticated_only)],
)
def get_password_policy(
    settings: Settings = Depends(get_current_settings),
) -> PasswordPolicyOut:
    """Return the password length bounds enforced on password changes."""
    return PasswordPolicyOut(
        min_length=settings.password_min_length,
        max_length=settings.password_max_length,
    )
