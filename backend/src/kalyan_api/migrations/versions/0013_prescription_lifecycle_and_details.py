"""Prescription lifecycle, cancellation metadata, and item delivery fields.

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-06

Requirements:
- DWS-07: Prescription authoring lifecycle (DRAFT -> AUTHORISED -> CANCELLED with re-issuance).
- DWS-07: Item delivery fields (strength, form, route).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add columns to prescriptions
    op.add_column(
        "prescriptions",
        sa.Column(
            "status",
            sa.String(length=16),
            server_default=sa.text("'AUTHORISED'"),
            nullable=False,
        ),
    )
    op.add_column(
        "prescriptions",
        sa.Column("authorised_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "prescriptions",
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "prescriptions",
        sa.Column(
            "cancelled_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    op.add_column(
        "prescriptions",
        sa.Column("cancellation_reason", sa.Text(), nullable=True),
    )

    # 2. Add constraints to prescriptions
    op.create_check_constraint(
        "ck_prescriptions_status",
        "prescriptions",
        "status IN ('DRAFT', 'AUTHORISED', 'CANCELLED')",
    )
    op.create_check_constraint(
        "ck_prescriptions_cancellation",
        "prescriptions",
        "(status != 'CANCELLED' AND cancelled_at IS NULL AND cancellation_reason IS NULL AND cancelled_by_user_id IS NULL) "
        "OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND length(trim(cancellation_reason)) >= 3 AND cancelled_by_user_id IS NOT NULL)",
    )

    # 3. Add partial unique index for active prescription per encounter
    op.create_index(
        "uq_prescriptions_active_per_encounter",
        "prescriptions",
        ["encounter_id"],
        unique=True,
        postgresql_where=sa.text("encounter_id IS NOT NULL AND status IN ('DRAFT', 'AUTHORISED')"),
    )

    # 4. Add columns to prescription_items
    op.add_column(
        "prescription_items",
        sa.Column("strength", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "prescription_items",
        sa.Column("form", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "prescription_items",
        sa.Column("route", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("prescription_items", "route")
    op.drop_column("prescription_items", "form")
    op.drop_column("prescription_items", "strength")

    op.drop_index("uq_prescriptions_active_per_encounter", table_name="prescriptions")
    op.drop_constraint("ck_prescriptions_cancellation", "prescriptions", type_="check")
    op.drop_constraint("ck_prescriptions_status", "prescriptions", type_="check")

    op.drop_constraint("prescriptions_cancelled_by_user_id_fkey", "prescriptions", type_="foreignkey")
    op.drop_column("prescriptions", "cancellation_reason")
    op.drop_column("prescriptions", "cancelled_by_user_id")
    op.drop_column("prescriptions", "cancelled_at")
    op.drop_column("prescriptions", "authorised_at")
    op.drop_column("prescriptions", "status")
