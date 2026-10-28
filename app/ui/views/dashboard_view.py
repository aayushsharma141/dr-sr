"""
Operational dashboard for Kalyan Hospital.
Displays live SQLite metrics and actual same-day clinic activity only.
"""
from pathlib import Path

from PySide6.QtCore import QDateTime, Qt, Signal
from PySide6.QtGui import QColor
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
from qfluentwidgets import (
    ElevatedCardWidget,
    FluentIcon,
    PrimaryPushButton,
    PushButton,
    TableWidget,
)

from app.config import (
    COLORS,
    DOCTORS,
)
from app.services.dashboard_service import DashboardService


def _rgba(hex_color: str, alpha: int) -> str:
    """Convert #RRGGBB into Qt stylesheet rgba() syntax."""
    value = hex_color.lstrip("#")
    red, green, blue = (int(value[i:i + 2], 16) for i in (0, 2, 4))
    return f"rgba({red}, {green}, {blue}, {alpha})"


ASSET_DIR = Path(__file__).resolve().parents[2] / "assets"


class StatCard(ElevatedCardWidget):
    """Compact metric card: tinted icon tile, large figure, quiet caption."""

    def __init__(
        self,
        title: str,
        initial_value: str,
        subtitle: str,
        icon,
        accent_color: str | None = None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.setObjectName("StatCard")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setMinimumHeight(104)

        accent = accent_color or COLORS["accent"]
        layout = QHBoxLayout(self)
        layout.setContentsMargins(16, 14, 16, 14)
        layout.setSpacing(14)

        icon_tile = QLabel()
        icon_tile.setFixedSize(44, 44)
        icon_tile.setAlignment(Qt.AlignmentFlag.AlignCenter)
        icon_tile.setStyleSheet(f"background:{_rgba(accent, 24)};border-radius:12px;")
        icon_tile.setPixmap(icon.icon(color=QColor(accent)).pixmap(22, 22))
        layout.addWidget(icon_tile, alignment=Qt.AlignmentFlag.AlignTop)

        text_col = QVBoxLayout()
        text_col.setSpacing(2)
        title_lbl = QLabel(title.upper())
        title_lbl.setObjectName("StatCardTitle")
        text_col.addWidget(title_lbl)

        self.value_lbl = QLabel(initial_value)
        self.value_lbl.setObjectName("StatCardValue")
        self.value_lbl.setStyleSheet(f"color:{COLORS['text_primary']};font-size:26px;")
        text_col.addWidget(self.value_lbl)

        sub_lbl = QLabel(subtitle)
        sub_lbl.setObjectName("StatCardSubtitle")
        text_col.addWidget(sub_lbl)
        layout.addLayout(text_col, stretch=1)

    def set_value(self, text: str):
        self.value_lbl.setText(text)


class DashboardView(QWidget):
    """Operational overview backed by the existing SQLite services."""

    navigate_to = Signal(int)
    register_patient_requested = Signal()
    open_patient_requested = Signal(int, str)
    manual_refresh_completed = Signal()

    def __init__(
        self,
        dashboard_service: DashboardService | None = None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.service = dashboard_service or DashboardService()
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)

        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(24, 20, 24, 16)
        root_layout.setSpacing(16)

        # Greeting row: context on the left, primary actions on the right.
        top_row = QHBoxLayout()
        top_row.setSpacing(12)
        greeting = QVBoxLayout()
        greeting.setSpacing(3)
        hour = QDateTime.currentDateTime().time().hour()
        part = "morning" if hour < 12 else "afternoon" if hour < 17 else "evening"
        self.greeting_label = QLabel(f"Good {part}, team")
        self.greeting_label.setObjectName("PageHeading")
        self.greeting_label.setStyleSheet("font-size:24px;")
        greeting.addWidget(self.greeting_label)
        doctor_names = "  ·  ".join(doctor["name_en"] for doctor in DOCTORS)
        self.clock_label = QLabel(
            f"{QDateTime.currentDateTime().toString('dddd, dd MMMM yyyy')}   |   {doctor_names}"
        )
        self.clock_label.setObjectName("PageSubheading")
        self.clock_label.setStyleSheet(f"color:{COLORS['text_secondary']};font-size:12px;")
        greeting.addWidget(self.clock_label)
        top_row.addLayout(greeting, stretch=1)

        btn_new_patient = PrimaryPushButton(FluentIcon.ADD, "Register Patient")
        btn_new_patient.setObjectName("PrimaryButton")
        btn_new_patient.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_new_patient.clicked.connect(self.register_patient_requested.emit)
        top_row.addWidget(btn_new_patient, alignment=Qt.AlignmentFlag.AlignTop)

        btn_new_treatment = PushButton(FluentIcon.HEART, "Log Session")
        btn_new_treatment.setObjectName("SecondaryButton")
        btn_new_treatment.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_new_treatment.clicked.connect(lambda: self.navigate_to.emit(2))
        top_row.addWidget(btn_new_treatment, alignment=Qt.AlignmentFlag.AlignTop)

        btn_payments = PushButton(FluentIcon.TAG, "Record Payment")
        btn_payments.setObjectName("SecondaryButton")
        btn_payments.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_payments.clicked.connect(lambda: self.navigate_to.emit(3))
        top_row.addWidget(btn_payments, alignment=Qt.AlignmentFlag.AlignTop)
        root_layout.addLayout(top_row)

        # Live KPI cards; figures are never hard-coded sample counts.
        cards_layout = QHBoxLayout()
        cards_layout.setSpacing(14)
        self.card_total_patients = StatCard(
            "Total Patients", "0", "Registered patient records", FluentIcon.PEOPLE, COLORS["primary"]
        )
        self.card_today_registrations = StatCard(
            "Today's Admissions", "0", "Registrations today", FluentIcon.ADD_TO, COLORS["accent"]
        )
        self.card_active_cases = StatCard(
            "Active Cases", "0", "Ongoing treatment plans", FluentIcon.HEART, COLORS["secondary"]
        )
        self.card_pending_balance = StatCard(
            "Outstanding Balance", "₹0.00", "Unpaid fees on active cases", FluentIcon.TAG, COLORS["danger"]
        )
        for card in (
            self.card_total_patients,
            self.card_today_registrations,
            self.card_active_cases,
            self.card_pending_balance,
        ):
            cards_layout.addWidget(card)
        root_layout.addLayout(cards_layout)

        # One line per doctor: shared registration and billing, separate caseloads.
        self.doctor_row = QHBoxLayout()
        self.doctor_row.setSpacing(14)
        root_layout.addLayout(self.doctor_row)

        # Today's activity
        table_header = QHBoxLayout()
        title_box = QVBoxLayout()
        title_box.setSpacing(1)
        title_activity = QLabel("Today's Patient Activity")
        title_activity.setObjectName("PageHeading")
        title_activity.setStyleSheet("font-size:16px;")
        title_box.addWidget(title_activity)
        activity_hint = QLabel("Registrations and treatment sessions saved today. Double-click a row to open the patient.")
        activity_hint.setObjectName("PageSubheading")
        title_box.addWidget(activity_hint)
        table_header.addLayout(title_box)
        table_header.addStretch()
        refresh_btn = PushButton(FluentIcon.SYNC, "Refresh")
        refresh_btn.setObjectName("SecondaryButton")
        refresh_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        refresh_btn.clicked.connect(self._on_manual_refresh)
        table_header.addWidget(refresh_btn)
        root_layout.addLayout(table_header)

        self.activity_empty = QLabel(
            "No registrations or treatment sessions have been recorded today."
        )
        self.activity_empty.setObjectName("EmptyStateLabel")
        self.activity_empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.activity_empty.setMinimumHeight(120)
        self.activity_empty.setStyleSheet(
            f"background:#FFFFFF;color:{COLORS['text_secondary']};border:1px dashed {COLORS['border']};"
            "border-radius:10px;padding:12px;"
        )
        root_layout.addWidget(self.activity_empty)

        self.recent_table = TableWidget()
        self.activity_table = self.recent_table  # Keep the original public attribute for compatibility.
        self.recent_table.setObjectName("TodayActivityTable")
        self.recent_table.setColumnCount(6)
        self.recent_table.setHorizontalHeaderLabels([
            "ACTIVITY", "PATIENT / URN", "DOCTOR", "CONDITION", "TIME", ""
        ])
        header_view = self.recent_table.horizontalHeader()
        header_view.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        header_view.setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        header_view.setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        header_view.setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        header_view.setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        header_view.setSectionResizeMode(5, QHeaderView.ResizeMode.Fixed)
        self.recent_table.setColumnWidth(5, 84)
        self.recent_table.verticalHeader().hide()
        self.recent_table.setAlternatingRowColors(False)
        self.recent_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.recent_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.recent_table.setShowGrid(False)
        self.recent_table.verticalHeader().setDefaultSectionSize(46)
        self.recent_table.verticalHeader().setMinimumSectionSize(46)
        self.recent_table.cellDoubleClicked.connect(self._on_activity_double_clicked)
        root_layout.addWidget(self.recent_table, stretch=1)

        self.refresh_data()

    def _render_doctor_overview(self) -> None:
        while self.doctor_row.count():
            item = self.doctor_row.takeAt(0)
            if item.widget() is not None:
                item.widget().deleteLater()
        for doctor in self.service.get_doctor_overview():
            panel = QFrame()
            panel.setObjectName("CardPanel")
            layout = QVBoxLayout(panel)
            layout.setContentsMargins(16, 12, 16, 12)
            layout.setSpacing(3)
            name = QLabel(doctor["name_en"])
            name.setStyleSheet("font-size:14px;font-weight:700;")
            layout.addWidget(name)
            dept = QLabel(doctor.get("department") or "")
            dept.setObjectName("PageSubheading")
            layout.addWidget(dept)
            counts = QLabel(
                f"{doctor['today_registrations']} registered today   ·   "
                f"{doctor['total_patients']} patients   ·   {doctor['active_cases']} active cases"
            )
            counts.setStyleSheet(f"color:{COLORS['primary']};font-size:12px;font-weight:600;")
            layout.addWidget(counts)
            self.doctor_row.addWidget(panel, stretch=1)

    def _on_activity_double_clicked(self, row: int, _column: int) -> None:
        item = self.recent_table.item(row, 0)
        if item is None:
            return
        patient_id = item.data(Qt.ItemDataRole.UserRole)
        urn = item.data(Qt.ItemDataRole.UserRole + 1)
        if patient_id:
            self.open_patient_requested.emit(int(patient_id), str(urn or ""))

    def _on_open_activity_patient(self, patient_id: int, urn: str) -> None:
        self.open_patient_requested.emit(patient_id, urn)

    def _on_manual_refresh(self):
        self.refresh_data()
        self.manual_refresh_completed.emit()

    def refresh_data(self):
        """Refresh live aggregates and real same-day registrations/session events."""
        stats = self.service.get_statistics()
        self.card_total_patients.set_value(str(stats["total_patients"]))
        self.card_today_registrations.set_value(str(stats["today_registrations"]))
        self.card_active_cases.set_value(str(stats["active_cases"]))
        self.card_pending_balance.set_value(f"₹{stats['pending_balance_rupees']:,.2f}")

        self._render_doctor_overview()

        activities = self.service.get_today_activity(limit=8)
        self.recent_table.setRowCount(len(activities))
        self.activity_empty.setVisible(not activities)
        self.recent_table.setVisible(bool(activities))

        for row, activity in enumerate(activities):
            patient_id = int(activity.get("patient_id") or 0)
            urn = str(activity.get("serial_urn_no") or "")
            activity_item = QTableWidgetItem(str(activity.get("activity_type") or "Activity"))
            activity_item.setData(Qt.ItemDataRole.UserRole, patient_id)
            activity_item.setData(Qt.ItemDataRole.UserRole + 1, urn)
            activity_item.setForeground(QColor(COLORS["primary"]))
            self.recent_table.setItem(row, 0, activity_item)

            patient_label = f"{activity.get('patient_name', '')}  ·  {urn}"
            self.recent_table.setItem(row, 1, QTableWidgetItem(patient_label))
            self.recent_table.setItem(row, 2, QTableWidgetItem(str(activity.get("doctor_name") or "—")))
            self.recent_table.setItem(row, 3, QTableWidgetItem(str(activity.get("patient_condition") or "")))
            activity_at = str(activity.get("activity_at") or "")
            self.recent_table.setItem(row, 4, QTableWidgetItem(activity_at[-8:-3] if len(activity_at) >= 16 else activity_at))

            open_btn = QPushButton("Open")
            open_btn.setObjectName("SecondaryButton")
            open_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            open_btn.setMinimumHeight(27)
            open_btn.clicked.connect(
                lambda _checked=False, pid=patient_id, patient_urn=urn:
                    self._on_open_activity_patient(pid, patient_urn)
            )
            cell = QWidget()
            cell_layout = QHBoxLayout(cell)
            cell_layout.setContentsMargins(6, 8, 10, 8)
            cell_layout.addWidget(open_btn)
            self.recent_table.setCellWidget(row, 5, cell)
