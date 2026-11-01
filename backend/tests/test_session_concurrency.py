"""Concurrency test for atomic physiotherapy session number allocation (TRT-02).

Guarantees:
- 20 parallel threads racing simultaneously to log sessions on the same treatment plan.
- SELECT ... FOR UPDATE row locking guarantees contiguous allocation.
- Zero duplicate session numbers.
- Zero gaps in the sequence (strictly 1 through 20).
- Progress trigger completes plan when target session count is reached.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.models import TreatmentSession
from kalyan_api.services.session_service import allocate_next_session_number


@pytest.mark.concurrency
def test_parallel_session_allocation_no_duplicates_or_gaps(
    test_settings: Settings, owner_engine: Engine
) -> None:
    """20 parallel threads concurrently log sessions on the same treatment package."""
    num_threads = 20

    # Setup doctor, patient, user, and treatment plan in owner_engine
    with owner_engine.connect() as conn:
        doc_id = conn.execute(
            text(
                "INSERT INTO doctors (name_en, is_active) "
                "VALUES ('Dr. Session Thread', true) RETURNING id"
            )
        ).scalar_one()

        user_id = conn.execute(
            text(
                "INSERT INTO users "
                "(username, full_name, role, doctor_id, password_hash, is_active) "
                "VALUES ('doc_thread', 'Doc Thread', 'DOCTOR', :did, 'argon2id$fake', true) "
                "RETURNING id"
            ),
            {"did": doc_id},
        ).scalar_one()

        patient_id = conn.execute(
            text(
                "INSERT INTO patients "
                "(urn, full_name, guardian_name, gender, age_years, mobile, "
                "address, district, state) "
                "VALUES ('KH-2099-0099', 'Concurrency Patient', 'Guardian', 'M', 45, "
                "'9999999999', 'Ara', 'Bhojpur', 'Bihar') RETURNING id"
            )
        ).scalar_one()

        plan_id = conn.execute(
            text(
                "INSERT INTO treatment_plans "
                "(patient_id, doctor_id, plan_name, condition_diagnosis, total_sessions, "
                "agreed_price_paise, status) "
                "VALUES (:pid, :did, 'Concurrency 20-Pack', 'Severe Lumbar Radiculopathy', "
                "20, 1000000, 'ACTIVE') RETURNING id"
            ),
            {"pid": patient_id, "did": doc_id},
        ).scalar_one()
        conn.commit()

    concurrent_engine = create_engine(
        test_settings.app_url,
        pool_size=num_threads + 5,
        max_overflow=10,
    )

    try:

        def _log_one(worker_idx: int) -> int:
            with Session(concurrent_engine) as session:
                plan, next_num = allocate_next_session_number(session, plan_id)
                sess = TreatmentSession(
                    treatment_plan_id=plan.id,
                    patient_id=patient_id,
                    doctor_id=doc_id,
                    session_number=next_num,
                    session_date=date(2026, 11, 2),
                    vas_score=5,
                    modalities=["TENS"],
                    clinical_notes=f"Concurrent thread session {worker_idx}",
                    is_finalised=True,
                    created_by_user_id=user_id,
                )
                session.add(sess)
                session.commit()
                return next_num

        results: list[int] = []
        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [executor.submit(_log_one, i) for i in range(num_threads)]
            for f in as_completed(futures):
                results.append(f.result())

        # 1. Assert exactly 20 results
        assert len(results) == num_threads

        # 2. Assert zero duplicate session numbers
        assert len(set(results)) == num_threads

        # 3. Assert zero gaps: strictly 1 through 20
        expected = set(range(1, num_threads + 1))
        assert set(results) == expected

        # 4. Verify treatment plan completed sessions and status
        with Session(concurrent_engine) as session:
            final_plan = session.execute(
                text("SELECT completed_sessions, status FROM treatment_plans WHERE id = :id"),
                {"id": plan_id},
            ).one()
            assert final_plan.completed_sessions == 20
            assert final_plan.status == "COMPLETED"

    finally:
        concurrent_engine.dispose()
        # Clean up
        with owner_engine.connect() as conn:
            conn.execute(
                text(
                    "UPDATE treatment_sessions SET is_finalised = false "
                    "WHERE treatment_plan_id = :id"
                ),
                {"id": plan_id},
            )
            conn.execute(
                text("DELETE FROM treatment_sessions WHERE treatment_plan_id = :id"),
                {"id": plan_id},
            )
            conn.execute(text("DELETE FROM treatment_plans WHERE id = :id"), {"id": plan_id})
            conn.execute(text("DELETE FROM patients WHERE id = :id"), {"id": patient_id})
            conn.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
            conn.execute(text("DELETE FROM doctors WHERE id = :id"), {"id": doc_id})
            conn.commit()
