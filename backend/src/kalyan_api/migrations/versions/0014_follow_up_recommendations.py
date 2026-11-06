"""Follow-up recommendations schema.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-06

Requirements:
- DWS-08: Follow-up recommendations workflow and reception privacy separation.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Table: follow_up_recommendations
    op.create_table(
        "follow_up_recommendations",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column(
            "encounter_id",
            sa.BigInteger(),
            sa.ForeignKey("clinical_encounters.id", ondelete="CASCADE"),
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
        sa.Column(
            "recommended_doctor_id",
            sa.BigInteger(),
            sa.ForeignKey("doctors.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("recommended_date", sa.Date(), nullable=False),
        sa.Column("clinical_reason", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=16),
            server_default=sa.text("'PENDING'"),
            nullable=False,
        ),
        sa.Column(
            "booked_appointment_id",
            sa.BigInteger(),
            sa.ForeignKey("appointments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("closed_reason", sa.Text(), nullable=True),
        sa.Column(
            "closed_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "version_id",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
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
        sa.UniqueConstraint("encounter_id", name="uq_follow_up_encounter"),
        sa.CheckConstraint(
            "status IN ('PENDING', 'BOOKED', 'CLOSED')",
            name="ck_follow_up_recommendations_status",
        ),
        sa.CheckConstraint(
            "(status != 'CLOSED' AND closed_reason IS NULL AND closed_by_user_id IS NULL AND closed_at IS NULL) "
            "OR (status = 'CLOSED' AND closed_reason IS NOT NULL AND length(trim(closed_reason)) >= 3 AND closed_by_user_id IS NOT NULL AND closed_at IS NOT NULL)",
            name="ck_follow_up_recommendations_closure",
        ),
    )
    op.create_index(
        "ix_follow_up_status_date",
        "follow_up_recommendations",
        ["status", "recommended_date"],
    )
    op.create_index(
        "ix_follow_up_patient",
        "follow_up_recommendations",
        ["patient_id"],
    )

    # 2. Permissions for kalyan_app
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON follow_up_recommendations TO kalyan_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON follow_up_recommendations FROM kalyan_app;")
    op.drop_table("follow_up_recommendations")
