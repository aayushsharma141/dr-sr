"""
Searchable Patient Directory View supporting real-time multi-field search and row actions.
"""

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.config import COLORS
from app.services.patient_service import PatientService
from app.services.document_builder import DocumentBuilder
from app.services.print_service import PrintService


class PatientListView(QWidget):
    """
    Searchable patient table displaying patient registry records with
    instant search filtering and quick edit actions.
    """

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

        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(28, 20, 28, 20)
        root_layout.setSpacing(16)

        # 1. Header & Quick Action Row
        top_row = QHBoxLayout()

        header_text = QVBoxLayout()
        header_text.setSpacing(2)
        title_lbl = QLabel("Patient Records Directory")
        title_lbl.setObjectName("PageHeading")
        header_text.addWidget(title_lbl)

        subtitle_lbl = QLabel("Search, manage demographic profiles, and open treatment sessions")
        subtitle_lbl.setObjectName("PageSubheading")
        header_text.addWidget(subtitle_lbl)

        top_row.addLayout(header_text)
        top_row.addStretch()

        btn_new = QPushButton("+  Register New Patient")
        btn_new.setObjectName("PrimaryButton")
        btn_new.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_new.clicked.connect(self.register_clicked.emit)
        top_row.addWidget(btn_new)

        root_layout.addLayout(top_row)

        # 2. Search Bar Filter Panel
        search_panel = QFrame()
        search_panel.setObjectName("CardPanel")
        search_layout = QHBoxLayout(search_panel)
        search_layout.setContentsMargins(16, 10, 16, 10)
        search_layout.setSpacing(12)

        search_icon = QLabel("Search")
        search_icon.setStyleSheet("font-size: 16px;")
        search_layout.addWidget(search_icon)

        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText(
            "Search by Serial / URN No. (e.g. KH-2026-0001), Patient Name, or Mobile Number..."
        )
        self.search_input.setClearButtonEnabled(True)
        self.search_input.textChanged.connect(self._on_search_changed)
        search_layout.addWidget(self.search_input)

        refresh_btn = QPushButton("Refresh")
        refresh_btn.setObjectName("SecondaryButton")
        refresh_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        refresh_btn.clicked.connect(self.reload_patients)
        search_layout.addWidget(refresh_btn)

        root_layout.addWidget(search_panel)

        # 3. Patient Records Table
        self.table = QTableWidget()
        self.table.setObjectName("CardPanel")
        self.table.setColumnCount(7)
        self.table.setHorizontalHeaderLabels([
            "Serial / URN",
            "Patient Name",
            "Age / Sex",
            "Mobile No.",
            "Condition / Diagnosis",
            "Registered At",
            "Actions",
        ])

        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(5, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(6, QHeaderView.ResizeMode.ResizeToContents)

        self.table.setAlternatingRowColors(True)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.cellDoubleClicked.connect(self._on_cell_double_clicked)
        self.table.verticalHeader().setDefaultSectionSize(42)

        root_layout.addWidget(self.table)

        # 4. Status Bar
        self.status_lbl = QLabel("Loading patient directory...")
        self.status_lbl.setStyleSheet("color: #64748B; font-size: 11px;")
        root_layout.addWidget(self.status_lbl)

        # Initial load
        self.reload_patients()

    def _on_search_changed(self, text: str):
        self.reload_patients(query=text)

    def reload_patients(self, query: str = ""):
        """Queries PatientService and repopulates table rows."""
        active_query = query if query else self.search_input.text()
        patients = self.service.search_patients(active_query)

        self.table.setRowCount(len(patients))

        for row, p in enumerate(patients):
            # 0. URN
            urn_item = QTableWidgetItem(str(p.get("serial_urn_no", "")))
            urn_item.setData(Qt.ItemDataRole.UserRole, p["id"])
            urn_item.setFont(self.font())
            self.table.setItem(row, 0, urn_item)

            # 1. Name
            name_item = QTableWidgetItem(str(p.get("patient_name", "")))
            self.table.setItem(row, 1, name_item)

            # 2. Age / Sex
            age_sex_item = QTableWidgetItem(f"{p.get('age', '')} / {p.get('sex', '')}")
            self.table.setItem(row, 2, age_sex_item)

            # 3. Mobile
            mobile_item = QTableWidgetItem(str(p.get("mobile_no", "")))
            self.table.setItem(row, 3, mobile_item)

            # 4. Condition
            cond_item = QTableWidgetItem(str(p.get("patient_condition", "")))
            self.table.setItem(row, 4, cond_item)

            # 5. Registered At
            reg_item = QTableWidgetItem(str(p.get("registered_at", ""))[:16])
            self.table.setItem(row, 5, reg_item)

            # 6. Action buttons container
            actions_widget = QWidget()
            actions_layout = QHBoxLayout(actions_widget)
            actions_layout.setContentsMargins(4, 2, 4, 2)
            actions_layout.setSpacing(6)

            edit_btn = QPushButton("Edit")
            edit_btn.setObjectName("SecondaryButton")
            edit_btn.setStyleSheet("padding: 3px 8px; font-size: 11px;")
            edit_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            patient_id = p["id"]
            edit_btn.clicked.connect(lambda _, pid=patient_id: self.edit_clicked.emit(pid))
            actions_layout.addWidget(edit_btn)

            trt_btn = QPushButton("Session")
            trt_btn.setObjectName("SecondaryButton")
            trt_btn.setStyleSheet(f"padding: 3px 8px; font-size: 11px; color: {COLORS['secondary']};")
            trt_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            trt_btn.clicked.connect(lambda _, pid=patient_id: self.open_treatment_clicked.emit(pid))
            actions_layout.addWidget(trt_btn)

            print_btn = QPushButton("Print")
            print_btn.setObjectName("SecondaryButton")
            print_btn.setStyleSheet("padding: 3px 8px; font-size: 11px;")
            print_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            print_btn.clicked.connect(lambda _, pt=p: self._on_print_patient(pt))
            actions_layout.addWidget(print_btn)

            self.table.setCellWidget(row, 6, actions_widget)

        count = len(patients)
        if count == 0:
            if active_query:
                self.status_lbl.setText(f"No records matching '{active_query}'.")
            else:
                self.status_lbl.setText("Patient registry is empty. Click 'Register New Patient' to add records.")
        else:
            self.status_lbl.setText(f"Displaying {count} patient record(s). Double-click a row to edit.")

    def _on_print_patient(self, patient_dict: dict):
        """Builds A4 document and displays print preview."""
        html = DocumentBuilder.build_patient_registration_html(patient_dict)
        PrintService.show_print_preview(html, parent=self)

    def _on_cell_double_clicked(self, row: int, _col: int):
        item = self.table.item(row, 0)
        if item:
            patient_id = item.data(Qt.ItemDataRole.UserRole)
            if patient_id:
                self.edit_clicked.emit(patient_id)
