"""Persist new-patient OPD arrivals before permanent registration.

Revision ID: 0031
Revises: 0030
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0031"
down_revision: str | None = "0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pending_opd_arrivals",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("full_name", sa.String(length=120), nullable=False),
        sa.Column("age_years", sa.Integer(), nullable=False),
        sa.Column("mobile", sa.String(length=15), nullable=False),
        sa.Column("doctor_id", sa.BigInteger(), nullable=False),
        sa.Column("department_id", sa.BigInteger(), nullable=False),
        sa.Column("appointment_date", sa.Date(), nullable=False),
        sa.Column("token_number", sa.Integer(), nullable=False),
        sa.Column("priority_level", sa.String(length=16), server_default="NORMAL", nullable=False),
        sa.Column("priority_reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="TO_ARRIVE", nullable=False),
        sa.Column("patient_id", sa.BigInteger(), nullable=True),
        sa.Column("appointment_id", sa.BigInteger(), nullable=True),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "status_updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("version_id", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("age_years >= 0 AND age_years <= 150", name="age_valid"),
        sa.CheckConstraint(
            "priority_level IN ('NORMAL', 'PRIORITY', 'EMERGENCY')", name="priority_valid"
        ),
        sa.CheckConstraint(
            "priority_level = 'NORMAL' OR (priority_reason IS NOT NULL "
            "AND length(trim(priority_reason)) >= 3)",
            name="priority_reason_present",
        ),
        sa.CheckConstraint("status IN ('TO_ARRIVE', 'REGISTERED')", name="status_valid"),
        sa.CheckConstraint(
            "(status = 'TO_ARRIVE' AND patient_id IS NULL AND appointment_id IS NULL) OR "
            "(status = 'REGISTERED' AND patient_id IS NOT NULL AND appointment_id IS NOT NULL)",
            name="status_links_consistent",
        ),
        sa.ForeignKeyConstraint(["doctor_id"], ["doctors.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["appointment_id"], ["appointments.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint(
            "doctor_id",
            "appointment_date",
            "token_number",
            name="uq_pending_opd_arrival_token",
        ),
        sa.UniqueConstraint("patient_id", name="uq_pending_opd_arrivals_patient_id"),
        sa.UniqueConstraint("appointment_id", name="uq_pending_opd_arrivals_appointment_id"),
    )
    op.create_index("ix_pending_opd_arrivals_doctor_id", "pending_opd_arrivals", ["doctor_id"])
    op.create_index(
        "ix_pending_opd_arrivals_department_id", "pending_opd_arrivals", ["department_id"]
    )
    op.create_index(
        "ix_pending_opd_arrivals_date_status",
        "pending_opd_arrivals",
        ["appointment_date", "status"],
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute("GRANT SELECT, INSERT, UPDATE ON pending_opd_arrivals TO kalyan_app;")
        op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    bind = op.get_bind()
    row_count = bind.execute(sa.text("SELECT count(*) FROM pending_opd_arrivals")).scalar_one()
    if row_count:
        raise RuntimeError("Refusing to drop pending_opd_arrivals while arrival history exists.")
    if bind.dialect.name == "postgresql":
        op.execute("REVOKE SELECT, INSERT, UPDATE ON pending_opd_arrivals FROM kalyan_app;")
    op.drop_index("ix_pending_opd_arrivals_date_status", table_name="pending_opd_arrivals")
    op.drop_index("ix_pending_opd_arrivals_department_id", table_name="pending_opd_arrivals")
    op.drop_index("ix_pending_opd_arrivals_doctor_id", table_name="pending_opd_arrivals")
    op.drop_table("pending_opd_arrivals")
