"""Pydantic schemas for appointment booking, status updates and queue management."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from kalyan_api.models import AppointmentStatus


class AppointmentCreate(BaseModel):
    """Payload to book an appointment (APT-01)."""

    patient_id: int = Field(..., gt=0, description="Target patient ID")
    doctor_id: int = Field(..., gt=0, description="Target doctor ID")
    department_id: int = Field(..., gt=0, description="Configured department/specialty ID")
    appointment_date: date = Field(..., description="Scheduled appointment date")
    notes: str | None = Field(default=None, max_length=1000, description="Reception notes")
    override_reason: str | None = Field(
        default=None,
        max_length=500,
        description=(
            "Reason of at least 5 characters to override duplicate booking on the same date "
            "(BR-006)"
        ),
    )


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
    department_id: int | None = None
    doctor_name_en: str
    doctor_name_hi: str | None = None
    appointment_date: date
    token_number: int
    status: str
    status_updated_at: datetime
    check_in_at: datetime | None = None
    cancellation_reason: str | None = None
    notes: str | None = None
    version_id: int
    created_at: datetime
    updated_at: datetime


class AppointmentListResponse(BaseModel):
    """Paginated or filtered appointment list response."""

    total: int
    appointments: list[AppointmentRead]


class DoctorQueueItem(BaseModel):
    """Item in doctor consultation queue."""

    id: int
    patient_id: int
    patient_urn: str
    patient_name: str
    patient_gender: str
    patient_age: int
    patient_mobile: str
    patient_allergies: str
    token_number: int
    status: str
    status_updated_at: datetime
    notes: str | None = None
    version_id: int


class DoctorQueueResponse(BaseModel):
    """Doctor daily consultation queue divided by operational sections (APT-02)."""

    doctor_id: int
    doctor_name: str
    queue_date: date
    in_consultation: list[DoctorQueueItem]
    waiting: list[DoctorQueueItem]
    booked: list[DoctorQueueItem]
    completed: list[DoctorQueueItem]
    total_active: int
