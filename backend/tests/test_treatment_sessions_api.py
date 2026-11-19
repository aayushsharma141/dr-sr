"""Integration tests for physiotherapy treatment sessions and addenda REST API (TRT-02, TRT-03).

Guarantees:
- Only licensed doctors can log sessions and record addenda (SESSION_LOG_WRITE).
- Receptionist and Admin receive HTTP 403 Forbidden.
- Doctor silo: Doctor B cannot log sessions or read sessions for Doctor A's plan (HTTP 404).
- Immutability lock: PATCH and DELETE on sessions return HTTP 400 Bad Request.
- Chronological session ordering with nested addenda.
- In-transaction audit trail for session logging and addenda creation.
- VAS score strictly bounded between 0 and 10.
"""

from datetime import timedelta

from sqlalchemy import select

from kalyan_api import clock
from kalyan_api.models import AuditLog, Patient, TreatmentPlan, TreatmentSession


def _create_patient_and_plan(
    db_session, doctor_id: int, total_sessions: int = 3, suffix: str = "30"
):
    patient = Patient(
        urn=f"KH-2026-55{suffix}",
        full_name=f"Session Test Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=44,
        mobile=f"98765455{suffix}",
        address="Ara, Bihar",
        district="Bhojpur",
        state="Bihar",
    )
    db_session.add(patient)
    db_session.flush()

    plan = TreatmentPlan(
        patient_id=patient.id,
        doctor_id=doctor_id,
        plan_name=f"Rehab Package {suffix}",
        condition_diagnosis="Lumbar Canal Stenosis",
        total_sessions=total_sessions,
        agreed_price_paise=total_sessions * 50000,
    )
    db_session.add(plan)
    db_session.flush()
    return patient, plan


def test_session_logging_and_addenda_lifecycle(login_client, doctor_a_user, db_session):
    """Doctor logs sequential sessions, adds an addendum, and verifies progress auto-sync."""
    patient, plan = _create_patient_and_plan(
        db_session, doctor_a_user.doctor_id, total_sessions=2, suffix="01"
    )
    doctor_client = login_client(doctor_a_user)

    # 1. Log Session 1
    s1_resp = doctor_client.post(
        f"/api/treatment-plans/{plan.id}/sessions",
        json={
            "vas_score": 8,
            "modalities": ["IFT", "Hot Pack"],
            "clinical_notes": "Initial session. Severe tenderness and spasm.",
        },
    )
    assert s1_resp.status_code == 201, s1_resp.text
    s1_data = s1_resp.json()
    assert s1_data["session_number"] == 1
    assert s1_data["vas_score"] == 8
    assert s1_data["modalities"] == ["IFT", "Hot Pack"]
    assert s1_data["is_finalised"] is True
    s1_id = s1_data["id"]

    # Refresh plan to verify progress trigger
    db_session.refresh(plan)
    assert plan.completed_sessions == 1
    assert plan.status == "ACTIVE"

    # 2. Append Addendum to Session 1
    add_resp = doctor_client.post(
        f"/api/treatment-sessions/{s1_id}/addenda",
        json={
            "note": "Correction: patient reported mild nausea during IFT, current lowered.",
        },
    )
    assert add_resp.status_code == 201
    add_data = add_resp.json()
    assert add_data["session_id"] == s1_id
    assert "mild nausea" in add_data["note"]

    # 3. Log Session 2 (Final session for 2-session plan)
    s2_resp = doctor_client.post(
        f"/api/treatment-plans/{plan.id}/sessions",
        json={
            "vas_score": 3,
            "modalities": ["IFT", "Lumbar Traction"],
            "clinical_notes": "Significant pain reduction. Straight leg raise improved.",
        },
    )
    assert s2_resp.status_code == 201
    s2_data = s2_resp.json()
    assert s2_data["session_number"] == 2

    # Refresh plan: progress trigger must mark plan COMPLETED
    db_session.refresh(plan)
    assert plan.completed_sessions == 2
    assert plan.status == "COMPLETED"

    # 4. Attempt to log session 3 on completed plan -> 422
    s3_resp = doctor_client.post(
        f"/api/treatment-plans/{plan.id}/sessions",
        json={
            "vas_score": 2,
            "modalities": ["Exercises"],
            "clinical_notes": "Attempt to exceed plan sessions.",
        },
    )
    assert s3_resp.status_code == 422

    # 5. List sessions for plan: check order and nested addenda
    list_resp = doctor_client.get(f"/api/treatment-plans/{plan.id}/sessions")
    assert list_resp.status_code == 200
    sessions = list_resp.json()
    assert len(sessions) == 2
    assert sessions[0]["session_number"] == 1
    assert len(sessions[0]["addenda"]) == 1
    assert sessions[1]["session_number"] == 2

    # 6. Verify audit logs
    logged_audit = db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "TREATMENT_SESSION_LOGGED",
            AuditLog.entity_id == str(s1_id),
        )
    ).scalar_one_or_none()
    assert logged_audit is not None
    assert logged_audit.after_data["session_number"] == 1


def test_session_immutability_defense(login_client, doctor_a_user, db_session):
    """Direct PATCH and DELETE on finalised sessions must be rejected with 400 Bad Request."""
    patient, plan = _create_patient_and_plan(
        db_session, doctor_a_user.doctor_id, total_sessions=5, suffix="02"
    )
    doctor_client = login_client(doctor_a_user)

    s_resp = doctor_client.post(
        f"/api/treatment-plans/{plan.id}/sessions",
        json={
            "vas_score": 7,
            "modalities": ["Ultrasound"],
            "clinical_notes": "Baseline session.",
        },
    )
    assert s_resp.status_code == 201
    sess_id = s_resp.json()["id"]

    # PATCH must return 400
    patch_resp = doctor_client.patch(
        f"/api/treatment-sessions/{sess_id}",
        json={"vas_score": 4},
    )
    assert patch_resp.status_code == 400
    assert patch_resp.json()["code"] == "immutable_record"

    # DELETE must return 400
    del_resp = doctor_client.delete(f"/api/treatment-sessions/{sess_id}")
    assert del_resp.status_code == 400
    assert del_resp.json()["code"] == "immutable_record"


def test_vas_score_bounds_validation(login_client, doctor_a_user, db_session):
    """VAS score must be between 0 and 10."""
    patient, plan = _create_patient_and_plan(
        db_session, doctor_a_user.doctor_id, total_sessions=5, suffix="03"
    )
    doctor_client = login_client(doctor_a_user)

    # Score > 10
    resp_high = doctor_client.post(
        f"/api/treatment-plans/{plan.id}/sessions",
        json={
            "vas_score": 11,
            "modalities": ["TENS"],
            "clinical_notes": "Invalid VAS.",
        },
    )
    assert resp_high.status_code == 422

    # Score < 0
    resp_low = doctor_client.post(
        f"/api/treatment-plans/{plan.id}/sessions",
        json={
            "vas_score": -1,
            "modalities": ["TENS"],
            "clinical_notes": "Invalid VAS.",
        },
    )
    assert resp_low.status_code == 422


def test_treatment_sessions_role_and_silo_permissions(
    login_client, admin_user, reception_user, doctor_a_user, doctor_b_user, db_session
):
    """Reception and Admin receive 403; Doctor B receives 404 for Doctor A's plan."""
    patient, plan = _create_patient_and_plan(
        db_session, doctor_a_user.doctor_id, total_sessions=5, suffix="04"
    )

    # Doctor A logs session 1
    doc_a_client = login_client(doctor_a_user)
    s_resp = doc_a_client.post(
        f"/api/treatment-plans/{plan.id}/sessions",
        json={
            "vas_score": 6,
            "clinical_notes": "Doctor A session.",
        },
    )
    assert s_resp.status_code == 201
    sess_id = s_resp.json()["id"]

    rec_client = login_client(reception_user)
    adm_client = login_client(admin_user)
    doc_b_client = login_client(doctor_b_user)

    # Reception cannot log session (403)
    assert (
        rec_client.post(
            f"/api/treatment-plans/{plan.id}/sessions",
            json={"vas_score": 5, "clinical_notes": "Unauthorized"},
        ).status_code
        == 403
    )

    # Admin cannot log session (403)
    assert (
        adm_client.post(
            f"/api/treatment-plans/{plan.id}/sessions",
            json={"vas_score": 5, "clinical_notes": "Unauthorized"},
        ).status_code
        == 403
    )

    # Reception cannot read sessions (403)
    assert rec_client.get(f"/api/treatment-plans/{plan.id}/sessions").status_code == 403

    # Admin cannot read sessions (403)
    assert adm_client.get(f"/api/treatment-plans/{plan.id}/sessions").status_code == 403

    # Doctor B cannot log session for Doctor A's plan (404)
    assert (
        doc_b_client.post(
            f"/api/treatment-plans/{plan.id}/sessions",
            json={"vas_score": 5, "clinical_notes": "Doctor B attempt"},
        ).status_code
        == 404
    )

    # Doctor B cannot add addendum to Doctor A's session (404)
    assert (
        doc_b_client.post(
            f"/api/treatment-sessions/{sess_id}/addenda",
            json={"note": "Doctor B addendum"},
        ).status_code
        == 404
    )


def test_log_treatment_session_rejects_future_date_invariant_11(
    login_client, doctor_a_user, db_session
):
    """Invariant #11: Sessions cannot be logged for a future date."""
    _patient, plan = _create_patient_and_plan(
        db_session, doctor_a_user.doctor_id, total_sessions=3, suffix="05"
    )
    doc_a_client = login_client(doctor_a_user)

    future_date = (clock.ist_today() + timedelta(days=1)).isoformat()
    future_resp = doc_a_client.post(
        f"/api/treatment-plans/{plan.id}/sessions",
        json={
            "session_date": future_date,
            "vas_score": 4,
            "modalities": ["IFT"],
            "clinical_notes": "Attempt to pre-log tomorrow's session.",
        },
    )
    assert future_resp.status_code == 422, future_resp.text
    assert future_resp.json()["code"] == "future_session_date_not_allowed"

    # No session created and completed_sessions untouched
    db_session.refresh(plan)
    assert plan.completed_sessions == 0
    sessions_count = len(
        db_session.execute(
            select(TreatmentSession).where(TreatmentSession.treatment_plan_id == plan.id)
        )
        .scalars()
        .all()
    )
    assert sessions_count == 0

    # Today's date is accepted
    today_resp = doc_a_client.post(
        f"/api/treatment-plans/{plan.id}/sessions",
        json={
            "session_date": clock.ist_today().isoformat(),
            "vas_score": 4,
            "modalities": ["IFT"],
            "clinical_notes": "Today's completed session.",
        },
    )
    assert today_resp.status_code == 201, today_resp.text
    db_session.refresh(plan)
    assert plan.completed_sessions == 1


def test_ophthalmology_doctor_cannot_log_physiotherapy_treatment_session(
    login_client, test_settings, db_session
):
    """Non-Physiotherapy doctors receive 403 specialty_required when logging rehab sessions."""
    from kalyan_api.core.security import build_hasher, hash_password
    from kalyan_api.models import Department, Doctor, User
    from tests.conftest import TEST_PASSWORD

    ophth_dept = db_session.scalar(select(Department).where(Department.code == "OPHTHALMOLOGY"))
    if ophth_dept is None:
        ophth_dept = Department(name_en="Ophthalmology", code="OPHTHALMOLOGY", is_active=True)
        db_session.add(ophth_dept)
        db_session.flush()

    ophth_doc = Doctor(name_en="Dr. Eye Session Specialist", is_active=True)
    ophth_doc.departments.append(ophth_dept)
    db_session.add(ophth_doc)
    db_session.flush()

    ophth_user = User(
        username="fixture_ophth_session_doc",
        full_name="Dr. Eye Session Specialist",
        role="DOCTOR",
        doctor_id=ophth_doc.id,
        password_hash=hash_password(build_hasher(test_settings), TEST_PASSWORD),
        must_change_password=False,
        is_active=True,
    )
    db_session.add(ophth_user)
    db_session.flush()

    _patient, plan = _create_patient_and_plan(
        db_session, ophth_doc.id, total_sessions=3, suffix="09"
    )

    ophth_client = login_client(ophth_user)
    resp = ophth_client.post(
        f"/api/treatment-plans/{plan.id}/sessions",
        json={
            "vas_score": 4,
            "modalities": ["IFT"],
            "clinical_notes": "Ophthalmology doctor attempting physio session",
        },
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["code"] == "specialty_required"
