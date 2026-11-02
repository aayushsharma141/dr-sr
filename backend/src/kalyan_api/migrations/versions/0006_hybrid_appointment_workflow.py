"""Separate same-day walk-in tokens from future scheduled visit bookings.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-02

Existing rows are preserved as WALK_IN and receive UNSPECIFIED visit type.
Scheduled visits do not consume a daily token until reception checks them in.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "appointments",
        sa.Column(
            "booking_mode",
            sa.String(length=16),
            server_default="WALK_IN",
            nullable=False,
        ),
    )
    op.add_column(
        "appointments",
        sa.Column(
            "visit_type",
            sa.String(length=32),
            server_default="UNSPECIFIED",
            nullable=False,
        ),
    )

    # Existing appointment tokens are retained. Only newly-created scheduled visits
    # may have a NULL token while they are awaiting check-in.
    op.alter_column("appointments", "token_number", existing_type=sa.Integer(), nullable=True)

    op.create_check_constraint(
        "ck_appointments_appointments_booking_mode_valid",
        "appointments",
        "booking_mode IN ('WALK_IN', 'SCHEDULED')",
    )
    op.create_check_constraint(
        "ck_appointments_appointments_visit_type_valid",
        "appointments",
        "visit_type IN ('UNSPECIFIED', 'NEW_CONSULTATION', 'FOLLOW_UP', "
        "'PHYSIOTHERAPY_SESSION', 'REVIEW')",
    )
    op.create_check_constraint(
        "ck_appointments_appointments_token_positive",
        "appointments",
        "token_number IS NULL OR token_number > 0",
    )
    op.create_index(
        "ix_appointments_mode_date",
        "appointments",
        ["booking_mode", "appointment_date"],
    )


def downgrade() -> None:
    # Before restoring NOT NULL, allocate numbers to any scheduled visit that never
    # reached check-in. This makes downgrade deterministic and preserves the unique
    # (doctor, date, token) invariant, although it necessarily removes scheduled mode.
    op.execute(
        """
        WITH missing_tokens AS (
            SELECT
                a.id,
                a.doctor_id,
                a.appointment_date,
                COALESCE(
                    (
                        SELECT MAX(existing.token_number)
                        FROM appointments AS existing
                        WHERE existing.doctor_id = a.doctor_id
                          AND existing.appointment_date = a.appointment_date
                          AND existing.token_number IS NOT NULL
                    ),
                    0
                ) + ROW_NUMBER() OVER (
                    PARTITION BY a.doctor_id, a.appointment_date
                    ORDER BY a.id
                ) AS next_token
            FROM appointments AS a
            WHERE a.token_number IS NULL
        )
        UPDATE appointments AS target
        SET token_number = missing_tokens.next_token
        FROM missing_tokens
        WHERE target.id = missing_tokens.id;
        """
    )
    op.drop_index("ix_appointments_mode_date", table_name="appointments")
    op.drop_constraint(
        "ck_appointments_appointments_token_positive", "appointments", type_="check"
    )
    op.drop_constraint(
        "ck_appointments_appointments_visit_type_valid", "appointments", type_="check"
    )
    op.drop_constraint(
        "ck_appointments_appointments_booking_mode_valid", "appointments", type_="check"
    )
    op.alter_column("appointments", "token_number", existing_type=sa.Integer(), nullable=False)
    op.drop_column("appointments", "visit_type")
    op.drop_column("appointments", "booking_mode")
