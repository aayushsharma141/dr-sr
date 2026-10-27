"""
Main Application Window for Kalyan Hospital Management System.
"""

from typing import Optional
from PySide6.QtWidgets import (
    QHBoxLayout,
    QMainWindow,
    QStackedWidget,
    QWidget,
)

from app.config import APP_NAME
from app.db.connection import init_db
from app.services.dashboard_service import DashboardService
from app.services.patient_service import PatientService
from app.ui.sidebar import SidebarWidget
from app.ui.styles import get_application_stylesheet
from app.ui.views.dashboard_view import DashboardView
from app.ui.views.patient_module_view import PatientModuleView
from app.ui.views.treatment_view import TreatmentView
from app.ui.views.payment_view import PaymentView
from app.ui.views.backup_view import BackupView
from app.ui.views.placeholder_view import PlaceholderView


class MainWindow(QMainWindow):
    """
    Top-level application window containing the navigation sidebar
    and stacked central content pages.
    """

    def __init__(self, db_path: Optional[str] = None, parent: QWidget | None = None):
        super().__init__(parent)
        self.db_path = db_path
        self.setWindowTitle(APP_NAME)
        self.resize(1160, 780)
        self.setMinimumSize(980, 660)

        # Apply global stylesheet
        self.setStyleSheet(get_application_stylesheet())

        # Central Layout Container
        central_widget = QWidget(self)
        central_widget.setObjectName("CentralWidget")
        self.setCentralWidget(central_widget)

        root_layout = QHBoxLayout(central_widget)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)

        # 1. Left Navigation Sidebar
        self.sidebar = SidebarWidget(self)
        root_layout.addWidget(self.sidebar)

        # 2. Right Central Stacked Widget
        self.stacked_widget = QStackedWidget(self)
        self.stacked_widget.setObjectName("MainContent")
        root_layout.addWidget(self.stacked_widget)

        # Wire navigation signal
        self.sidebar.page_changed.connect(self._navigate_to_page)

        # Ensure DB schema is initialized (idempotent — safe to call every launch)
        init_db(self.db_path)

        # Populate views
        self._init_views()

    def _init_views(self):
        """Initializes views for each navigation section."""
        # Index 0: Live Dashboard View
        dashboard_service = DashboardService(self.db_path)
        self.dashboard_view = DashboardView(dashboard_service=dashboard_service, parent=self)
        self.dashboard_view.navigate_to.connect(self._on_dashboard_navigate)
        self.stacked_widget.addWidget(self.dashboard_view)

        # Index 1: Patient Management Module (Live)
        patient_service = PatientService(self.db_path)
        self.patient_module = PatientModuleView(patient_service=patient_service, parent=self)
        self.patient_module.open_treatment_requested.connect(self._on_open_treatment)
        self.stacked_widget.addWidget(self.patient_module)

        # Index 2: Treatment Cases & Sessions (Live)
        self.treatment_view = TreatmentView(db_path=self.db_path, parent=self)
        self.treatment_view.view_billing_clicked.connect(self._on_view_billing)
        self.stacked_widget.addWidget(self.treatment_view)

        # Index 3: Billing & Payments Ledger (Live)
        self.payment_view = PaymentView(db_path=self.db_path, parent=self)
        self.stacked_widget.addWidget(self.payment_view)

        # Index 4: Backup & Data Safety (Live)
        self.backup_view = BackupView(db_path=self.db_path, parent=self)
        self.backup_view.database_restored.connect(self._on_database_restored)
        self.stacked_widget.addWidget(self.backup_view)

        # Start at dashboard
        self.stacked_widget.setCurrentIndex(0)

    def _on_dashboard_navigate(self, index: int):
        """Called when a quick-action button in the dashboard is clicked."""
        self.sidebar.set_active_page(index)
        self._navigate_to_page(index)

    def _on_open_treatment(self, patient_id: int):
        """Routes to Treatment Cases module with patient pre-selected."""
        self.treatment_view.load_patient_case(patient_id)
        self.sidebar.set_active_page(2)
        self._navigate_to_page(2)

    def _on_view_billing(self, case_id: int):
        """Routes to Billing & Payments module with case pre-selected."""
        self.payment_view.load_case_billing(case_id)
        self.sidebar.set_active_page(3)
        self._navigate_to_page(3)

    def _navigate_to_page(self, index: int):
        """Switches the active view in the stacked widget."""
        if 0 <= index < self.stacked_widget.count():
            self.stacked_widget.setCurrentIndex(index)
            # Dynamic refreshes on page activation
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

    def _on_database_restored(self):
        """Refreshes all loaded views after a database restoration."""
        self.dashboard_view.refresh_data()
        self.patient_module.list_view.reload_patients()
        self.treatment_view.refresh_patient_list()
        self.payment_view.refresh_patient_list()

    def set_view(self, index: int, widget: QWidget):
        """Replaces the widget at a specific index with a live view."""
        if 0 <= index < self.stacked_widget.count():
            old_widget = self.stacked_widget.widget(index)
            self.stacked_widget.removeWidget(old_widget)
            self.stacked_widget.insertWidget(index, widget)
            self.stacked_widget.setCurrentIndex(index)
