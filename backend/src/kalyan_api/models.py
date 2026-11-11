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
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
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
        Index("ix_patients_urn", "urn"),
        Index("ix_patients_mobile", "mobile"),
        Index("ix_patients_full_name", "full_name"),
        Index("ix_patients_legacy_urn", "legacy_urn"),
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
    allergies: Mapped[str] = mapped_column(
        Text, default="None reported", server_default="None reported", nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
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


class AppointmentStatus(StrEnum):
    """Appointment workflow status (APT-02)."""

    BOOKED = "BOOKED"
    ARRIVED = "ARRIVED"
    IN_CONSULTATION = "IN_CONSULTATION"
    DONE = "DONE"
    CANCELLED = "CANCELLED"
    NO_SHOW = "NO_SHOW"


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
        Index("ix_appointments_doctor_date_status", "doctor_id", "appointment_date", "status"),
        Index("ix_appointments_patient_date", "patient_id", "appointment_date"),
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
    token_number: Mapped[int] = mapped_column(Integer, nullable=False)
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
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    created_by_user = relationship("User", lazy="joined")


class ClinicalEncounter(Base):
    """Clinical encounter recorded by doctor; locked once finalised (CLN-01, CLN-02)."""

    __tablename__ = "clinical_encounters"
    __table_args__ = (
        Index("ix_encounters_patient_id", "patient_id"),
        Index("ix_encounters_doctor_id", "doctor_id"),
        Index("ix_encounters_encounter_date", "encounter_date"),
        Index("ix_encounters_appointment_id", "appointment_id"),
        Index(
            "uq_clinical_encounters_appointment_id",
            "appointment_id",
            unique=True,
            postgresql_where=text("appointment_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
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
    appointment = relationship("Appointment", lazy="select")
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
    )
    follow_up_recommendation = relationship(
        "FollowUpRecommendation",
        back_populates="encounter",
        uselist=False,
        cascade="all, delete-orphan",
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
    encounter = relationship("ClinicalEncounter", lazy="select")
    sessions = relationship(
        "TreatmentSession",
        back_populates="treatment_plan",
        cascade="all, delete-orphan",
        order_by="TreatmentSession.session_number",
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

    treatment_plan = relationship("TreatmentPlan", back_populates="sessions")
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
    CANCELLED = "CANCELLED"


class Prescription(Base):
    """Doctor medical prescription record (RX-01, DWS-07)."""

    __tablename__ = "prescriptions"
    __table_args__ = (
        Index("ix_prescriptions_patient_id", "patient_id"),
        Index("ix_prescriptions_doctor_id", "doctor_id"),
        Index("ix_prescriptions_encounter_id", "encounter_id"),
        CheckConstraint("length(trim(diagnosis)) >= 2", name="ck_prescriptions_diagnosis"),
        CheckConstraint(
            "status IN ('DRAFT', 'AUTHORISED', 'CANCELLED')", name="ck_prescriptions_status"
        ),
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
    encounter = relationship("ClinicalEncounter", lazy="select")
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
        Index("ix_payments_receipt_number", "receipt_number"),
        Index("ix_payments_patient_id", "patient_id"),
        Index("ix_payments_treatment_plan_id", "treatment_plan_id"),
        Index("ix_payments_appointment_id", "appointment_id"),
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
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
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
    treatment_plan = relationship("TreatmentPlan", lazy="joined")
    appointment = relationship("Appointment", lazy="select")
    created_by_user = relationship("User", foreign_keys=[created_by_user_id], lazy="joined")
    reversed_by_user = relationship("User", foreign_keys=[reversed_by_user_id], lazy="joined")


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
        "ClinicalEncounter", back_populates="vitals"
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

    encounter = relationship("ClinicalEncounter", back_populates="follow_up_recommendation")
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
