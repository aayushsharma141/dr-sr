"""
Unit tests for Kalyan Hospital MainWindow and Sidebar Navigation.
"""

from app.config import APP_NAME, HOSPITAL_NAME, HOSPITAL_NAME_HINDI
from app.ui.main_window import MainWindow


def test_main_window_instantiation(qapp):
    """Smoke test: MainWindow initializes cleanly with title and dimensions."""
    window = MainWindow()
    assert window is not None
    assert window.windowTitle() == APP_NAME
    assert window.stacked_widget.count() == 5
    assert window.stacked_widget.currentIndex() == 0


def test_sidebar_branding(qapp):
    """Verify that sidebar displays authentic hospital name and trust information."""
    from PySide6.QtWidgets import QLabel
    window = MainWindow()
    sidebar = window.sidebar

    # Collect text from all QLabel children in the sidebar
    labels = [lbl.text() for lbl in sidebar.findChildren(QLabel)]
    found_hindi = any(HOSPITAL_NAME_HINDI in lbl for lbl in labels)
    found_en = any(HOSPITAL_NAME in lbl for lbl in labels)

    assert found_hindi, f"Expected '{HOSPITAL_NAME_HINDI}' in sidebar labels"
    assert found_en, f"Expected '{HOSPITAL_NAME}' in sidebar labels"


def test_sidebar_navigation_switching(qapp):
    """Verify that navigation signals switch the stacked widget active index."""
    window = MainWindow()

    for target_index in range(5):
        window.sidebar.page_changed.emit(target_index)
        assert window.stacked_widget.currentIndex() == target_index


def test_global_quick_search_shortcut_is_available(qapp):
    """Ctrl+K must stay available from the shared application shell."""
    window = MainWindow()

    assert window.quick_search_button.text().endswith("Ctrl+K")
    assert window.quick_search_shortcut.key().toString() == "Ctrl+K"


def test_quick_launcher_registration_action_opens_blank_form(qapp, tmp_path):
    """The launcher registration action must open the actual form, not just the directory."""
    window = MainWindow(db_path=str(tmp_path / "registration_shortcut.db"))

    window._handle_quick_selection("register", None)

    assert window.stacked_widget.currentIndex() == 1
    assert window.patient_module.stack.currentIndex() == 1
