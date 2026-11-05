"""Persist the selected department on each appointment.

Revision ID: 0009
Revises: 0008
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "appointments",
        sa.Column("department_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_appointments_department_id_departments",
        "appointments",
        "departments",
        ["department_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_appointments_department_id",
        "appointments",
        ["department_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_appointments_department_id", table_name="appointments")
    op.drop_constraint(
        "fk_appointments_department_id_departments",
        "appointments",
        type_="foreignkey",
    )
    op.drop_column("appointments", "department_id")
