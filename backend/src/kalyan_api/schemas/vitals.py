"""Schemas for vital signs and biometrics observations (DWS-06, T-19-05)."""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class VitalObservationInput(BaseModel):
    """Payload to record or update vitals for a clinical encounter."""

    height_cm: Decimal | None = Field(
        default=None,
        gt=20,
        lt=280,
        description="Height in centimeters (20 < height < 280)",
    )
    weight_kg: Decimal | None = Field(
        default=None,
        gt=1,
        lt=400,
        description="Weight in kilograms (1 < weight < 400)",
    )
    systolic_bp: int | None = Field(
        default=None,
        ge=40,
        le=300,
        description="Systolic blood pressure mmHg (40-300)",
    )
    diastolic_bp: int | None = Field(
        default=None,
        ge=20,
        le=200,
        description="Diastolic blood pressure mmHg (20-200)",
    )
    pulse_bpm: int | None = Field(
        default=None,
        ge=30,
        le=260,
        description="Pulse rate beats per minute (30-260)",
    )
    temperature_f: Decimal | None = Field(
        default=None,
        ge=85,
        le=110,
        description="Body temperature in Fahrenheit (85.0-110.0)",
    )
    respiratory_rate: int | None = Field(
        default=None,
        ge=5,
        le=80,
        description="Respiratory rate breaths per minute (5-80)",
    )
    spo2_percent: int | None = Field(
        default=None,
        ge=40,
        le=100,
        description="Oxygen saturation SpO2 percentage (40-100)",
    )


class VitalObservationResponse(BaseModel):
    """Detailed vitals observations with server-calculated BMI."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    encounter_id: int
    patient_id: int
    height_cm: Decimal | None = None
    weight_kg: Decimal | None = None
    bmi: Decimal | None = None
    systolic_bp: int | None = None
    diastolic_bp: int | None = None
    pulse_bpm: int | None = None
    temperature_f: Decimal | None = None
    respiratory_rate: int | None = None
    spo2_percent: int | None = None
    created_at: datetime
    updated_at: datetime
