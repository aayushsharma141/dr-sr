"""Pydantic schemas for operational administrative endpoints (BAK-01, BAK-02, BAK-03)."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class BackupCreateRequest(BaseModel):
    """Payload to trigger an ad-hoc backup."""

    label: str | None = Field(
        default=None, max_length=50, description="Optional label for the archive"
    )
    destination_dir: str | None = Field(
        default=None,
        description="Optional custom directory path on server (e.g. secondary disk)",
    )


class BackupArchiveInfo(BaseModel):
    """Metadata of an available backup archive bundle on disk."""

    filename: str
    filepath: str
    size_bytes: int
    created_at: datetime
    label: str | None = None
    is_valid: bool = True
    manifest: dict[str, Any] | None = None


class BackupArchiveListResponse(BaseModel):
    """Response containing list of discovered backup bundles."""

    backups: list[BackupArchiveInfo]
    total_count: int
    backup_dir: str


class RestoreRequest(BaseModel):
    """Payload to trigger restoration from a backup archive."""

    archive_filename: str = Field(
        description="Filename of the backup archive in the backup directory"
    )
    create_prerestore_snapshot: bool = Field(
        default=True,
        description="Automatically take safety snapshot before restore",
    )
    confirmation_phrase: Literal["RESTORE-DATABASE-OVERWRITE"] = Field(
        description="Explicit confirmation that the active database will be overwritten",
    )
    justification: str = Field(
        min_length=10,
        max_length=500,
        description="Mandatory reason recorded in the audit log",
    )


class RestoreResultOut(BaseModel):
    """Response payload following a backup restore execution."""

    status: str
    archive_restored: str
    prerestore_snapshot: str | None = None
    database_restored: bool
    photos_restored_count: int
    manifest: dict[str, Any] | None = None


class IntegrityCheckItemOut(BaseModel):
    """Status of an individual integrity check."""

    name: str
    passed: bool
    details: str
    discrepancies: list[dict[str, Any]] = Field(default_factory=list)


class IntegrityReportOut(BaseModel):
    """System-wide clinical and financial integrity report."""

    generated_at: str
    is_healthy: bool
    total_checks: int
    passed_checks: int
    failed_checks: int
    checks: list[IntegrityCheckItemOut]

    model_config = ConfigDict(from_attributes=True)
