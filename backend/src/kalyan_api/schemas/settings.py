"""Pydantic request and response schemas for clinic settings."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ClinicSettingsOut(BaseModel):
    """Clinic configuration response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name_en: str
    name_hi: str
    address_1: str
    address_2: str | None = None
    phone: str
    email: str | None = None
    receipt_sequence_cycle: str
    print_header_en: str | None = None
    print_header_hi: str | None = None
    print_footer_en: str | None = None
    print_footer_hi: str | None = None
    consultation_validity_days: int
    version_id: int
    created_at: datetime
    updated_at: datetime


class ClinicSettingsUpdate(BaseModel):
    """Payload for updating clinic settings with optimistic concurrency."""

    model_config = ConfigDict(extra="forbid")

    name_en: str = Field(min_length=2, max_length=120)
    name_hi: str = Field(min_length=2, max_length=120)
    address_1: str = Field(min_length=2, max_length=255)
    address_2: str | None = Field(default=None, max_length=255)
    phone: str = Field(min_length=5, max_length=64)
    email: str | None = Field(default=None, max_length=120)
    receipt_sequence_cycle: str = Field(pattern=r"^(FINANCIAL_YEAR|CALENDAR_YEAR)$")
    print_header_en: str | None = Field(default=None, max_length=1000)
    print_header_hi: str | None = Field(default=None, max_length=1000)
    print_footer_en: str | None = Field(default=None, max_length=1000)
    print_footer_hi: str | None = Field(default=None, max_length=1000)
    consultation_validity_days: int = Field(ge=1, le=365)
    version_id: int = Field(ge=1)

