"""
Treatment View - Clinical Cases and Chronological Session History.
Kalyan Hospital Management System.
"""

from typing import Any, Dict, List, Optional
from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QTableWidget, QTableWidgetItem, QHeaderView,
    QComboBox, QSpinBox, QDoubleSpinBox, QDialog, QTextEdit,
    QDateTimeEdit, QFormLayout, QProgressBar, QMessageBox,
    QFrame
)
from app.ui.clinical_controls import ModalityChipGroup, PainScaleWidget, PainTrendWidget
from qfluentwidgets import TableWidget, PrimaryPushButton, PushButton, FluentIcon, SplitPushButton, RoundMenu, Action
from app.services.treatment_service import TreatmentService
from app.services.patient_service import PatientService
from app.services.billing_service import BillingService
from app.services.document_builder import DocumentBuilder
from app.services.print_service import PrintService
from app.ui.styles import (
    COLOR_PRIMARY, COLOR_PRIMARY_HOVER, COLOR_SECONDARY,
    COLOR_TEXT_PRIMARY, COLOR_TEXT_MUTED, COLOR_CARD_BG,
    COLOR_BORDER, COLOR_BG, COLOR_SUCCESS, COLOR_WARNING, COLOR_DANGER
)


class NewCaseDialog(QDialog):
    """Modal dialog for opening a new physiotherapy treatment case."""

    def __init__(self, patient_name: str, parent=None):
        super().__init__(parent)
        self.setWindowTitle(f"Open New Treatment Case — {patient_name}")
        self.setMinimumWidth(450)
        self.setStyleSheet(f"""
            QDialog {{ background-color: {COLOR_CARD_BG}; }}
            QLabel {{ color: {COLOR_TEXT_PRIMARY}; font-size: 13px; font-weight: 500; }}
            QLineEdit, QSpinBox, QDoubleSpinBox, QTextEdit {{
                background-color: {COLOR_BG};
                color: {COLOR_TEXT_PRIMARY};
                border: 1px solid {COLOR_BORDER};
                border-radius: 6px;
                padding: 8px;
                font-size: 13px;
            }}
        """)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(22, 20, 22, 20)
        layout.setSpacing(14)

        title_lbl = QLabel("New Physiotherapy Treatment Case")
        title_lbl.setStyleSheet(f"font-size: 17px; font-weight: 700; color: {COLOR_PRIMARY};")
        layout.addWidget(title_lbl)

        form = QFormLayout()
        form.setSpacing(12)

        self.title_input = QLineEdit()
        self.title_input.setPlaceholderText("e.g. Lumbar Spondylosis Rehabilitation")
        form.addRow("Case Title *:", self.title_input)

        self.sessions_input = QSpinBox()
        self.sessions_input.setRange(1, 100)
        self.sessions_input.setValue(10)
        form.addRow("Target Sessions (Field 11) *:", self.sessions_input)

        self.fee_input = QDoubleSpinBox()
        self.fee_input.setRange(0, 500000)
        self.fee_input.setValue(3000.0)
        self.fee_input.setPrefix("₹ ")
        self.fee_input.setDecimals(2)
        form.addRow("Total Agreed Fee (Field 12) *:", self.fee_input)

        self.notes_input = QTextEdit()
        self.notes_input.setPlaceholderText("Clinical diagnosis, initial assessment, referral notes...")
        self.notes_input.setMaximumHeight(80)
        form.addRow("Assessment Notes:", self.notes_input)

        layout.addLayout(form)

        btn_layout = QHBoxLayout()
        btn_layout.addStretch()

        cancel_btn = QPushButton("Cancel")
        cancel_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: transparent;
                color: {COLOR_TEXT_MUTED};
                border: 1px solid {COLOR_BORDER};
                border-radius: 6px;
                padding: 8px 16px;
                font-weight: 600;
            }}
            QPushButton:hover {{ background-color: {COLOR_BORDER}; }}
        """)
        cancel_btn.clicked.connect(self.reject)
        btn_layout.addWidget(cancel_btn)

        save_btn = QPushButton("Create Case")
        save_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: {COLOR_PRIMARY};
                color: white;
                border: none;
                border-radius: 6px;
                padding: 8px 20px;
                font-weight: 600;
            }}
            QPushButton:hover {{ background-color: {COLOR_PRIMARY_HOVER}; }}
        """)
        save_btn.clicked.connect(self.accept)
        btn_layout.addWidget(save_btn)

        layout.addLayout(btn_layout)

    def get_data(self) -> Dict[str, Any]:
        return {
            "title": self.title_input.text().strip(),
            "no_of_sessions": self.sessions_input.value(),
            "total_amount_rupees": self.fee_input.value(),
            "notes": self.notes_input.toPlainText().strip(),
        }


class LogSessionDialog(QDialog):
    """Modal dialog for recording a clinical physiotherapy session."""

    def __init__(self, session_number: int, parent=None):
        super().__init__(parent)
        self.setWindowTitle(f"Log Clinical Session #{session_number}")
        self.setMinimumWidth(700)
        self.resize(740, 600)
        self.setStyleSheet(f"""
            QDialog {{ background-color: {COLOR_CARD_BG}; }}
            QLabel {{ color: {COLOR_TEXT_PRIMARY}; font-size: 12px; font-weight: 500; }}
            QLineEdit, QSpinBox, QComboBox, QTextEdit, QDateTimeEdit {{
                background-color: {COLOR_BG};
                color: {COLOR_TEXT_PRIMARY};
                border: 1px solid {COLOR_BORDER};
                border-radius: 6px;
                padding: 7px;
                font-size: 12px;
            }}
        """)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 18, 20, 18)
        layout.setSpacing(9)

        header_lbl = QLabel(f"Record Clinical Session #{session_number}")
        header_lbl.setStyleSheet(f"font-size: 17px; font-weight: 800; color: {COLOR_PRIMARY};")
        layout.addWidget(header_lbl)

        helper_lbl = QLabel("Record the patient's pain score, modalities applied, and clinical response.")
        helper_lbl.setStyleSheet(f"font-size: 11px; color: {COLOR_TEXT_MUTED};")
        layout.addWidget(helper_lbl)

        form = QFormLayout()
        form.setSpacing(9)

        self.therapist_combo = QComboBox()
        self.therapist_combo.addItems([
            "Dr. Madan Mohan Dwivedi (Senior Physiotherapist)",
            "Dr. Chandan Kr. Dwivedi (Physiotherapist)",
            "Assistant Physiotherapist",
        ])
        form.addRow("Treating Therapist *:", self.therapist_combo)

        self.pain_scale = PainScaleWidget(initial_value=5, parent=self)
        # Keep the previous attribute name available for any UI integrations/tests.
        self.pain_input = self.pain_scale.slider
        form.addRow("Pain Score (VAS):", self.pain_scale)
        layout.addLayout(form)

        self.modality_group = ModalityChipGroup(parent=self)
        self.mod_cbs = self.modality_group.buttons
        layout.addWidget(self.modality_group)

        notes_lbl = QLabel("Clinical Progress Notes *:")
        notes_lbl.setStyleSheet("font-weight:700;")
        layout.addWidget(notes_lbl)

        self.notes_input = QTextEdit()
        self.notes_input.setPlaceholderText(
            "Patient response, range of motion, exercises performed, tolerance, and next-session plan…"
        )
        self.notes_input.setMinimumHeight(78)
        layout.addWidget(self.notes_input, stretch=1)

        btn_layout = QHBoxLayout()
        btn_layout.addStretch()

        cancel_btn = QPushButton("Cancel")
        cancel_btn.setObjectName("SecondaryButton")
        cancel_btn.clicked.connect(self.reject)
        btn_layout.addWidget(cancel_btn)

        save_btn = QPushButton("Save Session Record")
        save_btn.setObjectName("PrimaryButton")
        save_btn.clicked.connect(self.validate_and_accept)
        btn_layout.addWidget(save_btn)
        layout.addLayout(btn_layout)

    def validate_and_accept(self):
        if not self.notes_input.toPlainText().strip():
            QMessageBox.warning(self, "Validation Error", "Clinical treatment notes cannot be empty.")
            return
        self.accept()

    def get_data(self) -> Dict[str, Any]:
        return {
            "therapist_name": self.therapist_combo.currentText().split(" (")[0],
            "pain_score": self.pain_scale.value(),
            "modalities_used": ", ".join(self.modality_group.selected_values()),
            "treatment_notes": self.notes_input.toPlainText().strip(),
        }


class TreatmentView(QWidget):
    """Main view for managing physiotherapy clinical treatment cases and session timelines."""

    view_billing_clicked = Signal(int)  # Emits case_id to open billing ledger
    session_saved = Signal(dict)

    def __init__(self, db_path: Optional[str] = None, parent=None):
        super().__init__(parent)
        self.db_path = db_path
        self.treatment_service = TreatmentService(db_path)
        self.patient_service = PatientService(db_path)
        self.billing_service = BillingService(db_path)

        self.current_patient_id: Optional[int] = None
        self.current_case_id: Optional[int] = None

        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 20, 24, 20)
        layout.setSpacing(14)

        # 1. Header Bar
        header_layout = QHBoxLayout()
        title_box = QVBoxLayout()
        title_lbl = QLabel("Physiotherapy Treatment Cases")
        title_lbl.setStyleSheet(f"font-size: 24px; font-weight: 700; color: {COLOR_PRIMARY};")
        title_box.addWidget(title_lbl)

        subtitle_lbl = QLabel("Clinical history, session progression, and pain evaluation")
        subtitle_lbl.setStyleSheet(f"font-size: 13px; color: {COLOR_TEXT_MUTED};")
        title_box.addWidget(subtitle_lbl)
        header_layout.addLayout(title_box)

        header_layout.addStretch()

        self.new_case_btn = PushButton(FluentIcon.ADD, "Open New Case")
        self.new_case_btn.clicked.connect(self._on_new_case_clicked)
        header_layout.addWidget(self.new_case_btn)

        self.print_rx_btn = SplitPushButton(FluentIcon.PRINT, "Print Rx Pad")
        self.print_rx_btn.setObjectName("SecondaryButton")
        self.print_rx_btn.clicked.connect(self._on_direct_print_prescription)

        # Flyout menu for Print Rx Pad
        rx_flyout = RoundMenu(parent=self)
        act_print = Action(FluentIcon.PRINT, "Print Rx Pad (Send to Printer)", self)
        act_print.triggered.connect(self._on_direct_print_prescription)
        rx_flyout.addAction(act_print)

        act_preview = Action(FluentIcon.VIEW, "Print Preview", self)
        act_preview.triggered.connect(self._on_preview_prescription)
        rx_flyout.addAction(act_preview)

        act_pdf = Action(FluentIcon.SAVE, "Export as PDF...", self)
        act_pdf.triggered.connect(self._on_export_prescription_pdf)
        rx_flyout.addAction(act_pdf)

        self.print_rx_btn.setFlyout(rx_flyout)
        header_layout.addWidget(self.print_rx_btn)

        self.log_session_btn = PrimaryPushButton(FluentIcon.ADD, "Log Session")
        self.log_session_btn.clicked.connect(self._on_log_session_clicked)
        header_layout.addWidget(self.log_session_btn)

        layout.addLayout(header_layout)

        # 2. Patient & Case Selection Ribbon
        sel_frame = QFrame()
        sel_frame.setObjectName("CardPanel")
        sel_frame.setStyleSheet(f"""
            QFrame#CardPanel {{
                background-color: {COLOR_CARD_BG};
                border: 1px solid {COLOR_BORDER};
                border-radius: 10px;
            }}
        """)
        sel_layout = QHBoxLayout(sel_frame)
        sel_layout.setContentsMargins(12, 8, 12, 8)

        p_lbl = QLabel("Select Patient:")
        p_lbl.setStyleSheet(f"font-weight: 600; color: {COLOR_TEXT_PRIMARY};")
        sel_layout.addWidget(p_lbl)

        self.patient_combo = QComboBox()
        self.patient_combo.setMinimumWidth(260)
        self.patient_combo.currentIndexChanged.connect(self._on_patient_selected)
        sel_layout.addWidget(self.patient_combo)

        c_lbl = QLabel("Active Case:")
        c_lbl.setStyleSheet(f"font-weight: 600; color: {COLOR_TEXT_PRIMARY};")
        sel_layout.addWidget(c_lbl)

        self.case_combo = QComboBox()
        self.case_combo.setMinimumWidth(260)
        self.case_combo.currentIndexChanged.connect(self._on_case_selected)
        sel_layout.addWidget(self.case_combo)

        sel_layout.addStretch()

        self.billing_shortcut_btn = QPushButton("View Financials && Ledger")
        self.billing_shortcut_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: {COLOR_SECONDARY};
                color: white;
                border: none;
                border-radius: 6px;
                padding: 8px 14px;
                font-weight: 600;
            }}
            QPushButton:hover {{ background-color: #0E7490; }}
        """)
        self.billing_shortcut_btn.clicked.connect(self._on_view_billing_clicked)
        sel_layout.addWidget(self.billing_shortcut_btn)

        layout.addWidget(sel_frame)

        # 3. Active Case Information Card
        self.case_info_frame = QFrame()
        self.case_info_frame.setObjectName("CardPanel")
        self.case_info_frame.setStyleSheet(f"""
            QFrame#CardPanel {{
                background-color: {COLOR_CARD_BG};
                border: 1px solid {COLOR_BORDER};
                border-radius: 10px;
            }}
        """)
        case_info_layout = QVBoxLayout(self.case_info_frame)
        case_info_layout.setSpacing(10)

        top_info = QHBoxLayout()
        self.case_title_lbl = QLabel("No Case Selected")
        self.case_title_lbl.setStyleSheet(f"font-size: 16px; font-weight: 700; color: {COLOR_TEXT_PRIMARY};")
        top_info.addWidget(self.case_title_lbl)

        top_info.addStretch()

        self.case_status_badge = QLabel("STATUS")
        self.case_status_badge.setStyleSheet(f"""
            background-color: {COLOR_PRIMARY};
            color: white;
            font-size: 11px;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 12px;
        """)
        top_info.addWidget(self.case_status_badge)
        case_info_layout.addLayout(top_info)

        # Progress bar
        prog_layout = QHBoxLayout()
        self.progress_lbl = QLabel("Sessions: 0 / 0 completed")
        self.progress_lbl.setStyleSheet(f"font-size: 13px; color: {COLOR_TEXT_MUTED};")
        prog_layout.addWidget(self.progress_lbl)

        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.progress_bar.setFixedHeight(12)
        self.progress_bar.setTextVisible(False)
        self.progress_bar.setStyleSheet(f"""
            QProgressBar {{
                background-color: {COLOR_BG};
                border: 1px solid {COLOR_BORDER};
                border-radius: 6px;
            }}
            QProgressBar::chunk {{
                background-color: {COLOR_SUCCESS};
                border-radius: 5px;
            }}
        """)
        prog_layout.addWidget(self.progress_bar)
        case_info_layout.addLayout(prog_layout)

        layout.addWidget(self.case_info_frame)

        self.pain_trend = PainTrendWidget(self)
        layout.addWidget(self.pain_trend)

        # 4. Sessions Timeline Table
        table_title = QLabel("Clinical Sessions Log (Chronological)")
        table_title.setStyleSheet(f"font-size: 16px; font-weight: 700; color: {COLOR_PRIMARY}; margin-top: 6px;")
        layout.addWidget(table_title)

        self.sessions_table = TableWidget()
        self.sessions_table.setColumnCount(6)
        self.sessions_table.setHorizontalHeaderLabels([
            "Session #", "Date & Time", "Therapist", "Treatment Notes", "Modalities Used", "Pain (VAS)"
        ])
        self.sessions_table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeToContents)
        self.sessions_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.Stretch)
        self.sessions_table.verticalHeader().setVisible(False)
        self.sessions_table.setAlternatingRowColors(True)
        self.sessions_table.setStyleSheet(f"""
            QTableWidget {{
                background-color: {COLOR_CARD_BG};
                alternate-background-color: {COLOR_BG};
                color: {COLOR_TEXT_PRIMARY};
                gridline-color: {COLOR_BORDER};
                border: 1px solid {COLOR_BORDER};
                border-radius: 8px;
                font-size: 13px;
            }}
            QHeaderView::section {{
                background-color: {COLOR_PRIMARY};
                color: white;
                font-weight: 600;
                padding: 8px;
                border: none;
            }}
        """)
        layout.addWidget(self.sessions_table)

        self.refresh_patient_list()

    def refresh_patient_list(self):
        """Populates patient dropdown from database."""
        self.patient_combo.blockSignals(True)
        self.patient_combo.clear()
        patients = self.patient_service.search_patients("")
        for p in patients:
            label = f"{p['serial_urn_no']} - {p['patient_name']}"
            self.patient_combo.addItem(label, p["id"])
        self.patient_combo.blockSignals(False)

        if self.patient_combo.count() > 0:
            self.patient_combo.setCurrentIndex(0)
            self._on_patient_selected(0)
        else:
            self._clear_case_view()

    def _on_patient_selected(self, index: int):
        if index < 0 or self.patient_combo.count() == 0:
            return
        patient_id = self.patient_combo.currentData()
        self.current_patient_id = patient_id

        # Populate cases for patient
        self.case_combo.blockSignals(True)
        self.case_combo.clear()
        cases = self.treatment_service.get_patient_cases(patient_id)
        for c in cases:
            self.case_combo.addItem(f"Case #{c['id']}: {c['title']}", c["id"])
        self.case_combo.blockSignals(False)

        if self.case_combo.count() > 0:
            self.case_combo.setCurrentIndex(0)
            self._on_case_selected(0)
        else:
            self.current_case_id = None
            self._clear_case_view()

    def _on_case_selected(self, index: int):
        if index < 0 or self.case_combo.count() == 0:
            return
        case_id = self.case_combo.currentData()
        self.load_case(case_id)

    def load_case(self, case_id: int):
        """Loads and displays treatment case details and sessions."""
        self.current_case_id = case_id
        try:
            case_data = self.treatment_service.get_case_with_history(case_id)
        except Exception:
            return

        self.case_title_lbl.setText(f"{case_data.get('title', 'Treatment')} (URN: {case_data.get('serial_urn_no', '')})")
        status = case_data.get("status", "IN_PROGRESS")
        self.case_status_badge.setText(status)
        if status == "COMPLETED":
            self.case_status_badge.setStyleSheet(f"background-color: {COLOR_SUCCESS}; color: white; padding: 4px 10px; border-radius: 12px; font-weight: 700;")
        else:
            self.case_status_badge.setStyleSheet(f"background-color: {COLOR_PRIMARY}; color: white; padding: 4px 10px; border-radius: 12px; font-weight: 700;")

        completed = case_data["completed_sessions"]
        target = case_data["target_sessions"]
        pct = case_data["progress_pct"]
        self.progress_lbl.setText(f"Progress (Field 11): {completed} of {target} sessions completed ({pct}%)")
        self.progress_bar.setValue(pct)

        # Populate sessions table
        sessions = case_data.get("sessions", [])
        pain_scores = [
            (int(session.get("session_number") or 0), int(session["pain_score"]))
            for session in sessions
            if session.get("pain_score") is not None
        ]
        self.pain_trend.set_scores(pain_scores)
        self.sessions_table.setRowCount(len(sessions))
        for row, s in enumerate(sessions):
            # Session #
            item_seq = QTableWidgetItem(f"Session {s['session_number']}")
            item_seq.setTextAlignment(Qt.AlignCenter)
            self.sessions_table.setItem(row, 0, item_seq)

            # Date & Time
            dt_str = s.get("session_timestamp", "")[:16]
            self.sessions_table.setItem(row, 1, QTableWidgetItem(dt_str))

            # Therapist
            self.sessions_table.setItem(row, 2, QTableWidgetItem(s.get("therapist_name", "")))

            # Notes
            self.sessions_table.setItem(row, 3, QTableWidgetItem(s.get("treatment_notes", "")))

            # Modalities
            self.sessions_table.setItem(row, 4, QTableWidgetItem(s.get("modalities_used", "")))

            # Pain Score
            ps = s.get("pain_score")
            ps_text = f"{ps} / 10" if ps is not None else "N/A"
            ps_item = QTableWidgetItem(ps_text)
            ps_item.setTextAlignment(Qt.AlignCenter)
            if ps is not None:
                if ps <= 3:
                    ps_item.setForeground(Qt.darkGreen)
                elif ps <= 6:
                    ps_item.setForeground(Qt.darkYellow)
                else:
                    ps_item.setForeground(Qt.darkRed)
            self.sessions_table.setItem(row, 5, ps_item)

    def _clear_case_view(self):
        self.case_title_lbl.setText("No Active Treatment Case")
        self.case_status_badge.setText("NONE")
        self.progress_lbl.setText("Sessions: 0 of 0 completed")
        self.progress_bar.setValue(0)
        self.sessions_table.setRowCount(0)
        self.pain_trend.set_scores([])

    def load_patient_case(self, patient_id: int, case_id: Optional[int] = None):
        """Allows external modules (e.g. PatientList) to select patient and case directly."""
        self.refresh_patient_list()
        for idx in range(self.patient_combo.count()):
            if self.patient_combo.itemData(idx) == patient_id:
                self.patient_combo.setCurrentIndex(idx)
                break

        if case_id is not None:
            for idx in range(self.case_combo.count()):
                if self.case_combo.itemData(idx) == case_id:
                    self.case_combo.setCurrentIndex(idx)
                    break

    def _on_new_case_clicked(self):
        if not self.current_patient_id:
            QMessageBox.information(self, "Select Patient", "Please select or register a patient first.")
            return

        patient = self.patient_service.get_patient(self.current_patient_id)
        p_name = patient["patient_name"] if patient else "Patient"

        dialog = NewCaseDialog(p_name, self)
        if dialog.exec() == QDialog.Accepted:
            data = dialog.get_data()
            try:
                new_case = self.treatment_service.open_treatment_case(
                    patient_id=self.current_patient_id,
                    title=data["title"] or "Physiotherapy Treatment",
                    no_of_sessions=data["no_of_sessions"],
                    total_amount_rupees=data["total_amount_rupees"],
                    notes=data["notes"],
                )
                self._on_patient_selected(self.patient_combo.currentIndex())
                self.load_case(new_case["id"])
            except Exception as e:
                QMessageBox.critical(self, "Error", f"Failed to create case: {str(e)}")

    def _on_log_session_clicked(self):
        if not self.current_case_id:
            QMessageBox.information(self, "No Case Selected", "Please select an active treatment case first.")
            return

        next_seq = self.treatment_service.treatment_repo.get_next_session_number(self.current_case_id)
        dialog = LogSessionDialog(next_seq, self)
        if dialog.exec() == QDialog.Accepted:
            data = dialog.get_data()
            try:
                saved_session = self.treatment_service.log_session(
                    case_id=self.current_case_id,
                    treatment_notes=data["treatment_notes"],
                    therapist_name=data["therapist_name"],
                    modalities_used=data["modalities_used"],
                    pain_score=data["pain_score"],
                )
                self.load_case(self.current_case_id)
                self.session_saved.emit(saved_session)
            except Exception as e:
                QMessageBox.critical(self, "Error", f"Failed to log session: {str(e)}")

    def _on_view_billing_clicked(self):
        if self.current_case_id:
            self.view_billing_clicked.emit(self.current_case_id)
        else:
            QMessageBox.information(self, "No Case Selected", "Select a case to view billing details.")

    def _build_prescription_html(self) -> Optional[tuple[str, dict]]:
        """Validates patient/case selection and builds the authentic prescription slip HTML."""
        if not self.current_patient_id:
            QMessageBox.warning(self, "No Patient Selected", "Please select a patient to print their prescription pad.")
            return None

        patient_data = self.patient_service.get_patient(self.current_patient_id)
        if not patient_data:
            QMessageBox.warning(self, "Patient Not Found", "Unable to load patient data.")
            return None

        case_data = None
        if self.current_case_id:
            case_data = self.treatment_service.get_case(self.current_case_id)

        html = DocumentBuilder.build_prescription_slip_html(patient_data, case_data=case_data)
        return html, patient_data

    def _on_direct_print_prescription(self):
        """Directly sends the prescription pad to the Windows print dialog (actual print path)."""
        result = self._build_prescription_html()
        if not result:
            return
        html, patient_data = result
        patient_name = patient_data.get("patient_name", "Patient")
        success = PrintService.print_document(
            html,
            parent=self,
            title=f"Prescription Slip — {patient_name}",
        )
        if success and hasattr(self.window(), "show_toast"):
            self.window().show_toast(
                "Sent to Printer",
                f"Prescription slip for {patient_name} sent to printer successfully.",
                "success",
            )

    def _on_preview_prescription(self):
        """Displays interactive full-page A4 preview with embedded print/PDF action bar."""
        result = self._build_prescription_html()
        if not result:
            return
        html, patient_data = result
        PrintService.show_print_preview(
            html,
            parent=self,
            title=f"Prescription Slip — {patient_data.get('patient_name', 'Patient')}",
        )

    def _on_export_prescription_pdf(self):
        """Prompts for a file path and exports the prescription pad as a vector PDF."""
        result = self._build_prescription_html()
        if not result:
            return
        html, patient_data = result
        patient_name = patient_data.get("patient_name", "Patient")
        urn = patient_data.get("serial_urn_no", "Record")
        default_name = f"Prescription_{urn}_{patient_name.replace(' ', '_')}.pdf"
        saved_path = PrintService.export_to_pdf_with_dialog(html, parent=self, default_name=default_name)
        if saved_path and hasattr(self.window(), "show_toast"):
            self.window().show_toast(
                "PDF Exported",
                f"Saved prescription PDF to {os.path.basename(saved_path)}.",
                "success",
            )

    def _on_print_prescription_clicked(self):
        """Backward-compatible handler: routes directly to the print dialog."""
        self._on_direct_print_prescription()
