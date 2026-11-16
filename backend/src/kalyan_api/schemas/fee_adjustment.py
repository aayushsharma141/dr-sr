"""Consultation fee adjustment payloads (Phase 22, Wave 3; OD-22-11)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class FeeAdjustmentRequest(BaseModel):
    """Discount, waive or correct the fee of one consultation, with a reason."""

    kind: Literal["DISCOUNT", "WAIVER", "CORRECTION"]
    new_amount_paise: int = Field(..., ge=0, description="The fee after the change, in paise")
    reason: str = Field(..., min_length=3, max_length=500, description="Why the fee changed")


class FeeAdjustmentOut(BaseModel):
    bill_item_id: int
    appointment_id: int
    kind: str
    old_amount_paise: int
    new_amount_paise: int
    reason: str
    actor_user_id: int
    created_at: datetime
