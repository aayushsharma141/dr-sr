"""
Automated UI tests for TreatmentView, PaymentView, and MainWindow navigation.
Kalyan Hospital Management System.
"""

import pytest
from PySide6.QtWidgets import QApplication, QLabel
from app.db.connection import init_db
from app.services.patient_service import PatientService
from app.services.treatment_service import TreatmentService
from app.services.billing_service import BillingService
from app.services.print_service import PrintService
from app.ui.views.treatment_view import TreatmentView
from app.ui.views.payment_view import PaymentView
from app.ui.main_window import MainWindow


@pytest.fixture
def test_db(tmp_path):
    """Provides an isolated initialized SQLite database for UI tests."""
    db_file = tmp_path / "test_ui_treatment.db"
    init_db(str(db_file))
    return str(db_file)


@pytest.fixture
def populated_clinic(test_db):
    """Creates a patient, treatment case, and initial session."""
    p_service = PatientService(test_db)
    patient = p_service.register_patient({
        "patient_name": "Ramesh Kumar Sharma",
        "age": 52,
        "sex": "Male",
        "mobile_no": "9876543210",
        "patient_condition": "Chronic Lumbar Spondylosis",
    })

    t_service = TreatmentService(test_db)
    case = t_service.open_treatment_case(
        patient_id=patient["id"],
        title="Spine Rehabilitation",
        no_of_sessions=10,
        total_amount_rupees=4000.00,
    )

    t_service.log_session(
        case_id=case["id"],
        treatment_notes="Day 1: Initial traction and IFT.",
        pain_score=7,
    )

    return {
        "patient": patient,
        "case": case,
    }


def test_treatment_view_loads_and_displays_sessions(qapp, test_db, populated_clinic):
    """Verifies that TreatmentView correctly renders case info and past sessions."""
    view = TreatmentView(db_path=test_db)
    case_id = populated_clinic["case"]["id"]
    patient_id = populated_clinic["patient"]["id"]

    view.load_patient_case(patient_id, case_id)

    # Check case title
    assert "Spine Rehabilitation" in view.case_title_lbl.text()
    assert "1 of 10 sessions" in view.progress_lbl.text()
    assert view.progress_bar.value() == 10

    # Table should have exactly 1 session row
    assert view.sessions_table.rowCount() == 1
    assert view.sessions_table.item(0, 0).text() == "Session 1"
    assert "Initial traction" in view.sessions_table.item(0, 3).text()
    # The real persisted score is summarized in the pain trend panel.
    assert "Latest 7/10" in view.pain_trend.summary_label.text()


def test_payment_view_balance_updates(qapp, test_db, populated_clinic):
    """Verifies that recording an installment updates the balance card immediately."""
    view = PaymentView(db_path=test_db)
    case_id = populated_clinic["case"]["id"]
    patient_id = populated_clinic["patient"]["id"]

    # Select patient and case
    view.patient_combo.setCurrentIndex(0)
    view.load_case_billing(case_id)

    # Initial state: Agreed ₹4,000, Paid ₹0, Balance ₹4,000
    fee_val = view.fee_card.findChild(QLabel, "val_label")
    paid_val = view.paid_card.findChild(QLabel, "val_label")
    bal_val = view.balance_card.findChild(QLabel, "val_label")

    assert "₹ 4,000.00" in fee_val.text()
    assert "₹ 0.00" in paid_val.text()
    assert "₹ 4,000.00" in bal_val.text()

    # Record installment of ₹1,500
    view.amt_input.setValue(1500.0)
    view.mode_combo.setCurrentText("CASH")
    view.note_input.setText("1st Advance")

    # Call record directly
    b_service = BillingService(test_db)
    b_service.record_installment(
        case_id=case_id,
        amount_rupees=1500.0,
        payment_mode="CASH",
        reference_note="1st Advance",
    )
    view.load_case_billing(case_id)

    assert "₹ 1,500.00" in paid_val.text()
    assert "₹ 2,500.00" in bal_val.text()
    assert view.payments_table.rowCount() == 1
    assert "1st Advance" in view.payments_table.item(0, 4).text()


def test_main_window_treatment_billing_navigation(qapp, test_db, populated_clinic):
    """Verifies MainWindow navigation seamlessly switches to Treatment and Billing pages."""
    window = MainWindow(db_path=test_db)

    # Navigate to Treatment view (index 2)
    window.sidebar.set_active_page(2)
    assert window.stacked_widget.currentIndex() == 2
    assert isinstance(window.stacked_widget.currentWidget(), TreatmentView)

    # Navigate to Billing view (index 3)
    window.sidebar.set_active_page(3)
    assert window.stacked_widget.currentIndex() == 3
    assert isinstance(window.stacked_widget.currentWidget(), PaymentView)

    # From treatment view, trigger view_billing_clicked
    case_id = populated_clinic["case"]["id"]
    window.treatment_view.view_billing_clicked.emit(case_id)
    assert window.stacked_widget.currentIndex() == 3


def test_payment_presets_status_and_thermal_receipt_action(qapp, test_db, populated_clinic, monkeypatch):
    """Payment quick amounts and receipt actions use the saved ledger summary."""
    view = PaymentView(db_path=test_db)
    case_id = populated_clinic["case"]["id"]
    view.load_case_billing(case_id)

    assert view.payment_status_badge.text() == "BALANCE DUE"
    view.pay_full_button.click()
    assert view.amt_input.value() == 4000.0

    # Record one actual installment through the existing billing service.
    view.billing_service.record_installment(
        case_id=case_id,
        amount_rupees=1000,
        payment_mode="UPI",
        reference_note="Test UPI receipt",
    )
    view.load_case_billing(case_id)

    assert view.payment_status_badge.text() == "PARTIAL DUE"
    assert view.payments_table.columnCount() == 7
    assert view.payments_table.rowCount() == 1
    assert view.payments_table.cellWidget(0, 6) is not None

    view.amount_preset_buttons[500].click()
    assert view.amt_input.value() == 500.0
    view.pay_full_button.click()
    assert view.amt_input.value() == 3000.0

    printed = []
    monkeypatch.setattr(
        PrintService,
        "show_thermal_receipt_preview",
        lambda html, parent=None: printed.append(html),
    )
    view.payments_table.cellWidget(0, 6).click()

    assert len(printed) == 1
    assert "RCPT-0001" in printed[0]
    assert "80mm 240mm" in printed[0]
    assert "Test UPI receipt" in printed[0]
