"""Pydantic schemas for Patient Import Centre (D-20-08 to D-20-14)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class InspectFileResponse(BaseModel):
    """Result of file inspection and encoding sniffing."""

    model_config = ConfigDict(extra="forbid")

    filename: str
    file_type: str
    encoding: str | None = None
    delimiter: str | None = None
    total_rows: int
    headers: list[str]
    sample_rows: list[dict[str, Any]]
    suggested_mapping: dict[str, str]
    canonical_fields: list[str]


class BatchSummaryResponse(BaseModel):
    """Metadata and row metrics for an import batch."""

    model_config = ConfigDict(from_attributes=True, extra="ignore")

    batch_id: str
    filename: str
    total_rows: int
    valid_rows: int
    duplicate_rows: int
    invalid_rows: int
    committed_rows: int
    status: str
    column_mapping: dict[str, Any] | None = None
    safety_backup_file: str | None = None
    created_at: datetime
    committed_at: datetime | None = None


class ValidationSummaryResponse(BaseModel):
    """Result of batch row validation and duplicate matching."""

    model_config = ConfigDict(extra="forbid")

    batch_id: str
    total_rows: int
    valid_rows: int
    duplicate_rows: int
    invalid_rows: int
    status: str


class DuplicateCandidatePatient(BaseModel):
    """Demographics of existing patient candidate for side-by-side comparison."""

    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: int
    urn: str
    full_name: str
    guardian_name: str
    gender: str
    age_years: int
    mobile: str
    address: str
    legacy_urn: str | None = None


class DuplicateRowItem(BaseModel):
    """A flagged duplicate row and its matched patient."""

    model_config = ConfigDict(extra="ignore")

    row_id: int
    row_index: int
    mapped_data: dict[str, Any]
    duplicate_patient_id: int | None = None
    duplicate_patient: DuplicateCandidatePatient | None = None
    duplicate_resolution: str | None = None
    validation_errors: dict[str, Any] | None = None


class DuplicateListResponse(BaseModel):
    """List of duplicate candidate rows in a batch."""

    model_config = ConfigDict(extra="forbid")

    batch_id: str
    duplicates: list[DuplicateRowItem]


class DuplicateResolutionItem(BaseModel):
    """Explicit decision for a single duplicate candidate row."""

    model_config = ConfigDict(extra="forbid")

    row_id: int
    resolution: Literal["SKIP", "IMPORT_AS_NEW"]


class ResolveDuplicatesRequest(BaseModel):
    """Batch duplicate decision submission."""

    model_config = ConfigDict(extra="forbid")

    resolutions: list[DuplicateResolutionItem]


class CommitBatchResponse(BaseModel):
    """Result of committing import batch."""

    model_config = ConfigDict(extra="forbid")

    batch_id: str
    status: str
    committed_rows: int
    safety_backup_file: str | None = None
    urn_range_start: str | None = None
    urn_range_end: str | None = None

