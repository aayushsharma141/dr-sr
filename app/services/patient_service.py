"""
Patient Service implementing demographic validation, atomic registration,
and local photo storage management.
"""

from pathlib import Path
import re
import shutil
from typing import Any

from app.config import PHOTOS_DIR
from app.repositories.patient_repository import PatientRepository


class ValidationError(Exception):
    """Raised when user-supplied patient data fails business validation."""
    pass


class PatientService:
    """Coordinates patient validation, ID generation, and file storage."""

    def __init__(self, db_path: Path | str | None = None):
        self.db_path = db_path
        self.repository = PatientRepository(db_path)

    def validate_patient_data(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        Validates demographic input constraints and returns cleaned data.
        Raises ValidationError if any field is invalid.
        """
        cleaned = dict(data)

        # 1. Patient Name
        name = str(cleaned.get("patient_name", "")).strip()
        if not name:
            raise ValidationError("Patient Name is required and cannot be empty.")
        if len(name) > 150:
            raise ValidationError("Patient Name cannot exceed 150 characters.")
        cleaned["patient_name"] = name

        # 2. Age
        try:
            age = int(cleaned.get("age", -1))
        except (ValueError, TypeError):
            raise ValidationError("Age must be a valid integer.")

        if age < 0 or age > 125:
            raise ValidationError("Age must be between 0 and 125.")
        cleaned["age"] = age

        # 3. Sex / Gender
        sex = str(cleaned.get("sex", "")).strip().capitalize()
        if sex not in ("Male", "Female", "Other"):
            raise ValidationError("Sex must be 'Male', 'Female', or 'Other'.")
        cleaned["sex"] = sex

        # 4. Mobile Number
        raw_mobile = str(cleaned.get("mobile_no", ""))
        digits_only = re.sub(r"\D", "", raw_mobile)
        # Accept standard 10-digit Indian mobile number
        if len(digits_only) == 10:
            cleaned["mobile_no"] = digits_only
        elif len(digits_only) == 12 and digits_only.startswith("91"):
            cleaned["mobile_no"] = digits_only[2:]
        else:
            raise ValidationError("Mobile number must be a valid 10-digit phone number.")

        # 5. Patient Condition / Diagnosis
        condition = str(cleaned.get("patient_condition", "")).strip()
        if not condition:
            raise ValidationError("Patient Condition / Diagnosis is required.")
        cleaned["patient_condition"] = condition

        # 6. Optional Address & Referral
        cleaned["address"] = str(cleaned.get("address", "")).strip()
        cleaned["referred_by"] = str(cleaned.get("referred_by", "")).strip()

        return cleaned

    def register_patient(
        self,
        data: dict[str, Any],
        photo_source_path: str | Path | None = None,
    ) -> dict[str, Any]:
        """
        Validates input, generates a unique URN, copies photo to local storage,
        and saves the patient into SQLite.
        """
        cleaned = self.validate_patient_data(data)

        # Generate atomic URN if not provided
        if not cleaned.get("serial_urn_no"):
            cleaned["serial_urn_no"] = self.repository.generate_next_urn()

        # Handle Patient Photograph
        if photo_source_path:
            source = Path(photo_source_path)
            if source.exists() and source.is_file():
                ext = source.suffix.lower()
                if ext not in (".jpg", ".jpeg", ".png"):
                    raise ValidationError("Photo must be a JPEG or PNG image file.")

                # Unique sanitized destination filename
                dest_filename = f"{cleaned['serial_urn_no']}{ext}"
                dest_path = PHOTOS_DIR / dest_filename
                shutil.copy2(source, dest_path)
                cleaned["photo_filename"] = dest_filename

        patient_id = self.repository.create(cleaned)
        return self.get_patient(patient_id)  # type: ignore

    def update_patient(
        self,
        patient_id: int,
        data: dict[str, Any],
        new_photo_path: str | Path | None = None,
    ) -> dict[str, Any]:
        """
        Updates an existing patient record after validating modified fields.
        """
        existing = self.repository.get_by_id(patient_id)
        if not existing:
            raise ValidationError(f"Patient with ID {patient_id} does not exist.")

        cleaned = self.validate_patient_data(data)

        # Retain existing photo if no new one provided
        if new_photo_path:
            source = Path(new_photo_path)
            if source.exists() and source.is_file():
                ext = source.suffix.lower()
                if ext not in (".jpg", ".jpeg", ".png"):
                    raise ValidationError("Photo must be a JPEG or PNG image file.")

                dest_filename = f"{existing['serial_urn_no']}{ext}"
                dest_path = PHOTOS_DIR / dest_filename
                shutil.copy2(source, dest_path)
                cleaned["photo_filename"] = dest_filename
        else:
            cleaned["photo_filename"] = existing.get("photo_filename", "")

        self.repository.update(patient_id, cleaned)
        return self.get_patient(patient_id)  # type: ignore

    def get_patient(self, patient_id: int) -> dict[str, Any] | None:
        """
        Retrieves patient by ID and resolves absolute photo path if file exists.
        """
        patient = self.repository.get_by_id(patient_id)
        if not patient:
            return None

        # Resolve photo absolute path
        photo_filename = patient.get("photo_filename")
        if photo_filename:
            full_path = PHOTOS_DIR / photo_filename
            patient["photo_full_path"] = str(full_path) if full_path.exists() else None
        else:
            patient["photo_full_path"] = None

        return patient

    def get_patient_by_urn(self, serial_urn_no: str) -> dict[str, Any] | None:
        """Retrieves patient by URN."""
        patient = self.repository.get_by_urn(serial_urn_no)
        if patient:
            photo_filename = patient.get("photo_filename")
            if photo_filename:
                full_path = PHOTOS_DIR / photo_filename
                patient["photo_full_path"] = str(full_path) if full_path.exists() else None
            else:
                patient["photo_full_path"] = None
        return patient

    def search_patients(self, query: str = "", limit: int = 50) -> list[dict[str, Any]]:
        """Searches patients by ID, Name, or Mobile number."""
        patients = self.repository.search(query, limit)
        for p in patients:
            photo_filename = p.get("photo_filename")
            if photo_filename:
                full_path = PHOTOS_DIR / photo_filename
                p["photo_full_path"] = str(full_path) if full_path.exists() else None
            else:
                p["photo_full_path"] = None
        return patients
