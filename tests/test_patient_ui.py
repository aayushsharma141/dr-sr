"""
UI tests for PatientFormView, PatientListView, and PatientModuleView.
"""

from app.db.connection import get_db_connection, init_db
from app.services.billing_service import BillingService
from app.services.treatment_service import TreatmentService
from app.services.patient_service import PatientService
from app.ui.views.patient_form_view import PatientFormView
from app.ui.views.patient_list_view import PatientListView
from app.ui.views.patient_module_view import PatientModuleView


def test_patient_form_validation_and_save(qapp, tmp_path):
    """Verify form validation flags invalid input and emits patient_saved on valid save."""
    db_file = tmp_path / "form_test.db"
    init_db(db_file)
    service = PatientService(db_file)

    form = PatientFormView(patient_service=service)
    form.show()  # Qt isVisible() requires widget to be shown

    # 1. Try saving empty form -> error banner shown
    form.input_name.setText("")
    form.save_record()
    assert form.error_banner.isVisible()
    assert "Patient Name is required" in form.error_banner.text()

    # 2. Fill valid values
    form.input_name.setText("Anjali Kumari")
    form.input_age.setValue(26)
    form.input_mobile.setText("9876543210")
    form.input_condition.setText("Lumbar Disc Herniation")

    saved_payload = []
    form.patient_saved.connect(lambda p: saved_payload.append(p))

    form.save_record()

    assert not form.error_banner.isVisible()
    assert len(saved_payload) == 1
    assert saved_payload[0]["patient_name"] == "Anjali Kumari"
    assert saved_payload[0]["serial_urn_no"].startswith("KH-")


def test_patient_list_search_filtering(qapp, tmp_path):
    """Verify PatientListView filters table rows on textChanged."""
    db_file = tmp_path / "list_test.db"
    init_db(db_file)
    service = PatientService(db_file)

    service.register_patient({
        "patient_name": "Deepak Kumar",
        "age": 38,
        "sex": "Male",
        "mobile_no": "9998887771",
        "patient_condition": "Frozen Shoulder",
    })

    service.register_patient({
        "patient_name": "Meera Devi",
        "age": 55,
        "sex": "Female",
        "mobile_no": "9998887772",
        "patient_condition": "Cervical Spondylosis",
    })

    list_view = PatientListView(patient_service=service)
    assert list_view.table.rowCount() == 2

    # Filter by name "Meera"
    list_view.search_input.setText("Meera")
    assert list_view.table.rowCount() == 1
    assert list_view.table.item(0, 1).text() == "Meera Devi"

    # Filter by mobile "7771"
    list_view.search_input.setText("7771")
    assert list_view.table.rowCount() == 1
    assert list_view.table.item(0, 1).text() == "Deepak Kumar"

    # Clear filter
    list_view.search_input.setText("")
    assert list_view.table.rowCount() == 2


def test_patient_module_transitions(qapp, tmp_path):
    """Verify PatientModuleView switches between directory list and registration form."""
    db_file = tmp_path / "module_test.db"
    init_db(db_file)
    service = PatientService(db_file)

    module = PatientModuleView(patient_service=service)

    # Initial state is directory list (index 0)
    assert module.stack.currentIndex() == 0

    # Trigger register
    module.list_view.register_clicked.emit()
    assert module.stack.currentIndex() == 1
    assert module.form_view.current_patient_id is None

    # Cancel back
    module.form_view.cancelled.emit()
    assert module.stack.currentIndex() == 0


def test_patient_registry_filters_use_saved_today_active_case_and_balance_data(qapp, tmp_path):
    """Registry filters are backed by persisted patient, case, and payment values."""
    db_file = tmp_path / "registry_filters.db"
    init_db(db_file)
    patient_service = PatientService(db_file)
    treatment_service = TreatmentService(db_file)
    billing_service = BillingService(db_file)

    today_patient = patient_service.register_patient({
        "patient_name": "Anjali Current",
        "age": 32,
        "sex": "Female",
        "mobile_no": "9000000001",
        "address": "Ara",
        "patient_condition": "Knee Pain",
    })
    old_patient = patient_service.register_patient({
        "patient_name": "Ramesh Archived Date",
        "age": 45,
        "sex": "Male",
        "mobile_no": "9000000002",
        "address": "Ara",
        "patient_condition": "Back Pain",
    })

    conn = get_db_connection(db_file)
    conn.execute(
        "UPDATE patients SET created_at = ?, patient_in = ? WHERE id = ?",
        ("2020-01-01 09:00:00", "2020-01-01 09:00:00", old_patient["id"]),
    )
    conn.commit()
    conn.close()

    unpaid_case = treatment_service.open_treatment_case(
        patient_id=today_patient["id"],
        title="Active Knee Rehabilitation",
        no_of_sessions=8,
        total_amount_rupees=2400,
    )
    paid_case = treatment_service.open_treatment_case(
        patient_id=old_patient["id"],
        title="Completed Payment Plan",
        no_of_sessions=4,
        total_amount_rupees=1000,
    )
    billing_service.record_installment(
        case_id=paid_case["id"],
        amount_rupees=1000,
        payment_mode="CASH",
    )

    today_ids = {
        p["id"]
        for p in patient_service.search_patients("", limit=100, filter_key="today")
    }
    active_ids = {
        p["id"]
        for p in patient_service.search_patients("", limit=100, filter_key="active_therapy")
    }
    pending_ids = {
        p["id"]
        for p in patient_service.search_patients("", limit=100, filter_key="pending_balance")
    }

    assert today_patient["id"] in today_ids
    assert old_patient["id"] not in today_ids
    assert today_patient["id"] in active_ids
    assert old_patient["id"] in active_ids
    assert today_patient["id"] in pending_ids
    assert old_patient["id"] not in pending_ids


def test_patient_directory_filter_chip_and_profile_panel(qapp, tmp_path):
    """Selecting a row opens the service-backed quick profile and filters are selectable."""
    db_file = tmp_path / "registry_profile.db"
    init_db(db_file)
    patient_service = PatientService(db_file)
    patient = patient_service.register_patient({
        "patient_name": "Sita Devi",
        "age": 41,
        "sex": "Female",
        "mobile_no": "9000000011",
        "address": "Station Road, Ara",
        "patient_condition": "Shoulder Pain",
    })
    TreatmentService(db_file).open_treatment_case(
        patient_id=patient["id"],
        title="Shoulder Mobility",
        no_of_sessions=6,
        total_amount_rupees=1800,
    )

    view = PatientListView(patient_service=patient_service)
    view.filter_buttons["active_therapy"].click()

    assert view.table.rowCount() == 1
    view.table.setCurrentCell(0, 0)
    qapp.processEvents()

    assert not view.profile_panel.isHidden()
    assert view.profile_name.text() == "Sita Devi"
    assert view.profile_urn.text() == patient["serial_urn_no"]
    assert "Shoulder Mobility" in view.profile_case.text()
    assert view.profile_progress.value() == 0
