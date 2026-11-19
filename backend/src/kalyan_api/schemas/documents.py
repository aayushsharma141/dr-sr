"""Pydantic schemas for patient documents (Milestone 4, T4.2)."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class PatientDocumentOut(BaseModel):
    """Serialized patient document metadata with resolved uploader and link codes."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    visit_id: int | None = None
    visit_code: str | None = None
    encounter_id: int | None = None
    encounter_code: str | None = None
    title: str
    category: str
    is_clinical: bool
    original_filename: str
    mime_type: str
    file_size_bytes: int
    sha256_hex: str
    notes: str | None = None
    uploaded_by_user_id: int
    uploaded_by_username: str | None = None
    doctor_id: int | None = None
    is_archived: bool
    archived_at: datetime | None = None
    archived_by_user_id: int | None = None
    created_at: datetime
