"""Pydantic schemas for clinical investigation orders and append-only results (T2.3)."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from kalyan_api.models import (
    InvestigationCategory,
    InvestigationPriority,
    InvestigationStatus,
)


def _normalize_optional_text(value: Any) -> Any:
    """Trim optional string inputs and coerce empty strings to None."""
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    return value


class InvestigationOrderCreate(BaseModel):
    """Payload to order a clinical investigation during an encounter (DOCTOR only)."""

    model_config = ConfigDict(extra="forbid")

    category: InvestigationCategory
    test_name: str = Field(min_length=1, max_length=200)
    instructions: str | None = Field(default=None, max_length=4000)
    priority: InvestigationPriority = Field(default=InvestigationPriority.ROUTINE)

    @field_validator("test_name", mode="before")
    @classmethod
    def _clean_test_name(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("instructions", mode="before")
    @classmethod
    def _clean_instructions(cls, value: Any) -> Any:
        return _normalize_optional_text(value)


class InvestigationStatusUpdate(BaseModel):
    """Payload to transition an investigation order's lifecycle status with optimistic locking."""

    model_config = ConfigDict(extra="forbid")

    status: InvestigationStatus
    cancelled_reason: str | None = Field(default=None, max_length=2000)
    version_id: int = Field(ge=1, description="Optimistic concurrency control version.")

    @field_validator("cancelled_reason", mode="before")
    @classmethod
    def _clean_cancelled_reason(cls, value: Any) -> Any:
        return _normalize_optional_text(value)


class InvestigationResultCreate(BaseModel):
    """Payload to record an append-only result against an investigation order."""

    model_config = ConfigDict(extra="forbid")

    summary_text: str = Field(min_length=1, max_length=10000)
    result_value: str | None = Field(default=None, max_length=120)
    unit: str | None = Field(default=None, max_length=40)
    reference_range: str | None = Field(default=None, max_length=120)
    is_abnormal: bool = False
    reported_at: datetime | None = None
    document_id: int | None = Field(default=None, gt=0)

    @field_validator("summary_text", mode="before")
    @classmethod
    def _clean_summary_text(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("result_value", "unit", "reference_range", mode="before")
    @classmethod
    def _clean_optional_fields(cls, value: Any) -> Any:
        return _normalize_optional_text(value)


class InvestigationResultOut(BaseModel):
    """Serialized append-only clinical investigation result."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    order_id: int
    patient_id: int
    document_id: int | None = None
    document_title: str | None = None
    summary_text: str
    result_value: str | None = None
    unit: str | None = None
    reference_range: str | None = None
    is_abnormal: bool
    reported_at: datetime
    recorded_by_user_id: int
    recorded_by_username: str | None = None
    created_at: datetime


class InvestigationOrderOut(BaseModel):
    """Serialized clinical investigation order with attached results (DOCTOR only, D-04)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    encounter_id: int
    encounter_code: str
    patient_id: int
    doctor_id: int
    doctor_name: str
    category: str
    test_name: str
    instructions: str | None = None
    priority: str
    status: str
    cancelled_reason: str | None = None
    ordered_at: datetime
    updated_at: datetime
    version_id: int
    results: list[InvestigationResultOut] = Field(default_factory=list)
