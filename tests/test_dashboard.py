"""
Unit tests for Kalyan Hospital SQLite connection and Dashboard Service.
"""

from app.db.connection import get_db_connection, init_db
from app.services.dashboard_service import DashboardService
from app.ui.views.dashboard_view import DashboardView


def test_schema_initialization(tmp_path):
    """Verify that init_db creates all required tables and foreign keys are enforced."""
    db_file = tmp_path / "test_kalyan.db"
    init_db(db_file)

    conn = get_db_connection(db_file)
    cursor = conn.cursor()

    # Check tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row["name"] for row in cursor.fetchall()}

    expected_tables = {
        "patients",
        "treatment_cases",
        "treatment_sessions",
        "payments",
        "users",
        "id_sequences",
    }
    assert expected_tables.issubset(tables), f"Missing tables: {expected_tables - tables}"

    # Check foreign keys pragma
    cursor.execute("PRAGMA foreign_keys")
    fk_enabled = cursor.fetchone()[0]
    assert fk_enabled == 1, "Foreign keys must be enabled"
    conn.close()


def test_dashboard_service_empty_db(tmp_path):
    """Verify DashboardService returns exact 0 counts and zero balances on fresh DB."""
    db_file = tmp_path / "empty_clinic.db"
    init_db(db_file)

    service = DashboardService(db_file)
    stats = service.get_statistics()

    assert stats["total_patients"] == 0
    assert stats["today_registrations"] == 0
    assert stats["active_cases"] == 0
    assert stats["total_agreed_paise"] == 0
    assert stats["total_paid_paise"] == 0
    assert stats["pending_balance_paise"] == 0
    assert stats["pending_balance_rupees"] == 0.0

    recent = service.get_recent_registrations()
    assert recent == []


def test_dashboard_service_with_records(tmp_path):
    """Verify DashboardService accurately calculates counts and balances with records."""
    db_file = tmp_path / "active_clinic.db"
    init_db(db_file)

    conn = get_db_connection(db_file)
    cursor = conn.cursor()

    # Insert a fictional patient
    cursor.execute(
        """
        INSERT INTO patients (serial_urn_no, patient_name, age, sex, address, mobile_no,
                              patient_condition)
        VALUES ('KH-2026-0001', 'Ramesh Kumar', 45, 'Male', 'Station Road, Ara',
                '9876543210', 'Cervical Spondylosis')
        """
    )
    patient_id = cursor.lastrowid

    # Insert an active treatment case (Agreed fee = ₹5,000 = 500,000 paise)
    cursor.execute(
        """
        INSERT INTO treatment_cases (patient_id, title, no_of_sessions, total_amount_paise, status)
        VALUES (?, 'Cervical Physiotherapy', 10, 500000, 'IN_PROGRESS')
        """,
        (patient_id,),
    )
    case_id = cursor.lastrowid

    # Insert a partial payment of ₹1,500 = 150,000 paise
    cursor.execute(
        """
        INSERT INTO payments (case_id, amount_paid_paise, payment_mode)
        VALUES (?, 150000, 'CASH')
        """,
        (case_id,),
    )
    conn.commit()
    conn.close()

    service = DashboardService(db_file)
    stats = service.get_statistics()

    assert stats["total_patients"] == 1
    assert stats["today_registrations"] == 1
    assert stats["active_cases"] == 1
    assert stats["total_agreed_paise"] == 500000
    assert stats["total_paid_paise"] == 150000
    assert stats["pending_balance_paise"] == 350000  # ₹3,500
    assert stats["pending_balance_rupees"] == 3500.0

    recent = service.get_recent_registrations()
    assert len(recent) == 1
    assert recent[0]["patient_name"] == "Ramesh Kumar"
    assert recent[0]["serial_urn_no"] == "KH-2026-0001"


def test_dashboard_view_ui(qapp, tmp_path):
    """Verify DashboardView renders card values without crashing."""
    db_file = tmp_path / "ui_test.db"
    init_db(db_file)

    service = DashboardService(db_file)
    view = DashboardView(dashboard_service=service)

    assert view.card_total_patients.value_lbl.text() == "0"
    assert view.card_today_registrations.value_lbl.text() == "0"
    assert view.card_active_cases.value_lbl.text() == "0"
    assert view.card_pending_balance.value_lbl.text() == "₹0.00"
