"""Pydantic schemas for structured doctor prescriptions and medication lines (RX-01, DWS-07)."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class PrescriptionItemCreate(BaseModel):
    """Schema for itemized medication line creation."""

    model_config = ConfigDict(extra="forbid")

    item_order: int = Field(ge=1, description="1-based sequence order of medication item")
    medicine_name: str = Field(min_length=1, max_length=128, description="Brand or generic name")
    dosage: str = Field(min_length=1, max_length=64, description="Dosage (e.g. 500mg, 10ml)")
    frequency: str = Field(
        min_length=1, max_length=64, description="Frequency (e.g. 1-0-1, OD, BD, TDS)"
    )
    duration_days: int = Field(ge=1, le=365, description="Treatment duration in days")
    instructions: str | None = Field(
        default=None, max_length=500, description="Specific instructions (e.g. After food)"
    )
    strength: str | None = Field(
        default=None, max_length=64, description="Strength specification (e.g. 500mg, 0.5%)"
    )
    form: str | None = Field(
        default=None, max_length=32, description="Form (e.g. Tablet, Eye Drops, Syrup)"
    )
    route: str | None = Field(
        default=None, max_length=32, description="Route (e.g. Oral, Right Eye (OD), Left Eye (OS))"
    )


class PrescriptionItemOut(BaseModel):
    """Schema for reading a medication item."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    prescription_id: int
    item_order: int
    medicine_name: str
    dosage: str
    frequency: str
    duration_days: int
    instructions: str | None = None
    strength: str | None = None
    form: str | None = None
    route: str | None = None


class PrescriptionCancelRequest(BaseModel):
    """Schema for cancelling an existing prescription (D-19-15)."""

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(
        min_length=3, max_length=1000, description="Clinical or administrative cancellation reason"
    )


class PrescriptionCreate(BaseModel):
    """Schema for doctor creating a prescription (RX-01, DWS-07)."""

    model_config = ConfigDict(extra="forbid")

    patient_id: int = Field(gt=0, description="Patient ID")
    encounter_id: int | None = Field(
        default=None, gt=0, description="Optional linked clinical encounter ID"
    )
    status: str = Field(
        default="AUTHORISED", description="Prescription status: DRAFT or AUTHORISED"
    )
    diagnosis: str | None = Field(
        default=None,
        max_length=1000,
        description="Clinical diagnosis (inherited from encounter if omitted)",
    )
    dietary_advice: str | None = Field(default=None, max_length=1000)
    general_advice: str | None = Field(default=None, max_length=1000)
    follow_up_date: date | None = Field(default=None)
    items: list[PrescriptionItemCreate] = Field(
        default_factory=list, description="Prescribed medicine items"
    )


class PrescriptionUpdate(BaseModel):
    """Schema for updating a draft prescription."""

    model_config = ConfigDict(extra="forbid")

    diagnosis: str | None = Field(default=None, max_length=1000)
    dietary_advice: str | None = Field(default=None, max_length=1000)
    general_advice: str | None = Field(default=None, max_length=1000)
    follow_up_date: date | None = Field(default=None)
    items: list[PrescriptionItemCreate] | None = Field(default=None)
    version_id: int | None = Field(
        default=None, description="Expected version_id for optimistic locking"
    )


class PrescriptionOut(BaseModel):
    """Schema for full prescription reading including items."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    patient_urn: str
    patient_name: str
    patient_mobile: str | None = None
    patient_address: str | None = None
    doctor_id: int
    doctor_name: str
    encounter_id: int | None = None
    status: str
    authorised_at: datetime | None = None
    cancelled_at: datetime | None = None
    cancellation_reason: str | None = None
    cancelled_by_user_id: int | None = None
    is_printable: bool = False
    diagnosis: str
    dietary_advice: str | None = None
    general_advice: str | None = None
    follow_up_date: date | None = None
    version_id: int
    created_at: datetime
    updated_at: datetime
    items: list[PrescriptionItemOut]


class PrescriptionSummary(BaseModel):
    """Schema for prescription summary in patient prescription lists."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    patient_urn: str
    patient_name: str
    doctor_id: int
    doctor_name: str
    encounter_id: int | None = None
    status: str
    diagnosis: str
    items_count: int
    follow_up_date: date | None = None
    created_at: datetime
