"""
Composite Patient Module Widget managing transitions between the
searchable directory list and the registration/edit form.
"""

from PySide6.QtCore import Signal
from PySide6.QtWidgets import QStackedWidget, QVBoxLayout, QWidget

from app.services.patient_service import PatientService
from app.ui.views.patient_form_view import PatientFormView
from app.ui.views.patient_list_view import PatientListView


class PatientModuleView(QWidget):
    """
    Module container hosting the Patient Directory List (index 0)
    and the Patient Registration/Edit Form (index 1).
    """

    open_treatment_requested = Signal(int)

    def __init__(
        self,
        patient_service: PatientService | None = None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.service = patient_service or PatientService()

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        self.stack = QStackedWidget(self)
        layout.addWidget(self.stack)

        # 1. Directory View (Index 0)
        self.list_view = PatientListView(patient_service=self.service, parent=self)
        self.stack.addWidget(self.list_view)

        # 2. Form View (Index 1)
        self.form_view = PatientFormView(patient_service=self.service, parent=self)
        self.stack.addWidget(self.form_view)

        # Wire navigation signals
        self.list_view.register_clicked.connect(self.show_registration_form)
        self.list_view.edit_clicked.connect(self.show_edit_form)
        self.list_view.open_treatment_clicked.connect(self.open_treatment_requested.emit)

        self.form_view.patient_saved.connect(self._on_patient_saved)
        self.form_view.cancelled.connect(self.show_directory_list)

        # Start at directory list
        self.stack.setCurrentIndex(0)

    def show_registration_form(self):
        """Prepares a blank form and switches to registration mode."""
        self.form_view.clear_form()
        self.stack.setCurrentIndex(1)

    def show_edit_form(self, patient_id: int):
        """Loads the patient record and switches to edit mode."""
        patient = self.service.get_patient(patient_id)
        if patient:
            self.form_view.load_patient(patient)
            self.stack.setCurrentIndex(1)

    def show_directory_list(self):
        """Switches back to the patient directory view and refreshes rows."""
        self.stack.setCurrentIndex(0)
        self.list_view.reload_patients()

    def _on_patient_saved(self, _saved_patient: dict):
        """Callback when patient is saved successfully."""
        self.show_directory_list()
