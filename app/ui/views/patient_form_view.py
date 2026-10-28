"""
Patient registration / edit form.

One clean page: photo on the left, identity and visit details on the right.
Required fields are never pre-filled with guessed values (age, sex, doctor start empty).
"""

import os
from pathlib import Path

from PySide6.QtCore import QDateTime, QRegularExpression, Qt, Signal
from PySide6.QtGui import QPixmap, QRegularExpressionValidator
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDateTimeEdit,
    QFileDialog,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QSpinBox,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from app.config import COLORS
from app.services.doctor_service import DoctorService
from app.services.patient_service import PatientService, ValidationError
from app.ui.webcam_dialog import WebcamCaptureDialog

AGE_UNSET = -1
PHOTO_SIZE = (150, 193)  # 35:45 passport ratio


def _field(label: str, widget: QWidget, required: bool = False) -> QWidget:
    """A label stacked above its input."""
    box = QWidget()
    layout = QVBoxLayout(box)
    layout.setContentsMargins(0, 0, 0, 0)
    layout.setSpacing(4)
    caption = QLabel(f"{label} *" if required else label)
    caption.setObjectName("FieldLabel")
    layout.addWidget(caption)
    layout.addWidget(widget)
    return box


def _section(title: str) -> QLabel:
    label = QLabel(title)
    label.setObjectName("FormSectionHeading")
    return label


class PatientFormView(QWidget):
    """Intake and profile editing form."""

    patient_saved = Signal(dict)
    cancelled = Signal()

    def __init__(
        self,
        patient_service: PatientService | None = None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.service = patient_service or PatientService()
        self.doctor_service = DoctorService(self.service.db_path)
        self.current_patient_id: int | None = None
        self.selected_photo_path: str | None = None
        self._photo_is_temp = False

        root = QVBoxLayout(self)
        root.setContentsMargins(24, 20, 24, 16)
        root.setSpacing(14)

        header = QHBoxLayout()
        title_box = QVBoxLayout()
        title_box.setSpacing(2)
        self.title_lbl = QLabel("Register Patient")
        self.title_lbl.setObjectName("PageHeading")
        self.title_lbl.setStyleSheet("font-size:22px;")
        title_box.addWidget(self.title_lbl)
        self.urn_display = QLabel("Patient ID is created when you save")
        self.urn_display.setObjectName("PageSubheading")
        title_box.addWidget(self.urn_display)
        header.addLayout(title_box)
        header.addStretch()
        back_btn = QPushButton("Back to Patients")
        back_btn.setObjectName("SecondaryButton")
        back_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        back_btn.clicked.connect(self.cancelled.emit)
        header.addWidget(back_btn, alignment=Qt.AlignmentFlag.AlignTop)
        root.addLayout(header)

        card = QFrame()
        card.setObjectName("CardPanel")
        card_layout = QHBoxLayout(card)
        card_layout.setContentsMargins(24, 22, 24, 22)
        card_layout.setSpacing(28)

        # ---- Photo column -------------------------------------------------
        photo_col = QVBoxLayout()
        photo_col.setSpacing(8)
        photo_col.setAlignment(Qt.AlignmentFlag.AlignTop)
        self.photo_preview = QLabel("No photo")
        self.photo_preview.setFixedSize(*PHOTO_SIZE)
        self.photo_preview.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.photo_preview.setStyleSheet(
            f"border:1px dashed {COLORS['border']};border-radius:10px;"
            f"background:{COLORS['background']};color:{COLORS['text_secondary']};"
        )
        photo_col.addWidget(self.photo_preview)

        self.webcam_btn = QPushButton("Take Photo")
        self.webcam_btn.setObjectName("PrimaryButton")
        self.webcam_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.webcam_btn.clicked.connect(self._capture_from_webcam)
        photo_col.addWidget(self.webcam_btn)

        self.upload_btn = QPushButton("Upload Photo")
        self.upload_btn.setObjectName("SecondaryButton")
        self.upload_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.upload_btn.clicked.connect(self._browse_photo)
        photo_col.addWidget(self.upload_btn)

        self.remove_photo_btn = QPushButton("Remove")
        self.remove_photo_btn.setFlat(True)
        self.remove_photo_btn.setStyleSheet(
            f"color:{COLORS['danger']};border:none;background:transparent;font-weight:600;"
        )
        self.remove_photo_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.remove_photo_btn.clicked.connect(self._clear_photo)
        photo_col.addWidget(self.remove_photo_btn)
        photo_col.addStretch(1)
        card_layout.addLayout(photo_col)

        # ---- Form column --------------------------------------------------
        form_col = QVBoxLayout()
        form_col.setSpacing(12)

        form_col.addWidget(_section("PATIENT"))
        grid = QGridLayout()
        grid.setHorizontalSpacing(14)
        grid.setVerticalSpacing(12)

        self.input_name = QLineEdit()
        self.input_name.setPlaceholderText("Full name")
        grid.addWidget(_field("Patient name", self.input_name, True), 0, 0, 1, 2)

        self.input_age = QSpinBox()
        self.input_age.setRange(AGE_UNSET, 125)
        self.input_age.setValue(AGE_UNSET)
        self.input_age.setSpecialValueText("Select age")
        self.input_age.setSuffix(" yrs")
        grid.addWidget(_field("Age", self.input_age, True), 0, 2)

        self.input_sex = QComboBox()
        self.input_sex.addItems(["Select", "Male", "Female", "Other"])
        grid.addWidget(_field("Sex", self.input_sex, True), 0, 3)

        self.input_mobile = QLineEdit()
        self.input_mobile.setPlaceholderText("10-digit mobile number")
        self.input_mobile.setMaxLength(14)
        self.input_mobile.setValidator(QRegularExpressionValidator(QRegularExpression(r"[0-9+\s-]*")))
        grid.addWidget(_field("Mobile number", self.input_mobile, True), 1, 0, 1, 2)

        self.input_referred_by = QLineEdit()
        self.input_referred_by.setPlaceholderText("Doctor, clinic or self")
        grid.addWidget(_field("Referred by", self.input_referred_by), 1, 2, 1, 2)

        self.input_address = QTextEdit()
        self.input_address.setPlaceholderText("Village / street, district, pincode")
        self.input_address.setFixedHeight(62)
        self.input_address.setTabChangesFocus(True)
        grid.addWidget(_field("Address", self.input_address), 2, 0, 1, 4)
        for column in range(4):
            grid.setColumnStretch(column, 1 if column < 2 else 0)
        form_col.addLayout(grid)

        form_col.addWidget(_section("VISIT"))
        visit = QGridLayout()
        visit.setHorizontalSpacing(14)
        visit.setVerticalSpacing(12)

        self.input_doctor = QComboBox()
        self.input_doctor.addItem("Select doctor", None)
        for doctor in self.doctor_service.list_doctors():
            label = doctor["name_en"]
            if doctor.get("department"):
                label += f"  ·  {doctor['department']}"
            self.input_doctor.addItem(label, doctor["id"])
        if self.input_doctor.count() == 2:  # a single doctor needs no choice
            self.input_doctor.setCurrentIndex(1)
        visit.addWidget(_field("Doctor / department", self.input_doctor, True), 0, 0, 1, 2)

        self.input_in_time = QDateTimeEdit(QDateTime.currentDateTime())
        self.input_in_time.setDisplayFormat("dd MMM yyyy, hh:mm AP")
        self.input_in_time.setCalendarPopup(True)
        visit.addWidget(_field("Visit date & time", self.input_in_time), 0, 2)

        self.input_condition = QLineEdit()
        self.input_condition.setPlaceholderText("Condition or presenting complaint")
        visit.addWidget(_field("Condition", self.input_condition, True), 1, 0, 1, 3)

        out_box = QWidget()
        out_layout = QVBoxLayout(out_box)
        out_layout.setContentsMargins(0, 0, 0, 0)
        out_layout.setSpacing(4)
        self.out_check = QCheckBox("Patient out")
        self.out_check.setObjectName("FieldLabel")
        out_layout.addWidget(self.out_check)
        self.input_out_time = QDateTimeEdit(QDateTime.currentDateTime())
        self.input_out_time.setDisplayFormat("dd MMM yyyy, hh:mm AP")
        self.input_out_time.setCalendarPopup(True)
        self.input_out_time.setEnabled(False)
        self.out_check.toggled.connect(self.input_out_time.setEnabled)
        out_layout.addWidget(self.input_out_time)
        visit.addWidget(out_box, 1, 3)
        form_col.addLayout(visit)
        form_col.addStretch(1)
        card_layout.addLayout(form_col, stretch=1)
        root.addWidget(card)

        self.error_banner = QLabel("")
        self.error_banner.setObjectName("ErrorBanner")
        self.error_banner.setWordWrap(True)
        self.error_banner.setVisible(False)
        root.addWidget(self.error_banner)

        buttons = QHBoxLayout()
        buttons.addStretch()
        cancel_btn = QPushButton("Cancel")
        cancel_btn.setObjectName("SecondaryButton")
        cancel_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        cancel_btn.clicked.connect(self.cancelled.emit)
        buttons.addWidget(cancel_btn)
        self.save_btn = QPushButton("Save Patient")
        self.save_btn.setObjectName("PrimaryButton")
        self.save_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.save_btn.clicked.connect(self.save_record)
        buttons.addWidget(self.save_btn)
        root.addLayout(buttons)
        root.addStretch(1)

    # ---- photo handling ---------------------------------------------------
    def _capture_from_webcam(self):
        dialog = WebcamCaptureDialog(self)
        if dialog.exec() and dialog.captured_path:
            self._set_photo(dialog.captured_path, is_temp=True)

    def _browse_photo(self):
        file_path, _ = QFileDialog.getOpenFileName(
            self, "Select patient photo", "", "Image Files (*.jpg *.jpeg *.png)"
        )
        if file_path:
            self._set_photo(file_path, is_temp=False)

    def _set_photo(self, path: str, is_temp: bool):
        self._discard_temp_photo()
        self.selected_photo_path = path
        self._photo_is_temp = is_temp
        self._update_photo_preview(path)

    def _discard_temp_photo(self):
        if self._photo_is_temp and self.selected_photo_path:
            try:
                os.remove(self.selected_photo_path)
            except OSError:
                pass
        self._photo_is_temp = False

    def _clear_photo(self):
        self._discard_temp_photo()
        self.selected_photo_path = None
        self.photo_preview.setPixmap(QPixmap())
        self.photo_preview.setText("No photo")

    def _update_photo_preview(self, path_str: str):
        pixmap = QPixmap(path_str)
        if pixmap.isNull():
            return
        # Fill the passport frame, cropping rather than stretching.
        scaled = pixmap.scaled(
            self.photo_preview.size(),
            Qt.AspectRatioMode.KeepAspectRatioByExpanding,
            Qt.TransformationMode.SmoothTransformation,
        )
        x = max(0, (scaled.width() - self.photo_preview.width()) // 2)
        y = max(0, (scaled.height() - self.photo_preview.height()) // 2)
        self.photo_preview.setPixmap(scaled.copy(x, y, self.photo_preview.width(), self.photo_preview.height()))

    # ---- form state -------------------------------------------------------
    def clear_form(self):
        """Resets the form to an empty state for a new patient."""
        self.current_patient_id = None
        self.title_lbl.setText("Register Patient")
        self.urn_display.setText("Patient ID is created when you save")
        self.input_name.clear()
        self.input_age.setValue(AGE_UNSET)
        self.input_sex.setCurrentIndex(0)
        self.input_address.clear()
        self.input_mobile.clear()
        self.input_in_time.setDateTime(QDateTime.currentDateTime())
        self.out_check.setChecked(False)
        self.input_out_time.setDateTime(QDateTime.currentDateTime())
        self.input_referred_by.clear()
        self.input_condition.clear()
        self.input_doctor.setCurrentIndex(1 if self.input_doctor.count() == 2 else 0)
        self._clear_photo()
        self.error_banner.setVisible(False)

    def load_patient(self, patient: dict):
        """Loads an existing patient record into the form for editing."""
        self.current_patient_id = patient["id"]
        self.title_lbl.setText("Edit Patient")
        self.urn_display.setText(patient["serial_urn_no"])

        self.input_name.setText(patient.get("patient_name", ""))
        self.input_age.setValue(int(patient.get("age", AGE_UNSET)))
        idx = self.input_sex.findText(patient.get("sex", ""))
        self.input_sex.setCurrentIndex(max(idx, 0))
        self.input_address.setPlainText(patient.get("address", ""))
        self.input_mobile.setText(patient.get("mobile_no", ""))

        if patient.get("patient_in"):
            dt_in = QDateTime.fromString(patient["patient_in"][:16], "yyyy-MM-dd HH:mm")
            if dt_in.isValid():
                self.input_in_time.setDateTime(dt_in)

        has_out = bool(patient.get("patient_out"))
        self.out_check.setChecked(has_out)
        if has_out:
            dt_out = QDateTime.fromString(patient["patient_out"][:16], "yyyy-MM-dd HH:mm")
            if dt_out.isValid():
                self.input_out_time.setDateTime(dt_out)

        self.input_referred_by.setText(patient.get("referred_by", ""))
        self.input_condition.setText(patient.get("patient_condition", ""))

        doctor_idx = self.input_doctor.findData(patient.get("doctor_id"))
        self.input_doctor.setCurrentIndex(max(doctor_idx, 0))

        self._discard_temp_photo()
        photo_full_path = patient.get("photo_full_path")
        if photo_full_path and Path(photo_full_path).exists():
            self.selected_photo_path = photo_full_path
            self._update_photo_preview(photo_full_path)
        else:
            self._clear_photo()
        self.error_banner.setVisible(False)

    def _show_error(self, message: str):
        self.error_banner.setText(message)
        self.error_banner.setVisible(True)

    def save_record(self):
        """Validates inputs and calls PatientService to persist the record."""
        doctor_id = self.input_doctor.currentData()
        if self.input_name.text().strip() and self.input_age.value() == AGE_UNSET:
            self._show_error("Please enter the patient's age.")
            return
        if self.input_name.text().strip() and self.input_sex.currentIndex() == 0:
            self._show_error("Please select the patient's sex.")
            return
        # New registrations must name a doctor; legacy records without one can still be edited.
        if doctor_id is None and self.current_patient_id is None and self.input_name.text().strip():
            self._show_error("Please choose the doctor / department for this visit.")
            return

        payload = {
            "patient_name": self.input_name.text(),
            "age": self.input_age.value(),
            "sex": self.input_sex.currentText() if self.input_sex.currentIndex() > 0 else "",
            "address": self.input_address.toPlainText(),
            "mobile_no": self.input_mobile.text(),
            "patient_in": self.input_in_time.dateTime().toString("yyyy-MM-dd HH:mm:ss"),
            "patient_out": (
                self.input_out_time.dateTime().toString("yyyy-MM-dd HH:mm:ss")
                if self.out_check.isChecked() else None
            ),
            "referred_by": self.input_referred_by.text(),
            "patient_condition": self.input_condition.text(),
            "doctor_id": doctor_id,
        }

        try:
            if self.current_patient_id is None:
                saved = self.service.register_patient(payload, self.selected_photo_path)
            else:
                saved = self.service.update_patient(
                    self.current_patient_id, payload, self.selected_photo_path
                )
            self.error_banner.setVisible(False)
            self._discard_temp_photo()
            self.patient_saved.emit(saved)
        except ValidationError as e:
            self._show_error(str(e))
        except Exception as e:
            self._show_error(f"Could not save the record: {e}")
