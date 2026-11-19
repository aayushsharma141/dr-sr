"""Schemas for administrative reports (Phase 22, Wave 5; T22-11, OD-I, OD-22-21)."""

from datetime import date

from pydantic import BaseModel, ConfigDict


class ReferralReportRow(BaseModel):
    """One referral source aggregate row."""

    model_config = ConfigDict(from_attributes=True)

    source: str
    referrer_name: str | None = None
    visit_count: int


class ReferralReportOut(BaseModel):
    """Referral report response envelope."""

    model_config = ConfigDict(from_attributes=True)

    date_from: date
    date_to: date
    rows: list[ReferralReportRow]
    total_visits: int
