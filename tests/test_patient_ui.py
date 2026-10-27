"""
UI tests for PatientFormView, PatientListView, and PatientModuleView.
"""

from app.db.connection import init_db
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
