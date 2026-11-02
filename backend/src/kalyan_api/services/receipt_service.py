"""Atomic sequential receipt numbering service (BIL-04).

Guarantees:
- Concurrency-safe gap-free sequential receipt numbers using row locks (SELECT ... FOR UPDATE).
- Cycle support:
  - CALENDAR_YEAR: RCP-YYYY-XXXX (e.g. RCP-2026-0001)
  - FINANCIAL_YEAR: RCP-YYYY-YYYY-XXXX (e.g. RCP-2026-2027-0001)
"""

from datetime import date
from typing import Literal

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.models import ReceiptSequence

ReceiptCycle = Literal["FINANCIAL_YEAR", "CALENDAR_YEAR"]


def get_cycle_key(cycle: str, ref_date: date) -> str:
    """Compute the sequence cycle key based on clinic settings cycle and reference date."""
    if cycle == "CALENDAR_YEAR":
        return str(ref_date.year)

    # Indian Financial Year: April 1 to March 31
    if ref_date.month >= 4:
        return f"{ref_date.year}-{ref_date.year + 1}"
    return f"{ref_date.year - 1}-{ref_date.year}"


def allocate_next_receipt_number(
    session: Session,
    cycle: str = "FINANCIAL_YEAR",
    ref_date: date | None = None,
) -> str:
    """Allocate the next atomic gap-free receipt number for the active cycle using row locking.

    Locks the ReceiptSequence record for the given cycle key, increments last_number,
    and returns a formatted sequential receipt identifier string.
    """
    if ref_date is None:
        ref_date = clock.utcnow().date()

    cycle_key = get_cycle_key(cycle, ref_date)

    # Ensure sequence counter row exists using atomic upsert (on_conflict_do_nothing)
    stmt_init = (
        insert(ReceiptSequence)
        .values(cycle_key=cycle_key, last_number=0)
        .on_conflict_do_nothing(index_elements=["cycle_key"])
    )
    session.execute(stmt_init)

    # Lock sequence counter row with FOR UPDATE
    stmt_lock = (
        select(ReceiptSequence).where(ReceiptSequence.cycle_key == cycle_key).with_for_update()
    )
    seq_record = session.execute(stmt_lock).scalar_one()

    seq_record.last_number += 1
    session.flush()
    next_num = seq_record.last_number

    return f"RCP-{cycle_key}-{next_num:04d}"
