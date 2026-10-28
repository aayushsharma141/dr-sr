"""
Operational dashboard for Kalyan Hospital.
Displays live SQLite metrics and actual same-day clinic activity only.
"""
from pathlib import Path

from PySide6.QtCore import Qt, Signal, QDateTime
from PySide6.QtGui import QColor, QPixmap
from PySide6.QtWidgets import (
    QFrame, QHBoxLayout, QHeaderView, QLabel, QPushButton,
    QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
)

from app.config import (
    CLINIC_1_ADDR, CLINIC_2_ADDR, COLORS, DOCTORS, HOSPITAL_DEPT,
    HOSPITAL_NAME, HOSPITAL_NAME_HINDI, TRUST_NAME,
)
from app.services.dashboard_service import DashboardService


def _rgba(hex_color: str, alpha: int) -> str:
    """Convert #RRGGBB into Qt stylesheet rgba() syntax."""
    value = hex_color.lstrip("#")
    red, green, blue = (int(value[i:i + 2], 16) for i in (0, 2, 4))
    return f"rgba({red}, {green}, {blue}, {alpha})"


ASSET_DIR = Path(__file__).resolve().parents[2] / "assets"


class StatCard(QFrame):
    """Compact metric card with a restrained brand accent."""

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
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setMinimumHeight(98)

        accent = accent_color or COLORS["accent"]
        layout = QVBoxLayout(self)
        layout.setContentsMargins(13, 10, 13, 10)
        layout.setSpacing(4)

        accent_line = QFrame()
        accent_line.setFixedHeight(3)
        accent_line.setStyleSheet(f"background:{accent};border-radius:1px;")
        layout.addWidget(accent_line)

        header = QHBoxLayout()
        header.setContentsMargins(0, 0, 0, 0)
        header.setSpacing(4)
        title_lbl = QLabel(title.upper())
        title_lbl.setObjectName("StatCardTitle")
        title_lbl.setWordWrap(True)
        header.addWidget(title_lbl, stretch=1)

        icon_badge = QLabel(icon)
        icon_badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
        icon_badge.setFixedSize(27, 27)
        icon_badge.setStyleSheet(
            f"background:{_rgba(accent, 22)};color:{accent};border:1px solid {_rgba(accent, 85)};"
            "border-radius:7px;font-weight:800;font-size:10px;"
        )
        header.addWidget(icon_badge)
        layout.addLayout(header)

        self.value_lbl = QLabel(initial_value)
        self.value_lbl.setObjectName("StatCardValue")
        self.value_lbl.setStyleSheet(f"color:{accent};font-size:24px;")
        layout.addWidget(self.value_lbl)

        sub_lbl = QLabel(subtitle)
        sub_lbl.setObjectName("StatCardSubtitle")
        sub_lbl.setWordWrap(True)
        layout.addWidget(sub_lbl)

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
        root_layout.setContentsMargins(18, 12, 18, 12)
        root_layout.setSpacing(8)

        # Compact trust/hospital identity. Printed prescription branding remains separate.
        header_box = QFrame()
        header_box.setObjectName("CardPanel")
        header_layout = QHBoxLayout(header_box)
        header_layout.setContentsMargins(12, 9, 12, 9)
        header_layout.setSpacing(10)

        logo_lbl = QLabel()
        logo_lbl.setObjectName("HospitalLogo")
        logo_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        logo_lbl.setFixedSize(56, 56)
        logo_pixmap = QPixmap(str(ASSET_DIR / "kalyan_hospital_logo.jpg"))
        if not logo_pixmap.isNull():
            logo_lbl.setPixmap(logo_pixmap.scaled(
                logo_lbl.size(),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            ))
        else:
            logo_lbl.setText("KH")
            logo_lbl.setStyleSheet(
                f"background:{COLORS['primary_dark']};color:#FFFFFF;"
                "border-radius:8px;font-size:18px;font-weight:800;"
            )
        header_layout.addWidget(logo_lbl, alignment=Qt.AlignmentFlag.AlignTop)

        header_text = QVBoxLayout()
        header_text.setSpacing(2)
        title_lbl = QLabel(f"{HOSPITAL_NAME_HINDI}  |  {HOSPITAL_NAME}")
        title_lbl.setObjectName("PageHeading")
        title_lbl.setStyleSheet("font-size:18px;")
        title_lbl.setWordWrap(True)
        header_text.addWidget(title_lbl)

        sub_info = QLabel(f"{HOSPITAL_DEPT}  ·  {TRUST_NAME}")
        sub_info.setStyleSheet(
            f"color:{COLORS['primary']};font-size:9px;font-weight:800;letter-spacing:.2px;"
        )
        sub_info.setWordWrap(True)
        header_text.addWidget(sub_info)

        doctor_names = "  |  ".join(doctor["name_en"] for doctor in DOCTORS)
        doctor_info = QLabel(doctor_names)
        doctor_info.setObjectName("PageSubheading")
        doctor_info.setWordWrap(True)
        header_text.addWidget(doctor_info)
        header_layout.addLayout(header_text, stretch=1)

        scene_lbl = QLabel()
        scene_lbl.setObjectName("PhysiotherapyHeaderImage")
        scene_lbl.setFixedSize(158, 64)
        scene_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        scene_lbl.setToolTip("Physiotherapist assisting a patient during a knee-mobility exercise")
        scene_pixmap = QPixmap(str(ASSET_DIR / "physiotherapy_header.jpg"))
        if not scene_pixmap.isNull():
            scene_lbl.setPixmap(scene_pixmap.scaled(
                scene_lbl.size(),
                Qt.AspectRatioMode.IgnoreAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            ))
        else:
            scene_lbl.setText("PHYSIOTHERAPY")
        scene_lbl.setStyleSheet(
            "border:1px solid #DDE5DF;border-radius:7px;background:#F5F7F5;"
        )
        header_layout.addWidget(scene_lbl)

        self.clock_label = QLabel(QDateTime.currentDateTime().toString("ddd, dd MMM yyyy  ·  hh:mm AP"))
        self.clock_label.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        self.clock_label.setStyleSheet(f"color:{COLORS['text_secondary']};font-size:10px;")
        header_layout.addWidget(self.clock_label)
        root_layout.addWidget(header_box)

        # Branch details, compactly displayed instead of a promotional banner.
        branch_info = QFrame()
        branch_info.setObjectName("ClinicInfoBar")
        branch_info.setStyleSheet(
            f"QFrame#ClinicInfoBar {{ background:{COLORS['primary_dark']};border-radius:6px; }}"
        )
        branch_layout = QHBoxLayout(branch_info)
        branch_layout.setContentsMargins(10, 6, 10, 6)
        branch_layout.setSpacing(10)
        branch_title = QLabel("CLINIC LOCATIONS")
        branch_title.setStyleSheet("color:#D9C27A;font-size:9px;font-weight:800;letter-spacing:.5px;")
        branch_layout.addWidget(branch_title, alignment=Qt.AlignmentFlag.AlignTop)
        addresses = QLabel(f"ARA  ·  {CLINIC_1_ADDR}\nGADHANI  ·  {CLINIC_2_ADDR}")
        addresses.setStyleSheet("color:#FFFFFF;font-size:9px;")
        addresses.setWordWrap(True)
        branch_layout.addWidget(addresses, stretch=1)
        offline_badge = QLabel("● OFFLINE · LOCAL DATA")
        offline_badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
        offline_badge.setStyleSheet(
            "background:#E7F5EB;color:#155B43;border:1px solid #C5E5D0;"
            "border-radius:5px;padding:6px 8px;font-size:9px;font-weight:800;"
        )
        branch_layout.addWidget(offline_badge, alignment=Qt.AlignmentFlag.AlignTop)
        root_layout.addWidget(branch_info)

        # Live KPI cards; figures are never hard-coded sample counts.
        cards_layout = QHBoxLayout()
        cards_layout.setSpacing(9)
        self.card_total_patients = StatCard(
            "Total Patients", "0", "Registered patient records", "PT", COLORS["primary"]
        )
        self.card_today_registrations = StatCard(
            "Today's Admissions", "0", "Registrations today", "TODAY", COLORS["accent"]
        )
        self.card_active_cases = StatCard(
            "Active Cases", "0", "Ongoing treatment plans", "TX", COLORS["secondary"]
        )
        self.card_pending_balance = StatCard(
            "Outstanding Balance", "₹0.00", "Unpaid fees on active cases", "₹", COLORS["danger"]
        )
        for card in (
            self.card_total_patients,
            self.card_today_registrations,
            self.card_active_cases,
            self.card_pending_balance,
        ):
            cards_layout.addWidget(card)
        root_layout.addLayout(cards_layout)

        # One-click work actions. Registration is a distinct action, not just directory navigation.
        actions_frame = QFrame()
        actions_frame.setObjectName("CardPanel")
        actions_layout = QHBoxLayout(actions_frame)
        actions_layout.setContentsMargins(10, 7, 10, 7)
        actions_layout.setSpacing(7)

        quick_label = QLabel("QUICK ACTIONS")
        quick_label.setStyleSheet(
            f"font-size:9px;font-weight:800;letter-spacing:.5px;color:{COLORS['text_secondary']};"
        )
        actions_layout.addWidget(quick_label)

        btn_new_patient = QPushButton("+  Register Patient")
        btn_new_patient.setObjectName("PrimaryButton")
        btn_new_patient.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_new_patient.clicked.connect(self.register_patient_requested.emit)
        actions_layout.addWidget(btn_new_patient)

        btn_view_patients = QPushButton("Patient Registry")
        btn_view_patients.setObjectName("SecondaryButton")
        btn_view_patients.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_view_patients.clicked.connect(lambda: self.navigate_to.emit(1))
        actions_layout.addWidget(btn_view_patients)

        btn_new_treatment = QPushButton("Treatment Sessions")
        btn_new_treatment.setObjectName("SecondaryButton")
        btn_new_treatment.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_new_treatment.clicked.connect(lambda: self.navigate_to.emit(2))
        actions_layout.addWidget(btn_new_treatment)

        btn_payments = QPushButton("Billing & Payments")
        btn_payments.setObjectName("SecondaryButton")
        btn_payments.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_payments.clicked.connect(lambda: self.navigate_to.emit(3))
        actions_layout.addWidget(btn_payments)
        actions_layout.addStretch()
        root_layout.addWidget(actions_frame)

        # Real today activity: registrations and treatment sessions saved today.
        table_header = QHBoxLayout()
        title_activity = QLabel("Today's Patient Activity")
        title_activity.setObjectName("PageHeading")
        title_activity.setStyleSheet("font-size:15px;")
        table_header.addWidget(title_activity)
        table_header.addStretch()
        refresh_btn = QPushButton("Refresh")
        refresh_btn.setObjectName("SecondaryButton")
        refresh_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        refresh_btn.clicked.connect(self._on_manual_refresh)
        table_header.addWidget(refresh_btn)
        activity_hint = QLabel("REAL SQLITE ACTIVITY  ·  DOUBLE-CLICK OR OPEN A PATIENT")
        activity_hint.setStyleSheet(
            f"color:{COLORS['text_secondary']};font-size:8px;font-weight:800;letter-spacing:.3px;"
        )
        table_header.addWidget(activity_hint)
        root_layout.addLayout(table_header)

        self.activity_empty = QLabel(
            "No registrations or treatment sessions have been recorded today."
        )
        self.activity_empty.setObjectName("EmptyStateLabel")
        self.activity_empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.activity_empty.setMinimumHeight(64)
        self.activity_empty.setStyleSheet(
            f"background:#FFFFFF;color:{COLORS['text_secondary']};border:1px dashed {COLORS['border']};"
            "border-radius:8px;padding:12px;"
        )
        root_layout.addWidget(self.activity_empty)

        self.recent_table = QTableWidget()
        self.activity_table = self.recent_table  # Keep the original public attribute for compatibility.
        self.recent_table.setObjectName("TodayActivityTable")
        self.recent_table.setColumnCount(5)
        self.recent_table.setHorizontalHeaderLabels([
            "Activity", "Patient / URN", "Condition", "Time", "Action"
        ])
        header_view = self.recent_table.horizontalHeader()
        header_view.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        header_view.setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        header_view.setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        header_view.setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        header_view.setSectionResizeMode(4, QHeaderView.ResizeMode.Fixed)
        self.recent_table.setColumnWidth(4, 72)
        self.recent_table.setAlternatingRowColors(True)
        self.recent_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.recent_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.recent_table.setShowGrid(False)
        self.recent_table.verticalHeader().setDefaultSectionSize(40)
        self.recent_table.verticalHeader().setMinimumSectionSize(40)
        self.recent_table.cellDoubleClicked.connect(self._on_activity_double_clicked)
        root_layout.addWidget(self.recent_table, stretch=1)

        footer = QLabel(
            "KALYAN HOSPITAL  ·  Physiotherapy Management System  ·  "
            "Patient information is stored on this computer"
        )
        footer.setAlignment(Qt.AlignmentFlag.AlignRight)
        footer.setStyleSheet(f"color:{COLORS['text_secondary']};font-size:9px;padding-top:1px;")
        root_layout.addWidget(footer)

        self.refresh_data()

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
            self.recent_table.setItem(row, 2, QTableWidgetItem(str(activity.get("patient_condition") or "")))
            activity_at = str(activity.get("activity_at") or "")
            self.recent_table.setItem(row, 3, QTableWidgetItem(activity_at[-8:-3] if len(activity_at) >= 16 else activity_at))

            open_btn = QPushButton("Open")
            open_btn.setObjectName("SecondaryButton")
            open_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            open_btn.setMinimumHeight(27)
            open_btn.clicked.connect(
                lambda _checked=False, pid=patient_id, patient_urn=urn:
                    self._on_open_activity_patient(pid, patient_urn)
            )
            self.recent_table.setCellWidget(row, 4, open_btn)
