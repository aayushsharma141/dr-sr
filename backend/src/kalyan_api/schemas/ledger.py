"""Pydantic schemas for Admin payment refunds and append-only patient financial ledger (T3.3)."""

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from kalyan_api.schemas.billing import PaymentOut


def _strip_text(value: Any) -> Any:
    """Strip surrounding whitespace from string payloads before length validation."""
    return value.strip() if isinstance(value, str) else value


class RefundCreate(BaseModel):
    """Schema for Admin issuing a partial or full refund against a posted payment (D-06)."""

    model_config = ConfigDict(extra="forbid")

    amount_paise: int = Field(gt=0, description="Refund amount in integer paise")
    refund_method: Literal["CASH", "UPI", "CARD"] = Field(
        description="Refund disbursement method (CASH, UPI, CARD)"
    )
    reason: str = Field(
        min_length=5,
        max_length=1000,
        description="Mandatory reason justifying the refund (minimum 5 trimmed characters)",
    )

    @field_validator("reason", mode="before")
    @classmethod
    def _trim_reason(cls, value: Any) -> Any:
        return _strip_text(value)


class RefundOut(BaseModel):
    """Schema for reading an immutable payment refund record."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    refund_number: str
    payment_id: int
    payment_receipt_number: str | None = None
    patient_id: int
    visit_id: int | None = None
    amount_paise: int
    refund_method: str
    reason: str
    refunded_by_user_id: int
    refunded_by_username: str
    created_at: datetime


class LedgerEntryOut(BaseModel):
    """Schema for a single immutable ledger journal row with chronological running balance."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    visit_id: int | None = None
    entry_type: str
    direction: Literal["DEBIT", "CREDIT"]
    amount_paise: int
    signed_amount_paise: int
    running_balance_paise: int
    reference_type: str
    reference_id: int
    description: str
    actor_user_id: int | None = None
    actor_username: str | None = None
    occurred_at: datetime
    created_at: datetime


class LedgerPaymentItemOut(PaymentOut):
    """Payment row enriched with refund totals so UI renders refund badges and disables Reverse."""

    refunded_paise: int = Field(ge=0)
    remaining_refundable_paise: int = Field(ge=0)


class LedgerVisitBillOut(BaseModel):
    """Compact per-visit bill summary linking the patient ledger to each visit bill."""

    visit_id: int
    visit_code: str
    visit_date: date
    status: str
    bill_total_paise: int
    paid_paise: int
    refunded_paise: int
    due_paise: int


class PatientLedgerResponse(BaseModel):
    """Consolidated financial ledger projection for a patient (ADMIN + RECEPTION only)."""

    patient_id: int
    patient_urn: str
    total_billed_paise: int
    total_paid_paise: int
    total_refunded_paise: int
    outstanding_paise: int
    ledger_balance_paise: int
    entries: list[LedgerEntryOut]
    total_entries: int = Field(ge=0)
    limit: int = Field(ge=1)
    offset: int = Field(ge=0)
    payments: list[LedgerPaymentItemOut]
    refunds: list[RefundOut]
    visits: list[LedgerVisitBillOut]
