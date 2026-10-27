"""
Live Hospital Dashboard View displaying real-time patient counts,
active cases, fee balances, and quick navigation actions.
"""

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.config import (
    CLINIC_1_ADDR,
    COLORS,
    HOSPITAL_DEPT,
    HOSPITAL_NAME,
    HOSPITAL_NAME_HINDI,
    TRUST_NAME,
)
from app.services.dashboard_service import DashboardService


class StatCard(QFrame):
    """Clean metric card displaying a numeric value, label, and contextual icon."""

    def __init__(
        self,
        title: str,
        initial_value: str,
        subtitle: str,
        icon: str,
        accent_color: str | None = None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.setObjectName("StatCard")
        self.setMinimumHeight(115)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(18, 16, 18, 16)
        layout.setSpacing(6)

        # Header with title and icon
        header = QHBoxLayout()
        header.setContentsMargins(0, 0, 0, 0)

        title_lbl = QLabel(title)
        title_lbl.setObjectName("StatCardTitle")
        header.addWidget(title_lbl)

        header.addStretch()

        icon_lbl = QLabel(icon)
        icon_lbl.setStyleSheet("font-size: 18px;")
        header.addWidget(icon_lbl)
        layout.addLayout(header)

        # Main numeric value
        self.value_lbl = QLabel(initial_value)
        self.value_lbl.setObjectName("StatCardValue")
        if accent_color:
            self.value_lbl.setStyleSheet(f"color: {accent_color};")
        layout.addWidget(self.value_lbl)

        # Subtitle
        sub_lbl = QLabel(subtitle)
        sub_lbl.setObjectName("StatCardSubtitle")
        layout.addWidget(sub_lbl)

    def set_value(self, text: str):
        self.value_lbl.setText(text)


class DashboardView(QWidget):
    """
    Hospital Dashboard displaying operational statistics calculated
    directly from SQLite and quick action shortcuts.
    """

    navigate_to = Signal(int)

    def __init__(
        self,
        dashboard_service: DashboardService | None = None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.service = dashboard_service or DashboardService()

        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(28, 24, 28, 24)
        root_layout.setSpacing(20)

        # 1. Top Header Banner
        header_box = QHBoxLayout()
        header_box.setContentsMargins(0, 0, 0, 0)

        header_text = QVBoxLayout()
        header_text.setSpacing(3)

        title_lbl = QLabel(f"{HOSPITAL_NAME_HINDI} — {HOSPITAL_NAME}")
        title_lbl.setObjectName("PageHeading")
        header_text.addWidget(title_lbl)

        sub_info = QLabel(f"{HOSPITAL_DEPT}  •  {TRUST_NAME}")
        sub_info.setStyleSheet(f"color: {COLORS['secondary']}; font-weight: 600; font-size: 12px;")
        header_text.addWidget(sub_info)

        addr_info = QLabel(f"मुख्य क्लिनिक: {CLINIC_1_ADDR}")
        addr_info.setObjectName("PageSubheading")
        header_text.addWidget(addr_info)

        header_box.addLayout(header_text)
        header_box.addStretch()

        # Refresh button
        refresh_btn = QPushButton("🔄  Refresh Data")
        refresh_btn.setObjectName("SecondaryButton")
        refresh_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        refresh_btn.clicked.connect(self.refresh_data)
        header_box.addWidget(refresh_btn)

        root_layout.addLayout(header_box)

        # 2. Metric Stat Cards Grid
        cards_layout = QHBoxLayout()
        cards_layout.setSpacing(16)

        self.card_total_patients = StatCard(
            "Total Patients", "0", "All active registered records", "👥", COLORS["primary"]
        )
        cards_layout.addWidget(self.card_total_patients)

        self.card_today_registrations = StatCard(
            "Today's Admissions", "0", "New registrations today", "📅", COLORS["accent"]
        )
        cards_layout.addWidget(self.card_today_registrations)

        self.card_active_cases = StatCard(
            "Active Cases", "0", "Ongoing therapy treatment plans", "🩺", COLORS["secondary"]
        )
        cards_layout.addWidget(self.card_active_cases)

        self.card_pending_balance = StatCard(
            "Outstanding Balance", "₹0.00", "Pending collection from cases", "💰", "#E11D48"
        )
        cards_layout.addWidget(self.card_pending_balance)

        root_layout.addLayout(cards_layout)

        # 3. Quick Action Bar
        actions_frame = QFrame()
        actions_frame.setObjectName("CardPanel")
        actions_layout = QHBoxLayout(actions_frame)
        actions_layout.setContentsMargins(16, 12, 16, 12)
        actions_layout.setSpacing(12)

        quick_label = QLabel("Quick Actions:")
        quick_label.setStyleSheet("font-weight: 600; color: #475569;")
        actions_layout.addWidget(quick_label)

        btn_new_patient = QPushButton("➕  Register New Patient")
        btn_new_patient.setObjectName("PrimaryButton")
        btn_new_patient.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_new_patient.clicked.connect(lambda: self.navigate_to.emit(1))
        actions_layout.addWidget(btn_new_patient)

        btn_view_patients = QPushButton("📋  Search Patients")
        btn_view_patients.setObjectName("SecondaryButton")
        btn_view_patients.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_view_patients.clicked.connect(lambda: self.navigate_to.emit(1))
        actions_layout.addWidget(btn_view_patients)

        btn_new_treatment = QPushButton("🩺  Treatment Sessions")
        btn_new_treatment.setObjectName("SecondaryButton")
        btn_new_treatment.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_new_treatment.clicked.connect(lambda: self.navigate_to.emit(2))
        actions_layout.addWidget(btn_new_treatment)

        actions_layout.addStretch()
        root_layout.addWidget(actions_frame)

        # 4. Recent Admissions Section
        recent_header = QLabel("Recent Patient Admissions")
        recent_header.setStyleSheet(
            f"font-size: 15px; font-weight: 700; color: {COLORS['text_primary']}; margin-top: 8px;"
        )
        root_layout.addWidget(recent_header)

        self.recent_table = QTableWidget()
        self.recent_table.setObjectName("CardPanel")
        self.recent_table.setColumnCount(5)
        self.recent_table.setHorizontalHeaderLabels([
            "Serial / URN", "Patient Name", "Age / Sex", "Condition", "Registered At"
        ])
        header_view = self.recent_table.horizontalHeader()
        header_view.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        header_view.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        header_view.setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        header_view.setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        header_view.setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        self.recent_table.setAlternatingRowColors(True)
        self.recent_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.recent_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.recent_table.setMinimumHeight(200)

        root_layout.addWidget(self.recent_table)

        # Initial data load
        self.refresh_data()

    def refresh_data(self):
        """Fetches the latest statistics and recent patients from SQLite."""
        stats = self.service.get_statistics()

        self.card_total_patients.set_value(str(stats["total_patients"]))
        self.card_today_registrations.set_value(str(stats["today_registrations"]))
        self.card_active_cases.set_value(str(stats["active_cases"]))
        self.card_pending_balance.set_value(f"₹{stats['pending_balance_rupees']:,.2f}")

        # Populate recent patients table
        recent_patients = self.service.get_recent_registrations(limit=5)
        self.recent_table.setRowCount(len(recent_patients))

        for row, patient in enumerate(recent_patients):
            self.recent_table.setItem(
                row, 0, QTableWidgetItem(str(patient.get("serial_urn_no", "")))
            )
            self.recent_table.setItem(
                row, 1, QTableWidgetItem(str(patient.get("patient_name", "")))
            )
            age_sex = f"{patient.get('age', '')} / {patient.get('sex', '')}"
            self.recent_table.setItem(row, 2, QTableWidgetItem(age_sex))
            self.recent_table.setItem(
                row, 3, QTableWidgetItem(str(patient.get("patient_condition", "")))
            )
            self.recent_table.setItem(
                row, 4, QTableWidgetItem(str(patient.get("registered_at", ""))[:16])
            )
