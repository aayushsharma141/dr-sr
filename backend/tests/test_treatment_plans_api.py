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

from kalyan_api.models import AuditLog, Patient


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

    # Doctor B attempts to read Doctor A's plan -> 404
    doc_b_client = login_client(doctor_b_user)
    assert doc_b_client.get(f"/api/treatment-plans/{plan_id}").status_code == 404

    # Doctor B attempts to modify Doctor A's plan -> 404
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
