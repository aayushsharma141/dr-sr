"""Integration tests for Payments, Receipts, Pending Dues, and Reversals API (Phase 15).

Guarantees:
- Reception records consultation and package instalment payments (BIL-01).
- Money stored/returned as integer paise (BIL-02).
- Overpayments exceeding package fee rejected with 422 (BIL-02).
- Dynamic pending dues reflect agreed price minus active payments (BIL-03).
- Sequential receipt numbers generated (BIL-04).
- Admin-authorized reversals with mandatory reason restore dues (BIL-05).
- Non-admin callers attempting reversal rejected with 403 Forbidden (BIL-05).
- Doctors forbidden from billing endpoints (403 Forbidden).
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.models import (
    Appointment,
    AuditLog,
    Doctor,
    Patient,
    TreatmentPlan,
    User,
)


def _create_test_patient(session: Session, suffix: str = "01") -> Patient:
    patient = Patient(
        urn=f"KH-2026-BILAPI{suffix}",
        full_name=f"Billing Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=40,
        mobile=f"98765411{suffix}",
        address="Bhojpur",
        district="Bhojpur",
        state="Bihar",
    )
    session.add(patient)
    session.flush()
    return patient


def test_reception_records_consultation_payment(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Reception records consultation payment; receipt number and audit log created.

    Covers (BIL-01, BIL-04).
    """
    pat = _create_test_patient(db_session, "01")
    rec_c = login_client(reception_user)

    # Book appointment
    appt = Appointment(
        patient_id=pat.id,
        doctor_id=doctor_a_user.doctor_id,
        appointment_date=datetime.now(UTC).date(),
        token_number=1,
        status="ARRIVED",
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    # Record Payment of ₹300 (30,000 paise) via UPI
    pay_resp = rec_c.post(
        "/api/payments",
        json={
            "patient_id": pat.id,
            "appointment_id": appt.id,
            "amount_paise": 30000,
            "payment_method": "UPI",
            "notes": "Consultation fee paid via PhonePe",
        },
    )
    assert pay_resp.status_code == 201
    pay_data = pay_resp.json()

    assert pay_data["amount_paise"] == 30000
    assert pay_data["payment_method"] == "UPI"
    assert pay_data["receipt_number"].startswith("RCP-")
    assert pay_data["patient_urn"] == pat.urn
    assert pay_data["patient_name"] == pat.full_name
    assert pay_data["is_reversed"] is False
    assert pay_data["created_by_username"] == reception_user.username

    # Verify payment retrieval
    get_resp = rec_c.get(f"/api/payments/{pay_data['id']}")
    assert get_resp.status_code == 200
    assert get_resp.json()["receipt_number"] == pay_data["receipt_number"]

    # Verify patient payment history
    history_resp = rec_c.get(f"/api/patients/{pat.id}/payments")
    assert history_resp.status_code == 200
    history = history_resp.json()
    assert len(history) == 1
    assert history[0]["id"] == pay_data["id"]

    # Verify Audit log
    audit_row = db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "PAYMENT_RECORDED",
            AuditLog.entity_id == str(pay_data["id"]),
        )
    ).scalar_one_or_none()
    assert audit_row is not None
    assert audit_row.actor_user_id == reception_user.id
    assert audit_row.after_data["amount_paise"] == 30000


def test_treatment_package_instalment_and_overpayment_rejection(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Instalments decrement balance; overpayments are rejected with 422 (BIL-02, BIL-03)."""
    pat = _create_test_patient(db_session, "02")
    rec_c = login_client(reception_user)

    # Treatment package for ₹2,500 (250,000 paise)
    plan = TreatmentPlan(
        patient_id=pat.id,
        doctor_id=doctor_a_user.doctor_id,
        plan_name="Lumbar Disc Rehab 5-Session",
        condition_diagnosis="L4-L5 Herniation",
        total_sessions=5,
        agreed_price_paise=250000,
    )
    db_session.add(plan)
    db_session.flush()

    # First instalment: ₹1,500 (150,000 paise)
    inst1_resp = rec_c.post(
        "/api/payments",
        json={
            "patient_id": pat.id,
            "treatment_plan_id": plan.id,
            "amount_paise": 150000,
            "payment_method": "CASH",
            "notes": "First instalment at start of rehab",
        },
    )
    assert inst1_resp.status_code == 201
    assert inst1_resp.json()["amount_paise"] == 150000

    # Attempt Overpayment: ₹1,200 (120,000 paise) -> Total would be ₹2,700 > ₹2,500 -> 422!
    over_resp = rec_c.post(
        "/api/payments",
        json={
            "patient_id": pat.id,
            "treatment_plan_id": plan.id,
            "amount_paise": 120000,
            "payment_method": "UPI",
        },
    )
    assert over_resp.status_code == 422
    assert over_resp.json()["code"] == "overpayment_rejected"

    # Exact remaining balance: ₹1,000 (100,000 paise) -> 201
    inst2_resp = rec_c.post(
        "/api/payments",
        json={
            "patient_id": pat.id,
            "treatment_plan_id": plan.id,
            "amount_paise": 100000,
            "payment_method": "CARD",
            "notes": "Final settlement",
        },
    )
    assert inst2_resp.status_code == 201
    assert inst2_resp.json()["amount_paise"] == 100000


def test_pending_dues_ledger(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Pending dues lists packages with remaining balances; removes fully settled (BIL-03)."""
    pat = _create_test_patient(db_session, "03")
    rec_c = login_client(reception_user)

    plan = TreatmentPlan(
        patient_id=pat.id,
        doctor_id=doctor_a_user.doctor_id,
        plan_name="Cervical Spondylosis 7-Session",
        condition_diagnosis="Cervical Spasm",
        total_sessions=7,
        agreed_price_paise=350000,  # ₹3,500
    )
    db_session.add(plan)
    db_session.flush()

    # Initial state: 0 paid -> balance = 350000
    dues_resp = rec_c.get("/api/billing/pending-dues")
    assert dues_resp.status_code == 200
    dues = dues_resp.json()
    item = next(d for d in dues if d["treatment_plan_id"] == plan.id)
    assert item["agreed_price_paise"] == 350000
    assert item["paid_paise"] == 0
    assert item["balance_paise"] == 350000
    # FB-05 / D-04: clinical diagnosis hidden from reception
    assert item.get("condition_diagnosis") is None

    # Pay ₹2,000 (200000 paise)
    rec_c.post(
        "/api/payments",
        json={
            "patient_id": pat.id,
            "treatment_plan_id": plan.id,
            "amount_paise": 200000,
            "payment_method": "CASH",
        },
    )

    # Check updated dues
    dues_resp2 = rec_c.get("/api/billing/pending-dues")
    item2 = next(d for d in dues_resp2.json() if d["treatment_plan_id"] == plan.id)
    assert item2["paid_paise"] == 200000
    assert item2["balance_paise"] == 150000

    # Pay remaining ₹1,500
    rec_c.post(
        "/api/payments",
        json={
            "patient_id": pat.id,
            "treatment_plan_id": plan.id,
            "amount_paise": 150000,
            "payment_method": "UPI",
        },
    )

    # Fully settled package no longer appears in pending dues
    dues_resp3 = rec_c.get("/api/billing/pending-dues")
    assert not any(d["treatment_plan_id"] == plan.id for d in dues_resp3.json())


def test_admin_payment_reversal_and_balance_restoration(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Admin reverses payment with mandatory reason; dues restored; non-admin blocked (BIL-05)."""
    pat = _create_test_patient(db_session, "04")
    rec_c = login_client(reception_user)
    adm_c = login_client(admin_user)

    plan = TreatmentPlan(
        patient_id=pat.id,
        doctor_id=doctor_a_user.doctor_id,
        plan_name="Knee OA Package",
        condition_diagnosis="Bilateral Knee OA",
        total_sessions=10,
        agreed_price_paise=500000,  # ₹5,000
    )
    db_session.add(plan)
    db_session.flush()

    # Reception records ₹5,000 payment
    pay_resp = rec_c.post(
        "/api/payments",
        json={
            "patient_id": pat.id,
            "treatment_plan_id": plan.id,
            "amount_paise": 500000,
            "payment_method": "CARD",
        },
    )
    payment_id = pay_resp.json()["id"]

    # Verify no dues remaining
    dues_resp = rec_c.get("/api/billing/pending-dues").json()
    assert not any(d["treatment_plan_id"] == plan.id for d in dues_resp)

    # Reception attempts reversal -> 403 Forbidden
    rec_rev_resp = rec_c.post(
        f"/api/payments/{payment_id}/reverse",
        json={"reversal_reason": "Refund requested by patient"},
    )
    assert rec_rev_resp.status_code == 403

    # Admin attempts reversal with short reason (< 5 chars) -> 422
    bad_rev_resp = adm_c.post(
        f"/api/payments/{payment_id}/reverse",
        json={"reversal_reason": "Void"},
    )
    assert bad_rev_resp.status_code == 422

    # Admin successfully reverses payment
    adm_rev_resp = adm_c.post(
        f"/api/payments/{payment_id}/reverse",
        json={"reversal_reason": "Card charged in error, refunded via POS terminal."},
    )
    assert adm_rev_resp.status_code == 200
    rev_data = adm_rev_resp.json()
    assert rev_data["is_reversed"] is True
    assert rev_data["reversal_reason"] == "Card charged in error, refunded via POS terminal."
    assert rev_data["reversed_by_username"] == admin_user.username
    assert rev_data["reversed_at"] is not None

    # Reversing already reversed payment fails -> 400
    double_rev_resp = adm_c.post(
        f"/api/payments/{payment_id}/reverse",
        json={"reversal_reason": "Attempting second reversal."},
    )
    assert double_rev_resp.status_code == 400
    assert double_rev_resp.json()["code"] == "already_reversed"

    # Pending dues reflects restored ₹5,000 balance
    dues_after = rec_c.get("/api/billing/pending-dues").json()
    restored_due = next(d for d in dues_after if d["treatment_plan_id"] == plan.id)
    assert restored_due["paid_paise"] == 0
    assert restored_due["balance_paise"] == 500000

    # Verify Audit trail for reversal
    rev_audit = db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "PAYMENT_REVERSED",
            AuditLog.entity_id == str(payment_id),
        )
    ).scalar_one_or_none()
    assert rev_audit is not None
    assert rev_audit.actor_user_id == admin_user.id
    assert rev_audit.reason == "Card charged in error, refunded via POS terminal."


def test_doctor_cannot_record_or_reverse_payment(
    login_client: Any,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Doctor role is forbidden from billing mutations (403 Forbidden)."""
    pat = _create_test_patient(db_session, "05")
    doc_c = login_client(doctor_a_user)

    # Doctor POST /api/payments -> 403
    pay_resp = doc_c.post(
        "/api/payments",
        json={
            "patient_id": pat.id,
            "amount_paise": 10000,
            "payment_method": "CASH",
        },
    )
    assert pay_resp.status_code == 403

    # Doctor POST /api/payments/{id}/reverse -> 403
    rev_resp = doc_c.post(
        "/api/payments/1/reverse",
        json={"reversal_reason": "Doctor trying to reverse payment"},
    )
    assert rev_resp.status_code == 403


def test_completed_package_with_unpaid_balance_stays_in_pending_dues(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """BR-003: Completed treatment package with unpaid balance remains in pending dues and can be
    paid."""
    pat = _create_test_patient(db_session, "06")
    rec_c = login_client(reception_user)

    plan = TreatmentPlan(
        patient_id=pat.id,
        doctor_id=doctor_a_user.doctor_id,
        plan_name="Completed but Unpaid Plan",
        condition_diagnosis="Low Back Pain",
        total_sessions=5,
        completed_sessions=5,
        status="COMPLETED",
        agreed_price_paise=300000,  # ₹3,000
    )
    db_session.add(plan)
    db_session.flush()

    # Verify plan shows up in pending dues
    dues = rec_c.get("/api/billing/pending-dues").json()
    due = next((d for d in dues if d["treatment_plan_id"] == plan.id), None)
    assert due is not None
    assert due["balance_paise"] == 300000

    # Pay partial amount (₹2,000)
    pay1 = rec_c.post(
        "/api/payments",
        json={
            "patient_id": pat.id,
            "treatment_plan_id": plan.id,
            "amount_paise": 200000,
            "payment_method": "CASH",
        },
    )
    assert pay1.status_code == 201

    # Remaining balance (₹1,000) is still in pending dues
    dues2 = rec_c.get("/api/billing/pending-dues").json()
    due2 = next((d for d in dues2 if d["treatment_plan_id"] == plan.id), None)
    assert due2 is not None
    assert due2["balance_paise"] == 100000


def test_consultation_fee_overpayment_rejected(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """BR-004: Overpayment exceeding doctor's consultation fee is rejected."""
    pat = _create_test_patient(db_session, "07")
    rec_c = login_client(reception_user)

    doctor = db_session.get(Doctor, doctor_a_user.doctor_id)
    doctor.default_fee_paise = 40000  # ₹400
    dept = doctor.departments[0]
    db_session.flush()

    book = rec_c.post(
        "/api/appointments",
        json={
            "patient_id": pat.id,
            "doctor_id": doctor.id,
            "department_id": dept.id,
            "appointment_date": clock.ist_today().isoformat(),
        },
    )
    appt_id = book.json()["id"]

    # Attempting to pay ₹500 when fee is ₹400 is rejected
    overpay = rec_c.post(
        "/api/payments",
        json={
            "patient_id": pat.id,
            "appointment_id": appt_id,
            "amount_paise": 50000,
            "payment_method": "CASH",
        },
    )
    assert overpay.status_code == 422
    assert overpay.json()["code"] == "overpayment_rejected"

    # Paying exact ₹400 succeeds
    pay_ok = rec_c.post(
        "/api/payments",
        json={
            "patient_id": pat.id,
            "appointment_id": appt_id,
            "amount_paise": 40000,
            "payment_method": "CASH",
        },
    )
    assert pay_ok.status_code == 201

    # Second payment on same appointment is rejected as overpayment
    second_pay = rec_c.post(
        "/api/payments",
        json={
            "patient_id": pat.id,
            "appointment_id": appt_id,
            "amount_paise": 10000,
            "payment_method": "CASH",
        },
    )
    assert second_pay.status_code == 422
    assert second_pay.json()["code"] == "overpayment_rejected"
