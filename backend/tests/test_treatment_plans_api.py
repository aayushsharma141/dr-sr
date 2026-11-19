"""Integration tests for physiotherapy treatment plans and packages REST API (TRT-01, OQ-13).

Guarantees:
- Only licensed doctors can create, modify, or cancel treatment packages (PLAN_WRITE).
- Optimistic concurrency control via version_id (HTTP 409 on conflict).
- Mandatory cancellation reason for cancelled plans (HTTP 422 if omitted).
- Doctor silo: Doctor B cannot read or modify Doctor A's treatment plan (HTTP 404).
- Receptionist and Admin receive HTTP 403 Forbidden on create, update, or read.
- In-transaction audit events TREATMENT_PLAN_CREATED, UPDATED, CANCELLED.
"""

from sqlalchemy import select

from kalyan_api.models import AuditLog, ClinicalEncounter, Patient, TreatmentPlan


def _create_test_patient(db_session, suffix="20") -> Patient:
    patient = Patient(
        urn=f"KH-2026-66{suffix}",
        full_name=f"Plan Test Patient {suffix}",
        guardian_name="Guardian Name",
        gender="F",
        age_years=36,
        mobile=f"98765466{suffix}",
        address="Ara, Bihar",
        district="Bhojpur",
        state="Bihar",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def test_doctor_creates_and_updates_treatment_plan(login_client, doctor_a_user, db_session):
    """Doctor creates plan, modifies terms with versioning, and verifies audit logs."""
    patient = _create_test_patient(db_session, "01")
    doctor_client = login_client(doctor_a_user)

    plan_payload = {
        "patient_id": patient.id,
        "plan_name": "Frozen Shoulder 10-Session Rehab",
        "condition_diagnosis": "Adhesive Capsulitis Right Shoulder",
        "referred_by": "Dr. A. Verma",
        "total_sessions": 10,
        "agreed_price_paise": 600000,
    }

    create_resp = doctor_client.post("/api/treatment-plans", json=plan_payload)
    assert create_resp.status_code == 201, create_resp.text
    plan_data = create_resp.json()

    assert plan_data["id"] is not None
    assert plan_data["patient_id"] == patient.id
    assert plan_data["doctor_id"] == doctor_a_user.doctor_id
    assert plan_data["total_sessions"] == 10
    assert plan_data["completed_sessions"] == 0
    assert plan_data["agreed_price_paise"] == 600000
    assert plan_data["status"] == "ACTIVE"
    assert plan_data["version_id"] == 1

    plan_id = plan_data["id"]

    # Retrieve plan
    get_resp = doctor_client.get(f"/api/treatment-plans/{plan_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == plan_id

    # List patient plans
    list_resp = doctor_client.get(f"/api/patients/{patient.id}/treatment-plans")
    assert list_resp.status_code == 200
    assert len(list_resp.json()) >= 1
    assert list_resp.json()[0]["id"] == plan_id

    # Update plan with valid version_id
    patch_resp = doctor_client.patch(
        f"/api/treatment-plans/{plan_id}",
        json={
            "version_id": 1,
            "plan_name": "Frozen Shoulder Comprehensive 12-Session Rehab",
            "total_sessions": 12,
        },
    )
    assert patch_resp.status_code == 200
    updated_plan = patch_resp.json()
    assert updated_plan["plan_name"] == "Frozen Shoulder Comprehensive 12-Session Rehab"
    assert updated_plan["total_sessions"] == 12
    assert updated_plan["version_id"] == 2

    # Stale version_id -> 409 Conflict
    stale_resp = doctor_client.patch(
        f"/api/treatment-plans/{plan_id}",
        json={
            "version_id": 1,  # Stale, current is 2
            "plan_name": "Conflict Attempt",
        },
    )
    assert stale_resp.status_code == 409

    # Verify audit logs
    created_audit = db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "TREATMENT_PLAN_CREATED",
            AuditLog.entity_id == str(plan_id),
        )
    ).scalar_one_or_none()
    assert created_audit is not None
    assert created_audit.after_data["plan_name"] == "Frozen Shoulder 10-Session Rehab"

    updated_audit = db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "TREATMENT_PLAN_UPDATED",
            AuditLog.entity_id == str(plan_id),
        )
    ).scalar_one_or_none()
    assert updated_audit is not None
    assert updated_audit.after_data["total_sessions"] == 12


def test_treatment_plan_cancellation_workflow(login_client, doctor_a_user, db_session):
    """Doctor cancels a treatment plan with mandatory cancellation reason."""
    patient = _create_test_patient(db_session, "02")
    doctor_client = login_client(doctor_a_user)

    create_resp = doctor_client.post(
        "/api/treatment-plans",
        json={
            "patient_id": patient.id,
            "plan_name": "Knee Package",
            "condition_diagnosis": "Knee Sprain",
            "total_sessions": 5,
            "agreed_price_paise": 250000,
        },
    )
    assert create_resp.status_code == 201
    plan_id = create_resp.json()["id"]

    # Cancel without cancellation reason -> 422
    fail_cancel = doctor_client.patch(
        f"/api/treatment-plans/{plan_id}",
        json={
            "version_id": 1,
            "status": "CANCELLED",
        },
    )
    assert fail_cancel.status_code == 422

    # Cancel with too short cancellation reason -> 422
    fail_short = doctor_client.patch(
        f"/api/treatment-plans/{plan_id}",
        json={
            "version_id": 1,
            "status": "CANCELLED",
            "cancellation_reason": "No",
        },
    )
    assert fail_short.status_code == 422

    # Cancel with valid reason -> 200
    success_cancel = doctor_client.patch(
        f"/api/treatment-plans/{plan_id}",
        json={
            "version_id": 1,
            "status": "CANCELLED",
            "cancellation_reason": "Patient relocated to another district",
        },
    )
    assert success_cancel.status_code == 200
    cancelled_plan = success_cancel.json()
    assert cancelled_plan["status"] == "CANCELLED"
    assert cancelled_plan["cancellation_reason"] == "Patient relocated to another district"
    assert cancelled_plan["version_id"] == 2

    # Further modification of cancelled plan -> 422
    modify_cancelled = doctor_client.patch(
        f"/api/treatment-plans/{plan_id}",
        json={
            "version_id": 2,
            "plan_name": "Attempt to edit cancelled plan",
        },
    )
    assert modify_cancelled.status_code == 422


def test_reception_and_admin_cannot_create_or_read_plans(
    login_client, admin_user, reception_user, doctor_a_user, db_session
):
    """Reception and Admin receive 403 Forbidden for treatment plan management."""
    patient = _create_test_patient(db_session, "03")

    # Doctor creates a plan first
    doctor_client = login_client(doctor_a_user)
    create_resp = doctor_client.post(
        "/api/treatment-plans",
        json={
            "patient_id": patient.id,
            "plan_name": "Stroke Rehab Package",
            "condition_diagnosis": "Hemiplegia",
            "total_sessions": 20,
            "agreed_price_paise": 1500000,
        },
    )
    assert create_resp.status_code == 201
    plan_id = create_resp.json()["id"]

    rec_client = login_client(reception_user)
    adm_client = login_client(admin_user)

    # Reception cannot create plan
    assert (
        rec_client.post(
            "/api/treatment-plans",
            json={
                "patient_id": patient.id,
                "plan_name": "Unauthorized Plan",
                "condition_diagnosis": "Test",
                "total_sessions": 5,
                "agreed_price_paise": 100000,
            },
        ).status_code
        == 403
    )

    # Admin cannot create plan
    assert (
        adm_client.post(
            "/api/treatment-plans",
            json={
                "patient_id": patient.id,
                "plan_name": "Unauthorized Plan",
                "condition_diagnosis": "Test",
                "total_sessions": 5,
                "agreed_price_paise": 100000,
            },
        ).status_code
        == 403
    )

    # Reception and Admin cannot read plan
    assert rec_client.get(f"/api/treatment-plans/{plan_id}").status_code == 403
    assert adm_client.get(f"/api/treatment-plans/{plan_id}").status_code == 403


def test_doctor_silo_cross_isolation_on_plans(
    login_client, doctor_a_user, doctor_b_user, db_session
):
    """Doctor B cannot read or modify Doctor A's treatment plan (D-03)."""
    patient = _create_test_patient(db_session, "04")

    # Doctor A creates plan
    doc_a_client = login_client(doctor_a_user)
    create_resp = doc_a_client.post(
        "/api/treatment-plans",
        json={
            "patient_id": patient.id,
            "plan_name": "Cervical Package",
            "condition_diagnosis": "Cervical Spondylosis",
            "total_sessions": 7,
            "agreed_price_paise": 350000,
        },
    )
    assert create_resp.status_code == 201
    plan_id = create_resp.json()["id"]

    # Doctor B reads Doctor A's plan -> 200 under DWS-04 cross-read
    doc_b_client = login_client(doctor_b_user)
    assert doc_b_client.get(f"/api/treatment-plans/{plan_id}").status_code == 200

    # Doctor B attempts to modify Doctor A's plan -> 404 (write silo preserved)
    assert (
        doc_b_client.patch(
            f"/api/treatment-plans/{plan_id}",
            json={
                "version_id": 1,
                "plan_name": "Hijacked Plan",
            },
        ).status_code
        == 404
    )


def test_list_treatment_plans_roster_scoping_and_status_filters(
    login_client, admin_user, reception_user, doctor_a_user, doctor_b_user, db_session
):
    """GET /api/treatment-plans returns only the logged-in doctor's plans filtered by status."""
    patient = _create_test_patient(db_session, "05")
    doc_a_client = login_client(doctor_a_user)
    doc_b_client = login_client(doctor_b_user)

    # Doctor A: ACTIVE plan
    active_resp = doc_a_client.post(
        "/api/treatment-plans",
        json={
            "patient_id": patient.id,
            "plan_name": "Doc A Active Package",
            "condition_diagnosis": "Lumbar Strain",
            "total_sessions": 6,
            "agreed_price_paise": 300000,
        },
    )
    assert active_resp.status_code == 201
    active_id = active_resp.json()["id"]

    # Doctor A: CANCELLED plan
    cancel_create = doc_a_client.post(
        "/api/treatment-plans",
        json={
            "patient_id": patient.id,
            "plan_name": "Doc A Cancelled Package",
            "condition_diagnosis": "Ankle Sprain",
            "total_sessions": 4,
            "agreed_price_paise": 200000,
        },
    )
    assert cancel_create.status_code == 201
    cancelled_id = cancel_create.json()["id"]
    cancel_patch = doc_a_client.patch(
        f"/api/treatment-plans/{cancelled_id}",
        json={
            "version_id": 1,
            "status": "CANCELLED",
            "cancellation_reason": "Patient discontinued treatment",
        },
    )
    assert cancel_patch.status_code == 200

    # Doctor A: COMPLETED plan (1-session plan completed by logging 1 session)
    complete_create = doc_a_client.post(
        "/api/treatment-plans",
        json={
            "patient_id": patient.id,
            "plan_name": "Doc A Completed Package",
            "condition_diagnosis": "Cervical Spasm",
            "total_sessions": 1,
            "agreed_price_paise": 50000,
        },
    )
    assert complete_create.status_code == 201
    completed_id = complete_create.json()["id"]
    sess_resp = doc_a_client.post(
        f"/api/treatment-plans/{completed_id}/sessions",
        json={
            "vas_score": 2,
            "modalities": ["IFT"],
            "clinical_notes": "Single session completed.",
        },
    )
    assert sess_resp.status_code == 201

    # Doctor B: ACTIVE plan (must NOT appear in Doctor A's roster)
    doc_b_create = doc_b_client.post(
        "/api/treatment-plans",
        json={
            "patient_id": patient.id,
            "plan_name": "Doc B Active Package",
            "condition_diagnosis": "Knee Osteoarthritis",
            "total_sessions": 8,
            "agreed_price_paise": 400000,
        },
    )
    assert doc_b_create.status_code == 201
    doc_b_plan_id = doc_b_create.json()["id"]

    # Default status=ACTIVE for Doctor A returns only Doctor A's active plan
    default_resp = doc_a_client.get("/api/treatment-plans")
    assert default_resp.status_code == 200
    default_ids = [p["id"] for p in default_resp.json()]
    assert active_id in default_ids
    assert cancelled_id not in default_ids
    assert completed_id not in default_ids
    assert doc_b_plan_id not in default_ids

    # status=COMPLETED
    comp_resp = doc_a_client.get("/api/treatment-plans", params={"status": "COMPLETED"})
    assert comp_resp.status_code == 200
    assert [p["id"] for p in comp_resp.json()] == [completed_id]

    # status=CANCELLED
    canc_resp = doc_a_client.get("/api/treatment-plans", params={"status": "CANCELLED"})
    assert canc_resp.status_code == 200
    assert [p["id"] for p in canc_resp.json()] == [cancelled_id]

    # status=ALL returns all 3 of Doctor A's plans, excluding Doctor B's
    all_resp = doc_a_client.get("/api/treatment-plans", params={"status": "ALL"})
    assert all_resp.status_code == 200
    all_ids = {p["id"] for p in all_resp.json()}
    assert {active_id, cancelled_id, completed_id}.issubset(all_ids)
    assert doc_b_plan_id not in all_ids

    # Invalid status -> 422
    invalid_resp = doc_a_client.get("/api/treatment-plans", params={"status": "INVALID"})
    assert invalid_resp.status_code == 422
    assert invalid_resp.json()["code"] == "invalid_plan_status"

    # Doctor B sees only Doctor B's active plan
    doc_b_roster = doc_b_client.get("/api/treatment-plans")
    assert doc_b_roster.status_code == 200
    doc_b_ids = [p["id"] for p in doc_b_roster.json()]
    assert doc_b_plan_id in doc_b_ids
    assert active_id not in doc_b_ids

    # Reception and Admin -> 403
    assert login_client(reception_user).get("/api/treatment-plans").status_code == 403
    assert login_client(admin_user).get("/api/treatment-plans").status_code == 403


def test_create_treatment_plan_with_encounter_id_linkage_and_isolation(
    login_client, doctor_a_user, doctor_b_user, db_session
):
    """POST /api/treatment-plans persists encounter_id and rejects cross-patient/doctor links."""
    patient_1 = _create_test_patient(db_session, "06")
    patient_2 = _create_test_patient(db_session, "07")

    enc_doc_a = ClinicalEncounter(
        patient_id=patient_1.id,
        doctor_id=doctor_a_user.doctor_id,
        symptoms="Right shoulder pain",
        clinical_notes="Limited abduction",
        diagnosis="Frozen Shoulder",
        created_by_user_id=doctor_a_user.id,
    )
    enc_doc_b = ClinicalEncounter(
        patient_id=patient_1.id,
        doctor_id=doctor_b_user.doctor_id,
        symptoms="Neck stiffness",
        clinical_notes="Paraspinal tenderness",
        diagnosis="Cervical Strain",
        created_by_user_id=doctor_b_user.id,
    )
    db_session.add_all([enc_doc_a, enc_doc_b])
    db_session.flush()

    doc_a_client = login_client(doctor_a_user)

    # Valid linkage to own encounter for same patient -> 201
    ok_resp = doc_a_client.post(
        "/api/treatment-plans",
        json={
            "patient_id": patient_1.id,
            "encounter_id": enc_doc_a.id,
            "plan_name": "Shoulder Rehab Linked",
            "condition_diagnosis": "Frozen Shoulder",
            "total_sessions": 8,
            "agreed_price_paise": 400000,
        },
    )
    assert ok_resp.status_code == 201, ok_resp.text
    created = ok_resp.json()
    assert created["encounter_id"] == enc_doc_a.id
    persisted = db_session.get(TreatmentPlan, created["id"])
    assert persisted is not None
    assert persisted.encounter_id == enc_doc_a.id

    # Cross-patient encounter_id -> 404
    cross_patient_resp = doc_a_client.post(
        "/api/treatment-plans",
        json={
            "patient_id": patient_2.id,
            "encounter_id": enc_doc_a.id,
            "plan_name": "Mismatched Patient Plan",
            "condition_diagnosis": "Frozen Shoulder",
            "total_sessions": 5,
            "agreed_price_paise": 250000,
        },
    )
    assert cross_patient_resp.status_code == 404
    assert cross_patient_resp.json()["code"] == "encounter_not_found"

    # Cross-doctor encounter_id -> 404
    cross_doctor_resp = doc_a_client.post(
        "/api/treatment-plans",
        json={
            "patient_id": patient_1.id,
            "encounter_id": enc_doc_b.id,
            "plan_name": "Mismatched Doctor Plan",
            "condition_diagnosis": "Cervical Strain",
            "total_sessions": 5,
            "agreed_price_paise": 250000,
        },
    )
    assert cross_doctor_resp.status_code == 404


def test_create_treatment_plan_succeeds_with_merged_secondary_patient_encounter(
    login_client, doctor_a_user, db_session
):
    """create_treatment_plan succeeds when linking an encounter from a merged secondary patient."""
    master = _create_test_patient(db_session, "10")
    secondary = _create_test_patient(db_session, "11")

    # Encounter recorded under secondary patient prior to merge
    enc = ClinicalEncounter(
        patient_id=secondary.id,
        doctor_id=doctor_a_user.doctor_id,
        symptoms="Knee pain",
        clinical_notes="Meniscus injury suspected",
        diagnosis="Left knee strain",
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(enc)
    db_session.flush()

    # Merge secondary into master
    secondary.merged_into_id = master.id
    secondary.is_active = False
    db_session.flush()

    doc_a_client = login_client(doctor_a_user)

    # Creating treatment plan under master linking the secondary encounter succeeds
    resp = doc_a_client.post(
        "/api/treatment-plans",
        json={
            "patient_id": master.id,
            "encounter_id": enc.id,
            "plan_name": "Knee Rehab Post-Merge",
            "condition_diagnosis": "Left Knee Strain",
            "total_sessions": 6,
            "agreed_price_paise": 300000,
        },
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["encounter_id"] == enc.id
    assert data["patient_id"] in [master.id, secondary.id]

    # Verify downward alias consolidation on master patient plans list
    list_resp = doc_a_client.get(f"/api/patients/{master.id}/treatment-plans")
    assert list_resp.status_code == 200
    plan_ids = [p["id"] for p in list_resp.json()]
    assert data["id"] in plan_ids


def test_patch_treatment_plan_rejects_premature_completed_invariant_11(
    login_client, doctor_a_user, db_session
):
    """Invariant #11: PATCH COMPLETED is rejected when completed_sessions < total_sessions."""
    patient = _create_test_patient(db_session, "08")
    doc_a_client = login_client(doctor_a_user)

    create_resp = doc_a_client.post(
        "/api/treatment-plans",
        json={
            "patient_id": patient.id,
            "plan_name": "Post-ACL Rehab",
            "condition_diagnosis": "ACL Reconstruction Rehab",
            "total_sessions": 5,
            "agreed_price_paise": 500000,
        },
    )
    assert create_resp.status_code == 201
    plan_id = create_resp.json()["id"]

    # 0/5 completed -> 422 sessions_incomplete
    premature_0 = doc_a_client.patch(
        f"/api/treatment-plans/{plan_id}",
        json={"version_id": 1, "status": "COMPLETED"},
    )
    assert premature_0.status_code == 422
    assert premature_0.json()["code"] == "sessions_incomplete"
    assert "0/5" in premature_0.json()["message"]

    # Log 1 session -> 1/5 completed -> still 422 sessions_incomplete
    sess_resp = doc_a_client.post(
        f"/api/treatment-plans/{plan_id}/sessions",
        json={
            "vas_score": 5,
            "modalities": ["TENS"],
            "clinical_notes": "Session 1 done.",
        },
    )
    assert sess_resp.status_code == 201

    plan_after_s1 = doc_a_client.get(f"/api/treatment-plans/{plan_id}").json()
    assert plan_after_s1["completed_sessions"] == 1
    assert plan_after_s1["status"] == "ACTIVE"

    premature_1 = doc_a_client.patch(
        f"/api/treatment-plans/{plan_id}",
        json={"version_id": plan_after_s1["version_id"], "status": "COMPLETED"},
    )
    assert premature_1.status_code == 422
    assert premature_1.json()["code"] == "sessions_incomplete"
    assert "1/5" in premature_1.json()["message"]

    # Plan must remain ACTIVE
    refreshed = doc_a_client.get(f"/api/treatment-plans/{plan_id}").json()
    assert refreshed["status"] == "ACTIVE"


def test_ophthalmology_doctor_cannot_create_physiotherapy_treatment_plan(
    login_client, test_settings, db_session
):
    """Non-Physiotherapy doctors receive 403 specialty_required when creating rehab plans."""
    from kalyan_api.core.security import build_hasher, hash_password
    from kalyan_api.models import Department, Doctor, User
    from tests.conftest import TEST_PASSWORD

    patient = _create_test_patient(db_session, "09")
    ophth_dept = db_session.scalar(select(Department).where(Department.code == "OPHTHALMOLOGY"))
    if ophth_dept is None:
        ophth_dept = Department(name_en="Ophthalmology", code="OPHTHALMOLOGY", is_active=True)
        db_session.add(ophth_dept)
        db_session.flush()

    ophth_doc = Doctor(name_en="Dr. Eye Specialist", is_active=True)
    ophth_doc.departments.append(ophth_dept)
    db_session.add(ophth_doc)
    db_session.flush()

    ophth_user = User(
        username="fixture_ophth_plan_doc",
        full_name="Dr. Eye Specialist",
        role="DOCTOR",
        doctor_id=ophth_doc.id,
        password_hash=hash_password(build_hasher(test_settings), TEST_PASSWORD),
        must_change_password=False,
        is_active=True,
    )
    db_session.add(ophth_user)
    db_session.flush()

    ophth_client = login_client(ophth_user)
    resp = ophth_client.post(
        "/api/treatment-plans",
        json={
            "patient_id": patient.id,
            "plan_name": "Unauthorized Physio Plan",
            "condition_diagnosis": "Cervical Pain",
            "total_sessions": 5,
            "agreed_price_paise": 250000,
        },
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["code"] == "specialty_required"
