"""Appointments and clinical encounters schema with finalised note immutability trigger.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-01

Requirements:
- APT-01: Per-doctor daily appointment booking with atomic daily token counter.
- APT-02: Appointment status progression and doctor consultation queues.
- CLN-01: Clinical encounters recorded by doctor (D-03 doctor silo, D-04 reception default-deny).
- CLN-02: Finalised note immutability with PostgreSQL trigger and dated clinical addenda.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Table: daily_token_sequences
    op.create_table(
        "daily_token_sequences",
        sa.Column(
            "doctor_id",
            sa.BigInteger(),
            sa.ForeignKey("doctors.id", ondelete="RESTRICT"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("appointment_date", sa.Date(), primary_key=True, nullable=False),
        sa.Column("last_token", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # 2. Table: appointments
    op.create_table(
        "appointments",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "patient_id",
            sa.BigInteger(),
            sa.ForeignKey("patients.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "doctor_id",
            sa.BigInteger(),
            sa.ForeignKey("doctors.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("appointment_date", sa.Date(), nullable=False),
        sa.Column("token_number", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=32),
            server_default=sa.text("'BOOKED'"),
            nullable=False,
        ),
        sa.Column(
            "status_updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("cancellation_reason", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("version_id", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "doctor_id",
            "appointment_date",
            "token_number",
            name="uq_appointments_doctor_date_token",
        ),
    )
    op.create_index(
        "ix_appointments_doctor_date_status",
        "appointments",
        ["doctor_id", "appointment_date", "status"],
    )
    op.create_index(
        "ix_appointments_patient_date",
        "appointments",
        ["patient_id", "appointment_date"],
    )
    op.create_index("ix_appointments_patient_id", "appointments", ["patient_id"])
    op.create_index("ix_appointments_doctor_id", "appointments", ["doctor_id"])
    op.create_index("ix_appointments_appointment_date", "appointments", ["appointment_date"])

    # 3. Table: clinical_encounters
    op.create_table(
        "clinical_encounters",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "appointment_id",
            sa.BigInteger(),
            sa.ForeignKey("appointments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "patient_id",
            sa.BigInteger(),
            sa.ForeignKey("patients.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "doctor_id",
            sa.BigInteger(),
            sa.ForeignKey("doctors.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "encounter_date",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("symptoms", sa.Text(), nullable=False),
        sa.Column("clinical_notes", sa.Text(), nullable=False),
        sa.Column("diagnosis", sa.Text(), nullable=False),
        sa.Column(
            "is_finalised",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("finalised_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("version_id", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_encounters_patient_id", "clinical_encounters", ["patient_id"])
    op.create_index("ix_encounters_doctor_id", "clinical_encounters", ["doctor_id"])
    op.create_index("ix_encounters_encounter_date", "clinical_encounters", ["encounter_date"])
    op.create_index("ix_encounters_appointment_id", "clinical_encounters", ["appointment_id"])

    # 4. Table: clinical_addenda
    op.create_table(
        "clinical_addenda",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "encounter_id",
            sa.BigInteger(),
            sa.ForeignKey("clinical_encounters.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "doctor_id",
            sa.BigInteger(),
            sa.ForeignKey("doctors.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("addendum_text", sa.Text(), nullable=False),
        sa.Column(
            "created_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_clinical_addenda_encounter_id",
        "clinical_addenda",
        ["encounter_id"],
    )

    # 5. Database-level immutability trigger for finalised clinical encounters
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
    op.execute(
        """
        CREATE TRIGGER trg_prevent_finalised_encounter_tampering
        BEFORE UPDATE OR DELETE ON clinical_encounters
        FOR EACH ROW
        EXECUTE FUNCTION fn_prevent_finalised_encounter_tampering();
        """
    )

    # 6. Permissions for kalyan_app role
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON daily_token_sequences TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON appointments TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON clinical_encounters TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON clinical_addenda TO kalyan_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    # Revoke role grants
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON clinical_addenda FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON clinical_encounters FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON appointments FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON daily_token_sequences FROM kalyan_app;")

    op.execute(
        "DROP TRIGGER IF EXISTS trg_prevent_finalised_encounter_tampering ON clinical_encounters;"
    )
    op.execute("DROP FUNCTION IF EXISTS fn_prevent_finalised_encounter_tampering();")

    op.drop_table("clinical_addenda")
    op.drop_table("clinical_encounters")
    op.drop_table("appointments")
    op.drop_table("daily_token_sequences")
