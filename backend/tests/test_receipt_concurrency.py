"""Concurrency stress test for atomic sequential receipt numbering (BIL-04).

Guarantees:
- 20 concurrent threads generate exactly 20 distinct receipt numbers.
- Zero duplicate receipt numbers.
- Zero gaps: exactly sequential 0001 through 0020.
- Cycle formatting tested for both CALENDAR_YEAR and FINANCIAL_YEAR.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.services.receipt_service import (
    allocate_next_receipt_number,
    get_cycle_key,
)


def test_get_cycle_key() -> None:
    """Verify Indian financial year vs calendar year cycle key computation."""
    # Calendar Year
    assert get_cycle_key("CALENDAR_YEAR", date(2026, 11, 2)) == "2026"
    assert get_cycle_key("CALENDAR_YEAR", date(2026, 2, 1)) == "2026"

    # Financial Year: April 1 starts new FY
    assert get_cycle_key("FINANCIAL_YEAR", date(2026, 4, 1)) == "2026-2027"
    assert get_cycle_key("FINANCIAL_YEAR", date(2026, 11, 2)) == "2026-2027"
    # Pre-April belongs to previous FY
    assert get_cycle_key("FINANCIAL_YEAR", date(2026, 3, 31)) == "2025-2026"
    assert get_cycle_key("FINANCIAL_YEAR", date(2026, 1, 15)) == "2025-2026"


@pytest.mark.concurrency
def test_parallel_receipt_allocation_no_duplicates_or_gaps(
    test_settings: Settings,
    owner_engine: Engine,
) -> None:
    """20 threads race to allocate receipt numbers concurrently.

    Verifies row-level lock on receipt_sequences guarantees strict gap-free sequence.
    """
    test_fy_date = date(2098, 7, 10)  # Isolated cycle: 2098-2099
    expected_cycle = "2098-2099"
    num_threads = 20

    # Ensure clean start for test cycle
    with owner_engine.connect() as conn:
        conn.execute(
            text("DELETE FROM receipt_sequences WHERE cycle_key = :ck"),
            {"ck": expected_cycle},
        )
        conn.commit()

    concurrent_engine = create_engine(
        test_settings.app_url,
        pool_size=num_threads + 5,
        max_overflow=10,
    )

    try:

        def _allocate_one() -> str:
            with Session(concurrent_engine) as session:
                rcp = allocate_next_receipt_number(
                    session,
                    cycle="FINANCIAL_YEAR",
                    ref_date=test_fy_date,
                )
                session.commit()
                return rcp

        results: list[str] = []
        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [executor.submit(_allocate_one) for _ in range(num_threads)]
            for f in as_completed(futures):
                results.append(f.result())

        # 1. Exactly 20 results
        assert len(results) == num_threads

        # 2. Zero duplicates
        assert len(set(results)) == num_threads

        # 3. All belong to expected cycle prefix
        for rcp in results:
            assert rcp.startswith(f"RCP-{expected_cycle}-")

        # 4. Zero gaps: exactly 0001 through 0020
        extracted_numbers = sorted(int(r.split("-")[-1]) for r in results)
        assert extracted_numbers == list(range(1, num_threads + 1))

    finally:
        concurrent_engine.dispose()
        with owner_engine.connect() as conn:
            conn.execute(
                text("DELETE FROM receipt_sequences WHERE cycle_key = :ck"),
                {"ck": expected_cycle},
            )
            conn.commit()
