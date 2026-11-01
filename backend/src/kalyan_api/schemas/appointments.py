"""Pydantic schemas for appointment booking, status updates and queue management."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from kalyan_api.models import AppointmentStatus


class AppointmentCreate(BaseModel):
    """Payload to book an appointment (APT-01)."""

    patient_id: int = Field(..., gt=0, description="Target patient ID")
    doctor_id: int = Field(..., gt=0, description="Target doctor ID")
    appointment_date: date = Field(..., description="Scheduled appointment date")
    notes: str | None = Field(default=None, max_length=1000, description="Reception notes")


class AppointmentStatusUpdate(BaseModel):
    """Payload to transition appointment workflow status (APT-02)."""

    status: AppointmentStatus = Field(..., description="Target status")
    version_id: int = Field(..., gt=0, description="Optimistic locking version ID")
    cancellation_reason: str | None = Field(
        default=None, max_length=500, description="Required when moving to CANCELLED"
    )


class AppointmentRead(BaseModel):
    """Detailed appointment record."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    patient_urn: str
    patient_name: str
    patient_mobile: str
    doctor_id: int
    doctor_name_en: str
    doctor_name_hi: str | None = None
    appointment_date: date
    token_number: int
    status: str
    status_updated_at: datetime
    cancellation_reason: str | None = None
    notes: str | None = None
    version_id: int
    created_at: datetime
    updated_at: datetime


class AppointmentListResponse(BaseModel):
    """Paginated or filtered appointment list response."""

    total: int
    appointments: list[AppointmentRead]
