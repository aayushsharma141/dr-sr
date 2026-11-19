"""Pydantic request and response schemas for patient registration and demographics."""

import re
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator

from kalyan_api import clock
from kalyan_api.models import AllergyCategory, AllergySeverity, AllergyStatus

BLOOD_GROUPS = frozenset({"A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"})
_MOBILE_RE = re.compile(r"^[0-9+ -]{10,15}$")
_EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
_PIN_CODE_RE = re.compile(r"^[0-9 -]{4,10}$")


def compute_age_years(dob: date | None, fallback_age_years: int) -> int:
    """Compute current age in years from DOB against IST today, clamped >= 0."""
    if dob is None:
        return fallback_age_years
    today = clock.ist_today()
    years = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    return max(0, years)


def _normalize_optional_text(value: Any) -> Any:
    """Strip optional string input, normalizing blank strings to None."""
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return value


def _normalize_blood_group(value: Any) -> Any:
    """Strip, uppercase, and validate blood_group against the 8 canonical blood groups."""
    if isinstance(value, str):
        stripped = value.strip().upper()
        if not stripped:
            return None
        if stripped not in BLOOD_GROUPS:
            raise ValueError("blood_group must be one of A+, A-, B+, B-, AB+, AB-, O+, O-")
        return stripped
    return value


def _validate_alternate_mobile(value: str | None) -> str | None:
    """Validate optional alternate mobile format matching primary mobile rules."""
    if value is None:
        return None
    if not _MOBILE_RE.fullmatch(value):
        raise ValueError("Invalid alternate mobile number")
    return value


def _validate_email(value: str | None) -> str | None:
    """Validate optional email address."""
    if value is None:
        return None
    if not _EMAIL_RE.fullmatch(value):
        raise ValueError("Enter a valid email address")
    return value


def _validate_pin_code(value: str | None) -> str | None:
    """Validate optional postal pin code."""
    if value is None:
        return None
    if not _PIN_CODE_RE.fullmatch(value) or sum(ch.isdigit() for ch in value) < 4:
        raise ValueError("Invalid pin code")
    return value


class PatientOut(BaseModel):
    """Full patient demographic entity response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    urn: str
    legacy_urn: str | None = None
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
    alternate_mobile: str | None = None
    email: str | None = None
    blood_group: str | None = None
    pin_code: str | None = None
    guardian_relationship: str | None = None
    medical_history_notes: str | None = None
    allergies: str
    notes: str | None = None
    photo_path: str | None = None
    is_active: bool
    version_id: int
    created_at: datetime
    updated_at: datetime
    merged_into_id: int | None = None
    merged_into_urn: str | None = None
    merged_at: datetime | None = None
    is_archived: bool = False
    archived_at: datetime | None = None
    visit_count: int | None = None
    last_visit_date: date | None = None
    outstanding_paise: int | None = None

    @computed_field
    @property
    def computed_age_years(self) -> int:
        """Birthday-aware age in years derived from dob against IST today, or age_years."""
        return compute_age_years(self.dob, self.age_years)


class PatientCountResponse(BaseModel):
    """Total number of patients matching a directory search."""

    total: int


class PatientCreate(BaseModel):
    """Payload for registering a new patient with 12 canonical fields plus optional details."""

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
    alternate_mobile: str | None = Field(default=None, max_length=15)
    email: str | None = Field(default=None, max_length=120)
    blood_group: str | None = Field(default=None, max_length=8)
    pin_code: str | None = Field(default=None, max_length=10)
    guardian_relationship: str | None = Field(default=None, max_length=40)
    medical_history_notes: str | None = Field(default=None, max_length=4000)
    allergies: str = Field(default="None reported", max_length=1000)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator(
        "alternate_mobile",
        "email",
        "pin_code",
        "guardian_relationship",
        "medical_history_notes",
        mode="before",
    )
    @classmethod
    def _clean_optional_fields(cls, value: Any) -> Any:
        return _normalize_optional_text(value)

    @field_validator("blood_group", mode="before")
    @classmethod
    def _clean_blood_group(cls, value: Any) -> Any:
        return _normalize_blood_group(value)

    @field_validator("alternate_mobile", mode="after")
    @classmethod
    def _check_alternate_mobile(cls, value: str | None) -> str | None:
        return _validate_alternate_mobile(value)

    @field_validator("email", mode="after")
    @classmethod
    def _check_email(cls, value: str | None) -> str | None:
        return _validate_email(value)

    @field_validator("pin_code", mode="after")
    @classmethod
    def _check_pin_code(cls, value: str | None) -> str | None:
        return _validate_pin_code(value)


class PatientUpdate(BaseModel):
    """Payload for modifying demographic fields with optimistic concurrency control."""

    model_config = ConfigDict(extra="forbid")

    version_id: int = Field(ge=1, description="Optimistic concurrency control version.")
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    guardian_name: str | None = Field(default=None, min_length=2, max_length=120)
    gender: str | None = Field(default=None, pattern=r"^[MFO]$")
    dob: date | None = None
    age_years: int | None = Field(default=None, ge=0, le=150)
    mobile: str | None = Field(
        default=None, min_length=10, max_length=15, pattern=r"^[0-9+ -]{10,15}$"
    )
    address: str | None = Field(default=None, min_length=2, max_length=1000)
    district: str | None = Field(default=None, min_length=2, max_length=64)
    state: str | None = Field(default=None, min_length=2, max_length=64)
    emergency_contact: str | None = Field(default=None, max_length=120)
    alternate_mobile: str | None = Field(default=None, max_length=15)
    email: str | None = Field(default=None, max_length=120)
    blood_group: str | None = Field(default=None, max_length=8)
    pin_code: str | None = Field(default=None, max_length=10)
    guardian_relationship: str | None = Field(default=None, max_length=40)
    medical_history_notes: str | None = Field(default=None, max_length=4000)
    allergies: str | None = Field(default=None, max_length=1000)
    notes: str | None = Field(default=None, max_length=2000)
    is_active: bool | None = None

    @field_validator(
        "alternate_mobile",
        "email",
        "pin_code",
        "guardian_relationship",
        "medical_history_notes",
        mode="before",
    )
    @classmethod
    def _clean_optional_fields(cls, value: Any) -> Any:
        return _normalize_optional_text(value)

    @field_validator("blood_group", mode="before")
    @classmethod
    def _clean_blood_group(cls, value: Any) -> Any:
        return _normalize_blood_group(value)

    @field_validator("alternate_mobile", mode="after")
    @classmethod
    def _check_alternate_mobile(cls, value: str | None) -> str | None:
        return _validate_alternate_mobile(value)

    @field_validator("email", mode="after")
    @classmethod
    def _check_email(cls, value: str | None) -> str | None:
        return _validate_email(value)

    @field_validator("pin_code", mode="after")
    @classmethod
    def _check_pin_code(cls, value: str | None) -> str | None:
        return _validate_pin_code(value)


class PatientAllergyCreate(BaseModel):
    """Payload for recording a structured clinical allergy (DOCTOR only)."""

    model_config = ConfigDict(extra="forbid")

    substance: str = Field(min_length=1, max_length=160)
    category: AllergyCategory = Field(default=AllergyCategory.DRUG)
    severity: AllergySeverity = Field(default=AllergySeverity.MODERATE)
    reaction: str | None = Field(default=None, max_length=2000)
    clinical_notes: str | None = Field(default=None, max_length=4000)
    status: AllergyStatus = Field(default=AllergyStatus.ACTIVE)

    @field_validator("substance", mode="before")
    @classmethod
    def _clean_substance(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("reaction", "clinical_notes", mode="before")
    @classmethod
    def _clean_optional_notes(cls, value: Any) -> Any:
        return _normalize_optional_text(value)


class PatientAllergyUpdate(BaseModel):
    """Payload for updating a structured clinical allergy with optimistic locking (DOCTOR only)."""

    model_config = ConfigDict(extra="forbid")

    version_id: int = Field(ge=1, description="Optimistic concurrency control version.")
    substance: str | None = Field(default=None, min_length=1, max_length=160)
    category: AllergyCategory | None = None
    severity: AllergySeverity | None = None
    reaction: str | None = Field(default=None, max_length=2000)
    clinical_notes: str | None = Field(default=None, max_length=4000)
    status: AllergyStatus | None = None

    @field_validator("substance", mode="before")
    @classmethod
    def _clean_substance(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("reaction", "clinical_notes", mode="before")
    @classmethod
    def _clean_optional_notes(cls, value: Any) -> Any:
        return _normalize_optional_text(value)


class PatientAllergyOut(BaseModel):
    """Full structured clinical allergy response (DOCTOR-only, D-04)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    substance: str
    category: str
    severity: str
    reaction: str | None = None
    clinical_notes: str | None = None
    status: str
    doctor_id: int | None = None
    recorded_by_user_id: int | None = None
    recorded_by_username: str | None = None
    created_at: datetime
    updated_at: datetime
    version_id: int

    @model_validator(mode="before")
    @classmethod
    def _extract_recorded_by_username(cls, data: Any) -> Any:
        if not isinstance(data, dict) and hasattr(data, "recorded_by_user"):
            user = getattr(data, "recorded_by_user", None)
            if user is not None and not hasattr(data, "recorded_by_username"):
                return {
                    "id": data.id,
                    "patient_id": data.patient_id,
                    "substance": data.substance,
                    "category": data.category,
                    "severity": data.severity,
                    "reaction": data.reaction,
                    "clinical_notes": data.clinical_notes,
                    "status": data.status,
                    "doctor_id": data.doctor_id,
                    "recorded_by_user_id": data.recorded_by_user_id,
                    "recorded_by_username": user.username,
                    "created_at": data.created_at,
                    "updated_at": data.updated_at,
                    "version_id": data.version_id,
                }
        return data


class DuplicateCheckResponse(BaseModel):
    """Duplicate search check response."""

    has_duplicate: bool
    matching_patient: PatientOut | None = None


class AdminPatientDemographicCorrection(BaseModel):
    """Payload for administrative demographic correction with mandatory reason and concurrency check (D-20-02, D-20-03)."""  # noqa: E501 - published as the OpenAPI description; wrapping changes the text

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(
        ..., min_length=5, max_length=1000, description="Documented reason for correction"
    )
    version_id: int = Field(..., ge=1, description="Expected version_id for optimistic locking")
    full_name: str = Field(..., min_length=2, max_length=120)
    guardian_name: str = Field(..., min_length=2, max_length=120)
    gender: str = Field(..., pattern=r"^[MFO]$")
    dob: date | None = None
    age_years: int = Field(..., ge=0, le=150)
    mobile: str = Field(..., pattern=r"^[0-9]{10}$")
    address: str = Field(..., min_length=2, max_length=1000)
    district: str = Field(default="Bhojpur", min_length=2, max_length=64)
    state: str = Field(default="Bihar", min_length=2, max_length=64)
    emergency_contact: str | None = Field(default=None, max_length=120)


# Phase 23: Duplicate Detection & Merge Schemas
class DuplicateCandidatePair(BaseModel):
    """A pair of active patient records identified as potential duplicates."""

    master: PatientOut
    duplicate: PatientOut
    similarity_score: float
    match_reason: str
    master_visit_count: int = 0
    duplicate_visit_count: int = 0
    has_open_visit: bool = False
    open_visit_details: str | None = None


class PatientMergeRequest(BaseModel):
    """Payload for merging a secondary duplicate patient into a master patient."""

    model_config = ConfigDict(extra="forbid")

    master_patient_id: int = Field(..., gt=0)
    secondary_patient_id: int = Field(..., gt=0)
    reason: str = Field(..., min_length=3, max_length=1000)
    demographic_overrides: dict[str, str | int | None] | None = None


class PatientMergeResult(BaseModel):
    """Result of an alias-pointer patient merge."""

    master: PatientOut
    secondary: PatientOut
    message: str


class PatientUnmergeRequest(BaseModel):
    """Payload for undoing an alias-pointer merge."""

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(..., min_length=3, max_length=1000)


class PatientUnarchiveRequest(BaseModel):
    """Payload for restoring an archived patient."""

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(..., min_length=3, max_length=1000)


# Phase 23: Filtered Bulk Archival Schemas
class ArchivalCandidateItem(BaseModel):
    """A patient candidate for bulk archival."""

    patient: PatientOut
    last_activity_date: date | None = None
    visit_count: int = 0
    total_dues_paise: int = 0
    can_archive: bool = True
    blocking_reason: str | None = None


class BulkArchiveRequest(BaseModel):
    """Payload for administratively archiving a batch of eligible patients."""

    model_config = ConfigDict(extra="forbid")

    patient_ids: list[int] = Field(..., min_length=1, max_length=500)
    reason: str = Field(..., min_length=3, max_length=1000)


class BulkArchiveResult(BaseModel):
    """Summary of bulk archival operation."""

    archived_count: int
    skipped_count: int
    skipped_details: list[dict[str, str | int]] = []
    message: str
