"""
UX audit regressions: registry paging transparency, keyboard focus styling, non-blocking errors.
"""

from PySide6.QtWidgets import QMessageBox

from app.db.connection import init_db
from app.services.patient_service import PatientService
from app.ui.styles import get_application_stylesheet
from app.ui.toast_notification import notify
from app.ui.views.patient_list_view import PAGE_SIZE, PatientListView
from app.ui.views.treatment_view import LogSessionDialog


def _register(service, count):
    for index in range(count):
        service.register_patient({
            "patient_name": f"Patient {index:03d}", "age": 30, "sex": "Female", "mobile_no": "9876543210",
            "address": "Arrah", "patient_condition": "Back pain",
        })


def test_count_matches_search_filters(tmp_path):
    db = tmp_path / "count.db"
    init_db(db)
    service = PatientService(db)
    _register(service, 7)
    assert service.count_patients() == 7
    assert service.count_patients("Patient 003") == 1
    assert service.count_patients("nobody") == 0


def test_registry_discloses_partial_list_and_shows_more(qapp, tmp_path):
    db = tmp_path / "registry.db"
    init_db(db)
    service = PatientService(db)
    _register(service, PAGE_SIZE + 5)

    view = PatientListView(patient_service=service)
    assert view.table.rowCount() == PAGE_SIZE
    assert f"Showing {PAGE_SIZE} of {PAGE_SIZE + 5}" in view.status_lbl.text()
    assert not view.show_more_btn.isHidden()

    view.show_more_btn.click()
    assert view.table.rowCount() == PAGE_SIZE + 5
    assert view.show_more_btn.isHidden()

    view.search_input.setText("Patient 004")  # a new search starts from the first page again
    assert view.table.rowCount() == 1
    assert view.show_more_btn.isHidden()


def test_focus_styles_cover_keyboard_controls():
    sheet = get_application_stylesheet()
    for selector in ("QPushButton:focus", "QPushButton#FilterChip:focus", "QPushButton#NavButton:focus", "QTableView:focus"):
        assert selector in sheet


def test_notify_uses_toast_when_hosted_in_main_window(qapp, monkeypatch):
    from PySide6.QtWidgets import QWidget

    class Host(QWidget):
        calls = []

        def show_toast(self, title, message, level="success", duration_ms=3200):
            self.calls.append((title, level, duration_ms))

    host = Host()
    child = QWidget(host)
    monkeypatch.setattr(QMessageBox, "critical", lambda *a, **k: (_ for _ in ()).throw(AssertionError("blocking box")))
    notify(child, "Payment not saved", "boom", "error")
    notify(child, "No case selected", "pick one", "info")
    assert host.calls[0][1] == "error" and host.calls[0][2] >= 8000  # errors stay visible longer
    assert host.calls[1][1] == "info"


def test_session_dialog_shows_inline_error_instead_of_popup(qapp, monkeypatch):
    monkeypatch.setattr(QMessageBox, "warning", lambda *a, **k: (_ for _ in ()).throw(AssertionError("blocking box")))
    dialog = LogSessionDialog(1)
    dialog.show()
    dialog.validate_and_accept()
    assert dialog.error_label.isVisible()
    assert dialog.result() == 0  # still open
    dialog.notes_input.setPlainText("Traction and IFT")
    dialog.validate_and_accept()
    assert dialog.result() == 1
