"""Pydantic schemas for clinical follow-up recommendations and reception booking (DWS-08)."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class FollowUpRecommendationCreate(BaseModel):
    """Schema for doctor creating a follow-up recommendation."""

    model_config = ConfigDict(extra="forbid")

    recommended_date: date = Field(..., description="Target follow-up date")
    recommended_doctor_id: int | None = Field(
        default=None, gt=0, description="Target doctor ID (defaults to current doctor)"
    )
    clinical_reason: str | None = Field(
        default=None, max_length=1000, description="Clinical rationale (doctor-only, hidden from reception)"
    )


class FollowUpCloseRequest(BaseModel):
    """Schema for closing an unbooked follow-up recommendation."""

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=3, max_length=1000, description="Reason for closure")


class FollowUpBookRequest(BaseModel):
    """Schema for booking an appointment from a follow-up recommendation."""

    model_config = ConfigDict(extra="forbid")

    appointment_date: date | None = Field(
        default=None, description="Optional override date (defaults to recommendation date)"
    )
    notes: str | None = Field(default=None, max_length=1000, description="Optional appointment notes")


class DoctorFollowUpResponse(BaseModel):
    """Full follow-up recommendation schema for doctor inspection (includes clinical reason)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    encounter_id: int
    patient_id: int
    patient_name: str
    patient_urn: str
    doctor_id: int
    doctor_name: str
    recommended_doctor_id: int
    recommended_doctor_name: str
    recommended_date: date
    clinical_reason: str | None = None
    status: str
    booked_appointment_id: int | None = None
    closed_reason: str | None = None
    closed_by_user_id: int | None = None
    closed_at: datetime | None = None
    version_id: int
    created_at: datetime
    updated_at: datetime


class ReceptionFollowUpResponse(BaseModel):
    """
    Reception projection for follow-up scheduling (DWS-08, D-19-19).

    CRITICAL SECURITY & PRIVACY INVARIANT:
    clinical_reason is STRICTLY omitted from this schema and never returned to reception.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    encounter_id: int
    patient_id: int
    patient_name: str
    patient_urn: str
    patient_mobile: str | None = None
    recommended_doctor_id: int
    recommended_doctor_name: str
    recommended_date: date
    status: str
    booked_appointment_id: int | None = None
    created_at: datetime
