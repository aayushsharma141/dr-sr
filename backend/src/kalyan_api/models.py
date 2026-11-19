"""SQLAlchemy declarative models with strict naming conventions.

Locked decisions:
- D-03: Doctor silo partitioning via users.doctor_id FK to doctors.
- D-08: version_id on mutable tables (doctors, users).
- SEC-03: Role limited to ADMIN, RECEPTION, DOCTOR; doctor_id NOT NULL iff role is DOCTOR.
- SEC-07: Singleton system_setup row with id=1.
- AUD-01: Audit log schema.
"""

import re
import uuid
from datetime import date, datetime, time
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    CHAR,
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    FetchedValue,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    MetaData,
    Numeric,
    SmallInteger,
    String,
    Table,
    Text,
    Time,
    UniqueConstraint,
    false,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# Standard naming convention for all constraints and indexes
POSTGRES_NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy declarative models."""

    metadata = MetaData(naming_convention=POSTGRES_NAMING_CONVENTION)


def _department_code_from_name(context) -> str:  # type: ignore[no-untyped-def]
    """Default `departments.code` from the English name: "General Medicine" -> "GENERAL_MEDICINE".

    The admin create endpoint picks a unique code itself; this covers any other insert.
    """
    name = str(context.get_current_parameters().get("name_en") or "")
    return re.sub(r"[^A-Z0-9]+", "_", name.strip().upper()).strip("_")[:64] or "DEPARTMENT"


doctor_departments = Table(
    "doctor_departments",
    Base.metadata,
    Column("doctor_id", BigInteger, ForeignKey("doctors.id", ondelete="CASCADE"), primary_key=True),
    Column(
        "department_id",
        BigInteger,
        ForeignKey("departments.id", ondelete="RESTRICT"),
        primary_key=True,
    ),
)


class Department(Base):
    """Configured hospital department/specialty used for OPD routing (REC-01)."""

    __tablename__ = "departments"
    __table_args__ = (
        UniqueConstraint("name_en", name="uq_departments_name_en"),
        CheckConstraint("length(trim(name_en)) >= 2", name="departments_name_nonblank"),
    )
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    # Stable machine code (PHYSIOTHERAPY, OPHTHALMOLOGY) that selects the specialty template
    # (D-19-03).
    code: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, default=_department_code_from_name
    )
    name_en: Mapped[str] = mapped_column(String(128), nullable=False)
    name_hi: Mapped[str | None] = mapped_column(String(128), nullable=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    doctors: Mapped[list["Doctor"]] = relationship(
        secondary=doctor_departments, back_populates="departments"
    )
    templates: Mapped[list["ClinicalTemplate"]] = relationship(
        "ClinicalTemplate", back_populates="department"
    )
    __mapper_args__ = {"version_id_col": version_id}


class Doctor(Base):
    """Doctor profile entity (SET-02) referenced by users and clinical encounters."""

    __tablename__ = "doctors"
    __table_args__ = (
        Index(
            "ix_doctors_active_cabin_code",
            "cabin_code",
            unique=True,
            postgresql_where=text("cabin_code IS NOT NULL AND is_active = true"),
            sqlite_where=text("cabin_code IS NOT NULL AND is_active = 1"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    name_hi: Mapped[str | None] = mapped_column(String(120), nullable=True)
    qualification: Mapped[str | None] = mapped_column(String(120), nullable=True)
    registration_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    cabin_code: Mapped[str | None] = mapped_column(String(1), nullable=True)
    default_fee_paise: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="doctor", uselist=False)
    departments: Mapped[list["Department"]] = relationship(
        secondary=doctor_departments, back_populates="doctors"
    )

    __mapper_args__ = {"version_id_col": version_id}


class User(Base):
    """User account entity with role, authentication metadata, and lockout counters."""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "role IN ('ADMIN', 'RECEPTION', 'DOCTOR')",
            name="users_role_valid",
        ),
        CheckConstraint(
            "((role = 'DOCTOR') = (doctor_id IS NOT NULL))",
            name="users_doctor_role_requires_id",
        ),
        CheckConstraint(
            "(NOT is_super_admin) OR role = 'ADMIN'",
            name="super_admin_is_admin",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    doctor_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("doctors.id", ondelete="RESTRICT"),
        nullable=True,
        unique=True,
    )
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    must_change_password: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )
    is_super_admin: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    failed_login_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    password_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)

    # Relationships
    doctor: Mapped["Doctor | None"] = relationship("Doctor", back_populates="user")
    sessions: Mapped[list["AuthSession"]] = relationship(
        "AuthSession", back_populates="user", cascade="all, delete-orphan"
    )

    __mapper_args__ = {"version_id_col": version_id}


class AuthSession(Base):
    """User login session storing SHA-256 token hash and CSRF token."""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    ip: Mapped[str | None] = mapped_column(INET, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="sessions")


class LoginThrottle(Base):
    """IP-based login failure tracking for rate-limiting bursts."""

    __tablename__ = "login_throttle"

    ip: Mapped[str] = mapped_column(INET, primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempt_count: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )


class SystemSetup(Base):
    """Authoritative singleton record of first-run setup completion (SEC-07)."""

    __tablename__ = "system_setup"
    __table_args__ = (CheckConstraint("id = 1", name="system_setup_single_row"),)

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    admin_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    # Relationship
    admin_user: Mapped["User"] = relationship("User")


class AuditLog(Base):
    """Immutable, append-only record of system events, logins, and mutations (AUD-01)."""

    __tablename__ = "audit_logs"
    __table_args__ = (
        CheckConstraint(
            "outcome IN ('SUCCESS', 'FAILURE', 'DENIED')",
            name="audit_logs_outcome_valid",
        ),
        Index("ix_audit_logs_occurred_at", "occurred_at"),
        Index("ix_audit_logs_action", "action"),
        Index("ix_audit_logs_entity", "entity_type", "entity_id"),
        Index("ix_audit_logs_actor_time", "actor_user_id", "occurred_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    actor_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    actor_username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actor_role: Mapped[str | None] = mapped_column(String(16), nullable=True)
    action: Mapped[str] = mapped_column(String(48), nullable=False)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    before_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    request_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    ip: Mapped[str | None] = mapped_column(INET, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)


class ClinicSettings(Base):
    """Singleton clinic configuration entity (SET-01, id=1)."""

    __tablename__ = "clinic_settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="clinic_settings_singleton"),
        CheckConstraint(
            "receipt_sequence_cycle IN ('FINANCIAL_YEAR', 'CALENDAR_YEAR')",
            name="clinic_settings_receipt_cycle_valid",
        ),
        CheckConstraint(
            "token_reset_policy IN ('DAILY')",
            name="token_reset_policy_valid",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=1)
    name_en: Mapped[str] = mapped_column(
        String(120), default="Kalyan Hospital", server_default="Kalyan Hospital", nullable=False
    )
    name_hi: Mapped[str] = mapped_column(
        String(120), default="कल्याण हॉस्पिटल", server_default="कल्याण हॉस्पिटल", nullable=False
    )
    trust_name_en: Mapped[str] = mapped_column(
        String(120),
        default="Sri Vashishtha Kalyan Trust",
        server_default="Sri Vashishtha Kalyan Trust",
        nullable=False,
    )
    trust_name_hi: Mapped[str | None] = mapped_column(String(120), nullable=True)
    location_line: Mapped[str] = mapped_column(
        String(120),
        default="Ara, Bhojpur, Bihar",
        server_default="Ara, Bhojpur, Bihar",
        nullable=False,
    )
    address_1: Mapped[str] = mapped_column(String(255), nullable=False)
    address_2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str] = mapped_column(String(64), nullable=False)
    email: Mapped[str | None] = mapped_column(String(120), nullable=True)
    receipt_sequence_cycle: Mapped[str] = mapped_column(
        String(16), default="FINANCIAL_YEAR", server_default="FINANCIAL_YEAR", nullable=False
    )
    print_header_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    print_header_hi: Mapped[str | None] = mapped_column(Text, nullable=True)
    print_footer_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    print_footer_hi: Mapped[str | None] = mapped_column(Text, nullable=True)
    consultation_validity_days: Mapped[int] = mapped_column(
        Integer, default=7, server_default="7", nullable=False
    )
    token_reset_policy: Mapped[str] = mapped_column(
        String(24), default="DAILY", server_default=text("'DAILY'"), nullable=False
    )
    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __mapper_args__ = {"version_id_col": version_id}


class SecuritySettings(Base):
    """Singleton administrator overrides of the environment security baseline (id=1).

    NULL means "use the environment value". Overrides may only tighten that baseline; see
    services/security_policy_service.py.
    """

    __tablename__ = "security_settings"
    __table_args__ = (CheckConstraint("id = 1", name="security_settings_singleton"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=1)
    session_idle_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    session_absolute_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lockout_threshold: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lockout_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    password_min_length: Mapped[int | None] = mapped_column(Integer, nullable=True)
    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __mapper_args__ = {"version_id_col": version_id}


class BackupSettings(Base):
    """Singleton schedule, retention and second-copy destination for scheduled backups (id=1).

    Scheduling is off and retention is unset until an administrator configures them.
    """

    __tablename__ = "backup_settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="backup_settings_singleton"),
        CheckConstraint("frequency IN ('DAILY', 'WEEKLY')", name="backup_settings_frequency_valid"),
        CheckConstraint(
            "weekly_day IS NULL OR weekly_day BETWEEN 0 AND 6",
            name="backup_settings_weekly_day_valid",
        ),
        CheckConstraint(
            "frequency <> 'WEEKLY' OR weekly_day IS NOT NULL",
            name="backup_settings_weekly_day_required",
        ),
        CheckConstraint(
            "retention_count IS NULL OR retention_count >= 1",
            name="backup_settings_retention_positive",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=1)
    schedule_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
    )
    frequency: Mapped[str] = mapped_column(
        String(16), default="DAILY", server_default="DAILY", nullable=False
    )
    run_at: Mapped[time] = mapped_column(
        Time, default=time(2, 0), server_default="02:00:00", nullable=False
    )
    weekly_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    destination_dir: Mapped[str | None] = mapped_column(Text, nullable=True)
    retention_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __mapper_args__ = {"version_id_col": version_id}


class BackupRun(Base):
    """One attempted backup, kept even when it fails (the failed archive leaves no other trace)."""

    __tablename__ = "backup_runs"
    __table_args__ = (
        CheckConstraint("trigger IN ('MANUAL', 'SCHEDULED')", name="backup_runs_trigger_valid"),
        CheckConstraint(
            "outcome IN ('RUNNING', 'SUCCESS', 'FAILURE')", name="backup_runs_outcome_valid"
        ),
        Index("ix_backup_runs_started_at", "started_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    trigger: Mapped[str] = mapped_column(String(16), nullable=False)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    filename: Mapped[str | None] = mapped_column(Text, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    copied_to: Mapped[str | None] = mapped_column(Text, nullable=True)
    pruned_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    error_type: Mapped[str | None] = mapped_column(String(120), nullable=True)


class ConsultationFee(Base):
    """Configurable consultation fee schedule stored as integer paise (SET-03)."""

    __tablename__ = "consultation_fees"
    __table_args__ = (CheckConstraint("fee_paise >= 0", name="consultation_fees_fee_non_negative"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    fee_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __mapper_args__ = {"version_id_col": version_id}


class UrnSequence(Base):
    """Year-scoped atomic URN counter for gap-free sequence allocation (PAT-01)."""

    __tablename__ = "urn_sequences"

    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_seq: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)


class Patient(Base):
    """Patient demographic entity with the 12 canonical fields (PAT-01)."""

    __tablename__ = "patients"
    __table_args__ = (
        CheckConstraint("gender IN ('M', 'F', 'O')", name="patients_gender_valid"),
        CheckConstraint("age_years >= 0 AND age_years <= 150", name="patients_age_valid"),
        CheckConstraint(
            "blood_group IS NULL OR blood_group IN"
            " ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')",
            name="blood_group_valid",
        ),
        Index("ix_patients_urn", "urn"),
        Index("ix_patients_mobile", "mobile"),
        Index("ix_patients_full_name", "full_name"),
        Index("ix_patients_legacy_urn", "legacy_urn"),
        Index("ix_patients_merged_into_id", "merged_into_id"),
        Index("ix_patients_is_archived", "is_archived"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    urn: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    legacy_urn: Mapped[str | None] = mapped_column(String(64), nullable=True)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    guardian_name: Mapped[str] = mapped_column(String(120), nullable=False)
    gender: Mapped[str] = mapped_column(String(1), nullable=False)
    dob: Mapped[date | None] = mapped_column(Date, nullable=True)
    age_years: Mapped[int] = mapped_column(Integer, nullable=False)
    mobile: Mapped[str] = mapped_column(String(15), nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    district: Mapped[str] = mapped_column(
        String(64), default="Bhojpur", server_default="Bhojpur", nullable=False
    )
    state: Mapped[str] = mapped_column(
        String(64), default="Bihar", server_default="Bihar", nullable=False
    )
    emergency_contact: Mapped[str | None] = mapped_column(String(120), nullable=True)
    alternate_mobile: Mapped[str | None] = mapped_column(String(15), nullable=True)
    email: Mapped[str | None] = mapped_column(String(120), nullable=True)
    blood_group: Mapped[str | None] = mapped_column(String(8), nullable=True)
    pin_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    guardian_relationship: Mapped[str | None] = mapped_column(String(40), nullable=True)
    medical_history_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    allergies: Mapped[str] = mapped_column(
        Text, default="None reported", server_default="None reported", nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    # Phase 23: Alias-pointer duplicate merge and filtered soft-archival
    merged_into_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("patients.id", ondelete="RESTRICT"), nullable=True
    )
    merged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    merged_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    merge_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_archived: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    archive_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __mapper_args__ = {"version_id_col": version_id}


class AllergyCategory(StrEnum):
    """Structured allergy category (Level 1 Patient Master)."""

    DRUG = "DRUG"
    FOOD = "FOOD"
    ENVIRONMENTAL = "ENVIRONMENTAL"
    OTHER = "OTHER"


class AllergySeverity(StrEnum):
    """Structured clinical allergy severity."""

    MILD = "MILD"
    MODERATE = "MODERATE"
    SEVERE = "SEVERE"
    LIFE_THREATENING = "LIFE_THREATENING"


class AllergyStatus(StrEnum):
    """Lifecycle status of a structured patient allergy record."""

    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    RESOLVED = "RESOLVED"


class PatientAllergy(Base):
    """Structured clinical allergy record owned by doctors (D-04 clinical privacy)."""

    __tablename__ = "patient_allergies"
    __table_args__ = (
        CheckConstraint(
            "category IN ('DRUG', 'FOOD', 'ENVIRONMENTAL', 'OTHER')",
            name="category_valid",
        ),
        CheckConstraint(
            "severity IN ('MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING')",
            name="severity_valid",
        ),
        CheckConstraint(
            "status IN ('ACTIVE', 'INACTIVE', 'RESOLVED')",
            name="status_valid",
        ),
        Index("ix_patient_allergies_patient_status", "patient_id", "status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    patient_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    substance: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str] = mapped_column(
        String(24),
        default=AllergyCategory.DRUG.value,
        server_default=text(f"'{AllergyCategory.DRUG.value}'"),
        nullable=False,
    )
    severity: Mapped[str] = mapped_column(
        String(24),
        default=AllergySeverity.MODERATE.value,
        server_default=text(f"'{AllergySeverity.MODERATE.value}'"),
        nullable=False,
    )
    reaction: Mapped[str | None] = mapped_column(Text, nullable=True)
    clinical_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16),
        default=AllergyStatus.ACTIVE.value,
        server_default=text(f"'{AllergyStatus.ACTIVE.value}'"),
        nullable=False,
    )
    doctor_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("doctors.id", ondelete="RESTRICT"), nullable=True
    )
    recorded_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)

    __mapper_args__ = {"version_id_col": version_id}

    patient = relationship("Patient", foreign_keys=[patient_id], lazy="select")
    doctor = relationship("Doctor", foreign_keys=[doctor_id], lazy="select")
    recorded_by_user = relationship("User", foreign_keys=[recorded_by_user_id], lazy="joined")


class ConditionStatus(StrEnum):
    """Lifecycle status of a longitudinal patient condition (Level 1 Problem List)."""

    ACTIVE = "ACTIVE"
    RESOLVED = "RESOLVED"
    INACTIVE = "INACTIVE"


class PatientCondition(Base):
    """Longitudinal patient problem-list condition owned by doctors (D-04 clinical privacy)."""

    __tablename__ = "patient_conditions"
    __table_args__ = (
        UniqueConstraint("id", "patient_id", name="uq_patient_conditions_id_patient"),
        CheckConstraint(
            "status IN ('ACTIVE', 'RESOLVED', 'INACTIVE')",
            name="status_valid",
        ),
        Index("ix_patient_conditions_patient_status", "patient_id", "status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    patient_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    doctor_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("doctors.id", ondelete="RESTRICT"), nullable=False
    )
    condition_name: Mapped[str] = mapped_column(String(200), nullable=False)
    icd10_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status: Mapped[str] = mapped_column(
        String(16),
        default=ConditionStatus.ACTIVE.value,
        server_default=text(f"'{ConditionStatus.ACTIVE.value}'"),
        nullable=False,
    )
    onset_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    resolved_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)

    __mapper_args__ = {"version_id_col": version_id}

    patient = relationship("Patient", foreign_keys=[patient_id], lazy="select")
    doctor = relationship("Doctor", foreign_keys=[doctor_id], lazy="select")


class VisitSequence(Base):
    """Year-scoped atomic counter for human-readable visit codes (VIS-YY-NNNNNN)."""

    __tablename__ = "visit_sequences"

    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_number: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)


class EncounterSequence(Base):
    """Year-scoped atomic counter for human-readable encounter codes (ENC-YY-NNNNNN)."""

    __tablename__ = "encounter_sequences"

    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_number: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)


class AppointmentStatus(StrEnum):
    """Appointment workflow status (APT-02)."""

    BOOKED = "BOOKED"
    ARRIVED = "ARRIVED"
    IN_CONSULTATION = "IN_CONSULTATION"
    DONE = "DONE"
    CANCELLED = "CANCELLED"
    NO_SHOW = "NO_SHOW"
    # Replaced by a new linked appointment (RF-11); the old row keeps its history.
    RESCHEDULED = "RESCHEDULED"
    # Explicit OPD lifecycle statuses:
    # TO_ARRIVE -> REGISTERED -> CHECKED_IN -> WAITING -> IN_CONSULTATION -> COMPLETED
    TO_ARRIVE = "TO_ARRIVE"
    REGISTERED = "REGISTERED"
    CHECKED_IN = "CHECKED_IN"
    WAITING = "WAITING"
    COMPLETED = "COMPLETED"


class ConsultationStatus(StrEnum):
    """Doctor-side consultation state of one appointment (RF-10)."""

    WAITING = "WAITING"
    IN_CONSULTATION = "IN_CONSULTATION"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class AppointmentSource(StrEnum):
    """How an appointment was made (RF-10)."""

    PHONE = "PHONE"
    WALK_IN = "WALK_IN"


class VisitStatus(StrEnum):
    """Reception visit lifecycle: opened at check-in, closed or cancelled at checkout (RF-10)."""

    OPEN = "OPEN"
    CLOSED = "CLOSED"
    CANCELLED = "CANCELLED"


class VisitKind(StrEnum):
    """Visit type of one consultation (OD-22-05). Recorded only; it never sets the fee."""

    NEW = "NEW"
    FOLLOW_UP = "FOLLOW_UP"


class PriorityLevel(StrEnum):
    """Queue classification set by reception (OD-22-06). It never changes the token."""

    NORMAL = "NORMAL"
    PRIORITY = "PRIORITY"
    EMERGENCY = "EMERGENCY"


class ReferralSource(StrEnum):
    """Who referred the patient for this visit (OD-22-16)."""

    SELF = "SELF"
    DOCTOR = "DOCTOR"
    PERSONAL = "PERSONAL"
    ORGANIZATION = "ORGANIZATION"
    OTHER = "OTHER"


# Referral sources that must name the referrer (OD-22-16).
REFERRAL_SOURCES_NEEDING_NAME = frozenset(
    {ReferralSource.DOCTOR.value, ReferralSource.PERSONAL.value, ReferralSource.ORGANIZATION.value}
)


class DailyTokenSequence(Base):
    """Per-doctor daily sequential token counter for gap-free appointment allocation (APT-01)."""

    __tablename__ = "daily_token_sequences"

    doctor_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("doctors.id", ondelete="RESTRICT"), primary_key=True
    )
    appointment_date: Mapped[date] = mapped_column(Date, primary_key=True)
    last_token: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class PendingOpdArrival(Base):
    """Token reservation for a first-time patient before canonical registration (OD-OPD-01).

    This row holds only intake facts supplied at reception. It becomes a permanent Patient and
    linked Appointment atomically when the full registration form is submitted. Token numbers
    are reserved through DailyTokenSequence and retained on the resulting appointment.
    """

    __tablename__ = "pending_opd_arrivals"
    __table_args__ = (
        CheckConstraint("age_years >= 0 AND age_years <= 150", name="age_valid"),
        CheckConstraint(
            "priority_level IN ('NORMAL', 'PRIORITY', 'EMERGENCY')", name="priority_valid"
        ),
        CheckConstraint(
            "priority_level = 'NORMAL' OR (priority_reason IS NOT NULL"
            " AND length(trim(priority_reason)) >= 3)",
            name="priority_reason_present",
        ),
        CheckConstraint("status IN ('TO_ARRIVE', 'REGISTERED', 'CANCELLED')", name="status_valid"),
        UniqueConstraint(
            "doctor_id", "appointment_date", "token_number", name="uq_pending_opd_arrival_token"
        ),
        Index("ix_pending_opd_arrivals_date_status", "appointment_date", "status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    age_years: Mapped[int] = mapped_column(Integer, nullable=False)
    mobile: Mapped[str] = mapped_column(String(15), nullable=False)
    doctor_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("doctors.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    department_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("departments.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    appointment_date: Mapped[date] = mapped_column(Date, nullable=False)
    token_number: Mapped[int] = mapped_column(Integer, nullable=False)
    priority_level: Mapped[str] = mapped_column(
        String(16), default=PriorityLevel.NORMAL.value, server_default="NORMAL", nullable=False
    )
    priority_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), default="TO_ARRIVE", server_default="TO_ARRIVE", nullable=False
    )
    patient_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("patients.id", ondelete="RESTRICT"), nullable=True, unique=True
    )
    appointment_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("appointments.id", ondelete="RESTRICT"), nullable=True, unique=True
    )
    created_by_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    status_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    doctor: Mapped["Doctor"] = relationship("Doctor", lazy="joined")
    department: Mapped["Department"] = relationship("Department", lazy="joined")

    __mapper_args__ = {"version_id_col": version_id}


class Visit(Base):
    """A patient's visit at reception on one day, opened at check-in (RF-10)."""

    __tablename__ = "visits"
    __table_args__ = (
        CheckConstraint("status IN ('OPEN', 'CLOSED', 'CANCELLED')", name="status_valid"),
        CheckConstraint(
            "status <> 'CLOSED' OR (closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL)",
            name="closed_fields_present",
        ),
        CheckConstraint(
            "status <> 'CANCELLED' OR (cancelled_at IS NOT NULL"
            " AND cancelled_by_user_id IS NOT NULL AND cancel_reason IS NOT NULL)",
            name="cancelled_fields_present",
        ),
        CheckConstraint(
            "referral_source IS NULL OR referral_source IN"
            " ('SELF', 'DOCTOR', 'PERSONAL', 'ORGANIZATION', 'OTHER')",
            name="referral_source_valid",
        ),
        CheckConstraint(
            "referral_source IS NULL OR referral_source NOT IN"
            " ('DOCTOR', 'PERSONAL', 'ORGANIZATION')"
            " OR (referrer_name IS NOT NULL AND length(trim(referrer_name)) >= 2)",
            name="referrer_name_present",
        ),
        # Target of fk_appointments_visit_patient (same-patient rule, as SEC-03).
        UniqueConstraint("id", "patient_id", name="uq_visits_id_patient"),
        UniqueConstraint("visit_code", name="uq_visits_visit_code"),
        # At most one OPEN visit per patient at any time.
        Index(
            "ix_visits_one_open_per_patient",
            "patient_id",
            unique=True,
            postgresql_where=text("status = 'OPEN'"),
        ),
        Index("ix_visits_patient_date", "patient_id", "visit_date"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    visit_code: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=FetchedValue()
    )
    patient_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    visit_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16),
        default=VisitStatus.OPEN.value,
        server_default=text(f"'{VisitStatus.OPEN.value}'"),
        nullable=False,
    )
    opened_by_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    closed_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    close_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancelled_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Referred By, recorded by the check-in that opened the visit (OD-22-16). Empty only on
    # visits opened before phase 22.
    referral_source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    referrer_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    referral_recorded_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    referral_recorded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    version_id: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __mapper_args__ = {"version_id_col": version_id}


class Appointment(Base):
    """Per-doctor daily appointment booking with atomic token and status (APT-01, APT-02)."""

    __tablename__ = "appointments"
    __table_args__ = (
        UniqueConstraint(
            "doctor_id",
            "appointment_date",
            "token_number",
            name="uq_appointments_doctor_date_token",
        ),
        # Target of fk_clinical_encounters_appointment_patient (BR-001, SEC-03).
        UniqueConstraint("id", "patient_id", name="uq_appointments_id_patient"),
        Index("ix_appointments_doctor_date_status", "doctor_id", "appointment_date", "status"),
        Index("ix_appointments_patient_date", "patient_id", "appointment_date"),
        # Same-patient rule for visit links (RF-10, as SEC-03).
        ForeignKeyConstraint(
            ["visit_id", "patient_id"],
            ["visits.id", "visits.patient_id"],
            name="fk_appointments_visit_patient",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "status IN ('BOOKED', 'ARRIVED', 'IN_CONSULTATION', 'DONE', 'CANCELLED', "
            "'NO_SHOW', 'RESCHEDULED', 'TO_ARRIVE', 'REGISTERED', 'CHECKED_IN', "
            "'WAITING', 'COMPLETED')",
            name="status_valid",
        ),
        CheckConstraint("source IS NULL OR source IN ('PHONE', 'WALK_IN')", name="source_valid"),
        CheckConstraint(
            "consultation_status IS NULL OR consultation_status IN"
            " ('WAITING', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED')",
            name="consultation_status_valid",
        ),
        CheckConstraint(
            "visit_kind IS NULL OR visit_kind IN ('NEW', 'FOLLOW_UP')", name="visit_kind_valid"
        ),
        CheckConstraint(
            "priority_level IN ('NORMAL', 'PRIORITY', 'EMERGENCY')", name="priority_level_valid"
        ),
        CheckConstraint(
            "priority_level = 'NORMAL'"
            " OR (priority_reason IS NOT NULL AND length(trim(priority_reason)) >= 3)",
            name="priority_reason_present",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    patient_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    doctor_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("doctors.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    department_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("departments.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    appointment_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # Issued at check-in, not at booking (RF-10). NULL until the patient checks in.
    token_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(
        String(32),
        default=AppointmentStatus.BOOKED.value,
        server_default=text(f"'{AppointmentStatus.BOOKED.value}'"),
        nullable=False,
    )
    status_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    check_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    visit_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("visits.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    expected_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    rescheduled_from_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("appointments.id", ondelete="RESTRICT"), nullable=True
    )
    consultation_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Visit type (OD-22-05); empty on consultations recorded before phase 22.
    visit_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Classification (OD-22-06/07/09). The token never changes with it; history lives in
    # consultation_priority_events.
    priority_level: Mapped[str] = mapped_column(
        String(16),
        default=PriorityLevel.NORMAL.value,
        server_default=text(f"'{PriorityLevel.NORMAL.value}'"),
        nullable=False,
    )
    priority_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    priority_updated_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    emergency_alerted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    alert_acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    alert_acknowledged_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    created_by_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __mapper_args__ = {"version_id_col": version_id}

    patient = relationship("Patient", lazy="joined")
    doctor = relationship("Doctor", lazy="joined")
    department = relationship("Department", lazy="joined")
    created_by_user = relationship("User", foreign_keys=[created_by_user_id], lazy="joined")


class PriorityEventType(StrEnum):
    """What a classification history row records (OD-22-06/09)."""

    CLASSIFIED = "CLASSIFIED"
    ACKNOWLEDGED = "ACKNOWLEDGED"


class ConsultationPriorityEvent(Base):
    """Append-only history of classification changes and emergency acknowledgements.

    The runtime role holds SELECT and INSERT only (migration 0026), so rows cannot be edited.
    """

    __tablename__ = "consultation_priority_events"
    __table_args__ = (
        ForeignKeyConstraint(
            ["appointment_id", "patient_id"],
            ["appointments.id", "appointments.patient_id"],
            name="fk_consultation_priority_events_appointment_patient",
            ondelete="RESTRICT",
        ),
        CheckConstraint("event IN ('CLASSIFIED', 'ACKNOWLEDGED')", name="event_valid"),
        CheckConstraint(
            "to_level IN ('NORMAL', 'PRIORITY', 'EMERGENCY')"
            " AND (from_level IS NULL OR from_level IN ('NORMAL', 'PRIORITY', 'EMERGENCY'))",
            name="levels_valid",
        ),
        Index("ix_consultation_priority_events_appointment", "appointment_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    appointment_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    visit_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("visits.id", ondelete="RESTRICT"), nullable=True
    )
    patient_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    doctor_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("doctors.id", ondelete="RESTRICT"), nullable=False
    )
    event: Mapped[str] = mapped_column(String(16), nullable=False)
    from_level: Mapped[str | None] = mapped_column(String(16), nullable=True)
    to_level: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class BillItemCategory(StrEnum):
    """Bill categories (OD-22-14, migration 0027/0029)."""

    CONSULTATION = "CONSULTATION"
    PROCEDURE = "PROCEDURE"
    PACKAGE = "PACKAGE"
    MEDICINE = "MEDICINE"
    ADDITIONAL = "ADDITIONAL"


class BillItemStatus(StrEnum):
    """Status of a bill line (ACTIVE or VOIDED)."""

    ACTIVE = "ACTIVE"
    VOIDED = "VOIDED"


class BillItemSource(StrEnum):
    """Who created a bill line: the doctor, reception, or the system (the check-in snapshot)."""

    DOCTOR = "DOCTOR"
    RECEPTION = "RECEPTION"
    SYSTEM = "SYSTEM"


class BillItem(Base):
    """One charge line on a visit's bill (Phase 22, design §4, OD-22-10).

    A consultation's line stores the doctor's fee at check-in. Later fee changes never alter it,
    so an existing bill cannot change when a doctor's default fee is edited (K-63, FEE-07).
    Rows are append-only except the amount/status moves written with a history row in the same
    transaction (migration 0027, 0028, 0029).
    Amounts are integer paise.
    """

    __tablename__ = "bill_items"
    __table_args__ = (
        ForeignKeyConstraint(
            ["visit_id", "patient_id"],
            ["visits.id", "visits.patient_id"],
            name="fk_bill_items_visit_patient",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["appointment_id", "patient_id"],
            ["appointments.id", "appointments.patient_id"],
            name="fk_bill_items_appointment_patient",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["treatment_plan_id", "patient_id"],
            ["treatment_plans.id", "treatment_plans.patient_id"],
            name="fk_bill_items_treatment_plan_patient",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "category IN ('CONSULTATION', 'PROCEDURE', 'PACKAGE', 'MEDICINE', 'ADDITIONAL')",
            name="category_valid",
        ),
        CheckConstraint("source IN ('DOCTOR', 'RECEPTION', 'SYSTEM')", name="source_valid"),
        CheckConstraint("status IN ('ACTIVE', 'VOIDED')", name="status_valid"),
        CheckConstraint(
            "(status = 'ACTIVE' AND void_reason IS NULL AND voided_by_user_id IS NULL"
            " AND voided_at IS NULL) "
            "OR (status = 'VOIDED' AND void_reason IS NOT NULL"
            " AND length(trim(void_reason)) >= 3 "
            "AND voided_by_user_id IS NOT NULL AND voided_at IS NOT NULL)",
            name="void_integrity",
        ),
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("rate_paise >= 0 AND amount_paise >= 0", name="amounts_nonnegative"),
        CheckConstraint(
            "category <> 'CONSULTATION' OR appointment_id IS NOT NULL",
            name="consultation_has_appointment",
        ),
        CheckConstraint(
            "category <> 'PACKAGE' OR (treatment_plan_id IS NOT NULL AND rate_paise = 0"
            " AND amount_paise = 0)",
            name="package_reference",
        ),
        CheckConstraint(
            "category = 'MEDICINE' OR prescription_item_id IS NULL",
            name="prescription_link_medicine_only",
        ),
        Index("ix_bill_items_visit", "visit_id"),
        Index("ix_bill_items_appointment", "appointment_id"),
        # One consultation line per appointment: the snapshot is written once.
        Index(
            "uq_bill_items_consultation_appointment",
            "appointment_id",
            unique=True,
            postgresql_where=text("category = 'CONSULTATION'"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    visit_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    patient_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    appointment_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    treatment_plan_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    prescription_item_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("prescription_items.id", ondelete="SET NULL"), nullable=True
    )
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16),
        default=BillItemStatus.ACTIVE.value,
        server_default=text(f"'{BillItemStatus.ACTIVE.value}'"),
        nullable=False,
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=text("1")
    )
    rate_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # The amount as first billed (design §4). amount_paise moves only through a logged adjustment.
    original_amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    void_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    voided_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class BillItemAdjustmentKind(StrEnum):
    """Why a bill line changed: discount, waiver, correction, or void (OD-22-11, OD-22-15)."""

    DISCOUNT = "DISCOUNT"
    WAIVER = "WAIVER"
    CORRECTION = "CORRECTION"
    VOID = "VOID"


class BillItemAdjustment(Base):
    """Append-only history of bill line changes (design §4, OD-22-11, OD-22-15).

    The line keeps its current amount; every change writes one row with the value it replaced,
    the reason, the staff member and the time. Rows cannot be updated or deleted by the app.
    """

    __tablename__ = "bill_item_adjustments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["bill_item_id"],
            ["bill_items.id"],
            name="fk_bill_item_adjustments_bill_item",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "kind IN ('DISCOUNT', 'WAIVER', 'CORRECTION', 'VOID')",
            name="kind_valid",
        ),
        CheckConstraint("length(trim(reason)) >= 3", name="reason_present"),
        CheckConstraint(
            "old_amount_paise >= 0 AND new_amount_paise >= 0",
            name="amounts_nonnegative",
        ),
        Index("ix_bill_item_adjustments_bill_item", "bill_item_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bill_item_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    old_quantity: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    new_quantity: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    old_rate_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    new_rate_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    old_amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    new_amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ClinicalEncounter(Base):
    """Clinical encounter recorded by doctor; locked once finalised (CLN-01, CLN-02)."""

    __tablename__ = "clinical_encounters"
    __table_args__ = (
        Index("ix_encounters_patient_id", "patient_id"),
        Index("ix_encounters_doctor_id", "doctor_id"),
        Index("ix_encounters_encounter_date", "encounter_date"),
        Index("ix_encounters_appointment_id", "appointment_id"),
        Index("ix_clinical_encounters_visit_id", "visit_id"),
        Index(
            "uq_clinical_encounters_appointment_id",
            "appointment_id",
            unique=True,
            postgresql_where=text("appointment_id IS NOT NULL"),
        ),
        UniqueConstraint("encounter_code", name="uq_clinical_encounters_encounter_code"),
        # Target of the prescription and treatment-plan patient-link constraints (SEC-03).
        UniqueConstraint("id", "patient_id", name="uq_clinical_encounters_id_patient"),
        # BR-001, SEC-03: a linked appointment must belong to the same patient. Deleting the
        # appointment clears only the link, as the single-column foreign key always did.
        ForeignKeyConstraint(
            ["appointment_id", "patient_id"],
            ["appointments.id", "appointments.patient_id"],
            name="fk_clinical_encounters_appointment_patient",
            ondelete="SET NULL (appointment_id)",
        ),
        # Same-patient rule for visit link; PG15 ON DELETE SET NULL (visit_id) enforced in 0034.
        ForeignKeyConstraint(
            ["visit_id", "patient_id"],
            ["visits.id", "visits.patient_id"],
            name="fk_clinical_encounters_visit_patient",
            ondelete="SET NULL (visit_id)",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    encounter_code: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=FetchedValue()
    )
    visit_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    appointment_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True
    )
    department_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True
    )
    patient_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    patient_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    patient_urn: Mapped[str | None] = mapped_column(String(32), nullable=True)
    patient_mobile: Mapped[str | None] = mapped_column(String(15), nullable=True)
    patient_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    doctor_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("doctors.id", ondelete="RESTRICT"), nullable=False
    )
    encounter_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    symptoms: Mapped[str] = mapped_column(
        Text, default="", server_default=text("''"), nullable=True
    )
    clinical_notes: Mapped[str] = mapped_column(
        Text, default="", server_default=text("''"), nullable=True
    )
    diagnosis: Mapped[str] = mapped_column(
        Text, default="", server_default=text("''"), nullable=True
    )
    is_finalised: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    finalised_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __mapper_args__ = {"version_id_col": version_id}

    patient = relationship("Patient", lazy="joined")
    doctor = relationship("Doctor", lazy="joined")
    department = relationship("Department", lazy="select")
    appointment = relationship("Appointment", foreign_keys=[appointment_id], lazy="select")
    addenda = relationship(
        "ClinicalAddendum",
        back_populates="encounter",
        cascade="all, delete-orphan",
        order_by="ClinicalAddendum.created_at",
    )
    template_response = relationship(
        "ClinicalTemplateResponse",
        back_populates="encounter",
        uselist=False,
        cascade="all, delete-orphan",
    )
    vitals = relationship(
        "VitalObservation",
        back_populates="encounter",
        uselist=False,
        cascade="all, delete-orphan",
        foreign_keys="VitalObservation.encounter_id",
    )
    follow_up_recommendation = relationship(
        "FollowUpRecommendation",
        back_populates="encounter",
        uselist=False,
        cascade="all, delete-orphan",
        foreign_keys="FollowUpRecommendation.encounter_id",
    )


class ClinicalAddendum(Base):
    """Chronologically ordered, dated addenda attached to finalised encounters (CLN-02)."""

    __tablename__ = "clinical_addenda"
    __table_args__ = (Index("ix_clinical_addenda_encounter_id", "encounter_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    encounter_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("clinical_encounters.id", ondelete="RESTRICT"), nullable=False
    )
    doctor_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("doctors.id", ondelete="RESTRICT"), nullable=False
    )
    addendum_text: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    encounter = relationship("ClinicalEncounter", back_populates="addenda")
    doctor = relationship("Doctor", lazy="joined")
    created_by_user = relationship("User", lazy="joined")


class DiagnosisType(StrEnum):
    """Clinical classification of a structured encounter diagnosis."""

    PRIMARY = "PRIMARY"
    SECONDARY = "SECONDARY"
    PROVISIONAL = "PROVISIONAL"


class DiagnosisStatus(StrEnum):
    """Clinical status of a structured encounter diagnosis."""

    ACTIVE = "ACTIVE"
    RESOLVED = "RESOLVED"
    INACTIVE = "INACTIVE"


class EncounterDiagnosis(Base):
    """Structured per-encounter diagnosis locked once the parent encounter is finalised."""

    __tablename__ = "encounter_diagnoses"
    __table_args__ = (
        ForeignKeyConstraint(
            ["encounter_id", "patient_id"],
            ["clinical_encounters.id", "clinical_encounters.patient_id"],
            name="fk_encounter_diagnoses_encounter_patient",
            ondelete="RESTRICT",
        ),
        # Same-patient rule for condition link; PG15 ON DELETE SET NULL (patient_condition_id)
        # enforced in migration 0035.
        ForeignKeyConstraint(
            ["patient_condition_id", "patient_id"],
            ["patient_conditions.id", "patient_conditions.patient_id"],
            name="fk_encounter_diagnoses_condition_patient",
            ondelete="SET NULL (patient_condition_id)",
        ),
        CheckConstraint(
            "diagnosis_type IN ('PRIMARY', 'SECONDARY', 'PROVISIONAL')",
            name="type_valid",
        ),
        CheckConstraint(
            "status IN ('ACTIVE', 'RESOLVED', 'INACTIVE')",
            name="status_valid",
        ),
        Index("ix_encounter_diagnoses_encounter_id", "encounter_id"),
        Index("ix_encounter_diagnoses_patient_id", "patient_id"),
        Index("ix_encounter_diagnoses_condition_id", "patient_condition_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    encounter_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    patient_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    doctor_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("doctors.id", ondelete="RESTRICT"), nullable=False
    )
    diagnosis_name: Mapped[str] = mapped_column(String(200), nullable=False)
    icd10_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    diagnosis_type: Mapped[str] = mapped_column(
        String(16),
        default=DiagnosisType.PRIMARY.value,
        server_default=text(f"'{DiagnosisType.PRIMARY.value}'"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(16),
        default=DiagnosisStatus.ACTIVE.value,
        server_default=text(f"'{DiagnosisStatus.ACTIVE.value}'"),
        nullable=False,
    )
    onset_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    patient_condition_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    doctor = relationship("Doctor", foreign_keys=[doctor_id], lazy="select")
    patient_condition = relationship(
        "PatientCondition",
        foreign_keys=[patient_condition_id, patient_id],
        primaryjoin=(
            "and_(EncounterDiagnosis.patient_condition_id == PatientCondition.id, "
            "EncounterDiagnosis.patient_id == PatientCondition.patient_id)"
        ),
        viewonly=True,
        lazy="select",
    )


class InvestigationCategory(StrEnum):
    """Clinical investigation order category."""

    LAB = "LAB"
    IMAGING = "IMAGING"
    PATHOLOGY = "PATHOLOGY"
    DIAGNOSTIC = "DIAGNOSTIC"
    OTHER = "OTHER"


class InvestigationPriority(StrEnum):
    """Clinical urgency of an investigation order."""

    ROUTINE = "ROUTINE"
    URGENT = "URGENT"


class InvestigationStatus(StrEnum):
    """Lifecycle status of an investigation order."""

    ORDERED = "ORDERED"
    SAMPLE_COLLECTED = "SAMPLE_COLLECTED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class InvestigationOrder(Base):
    """Doctor-ordered clinical investigation linked to an encounter and patient."""

    __tablename__ = "investigation_orders"
    __table_args__ = (
        UniqueConstraint("id", "patient_id", name="uq_investigation_orders_id_patient"),
        ForeignKeyConstraint(
            ["encounter_id", "patient_id"],
            ["clinical_encounters.id", "clinical_encounters.patient_id"],
            name="fk_investigation_orders_encounter_patient",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "category IN ('LAB', 'IMAGING', 'PATHOLOGY', 'DIAGNOSTIC', 'OTHER')",
            name="category_valid",
        ),
        CheckConstraint(
            "priority IN ('ROUTINE', 'URGENT')",
            name="priority_valid",
        ),
        CheckConstraint(
            "status IN ('ORDERED', 'SAMPLE_COLLECTED', 'COMPLETED', 'CANCELLED')",
            name="status_valid",
        ),
        CheckConstraint(
            "(status = 'CANCELLED' AND length(trim(coalesce(cancelled_reason, ''))) >= 3) "
            "OR status <> 'CANCELLED'",
            name="cancel_reason_required",
        ),
        Index("ix_investigation_orders_encounter_id", "encounter_id"),
        Index("ix_investigation_orders_patient_status", "patient_id", "status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    encounter_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    patient_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    doctor_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("doctors.id", ondelete="RESTRICT"), nullable=False
    )
    category: Mapped[str] = mapped_column(String(24), nullable=False)
    test_name: Mapped[str] = mapped_column(String(200), nullable=False)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[str] = mapped_column(
        String(16),
        default=InvestigationPriority.ROUTINE.value,
        server_default=text(f"'{InvestigationPriority.ROUTINE.value}'"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(24),
        default=InvestigationStatus.ORDERED.value,
        server_default=text(f"'{InvestigationStatus.ORDERED.value}'"),
        nullable=False,
    )
    cancelled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    ordered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)

    __mapper_args__ = {"version_id_col": version_id}

    doctor = relationship("Doctor", foreign_keys=[doctor_id], lazy="select")
    results: Mapped[list["InvestigationResult"]] = relationship(
        "InvestigationResult",
        back_populates="order",
        order_by="desc(InvestigationResult.reported_at), desc(InvestigationResult.id)",
        lazy="select",
    )


class InvestigationResult(Base):
    """Append-only investigation result recorded against an investigation order."""

    __tablename__ = "investigation_results"
    __table_args__ = (
        ForeignKeyConstraint(
            ["order_id", "patient_id"],
            ["investigation_orders.id", "investigation_orders.patient_id"],
            name="fk_investigation_results_order_patient",
            ondelete="RESTRICT",
        ),
        Index("ix_investigation_results_order_id", "order_id"),
        Index("ix_investigation_results_patient_id", "patient_id"),
        Index("ix_investigation_results_document_id", "document_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    order_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    patient_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    document_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("patient_documents.id", ondelete="SET NULL"), nullable=True
    )
    summary_text: Mapped[str] = mapped_column(Text, nullable=False)
    result_value: Mapped[str | None] = mapped_column(String(120), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    reference_range: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_abnormal: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    reported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    recorded_by_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    order = relationship("InvestigationOrder", back_populates="results", lazy="select")
    document = relationship("PatientDocument", foreign_keys=[document_id], lazy="select")
    recorded_by_user = relationship("User", foreign_keys=[recorded_by_user_id], lazy="joined")


class DocumentCategory(StrEnum):
    """Document categories for patient attachments (Milestone 4, migration 0037)."""

    LAB_REPORT = "LAB_REPORT"
    IMAGING = "IMAGING"
    PRESCRIPTION_SCAN = "PRESCRIPTION_SCAN"
    REFERRAL = "REFERRAL"
    ID_PROOF = "ID_PROOF"
    INSURANCE = "INSURANCE"
    DISCHARGE_SUMMARY = "DISCHARGE_SUMMARY"
    OTHER = "OTHER"


class PatientDocument(Base):
    """Patient-attached clinical or administrative document stored locally (Milestone 4)."""

    __tablename__ = "patient_documents"
    __table_args__ = (
        UniqueConstraint("stored_filename", name="uq_patient_documents_stored_filename"),
        # Same-patient composite FKs; PG15 ON DELETE SET NULL (visit_id / encounter_id)
        # enforced in migration 0037.
        ForeignKeyConstraint(
            ["visit_id", "patient_id"],
            ["visits.id", "visits.patient_id"],
            name="fk_patient_documents_visit_patient",
            ondelete="SET NULL (visit_id)",
        ),
        ForeignKeyConstraint(
            ["encounter_id", "patient_id"],
            ["clinical_encounters.id", "clinical_encounters.patient_id"],
            name="fk_patient_documents_encounter_patient",
            ondelete="SET NULL (encounter_id)",
        ),
        CheckConstraint(
            "category IN ("
            "'LAB_REPORT', 'IMAGING', 'PRESCRIPTION_SCAN', 'REFERRAL', "
            "'ID_PROOF', 'INSURANCE', 'DISCHARGE_SUMMARY', 'OTHER')",
            name="category_valid",
        ),
        CheckConstraint(
            "category NOT IN ('LAB_REPORT', 'IMAGING', 'PRESCRIPTION_SCAN', 'DISCHARGE_SUMMARY') "
            "OR is_clinical = TRUE",
            name="clinical_category",
        ),
        CheckConstraint(
            "mime_type IN ('application/pdf', 'image/jpeg', 'image/png')",
            name="mime_type_valid",
        ),
        CheckConstraint(
            "file_size_bytes > 0 AND file_size_bytes <= 10485760",
            name="file_size_valid",
        ),
        Index(
            "ix_patient_documents_patient_active",
            "patient_id",
            "is_archived",
            text("created_at DESC"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    patient_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    visit_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    encounter_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    is_clinical: Mapped[bool] = mapped_column(Boolean, nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_filename: Mapped[str] = mapped_column(String(128), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256_hex: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    doctor_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("doctors.id", ondelete="RESTRICT"), nullable=True
    )
    is_archived: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    patient = relationship("Patient", foreign_keys=[patient_id], lazy="select")
    doctor = relationship("Doctor", foreign_keys=[doctor_id], lazy="select")
    uploaded_by_user = relationship("User", foreign_keys=[uploaded_by_user_id], lazy="select")
    archived_by_user = relationship("User", foreign_keys=[archived_by_user_id], lazy="select")


class TreatmentPlanStatus(StrEnum):
    """Lifecycle statuses for multi-session physiotherapy treatment packages."""

    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class TreatmentPlan(Base):
    """Multi-session physiotherapy treatment plan / package (TRT-01, OQ-13)."""

    __tablename__ = "treatment_plans"
    __table_args__ = (
        Index("ix_treatment_plans_patient_id", "patient_id"),
        Index("ix_treatment_plans_doctor_id", "doctor_id"),
        Index("ix_treatment_plans_status", "status"),
        # Target of the payment and treatment-session patient-link constraints (FB-04, SEC-03).
        UniqueConstraint("id", "patient_id", name="uq_treatment_plans_id_patient"),
        # BR-001, SEC-03: a linked encounter must belong to the same patient.
        ForeignKeyConstraint(
            ["encounter_id", "patient_id"],
            ["clinical_encounters.id", "clinical_encounters.patient_id"],
            name="fk_treatment_plans_encounter_patient",
            ondelete="SET NULL (encounter_id)",
        ),
        CheckConstraint(
            "total_sessions >= 1 AND total_sessions <= 200",
            name="ck_treatment_plans_total_sessions",
        ),
        CheckConstraint(
            "completed_sessions >= 0 AND completed_sessions <= total_sessions",
            name="ck_treatment_plans_completed_sessions",
        ),
        CheckConstraint("agreed_price_paise >= 0", name="ck_treatment_plans_agreed_price"),
        CheckConstraint(
            "status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')", name="ck_treatment_plans_status"
        ),
        CheckConstraint(
            "status != 'CANCELLED' OR ("
            "cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) >= 3)",
            name="ck_treatment_plans_cancellation",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    patient_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    doctor_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("doctors.id", ondelete="RESTRICT"), nullable=False
    )
    encounter_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("clinical_encounters.id", ondelete="SET NULL"), nullable=True
    )
    plan_name: Mapped[str] = mapped_column(String(128), nullable=False)
    condition_diagnosis: Mapped[str] = mapped_column(Text, nullable=False)
    referred_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    total_sessions: Mapped[int] = mapped_column(Integer, nullable=False)
    completed_sessions: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    agreed_price_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(
        String(32),
        default=TreatmentPlanStatus.ACTIVE.value,
        server_default=TreatmentPlanStatus.ACTIVE.value,
        nullable=False,
    )
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __mapper_args__ = {"version_id_col": version_id}

    patient = relationship("Patient", lazy="joined")
    doctor = relationship("Doctor", lazy="joined")
    encounter = relationship("ClinicalEncounter", foreign_keys=[encounter_id], lazy="select")
    sessions = relationship(
        "TreatmentSession",
        back_populates="treatment_plan",
        cascade="all, delete-orphan",
        order_by="TreatmentSession.session_number",
        foreign_keys="TreatmentSession.treatment_plan_id",
    )


class TreatmentSession(Base):
    """Chronological individual physiotherapy session logs with VAS scoring (TRT-02, TRT-03)."""

    __tablename__ = "treatment_sessions"
    __table_args__ = (
        UniqueConstraint(
            "treatment_plan_id", "session_number", name="uq_treatment_sessions_plan_session"
        ),
        Index("ix_treatment_sessions_treatment_plan_id", "treatment_plan_id"),
        Index("ix_treatment_sessions_patient_id", "patient_id"),
        Index("ix_treatment_sessions_session_date", "session_date"),
        CheckConstraint("vas_score >= 0 AND vas_score <= 10", name="ck_treatment_sessions_vas"),
        CheckConstraint("session_number >= 1", name="ck_treatment_sessions_number"),
        CheckConstraint("length(trim(clinical_notes)) >= 2", name="ck_treatment_sessions_notes"),
        # FB-04 / SEC-03: treatment session must belong to the treatment plan's patient
        ForeignKeyConstraint(
            ["treatment_plan_id", "patient_id"],
            ["treatment_plans.id", "treatment_plans.patient_id"],
            name="fk_treatment_sessions_plan_patient",
            ondelete="RESTRICT",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    treatment_plan_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("treatment_plans.id", ondelete="RESTRICT"), nullable=False
    )
    patient_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    doctor_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("doctors.id", ondelete="RESTRICT"), nullable=False
    )
    session_number: Mapped[int] = mapped_column(Integer, nullable=False)
    session_date: Mapped[date] = mapped_column(
        Date, server_default=func.current_date(), nullable=False
    )
    vas_score: Mapped[int] = mapped_column(Integer, nullable=False)
    modalities: Mapped[list] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb"), nullable=False
    )
    clinical_notes: Mapped[str] = mapped_column(Text, nullable=False)
    is_finalised: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    created_by_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    treatment_plan = relationship(
        "TreatmentPlan", back_populates="sessions", foreign_keys=[treatment_plan_id]
    )
    patient = relationship("Patient", lazy="joined")
    doctor = relationship("Doctor", lazy="joined")
    created_by_user = relationship("User", lazy="joined")
    addenda = relationship(
        "TreatmentSessionAddendum",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="TreatmentSessionAddendum.created_at",
    )


class TreatmentSessionAddendum(Base):
    """Chronologically ordered addenda for finalised physiotherapy sessions (TRT-03)."""

    __tablename__ = "treatment_session_addenda"
    __table_args__ = (Index("ix_treatment_session_addenda_session_id", "session_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("treatment_sessions.id", ondelete="RESTRICT"), nullable=False
    )
    author_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    note: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    session = relationship("TreatmentSession", back_populates="addenda")
    author_user = relationship("User", lazy="joined")


class PrescriptionStatus(StrEnum):
    """Lifecycle statuses for medical prescriptions (DWS-07)."""

    DRAFT = "DRAFT"
    AUTHORISED = "AUTHORISED"
    SUPERSEDED = "SUPERSEDED"
    CANCELLED = "CANCELLED"


class Prescription(Base):
    """Doctor medical prescription record (RX-01, DWS-07)."""

    __tablename__ = "prescriptions"
    __table_args__ = (
        Index("ix_prescriptions_patient_id", "patient_id"),
        Index("ix_prescriptions_doctor_id", "doctor_id"),
        Index("ix_prescriptions_encounter_id", "encounter_id"),
        # BR-001, SEC-03: a linked encounter must belong to the same patient.
        ForeignKeyConstraint(
            ["encounter_id", "patient_id"],
            ["clinical_encounters.id", "clinical_encounters.patient_id"],
            name="fk_prescriptions_encounter_patient",
            ondelete="SET NULL (encounter_id)",
        ),
        CheckConstraint("length(trim(diagnosis)) >= 2", name="ck_prescriptions_diagnosis"),
        CheckConstraint(
            "status IN ('DRAFT', 'AUTHORISED', 'SUPERSEDED', 'CANCELLED')",
            name="status",
        ),
        CheckConstraint("revision_number >= 1", name="revision_positive"),
        CheckConstraint(
            "(status != 'CANCELLED' AND cancelled_at IS NULL AND cancellation_reason IS NULL AND "
            "cancelled_by_user_id IS NULL) "
            "OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND "
            "length(trim(cancellation_reason)) >= 3 AND cancelled_by_user_id IS NOT NULL)",
            name="ck_prescriptions_cancellation",
        ),
        Index(
            "uq_prescriptions_active_per_encounter",
            "encounter_id",
            unique=True,
            postgresql_where=text("encounter_id IS NOT NULL AND status IN ('DRAFT', 'AUTHORISED')"),
        ),
        Index(
            "uq_prescriptions_supersedes",
            "supersedes_prescription_id",
            unique=True,
            postgresql_where=text("supersedes_prescription_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    patient_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    patient_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    patient_urn: Mapped[str | None] = mapped_column(String(32), nullable=True)
    patient_mobile: Mapped[str | None] = mapped_column(String(15), nullable=True)
    patient_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    doctor_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("doctors.id", ondelete="RESTRICT"), nullable=False
    )
    encounter_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("clinical_encounters.id", ondelete="SET NULL"), nullable=True
    )
    diagnosis: Mapped[str] = mapped_column(Text, nullable=False)
    dietary_advice: Mapped[str | None] = mapped_column(Text, nullable=True)
    general_advice: Mapped[str | None] = mapped_column(Text, nullable=True)
    follow_up_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16),
        default=PrescriptionStatus.AUTHORISED.value,
        server_default=text("'AUTHORISED'"),
        nullable=False,
    )
    revision_number: Mapped[int] = mapped_column(
        Integer, default=1, server_default=text("1"), nullable=False
    )
    supersedes_prescription_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("prescriptions.id", ondelete="RESTRICT"), nullable=True
    )
    amendment_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    authorised_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __mapper_args__ = {"version_id_col": version_id}

    patient = relationship("Patient", lazy="joined")
    doctor = relationship("Doctor", lazy="joined")
    encounter = relationship("ClinicalEncounter", foreign_keys=[encounter_id], lazy="select")
    cancelled_by_user = relationship("User", foreign_keys=[cancelled_by_user_id], lazy="joined")
    items = relationship(
        "PrescriptionItem",
        back_populates="prescription",
        cascade="all, delete-orphan",
        order_by="PrescriptionItem.item_order",
    )


class PrescriptionItem(Base):
    """Individual itemized medication line on a prescription (RX-01)."""

    __tablename__ = "prescription_items"
    __table_args__ = (
        UniqueConstraint("prescription_id", "item_order", name="uq_prescription_items_order"),
        Index("ix_prescription_items_prescription_id", "prescription_id"),
        CheckConstraint(
            "duration_days >= 1 AND duration_days <= 365", name="ck_prescription_items_duration"
        ),
        CheckConstraint("length(trim(medicine_name)) >= 1", name="ck_prescription_items_medicine"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    prescription_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("prescriptions.id", ondelete="CASCADE"), nullable=False
    )
    item_order: Mapped[int] = mapped_column(Integer, nullable=False)
    medicine_name: Mapped[str] = mapped_column(String(128), nullable=False)
    dosage: Mapped[str] = mapped_column(String(64), nullable=False)
    frequency: Mapped[str] = mapped_column(String(64), nullable=False)
    duration_days: Mapped[int] = mapped_column(Integer, nullable=False)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    strength: Mapped[str | None] = mapped_column(String(64), nullable=True)
    form: Mapped[str | None] = mapped_column(String(32), nullable=True)
    route: Mapped[str | None] = mapped_column(String(32), nullable=True)

    prescription = relationship("Prescription", back_populates="items")


class PaymentMethod(StrEnum):
    """Payment methods supported at Reception desk (BIL-01)."""

    CASH = "CASH"
    UPI = "UPI"
    CARD = "CARD"


class ReceiptSequence(Base):
    """Atomic sequence counter for sequential receipt numbering (BIL-04)."""

    __tablename__ = "receipt_sequences"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    cycle_key: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    last_number: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Payment(Base):
    """Financial transaction ledger for fees and package instalments (BIL-01, BIL-02, BIL-05)."""

    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint("id", "patient_id", name="uq_payments_id_patient"),
        Index("ix_payments_receipt_number", "receipt_number"),
        Index("ix_payments_patient_id", "patient_id"),
        Index("ix_payments_treatment_plan_id", "treatment_plan_id"),
        Index("ix_payments_appointment_id", "appointment_id"),
        Index("ix_payments_visit_id", "visit_id"),
        Index("ix_payments_is_reversed", "is_reversed"),
        CheckConstraint("amount_paise > 0", name="ck_payments_amount_positive"),
        CheckConstraint(
            "payment_method IN ('CASH', 'UPI', 'CARD')",
            name="ck_payments_payment_method",
        ),
        CheckConstraint(
            "(is_reversed = FALSE AND reversal_reason IS NULL AND "
            "reversed_by_user_id IS NULL AND reversed_at IS NULL) "
            "OR (is_reversed = TRUE AND reversal_reason IS NOT NULL AND "
            "length(trim(reversal_reason)) >= 5 AND "
            "reversed_by_user_id IS NOT NULL AND reversed_at IS NOT NULL)",
            name="ck_payments_reversal_integrity",
        ),
        CheckConstraint(
            "visit_id IS NULL OR (treatment_plan_id IS NULL AND appointment_id IS NULL)",
            name="single_target",
        ),
        # FB-04 / SEC-03: payments must belong to the treatment plan / appointment's patient
        ForeignKeyConstraint(
            ["treatment_plan_id", "patient_id"],
            ["treatment_plans.id", "treatment_plans.patient_id"],
            name="fk_payments_treatment_plan_patient",
            ondelete="SET NULL (treatment_plan_id)",
        ),
        ForeignKeyConstraint(
            ["appointment_id", "patient_id"],
            ["appointments.id", "appointments.patient_id"],
            name="fk_payments_appointment_patient",
            ondelete="SET NULL (appointment_id)",
        ),
        ForeignKeyConstraint(
            ["visit_id", "patient_id"],
            ["visits.id", "visits.patient_id"],
            name="fk_payments_visit_patient",
            ondelete="RESTRICT",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    receipt_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    patient_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    patient_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    patient_urn: Mapped[str | None] = mapped_column(String(32), nullable=True)
    patient_mobile: Mapped[str | None] = mapped_column(String(15), nullable=True)
    patient_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    treatment_plan_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("treatment_plans.id", ondelete="RESTRICT"), nullable=True
    )
    appointment_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True
    )
    visit_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    payment_method: Mapped[str] = mapped_column(String(16), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_reversed: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    reversal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reversed_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    patient = relationship("Patient", lazy="joined")
    treatment_plan = relationship("TreatmentPlan", foreign_keys=[treatment_plan_id], lazy="joined")
    appointment = relationship("Appointment", foreign_keys=[appointment_id], lazy="select")
    created_by_user = relationship("User", foreign_keys=[created_by_user_id], lazy="joined")
    reversed_by_user = relationship("User", foreign_keys=[reversed_by_user_id], lazy="joined")


class LedgerEntryType(StrEnum):
    """Event types recorded in the immutable financial ledger (migration 0036)."""

    CHARGE = "CHARGE"
    CHARGE_ADJUSTMENT = "CHARGE_ADJUSTMENT"
    CHARGE_VOID = "CHARGE_VOID"
    PACKAGE_CHARGE = "PACKAGE_CHARGE"
    PACKAGE_ADJUSTMENT = "PACKAGE_ADJUSTMENT"
    LEGACY_CHARGE = "LEGACY_CHARGE"
    PAYMENT = "PAYMENT"
    PAYMENT_REVERSAL = "PAYMENT_REVERSAL"
    REFUND = "REFUND"


class LedgerDirection(StrEnum):
    """Signed direction of a financial ledger entry (DEBIT = +payable, CREDIT = -payable)."""

    DEBIT = "DEBIT"
    CREDIT = "CREDIT"


class LedgerReferenceType(StrEnum):
    """Source entity type referenced by a financial ledger entry."""

    BILL_ITEM = "BILL_ITEM"
    BILL_ITEM_ADJUSTMENT = "BILL_ITEM_ADJUSTMENT"
    TREATMENT_PLAN = "TREATMENT_PLAN"
    APPOINTMENT = "APPOINTMENT"
    PAYMENT = "PAYMENT"
    REFUND = "REFUND"


class RefundSequence(Base):
    """Financial-year scoped atomic sequence counter for refund numbers (RFN-FY-NNNNNN)."""

    __tablename__ = "refund_sequences"

    cycle_key: Mapped[str] = mapped_column(String(16), primary_key=True)
    last_number: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)


class Refund(Base):
    """Immutable Admin-only partial or full refund against a posted payment (D-06)."""

    __tablename__ = "refunds"
    __table_args__ = (
        UniqueConstraint("refund_number", name="uq_refunds_refund_number"),
        ForeignKeyConstraint(
            ["payment_id", "patient_id"],
            ["payments.id", "payments.patient_id"],
            name="fk_refunds_payment_patient",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["visit_id", "patient_id"],
            ["visits.id", "visits.patient_id"],
            name="fk_refunds_visit_patient",
            ondelete="RESTRICT",
        ),
        CheckConstraint("amount_paise > 0", name="amount_positive"),
        CheckConstraint("refund_method IN ('CASH', 'UPI', 'CARD')", name="method_valid"),
        CheckConstraint("length(trim(reason)) >= 5", name="reason_min_len"),
        Index("ix_refunds_payment_id", "payment_id"),
        Index("ix_refunds_patient_id", "patient_id"),
        Index("ix_refunds_visit_id", "visit_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    refund_number: Mapped[str] = mapped_column(String(32), nullable=False)
    payment_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    patient_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    visit_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    refund_method: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    refunded_by_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    payment = relationship(
        "Payment",
        primaryjoin="Refund.payment_id == Payment.id",
        foreign_keys=[payment_id],
        viewonly=True,
        lazy="select",
    )
    refunded_by_user = relationship("User", foreign_keys=[refunded_by_user_id], lazy="joined")


class LedgerEntry(Base):
    """Append-only financial ledger entry tracking charges, payments, reversals, and refunds."""

    __tablename__ = "ledger_entries"
    __table_args__ = (
        ForeignKeyConstraint(
            ["visit_id", "patient_id"],
            ["visits.id", "visits.patient_id"],
            name="fk_ledger_entries_visit_patient",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "entry_type IN ("
            "'CHARGE', 'CHARGE_ADJUSTMENT', 'CHARGE_VOID', "
            "'PACKAGE_CHARGE', 'PACKAGE_ADJUSTMENT', 'LEGACY_CHARGE', "
            "'PAYMENT', 'PAYMENT_REVERSAL', 'REFUND')",
            name="entry_type_valid",
        ),
        CheckConstraint("direction IN ('DEBIT', 'CREDIT')", name="direction_valid"),
        CheckConstraint("amount_paise > 0", name="amount_positive"),
        CheckConstraint(
            "(direction = 'DEBIT' AND signed_amount_paise = amount_paise) OR "
            "(direction = 'CREDIT' AND signed_amount_paise = -amount_paise)",
            name="signed_matches_direction",
        ),
        CheckConstraint(
            "reference_type IN ("
            "'BILL_ITEM', 'BILL_ITEM_ADJUSTMENT', 'TREATMENT_PLAN', "
            "'APPOINTMENT', 'PAYMENT', 'REFUND')",
            name="reference_type_valid",
        ),
        Index(
            "uq_ledger_ref_event",
            "reference_type",
            "reference_id",
            "entry_type",
            unique=True,
            postgresql_where=text("entry_type <> 'PACKAGE_ADJUSTMENT'"),
        ),
        Index(
            "ix_ledger_entries_patient_occurred",
            "patient_id",
            text("occurred_at DESC"),
            text("id DESC"),
        ),
        Index("ix_ledger_entries_visit", "visit_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    patient_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    visit_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    entry_type: Mapped[str] = mapped_column(String(24), nullable=False)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    signed_amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reference_type: Mapped[str] = mapped_column(String(32), nullable=False)
    reference_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    patient = relationship("Patient", foreign_keys=[patient_id], lazy="select")
    actor_user = relationship("User", foreign_keys=[actor_user_id], lazy="select")


class ClinicalTemplate(Base):
    """Specialty clinical template definition."""

    __tablename__ = "clinical_templates"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    department_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("departments.id", ondelete="RESTRICT"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name_en: Mapped[str] = mapped_column(String(128), nullable=False)
    name_hi: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    department: Mapped["Department"] = relationship("Department", back_populates="templates")
    versions: Mapped[list["ClinicalTemplateVersion"]] = relationship(
        "ClinicalTemplateVersion", back_populates="template", cascade="all, delete-orphan"
    )


class ClinicalTemplateVersion(Base):
    """Versioned schema definition for a specialty clinical template."""

    __tablename__ = "clinical_template_versions"
    __table_args__ = (
        UniqueConstraint("template_id", "version_number", name="uq_template_version"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    template_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("clinical_templates.id", ondelete="CASCADE"), nullable=False
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    schema_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    approved_by: Mapped[str] = mapped_column(String(128), nullable=False)
    approved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    template: Mapped["ClinicalTemplate"] = relationship(
        "ClinicalTemplate", back_populates="versions"
    )
    responses: Mapped[list["ClinicalTemplateResponse"]] = relationship(
        "ClinicalTemplateResponse", back_populates="template_version"
    )


class ClinicalTemplateResponse(Base):
    """Encounter-specific specialty template response data."""

    __tablename__ = "clinical_template_responses"
    __table_args__ = (UniqueConstraint("encounter_id", name="uq_template_responses_encounter"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    encounter_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("clinical_encounters.id", ondelete="CASCADE"), nullable=False
    )
    template_version_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("clinical_template_versions.id", ondelete="RESTRICT"), nullable=False
    )
    response_data: Mapped[dict] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    encounter: Mapped["ClinicalEncounter"] = relationship(
        "ClinicalEncounter", back_populates="template_response"
    )
    template_version: Mapped["ClinicalTemplateVersion"] = relationship(
        "ClinicalTemplateVersion", back_populates="responses"
    )


class VitalObservation(Base):
    """Vital observations and biometrics recorded for an encounter."""

    __tablename__ = "vital_observations"
    __table_args__ = (
        UniqueConstraint("encounter_id", name="uq_vital_observations_encounter"),
        CheckConstraint(
            "height_cm IS NULL OR (height_cm > 20 AND height_cm < 280)",
            name="ck_vital_observations_height_cm",
        ),
        CheckConstraint(
            "weight_kg IS NULL OR (weight_kg > 1 AND weight_kg < 400)",
            name="ck_vital_observations_weight_kg",
        ),
        CheckConstraint(
            "bmi IS NULL OR (bmi >= 5 AND bmi <= 100)",
            name="ck_vital_observations_bmi",
        ),
        CheckConstraint(
            "systolic_bp IS NULL OR (systolic_bp >= 40 AND systolic_bp <= 300)",
            name="ck_vital_observations_systolic_bp",
        ),
        CheckConstraint(
            "diastolic_bp IS NULL OR (diastolic_bp >= 20 AND diastolic_bp <= 200)",
            name="ck_vital_observations_diastolic_bp",
        ),
        CheckConstraint(
            "pulse_bpm IS NULL OR (pulse_bpm >= 30 AND pulse_bpm <= 260)",
            name="ck_vital_observations_pulse_bpm",
        ),
        CheckConstraint(
            "temperature_f IS NULL OR (temperature_f >= 85 AND temperature_f <= 110)",
            name="ck_vital_observations_temperature_f",
        ),
        CheckConstraint(
            "respiratory_rate IS NULL OR (respiratory_rate >= 5 AND respiratory_rate <= 80)",
            name="ck_vital_observations_respiratory_rate",
        ),
        CheckConstraint(
            "spo2_percent IS NULL OR (spo2_percent >= 40 AND spo2_percent <= 100)",
            name="ck_vital_observations_spo2_percent",
        ),
        # FB-04 / SEC-03: vitals must belong to the encounter's patient
        ForeignKeyConstraint(
            ["encounter_id", "patient_id"],
            ["clinical_encounters.id", "clinical_encounters.patient_id"],
            name="fk_vital_observations_encounter_patient",
            ondelete="CASCADE",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    encounter_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("clinical_encounters.id", ondelete="CASCADE"), nullable=False
    )
    patient_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    height_cm: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    bmi: Mapped[float | None] = mapped_column(Numeric(4, 1), nullable=True)
    systolic_bp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    diastolic_bp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pulse_bpm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    temperature_f: Mapped[float | None] = mapped_column(Numeric(4, 1), nullable=True)
    respiratory_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spo2_percent: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    encounter: Mapped["ClinicalEncounter"] = relationship(
        "ClinicalEncounter", back_populates="vitals", foreign_keys=[encounter_id]
    )
    patient: Mapped["Patient"] = relationship("Patient")


class FollowUpStatus(StrEnum):
    """Lifecycle statuses for follow-up recommendations (DWS-08)."""

    PENDING = "PENDING"
    BOOKED = "BOOKED"
    CLOSED = "CLOSED"


class FollowUpRecommendation(Base):
    """Clinical follow-up recommendation linked to encounter and patient (DWS-08)."""

    __tablename__ = "follow_up_recommendations"
    __table_args__ = (
        UniqueConstraint("encounter_id", name="uq_follow_up_encounter"),
        Index("ix_follow_up_status_date", "status", "recommended_date"),
        Index("ix_follow_up_patient", "patient_id"),
        CheckConstraint(
            "status IN ('PENDING', 'BOOKED', 'CLOSED')",
            name="ck_follow_up_recommendations_status",
        ),
        CheckConstraint(
            "(status != 'CLOSED' AND closed_reason IS NULL AND closed_by_user_id IS NULL AND "
            "closed_at IS NULL) "
            "OR (status = 'CLOSED' AND closed_reason IS NOT NULL AND length(trim(closed_reason)) "
            ">= 3 AND closed_by_user_id IS NOT NULL AND closed_at IS NOT NULL)",
            name="ck_follow_up_recommendations_closure",
        ),
        # FB-04 / SEC-03: follow-up recommendation must belong to the encounter's patient
        ForeignKeyConstraint(
            ["encounter_id", "patient_id"],
            ["clinical_encounters.id", "clinical_encounters.patient_id"],
            name="fk_follow_up_recommendations_encounter_patient",
            ondelete="CASCADE",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    encounter_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("clinical_encounters.id", ondelete="CASCADE"), nullable=False
    )
    patient_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    doctor_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("doctors.id", ondelete="RESTRICT"), nullable=False
    )
    recommended_doctor_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("doctors.id", ondelete="RESTRICT"), nullable=False
    )
    recommended_date: Mapped[date] = mapped_column(Date, nullable=False)
    clinical_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16),
        default=FollowUpStatus.PENDING.value,
        server_default=text("'PENDING'"),
        nullable=False,
    )
    booked_appointment_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True
    )
    closed_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    closed_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __mapper_args__ = {"version_id_col": version_id}

    encounter = relationship(
        "ClinicalEncounter", back_populates="follow_up_recommendation", foreign_keys=[encounter_id]
    )
    patient = relationship("Patient", lazy="joined")
    doctor = relationship("Doctor", foreign_keys=[doctor_id], lazy="joined")
    recommended_doctor = relationship("Doctor", foreign_keys=[recommended_doctor_id], lazy="joined")
    booked_appointment = relationship(
        "Appointment", foreign_keys=[booked_appointment_id], lazy="select"
    )
    closed_by_user = relationship("User", foreign_keys=[closed_by_user_id], lazy="joined")


class AssetType(StrEnum):
    """Supported asset types for hospital identity and documentation."""

    LOGO = "LOGO"
    PHOTO = "PHOTO"
    REGISTRATION_DOC = "REGISTRATION_DOC"


class HospitalAsset(Base):
    """Hospital identity, registration, and facility assets (SET-01, D-20-01).

    Historical asset versions are never deleted from disk or database,
    ensuring historical issued documents retain valid references.
    """

    __tablename__ = "hospital_assets"
    __table_args__ = (
        UniqueConstraint("filename", name="uq_hospital_assets_filename"),
        CheckConstraint(
            "asset_type IN ('LOGO', 'PHOTO', 'REGISTRATION_DOC')",
            name="ck_hospital_assets_asset_type",
        ),
        Index("ix_hospital_assets_asset_type_active", "asset_type", "is_active"),
        Index("ix_hospital_assets_uploaded_by", "uploaded_by_user_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    asset_type: Mapped[str] = mapped_column(String(32), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    version: Mapped[int] = mapped_column(
        Integer, default=1, server_default=text("1"), nullable=False
    )
    uploaded_by_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    uploaded_by_user = relationship("User", foreign_keys=[uploaded_by_user_id], lazy="joined")


class PrintDocumentType(StrEnum):
    """Supported print document types for bilingual print templates."""

    PRESCRIPTION = "prescription"
    RECEIPT = "receipt"
    REGISTRATION_CARD = "registration_card"
    CONSULTATION_SUMMARY = "consultation_summary"


class PrintTemplate(Base):
    """Bilingual print template configuration per document type (SET-01, BIL-04, D-20-04)."""

    __tablename__ = "print_templates"
    __table_args__ = (
        UniqueConstraint("document_type", name="uq_print_templates_document_type"),
        CheckConstraint(
            "document_type IN ('prescription', 'receipt', 'registration_card', "
            "'consultation_summary')",
            name="ck_print_templates_document_type",
        ),
        Index("ix_print_templates_updated_by", "updated_by_user_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    document_type: Mapped[str] = mapped_column(String(32), nullable=False)
    header_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    header_hi: Mapped[str | None] = mapped_column(Text, nullable=True)
    footer_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    footer_hi: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(
        Integer, default=1, server_default=text("1"), nullable=False
    )
    updated_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __mapper_args__ = {"version_id_col": version}

    updated_by_user = relationship("User", foreign_keys=[updated_by_user_id], lazy="joined")


class PatientImportBatch(Base):
    """Patient spreadsheet import batch metadata and staging lifecycle (D-20-08, D-20-14)."""

    __tablename__ = "patient_import_batches"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    total_rows: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    valid_rows: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    duplicate_rows: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    invalid_rows: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    committed_rows: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(32), default="STAGED", server_default=text("'STAGED'"), nullable=False
    )
    column_mapping: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    safety_backup_file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by_user = relationship("User", foreign_keys=[created_by_user_id], lazy="select")
    rows: Mapped[list["PatientImportRow"]] = relationship(
        "PatientImportRow",
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="PatientImportRow.row_index",
    )


class PatientImportRow(Base):
    """Individual staged row for spreadsheet import (D-20-10, D-20-11, D-20-13)."""

    __tablename__ = "patient_import_rows"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    batch_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("patient_import_batches.batch_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    row_index: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    mapped_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    validation_status: Mapped[str] = mapped_column(
        String(32), default="PENDING", server_default=text("'PENDING'"), nullable=False
    )
    validation_errors: Mapped[dict | list | None] = mapped_column(JSONB, nullable=True)
    duplicate_patient_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("patients.id", ondelete="SET NULL"), nullable=True, index=True
    )
    duplicate_resolution: Mapped[str | None] = mapped_column(String(32), nullable=True)
    allocated_urn: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    batch: Mapped["PatientImportBatch"] = relationship("PatientImportBatch", back_populates="rows")
    duplicate_patient: Mapped["Patient | None"] = relationship(
        "Patient", foreign_keys=[duplicate_patient_id], lazy="select"
    )


class IntegrityRun(Base):
    """One run of the data integrity check, with its full result (BAK-03).

    Opening the Data Integrity page reads the latest run; only an explicit run adds a row.
    Rows are never updated.
    """

    __tablename__ = "integrity_runs"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    run_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    run_by_username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    is_healthy: Mapped[bool] = mapped_column(Boolean, nullable=False)
    total_checks: Mapped[int] = mapped_column(Integer, nullable=False)
    passed_checks: Mapped[int] = mapped_column(Integer, nullable=False)
    failed_checks: Mapped[int] = mapped_column(Integer, nullable=False)
    warning_checks: Mapped[int] = mapped_column(Integer, nullable=False)
    cleanup_checks: Mapped[int] = mapped_column(Integer, nullable=False)
    checks: Mapped[list] = mapped_column(JSONB, nullable=False)

    __table_args__ = (Index("ix_integrity_runs_generated_at", "generated_at"),)


class Workstation(Base):
    """LAN terminal workstation registry and heartbeat status (Phase 23)."""

    __tablename__ = "workstations"
    __table_args__ = (
        Index("ix_workstations_hostname", "hostname"),
        Index("ix_workstations_last_seen_at", "last_seen_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    hostname: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    ip_address: Mapped[str] = mapped_column(String(64), nullable=False)
    terminal_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    app_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    last_username: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class IdempotencyKey(Base):
    """Short-lived (24h TTL) request idempotency cache for reception mutation endpoints."""

    __tablename__ = "idempotency_keys"
    __table_args__ = (
        UniqueConstraint(
            "actor_user_id",
            "endpoint_key",
            "idempotency_key",
            name="uq_idempotency_keys_scope",
        ),
        Index("ix_idempotency_keys_expires_at", "expires_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    actor_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    endpoint_key: Mapped[str] = mapped_column(String(128), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_status: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    response_body: Mapped[dict] = mapped_column(JSONB(astext_type=Text()), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class QuickPhraseScope(StrEnum):
    """Ownership scope for clinical quick phrases."""

    PERSONAL = "PERSONAL"
    HOSPITAL_DEFAULT = "HOSPITAL_DEFAULT"


class QuickPhraseSection(StrEnum):
    """Clinical encounter section where a quick phrase appears."""

    COMPLAINTS = "COMPLAINTS"
    EXAMINATION = "EXAMINATION"
    DIAGNOSIS = "DIAGNOSIS"
    ADVICE = "ADVICE"


class ClinicalQuickPhrase(Base):
    """Persistent clinical quick phrases (hospital defaults + per-doctor personal phrases)."""

    __tablename__ = "clinical_quick_phrases"
    __table_args__ = (
        CheckConstraint(
            "scope IN ('PERSONAL', 'HOSPITAL_DEFAULT')",
            name="scope_valid",
        ),
        CheckConstraint(
            "section IN ('COMPLAINTS', 'EXAMINATION', 'DIAGNOSIS', 'ADVICE')",
            name="section_valid",
        ),
        CheckConstraint(
            "(scope = 'PERSONAL' AND doctor_id IS NOT NULL) "
            "OR (scope = 'HOSPITAL_DEFAULT' AND doctor_id IS NULL)",
            name="scope_doctor_consistency",
        ),
        CheckConstraint(
            "length(trim(phrase_text)) >= 2",
            name="phrase_text_nonblank",
        ),
        Index(
            "ix_clinical_quick_phrases_personal",
            "scope",
            "doctor_id",
            "section",
            "is_active",
        ),
        Index(
            "ix_clinical_quick_phrases_default",
            "scope",
            "department_code",
            "section",
            "is_active",
        ),
        Index(
            "ix_quick_phrases_default_dept",
            "department_code",
            "section",
            "phrase_text",
            unique=True,
            postgresql_where=text("scope = 'HOSPITAL_DEFAULT' AND department_code IS NOT NULL"),
        ),
        Index(
            "ix_quick_phrases_default_global",
            "section",
            "phrase_text",
            unique=True,
            postgresql_where=text("scope = 'HOSPITAL_DEFAULT' AND department_code IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    scope: Mapped[str] = mapped_column(String(24), nullable=False)
    doctor_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("doctors.id", ondelete="CASCADE"), nullable=True
    )
    department_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True
    )
    department_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    section: Mapped[str] = mapped_column(String(24), nullable=False)
    phrase_text: Mapped[str] = mapped_column(String(240), nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        onupdate=func.now(),
        nullable=False,
    )
