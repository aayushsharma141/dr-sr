"""
Keyboard-first launcher for navigating Kalyan Hospital and finding patients.
Built with native PySide6 widgets; no additional UI framework dependency.
"""
from __future__ import annotations

from PySide6.QtCore import Qt, Signal, QSize
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.services.patient_service import PatientService


class QuickLauncherDialog(QDialog):
    """Ctrl+K launcher for application destinations and matching patient records."""

    selection_requested = Signal(str, object)

    COMMANDS = (
        ("Dashboard", "Live clinic overview", "navigate", 0, "dashboard"),
        ("Patient Registry", "Search and manage patient records", "navigate", 1, "patient"),
        ("Register New Patient", "Open a blank patient registration form", "register", None, "register"),
        ("Treatment Sessions", "Open treatment cases and session history", "navigate", 2, "treatment"),
        ("Billing & Payments", "Open the patient payment ledger", "navigate", 3, "billing"),
        ("Backup & Safety", "Create or restore a local database backup", "navigate", 4, "backup"),
    )

    def __init__(
        self,
        patient_service: PatientService,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.patient_service = patient_service
        self.setObjectName("QuickLauncherDialog")
        self.setWindowTitle("Quick Launcher")
        self.setModal(True)
        self.resize(660, 460)

        root = QVBoxLayout(self)
        root.setContentsMargins(20, 18, 20, 18)
        root.setSpacing(12)

        title = QLabel("Find a patient or jump to a workspace")
        title.setObjectName("PageHeading")
        title.setStyleSheet("font-size:18px;")
        root.addWidget(title)

        subtitle = QLabel("Search by patient name, URN, or mobile number. Use ↑ ↓ and Enter.")
        subtitle.setObjectName("PageSubheading")
        root.addWidget(subtitle)

        self.search_input = QLineEdit(self)
        self.search_input.setObjectName("QuickLauncherSearch")
        self.search_input.setPlaceholderText("Type a patient name, KH-YYYY-XXXX, mobile, or an action…")
        self.search_input.setClearButtonEnabled(True)
        self.search_input.setMinimumHeight(44)
        root.addWidget(self.search_input)

        self.results_list = QListWidget(self)
        self.results_list.setObjectName("QuickLauncherResults")
        self.results_list.setSpacing(3)
        self.results_list.setUniformItemSizes(True)
        self.results_list.setMinimumHeight(280)
        root.addWidget(self.results_list, stretch=1)

        footer = QHBoxLayout()
        hint = QLabel("ESC  Close")
        hint.setObjectName("PageSubheading")
        footer.addWidget(hint)
        footer.addStretch()
        footer.addWidget(QLabel("OFFLINE · LOCAL SEARCH"))
        root.addLayout(footer)

        self.search_input.textChanged.connect(self._populate_results)
        self.search_input.returnPressed.connect(self._activate_current)
        self.results_list.itemActivated.connect(self._activate_item)
        self.results_list.itemDoubleClicked.connect(self._activate_item)

        escape = QShortcut(QKeySequence(Qt.Key.Key_Escape), self)
        escape.activated.connect(self.reject)

        self._populate_results("")
        self.search_input.setFocus()

    def _add_result(
        self,
        title: str,
        detail: str,
        kind: str,
        payload: object,
        selectable: bool = True,
    ) -> None:
        item = QListWidgetItem(f"{title}    ·    {detail}")
        item.setSizeHint(QSize(0, 42))
        item.setData(Qt.ItemDataRole.UserRole, kind)
        item.setData(Qt.ItemDataRole.UserRole + 1, payload)
        if not selectable:
            item.setFlags(Qt.ItemFlag.NoItemFlags)
        self.results_list.addItem(item)

    def _populate_results(self, query: str) -> None:
        self.results_list.clear()
        normalized = query.strip().casefold()
        matches = 0

        for title, detail, kind, payload, _category in self.COMMANDS:
            if not normalized or normalized in title.casefold() or normalized in detail.casefold():
                self._add_result(title, detail, kind, payload)
                matches += 1

        patient_matches: list[dict] = []
        if normalized:
            try:
                patient_matches = self.patient_service.search_patients(query.strip(), limit=12)
            except Exception:
                # A failed database read must not crash the launcher UI.
                patient_matches = []

        for patient in patient_matches:
            name = str(patient.get("patient_name") or "Unnamed patient")
            urn = str(patient.get("serial_urn_no") or "")
            mobile = str(patient.get("mobile_no") or "")
            condition = str(patient.get("patient_condition") or "")
            detail_parts = [urn]
            if mobile:
                detail_parts.append(mobile)
            if condition:
                detail_parts.append(condition)
            self._add_result(name, " · ".join(part for part in detail_parts if part), "patient", patient)
            matches += 1

        if matches == 0:
            self._add_result(
                "No matching patients or actions",
                "Try a name, URN, mobile number, or workspace name",
                "empty",
                None,
                selectable=False,
            )
        else:
            self.results_list.setCurrentRow(0)

    def _activate_current(self) -> None:
        item = self.results_list.currentItem()
        if item is not None:
            self._activate_item(item)

    def _activate_item(self, item: QListWidgetItem) -> None:
        kind = item.data(Qt.ItemDataRole.UserRole)
        if kind in ("navigate", "register", "patient"):
            payload = item.data(Qt.ItemDataRole.UserRole + 1)
            self.selection_requested.emit(str(kind), payload)
            self.accept()
