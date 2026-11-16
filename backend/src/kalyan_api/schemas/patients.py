"""Pydantic request and response schemas for patient registration and demographics."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


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


class PatientCountResponse(BaseModel):
    """Total number of patients matching a directory search."""

    total: int


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
    allergies: str | None = Field(default=None, max_length=1000)
    notes: str | None = Field(default=None, max_length=2000)
    is_active: bool | None = None


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
