"""Pydantic schemas for physiotherapy treatment sessions and addenda (TRT-02, TRT-03)."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class TreatmentSessionAddendumCreate(BaseModel):
    """Schema for appending a dated addendum to a finalised session."""

    model_config = ConfigDict(extra="forbid")

    note: str = Field(
        min_length=2, max_length=2000, description="Clinical observation or correction"
    )


class TreatmentSessionAddendumOut(BaseModel):
    """Schema for reading an addendum attached to a session."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    author_user_id: int
    author_name: str
    note: str
    created_at: datetime


class TreatmentSessionCreate(BaseModel):
    """Schema for recording a new physiotherapy treatment session."""

    model_config = ConfigDict(extra="forbid")

    session_date: date | None = Field(
        default=None, description="Date session took place (defaults to today)"
    )
    vas_score: int = Field(ge=0, le=10, description="Visual Analog Scale pain rating (0-10)")
    modalities: list[str] = Field(
        default_factory=list, description="Physiotherapy modalities applied (e.g. IFT, Traction)"
    )
    clinical_notes: str = Field(
        min_length=2, max_length=2000, description="Session observations and patient response"
    )


class TreatmentSessionOut(BaseModel):
    """Schema for reading full treatment session details including addenda."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    treatment_plan_id: int
    patient_id: int
    patient_urn: str
    patient_name: str
    doctor_id: int
    doctor_name: str
    session_number: int
    session_date: date
    vas_score: int
    modalities: list[str]
    clinical_notes: str
    is_finalised: bool
    created_by_user_id: int
    created_by_username: str
    created_at: datetime
    addenda: list[TreatmentSessionAddendumOut]
