"""Pydantic schemas for clinical encounters and dated addenda (CLN-01, CLN-02)."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AddendumCreate(BaseModel):
    """Payload to add a dated addendum to a finalised encounter."""

    addendum_text: str = Field(..., min_length=2, max_length=5000, description="Addendum text")


class AddendumRead(BaseModel):
    """Dated addendum attached to an encounter."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    encounter_id: int
    doctor_id: int
    doctor_name: str
    addendum_text: str
    created_at: datetime


class EncounterCreate(BaseModel):
    """Payload to record a clinical encounter (CLN-01)."""

    patient_id: int = Field(..., gt=0, description="Target patient ID")
    appointment_id: int | None = Field(
        default=None, gt=0, description="Optional linked appointment ID"
    )
    symptoms: str = Field(
        ..., min_length=2, max_length=5000, description="Chief complaints and symptoms"
    )
    clinical_notes: str = Field(
        ..., min_length=2, max_length=10000, description="Examination and progress notes"
    )
    diagnosis: str = Field(
        ..., min_length=2, max_length=5000, description="Clinical diagnosis or impression"
    )


class EncounterUpdate(BaseModel):
    """Payload to update an unfinalised draft encounter note."""

    symptoms: str | None = Field(default=None, min_length=2, max_length=5000)
    clinical_notes: str | None = Field(default=None, min_length=2, max_length=10000)
    diagnosis: str | None = Field(default=None, min_length=2, max_length=5000)
    version_id: int = Field(..., gt=0, description="Optimistic locking version ID")


class EncounterRead(BaseModel):
    """Detailed clinical encounter record with attached addenda."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    patient_urn: str
    patient_name: str
    doctor_id: int
    doctor_name: str
    appointment_id: int | None = None
    encounter_date: datetime
    symptoms: str
    clinical_notes: str
    diagnosis: str
    is_finalised: bool
    finalised_at: datetime | None = None
    version_id: int
    created_at: datetime
    updated_at: datetime
    addenda: list[AddendumRead] = Field(default_factory=list)


class EncounterSummary(BaseModel):
    """Compact summary of encounter for patient historical timeline."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    doctor_id: int
    doctor_name: str
    encounter_date: datetime
    diagnosis: str
    is_finalised: bool
    finalised_at: datetime | None = None
    addenda_count: int = 0
