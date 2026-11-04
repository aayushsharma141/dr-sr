"""Atomic gap-free URN sequence generator for Kalyan Hospital (PAT-01).

Guarantees:
- Format: KH-YYYY-XXXX (e.g., KH-2026-0001).
- Sequence counter scoped per calendar year, evaluated in IST (Asia/Kolkata).
- Row-level lock via ON CONFLICT DO UPDATE on urn_sequences guarantees race-free
  sequential allocation even under high concurrency.
"""

from sqlalchemy import text
from sqlalchemy.orm import Session

from kalyan_api import clock


def allocate_next_urn(session: Session, year: int | None = None) -> str:
    """Allocate the next sequential URN for the given calendar year atomically.

    The default year is the IST business year (clock.ist_today()), not the UTC year, so a
    patient registered at 00:30 IST on 1 January receives a URN in the new year.
    """
    if year is None:
        year = clock.ist_today().year

    query = text("""
        INSERT INTO urn_sequences (year, last_seq)
        VALUES (:year, 1)
        ON CONFLICT (year)
        DO UPDATE SET last_seq = urn_sequences.last_seq + 1
        RETURNING last_seq;
    """)
    res = session.execute(query, {"year": year})
    seq_val = res.scalar_one()

    return f"KH-{year}-{seq_val:04d}"
