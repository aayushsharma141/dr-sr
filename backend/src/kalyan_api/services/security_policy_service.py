"""Administrator security policy layered over the environment baseline (Admin module 09).

Guarantees:
- The environment Settings are the baseline. Stored overrides may only tighten them, so an
  administrator can never weaken the installed policy; loosening needs a server configuration
  change. Values are also clamped on read, so a baseline tightened later always wins.
- Lower and upper engineering limits stop a value that would make the system unusable.
- effective_settings() is the single read path used by authentication, session validation and
  password checks, so a saved change applies on the next request, including existing sessions.
"""

from dataclasses import dataclass

from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.models import SecuritySettings

SINGLETON_ID = 1

# Engineering limits, not hospital policy: below these staff could not realistically work.
MIN_IDLE_MINUTES = 5
MIN_ABSOLUTE_HOURS = 1
MIN_LOCKOUT_THRESHOLD = 3
MAX_LOCKOUT_MINUTES = 1440


@dataclass(frozen=True)
class FieldBounds:
    """Inclusive range an override may take, and the environment value it starts from."""

    baseline: int
    minimum: int
    maximum: int


POLICY_FIELDS: tuple[str, ...] = (
    "session_idle_minutes",
    "session_absolute_hours",
    "lockout_threshold",
    "lockout_minutes",
    "password_min_length",
)


def field_bounds(settings: Settings) -> dict[str, FieldBounds]:
    """Allowed range for each field. Tightening means lower for some and higher for others."""
    return {
        "session_idle_minutes": FieldBounds(
            settings.session_idle_minutes,
            min(MIN_IDLE_MINUTES, settings.session_idle_minutes),
            settings.session_idle_minutes,
        ),
        "session_absolute_hours": FieldBounds(
            settings.session_absolute_hours,
            min(MIN_ABSOLUTE_HOURS, settings.session_absolute_hours),
            settings.session_absolute_hours,
        ),
        "lockout_threshold": FieldBounds(
            settings.lockout_threshold,
            min(MIN_LOCKOUT_THRESHOLD, settings.lockout_threshold),
            settings.lockout_threshold,
        ),
        "lockout_minutes": FieldBounds(
            settings.lockout_minutes,
            settings.lockout_minutes,
            max(MAX_LOCKOUT_MINUTES, settings.lockout_minutes),
        ),
        "password_min_length": FieldBounds(
            settings.password_min_length,
            settings.password_min_length,
            settings.password_max_length,
        ),
    }


def _clamped(value: int, bounds: FieldBounds) -> int:
    return max(bounds.minimum, min(bounds.maximum, value))


def effective_settings(session: Session, settings: Settings) -> Settings:
    """Return settings with stored overrides applied, or the baseline object when there are none."""
    row = session.get(SecuritySettings, SINGLETON_ID)
    if row is None:
        return settings

    bounds = field_bounds(settings)
    overrides = {
        name: _clamped(value, bounds[name])
        for name in POLICY_FIELDS
        if (value := getattr(row, name)) is not None
    }
    return settings.model_copy(update=overrides) if overrides else settings
