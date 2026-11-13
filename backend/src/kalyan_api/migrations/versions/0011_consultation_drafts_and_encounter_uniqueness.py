"""Consultation drafts, encounter uniqueness, check-in timestamp, and tamper trigger update.

Revision ID: 0011
Revises: 0007
Create Date: 2026-11-06

Requirements:
- DWS-01: Per-appointment encounter uniqueness via partial unique index.
- DWS-02: Draft consultation autosave allowing nullable/empty symptoms, clinical notes, diagnosis.
- DWS-03: Reception check-in timestamp tracking.
- DWS-04: Department reference on encounters for multi-specialty consultations.
- CLN-02: Tamper trigger preventing changes to finalised encounters.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add appointments.check_in_at
    op.add_column(
        "appointments",
        sa.Column("check_in_at", sa.DateTime(timezone=True), nullable=True),
    )

    # 2. Add clinical_encounters.department_id
    op.add_column(
        "clinical_encounters",
        sa.Column("department_id", sa.BigInteger(), nullable=True),
    )

    # 3. Partial unique index on clinical_encounters (appointment_id) WHERE appointment_id IS NOT
    # NULL
    op.create_index(
        "uq_clinical_encounters_appointment_id",
        "clinical_encounters",
        ["appointment_id"],
        unique=True,
        postgresql_where=sa.text("appointment_id IS NOT NULL"),
    )

    # 4. Alter symptoms, clinical_notes, diagnosis on clinical_encounters to allow nullable with
    # default ''
    op.alter_column(
        "clinical_encounters",
        "symptoms",
        existing_type=sa.Text(),
        nullable=True,
        server_default=sa.text("''"),
    )
    op.alter_column(
        "clinical_encounters",
        "clinical_notes",
        existing_type=sa.Text(),
        nullable=True,
        server_default=sa.text("''"),
    )
    op.alter_column(
        "clinical_encounters",
        "diagnosis",
        existing_type=sa.Text(),
        nullable=True,
        server_default=sa.text("''"),
    )

    # 5. Update PostgreSQL function fn_prevent_finalised_encounter_tampering()
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_prevent_finalised_encounter_tampering()
        RETURNS TRIGGER AS $$
        BEGIN
            IF TG_OP = 'UPDATE' THEN
                IF OLD.is_finalised = TRUE THEN
                    IF (
                        OLD.symptoms IS DISTINCT FROM NEW.symptoms OR
                        OLD.clinical_notes IS DISTINCT FROM NEW.clinical_notes OR
                        OLD.diagnosis IS DISTINCT FROM NEW.diagnosis OR
                        OLD.patient_id IS DISTINCT FROM NEW.patient_id OR
                        OLD.doctor_id IS DISTINCT FROM NEW.doctor_id OR
                        OLD.department_id IS DISTINCT FROM NEW.department_id OR
                        OLD.appointment_id IS DISTINCT FROM NEW.appointment_id
                    ) THEN
                        RAISE EXCEPTION
                            'Finalised encounter cannot be modified. Append addendum instead.';
                    END IF;
                END IF;
                RETURN NEW;
            ELSIF TG_OP = 'DELETE' THEN
                IF OLD.is_finalised = TRUE THEN
                    RAISE EXCEPTION 'Finalised clinical encounter cannot be deleted.';
                END IF;
                RETURN OLD;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )


def downgrade() -> None:
    # 1. Restore PostgreSQL function fn_prevent_finalised_encounter_tampering() to previous
    # definition
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_prevent_finalised_encounter_tampering()
        RETURNS TRIGGER AS $$
        BEGIN
            IF TG_OP = 'UPDATE' THEN
                IF OLD.is_finalised = TRUE THEN
                    IF (
                        OLD.symptoms IS DISTINCT FROM NEW.symptoms OR
                        OLD.clinical_notes IS DISTINCT FROM NEW.clinical_notes OR
                        OLD.diagnosis IS DISTINCT FROM NEW.diagnosis OR
                        OLD.patient_id IS DISTINCT FROM NEW.patient_id OR
                        OLD.doctor_id IS DISTINCT FROM NEW.doctor_id
                    ) THEN
                        RAISE EXCEPTION
                            'Finalised encounter cannot be modified. Append addendum instead.';
                    END IF;
                END IF;
                RETURN NEW;
            ELSIF TG_OP = 'DELETE' THEN
                IF OLD.is_finalised = TRUE THEN
                    RAISE EXCEPTION 'Finalised clinical encounter cannot be deleted.';
                END IF;
                RETURN OLD;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    # 2. Revert columns to NOT NULL (ensure empty strings for any NULLs first)
    op.execute("UPDATE clinical_encounters SET symptoms = '' WHERE symptoms IS NULL;")
    op.execute("UPDATE clinical_encounters SET clinical_notes = '' WHERE clinical_notes IS NULL;")
    op.execute("UPDATE clinical_encounters SET diagnosis = '' WHERE diagnosis IS NULL;")

    op.alter_column(
        "clinical_encounters",
        "diagnosis",
        existing_type=sa.Text(),
        nullable=False,
        server_default=None,
    )
    op.alter_column(
        "clinical_encounters",
        "clinical_notes",
        existing_type=sa.Text(),
        nullable=False,
        server_default=None,
    )
    op.alter_column(
        "clinical_encounters",
        "symptoms",
        existing_type=sa.Text(),
        nullable=False,
        server_default=None,
    )

    # 3. Drop partial unique index
    op.drop_index(
        "uq_clinical_encounters_appointment_id",
        table_name="clinical_encounters",
        postgresql_where=sa.text("appointment_id IS NOT NULL"),
    )

    # 4. Drop columns
    op.drop_column("clinical_encounters", "department_id")
    op.drop_column("appointments", "check_in_at")
