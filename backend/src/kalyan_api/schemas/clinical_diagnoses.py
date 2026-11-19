"""Pydantic schemas for longitudinal patient conditions and structured encounter diagnoses (T2.2).

Guarantees:
- Strict extra-field rejection on all create/update inputs.
- Strings are trimmed; blank optional strings normalize to None.
- Optimistic locking version_id required on PatientConditionUpdate.
- EncounterDiagnosisCreate rejects conflicting patient_condition_id + promote_to_condition=True.
"""

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from kalyan_api.models import ConditionStatus, DiagnosisStatus, DiagnosisType


def _normalize_optional_text(value: Any) -> Any:
    """Trim optional strings and normalize empty/whitespace strings to None."""
    if value is None or not isinstance(value, str):
        return value
    cleaned = value.strip()
    return cleaned or None


def _strip_text(value: Any) -> Any:
    """Strip leading/trailing whitespace from string values."""
    return value.strip() if isinstance(value, str) else value


class PatientConditionCreate(BaseModel):
    """Payload for recording a longitudinal problem-list condition (DOCTOR only)."""

    model_config = ConfigDict(extra="forbid")

    condition_name: str = Field(min_length=1, max_length=200)
    icd10_code: str | None = Field(default=None, max_length=16)
    status: ConditionStatus = Field(default=ConditionStatus.ACTIVE)
    onset_date: date | None = None
    resolved_date: date | None = None
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("condition_name", mode="before")
    @classmethod
    def _clean_condition_name(cls, value: Any) -> Any:
        return _strip_text(value)

    @field_validator("icd10_code", "notes", mode="before")
    @classmethod
    def _clean_optional_fields(cls, value: Any) -> Any:
        return _normalize_optional_text(value)


class PatientConditionUpdate(BaseModel):
    """Payload for updating a longitudinal patient condition with optimistic locking."""

    model_config = ConfigDict(extra="forbid")

    version_id: int = Field(ge=1, description="Optimistic concurrency control version.")
    condition_name: str | None = Field(default=None, min_length=1, max_length=200)
    icd10_code: str | None = Field(default=None, max_length=16)
    status: ConditionStatus | None = None
    onset_date: date | None = None
    resolved_date: date | None = None
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("condition_name", mode="before")
    @classmethod
    def _clean_condition_name(cls, value: Any) -> Any:
        return _strip_text(value)

    @field_validator("icd10_code", "notes", mode="before")
    @classmethod
    def _clean_optional_fields(cls, value: Any) -> Any:
        return _normalize_optional_text(value)


class PatientConditionOut(BaseModel):
    """Serialized longitudinal patient condition (DOCTOR only, D-04)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    doctor_id: int
    doctor_name: str | None = None
    condition_name: str
    icd10_code: str | None = None
    status: str
    onset_date: date | None = None
    resolved_date: date | None = None
    notes: str | None = None
    created_at: datetime
    updated_at: datetime
    version_id: int


class EncounterDiagnosisCreate(BaseModel):
    """Payload for recording a structured diagnosis on an unfinalised encounter."""

    model_config = ConfigDict(extra="forbid")

    diagnosis_name: str = Field(min_length=1, max_length=200)
    icd10_code: str | None = Field(default=None, max_length=16)
    diagnosis_type: DiagnosisType = Field(default=DiagnosisType.PRIMARY)
    status: DiagnosisStatus = Field(default=DiagnosisStatus.ACTIVE)
    onset_date: date | None = None
    notes: str | None = Field(default=None, max_length=4000)
    patient_condition_id: int | None = Field(default=None, gt=0)
    promote_to_condition: bool = Field(default=False)

    @field_validator("diagnosis_name", mode="before")
    @classmethod
    def _clean_diagnosis_name(cls, value: Any) -> Any:
        return _strip_text(value)

    @field_validator("icd10_code", "notes", mode="before")
    @classmethod
    def _clean_optional_fields(cls, value: Any) -> Any:
        return _normalize_optional_text(value)

    @model_validator(mode="after")
    def _validate_condition_link(self) -> "EncounterDiagnosisCreate":
        if self.patient_condition_id is not None and self.promote_to_condition:
            raise ValueError(
                "Cannot specify patient_condition_id when promote_to_condition is true."
            )
        return self


class EncounterDiagnosisUpdate(BaseModel):
    """Payload for updating a structured diagnosis on an unfinalised encounter."""

    model_config = ConfigDict(extra="forbid")

    diagnosis_name: str | None = Field(default=None, min_length=1, max_length=200)
    icd10_code: str | None = Field(default=None, max_length=16)
    diagnosis_type: DiagnosisType | None = None
    status: DiagnosisStatus | None = None
    onset_date: date | None = None
    notes: str | None = Field(default=None, max_length=4000)
    patient_condition_id: int | None = Field(default=None, gt=0)

    @field_validator("diagnosis_name", mode="before")
    @classmethod
    def _clean_diagnosis_name(cls, value: Any) -> Any:
        return _strip_text(value)

    @field_validator("icd10_code", "notes", mode="before")
    @classmethod
    def _clean_optional_fields(cls, value: Any) -> Any:
        return _normalize_optional_text(value)


class EncounterDiagnosisOut(BaseModel):
    """Serialized structured encounter diagnosis (DOCTOR only, D-04)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    encounter_id: int
    encounter_code: str | None = None
    patient_id: int
    doctor_id: int
    doctor_name: str | None = None
    diagnosis_name: str
    icd10_code: str | None = None
    diagnosis_type: str
    status: str
    onset_date: date | None = None
    notes: str | None = None
    patient_condition_id: int | None = None
    created_at: datetime
    updated_at: datetime
