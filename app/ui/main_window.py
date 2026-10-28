"""
Main application window for Kalyan Hospital Management System.
Native PySide6 shell with keyboard-first patient search and non-blocking feedback.
"""
from typing import Optional

from PySide6.QtCore import Qt, QDateTime
from PySide6.QtGui import QKeySequence, QShortcut, QIcon
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QPushButton,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from qfluentwidgets import setThemeColor

from app.config import APP_NAME, COLORS, BASE_DIR
from app.db.connection import init_db
from app.services.dashboard_service import DashboardService
from app.services.patient_service import PatientService
from app.ui.quick_launcher import QuickLauncherDialog
from app.ui.sidebar import SidebarWidget
from app.ui.styles import get_application_stylesheet
from app.ui.toast_notification import ToastNotification
from app.ui.views.dashboard_view import DashboardView
from app.ui.views.patient_module_view import PatientModuleView
from app.ui.views.treatment_view import TreatmentView
from app.ui.views.payment_view import PaymentView
from app.ui.views.backup_view import BackupView


class MainWindow(QMainWindow):
    """Top-level offline clinic workspace with persistent command access."""

    PAGE_LABELS = (
        "DASHBOARD",
        "PATIENT REGISTRY",
        "TREATMENT SESSIONS",
        "BILLING & PAYMENTS",
        "BACKUP & SAFETY",
    )

    def __init__(self, db_path: Optional[str] = None, parent: QWidget | None = None):
        super().__init__(parent)
        self.db_path = db_path
        self._active_toast: ToastNotification | None = None

        self.setWindowTitle(APP_NAME)
        icon_path = BASE_DIR / "app" / "assets" / "kalyan_hospital_logo.png"
        if icon_path.exists():
            self.setWindowIcon(QIcon(str(icon_path)))
        self.resize(1160, 780)
        self.setMinimumSize(980, 660)
        setThemeColor(COLORS["primary"])
        self.setStyleSheet(get_application_stylesheet())

        central_widget = QWidget(self)
        central_widget.setObjectName("CentralWidget")
        self.setCentralWidget(central_widget)

        root_layout = QHBoxLayout(central_widget)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)

        # Persistent brand navigation.
        self.sidebar = SidebarWidget(self)
        root_layout.addWidget(self.sidebar)

        # A shared command bar makes patient search available on every module.
        self.workspace_column = QWidget(central_widget)
        self.workspace_column.setObjectName("WorkspaceColumn")
        self.workspace_layout = QVBoxLayout(self.workspace_column)
        self.workspace_layout.setContentsMargins(0, 0, 0, 0)
        self.workspace_layout.setSpacing(0)
        root_layout.addWidget(self.workspace_column, stretch=1)

        self.command_bar = QFrame(self.workspace_column)
        self.command_bar.setObjectName("AppCommandBar")
        self.command_bar.setFixedHeight(58)
        command_layout = QHBoxLayout(self.command_bar)
        command_layout.setContentsMargins(18, 8, 16, 8)
        command_layout.setSpacing(12)

        self.workspace_context = QLabel("DASHBOARD")
        self.workspace_context.setObjectName("WorkspaceContext")
        command_layout.addWidget(self.workspace_context)

        command_layout.addStretch(1)

        self.quick_search_button = QPushButton("Find patient, URN or mobile     Ctrl+K")
        self.quick_search_button.setObjectName("SearchLauncherButton")
        self.quick_search_button.setCursor(Qt.CursorShape.PointingHandCursor)
        self.quick_search_button.setMinimumWidth(275)
        self.quick_search_button.clicked.connect(self.open_quick_launcher)
        command_layout.addWidget(self.quick_search_button)

        self.clock_label = QLabel(QDateTime.currentDateTime().toString("ddd, dd MMM  ·  hh:mm AP"))
        self.clock_label.setStyleSheet(f"color:{COLORS['text_secondary']};font-size:10px;")
        command_layout.addWidget(self.clock_label)

        self.offline_status = QLabel("OFFLINE · LOCAL DB")
        self.offline_status.setObjectName("OfflineStatus")
        command_layout.addWidget(self.offline_status)

        self.workspace_layout.addWidget(self.command_bar)

        self.stacked_widget = QStackedWidget(self.workspace_column)
        self.stacked_widget.setObjectName("MainContent")
        self.workspace_layout.addWidget(self.stacked_widget, stretch=1)

        self.sidebar.page_changed.connect(self._navigate_to_page)

        self.quick_search_shortcut = QShortcut(QKeySequence("Ctrl+K"), self)
        self.quick_search_shortcut.setContext(Qt.ShortcutContext.ApplicationShortcut)
        self.quick_search_shortcut.activated.connect(self.open_quick_launcher)

        # Initialize SQLite schema only; no schema or business-rule changes in this UI phase.
        init_db(self.db_path)
        self._init_views()

    def _init_views(self):
        """Initialize existing database-backed views and wire presentation events."""
        dashboard_service = DashboardService(self.db_path)
        self.dashboard_view = DashboardView(dashboard_service=dashboard_service, parent=self)
        self.dashboard_view.navigate_to.connect(self._on_dashboard_navigate)
        self.dashboard_view.register_patient_requested.connect(self._register_patient)
        self.dashboard_view.open_patient_requested.connect(self._open_patient_from_search)
        self.dashboard_view.manual_refresh_completed.connect(
            lambda: self.show_toast("Dashboard refreshed", "Clinic metrics and today's activity are up to date.", "info")
        )
        self.stacked_widget.addWidget(self.dashboard_view)

        patient_service = PatientService(self.db_path)
        self.patient_module = PatientModuleView(patient_service=patient_service, parent=self)
        self.patient_module.open_treatment_requested.connect(self._on_open_treatment)
        self.patient_module.patient_saved.connect(self._on_patient_saved)
        self.stacked_widget.addWidget(self.patient_module)

        self.treatment_view = TreatmentView(db_path=self.db_path, parent=self)
        self.treatment_view.view_billing_clicked.connect(self._on_view_billing)
        self.treatment_view.session_saved.connect(self._on_session_saved)
        self.stacked_widget.addWidget(self.treatment_view)

        self.payment_view = PaymentView(db_path=self.db_path, parent=self)
        self.payment_view.payment_saved.connect(self._on_payment_saved)
        self.stacked_widget.addWidget(self.payment_view)

        self.backup_view = BackupView(db_path=self.db_path, parent=self)
        self.backup_view.database_restored.connect(self._on_database_restored)
        self.stacked_widget.addWidget(self.backup_view)

        self.stacked_widget.setCurrentIndex(0)

    def open_quick_launcher(self):
        """Open the Ctrl+K launcher for patient search or workspace navigation."""
        if not hasattr(self, "patient_module"):
            return
        dialog = QuickLauncherDialog(self.patient_module.service, parent=self)
        dialog.selection_requested.connect(self._handle_quick_selection)
        dialog.exec()

    def _handle_quick_selection(self, kind: str, payload: object):
        if kind == "navigate":
            index = int(payload)
            if index == 1:
                self.patient_module.stack.setCurrentIndex(0)
                self.patient_module.list_view.search_input.clear()
            self.sidebar.set_active_page(index)
            return

        if kind == "register":
            self._register_patient()
            return

        if kind == "patient" and isinstance(payload, dict):
            urn = str(payload.get("serial_urn_no") or "")
            patient_id = int(payload.get("id") or 0)
            if patient_id and urn:
                self._open_patient_from_search(patient_id, urn)

    def _register_patient(self):
        """Navigate to the directory and open a clean registration form."""
        self.patient_module.list_view.search_input.clear()
        self.patient_module.stack.setCurrentIndex(0)
        self.sidebar.set_active_page(1)
        self.patient_module.show_registration_form()

    def _open_patient_from_search(self, patient_id: int, urn: str):
        """Show a single matching record in the existing directory without auto-editing it."""
        del patient_id  # The directory uses the repository-backed URN search as its visible context.
        self.patient_module.stack.setCurrentIndex(0)
        self.patient_module.list_view.search_input.setText(urn)
        self.sidebar.set_active_page(1)
        self.show_toast("Patient found", f"Showing {urn} in the patient registry.", "info")

    def _on_dashboard_navigate(self, index: int):
        """Route dashboard shortcuts through the existing sidebar signal."""
        if index == 1:
            self.patient_module.stack.setCurrentIndex(0)
            self.patient_module.list_view.search_input.clear()
        self.sidebar.set_active_page(index)

    def _on_open_treatment(self, patient_id: int):
        """Route to treatment cases with the selected patient loaded."""
        self.treatment_view.load_patient_case(patient_id)
        self.sidebar.set_active_page(2)

    def _on_view_billing(self, case_id: int):
        """Route to the billing ledger with the selected case loaded."""
        self.payment_view.load_case_billing(case_id)
        self.sidebar.set_active_page(3)

    def _navigate_to_page(self, index: int):
        """Switch pages and refresh their existing service-backed data."""
        if not 0 <= index < self.stacked_widget.count():
            return
        self.stacked_widget.setCurrentIndex(index)
        self.workspace_context.setText(self.PAGE_LABELS[index])

        if index == 0:
            self.dashboard_view.refresh_data()
        elif index == 1:
            self.patient_module.list_view.reload_patients()
        elif index == 2:
            self.treatment_view.refresh_patient_list()
        elif index == 3:
            self.payment_view.refresh_patient_list()
        elif index == 4:
            self.backup_view.refresh_backups()

    def _on_patient_saved(self, patient: dict):
        self.dashboard_view.refresh_data()
        name = str(patient.get("patient_name") or "Patient")
        urn = str(patient.get("serial_urn_no") or "")
        detail = f"{name} · {urn} saved to the local database." if urn else f"{name} saved to the local database."
        self.show_toast("Patient record saved", detail, "success")

    def _on_payment_saved(self, receipt: dict):
        """Refresh live financial indicators and acknowledge a saved payment without a modal."""
        self.dashboard_view.refresh_data()
        amount = str(receipt.get("amount_paid_formatted") or "Payment")
        balance = str(receipt.get("balance_formatted") or "")
        detail = f"{amount} recorded. "
        if receipt.get("is_overpayment"):
            detail += f"Case is cleared with an excess of {receipt.get('overpayment_formatted', '—')}."
            level = "warning"
            title = "Payment recorded · overpayment"
        else:
            detail += f"Remaining balance: {balance}. Use the Print action in the ledger for an 80mm receipt."
            level = "success"
            title = "Payment recorded"
        self.show_toast(title, detail, level)

    def _on_session_saved(self, session: dict):
        """Refresh the day feed and acknowledge successful session logging non-modally."""
        self.dashboard_view.refresh_data()
        session_number = session.get("session_number", "")
        pain_score = session.get("pain_score")
        detail = f"Session {session_number} saved to the local case history."
        if pain_score is not None:
            detail += f" Recorded pain score: {pain_score}/10."
        self.show_toast("Treatment session saved", detail, "success")

    def _on_database_restored(self):
        """Refresh all loaded views after database restore and notify without blocking."""
        self.dashboard_view.refresh_data()
        self.patient_module.list_view.reload_patients()
        self.treatment_view.refresh_patient_list()
        self.payment_view.refresh_patient_list()
        self.show_toast("Database restored", "Local views have been refreshed.", "success")

    def show_toast(
        self,
        title: str,
        message: str,
        level: str = "success",
        duration_ms: int = 3200,
    ):
        """Display a temporary, non-modal toast above the workspace content."""
        bar = ToastNotification.show_fluent(self, title, message, level, duration_ms)
        if bar is not None:
            return

        if self._active_toast is not None:
            self._active_toast.close()
            self._active_toast = None
        toast = ToastNotification(self, title, message, level, duration_ms)
        self._active_toast = toast
        toast.dismissed.connect(lambda current=toast: self._on_toast_dismissed(current))
        toast.adjustSize()
        x = max(16, self.width() - toast.width() - 22)
        y = 70
        toast.show_toast(x, y)

    def _on_toast_dismissed(self, toast: ToastNotification) -> None:
        """Avoid retaining a Python wrapper for a toast widget that Qt has deleted."""
        if self._active_toast is toast:
            self._active_toast = None

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if self._active_toast is not None and self._active_toast.isVisible():
            x = max(16, self.width() - self._active_toast.width() - 22)
            self._active_toast.move(x, 70)

    def set_view(self, index: int, widget: QWidget):
        """Replace a view at a given index while preserving the application shell."""
        if 0 <= index < self.stacked_widget.count():
            old_widget = self.stacked_widget.widget(index)
            self.stacked_widget.removeWidget(old_widget)
            self.stacked_widget.insertWidget(index, widget)
            self.stacked_widget.setCurrentIndex(index)
