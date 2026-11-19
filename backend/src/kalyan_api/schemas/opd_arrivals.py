"""Schemas for pending new-patient OPD arrivals (KALYAN-OPD-CHECKIN-REDESIGN)."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from kalyan_api.models import PriorityLevel
from kalyan_api.schemas.patients import PatientCreate


class OpdArrivalCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=2, max_length=120)
    age_years: int = Field(ge=0, le=150)
    mobile: str = Field(min_length=10, max_length=15, pattern=r"^[0-9+ -]{10,15}$")
    doctor_id: int = Field(gt=0)
    department_id: int = Field(gt=0)
    priority_level: PriorityLevel = PriorityLevel.NORMAL
    priority_reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_priority_reason(self) -> "OpdArrivalCreate":
        if (
            self.priority_level != PriorityLevel.NORMAL
            and len((self.priority_reason or "").strip()) < 3
        ):
            raise ValueError("Enter a reason for marking the patient Priority or Emergency.")
        if self.priority_level == PriorityLevel.NORMAL and (self.priority_reason or "").strip():
            raise ValueError(
                "A priority reason can only be supplied for High or Emergency priority."
            )
        return self


class OpdArrivalRegister(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version_id: int = Field(ge=1)
    patient: PatientCreate


class OpdArrivalPriorityUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version_id: int = Field(ge=1)
    priority_level: PriorityLevel
    reason: str = Field(min_length=3, max_length=500)


class OpdArrivalCancel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version_id: int = Field(ge=1)
    reason: str = Field(min_length=3, max_length=500)


class OpdArrivalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    age_years: int
    mobile: str
    doctor_id: int
    doctor_name_en: str
    department_id: int
    department_name: str
    appointment_date: date
    token_number: int
    priority_level: str
    priority_reason: str | None = None
    status: str
    cancellation_reason: str | None = None
    version_id: int
    created_at: datetime
    patient_id: int | None = None
    appointment_id: int | None = None


class OpdArrivalList(BaseModel):
    total: int
    arrivals: list[OpdArrivalRead]
    limit: int | None = None
    offset: int = 0
