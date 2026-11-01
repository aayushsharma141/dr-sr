"""Prescriptions, treatment plans, and physiotherapy sessions schema.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-01

Requirements:
- RX-01: Structured prescription engine linked to patient and doctor.
- TRT-01: Treatment plans/packages schema with condition, sessions, and agreed fee.
- TRT-02: Physiotherapy sessions schema with sequential numbering and VAS (0-10).
- TRT-03: Finalised session immutability via database trigger and chronological addenda.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Table: treatment_plans
    op.create_table(
        "treatment_plans",
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
        sa.Column(
            "encounter_id",
            sa.BigInteger(),
            sa.ForeignKey("clinical_encounters.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("plan_name", sa.String(length=128), nullable=False),
        sa.Column("condition_diagnosis", sa.Text(), nullable=False),
        sa.Column("referred_by", sa.String(length=128), nullable=True),
        sa.Column("total_sessions", sa.Integer(), nullable=False),
        sa.Column(
            "completed_sessions",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("agreed_price_paise", sa.BigInteger(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=32),
            server_default=sa.text("'ACTIVE'"),
            nullable=False,
        ),
        sa.Column("cancellation_reason", sa.Text(), nullable=True),
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
        sa.CheckConstraint(
            "total_sessions >= 1 AND total_sessions <= 200",
            name="ck_treatment_plans_total_sessions",
        ),
        sa.CheckConstraint(
            "completed_sessions >= 0 AND completed_sessions <= total_sessions",
            name="ck_treatment_plans_completed_sessions",
        ),
        sa.CheckConstraint("agreed_price_paise >= 0", name="ck_treatment_plans_agreed_price"),
        sa.CheckConstraint(
            "status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')",
            name="ck_treatment_plans_status",
        ),
        sa.CheckConstraint(
            "status != 'CANCELLED' OR ("
            "cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) >= 3)",
            name="ck_treatment_plans_cancellation",
        ),
    )
    op.create_index("ix_treatment_plans_patient_id", "treatment_plans", ["patient_id"])
    op.create_index("ix_treatment_plans_doctor_id", "treatment_plans", ["doctor_id"])
    op.create_index("ix_treatment_plans_status", "treatment_plans", ["status"])

    # 2. Table: treatment_sessions
    op.create_table(
        "treatment_sessions",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "treatment_plan_id",
            sa.BigInteger(),
            sa.ForeignKey("treatment_plans.id", ondelete="RESTRICT"),
            nullable=False,
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
        sa.Column("session_number", sa.Integer(), nullable=False),
        sa.Column(
            "session_date", sa.Date(), server_default=sa.text("CURRENT_DATE"), nullable=False
        ),
        sa.Column("vas_score", sa.Integer(), nullable=False),
        sa.Column(
            "modalities",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("clinical_notes", sa.Text(), nullable=False),
        sa.Column("is_finalised", sa.Boolean(), server_default=sa.text("true"), nullable=False),
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
        sa.UniqueConstraint(
            "treatment_plan_id",
            "session_number",
            name="uq_treatment_sessions_plan_session",
        ),
        sa.CheckConstraint(
            "vas_score >= 0 AND vas_score <= 10",
            name="ck_treatment_sessions_vas",
        ),
        sa.CheckConstraint("session_number >= 1", name="ck_treatment_sessions_number"),
        sa.CheckConstraint(
            "length(trim(clinical_notes)) >= 2",
            name="ck_treatment_sessions_notes",
        ),
    )
    op.create_index(
        "ix_treatment_sessions_treatment_plan_id", "treatment_sessions", ["treatment_plan_id"]
    )
    op.create_index("ix_treatment_sessions_patient_id", "treatment_sessions", ["patient_id"])
    op.create_index("ix_treatment_sessions_session_date", "treatment_sessions", ["session_date"])

    # 3. Table: treatment_session_addenda
    op.create_table(
        "treatment_session_addenda",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "session_id",
            sa.BigInteger(),
            sa.ForeignKey("treatment_sessions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "author_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("length(trim(note)) >= 2", name="ck_treatment_session_addenda_note"),
    )
    op.create_index(
        "ix_treatment_session_addenda_session_id",
        "treatment_session_addenda",
        ["session_id"],
    )

    # 4. Table: prescriptions
    op.create_table(
        "prescriptions",
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
        sa.Column(
            "encounter_id",
            sa.BigInteger(),
            sa.ForeignKey("clinical_encounters.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("diagnosis", sa.Text(), nullable=False),
        sa.Column("dietary_advice", sa.Text(), nullable=True),
        sa.Column("general_advice", sa.Text(), nullable=True),
        sa.Column("follow_up_date", sa.Date(), nullable=True),
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
        sa.CheckConstraint("length(trim(diagnosis)) >= 2", name="ck_prescriptions_diagnosis"),
    )
    op.create_index("ix_prescriptions_patient_id", "prescriptions", ["patient_id"])
    op.create_index("ix_prescriptions_doctor_id", "prescriptions", ["doctor_id"])
    op.create_index("ix_prescriptions_encounter_id", "prescriptions", ["encounter_id"])

    # 5. Table: prescription_items
    op.create_table(
        "prescription_items",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "prescription_id",
            sa.BigInteger(),
            sa.ForeignKey("prescriptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("item_order", sa.Integer(), nullable=False),
        sa.Column("medicine_name", sa.String(length=128), nullable=False),
        sa.Column("dosage", sa.String(length=64), nullable=False),
        sa.Column("frequency", sa.String(length=64), nullable=False),
        sa.Column("duration_days", sa.Integer(), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.UniqueConstraint("prescription_id", "item_order", name="uq_prescription_items_order"),
        sa.CheckConstraint(
            "duration_days >= 1 AND duration_days <= 365",
            name="ck_prescription_items_duration",
        ),
        sa.CheckConstraint(
            "length(trim(medicine_name)) >= 1",
            name="ck_prescription_items_medicine",
        ),
    )
    op.create_index(
        "ix_prescription_items_prescription_id",
        "prescription_items",
        ["prescription_id"],
    )

    # 6. Immutability trigger for finalised treatment sessions (TRT-03)
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_prevent_finalised_treatment_session_tampering()
        RETURNS TRIGGER AS $$
        BEGIN
            IF TG_OP = 'UPDATE' THEN
                IF OLD.is_finalised = TRUE THEN
                    IF (
                        OLD.treatment_plan_id IS DISTINCT FROM NEW.treatment_plan_id OR
                        OLD.patient_id IS DISTINCT FROM NEW.patient_id OR
                        OLD.doctor_id IS DISTINCT FROM NEW.doctor_id OR
                        OLD.session_number IS DISTINCT FROM NEW.session_number OR
                        OLD.session_date IS DISTINCT FROM NEW.session_date OR
                        OLD.vas_score IS DISTINCT FROM NEW.vas_score OR
                        OLD.modalities IS DISTINCT FROM NEW.modalities OR
                        OLD.clinical_notes IS DISTINCT FROM NEW.clinical_notes
                    ) THEN
                        RAISE EXCEPTION
                            'Finalised treatment session cannot be modified. '
                            'Append addendum instead.';
                    END IF;
                END IF;
                RETURN NEW;
            ELSIF TG_OP = 'DELETE' THEN
                IF OLD.is_finalised = TRUE THEN
                    RAISE EXCEPTION 'Finalised treatment session cannot be deleted.';
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
        CREATE TRIGGER trg_prevent_finalised_treatment_session_tampering
        BEFORE UPDATE OR DELETE ON treatment_sessions
        FOR EACH ROW
        EXECUTE FUNCTION fn_prevent_finalised_treatment_session_tampering();
        """
    )

    # 7. Progress sync trigger for treatment plans
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_sync_treatment_plan_session_progress()
        RETURNS TRIGGER AS $$
        DECLARE
            plan_total INTEGER;
            plan_completed INTEGER;
        BEGIN
            SELECT total_sessions, completed_sessions 
            INTO plan_total, plan_completed
            FROM treatment_plans 
            WHERE id = NEW.treatment_plan_id
            FOR UPDATE;

            plan_completed := plan_completed + 1;

            UPDATE treatment_plans
            SET completed_sessions = plan_completed,
                status = CASE WHEN plan_completed >= plan_total THEN 'COMPLETED' ELSE status END,
                updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
            WHERE id = NEW.treatment_plan_id;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_sync_treatment_plan_session_progress
        AFTER INSERT ON treatment_sessions
        FOR EACH ROW
        EXECUTE FUNCTION fn_sync_treatment_plan_session_progress();
        """
    )

    # 8. Permissions for kalyan_app role
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON treatment_plans TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON treatment_sessions TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON treatment_session_addenda TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON prescriptions TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON prescription_items TO kalyan_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    # Revoke role grants
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON prescription_items FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON prescriptions FROM kalyan_app;")
    op.execute(
        "REVOKE SELECT, INSERT, UPDATE, DELETE ON treatment_session_addenda FROM kalyan_app;"
    )
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON treatment_sessions FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON treatment_plans FROM kalyan_app;")

    op.execute(
        "DROP TRIGGER IF EXISTS trg_sync_treatment_plan_session_progress ON treatment_sessions;"
    )
    op.execute("DROP FUNCTION IF EXISTS fn_sync_treatment_plan_session_progress();")

    op.execute(
        "DROP TRIGGER IF EXISTS trg_prevent_finalised_treatment_session_tampering "
        "ON treatment_sessions;"
    )
    op.execute("DROP FUNCTION IF EXISTS fn_prevent_finalised_treatment_session_tampering();")

    op.drop_table("prescription_items")
    op.drop_table("prescriptions")
    op.drop_table("treatment_session_addenda")
    op.drop_table("treatment_sessions")
    op.drop_table("treatment_plans")
