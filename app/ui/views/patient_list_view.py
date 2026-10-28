"""
Searchable Patient Directory with registry filters and a side-by-side patient summary.
All filters use read-only service/repository queries; patient updates still use the
existing edit form and the same patient/treatment/billing services.
"""
from __future__ import annotations

import os
from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QCursor, QPixmap
from PySide6.QtWidgets import (
    QButtonGroup,
    QComboBox,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMenu,
    QProgressBar,
    QPushButton,
    QSplitter,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.config import COLORS
from app.services.billing_service import BillingService
from app.services.doctor_service import DoctorService
from app.services.document_builder import DocumentBuilder
from app.services.patient_service import PatientService
from app.services.print_service import PrintService
from app.services.treatment_service import TreatmentService
from qfluentwidgets import (
    Action,
    ElevatedCardWidget,
    FluentIcon,
    PillPushButton,
    PrimaryPushButton,
    ProgressBar,
    PushButton,
    RoundMenu,
    SearchLineEdit,
    SplitPushButton,
    TableWidget,
)


REGISTRY_FILTERS = (
    ("all", "All Patients"),
    ("today", "Admitted Today"),
    ("active_therapy", "Active Therapy"),
    ("pending_balance", "Pending Balance"),
)


class PatientListView(QWidget):
    """Patient directory with fast filtering, quick profile, and direct clinical actions."""

    register_clicked = Signal()
    edit_clicked = Signal(int)
    open_treatment_clicked = Signal(int)

    def __init__(
        self,
        patient_service: PatientService | None = None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.service = patient_service or PatientService()
        db_path = self.service.db_path
        self.treatment_service = TreatmentService(db_path)
        self.billing_service = BillingService(db_path)
        self.doctor_service = DoctorService(db_path)
        self._active_filter = "all"
        self._active_doctor_id: int | None = None
        self._profile_patient: dict | None = None
        self._profile_cases: list[dict] = []
        self._profile_selected_case: dict | None = None

        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(20, 14, 20, 12)
        root_layout.setSpacing(9)

        # Header and primary action.
        top_row = QHBoxLayout()
        header_text = QVBoxLayout()
        header_text.setSpacing(2)
        title_lbl = QLabel("Patient Registry")
        title_lbl.setObjectName("PageHeading")
        title_lbl.setStyleSheet("font-size:20px;")
        header_text.addWidget(title_lbl)

        subtitle_lbl = QLabel("Find a record, review clinical progress, or open treatment.")
        subtitle_lbl.setObjectName("PageSubheading")
        header_text.addWidget(subtitle_lbl)
        top_row.addLayout(header_text)
        top_row.addStretch()

        btn_new = PrimaryPushButton(FluentIcon.ADD, "Register New Patient")
        btn_new.setObjectName("PrimaryButton")
        btn_new.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_new.clicked.connect(self.register_clicked.emit)
        top_row.addWidget(btn_new)
        root_layout.addLayout(top_row)

        # Search input.
        search_panel = QFrame()
        search_panel.setObjectName("CardPanel")
        search_layout = QHBoxLayout(search_panel)
        search_layout.setContentsMargins(12, 8, 12, 8)
        search_layout.setSpacing(10)

        self.search_input = SearchLineEdit()
        self.search_input.setObjectName("PatientRegistrySearch")
        self.search_input.setPlaceholderText("Search by patient name, KH-YYYY-XXXX, or mobile number…")
        self.search_input.setClearButtonEnabled(True)
        self.search_input.setMinimumHeight(36)
        self.search_input.textChanged.connect(self._on_search_changed)
        search_layout.addWidget(self.search_input, stretch=1)

        self.doctor_filter = QComboBox()
        self.doctor_filter.setObjectName("DoctorFilter")
        self.doctor_filter.setMinimumWidth(230)
        self.doctor_filter.addItem("All doctors", None)
        for doctor in self.doctor_service.list_doctors():
            self.doctor_filter.addItem(doctor["name_en"], doctor["id"])
        self.doctor_filter.currentIndexChanged.connect(self._on_doctor_changed)
        search_layout.addWidget(self.doctor_filter)

        refresh_btn = QPushButton("Refresh")
        refresh_btn.setObjectName("SecondaryButton")
        refresh_btn.clicked.connect(lambda: self.reload_patients())
        search_layout.addWidget(refresh_btn)
        root_layout.addWidget(search_panel)

        # Filter chips map to parameterized read-only SQL in PatientRepository.
        filter_row = QHBoxLayout()
        filter_row.setSpacing(7)
        self.filter_group = QButtonGroup(self)
        self.filter_group.setExclusive(True)
        self.filter_buttons: dict[str, QPushButton] = {}
        for key, label in REGISTRY_FILTERS:
            button = PillPushButton(label)
            button.setObjectName("FilterChip")
            button.setCheckable(True)
            button.setCursor(Qt.CursorShape.PointingHandCursor)
            button.setMinimumHeight(30)
            button.setChecked(key == "all")
            button.clicked.connect(lambda _checked=False, filter_key=key: self._on_filter_changed(filter_key))
            self.filter_group.addButton(button)
            self.filter_buttons[key] = button
            filter_row.addWidget(button)
        filter_row.addStretch(1)
        root_layout.addLayout(filter_row)

        # Main work area: the table remains full width until a patient is selected.
        self.splitter = QSplitter(Qt.Orientation.Horizontal, self)
        self.splitter.setChildrenCollapsible(True)
        self.splitter.setHandleWidth(5)

        self.table = TableWidget()
        self.table.setObjectName("PatientRegistryTable")
        self.table.setColumnCount(7)
        self.table.setHorizontalHeaderLabels([
            "Serial / URN",
            "Patient Name",
            "Age / Sex",
            "Mobile No.",
            "Condition",
            "Doctor",
            "",
        ])
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(5, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(6, QHeaderView.ResizeMode.Fixed)
        self.table.setColumnWidth(6, 178)
        self.table.setAlternatingRowColors(False)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.setShowGrid(False)
        self.table.cellDoubleClicked.connect(self._on_cell_double_clicked)
        self.table.itemSelectionChanged.connect(self._on_selection_changed)
        self.table.verticalHeader().setVisible(False)
        self.table.verticalHeader().setDefaultSectionSize(40)
        self.table.verticalHeader().setMinimumSectionSize(40)
        self.splitter.addWidget(self.table)

        self.profile_panel = self._build_profile_panel()
        self.profile_panel.hide()
        self.splitter.addWidget(self.profile_panel)
        self.splitter.setCollapsible(0, False)
        self.splitter.setCollapsible(1, True)
        self.splitter.setSizes([1000, 0])
        root_layout.addWidget(self.splitter, stretch=1)

        self.status_lbl = QLabel("Loading patient directory…")
        self.status_lbl.setStyleSheet(f"color:{COLORS['text_secondary']};font-size:10px;")
        root_layout.addWidget(self.status_lbl)

        self.reload_patients()

    def _build_profile_panel(self) -> QFrame:
        panel = ElevatedCardWidget()
        panel.setObjectName("PatientProfilePanel")
        panel.setMinimumWidth(265)
        panel.setMaximumWidth(360)

        layout = QVBoxLayout(panel)
        layout.setContentsMargins(13, 12, 13, 12)
        layout.setSpacing(7)

        heading = QHBoxLayout()
        heading_lbl = QLabel("PATIENT QUICK VIEW")
        heading_lbl.setStyleSheet(
            f"font-size:9px;font-weight:800;letter-spacing:.6px;color:{COLORS['primary']};"
        )
        heading.addWidget(heading_lbl)
        heading.addStretch()
        self.profile_close_btn = QPushButton("×")
        self.profile_close_btn.setObjectName("SecondaryButton")
        self.profile_close_btn.setFixedSize(28, 26)
        self.profile_close_btn.clicked.connect(self._hide_profile)
        heading.addWidget(self.profile_close_btn)
        layout.addLayout(heading)

        identity = QHBoxLayout()
        self.profile_photo = QLabel("KH")
        self.profile_photo.setObjectName("PatientProfilePhoto")
        self.profile_photo.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.profile_photo.setFixedSize(66, 66)
        self.profile_photo.setStyleSheet(
            f"background:#E7F5EB;color:{COLORS['primary']};border:1px solid {COLORS['border']};"
            "border-radius:8px;font-size:18px;font-weight:800;"
        )
        identity.addWidget(self.profile_photo, alignment=Qt.AlignmentFlag.AlignTop)

        name_box = QVBoxLayout()
        name_box.setSpacing(3)
        self.profile_name = QLabel("Select a patient")
        self.profile_name.setWordWrap(True)
        self.profile_name.setStyleSheet("font-size:14px;font-weight:800;color:#202B33;")
        name_box.addWidget(self.profile_name)
        self.profile_urn = QLabel("")
        self.profile_urn.setWordWrap(True)
        self.profile_urn.setStyleSheet(f"font-size:10px;color:{COLORS['primary']};font-weight:800;")
        name_box.addWidget(self.profile_urn)
        self.profile_doctor = QLabel("")
        self.profile_doctor.setWordWrap(True)
        self.profile_doctor.setStyleSheet(f"font-size:11px;font-weight:700;color:{COLORS['primary']};")
        name_box.addWidget(self.profile_doctor)
        self.profile_demographics = QLabel("")
        self.profile_demographics.setWordWrap(True)
        self.profile_demographics.setStyleSheet(f"font-size:10px;color:{COLORS['text_secondary']};")
        name_box.addWidget(self.profile_demographics)
        identity.addLayout(name_box, stretch=1)
        layout.addLayout(identity)

        layout.addWidget(self._profile_section_title("CLINICAL SUMMARY"))
        self.profile_condition = QLabel("Condition not selected")
        self.profile_condition.setWordWrap(True)
        self.profile_condition.setStyleSheet("font-size:12px;font-weight:700;color:#202B33;")
        layout.addWidget(self.profile_condition)

        self.profile_contact = QLabel("")
        self.profile_contact.setWordWrap(True)
        self.profile_contact.setStyleSheet(f"font-size:10px;color:{COLORS['text_secondary']};")
        layout.addWidget(self.profile_contact)

        self.profile_address = QLabel("")
        self.profile_address.setWordWrap(True)
        self.profile_address.setStyleSheet(f"font-size:10px;color:{COLORS['text_secondary']};")
        layout.addWidget(self.profile_address)

        layout.addWidget(self._profile_section_title("TREATMENT PROGRESS"))
        self.profile_case = QLabel("No treatment case")
        self.profile_case.setWordWrap(True)
        self.profile_case.setStyleSheet("font-size:11px;font-weight:700;color:#202B33;")
        layout.addWidget(self.profile_case)

        self.profile_progress_label = QLabel("No sessions recorded")
        self.profile_progress_label.setStyleSheet(f"font-size:10px;color:{COLORS['text_secondary']};")
        layout.addWidget(self.profile_progress_label)

        self.profile_progress = ProgressBar()
        self.profile_progress.setObjectName("PatientProfileProgress")
        self.profile_progress.setRange(0, 100)
        self.profile_progress.setFixedHeight(9)
        self.profile_progress.setTextVisible(False)
        layout.addWidget(self.profile_progress)

        self.profile_balance = QLabel("Outstanding balance: —")
        self.profile_balance.setWordWrap(True)
        self.profile_balance.setStyleSheet(
            "background:#F5F7F5;border:1px solid #DDE5DF;border-radius:6px;"
            "padding:7px;font-size:11px;font-weight:800;color:#202B33;"
        )
        layout.addWidget(self.profile_balance)

        layout.addStretch(1)

        self.profile_edit_btn = PushButton(FluentIcon.EDIT, "Edit Patient")
        self.profile_edit_btn.setObjectName("SecondaryButton")
        self.profile_edit_btn.clicked.connect(self._on_profile_edit)
        layout.addWidget(self.profile_edit_btn)

        self.profile_treatment_btn = PrimaryPushButton(FluentIcon.HEART, "Open Treatment")
        self.profile_treatment_btn.setObjectName("PrimaryButton")
        self.profile_treatment_btn.clicked.connect(self._on_profile_treatment)
        layout.addWidget(self.profile_treatment_btn)

        print_row = QHBoxLayout()
        self.profile_rx_btn = SplitPushButton(FluentIcon.PRINT, "Print Rx")
        self.profile_rx_btn.setObjectName("SecondaryButton")
        self.profile_rx_btn.clicked.connect(lambda: self._print_profile_patient("rx", "direct"))
        rx_menu = RoundMenu(parent=self)
        act_rx_prn = Action(FluentIcon.PRINT, "Print Rx (Send to Printer)", self)
        act_rx_prn.triggered.connect(lambda: self._print_profile_patient("rx", "direct"))
        rx_menu.addAction(act_rx_prn)
        act_rx_prev = Action(FluentIcon.VIEW, "Preview Rx", self)
        act_rx_prev.triggered.connect(lambda: self._print_profile_patient("rx", "preview"))
        rx_menu.addAction(act_rx_prev)
        act_rx_pdf = Action(FluentIcon.SAVE, "Export Rx PDF...", self)
        act_rx_pdf.triggered.connect(lambda: self._print_profile_patient("rx", "pdf"))
        rx_menu.addAction(act_rx_pdf)
        self.profile_rx_btn.setFlyout(rx_menu)
        print_row.addWidget(self.profile_rx_btn)

        self.profile_record_btn = SplitPushButton(FluentIcon.DOCUMENT, "Print Record")
        self.profile_record_btn.setObjectName("SecondaryButton")
        self.profile_record_btn.clicked.connect(lambda: self._print_profile_patient("record", "direct"))
        rec_menu = RoundMenu(parent=self)
        act_rec_prn = Action(FluentIcon.PRINT, "Print Record (Send to Printer)", self)
        act_rec_prn.triggered.connect(lambda: self._print_profile_patient("record", "direct"))
        rec_menu.addAction(act_rec_prn)
        act_rec_prev = Action(FluentIcon.VIEW, "Preview Record", self)
        act_rec_prev.triggered.connect(lambda: self._print_profile_patient("record", "preview"))
        rec_menu.addAction(act_rec_prev)
        act_rec_pdf = Action(FluentIcon.SAVE, "Export Record PDF...", self)
        act_rec_pdf.triggered.connect(lambda: self._print_profile_patient("record", "pdf"))
        rec_menu.addAction(act_rec_pdf)
        self.profile_record_btn.setFlyout(rec_menu)
        print_row.addWidget(self.profile_record_btn)
        layout.addLayout(print_row)

        return panel

    @staticmethod
    def _profile_section_title(text: str) -> QLabel:
        label = QLabel(text)
        label.setStyleSheet(
            f"font-size:9px;font-weight:800;letter-spacing:.5px;color:{COLORS['primary']};"
            f"border-bottom:1px solid {COLORS['border']};padding:5px 0 3px 0;"
        )
        return label

    def _on_search_changed(self, text: str):
        self.reload_patients(query=text)

    def _on_doctor_changed(self, _index: int):
        self._active_doctor_id = self.doctor_filter.currentData()
        self._hide_profile()
        self.reload_patients(query=self.search_input.text())

    def _on_filter_changed(self, filter_key: str):
        self._active_filter = filter_key
        self._hide_profile()
        self.reload_patients(query=self.search_input.text())

    def reload_patients(self, query: str = ""):
        """Refresh records from the existing patient-search service and selected filter."""
        self._hide_profile()
        active_query = query if query else self.search_input.text()
        patients = self.service.search_patients(
            active_query,
            limit=500,
            filter_key=self._active_filter,
            doctor_id=self._active_doctor_id,
        )

        self.table.blockSignals(True)
        self.table.clearSelection()
        self.table.setRowCount(len(patients))

        for row, patient in enumerate(patients):
            urn_item = QTableWidgetItem(str(patient.get("serial_urn_no", "")))
            urn_item.setData(Qt.ItemDataRole.UserRole, patient["id"])
            urn_item.setFont(self.font())
            self.table.setItem(row, 0, urn_item)
            self.table.setItem(row, 1, QTableWidgetItem(str(patient.get("patient_name", ""))))
            self.table.setItem(row, 2, QTableWidgetItem(f"{patient.get('age', '')} / {patient.get('sex', '')}"))
            self.table.setItem(row, 3, QTableWidgetItem(str(patient.get("mobile_no", ""))))
            self.table.setItem(row, 4, QTableWidgetItem(str(patient.get("patient_condition", ""))))

            self.table.setItem(row, 5, QTableWidgetItem(str(patient.get("doctor_name") or "Unassigned")))

            actions_widget = QWidget()
            actions_layout = QHBoxLayout(actions_widget)
            actions_layout.setContentsMargins(4, 2, 4, 2)
            actions_layout.setSpacing(4)

            edit_btn = QPushButton("Edit")
            edit_btn.setObjectName("SecondaryButton")
            edit_btn.setStyleSheet("padding:4px 7px;font-size:10px;")
            edit_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            patient_id = int(patient["id"])
            edit_btn.clicked.connect(lambda _checked=False, pid=patient_id: self.edit_clicked.emit(pid))
            actions_layout.addWidget(edit_btn)

            treatment_btn = QPushButton("Session")
            treatment_btn.setObjectName("SecondaryButton")
            treatment_btn.setStyleSheet(f"padding:4px 7px;font-size:10px;color:{COLORS['secondary']};")
            treatment_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            treatment_btn.clicked.connect(lambda _checked=False, pid=patient_id: self.open_treatment_clicked.emit(pid))
            actions_layout.addWidget(treatment_btn)

            print_btn = QPushButton("Print")
            print_btn.setObjectName("SecondaryButton")
            print_btn.setStyleSheet("padding:4px 7px;font-size:10px;")
            print_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            print_btn.clicked.connect(lambda _checked=False, p=patient: self._on_print_patient(p))
            actions_layout.addWidget(print_btn)
            self.table.setCellWidget(row, 6, actions_widget)

        self.table.blockSignals(False)
        count = len(patients)
        filter_label = dict(REGISTRY_FILTERS).get(self._active_filter, "All Patients")
        if self._active_doctor_id is not None:
            filter_label = f"{filter_label} · {self.doctor_filter.currentText()}"
        if count == 0:
            if active_query:
                self.status_lbl.setText(f"No records matching '{active_query}' in {filter_label}.")
            else:
                self.status_lbl.setText(f"No records found for {filter_label.lower()}.")
        else:
            suffix = " · latest 500 records" if count == 500 else ""
            self.status_lbl.setText(f"{count} patient record(s) · {filter_label}{suffix}. Select a row for quick view.")

    def _on_selection_changed(self):
        item = self.table.item(self.table.currentRow(), 0) if self.table.currentRow() >= 0 else None
        if item is None:
            self._hide_profile()
            return
        patient_id = item.data(Qt.ItemDataRole.UserRole)
        if patient_id:
            self._show_patient_profile(int(patient_id))

    def _show_patient_profile(self, patient_id: int):
        patient = self.service.get_patient(patient_id)
        if not patient:
            self._hide_profile()
            return

        self._profile_patient = patient
        self._profile_cases = self.treatment_service.get_patient_cases(patient_id)

        name = str(patient.get("patient_name") or "Patient")
        self.profile_name.setText(name)
        self.profile_urn.setText(str(patient.get("serial_urn_no") or ""))
        doctor_text = patient.get("doctor_name") or "No doctor assigned"
        if patient.get("doctor_department"):
            doctor_text += f" · {patient['doctor_department']}"
        self.profile_doctor.setText(doctor_text)
        self.profile_demographics.setText(f"{patient.get('age', '')} years · {patient.get('sex', '')}")
        self.profile_condition.setText(str(patient.get("patient_condition") or "Condition not recorded"))
        self.profile_contact.setText(f"Mobile: {patient.get('mobile_no') or '—'}")
        self.profile_address.setText(f"Address: {patient.get('address') or '—'}")

        photo_path = patient.get("photo_full_path")
        photo_pixmap = QPixmap(str(photo_path)) if photo_path and Path(str(photo_path)).exists() else QPixmap()
        if not photo_pixmap.isNull():
            self.profile_photo.setPixmap(photo_pixmap.scaled(
                self.profile_photo.size(),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            ))
            self.profile_photo.setText("")
        else:
            initials = "".join(part[:1] for part in name.split()[:2]).upper() or "PT"
            self.profile_photo.setPixmap(QPixmap())
            self.profile_photo.setText(initials)

        # Show the active case first, otherwise the most recent available case.
        sorted_cases = sorted(
            self._profile_cases,
            key=lambda case: (case.get("status") == "IN_PROGRESS", case.get("id", 0)),
            reverse=True,
        )
        selected_case = sorted_cases[0] if sorted_cases else None
        self._profile_selected_case = selected_case
        if selected_case:
            history = self.treatment_service.get_case_with_history(int(selected_case["id"]))
            self.profile_case.setText(
                f"{history.get('title', 'Treatment')} · {history.get('status', 'IN_PROGRESS')}"
            )
            self.profile_progress_label.setText(
                f"{history.get('completed_sessions', 0)} of {history.get('target_sessions', 0)} sessions · "
                f"{history.get('progress_pct', 0)}%"
            )
            self.profile_progress.setValue(int(history.get("progress_pct", 0)))
        else:
            self.profile_case.setText("No treatment case recorded")
            self.profile_progress_label.setText("Open a treatment case to track sessions")
            self.profile_progress.setValue(0)

        # Total due is aggregated from existing billing summaries rather than a UI-side formula.
        total_balance_paise = 0
        has_partial_due = False
        for case in self._profile_cases:
            try:
                summary = self.billing_service.get_financial_summary(int(case["id"]))
                case_balance = int(summary.get("balance_paise", 0))
                total_balance_paise += case_balance
                if case_balance > 0 and int(summary.get("total_paid_paise", 0)) > 0:
                    has_partial_due = True
            except Exception:
                continue
        balance_text = self.billing_service.format_inr(total_balance_paise)
        if total_balance_paise > 0:
            status = "PARTIAL DUE" if has_partial_due else "BALANCE DUE"
            self.profile_balance.setText(f"{status} · Outstanding balance: {balance_text}")
            self.profile_balance.setStyleSheet(
                "background:#FFF7E6;color:#8A4B08;border:1px solid #F2D49B;"
                "border-radius:6px;padding:7px;font-size:11px;font-weight:800;"
            )
        else:
            self.profile_balance.setText(f"PAID IN FULL · Outstanding balance: {balance_text}")
            self.profile_balance.setStyleSheet(
                "background:#E7F5EB;color:#155B43;border:1px solid #C5E5D0;"
                "border-radius:6px;padding:7px;font-size:11px;font-weight:800;"
            )

        self.profile_panel.show()
        width = max(560, self.splitter.width())
        pane_width = min(340, max(255, int(width * 0.33)))
        self.splitter.setSizes([max(300, width - pane_width), pane_width])

    def _hide_profile(self):
        if hasattr(self, "profile_panel"):
            self.profile_panel.hide()
            if hasattr(self, "splitter"):
                self.splitter.setSizes([max(1, self.splitter.width()), 0])

    def _on_profile_edit(self):
        if self._profile_patient:
            self.edit_clicked.emit(int(self._profile_patient["id"]))

    def _on_profile_treatment(self):
        if self._profile_patient:
            self.open_treatment_clicked.emit(int(self._profile_patient["id"]))

    def _print_profile_patient(self, document_type: str, action_mode: str = "direct"):
        if self._profile_patient:
            self._on_print_patient(self._profile_patient, document_type, action_mode=action_mode)

    def _on_print_patient(
        self,
        patient_dict: dict,
        document_type: str | None = None,
        action_mode: str = "direct",
    ):
        """Build the selected document and print directly, preview, or export to PDF."""
        patient_name = patient_dict.get("patient_name", "Patient")
        urn = patient_dict.get("serial_urn_no", "Record")

        if document_type == "rx":
            html = DocumentBuilder.build_prescription_slip_html(patient_dict)
            title = f"Prescription Slip — {patient_name}"
            default_pdf = f"Prescription_{urn}_{patient_name.replace(' ', '_')}.pdf"
            if action_mode == "direct":
                if PrintService.print_document(html, parent=self, title=title) and hasattr(self.window(), "show_toast"):
                    self.window().show_toast("Sent to Printer", f"Prescription for {patient_name} sent to printer.", "success")
            elif action_mode == "pdf":
                saved = PrintService.export_to_pdf_with_dialog(html, parent=self, default_name=default_pdf)
                if saved and hasattr(self.window(), "show_toast"):
                    self.window().show_toast("PDF Exported", f"Saved to {os.path.basename(saved)}", "success")
            else:
                PrintService.show_print_preview(html, parent=self, title=title)
            return

        if document_type == "record":
            financial_summary = None
            case_data = None
            if self._profile_selected_case:
                case_data = self.treatment_service.get_case_with_history(int(self._profile_selected_case["id"]))
                financial_summary = self.billing_service.get_financial_summary(int(case_data["id"]))
            html = DocumentBuilder.build_patient_registration_html(
                patient_dict,
                case_data=case_data,
                financial_summary=financial_summary,
            )
            title = f"Registration Card — {patient_name}"
            default_pdf = f"Registration_{urn}_{patient_name.replace(' ', '_')}.pdf"
            if action_mode == "direct":
                if PrintService.print_document(html, parent=self, title=title) and hasattr(self.window(), "show_toast"):
                    self.window().show_toast("Sent to Printer", f"Registration record for {patient_name} sent to printer.", "success")
            elif action_mode == "pdf":
                saved = PrintService.export_to_pdf_with_dialog(html, parent=self, default_name=default_pdf)
                if saved and hasattr(self.window(), "show_toast"):
                    self.window().show_toast("PDF Exported", f"Saved to {os.path.basename(saved)}", "success")
            else:
                PrintService.show_print_preview(html, parent=self, title=title)
            return

        # When triggered from the table row Print button without preselected type, show full action menu
        menu = RoundMenu(parent=self)
        act_print_rx = Action(FluentIcon.PRINT, "Print Rx Pad (Send to Printer)", self)
        act_print_rx.triggered.connect(lambda: self._on_print_patient(patient_dict, "rx", "direct"))
        menu.addAction(act_print_rx)

        act_print_rec = Action(FluentIcon.PRINT, "Print Registration Card (Send to Printer)", self)
        act_print_rec.triggered.connect(lambda: self._on_print_patient(patient_dict, "record", "direct"))
        menu.addAction(act_print_rec)

        menu.addSeparator()

        act_prev_rx = Action(FluentIcon.VIEW, "Preview Rx Pad", self)
        act_prev_rx.triggered.connect(lambda: self._on_print_patient(patient_dict, "rx", "preview"))
        menu.addAction(act_prev_rx)

        act_prev_rec = Action(FluentIcon.VIEW, "Preview Registration Card", self)
        act_prev_rec.triggered.connect(lambda: self._on_print_patient(patient_dict, "record", "preview"))
        menu.addAction(act_prev_rec)

        menu.addSeparator()

        act_pdf_rx = Action(FluentIcon.SAVE, "Export Rx as PDF...", self)
        act_pdf_rx.triggered.connect(lambda: self._on_print_patient(patient_dict, "rx", "pdf"))
        menu.addAction(act_pdf_rx)

        act_pdf_rec = Action(FluentIcon.SAVE, "Export Registration as PDF...", self)
        act_pdf_rec.triggered.connect(lambda: self._on_print_patient(patient_dict, "record", "pdf"))
        menu.addAction(act_pdf_rec)

        menu.exec(QCursor.pos())

    def _on_cell_double_clicked(self, row: int, _col: int):
        item = self.table.item(row, 0)
        if item:
            patient_id = item.data(Qt.ItemDataRole.UserRole)
            if patient_id:
                self.edit_clicked.emit(patient_id)
