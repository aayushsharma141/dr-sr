"""Add doctor cabin code with partial unique index among active doctors.

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-10

K-60: Cabin code per doctor (A-Z) unique among active doctors, used for token displays.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("doctors", sa.Column("cabin_code", sa.String(length=1), nullable=True))
    op.create_index(
        "ix_doctors_active_cabin_code",
        "doctors",
        ["cabin_code"],
        unique=True,
        postgresql_where=sa.text("cabin_code IS NOT NULL AND is_active = true"),
        sqlite_where=sa.text("cabin_code IS NOT NULL AND is_active = 1"),
    )


def downgrade() -> None:
    op.drop_index("ix_doctors_active_cabin_code", table_name="doctors")
    op.drop_column("doctors", "cabin_code")

