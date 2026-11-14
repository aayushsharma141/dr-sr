"""Pydantic schemas for reception visits (RF-12)."""

from datetime import date, datetime

from pydantic import BaseModel, Field


class VisitConsultation(BaseModel):
    """One doctor's consultation inside a visit."""

    appointment_id: int
    doctor_id: int
    doctor_name_en: str
    token_number: int | None = None
    appointment_status: str
    consultation_status: str | None = None
    appointment_date: date


class VisitRead(BaseModel):
    """A visit as listed to reception and admin."""

    id: int
    patient_id: int
    patient_urn: str
    patient_name: str
    visit_date: date
    status: str
    opened_by_user_id: int
    opened_at: datetime
    closed_by_user_id: int | None = None
    closed_at: datetime | None = None
    close_reason: str | None = None
    cancelled_by_user_id: int | None = None
    cancelled_at: datetime | None = None
    cancel_reason: str | None = None
    version_id: int


class VisitDetail(VisitRead):
    """A visit with its consultations and the balance still due on it."""

    consultations: list[VisitConsultation]
    outstanding_paise: int = Field(
        ...,
        ge=0,
        description=(
            "Consultation fees of completed consultations not yet covered by payments linked "
            "to those appointments (interim, until invoices exist)"
        ),
    )


class VisitListResponse(BaseModel):
    """Filtered visit list."""

    total: int
    visits: list[VisitRead]


class VisitCloseRequest(BaseModel):
    """Payload to close a visit at checkout ("Patient Out")."""

    version_id: int = Field(..., gt=0, description="Optimistic locking version ID")
    reason: str | None = Field(
        default=None,
        max_length=500,
        description="Required when money is still due; the balance moves to Pending Dues",
    )


class VisitCancelRequest(BaseModel):
    """Payload to cancel a visit in which nobody was seen."""

    version_id: int = Field(..., gt=0, description="Optimistic locking version ID")
    reason: str = Field(..., min_length=1, max_length=500, description="Why the visit is cancelled")
