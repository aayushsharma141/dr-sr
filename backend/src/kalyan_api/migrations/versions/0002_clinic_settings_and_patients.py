"""Clinic settings, doctor enhancements, consultation fees, and patients schema.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-01

Requirements:
- SET-01: Clinic settings singleton (bilingual names, addresses, phone, receipt sequence cycle).
- SET-02: Doctor profiles with Hindi names, qualifications, and registration numbers.
- SET-03: Consultation fees schedule in integer paise.
- PAT-01: Canonical 12 demographic fields and atomic URN counter.
- D-08: version_id on mutable tables (clinic_settings, patients).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Table: clinic_settings (singleton table id=1)
    op.create_table(
        "clinic_settings",
        sa.Column("id", sa.BigInteger(), primary_key=True, default=1),
        sa.Column(
            "name_en",
            sa.String(length=120),
            server_default=sa.text("'Kalyan Hospital'"),
            nullable=False,
        ),
        sa.Column(
            "name_hi",
            sa.String(length=120),
            server_default=sa.text("'कल्याण हॉस्पिटल'"),
            nullable=False,
        ),
        sa.Column("address_1", sa.String(length=255), nullable=False),
        sa.Column("address_2", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=64), nullable=False),
        sa.Column("email", sa.String(length=120), nullable=True),
        sa.Column(
            "receipt_sequence_cycle",
            sa.String(length=16),
            server_default=sa.text("'FINANCIAL_YEAR'"),
            nullable=False,
        ),
        sa.Column("print_header_en", sa.Text(), nullable=True),
        sa.Column("print_header_hi", sa.Text(), nullable=True),
        sa.Column("print_footer_en", sa.Text(), nullable=True),
        sa.Column("print_footer_hi", sa.Text(), nullable=True),
        sa.Column(
            "consultation_validity_days",
            sa.Integer(),
            server_default=sa.text("7"),
            nullable=False,
        ),
        sa.Column(
            "version_id",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_clinic_settings"),
        sa.CheckConstraint("id = 1", name="ck_clinic_settings_singleton"),
        sa.CheckConstraint(
            "receipt_sequence_cycle IN ('FINANCIAL_YEAR', 'CALENDAR_YEAR')",
            name="ck_clinic_settings_receipt_cycle_valid",
        ),
    )

    # Seed initial default clinic settings row
    op.execute("""
    INSERT INTO clinic_settings (
        id, name_en, name_hi, address_1, address_2, phone, receipt_sequence_cycle
    ) VALUES (
        1,
        'Kalyan Hospital',
        'कल्याण हॉस्पिटल',
        'Hospital Road, Ara, Bhojpur, Bihar - 802301',
        NULL,
        '+91 6182 000000',
        'FINANCIAL_YEAR'
    ) ON CONFLICT (id) DO NOTHING;
    """)

    # 2. Add columns to doctors
    op.add_column("doctors", sa.Column("name_hi", sa.String(length=120), nullable=True))
    op.add_column("doctors", sa.Column("qualification", sa.String(length=120), nullable=True))
    op.add_column("doctors", sa.Column("registration_number", sa.String(length=64), nullable=True))
    op.add_column(
        "doctors",
        sa.Column("default_fee_paise", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )

    # 3. Table: consultation_fees
    op.create_table(
        "consultation_fees",
        sa.Column(
            "id", sa.BigInteger(), sa.Identity(always=False), nullable=False, primary_key=True
        ),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("fee_paise", sa.Integer(), nullable=False),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_consultation_fees"),
        sa.CheckConstraint("fee_paise >= 0", name="ck_consultation_fees_fee_non_negative"),
    )

    # 4. Table: urn_sequences (atomic year-scoped counter)
    op.create_table(
        "urn_sequences",
        sa.Column("year", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "last_seq", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.PrimaryKeyConstraint("year", name="pk_urn_sequences"),
    )

    # 5. Table: patients (12 canonical demographic fields)
    op.create_table(
        "patients",
        sa.Column(
            "id", sa.BigInteger(), sa.Identity(always=False), nullable=False, primary_key=True
        ),
        sa.Column("urn", sa.String(length=32), nullable=False),
        sa.Column("full_name", sa.String(length=120), nullable=False),
        sa.Column("guardian_name", sa.String(length=120), nullable=False),
        sa.Column("gender", sa.String(length=1), nullable=False),
        sa.Column("dob", sa.Date(), nullable=True),
        sa.Column("age_years", sa.Integer(), nullable=False),
        sa.Column("mobile", sa.String(length=15), nullable=False),
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column(
            "district",
            sa.String(length=64),
            server_default=sa.text("'Bhojpur'"),
            nullable=False,
        ),
        sa.Column(
            "state",
            sa.String(length=64),
            server_default=sa.text("'Bihar'"),
            nullable=False,
        ),
        sa.Column("emergency_contact", sa.String(length=120), nullable=True),
        sa.Column(
            "allergies",
            sa.Text(),
            server_default=sa.text("'None reported'"),
            nullable=False,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("photo_path", sa.String(length=255), nullable=True),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "version_id", sa.Integer(), server_default=sa.text("1"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_patients"),
        sa.UniqueConstraint("urn", name="uq_patients_urn"),
        sa.CheckConstraint("gender IN ('M', 'F', 'O')", name="ck_patients_gender_valid"),
        sa.CheckConstraint(
            "age_years >= 0 AND age_years <= 150", name="ck_patients_age_valid"
        ),
    )

    op.create_index("ix_patients_urn", "patients", ["urn"])
    op.create_index("ix_patients_mobile", "patients", ["mobile"])
    op.create_index("ix_patients_full_name", "patients", ["full_name"])

    # 6. Permissions for kalyan_app role
    op.execute("GRANT SELECT, INSERT, UPDATE ON clinic_settings TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE ON consultation_fees TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE ON urn_sequences TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE ON patients TO kalyan_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    # Revoke role grants
    op.execute("REVOKE SELECT, INSERT, UPDATE ON patients FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT, UPDATE ON urn_sequences FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT, UPDATE ON consultation_fees FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT, UPDATE ON clinic_settings FROM kalyan_app;")

    # Drop tables
    op.drop_index("ix_patients_full_name", table_name="patients")
    op.drop_index("ix_patients_mobile", table_name="patients")
    op.drop_index("ix_patients_urn", table_name="patients")
    op.drop_table("patients")
    op.drop_table("urn_sequences")
    op.drop_table("consultation_fees")

    # Drop columns from doctors
    op.drop_column("doctors", "default_fee_paise")
    op.drop_column("doctors", "registration_number")
    op.drop_column("doctors", "qualification")
    op.drop_column("doctors", "name_hi")

    op.drop_table("clinic_settings")
