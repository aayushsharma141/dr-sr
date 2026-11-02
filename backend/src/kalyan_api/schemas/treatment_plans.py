"""Pydantic schemas for physiotherapy treatment plans and packages (TRT-01, OQ-13)."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from kalyan_api.models import TreatmentPlanStatus


class TreatmentPlanCreate(BaseModel):
    """Schema for creating a multi-session treatment plan / package."""

    model_config = ConfigDict(extra="forbid")

    patient_id: int = Field(gt=0, description="Patient ID")
    encounter_id: int | None = Field(
        default=None, gt=0, description="Optional linked clinical encounter ID"
    )
    plan_name: str = Field(min_length=2, max_length=128, description="Treatment plan package name")
    condition_diagnosis: str = Field(
        min_length=2, max_length=1000, description="Clinical diagnosis/condition being treated"
    )
    referred_by: str | None = Field(
        default=None, max_length=128, description="Referring doctor or source"
    )
    total_sessions: int = Field(
        ge=1, le=200, description="Total planned physiotherapy sessions (1-200)"
    )
    agreed_price_paise: int = Field(
        ge=0, description="Total agreed fee in integer paise (INR x 100)"
    )


class TreatmentPlanUpdate(BaseModel):
    """Schema for modifying or cancelling a treatment plan."""

    model_config = ConfigDict(extra="forbid")

    version_id: int = Field(ge=1, description="Version ID for optimistic concurrency control")
    plan_name: str | None = Field(default=None, min_length=2, max_length=128)
    condition_diagnosis: str | None = Field(default=None, min_length=2, max_length=1000)
    referred_by: str | None = Field(default=None, max_length=128)
    total_sessions: int | None = Field(default=None, ge=1, le=200)
    status: TreatmentPlanStatus | None = Field(
        default=None, description="Status update (e.g. CANCELLED)"
    )
    cancellation_reason: str | None = Field(
        default=None, min_length=3, max_length=500, description="Required when cancelling plan"
    )


class TreatmentPlanOut(BaseModel):
    """Schema for reading treatment plan details and progress."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    patient_urn: str
    patient_name: str
    doctor_id: int
    doctor_name: str
    encounter_id: int | None = None
    plan_name: str
    condition_diagnosis: str
    referred_by: str | None = None
    total_sessions: int
    completed_sessions: int
    agreed_price_paise: int
    status: str
    cancellation_reason: str | None = None
    version_id: int
    created_at: datetime
    updated_at: datetime
