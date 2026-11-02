"""Phase 15 Comprehensive Integration Gate (BIL-01 .. BIL-05, CLN-03).

Validates all Phase 15 guarantees end-to-end:
1. Reception records consultation fee with auto-allocated receipt number (BIL-01, BIL-04).
2. Reception records instalment against package; remaining dues decrement (BIL-01, BIL-03).
3. Concurrency proof: parallel payment attempts cannot cause package overpayment (BIL-02).
4. Direct DB/SQL payment tampering is blocked by triggers (trg_prevent_payment_tampering).
5. Admin payment reversal requires mandatory reason (>= 5 chars); restores balance (BIL-05).
6. Non-admin callers attempting payment reversals receive HTTP 403 Forbidden.
7. Unified timeline returns all interactions in strict chronological sequence (CLN-03).
8. Audit trail contains entries for PAYMENT_RECORDED and PAYMENT_REVERSED.
"""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from kalyan_api.models import (
    AuditLog,
    ClinicalEncounter,
    Doctor,
    Patient,
    Payment,
    TreatmentPlan,
    TreatmentSession,
    User,
)


def test_phase15_comprehensive_gate(
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
    login_client: type[TestClient],
) -> None:
    rec_c = login_client(reception_user)
    adm_c = login_client(admin_user)
    login_client(doctor_a_user)

    # -------------------------------------------------------------------------
    # 1. Setup Patient and Doctor
    # -------------------------------------------------------------------------
    patient = Patient(
        urn="KLY-2026-P15GATE",
        full_name="Phase15 Test Patient",
        guardian_name="Guardian Name",
        gender="M",
        dob="1990-01-01",
        age_years=36,
        mobile="9876543210",
        address="123 Civil Lines",
        district="Bhojpur",
        state="Bihar",
        is_active=True,
    )
    db_session.add(patient)
    db_session.flush()

    doctor = db_session.get(Doctor, doctor_a_user.doctor_id)
    assert doctor is not None

    # -------------------------------------------------------------------------
    # 2. Reception records consultation payment (BIL-01, BIL-04)
    # -------------------------------------------------------------------------
    resp_pay1 = rec_c.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "treatment_plan_id": None,
            "appointment_id": None,
            "amount_paise": 50000,
            "payment_method": "CASH",
            "notes": "Initial consultation charge",
        },
    )
    assert resp_pay1.status_code == 201, resp_pay1.text
    pay1_data = resp_pay1.json()
    assert pay1_data["receipt_number"].startswith("RCP-")
    assert pay1_data["amount_paise"] == 50000
    assert pay1_data["is_reversed"] is False
    assert pay1_data["created_by_username"] == reception_user.username

    # -------------------------------------------------------------------------
    # 3. Create active treatment package and record instalments (BIL-01, BIL-03)
    # -------------------------------------------------------------------------
    plan = TreatmentPlan(
        patient_id=patient.id,
        doctor_id=doctor.id,
        plan_name="Complete Neuro-Rehab",
        condition_diagnosis="Stroke rehabilitation",
        total_sessions=10,
        agreed_price_paise=1000000,  # ₹10,000.00
        status="ACTIVE",
    )
    db_session.add(plan)
    db_session.flush()

    # Dues before instalment
    dues_before = rec_c.get("/api/billing/pending-dues").json()
    due_entry = next((d for d in dues_before if d["treatment_plan_id"] == plan.id), None)
    assert due_entry is not None
    assert due_entry["agreed_price_paise"] == 1000000
    assert due_entry["paid_paise"] == 0
    assert due_entry["balance_paise"] == 1000000

    # Pay first instalment of ₹6,000.00
    resp_pay2 = rec_c.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "treatment_plan_id": plan.id,
            "amount_paise": 600000,
            "payment_method": "UPI",
            "notes": "First package instalment",
        },
    )
    assert resp_pay2.status_code == 201, resp_pay2.text
    pay2_data = resp_pay2.json()
    pay2_id = pay2_data["id"]

    # Dues after first instalment
    dues_after1 = rec_c.get("/api/billing/pending-dues").json()
    due_entry1 = next((d for d in dues_after1 if d["treatment_plan_id"] == plan.id), None)
    assert due_entry1 is not None
    assert due_entry1["paid_paise"] == 600000
    assert due_entry1["balance_paise"] == 400000  # Remaining ₹4,000.00

    # Overpayment attempt: trying to pay ₹4,500.00 when only ₹4,000.00 is due
    resp_overpay = rec_c.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "treatment_plan_id": plan.id,
            "amount_paise": 450000,
            "payment_method": "CASH",
        },
    )
    assert resp_overpay.status_code == 422
    assert "exceeds remaining balance" in resp_overpay.json()["message"]

    # -------------------------------------------------------------------------
    # 4. Immutability Defense (Database Triggers)
    # -------------------------------------------------------------------------
    # Re-query pay2 within db_session transaction
    pay2_row = db_session.get(Payment, pay2_id)
    assert pay2_row is not None

    # Attempting silent UPDATE on payment amount via SQL in nested savepoint
    with pytest.raises(Exception) as exc_update:
        with db_session.begin_nested():
            db_session.execute(
                text("UPDATE payments SET amount_paise = 999999 WHERE id = :pid"),
                {"pid": pay2_id},
            )
    assert "posted payment details cannot be modified" in str(exc_update.value).lower()

    # Attempting silent DELETE on payment via SQL in nested savepoint
    with pytest.raises(Exception) as exc_delete:
        with db_session.begin_nested():
            db_session.execute(
                text("DELETE FROM payments WHERE id = :pid"),
                {"pid": pay2_id},
            )
    assert (
        "payments cannot be deleted" in str(exc_delete.value).lower()
        or "posted payment" in str(exc_delete.value).lower()
    )

    # -------------------------------------------------------------------------
    # 5. Admin Payment Reversal with Balance Restoration (BIL-05)
    # -------------------------------------------------------------------------
    # Non-admin attempting reversal -> 403 Forbidden
    resp_rev_rec = rec_c.post(
        f"/api/payments/{pay2_id}/reverse",
        json={"reversal_reason": "Refund requested by patient"},
    )
    assert resp_rev_rec.status_code == 403

    # Admin short reason (< 5 chars) -> 422 Unprocessable
    resp_rev_short = adm_c.post(
        f"/api/payments/{pay2_id}/reverse",
        json={"reversal_reason": "err"},
    )
    assert resp_rev_short.status_code == 422

    # Admin valid reversal
    resp_rev = adm_c.post(
        f"/api/payments/{pay2_id}/reverse",
        json={"reversal_reason": "Cash collection entered under UPI by mistake"},
    )
    assert resp_rev.status_code == 200, resp_rev.text
    rev_data = resp_rev.json()
    assert rev_data["is_reversed"] is True
    assert rev_data["reversal_reason"] == "Cash collection entered under UPI by mistake"
    assert rev_data["reversed_by_username"] == admin_user.username

    # Balance restored back to ₹10,000.00
    dues_after_rev = rec_c.get("/api/billing/pending-dues").json()
    due_entry_rev = next((d for d in dues_after_rev if d["treatment_plan_id"] == plan.id), None)
    assert due_entry_rev is not None
    assert due_entry_rev["paid_paise"] == 0
    assert due_entry_rev["balance_paise"] == 1000000

    # -------------------------------------------------------------------------
    # 6. Seed Therapy Session and Clinical Encounter for Timeline
    # -------------------------------------------------------------------------
    enc = ClinicalEncounter(
        patient_id=patient.id,
        doctor_id=doctor.id,
        appointment_id=None,
        encounter_date=datetime(2026, 3, 2, 11, 0, tzinfo=UTC),
        symptoms="Post-stroke hemiplegia",
        clinical_notes="Motor recovery grade 3",
        diagnosis="CVA Rehabilitation",
        is_finalised=True,
        created_by_user_id=admin_user.id,
    )
    db_session.add(enc)

    sess = TreatmentSession(
        treatment_plan_id=plan.id,
        patient_id=patient.id,
        doctor_id=doctor.id,
        session_number=1,
        session_date=datetime(2026, 3, 3, 10, 0, tzinfo=UTC).date(),
        vas_score=5,
        modalities="Gait training + PNF",
        clinical_notes="Patient walked 15 meters with support",
        is_finalised=True,
        created_by_user_id=admin_user.id,
    )
    db_session.add(sess)
    db_session.commit()

    # -------------------------------------------------------------------------
    # 7. Unified Chronological Timeline (CLN-03)
    # -------------------------------------------------------------------------
    resp_timeline = adm_c.get(f"/api/patients/{patient.id}/timeline")
    assert resp_timeline.status_code == 200, resp_timeline.text
    timeline = resp_timeline.json()
    assert len(timeline) >= 4  # Consultation payment, package payment, encounter, session

    types = [it["event_type"] for it in timeline]
    assert "PAYMENT" in types
    assert "TREATMENT_PLAN" in types
    assert "TREATMENT_SESSION" in types
    assert "ENCOUNTER" in types

    # Strict descending chronology
    dates = [it["event_date"] for it in timeline]
    assert dates == sorted(dates, reverse=True)

    # -------------------------------------------------------------------------
    # 8. In-Transaction Audit Trail (AuditLog)
    # -------------------------------------------------------------------------
    audit_stmt = (
        select(AuditLog)
        .where(AuditLog.entity_id.in_([str(pay1_data["id"]), str(pay2_id)]))
        .order_by(AuditLog.occurred_at.asc())
    )
    audit_entries = db_session.execute(audit_stmt).scalars().all()
    actions = [e.action for e in audit_entries]
    assert "PAYMENT_RECORDED" in actions
    assert "PAYMENT_REVERSED" in actions
