"""Pydantic request and response schemas for doctors and consultation fees."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _normalize_cabin_code(v: str | None) -> str | None:
    if v is None:
        return None
    s = v.strip()
    if not s:
        return None
    if len(s) != 1 or not s.isalpha():
        raise ValueError("Cabin code must be a single letter A-Z")
    return s.upper()


class DoctorOut(BaseModel):
    """Doctor profile entity response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name_en: str
    name_hi: str | None = None
    qualification: str | None = None
    registration_number: str | None = None
    cabin_code: str | None = None
    default_fee_paise: int
    is_active: bool
    version_id: int
    created_at: datetime
    updated_at: datetime


class DoctorCreate(BaseModel):
    """Payload for creating a new doctor profile."""

    model_config = ConfigDict(extra="forbid")

    name_en: str = Field(min_length=2, max_length=120)
    name_hi: str | None = Field(default=None, max_length=120)
    qualification: str | None = Field(default=None, max_length=120)
    registration_number: str | None = Field(default=None, max_length=64)
    cabin_code: str | None = Field(default=None)
    default_fee_paise: int = Field(default=0, ge=0)

    @field_validator("cabin_code", mode="before")
    @classmethod
    def validate_cabin_code(cls, v: str | None) -> str | None:
        return _normalize_cabin_code(v)


class DoctorUpdate(BaseModel):
    """Payload for updating a doctor profile with optimistic concurrency."""

    model_config = ConfigDict(extra="forbid")

    name_en: str = Field(min_length=2, max_length=120)
    name_hi: str | None = Field(default=None, max_length=120)
    qualification: str | None = Field(default=None, max_length=120)
    registration_number: str | None = Field(default=None, max_length=64)
    cabin_code: str | None = Field(default=None)
    default_fee_paise: int = Field(ge=0)
    is_active: bool = True
    version_id: int = Field(ge=1)

    @field_validator("cabin_code", mode="before")
    @classmethod
    def validate_cabin_code(cls, v: str | None) -> str | None:
        return _normalize_cabin_code(v)


class DoctorMeSettingsUpdate(BaseModel):
    """Payload for a doctor updating their own consultation fee."""

    model_config = ConfigDict(extra="forbid")

    default_fee_paise: int = Field(ge=0)
    version_id: int = Field(ge=1)


class FeeOut(BaseModel):
    """Consultation fee schedule response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    fee_paise: int
    is_active: bool
    version_id: int


class FeeCreate(BaseModel):
    """Payload for creating a consultation fee schedule entry."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=64)
    fee_paise: int = Field(ge=0)


class FeeUpdate(BaseModel):
    """Payload for updating a consultation fee with optimistic locking."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=64)
    fee_paise: int = Field(ge=0)
    is_active: bool = True
    version_id: int = Field(ge=1)
