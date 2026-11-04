"""Atomic sequential receipt numbering service (BIL-04).

Guarantees:
- Concurrency-safe gap-free sequential receipt numbers using row locks (SELECT ... FOR UPDATE).
- Cycle support:
  - CALENDAR_YEAR: RCP-YYYY-XXXX (e.g. RCP-2026-0001)
  - FINANCIAL_YEAR: RCP-YYYY-YYYY-XXXX (e.g. RCP-2026-2027-0001)
- Cycle periods are evaluated on the IST business date (clock.ist_today()), never the UTC date.
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


def current_cycle_key(cycle: str) -> str:
    """Return the sequence cycle key for today's IST business date."""
    return get_cycle_key(cycle, clock.ist_today())


def receipts_issued_in_current_cycle(session: Session, cycle: str) -> int:
    """Count receipts already issued in the active cycle for the given cycle setting.

    Reads the gap-free sequence counter, which advances only inside committed payment
    transactions, so it equals the number of receipts issued under that cycle key.
    """
    issued = session.scalar(
        select(ReceiptSequence.last_number).where(
            ReceiptSequence.cycle_key == current_cycle_key(cycle)
        )
    )
    return issued or 0


def format_receipt_number(cycle_key: str, number: int) -> str:
    """Render a receipt number for a cycle key."""
    return f"RCP-{cycle_key}-{number:04d}"


def preview_next_receipt_number(session: Session, cycle: str) -> str:
    """Show the number the next payment would receive, without allocating it."""
    return format_receipt_number(
        current_cycle_key(cycle), receipts_issued_in_current_cycle(session, cycle) + 1
    )


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
        ref_date = clock.ist_today()

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

    return format_receipt_number(cycle_key, next_num)
