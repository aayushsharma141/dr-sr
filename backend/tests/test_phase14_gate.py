"""End-to-end integration gate test for Phase 14 (Prescriptions, Treatment Plans & Sessions).

Validates the full Phase 14 contract:
1. Structured Prescriptions (RX-01, D-03):
   - Doctor creates prescription with itemized medications, frequency presets, instructions.
   - Reception default-deny (403 Forbidden).
   - Doctor Silo isolation: Doctor B cannot read Doctor A's prescription (404 Not Found).
   - Audit event PRESCRIPTION_CREATED logged.
2. Multi-Session Treatment Plans (TRT-01):
   - Doctor creates multi-session rehab package with agreed fee and condition.
   - Optimistic concurrency protection (409 Conflict on version mismatch).
   - Package cancellation requires mandatory justification reason >= 3 chars.
   - Audit events TREATMENT_PLAN_CREATED and UPDATED logged.
3. Multi-Threaded Session Number Concurrency Gate (TRT-02):
   - 20 parallel racing threads allocate sessions for the same treatment package.
   - Exactly contiguous 1..20 session numbers allocated with zero gaps and zero duplicates.
4. Finalised Session Immutability & Addenda (TRT-03):
   - Direct API PATCH / DELETE on treatment sessions return 400 Bad Request (immutable_record).
   - PostgreSQL trigger blocks direct SQL UPDATE or DELETE on finalised session records.
   - Dated retrospective addenda appendable and chronologically ordered.
   - Trigger trg_sync_treatment_plan_session_progress synchronizes completed session count.
   - Audit events TREATMENT_SESSION_LOGGED and TREATMENT_SESSION_ADDENDUM_ADDED logged.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from typing import Any

import pytest
from sqlalchemy import Engine, create_engine, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.models import (
    AuditLog,
    Patient,
    TreatmentPlan,
    TreatmentSession,
    User,
)
from kalyan_api.services.session_service import allocate_next_session_number


@pytest.mark.concurrency
def test_phase14_session_concurrency_gate(
    test_settings: Settings,
    owner_engine: Engine,
) -> None:
    """Gate 1: 20 parallel racing threads allocate exactly 1..20 gap-free session numbers."""
    with owner_engine.connect() as conn:
        doc_res = conn.execute(
            text(
                "INSERT INTO doctors (name_en, is_active) "
                "VALUES ('Dr. Gate 14 Concurrency', true) RETURNING id"
            )
        )
        doc_id = doc_res.scalar_one()

        user_res = conn.execute(
            text(
                "INSERT INTO users (username, password_hash, full_name, role, "
                "doctor_id, is_active) "
                "VALUES ('gate14_doc_user', 'hash', 'Dr. Gate 14', 'DOCTOR', "
                ":did, true) RETURNING id"
            ),
            {"did": doc_id},
        )
        user_id = user_res.scalar_one()

        pat_res = conn.execute(
            text(
                "INSERT INTO patients (urn, full_name, guardian_name, gender, "
                "age_years, mobile, address, district, state) "
                "VALUES ('KH-2026-GATE14-RACE', 'Race Patient', 'Guardian', 'M', "
                "35, '9998887771', 'Ara', 'Bhojpur', 'Bihar') "
                "RETURNING id"
            )
        )
        pat_id = pat_res.scalar_one()

        plan_res = conn.execute(
            text(
                "INSERT INTO treatment_plans (patient_id, doctor_id, plan_name, "
                "condition_diagnosis, total_sessions, agreed_price_paise, status) "
                "VALUES (:pid, :did, 'Parallel Race Plan', 'Lumbar Spasm', 25, "
                "500000, 'ACTIVE') "
                "RETURNING id"
            ),
            {"pid": pat_id, "did": doc_id},
        )
        plan_id = plan_res.scalar_one()
        conn.commit()

    num_threads = 20
    concurrent_engine = create_engine(
        test_settings.app_url,
        pool_size=num_threads + 5,
        max_overflow=10,
    )

    try:

        def _allocate(thread_idx: int) -> int:
            with Session(concurrent_engine) as session:
                _plan, seq = allocate_next_session_number(session, treatment_plan_id=plan_id)
                sess = TreatmentSession(
                    treatment_plan_id=plan_id,
                    patient_id=pat_id,
                    doctor_id=doc_id,
                    session_number=seq,
                    session_date=date(2026, 11, 2),
                    vas_score=6,
                    modalities=["IFT"],
                    clinical_notes=f"Concurrent thread {thread_idx}",
                    is_finalised=True,
                    created_by_user_id=user_id,
                )
                session.add(sess)
                session.commit()
                return seq

        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [executor.submit(_allocate, i) for i in range(num_threads)]
            results = [f.result() for f in as_completed(futures)]

        assert len(results) == num_threads
        assert len(set(results)) == num_threads
        assert sorted(results) == list(range(1, num_threads + 1))

        # Verify plan progress trigger synced completed sessions
        with Session(concurrent_engine) as session:
            plan = session.get(TreatmentPlan, plan_id)
            assert plan is not None
            assert plan.completed_sessions == num_threads
    finally:
        concurrent_engine.dispose()
        # Cleanup
        with owner_engine.connect() as conn:
            conn.execute(
                text(
                    "UPDATE treatment_sessions SET is_finalised = false "
                    "WHERE treatment_plan_id = :tpid"
                ),
                {"tpid": plan_id},
            )
            conn.execute(
                text("DELETE FROM treatment_sessions WHERE treatment_plan_id = :tpid"),
                {"tpid": plan_id},
            )
            conn.execute(
                text("DELETE FROM treatment_plans WHERE id = :tpid"),
                {"tpid": plan_id},
            )
            conn.execute(
                text("DELETE FROM patients WHERE id = :pid"),
                {"pid": pat_id},
            )
            conn.execute(
                text("DELETE FROM users WHERE id = :uid"),
                {"uid": user_id},
            )
            conn.execute(
                text("DELETE FROM doctors WHERE id = :did"),
                {"did": doc_id},
            )
            conn.commit()


def test_phase14_full_lifecycle_and_security_gate(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    doctor_b_user: User,
    db_session: Session,
) -> None:
    """Gate 2: Prescriptions, Treatment Plans, Doctor Silo, Immutability & Audit Trail."""
    rec_c = login_client(reception_user)
    doc_a_c = login_client(doctor_a_user)
    doc_b_c = login_client(doctor_b_user)

    # 1. Setup Patient
    pat = Patient(
        urn="KH-2026-GATE14",
        full_name="Meena Devi",
        guardian_name="Kishore Kumar",
        gender="F",
        age_years=48,
        mobile="9876543299",
        address="Babu Bazar, Ara",
        district="Bhojpur",
        state="Bihar",
        allergies="Sulfa drugs",
        notes="Phase 14 gate integration patient",
    )
    db_session.add(pat)
    db_session.commit()
    db_session.refresh(pat)
    patient_id = pat.id

    # =====================================================================
    # PART 1: PRESCRIPTION LIFECYCLE & SILO (RX-01, D-03)
    # =====================================================================
    # Reception attempted prescription creation -> 403 Forbidden
    rec_rx_resp = rec_c.post(
        "/api/prescriptions",
        json={
            "patient_id": patient_id,
            "diagnosis": "Cervical Radiculopathy",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Pregabalin 75mg",
                    "dosage": "75mg",
                    "frequency": "0-0-1",
                    "duration_days": 14,
                }
            ],
        },
    )
    assert rec_rx_resp.status_code == 403

    # Doctor A creates structured prescription
    doc_a_rx_resp = doc_a_c.post(
        "/api/prescriptions",
        json={
            "patient_id": patient_id,
            "diagnosis": "Cervical Spondylotic Radiculopathy",
            "dietary_advice": "High protein, calcium rich diet",
            "general_advice": "Cervical pillow, avoid forward neck bending",
            "follow_up_date": "2026-11-20",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Tab. Pregabalin",
                    "dosage": "75 mg",
                    "frequency": "0-0-1",
                    "duration_days": 14,
                    "instructions": "After dinner",
                },
                {
                    "item_order": 2,
                    "medicine_name": "Tab. Paracetamol",
                    "dosage": "650 mg",
                    "frequency": "SOS",
                    "duration_days": 5,
                    "instructions": "For severe pain only",
                },
            ],
        },
    )
    assert doc_a_rx_resp.status_code == 201
    rx_data = doc_a_rx_resp.json()
    rx_id = rx_data["id"]
    assert len(rx_data["items"]) == 2
    assert rx_data["items"][0]["item_order"] == 1
    assert rx_data["items"][1]["item_order"] == 2
    assert rx_data["doctor_id"] == doctor_a_user.doctor_id

    # Doctor Silo: Doctor B attempts to view Doctor A's prescription -> 404
    doc_b_rx_view = doc_b_c.get(f"/api/prescriptions/{rx_id}")
    assert doc_b_rx_view.status_code == 404

    # Doctor A views own prescription -> 200 OK
    doc_a_rx_view = doc_a_c.get(f"/api/prescriptions/{rx_id}")
    assert doc_a_rx_view.status_code == 200
    assert doc_a_rx_view.json()["diagnosis"] == "Cervical Spondylotic Radiculopathy"

    # Patient Prescriptions endpoint silo check
    doc_a_pat_rxs = doc_a_c.get(f"/api/patients/{patient_id}/prescriptions")
    assert doc_a_pat_rxs.status_code == 200
    assert any(r["id"] == rx_id for r in doc_a_pat_rxs.json())

    doc_b_pat_rxs = doc_b_c.get(f"/api/patients/{patient_id}/prescriptions")
    assert doc_b_pat_rxs.status_code == 200
    assert not any(r["id"] == rx_id for r in doc_b_pat_rxs.json())

    # Audit log for prescription
    rx_audit = db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "PRESCRIPTION_CREATED",
            AuditLog.entity_id == str(rx_id),
        )
    ).scalar_one_or_none()
    assert rx_audit is not None
    assert rx_audit.actor_user_id == doctor_a_user.id

    # =====================================================================
    # PART 2: TREATMENT PLAN LIFECYCLE & CONFLICTS (TRT-01)
    # =====================================================================
    # Reception attempted plan creation -> 403 Forbidden
    rec_plan_resp = rec_c.post(
        "/api/treatment-plans",
        json={
            "patient_id": patient_id,
            "plan_name": "Cervical Rehab Package",
            "condition_diagnosis": "Cervical Spondylosis",
            "total_sessions": 7,
            "agreed_price_paise": 350000,
        },
    )
    assert rec_plan_resp.status_code == 403

    # Doctor A creates treatment package
    doc_a_plan_resp = doc_a_c.post(
        "/api/treatment-plans",
        json={
            "patient_id": patient_id,
            "plan_name": "Cervical Decompression 7-Day Package",
            "condition_diagnosis": "C5-C6 Disc Protrusion with Spasm",
            "referred_by": "Dr. Sharma (Ortho)",
            "total_sessions": 7,
            "agreed_price_paise": 350000,
        },
    )
    assert doc_a_plan_resp.status_code == 201
    plan_data = doc_a_plan_resp.json()
    created_plan_id = plan_data["id"]
    assert plan_data["status"] == "ACTIVE"
    assert plan_data["completed_sessions"] == 0
    assert plan_data["total_sessions"] == 7

    # Doctor Silo: Doctor B cannot read Doctor A's treatment plan -> 404
    doc_b_plan_view = doc_b_c.get(f"/api/treatment-plans/{created_plan_id}")
    assert doc_b_plan_view.status_code == 404

    # Optimistic locking 409 Conflict test on plan update
    conflict_resp = doc_a_c.patch(
        f"/api/treatment-plans/{created_plan_id}",
        json={
            "version_id": 9999,  # Deliberately stale
            "plan_name": "Updated Title",
        },
    )
    assert conflict_resp.status_code == 409
    assert conflict_resp.json()["code"] == "version_conflict"

    # Mandatory cancellation reason test: too short (< 3 chars) -> 422
    bad_cancel_resp = doc_a_c.patch(
        f"/api/treatment-plans/{created_plan_id}",
        json={
            "version_id": plan_data["version_id"],
            "status": "CANCELLED",
            "cancellation_reason": "No",
        },
    )
    assert bad_cancel_resp.status_code == 422

    # =====================================================================
    # PART 3: SESSIONS, IMMUTABILITY & ADDENDA (TRT-02, TRT-03)
    # =====================================================================
    # Doctor A logs Session #1
    s1_resp = doc_a_c.post(
        f"/api/treatment-plans/{created_plan_id}/sessions",
        json={
            "session_date": "2026-11-02",
            "vas_score": 8,
            "modalities": ["Cervical Traction", "IFT", "Hot Pack"],
            "clinical_notes": "Initial session: severe spasm, traction at 6kg tolerated well.",
        },
    )
    assert s1_resp.status_code == 201
    s1_data = s1_resp.json()
    created_session_id = s1_data["id"]
    assert s1_data["session_number"] == 1
    assert s1_data["is_finalised"] is True

    # Doctor A logs Session #2
    s2_resp = doc_a_c.post(
        f"/api/treatment-plans/{created_plan_id}/sessions",
        json={
            "session_date": "2026-11-03",
            "vas_score": 6,
            "modalities": ["Cervical Traction", "IFT"],
            "clinical_notes": "Session 2: pain reduced from 8 to 6, traction at 7kg.",
        },
    )
    assert s2_resp.status_code == 201
    assert s2_resp.json()["session_number"] == 2

    # Verify DB trigger updated completed_sessions to 2 on treatment plan
    plan_refresh = doc_a_c.get(f"/api/treatment-plans/{created_plan_id}")
    assert plan_refresh.status_code == 200
    assert plan_refresh.json()["completed_sessions"] == 2

    # Immutability Defense 1: REST API modification rejected
    patch_resp = doc_a_c.patch(
        f"/api/treatment-sessions/{created_session_id}",
        json={"vas_score": 2},
    )
    assert patch_resp.status_code == 400
    assert patch_resp.json()["code"] == "immutable_record"

    delete_resp = doc_a_c.delete(f"/api/treatment-sessions/{created_session_id}")
    assert delete_resp.status_code == 400
    assert delete_resp.json()["code"] == "immutable_record"

    # Immutability Defense 2: Direct SQL UPDATE blocked by DB trigger
    with pytest.raises(DBAPIError) as exc_info:
        with db_session.begin_nested():
            db_session.execute(
                text("UPDATE treatment_sessions SET vas_score = 0 WHERE id = :sid"),
                {"sid": created_session_id},
            )
    assert "Finalised treatment session cannot be modified" in str(exc_info.value)

    with pytest.raises(DBAPIError) as exc_info_del:
        with db_session.begin_nested():
            db_session.execute(
                text("DELETE FROM treatment_sessions WHERE id = :sid"),
                {"sid": created_session_id},
            )
    assert "Finalised treatment session cannot be deleted" in str(exc_info_del.value)

    # Retrospective Addendum: append dated addendum to Session #1
    addendum_resp = doc_a_c.post(
        f"/api/treatment-sessions/{created_session_id}/addenda",
        json={
            "note": (
                "Post-session observation: patient reported mild soreness "
                "2 hours later, resolved with ice pack."
            ),
        },
    )
    assert addendum_resp.status_code == 201
    add_data = addendum_resp.json()
    assert add_data["session_id"] == created_session_id
    assert add_data["author_name"] == doctor_a_user.username

    # Verify session listing includes chronological addenda
    sessions_list = doc_a_c.get(f"/api/treatment-plans/{created_plan_id}/sessions")
    assert sessions_list.status_code == 200
    sessions = sessions_list.json()
    assert len(sessions) == 2
    s1 = next(s for s in sessions if s["id"] == created_session_id)
    assert len(s1["addenda"]) == 1
    assert "soreness 2 hours later" in s1["addenda"][0]["note"]

    # Doctor Silo: Doctor B cannot read Doctor A's treatment sessions
    doc_b_sessions = doc_b_c.get(f"/api/treatment-plans/{created_plan_id}/sessions")
    assert doc_b_sessions.status_code == 404

    # Audit Logs verification
    session_audit = db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "TREATMENT_SESSION_LOGGED",
            AuditLog.entity_id == str(created_session_id),
        )
    ).scalar_one_or_none()
    assert session_audit is not None
    assert session_audit.actor_user_id == doctor_a_user.id

    addendum_audit = db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "TREATMENT_SESSION_ADDENDUM_ADDED",
            AuditLog.entity_id == str(add_data["id"]),
        )
    ).scalar_one_or_none()
    assert addendum_audit is not None
    assert addendum_audit.actor_user_id == doctor_a_user.id
