"""Pydantic schemas for reception visits (RF-12, RF-23)."""

from datetime import date, datetime

from pydantic import BaseModel, Field


class VisitConsultation(BaseModel):
    """One doctor's consultation inside a visit, with what it costs and what is paid."""

    appointment_id: int
    doctor_id: int
    doctor_name_en: str
    token_number: int | None = None
    appointment_status: str
    consultation_status: str | None = None
    appointment_date: date
    fee_paise: int = Field(default=0, ge=0, description="The doctor's consultation fee")
    paid_paise: int = Field(
        default=0, ge=0, description="Payments recorded against it, reversed ones excluded"
    )
    balance_paise: int = Field(
        default=0, ge=0, description="Still due; only a completed consultation owes anything"
    )
    collectable: bool = Field(
        default=False,
        description="True once the doctor has completed it; fees are collected after that",
    )


class VisitPayment(BaseModel):
    """A payment recorded against a consultation in the visit."""

    id: int
    appointment_id: int
    receipt_number: str
    amount_paise: int
    payment_method: str
    is_reversed: bool
    created_at: datetime
    created_by_username: str


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


class VisitSummary(VisitRead):
    """A visit in a list: who was seen, whether it is ready for checkout, and what is due."""

    doctors: list[str]
    completed_consultations: int = Field(..., ge=0)
    active_consultations: int = Field(
        ..., ge=0, description="Consultations still waiting or in progress"
    )
    outstanding_paise: int = Field(..., ge=0)
    token_numbers: list[int] = Field(
        default_factory=list, description="Tokens of non-cancelled consultations, check-in order"
    )
    last_completed_at: datetime | None = Field(
        default=None, description="Latest completion time among completed consultations"
    )


class VisitDetail(VisitRead):
    """A visit with its consultations, its payments and the balance still due on it."""

    consultations: list[VisitConsultation]
    payments: list[VisitPayment]
    total_paid_paise: int = Field(..., ge=0)
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
    visits: list[VisitSummary]


class VisitCloseRequest(BaseModel):
    """Payload to close a visit at checkout ("Patient Out")."""

    version_id: int = Field(..., gt=0, description="Optimistic locking version ID")
    reason: str | None = Field(
        default=None,
        max_length=500,
        description="Required when money is still due; the balance then stays listed as a due",
    )


class VisitCancelRequest(BaseModel):
    """Payload to cancel a visit in which nobody was seen."""

    version_id: int = Field(..., gt=0, description="Optimistic locking version ID")
    reason: str = Field(..., min_length=1, max_length=500, description="Why the visit is cancelled")
