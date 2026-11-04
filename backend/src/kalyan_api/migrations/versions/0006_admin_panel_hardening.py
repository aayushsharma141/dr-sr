"""Admin panel hardening: optimistic locking for consultation fee schedules.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-04

Requirements:
- SET-03: Consultation fee schedule edits are versioned.
- SEC-06 / D-08: version_id on mutable tables (consultation_fees) so concurrent admin
  edits are rejected with 409 version_conflict instead of silently overwriting.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Column: consultation_fees.version_id (SEC-06). Existing rows start at version 1.
    op.add_column(
        "consultation_fees",
        sa.Column(
            "version_id",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
    )

    # 2. Least-privilege grants for runtime role kalyan_app are unchanged: the column inherits
    #    the existing table-level SELECT, INSERT, UPDATE grant on consultation_fees (no DELETE).


def downgrade() -> None:
    op.drop_column("consultation_fees", "version_id")
