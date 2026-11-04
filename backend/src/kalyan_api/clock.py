"""Clock abstraction providing deterministic timestamps for sessions, lockout, and audit.

Guarantees:
- Application code uses clock.utcnow() as the authoritative time seam.
- IST helpers provide timezone-aware calculations for business workflows (OPD receipts, shifts).
"""

import zoneinfo
from datetime import UTC, date, datetime

IST = zoneinfo.ZoneInfo("Asia/Kolkata")


def utcnow() -> datetime:
    """Return current timezone-aware UTC datetime."""
    return datetime.now(UTC)


def ist_now() -> datetime:
    """Return current timezone-aware IST datetime, derived from the single utcnow() seam."""
    return utcnow().astimezone(IST)


def ist_today() -> date:
    """Return current calendar date in Indian Standard Time (Asia/Kolkata)."""
    return ist_now().date()
