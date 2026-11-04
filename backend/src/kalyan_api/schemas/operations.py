"""Pydantic schemas for operational administrative endpoints (BAK-01, BAK-02, BAK-03).

Request models forbid unknown fields. Archive filename confinement and destination directory
existence are validated in the router against the live filesystem (they cannot be decided by
the schema alone) and are reported as 422 with a specific error code.
"""

from datetime import datetime, time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

RESTORE_CONFIRMATION_PHRASE = "RESTORE"
RESTORE_REASON_MIN_LENGTH = 10
RESTORE_REASON_MAX_LENGTH = 500


class BackupCreateRequest(BaseModel):
    """Payload to trigger an ad-hoc backup."""

    model_config = ConfigDict(extra="forbid")

    label: str | None = Field(
        default=None,
        max_length=50,
        pattern=r"^[A-Za-z0-9_-]*$",
        description="Optional label for the archive (letters, digits, '_' and '-' only)",
    )
    destination_dir: str | None = Field(
        default=None,
        max_length=1024,
        description=(
            "Optional absolute path to an EXISTING directory on the server "
            "(e.g. a secondary disk). Relative or missing paths are rejected with 422."
        ),
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


class BackupVerifyResponse(BaseModel):
    """Result of re-hashing a single archive against its manifest."""

    model_config = ConfigDict(extra="forbid")

    filename: str
    valid: bool
    details: str


class RestoreRequest(BaseModel):
    """Payload to trigger restoration from a backup archive.

    Backward compatibility: ``create_prerestore_snapshot`` is still accepted, but only the value
    ``true`` (or omission). Sending ``false`` is rejected with 422 because the pre-restore safety
    snapshot is mandatory.
    """

    model_config = ConfigDict(extra="forbid")

    archive_filename: str = Field(
        min_length=1,
        max_length=255,
        description="Bare filename of the backup archive in the configured backup directory",
    )
    confirmation_phrase: str = Field(
        description=f"Must be exactly '{RESTORE_CONFIRMATION_PHRASE}'",
    )
    reason: str = Field(
        description=(
            f"Why the restore is being performed ({RESTORE_REASON_MIN_LENGTH}-"
            f"{RESTORE_REASON_MAX_LENGTH} characters); stored on the audit row"
        ),
    )
    create_prerestore_snapshot: Literal[True] = Field(
        default=True,
        description="Deprecated: the pre-restore safety snapshot is always taken",
    )

    @field_validator("confirmation_phrase")
    @classmethod
    def _confirmation_must_match(cls, value: str) -> str:
        if value != RESTORE_CONFIRMATION_PHRASE:
            raise ValueError(f"confirmation_phrase must be exactly '{RESTORE_CONFIRMATION_PHRASE}'")
        return value

    @field_validator("reason")
    @classmethod
    def _reason_length(cls, value: str) -> str:
        stripped = value.strip()
        if len(stripped) < RESTORE_REASON_MIN_LENGTH:
            raise ValueError(f"reason must be at least {RESTORE_REASON_MIN_LENGTH} characters")
        if len(stripped) > RESTORE_REASON_MAX_LENGTH:
            raise ValueError(f"reason must be at most {RESTORE_REASON_MAX_LENGTH} characters")
        return stripped


class RestoreResultOut(BaseModel):
    """Response payload following a backup restore execution."""

    status: str
    archive_restored: str
    prerestore_snapshot: str | None = None
    database_restored: bool
    photos_restored_count: int
    manifest: dict[str, Any] | None = None


class IntegrityCheckItemOut(BaseModel):
    """Status of an individual integrity check.

    ``severity`` describes how a non-passing result is classified: ERROR findings make the
    report unhealthy; WARNING findings are reported but do not.
    """

    name: str
    passed: bool
    severity: Literal["ERROR", "WARNING"] = "ERROR"
    details: str
    discrepancies: list[dict[str, Any]] = Field(default_factory=list)


class IntegrityReportOut(BaseModel):
    """System-wide clinical and financial integrity report."""

    generated_at: str
    is_healthy: bool
    total_checks: int
    passed_checks: int
    failed_checks: int
    warning_checks: int = 0
    checks: list[IntegrityCheckItemOut]

    model_config = ConfigDict(from_attributes=True)


class BackupSettingsOut(BaseModel):
    """Persisted backup schedule with the next planned run and approved second-copy folders."""

    model_config = ConfigDict(extra="forbid")

    schedule_enabled: bool
    frequency: Literal["DAILY", "WEEKLY"]
    run_at: time
    weekly_day: int | None
    destination_dir: str | None
    retention_count: int | None
    version_id: int
    updated_at: datetime
    next_run_at: datetime | None
    overdue: bool
    approved_destinations: list[str]


class BackupSettingsUpdate(BaseModel):
    """Full replacement of the backup schedule, with a mandatory reason."""

    model_config = ConfigDict(extra="forbid")

    version_id: int = Field(ge=1)
    schedule_enabled: bool
    frequency: Literal["DAILY", "WEEKLY"]
    run_at: time
    weekly_day: int | None = Field(default=None, ge=0, le=6)
    destination_dir: str | None = Field(default=None, max_length=1024)
    retention_count: int | None = Field(default=None, ge=1, le=3650)
    reason: str = Field(min_length=10, max_length=500)

    @field_validator("reason")
    @classmethod
    def reason_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if len(stripped) < 10:
            raise ValueError("reason must be at least 10 characters")
        return stripped

    @model_validator(mode="after")
    def weekly_needs_day(self) -> "BackupSettingsUpdate":
        if self.frequency == "WEEKLY" and self.weekly_day is None:
            raise ValueError("weekly_day is required for a weekly schedule")
        return self


class BackupRunOut(BaseModel):
    """One attempted backup."""

    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: int
    trigger: str
    outcome: str
    started_at: datetime
    finished_at: datetime | None
    filename: str | None
    size_bytes: int | None
    copied_to: str | None
    pruned_count: int
    error_type: str | None
