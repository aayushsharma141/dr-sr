"""Concurrency test for atomic daily token allocation (APT-01).

Guarantees:
- 20 parallel threads racing simultaneously to allocate daily tokens against real PostgreSQL.
- Zero duplicate token numbers.
- Zero gaps in the sequence.
- Exactly 20 distinct consecutive integers generated (1 to 20).
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.services.token_service import generate_next_daily_token


@pytest.mark.concurrency
def test_parallel_token_allocation_no_duplicates_or_gaps(
    test_settings: Settings, owner_engine: Engine
) -> None:
    """20 parallel threads concurrently allocate tokens for same doctor and date."""
    test_date = date(2099, 12, 31)  # Future isolated date

    # Create doctor in owner_engine
    with owner_engine.connect() as conn:
        insert_sql = (
            "INSERT INTO doctors (name_en, is_active) VALUES ('Dr. Concurrency', true) RETURNING id"
        )
        res = conn.execute(text(insert_sql))
        doc_id = res.scalar_one()
        conn.commit()

    num_threads = 20

    # Dedicated engine with adequate pool capacity
    concurrent_engine = create_engine(
        test_settings.app_url,
        pool_size=num_threads + 5,
        max_overflow=10,
    )

    try:

        def _allocate_one() -> int:
            with Session(concurrent_engine) as session:
                token = generate_next_daily_token(
                    session, doctor_id=doc_id, appointment_date=test_date
                )
                session.commit()
                return token

        results: list[int] = []
        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [executor.submit(_allocate_one) for _ in range(num_threads)]
            for f in as_completed(futures):
                results.append(f.result())

        # 1. Assert exactly 20 results
        assert len(results) == num_threads

        # 2. Assert zero duplicates
        assert len(set(results)) == num_threads

        # 3. Assert zero gaps: strictly 1 through 20
        expected = set(range(1, num_threads + 1))
        assert set(results) == expected

    finally:
        concurrent_engine.dispose()
        # Clean up
        with owner_engine.connect() as conn:
            del_seq_sql = (
                "DELETE FROM daily_token_sequences "
                "WHERE doctor_id = :d AND appointment_date = :dt"
            )
            conn.execute(text(del_seq_sql), {"d": doc_id, "dt": test_date})
            conn.execute(text("DELETE FROM doctors WHERE id = :d"), {"d": doc_id})
            conn.commit()
