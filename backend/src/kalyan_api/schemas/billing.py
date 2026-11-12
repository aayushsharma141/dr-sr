"""Pydantic schemas for payments, sequential receipts, reversals, and pending dues (Phase 15)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PaymentCreate(BaseModel):
    """Schema for recording a payment at Reception desk (BIL-01, BIL-02)."""

    model_config = ConfigDict(extra="forbid")

    patient_id: int = Field(gt=0, description="Patient database ID")
    treatment_plan_id: int | None = Field(
        default=None, gt=0, description="Optional linked treatment package ID"
    )
    appointment_id: int | None = Field(
        default=None, gt=0, description="Optional linked appointment ID"
    )
    amount_paise: int = Field(gt=0, description="Payment amount in integer paise")
    payment_method: Literal["CASH", "UPI", "CARD"] = Field(
        description="Payment mode used (CASH, UPI, CARD)"
    )
    notes: str | None = Field(default=None, max_length=500, description="Optional payment remarks")


class PaymentOut(BaseModel):
    """Schema for reading a recorded payment transaction (BIL-01, BIL-04)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    receipt_number: str
    patient_id: int
    patient_urn: str
    patient_name: str
    patient_mobile: str | None = None
    patient_address: str | None = None
    treatment_plan_id: int | None = None
    treatment_plan_name: str | None = None
    appointment_id: int | None = None
    amount_paise: int
    payment_method: str
    notes: str | None = None
    is_reversed: bool
    reversal_reason: str | None = None
    reversed_by_username: str | None = None
    reversed_at: datetime | None = None
    created_by_username: str
    created_at: datetime


class PaymentReversalCreate(BaseModel):
    """Schema for Admin reversing a posted payment with mandatory justification (BIL-05)."""

    model_config = ConfigDict(extra="forbid")

    reversal_reason: str = Field(
        min_length=5,
        max_length=1000,
        description="Mandatory reason justifying the administrative payment reversal",
    )


class BillingConfigurationOut(BaseModel):
    """How billing works on this system today. Read-only: these are not editable settings."""

    model_config = ConfigDict(extra="forbid")

    receipt_sequence_cycle: str
    current_cycle_key: str
    receipts_issued_in_cycle: int
    next_receipt_number: str
    payment_methods: list[str]
    reversal_roles: list[str]


class PendingDueOut(BaseModel):
    """Schema for reporting active treatment package pending dues (BIL-03)."""

    model_config = ConfigDict(from_attributes=True)

    treatment_plan_id: int
    patient_id: int
    patient_urn: str
    patient_name: str
    plan_name: str
    condition_diagnosis: str | None = None
    agreed_price_paise: int
    paid_paise: int
    balance_paise: int
    total_sessions: int
    completed_sessions: int
