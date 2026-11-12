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
    """Payload to record a clinical encounter (CLN-01, DWS-02 draft state)."""

    patient_id: int = Field(..., gt=0, description="Target patient ID")
    appointment_id: int | None = Field(
        default=None, gt=0, description="Optional linked appointment ID"
    )
    department_id: int | None = Field(
        default=None, gt=0, description="Optional department/specialty ID"
    )
    symptoms: str = Field(
        default="", max_length=5000, description="Chief complaints and symptoms"
    )
    clinical_notes: str = Field(
        default="", max_length=10000, description="Examination and progress notes"
    )
    diagnosis: str = Field(
        default="", max_length=5000, description="Clinical diagnosis or impression"
    )


class EncounterUpdate(BaseModel):
    """Payload to update an unfinalised draft encounter note."""

    symptoms: str | None = Field(default=None, max_length=5000)
    clinical_notes: str | None = Field(default=None, max_length=10000)
    diagnosis: str | None = Field(default=None, max_length=5000)
    department_id: int | None = Field(default=None, gt=0)
    version_id: int = Field(..., gt=0, description="Optimistic locking version ID")


class EncounterFinaliseRequest(BaseModel):
    """Payload to finalise an encounter requiring mandatory fields (D-19-09)."""

    symptoms: str = Field(
        ..., min_length=2, max_length=5000, description="Chief complaint (min 2 characters)"
    )
    diagnosis: str = Field(
        ..., min_length=2, max_length=5000, description="Diagnosis (min 2 characters)"
    )
    clinical_notes: str | None = Field(default=None, max_length=10000)
    version_id: int | None = Field(
        default=None, gt=0, description="Optimistic locking version ID (FB-01)"
    )


class EncounterRead(BaseModel):
    """Detailed clinical encounter record with attached addenda."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    patient_urn: str
    patient_name: str
    patient_mobile: str | None = None
    patient_address: str | None = None
    doctor_id: int
    doctor_name: str
    appointment_id: int | None = None
    department_id: int | None = None
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


class UnfinishedEncounterItem(BaseModel):
    """Active draft clinical encounter awaiting doctor completion (D-19-24, DWS-02)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    patient_urn: str
    patient_name: str
    department_id: int | None = None
    department_name: str = ""
    started_at: datetime
    is_finalised: bool = False

