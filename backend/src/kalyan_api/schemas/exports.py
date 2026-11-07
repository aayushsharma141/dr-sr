"""Schemas for administrative patient dataset exports (D-20-15 through D-20-20)."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ALLOWED_EXPORT_FIELDS: tuple[str, ...] = (
    # Group 1: Core Demographics
    "full_name",
    "urn",
    "guardian_name",
    "gender",
    "age_years",
    "mobile",
    "address",
    "district",
    "state",
    # Group 2: Administrative Identifiers
    "emergency_contact",
    "legacy_urn",
    # Group 3: Patient Profile Notes
    "allergies",
    "notes",
    # Group 4: Complete Clinical Content
    "encounters",
    "clinical_notes",
    "addenda",
    "assessments",
    "vitals",
    "diagnoses",
    "prescriptions",
    "treatment_plans",
    "sessions",
)


class ExportScope(BaseModel):
    """Filter criteria scoping patient records for export."""

    model_config = ConfigDict(extra="forbid")

    start_date: date | None = None
    end_date: date | None = None
    department_id: int | None = None
    search_query: str | None = None


class PatientExportRequest(BaseModel):
    """Administrative request payload for patient dataset export."""

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(
        ...,
        min_length=5,
        max_length=500,
        description="Documented purpose / justification for export (audited)",
    )
    format: Literal["csv", "xlsx"] = Field(
        default="csv",
        description="Desired export file format ('csv' or 'xlsx')",
    )
    scope: ExportScope = Field(
        default_factory=ExportScope,
        description="Filter parameters for scoping patients",
    )
    fields: list[str] = Field(
        ...,
        min_length=1,
        description="List of patient fields to include in export",
    )

    @field_validator("fields")
    @classmethod
    def validate_fields(cls, v: list[str]) -> list[str]:
        invalid = [f for f in v if f not in ALLOWED_EXPORT_FIELDS]
        if invalid:
            raise ValueError(f"Invalid export fields requested: {invalid}")
        return v
