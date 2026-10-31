"""Database-backed per-IP login failure throttling for burst defense.

Guarantees:
- Uses login_throttle table with atomic upsert (on_conflict_do_update).
- Resets the throttle window if the existing window is older than throttle_window_minutes.
- Returns 429 too_many_attempts with Retry-After header before executing any password hash checks.
- Zero external dependencies on Redis or memory rate limiters (offline LAN resilience).
"""

from datetime import datetime, timedelta

from sqlalchemy import case, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from kalyan_api.models import LoginThrottle


def current_window(
    session: Session,
    ip: str,
    now: datetime,
    window_minutes: int = 15,
) -> tuple[int, int]:
    """Inspect current attempt count and seconds remaining for given IP.

    Returns:
        tuple of (attempt_count, seconds_remaining). If no active window exists or
        the window has expired, returns (0, 0).
    """
    row = session.scalar(select(LoginThrottle).where(LoginThrottle.ip == ip))
    if not row:
        return 0, 0

    window_end = row.window_start + timedelta(minutes=window_minutes)
    if now >= window_end:
        return 0, 0

    seconds_left = max(1, int((window_end - now).total_seconds()))
    return row.attempt_count, seconds_left


def limit_exceeded(
    session: Session,
    ip: str,
    now: datetime,
    max_failures: int = 20,
    window_minutes: int = 15,
) -> tuple[bool, int]:
    """Evaluate whether failures from IP have reached or exceeded max_failures.

    Returns:
        tuple of (is_exceeded, retry_after_seconds).
    """
    count, seconds_left = current_window(session, ip, now, window_minutes=window_minutes)
    if count >= max_failures:
        return True, seconds_left
    return False, 0


def register_failure(
    session: Session,
    ip: str,
    now: datetime,
    window_minutes: int = 15,
) -> int:
    """Atomically record a login failure for the specified IP.

    Guarantees:
    - Exactly one ON CONFLICT statement handles concurrent writes safely.
    - If existing window is older than window_minutes, resets window_start to now and count to 1.
    - Otherwise increments attempt_count by 1.
    - Returns updated attempt_count.
    """
    window_cutoff = now - timedelta(minutes=window_minutes)

    stmt = (
        pg_insert(LoginThrottle)
        .values(ip=ip, window_start=now, attempt_count=1)
        .on_conflict_do_update(
            index_elements=[LoginThrottle.ip],
            set_={
                "window_start": case(
                    (LoginThrottle.window_start <= window_cutoff, now),
                    else_=LoginThrottle.window_start,
                ),
                "attempt_count": case(
                    (LoginThrottle.window_start <= window_cutoff, 1),
                    else_=LoginThrottle.attempt_count + 1,
                ),
            },
        )
        .returning(LoginThrottle.attempt_count)
    )

    result = session.execute(stmt).scalar_one()
    return result
