"""Unit tests for Billing & Payment database models, constraints, and triggers (Plan 15-01).

Guarantees:
- Check constraints reject negative/zero amount_paise (BIL-02).
- Check constraints reject invalid payment method.
- Check constraints enforce reversal integrity (reversal_reason >= 5 chars, user, timestamp).
- Trigger trg_prevent_payment_tampering prevents direct SQL DELETE on posted payments (BIL-05).
- Trigger trg_prevent_payment_tampering prevents direct SQL UPDATE on payment details (BIL-05).
- Trigger trg_enforce_package_payment_limits rejects payments exceeding package fee (BIL-02).
"""

from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from kalyan_api.models import (
    Doctor,
    Patient,
    Payment,
    PaymentMethod,
    TreatmentPlan,
    User,
)


def _create_patient(session: Session, suffix: str = "01") -> Patient:
    patient = Patient(
        urn=f"KH-2026-BIL{suffix}",
        full_name=f"Billing Test Patient {suffix}",
        guardian_name="Guardian Name",
        gender="F",
        age_years=35,
        mobile=f"98765999{suffix}",
        address="Ara, Bihar",
        district="Bhojpur",
        state="Bihar",
    )
    session.add(patient)
    session.flush()
    return patient


def _create_doctor_and_user(session: Session, suffix: str = "01") -> tuple[Doctor, User]:
    doc = Doctor(name_en=f"Dr. Billing {suffix}", default_fee_paise=30000)
    session.add(doc)
    session.flush()

    user = User(
        username=f"bill_staff_{suffix}",
        password_hash="argon2id$fakehash",
        full_name=f"Billing Staff {suffix}",
        role="RECEPTION",
        is_active=True,
    )
    session.add(user)
    session.flush()
    return doc, user


def test_payment_constraints(db_session: Session) -> None:
    """Verify check constraints on Payment model (positive amount, method, reversal)."""
    pat = _create_patient(db_session, "10")
    _doc, user = _create_doctor_and_user(db_session, "10")

    # 1. Invalid zero amount
    with pytest.raises(DBAPIError):
        with db_session.begin_nested():
            p_zero = Payment(
                receipt_number="RCP-2026-0001",
                patient_id=pat.id,
                amount_paise=0,
                payment_method=PaymentMethod.CASH,
                created_by_user_id=user.id,
            )
            db_session.add(p_zero)
            db_session.flush()

    # 2. Invalid negative amount
    with pytest.raises(DBAPIError):
        with db_session.begin_nested():
            p_neg = Payment(
                receipt_number="RCP-2026-0002",
                patient_id=pat.id,
                amount_paise=-5000,
                payment_method=PaymentMethod.CASH,
                created_by_user_id=user.id,
            )
            db_session.add(p_neg)
            db_session.flush()

    # 3. Invalid payment method
    with pytest.raises(DBAPIError):
        with db_session.begin_nested():
            p_bad_method = Payment(
                receipt_number="RCP-2026-0003",
                patient_id=pat.id,
                amount_paise=50000,
                payment_method="BITCOIN",
                created_by_user_id=user.id,
            )
            db_session.add(p_bad_method)
            db_session.flush()

    # 4. Invalid reversal: is_reversed=True but missing reversal_reason
    with pytest.raises(DBAPIError):
        with db_session.begin_nested():
            p_bad_rev = Payment(
                receipt_number="RCP-2026-0004",
                patient_id=pat.id,
                amount_paise=50000,
                payment_method=PaymentMethod.CASH,
                is_reversed=True,
                reversal_reason=None,
                reversed_by_user_id=user.id,
                reversed_at=datetime.now(UTC),
                created_by_user_id=user.id,
            )
            db_session.add(p_bad_rev)
            db_session.flush()

    # 5. Invalid reversal: reason too short (< 5 chars)
    with pytest.raises(DBAPIError):
        with db_session.begin_nested():
            p_short_rev = Payment(
                receipt_number="RCP-2026-0005",
                patient_id=pat.id,
                amount_paise=50000,
                payment_method=PaymentMethod.CASH,
                is_reversed=True,
                reversal_reason="Mist",  # only 4 chars
                reversed_by_user_id=user.id,
                reversed_at=datetime.now(UTC),
                created_by_user_id=user.id,
            )
            db_session.add(p_short_rev)
            db_session.flush()


def test_payment_tampering_trigger(db_session: Session) -> None:
    """Verify trigger blocks direct SQL DELETE and modification on payments (BIL-05)."""
    pat = _create_patient(db_session, "20")
    _doc, user = _create_doctor_and_user(db_session, "20")

    payment = Payment(
        receipt_number="RCP-2026-0020",
        patient_id=pat.id,
        amount_paise=100000,
        payment_method=PaymentMethod.UPI,
        created_by_user_id=user.id,
    )
    db_session.add(payment)
    db_session.flush()

    # Modifying amount must fail
    with pytest.raises(DBAPIError) as exc_amount:
        with db_session.begin_nested():
            db_session.execute(
                text("UPDATE payments SET amount_paise = 50000 WHERE id = :pid"),
                {"pid": payment.id},
            )
    assert "Posted payment details cannot be modified" in str(exc_amount.value)

    # Deleting payment must fail
    with pytest.raises(DBAPIError) as exc_del:
        with db_session.begin_nested():
            db_session.execute(
                text("DELETE FROM payments WHERE id = :pid"),
                {"pid": payment.id},
            )
    assert "Posted payments cannot be deleted" in str(exc_del.value)


def test_package_overpayment_limit_trigger(db_session: Session) -> None:
    """Verify trigger rejects payments exceeding treatment package agreed price (BIL-02)."""
    pat = _create_patient(db_session, "30")
    doc, user = _create_doctor_and_user(db_session, "30")

    plan = TreatmentPlan(
        patient_id=pat.id,
        doctor_id=doc.id,
        plan_name="Lumbar Rehab 10-Session",
        condition_diagnosis="Spasm",
        total_sessions=10,
        agreed_price_paise=300000,  # ₹3,000
    )
    db_session.add(plan)
    db_session.flush()

    # First instalment: ₹2,000 (200000 paise) -> succeeds
    p1 = Payment(
        receipt_number="RCP-2026-0031",
        patient_id=pat.id,
        treatment_plan_id=plan.id,
        amount_paise=200000,
        payment_method=PaymentMethod.CASH,
        created_by_user_id=user.id,
    )
    db_session.add(p1)
    db_session.flush()

    # Second instalment: ₹1,500 (150000 paise) -> Total would be ₹3,500 > ₹3,000 -> trigger fails!
    with pytest.raises(DBAPIError) as exc_over:
        with db_session.begin_nested():
            p2_over = Payment(
                receipt_number="RCP-2026-0032",
                patient_id=pat.id,
                treatment_plan_id=plan.id,
                amount_paise=150000,
                payment_method=PaymentMethod.UPI,
                created_by_user_id=user.id,
            )
            db_session.add(p2_over)
            db_session.flush()
    assert "Payment exceeds agreed treatment package price" in str(exc_over.value)

    # Exact final instalment: ₹1,000 (100000 paise) -> Total is ₹3,000 == agreed price -> succeeds!
    p2_exact = Payment(
        receipt_number="RCP-2026-0033",
        patient_id=pat.id,
        treatment_plan_id=plan.id,
        amount_paise=100000,
        payment_method=PaymentMethod.CARD,
        created_by_user_id=user.id,
    )
    db_session.add(p2_exact)
    db_session.flush()
    assert p2_exact.id is not None
