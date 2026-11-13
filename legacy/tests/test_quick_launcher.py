"""Tests for the native Ctrl+K workspace and patient launcher."""

from PySide6.QtCore import Qt

from app.db.connection import get_db_connection, init_db
from app.services.patient_service import PatientService
from app.ui.quick_launcher import QuickLauncherDialog


def test_quick_launcher_lists_workspace_commands(qapp, tmp_path):
    db_file = tmp_path / "launcher_commands.db"
    init_db(db_file)

    dialog = QuickLauncherDialog(PatientService(db_file))
    labels = [
        dialog.results_list.item(row).text()
        for row in range(dialog.results_list.count())
    ]

    assert any("Dashboard" in label for label in labels)
    assert any("Patient Registry" in label for label in labels)
    assert any("Register New Patient" in label for label in labels)


def test_quick_launcher_finds_patient_by_name_and_returns_selection(qapp, tmp_path):
    db_file = tmp_path / "launcher_patient.db"
    init_db(db_file)

    conn = get_db_connection(db_file)
    conn.execute(
        """
        INSERT INTO patients (
            serial_urn_no, patient_name, age, sex, address, mobile_no, patient_condition
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "KH-2026-0042",
            "Ramesh Kumar",
            45,
            "Male",
            "Station Road, Ara",
            "9876543210",
            "Lumbar Spondylosis",
        ),
    )
    conn.commit()
    conn.close()

    dialog = QuickLauncherDialog(PatientService(db_file))
    selected = []
    dialog.selection_requested.connect(lambda kind, payload: selected.append((kind, payload)))

    dialog.search_input.setText("Ramesh")
    patient_items = [
        dialog.results_list.item(row)
        for row in range(dialog.results_list.count())
        if dialog.results_list.item(row).data(Qt.ItemDataRole.UserRole) == "patient"
    ]

    assert len(patient_items) == 1
    dialog.results_list.setCurrentItem(patient_items[0])
    dialog._activate_current()

    assert selected
    assert selected[0][0] == "patient"
    assert selected[0][1]["serial_urn_no"] == "KH-2026-0042"


def test_quick_launcher_shows_empty_state_for_unknown_search(qapp, tmp_path):
    db_file = tmp_path / "launcher_empty.db"
    init_db(db_file)

    dialog = QuickLauncherDialog(PatientService(db_file))
    dialog.search_input.setText("not-a-patient-or-action")

    assert dialog.results_list.count() == 1
    assert "No matching patients or actions" in dialog.results_list.item(0).text()
