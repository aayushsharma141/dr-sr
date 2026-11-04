"""Pydantic request and response schemas for clinic settings."""

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Phone numbers: digits, spaces and the separators + - / , ( ) only (e.g. "+91 6182 234567").
PHONE_PATTERN = r"^[0-9 +\-/,()]+$"

# Deliberately light email check (no external validator dependency): local@domain.tld.
_EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


class ClinicSettingsOut(BaseModel):
    """Clinic configuration response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name_en: str
    name_hi: str
    trust_name_en: str
    trust_name_hi: str | None = None
    location_line: str
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
    """Payload for updating clinic settings with optimistic concurrency.

    confirm_receipt_cycle_change / change_reason are a safety confirmation only: they are
    required when receipt_sequence_cycle changes after receipts were already issued in the
    current cycle (enforced in the router, which can see the ledger).
    """

    model_config = ConfigDict(extra="forbid")

    name_en: str = Field(min_length=2, max_length=120)
    name_hi: str = Field(min_length=2, max_length=120)
    # Left out means unchanged, so existing clients of this full-replace endpoint keep working.
    trust_name_en: str | None = Field(default=None, min_length=2, max_length=120)
    trust_name_hi: str | None = Field(default=None, max_length=120)
    location_line: str | None = Field(default=None, min_length=2, max_length=120)
    address_1: str = Field(min_length=2, max_length=255)
    address_2: str | None = Field(default=None, max_length=255)
    phone: str = Field(min_length=5, max_length=64, pattern=PHONE_PATTERN)
    email: str | None = Field(default=None, max_length=120)
    receipt_sequence_cycle: str = Field(pattern=r"^(FINANCIAL_YEAR|CALENDAR_YEAR)$")
    print_header_en: str | None = Field(default=None, max_length=1000)
    print_header_hi: str | None = Field(default=None, max_length=1000)
    print_footer_en: str | None = Field(default=None, max_length=1000)
    print_footer_hi: str | None = Field(default=None, max_length=1000)
    consultation_validity_days: int = Field(ge=1, le=365)
    version_id: int = Field(ge=1)
    confirm_receipt_cycle_change: bool = False
    change_reason: str | None = Field(default=None, max_length=500)

    @field_validator("phone", mode="after")
    @classmethod
    def _validate_phone_has_digits(cls, value: str) -> str:
        """Reject separator-only values such as '-----' that pass the character whitelist."""
        if not any(ch.isdigit() for ch in value):
            raise ValueError("Phone number must contain digits")
        return value

    @field_validator("email", mode="after")
    @classmethod
    def _validate_email(cls, value: str | None) -> str | None:
        """Accept an absent email; otherwise require a plausible single address."""
        if value is None:
            return None
        if not _EMAIL_RE.fullmatch(value):
            raise ValueError("Enter a valid email address, e.g. info@example.org")
        return value

    @model_validator(mode="after")
    def _require_reason_when_confirming(self) -> "ClinicSettingsUpdate":
        """A confirmed receipt cycle change must carry a non-blank reason for the audit trail."""
        if self.confirm_receipt_cycle_change and not (self.change_reason or "").strip():
            raise ValueError("change_reason is required when confirm_receipt_cycle_change is true")
        return self
