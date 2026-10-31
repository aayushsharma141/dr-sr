"""SQLAlchemy declarative models with strict naming conventions.

Locked decisions:
- D-03: Doctor silo partitioning via users.doctor_id FK to doctors.
- D-08: version_id on mutable tables (doctors, users).
- SEC-03: Role limited to ADMIN, RECEPTION, DOCTOR; doctor_id NOT NULL iff role is DOCTOR.
- SEC-07: Singleton system_setup row with id=1.
- AUD-01: Audit log schema.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    MetaData,
    SmallInteger,
    String,
    Text,
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


class Doctor(Base):
    """Doctor profile entity (SET-02) referenced by users and clinical encounters."""

    __tablename__ = "doctors"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    name_hi: Mapped[str | None] = mapped_column(String(120), nullable=True)
    qualification: Mapped[str | None] = mapped_column(String(120), nullable=True)
    registration_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    default_fee_paise: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    version_id: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
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

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="doctor", uselist=False)

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
    locked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
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
    version_id: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )

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
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="sessions")


class LoginThrottle(Base):
    """IP-based login failure tracking for rate-limiting bursts."""

    __tablename__ = "login_throttle"

    ip: Mapped[str] = mapped_column(INET, primary_key=True)
    window_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    attempt_count: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )


class SystemSetup(Base):
    """Authoritative singleton record of first-run setup completion (SEC-07)."""

    __tablename__ = "system_setup"
    __table_args__ = (
        CheckConstraint("id = 1", name="system_setup_single_row"),
    )

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
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
    version_id: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
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

    __mapper_args__ = {"version_id_col": version_id}


class ConsultationFee(Base):
    """Configurable consultation fee schedule stored as integer paise (SET-03)."""

    __tablename__ = "consultation_fees"
    __table_args__ = (
        CheckConstraint("fee_paise >= 0", name="consultation_fees_fee_non_negative"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    fee_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
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
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    urn: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
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
    version_id: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
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

    __mapper_args__ = {"version_id_col": version_id}

