"""Pydantic request and response schemas for doctors and consultation fees."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DoctorOut(BaseModel):
    """Doctor profile entity response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name_en: str
    name_hi: str | None = None
    qualification: str | None = None
    registration_number: str | None = None
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
    default_fee_paise: int = Field(default=0, ge=0)


class DoctorUpdate(BaseModel):
    """Payload for updating a doctor profile with optimistic concurrency."""

    model_config = ConfigDict(extra="forbid")

    name_en: str = Field(min_length=2, max_length=120)
    name_hi: str | None = Field(default=None, max_length=120)
    qualification: str | None = Field(default=None, max_length=120)
    registration_number: str | None = Field(default=None, max_length=64)
    default_fee_paise: int = Field(ge=0)
    is_active: bool = True
    version_id: int = Field(ge=1)


class FeeOut(BaseModel):
    """Consultation fee schedule response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    fee_paise: int
    is_active: bool
    version_id: int
    created_at: datetime
    updated_at: datetime


class FeeCreate(BaseModel):
    """Payload for creating a consultation fee schedule."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=120)
    fee_paise: int = Field(ge=0)


class FeeUpdate(BaseModel):
    """Payload for modifying a consultation fee schedule."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=120)
    fee_paise: int = Field(ge=0)
    is_active: bool = True
    version_id: int = Field(ge=1)
