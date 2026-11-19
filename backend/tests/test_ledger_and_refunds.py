"""Milestone 3 (T3.3): Append-only patient financial ledger, Admin-only refunds,
tamper triggers, least-privilege DB grants, RBAC, and merged alias consolidation.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

import pytest
from conftest import make_user
from sqlalchemy import Engine, select, text
from sqlalchemy.exc import DBAPIError, ProgrammingError
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.models import (
    Appointment,
    AuditLog,
    Patient,
    User,
)
from kalyan_api.services import integrity_service
from kalyan_api.services.audit_service import AuditAction


def _create_patient(db_session: Session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-LD{suffix}",
        full_name=f"Ledger Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=40,
        mobile="9876543210",
        address="Hospital Road, Ara",
        district="Bhojpur",
        state="Bihar",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _check_in_and_complete(
    reception_client: Any,
    db_session: Session,
    patient: Patient,
    doctor_user: User,
    fee_paise: int,
) -> dict[str, Any]:
    """Perform walk-in check-in creating visit + consultation bill item, then complete consult."""
    assert doctor_user.doctor is not None
    doctor_user.doctor.default_fee_paise = fee_paise
    db_session.flush()
    dept = doctor_user.doctor.departments[0]
    res = reception_client.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_user.doctor_id,
            "department_id": dept.id,
            "referral_source": "SELF",
        },
    )
    assert res.status_code == 201, res.text
    walked = res.json()
    appt = db_session.get(Appointment, walked["id"])
    assert appt is not None
    appt.consultation_status = "COMPLETED"
    db_session.flush()
    return walked


def test_full_ledger_and_refund_lifecycle_with_integrity_reconciliation(
    clock: dict[str, Any],
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    """Full lifecycle: check-in -> bill item -> discount -> partial payment -> partial refund
    -> re-collection -> second partial refund -> over-refund 422 -> reversal after refund 422,
    verifying exact running balances, pagination, audit logs, and Check #1/#7 0 discrepancies.
    """
    admin = login_client(admin_user)
    reception = login_client(reception_user)
    doctor = login_client(doctor_a_user)

    patient = _create_patient(db_session, "LC01")

    # 1. Consultation check-in: +50,000 paise (balance: 50,000)
    walked = _check_in_and_complete(reception, db_session, patient, doctor_a_user, fee_paise=50000)
    visit_id = walked["visit_id"]
    appt_id = walked["id"]

    # 2. Reception adds bill item: +20,000 paise (balance: 70,000)
    clock["t"] = clock["t"] + timedelta(minutes=5)
    line_res = reception.post(
        f"/api/visits/{visit_id}/bill-items",
        json={
            "category": "ADDITIONAL",
            "description": "Dressing & Injection",
            "unit": "procedure",
            "quantity": "1",
            "rate_paise": 20000,
        },
    )
    assert line_res.status_code == 201, line_res.text

    # 3. Doctor discounts consultation fee 50,000 -> 40,000: -10,000 paise (balance: 60,000)
    clock["t"] = clock["t"] + timedelta(minutes=5)
    disc_res = doctor.post(
        f"/api/appointments/{appt_id}/fee-adjustment",
        json={"kind": "DISCOUNT", "new_amount_paise": 40000, "reason": "Senior citizen discount"},
    )
    assert disc_res.status_code == 201, disc_res.text

    # 4. Reception collects partial payment #1: -35,000 paise (balance: 25,000)
    clock["t"] = clock["t"] + timedelta(minutes=5)
    pay1_res = reception.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit_id,
            "amount_paise": 35000,
            "payment_method": "CASH",
            "notes": "First instalment",
        },
    )
    assert pay1_res.status_code == 201, pay1_res.text
    pay1 = pay1_res.json()

    # 5. Admin issues partial refund #1 against payment #1: +10,000 paise (balance: 35,000)
    clock["t"] = clock["t"] + timedelta(minutes=5)
    ref1_res = admin.post(
        f"/api/payments/{pay1['id']}/refunds",
        json={
            "amount_paise": 10000,
            "refund_method": "UPI",
            "reason": "  Partial overcharge refund  ",
        },
    )
    assert ref1_res.status_code == 201, ref1_res.text
    ref1 = ref1_res.json()
    assert ref1["refund_number"].startswith("RFN-")
    assert ref1["payment_id"] == pay1["id"]
    assert ref1["payment_receipt_number"] == pay1["receipt_number"]
    assert ref1["visit_id"] == visit_id
    assert ref1["amount_paise"] == 10000
    assert ref1["refund_method"] == "UPI"
    assert ref1["reason"] == "Partial overcharge refund"
    assert ref1["refunded_by_user_id"] == admin_user.id
    assert ref1["refunded_by_username"] == admin_user.username

    # 6. Reception re-collects payment #2: -25,000 paise (balance: 10,000)
    clock["t"] = clock["t"] + timedelta(minutes=5)
    pay2_res = reception.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit_id,
            "amount_paise": 25000,
            "payment_method": "CARD",
            "notes": "Re-collection after partial refund",
        },
    )
    assert pay2_res.status_code == 201, pay2_res.text
    pay2 = pay2_res.json()

    # 7. Admin issues second partial refund against payment #1: +15,000 paise (balance: 25,000)
    clock["t"] = clock["t"] + timedelta(minutes=5)
    ref2_res = admin.post(
        f"/api/payments/{pay1['id']}/refunds",
        json={
            "amount_paise": 15000,
            "refund_method": "CASH",
            "reason": "Second approved partial refund",
        },
    )
    assert ref2_res.status_code == 201, ref2_res.text
    ref2 = ref2_res.json()
    assert ref2["refund_number"].startswith("RFN-")
    assert ref2["refund_number"] != ref1["refund_number"]

    # 8. Over-refund rejected 422 (remaining refundable on pay1 is 35,000 - 25,000 = 10,000)
    over_ref = admin.post(
        f"/api/payments/{pay1['id']}/refunds",
        json={
            "amount_paise": 10001,
            "refund_method": "CASH",
            "reason": "Exceeds remaining refundable",
        },
    )
    assert over_ref.status_code == 422, over_ref.text
    assert over_ref.json()["code"] == "refund_exceeds_payment"

    # 9. Reversal after partial refund rejected 422
    rev_after_ref = admin.post(
        f"/api/payments/{pay1['id']}/reverse",
        json={"reversal_reason": "Attempt reverse after partial refund"},
    )
    assert rev_after_ref.status_code == 422, rev_after_ref.text
    assert rev_after_ref.json()["code"] == "payment_already_refunded"

    # 10. Input validation & edge guards on POST /payments/{id}/refunds
    short_reason = admin.post(
        f"/api/payments/{pay1['id']}/refunds",
        json={"amount_paise": 1000, "refund_method": "CASH", "reason": "  abcd  "},
    )
    assert short_reason.status_code == 422

    bad_method = admin.post(
        f"/api/payments/{pay1['id']}/refunds",
        json={"amount_paise": 1000, "refund_method": "CHEQUE", "reason": "Valid reason here"},
    )
    assert bad_method.status_code == 422

    not_found = admin.post(
        "/api/payments/999999999/refunds",
        json={"amount_paise": 1000, "refund_method": "CASH", "reason": "Valid reason here"},
    )
    assert not_found.status_code == 404
    assert not_found.json()["code"] == "payment_not_found"

    # Verify AuditAction.PAYMENT_REFUNDED recorded for both refunds
    audit_rows = db_session.scalars(
        select(AuditLog).where(AuditLog.action == AuditAction.PAYMENT_REFUNDED.value)
    ).all()
    audited_ids = {row.entity_id for row in audit_rows}
    assert str(ref1["id"]) in audited_ids
    assert str(ref2["id"]) in audited_ids

    # 11. Inspect GET /patients/{id}/ledger (chronological asc)
    ledger_asc_res = admin.get(f"/api/patients/{patient.id}/ledger?order=asc")
    assert ledger_asc_res.status_code == 200, ledger_asc_res.text
    ledger = ledger_asc_res.json()

    # Totals: billed = 40,000 + 20,000 = 60,000; gross paid = 60,000; refunded = 25,000;
    # net paid = 35,000; outstanding = 25,000
    assert ledger["patient_id"] == patient.id
    assert ledger["patient_urn"] == patient.urn
    assert ledger["total_billed_paise"] == 60000
    assert ledger["total_paid_paise"] == 35000
    assert ledger["total_refunded_paise"] == 25000
    assert ledger["outstanding_paise"] == 25000
    assert ledger["ledger_balance_paise"] == 25000
    assert ledger["total_entries"] == 7

    expected_sequence = [
        ("CHARGE", "DEBIT", 50000, 50000, 50000),
        ("CHARGE", "DEBIT", 20000, 20000, 70000),
        ("CHARGE_ADJUSTMENT", "CREDIT", 10000, -10000, 60000),
        ("PAYMENT", "CREDIT", 35000, -35000, 25000),
        ("REFUND", "DEBIT", 10000, 10000, 35000),
        ("PAYMENT", "CREDIT", 25000, -25000, 10000),
        ("REFUND", "DEBIT", 15000, 15000, 25000),
    ]
    actual_sequence = [
        (
            e["entry_type"],
            e["direction"],
            e["amount_paise"],
            e["signed_amount_paise"],
            e["running_balance_paise"],
        )
        for e in ledger["entries"]
    ]
    assert actual_sequence == expected_sequence

    # Verify pagination preserves exact chronological running balance on page 2
    page2_res = reception.get(f"/api/patients/{patient.id}/ledger?order=asc&limit=2&offset=3")
    assert page2_res.status_code == 200, page2_res.text
    page2 = page2_res.json()
    assert page2["total_entries"] == 7
    assert page2["limit"] == 2
    assert page2["offset"] == 3
    assert [
        (e["entry_type"], e["running_balance_paise"]) for e in page2["entries"]
    ] == [
        ("PAYMENT", 25000),
        ("REFUND", 35000),
    ]

    # Verify payments[] carries refunded_paise and remaining_refundable_paise
    payments_by_id = {p["id"]: p for p in ledger["payments"]}
    assert payments_by_id[pay1["id"]]["refunded_paise"] == 25000
    assert payments_by_id[pay1["id"]]["remaining_refundable_paise"] == 10000
    assert payments_by_id[pay2["id"]]["refunded_paise"] == 0
    assert payments_by_id[pay2["id"]]["remaining_refundable_paise"] == 25000

    # Verify visits[] link summary
    assert len(ledger["visits"]) == 1
    v_link = ledger["visits"][0]
    assert v_link["visit_id"] == visit_id
    assert v_link["bill_total_paise"] == 60000
    assert v_link["paid_paise"] == 35000
    assert v_link["refunded_paise"] == 25000
    assert v_link["due_paise"] == 25000

    # Verify GET /patients/{id}/refunds
    refunds_res = reception.get(f"/api/patients/{patient.id}/refunds")
    assert refunds_res.status_code == 200, refunds_res.text
    refunds_list = refunds_res.json()
    assert len(refunds_list) == 2
    assert {r["id"] for r in refunds_list} == {ref1["id"], ref2["id"]}

    # Verify refunding a reversed payment is rejected 422 payment_reversed
    rev_pay2 = admin.post(
        f"/api/payments/{pay2['id']}/reverse",
        json={"reversal_reason": "Wrong card terminal posted"},
    )
    assert rev_pay2.status_code == 200, rev_pay2.text
    ref_reversed = admin.post(
        f"/api/payments/{pay2['id']}/refunds",
        json={"amount_paise": 5000, "refund_method": "CARD", "reason": "Try refunding reversed"},
    )
    assert ref_reversed.status_code == 422, ref_reversed.text
    assert ref_reversed.json()["code"] == "payment_reversed"

    # 12. Integrity audit Check #1 (package_payments) and Check #7 (ledger_reconciliation)
    report = integrity_service.run_integrity_audit(db_session, test_settings)
    checks_by_code = {c.code: c for c in report.checks}
    assert checks_by_code["package_payments"].passed, (
        checks_by_code["package_payments"].discrepancies
    )
    assert checks_by_code["package_payments"].discrepancies == []
    assert checks_by_code["ledger_reconciliation"].passed, (
        checks_by_code["ledger_reconciliation"].discrepancies
    )
    assert checks_by_code["ledger_reconciliation"].discrepancies == []


def test_package_plan_and_visit_bill_reconciliation_with_refunds(
    clock: dict[str, Any],
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    """Combined visit bill + active/cancelled treatment package with payments & refunds
    reconciles to 0 discrepancies on both Check #1 and Check #7.
    """
    admin = login_client(admin_user)
    reception = login_client(reception_user)
    doctor = login_client(doctor_a_user)

    patient = _create_patient(db_session, "PK01")

    # 1. Visit consultation: 30,000 paise, paid 30,000, refunded 5,000 -> visit due 5,000
    walked = _check_in_and_complete(reception, db_session, patient, doctor_a_user, fee_paise=30000)
    visit_pay = reception.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": walked["visit_id"],
            "amount_paise": 30000,
            "payment_method": "CASH",
        },
    )
    assert visit_pay.status_code == 201, visit_pay.text
    visit_ref = admin.post(
        f"/api/payments/{visit_pay.json()['id']}/refunds",
        json={
            "amount_paise": 5000,
            "refund_method": "CASH",
            "reason": "Visit goodwill partial refund",
        },
    )
    assert visit_ref.status_code == 201, visit_ref.text

    # 2. Active Treatment Package: 100,000 paise -> pay 60,000 -> refund 20,000 -> pay 40,000
    #    (net paid 80,000, remaining package due 20,000)
    plan1_res = doctor.post(
        "/api/treatment-plans",
        json={
            "patient_id": patient.id,
            "plan_name": "Physio 10-Session Pack",
            "condition_diagnosis": "Cervical Spondylosis",
            "total_sessions": 10,
            "agreed_price_paise": 100000,
        },
    )
    assert plan1_res.status_code == 201, plan1_res.text
    plan1_id = plan1_res.json()["id"]

    pkg_pay1 = reception.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "treatment_plan_id": plan1_id,
            "amount_paise": 60000,
            "payment_method": "UPI",
        },
    )
    assert pkg_pay1.status_code == 201, pkg_pay1.text

    pkg_ref1 = admin.post(
        f"/api/payments/{pkg_pay1.json()['id']}/refunds",
        json={
            "amount_paise": 20000,
            "refund_method": "UPI",
            "reason": "Package instalment adjustment refund",
        },
    )
    assert pkg_ref1.status_code == 201, pkg_ref1.text

    # Refund freed 20,000 of package payment cap, so paying 40,000 succeeds (60k - 20k + 40k = 80k)
    pkg_pay2 = reception.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "treatment_plan_id": plan1_id,
            "amount_paise": 40000,
            "payment_method": "CARD",
        },
    )
    assert pkg_pay2.status_code == 201, pkg_pay2.text

    # 3. Cancelled Treatment Package: 80,000 -> pay 50,000 -> cancel -> refund 30,000
    #    (cancelled package retains 20,000 net paid, owes 0)
    plan2_res = doctor.post(
        "/api/treatment-plans",
        json={
            "patient_id": patient.id,
            "plan_name": "Cancelled Rehab Pack",
            "condition_diagnosis": "Knee pain",
            "total_sessions": 8,
            "agreed_price_paise": 80000,
        },
    )
    assert plan2_res.status_code == 201, plan2_res.text
    plan2 = plan2_res.json()

    pkg2_pay = reception.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "treatment_plan_id": plan2["id"],
            "amount_paise": 50000,
            "payment_method": "CASH",
        },
    )
    assert pkg2_pay.status_code == 201, pkg2_pay.text

    cancel_res = doctor.patch(
        f"/api/treatment-plans/{plan2['id']}",
        json={
            "status": "CANCELLED",
            "cancellation_reason": "Patient relocating out of city",
            "version_id": plan2["version_id"],
        },
    )
    assert cancel_res.status_code == 200, cancel_res.text

    pkg2_ref = admin.post(
        f"/api/payments/{pkg2_pay.json()['id']}/refunds",
        json={
            "amount_paise": 30000,
            "refund_method": "CASH",
            "reason": "Pro-rata refund for cancelled package",
        },
    )
    assert pkg2_ref.status_code == 201, pkg2_ref.text

    # Verify ledger KPIs & balance parity
    ledger_res = admin.get(f"/api/patients/{patient.id}/ledger")
    assert ledger_res.status_code == 200, ledger_res.text
    ledger = ledger_res.json()
    # Active billed: 30,000 (visit) + 100,000 (active plan1) = 130,000
    # Gross paid: 30k + 60k + 40k + 50k = 180,000; refunded: 5k + 20k + 30k = 55,000
    # Net paid: 125,000; outstanding: 5,000 (visit) + 20,000 (plan1) = 25,000
    assert ledger["total_billed_paise"] == 130000
    assert ledger["total_paid_paise"] == 125000
    assert ledger["total_refunded_paise"] == 55000
    assert ledger["outstanding_paise"] == 25000
    assert ledger["ledger_balance_paise"] == 25000

    # Verify integrity Check #1 and Check #7 report 0 discrepancies
    report = integrity_service.run_integrity_audit(db_session, test_settings)
    checks_by_code = {c.code: c for c in report.checks}
    assert checks_by_code["package_payments"].passed, (
        checks_by_code["package_payments"].discrepancies
    )
    assert checks_by_code["package_payments"].discrepancies == []
    assert checks_by_code["ledger_reconciliation"].passed, (
        checks_by_code["ledger_reconciliation"].discrepancies
    )
    assert checks_by_code["ledger_reconciliation"].discrepancies == []


def test_direct_sql_tamper_triggers_on_owner_engine(owner_engine: Engine) -> None:
    """Direct SQL tamper trigger tests on owner_engine (rolled-back tx):
    - UPDATE/DELETE on ledger_entries & refunds blocked.
    - UPDATE payments SET visit_id = ... blocked; print snapshot columns remain protected.
    - INSERT over-limit refund & refund on reversed payment blocked by trg_enforce_refund_limit.
    """
    uid_tag = uuid.uuid4().hex[:8]
    with owner_engine.connect() as conn:
        outer_tx = conn.begin()
        try:
            user_id = conn.execute(
                text(
                    """
                    INSERT INTO users (username, full_name, role, password_hash, is_active)
                    VALUES (:u, 'Trigger Admin', 'ADMIN', 'dummy_hash', TRUE)
                    RETURNING id
                    """
                ),
                {"u": f"trg_adm_{uid_tag}"},
            ).scalar_one()

            patient_id = conn.execute(
                text(
                    """
                    INSERT INTO patients (
                        urn, full_name, guardian_name, gender, age_years, mobile, address
                    )
                    VALUES (:urn, 'Trigger Patient', 'Guardian', 'M', 35, '9876543210', 'Ara')
                    RETURNING id
                    """
                ),
                {"urn": f"KH-2026-TR{uid_tag[:4]}"},
            ).scalar_one()

            visit1_id = conn.execute(
                text(
                    """
                    INSERT INTO visits (
                        patient_id, visit_date, status, opened_by_user_id, version_id
                    )
                    VALUES (:pid, '2026-11-02', 'OPEN', :uid, 1)
                    RETURNING id
                    """
                ),
                {"pid": patient_id, "uid": user_id},
            ).scalar_one()

            visit2_id = conn.execute(
                text(
                    """
                    INSERT INTO visits (
                        patient_id, visit_date, status, opened_by_user_id,
                        closed_by_user_id, closed_at, version_id
                    )
                    VALUES (:pid, '2026-11-03', 'CLOSED', :uid, :uid, now(), 1)
                    RETURNING id
                    """
                ),
                {"pid": patient_id, "uid": user_id},
            ).scalar_one()

            pay_id = conn.execute(
                text(
                    """
                    INSERT INTO payments (
                        receipt_number, patient_id, patient_name, patient_urn,
                        visit_id, amount_paise, payment_method, is_reversed, created_by_user_id
                    )
                    VALUES (
                        :rcp, :pid, 'Trigger Patient', :urn,
                        :vid, 50000, 'CASH', FALSE, :uid
                    )
                    RETURNING id
                    """
                ),
                {
                    "rcp": f"RCP-TRG-{uid_tag}",
                    "pid": patient_id,
                    "urn": f"KH-2026-TR{uid_tag[:4]}",
                    "vid": visit1_id,
                    "uid": user_id,
                },
            ).scalar_one()

            # Second unrefunded payment used to test reversal-time tamper checks
            pay2_id = conn.execute(
                text(
                    """
                    INSERT INTO payments (
                        receipt_number, patient_id, patient_name, patient_urn,
                        visit_id, amount_paise, payment_method, is_reversed, created_by_user_id
                    )
                    VALUES (
                        :rcp, :pid, 'Original Snapshot Name', :urn,
                        :vid, 30000, 'CASH', FALSE, :uid
                    )
                    RETURNING id
                    """
                ),
                {
                    "rcp": f"RCP-TRG2-{uid_tag}",
                    "pid": patient_id,
                    "urn": f"KH-2026-TR{uid_tag[:4]}",
                    "vid": visit1_id,
                    "uid": user_id,
                },
            ).scalar_one()

            refund_id = conn.execute(
                text(
                    """
                    INSERT INTO refunds (
                        refund_number, payment_id, patient_id, visit_id,
                        amount_paise, refund_method, reason, refunded_by_user_id
                    )
                    VALUES (
                        :rfn, :pay_id, :pid, :vid,
                        20000, 'CASH', 'Trigger test initial refund', :uid
                    )
                    RETURNING id
                    """
                ),
                {
                    "rfn": f"RFN-TRG-{uid_tag}",
                    "pay_id": pay_id,
                    "pid": patient_id,
                    "vid": visit1_id,
                    "uid": user_id,
                },
            ).scalar_one()

            ledger_id = conn.execute(
                text(
                    """
                    INSERT INTO ledger_entries (
                        patient_id, visit_id, entry_type, direction,
                        amount_paise, signed_amount_paise,
                        reference_type, reference_id, description,
                        actor_user_id, occurred_at
                    )
                    VALUES (
                        :pid, :vid, 'REFUND', 'DEBIT',
                        20000, 20000,
                        'REFUND', :ref_id, 'Trigger test ledger row',
                        :uid, now()
                    )
                    RETURNING id
                    """
                ),
                {
                    "pid": patient_id,
                    "vid": visit1_id,
                    "ref_id": refund_id,
                    "uid": user_id,
                },
            ).scalar_one()

            # 1. UPDATE ledger_entries blocked by trg_prevent_ledger_tampering
            with pytest.raises(DBAPIError, match="permanently immutable"):
                with conn.begin_nested():
                    conn.execute(
                        text("UPDATE ledger_entries SET description = 'tampered' WHERE id = :id"),
                        {"id": ledger_id},
                    )

            # 2. DELETE ledger_entries blocked by trg_prevent_ledger_tampering
            with pytest.raises(DBAPIError, match="permanently immutable"):
                with conn.begin_nested():
                    conn.execute(
                        text("DELETE FROM ledger_entries WHERE id = :id"),
                        {"id": ledger_id},
                    )

            # 3. UPDATE refunds blocked by trg_prevent_refund_tampering
            with pytest.raises(DBAPIError, match="permanently immutable"):
                with conn.begin_nested():
                    conn.execute(
                        text("UPDATE refunds SET reason = 'tampered reason' WHERE id = :id"),
                        {"id": refund_id},
                    )

            # 4. DELETE refunds blocked by trg_prevent_refund_tampering
            with pytest.raises(DBAPIError, match="permanently immutable"):
                with conn.begin_nested():
                    conn.execute(
                        text("DELETE FROM refunds WHERE id = :id"),
                        {"id": refund_id},
                    )

            # 5. Direct UPDATE payments SET visit_id = ... blocked
            with pytest.raises(DBAPIError, match="cannot be modified"):
                with conn.begin_nested():
                    conn.execute(
                        text("UPDATE payments SET visit_id = :v2 WHERE id = :id"),
                        {"v2": visit2_id, "id": pay2_id},
                    )

            # 6. Changing visit_id during reversal blocked by fn_prevent_payment_tampering
            with pytest.raises(DBAPIError, match="Only reversal metadata"):
                with conn.begin_nested():
                    conn.execute(
                        text(
                            """
                            UPDATE payments
                            SET is_reversed = TRUE,
                                visit_id = :v2,
                                reversal_reason = 'Tamper visit during reversal',
                                reversed_by_user_id = :uid,
                                reversed_at = now()
                            WHERE id = :id
                            """
                        ),
                        {"v2": visit2_id, "uid": user_id, "id": pay2_id},
                    )

            # 7. Changing print snapshot column (patient_name) during reversal remains blocked
            with pytest.raises(DBAPIError, match="Only reversal metadata"):
                with conn.begin_nested():
                    conn.execute(
                        text(
                            """
                            UPDATE payments
                            SET is_reversed = TRUE,
                                patient_name = 'Tampered Snapshot Name',
                                reversal_reason = 'Tamper snapshot during reversal',
                                reversed_by_user_id = :uid,
                                reversed_at = now()
                            WHERE id = :id
                            """
                        ),
                        {"uid": user_id, "id": pay2_id},
                    )

            # 8. INSERT over-limit refund blocked by trg_enforce_refund_limit (20k + 30,001 > 50k)
            with pytest.raises(DBAPIError, match="exceeds remaining refundable"):
                with conn.begin_nested():
                    conn.execute(
                        text(
                            """
                            INSERT INTO refunds (
                                refund_number, payment_id, patient_id, visit_id,
                                amount_paise, refund_method, reason, refunded_by_user_id
                            )
                            VALUES (
                                :rfn, :pay_id, :pid, :vid,
                                30001, 'CASH', 'Over-limit SQL refund attempt', :uid
                            )
                            """
                        ),
                        {
                            "rfn": f"RFN-OVR-{uid_tag}",
                            "pay_id": pay_id,
                            "pid": patient_id,
                            "vid": visit1_id,
                            "uid": user_id,
                        },
                    )

            # 9. Valid reversal on pay2 succeeds, then INSERT refund on reversed pay2 is blocked
            conn.execute(
                text(
                    """
                    UPDATE payments
                    SET is_reversed = TRUE,
                        reversal_reason = 'Valid reversal before refund test',
                        reversed_by_user_id = :uid,
                        reversed_at = now()
                    WHERE id = :id
                    """
                ),
                {"uid": user_id, "id": pay2_id},
            )
            with pytest.raises(DBAPIError, match="Cannot refund a reversed payment"):
                with conn.begin_nested():
                    conn.execute(
                        text(
                            """
                            INSERT INTO refunds (
                                refund_number, payment_id, patient_id, visit_id,
                                amount_paise, refund_method, reason, refunded_by_user_id
                            )
                            VALUES (
                                :rfn, :pay_id, :pid, :vid,
                                1000, 'CASH', 'Refund on reversed payment', :uid
                            )
                            """
                        ),
                        {
                            "rfn": f"RFN-REV-{uid_tag}",
                            "pay_id": pay2_id,
                            "pid": patient_id,
                            "vid": visit1_id,
                            "uid": user_id,
                        },
                    )
        finally:
            outer_tx.rollback()


def test_kalyan_app_least_privilege_grants_on_ledger_and_refunds(
    db_session: Session,
    test_settings: Settings,
) -> None:
    """kalyan_app runtime role can SELECT/INSERT ledger_entries & refunds,
    and receives PostgreSQL permission denied on UPDATE/DELETE.
    """
    uid_tag = uuid.uuid4().hex[:8]
    user = make_user(db_session, test_settings, "ADMIN", f"grant_adm_{uid_tag}")
    patient = _create_patient(db_session, f"GR{uid_tag[:4]}")

    pay_id = db_session.execute(
        text(
            """
            INSERT INTO payments (
                receipt_number, patient_id, patient_name, patient_urn,
                amount_paise, payment_method, is_reversed, created_by_user_id
            )
            VALUES (:rcp, :pid, :pname, :urn, 40000, 'CASH', FALSE, :uid)
            RETURNING id
            """
        ),
        {
            "rcp": f"RCP-GR-{uid_tag}",
            "pid": patient.id,
            "pname": patient.full_name,
            "urn": patient.urn,
            "uid": user.id,
        },
    ).scalar_one()

    # INSERT & SELECT succeed for kalyan_app on refunds
    refund_id = db_session.execute(
        text(
            """
            INSERT INTO refunds (
                refund_number, payment_id, patient_id,
                amount_paise, refund_method, reason, refunded_by_user_id
            )
            VALUES (:rfn, :pay_id, :pid, 10000, 'CASH', 'Grant verification refund', :uid)
            RETURNING id
            """
        ),
        {
            "rfn": f"RFN-GR-{uid_tag}",
            "pay_id": pay_id,
            "pid": patient.id,
            "uid": user.id,
        },
    ).scalar_one()
    assert (
        db_session.execute(
            text("SELECT amount_paise FROM refunds WHERE id = :id"), {"id": refund_id}
        ).scalar_one()
        == 10000
    )

    # INSERT & SELECT succeed for kalyan_app on ledger_entries
    ledger_id = db_session.execute(
        text(
            """
            INSERT INTO ledger_entries (
                patient_id, entry_type, direction, amount_paise, signed_amount_paise,
                reference_type, reference_id, description, actor_user_id, occurred_at
            )
            VALUES (
                :pid, 'REFUND', 'DEBIT', 10000, 10000,
                'REFUND', :ref_id, 'Grant verification ledger row', :uid, now()
            )
            RETURNING id
            """
        ),
        {"pid": patient.id, "ref_id": refund_id, "uid": user.id},
    ).scalar_one()
    assert (
        db_session.execute(
            text("SELECT signed_amount_paise FROM ledger_entries WHERE id = :id"),
            {"id": ledger_id},
        ).scalar_one()
        == 10000
    )

    # UPDATE & DELETE must be denied by PostgreSQL table grants for kalyan_app
    with pytest.raises(ProgrammingError, match="permission denied"):
        with db_session.begin_nested():
            db_session.execute(
                text("UPDATE ledger_entries SET description = 'nope' WHERE id = :id"),
                {"id": ledger_id},
            )

    with pytest.raises(ProgrammingError, match="permission denied"):
        with db_session.begin_nested():
            db_session.execute(
                text("DELETE FROM ledger_entries WHERE id = :id"),
                {"id": ledger_id},
            )

    with pytest.raises(ProgrammingError, match="permission denied"):
        with db_session.begin_nested():
            db_session.execute(
                text("UPDATE refunds SET reason = 'nope reason' WHERE id = :id"),
                {"id": refund_id},
            )

    with pytest.raises(ProgrammingError, match="permission denied"):
        with db_session.begin_nested():
            db_session.execute(
                text("DELETE FROM refunds WHERE id = :id"),
                {"id": refund_id},
            )


def test_ledger_and_refunds_rbac_boundaries(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Verify RBAC boundaries:
    - RECEPTION & DOCTOR get 403 on POST /payments/{id}/refunds.
    - DOCTOR gets 403 on GET /patients/{id}/ledger and GET /patients/{id}/refunds.
    - ADMIN & RECEPTION get 200 on GET /patients/{id}/ledger and GET /patients/{id}/refunds.
    """
    admin = login_client(admin_user)
    reception = login_client(reception_user)
    doctor = login_client(doctor_a_user)

    patient = _create_patient(db_session, "RB01")
    pay_res = reception.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "amount_paise": 25000,
            "payment_method": "CASH",
        },
    )
    assert pay_res.status_code == 201, pay_res.text
    payment_id = pay_res.json()["id"]

    refund_payload = {
        "amount_paise": 5000,
        "refund_method": "CASH",
        "reason": "RBAC refund check",
    }

    # POST /payments/{id}/refunds: RECEPTION -> 403, DOCTOR -> 403, ADMIN -> 201
    rec_refund = reception.post(f"/api/payments/{payment_id}/refunds", json=refund_payload)
    doc_refund = doctor.post(f"/api/payments/{payment_id}/refunds", json=refund_payload)
    adm_refund = admin.post(f"/api/payments/{payment_id}/refunds", json=refund_payload)
    assert rec_refund.status_code == 403
    assert doc_refund.status_code == 403
    assert adm_refund.status_code == 201

    # GET /patients/{id}/ledger: DOCTOR -> 403, ADMIN -> 200, RECEPTION -> 200
    assert doctor.get(f"/api/patients/{patient.id}/ledger").status_code == 403
    assert admin.get(f"/api/patients/{patient.id}/ledger").status_code == 200
    assert reception.get(f"/api/patients/{patient.id}/ledger").status_code == 200

    # GET /patients/{id}/refunds: DOCTOR -> 403, ADMIN -> 200, RECEPTION -> 200
    assert doctor.get(f"/api/patients/{patient.id}/refunds").status_code == 403
    assert admin.get(f"/api/patients/{patient.id}/refunds").status_code == 200
    assert reception.get(f"/api/patients/{patient.id}/refunds").status_code == 200


def test_merged_alias_consolidation_on_payments_ledger_and_refunds(
    clock: dict[str, Any],
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """After merging secondary patient into master patient:
    - GET /patients/{master.id}/payments includes both master and secondary payments.
    - GET /patients/{master.id}/ledger consolidates KPIs, entries, payments, refunds, and visits.
    - GET /patients/{master.id}/refunds includes both master and secondary refunds.
    - Reads on the merged secondary patient ID also succeed (200).
    """
    admin = login_client(admin_user)
    reception = login_client(reception_user)

    master = _create_patient(db_session, "MG01")
    secondary = _create_patient(db_session, "MG02")

    # Master visit: 50,000 fee -> pay 40,000 -> refund 10,000 (net paid 30,000, due 20,000)
    m_walked = _check_in_and_complete(reception, db_session, master, doctor_a_user, fee_paise=50000)
    clock["t"] = clock["t"] + timedelta(minutes=2)
    m_pay = reception.post(
        "/api/payments",
        json={
            "patient_id": master.id,
            "visit_id": m_walked["visit_id"],
            "amount_paise": 40000,
            "payment_method": "CASH",
        },
    )
    assert m_pay.status_code == 201, m_pay.text
    clock["t"] = clock["t"] + timedelta(minutes=2)
    m_ref = admin.post(
        f"/api/payments/{m_pay.json()['id']}/refunds",
        json={"amount_paise": 10000, "refund_method": "CASH", "reason": "Master partial refund"},
    )
    assert m_ref.status_code == 201, m_ref.text

    # Secondary visit: 30,000 fee -> pay 25,000 -> refund 5,000 (net paid 20,000, due 10,000)
    clock["t"] = clock["t"] + timedelta(minutes=2)
    s_walked = _check_in_and_complete(
        reception, db_session, secondary, doctor_a_user, fee_paise=30000
    )
    clock["t"] = clock["t"] + timedelta(minutes=2)
    s_pay = reception.post(
        "/api/payments",
        json={
            "patient_id": secondary.id,
            "visit_id": s_walked["visit_id"],
            "amount_paise": 25000,
            "payment_method": "UPI",
        },
    )
    assert s_pay.status_code == 201, s_pay.text
    clock["t"] = clock["t"] + timedelta(minutes=2)
    s_ref = admin.post(
        f"/api/payments/{s_pay.json()['id']}/refunds",
        json={"amount_paise": 5000, "refund_method": "UPI", "reason": "Secondary partial refund"},
    )
    assert s_ref.status_code == 201, s_ref.text

    # Close both open visits before merging (merge forbids active open visits)
    for vid in (m_walked["visit_id"], s_walked["visit_id"]):
        close_res = reception.post(
            f"/api/visits/{vid}/close",
            json={"version_id": 1, "reason": "Closing visit with remaining due before merge"},
        )
        assert close_res.status_code == 200, close_res.text

    # Merge secondary into master
    merge_res = admin.post(
        "/api/admin/patients/merge",
        json={
            "master_patient_id": master.id,
            "secondary_patient_id": secondary.id,
            "reason": "Duplicate registration merged for ledger verification",
        },
    )
    assert merge_res.status_code == 200, merge_res.text

    # 1. GET /patients/{master.id}/payments includes both master and secondary payments
    payments_res = reception.get(f"/api/patients/{master.id}/payments")
    assert payments_res.status_code == 200, payments_res.text
    payment_ids = {p["id"] for p in payments_res.json()}
    assert payment_ids == {m_pay.json()["id"], s_pay.json()["id"]}

    # 2. GET /patients/{master.id}/ledger consolidates both patients completely
    ledger_res = admin.get(f"/api/patients/{master.id}/ledger?order=asc")
    assert ledger_res.status_code == 200, ledger_res.text
    ledger = ledger_res.json()
    assert ledger["total_billed_paise"] == 80000
    assert ledger["total_paid_paise"] == 50000
    assert ledger["total_refunded_paise"] == 15000
    assert ledger["outstanding_paise"] == 30000
    assert ledger["ledger_balance_paise"] == 30000
    assert ledger["total_entries"] == 6
    assert ledger["entries"][-1]["running_balance_paise"] == 30000
    assert {p["id"] for p in ledger["payments"]} == {m_pay.json()["id"], s_pay.json()["id"]}
    assert {r["id"] for r in ledger["refunds"]} == {m_ref.json()["id"], s_ref.json()["id"]}
    assert {v["visit_id"] for v in ledger["visits"]} == {
        m_walked["visit_id"],
        s_walked["visit_id"],
    }

    # 3. GET /patients/{master.id}/refunds includes both refunds
    refunds_res = reception.get(f"/api/patients/{master.id}/refunds")
    assert refunds_res.status_code == 200, refunds_res.text
    assert {r["id"] for r in refunds_res.json()} == {m_ref.json()["id"], s_ref.json()["id"]}

    # 4. Archived/merged patient reads stay accessible (200)
    assert reception.get(f"/api/patients/{secondary.id}/payments").status_code == 200
    assert reception.get(f"/api/patients/{secondary.id}/ledger").status_code == 200
    assert reception.get(f"/api/patients/{secondary.id}/refunds").status_code == 200
