"""Pydantic request and response schemas for patient registration and demographics (PAT-01)."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class PatientOut(BaseModel):
    """Full patient demographic entity response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    urn: str
    full_name: str
    guardian_name: str
    gender: str
    dob: date | None = None
    age_years: int
    mobile: str
    address: str
    district: str
    state: str
    emergency_contact: str | None = None
    allergies: str
    notes: str | None = None
    photo_path: str | None = None
    is_active: bool
    version_id: int
    created_at: datetime
    updated_at: datetime


class PatientCreate(BaseModel):
    """Payload for registering a new patient with 12 canonical fields."""

    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=2, max_length=120)
    guardian_name: str = Field(min_length=2, max_length=120)
    gender: str = Field(pattern=r"^[MFO]$")
    dob: date | None = None
    age_years: int = Field(ge=0, le=150)
    mobile: str = Field(min_length=10, max_length=15, pattern=r"^[0-9+ -]{10,15}$")
    address: str = Field(min_length=2, max_length=1000)
    district: str = Field(default="Bhojpur", min_length=2, max_length=64)
    state: str = Field(default="Bihar", min_length=2, max_length=64)
    emergency_contact: str | None = Field(default=None, max_length=120)
    allergies: str = Field(default="None reported", max_length=1000)
    notes: str | None = Field(default=None, max_length=2000)


class DuplicateCheckResponse(BaseModel):
    """Duplicate search check response."""

    has_duplicate: bool
    matching_patient: PatientOut | None = None
