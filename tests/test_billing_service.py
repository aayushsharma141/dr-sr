"""
Unit tests for BillingService and PaymentRepository.
Kalyan Hospital Management System.
"""

import pytest
from app.db.connection import init_db
from app.services.patient_service import PatientService
from app.services.treatment_service import TreatmentService
from app.services.billing_service import BillingService


@pytest.fixture
def test_db(tmp_path):
    """Provides an isolated initialized SQLite database for tests."""
    db_file = tmp_path / "test_kalyan_billing.db"
    init_db(str(db_file))
    return str(db_file)


@pytest.fixture
def sample_case(test_db):
    """Creates a patient and a treatment case with ₹3,000 agreed fee."""
    patient_service = PatientService(test_db)
    patient = patient_service.register_patient({
        "patient_name": "Sunita Devi",
        "age": 38,
        "sex": "Female",
        "mobile_no": "9123456789",
        "patient_condition": "Post-op Knee Rehabilitation",
    })

    treatment_service = TreatmentService(test_db)
    return treatment_service.open_treatment_case(
        patient_id=patient["id"],
        title="Knee Post-Op Rehabilitation",
        no_of_sessions=10,
        total_amount_rupees=3000.00,
    )


def test_currency_conversion_precision():
    """Verifies that rupees_to_paise and paise_to_rupees handle floating and string values without loss."""
    assert BillingService.rupees_to_paise(150.50) == 15050
    assert BillingService.rupees_to_paise("1200.75") == 120075
    assert BillingService.rupees_to_paise(0.10) == 10
    assert BillingService.rupees_to_paise("0") == 0
    assert BillingService.rupees_to_paise(None) == 0

    assert BillingService.paise_to_rupees(15050) == 150.50
    assert BillingService.paise_to_rupees(10) == 0.10


def test_format_inr():
    """Verifies Indian Rupee currency string formatting."""
    assert BillingService.format_inr(0) == "₹ 0.00"
    assert BillingService.format_inr(50000) == "₹ 500.00"
    assert BillingService.format_inr(150000) == "₹ 1,500.00"
    assert BillingService.format_inr(12500000) == "₹ 1,25,000.00"


def test_partial_installment_payments(test_db, sample_case):
    """Verifies recording installments correctly updates total paid and decreases balance."""
    billing_service = BillingService(test_db)

    # Initial balance should equal total fee (₹3,000 = 300,000 paise)
    summary0 = billing_service.get_financial_summary(sample_case["id"])
    assert summary0["total_fee_paise"] == 300000
    assert summary0["total_paid_paise"] == 0
    assert summary0["balance_paise"] == 300000
    assert not summary0["is_cleared"]

    # 1st Installment: ₹1,000 via Cash
    r1 = billing_service.record_installment(
        case_id=sample_case["id"],
        amount_rupees=1000.00,
        payment_mode="CASH",
        reference_note="Advance at intake",
    )
    assert r1["amount_paid_paise"] == 100000
    assert r1["new_total_paid_paise"] == 100000
    assert r1["balance_paise"] == 200000
    assert not r1["is_cleared"]

    # 2nd Installment: ₹1,500 via UPI
    r2 = billing_service.record_installment(
        case_id=sample_case["id"],
        amount_rupees="1500.00",
        payment_mode="UPI",
        reference_note="UPI Ref 987654321",
    )
    assert r2["amount_paid_paise"] == 150000
    assert r2["new_total_paid_paise"] == 250000
    assert r2["balance_paise"] == 50000
    assert not r2["is_cleared"]

    # Verify summary after 2 installments
    summary2 = billing_service.get_financial_summary(sample_case["id"])
    assert summary2["total_paid_paise"] == 250000
    assert summary2["balance_paise"] == 50000
    assert summary2["payment_count"] == 2
    assert summary2["payments"][0]["payment_mode"] == "CASH"
    assert summary2["payments"][1]["payment_mode"] == "UPI"


def test_negative_and_zero_payment_rejected(test_db, sample_case):
    """Verifies that zero or negative payments are rejected."""
    billing_service = BillingService(test_db)

    with pytest.raises(ValueError, match="greater than zero"):
        billing_service.record_installment(case_id=sample_case["id"], amount_rupees=0)

    with pytest.raises(ValueError, match="greater than zero"):
        billing_service.record_installment(case_id=sample_case["id"], amount_rupees=-500)


def test_invalid_payment_mode_rejected(test_db, sample_case):
    """Verifies that unsupported payment modes raise ValueError."""
    billing_service = BillingService(test_db)

    with pytest.raises(ValueError, match="Invalid payment mode"):
        billing_service.record_installment(
            case_id=sample_case["id"],
            amount_rupees=500,
            payment_mode="BITCOIN",
        )


def test_full_settlement_cleared_status(test_db, sample_case):
    """Verifies full payment clears balance and sets is_cleared to True."""
    billing_service = BillingService(test_db)

    r = billing_service.record_installment(
        case_id=sample_case["id"],
        amount_rupees=3000.00,
        payment_mode="CASH",
        reference_note="Full payment upfront",
    )
    assert r["balance_paise"] == 0
    assert r["is_cleared"] is True
    assert r["is_overpayment"] is False


def test_overpayment_flagging(test_db, sample_case):
    """Verifies that paying more than agreed fee flags overpayment without negative balance."""
    billing_service = BillingService(test_db)

    r = billing_service.record_installment(
        case_id=sample_case["id"],
        amount_rupees=3500.00,  # ₹500 more than ₹3,000
        payment_mode="CASH",
    )
    assert r["is_overpayment"] is True
    assert r["overpayment_paise"] == 50000
    assert r["balance_paise"] == 0
    assert r["is_cleared"] is True
