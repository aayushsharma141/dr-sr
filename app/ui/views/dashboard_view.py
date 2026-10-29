"""
Operational dashboard for Kalyan Hospital.
Displays live SQLite metrics, clinician caseload profiles, and interactive activity / patient queues.
"""
from pathlib import Path
from typing import Any

from PySide6.QtCore import QDateTime, Qt, Signal
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QButtonGroup,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QPushButton,
    QScrollArea,
    QStackedWidget,
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
    """Modern clinical metric card: crisp left accent pillar, tinted icon tile, large figure, quiet caption."""

    def __init__(
        self,
        title: str,
        initial_value: str,
        subtitle: str,
        icon,
        accent_color: str | None = None,
        badge_text: str | None = None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.setObjectName("StatCard")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setMinimumHeight(116)

        accent = accent_color or COLORS["accent"]
        self.accent_color = accent
        self.setStyleSheet(
            f"QFrame#StatCard {{ border-left: 4px solid {accent}; border-radius: 12px; }}"
        )

        root = QVBoxLayout(self)
        root.setContentsMargins(18, 14, 18, 14)
        root.setSpacing(6)

        # Top row: icon + title + badge
        top_row = QHBoxLayout()
        top_row.setSpacing(10)

        icon_tile = QLabel()
        icon_tile.setFixedSize(40, 40)
        icon_tile.setAlignment(Qt.AlignmentFlag.AlignCenter)
        icon_tile.setStyleSheet(
            f"background:{_rgba(accent, 22)}; border-radius:10px; border:1px solid {_rgba(accent, 50)};"
        )
        icon_tile.setPixmap(icon.icon(color=QColor(accent)).pixmap(20, 20))
        top_row.addWidget(icon_tile)

        title_col = QVBoxLayout()
        title_col.setSpacing(1)
        title_lbl = QLabel(title.upper())
        title_lbl.setObjectName("StatCardTitle")
        title_col.addWidget(title_lbl)

        if badge_text:
            badge = QLabel(badge_text)
            badge.setStyleSheet(
                f"background:{_rgba(accent, 16)}; color:{accent}; font-size:9px; font-weight:800; border-radius:4px; padding:1px 5px;"
            )
            title_col.addWidget(badge, alignment=Qt.AlignmentFlag.AlignLeft)
        top_row.addLayout(title_col, stretch=1)
        root.addLayout(top_row)

        # Value
        self.value_lbl = QLabel(initial_value)
        self.value_lbl.setObjectName("StatCardValue")
        self.value_lbl.setStyleSheet(f"color:{COLORS['text_primary']};font-size:27px;font-weight:800;")
        root.addWidget(self.value_lbl)

        # Subtitle
        self.sub_lbl = QLabel(subtitle)
        self.sub_lbl.setObjectName("StatCardSubtitle")
        root.addWidget(self.sub_lbl)

    def set_value(self, text: str):
        self.value_lbl.setText(text)
        if "₹" in text and text != "₹0.00":
            self.value_lbl.setStyleSheet(f"color:{COLORS['danger']};font-size:27px;font-weight:800;")


class DoctorCard(ElevatedCardWidget):
    """Clinician profile card with avatar initials, credentials, caseload metrics, and direct filter action."""

    filter_requested = Signal(int)

    def __init__(
        self,
        doctor: dict[str, Any],
        accent_color: str,
        initials: str,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.setObjectName("DoctorProfileCard")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.doctor_id = int(doctor.get("doctor_id") or doctor.get("id") or 1)
        self.setStyleSheet(
            f"QFrame#DoctorProfileCard {{ border-left: 4px solid {accent_color}; border-radius: 12px; }}"
        )

        layout = QVBoxLayout(self)
        layout.setContentsMargins(18, 16, 18, 16)
        layout.setSpacing(12)

        # Top section: Avatar + Details
        top_row = QHBoxLayout()
        top_row.setSpacing(12)

        avatar = QLabel(initials)
        avatar.setFixedSize(48, 48)
        avatar.setAlignment(Qt.AlignmentFlag.AlignCenter)
        avatar.setStyleSheet(
            f"background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 {accent_color}, stop:1 {_rgba(accent_color, 190)});"
            "color: #FFFFFF; font-size: 15px; font-weight: 800; border-radius: 12px;"
        )
        top_row.addWidget(avatar)

        name_col = QVBoxLayout()
        name_col.setSpacing(2)

        name_en = QLabel(doctor.get("name_en") or "")
        name_en.setObjectName("DoctorCardName")
        name_col.addWidget(name_en)

        hindi = doctor.get("name_hindi") or ""
        if hindi:
            name_hi = QLabel(hindi)
            name_hi.setObjectName("DoctorCardHindi")
            name_col.addWidget(name_hi)

        dept = doctor.get("department") or ""
        if dept:
            dept_badge = QLabel(dept)
            dept_badge.setObjectName("DoctorCardDept")
            name_col.addWidget(dept_badge)

        top_row.addLayout(name_col, stretch=1)

        status_lbl = QLabel("● ON DUTY")
        status_lbl.setStyleSheet(
            f"color:{COLORS['success']}; background:{_rgba(COLORS['success'], 18)};"
            "font-size:9px; font-weight:800; border-radius:4px; padding:3px 7px;"
        )
        top_row.addWidget(status_lbl, alignment=Qt.AlignmentFlag.AlignTop)
        layout.addLayout(top_row)

        # Mini Metrics Strip
        stats_row = QHBoxLayout()
        stats_row.setSpacing(8)

        def _make_stat_box(val: str, lbl: str):
            box = QFrame()
            box.setObjectName("DoctorStatBox")
            b_layout = QVBoxLayout(box)
            b_layout.setContentsMargins(8, 7, 8, 7)
            b_layout.setSpacing(2)
            v = QLabel(val)
            v.setObjectName("DoctorStatVal")
            v.setAlignment(Qt.AlignmentFlag.AlignCenter)
            b_layout.addWidget(v)
            l = QLabel(lbl)
            l.setObjectName("DoctorStatLbl")
            l.setAlignment(Qt.AlignmentFlag.AlignCenter)
            b_layout.addWidget(l)
            return box

        stats_row.addWidget(_make_stat_box(str(doctor.get("today_registrations", 0)), "TODAY"))
        stats_row.addWidget(_make_stat_box(str(doctor.get("total_patients", 0)), "PATIENTS"))
        stats_row.addWidget(_make_stat_box(str(doctor.get("active_cases", 0)), "ACTIVE CASES"))
        layout.addLayout(stats_row)

        # Bottom button: View Caseload
        btn_caseload = PushButton(FluentIcon.PEOPLE, "View Doctor Caseload")
        btn_caseload.setObjectName("SecondaryButton")
        btn_caseload.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_caseload.setFixedHeight(30)
        btn_caseload.clicked.connect(lambda: self.filter_requested.emit(self.doctor_id))
        layout.addWidget(btn_caseload)


class DashboardView(QWidget):
    """Operational overview backed by SQLite services with live clinic activity and quick patient queue."""

    navigate_to = Signal(int)
    register_patient_requested = Signal()
    open_patient_requested = Signal(int, str)
    filter_doctor_requested = Signal(int)
    manual_refresh_completed = Signal()

    def __init__(
        self,
        dashboard_service: DashboardService | None = None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.setObjectName("DashboardView")
        self.service = dashboard_service or DashboardService()
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)

        # Outer layout with scroll area to prevent clipping on small displays
        outer_layout = QVBoxLayout(self)
        outer_layout.setContentsMargins(0, 0, 0, 0)
        outer_layout.setSpacing(0)

        scroll_area = QScrollArea(self)
        scroll_area.setObjectName("DashboardScroll")
        scroll_area.setWidgetResizable(True)
        scroll_area.setFrameShape(QFrame.Shape.NoFrame)
        scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        outer_layout.addWidget(scroll_area)

        content_widget = QWidget()
        content_widget.setObjectName("DashboardContent")
        scroll_area.setWidget(content_widget)

        root_layout = QVBoxLayout(content_widget)
        root_layout.setContentsMargins(24, 20, 24, 20)
        root_layout.setSpacing(18)

        # 1. Clinic Hero Card: Context on the left, Primary actions on the right.
        hero_card = QFrame()
        hero_card.setObjectName("DashboardHeroCard")
        hero_layout = QHBoxLayout(hero_card)
        hero_layout.setContentsMargins(20, 16, 20, 16)
        hero_layout.setSpacing(16)

        greeting_box = QVBoxLayout()
        greeting_box.setSpacing(3)
        hour = QDateTime.currentDateTime().time().hour()
        part = "morning" if hour < 12 else "afternoon" if hour < 17 else "evening"
        self.greeting_label = QLabel(f"Good {part}, Kalyan Team")
        self.greeting_label.setObjectName("PageHeading")
        self.greeting_label.setStyleSheet("font-size:22px; font-weight:800;")
        greeting_box.addWidget(self.greeting_label)

        date_str = QDateTime.currentDateTime().toString("dddd, dd MMMM yyyy")
        self.clock_label = QLabel(
            f"📅  {date_str}   ·   🏥  Physiotherapy Department   ·   📍  Ara & Garhani"
        )
        self.clock_label.setObjectName("PageSubheading")
        self.clock_label.setStyleSheet(f"color:{COLORS['text_secondary']};font-size:12px;font-weight:500;")
        greeting_box.addWidget(self.clock_label)
        hero_layout.addLayout(greeting_box, stretch=1)

        # Action buttons
        btn_new_patient = PrimaryPushButton(FluentIcon.ADD, "Register Patient")
        btn_new_patient.setObjectName("PrimaryButton")
        btn_new_patient.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_new_patient.setToolTip("Register a new patient (F2)")
        btn_new_patient.clicked.connect(self.register_patient_requested.emit)
        hero_layout.addWidget(btn_new_patient, alignment=Qt.AlignmentFlag.AlignVCenter)

        btn_new_treatment = PushButton(FluentIcon.HEART, "Log Session")
        btn_new_treatment.setObjectName("SecondaryButton")
        btn_new_treatment.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_new_treatment.setToolTip("Record a therapy session")
        btn_new_treatment.clicked.connect(lambda: self.navigate_to.emit(2))
        hero_layout.addWidget(btn_new_treatment, alignment=Qt.AlignmentFlag.AlignVCenter)

        btn_payments = PushButton(FluentIcon.TAG, "Record Payment")
        btn_payments.setObjectName("SecondaryButton")
        btn_payments.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_payments.setToolTip("Record a payment transaction")
        btn_payments.clicked.connect(lambda: self.navigate_to.emit(3))
        hero_layout.addWidget(btn_payments, alignment=Qt.AlignmentFlag.AlignVCenter)

        root_layout.addWidget(hero_card)

        # 2. Live KPI Cards: Registered, Today's Admissions, Active Cases, Balance.
        cards_layout = QHBoxLayout()
        cards_layout.setSpacing(14)
        self.card_total_patients = StatCard(
            "Total Patients", "0", "Registered patient records",
            FluentIcon.PEOPLE, COLORS["primary"], badge_text="DATABASE"
        )
        self.card_today_registrations = StatCard(
            "Today's Admissions", "0", "Registrations today",
            FluentIcon.ADD_TO, COLORS["accent"], badge_text="TODAY"
        )
        self.card_active_cases = StatCard(
            "Active Cases", "0", "Ongoing treatment plans",
            FluentIcon.HEART, COLORS["secondary"], badge_text="IN PROGRESS"
        )
        self.card_pending_balance = StatCard(
            "Outstanding Balance", "₹0.00", "Unpaid fees on active cases",
            FluentIcon.TAG, COLORS["danger"], badge_text="FEES DUE"
        )
        for card in (
            self.card_total_patients,
            self.card_today_registrations,
            self.card_active_cases,
            self.card_pending_balance,
        ):
            cards_layout.addWidget(card)
        root_layout.addLayout(cards_layout)

        # 3. Clinician Overview: Clinician profile cards.
        self.doctor_row = QHBoxLayout()
        self.doctor_row.setSpacing(14)
        root_layout.addLayout(self.doctor_row)

        # 4. Activity & Recent Patient Queue
        section_box = QVBoxLayout()
        section_box.setSpacing(10)

        table_header = QHBoxLayout()
        table_header.setSpacing(12)

        title_box = QVBoxLayout()
        title_box.setSpacing(1)
        title_activity = QLabel("Clinic Activity & Patient Queue")
        title_activity.setObjectName("PageHeading")
        title_activity.setStyleSheet("font-size:16px; font-weight:700;")
        title_box.addWidget(title_activity)
        activity_hint = QLabel("Daily clinic operations and quick access to recently registered patients.")
        activity_hint.setObjectName("PageSubheading")
        title_box.addWidget(activity_hint)
        table_header.addLayout(title_box)

        table_header.addStretch(1)

        # Segmented view switch: Today's Activity vs Recent Patients
        self.tab_group = QButtonGroup(self)
        self.tab_group.setExclusive(True)

        self.btn_tab_today = QPushButton("📅  Today's Activity (0)")
        self.btn_tab_today.setObjectName("SegmentTabBtn")
        self.btn_tab_today.setCheckable(True)
        self.btn_tab_today.setCursor(Qt.CursorShape.PointingHandCursor)
        self.tab_group.addButton(self.btn_tab_today, 0)
        table_header.addWidget(self.btn_tab_today)

        self.btn_tab_recent = QPushButton("👥  Recent Patients (0)")
        self.btn_tab_recent.setObjectName("SegmentTabBtn")
        self.btn_tab_recent.setCheckable(True)
        self.btn_tab_recent.setCursor(Qt.CursorShape.PointingHandCursor)
        self.tab_group.addButton(self.btn_tab_recent, 1)
        table_header.addWidget(self.btn_tab_recent)

        self.tab_group.idClicked.connect(self._on_tab_changed)

        refresh_btn = PushButton(FluentIcon.SYNC, "Refresh")
        refresh_btn.setObjectName("SecondaryButton")
        refresh_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        refresh_btn.clicked.connect(self._on_manual_refresh)
        table_header.addWidget(refresh_btn)

        section_box.addLayout(table_header)

        # Housing Card for tables
        table_container = QFrame()
        table_container.setObjectName("TableContainerCard")
        table_container_layout = QVBoxLayout(table_container)
        table_container_layout.setContentsMargins(14, 14, 14, 14)

        # Stacked pages: Page 0 = Today's Activity, Page 1 = Recent Patients
        self.activity_stack = QStackedWidget()

        # --- Page 0: Today's Activity ---
        page_today = QWidget()
        page_today_layout = QVBoxLayout(page_today)
        page_today_layout.setContentsMargins(0, 0, 0, 0)
        page_today_layout.setSpacing(8)

        # Friendly Empty State when today has no activity yet
        self.activity_empty_container = QFrame()
        self.activity_empty_container.setObjectName("EmptyStateContainer")
        empty_layout = QVBoxLayout(self.activity_empty_container)
        empty_layout.setContentsMargins(24, 28, 24, 28)
        empty_layout.setSpacing(10)
        empty_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

        empty_icon = QLabel()
        empty_icon.setAlignment(Qt.AlignmentFlag.AlignCenter)
        empty_icon.setPixmap(FluentIcon.CALENDAR.icon(color=QColor(COLORS["primary"])).pixmap(36, 36))
        empty_layout.addWidget(empty_icon)

        empty_title = QLabel("No Clinic Activity Logged Today Yet")
        empty_title.setStyleSheet(f"font-size:16px; font-weight:700; color:{COLORS['text_primary']};")
        empty_title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        empty_layout.addWidget(empty_title)

        self.activity_empty = QLabel(
            "Clinic is open and ready. Register today's first arrival or pick a recent patient from file."
        )
        self.activity_empty.setObjectName("EmptyStateLabel")
        self.activity_empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.activity_empty.setStyleSheet(f"color:{COLORS['text_secondary']};font-size:13px;")
        empty_layout.addWidget(self.activity_empty)

        empty_btns = QHBoxLayout()
        empty_btns.setSpacing(10)
        empty_btns.setAlignment(Qt.AlignmentFlag.AlignCenter)
        btn_empty_register = PrimaryPushButton(FluentIcon.ADD, "Register First Patient Today")
        btn_empty_register.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_empty_register.clicked.connect(self.register_patient_requested.emit)
        empty_btns.addWidget(btn_empty_register)

        btn_switch_recent = PushButton(FluentIcon.PEOPLE, "View Recent Patients on File")
        btn_switch_recent.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_switch_recent.clicked.connect(lambda: self._set_active_tab(1))
        empty_btns.addWidget(btn_switch_recent)
        empty_layout.addLayout(empty_btns)

        page_today_layout.addWidget(self.activity_empty_container)

        self.recent_table = TableWidget()
        self.activity_table = self.recent_table
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
        self.recent_table.setAlternatingRowColors(True)
        self.recent_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.recent_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.recent_table.setShowGrid(False)
        self.recent_table.verticalHeader().setDefaultSectionSize(46)
        self.recent_table.verticalHeader().setMinimumSectionSize(46)
        self.recent_table.cellDoubleClicked.connect(self._on_activity_double_clicked)
        page_today_layout.addWidget(self.recent_table)

        self.activity_stack.addWidget(page_today)

        # --- Page 1: Recent Patients on File ---
        page_recent = QWidget()
        page_recent_layout = QVBoxLayout(page_recent)
        page_recent_layout.setContentsMargins(0, 0, 0, 0)
        page_recent_layout.setSpacing(8)

        self.recent_patients_table = TableWidget()
        self.recent_patients_table.setObjectName("RecentPatientsTable")
        self.recent_patients_table.setColumnCount(7)
        self.recent_patients_table.setHorizontalHeaderLabels([
            "URN", "PATIENT NAME", "CONTACT", "DOCTOR", "CONDITION / DIAGNOSIS", "REGISTERED", ""
        ])
        recent_header = self.recent_patients_table.horizontalHeader()
        recent_header.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        recent_header.setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        recent_header.setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        recent_header.setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        recent_header.setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)
        recent_header.setSectionResizeMode(5, QHeaderView.ResizeMode.ResizeToContents)
        recent_header.setSectionResizeMode(6, QHeaderView.ResizeMode.Fixed)
        self.recent_patients_table.setColumnWidth(6, 84)
        self.recent_patients_table.verticalHeader().hide()
        self.recent_patients_table.setAlternatingRowColors(True)
        self.recent_patients_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.recent_patients_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.recent_patients_table.setShowGrid(False)
        self.recent_patients_table.verticalHeader().setDefaultSectionSize(46)
        self.recent_patients_table.verticalHeader().setMinimumSectionSize(46)
        self.recent_patients_table.cellDoubleClicked.connect(self._on_recent_patient_double_clicked)
        page_recent_layout.addWidget(self.recent_patients_table)

        self.activity_stack.addWidget(page_recent)

        table_container_layout.addWidget(self.activity_stack)
        section_box.addWidget(table_container)
        root_layout.addLayout(section_box, stretch=1)

        self.refresh_data()

    def _on_tab_changed(self, tab_id: int):
        self.activity_stack.setCurrentIndex(tab_id)

    def _set_active_tab(self, tab_id: int):
        self.activity_stack.setCurrentIndex(tab_id)
        if tab_id == 0:
            self.btn_tab_today.setChecked(True)
        else:
            self.btn_tab_recent.setChecked(True)

    def _render_doctor_overview(self) -> None:
        while self.doctor_row.count():
            item = self.doctor_row.takeAt(0)
            if item.widget() is not None:
                item.widget().deleteLater()

        doctor_data = self.service.get_doctor_overview()
        accent_colors = [COLORS["primary"], COLORS["secondary"]]
        doctor_initials = ["MD", "CD"]

        for idx, doctor in enumerate(doctor_data):
            accent = accent_colors[idx % len(accent_colors)]
            initials = doctor_initials[idx % len(doctor_initials)]
            card = DoctorCard(doctor, accent_color=accent, initials=initials)
            card.filter_requested.connect(self.filter_doctor_requested.emit)
            self.doctor_row.addWidget(card, stretch=1)

    def _on_activity_double_clicked(self, row: int, _column: int) -> None:
        item = self.recent_table.item(row, 0)
        if item is None:
            return
        patient_id = item.data(Qt.ItemDataRole.UserRole)
        urn = item.data(Qt.ItemDataRole.UserRole + 1)
        if patient_id:
            self.open_patient_requested.emit(int(patient_id), str(urn or ""))

    def _on_recent_patient_double_clicked(self, row: int, _column: int) -> None:
        item = self.recent_patients_table.item(row, 0)
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
        """Refresh live aggregates, clinician caseloads, and real activity / patient queues."""
        stats = self.service.get_statistics()
        self.card_total_patients.set_value(str(stats["total_patients"]))
        self.card_today_registrations.set_value(str(stats["today_registrations"]))
        self.card_active_cases.set_value(str(stats["active_cases"]))
        self.card_pending_balance.set_value(f"₹{stats['pending_balance_rupees']:,.2f}")

        self._render_doctor_overview()

        # 1. Today's Activity Table
        activities = self.service.get_today_activity(limit=8)
        self.recent_table.setRowCount(len(activities))
        has_today = bool(activities)
        self.activity_empty_container.setVisible(not has_today)
        self.recent_table.setVisible(has_today)
        self.btn_tab_today.setText(f"📅  Today's Activity ({len(activities)})")

        for row, activity in enumerate(activities):
            patient_id = int(activity.get("patient_id") or 0)
            urn = str(activity.get("serial_urn_no") or "")
            act_type = str(activity.get("activity_type") or "Activity")

            activity_item = QTableWidgetItem(f"  ●  {act_type}")
            activity_item.setData(Qt.ItemDataRole.UserRole, patient_id)
            activity_item.setData(Qt.ItemDataRole.UserRole + 1, urn)
            if "Session" in act_type:
                activity_item.setForeground(QColor(COLORS["secondary"]))
            else:
                activity_item.setForeground(QColor(COLORS["primary"]))
            self.recent_table.setItem(row, 0, activity_item)

            patient_label = f"{activity.get('patient_name', '')}  ·  {urn}"
            self.recent_table.setItem(row, 1, QTableWidgetItem(patient_label))
            self.recent_table.setItem(row, 2, QTableWidgetItem(str(activity.get("doctor_name") or "—")))
            self.recent_table.setItem(row, 3, QTableWidgetItem(str(activity.get("patient_condition") or "—")))
            activity_at = str(activity.get("activity_at") or "")
            self.recent_table.setItem(row, 4, QTableWidgetItem(activity_at[-8:-3] if len(activity_at) >= 16 else activity_at))

            open_btn = QPushButton("Open")
            open_btn.setObjectName("SecondaryButton")
            open_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            open_btn.setMinimumHeight(28)
            open_btn.clicked.connect(
                lambda _checked=False, pid=patient_id, patient_urn=urn:
                    self._on_open_activity_patient(pid, patient_urn)
            )
            cell = QWidget()
            cell_layout = QHBoxLayout(cell)
            cell_layout.setContentsMargins(6, 6, 8, 6)
            cell_layout.addWidget(open_btn)
            self.recent_table.setCellWidget(row, 5, cell)

        # 2. Recent Patients on File
        recent_patients = self.service.get_recent_registrations(limit=8)
        self.recent_patients_table.setRowCount(len(recent_patients))
        self.btn_tab_recent.setText(f"👥  Recent Patients ({len(recent_patients)})")

        for row, patient in enumerate(recent_patients):
            patient_id = int(patient.get("id") or 0)
            urn = str(patient.get("serial_urn_no") or "")

            urn_item = QTableWidgetItem(urn)
            urn_item.setData(Qt.ItemDataRole.UserRole, patient_id)
            urn_item.setData(Qt.ItemDataRole.UserRole + 1, urn)
            urn_item.setForeground(QColor(COLORS["primary"]))
            self.recent_patients_table.setItem(row, 0, urn_item)

            name = patient.get("patient_name") or "—"
            demographics = f"{patient.get('sex') or ''}, {patient.get('age') or ''} yrs".strip(", ")
            name_label = f"{name} ({demographics})" if demographics else name
            self.recent_patients_table.setItem(row, 1, QTableWidgetItem(name_label))
            self.recent_patients_table.setItem(row, 2, QTableWidgetItem(str(patient.get("mobile_no") or "—")))
            self.recent_patients_table.setItem(row, 3, QTableWidgetItem(str(patient.get("doctor_name") or "—")))
            self.recent_patients_table.setItem(row, 4, QTableWidgetItem(str(patient.get("patient_condition") or "—")))

            created_at = str(patient.get("created_at") or "")
            created_label = created_at[:10] if len(created_at) >= 10 else created_at
            self.recent_patients_table.setItem(row, 5, QTableWidgetItem(created_label))

            open_btn = QPushButton("Open")
            open_btn.setObjectName("SecondaryButton")
            open_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            open_btn.setMinimumHeight(28)
            open_btn.clicked.connect(
                lambda _checked=False, pid=patient_id, patient_urn=urn:
                    self._on_open_activity_patient(pid, patient_urn)
            )
            cell = QWidget()
            cell_layout = QHBoxLayout(cell)
            cell_layout.setContentsMargins(6, 6, 8, 6)
            cell_layout.addWidget(open_btn)
            self.recent_patients_table.setCellWidget(row, 6, cell)

        # Smart tab selection: if today has activity, show today; otherwise show recent patients
        if has_today:
            self._set_active_tab(0)
        else:
            self._set_active_tab(1)
