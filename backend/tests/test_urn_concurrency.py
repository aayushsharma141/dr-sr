"""Concurrency tests for atomic gap-free URN allocation (PAT-01).

Guarantees:
- 20 parallel threads racing simultaneously to allocate URNs against real PostgreSQL.
- Zero duplicate URNs.
- Zero gaps in the sequence.
- Exactly 20 distinct consecutive numbers generated.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.services.urn_service import allocate_next_urn


@pytest.mark.concurrency
def test_parallel_urn_allocation_no_duplicates_or_gaps(
    test_settings: Settings, owner_engine: Engine
) -> None:
    """20 parallel threads concurrently allocate URNs in separate committed transactions."""
    test_year = 2099  # Isolated test year to prevent conflict with other test runs

    # Ensure year row is clean using owner_engine (least-privilege: kalyan_app has no DELETE grant)
    with owner_engine.connect() as conn:
        conn.execute(text("DELETE FROM urn_sequences WHERE year = :y"), {"y": test_year})
        conn.commit()

    num_threads = 20

    # Dedicated engine with adequate pool capacity to prevent QueuePool contention on app_engine
    concurrent_engine = create_engine(
        test_settings.app_url,
        pool_size=num_threads + 5,
        max_overflow=10,
    )

    try:
        def _allocate_one() -> str:
            with Session(concurrent_engine) as session:
                urn = allocate_next_urn(session, year=test_year)
                session.commit()
                return urn

        results: list[str] = []
        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [executor.submit(_allocate_one) for _ in range(num_threads)]
            for f in as_completed(futures):
                results.append(f.result())

        # 1. Assert exactly 20 results
        assert len(results) == num_threads

        # 2. Assert zero duplicates
        assert len(set(results)) == num_threads

        # 3. Assert sequential numbers with zero gaps
        seq_numbers = sorted(int(r.split("-")[-1]) for r in results)
        expected_sequence = list(range(1, num_threads + 1))
        assert seq_numbers == expected_sequence, f"URN sequence had gaps or misorder: {seq_numbers}"

    finally:
        concurrent_engine.dispose()
        # Cleanup using owner_engine
        with owner_engine.connect() as conn:
            conn.execute(text("DELETE FROM urn_sequences WHERE year = :y"), {"y": test_year})
            conn.commit()
