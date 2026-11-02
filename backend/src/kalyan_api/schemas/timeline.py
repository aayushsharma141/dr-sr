"""Unified Patient Timeline schema (CLN-03, Phase 15).

Aggregates:
- APPOINTMENT: Bookings, check-ins, status transitions
- ENCOUNTER: Clinical consultation notes, diagnoses, addenda
- PRESCRIPTION: Medication prescriptions, line items
- TREATMENT_PLAN: Physiotherapy / rehabilitation packages
- TREATMENT_SESSION: Daily therapy sessions, VAS score tracking, modalities
- PAYMENT: Consultation & package payments, reversals, receipts
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class TimelineItemOut(BaseModel):
    """Normalized timeline item for patient chronological history."""

    id: str  # Composite or typed id, e.g. "ENCOUNTER-1", "PAYMENT-4"
    event_type: (
        str  # APPOINTMENT, ENCOUNTER, PRESCRIPTION, TREATMENT_PLAN, TREATMENT_SESSION, PAYMENT
    )
    event_date: datetime
    title: str
    subtitle: str | None = None
    summary: str | None = None
    badge: str | None = None
    badge_variant: str | None = None  # default, secondary, destructive, outline
    metadata: dict[str, Any] = {}
