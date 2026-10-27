"""
Payment View - Financial Ledger, Installment Processing & Real-Time Balance Cards.
Kalyan Hospital Management System.
"""

from typing import Any, Dict, List, Optional
from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QTableWidget, QTableWidgetItem, QHeaderView,
    QComboBox, QDoubleSpinBox, QFormLayout, QMessageBox,
    QFrame, QGridLayout
)
from app.services.billing_service import BillingService
from app.services.treatment_service import TreatmentService
from app.services.patient_service import PatientService
from app.ui.styles import (
    COLOR_PRIMARY, COLOR_PRIMARY_HOVER, COLOR_SECONDARY,
    COLOR_TEXT_PRIMARY, COLOR_TEXT_MUTED, COLOR_CARD_BG,
    COLOR_BORDER, COLOR_BG, COLOR_SUCCESS, COLOR_WARNING, COLOR_DANGER
)


class PaymentView(QWidget):
    """Manages medical billing, partial installments, and dynamic balance tracking."""

    payment_recorded = Signal(int)  # Emits case_id after payment saved

    def __init__(self, db_path: Optional[str] = None, parent=None):
        super().__init__(parent)
        self.db_path = db_path
        self.billing_service = BillingService(db_path)
        self.treatment_service = TreatmentService(db_path)
        self.patient_service = PatientService(db_path)

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
        title_lbl = QLabel("Billing & Payment Ledger")
        title_lbl.setStyleSheet(f"font-size: 24px; font-weight: 700; color: {COLOR_PRIMARY};")
        title_box.addWidget(title_lbl)

        subtitle_lbl = QLabel("Field 12 Payment Details • Exact Integer Paise Calculations (Zero Rounding Errors)")
        subtitle_lbl.setStyleSheet(f"font-size: 13px; color: {COLOR_TEXT_MUTED};")
        title_box.addWidget(subtitle_lbl)
        header_layout.addLayout(title_box)

        layout.addLayout(header_layout)

        # 2. Patient & Case Selection Ribbon
        sel_frame = QFrame()
        sel_frame.setStyleSheet(f"""
            QFrame {{
                background-color: {COLOR_CARD_BG};
                border: 1px solid {COLOR_BORDER};
                border-radius: 10px;
                padding: 12px;
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

        c_lbl = QLabel("Select Case:")
        c_lbl.setStyleSheet(f"font-weight: 600; color: {COLOR_TEXT_PRIMARY};")
        sel_layout.addWidget(c_lbl)

        self.case_combo = QComboBox()
        self.case_combo.setMinimumWidth(260)
        self.case_combo.currentIndexChanged.connect(self._on_case_selected)
        sel_layout.addWidget(self.case_combo)

        sel_layout.addStretch()

        refresh_btn = QPushButton("Refresh")
        refresh_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: transparent;
                color: {COLOR_TEXT_PRIMARY};
                border: 1px solid {COLOR_BORDER};
                border-radius: 6px;
                padding: 6px 14px;
                font-weight: 600;
            }}
            QPushButton:hover {{ background-color: {COLOR_BORDER}; }}
        """)
        refresh_btn.clicked.connect(self.refresh_patient_list)
        sel_layout.addWidget(refresh_btn)

        layout.addWidget(sel_frame)

        # 3. Dynamic Balance Stat Cards (3 Columns)
        cards_layout = QHBoxLayout()
        cards_layout.setSpacing(12)

        # Total Agreed Fee Card
        self.fee_card = self._create_metric_card("Total Agreed Fee (Field 12)", "₹ 0.00", COLOR_SECONDARY)
        cards_layout.addWidget(self.fee_card)

        # Total Amount Paid Card
        self.paid_card = self._create_metric_card("Amount Paid to Date", "₹ 0.00", COLOR_SUCCESS)
        cards_layout.addWidget(self.paid_card)

        # Remaining Balance Card
        self.balance_card = self._create_metric_card("Outstanding Balance Due", "₹ 0.00", COLOR_PRIMARY)
        cards_layout.addWidget(self.balance_card)

        layout.addLayout(cards_layout)

        # 4. Record Payment Input Group
        entry_frame = QFrame()
        entry_frame.setStyleSheet(f"""
            QFrame {{
                background-color: {COLOR_CARD_BG};
                border: 1px solid {COLOR_BORDER};
                border-radius: 10px;
                padding: 16px;
            }}
        """)
        entry_layout = QVBoxLayout(entry_frame)
        entry_layout.setSpacing(12)

        entry_title = QLabel("Record Partial Payment / Installment")
        entry_title.setStyleSheet(f"font-size: 15px; font-weight: 700; color: {COLOR_PRIMARY};")
        entry_layout.addWidget(entry_title)

        form_grid = QGridLayout()
        form_grid.setSpacing(10)

        # Amount
        amt_lbl = QLabel("Payment Amount (₹) *:")
        amt_lbl.setStyleSheet(f"font-weight: 600; color: {COLOR_TEXT_PRIMARY};")
        self.amt_input = QDoubleSpinBox()
        self.amt_input.setRange(1.0, 500000.0)
        self.amt_input.setValue(500.0)
        self.amt_input.setPrefix("₹ ")
        self.amt_input.setDecimals(2)
        self.amt_input.setStyleSheet(f"""
            QDoubleSpinBox {{
                background-color: {COLOR_BG};
                color: {COLOR_TEXT_PRIMARY};
                border: 1px solid {COLOR_BORDER};
                border-radius: 6px;
                padding: 8px;
                font-size: 14px;
                font-weight: 600;
            }}
        """)
        form_grid.addWidget(amt_lbl, 0, 0)
        form_grid.addWidget(self.amt_input, 0, 1)

        # Payment Mode
        mode_lbl = QLabel("Payment Mode *:")
        mode_lbl.setStyleSheet(f"font-weight: 600; color: {COLOR_TEXT_PRIMARY};")
        self.mode_combo = QComboBox()
        self.mode_combo.addItems(["CASH", "UPI", "CARD", "OTHER"])
        self.mode_combo.setStyleSheet(f"""
            QComboBox {{
                background-color: {COLOR_BG};
                color: {COLOR_TEXT_PRIMARY};
                border: 1px solid {COLOR_BORDER};
                border-radius: 6px;
                padding: 8px;
                font-size: 13px;
            }}
        """)
        form_grid.addWidget(mode_lbl, 0, 2)
        form_grid.addWidget(self.mode_combo, 0, 3)

        # Reference Note
        note_lbl = QLabel("Reference / Receipt Memo:")
        note_lbl.setStyleSheet(f"font-weight: 600; color: {COLOR_TEXT_PRIMARY};")
        self.note_input = QLineEdit()
        self.note_input.setPlaceholderText("e.g. GPay Ref #123456 or 1st Installment")
        self.note_input.setStyleSheet(f"""
            QLineEdit {{
                background-color: {COLOR_BG};
                color: {COLOR_TEXT_PRIMARY};
                border: 1px solid {COLOR_BORDER};
                border-radius: 6px;
                padding: 8px;
                font-size: 13px;
            }}
        """)
        form_grid.addWidget(note_lbl, 1, 0)
        form_grid.addWidget(self.note_input, 1, 1, 1, 2)

        # Record Button
        self.submit_payment_btn = QPushButton("Save Payment")
        self.submit_payment_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: {COLOR_PRIMARY};
                color: white;
                border: none;
                border-radius: 6px;
                padding: 10px 20px;
                font-weight: 700;
                font-size: 13px;
            }}
            QPushButton:hover {{ background-color: {COLOR_PRIMARY_HOVER}; }}
        """)
        self.submit_payment_btn.clicked.connect(self._on_submit_payment)
        form_grid.addWidget(self.submit_payment_btn, 1, 3)

        entry_layout.addLayout(form_grid)
        layout.addWidget(entry_frame)

        # 5. Payment Installments Ledger Table
        table_title = QLabel("Installment Payment History")
        table_title.setStyleSheet(f"font-size: 16px; font-weight: 700; color: {COLOR_PRIMARY}; margin-top: 4px;")
        layout.addWidget(table_title)

        self.payments_table = QTableWidget()
        self.payments_table.setColumnCount(6)
        self.payments_table.setHorizontalHeaderLabels([
            "Payment Date", "Receipt #", "Amount Paid", "Mode", "Reference Note", "Recorded By"
        ])
        self.payments_table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeToContents)
        self.payments_table.horizontalHeader().setSectionResizeMode(4, QHeaderView.Stretch)
        self.payments_table.verticalHeader().setVisible(False)
        self.payments_table.setAlternatingRowColors(True)
        self.payments_table.setStyleSheet(f"""
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
        layout.addWidget(self.payments_table)

        self.refresh_patient_list()

    def _create_metric_card(self, title: str, initial_value: str, accent_color: str) -> QFrame:
        card = QFrame()
        card.setStyleSheet(f"""
            QFrame {{
                background-color: {COLOR_CARD_BG};
                border: 1px solid {COLOR_BORDER};
                border-left: 5px solid {accent_color};
                border-radius: 10px;
                padding: 16px;
            }}
        """)
        card_layout = QVBoxLayout(card)
        card_layout.setSpacing(4)

        title_lbl = QLabel(title)
        title_lbl.setStyleSheet(f"font-size: 12px; font-weight: 600; color: {COLOR_TEXT_MUTED}; text-transform: uppercase;")
        card_layout.addWidget(title_lbl)

        val_lbl = QLabel(initial_value)
        val_lbl.setObjectName("val_label")
        val_lbl.setStyleSheet(f"font-size: 22px; font-weight: 700; color: {COLOR_TEXT_PRIMARY};")
        card_layout.addWidget(val_lbl)

        return card

    def _update_card_value(self, card: QFrame, value_text: str, custom_color: Optional[str] = None):
        val_lbl = card.findChild(QLabel, "val_label")
        if val_lbl:
            val_lbl.setText(value_text)
            if custom_color:
                val_lbl.setStyleSheet(f"font-size: 22px; font-weight: 700; color: {custom_color};")

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
            self._clear_billing_view()

    def _on_patient_selected(self, index: int):
        if index < 0 or self.patient_combo.count() == 0:
            return
        patient_id = self.patient_combo.currentData()
        self.current_patient_id = patient_id

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
            self._clear_billing_view()

    def _on_case_selected(self, index: int):
        if index < 0 or self.case_combo.count() == 0:
            return
        case_id = self.case_combo.currentData()
        self.load_case_billing(case_id)

    def load_case_billing(self, case_id: int):
        """Calculates and renders financial metrics and payments ledger."""
        self.current_case_id = case_id
        try:
            summary = self.billing_service.get_financial_summary(case_id)
        except Exception:
            return

        # Update cards
        self._update_card_value(self.fee_card, summary["total_fee_formatted"])
        self._update_card_value(self.paid_card, summary["total_paid_formatted"])

        bal_formatted = summary["balance_formatted"]
        if summary["is_cleared"]:
            self._update_card_value(self.balance_card, f"{bal_formatted} (CLEARED ✓)", COLOR_SUCCESS)
            self.balance_card.setStyleSheet(f"""
                QFrame {{
                    background-color: {COLOR_CARD_BG};
                    border: 1px solid {COLOR_BORDER};
                    border-left: 5px solid {COLOR_SUCCESS};
                    border-radius: 10px;
                    padding: 16px;
                }}
            """)
        else:
            self._update_card_value(self.balance_card, bal_formatted, COLOR_PRIMARY)
            self.balance_card.setStyleSheet(f"""
                QFrame {{
                    background-color: {COLOR_CARD_BG};
                    border: 1px solid {COLOR_BORDER};
                    border-left: 5px solid {COLOR_PRIMARY};
                    border-radius: 10px;
                    padding: 16px;
                }}
            """)

        # Populate payments table
        payments = summary.get("payments", [])
        self.payments_table.setRowCount(len(payments))
        for row, p in enumerate(payments):
            # Date
            dt_str = p.get("payment_timestamp", "")[:16]
            self.payments_table.setItem(row, 0, QTableWidgetItem(dt_str))

            # Receipt #
            item_rcpt = QTableWidgetItem(f"RCPT-{p['id']:04d}")
            item_rcpt.setTextAlignment(Qt.AlignCenter)
            self.payments_table.setItem(row, 1, item_rcpt)

            # Amount
            amt_item = QTableWidgetItem(p.get("amount_formatted", ""))
            amt_item.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
            amt_item.setForeground(Qt.darkGreen)
            self.payments_table.setItem(row, 2, amt_item)

            # Mode
            mode_item = QTableWidgetItem(p.get("payment_mode", "CASH"))
            mode_item.setTextAlignment(Qt.AlignCenter)
            self.payments_table.setItem(row, 3, mode_item)

            # Note
            self.payments_table.setItem(row, 4, QTableWidgetItem(p.get("reference_note", "")))

            # Recorded By
            self.payments_table.setItem(row, 5, QTableWidgetItem(p.get("recorded_by", "Staff")))

    def _clear_billing_view(self):
        self._update_card_value(self.fee_card, "₹ 0.00")
        self._update_card_value(self.paid_card, "₹ 0.00")
        self._update_card_value(self.balance_card, "₹ 0.00")
        self.payments_table.setRowCount(0)

    def _on_submit_payment(self):
        if not self.current_case_id:
            QMessageBox.information(self, "No Case Selected", "Please select a treatment case first.")
            return

        amount = self.amt_input.value()
        mode = self.mode_combo.currentText()
        note = self.note_input.text().strip()

        try:
            receipt = self.billing_service.record_installment(
                case_id=self.current_case_id,
                amount_rupees=amount,
                payment_mode=mode,
                reference_note=note,
                recorded_by="Staff",
            )
            # Clear input note
            self.note_input.clear()

            # Refresh view
            self.load_case_billing(self.current_case_id)
            self.payment_recorded.emit(self.current_case_id)

            if receipt.get("is_overpayment"):
                over_str = receipt.get("overpayment_formatted", "")
                QMessageBox.information(
                    self,
                    "Payment Saved (Overpayment)",
                    f"Payment of {receipt['amount_paid_formatted']} recorded successfully.\n"
                    f"Note: This case is now fully cleared, with an excess payment of {over_str}."
                )
            else:
                QMessageBox.information(
                    self,
                    "Payment Recorded",
                    f"Payment of {receipt['amount_paid_formatted']} successfully recorded.\n"
                    f"Remaining Balance: {receipt['balance_formatted']}"
                )
        except Exception as e:
            QMessageBox.critical(self, "Payment Error", f"Failed to record payment: {str(e)}")
