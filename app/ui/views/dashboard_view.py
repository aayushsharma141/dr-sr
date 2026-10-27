"""
Live Hospital Dashboard for Kalyan Hospital.
UI-only redesign: keeps existing service calls, data keys, and navigation signals.
"""
from pathlib import Path

from PySide6.QtCore import Qt, Signal, QDateTime
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (
    QFrame, QHBoxLayout, QHeaderView, QLabel, QPushButton,
    QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
)

from app.config import (
    CLINIC_1_ADDR, CLINIC_2_ADDR, COLORS, DOCTORS, HOSPITAL_DEPT,
    HOSPITAL_NAME, HOSPITAL_NAME_HINDI, TRUST_NAME,
)
from app.services.dashboard_service import DashboardService


ASSET_DIR = Path(__file__).resolve().parents[2] / "assets"


class StatCard(QFrame):
    """Compact metric card with a brand-color accent and typographic icon."""

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
        self.setMinimumHeight(112)

        accent = accent_color or COLORS["accent"]
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 13, 16, 13)
        layout.setSpacing(5)

        accent_line = QFrame()
        accent_line.setFixedHeight(3)
        accent_line.setStyleSheet(f"background:{accent};border-radius:1px;")
        layout.addWidget(accent_line)

        header = QHBoxLayout()
        header.setContentsMargins(0, 0, 0, 0)
        title_lbl = QLabel(title.upper())
        title_lbl.setObjectName("StatCardTitle")
        header.addWidget(title_lbl)
        header.addStretch()

        icon_badge = QLabel(icon)
        icon_badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
        icon_badge.setFixedSize(30, 30)
        icon_badge.setStyleSheet(
            f"background:{accent}18;color:{accent};border:1px solid {accent}55;"
            "border-radius:7px;font-weight:800;font-size:11px;"
        )
        header.addWidget(icon_badge)
        layout.addLayout(header)

        self.value_lbl = QLabel(initial_value)
        self.value_lbl.setObjectName("StatCardValue")
        self.value_lbl.setStyleSheet(f"color:{accent};")
        layout.addWidget(self.value_lbl)

        sub_lbl = QLabel(subtitle)
        sub_lbl.setObjectName("StatCardSubtitle")
        sub_lbl.setWordWrap(True)
        layout.addWidget(sub_lbl)

    def set_value(self, text: str):
        self.value_lbl.setText(text)


class DashboardView(QWidget):
    """Operational overview backed by the existing SQLite dashboard service."""

    navigate_to = Signal(int)

    def __init__(
        self,
        dashboard_service: DashboardService | None = None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.service = dashboard_service or DashboardService()
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)

        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(24, 18, 24, 16)
        root_layout.setSpacing(12)

        # Header row: supplied hospital logo, identity, and a correctly positioned
        # physiotherapist helping a patient with a supported knee-flexion exercise.
        header_box = QFrame()
        header_box.setObjectName("CardPanel")
        header_layout = QHBoxLayout(header_box)
        header_layout.setContentsMargins(14, 12, 14, 12)
        header_layout.setSpacing(12)

        logo_lbl = QLabel()
        logo_lbl.setObjectName("HospitalLogo")
        logo_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        logo_lbl.setFixedSize(68, 68)
        logo_path = ASSET_DIR / "kalyan_hospital_logo.jpg"
        logo_pixmap = QPixmap(str(logo_path))
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
        header_text.setSpacing(3)
        title_lbl = QLabel(f"{HOSPITAL_NAME_HINDI}  |  {HOSPITAL_NAME}")
        title_lbl.setObjectName("PageHeading")
        title_lbl.setWordWrap(True)
        header_text.addWidget(title_lbl)

        sub_info = QLabel(f"{HOSPITAL_DEPT}  ·  {TRUST_NAME}")
        sub_info.setStyleSheet(
            f"color:{COLORS['primary']};font-size:10px;font-weight:800;letter-spacing:.25px;"
        )
        sub_info.setWordWrap(True)
        header_text.addWidget(sub_info)

        doctor_names = "  |  ".join(d["name_en"] for d in DOCTORS)
        doctor_info = QLabel(doctor_names)
        doctor_info.setObjectName("PageSubheading")
        doctor_info.setWordWrap(True)
        header_text.addWidget(doctor_info)
        header_layout.addLayout(header_text, stretch=1)

        scene_lbl = QLabel()
        scene_lbl.setObjectName("PhysiotherapyHeaderImage")
        scene_lbl.setFixedSize(232, 96)
        scene_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        scene_lbl.setToolTip("Physiotherapist assisting a patient during a knee-mobility exercise")
        scene_path = ASSET_DIR / "physiotherapy_header.jpg"
        scene_pixmap = QPixmap(str(scene_path))
        if not scene_pixmap.isNull():
            scene_lbl.setPixmap(scene_pixmap.scaled(
                scene_lbl.size(),
                Qt.AspectRatioMode.IgnoreAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            ))
        else:
            scene_lbl.setText("PHYSIOTHERAPY")
            scene_lbl.setStyleSheet(
                f"background:{COLORS['background']};color:{COLORS['primary']};"
                "border:1px solid #E2E8F0;border-radius:8px;font-weight:800;"
            )
        scene_lbl.setStyleSheet(
            scene_lbl.styleSheet() +
            "border:1px solid #E2E8F0;border-radius:8px;background:#F8FAFC;"
        )
        header_layout.addWidget(scene_lbl)

        header_side = QVBoxLayout()
        header_side.setSpacing(6)
        offline_badge = QLabel("●  OFFLINE · LOCAL DATA")
        offline_badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
        offline_badge.setStyleSheet(
            "background:#ECFDF5;color:#166534;border:1px solid #A7F3D0;"
            "border-radius:6px;padding:7px 8px;font-size:9px;font-weight:800;"
        )
        header_side.addWidget(offline_badge)

        self.clock_label = QLabel(QDateTime.currentDateTime().toString("ddd, dd MMM yyyy\nhh:mm AP"))
        self.clock_label.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        self.clock_label.setStyleSheet(f"color:{COLORS['text_secondary']};font-size:10px;")
        header_side.addWidget(self.clock_label)

        refresh_btn = QPushButton("Refresh Data")
        refresh_btn.setObjectName("SecondaryButton")
        refresh_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        refresh_btn.clicked.connect(self.refresh_data)
        header_side.addWidget(refresh_btn)
        header_layout.addLayout(header_side)
        root_layout.addWidget(header_box)

        # Branch addresses are kept visible below the brand header.
        branch_info = QFrame()
        branch_info.setObjectName("ClinicInfoBar")
        branch_info.setStyleSheet(
            f"QFrame#ClinicInfoBar {{ background:{COLORS['primary_dark']};"
            "border-radius:6px; }"
        )
        branch_layout = QHBoxLayout(branch_info)
        branch_layout.setContentsMargins(12, 7, 12, 7)
        branch_layout.setSpacing(10)
        branch_icon = QLabel("CLINIC LOCATIONS")
        branch_icon.setStyleSheet("color:#FFFFFF;font-size:9px;font-weight:800;letter-spacing:.6px;")
        branch_layout.addWidget(branch_icon, alignment=Qt.AlignmentFlag.AlignTop)

        addresses = QLabel(f"ARA: {CLINIC_1_ADDR}\nGADHANI: {CLINIC_2_ADDR}")
        addresses.setStyleSheet("color:#F8FAFC;font-size:10px;")
        addresses.setWordWrap(True)
        branch_layout.addWidget(addresses, stretch=1)
        root_layout.addWidget(branch_info)

        # Live KPIs remain connected to DashboardService, not mock figures.
        cards_layout = QHBoxLayout()
        cards_layout.setSpacing(12)
        self.card_total_patients = StatCard(
            "Total Patients", "0", "Registered patient records", "PT", COLORS["primary"]
        )
        self.card_today_registrations = StatCard(
            "Today's Admissions", "0", "New registrations today", "IN", COLORS["accent"]
        )
        self.card_active_cases = StatCard(
            "Active Cases", "0", "Ongoing treatment plans", "TR", COLORS["secondary"]
        )
        self.card_pending_balance = StatCard(
            "Outstanding Balance", "₹0.00", "Fees pending collection", "₹", COLORS["danger"]
        )
        for card in (
            self.card_total_patients,
            self.card_today_registrations,
            self.card_active_cases,
            self.card_pending_balance,
        ):
            cards_layout.addWidget(card)
        root_layout.addLayout(cards_layout)

        # Existing navigation actions; labels are text-based rather than emoji icons.
        actions_frame = QFrame()
        actions_frame.setObjectName("CardPanel")
        actions_layout = QHBoxLayout(actions_frame)
        actions_layout.setContentsMargins(12, 9, 12, 9)
        actions_layout.setSpacing(8)

        quick_label = QLabel("QUICK ACTIONS")
        quick_label.setStyleSheet(
            f"font-size:10px;font-weight:800;letter-spacing:.6px;color:{COLORS['text_secondary']};"
        )
        actions_layout.addWidget(quick_label)

        btn_new_patient = QPushButton("+  Register Patient")
        btn_new_patient.setObjectName("PrimaryButton")
        btn_new_patient.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_new_patient.clicked.connect(lambda: self.navigate_to.emit(1))
        actions_layout.addWidget(btn_new_patient)

        btn_view_patients = QPushButton("Search Registry")
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

        # Recent admissions table is populated from the same live service method.
        table_header = QHBoxLayout()
        table_title = QLabel("Recent Patient Admissions")
        table_title.setObjectName("PageHeading")
        table_title.setStyleSheet("font-size:16px;")
        table_header.addWidget(table_title)
        table_header.addStretch()
        latest_lbl = QLabel("LATEST 5 RECORDS")
        latest_lbl.setStyleSheet(
            f"color:{COLORS['text_secondary']};font-size:10px;font-weight:700;letter-spacing:.6px;"
        )
        table_header.addWidget(latest_lbl)
        root_layout.addLayout(table_header)

        self.recent_table = QTableWidget()
        self.recent_table.setObjectName("RecentAdmissionsTable")
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
        self.recent_table.verticalHeader().setDefaultSectionSize(40)
        self.recent_table.setMinimumHeight(150)
        root_layout.addWidget(self.recent_table, stretch=1)

        footer = QLabel(
            "KALYAN HOSPITAL  ·  Physiotherapy Management System  ·  "
            "Patient information is stored on this computer"
        )
        footer.setAlignment(Qt.AlignmentFlag.AlignRight)
        footer.setStyleSheet(f"color:{COLORS['text_secondary']};font-size:10px;padding-top:1px;")
        root_layout.addWidget(footer)

        self.refresh_data()

    def refresh_data(self):
        """Fetch current metrics and recent records from the existing SQLite service."""
        stats = self.service.get_statistics()
        self.card_total_patients.set_value(str(stats["total_patients"]))
        self.card_today_registrations.set_value(str(stats["today_registrations"]))
        self.card_active_cases.set_value(str(stats["active_cases"]))
        self.card_pending_balance.set_value(f"₹{stats['pending_balance_rupees']:,.2f}")

        recent_patients = self.service.get_recent_registrations(limit=5)
        self.recent_table.setRowCount(len(recent_patients))
        for row, patient in enumerate(recent_patients):
            self.recent_table.setItem(row, 0, QTableWidgetItem(str(patient.get("serial_urn_no", ""))))
            self.recent_table.setItem(row, 1, QTableWidgetItem(str(patient.get("patient_name", ""))))
            age_sex = f"{patient.get('age', '')} / {patient.get('sex', '')}"
            self.recent_table.setItem(row, 2, QTableWidgetItem(age_sex))
            self.recent_table.setItem(row, 3, QTableWidgetItem(str(patient.get("patient_condition", ""))))
            self.recent_table.setItem(row, 4, QTableWidgetItem(str(patient.get("registered_at", ""))[:16]))
