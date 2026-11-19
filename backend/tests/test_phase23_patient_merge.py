"""Tests for Phase 23 Duplicate Detection, Open Visit Guard, and Alias-Pointer Merge."""

from datetime import date
import pytest
from sqlalchemy import select

from kalyan_api.models import (
    Appointment,
    AppointmentSource,
    AppointmentStatus,
    ClinicalEncounter,
    Department,
    Doctor,
    Patient,
    Payment,
    PaymentMethod,
    Visit,
    VisitKind,
)
from kalyan_api.services.audit_service import AuditAction


def _create_test_patient(
    db_session,
    urn: str,
    name: str,
    mobile: str = "9876543210",
    address: str = "Ara, Bihar",
    guardian: str = "Guardian Name",
) -> Patient:
    patient = Patient(
        urn=urn,
        full_name=name,
        guardian_name=guardian,
        gender="M",
        age_years=35,
        mobile=mobile,
        address=address,
        district="Bhojpur",
        state="Bihar",
        is_active=True,
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def test_duplicate_candidate_detection(login_client, admin_user, db_session):
    client = login_client(admin_user)
    
    # Create two patients sharing exact mobile and normalized similar names
    p1 = _create_test_patient(db_session, "URN-DUP-01", "Sanjay  Sharma", mobile="9811122233")
    p2 = _create_test_patient(db_session, "URN-DUP-02", "Sanjay Sharma", mobile="9811122233")
    p3 = _create_test_patient(db_session, "URN-DUP-03", "Anil Kumar", mobile="9844455566")
    db_session.commit()

    resp = client.get("/api/admin/patients/duplicates")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert len(data) >= 1
    
    matched = next((pair for pair in data if pair["master"]["id"] == p1.id and pair["duplicate"]["id"] == p2.id), None)
    assert matched is not None
    assert matched["similarity_score"] == 1.0
    assert matched["has_open_visit"] is False


def test_open_visit_guard_blocks_merge(login_client, admin_user, db_session):
    client = login_client(admin_user)
    
    p1 = _create_test_patient(db_session, "URN-VISIT-01", "Ramesh Verma", mobile="9822233344")
    p2 = _create_test_patient(db_session, "URN-VISIT-02", "Ramesh Verma", mobile="9822233344")
    
    # Open visit on p2
    open_visit = Visit(
        patient_id=p2.id,
        visit_date=date.today(),
        status="OPEN",
        opened_by_user_id=admin_user.id,
        closed_at=None,  # Open visit!
    )
    db_session.add(open_visit)
    db_session.commit()

    # Attempt merge: MUST fail closed with open_visit_conflict
    merge_payload = {
        "master_patient_id": p1.id,
        "secondary_patient_id": p2.id,
        "reason": "Duplicate registration cleanup",
    }
    resp = client.post("/api/admin/patients/merge", json=merge_payload)
    assert resp.status_code == 400
    err = resp.json()
    assert err["code"] == "open_visit_conflict"
    assert "open visit" in err["message"].lower()

    # Close the visit and verify merge now succeeds
    open_visit.status = "CLOSED"
    open_visit.closed_at = open_visit.opened_at
    open_visit.closed_by_user_id = admin_user.id
    db_session.commit()

    resp_ok = client.post("/api/admin/patients/merge", json=merge_payload)
    assert resp_ok.status_code == 200, resp_ok.text
    result = resp_ok.json()
    assert result["secondary"]["is_active"] is False
    assert result["secondary"]["merged_into_id"] == p1.id


def test_alias_pointer_merge_and_tamper_trigger_preservation(
    login_client, admin_user, db_session
):
    client = login_client(admin_user)
    
    p1 = _create_test_patient(db_session, "URN-TRIG-01", "Pooja Singh", mobile="9833344455")
    p2 = _create_test_patient(db_session, "URN-TRIG-02", "Pooja Singh", mobile="9833344455", address="Old Village Road")
    
    # Post historical payment on p2 (this row has trg_prevent_payment_tampering)
    payment = Payment(
        receipt_number="RCP-P23-001",
        patient_id=p2.id,
        amount_paise=50000,
        payment_method=PaymentMethod.CASH.value,
        is_reversed=False,
        created_by_user_id=admin_user.id,
    )
    db_session.add(payment)
    db_session.commit()

    # Merge p2 into p1 with address demographic override
    merge_payload = {
        "master_patient_id": p1.id,
        "secondary_patient_id": p2.id,
        "reason": "Duplicate profile verified by admin",
        "demographic_overrides": {"address": "Updated Village Road, Ara"},
    }
    resp = client.post("/api/admin/patients/merge", json=merge_payload)
    assert resp.status_code == 200, resp.text
    
    # Verify p1 master received the override
    db_session.refresh(p1)
    db_session.refresh(p2)
    assert p1.address == "Updated Village Road, Ara"
    assert p2.is_active is False
    assert p2.merged_into_id == p1.id
    assert p2.merge_reason == "Duplicate profile verified by admin"
    
    # Verify payment row remains untouched on p2.id (tamper trigger preserved!)
    db_session.refresh(payment)
    assert payment.patient_id == p2.id

    # Now verify unmerge restores secondary patient
    unmerge_resp = client.post(f"/api/admin/patients/{p2.id}/unmerge", json={"reason": "Incorrect duplicate flagged"})
    assert unmerge_resp.status_code == 200, unmerge_resp.text
    db_session.refresh(p2)
    assert p2.is_active is True
    assert p2.merged_into_id is None
    assert p2.merge_reason is None


def test_rbac_reception_cannot_merge_or_view_duplicates(login_client, reception_user, db_session):
    client = login_client(reception_user)
    
    resp_get = client.get("/api/admin/patients/duplicates")
    assert resp_get.status_code == 403

    resp_post = client.post(
        "/api/admin/patients/merge",
        json={"master_patient_id": 1, "secondary_patient_id": 2, "reason": "test"},
    )
    assert resp_post.status_code == 403
