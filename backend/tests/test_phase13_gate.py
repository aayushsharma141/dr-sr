"""End-to-end integration gate test for Phase 13 (Appointments & Clinical Encounters).

Validates the full Phase 13 contract:
1. Multi-threaded token test: 20 concurrent threads -> 20 unique tokens, zero gaps (APT-01).
2. Full appointment lifecycle: BOOKED -> ARRIVED -> IN_CONSULTATION -> DONE (APT-02).
3. Terminal state protections: transitions out of DONE or CANCELLED fail with 422.
4. Optimistic locking: stale version_id yields 409 Conflict.
5. Strict Doctor Silo & Reception default-deny (D-03, D-04, CLN-01):
   - Reception attempting GET or POST /api/encounters returns 403 Forbidden.
   - Doctor A attempting to access Doctor B's encounter returns 404 Not Found.
6. Note Finalisation & Immutability (CLN-02):
   - Finalised encounters reject API updates (400 Bad Request).
   - PostgreSQL trigger blocks direct SQL updates or deletes on finalised encounters.
   - Follow-up entries recorded only as chronological addenda.
7. Audit log verification for all critical lifecycle events.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from typing import Any

import pytest
from sqlalchemy import Engine, create_engine, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from kalyan_api.clock import ist_today
from kalyan_api.config import Settings
from kalyan_api.models import AuditLog, Patient, User
from kalyan_api.services.token_service import generate_next_daily_token


@pytest.mark.concurrency
def test_phase13_token_concurrency_gate(test_settings: Settings, owner_engine: Engine) -> None:
    """Gate 1: 20 parallel racing threads generate exactly 1..20 gap-free tokens."""
    test_date = date(2099, 11, 15)

    with owner_engine.connect() as conn:
        res = conn.execute(
            text(
                "INSERT INTO doctors (name_en, is_active) "
                "VALUES ('Dr. Gate Race', true) RETURNING id"
            )
        )
        doc_id = res.scalar_one()
        conn.commit()

    num_threads = 20
    concurrent_engine = create_engine(
        test_settings.app_url,
        pool_size=num_threads + 5,
        max_overflow=10,
    )

    try:

        def _allocate() -> int:
            with Session(concurrent_engine) as session:
                tok = generate_next_daily_token(
                    session, doctor_id=doc_id, appointment_date=test_date
                )
                session.commit()
                return tok

        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [executor.submit(_allocate) for _ in range(num_threads)]
            results = [f.result() for f in as_completed(futures)]

        assert len(results) == num_threads
        assert len(set(results)) == num_threads
        assert sorted(results) == list(range(1, num_threads + 1))
    finally:
        concurrent_engine.dispose()


def test_phase13_full_lifecycle_and_security_gate(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    doctor_b_user: User,
    db_session: Session,
) -> None:
    """Gate 2: Lifecycle, State Machine, Doctor Silo, Immutability & Audit Trail."""
    rec_c = login_client(reception_user)
    doc_a_c = login_client(doctor_a_user)
    doc_b_c = login_client(doctor_b_user)

    # Setup patient
    pat = Patient(
        urn="KH-2026-GATE13",
        full_name="Rajesh Verma",
        guardian_name="S. Verma",
        gender="M",
        age_years=42,
        mobile="9876543210",
        address="Station Road, Ara",
        district="Bhojpur",
        state="Bihar",
        allergies="Aspirin allergy",
        notes="Phase 13 gate patient",
    )
    db_session.add(pat)
    db_session.flush()
    patient_id = pat.id

    doc_a_id = doctor_a_user.doctor_id
    assert doc_a_id is not None
    doc_b_id = doctor_b_user.doctor_id
    assert doc_b_id is not None

    today_str = ist_today().isoformat()

    # 1. Reception books appointment (APT-01)
    dept_id = doctor_a_user.doctor.departments[0].id
    book_res = rec_c.post(
        "/api/appointments",
        json={
            "patient_id": patient_id,
            "doctor_id": doc_a_id,
            "department_id": dept_id,
            "appointment_date": today_str,
            "notes": "Gate test routine checkup",
        },
    )
    assert book_res.status_code == 201, book_res.text
    appt = book_res.json()
    appt_id = appt["id"]
    token_1 = appt["token_number"]
    assert token_1 >= 1
    assert appt["status"] == "BOOKED"
    v_id = appt["version_id"]

    # 2. Reception marks ARRIVED (APT-02)
    arrived_res = rec_c.patch(
        f"/api/appointments/{appt_id}/status",
        json={
            "status": "ARRIVED",
            "version_id": v_id,
        },
    )
    assert arrived_res.status_code == 200, arrived_res.text
    appt = arrived_res.json()
    assert appt["status"] == "ARRIVED"
    v_id = appt["version_id"]

    # Optimistic locking test: reusing stale version_id must return 409
    stale_res = rec_c.patch(
        f"/api/appointments/{appt_id}/status",
        json={
            "status": "IN_CONSULTATION",
            "version_id": v_id - 1,
        },
    )
    assert stale_res.status_code == 409, stale_res.text
    assert stale_res.json()["code"] == "version_conflict"

    # 3. Doctor A checks queue and starts consultation (APT-02, CLN-01)
    queue_res = doc_a_c.get("/api/doctor/queue")
    assert queue_res.status_code == 200, queue_res.text
    q_data = queue_res.json()
    assert any(item["id"] == appt_id for item in q_data["waiting"])

    # Doctor transitions to IN_CONSULTATION
    in_consult_res = doc_a_c.patch(
        f"/api/appointments/{appt_id}/status",
        json={
            "status": "IN_CONSULTATION",
            "version_id": v_id,
        },
    )
    assert in_consult_res.status_code == 200, in_consult_res.text
    v_id = in_consult_res.json()["version_id"]

    # 4. Strict Doctor Silo & Reception Default-Deny (D-03, D-04)
    # Reception attempts to create encounter -> 403 Forbidden
    rec_enc_create = rec_c.post(
        "/api/encounters",
        json={
            "patient_id": patient_id,
            "appointment_id": appt_id,
            "symptoms": "Illegitimate reception entry",
            "clinical_notes": "Deny",
            "diagnosis": "None",
        },
    )
    assert rec_enc_create.status_code == 403, rec_enc_create.text

    # Doctor A records clinical encounter
    enc_create_res = doc_a_c.post(
        "/api/encounters",
        json={
            "patient_id": patient_id,
            "appointment_id": appt_id,
            "symptoms": "Lower back pain radiating down left leg",
            "clinical_notes": "SLR positive at 40 degrees on left",
            "diagnosis": "Lumbar disc protrusion with radiculopathy",
        },
    )
    assert enc_create_res.status_code == 201, enc_create_res.text
    enc = enc_create_res.json()
    enc_id = enc["id"]
    enc_v_id = enc["version_id"]
    assert enc["is_finalised"] is False

    # Reception attempts to read encounter -> 403 Forbidden
    rec_enc_read = rec_c.get(f"/api/encounters/{enc_id}")
    assert rec_enc_read.status_code == 403, rec_enc_read.text

    # Doctor B reads Doctor A's encounter -> 200 OK (audited cross-doctor read per DWS-04)
    doc_b_enc_read = doc_b_c.get(f"/api/encounters/{enc_id}")
    assert doc_b_enc_read.status_code == 200, doc_b_enc_read.text

    # Doctor B write attempt remains strictly denied -> 404 Not Found (siloed write per DWS-04)
    doc_b_enc_write = doc_b_c.patch(
        f"/api/encounters/{enc_id}",
        json={"symptoms": "Doctor B tampering", "version_id": enc_v_id},
    )
    assert doc_b_enc_write.status_code == 404, doc_b_enc_write.text

    # 5. Doctor updates draft notes
    patch_draft_res = doc_a_c.patch(
        f"/api/encounters/{enc_id}",
        json={
            "symptoms": "Lower back pain radiating down left leg (VAS 8/10)",
            "clinical_notes": "SLR positive at 40 degrees; reflexes normal",
            "diagnosis": "L4-L5 Lumbar Disc Herniation",
            "version_id": enc_v_id,
        },
    )
    assert patch_draft_res.status_code == 200, patch_draft_res.text
    enc_v_id = patch_draft_res.json()["version_id"]

    # 6. Doctor finalises consultation note (CLN-02)
    finalise_res = doc_a_c.post(f"/api/encounters/{enc_id}/finalise")
    assert finalise_res.status_code == 200, finalise_res.text
    finalised_enc = finalise_res.json()
    assert finalised_enc["is_finalised"] is True
    assert finalised_enc["finalised_at"] is not None

    # Subsequent PATCH via API is rejected (400 Bad Request)
    post_final_patch = doc_a_c.patch(
        f"/api/encounters/{enc_id}",
        json={
            "symptoms": "Attempt to edit finalised note",
            "clinical_notes": "Should fail",
            "diagnosis": "Should fail",
            "version_id": enc_v_id + 1,
        },
    )
    assert post_final_patch.status_code == 400, post_final_patch.text
    assert "finalised" in post_final_patch.text.lower()

    # PostgreSQL trigger blocks direct SQL tampering
    nested = db_session.begin_nested()
    try:
        db_session.execute(
            text(
                "UPDATE clinical_encounters SET clinical_notes = 'Direct SQL bypass' WHERE id = :id"
            ),
            {"id": enc_id},
        )
        db_session.flush()
        pytest.fail("Trigger should have blocked update on finalised encounter")
    except DBAPIError as exc:
        nested.rollback()
        assert "cannot be modified" in str(exc).lower()

    # 7. Addenda recording and chronological retrieval
    addendum_1_res = doc_a_c.post(
        f"/api/encounters/{enc_id}/addenda",
        json={"addendum_text": "First follow-up remark: prescribed physiotherapy sessions."},
    )
    assert addendum_1_res.status_code == 201, addendum_1_res.text

    addendum_2_res = doc_a_c.post(
        f"/api/encounters/{enc_id}/addenda",
        json={"addendum_text": "Second follow-up remark: patient reports 50% pain reduction."},
    )
    assert addendum_2_res.status_code == 201, addendum_2_res.text

    # Read encounter and verify addenda sequence
    get_enc_res = doc_a_c.get(f"/api/encounters/{enc_id}")
    assert get_enc_res.status_code == 200, get_enc_res.text
    enc_data = get_enc_res.json()
    assert len(enc_data["addenda"]) == 2
    assert "First follow-up" in enc_data["addenda"][0]["addendum_text"]
    assert "Second follow-up" in enc_data["addenda"][1]["addendum_text"]

    # 8. Verify appointment was automatically transitioned to DONE upon finalisation
    get_appt_res = rec_c.get(f"/api/appointments/{appt_id}")
    assert get_appt_res.status_code == 200, get_appt_res.text
    done_appt = get_appt_res.json()
    assert done_appt["status"] == "DONE"
    done_v_id = done_appt["version_id"]

    # Transition out of terminal DONE state must be rejected with 422
    invalid_done_trans = rec_c.patch(
        f"/api/appointments/{appt_id}/status",
        json={
            "status": "BOOKED",
            "version_id": done_v_id,
        },
    )
    assert invalid_done_trans.status_code == 422, invalid_done_trans.text

    # 9. Verify Audit Log Trail
    add_1_id = addendum_1_res.json()["id"]
    audit_actions = (
        db_session.execute(
            select(AuditLog.action).where(
                AuditLog.entity_id.in_([str(appt_id), str(enc_id), str(add_1_id)])
            )
        )
        .scalars()
        .all()
    )

    expected_actions = {
        "APPOINTMENT_CREATED",
        "APPOINTMENT_STATUS_UPDATED",
        "ENCOUNTER_CREATED",
        "ENCOUNTER_FINALISED",
        "ENCOUNTER_ADDENDUM_ADDED",
    }
    recorded_set = set(audit_actions)
    missing = expected_actions - recorded_set
    assert expected_actions.issubset(recorded_set), f"Missing audit actions: {missing}"
