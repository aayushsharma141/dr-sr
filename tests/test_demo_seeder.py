"""
Automated unit tests for DemoSeeder and synthetic dataset reset.
Kalyan Hospital Management System.
"""

import time
import pytest
from app.db.connection import init_db, get_db_connection
from app.services.demo_seeder import DemoSeeder
from app.services.billing_service import BillingService


@pytest.fixture
def test_db(tmp_path):
    """Provides an isolated initialized SQLite database for demo tests."""
    db_file = tmp_path / "test_demo_seeder.db"
    init_db(str(db_file))
    return str(db_file)


def test_seed_demo_patients_counts(test_db):
    """Verifies that DemoSeeder creates exactly 5 patients with cases, sessions, and payments."""
    seeded = DemoSeeder.seed_demo_patients(test_db)
    assert len(seeded) == 5

    with get_db_connection(test_db) as conn:
        p_count = conn.execute("SELECT COUNT(*) FROM patients").fetchone()[0]
        c_count = conn.execute("SELECT COUNT(*) FROM treatment_cases").fetchone()[0]
        s_count = conn.execute("SELECT COUNT(*) FROM treatment_sessions").fetchone()[0]
        pay_count = conn.execute("SELECT COUNT(*) FROM payments").fetchone()[0]

    assert p_count == 5
    assert c_count == 5
    assert s_count >= 10
    assert pay_count >= 5


def test_reset_demo_benchmark(test_db):
    """Verifies that reset_to_demo_dataset executes well within the 1-second benchmark."""
    # Seed once
    DemoSeeder.seed_demo_patients(test_db)

    # Measure reset execution time
    result = DemoSeeder.reset_to_demo_dataset(test_db)

    assert result["success"] is True
    assert result["patients_count"] == 5
    assert result["elapsed_seconds"] < 1.0
    assert result["benchmark_passed"] is True


def test_demo_financial_balances(test_db):
    """Verifies financial balance accuracy for seeded patients."""
    DemoSeeder.seed_demo_patients(test_db)
    billing_service = BillingService(test_db)

    # Sunita Devi (Case #2) should be completely cleared (balance = 0)
    with get_db_connection(test_db) as conn:
        case2 = conn.execute(
            "SELECT tc.id FROM treatment_cases tc JOIN patients p ON tc.patient_id = p.id WHERE p.patient_name = 'Sunita Devi'"
        ).fetchone()

    assert case2 is not None
    summary = billing_service.get_financial_summary(case2["id"])
    assert summary["is_cleared"] is True
    assert summary["balance_paise"] == 0
    assert summary["total_fee_paise"] == 280000
    assert summary["total_paid_paise"] == 280000


def test_fictional_data_compliance(test_db):
    """Verifies that all seeded patient names and phone numbers are strictly fictional."""
    DemoSeeder.seed_demo_patients(test_db)

    with get_db_connection(test_db) as conn:
        patients = conn.execute("SELECT patient_name, mobile_no FROM patients").fetchall()

    for p in patients:
        # All phone numbers are 10 digits
        assert len(p["mobile_no"]) == 10
        assert p["mobile_no"].isdigit()
        # Strictly standard fictional names
        assert any(first in p["patient_name"] for first in ["Ramesh", "Sunita", "Rajesh", "Anita", "Manoj"])
