"""
Patient Registration and Edit Form View capturing canonical demographic fields 1-10 and photo.
"""

from pathlib import Path
from PySide6.QtCore import QDateTime, Qt, Signal
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (
    QComboBox,
    QDateTimeEdit,
    QFileDialog,
    QFormLayout,
    QFrame,
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
from app.services.patient_service import PatientService, ValidationError


class PatientFormView(QWidget):
    """
    Intake and profile editing form conforming to Kalyan Hospital's
    prescribed demographic fields (1-10 + Photo).
    """

    patient_saved = Signal(dict)
    cancelled = Signal()

    def __init__(
        self,
        patient_service: PatientService | None = None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.service = patient_service or PatientService()
        self.current_patient_id: int | None = None
        self.selected_photo_path: str | None = None

        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(28, 20, 28, 20)
        root_layout.setSpacing(16)

        # 1. Header with title and mode indicator
        header_layout = QHBoxLayout()
        self.title_lbl = QLabel("Patient Registration Form")
        self.title_lbl.setObjectName("PageHeading")
        header_layout.addWidget(self.title_lbl)

        header_layout.addStretch()

        back_btn = QPushButton("← Back to Directory")
        back_btn.setObjectName("SecondaryButton")
        back_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        back_btn.clicked.connect(self.cancelled.emit)
        header_layout.addWidget(back_btn)

        root_layout.addLayout(header_layout)

        # 2. Main Form Card Container
        form_card = QFrame()
        form_card.setObjectName("CardPanel")
        form_layout = QHBoxLayout(form_card)
        form_layout.setContentsMargins(24, 20, 24, 20)
        form_layout.setSpacing(32)

        # Left Column: Inputs Form
        left_inputs = QWidget()
        left_layout = QFormLayout(left_inputs)
        left_layout.setSpacing(12)
        left_layout.setLabelAlignment(Qt.AlignmentFlag.AlignRight)

        # Field 1: Serial / URN
        self.urn_display = QLabel("Auto-generated on save")
        self.urn_display.setStyleSheet("font-weight: 700; color: #64748B; font-size: 13px;")
        left_layout.addRow("1. Serial / URN No.:", self.urn_display)

        # Field 2: Patient Name
        self.input_name = QLineEdit()
        self.input_name.setPlaceholderText("Enter patient's full name")
        left_layout.addRow("2. Patient Name *:", self.input_name)

        # Fields 3 & 4: Age & Sex in a row
        age_sex_box = QHBoxLayout()
        self.input_age = QSpinBox()
        self.input_age.setRange(0, 125)
        self.input_age.setValue(35)
        self.input_age.setFixedWidth(80)
        age_sex_box.addWidget(self.input_age)

        age_sex_box.addWidget(QLabel("   4. Sex *: "))
        self.input_sex = QComboBox()
        self.input_sex.addItems(["Male", "Female", "Other"])
        self.input_sex.setFixedWidth(110)
        age_sex_box.addWidget(self.input_sex)
        age_sex_box.addStretch()
        left_layout.addRow("3. Age *:", age_sex_box)

        # Field 5: Address
        self.input_address = QTextEdit()
        self.input_address.setPlaceholderText("Residential address (village/street, district, pincode)")
        self.input_address.setFixedHeight(64)
        left_layout.addRow("5. Address:", self.input_address)

        # Field 6: Mobile No.
        self.input_mobile = QLineEdit()
        self.input_mobile.setPlaceholderText("10-digit mobile number")
        self.input_mobile.setMaxLength(14)
        left_layout.addRow("6. Mobile No. *:", self.input_mobile)

        # Field 7: Patient In
        self.input_in_time = QDateTimeEdit(QDateTime.currentDateTime())
        self.input_in_time.setDisplayFormat("yyyy-MM-dd HH:mm")
        self.input_in_time.setCalendarPopup(True)
        left_layout.addRow("7. Patient In (Date & Time):", self.input_in_time)

        # Field 8: Patient Out
        self.input_out_time = QDateTimeEdit(QDateTime.currentDateTime())
        self.input_out_time.setDisplayFormat("yyyy-MM-dd HH:mm")
        self.input_out_time.setCalendarPopup(True)
        left_layout.addRow("8. Patient Out (Optional):", self.input_out_time)

        # Field 9: Reference / Referred By
        self.input_referred_by = QLineEdit()
        self.input_referred_by.setPlaceholderText("Doctor, clinic, or word-of-mouth referral")
        left_layout.addRow("9. Referred By:", self.input_referred_by)

        # Field 10: Patient Condition
        self.input_condition = QLineEdit()
        self.input_condition.setPlaceholderText("Diagnosis / clinical condition (e.g. Cervical Spondylosis)")
        left_layout.addRow("10. Patient Condition *:", self.input_condition)

        form_layout.addWidget(left_inputs, stretch=2)

        # Right Column: Photo Management Box
        right_photo = QWidget()
        right_layout = QVBoxLayout(right_photo)
        right_layout.setAlignment(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignHCenter)
        right_layout.setSpacing(12)

        photo_title = QLabel("Patient Picture")
        photo_title.setStyleSheet("font-weight: 600; color: #475569;")
        right_layout.addWidget(photo_title)

        self.photo_preview = QLabel("No Photo Selected")
        self.photo_preview.setFixedSize(140, 160)
        self.photo_preview.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.photo_preview.setStyleSheet(
            "border: 2px dashed #CBD5E1; border-radius: 8px; background-color: #F8FAFC; color: #94A3B8;"
        )
        right_layout.addWidget(self.photo_preview)

        browse_photo_btn = QPushButton("📷 Choose Photo...")
        browse_photo_btn.setObjectName("SecondaryButton")
        browse_photo_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        browse_photo_btn.clicked.connect(self._browse_photo)
        right_layout.addWidget(browse_photo_btn)

        clear_photo_btn = QPushButton("Remove Photo")
        clear_photo_btn.setStyleSheet("color: #EF4444; border: none; background: transparent;")
        clear_photo_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        clear_photo_btn.clicked.connect(self._clear_photo)
        right_layout.addWidget(clear_photo_btn)

        form_layout.addWidget(right_photo, stretch=1)

        root_layout.addWidget(form_card)

        # 3. Validation Banner & Action Buttons
        self.error_banner = QLabel("")
        self.error_banner.setStyleSheet(
            "color: #DC2626; background-color: #FEF2F2; padding: 8px 12px; border-radius: 6px; border: 1px solid #FCA5A5;"
        )
        self.error_banner.setVisible(False)
        root_layout.addWidget(self.error_banner)

        button_row = QHBoxLayout()
        button_row.addStretch()

        cancel_btn = QPushButton("Cancel")
        cancel_btn.setObjectName("SecondaryButton")
        cancel_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        cancel_btn.clicked.connect(self.cancelled.emit)
        button_row.addWidget(cancel_btn)

        save_btn = QPushButton("💾  Save Patient Record")
        save_btn.setObjectName("PrimaryButton")
        save_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        save_btn.clicked.connect(self.save_record)
        button_row.addWidget(save_btn)

        root_layout.addLayout(button_row)
        root_layout.addStretch()

    def _browse_photo(self):
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Select Patient Photograph",
            "",
            "Image Files (*.jpg *.jpeg *.png)",
        )
        if file_path:
            self.selected_photo_path = file_path
            self._update_photo_preview(file_path)

    def _clear_photo(self):
        self.selected_photo_path = None
        self.photo_preview.setText("No Photo Selected")
        self.photo_preview.setPixmap(QPixmap())

    def _update_photo_preview(self, path_str: str):
        pixmap = QPixmap(path_str)
        if not pixmap.isNull():
            scaled = pixmap.scaled(
                self.photo_preview.size(),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            self.photo_preview.setPixmap(scaled)

    def clear_form(self):
        """Resets the form to empty initial state for a new patient."""
        self.current_patient_id = None
        self.selected_photo_path = None
        self.title_lbl.setText("Patient Registration Form")
        self.urn_display.setText("Auto-generated on save")
        self.urn_display.setStyleSheet("font-weight: 700; color: #64748B; font-size: 13px;")
        self.input_name.clear()
        self.input_age.setValue(35)
        self.input_sex.setCurrentIndex(0)
        self.input_address.clear()
        self.input_mobile.clear()
        self.input_in_time.setDateTime(QDateTime.currentDateTime())
        self.input_out_time.setDateTime(QDateTime.currentDateTime())
        self.input_referred_by.clear()
        self.input_condition.clear()
        self._clear_photo()
        self.error_banner.setVisible(False)

    def load_patient(self, patient: dict):
        """Loads an existing patient record into the form for editing."""
        self.current_patient_id = patient["id"]
        self.title_lbl.setText(f"Edit Patient Record — {patient['serial_urn_no']}")
        self.urn_display.setText(patient["serial_urn_no"])
        self.urn_display.setStyleSheet(f"font-weight: 700; color: {COLORS['primary']}; font-size: 14px;")

        self.input_name.setText(patient.get("patient_name", ""))
        self.input_age.setValue(int(patient.get("age", 30)))

        sex = patient.get("sex", "Male")
        idx = self.input_sex.findText(sex)
        if idx >= 0:
            self.input_sex.setCurrentIndex(idx)

        self.input_address.setPlainText(patient.get("address", ""))
        self.input_mobile.setText(patient.get("mobile_no", ""))

        if patient.get("patient_in"):
            dt_in = QDateTime.fromString(patient["patient_in"][:16], "yyyy-MM-dd HH:mm")
            if dt_in.isValid():
                self.input_in_time.setDateTime(dt_in)

        if patient.get("patient_out"):
            dt_out = QDateTime.fromString(patient["patient_out"][:16], "yyyy-MM-dd HH:mm")
            if dt_out.isValid():
                self.input_out_time.setDateTime(dt_out)

        self.input_referred_by.setText(patient.get("referred_by", ""))
        self.input_condition.setText(patient.get("patient_condition", ""))

        photo_full_path = patient.get("photo_full_path")
        if photo_full_path and Path(photo_full_path).exists():
            self.selected_photo_path = photo_full_path
            self._update_photo_preview(photo_full_path)
        else:
            self._clear_photo()

        self.error_banner.setVisible(False)

    def save_record(self):
        """Validates inputs and calls PatientService to persist the record."""
        payload = {
            "patient_name": self.input_name.text(),
            "age": self.input_age.value(),
            "sex": self.input_sex.currentText(),
            "address": self.input_address.toPlainText(),
            "mobile_no": self.input_mobile.text(),
            "patient_in": self.input_in_time.dateTime().toString("yyyy-MM-dd HH:mm:ss"),
            "patient_out": self.input_out_time.dateTime().toString("yyyy-MM-dd HH:mm:ss"),
            "referred_by": self.input_referred_by.text(),
            "patient_condition": self.input_condition.text(),
        }

        try:
            if self.current_patient_id is None:
                saved = self.service.register_patient(payload, self.selected_photo_path)
            else:
                saved = self.service.update_patient(
                    self.current_patient_id, payload, self.selected_photo_path
                )

            self.error_banner.setVisible(False)
            self.patient_saved.emit(saved)
        except ValidationError as e:
            self.error_banner.setText(f"⚠ {str(e)}")
            self.error_banner.setVisible(True)
        except Exception as e:
            self.error_banner.setText(f"Database error: {str(e)}")
            self.error_banner.setVisible(True)
