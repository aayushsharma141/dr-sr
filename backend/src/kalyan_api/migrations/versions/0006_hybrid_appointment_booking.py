"""Hybrid walk-in token and date-based scheduled appointment workflow.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-03

Adds visit intent and explicit test-data marking. Scheduled dates reserve a
doctor-specific daily token; they do not imply a guaranteed arrival time.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Keep synthetic records created by persistent recovery/gate tests out of live pickers.
    op.add_column(
        "patients",
        sa.Column(
            "is_test_data",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.execute(
        """
        UPDATE patients
        SET is_test_data = TRUE
        WHERE urn IN (
            'KHM-2026-17001',
            'KHM-2026-77777',
            'KHM-2026-99999'
        )
        """
    )

    # Existing appointments retain their token and are classified as legacy walk-ins.
    op.add_column(
        "appointments",
        sa.Column(
            "booking_mode",
            sa.String(length=16),
            server_default=sa.text("'WALK_IN'"),
            nullable=False,
        ),
    )
    op.add_column(
        "appointments",
        sa.Column(
            "visit_type",
            sa.String(length=32),
            server_default=sa.text("'NEW_CONSULTATION'"),
            nullable=False,
        ),
    )
    op.add_column(
        "appointments",
        sa.Column(
            "treatment_plan_id",
            sa.BigInteger(),
            sa.ForeignKey("treatment_plans.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    op.create_check_constraint(
        "ck_appointments_booking_mode",
        "appointments",
        "booking_mode IN ('WALK_IN', 'SCHEDULED')",
    )
    op.create_check_constraint(
        "ck_appointments_visit_type",
        "appointments",
        "visit_type IN ('NEW_CONSULTATION', 'FOLLOW_UP', 'PHYSIOTHERAPY_SESSION')",
    )
    op.create_index(
        "ix_appointments_patient_doctor_date_type_status",
        "appointments",
        ["patient_id", "doctor_id", "appointment_date", "visit_type", "status"],
    )
    op.create_index(
        "ix_appointments_booking_date_mode",
        "appointments",
        ["appointment_date", "booking_mode"],
    )


def downgrade() -> None:
    op.drop_index("ix_appointments_booking_date_mode", table_name="appointments")
    op.drop_index("ix_appointments_patient_doctor_date_type_status", table_name="appointments")
    op.drop_constraint("ck_appointments_visit_type", "appointments", type_="check")
    op.drop_constraint("ck_appointments_booking_mode", "appointments", type_="check")
    op.drop_column("appointments", "treatment_plan_id")
    op.drop_column("appointments", "visit_type")
    op.drop_column("appointments", "booking_mode")
    op.drop_column("patients", "is_test_data")
