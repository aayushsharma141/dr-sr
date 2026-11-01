"""Atomic, concurrency-safe daily token sequence generator per doctor per date (APT-01).

Guarantees:
- Zero duplicate token numbers assigned.
- Zero gaps in daily sequences per (doctor_id, appointment_date).
- Row-level locking on `daily_token_sequences` with `SELECT ... FOR UPDATE`.
"""

from datetime import date

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from kalyan_api.models import DailyTokenSequence


def generate_next_daily_token(
    session: Session,
    doctor_id: int,
    appointment_date: date,
) -> int:
    """Generate next sequential token number for given doctor and date atomically."""
    # Ensure sequence tracking row exists using atomic upsert
    stmt_init = (
        insert(DailyTokenSequence)
        .values(doctor_id=doctor_id, appointment_date=appointment_date, last_token=0)
        .on_conflict_do_nothing(index_elements=["doctor_id", "appointment_date"])
    )
    session.execute(stmt_init)

    # Lock sequence counter row with FOR UPDATE
    stmt_lock = (
        select(DailyTokenSequence)
        .where(
            DailyTokenSequence.doctor_id == doctor_id,
            DailyTokenSequence.appointment_date == appointment_date,
        )
        .with_for_update()
    )
    seq = session.execute(stmt_lock).scalar_one()

    # Increment token
    next_token = seq.last_token + 1
    seq.last_token = next_token
    session.flush()

    return next_token
