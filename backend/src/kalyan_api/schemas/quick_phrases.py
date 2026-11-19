"""Pydantic schemas for persistent clinical quick phrases (Phase 3 / T3.1)."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from kalyan_api.models import QuickPhraseSection


def _strip_text(value: Any) -> Any:
    """Strip surrounding whitespace from string inputs before length validation."""
    return value.strip() if isinstance(value, str) else value


class QuickPhraseCreate(BaseModel):
    """Payload for creating a doctor-owned personal clinical quick phrase."""

    model_config = ConfigDict(extra="forbid")

    phrase_text: str = Field(min_length=2, max_length=240)
    section: QuickPhraseSection = Field(default=QuickPhraseSection.COMPLAINTS)
    department_id: int | None = Field(default=None, gt=0)
    sort_order: int = Field(default=0, ge=0, le=10000)

    @field_validator("phrase_text", mode="before")
    @classmethod
    def _clean_phrase_text(cls, value: Any) -> Any:
        return _strip_text(value)


class QuickPhraseUpdate(BaseModel):
    """Payload for updating a doctor-owned personal clinical quick phrase."""

    model_config = ConfigDict(extra="forbid")

    phrase_text: str | None = Field(default=None, min_length=2, max_length=240)
    section: QuickPhraseSection | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10000)

    @field_validator("phrase_text", mode="before")
    @classmethod
    def _clean_phrase_text(cls, value: Any) -> Any:
        return _strip_text(value)


class QuickPhraseOut(BaseModel):
    """Serialized clinical quick phrase."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    scope: str
    doctor_id: int | None = None
    department_id: int | None = None
    department_code: str | None = None
    section: str
    phrase_text: str
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class QuickPhraseListResponse(BaseModel):
    """Separated hospital defaults and doctor-owned personal quick phrases."""

    defaults: list[QuickPhraseOut]
    personal: list[QuickPhraseOut]
