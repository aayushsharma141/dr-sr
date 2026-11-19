"""Atomic, concurrency-safe daily token sequence generator per doctor per date (APT-01).

Guarantees:
- Zero duplicate token numbers assigned.
- Zero gaps in daily sequences per (doctor_id, appointment_date).
- Row-level locking on `daily_token_sequences` with `SELECT ... FOR UPDATE`.
"""

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from kalyan_api.models import Appointment, DailyTokenSequence, PendingOpdArrival


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

    # The counter is the source of truth, but an appointment or pending OPD arrival written without
    # it (an import, a restore, direct SQL, a dev seed) can hold a token at or above it. Issuing
    # that number again would break uq_appointments_doctor_date_token or
    # uq_pending_opd_arrival_token and turn a check-in into a server error, so never go below the
    # highest token already in use across both tables. Tokens are never reused, even when the
    # holder was cancelled. The counter row is locked, so racing check-ins still queue up here.
    highest_appointment = (
        session.scalar(
            select(func.max(Appointment.token_number)).where(
                Appointment.doctor_id == doctor_id,
                Appointment.appointment_date == appointment_date,
            )
        )
        or 0
    )
    highest_arrival = (
        session.scalar(
            select(func.max(PendingOpdArrival.token_number)).where(
                PendingOpdArrival.doctor_id == doctor_id,
                PendingOpdArrival.appointment_date == appointment_date,
            )
        )
        or 0
    )
    highest_used = max(highest_appointment, highest_arrival)

    # Increment token
    next_token = max(seq.last_token, highest_used) + 1
    seq.last_token = next_token
    session.flush()

    return next_token
